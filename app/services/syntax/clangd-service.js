/**
 * Sameko Dev C++ IDE - Clangd Service
 * Manages the clangd language server process and provides autocompletion and hover services
 * @module app/services/syntax/clangd-service
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { app } = require('electron');
const { getCompilerBinDir, getBasePath, getDetectedCompiler } = require('../compiler/detector');

let clangdProcess = null;
let isEnabled = false;
let isInitialized = false;
let isInitializing = false;
let isShuttingDown = false;
let isPermanentlyDisabled = false;

let clangdPath = null;
let binDir = null;

// Cache: GCC include paths (queried once at startup, ~200ms)
let gccIncludePathsCache = null;
let gccIncludePathsPromise = null;

let nextRequestId = 1;
const pendingRequests = new Map(); // id -> { resolve, reject, timeout }

const openedDocuments = new Set();
const documentVersions = {}; // uri -> version

let crashTimestamps = [];
let restartTimer = null;

// Optimize initialization with a single promise
let initializationPromise = null;
let resolveInitialization = null;

/**
 * Find clangd.exe location
 * @returns {{clangdPath: string, binDir: string}|null}
 */
function findClangd() {
    // 1. Try to find clangd.exe in same directory as g++.exe
    const detectedBinDir = getCompilerBinDir();
    if (detectedBinDir) {
        const p = path.join(detectedBinDir, 'clangd.exe');
        if (fs.existsSync(p)) {
            return { clangdPath: p, binDir: detectedBinDir };
        }
    }
    // 2. Fallback: check Sameko-GCC/bin/clangd.exe relative to app base path
    const basePath = getBasePath();
    const fallbackBinDir = path.join(basePath, 'Sameko-GCC', 'bin');
    const fallbackPath = path.join(fallbackBinDir, 'clangd.exe');
    if (fs.existsSync(fallbackPath)) {
        return { clangdPath: fallbackPath, binDir: fallbackBinDir };
    }
    return null;
}

/**
 * LSP Message Parser for chunked buffers
 */
class LSPParser {
    constructor(onMessage) {
        this.buffer = Buffer.alloc(0);
        this.onMessage = onMessage;
    }

    append(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.parse();
    }

    parse() {
        while (true) {
            // Find headers end "\r\n\r\n"
            const headerEndIndex = this.buffer.indexOf('\r\n\r\n');
            if (headerEndIndex === -1) {
                break;
            }

            const headerStr = this.buffer.toString('ascii', 0, headerEndIndex);
            const contentLengthMatch = headerStr.match(/(?:^|\r?\n)Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch) {
                // Garbage or invalid header? Skip to next to avoid infinite loop
                console.error('[Clangd] Invalid header in JSON-RPC stream:', headerStr);
                this.buffer = this.buffer.subarray(headerEndIndex + 4);
                continue;
            }

            const contentLength = parseInt(contentLengthMatch[1], 10);
            const messageStartIndex = headerEndIndex + 4;
            const totalMessageLength = messageStartIndex + contentLength;

            if (this.buffer.length < totalMessageLength) {
                // Message body not fully loaded yet, wait for more chunks
                break;
            }

            const messageContent = this.buffer.subarray(messageStartIndex, totalMessageLength);
            this.buffer = this.buffer.subarray(totalMessageLength);

            try {
                const jsonStr = messageContent.toString('utf8');
                const message = JSON.parse(jsonStr);
                this.onMessage(message);
            } catch (err) {
                console.error('[Clangd] Failed to parse JSON body:', err);
            }
        }
    }

    clear() {
        this.buffer = Buffer.alloc(0);
    }
}

/**
 * Handle incoming JSON-RPC message
 * @param {object} message 
 */
function handleMessage(message) {
    if (message.id !== undefined && message.id !== null) {
        const pending = pendingRequests.get(message.id);
        if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.delete(message.id);
            if (message.error) {
                pending.reject(message.error);
            } else {
                pending.resolve(message.result);
            }
        }
    }
}

/**
 * Send a raw JSON-RPC string over process stdin
 * @param {object} message 
 */
function sendRaw(message) {
    if (!clangdProcess || clangdProcess.killed) {
        return;
    }
    const jsonStr = JSON.stringify(message);
    const payload = `Content-Length: ${Buffer.byteLength(jsonStr, 'utf8')}\r\n\r\n${jsonStr}`;
    try {
        clangdProcess.stdin.write(payload, 'utf8');
    } catch (err) {
        console.error('[Clangd] Error writing to stdin:', err);
    }
}

/**
 * Send an LSP request and wait for a response
 * @param {string} method 
 * @param {object} params 
 * @returns {Promise<any>}
 */
