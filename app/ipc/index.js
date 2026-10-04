'use strict';

const fileHandlers = require('./file-handlers');
const compilerHandlers = require('./compiler-handlers');
const dialogHandlers = require('./dialog-handlers');
const windowHandlers = require('./window-handlers');
const settingsHandlers = require('./settings-handlers');
const formatHandlers = require('./format-handlers');
const competitiveHandlers = require('./competitive-handlers');
const updateHandlers = require('./update-handlers');
const historyHandlers = require('./history-handlers');
const discordHandlers = require('./discord-handlers');
const debugHandlers = require('./debug-handlers');
const stateHandlers = require('./state-handlers');

function registerAllHandlers(mainWindow) {
    fileHandlers.setMainWindow(mainWindow);
    compilerHandlers.setMainWindow(mainWindow);
    dialogHandlers.setMainWindow(mainWindow);
    competitiveHandlers.setMainWindow(mainWindow);
    debugHandlers.setMainWindow(mainWindow);

    // compile() writes the editor's text to the source file when it differs from
    // disk; record that as our own write so the watcher does not offer a reload.
    require('../services/compiler').setFileWatcherCallback(fileHandlers.updateFileWatcherMtime);

    fileHandlers.registerHandlers();
    compilerHandlers.registerHandlers();
    dialogHandlers.registerHandlers();
    windowHandlers.registerHandlers();
    settingsHandlers.registerHandlers();
    formatHandlers.registerHandlers();
    competitiveHandlers.registerHandlers();
    updateHandlers();
    historyHandlers.registerHistoryHandlers();
    discordHandlers.registerHandlers();
    debugHandlers.registerHandlers();
    stateHandlers.registerHandlers();
}

module.exports = registerAllHandlers;

