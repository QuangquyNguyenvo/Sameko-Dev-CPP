/**
 * Sameko Dev C++ IDE - Renderer boot hooks
 *
 * Loaded first, as a file rather than inline: the page's Content-Security-Policy
 * forbids inline scripts, which is what stops injected markup from running code.
 */

// Surface every uncaught error in the console (and in electron-log via --enable-logging).
window.onerror = function (msg, url, line, col, error) {
    console.error('[GLOBAL ERROR]', msg, url, line, col, error);
    return false;
};
window.onunhandledrejection = function (event) {
    const reason = event.reason;
    // Monaco cancels pending work (a Delayer) when an editor switches models and
    // leaves that promise unhandled. It is expected, and VS Code ignores it too.
    if (reason && reason.name === 'Canceled' && reason.message === 'Canceled') {
        event.preventDefault();
        return;
    }
    console.error('[UNHANDLED REJECTION]', reason);
};

/**
 * Escape a value for use in HTML text or a quoted attribute. Shared by every
 * renderer script (plain <script> tags share one global scope, so it is
 * declared exactly once, here). Anything interpolated into innerHTML that did
 * not originate as markup in this codebase must go through it.
 * @param {*} value
 * @returns {string}
 */
function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/**
 * The page is served from app:// (for Chromium's code cache), and such a page
 * may not load file:// URLs. Pictures, videos and audio on disk are fetched
 * through app://app/@local?u=<file URL> or ?p=<path> instead; the main process
 * (app/core/app-protocol.js) turns that back into a file. Accepts a file:// URL
 * or an absolute path (C:\x, \\server\share\x, /home/x); anything else is
 * returned unchanged. Stored settings and themes keep file:// URLs, so convert
 * where a URL goes into the DOM or fetch().
 * @param {string} url
 * @returns {string}
 */
function localUrl(url) {
    if (typeof url !== 'string') return url;
    const u = url.trim();
    if (/^file:/i.test(u)) {
        // A fragment (sprite.svg#icon, clip.mp4#t=10) stays on the outer URL.
        const at = u.indexOf('#');
        return at < 0 ? 'app://app/@local?u=' + encodeURIComponent(u)
            : 'app://app/@local?u=' + encodeURIComponent(u.slice(0, at)) + u.slice(at);
    }
    if (/^[a-zA-Z]:[\\/]|^[\\/]{2}[^\\/]|^\/(?!\/)/.test(u)) return 'app://app/@local?p=' + encodeURIComponent(u);
    return url;
}

/** True for \\server\share\x, //server/x or file://server/x (a network share). */
function isNetworkPath(url) {
    if (typeof url !== 'string') return false;
    const u = url.trim();
    if (/^[\\/]{2}/.test(u)) return true;
    if (!/^file:/i.test(u)) return false;
    // The URL parser also canonicalises file://C:/x to a local drive.
    try { const h = new URL(u).hostname; return !!h && h !== 'localhost'; } catch (_) { return false; }
}

/**
 * Loads a script once and resolves when it has run. `module` loads an ES module
 * (Monaco's bundle); plain UMD libraries (xterm, marked, DOMPurify, gsap) set
 * their window global since no AMD loader is present.
 * @param {string} src
 * @param {{ module?: boolean }} [opts]
 * @returns {Promise<void>}
 */
const __scriptLoads = new Map();
function loadScript(src, opts = {}) {
    if (!__scriptLoads.has(src)) {
        __scriptLoads.set(src, new Promise((resolve, reject) => {
            const el = document.createElement('script');
            if (opts.module) el.type = 'module';
            el.src = src;
            el.onload = () => resolve();
            el.onerror = () => {
                __scriptLoads.delete(src);   // let a later call retry
                el.remove();
                reject(new Error(`failed to load ${src}`));
            };
            document.head.appendChild(el);
        }));
    }
    return __scriptLoads.get(src);
}
