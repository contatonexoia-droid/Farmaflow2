const fs = require('fs');
const archiver = require('archiver');
const output = fs.createWriteStream('test_standard.zip');
const archive = archiver('zip', { zlib: { level: 9 } });
output.on('close', () => console.log('Closed standard'));
archive.pipe(output);
archive.append('hello world', { name: 'hello.txt' });
archive.finalize();

const output2 = fs.createWriteStream('test_ZipArchive.zip');
const archive2 = new archiver.ZipArchive({ zlib: { level: 9 } });
output2.on('close', () => console.log('Closed ZipArchive'));
archive2.pipe(output2);
archive2.append('hello world', { name: 'hello.txt' });
archive2.finalize();
