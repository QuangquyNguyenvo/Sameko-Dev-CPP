'use strict';

const { ipcMain } = require('electron');
const autoUpdateService = require('../services/auto-update-service');

function registerUpdateHandlers() {
    ipcMain.handle('check-for-updates', async (event) => {
        try {
            await autoUpdateService.checkForUpdates(true);
            return { success: true };
        } catch (error) {
            return { 
                success: false, 
                error: error.message 
            };
        }
    });

    ipcMain.handle('download-update', async (event) => {
        try {
            await autoUpdateService.downloadUpdate();
            return { success: true };
        } catch (error) {
            return { 
                success: false, 
                error: error.message 
            };
        }
    });

    ipcMain.handle('quit-and-install', (event) => {
        autoUpdateService.quitAndInstall();
        return { success: true };
    });

    // Open a project page in the user's browser. The preload has exposed
    // `openReleasePage` for a long time, but no handler existed, so the GitHub
    // and "Download" buttons did nothing. Only the project's own pages are
    // allowed — the renderer must not be able to open arbitrary URLs.
    ipcMain.handle('open-release-page', async (event, url) => {
        const target = typeof url === 'string' && url
            ? url
            : 'https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/releases';
        const allowed = /^https:\/\/(github\.com\/QuangquyNguyenvo\/Sameko-Dev-CPP(\/|$)|sameko\.dev(\/|$))/i;
        if (!allowed.test(target)) return { success: false, error: 'URL not allowed' };
        await require('electron').shell.openExternal(target);
        return { success: true };
    });

    // Get app info (portable detection)
    ipcMain.handle('get-app-info', () => {
        const isPortable = process.env.PORTABLE_EXECUTABLE_DIR !== undefined;
        return {
            isPortable: isPortable,
            version: require('electron').app.getVersion()
        };
    });

}

module.exports = registerUpdateHandlers;
