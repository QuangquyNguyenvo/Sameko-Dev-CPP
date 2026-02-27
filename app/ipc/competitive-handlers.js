/**
 * Sameko Dev C++ IDE - Competitive Programming IPC Handlers
 * Handles CP Companion and batch testing
 * @module app/ipc/competitive-handlers
 */

'use strict';

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const competitive = require('../services/competitive');

let mainWindow = null;

function setMainWindow(window) {
    mainWindow = window;

    // Setup callbacks
    competitive.setOnProblemReceived((problem) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('problem-received', problem);
        }
    });

    competitive.setOnFocusWindow(() => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.show();
            mainWindow.focus();
            mainWindow.setAlwaysOnTop(false);
            if (!mainWindow.isFocused()) mainWindow.flashFrame(true);
        }
    });
}

/**
 * Register all competitive programming IPC handlers
 */
function registerHandlers() {
    // CP Companion server control
    ipcMain.handle('cc-start-server', async () => {
        return await competitive.startServer();
    });

    ipcMain.handle('cc-stop-server', async () => {
        return competitive.stopServer();
    });

    ipcMain.handle('cc-get-status', async () => {
        return competitive.getServerStatus();
    });

    ipcMain.handle('cc-open-extension-page', async () => {
        return competitive.openExtensionPage();
    });

    // Batch testing
    ipcMain.handle('run-test', async (event, { exePath, input, expectedOutput, timeLimit, cwd }) => {
        return await competitive.runTest({ exePath, input, expectedOutput, timeLimit, cwd });
    });

    // ==================== .sameko file handlers ====================

    /**
     * Read .sameko metadata file from a folder
     */
    ipcMain.handle('read-sameko', async (event, folderPath) => {
        try {
            const samekoPath = path.join(folderPath, '.sameko');
            if (!fs.existsSync(samekoPath)) {
                return { exists: false, data: null };
            }
            const content = fs.readFileSync(samekoPath, 'utf-8');
            const data = JSON.parse(content);
            return { exists: true, data };
        } catch (err) {
            console.error('[Competitive] Failed to read .sameko:', err);
            return { exists: false, data: null, error: err.message };
        }
    });

    /**
     * Write .sameko metadata file to a folder
     */
    ipcMain.handle('write-sameko', async (event, { folderPath, data }) => {
        try {
            const samekoPath = path.join(folderPath, '.sameko');
            const content = JSON.stringify(data, null, 2);
            fs.writeFileSync(samekoPath, content, 'utf-8');
            return { success: true };
        } catch (err) {
            console.error('[Competitive] Failed to write .sameko:', err);
            return { success: false, error: err.message };
        }
    });

    /**
     * Create a new contest folder with problem files and .sameko metadata
     */
    ipcMain.handle('create-contest', async (event, { parentDir, name, problemIds, platform }) => {
        try {
            const contestDir = path.join(parentDir, name);

            // Create contest directory
            if (!fs.existsSync(contestDir)) {
                fs.mkdirSync(contestDir, { recursive: true });
            }

            // Create .cpp files for each problem
            const cppTemplate = (id) => `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    // TODO: solve ${id}

    return 0;
}
`;

            const problems = [];
            for (const id of problemIds) {
                const filePath = path.join(contestDir, `${id}.cpp`);
                if (!fs.existsSync(filePath)) {
                    fs.writeFileSync(filePath, cppTemplate(id), 'utf-8');
                }
                problems.push({
                    id,
                    label: '',
                    status: 'todo',
                    timeSpentMs: 0,
                    activeApproach: null,
                    approaches: []
                });
            }

            // Create .sameko metadata
            const samekoData = {
                type: 'contest',
                name,
                platform: platform || 'Other',
                date: new Date().toISOString().split('T')[0],
                problems
            };

            const samekoPath = path.join(contestDir, '.sameko');
            fs.writeFileSync(samekoPath, JSON.stringify(samekoData, null, 2), 'utf-8');

            return { success: true, contestDir: contestDir.replace(/\\/g, '/') };
        } catch (err) {
            console.error('[Competitive] Failed to create contest:', err);
            return { success: false, error: err.message };
        }
    });

}

module.exports = {
    registerHandlers,
    setMainWindow,
};
