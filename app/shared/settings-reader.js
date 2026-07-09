/**
 * Sameko Dev C++ IDE - Main-process Settings Reader
 * Small helper so main-process services (clangd, gcc-checker) can read the
 * user's compiler settings without going through IPC.
 * @module app/shared/settings-reader
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Read raw settings.json (main-process side, same file written by
 * app/ipc/settings-handlers.js).
 * @returns {object|null}
 */
function readUserSettings() {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
    } catch (e) { }
    return null;
}

/**
 * Get the compiler-related settings that affect flags.
 * cppStandard is returned as-is (may be '' meaning "IDE default" — the
 * caller decides what that default dialect is), matching the shape of
 * src/renderer/app.js DEFAULT_SETTINGS.compiler.
 * @returns {{cppStandard: string, extraFlags: string}}
 */
function getCompilerSettings() {
    const settings = readUserSettings();
    const compiler = (settings && settings.compiler) || {};
    return {
        cppStandard: compiler.cppStandard || '',
        extraFlags: typeof compiler.extraFlags === 'string' ? compiler.extraFlags.trim() : ''
    };
}

module.exports = { readUserSettings, getCompilerSettings };
