/**
 * Sameko Dev C++ IDE - Main-process Settings Reader
 * Small helper so main-process services (clangd, gcc-checker) can read the
 * user's compiler settings without going through IPC.
 * @module app/shared/settings-reader
 */

'use strict';

const { readSettings } = require('./settings-store');

/**
 * Read raw settings.json (main-process side, same file written by
 * app/ipc/settings-handlers.js).
 * @returns {object|null}
 */
function readUserSettings() {
    try {
        return readSettings();
    } catch (e) { }
    return null;
}

/**
 * Get the compiler-related settings that affect flags.
 * cppStandard is returned as-is (may be '' meaning "IDE default" — the
 * caller decides what that default dialect is), matching the shape of
 * src/renderer/app/core.js DEFAULT_SETTINGS.compiler.
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
