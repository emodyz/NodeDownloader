// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';

import test from 'ava';

import { createDownloader, Downloader } from './Downloader';

const installPath = path.resolve('./downloads');

const filesLibrary = [
  {
    url: 'http://www.ovh.net/files/1Mio.dat',
    sha1: '22c952ea2b497171d37b76f0830ef8d9911cfe9b',
    md5: '6cb91af4ed4c60c11613b75cd1fc6116',
    name: '1Mio.dat',
  },
  {
    url: 'http://www.ovh.net/files/10Mio.dat',
    sha1: '984bc7daae5f509357fb6694277a9852db61f2a7',
    md5: 'ecf2a421f46ab33f277fa2aaaf141780',
    name: '10Mio.dat',
  },
];

function cleanDownloads() {
  fs.readdirSync(installPath).forEach((file) => {
    if (file !== '.gitignore') {
      fs.unlinkSync(path.resolve(installPath, file));
    }
  });
}

function waitDownloadForEnd(downloader) {
  return new Promise((resolve, reject) => {
    downloader.on('end', () => {
      resolve();
    });
    downloader.on('error', (err) => {
      reject(err);
    });
  });
}

function checkFileIntegrity(
  fileName: string,
  checksum: string = null,
  algo: string = null
) {
  const filePath = path.resolve(installPath, fileName);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  if (checksum && !fs.existsSync(`${filePath}.${algo}`)) {
    return false;
  }

  if (checksum) {
    const localChecksum = fs.readFileSync(`${filePath}.${algo}`).toString();
    if (checksum !== localChecksum) {
      return false;
    }
  }

  return true;
}

function getFileStats(fileName) {
  const filePath = path.resolve(installPath, fileName);
  return fs.statSync(filePath);
}

test.beforeEach('cleanFiles', () => {
  cleanDownloads();
});

test('createDownloader return Downloader instance', (t) => {
  const downloader = createDownloader();
  t.true(downloader instanceof Downloader);
});

test('addFile must increment files in stats', (t) => {
  const downloader = createDownloader();
  const file = filesLibrary[0];
  t.is(0, downloader.stats().files);
  downloader.addFile(file.url, installPath);
  t.is(1, downloader.stats().files);
});

test('start function must start downloads', async (t) => {
  const downloader = createDownloader();

  t.is(0, downloader.stats().fileDownloaded);
  filesLibrary.forEach((file) => {
    downloader.addFile(file.url, installPath);
  });
  await downloader.start();
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);

  filesLibrary.forEach((file) => {
    t.true(checkFileIntegrity(file.name));
  });
});

test('downloads files checksum must be created if specified', async (t) => {
  const downloader = createDownloader();
  downloader.checksumAlgo = 'sha1';

  t.is(0, downloader.stats().fileDownloaded);
  filesLibrary.forEach((file) => {
    downloader.addFile(file.url, installPath, null, file.sha1);
  });
  await downloader.start();
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);

  filesLibrary.forEach((file) => {
    t.true(checkFileIntegrity(file.name, file.sha1, downloader.checksumAlgo));
  });
});

test('downloads files checksum with another algo must work', async (t) => {
  const downloader = createDownloader();
  downloader.checksumAlgo = 'md5';

  t.is(0, downloader.stats().fileDownloaded);
  filesLibrary.forEach((file) => {
    downloader.addFile(file.url, installPath, null, file.md5);
  });
  await downloader.start();
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);

  filesLibrary.forEach((file) => {
    t.true(checkFileIntegrity(file.name, file.md5, downloader.checksumAlgo));
  });
});

test('downloads files with wrong checksum must fail', async (t) => {
  const downloader = createDownloader();
  const badChecksum = '293Kjhgigk324jkjkbbi';
  downloader.checksumAlgo = 'md5';

  downloader.addFile(filesLibrary[0].url, installPath, null, badChecksum);
  await downloader.start();

  try {
    await waitDownloadForEnd(downloader);
    t.fail();
  } catch (e) {
    t.pass();
  }
});

test('downloads with low simulataneousDownload must download all files', async (t) => {
  const downloader = createDownloader();
  downloader.simultaneusDownloads = 1;

  t.is(0, downloader.stats().fileDownloaded);
  filesLibrary.forEach((file) => {
    downloader.addFile(file.url, installPath);
  });
  await downloader.start();
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);
});

test('download with existing file and correct checksum must not restart download', async (t) => {
  const file = filesLibrary[0];
  const createDownload = () => {
    const newDownloader = createDownloader();
    newDownloader.checksumAlgo = 'sha1';
    newDownloader.addFile(file.url, installPath, null, file.sha1);
    return newDownloader;
  };
  let downloader = createDownload();
  await downloader.start();
  await waitDownloadForEnd(downloader);

  let stats = getFileStats(file.name);
  const fileCreationTime = stats.birthtimeMs;

  await new Promise((resolve) => {
    // @ts-ignore
    setTimeout(async () => {
      downloader = createDownload();
      await downloader.start();
      await waitDownloadForEnd(downloader);

      stats = getFileStats(file.name);
      t.is(fileCreationTime, stats.birthtimeMs);

      resolve();
    }, 2000);
  });
});

test('two files with same name must redownload', async (t) => {
  const fileName = 'test.dat';
  const file1 = filesLibrary[0];
  const file2 = filesLibrary[1];

  const createDownload = (file) => {
    const newDownloader = createDownloader();
    newDownloader.checksumAlgo = 'sha1';
    newDownloader.addFile(file.url, installPath, fileName, file.sha1);
    return newDownloader;
  };
  let downloader = createDownload(file1);
  await downloader.start();
  await waitDownloadForEnd(downloader);
  t.true(checkFileIntegrity(fileName, file1.sha1, downloader.checksumAlgo));

  let stats = getFileStats(fileName);
  const fileCreationTime = stats.birthtimeMs;

  await new Promise((resolve) => {
    // @ts-ignore
    setTimeout(async () => {
      downloader = createDownload(file2);
      await downloader.start();
      await waitDownloadForEnd(downloader);

      t.true(checkFileIntegrity(fileName, file2.sha1, downloader.checksumAlgo));

      stats = getFileStats(fileName);
      t.not(fileCreationTime, stats.birthtimeMs);

      resolve();
    }, 2000);
  });
});
