'use strict';

const { BrowserWindow, Menu, app, screen } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { WINDOW } = require('../shared/constants');
const { IS_WIN } = require('../shared/platform');

let mainWindow = null;
let devServer = null;
let devServerPort = null;
let saveTimeout = null;
let displayListenersAttached = false;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadWindowBounds() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            return data.windowBounds || null;
        }
    } catch (error) {
        console.error('[Window] Failed to load window bounds:', error);
    }
    return null;
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

function saveWindowBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    
    // Debounce: only save after 500ms of no changes
    if (saveTimeout) clearTimeout(saveTimeout);
    
    saveTimeout = setTimeout(() => {
        try {
            const isMaximized = mainWindow.isMaximized();
            
            let settings = {};
            if (fs.existsSync(settingsPath)) {
                settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            }
            
            // Only save bounds when NOT maximized to get correct restore size
            if (!isMaximized) {
                const bounds = mainWindow.getBounds();
                settings.windowBounds = {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    isMaximized: false
                };
            } else {
                // Just update maximized state, keep previous bounds for restore
                if (!settings.windowBounds) {
                    settings.windowBounds = {};
                }
                settings.windowBounds.isMaximized = true;
            }
            
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        } catch (error) {
            console.error('[Window] Failed to save window bounds:', error);
        }
    }, 500);
}

function startDevStaticServer(appRoot) {
    if (app.isPackaged) return null;
    if (devServer) return { port: devServerPort };

    const publicDir = path.join(appRoot, 'src');
    const mime = {
        '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
        '.woff2': 'font/woff2', '.ttf': 'font/ttf'
    };

    devServer = http.createServer((req, res) => {
        const urlPath = req.url.split('?')[0];
        const safePath = urlPath === '/' ? '/index.html' : urlPath;
        const filePath = path.join(publicDir, safePath);

        if (!filePath.startsWith(publicDir)) {
            res.writeHead(403); res.end('Forbidden'); return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404); res.end('Not found'); return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
            res.end(data);
        });
    });

    devServer.listen(0, '127.0.0.1', () => {
        devServerPort = devServer.address().port;
        console.log(`[DevServer] http://localhost:${devServerPort}/`);
    });

    devServer.on('error', (err) => {
        console.warn('[DevServer] Failed to start:', err.message);
    });

    return { port: devServerPort };
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

    const devServerInfo = startDevStaticServer(appRoot);
    if (devServerInfo?.port) {
        const devUrl = `http://localhost:${devServerInfo.port}/`;
        mainWindow.loadURL(devUrl);
    } else {
        mainWindow.loadFile(path.join(appRoot, 'src', 'index.html'));
    }

    Menu.setApplicationMenu(null);

    // Save window bounds on resize, move, maximize, unmaximize
    mainWindow.on('resize', saveWindowBounds);
    mainWindow.on('move', saveWindowBounds);
    mainWindow.on('maximize', saveWindowBounds);
    mainWindow.on('unmaximize', saveWindowBounds);

    // Save immediately before closing
    mainWindow.on('close', () => {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        // Force immediate save on close
        try {
            const isMaximized = mainWindow.isMaximized();
            
            let settings = {};
            if (fs.existsSync(settingsPath)) {
                settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            }
            
            // Only save bounds when NOT maximized
            if (!isMaximized) {
                const bounds = mainWindow.getBounds();
                settings.windowBounds = {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    isMaximized: false
                };
            } else {
                // Just update maximized state, keep previous bounds
                if (!settings.windowBounds) {
                    settings.windowBounds = {};
                }
                settings.windowBounds.isMaximized = true;
            }
            
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        } catch (error) {
            console.error('[Window] Failed to save bounds on close:', error);
        }
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
