'use strict';

/**
 * Files passed on the command line: "Open with Sameko Dev C++", a file dropped on the
 * shortcut, or `sameko-dev-cpp main.cpp`. The first launch keeps them until the renderer has
 * restored its session and asks for them (take); after that, a second launch's files are
 * delivered at once through the callback the renderer's request installed.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let pending = [];
let deliver = null;

/**
 * Paths of existing files in an argv. Skips the executable, the app folder that a dev run
 * (`electron .`) passes, and switches (Chromium adds its own to a second instance's argv).
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {string[]}
 */
function filesFromArgv(argv, cwd) {
    const appPath = path.resolve(app.getAppPath());
    const files = [];
    for (const arg of argv.slice(1)) {
        if (!arg || arg.startsWith('-')) continue;
        const full = path.resolve(cwd || process.cwd(), arg);
        if (full === appPath) continue;
        try {
            if (fs.statSync(full).isFile() && !files.includes(full)) files.push(full);
        } catch (_) { /* not a path */ }
    }
    return files;
}

/** Records the files of a launch: queued until the renderer asks, then sent directly. */
function add(argv, cwd) {
    const files = filesFromArgv(argv, cwd);
    if (deliver) files.forEach(deliver);
    else pending.push(...files);
    return files.length;
}

/**
 * Hands over the queued files and routes later launches to `send`.
 * @param {(filePath: string) => void} send
 */
function take(send) {
    deliver = send;
    const files = pending;
    pending = [];
    return files;
}

module.exports = { add, take, filesFromArgv };
