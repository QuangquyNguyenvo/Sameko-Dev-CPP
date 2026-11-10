'use strict';

/**
 * The Windows zip build is a portable app: it keeps its data in `data\` next to the exe instead
 * of %APPDATA%, so it can live on a USB stick or in a school lab that wipes the system drive
 * (Deep Freeze), and it does not install updates (the installer would go to another folder and
 * leave the zip folder on the old version).
 *
 * A zip build is told apart from an installed one by the uninstaller the installer puts next to
 * the exe. `setup()` must run before anything reads `app.getPath('userData')`, so `app/main.js`
 * calls it before requiring the rest of the app.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let cached;

/** @returns {string|null} the folder of the exe when this is the zip build, else null */
function portableAppDir() {
    if (cached !== undefined) return cached;
    cached = null;
    // electron-builder's single-exe "portable" target (not shipped, kept for old builds).
    if (process.env.PORTABLE_EXECUTABLE_DIR) return (cached = process.env.PORTABLE_EXECUTABLE_DIR);
    if (process.platform !== 'win32' || !app.isPackaged) return cached;
    const exeDir = path.dirname(process.execPath);
    const product = path.basename(process.execPath, path.extname(process.execPath));
    try {
        if (!fs.existsSync(path.join(exeDir, `Uninstall ${product}.exe`))) cached = exeDir;
    } catch (_) { /* treat as installed */ }
    return cached;
}

function isPortable() {
    return portableAppDir() !== null;
}

// Small files that hold what the user set up. Caches, logs and local history are left behind.
const CARRIED_OVER = ['settings.json', 'snippets.json', 'state'];

/**
 * Point userData at `data\` next to the exe. A first start of a portable copy on a machine that
 * already ran the app takes the existing settings along, so updating the zip build from a version
 * that still used %APPDATA% keeps them. A folder that cannot be written (the zip extracted into
 * Program Files) keeps using %APPDATA%.
 */
function setup() {
    const dir = portableAppDir();
    // An explicit --user-data-dir (tests, probes) wins.
    if (!dir || process.env.PORTABLE_EXECUTABLE_DIR || app.commandLine.hasSwitch('user-data-dir')) return;
    const dataDir = path.join(dir, 'data');
    const firstRun = !fs.existsSync(dataDir);
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.accessSync(dataDir, fs.constants.W_OK);
    } catch (err) {
        console.warn(`[Portable] ${dataDir} is not writable, using the default data folder: ${err.message}`);
        return;
    }
    const oldDir = app.getPath('userData');
    app.setPath('userData', dataDir);
    console.log(`[Portable] Data folder: ${dataDir}`);
    if (!firstRun) return;
    for (const name of CARRIED_OVER) {
        try {
            const from = path.join(oldDir, name);
            if (fs.existsSync(from)) fs.cpSync(from, path.join(dataDir, name), { recursive: true });
        } catch (err) {
            console.warn(`[Portable] Could not copy ${name}: ${err.message}`);
        }
    }
}

module.exports = { setup, isPortable, portableAppDir };
