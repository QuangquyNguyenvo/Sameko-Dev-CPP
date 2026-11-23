'use strict';

/**
 * samekodev:// links: the browser extension's "Open Sameko Dev C++" button (and anything else)
 * starts or focuses the app. The link carries no command: whatever follows the scheme is
 * ignored, so a web page that opens such a link can only bring the window up.
 *
 * Windows: registered for the current user (HKCU\Software\Classes\samekodev) from the
 * installed or portable exe, after startup; the uninstaller removes it (installer.nsh).
 * The command line is `"exe" -- "%1"`: after `--` Chromium reads no switches, so a crafted
 * link cannot pass any. Linux: the deb's .desktop file declares it (package.json build.protocols);
 * nothing installs an AppImage's, so a running AppImage writes a hidden one for the current user.
 * A dev run (`electron .`) registers nothing.
 */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEME = 'samekodev';
const DESKTOP_FILE = 'sameko-dev-cpp-url.desktop';

function isSchemeUrl(arg) {
    return typeof arg === 'string' && arg.toLowerCase().startsWith(SCHEME + ':');
}

/** Registers the scheme for this exe when it is not already; called from startDeferredWork. */
function register() {
    if (!app.isPackaged) return false;
    if (process.platform === 'linux') return registerAppImage(process.env.APPIMAGE);
    if (process.platform !== 'win32') return false;
    try {
        const args = ['--'];
        if (app.isDefaultProtocolClient(SCHEME, process.execPath, args)) return true;
        return app.setAsDefaultProtocolClient(SCHEME, process.execPath, args);
    } catch (e) {
        console.warn('[UrlScheme] register failed:', e && e.message);
        return false;
    }
}

/** The .desktop text for an AppImage at this path (Exec quoting per the Desktop Entry spec). */
function appImageDesktopEntry(appImage) {
    const quoted = appImage.replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%');
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Sameko Dev C++',
        `Exec="${quoted}" -- %u`,
        'NoDisplay=true',
        `MimeType=x-scheme-handler/${SCHEME};`,
        ''
    ].join('\n');
}

function registerAppImage(appImage) {
    if (!appImage || !path.isAbsolute(appImage)) return false;
    try {
        const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
        const dir = path.join(dataHome, 'applications');
        const file = path.join(dir, DESKTOP_FILE);
        const text = appImageDesktopEntry(appImage);
        let current = null;
        try { current = fs.readFileSync(file, 'utf8'); } catch (_) { }
        if (current !== text) {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file, text);
        }
        require('child_process').execFile('xdg-mime', ['default', DESKTOP_FILE, `x-scheme-handler/${SCHEME}`], () => { });
        return true;
    } catch (e) {
        console.warn('[UrlScheme] register failed:', e && e.message);
        return false;
    }
}

module.exports = { SCHEME, isSchemeUrl, register, appImageDesktopEntry };
