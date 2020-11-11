// @ts-ignore
import * as crypto from 'crypto';
// @ts-ignore
import * as fs from 'fs';
// @ts-ignore
import * as path from 'path';

import { DownloaderHelper } from 'node-downloader-helper';

import { Dispatcher } from './Dispatcher';
import { DownloaderState } from './enums/DownloaderState';

export class Downloader {
  public simultaneusDownloads = 5;
  public maxRetries = 3;
  public checksumAlgo = 'sha256';

  public state: DownloaderState = DownloaderState.STAND_BY;

  private lastProgressDispatchedTime = 0;

  private dispatcher: Dispatcher = new Dispatcher();

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

  private downloadersQueue: DownloaderHelper[] = [];
  private downloadersInProgress: DownloaderHelper[] = [];

  private readonly downloaderOptions = {};

  constructor(downloaderOptions = {}) {
    this.downloaderOptions = downloaderOptions;
  }

  private checksumFile(downloader) {
    const filePath = downloader.filePath;

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(this.checksumAlgo);
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => reject(err));
      stream.on('data', (chunk) => {
        hash.update(chunk);

        const stats = downloader.getStats();
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

      this.dispatcher.dispatch('progress', {
        ...stats,
        ...{
          progressTotal: this.progress,
          progressDownload: this.downloadProgress,
          progressCheck: this.checkProgress,
        },
      });
    }
  }

  private async isFileNeedUpdate(downloader) {
    let localChecksum = null;
    const filePath = downloader.filePath;
    const fileSize = downloader.fileSize;
    const checksum = downloader.checksum;

    if (!fs.existsSync(filePath)) {
      return true;
    }

    if (fs.existsSync(`${filePath}.${this.checksumAlgo}`)) {
      localChecksum = fs
        .readFileSync(`${filePath}.${this.checksumAlgo}`)
        .toString();
      this.bytesChecked += fileSize;
    } else if (fs.existsSync(filePath)) {
      localChecksum = await this.checksumFile(downloader);
      fs.writeFileSync(`${filePath}.${this.checksumAlgo}`, localChecksum);
    } else {
      return true;
    }

    if (localChecksum !== checksum) {
      this.bytesToCheck += fileSize;
    }

    return localChecksum !== checksum;
  }

  private async startDownloader(downloader) {
    let lastDownloadedSize = 0;
    this.downloadersInProgress.push(downloader);

    downloader.on('progress.throttled', (stats) => {
      const totalDownloaded = stats.downloaded - lastDownloadedSize;
      this.bytesDownloaded += totalDownloaded;

      if (!downloader.checksum) {
        this.bytesChecked += totalDownloaded;
      }

      lastDownloadedSize = stats.downloaded;
      this.dispatchProgress(stats);
    });

    downloader.on('end', async (downloadInfos) => {
      if (downloader.checksum) {
        const checksum = await this.checksumFile(downloader);
        if (checksum !== downloader.checksum) {
          if (!downloader.retryCount) {
            downloader.retryCount = 0;
          }
          if (downloader.retryCount >= this.maxRetries) {
            this.dispatcher.dispatch('error', {
              message: 'Max retries attempts.',
              file: downloadInfos.fileName,
              path: downloadInfos.filePath,
              checksum: downloader.checksum,
              fileChecksum: checksum,
            });
            return;
          }
          this.bytesToCheck += downloader.fileSize;
          this.bytesToDownload += downloader.fileSize;
          downloader.retryCount++;
          await downloader.start();
          return;
        }
        fs.writeFileSync(
          `${downloadInfos.filePath}.${this.checksumAlgo}`,
          checksum
        );
      }

      this.downloaderCompleted(downloader);
    });

    if (!this.forceDownload && !(await this.isFileNeedUpdate(downloader))) {
      this.downloaderCompleted(downloader, true);
      return;
    }

    if (!fs.existsSync(downloader.installPath)) {
      fs.mkdirSync(downloader.installPath, {
        recursive: true,
      });
    }
    if (fs.existsSync(downloader.filePath)) {
      fs.unlinkSync(downloader.filePath);
    }
    await downloader.start();
  }

  private downloaderCompleted(downloader, pass = false) {
    this.filesDownloaded++;
    const stats = downloader.getStats();
    if (pass) {
      this.bytesDownloaded += downloader.fileSize;
    }

    this.dispatchProgress(stats);

    if (this.progress >= 100) {
      this.dispatcher.dispatch('end', {});
      return;
    }

    this.removeDownloaderFromQueue(downloader);
    this.startNextDownloader();
  }

  private startNextDownloader() {
    if (this.state === DownloaderState.STOPED) {
      return false;
    }

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

  private removeDownloaderFromQueue(downloader) {
    const index = this.downloadersInProgress.indexOf(downloader);
    if (index > -1) {
      this.downloadersInProgress.splice(index, 1);
      return true;
    }
    return false;
  }

  clean() {
    if (this.state === DownloaderState.DOWNLOADING) {
      throw new Error('Cannot clean while downloading.');
    }
    //this.dispatcher.clean();
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
    this.lastProgressDispatchedTime = null;
    this.state = DownloaderState.STAND_BY;
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
    const downloader = new DownloaderHelper(fileUrl, installPath, {
      ...{
        fileName: fileName,
        forceResume: true,
        override: true,
        retry: { maxRetries: 3, delay: 3000 },
      },
      ...this.downloaderOptions,
    });

    downloader.checksum = checksum;
    downloader.fileName = fileName || path.parse(fileUrl).base;
    downloader.filePath = path.resolve(installPath, downloader.fileName);
    downloader.installPath = path.dirname(downloader.filePath);

    this.downloadersQueue.push(downloader);
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

    for (const downloader of this.downloadersQueue) {
      const stats = await downloader.getTotalSize();
      const fileSize = stats.total;

      this.bytesToCheck += fileSize;
      this.bytesToDownload += fileSize;
      downloader.fileSize = fileSize;
    }

    this.downloadersQueue.forEach(() => {
      if (this.startNextDownloader() == false) {
        return;
      }
    });
  }

  stop() {
    this.state = DownloaderState.STOPED;
    this.downloadersInProgress.forEach((downloader) => {
      downloader.stop();
    });
    this.clean();
  }

  pause() {
    this.state = DownloaderState.PAUSED;
    this.downloadersInProgress.forEach((downloader) => {
      downloader.pause();
    });
  }

  async resume() {
    this.state = DownloaderState.DOWNLOADING;

    if (this.downloadersInProgress.length > 0) {
      this.downloadersInProgress.forEach((downloader) => {
        downloader.resume();
      });
    } else {
      await this.startNextDownloader();
    }
  }

  on(eventName: string, callback: (data) => void): Downloader {
    this.dispatcher.on(eventName, callback);
    return this;
  }

  off(eventName: string, callback: (data) => void): Downloader {
    this.dispatcher.off(eventName, callback);
    return this;
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

export function createDownloader(dowloaderOptions = {}): Downloader {
  return new Downloader(dowloaderOptions);
}
