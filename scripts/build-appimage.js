#!/usr/bin/env node
/**
 * Sameko Dev C++ IDE - Linux AppImage build helper
 *
 * electron-builder packs the AppImage by creating symlinks in a staging folder
 * (`__appImage-x64/`). Windows only grants SeCreateSymbolicLinkPrivilege to an
 * elevated process or when Developer Mode is on, so on an ordinary terminal the
 * build dies with:
 *
 *     symlink usr\share\icons\...: A required privilege is not held by the client
 *
 * WSL has no such restriction and can build straight out of /mnt/<drive>, so
 * this script picks whichever route actually works:
 *
 *   1. non-Windows, or Windows with symlink permission -> build in place
 *   2. Windows without it, but WSL present               -> build through WSL
 *   3. neither                                           -> explain both fixes
 *
 * @module scripts/build-appimage
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = ['electron-builder', '--linux', 'AppImage'];

/** Can this process create a symlink? Cheaper than finding out 90 seconds in. */
function canSymlink() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-symlink-'));
    try {
        fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'));
        return true;
    } catch (err) {
        return false;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function hasWsl() {
    const probe = spawnSync('wsl', ['bash', '-lc', 'command -v npx'], { encoding: 'utf8' });
    return probe.status === 0 && String(probe.stdout).trim() !== '';
}

function run(cmd, args) {
    // `wsl` keeps the Windows working directory (D:\... -> /mnt/d/...), so the
    // WSL branch needs no path translation.
    const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true });
    process.exit(res.status === null ? 1 : res.status);
}

if (process.platform !== 'win32' || canSymlink()) {
    run('npx', ARGS);
} else if (hasWsl()) {
    console.log('AppImage: no symlink permission on Windows - building through WSL instead.');
    run('wsl', ['bash', '-lc', '"npx ' + ARGS.join(' ') + '"']);
} else {
    console.error([
        '',
        'Cannot build the AppImage: creating symlinks is not permitted, and WSL is not available.',
        'Fix it with any one of these:',
        '  - turn on Developer Mode (Settings > System > For developers), or',
        '  - run this build from an elevated terminal, or',
        '  - install WSL (`wsl --install`) and run it again, or',
        '  - build on a real Linux machine with `npm run build:linux`.',
        '',
    ].join('\n'));
    process.exit(1);
}
