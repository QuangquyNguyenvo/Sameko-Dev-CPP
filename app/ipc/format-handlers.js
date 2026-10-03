/**
 * Sameko Dev C++ IDE - Format IPC Handlers
 * Handles code formatting and syntax checking
 * @module app/ipc/format-handlers
 */

'use strict';

const { ipcMain } = require('electron');
const { IPC } = require('../shared/constants');
const formatter = require('../services/formatter');
const syntax = require('../services/syntax');

/**
 * Register all format-related IPC handlers
 */
function registerHandlers() {
    // Format code
    ipcMain.handle(IPC.FORMAT.CODE, async (event, { code, style = 'google' }) => {
        return await formatter.formatCode(code, style);
    });

    // Syntax check
    ipcMain.handle(IPC.FORMAT.SYNTAX_CHECK, async (event, { content, filePath, docId }) => {
        return await syntax.checkSyntax(content, filePath, docId);
    });

    // Clangd completions
    ipcMain.handle(IPC.FORMAT.CLANGD_COMPLETIONS, async (event, { filePath, content, line, character }) => {
        return syntax.getClangdCompletions(filePath, content, line, character);
    });

    // Clangd: a tab was closed
    ipcMain.handle('clangd-close-document', async (event, filePath) => {
        syntax.closeClangdDocument(filePath);
        return { success: true };
    });

    // Clangd hover
    ipcMain.handle(IPC.FORMAT.CLANGD_HOVER, async (event, { filePath, content, line, character }) => {
        return syntax.getClangdHover(filePath, content, line, character);
    });
}

module.exports = {
    registerHandlers,
};
