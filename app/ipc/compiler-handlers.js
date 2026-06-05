/**
 * Sameko Dev C++ IDE - Compiler IPC Handlers
 * Handles compile, run, stop operations
 * @module app/ipc/compiler-handlers
 */

'use strict';

const { ipcMain } = require('electron');
const { IPC } = require('../shared/constants');
const compiler = require('../services/compiler');

let mainWindow = null;

function setMainWindow(window) {
    mainWindow = window;

    // Setup renderer callback
    compiler.setSendToRendererCallback((channel, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
    });
}

/**
 * Register all compiler-related IPC handlers
 */
function registerHandlers() {
    // Compile
    ipcMain.handle(IPC.COMPILER.COMPILE, async (event, { filePath, content, flags, useLLD, noBuildCache, singleFileMode, realtimeOutput }) => {
        return await compiler.compile({ filePath, content, flags, useLLD, noBuildCache, singleFileMode, realtimeOutput });
    });

    // Run
    ipcMain.handle(IPC.COMPILER.RUN, async (event, { exePath, cwd, useExternalTerminal }) => {
        if (useExternalTerminal) {
            return await compiler.runExternal({ exePath, cwd });
        }
        return await compiler.run({ exePath, cwd });
    });

    // Stop
    ipcMain.handle(IPC.COMPILER.STOP, async () => {
        compiler.stopProcess();
        return { success: true };
    });

    // Send input to running process
    ipcMain.handle(IPC.COMPILER.SEND_INPUT, async (event, input) => {
        return compiler.sendInput(input);
    });

    // Also register with the channel name used by preload.js
    ipcMain.handle('send-input', async (event, input) => {
        return compiler.sendInput(input);
    });

    // Get compiler info
    ipcMain.handle(IPC.COMPILER.GET_INFO, async () => {
        await compiler.getCompilerVersion();
        return compiler.getCompilerInfo();
    });

    // Get compiler status (for startup check)
    ipcMain.handle('get-compiler-status', async () => {
        const { getCompilerStatus } = require('../core/app-lifecycle');
        return getCompilerStatus();
    });
}

module.exports = {
    registerHandlers,
    setMainWindow,
};
