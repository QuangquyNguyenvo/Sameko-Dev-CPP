'use strict';
/**
 * Gives the auto-updater its own copy of the Windows installer, so GitHub's download count for
 * sameko-dev-cpp-setup-<version>.exe only counts people who downloaded it.
 *
 *   node scripts/split-update-asset.js [outputDir]
 *
 * Writes sameko-dev-cpp-update-<version>.exe and its .blockmap, byte-identical to the installer's,
 * and points latest.yml at them. All of these must be uploaded to the release: a latest.yml whose
 * file is missing breaks updates for everyone.
 *
 * Clients on a version without an update-named blockmap cannot fetch the old one, and
 * electron-updater then falls back to a full download of the new file.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function sha512(file) {
    const hash = crypto.createHash('sha512');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const fd = fs.openSync(file, 'r');
    try {
        for (let read; (read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
            hash.update(buffer.subarray(0, read));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('base64');
}

function splitUpdateAsset(outDir, version) {
    const setupName = `sameko-dev-cpp-setup-${version}.exe`;
    const updateName = `sameko-dev-cpp-update-${version}.exe`;
    const setup = path.join(outDir, setupName);
    const update = path.join(outDir, updateName);
    const manifest = path.join(outDir, 'latest.yml');

    for (const file of [setup, `${setup}.blockmap`, manifest]) {
        if (!fs.existsSync(file)) throw new Error(`split-update-asset: ${file} not found`);
    }
    const text = fs.readFileSync(manifest, 'utf8');
    if (!new RegExp(`^version: ['"]?${version.replace(/\./g, '\\.')}['"]?\\s*$`, 'm').test(text)) {
        throw new Error(`split-update-asset: latest.yml is not for version ${version}`);
    }
    if (!text.includes(setupName) && !text.includes(updateName)) {
        throw new Error(`split-update-asset: latest.yml names neither ${setupName} nor ${updateName}`);
    }
    const digest = sha512(setup);
    const listed = [...text.matchAll(/sha512:\s*(\S+)/g)].map((m) => m[1]);
    if (!listed.length || listed.some((value) => value !== digest)) {
        throw new Error('split-update-asset: latest.yml sha512 does not match the installer');
    }

    fs.copyFileSync(setup, update);
    fs.copyFileSync(`${setup}.blockmap`, `${update}.blockmap`);
    if (sha512(update) !== digest) throw new Error('split-update-asset: the copy differs from the installer');

    const temp = `${manifest}.tmp`;
    fs.writeFileSync(temp, text.split(setupName).join(updateName));
    fs.renameSync(temp, manifest);
    return { setupName, updateName };
}

module.exports = { splitUpdateAsset };

if (require.main === module) {
    const pkg = require(path.join(ROOT, 'package.json'));
    const outDir = path.resolve(process.argv[2] || path.join(ROOT, pkg.build.directories.output));
    try {
        const { updateName } = splitUpdateAsset(outDir, pkg.version);
        console.log(`split-update-asset: latest.yml now points to ${updateName}`);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
