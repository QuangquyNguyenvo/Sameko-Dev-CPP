/**
 * Sameko Dev C++ IDE - settings.json store (MAIN PROCESS ONLY)
 *
 * The one place that reads and writes `userData/settings.json`. Two writers
 * used to rewrite the whole file independently — the renderer (all settings)
 * and the window manager (window bounds) — so each could overwrite the other's
 * newer data, and a crash in the middle of `writeFileSync` left a truncated
 * file that was then read as "no settings" and silently reset everything.
 *
 * Writes go to a temp file that is renamed over the real one (atomic on the
 * same volume), and the previous good file is kept as `settings.json.bak` and
 * used when the main file cannot be parsed.
 *
 * @module app/shared/settings-store
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/** Keys owned by the main process; a save coming from the renderer never replaces them. */
const MAIN_OWNED_KEYS = ['windowBounds'];

function settingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function readJson(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
}

/**
 * Read settings.json, falling back to the backup when it is missing or corrupt.
 * @returns {object|null} null when there are no settings yet
 */
function readSettings() {
    const file = settingsPath();
    for (const candidate of [file, file + '.bak']) {
        try {
            if (!fs.existsSync(candidate)) continue;
            const data = readJson(candidate);
            if (data) {
                if (candidate !== file) console.warn('[Settings] settings.json unreadable, restored from backup');
                return data;
            }
        } catch (error) {
            console.error(`[Settings] Failed to read ${path.basename(candidate)}:`, error.message);
        }
    }
    return null;
}

/** Write the whole settings object atomically, keeping a backup of the last good file. */
function writeSettings(settings) {
    const file = settingsPath();
    const tmp = file + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8');
    try {
        // Only a file that still parses is worth keeping as the backup.
        if (fs.existsSync(file) && readJson(file)) fs.copyFileSync(file, file + '.bak');
    } catch (_) { /* current file is corrupt — keep the older backup */ }
    fs.renameSync(tmp, file);
}

/**
 * Save the settings object sent by the renderer, preserving main-owned keys.
 * @param {object} settings
 */
function saveRendererSettings(settings) {
    const current = readSettings() || {};
    const next = { ...(settings && typeof settings === 'object' ? settings : {}) };
    for (const key of MAIN_OWNED_KEYS) {
        if (current[key] !== undefined) next[key] = current[key];
        else delete next[key];
    }
    writeSettings(next);
}

/**
 * Read-modify-write a few top-level keys (used by the main process).
 * @param {(settings: object) => void} mutate
 */
function updateSettings(mutate) {
    const current = readSettings() || {};
    mutate(current);
    writeSettings(current);
}

module.exports = { settingsPath, readSettings, writeSettings, saveRendererSettings, updateSettings };