function sendRequest(method, params) {
    const id = nextRequestId++;
    const message = {
        jsonrpc: '2.0',
        id,
        method,
        params
    };

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`Request ${method} (id: ${id}) timed out`));
        }, 15000); // 15s timeout for weak machines

        pendingRequests.set(id, { resolve, reject, timeout });
        sendRaw(message);
    });
}

/**
 * Send an LSP notification (no response expected)
 * @param {string} method 
 * @param {object} params 
 */
function sendNotification(method, params) {
    const message = {
        jsonrpc: '2.0',
        method,
        params
    };
    sendRaw(message);
}

/**
 * Initialize LSP server
 */
async function startLspInitialization() {
    isInitializing = true;
    isInitialized = false;

    // Maintain a single promise resolving once initialization completes
    initializationPromise = new Promise((resolve) => {
        resolveInitialization = resolve;
    });

    try {
        const rootUri = url.pathToFileURL(getBasePath()).href;
        await sendRequest('initialize', {
            processId: process.pid,
            rootUri: rootUri,
            capabilities: {
                textDocument: {
                    completion: {
                        completionItem: {
                            snippetSupport: true,
                            resolveSupport: {
                                properties: ['documentation', 'detail', 'additionalTextEdits']
                            }
                        }
                    },
                    hover: {
                        contentFormat: ['markdown', 'plaintext']
                    }
                }
            },
            initializationOptions: {}
        });

        sendNotification('initialized', {});
        isInitialized = true;
        isInitializing = false;
        if (resolveInitialization) {
            resolveInitialization(true);
            resolveInitialization = null;
        }
        console.log('[Clangd] LSP initialized and ready');
    } catch (err) {
        isInitializing = false;
        if (resolveInitialization) {
            resolveInitialization(false);
            resolveInitialization = null;
        }
        console.error('[Clangd] LSP initialization failed:', err);
    }
}

/**
 * Query g++ for its system include paths and cache the result.
 * Clangd's --query-driver flag does not always pick up MinGW include paths
 * on Windows (a known issue), so we extract them explicitly and pass as -I.
 * @returns {Promise<string[]>} array of resolved include paths
 */
function getGccIncludePaths() {
    if (gccIncludePathsCache) return Promise.resolve(gccIncludePathsCache);
    if (gccIncludePathsPromise) return gccIncludePathsPromise;

    gccIncludePathsPromise = new Promise((resolve) => {
        const gpp = (typeof getDetectedCompiler === 'function') ? getDetectedCompiler() : null;
        if (!gpp) {
            console.warn('[Clangd] getGccIncludePaths: no compiler detected, skipping');
            gccIncludePathsCache = [];
            resolve([]);
            return;
        }

        // Use nul as a no-op input. -E = preprocess only, -Wp,-v = verbose
        // include path output (printed to stderr between markers).
        const child = spawn(gpp, ['-E', '-Wp,-v', '-xc++', 'nul'], {
            cwd: getBasePath()
        });
        let stderr = '';
        let settled = false;

        const finish = (paths) => {
            if (settled) return;
            settled = true;
            gccIncludePathsCache = paths;
            console.log(`[Clangd] Extracted ${paths.length} GCC include paths`);
            resolve(paths);
        };

        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('close', () => {
            const paths = [];
            let inSearch = false;
            for (const raw of stderr.split(/\r?\n/)) {
                if (raw.includes('search starts here:')) {
                    inSearch = true;
                    continue;
                }
                if (raw.includes('End of search list.')) {
                    inSearch = false;
                    continue;
                }
                if (!inSearch) continue;
                const trimmed = raw.trim();
                if (!trimmed) continue;
                // Skip informational lines like "ignoring ..."
                if (trimmed.startsWith('ignoring')) continue;
                // Resolve ../ and normalize to absolute path
                const resolved = path.resolve(trimmed);
                if (!paths.includes(resolved)) {
                    paths.push(resolved);
                }
            }
            finish(paths);
        });
        child.on('error', (err) => {
            console.warn('[Clangd] getGccIncludePaths spawn error:', err.message);
            finish([]);
        });
        // Safety timeout: g++ -v rarely takes >2s
        setTimeout(() => {
            if (!settled) {
                console.warn('[Clangd] getGccIncludePaths: timeout, killing g++');
                try { child.kill(); } catch (e) {}
                finish([]);
            }
        }, 3000);
    });

    return gccIncludePathsPromise;
}

/**
 * Spawn the clangd child process
 */
