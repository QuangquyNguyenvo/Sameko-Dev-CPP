'use strict';

require('v8-compile-cache');

const __T0 = process.hrtime.bigint();
const __ms = () => Number(process.hrtime.bigint() - __T0) / 1e6;

const { app } = require('electron');
const { initializeApp, setupAppEvents, startDeferredCompilerWork } = require('./core/app-lifecycle');

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

    // None of this is needed to show the editor: the compiler warm-up and PCH
    // build (g++ processes), and the updater and Discord RPC (~170 ms of module
    // loading). They start once the page has loaded, so a slow machine spends
    // its first seconds on the UI.
    let deferredStarted = false;
    const startDeferredWork = () => {
        if (deferredStarted) return;
        deferredStarted = true;
        startDeferredCompilerWork();
        setTimeout(() => {
            require('./services/auto-update-service').initialize(mainWindow);
            require('./services/discord-rpc-service').connect();
        }, 1500);
    };

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

    // Not on 'ready-to-show': that fires on the first paint, before the renderer has read the
    // settings and applied the theme, so the window opened in the default colours and then
    // switched. By 'did-finish-load' the DOMContentLoaded handlers (applySettings) have run.
    mainWindow.webContents.once('did-finish-load', () => {
        console.log(`[PERF] renderer did-finish-load @ ${__ms().toFixed(0)}ms`);
        revealMainWindow('did-finish-load');
        startDeferredWork();
    });
    mainWindow.webContents.once('dom-ready', () => {
        console.log(`[PERF] renderer dom-ready @ ${__ms().toFixed(0)}ms`);
    });

    // Safety net: never let the splash hang longer than 10s.
    setTimeout(() => {
        revealMainWindow('fallback-timeout');
        startDeferredWork();
    }, 10000);

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
