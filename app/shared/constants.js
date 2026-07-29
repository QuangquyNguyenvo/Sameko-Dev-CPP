/**
 * Sameko Dev C++ IDE - Shared Constants
 * Used by both Main and Renderer processes
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
        GET_INFO: 'get-compiler-info',
        SEND_INPUT: 'process-input',
    },

    // Debugger (GDB/MI)
    DEBUG: {
        START: 'debug:start',
        STOP: 'debug:stop',
        SET_BREAKPOINT: 'debug:setBreakpoint',
        REMOVE_BREAKPOINT: 'debug:removeBreakpoint',
        ENABLE_BREAKPOINT: 'debug:enableBreakpoint',
        DISABLE_BREAKPOINT: 'debug:disableBreakpoint',
        SET_CONDITION: 'debug:setCondition',
        RUN_TO_LINE: 'debug:runToLine',
        VAR_SET_FORMAT: 'debug:varSetFormat',
        CONTINUE: 'debug:continue',
        INTERRUPT: 'debug:interrupt',
        STEP_OVER: 'debug:stepOver',
        STEP_INTO: 'debug:stepInto',
        STEP_OUT: 'debug:stepOut',
        SELECT_FRAME: 'debug:selectFrame',
        EVALUATE: 'debug:evaluate',
        VAR_CREATE: 'debug:varCreate',
        VAR_CHILDREN: 'debug:varChildren',
        VAR_UPDATE: 'debug:varUpdate',
        VAR_DELETE: 'debug:varDelete',
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

    // Code Formatting
    FORMAT: {
        CODE: 'format-code',
        SYNTAX_CHECK: 'syntax-check',
        SMART_SUGGESTIONS: 'smart-suggestions',
        CLANGD_COMPLETIONS: 'get-clangd-completions',
        CLANGD_HOVER: 'get-clangd-hover',
    },

    // Competitive Programming
    COMPETITIVE: {
        BATCH_TEST: 'batch-test',
        STOP_TEST: 'stop-batch-test',
    },

    // Local History
    HISTORY: {
        SAVE: 'history-save',
        GET_HISTORY: 'history-get',
        RESTORE: 'history-restore',
        DELETE: 'history-delete',
        CLEAR: 'history-clear',
    },

    // Renderer Events (Main -> Renderer)
    EVENTS: {
        FILE_OPENED: 'file-opened',
        FILE_CHANGED_EXTERNAL: 'file-changed-external',
        SAVE_FILE_AS: 'save-file-as',
        COMPILE_OUTPUT: 'compile-output',
        RUN_OUTPUT: 'run-output',
        PROCESS_STOPPED: 'process-stopped',
        MEMORY_UPDATE: 'memory-update',
        SYSTEM_MESSAGE: 'system-message',
        BATCH_TEST_RESULT: 'batch-test-result',
        CP_COMPANION_PROBLEM: 'cp-companion-problem',
    },
};

/**
 * Path constants
 */
const PATHS = {
    PCH_DIR: 'cpp-ide-pch',
    BUILDS_DIR: 'cpp-ide-builds',
    SETTINGS_FILE: 'settings.json',
    HISTORY_DIR: 'local-history',
    SNIPPETS_FILE: 'snippets.json',
};

/**
 * Application limits
 */
const LIMITS = {
    MAX_FILE_SIZE_KB: 1024,
    MAX_HISTORY_VERSIONS: 20,
    MAX_BATCH_TESTS: 100,
    MAX_EXECUTION_TIME_MS: 30000, // 30 seconds
    MAX_MEMORY_MB: 256,
    DEBOUNCE_DELAY_MS: 300,
    AUTOSAVE_INTERVAL_MS: 60000, // 1 minute
};

/**
 * Compiler-related constants
 */
const COMPILER = {
    // NOTE: Windows-only literals. Not consumed by detector.js (which builds its own
    // paths via app/shared/platform.js). Kept for backward compat only.
    BUNDLED_MIN_GW_PATHS: [
        'Sameko-GCC/bin/g++.exe',
        'mingw64/bin/g++.exe',
        'mingw32/bin/g++.exe',
        'MinGW/bin/g++.exe',
        'compiler/bin/g++.exe',
    ],
    SYSTEM_COMPILER_PATHS: [
        'C:\\TDM-GCC-64\\bin\\g++.exe',
        'C:\\TDM-GCC-32\\bin\\g++.exe',
        'C:\\MinGW\\bin\\g++.exe',
        'C:\\MinGW64\\bin\\g++.exe',
        'C:\\msys64\\mingw64\\bin\\g++.exe',
        'C:\\msys64\\mingw32\\bin\\g++.exe',
    ],
    FILE_EXTENSIONS: ['.cpp', '.c', '.h', '.hpp', '.cc', '.cxx'],
    DEFAULT_FLAGS: '-O0 -w',
};

/**
 * Competitive Companion constants
 */
const COMPETITIVE_COMPANION = {
    PORT: 10043,
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

// Export for Node.js (Main Process)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        IPC,
        PATHS,
        LIMITS,
        COMPILER,
        COMPETITIVE_COMPANION,
        WINDOW,
    };
}

// Export for ES Modules (Renderer Process if bundled)
// This can be imported as `import { IPC } from './constants.js'`