async function spawnProcess() {
    // 1. Process Leak guard: prevent spawning multiple active processes
    if (clangdProcess) {
        return;
    }

    if (!isEnabled || isPermanentlyDisabled || isShuttingDown) {
        return;
    }

    const queryDriverPath = path.join(binDir, 'g++*').replace(/\\/g, '/');
    // NOTE: clangd does NOT accept -I as command-line argument (rejected at
    // startup). Include paths are supplied via compile_flags.txt written to
    // the base path by init() — clangd picks it up automatically when
    // processing files in that directory tree.
    const flags = [
        '--background-index',
        '--background-index-priority=low',
        '--clang-tidy',
        '--completion-style=detailed',
        '--header-insertion=never',
        `--query-driver=${queryDriverPath}`
    ];

    console.log(`[Clangd] Spawning from ${clangdPath} with flags:`, flags);

    try {
        clangdProcess = spawn(clangdPath, flags, {
            cwd: getBasePath(),
            env: process.env
        });

        // 2. Prevent Stdin Write Crash: catch EPIPE or write errors
        clangdProcess.stdin.on('error', (err) => {
            console.error('[Clangd] Stdin error:', err);
        });

        const parser = new LSPParser((message) => {
            handleMessage(message);
        });

        clangdProcess.stdout.on('data', (chunk) => {
            parser.append(chunk);
        });

        clangdProcess.stderr.on('data', (data) => {
            // stderr contains logs, which we can ignore or print to debug
        });

        clangdProcess.on('error', (err) => {
            console.error('[Clangd] Process error:', err);
        });

        clangdProcess.on('close', (code, signal) => {
            clangdProcess = null;
            isInitialized = false;
            isInitializing = false;
            parser.clear();
            openedDocuments.clear();
            for (const key of Object.keys(documentVersions)) {
                delete documentVersions[key];
            }

            if (resolveInitialization) {
                resolveInitialization(false);
                resolveInitialization = null;
            }
            initializationPromise = null;

            for (const [id, pending] of pendingRequests) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Clangd process closed'));
            }
            pendingRequests.clear();

            if (isShuttingDown || isPermanentlyDisabled) {
                return;
            }

            console.warn(`[Clangd] Process exited (code: ${code}, signal: ${signal})`);

            const now = Date.now();
            crashTimestamps = crashTimestamps.filter(t => now - t < 5 * 60 * 1000);

            if (crashTimestamps.length >= 3) {
                isPermanentlyDisabled = true;
                console.warn('[Clangd] Process crashed more than 3 times within 5 minutes. Disabling Clangd service.');
                return;
            }

            crashTimestamps.push(now);

            restartTimer = setTimeout(() => {
                console.log('[Clangd] Restarting clangd process...');
                spawnProcess();
            }, 2000);
        });

        startLspInitialization();
    } catch (err) {
        console.error('[Clangd] Failed to spawn process:', err);
    }
}

/**
 * Initialize the Clangd Service
 */
async function init() {
    if (isPermanentlyDisabled) {
        return;
    }
    const detected = findClangd();
    if (!detected) {
        console.warn('[Clangd] clangd.exe not found. Clangd IntelliSense service is disabled.');
        isEnabled = false;
        return;
    }

    clangdPath = detected.clangdPath;
    binDir = detected.binDir;
    isEnabled = true;
    isShuttingDown = false;

    // Pre-warm GCC include paths cache and write compile_flags.txt so clangd
    // can resolve system headers (MinGW). clangd walks up from each source
    // file's directory looking for this file; the base path is the root URI
    // so it covers untitled files and any saved files under the app dir.
    // clangd's --query-driver alone does NOT pick up MinGW include paths on
    // Windows, and clangd rejects -I as a command-line argument — this file
    // is the only way to pass them.
    const includePaths = await getGccIncludePaths();
    if (includePaths.length > 0) {
        const flagsFile = path.join(getBasePath(), 'compile_flags.txt');
        try {
            if (!fs.existsSync(flagsFile)) {
                // Each flag on its own line. The leading flags (target/std)
                // are needed to match MinGW's ABI; without --target clangd
                // uses MSVC defaults and builtins won't resolve.
                const lines = [
                    '-std=gnu++17',
                    '--target=x86_64-w64-mingw32',
                    ...includePaths.flatMap(p => ['-I', p])
                ];
                fs.writeFileSync(flagsFile, lines.join('\n') + '\n', 'utf-8');
                console.log(`[Clangd] Wrote ${flagsFile} (${includePaths.length} include paths)`);
            } else {
                console.log(`[Clangd] compile_flags.txt already exists at ${flagsFile}, not overwriting`);
            }
        } catch (err) {
            console.warn(`[Clangd] Failed to write compile_flags.txt:`, err.message);
        }
    }

    spawnProcess();
}

