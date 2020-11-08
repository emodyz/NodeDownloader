// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';

import test from 'ava';

import { createDownloader, Downloader } from './Downloader';

const downloadPath = path.resolve('./downloads');

function cleanFiles() {
  if (fs.existsSync(`${downloadPath}/10Mio.dat`)) {
    fs.unlinkSync(`${downloadPath}/10Mio.dat`);
  }
  if (fs.existsSync(`${downloadPath}/test1.dat`)) {
    fs.unlinkSync(`${downloadPath}/test1.dat`);
  }
  if (fs.existsSync(`${downloadPath}/test2.dat`)) {
    fs.unlinkSync(`${downloadPath}/test2.dat`);
  }
  if (fs.existsSync(`${downloadPath}/test3.dat`)) {
    fs.unlinkSync(`${downloadPath}/test3.dat`);
  }
}

test.beforeEach('cleanFiles', () => {
  cleanFiles();
});

test.afterEach('cleanFiles', () => {
  cleanFiles();
});

test('addFile must add file', (t) => {
  const downloader: Downloader = createDownloader();
  t.is(downloader.stats().files, 0);
  downloader.addFile('http://www.ovh.net/files/10Mio.dat', downloadPath);
  t.is(downloader.stats().files, 1);
});

test('start must process files', async (t) => {
  const downloader: Downloader = createDownloader();

  t.false(fs.existsSync(`${downloadPath}/10Mio.dat`));
  t.false(fs.existsSync(`${downloadPath}/test1.dat`));
  t.false(fs.existsSync(`${downloadPath}/test2.dat`));
  t.false(fs.existsSync(`${downloadPath}/test3.dat`));

  downloader.addFile('http://www.ovh.net/files/10Mio.dat', downloadPath);
  downloader.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    'test1.dat'
  );
  downloader.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    'test2.dat'
  );
  downloader.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    'test3.dat'
  );

  t.is(downloader.stats().files, 4);
  t.is(downloader.stats().fileDownloaded, 0);

  downloader.start();
  await new Promise((resolve) => {
    downloader.on('progress', (stats) => {
      t.is(typeof stats.progressTotal, 'number');
      t.is(typeof stats.progress, 'number');
    });
    downloader.on('end', () => {
      resolve();
    });
  });

  t.is(downloader.stats().fileDownloaded, 4);

  t.true(fs.existsSync(`${downloadPath}/10Mio.dat`));
  t.true(fs.existsSync(`${downloadPath}/test1.dat`));
  t.true(fs.existsSync(`${downloadPath}/test2.dat`));
  t.true(fs.existsSync(`${downloadPath}/test3.dat`));
});
