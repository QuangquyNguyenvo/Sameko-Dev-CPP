/**
 * Sameko Dev C++ IDE - Settings IPC Handlers
 * Handles settings persistence
 * @module app/ipc/settings-handlers
 */

'use strict';

const { ipcMain, app } = require('electron');
const { IPC } = require('../shared/constants');
const { readSettings, saveRendererSettings } = require('../shared/settings-store');

function registerHandlers() {
    ipcMain.handle(IPC.SETTINGS.SAVE, async (event, settings) => {
        try {
            saveRendererSettings(settings);
            try {
                // Keep clangd's compile_flags.txt (cppStandard/extraFlags) in
                // sync so IntelliSense matches the compiler settings the user
                // just saved, without requiring an app restart.
                require('../services/syntax').onClangdSettingsChanged();
            } catch (e) { }
            // Interface Scale applies as soon as it is saved.
            require('../windows/main-window').applyUiScale();
            return { success: true };
        } catch (error) {
            console.error('Failed to save settings:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on(IPC.SETTINGS.LOAD, (event) => {
        try {
            event.returnValue = readSettings();
        } catch (error) {
            console.error('Failed to load settings:', error);
            event.returnValue = null;
        }
    });

    ipcMain.handle('get-current-version', async () => {
        return app.getVersion();
    });

}

module.exports = {
    registerHandlers,
};
