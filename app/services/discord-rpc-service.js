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
        console.log('[Discord RPC] Could not connect (Discord might not be running):', error.message);
        isConnected = false;
        rpcClient = null;
        if (isEnabled) scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (isDestroyed || !isEnabled) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(() => {
        if (!isDestroyed && !isConnected && isEnabled) {
            console.log('[Discord RPC] Attempting to reconnect...');
            connect();
        }
    }, 15000);
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
