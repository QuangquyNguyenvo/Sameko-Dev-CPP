'use strict';

// The updater's own installer copy: latest.yml must resolve to it, with the installer's checksum.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseUpdateInfo, resolveFiles } = require('electron-updater/out/providers/Provider');
const { splitUpdateAsset } = require('../../scripts/split-update-asset');

let failed = 0;
function check(name, ok) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
}

const version = '9.8.7';
const setupName = `sameko-dev-cpp-setup-${version}.exe`;
const updateName = `sameko-dev-cpp-update-${version}.exe`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-update-asset-'));

function manifest(digest, name = setupName, forVersion = version) {
    return `version: ${forVersion}\nfiles:\n  - url: ${name}\n    sha512: ${digest}\n    size: 7\npath: ${name}\nsha512: ${digest}\nreleaseDate: '2026-11-23T00:00:00.000Z'\n`;
}

try {
    const bytes = Buffer.from('install');
    const digest = crypto.createHash('sha512').update(bytes).digest('base64');
    fs.writeFileSync(path.join(dir, setupName), bytes);
    fs.writeFileSync(path.join(dir, `${setupName}.blockmap`), 'map');
    fs.writeFileSync(path.join(dir, 'latest.yml'), manifest(digest));

    splitUpdateAsset(dir, version);
    check('the update file is byte-identical', fs.readFileSync(path.join(dir, updateName)).equals(bytes));
    check('the blockmap is copied', fs.readFileSync(path.join(dir, `${updateName}.blockmap`), 'utf8') === 'map');
    check('the installer is kept', fs.existsSync(path.join(dir, setupName)));

    const text = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
    check('latest.yml no longer names the installer', !text.includes(setupName));
    const info = parseUpdateInfo(text, 'latest.yml', new URL('https://example.test/latest.yml'));
    const files = resolveFiles(info, new URL('https://example.test/download/'));
    check('electron-updater resolves the update file', files.length === 1 && files[0].url.pathname.endsWith(`/${updateName}`));
    check('the checksum is unchanged', files[0].info.sha512 === digest && info.sha512 === digest);

    const service = fs.readFileSync(path.join(__dirname, '../../app/services/auto-update-service.js'), 'utf8');
    const pending = new RegExp(service.match(/file\.match\(\/(.+?)\/\)/)[1]);
    check('a pending update file is recognized', pending.exec(updateName)?.[1] === version && pending.exec(setupName)?.[1] === version);

    splitUpdateAsset(dir, version);
    check('running it again changes nothing', fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8') === text);

    fs.writeFileSync(path.join(dir, 'latest.yml'), manifest('wrong'));
    let threw = false;
    try { splitUpdateAsset(dir, version); } catch { threw = true; }
    check('a checksum mismatch stops the build', threw);

    fs.writeFileSync(path.join(dir, 'latest.yml'), manifest(digest, setupName, '1.0.0'));
    threw = false;
    try { splitUpdateAsset(dir, version); } catch { threw = true; }
    check('a manifest for another version stops the build', threw);
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
