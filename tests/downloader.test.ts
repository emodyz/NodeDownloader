import {
    checkFileIntegrity,
    cleanDownloads,
    filesLibrary,
    getFileStats,
    installPath,
    waitDownloadForEnd
} from "./helpers";
import {createDownloader} from "../dist";
import {Downloader} from "../dist";
import * as os from "os";
import * as path from 'path'

afterEach(() => {
    cleanDownloads()
})

test('createDownloader return Downloader instance', () => {
    const downloader = createDownloader();
    expect(downloader).toBeInstanceOf(Downloader);
});

test('addFile must increment files in stats', () => {
    const downloader = createDownloader();
    const file = filesLibrary[0];
    expect(downloader.stats().files).toBe(0);
    downloader.addFile(file.url, installPath);
    expect(downloader.stats().files).toBe(1);
});

test('start function must start downloads',  async (done) => {
        try {
            const downloader = createDownloader();

            expect(downloader.stats().fileDownloaded).toBe(0);
            for (const file of filesLibrary) {
                downloader.addFile(file.url, installPath, `test-1/${file.name}`);
            }
            await waitDownloadForEnd(downloader);
            expect(downloader.stats().fileDownloaded).toBe(filesLibrary.length);

            filesLibrary.forEach((file) => {
                expect(checkFileIntegrity(`test-1/${file.name}`)).toBeTruthy()
            });

            done()
        } catch (error) {
            done(error)
        }
});

test('download need to create folder recursively', async (done) => {
    try {
        const downloader = createDownloader();

        expect(downloader.stats().fileDownloaded).toBe(0)
        for (const file of filesLibrary) {
            downloader.addFile(
                file.url,
                installPath,
                `test-folder/foo/bar/${file.name}`
            );
        }
        await waitDownloadForEnd(downloader);
        expect(downloader.stats().fileDownloaded).toBe(filesLibrary.length)

        filesLibrary.forEach((file) => {
            expect(checkFileIntegrity(`test-folder/foo/bar/${file.name}`)).toBeTruthy()
        });
        done()
    } catch (error) {
        done(error)
    }
});

test('downloads files checksum must be created if specified', async (done) => {
    try {
        const downloader = createDownloader();
        downloader.checksumAlgo = 'sha1';

        for (const file of filesLibrary) {
            downloader.addFile(file.url, installPath, `test-2/${file.name}`, file.sha1);
        }
        await waitDownloadForEnd(downloader);
        expect(downloader.stats().fileDownloaded).toBe(filesLibrary.length)

        filesLibrary.forEach((file) => {
            expect(checkFileIntegrity(
                `test-2/${file.name}`,
                file.sha1,
                downloader.checksumAlgo
            )).toBeTruthy()
        });
        done()
    } catch (error) {
        done(error)
    }
});


test('downloads files checksum with another algo must work', async (done) => {
    try {
        const downloader = createDownloader();
        downloader.checksumAlgo = 'md5';

        for (const file of filesLibrary) {
            downloader.addFile(file.url, installPath, `test-3/${file.name}`, file.md5);
        }
        await waitDownloadForEnd(downloader);
        expect(downloader.stats().fileDownloaded).toBe(filesLibrary.length)

        filesLibrary.forEach((file) => {
            expect(
                checkFileIntegrity(
                    `test-3/${file.name}`,
                    file.md5,
                    downloader.checksumAlgo
                )
            ).toBeTruthy();
        });
        done()
    } catch (error) {
        done(error)
    }
});

test('downloads files with wrong checksum must fail', async (done) => {
    const downloader = createDownloader();
    const badChecksum = '293Kjhgigk324jkjkbbi';
    downloader.checksumAlgo = 'md5';
    const file = filesLibrary[0];

    downloader.addFile(file.url, installPath, `test-4/${file.name}`, badChecksum);
    try {
        await waitDownloadForEnd(downloader);
        done.fail();
    } catch (e) {
        done()
    }
});

test('downloads with low simultaneousDownload must download all files', async (done) => {
    try {
        const downloader = createDownloader();
        downloader.simultaneusDownloads = 1;

        expect(downloader.stats().fileDownloaded).toBe(0)
        for (const file of filesLibrary) {
            downloader.addFile(file.url, installPath, `test-5/${file.name}`);
        }
        await waitDownloadForEnd(downloader);
        expect(downloader.stats().fileDownloaded).toBe(downloader.stats().fileDownloaded)
        done()
    } catch (error) {
        done(error)
    }
});

test('download with existing file and correct checksum must not restart download', async (done) => {
    try {
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
                expect(stats.birthtimeMs).toBe(fileCreationTime)

                resolve(null);
            }, 2000);
        });
        done()
    } catch (error) {
        done(error);
    }
});

if (!(os.platform() === 'win32' && process.env.CI === 'true')) {
    test('two files with same name must re-downloaded', async (done) => {
        try {
            const fileName = path.normalize('test-7/file.dat');
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
            expect(checkFileIntegrity(fileName, file1.sha1, downloader.checksumAlgo)).toBeTruthy()

            let stats = getFileStats(fileName);
            const fileCreationTime = stats.birthtimeMs;

            await new Promise((resolve) => {
                // @ts-ignore
                setTimeout(async () => {
                    downloader = createDownload(file2);
                    await waitDownloadForEnd(downloader);

                    expect(
                        checkFileIntegrity(fileName, file2.sha1, downloader.checksumAlgo)
                    ).toBeTruthy();

                    stats = getFileStats(fileName);
                    expect(stats.birthtimeMs).not.toBe(fileCreationTime)

                    resolve(null);
                }, 2000);
            });
            done()
        } catch (error) {
            done(error)
        }
    });
}