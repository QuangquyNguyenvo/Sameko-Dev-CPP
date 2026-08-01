#!/usr/bin/env node
/**
 * Sameko Dev C++ IDE - clean helper
 *
 * Replaces two `powershell -Command Remove-Item` one-liners that were both
 * wrong and Windows-only:
 *   - `clean` deleted `%APPDATA%/cpp-ide`, but the settings folder is named
 *     after package.json's `name` (`sameko-dev-cpp`), so it wiped nothing.
 *   - `clean:dist` deleted `release_build`, but the build output directory is
 *     `samekodevcpp` (build.directories.output), so `rebuild:win` was not
 *     actually rebuilding from scratch.
 *
 * Usage:
 *   node scripts/clean.js settings   # wipe the app's user data (settings, history, snippets)
 *   node scripts/clean.js dist       # wipe the packaged output directory
 *
 * @module scripts/clean
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

/** Where Electron puts userData for this app, per platform. */
function userDataDir() {
    const name = pkg.name;                       // Electron uses package.json `name`
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', name);
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
}

function outputDir() {
    const out = (pkg.build && pkg.build.directories && pkg.build.directories.output) || 'dist';
    return path.join(ROOT, out);
}

function remove(target) {
    if (!fs.existsSync(target)) {
        console.log('nothing to remove: ' + target);
        return;
    }
    fs.rmSync(target, { recursive: true, force: true });
    console.log('removed ' + target);
}

const what = process.argv[2];
if (what === 'settings') {
    remove(userDataDir());
} else if (what === 'dist') {
    remove(outputDir());
} else {
    console.error('usage: node scripts/clean.js <settings|dist>');
    process.exit(1);
}
