'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let tsParser = null;
let compilerStatus = { found: false, path: null, error: null };

function initTreeSitter() {
    try {
        const Parser = require('tree-sitter');
        const Cpp = require('tree-sitter-cpp');
        tsParser = new Parser();
        tsParser.setLanguage(Cpp);
        return true;
    } catch (e) {
        return false;
    }
}

function getTreeSitterParser() {
    return tsParser;
}

function ensureDirectories() {
    const dirs = [
        path.join(app.getPath('userData'), 'local-history'),
        path.join(app.getPath('temp'), 'cpp-ide'),
        path.join(app.getPath('temp'), 'cpp-ide-pch'),
        path.join(app.getPath('temp'), 'cpp-ide-builds'),
    ];

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

function validateCompiler() {
    try {
        const { getDetectedCompiler, getCompilerInfo } = require('../services/compiler/detector');
        const compiler = getDetectedCompiler();
        const info = getCompilerInfo();

        if (compiler && compiler !== 'g++' && fs.existsSync(compiler)) {
            compilerStatus = { found: true, path: compiler, info };
            console.log(`[Startup] Compiler OK: ${compiler}`);
        } else if (compiler === 'g++') {
            compilerStatus = {
                found: false,
                path: null,
                error: 'Compiler not found. Using system PATH fallback.',
                fallback: true
            };
            console.warn('[Startup] Compiler not bundled, using PATH fallback');
        } else {
            compilerStatus = {
                found: false,
                path: null,
                error: `Compiler not found at: ${compiler}`
            };
            console.error('[Startup] Compiler NOT found!');
        }
    } catch (e) {
        compilerStatus = { found: false, path: null, error: e.message };
        console.error('[Startup] Compiler check failed:', e.message);
    }
    return compilerStatus;
}

function getCompilerStatus() {
    return compilerStatus;
}

async function initializeApp() {
    initTreeSitter();
    ensureDirectories();
    validateCompiler();
}

function cleanupBeforeQuit() {
}

function setupAppEvents() {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        const { getMainWindow, restoreAndFocusWindow } = require('../windows/main-window');
        const mainWindow = getMainWindow();

        if (mainWindow) {
            restoreAndFocusWindow();
        }
    });

    app.on('before-quit', () => {
        cleanupBeforeQuit();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('activate', () => {
        const { BrowserWindow } = require('electron');
        if (BrowserWindow.getAllWindows().length === 0) {
            const { createMainWindow } = require('../windows/main-window');
            createMainWindow();
        }
    });
}

module.exports = {
    initializeApp,
    cleanupBeforeQuit,
    setupAppEvents,
    getTreeSitterParser,
    getCompilerStatus,
};
