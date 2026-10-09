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
    return fsp.readFile(filePath, 'utf-8');
}

async function writeTextFile(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    // fs.watch reports our own write while it is still in progress (on Windows
    // before writeFile resolves), so the change would read as external and every
    // Build & Run of a saved file asked to reload it. Ignore the watcher until the
    // write is done and the new mtime is recorded.
    const entry = fileWatchers.get(filePath);
    if (entry) entry.writing = (entry.writing || 0) + 1;
    try {
        await fsp.writeFile(filePath, content, 'utf-8');
    } finally {
        if (entry) entry.writing--;
        updateFileWatcherMtime(filePath);
    }
}

/** @type {Map<string, {watcher: fs.FSWatcher, mtime: number, writing?: number}>} */
const fileWatchers = new Map();

function setMainWindow(window) {
    mainWindow = window;
}

function watchFile(filePath) {
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
            unwatchFile(filePath);
            setTimeout(() => {
                if (!fs.existsSync(filePath)) return;
                watchFile(filePath);
                // The file was replaced wholesale, so it changed by definition.
                if (hadWatcher && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(IPC.EVENTS.FILE_CHANGED_EXTERNAL, { path: filePath });
                }
            }, 50);
        });

        fileWatchers.set(filePath, { watcher, mtime: stats.mtimeMs });
    } catch (e) {
        console.error(`[FileWatcher] Cannot watch: ${filePath}`, e.message);
    }
}

function unwatchFile(filePath) {
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
        try {
            await fsp.rename(oldPath, newPath);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot rename file: ${error.message}`);
        }
    });

    ipcMain.handle('copy-file', async (event, { src, dest }) => {
        try {
            await fsp.copyFile(src, dest);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot copy file: ${error.message}`);
        }
    });

    ipcMain.handle('move-file', async (event, { src, dest }) => {
        try {
            await fsp.rename(src, dest);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot move file: ${error.message}`);
        }
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
}

module.exports = {
    registerHandlers,
    setMainWindow,
    watchFile,
    unwatchFile,
    updateFileWatcherMtime,
};
