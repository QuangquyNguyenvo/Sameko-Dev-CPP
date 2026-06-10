'use strict';

require('v8-compile-cache');

const __T0 = process.hrtime.bigint();
const __ms = () => Number(process.hrtime.bigint() - __T0) / 1e6;

const { app } = require('electron');
const { initializeApp, setupAppEvents } = require('./core/app-lifecycle');

if (process.platform === 'win32') {
    app.setAppUserModelId('com.quangquy.cppide');
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('[App] Another instance is already running. Quitting...');
    app.quit();
    process.exit(0);
}

setupAppEvents();

app.whenReady().then(async () => {
    // Show splash screen immediately
    const { createSplashWindow, closeSplashWindow } = require('./windows/splash-window');
    createSplashWindow();

    console.log(`[PERF] whenReady @ ${__ms().toFixed(0)}ms`);
    await initializeApp();
    console.log(`[PERF] initializeApp done @ ${__ms().toFixed(0)}ms`);
    
    // Lazy load window & handlers
    const { createMainWindow } = require('./windows/main-window');
    const mainWindow = createMainWindow();
    console.log(`[PERF] createMainWindow done @ ${__ms().toFixed(0)}ms`);
    
    const registerLegacyHandlers = require('./ipc');
    registerLegacyHandlers(mainWindow);
    
    const autoUpdateService = require('./services/auto-update-service');
    autoUpdateService.initialize(mainWindow);
    
    const discordRPC = require('./services/discord-rpc-service');
    discordRPC.connect();
    
    let revealed = false;
    const revealMainWindow = (reason) => {
        if (revealed) return;
        revealed = true;
        closeSplashWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        }
        console.log(`[PERF] main window shown @ ${__ms().toFixed(0)}ms (${reason})`);
    };

    mainWindow.once('ready-to-show', () => revealMainWindow('ready-to-show'));
    mainWindow.webContents.once('did-finish-load', () => {
        console.log(`[PERF] renderer did-finish-load @ ${__ms().toFixed(0)}ms`);
        revealMainWindow('did-finish-load');
    });
    mainWindow.webContents.once('dom-ready', () => {
        console.log(`[PERF] renderer dom-ready @ ${__ms().toFixed(0)}ms`);
    });
    
    // Safety net: never let the splash hang longer than 10s.
    setTimeout(() => revealMainWindow('fallback-timeout'), 10000);

    console.log('[App] Sameko Dev C++ is ready!');
});

app.on('will-quit', (event) => {
    // Require on demand to avoid blocking startup
    const discordRPC = require('./services/discord-rpc-service');
    if (!discordRPC.isRpcConnected()) return; // nothing to clear, let quit proceed
    event.preventDefault();
    discordRPC.destroy().finally(() => {
        app.quit();
    });
});

process.on('uncaughtException', (error) => {
    console.error('[App] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[App] Unhandled Rejection at:', promise, 'reason:', reason);
});
