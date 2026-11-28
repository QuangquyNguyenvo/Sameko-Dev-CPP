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
    compiler.setSendToRendererCallback((channel, ...args) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, ...args);
        }
    });
}

/**
 * Register all compiler-related IPC handlers
 */
function registerHandlers() {
    ipcMain.handle(IPC.COMPILER.RUN_INSTRUMENTED_TEST, async (event, options) => {
        return require('../services/compiler/run/test-instrumentation').runInstrumentedTest(options);
    });

    // Compile
    ipcMain.handle(IPC.COMPILER.COMPILE, async (event, { filePath, content, flags, useLLD, noBuildCache, singleFileMode, realtimeOutput, untitledId, untitledExt, variant, saveSource }) => {
        const request = { filePath, content, flags, useLLD, noBuildCache, singleFileMode, realtimeOutput, untitledId, untitledExt, variant };
        if (!saveSource || !filePath) return compiler.compile(request);
        try {
            await require('./file-handlers').writeTextFile(filePath, content);
        } catch (error) {
            return { success: false, saveError: error.message };
        }
        try {
            return { ...await compiler.compile(request), sourceSaved: true };
        } catch (error) {
            return { success: false, error: error.message, sourceSaved: true };
        }
    });

    // Run
    ipcMain.handle(IPC.COMPILER.RUN, async (event, { exePath, cwd, useExternalTerminal, runId, initialInput }) => {
        if (useExternalTerminal) {
            return await compiler.runExternal({ exePath, cwd });
        }
        return compiler.run({ exePath, cwd, runId, initialInput });
    });

    // Stop
    ipcMain.handle(IPC.COMPILER.STOP, async () => {
        compiler.stopProcess();
        return { success: true };
    });

    // Send input to the running process (terminal input box / INPUT panel)
    ipcMain.handle(IPC.COMPILER.SEND_INPUT, async (event, input) => {
        return compiler.sendInput(input);
    });

    // End of input (EOF) for the running process (Ctrl+D / Ctrl+Z in the terminal)
    ipcMain.handle(IPC.COMPILER.CLOSE_INPUT, async () => {
        return compiler.closeInput();
    });

    // Stream a test input file into the running process (Input card › Load input from file)
    ipcMain.handle(IPC.COMPILER.SEND_INPUT_FILE, async (event, filePath, runId) => {
        return compiler.sendInputFile(filePath, runId);
    });

    // Size, line count and first lines of a test input file, for its preview
    ipcMain.handle(IPC.COMPILER.INPUT_FILE_INFO, async (event, filePath) => {
        return compiler.inputFileInfo(filePath);
    });

    // Python, Java, Rust... and the compiler or interpreter found for each (Settings › Compiler)
    ipcMain.handle(IPC.COMPILER.LANGUAGES, async (event, typed) => {
        return require('../services/compiler/toolchain/languages').listLanguages(typed);
    });

    // Get compiler status (for startup check)
    ipcMain.handle('get-compiler-status', async () => {
        const { getCompilerStatus } = require('../core/app-lifecycle');
        return getCompilerStatus();
    });

    // Clean PCH cache
    ipcMain.handle('clean-pch-cache', async (event, options) => {
        try {
            compiler.cleanPCHCache();
            const flags = options?.flags;
            if (flags) {
                console.log(`[Compiler IPC] Triggering background PCH rebuild with flags: ${flags}`);
                compiler.ensurePCH(flags).catch(err => {
                    console.error('[Compiler IPC] Background PCH rebuild failed:', err);
                });
            }
            return { success: true };
        } catch (err) {
            console.error('[Compiler IPC] Failed to clean PCH cache:', err);
            return { success: false, error: err.message };
        }
    });
}

module.exports = {
    registerHandlers,
    setMainWindow,
};
