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
    await fsp.writeFile(filePath, content, 'utf-8');
    updateFileWatcherMtime(filePath);
}

/** @type {Map<string, {watcher: fs.FSWatcher, mtime: number}>} */
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
            if (!current) return;
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
    ipcMain.handle(IPC.FILE.OPEN_DIALOG, async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'C++ Files', extensions: ['cpp', 'c', 'h', 'hpp', 'cc', 'cxx'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled && result.filePaths.length > 0) {
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
            filters: [
                { name: 'C++ Files', extensions: ['cpp'] },
                { name: 'C Files', extensions: ['c'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled) {
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
