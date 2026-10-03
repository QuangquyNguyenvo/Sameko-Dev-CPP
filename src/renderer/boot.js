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
    console.error('[UNHANDLED REJECTION]', event.reason);
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

// Monaco's AMD loader reads this global when vs/loader.js runs. It must be a
// `var` at script top level so it becomes window.require.
// eslint-disable-next-line no-var
var require = { paths: { vs: '../node_modules/monaco-editor/min/vs' } };
