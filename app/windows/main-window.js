'use strict';

const { BrowserWindow, Menu, app, screen } = require('electron');
const path = require('path');
const { WINDOW } = require('../shared/constants');
const { IS_WIN } = require('../shared/platform');
const { readSettings, updateSettings } = require('../shared/settings-store');

let mainWindow = null;
let saveTimeout = null;
let displayListenersAttached = false;

function loadWindowBounds() {
    const settings = readSettings();
    return (settings && settings.windowBounds) || null;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getIntersectionArea(boundsA, boundsB) {
    const left = Math.max(boundsA.x, boundsB.x);
    const top = Math.max(boundsA.y, boundsB.y);
    const right = Math.min(boundsA.x + boundsA.width, boundsB.x + boundsB.width);
    const bottom = Math.min(boundsA.y + boundsA.height, boundsB.y + boundsB.height);

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    return width * height;
}

function centerBoundsInArea(bounds, area) {
    const width = Math.min(bounds.width, area.width);
    const height = Math.min(bounds.height, area.height);

    return {
        ...bounds,
        width,
        height,
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2)
    };
}

function getSafeWindowBounds(savedBounds) {
    const primaryWorkArea = screen.getPrimaryDisplay().workArea;
    const baseBounds = {
        width: savedBounds?.width || WINDOW.DEFAULT_WIDTH,
        height: savedBounds?.height || WINDOW.DEFAULT_HEIGHT,
        isMaximized: savedBounds?.isMaximized === true
    };

    if (!savedBounds || typeof savedBounds.x !== 'number' || typeof savedBounds.y !== 'number') {
        return centerBoundsInArea(baseBounds, primaryWorkArea);
    }

    const requestedBounds = {
        x: savedBounds.x,
        y: savedBounds.y,
        width: baseBounds.width,
        height: baseBounds.height
    };

    let bestDisplay = null;
    let bestIntersection = 0;

    for (const display of screen.getAllDisplays()) {
        const intersection = getIntersectionArea(requestedBounds, display.workArea);
        if (intersection > bestIntersection) {
            bestIntersection = intersection;
            bestDisplay = display;
        }
    }

    if (!bestDisplay || bestIntersection === 0) {
        return centerBoundsInArea(baseBounds, primaryWorkArea);
    }

    const workArea = bestDisplay.workArea;
    const width = Math.min(baseBounds.width, workArea.width);
    const height = Math.min(baseBounds.height, workArea.height);

    return {
        ...baseBounds,
        width,
        height,
        x: clamp(savedBounds.x, workArea.x, workArea.x + Math.max(workArea.width - width, 0)),
        y: clamp(savedBounds.y, workArea.y, workArea.y + Math.max(workArea.height - height, 0))
    };
}

function ensureWindowIsVisible(window) {
    if (!window || window.isDestroyed()) return;

    const wasMaximized = window.isMaximized();
    const currentBounds = window.getBounds();
    const safeBounds = getSafeWindowBounds({
        ...currentBounds,
        isMaximized: wasMaximized
    });

    const boundsChanged = currentBounds.x !== safeBounds.x
        || currentBounds.y !== safeBounds.y
        || currentBounds.width !== safeBounds.width
        || currentBounds.height !== safeBounds.height;

    if (!boundsChanged) return;

    if (wasMaximized) {
        window.unmaximize();
    }

    window.setBounds({
        x: safeBounds.x,
        y: safeBounds.y,
        width: safeBounds.width,
        height: safeBounds.height
    });

    if (wasMaximized) {
        window.maximize();
    }
}

/** Persist the current bounds now (only the windowBounds key is touched). */
function writeWindowBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        const isMaximized = mainWindow.isMaximized();
        // Only save bounds when NOT maximized to get the correct restore size;
        // while maximized just flip the flag and keep the previous bounds.
        const bounds = isMaximized ? null : mainWindow.getBounds();
        updateSettings((settings) => {
            if (bounds) {
                settings.windowBounds = {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    isMaximized: false
                };
            } else {
                if (!settings.windowBounds) settings.windowBounds = {};
                settings.windowBounds.isMaximized = true;
            }
        });
    } catch (error) {
        console.error('[Window] Failed to save window bounds:', error);
    }
}

function saveWindowBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Debounce: only save after 500ms of no changes
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(writeWindowBounds, 500);
}

function getBasePath() {
    if (__dirname.includes('app.asar')) {
        return __dirname.replace('app.asar', 'app.asar.unpacked');
    }
    return path.join(__dirname, '..', '..');
}

