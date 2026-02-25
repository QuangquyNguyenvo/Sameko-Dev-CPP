'use strict';

const { ipcMain } = require('electron');
const discordRPC = require('../services/discord-rpc-service');

function registerHandlers() {
    ipcMain.handle('discord-update-presence', async (event, data) => {
        const { fileName, workspaceName } = data || {};
        await discordRPC.updatePresence(fileName, workspaceName);
        return { success: true };
    });

    ipcMain.handle('discord-clear-presence', async () => {
        await discordRPC.clearPresence();
        return { success: true };
    });

    ipcMain.handle('discord-get-status', async () => {
        return { connected: discordRPC.isRpcConnected() };
    });
}

module.exports = { registerHandlers };
