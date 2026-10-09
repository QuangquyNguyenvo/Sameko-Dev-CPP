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

const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
    openFile: (options) => ipcRenderer.invoke('open-file-dialog', options),
    getLaunchFiles: () => ipcRenderer.invoke('get-launch-files'),
    saveFile: (data) => ipcRenderer.invoke('save-file', data),
    saveFileDialog: (payload) => ipcRenderer.invoke('save-file-dialog', payload),

    // Path of a File from a drop or an <input type="file">. File.path was removed in Electron 32.
    getPathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; } },

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
    sendInputFile: (filePath) => ipcRenderer.invoke('send-input-file', filePath),
    inputFileInfo: (filePath) => ipcRenderer.invoke('input-file-info', filePath),
    stopProcess: () => ipcRenderer.invoke('stop-process'),
    getCompilerStatus: () => ipcRenderer.invoke('get-compiler-status'),
    cleanPCHCache: (options) => ipcRenderer.invoke('clean-pch-cache', options),

    // Window controls (for frameless window)
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
    closeWindow: () => ipcRenderer.invoke('window-close'),

    // Event listeners
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, data) => callback(data)),

    // Process events
    onProcessStarted: (callback) => ipcRenderer.on('process-started', () => callback()),
    onProcessExternalStarted: (callback) => ipcRenderer.on('process-external-started', () => callback()),
    onProcessExternalExit: (callback) => ipcRenderer.on('process-external-exit', (event, data) => callback(data)),
    onProcessOutput: (callback) => ipcRenderer.on('process-output', (event, data) => callback(data)),
    onProcessError: (callback) => ipcRenderer.on('process-error', (event, data) => callback(data)),
    onProcessExit: (callback) => ipcRenderer.on('process-exit', (event, data) => callback(data)),
    onProcessStopped: (callback) => ipcRenderer.on('process-stopped', () => callback()),

    // Debugger (GDB/MI)
    debugStart: (data) => ipcRenderer.invoke('debug:start', data),
    debugStop: () => ipcRenderer.invoke('debug:stop'),
    debugSetBreakpoint: (data) => ipcRenderer.invoke('debug:setBreakpoint', data),
    debugRemoveBreakpoint: (id) => ipcRenderer.invoke('debug:removeBreakpoint', { id }),
    debugEnableBreakpoint: (id) => ipcRenderer.invoke('debug:enableBreakpoint', { id }),
    debugDisableBreakpoint: (id) => ipcRenderer.invoke('debug:disableBreakpoint', { id }),
    debugRunToLine: (file, line) => ipcRenderer.invoke('debug:runToLine', { file, line }),
    debugVarSetFormat: (name, fmt) => ipcRenderer.invoke('debug:varSetFormat', { name, fmt }),
    debugContinue: () => ipcRenderer.invoke('debug:continue'),
    debugInterrupt: () => ipcRenderer.invoke('debug:interrupt'),
    debugStepOver: () => ipcRenderer.invoke('debug:stepOver'),
    debugStepInto: () => ipcRenderer.invoke('debug:stepInto'),
    debugStepOut: () => ipcRenderer.invoke('debug:stepOut'),
    debugSelectFrame: (level) => ipcRenderer.invoke('debug:selectFrame', { level }),
    debugEvaluate: (expr) => ipcRenderer.invoke('debug:evaluate', { expr }),
    debugVarChildren: (name, from, to) => ipcRenderer.invoke('debug:varChildren', { name, from, to }),
    debugVarUpdate: () => ipcRenderer.invoke('debug:varUpdate'),
    debugVarCreateMany: (items) => ipcRenderer.invoke('debug:varCreateMany', { items }),
    debugVarDeleteMany: (names) => ipcRenderer.invoke('debug:varDeleteMany', { names }),
    onDebugStopped: (cb) => ipcRenderer.on('debug:stopped', (e, d) => cb(d)),
    onDebugRunning: (cb) => ipcRenderer.on('debug:running', (e, d) => cb(d)),
    onDebugOutput: (cb) => ipcRenderer.on('debug:output', (e, d) => cb(d)),
    onDebugConsole: (cb) => ipcRenderer.on('debug:console', (e, d) => cb(d)),
    onDebugNotify: (cb) => ipcRenderer.on('debug:notify', (e, d) => cb(d)),
    onDebugProgramExited: (cb) => ipcRenderer.on('debug:programExited', (e, d) => cb(d)),
    onDebugTerminated: (cb) => ipcRenderer.on('debug:terminated', (e, d) => cb(d)),
    onDebugError: (cb) => ipcRenderer.on('debug:error', (e, d) => cb(d)),

    // Competitive Companion
    ccStartServer: () => ipcRenderer.invoke('cc-start-server'),
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

    // Real-time syntax checking
    syntaxCheck: (content, filePath, docId) => ipcRenderer.invoke('syntax-check', { content, filePath, docId }),
    getClangdCompletions: (filePath, content, line, character) => ipcRenderer.invoke('get-clangd-completions', { filePath, content, line, character }),
    getClangdHover: (filePath, content, line, character) => ipcRenderer.invoke('get-clangd-hover', { filePath, content, line, character }),
    clangdCloseDocument: (filePath) => ipcRenderer.invoke('clangd-close-document', filePath),

    // Local History - backup before save
    createHistoryBackup: (data) => ipcRenderer.invoke('create-history-backup', data),
    getFileHistory: (filePath) => ipcRenderer.invoke('get-file-history', filePath),
    getHistoryContent: (backupPath) => ipcRenderer.invoke('get-history-content', backupPath),
    clearFileHistory: (filePath) => ipcRenderer.invoke('clear-file-history', filePath),

    // Small JSON documents kept under userData/state (session, untitled checkpoints)
    stateRead: (name) => ipcRenderer.invoke('state-read', name),
    stateWrite: (name, data) => ipcRenderer.invoke('state-write', { name, data }),
    stateWriteSync: (name, data) => ipcRenderer.sendSync('state-write-sync', { name, data }),
    stateDelete: (name) => ipcRenderer.invoke('state-delete', name),
    saveThemeAsset: (dataUrl) => ipcRenderer.invoke('theme-asset-save', dataUrl),

    // Discord Rich Presence
    discordUpdatePresence: (data) => ipcRenderer.invoke('discord-update-presence', data),
    discordEnable: () => ipcRenderer.invoke('discord-enable'),
    discordDisable: () => ipcRenderer.invoke('discord-disable'),

    // .sameko contest metadata
    readSameko: (folderPath) => ipcRenderer.invoke('read-sameko', folderPath),
    writeSameko: (folderPath, data) => ipcRenderer.invoke('write-sameko', { folderPath, data }),
    createContest: (opts) => ipcRenderer.invoke('create-contest', opts),

    // System info
    getSystemVersions: () => process.versions
});

