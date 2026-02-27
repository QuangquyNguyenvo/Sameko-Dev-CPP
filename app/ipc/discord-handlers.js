'use strict';

const { ipcMain } = require('electron');
const discordRPC = require('../services/discord-rpc-service');

function registerHandlers() {
    ipcMain.handle('discord-update-presence', async (event, data) => {
        const { fileName, workspaceName, line, col } = data || {};
        await discordRPC.updatePresence(fileName, workspaceName, line, col);
        return { success: true };
    });

    ipcMain.handle('discord-clear-presence', async () => {
        await discordRPC.clearPresence();
        return { success: true };
    });

    ipcMain.handle('discord-get-status', async () => {
        return { connected: discordRPC.isRpcConnected(), enabled: discordRPC.isRpcEnabled() };
    });

    ipcMain.handle('discord-enable', async () => {
        await discordRPC.enable();
        return { success: true };
    });

    ipcMain.handle('discord-disable', async () => {
        await discordRPC.disable();
        return { success: true };
    });
}

module.exports = { registerHandlers };