function getAppRoot() {
    // For packaged app without asar, __dirname is inside resources/app
    if (app.isPackaged) {
        return path.join(__dirname, '..', '..');
    }
    return path.join(__dirname, '..', '..');
}

function attachDisplaySafetyListeners() {
    if (displayListenersAttached) return;

    const handleDisplayChange = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        ensureWindowIsVisible(mainWindow);
    };

    screen.on('display-added', handleDisplayChange);
    screen.on('display-removed', handleDisplayChange);
    screen.on('display-metrics-changed', handleDisplayChange);

    displayListenersAttached = true;
}

function createMainWindow() {
    const appRoot = getAppRoot();

    // Load saved window bounds
    const savedBounds = getSafeWindowBounds(loadWindowBounds());
    const windowOptions = {
        width: savedBounds?.width || WINDOW.DEFAULT_WIDTH,
        height: savedBounds?.height || WINDOW.DEFAULT_HEIGHT,
        x: savedBounds?.x,
        y: savedBounds?.y,
        frame: false,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // Chromium's spellchecker is on by default and would underline
            // identifiers typed in the app's text fields; it also costs memory.
            spellcheck: false,
            preload: path.join(appRoot, 'preload.js')
        },
        // Electron on Linux/macOS cannot read .ico for a window icon — it needs a PNG.
        // It must be a SMALL one: Electron copies the bitmap into the X11 _NET_WM_ICON
        // property, and the 2508x2508 source produced a 25 MB request that the X server
        // rejected ("Cannot send request of length 25160288"). Weston's XWM then never
        // finished setting up the window, so under WSLg the window existed in X but was
        // never handed to the compositor — it simply never appeared. 256px is the size
        // desktops actually use for taskbar/alt-tab.
        icon: IS_WIN
            ? path.join(appRoot, 'src', 'assets', 'icon.ico')
            : path.join(appRoot, 'src', 'assets', 'icons', 'linux', '256x256.png'),
        backgroundColor: WINDOW.BACKGROUND_COLOR
    };

    mainWindow = new BrowserWindow(windowOptions);
    attachDisplaySafetyListeners();

    // Restore maximized state
    if (savedBounds?.isMaximized) {
        mainWindow.maximize();
    }

    // (A dev-only static HTTP server used to be started here. It returned its
    // port before listen() had assigned one, so the window always fell through
    // to loadFile() and the server just sat on an open port, unused.)
    mainWindow.loadFile(path.join(appRoot, 'src', 'index.html'));

    Menu.setApplicationMenu(null);

    // The window only ever shows the app's own page. Refuse to navigate it
    // anywhere else (a dropped file or a stray link would otherwise replace the
    // whole IDE, with the preload API still attached) and never open child
    // windows; external links go through the `open-release-page` handler.
    const appUrl = mainWindow.webContents.getURL();
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url !== mainWindow.webContents.getURL() && url !== appUrl) event.preventDefault();
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Save window bounds on resize, move, maximize, unmaximize
    mainWindow.on('resize', saveWindowBounds);
    mainWindow.on('move', saveWindowBounds);
    mainWindow.on('maximize', saveWindowBounds);
    mainWindow.on('unmaximize', saveWindowBounds);

    // Save immediately before closing
    mainWindow.on('close', () => {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        writeWindowBounds();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Enable DevTools shortcut (Ctrl+Shift+I) - FOR DEBUGGING
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
        // F12 support
        if (input.key === 'F12') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });
    
    // Log renderer errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Window] Failed to load:', errorCode, errorDescription);
    });
    
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[Window] Render process gone:', details);
    });

    return mainWindow;
}

function getMainWindow() {
    return mainWindow;
}

function restoreAndFocusWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    ensureWindowIsVisible(mainWindow);
    mainWindow.show();
    mainWindow.focus();
}

function minimizeWindow() {
    if (mainWindow) {
        mainWindow.minimize();
    }
}

function toggleMaximize() {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
}

function closeWindow() {
    if (mainWindow) {
        mainWindow.close();
    }
}

function isWindowAvailable() {
    return mainWindow !== null && !mainWindow.isDestroyed();
}

function sendToRenderer(channel, data) {
    if (isWindowAvailable()) {
        mainWindow.webContents.send(channel, data);
    }
}

module.exports = {
    createMainWindow,
    getMainWindow,
    restoreAndFocusWindow,
    getBasePath,
    getAppRoot,
    minimizeWindow,
    toggleMaximize,
    closeWindow,
    isWindowAvailable,
    sendToRenderer,
};
