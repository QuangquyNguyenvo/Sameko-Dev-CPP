/**
 * Sameko Dev C++ IDE - File IPC Handlers
 * Handles file operations: open, save, read, delete, etc.
 * @module app/ipc/file-handlers
 */

'use strict';

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { IPC } = require('../shared/constants');

let mainWindow = null;

let currentFile = null;

/** @type {Map<string, {watcher: fs.FSWatcher, mtime: number}>} */
const fileWatchers = new Map();

function setMainWindow(window) {
    mainWindow = window;
}

function getCurrentFile() {
    return currentFile;
}

function watchFile(filePath) {
    if (!filePath || fileWatchers.has(filePath)) return;

    try {
        const stats = fs.statSync(filePath);
        const watcher = fs.watch(filePath, (eventType) => {
            if (eventType === 'change') {
                const current = fileWatchers.get(filePath);
                if (!current) return;

                try {
                    const newStats = fs.statSync(filePath);
                    const newMtime = newStats.mtimeMs;

                    if (newMtime !== current.mtime) {
                        current.mtime = newMtime;
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send(IPC.EVENTS.FILE_CHANGED_EXTERNAL, { path: filePath });
                        }
                    }
                } catch (e) {
                    // File might be deleted
                }
            }
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
                const content = fs.readFileSync(filePath, 'utf-8');
                currentFile = filePath;
                mainWindow.webContents.send(IPC.EVENTS.FILE_OPENED, { path: filePath, content });
            }
        }
    });

    ipcMain.handle(IPC.FILE.SAVE, async (event, { path: filePath, content }) => {
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
            currentFile = filePath;
            updateFileWatcherMtime(filePath);
            return { success: true, path: filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC.FILE.SAVE_DIALOG, async (event, content) => {
        const result = await dialog.showSaveDialog(mainWindow, {
            filters: [
                { name: 'C++ Files', extensions: ['cpp'] },
                { name: 'C Files', extensions: ['c'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled) {
            try {
                fs.writeFileSync(result.filePath, content, 'utf-8');
                currentFile = result.filePath;
                return { success: true, path: result.filePath };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
        return { success: false, canceled: true };
    });

    ipcMain.handle(IPC.FILE.READ, async (event, filePath) => {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content;
        } catch (error) {
            throw new Error(`Cannot read file: ${error.message}`);
        }
    });

    ipcMain.handle(IPC.FILE.READ_DIR, async (event, dirPath) => {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            return entries.map(entry => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile()
            }));
        } catch (error) {
            console.error('[FileExplorer] read-directory error:', error);
            return [];
        }
    });

    ipcMain.handle(IPC.FILE.DELETE, async (event, filePath) => {
        try {
            fs.unlinkSync(filePath);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot delete file: ${error.message}`);
        }
    });

    ipcMain.handle(IPC.FILE.RENAME, async (event, { oldPath, newPath }) => {
        try {
            fs.renameSync(oldPath, newPath);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot rename file: ${error.message}`);
        }
    });

    ipcMain.handle('copy-file', async (event, { src, dest }) => {
        try {
            fs.copyFileSync(src, dest);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot copy file: ${error.message}`);
        }
    });

    ipcMain.handle('move-file', async (event, { src, dest }) => {
        try {
            fs.renameSync(src, dest);
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot move file: ${error.message}`);
        }
    });

    ipcMain.handle('delete-folder', async (event, folderPath) => {
        try {
            fs.rmSync(folderPath, { recursive: true, force: true });
            return { success: true };
        } catch (error) {
            throw new Error(`Cannot delete folder: ${error.message}`);
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
            const content = fs.readFileSync(filePath, 'utf-8');
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
    getCurrentFile,
    watchFile,
    unwatchFile,
    updateFileWatcherMtime,
};
