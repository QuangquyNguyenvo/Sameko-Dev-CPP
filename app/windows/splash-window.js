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
const fs = require('fs');

let splashWindow = null;

function getAppRoot() {
    // Mirror main-window.js: __dirname is app/windows, root is two levels up.
    return path.join(__dirname, '..', '..');
}

// Colours of the theme in use, saved by the renderer each time a theme is applied
// (appearance.js › saveSplashPalette), so the splash opens in the user's theme.
// Only plain colour values pass; anything else falls back to the splash defaults.
const SPLASH_KEYS = ['bg', 'panel', 'accent', 'text', 'muted', 'accentText'];
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([0-9\s.,%]+\))$/i;

function readSplashPalette() {
    try {
        const file = path.join(app.getPath('userData'), 'state', 'splash.json');
        const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const query = {};
        for (const key of SPLASH_KEYS) {
            if (typeof saved[key] === 'string' && COLOR_RE.test(saved[key].trim())) query[key] = saved[key].trim();
        }
        if (saved.type === 'light' || saved.type === 'dark') query.type = saved.type;
        return query;
    } catch (_) {
        return {}; // first launch, or no theme saved yet
    }
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
        // Linux without a compositing WM ignores `transparent` and would paint an
        // opaque black rectangle. A fully transparent backgroundColor keeps it
        // looking intentional; it is invisible where transparency does work.
        backgroundColor: '#00000000',
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

    splashWindow.loadFile(path.join(appRoot, 'src', 'splash.html'), { query: readSplashPalette() });

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
