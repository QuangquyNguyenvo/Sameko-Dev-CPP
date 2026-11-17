'use strict';

/**
 * samekodev:// links: the browser extension's "Open Sameko Dev C++" button (and anything else)
 * starts or focuses the app. The link carries no command: whatever follows the scheme is
 * ignored, so a web page that opens such a link can only bring the window up.
 *
 * Windows: registered for the current user (HKCU\Software\Classes\samekodev) from the
 * installed or portable exe, after startup; the uninstaller removes it (installer.nsh).
 * The command line is `"exe" -- "%1"`: after `--` Chromium reads no switches, so a crafted
 * link cannot pass any. Linux: the .desktop file of the deb/AppImage declares it
 * (package.json build.protocols). A dev run (`electron .`) registers nothing.
 */
const { app } = require('electron');

const SCHEME = 'samekodev';

function isSchemeUrl(arg) {
    return typeof arg === 'string' && arg.toLowerCase().startsWith(SCHEME + ':');
}

/** Registers the scheme for this exe when it is not already; called from startDeferredWork. */
function register() {
    if (process.platform !== 'win32' || !app.isPackaged) return false;
    try {
        const args = ['--'];
        if (app.isDefaultProtocolClient(SCHEME, process.execPath, args)) return true;
        return app.setAsDefaultProtocolClient(SCHEME, process.execPath, args);
    } catch (e) {
        console.warn('[UrlScheme] register failed:', e && e.message);
        return false;
    }
}

module.exports = { SCHEME, isSchemeUrl, register };
