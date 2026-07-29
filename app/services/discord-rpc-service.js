'use strict';

const DiscordRPC = require('discord-rpc');
const path = require('path');

const CLIENT_ID = '1476184013742805105';

let rpcClient = null;
let isConnected = false;
let isEnabled = true;
let startTimestamp = null;
let currentPresence = {};
let reconnectTimer = null;
let isDestroyed = false;
let reconnectAttempts = 0;
let hasLoggedConnectFailure = false;

// Discord simply is not installed on most Linux desktops, so a fixed 15 s retry
// meant an endless connect-and-log loop for the whole session. Back off instead,
// but never give up entirely — the user may start Discord after the IDE.
const RECONNECT_DELAYS_MS = [15000, 30000, 60000, 120000, 300000];

const FILE_ICONS = {
    '.cpp': 'cpp',
    '.c': 'c_lang',
    '.h': 'header',
    '.hpp': 'header',
    '.txt': 'text',
    '.json': 'json',
    '.md': 'markdown',
};

function getFileIcon(fileName) {
    if (!fileName) return 'sameko_icon';
    const ext = path.extname(fileName).toLowerCase();
    return FILE_ICONS[ext] || 'sameko_icon';
}

function getFileTypeText(fileName) {
    if (!fileName) return 'Idle';
    const ext = path.extname(fileName).toLowerCase();
    const types = {
        '.cpp': 'C++ Source File',
        '.c': 'C Source File',
        '.h': 'C/C++ Header',
        '.hpp': 'C++ Header',
        '.txt': 'Text File',
        '.json': 'JSON File',
        '.md': 'Markdown File',
    };
    return types[ext] || 'File';
}

async function connect() {
    if (isDestroyed || !isEnabled) return;
    if (isConnected && rpcClient) return;

    try {
        rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

        rpcClient.on('ready', () => {
            console.log('[Discord RPC] Connected successfully!');
            isConnected = true;
            reconnectAttempts = 0;
            hasLoggedConnectFailure = false;
            if (!startTimestamp) startTimestamp = new Date();
            updatePresence(
                currentPresence.fileName,
                currentPresence.workspaceName,
                currentPresence.line,
                currentPresence.col
            );
        });

        rpcClient.on('disconnected', () => {
            console.log('[Discord RPC] Disconnected');
            isConnected = false;
            rpcClient = null;
            if (isEnabled) scheduleReconnect();
        });

        await rpcClient.login({ clientId: CLIENT_ID });
    } catch (error) {
        // Only the first failure is worth a line; after that it is just noise.
        if (!hasLoggedConnectFailure) {
            console.log('[Discord RPC] Could not connect (Discord might not be running):', error.message);
            hasLoggedConnectFailure = true;
        }
        isConnected = false;
        rpcClient = null;
        if (isEnabled) scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (isDestroyed || !isEnabled) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    const idx = Math.min(reconnectAttempts, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[idx];
    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
        if (!isDestroyed && !isConnected && isEnabled) {
            connect();
        }
    }, delay);
}

async function updatePresence(fileName, workspaceName, line, col) {
    currentPresence = { fileName, workspaceName, line, col };

    if (!isEnabled || !isConnected || !rpcClient) return;

    try {
        const activity = {
            largeImageKey: 'sameko_icon',
            largeImageText: 'Sameko Dev C++',
            // instance: true gives higher priority over other RPC apps (e.g. VS Code extension)
            instance: true,
        };

        if (fileName) {
            // "Working on filename — Ln X, Col Y" style (like VS Code status bar)
            const posLabel = (line && col) ? ` — Ln ${line}, Col ${col}` : '';
            activity.details = `Working on ${fileName}`;
            activity.state = workspaceName
                ? `In ${workspaceName}${posLabel}`
                : `Sameko Dev C++${posLabel}`;
            activity.smallImageKey = getFileIcon(fileName);
            activity.smallImageText = getFileTypeText(fileName);
        } else {
            activity.details = 'Idle';
            activity.state = 'Sameko Dev C++';
        }

        if (startTimestamp) {
            activity.startTimestamp = startTimestamp;
        }

        await rpcClient.setActivity(activity);
        console.log('[Discord RPC] Presence updated:', activity.details);
    } catch (error) {
        console.error('[Discord RPC] Failed to update presence:', error.message);
    }
}

async function clearPresence() {
    if (!isConnected || !rpcClient) return;

    try {
        await rpcClient.clearActivity();
        console.log('[Discord RPC] Presence cleared');
    } catch (error) {
        console.error('[Discord RPC] Failed to clear presence:', error.message);
    }
}

/**
 * Enable Discord RPC — connects if not already connected
 */
async function enable() {
    isEnabled = true;
    // Turning the feature back on is an explicit user action: start the backoff
    // from scratch instead of inheriting a 5-minute wait from an earlier session.
    reconnectAttempts = 0;
    hasLoggedConnectFailure = false;
    startTimestamp = new Date();
    await connect();
    console.log('[Discord RPC] Enabled');
}

/**
 * Disable Discord RPC — disconnects and clears presence
 */
async function disable() {
    isEnabled = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    await clearPresence();
    if (rpcClient) {
        try {
            await rpcClient.destroy();
        } catch (e) { /* ignore */ }
        rpcClient = null;
        isConnected = false;
    }
    console.log('[Discord RPC] Disabled');
}

async function destroy() {
    isDestroyed = true;
    isEnabled = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (rpcClient) {
        try {
            // Clear presence FIRST so Discord removes the status immediately
            await rpcClient.clearActivity();
        } catch (e) { }
        try {
            await rpcClient.destroy();
        } catch (e) { }
        rpcClient = null;
        isConnected = false;
    }
    console.log('[Discord RPC] Service destroyed');
}

function isRpcConnected() {
    return isConnected;
}

function isRpcEnabled() {
    return isEnabled;
}

module.exports = {
    connect,
    updatePresence,
    clearPresence,
    enable,
    disable,
    destroy,
    isRpcConnected,
    isRpcEnabled,
};
