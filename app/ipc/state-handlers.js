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
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const url = require('url');
const { IPC } = require('../shared/constants');

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
// Temp files carry a tag unique to this run: the startup sweep removes only
// other runs' (a crash's leftovers), never a save of this run still in flight.
const RUN_TAG = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

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
    const tmp = `${file}.${RUN_TAG}.${seq}.tmp`;
    const json = JSON.stringify(data);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, json, 'utf-8');
    commitState(file, tmp, seq);
}

function writeStateSync(name, data) {
    const file = fileFor(name);
    const seq = ++writeSeq;
    const tmp = `${file}.${RUN_TAG}.${seq}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    commitState(file, tmp, seq);
}

// A delete is ordered like a write: an older write still in flight is dropped
// when it lands, and a newer write recreates the document. Synchronous, so a
// pending delete can never remove a save made after it.
function deleteState(name) {
    const file = fileFor(name);
    committedSeq.set(file, ++writeSeq);
    fs.rmSync(file, { force: true });
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

// Picked by path, so large wallpaper videos never pass through IPC as base64.
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const EXT_ASSET = {};
for (const ext of Object.values(ASSET_EXT)) EXT_ASSET['.' + ext] = ext;
EXT_ASSET['.jpeg'] = 'jpg';

/** Local absolute path, or null for network paths, devices and URLs (mirrors app-protocol localFile). */
function localAssetPath(p) {
    if (typeof p !== 'string' || !p || p.includes('\0')) return null;
    let file = p;
    if (process.platform === 'win32') {
        // \\.\ is a device; \\?\C:\x is a plain path, \\?\UNC\srv\x a network one.
        if (/^[\\/]{2}\.[\\/]/.test(file)) return null;
        const ext = /^[\\/]{2}\?[\\/](UNC[\\/])?(.*)$/i.exec(file);
        if (ext) file = (ext[1] ? '\\\\' : '') + ext[2];
    }
    // Network paths (\\server\share, //server/x): opening one sends NTLM credentials.
    if (/^[\\/]{2}/.test(file)) return null;
    // URLs (file:, http:, ...) — a Windows drive letter is a single character.
    if (/^[a-z][a-z0-9+.-]+:/i.test(file)) return null;
    if (!path.isAbsolute(file)) return null;
    return path.resolve(file);
}

/**
 * Copy a local image/video into theme-assets under its content hash and
 * return a file:// URL for it, like saveThemeAsset. The hash is streamed.
 */
async function importThemeAsset(filePath) {
    const file = localAssetPath(filePath);
    if (!file) throw new Error('Not a local file path');
    const ext = EXT_ASSET[path.extname(file).toLowerCase()];
    if (!ext) throw new Error('Unsupported asset type: ' + path.extname(file));
    // A symlink to \\server\share\x.png passes the check above; opening it would still send
    // NTLM credentials to that server.
    const link = await fsp.lstat(file);
    if (link.isSymbolicLink()) {
        const target = await fsp.readlink(file);
        if (!localAssetPath(path.resolve(path.dirname(file), target))) throw new Error('Not a local file path');
    }
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new Error('Not a regular file');
    if (st.size > MAX_IMPORT_BYTES) throw new Error('Asset too large');

    const dir = assetDir();
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `import-${RUN_TAG}-${++writeSeq}.tmp`);
    const hash = crypto.createHash('sha1');
    try {
        // Hash while copying: one read of the source, and the copy is exactly the hashed bytes.
        // pipeline() closes both files on an error, so the temp file can be removed.
        const src = fs.createReadStream(file);
        src.on('data', (chunk) => hash.update(chunk));
        await pipeline(src, fs.createWriteStream(tmp));
        const target = path.join(dir, hash.digest('hex') + '.' + ext);
        if (fs.existsSync(target)) await fsp.rm(tmp, { force: true });
        else await fsp.rename(tmp, target);
        return url.pathToFileURL(target).href;
    } catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => { });
        throw error;
    }
}

/**
 * Drop checkpoints of untitled tabs that no session will ever ask for again,
 * and temp files left by a crash in the middle of a save.
 */
async function sweepStaleState() {
    const dir = stateDir();
    // An import cut short by a crash leaves a copy of up to 512 MB in theme-assets.
    try {
        for (const name of await fsp.readdir(assetDir())) {
            if (/^import-.*\.tmp$/.test(name) && !name.startsWith(`import-${RUN_TAG}-`)) {
                await fsp.rm(path.join(assetDir(), name), { force: true }).catch(() => { });
            }
        }
    } catch (_) { }
    let names;
    try { names = await fsp.readdir(dir); } catch (_) { return; }
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const name of names) {
        const full = path.join(dir, name);
        if (name.endsWith('.tmp')) {
            if (!name.includes(`.${RUN_TAG}.`)) await fsp.rm(full, { force: true }).catch(() => { });
            continue;
        }
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

    ipcMain.handle(IPC.THEME.ASSET_IMPORT, async (event, filePath) => {
        try {
            return { success: true, url: await importThemeAsset(filePath) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

module.exports = { registerHandlers };
