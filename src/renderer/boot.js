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
