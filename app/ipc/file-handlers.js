/**
 * Sameko Dev C++ IDE - File IPC Handlers
 * Handles file operations: open, save, read, delete, etc.
 * @module app/ipc/file-handlers
 */

'use strict';

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { IPC } = require('../shared/constants');
const { writeFileAtomic } = require('../shared/fs-atomic');

let mainWindow = null;

// Monaco becomes unusable well before this; refuse instead of freezing the window.
const MAX_OPEN_BYTES = 16 * 1024 * 1024;

const SOURCE_EXTENSIONS = ['cpp', 'c', 'h', 'hpp', 'cc', 'cxx', 'hh', 'hxx'];
// Write-ups and test data that sit next to solutions.
const TEXT_EXTENSIONS = ['txt', 'md', 'inp', 'in', 'out', 'ans', 'ok', 'log', 'csv', 'json'];
const ALL_FILES = { name: 'All Files', extensions: ['*'] };

/** Save filters with the one matching the file's extension first (the dialog selects it). */
function saveFilters(defaultPath) {
    const filters = [
        { name: 'C++ Source', extensions: ['cpp', 'cc', 'cxx'] },
        { name: 'C Source', extensions: ['c'] },
        { name: 'Header', extensions: ['h', 'hpp', 'hh', 'hxx'] },
        { name: 'Text', extensions: ['txt'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Test Data', extensions: ['inp', 'in', 'out', 'ans', 'ok'] },
        ALL_FILES
    ];
    const ext = path.extname(defaultPath || '').slice(1).toLowerCase();
    const index = filters.findIndex(f => f.extensions.includes(ext));
    if (index > 0) filters.unshift(filters.splice(index, 1)[0]);
    else if (ext && index < 0) filters.unshift(filters.pop());
    return filters;
}

// The folder of the last file opened or saved through a dialog: the next Open starts there.
let lastDialogDir = null;

function rememberDialogDir(filePath) {
    if (filePath) lastDialogDir = path.dirname(filePath);
}

/** An existing folder for the Open dialog: the one the renderer suggests, else the last used. */
function openDialogDir(suggested) {
    for (const dir of [suggested, lastDialogDir]) {
        try { if (dir && fs.statSync(dir).isDirectory()) return dir; } catch (_) { /* gone */ }
    }
    return undefined;
}

/**
 * Read a text file for the editor, refusing files above MAX_OPEN_BYTES.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readTextFile(filePath) {
    const { size } = await fsp.stat(filePath);
    if (size > MAX_OPEN_BYTES) {
        const mb = (n) => (n / (1024 * 1024)).toFixed(1);
        throw new Error(`File is too large to open (${mb(size)} MB, limit ${mb(MAX_OPEN_BYTES)} MB)`);
    }
    return decodeText(await fsp.readFile(filePath));
}

/**
 * UTF-8 unless the file starts with a UTF-16 byte-order mark. Windows PowerShell 5.1's `>`
 * and Notepad's "Unicode" write UTF-16 LE; read as UTF-8 that is a NUL after every character.
 * Saving writes UTF-8, which g++ and git also expect.
 * @param {Buffer} buf
 * @returns {string}
 */
function decodeText(buf) {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
        return buf.toString('utf16le', 2);
    }
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
        const le = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)));
        return le.swap16().toString('utf16le');
    }
    return buf.toString('utf-8');
}

async function writeTextFile(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    // The save replaces the file (temp file + rename), which fs.watch reports as a
    // change or a rename while it happens, so it would read as an external edit and
    // ask to reload. Close the watcher for our own write and reopen it after the
    // last overlapping write, if the file is still wanted (its tab may have closed).
    writesInFlight.set(filePath, (writesInFlight.get(filePath) || 0) + 1);
    cancelRewatch(filePath);
    stopWatcher(filePath);
    try {
        await writeFileAtomic(filePath, content, 'utf-8');
    } finally {
        const left = writesInFlight.get(filePath) - 1;
        if (left > 0) {
            writesInFlight.set(filePath, left);
        } else {
            writesInFlight.delete(filePath);
            if (watchWanted.has(filePath)) startWatcher(filePath);
        }
    }
}

