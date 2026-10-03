/**
 * Sameko Dev C++ IDE - Syntax Services Index
 * Live diagnostics (clangd, with a g++ fallback) and the clangd bridge
 * @module app/services/syntax
 */

'use strict';

const gccChecker = require('./gcc-checker');
const clangdService = require('./clangd-service');

// Initialize Clangd IntelliSense service at startup
clangdService.init();

/**
 * Diagnostics for the live check.
 *
 * @param {string} content - Source code
 * @param {string} [filePath] - Saved path (null for an untitled tab)
 * @param {string} [docId] - Stable id of the tab, used when there is no path
 * @returns {Promise<{success: boolean, diagnostics: Array, source?: string}>}
 */
async function checkSyntax(content, filePath = null, docId = null) {
    // Preferred: clangd already parses the open document for completions, so
    // its diagnostics are free. Fall back to g++ -fsyntax-only only when
    // clangd is not running or does not answer.
    if (clangdService.isAvailable()) {
        try {
            const diagnostics = await clangdService.getDiagnostics(filePath || docId || 'live-check', content);
            if (diagnostics) {
                return { success: diagnostics.length === 0, diagnostics, source: 'clangd' };
            }
        } catch (err) {
            console.error('[Syntax] clangd diagnostics failed, using g++:', err && err.message);
        }
    }

    let diagnostics = [];
    try {
        diagnostics = await gccChecker.checkSyntax(content, filePath);
    } catch (err) {
        console.error('[Syntax] GCC checkSyntax error:', err);
    }
    if (!Array.isArray(diagnostics)) diagnostics = [];

    return {
        success: diagnostics.length === 0,
        diagnostics
    };
}

module.exports = {
    checkSyntax,

    // GCC
    checkSyntaxGcc: gccChecker.checkSyntax,
    parseGccOutput: gccChecker.parseGccOutput,
    cancelSyntaxCheck: gccChecker.cancelSyntaxCheck,

    // Clangd LSP
    initClangd: clangdService.init,
    getClangdCompletions: clangdService.getCompletions,
    getClangdHover: clangdService.getHover,
    closeClangdDocument: clangdService.closeDocument,
    shutdownClangd: clangdService.shutdown,
    isClangdAvailable: clangdService.isAvailable,
    onClangdSettingsChanged: clangdService.onSettingsChanged,
};
