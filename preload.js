/**
 * C++ IDE - Preload Script
 * 
 * Exposes a secure API to the renderer process via contextBridge.
 * All IPC communication between main and renderer is handled here.
 * 
 * API Categories:
 * - File operations (open, save, save-as)
 * - Build operations (compile, run, stop)
 * - Window controls (minimize, maximize, close)
 * - Event listeners (process output, file events)
 * 
 * @author Project IDE Team
 * @license MIT
 */

const { contextBridge, ipcRenderer } = require('electron');

let judge = null;
try {
    judge = require('./app/shared/judge');
} catch (err) {
    // Do not crash preload if optional/shared judge module fails to load.
    // Core APIs (compile/run/...) must still be exposed.
    console.warn('[preload] Failed to load shared judge module:', err?.message || err);
}

contextBridge.exposeInMainWorld('electronAPI', {
    // File operations
    openFile: () => ipcRenderer.invoke('open-file-dialog'),
    saveFile: (data) => ipcRenderer.invoke('save-file', data),
    saveFileDialog: (payload) => ipcRenderer.invoke('save-file-dialog', payload),
    getCurrentFile: () => ipcRenderer.invoke('get-current-file'),

    // File Explorer operations
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', { oldPath, newPath }),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    copyFile: (src, dest) => ipcRenderer.invoke('copy-file', { src, dest }),
    moveFile: (src, dest) => ipcRenderer.invoke('move-file', { src, dest }),
    deleteFolder: (folderPath) => ipcRenderer.invoke('delete-folder', folderPath),
    createDirectory: (dirPath) => ipcRenderer.invoke('create-directory', dirPath),
    showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),

    // Settings operations
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    loadSettings: () => ipcRenderer.sendSync('load-settings'),

    // Build operations
    compile: (data) => ipcRenderer.invoke('compile', data),
    run: (data) => ipcRenderer.invoke('run', data),
    sendInput: (input) => ipcRenderer.invoke('send-input', input),
    stopProcess: () => ipcRenderer.invoke('stop-process'),
    getCompilerInfo: () => ipcRenderer.invoke('get-compiler-info'),
    getCompilerStatus: () => ipcRenderer.invoke('get-compiler-status'),

    // Window controls (for frameless window)
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
    closeWindow: () => ipcRenderer.invoke('window-close'),

    // Event listeners
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, data) => callback(data)),
    onSaveFileAs: (callback) => ipcRenderer.on('save-file-as', (event, path) => callback(path)),
    onMenuNew: (callback) => ipcRenderer.on('menu-new', () => callback()),
    onMenuSave: (callback) => ipcRenderer.on('menu-save', () => callback()),
    onMenuCompile: (callback) => ipcRenderer.on('menu-compile', () => callback()),
    onMenuRun: (callback) => ipcRenderer.on('menu-run', () => callback()),
    onMenuCompileRun: (callback) => ipcRenderer.on('menu-compile-run', () => callback()),

    // Process events
    onProcessStarted: (callback) => ipcRenderer.on('process-started', () => callback()),
    onProcessExternalStarted: (callback) => ipcRenderer.on('process-external-started', () => callback()),
    onProcessExternalExit: (callback) => ipcRenderer.on('process-external-exit', (event, data) => callback(data)),
    onProcessOutput: (callback) => ipcRenderer.on('process-output', (event, data) => callback(data)),
    onProcessError: (callback) => ipcRenderer.on('process-error', (event, data) => callback(data)),
    onProcessExit: (callback) => ipcRenderer.on('process-exit', (event, data) => callback(data)),
    onProcessStopped: (callback) => ipcRenderer.on('process-stopped', () => callback()),

    // Competitive Companion
    ccStartServer: () => ipcRenderer.invoke('cc-start-server'),
    ccStopServer: () => ipcRenderer.invoke('cc-stop-server'),
    ccGetStatus: () => ipcRenderer.invoke('cc-get-status'),
    ccOpenExtensionPage: () => ipcRenderer.invoke('cc-open-extension-page'),
    onProblemReceived: (callback) => ipcRenderer.on('problem-received', (event, data) => callback(data)),

    // File watcher - detect external changes
    watchFile: (filePath) => ipcRenderer.invoke('watch-file', filePath),
    unwatchFile: (filePath) => ipcRenderer.invoke('unwatch-file', filePath),
    reloadFile: (filePath) => ipcRenderer.invoke('reload-file', filePath),
    onFileChangedExternal: (callback) => ipcRenderer.on('file-changed-external', (event, data) => callback(data)),

    // System messages
    onSystemMessage: (callback) => ipcRenderer.on('system-message', (event, data) => callback(data)),

    // Batch testing - run single test case
    runTest: (data) => ipcRenderer.invoke('run-test', data),

    // Shared judge utils (same rules as main process batch judge)
    judgeNormalizeOutput: (text) => {
        const fallback = String(text ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map(l => l.trimEnd())
            .join('\n')
            .trim();

        if (judge && typeof judge.normalizeOutput === 'function') {
            return judge.normalizeOutput(text);
        }
        return fallback;
    },
    judgeCompareOutputs: (actual, expected) => {
        if (judge && typeof judge.compareOutputs === 'function') {
            return judge.compareOutputs(actual, expected);
        }

        const normalize = (value) => String(value ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map(l => l.trimEnd())
            .join('\n')
            .trim();

        const actualNorm = normalize(actual);
        const expectedNorm = normalize(expected);
        return {
            matched: actualNorm === expectedNorm,
            actualNorm,
            expectedNorm,
        };
    },

    // Auto-update
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    getCurrentVersion: () => ipcRenderer.invoke('get-current-version'),
    openReleasePage: (url) => ipcRenderer.invoke('open-release-page', url),
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

    // Code formatting (AStyle)
    formatCode: (code, style) => ipcRenderer.invoke('format-code', { code, style }),
    checkAStyle: () => ipcRenderer.invoke('check-astyle'),

    // Real-time syntax checking
    syntaxCheck: (content, filePath) => ipcRenderer.invoke('syntax-check', { content, filePath }),
    getSmartSuggestions: (content, row, column) => ipcRenderer.invoke('smart-suggestions', { content, row, column }),

    // Local History - backup before save
    createHistoryBackup: (data) => ipcRenderer.invoke('create-history-backup', data),
    getFileHistory: (filePath) => ipcRenderer.invoke('get-file-history', filePath),
    getHistoryContent: (backupPath) => ipcRenderer.invoke('get-history-content', backupPath),
    clearFileHistory: (filePath) => ipcRenderer.invoke('clear-file-history', filePath),

    // Discord Rich Presence
    discordUpdatePresence: (data) => ipcRenderer.invoke('discord-update-presence', data),
    discordClearPresence: () => ipcRenderer.invoke('discord-clear-presence'),
    discordGetStatus: () => ipcRenderer.invoke('discord-get-status'),
    discordEnable: () => ipcRenderer.invoke('discord-enable'),
    discordDisable: () => ipcRenderer.invoke('discord-disable'),

    // .sameko contest metadata
    readSameko: (folderPath) => ipcRenderer.invoke('read-sameko', folderPath),
    writeSameko: (folderPath, data) => ipcRenderer.invoke('write-sameko', { folderPath, data }),
    createContest: (opts) => ipcRenderer.invoke('create-contest', opts),

    // System info
    getSystemVersions: () => process.versions
});


