import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {DownloaderState} from "./enums/DownloaderState";
import {DownloaderHelper, DownloaderHelperOptions} from "node-downloader-helper";
import {EventEmitter} from 'events';

interface QueuedDownloader {
    downloader: DownloaderHelper;
    checksum: string | null;
    fileName: string;
    filePath: string;
    installPath: string;
    fileSize: number;
    retryCount: number;
}

export class Downloader extends EventEmitter {

    public simultaneusDownloads = 5;
    public maxRetries = 3;
    public checksumAlgo = 'sha256';

    public state: DownloaderState = DownloaderState.STAND_BY;

    private lastProgressDispatchedTime = 0;

    private bytesToDownload = 0;
    private bytesDownloaded = 0;

    private bytesToCheck = 0;
    private bytesChecked = 0;

    private filesToDownload = 0;
    private filesDownloaded = 0;

    private downloadProgress = 0;
    private checkProgress = 0;
    private progress = 0;

    private forceDownload = false;

    private downloadersQueue: QueuedDownloader[] = [];
    private downloadersInProgress: QueuedDownloader[] = [];

    private readonly downloaderOptions: DownloaderHelperOptions;

    constructor(downloaderOptions: DownloaderHelperOptions = {}) {
        super();
        this.downloaderOptions = downloaderOptions;
    }

    clean() {
        if (this.state === DownloaderState.DOWNLOADING) {
            throw new Error('Cannot clean while downloading.');
        }
        this.downloadersQueue = [];
        this.downloadersInProgress = [];
        this.filesToDownload = 0;
        this.filesDownloaded = 0;
        this.bytesToDownload = 0;
        this.bytesDownloaded = 0;
        this.bytesToCheck = 0;
        this.bytesChecked = 0;
        this.downloadProgress = 0;
        this.checkProgress = 0;
        this.progress = 0;
        this.lastProgressDispatchedTime = 0; // TODO see why is it null before
        this.state = DownloaderState.STAND_BY;
    }

