'use strict';

/**
 * Sameko Dev C++ IDE - Splash Window
 * A lightweight, frameless window shown immediately on launch so the user gets
 * instant visual feedback while the (heavier) main window + Monaco load in the
 * background. Closed automatically once the main window is ready to show.
 * @module app/windows/splash-window
 */

const { BrowserWindow, app } = require('electron');
const path = require('path');

let splashWindow = null;

function getAppRoot() {
    // Mirror main-window.js: __dirname is app/windows, root is two levels up.
    return path.join(__dirname, '..', '..');
}

/**
 * Create and show the splash window immediately.
 * @returns {BrowserWindow|null}
 */
function createSplashWindow() {
    const appRoot = getAppRoot();

    splashWindow = new BrowserWindow({
        width: 420,
        height: 320,
        frame: false,
        transparent: true,
        resizable: false,
        movable: true,
        center: true,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        // No preload / nodeIntegration: the splash is static HTML and needs no privileges.
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    splashWindow.loadFile(path.join(appRoot, 'src', 'splash.html'));

    // Show as soon as the content is painted to avoid a white flash.
    splashWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.show();
        }
    });

    splashWindow.on('closed', () => {
        splashWindow = null;
    });

    return splashWindow;
}

/**
 * Close the splash window if it is still open.
 */
function closeSplashWindow() {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }
    splashWindow = null;
}

function getSplashWindow() {
    return splashWindow;
}

module.exports = {
    createSplashWindow,
    closeSplashWindow,
    getSplashWindow,
};
