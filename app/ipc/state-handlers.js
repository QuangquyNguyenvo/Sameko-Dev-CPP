/**
 * Sameko Dev C++ IDE - Renderer State IPC Handlers
 *
 * Small JSON documents the renderer needs to survive a restart (session
 * checkpoint, checkpoints of untitled tabs) and binary theme assets. They used
 * to live in localStorage, which has a fixed quota: once a large background
 * image or many untitled checkpoints filled it, every later write — including
 * the session checkpoint — failed silently.
 *
 * Layout under userData:
 *   state/<name>.json          one document per name
 *   theme-assets/<sha1>.<ext>  images/videos picked as theme backgrounds
 *
 * @module app/ipc/state-handlers
 */

'use strict';

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const url = require('url');

const stateDir = () => path.join(app.getPath('userData'), 'state');
const assetDir = () => path.join(app.getPath('userData'), 'theme-assets');

const NAME_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const ASSET_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
    'video/webm': 'webm', 'video/mp4': 'mp4',
};

function fileFor(name) {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('Invalid state name');
    return path.join(stateDir(), name + '.json');
}

async function readState(name) {
    const file = fileFor(name);
    try {
        return JSON.parse(await fsp.readFile(file, 'utf-8'));
    } catch (error) {
        if (error.code !== 'ENOENT') console.error(`[State] Failed to read ${name}:`, error.message);
        return null;
    }
}

// Writes are atomic (temp file + rename), so a crash mid-save leaves the
// previous document intact. The temp file is written asynchronously; the
// rename is synchronous and skipped when a newer write of the same document
// already landed, so a slow async save can never overwrite the synchronous
// one made while the window closes.
let writeSeq = 0;
const committedSeq = new Map();

function commitState(file, tmp, seq) {
    if ((committedSeq.get(file) || 0) > seq) {
        fs.rmSync(tmp, { force: true });
        return;
    }
    fs.renameSync(tmp, file);
    committedSeq.set(file, seq);
}

async function writeState(name, data) {
    const file = fileFor(name);
    const seq = ++writeSeq;
    const tmp = `${file}.${seq}.tmp`;
    const json = JSON.stringify(data);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, json, 'utf-8');
    commitState(file, tmp, seq);
}

function writeStateSync(name, data) {
    const file = fileFor(name);
    const seq = ++writeSeq;
    const tmp = `${file}.${seq}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    commitState(file, tmp, seq);
}

async function deleteState(name) {
    await fsp.rm(fileFor(name), { force: true });
}

/**
 * Store a `data:` URL as a file and return a file:// URL for it. The file name
 * is the content hash, so saving the same image twice costs nothing.
 */
async function saveThemeAsset(dataUrl) {
    const m = /^data:([a-z0-9.+/-]+);base64,(.*)$/is.exec(String(dataUrl || ''));
    if (!m) throw new Error('Not a base64 data URL');
    const ext = ASSET_EXT[m[1].toLowerCase()];
    if (!ext) throw new Error('Unsupported asset type: ' + m[1]);
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > MAX_ASSET_BYTES) throw new Error('Asset too large');
    const dir = assetDir();
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, crypto.createHash('sha1').update(bytes).digest('hex') + '.' + ext);
    if (!fs.existsSync(file)) await fsp.writeFile(file, bytes);
    return url.pathToFileURL(file).href;
}

/**
 * Drop checkpoints of untitled tabs that no session will ever ask for again,
 * and temp files left by a crash in the middle of a save.
 */
async function sweepStaleState() {
    const dir = stateDir();
    let names;
    try { names = await fsp.readdir(dir); } catch (_) { return; }
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const name of names) {
        const full = path.join(dir, name);
        if (name.endsWith('.tmp')) { await fsp.rm(full, { force: true }).catch(() => { }); continue; }
        if (!/^untitled-.*\.json$/.test(name)) continue;
        try { if ((await fsp.stat(full)).mtimeMs < cutoff) await fsp.unlink(full); } catch (_) { }
    }
}

function registerHandlers() {
    sweepStaleState();

    ipcMain.handle('state-read', async (event, name) => readState(name));

    ipcMain.handle('state-write', async (event, { name, data }) => {
        try {
            await writeState(name, data);
            return { success: true };
        } catch (error) {
            console.error(`[State] Failed to write ${name}:`, error.message);
            return { success: false, error: error.message };
        }
    });

    // Synchronous variant for the one save that happens while the window is
    // closing, when an async reply would arrive too late.
    ipcMain.on('state-write-sync', (event, { name, data }) => {
        try {
            writeStateSync(name, data);
            event.returnValue = true;
        } catch (error) {
            console.error(`[State] Failed to write ${name}:`, error.message);
            event.returnValue = false;
        }
    });

    ipcMain.handle('state-delete', async (event, name) => {
        try { await deleteState(name); } catch (_) { }
        return { success: true };
    });

    ipcMain.handle('theme-asset-save', async (event, dataUrl) => {
        try {
            return { success: true, url: await saveThemeAsset(dataUrl) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

module.exports = { registerHandlers };