    private checksumFile(queuedDownloader: QueuedDownloader): Promise<string | null> {
        const filePath = queuedDownloader.filePath;

        return new Promise((resolve, reject) => {
            const hash = crypto.createHash(this.checksumAlgo);
            const stream = fs.createReadStream(filePath);
            const stats = queuedDownloader.downloader.getStats();

            stream.on('error', (err) => reject(err));
            stream.on('data', (chunk) => {
                if (this.state === DownloaderState.STOPED) {
                    stream.close();
                    resolve(null);
                    return;
                }

                hash.update(chunk);

                this.bytesChecked += chunk.length;
                this.dispatchProgress(stats);
            });
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    private dispatchProgress(stats) {
        const currentTime = new Date().getTime();
        const elaspsedTime = currentTime - this.lastProgressDispatchedTime;

        this.downloadProgress = (this.bytesDownloaded * 100) / this.bytesToDownload;
        this.checkProgress = (this.bytesChecked * 100) / this.bytesToCheck;
        this.progress = (this.downloadProgress + this.checkProgress) / 2;

        if (this.progress >= 100 || elaspsedTime > 1000) {
            this.lastProgressDispatchedTime = currentTime;

            this.emit('progress', {
                ...stats,
                ...{
                    progressTotal: this.progress,
                    progressDownload: this.downloadProgress,
                    progressCheck: this.checkProgress,
                },
            });
        }
    }

    private async isFileNeedUpdate(queuedDownloader: QueuedDownloader) {
        let localChecksum: any = null;
        const filePath = queuedDownloader.filePath;
        const fileSize = queuedDownloader.fileSize;
        const checksum = queuedDownloader.checksum;
        const checksumFilePath = `${filePath}.${this.checksumAlgo}`;

        if (!fs.existsSync(filePath)) {
            return true;
        }

        if (fs.existsSync(checksumFilePath)) {
            localChecksum = fs.readFileSync(checksumFilePath).toString();
            this.bytesChecked += fileSize;
        } else if (fs.existsSync(filePath)) {
            localChecksum = await this.checksumFile(queuedDownloader);
            fs.writeFileSync(checksumFilePath, localChecksum);
        } else {
            return true;
        }

        if (localChecksum !== checksum) {
            this.bytesToCheck += fileSize;
        }

        return localChecksum !== checksum;
    }

    private async startDownloader(queuedDownloader: QueuedDownloader) {
        let lastDownloadedSize = 0;
        this.downloadersInProgress.push(queuedDownloader);

        queuedDownloader.downloader.on('progress.throttled', (stats) => {
            const totalDownloaded = stats.downloaded - lastDownloadedSize;
            this.bytesDownloaded += totalDownloaded;

            if (!queuedDownloader.checksum) {
                this.bytesChecked += totalDownloaded;
            }

            lastDownloadedSize = stats.downloaded;
            this.dispatchProgress(stats);
        });

        queuedDownloader.downloader.on('end', async (downloadInfos) => {
            if (this.state === DownloaderState.STOPED) {
                return;
            }

            if (queuedDownloader.checksum) {
                const checksum: string | null = await this.checksumFile(queuedDownloader);

                // @ts-ignore
                if (checksum === null && this.state === DownloaderState.STOPED) {
                    this.downloaderStopped(queuedDownloader);
                    return;
                }

                if (checksum !== queuedDownloader.checksum) {
                    if (!queuedDownloader.retryCount) {
                        queuedDownloader.retryCount = 0;
                    }
                    if (queuedDownloader.retryCount >= this.maxRetries) {
                        this.emit('error', {
                            message: 'Max retries attempts.',
                            file: downloadInfos.fileName,
                            path: downloadInfos.filePath,
                            checksum: queuedDownloader.checksum,
                            fileChecksum: checksum,
                        });
                        return;
                    }
                    this.bytesToCheck += queuedDownloader.fileSize;
                    this.bytesToDownload += queuedDownloader.fileSize;
                    queuedDownloader.retryCount++;
                    await queuedDownloader.downloader.start();
                    return;
                }

                if (checksum) {
                    fs.writeFileSync(
                        `${downloadInfos.filePath}.${this.checksumAlgo}`,
                        checksum
                    );
                }
            }

            this.downloaderCompleted(queuedDownloader);
        });

        queuedDownloader.downloader.on('stop', async () => {
            this.downloaderStopped(queuedDownloader);
        });

        queuedDownloader.downloader.on('error', async (error) => {
            this.stop();
            this.emit('error', error);
        });

        if (!this.forceDownload && !(await this.isFileNeedUpdate(queuedDownloader))) {
            this.downloaderCompleted(queuedDownloader, true);
            return;
        }

        if (!fs.existsSync(queuedDownloader.installPath)) {
            fs.mkdirSync(queuedDownloader.installPath, {
                recursive: true,
            });
        }
        if (fs.existsSync(queuedDownloader.filePath)) {
            fs.unlinkSync(queuedDownloader.filePath);
        }

        if (this.state === DownloaderState.PAUSED) {
            return;
        }

        if (this.state === DownloaderState.STOPED) {
            await queuedDownloader.downloader.stop();
            return;
        }

        await queuedDownloader.downloader.start();
    }

    private downloaderStopped(queuedDownloader: QueuedDownloader) {
        this.removeDownloaderFromQueue(queuedDownloader);

        if (
            this.downloadersQueue.length === 0 &&
            this.downloadersInProgress.length === 0
        ) {
            this.clean();

            this.emit('stop', {});
            return;
        }
        this.startNextDownloader();
    }

    private downloaderCompleted(queuedDownloader: QueuedDownloader, pass = false) {
        this.filesDownloaded++;
        const stats = queuedDownloader.downloader.getStats();

        if (pass) {
            this.bytesDownloaded += queuedDownloader.fileSize;
        }

        this.dispatchProgress(stats);

        if (this.progress >= 100) {
            this.emit('end', {});
            return;
        }

        this.removeDownloaderFromQueue(queuedDownloader);
        this.startNextDownloader();
    }

    private startNextDownloader() {
        if (this.downloadersInProgress.length >= this.simultaneusDownloads) {
            return false;
        }

        const downloader = this.downloadersQueue.shift();
        if (downloader) {
            this.startDownloader(downloader);
            return true;
        }
        return false;
    }

    private removeDownloaderFromQueue(queuedDownloader: QueuedDownloader) {
        const index = this.downloadersInProgress.indexOf(queuedDownloader);
        if (index > -1) {
            this.downloadersInProgress.splice(index, 1);
            return true;
        }
        return false;
    }

    addFile(
        fileUrl: string,
        installPath: string,
        fileName: string | null = null,
        checksum: string | null = null
    ): Downloader {
        if (this.state !== DownloaderState.STAND_BY) {
            throw new Error('Cannot add file while downloading.');
        }

        fileName = path.normalize(fileName || path.parse(fileUrl).base);
        installPath = path.normalize(installPath);

        const downloader = new DownloaderHelper(fileUrl, installPath, {
            ...{
                fileName: fileName,
                forceResume: true,
                override: true,
                retry: { maxRetries: 3, delay: 3000 },
            },
            ...this.downloaderOptions,
        });

        const filePath = path.resolve(installPath, fileName);

        const queuedDownloader: QueuedDownloader = {
            downloader: downloader,
            checksum: checksum,
            fileName: fileName,
            filePath: filePath,
            installPath: path.dirname(filePath),
            fileSize: 0,
            retryCount: 0
        }

        this.downloadersQueue.push(queuedDownloader);
        this.filesToDownload++;

        return this;
    }

    async start(forceDownload = false) {
        if (this.state !== DownloaderState.STAND_BY) {
            throw new Error('Download already in progress.');
        }
        this.state = DownloaderState.DOWNLOADING;
        this.forceDownload = forceDownload;

        this.filesToDownload = this.downloadersQueue.length;
        this.lastProgressDispatchedTime = new Date().getTime();

        for (const queuedDownloader of this.downloadersQueue) {
            const stats = await queuedDownloader.downloader.getTotalSize();
            if (stats.total === null) {
                throw new Error('Cannot get file size.');
            }
            
            const fileSize = stats.total;

            this.bytesToCheck += fileSize;
            this.bytesToDownload += fileSize;

            queuedDownloader.fileSize = fileSize;
        }

        this.downloadersQueue.forEach(() => {
            if (this.startNextDownloader() == false) {
                return;
            }
        });
    }

    stop() {
        this.state = DownloaderState.STOPED;

        this.downloadersInProgress.forEach((queuedDownloader) => {
            queuedDownloader.downloader.stop();
        });
    }

    pause() {
        this.state = DownloaderState.PAUSED;
        this.downloadersInProgress.forEach((queuedDownloader) => {
            queuedDownloader.downloader.pause();
        });
    }

    async resume() {
        this.state = DownloaderState.DOWNLOADING;

        if (this.downloadersInProgress.length > 0) {
            this.downloadersInProgress.forEach((queuedDownloader) => {
                queuedDownloader.downloader.resume();
            });
        } else {
            await this.startNextDownloader();
        }
    }

    stats() {
        return {
            files: this.filesToDownload,
            fileDownloaded: this.filesDownloaded,
            progress: this.progress,
            progressDownload: this.downloadProgress,
            progressCheck: this.checkProgress,
        };
    }
}

export function createDownloader(downloaderOptions: DownloaderHelperOptions = {}): Downloader {
    return new Downloader(downloaderOptions);
}