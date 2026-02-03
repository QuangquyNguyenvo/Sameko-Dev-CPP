'use strict';

const { BrowserWindow, Menu, app } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { WINDOW } = require('../shared/constants');

let mainWindow = null;
let devServer = null;
let devServerPort = null;
let saveTimeout = null;

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

function createMainWindow() {
    const appRoot = getAppRoot();

    // Load saved window bounds
    const savedBounds = loadWindowBounds();
    const windowOptions = {
        width: savedBounds?.width || WINDOW.DEFAULT_WIDTH,
        height: savedBounds?.height || WINDOW.DEFAULT_HEIGHT,
        x: savedBounds?.x,
        y: savedBounds?.y,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(appRoot, 'preload.js')
        },
        icon: path.join(appRoot, 'src', 'assets', 'icon.ico'),
        backgroundColor: WINDOW.BACKGROUND_COLOR
    };

    mainWindow = new BrowserWindow(windowOptions);

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
    getBasePath,
    getAppRoot,
    minimizeWindow,
    toggleMaximize,
    closeWindow,
    isWindowAvailable,
    sendToRenderer,
};
