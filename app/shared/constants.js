/**
 * Sameko Dev C++ IDE - Shared Constants (main process)
 *
 * Channel names used by the handlers in app/ipc/. `preload.js` runs sandboxed
 * and cannot import this file, so it repeats the literal strings — keep the two
 * in step (plans/code-audit/tools/ipc-check.js verifies). Channels registered
 * with a literal string in their handler file are not listed here.
 *
 * @module shared/constants
 */

'use strict';

/**
 * IPC Channel names for inter-process communication
 * Group by feature area for easier navigation
 */
const IPC = {
    // File Operations
    FILE: {
        OPEN_DIALOG: 'open-file-dialog',
        SAVE: 'save-file',
        SAVE_DIALOG: 'save-file-dialog',
        READ: 'read-file',
        READ_DIR: 'read-directory',
        DELETE: 'delete-file',
        RENAME: 'rename-file',
        WATCH: 'watch-file',
        UNWATCH: 'unwatch-file',
        RELOAD: 'reload-file',
        SHOW_IN_FOLDER: 'show-item-in-folder',
    },

    // Compiler & Build
    COMPILER: {
        COMPILE: 'compile',
        RUN: 'run',
        STOP: 'stop-process',
        SEND_INPUT: 'send-input',
        SEND_INPUT_FILE: 'send-input-file',
        INPUT_FILE_INFO: 'input-file-info',
    },

    // Debugger (GDB/MI)
    DEBUG: {
        START: 'debug:start',
        STOP: 'debug:stop',
        SET_BREAKPOINT: 'debug:setBreakpoint',
        REMOVE_BREAKPOINT: 'debug:removeBreakpoint',
        ENABLE_BREAKPOINT: 'debug:enableBreakpoint',
        DISABLE_BREAKPOINT: 'debug:disableBreakpoint',
        RUN_TO_LINE: 'debug:runToLine',
        VAR_SET_FORMAT: 'debug:varSetFormat',
        CONTINUE: 'debug:continue',
        INTERRUPT: 'debug:interrupt',
        STEP_OVER: 'debug:stepOver',
        STEP_INTO: 'debug:stepInto',
        STEP_OUT: 'debug:stepOut',
        SELECT_FRAME: 'debug:selectFrame',
        EVALUATE: 'debug:evaluate',
        VAR_CHILDREN: 'debug:varChildren',
        VAR_UPDATE: 'debug:varUpdate',
        VAR_CREATE_MANY: 'debug:varCreateMany',
        VAR_DELETE_MANY: 'debug:varDeleteMany',
    },

    // Window Management
    WINDOW: {
        MINIMIZE: 'window-minimize',
        MAXIMIZE: 'window-maximize',
        CLOSE: 'window-close',
    },

    // Settings
    SETTINGS: {
        SAVE: 'save-settings',
        LOAD: 'load-settings',
    },

    // Dialog
    DIALOG: {
        SHOW_OPEN: 'show-open-dialog',
    },

    // Formatting, live check, IntelliSense
    FORMAT: {
        CODE: 'format-code',
        SYNTAX_CHECK: 'syntax-check',
        CLANGD_COMPLETIONS: 'get-clangd-completions',
        CLANGD_HOVER: 'get-clangd-hover',
    },

    // Renderer Events (Main -> Renderer)
    EVENTS: {
        FILE_OPENED: 'file-opened',
        FILE_CHANGED_EXTERNAL: 'file-changed-external',
    },
};

/**
 * Compiler-related constants
 */
const COMPILER = {
    // Used when the renderer sends no flags at all.
    DEFAULT_FLAGS: '-O0 -w',
};

/**
 * Competitive Companion listener (read by services/competitive/companion-server.js)
 */
const COMPETITIVE_COMPANION = {
    PORT: 27121,
    LISTEN_ADDRESS: '127.0.0.1',
};

/**
 * Window defaults
 */
const WINDOW = {
    DEFAULT_WIDTH: 1400,
    DEFAULT_HEIGHT: 900,
    BACKGROUND_COLOR: '#1e1e1e',
};

module.exports = {
    IPC,
    COMPILER,
    COMPETITIVE_COMPANION,
    WINDOW,
};
