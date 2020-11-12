// @ts-ignore
import fs from 'fs';
// @ts-ignore
import os from 'os';
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

function deleteFolderRecursive(filePath: string) {
  if (fs.existsSync(filePath)) {
    fs.readdirSync(filePath).forEach(function (file) {
      const curPath = path.resolve(filePath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(filePath);
  }
}

function cleanDownloads() {
  fs.readdirSync(installPath).forEach((directoryOrFile) => {
    if (directoryOrFile !== '.gitignore') {
      deleteFolderRecursive(path.resolve(installPath, directoryOrFile));
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
    downloader.start();
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

test.after('cleanFiles', () => {
  cleanDownloads();
});

test('createDownloader return Downloader instance', (t) => {
  const downloader = createDownloader();
  t.true(downloader instanceof Downloader);
});

test('addFile must increment files in stats', async (t) => {
  const downloader = createDownloader();
  const file = filesLibrary[0];
  t.is(0, downloader.stats().files);
  downloader.addFile(file.url, installPath);
  t.is(1, downloader.stats().files);
});

test('start function must start downloads', async (t) => {
  const downloader = createDownloader();

  t.is(0, downloader.stats().fileDownloaded);
  for (const file of filesLibrary) {
    downloader.addFile(file.url, installPath, `test-1/${file.name}`);
  }
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);

  filesLibrary.forEach((file) => {
    t.true(checkFileIntegrity(`test-1/${file.name}`));
  });
});

test('download need to create folder recursively', async (t) => {
  const downloader = createDownloader();

  t.is(0, downloader.stats().fileDownloaded);
  for (const file of filesLibrary) {
    downloader.addFile(
      file.url,
      installPath,
      `test-folder/foo/bar/${file.name}`
    );
  }
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);

  filesLibrary.forEach((file) => {
    t.true(checkFileIntegrity(`test-folder/foo/bar/${file.name}`));
  });
});

test('downloads files checksum must be created if specified', async (t) => {
  const downloader = createDownloader();
  downloader.checksumAlgo = 'sha1';

  t.is(0, downloader.stats().fileDownloaded);
  for (const file of filesLibrary) {
    downloader.addFile(file.url, installPath, `test-2/${file.name}`, file.sha1);
  }
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);

  filesLibrary.forEach((file) => {
    t.true(
      checkFileIntegrity(
        `test-2/${file.name}`,
        file.sha1,
        downloader.checksumAlgo
      )
    );
  });
});

test('downloads files checksum with another algo must work', async (t) => {
  const downloader = createDownloader();
  downloader.checksumAlgo = 'md5';

  t.is(0, downloader.stats().fileDownloaded);
  for (const file of filesLibrary) {
    downloader.addFile(file.url, installPath, `test-3/${file.name}`, file.md5);
  }
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);

  filesLibrary.forEach((file) => {
    t.true(
      checkFileIntegrity(
        `test-3/${file.name}`,
        file.md5,
        downloader.checksumAlgo
      )
    );
  });
});

test('downloads files with wrong checksum must fail', async (t) => {
  const downloader = createDownloader();
  const badChecksum = '293Kjhgigk324jkjkbbi';
  downloader.checksumAlgo = 'md5';
  const file = filesLibrary[0];

  downloader.addFile(file.url, installPath, `test-4/${file.name}`, badChecksum);
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
  for (const file of filesLibrary) {
    downloader.addFile(file.url, installPath, `test-5/${file.name}`);
  }
  await waitDownloadForEnd(downloader);
  t.is(filesLibrary.length, downloader.stats().fileDownloaded);
});

test('download with existing file and correct checksum must not restart download', async (t) => {
  const file = filesLibrary[0];
  const createDownload = () => {
    const newDownloader = createDownloader();
    newDownloader.checksumAlgo = 'sha1';
    newDownloader.addFile(
      file.url,
      installPath,
      `test-6/${file.name}`,
      file.sha1
    );
    return newDownloader;
  };
  let downloader = createDownload();
  await waitDownloadForEnd(downloader);

  let stats = getFileStats(`test-6/${file.name}`);
  const fileCreationTime = stats.birthtimeMs;

  await new Promise((resolve) => {
    // @ts-ignore
    setTimeout(async () => {
      downloader = createDownload();
      await waitDownloadForEnd(downloader);

      stats = getFileStats(`test-6/${file.name}`);
      t.is(fileCreationTime, stats.birthtimeMs);

      resolve();
    }, 2000);
  });
});

// @ts-ignore
if (!(os.platform() === 'win32' && process.env.CI === 'true')) {
  test('two files with same name must redownload', async (t) => {
    const fileName = `test-7/file.dat`;
    const file1 = filesLibrary[0];
    const file2 = filesLibrary[1];

    const createDownload = (file) => {
      const newDownloader = createDownloader();
      newDownloader.checksumAlgo = 'sha1';
      newDownloader.addFile(file.url, installPath, fileName, file.sha1);
      return newDownloader;
    };
    let downloader = createDownload(file1);
    await waitDownloadForEnd(downloader);
    t.true(checkFileIntegrity(fileName, file1.sha1, downloader.checksumAlgo));

    let stats = getFileStats(fileName);
    const fileCreationTime = stats.birthtimeMs;

    await new Promise((resolve) => {
      // @ts-ignore
      setTimeout(async () => {
        downloader = createDownload(file2);
        await waitDownloadForEnd(downloader);

        t.true(
          checkFileIntegrity(fileName, file2.sha1, downloader.checksumAlgo)
        );

        stats = getFileStats(fileName);
        t.not(fileCreationTime, stats.birthtimeMs);

        resolve();
      }, 2000);
    });
  });
}
