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

  if (fs.existsSync(`${downloadPath}/10Mio.dat.checksum`)) {
    fs.unlinkSync(`${downloadPath}/10Mio.dat.checksum`);
  }
  if (fs.existsSync(`${downloadPath}/test1.dat.checksum`)) {
    fs.unlinkSync(`${downloadPath}/test1.dat.checksum`);
  }
  if (fs.existsSync(`${downloadPath}/test2.dat.checksum`)) {
    fs.unlinkSync(`${downloadPath}/test2.dat.checksum`);
  }
  if (fs.existsSync(`${downloadPath}/test3.dat.checksum`)) {
    fs.unlinkSync(`${downloadPath}/test3.dat.checksum`);
  }
}

test.beforeEach('cleanFiles', () => {
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

  downloader.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    null,
    '984bc7daae5f509357fb6694277a9852db61f2a7');
  downloader.addFile(
    'http://www.ovh.net/files/100Mio.dat',
    downloadPath,
    'test1.dat',
    '9b1ff4cf6140a889e1988c9510a544ac3758e147'
  );
  downloader.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    'test2.dat',
    '984bc7daae5f509357fb6694277a9852db61f2a7'
  );
  downloader.addFile(
    'http://www.ovh.net/files/1Gb.dat',
    downloadPath,
    'test3.dat',
    '7c0617f4b6c4907d400cb2521c3b39896f38f459'
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

test('download file with wrong checksum must fail', async (t) => {
  const downloader: Downloader = createDownloader();
  t.is(downloader.stats().files, 0);
  downloader.addFile('http://www.ovh.net/files/10Mio.dat', downloadPath, null, 'fakeCheckSum');
  t.is(downloader.stats().files, 1);

  downloader.on('error', () => {
    t.pass();
  });

  downloader.on('end', () => {
    t.fail();
  });

  downloader.start();
});

test('after download, checksum file must be created', async (t) => {
  const downloader: Downloader = createDownloader();
  downloader.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    null,
    '984bc7daae5f509357fb6694277a9852db61f2a7');

  downloader.start();
  await new Promise((resolve) => {
    downloader.on('end', () => {
      resolve();
    });
  });
  const checksum = fs.readFileSync(`${downloadPath}/10Mio.dat.checksum`).toString();
  t.is(checksum, '984bc7daae5f509357fb6694277a9852db61f2a7');
});


test('test skip download', async (t) => {
  let downloader: Downloader = createDownloader();
  downloader.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    null,
    '984bc7daae5f509357fb6694277a9852db61f2a7');

  downloader.start();
  await new Promise((resolve) => {
    downloader.on('end', () => {
      resolve();
    });
  });

  const downloader2 = createDownloader();
  downloader2.addFile(
    'http://www.ovh.net/files/10Mio.dat',
    downloadPath,
    null,
    '984bc7daae5f509357fb6694277a9852db61f2a7');
  downloader2.start();
  await new Promise((resolve) => {
    downloader2.on('end', () => {
      resolve();
    });
  });

  t.pass();
});