const fileExists = (p) => fsp.access(p).then(() => true, () => false);

/**
 * A folder moved from `src` to `dest`: move the local history of every file in
 * it (history is keyed by file path, so it was left behind under the old paths).
 * New keys use the separator style of `dest`, as the renderer's paths do.
 */
async function moveFolderHistory(src, dest) {
    const { moveFileHistory } = require('./history-handlers');
    const sep = dest.includes('/') && !dest.includes('\\') ? '/' : path.sep;
    const under = (root, rel) => root.replace(/[\\/]+$/, '') + sep + rel;
    const walk = async (dir, rel, depth) => {
        if (depth > 32) return;
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const childRel = rel ? `${rel}${sep}${entry.name}` : entry.name;
            if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel, depth + 1);
            else if (entry.isFile()) await moveFileHistory(under(src, childRel), under(dest, childRel)).catch(() => { });
        }
    };
    await walk(dest, '', 0);
}

/** Same path on this platform (Windows and macOS ignore case). */
function samePath(a, b) {
    const fold = (p) => (process.platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase());
    return fold(a) === fold(b);
}

/** @type {Map<string, {watcher: fs.FSWatcher, mtime: number, writing?: number}>} */
const fileWatchers = new Map();
/** Re-watch timers after a replace-by-rename (Linux); unwatchFile cancels them. */
const pendingRewatch = new Map();
/** Paths the renderer asked to watch (a write or a re-watch may close the native watcher). */
const watchWanted = new Set();
/** Saves in progress per path: the watcher stays closed until the last one ends. */
const writesInFlight = new Map();

function setMainWindow(window) {
    mainWindow = window;
}

/** The renderer wants changes to `filePath` reported. */
function watchFile(filePath) {
    if (!filePath) return;
    watchWanted.add(filePath);
    if (!writesInFlight.has(filePath)) startWatcher(filePath);
}

/** The renderer no longer wants `filePath` watched (tab closed, renamed). */
function unwatchFile(filePath) {
    watchWanted.delete(filePath);
    cancelRewatch(filePath);
    stopWatcher(filePath);
}

function cancelRewatch(filePath) {
    const timer = pendingRewatch.get(filePath);
    if (timer) {
        clearTimeout(timer);
        pendingRewatch.delete(filePath);
    }
}

function startWatcher(filePath) {
    if (!filePath || fileWatchers.has(filePath)) return;

    try {
        const stats = fs.statSync(filePath);

        const notifyIfChanged = () => {
            const current = fileWatchers.get(filePath);
            if (!current || current.writing > 0) return;
            try {
                const newMtime = fs.statSync(filePath).mtimeMs;
                if (newMtime !== current.mtime) {
                    current.mtime = newMtime;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send(IPC.EVENTS.FILE_CHANGED_EXTERNAL, { path: filePath });
                    }
                }
            } catch (e) {
                // File might be deleted
            }
        };

        const watcher = fs.watch(filePath, (eventType) => {
            if (eventType === 'change') {
                notifyIfChanged();
                return;
            }
            // 'rename': on Linux fs.watch follows the INODE, so any external write that
            // replaces the file (vim's default save, `git checkout/pull`, `sed -i`,
            // atomic-save editors) kills this watcher permanently. Re-establish it on the
            // new inode, then report the change. On Windows this branch is effectively
            // unused because ReadDirectoryChangesW tracks the name, not the inode.
            const hadWatcher = fileWatchers.has(filePath);
            stopWatcher(filePath);
            cancelRewatch(filePath);
            pendingRewatch.set(filePath, setTimeout(() => {
                pendingRewatch.delete(filePath);
                // Unwatched meanwhile (tab closed) or being saved by us: nothing to do.
                if (!watchWanted.has(filePath) || writesInFlight.has(filePath)) return;
                if (!fs.existsSync(filePath)) return;
                startWatcher(filePath);
                // The file was replaced wholesale, so it changed by definition.
                if (hadWatcher && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(IPC.EVENTS.FILE_CHANGED_EXTERNAL, { path: filePath });
                }
            }, 50));
        });

        fileWatchers.set(filePath, { watcher, mtime: stats.mtimeMs });
    } catch (e) {
        console.error(`[FileWatcher] Cannot watch: ${filePath}`, e.message);
    }
}

