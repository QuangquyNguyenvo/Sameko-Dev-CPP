/**
 * Sameko Dev C++ IDE - app:// protocol for the main window.
 *
 * Chromium keeps a V8 code cache only for http(s) and for custom schemes
 * registered with `codeCache: true`. From file:// the page recompiled all of
 * its JavaScript (Monaco plus the app, ~2.5 MB) on every launch.
 *
 *   app://app/<path>               a file inside the app root (page, scripts, styles)
 *   app://app/@local?u=<file URL>  a picture, video, audio or subtitle file
 *   app://app/@local?p=<path>      anywhere on disk: theme backgrounds, Markdown
 *                                  media. A page that is not file:// may not load
 *                                  file:// URLs; the renderer rewrites them with
 *                                  localUrl() (src/renderer/boot.js). The path rides
 *                                  in the query so URL normalisation cannot change
 *                                  it; Node resolves it. Same origin as the page, so
 *                                  a canvas can read the image (appearance.js blur).
 * @module app/core/app-protocol
 */

'use strict';

const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const SCHEME = 'app';
const APP_HOST = 'app';
const MEDIA_EXT = new Set([
    // images
    '.png', '.apng', '.jpg', '.jpeg', '.jpe', '.jfif', '.pjpeg', '.pjp', '.gif', '.webp', '.bmp', '.svg', '.ico', '.cur', '.avif',
    // video
    '.mp4', '.m4v', '.webm', '.ogv', '.mov',
    // audio
    '.mp3', '.wav', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.weba',
    // subtitles (<track>)
    '.vtt',
]);

/**
 * The file a @local request names, or null.
 * @param {URLSearchParams} q
 * @returns {string|null}
 */
function localFile(q) {
    let file = null;
    try {
        if (q.has('u')) file = fileURLToPath(new URL(q.get('u')));
        else if (q.has('p')) file = q.get('p');
    } catch (_) { return null; }
    if (!file || file.includes('\0')) return null;
    if (process.platform === 'win32') {
        // Win32 namespaces: \\?\C:\x and \\?\UNC\srv\share\x are plain paths; \\.\ is a device.
        if (/^[\\/]{2}\.[\\/]/.test(file)) return null;
        const ext = /^[\\/]{2}\?[\\/](UNC[\\/])?(.*)$/i.exec(file);
        if (ext) file = (ext[1] ? '\\\\' : '') + ext[2];
    }
    if (!path.isAbsolute(file)) return null;
    // Resolves ".." within the drive or \\server\share root.
    file = path.resolve(file);
    return MEDIA_EXT.has(path.extname(file).toLowerCase()) ? file : null;
}

/**
 * file:// URL for net.fetch. pathToFileURL turns \\localhost\share\x into
 * file:///share/x, so that server is addressed as 127.0.0.1.
 * @param {string} file
 * @returns {string}
 */
function fetchUrl(file) {
    const m = /^\\\\([^\\]+)\\(.+)$/.exec(file);
    if (process.platform === 'win32' && m) {
        const host = m[1].toLowerCase() === 'localhost' ? '127.0.0.1' : m[1];
        return 'file://' + host + '/' + m[2].split('\\').map(encodeURIComponent).join('/');
    }
    return pathToFileURL(file).href;
}

/** Must run before app 'ready'. */
function registerScheme() {
    const { protocol } = require('electron');
    protocol.registerSchemesAsPrivileged([{
        scheme: SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true, stream: true },
    }]);
}

const notFound = () => new Response(null, { status: 404 });

let handled = false;
/**
 * Serve the scheme. Call after 'ready'; later calls do nothing.
 * @param {string} root - the app root (folder that holds src/ and node_modules/)
 */
function ensureHandled(root) {
    if (handled) return;
    handled = true;
    const { protocol, net } = require('electron');
    const base = path.resolve(root);
    protocol.handle(SCHEME, (request) => {
        let url;
        try { url = new URL(request.url); } catch (_) { return new Response(null, { status: 400 }); }
        if (url.host !== APP_HOST) return notFound();
        let file;
        if (url.pathname === '/@local') {
            file = localFile(url.searchParams);
            if (!file) return notFound();
        } else {
            try { file = path.resolve(base, '.' + decodeURIComponent(url.pathname)); } catch (_) { return notFound(); }
            if (file !== base && !file.startsWith(base + path.sep)) return notFound();
        }
        // Range requests let a background video seek and loop.
        return net.fetch(fetchUrl(file), { headers: request.headers, bypassCustomProtocolHandlers: true });
    });
}

const READ_ALL = `(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })()`;

/**
 * Versions up to 1.3.x ran the page from file://, and localStorage belongs to
 * the origin: debugger panel state, per-folder CP mode, and data older
 * versions still migrate from there. Copy it to app:// once (keys app://
 * already has win). Two hidden windows, only when the old store exists.
 * @param {string} root
 * @returns {Promise<void>}
 */
async function migrateFileOriginStorage(root) {
    const fs = require('fs');
    const { app, BrowserWindow } = require('electron');
    const userData = app.getPath('userData');
    const marker = path.join(userData, 'state', 'app-origin-storage');
    if (fs.existsSync(marker)) return;
    const done = () => {
        try {
            fs.mkdirSync(path.dirname(marker), { recursive: true });
            fs.writeFileSync(marker, 'localStorage copied from file:// to app://\n');
        } catch (_) { }
    };
    if (!fs.existsSync(path.join(userData, 'Local Storage', 'leveldb'))) return done();

    ensureHandled(root);
    const page = path.join(root, 'src', 'storage-migrate.html');
    const hidden = () => new BrowserWindow({
        show: false, width: 100, height: 100,
        webPreferences: { sandbox: true, contextIsolation: true, spellcheck: false },
    });
    const wins = [];
    const work = (async () => {
        const from = hidden(); wins.push(from);
        await from.loadFile(page);
        const entries = await from.webContents.executeJavaScript(READ_ALL);
        const keys = Object.keys(entries || {});
        if (keys.length) {
            const to = hidden(); wins.push(to);
            await to.loadURL(urlFor(root, page));
            await to.webContents.executeJavaScript(`(() => { const e = ${JSON.stringify(entries)};
                for (const k of Object.keys(e)) if (localStorage.getItem(k) === null) localStorage.setItem(k, e[k]); })()`);
        }
        console.log(`[Startup] Copied ${keys.length} localStorage entries to app://`);
    })();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), 8000); });
    try {
        await Promise.race([work, timeout]);
        done();
    } catch (err) {
        // Not marked done: tried again on the next launch.
        console.warn('[Startup] localStorage migration failed:', err && err.message);
    } finally {
        clearTimeout(timer);
        for (const w of wins) { try { if (!w.isDestroyed()) w.destroy(); } catch (_) { } }
    }
}

/**
 * URL of a file inside the app root, for BrowserWindow.loadURL.
 * @param {string} root
 * @param {string} file - absolute path inside root
 * @returns {string}
 */
function urlFor(root, file) {
    const rel = path.relative(root, file).split(path.sep).map(encodeURIComponent).join('/');
    return `${SCHEME}://${APP_HOST}/${rel}`;
}

module.exports = { registerScheme, ensureHandled, migrateFileOriginStorage, urlFor, SCHEME };
