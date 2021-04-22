const fs = require('fs')
const path = require('path')

export const installPath = path.resolve(__dirname, './downloads');

export const filesLibrary = [
    {
        url: 'https://raw.githubusercontent.com/emodyz/SpeedTest/master/1MB.bin',
        sha1: 'c825975e35c65fc1ddcbe9353a8d3b3645089334',
        md5: 'caecf2017fb7de3da7bafa4ea9354aef',
        name: '1MB.dat',
    },
    {
        url: 'https://raw.githubusercontent.com/emodyz/SpeedTest/master/10MB.bin',
        sha1: '87629cb9201d30a402bfecd40acf073e44799861',
        md5: '27fa7fd6111b8aaa25ea6b8477d1e084',
        name: '10MB.dat',
    },
];

export function deleteFolderRecursive(filePath: string) {
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

export function cleanDownloads() {
    fs.readdirSync(installPath).forEach((directoryOrFile) => {
        if (directoryOrFile !== '.gitignore') {
            deleteFolderRecursive(path.resolve(installPath, directoryOrFile));
        }
    });
}

export function waitDownloadForEnd(downloader) {
    return new Promise((resolve, reject) => {
        downloader.on('end', () => {
            resolve(null);
        });
        downloader.on('error', (err) => {
            reject(err);
        });
        downloader.start();
    });
}

export function checkFileIntegrity(
    fileName: string,
    // @ts-ignore
    checksum: string = null,
    // @ts-ignore
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

export function getFileStats(fileName) {
    const filePath = path.resolve(installPath, fileName);
    return fs.statSync(filePath);
}