function stopWatcher(filePath) {
    const entry = fileWatchers.get(filePath);
    if (entry) {
        entry.watcher.close();
        fileWatchers.delete(filePath);
    }
}

function updateFileWatcherMtime(filePath) {
    const entry = fileWatchers.get(filePath);
    if (entry) {
        try {
            const stats = fs.statSync(filePath);
            entry.mtime = stats.mtimeMs;
        } catch (e) { }
    }
}

/**
 * Register all file-related IPC handlers
 */
function registerHandlers() {
    ipcMain.handle(IPC.FILE.OPEN_DIALOG, async (event, options) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            defaultPath: openDialogDir(options?.defaultPath),
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Code, Text & Test Data', extensions: [...SOURCE_EXTENSIONS, ...TEXT_EXTENSIONS] },
                { name: 'C/C++ Files', extensions: SOURCE_EXTENSIONS },
                { name: 'Text & Test Data (.txt .md .inp .out …)', extensions: TEXT_EXTENSIONS },
                ALL_FILES
            ]
        });

        if (!result.canceled && result.filePaths.length > 0) {
            rememberDialogDir(result.filePaths[0]);
            for (const filePath of result.filePaths) {
                try {
                    const content = await readTextFile(filePath);
                    mainWindow.webContents.send(IPC.EVENTS.FILE_OPENED, { path: filePath, content });
                } catch (error) {
                    dialog.showErrorBox('Cannot open file', `${path.basename(filePath)}: ${error.message}`);
                }
            }
        }
    });

    // Files from the command line. Later launches are sent as file-opened events.
    ipcMain.handle(IPC.FILE.LAUNCH_FILES, async () => require('../services/launch-files').take(async filePath => {
        try {
            const content = await readTextFile(filePath);
            mainWindow.webContents.send(IPC.EVENTS.FILE_OPENED, { path: filePath, content });
        } catch (error) {
            dialog.showErrorBox('Cannot open file', path.basename(filePath) + ': ' + error.message);
        }
    }));

    ipcMain.handle(IPC.FILE.SAVE, async (event, { path: filePath, content }) => {
        try {
            await writeTextFile(filePath, content);
            return { success: true, path: filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC.FILE.SAVE_DIALOG, async (event, payload) => {
        const content = typeof payload === 'object' && payload !== null ? payload.content : payload;
        const defaultPath = typeof payload === 'object' && payload !== null ? payload.defaultPath : undefined;

        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath,
            filters: saveFilters(defaultPath)
        });

        if (!result.canceled) {
            rememberDialogDir(result.filePath);
            try {
                await writeTextFile(result.filePath, content);
                return { success: true, path: result.filePath };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
        return { success: false, canceled: true };
    });

    ipcMain.handle(IPC.FILE.READ, async (event, filePath) => {
        try {
            return await readTextFile(filePath);
        } catch (error) {
            throw new Error(`Cannot read file: ${error.message}`);
        }
    });

    ipcMain.handle(IPC.FILE.READ_DIR, async (event, dirPath) => {
        try {
            const entries = await fsp.readdir(dirPath, { withFileTypes: true });
            return entries.map(entry => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile()
            }));
        } catch (error) {
            // Only log unexpected errors, not missing directories
            if (error.code !== 'ENOENT') {
                console.error('[FileExplorer] read-directory error:', error);
            }
            return [];
        }
    });

    ipcMain.handle(IPC.FILE.DELETE, async (event, filePath) => {
        try {
            await fsp.unlink(filePath);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot delete file: ${error.message}`);
        }
    });

    ipcMain.handle(IPC.FILE.RENAME, async (event, { oldPath, newPath }) => {
        // On Windows rename() silently replaces an existing file. A change of case only
        // (main.cpp -> Main.cpp) is the same file there and is allowed.
        const fold = (p) => (process.platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase());
        const sameFile = fold(oldPath) === fold(newPath);
        if (!sameFile && await fsp.access(newPath).then(() => true, () => false)) {
            throw new Error(`"${path.basename(newPath)}" already exists`);
        }
        let isDir = false;
        try { isDir = (await fsp.stat(oldPath)).isDirectory(); } catch (_) { }
        try {
            await fsp.rename(oldPath, newPath);
        } catch (error) {
            throw new Error(`Cannot rename file: ${error.message}`);
        }
        // Local history follows the file(s); the rename has happened even if this fails.
        await (isDir ? moveFolderHistory(oldPath, newPath) : require('./history-handlers').moveFileHistory(oldPath, newPath))
            .catch((error) => console.warn('[rename] local history not moved:', error.message));
        return { success: true };
    });

    // Copy and move never replace an existing file unless the renderer asked the
    // user first and passes `overwrite`; a refusal comes back as { exists: true }.
    ipcMain.handle('copy-file', async (event, { src, dest, overwrite }) => {
        if (samePath(src, dest)) return { success: false, error: 'Source and destination are the same file' };
        try {
            await fsp.copyFile(src, dest, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
            return { success: true };
        } catch (error) {
            if (error.code === 'EEXIST') return { success: false, exists: true, error: `"${path.basename(dest)}" already exists` };
            throw new Error(`Cannot copy file: ${error.message}`);
        }
    });

    ipcMain.handle('move-file', async (event, { src, dest, overwrite }) => {
        // A change of case only (a.cpp -> A.cpp) is the same file on Windows/macOS.
        if (!samePath(src, dest) && !overwrite && await fileExists(dest)) {
            return { success: false, exists: true, error: `"${path.basename(dest)}" already exists` };
        }
        let isFile = false;
        try { isFile = (await fsp.stat(src)).isFile(); } catch (_) { }
        try {
            await fsp.rename(src, dest);
        } catch (error) {
            // Another drive: rename() cannot cross volumes, so copy then delete.
            if (error.code !== 'EXDEV' || !isFile) throw new Error(`Cannot move file: ${error.message}`);
            try {
                await fsp.copyFile(src, dest, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
                await fsp.unlink(src);
            } catch (copyError) {
                throw new Error(`Cannot move file: ${copyError.message}`);
            }
        }
        await (isFile ? require('./history-handlers').moveFileHistory(src, dest) : moveFolderHistory(src, dest))
            .catch((error) => console.warn('[move] local history not moved:', error.message));
        return { success: true };
    });

    ipcMain.handle('delete-folder', async (event, folderPath) => {
        try {
            await fsp.rm(folderPath, { recursive: true, force: true });
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot delete folder: ${error.message}`);
        }
    });

    ipcMain.handle('create-directory', async (event, dirPath) => {
        try {
            await fsp.mkdir(dirPath, { recursive: true });
            return { success: true, path: dirPath };
        } catch (error) {
            throw new Error(`Cannot create directory: ${error.message}`);
        }
    });

    ipcMain.handle(IPC.FILE.WATCH, async (event, filePath) => {
        watchFile(filePath);
        return { success: true };
    });

    ipcMain.handle(IPC.FILE.UNWATCH, async (event, filePath) => {
        unwatchFile(filePath);
        return { success: true };
    });

    ipcMain.handle(IPC.FILE.RELOAD, async (event, filePath) => {
        try {
            const content = await readTextFile(filePath);
            updateFileWatcherMtime(filePath);
            return { success: true, content };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle(IPC.FILE.SHOW_IN_FOLDER, async (event, filePath) => {
        try {
            shell.showItemInFolder(filePath);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot show item in folder: ${error.message}`);
        }
    });

    // A link clicked in the Markdown preview: web and mail links only, in the user's browser.
    ipcMain.handle(IPC.FILE.OPEN_LINK, async (event, url) => {
        if (typeof url !== 'string' || !/^(https?:\/\/|mailto:)/i.test(url)) return { success: false, error: 'URL not allowed' };
        await shell.openExternal(url);
        return { success: true };
    });
}

module.exports = {
    registerHandlers,
    setMainWindow,
    watchFile,
    unwatchFile,
    updateFileWatcherMtime,
};
