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

function registerAllHandlers(mainWindow) {
    fileHandlers.setMainWindow(mainWindow);
    compilerHandlers.setMainWindow(mainWindow);
    dialogHandlers.setMainWindow(mainWindow);
    competitiveHandlers.setMainWindow(mainWindow);
    debugHandlers.setMainWindow(mainWindow);

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
}

module.exports = registerAllHandlers;

