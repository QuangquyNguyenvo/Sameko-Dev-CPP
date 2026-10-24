/**
 * Sameko Dev C++ IDE - Replace a file without ever leaving it half-written.
 *
 * writeFile() truncates the old file before the new bytes are on disk, so a full
 * disk or a crash in between left a source file or a .sameko cut short. These
 * helpers write a temp file next to the target and rename it over the target:
 * the rename either happens completely or not at all.
 *
 * Symlinks are followed (the link itself stays a link) and POSIX permission bits
 * are kept. When the target cannot be replaced (Windows: another program has it
 * open without share-delete; a folder that allows writing the file but not
 * creating one) the file is written in place, as before.
 *
 * @module app/shared/fs-atomic
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const IN_PLACE_FALLBACK = new Set(['EPERM', 'EACCES', 'EBUSY', 'EXDEV', 'ENOTSUP', 'EINVAL', 'EISDIR']);

function tempNameFor(target) {
    const tag = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    return path.join(path.dirname(target), `.${path.basename(target)}.${tag}.tmp`);
}

/**
 * The real file behind a path, its POSIX mode (undefined on Windows) and whether
 * it exists. An existing file must be writable: rename() would replace a
 * read-only file whenever its folder is writable (Linux), where writeFile()
 * refused to.
 */
async function resolveTarget(filePath) {
    let target, st;
    try {
        target = await fsp.realpath(filePath);
        st = await fsp.stat(target);
    } catch (_) {
        return { target: filePath, mode: undefined };
    }
    await fsp.access(target, fs.constants.W_OK);
    return { target, mode: IS_WIN ? undefined : (st.mode & 0o7777) };
}

function resolveTargetSync(filePath) {
    let target, st;
    try {
        target = fs.realpathSync(filePath);
        st = fs.statSync(target);
    } catch (_) {
        return { target: filePath, mode: undefined };
    }
    fs.accessSync(target, fs.constants.W_OK);
    return { target, mode: IS_WIN ? undefined : (st.mode & 0o7777) };
}

/**
 * @param {string} filePath
 * @param {string|Buffer} data
 * @param {BufferEncoding} [encoding]
 */
async function writeFileAtomic(filePath, data, encoding = 'utf-8') {
    const { target, mode } = await resolveTarget(filePath);
    const tmp = tempNameFor(target);
    try {
        await fsp.writeFile(tmp, data, { encoding });
        if (mode !== undefined) await fsp.chmod(tmp, mode);
        await fsp.rename(tmp, target);
    } catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => { });
        if (!IN_PLACE_FALLBACK.has(error.code)) throw error;
        await fsp.writeFile(target, data, { encoding });
    }
}

/** Synchronous form of writeFileAtomic(), for saves that must finish before quitting. */
function writeFileAtomicSync(filePath, data, encoding = 'utf-8') {
    const { target, mode } = resolveTargetSync(filePath);
    const tmp = tempNameFor(target);
    try {
        fs.writeFileSync(tmp, data, { encoding });
        if (mode !== undefined) fs.chmodSync(tmp, mode);
        fs.renameSync(tmp, target);
    } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch (_) { }
        if (!IN_PLACE_FALLBACK.has(error.code)) throw error;
        fs.writeFileSync(target, data, { encoding });
    }
}

module.exports = { writeFileAtomic, writeFileAtomicSync };