/**
 * Ensure clangd is initialized and ready to accept requests
 * @returns {Promise<boolean>}
 */
async function ensureReady() {
    if (!isEnabled || isPermanentlyDisabled) {
        return false;
    }
    if (isInitialized) {
        return true;
    }
    // 3. EnsureReady Optimization: await the pending initialization promise
    if (isInitializing && initializationPromise) {
        return initializationPromise;
    }
    return false;
}

/**
 * Map file paths (real or unsaved) to absolute file URIs
 * @param {string} filePath 
 * @returns {string}
 */
function getFileUri(filePath) {
    // 5. Path Type Safety: check if filePath is of type 'string'
    if (filePath && typeof filePath === 'string' && path.isAbsolute(filePath)) {
        return url.pathToFileURL(filePath).href;
    }
    // Handle unsaved files with unique identifier
    const id = (filePath && typeof filePath === 'string')
        ? filePath.replace(/[^a-zA-Z0-9-]/g, '_')
        : Math.random().toString(36).substring(7);

    const mockPath = path.join(getBasePath(), `temp_untitled_${id}.cpp`);
    return url.pathToFileURL(mockPath).href;
}

/**
 * Synchronize document state with clangd
 * @param {string} fileUri 
 * @param {string} content 
 */
function syncDocument(fileUri, content) {
    if (!openedDocuments.has(fileUri)) {
        const didOpenParams = {
            textDocument: {
                uri: fileUri,
                languageId: 'cpp',
                version: 1,
                text: content
            }
        };
        sendNotification('textDocument/didOpen', didOpenParams);
        openedDocuments.add(fileUri);
        documentVersions[fileUri] = 1;
    } else {
        documentVersions[fileUri] = (documentVersions[fileUri] || 1) + 1;
        const didChangeParams = {
            textDocument: {
                uri: fileUri,
                version: documentVersions[fileUri]
            },
            contentChanges: [
                {
                    text: content
                }
            ]
        };
        sendNotification('textDocument/didChange', didChangeParams);
    }
}

/**
 * Fetch autocompletions from clangd
 * @param {string} filePath 
 * @param {string} content 
 * @param {number} line 
 * @param {number} character 
 * @returns {Promise<any[]>}
 */
async function getCompletions(filePath, content, line, character) {
    const ready = await ensureReady();
    if (!ready) {
        return [];
    }

    const fileUri = getFileUri(filePath);
    syncDocument(fileUri, content);

    const completionParams = {
        textDocument: {
            uri: fileUri
        },
        position: {
            line: line,
            character: character
        }
    };

    try {
        const result = await sendRequest('textDocument/completion', completionParams);
        return result ? (Array.isArray(result) ? result : result.items || []) : [];
    } catch (err) {
        console.error('[Clangd] getCompletions request failed:', err);
        return [];
    }
}

/**
 * Fetch hover information from clangd
 * @param {string} filePath 
 * @param {string} content 
 * @param {number} line 
 * @param {number} character 
 * @returns {Promise<object|null>}
 */
async function getHover(filePath, content, line, character) {
    const ready = await ensureReady();
    if (!ready) {
        return null;
    }

    const fileUri = getFileUri(filePath);
    syncDocument(fileUri, content);

    const hoverParams = {
        textDocument: {
            uri: fileUri
        },
        position: {
            line: line,
            character: character
        }
    };

    try {
        const result = await sendRequest('textDocument/hover', hoverParams);
        return result;
    } catch (err) {
        console.error('[Clangd] getHover request failed:', err);
        return null;
    }
}

/**
 * Clean up/terminate the clangd process
 */
function shutdown() {
    isShuttingDown = true;
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    if (clangdProcess) {
        try {
            clangdProcess.kill('SIGTERM');
            const forceKillTimer = setTimeout(() => {
                if (clangdProcess) {
                    clangdProcess.kill('SIGKILL');
                }
            }, 1000);
            clangdProcess.on('close', () => {
                clearTimeout(forceKillTimer);
            });
        } catch (err) {
            console.error('[Clangd] Error during shutdown:', err);
        }
    }
}

/**
 * Get whether clangd is available
 * @returns {boolean}
 */
function isAvailable() {
    return isEnabled && isInitialized && !isPermanentlyDisabled;
}

// Ensure cleanup on before-quit
if (app) {
    app.on('before-quit', () => {
        shutdown();
    });
}

module.exports = {
    init,
    getCompletions,
    getHover,
    shutdown,
    isAvailable
};
