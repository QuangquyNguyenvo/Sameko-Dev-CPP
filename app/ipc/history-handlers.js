/**
 * Sameko Dev C++ IDE - History IPC Handlers
 * Local history: a snapshot of a file is stored before every save, under
 * userData/local-history/<sha256 of the path>/<timestamp>.snapshot.
 * @module app/ipc/history-handlers
 */

'use strict';

const { ipcMain, app } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fsp = require('fs').promises;

const historyDir = path.join(app.getPath('userData'), 'local-history');

/**
 * @param {string} filePath - Absolute file path
 * @returns {string} History folder for the file
 */
function getHistoryDirForFile(filePath) {
    const hash = crypto.createHash('sha256').update(filePath).digest('hex');
    return path.join(historyDir, hash);
}

/**
 * Snapshots of a file, newest first.
 * @param {string} filePath
 * @returns {Promise<Array<{timestamp: string, filename: string, path: string, size: number}>>}
 */
async function getFileHistory(filePath) {
    const dir = getHistoryDirForFile(filePath);
    let names;
    try {
        names = await fsp.readdir(dir);
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('[History] Failed to list history:', error.message);
        return [];
    }
    const entries = await Promise.all(names
        .filter((f) => f.endsWith('.snapshot'))
        .map(async (f) => {
            const full = path.join(dir, f);
            try {
                const { size } = await fsp.stat(full);
                return { timestamp: f.replace('.snapshot', ''), filename: f, path: full, size };
            } catch (_) {
                return null;
            }
        }));
    return entries.filter(Boolean).sort((a, b) => parseInt(b.timestamp, 10) - parseInt(a.timestamp, 10));
}

/**
 * Keep only the newest `maxSnapshots` snapshots of a file.
 */
async function cleanupOldSnapshots(filePath, maxSnapshots) {
    const history = await getFileHistory(filePath);
    await Promise.all(history.slice(maxSnapshots).map((entry) => fsp.unlink(entry.path).catch(() => { })));
}

// "Delete After (days)" from Settings, sent with every backup.
let retentionDays = 7;
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Delete snapshots older than the retention period, across all files, and
 * remove folders left empty. Runs at most once every few hours.
 */
async function pruneExpiredHistory() {
    const now = Date.now();
    if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
    lastPruneAt = now;
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    try {
        for (const dir of await fsp.readdir(historyDir, { withFileTypes: true })) {
            if (!dir.isDirectory()) continue;
            const full = path.join(historyDir, dir.name);
            let remaining = 0;
            for (const name of await fsp.readdir(full)) {
                const ts = parseInt(name, 10);
                if (name.endsWith('.snapshot') && Number.isFinite(ts) && ts < cutoff) {
                    try { await fsp.unlink(path.join(full, name)); continue; } catch (_) { }
                }
                remaining++;
            }
            if (remaining === 0) await fsp.rmdir(full).catch(() => { });
        }
    } catch (error) {
        console.error('[History] Failed to prune old snapshots:', error.message);
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when `p` is a snapshot file inside the history folder. */
function isSnapshotPath(p) {
    if (typeof p !== 'string' || !p.endsWith('.snapshot')) return false;
    const rel = path.relative(historyDir, path.resolve(p));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Register all history-related IPC handlers
 */
function registerHistoryHandlers() {
    fsp.mkdir(historyDir, { recursive: true }).catch(() => { });

    // Request: { filePath, content, maxVersions?, maxAgeDays? }
    ipcMain.handle('create-history-backup', async (event, { filePath, content, maxVersions, maxAgeDays }) => {
        try {
            if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) retentionDays = maxAgeDays;
            const ts = Date.now().toString();
            const dir = getHistoryDirForFile(filePath);
            const backupPath = path.join(dir, `${ts}.snapshot`);
            await fsp.mkdir(dir, { recursive: true });
            await fsp.writeFile(backupPath, content, 'utf-8');
            await cleanupOldSnapshots(filePath, maxVersions || 20);
            pruneExpiredHistory();
            return { success: true, timestamp: ts, backupPath };
        } catch (error) {
            console.error('[History] Backup failed:', error.message);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-file-history', async (event, filePath) => {
        const history = await getFileHistory(filePath);
        return {
            success: true,
            entries: history.map((h) => ({
                timestamp: h.timestamp,
                filename: h.filename,
                path: h.path,
                size: formatSize(h.size),
                formattedTime: new Date(parseInt(h.timestamp, 10)).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                })
            }))
        };
    });

    // Only snapshot files can be read through this channel, not arbitrary paths.
    ipcMain.handle('get-history-content', async (event, backupPath) => {
        if (!isSnapshotPath(backupPath)) return { success: false, error: 'Not a history snapshot' };
        try {
            return { success: true, content: await fsp.readFile(backupPath, 'utf-8') };
        } catch (error) {
            return { success: false, error: error.code === 'ENOENT' ? 'Backup file not found' : error.message };
        }
    });

    ipcMain.handle('clear-file-history', async (event, filePath) => {
        try {
            await fsp.rm(getHistoryDirForFile(filePath), { recursive: true, force: true });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    registerHistoryHandlers,
};
