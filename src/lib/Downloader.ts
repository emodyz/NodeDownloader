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
  public state: DownloaderState = DownloaderState.STAND_BY;

  private dispatcher: Dispatcher = new Dispatcher();

  private bytesToDownload = 0;
  private bytesDownloaded = 0;
  private filesToDownload = 0;
  private filesDownloaded = 0;
  private progress = 0;

  private forceDownload = false;

  private downloadersQueue: DownloaderHelper[] = [];
  private downloadersInProgress: DownloaderHelper[] = [];

  public simultaneusDownloads = 5;
  public maxRetries = 3;
  public checksumAlgo = 'sha256';

  private downloaderOptions = {};

  constructor(downloaderOptions = {}) {
    this.downloaderOptions = downloaderOptions;
  }

  private checksumFile(path: string) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(this.checksumAlgo);
      const stream = fs.createReadStream(path);
      stream.on('error', (err) => reject(err));
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private async isFileNeedUpdate(filePath, checksum) {
    let localChecksum = null;

    if (!fs.existsSync(filePath)) {
      return true;
    }

    if (fs.existsSync(`${filePath}.${this.checksumAlgo}`)) {
      localChecksum = fs
        .readFileSync(`${filePath}.${this.checksumAlgo}`)
        .toString();
    } else if (fs.existsSync(filePath)) {
      localChecksum = await this.checksumFile(filePath);
      fs.writeFileSync(`${filePath}.${this.checksumAlgo}`, localChecksum);
    } else {
      return true;
    }

    if (localChecksum !== checksum) {
      return true;
    }

    return false;
  }

  private async startDownloader(downloader) {
    let lastDownloadedSize = 0;
    this.downloadersInProgress.push(downloader);

    downloader.on('progress.throttled', (stats) => {
      const totalDownloaded = stats.downloaded - lastDownloadedSize;
      this.bytesDownloaded += totalDownloaded;

      lastDownloadedSize = stats.downloaded;
      this.progress = (this.bytesDownloaded * 100) / this.bytesToDownload;

      this.dispatcher.dispatch('progress', {
        ...stats,
        ...{
          progressTotal: this.progress,
        },
      });
    });

    downloader.on('end', async (downloadInfos) => {
      if (downloader.checksum) {
        const checksum = await this.checksumFile(downloadInfos.filePath);
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
          downloader.retryCount++;
          await downloader.start();
          return;
        }
        fs.writeFileSync(
          `${downloadInfos.filePath}.${this.checksumAlgo}`,
          checksum
        );
      }
      await this.downloaderCompleted(downloader);
    });

    if (
      !this.forceDownload &&
      !(await this.isFileNeedUpdate(downloader.filePath, downloader.checksum))
    ) {
      await this.downloaderCompleted(downloader, true);
      return;
    }

    if (fs.existsSync(downloader.filePath)) {
      fs.unlinkSync(downloader.filePath);
    }
    await downloader.start();
  }

  private async downloaderCompleted(downloader, pass = false) {
    this.filesDownloaded++;
    const stats = downloader.getStats();
    if (pass) {
      const stats = await downloader.getTotalSize();
      const fileSize = stats.total;
      this.bytesDownloaded += fileSize;
    }

    this.progress = (this.bytesDownloaded * 100) / this.bytesToDownload;

    this.dispatcher.dispatch('progress', {
      ...stats,
      ...{
        progressTotal: this.progress,
      },
    });

    if (this.progress === 100) {
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
    this.downloadersQueue = [];
    this.downloadersInProgress = [];
    this.filesToDownload = 0;
    this.filesDownloaded = 0;
    this.bytesToDownload = 0;
    this.bytesDownloaded = 0;
    this.progress = 0;
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
    downloader.installPath = installPath;
    downloader.filePath = path.resolve(
      downloader.installPath,
      downloader.fileName
    );

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

    await this.downloadersQueue.forEach(async (downloader) => {
      const stats = await downloader.getTotalSize();
      const fileSize = stats.total;
      this.bytesToDownload = this.bytesToDownload + fileSize;
    });

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

  resume() {
    this.state = DownloaderState.DOWNLOADING;

    if (this.downloadersInProgress.length > 0) {
      this.downloadersInProgress.forEach((downloader) => {
        downloader.resume();
      });
    } else {
      this.startNextDownloader();
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
    };
  }
}

export function createDownloader(dowloaderOptions = {}): Downloader {
  return new Downloader(dowloaderOptions);
}
