const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const { version } = require('./manifest.json');
const output = `extension-v${version}.zip`;

const stream = fs.createWriteStream(output);
const archive = archiver('zip', { zlib: { level: 9 } });

stream.on('close', () => console.log(`Built: ${output} (${archive.pointer()} bytes)`));
archive.on('error', err => { throw err; });

archive.pipe(stream);

archive.file('manifest.json');
archive.file('background.js');
archive.file('content.js');
archive.file('onboarding.html');
archive.file('onboarding.js');
archive.file('options.html');
archive.file('options.js');
archive.glob('images/icon-*.png');
archive.directory('images/onboarding/', 'images/onboarding');
archive.directory('_locales/', '_locales');

archive.finalize();