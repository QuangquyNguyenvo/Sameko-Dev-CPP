/**
 * Sameko Dev C++ IDE - Clangd Service
 * Manages the clangd language server process and provides autocompletion and hover services
 * @module app/services/syntax/clangd-service
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const url = require('url');
const { app } = require('electron');
const { getCompilerBinDir, getBasePath, getDetectedCompiler } = require('../compiler/detector');
const { getCompilerSettings } = require('../../shared/settings-reader');

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
    // startup). Include paths are supplied two ways: compile_flags.txt
    // written to the base path (covers untitled/temp files and anything
    // saved under the app dir), and the global clangd user config YAML
    // written by regenerateCompileFlags() (covers files saved ANYWHERE else
    // on disk — Desktop, Documents, another project folder — which would
    // otherwise get zero include paths and fail to resolve even <vector>).
    // --enable-config is required for clangd to read that user config file.
    const flags = [
        '--background-index',
        '--background-index-priority=low',
        '--clang-tidy',
        // bundled groups function overloads into a single entry ("assign(…)
        // [3 overloads]") instead of one line per overload — a shorter, less
        // noisy completion list, better suited to competitive programming.
        '--completion-style=bundled',
        '--header-insertion=never',
        '--enable-config',
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
            // stderr carries clangd's own diagnostic logs (preamble build
            // errors, missing headers, etc.) — surfaced only in debug mode
            // to avoid spamming the console in normal use.
            if (process.env.SAMEKO_CLANGD_DEBUG) {
                console.log('[Clangd-stderr]', data.toString());
            }
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
 * Build the shared list of clangd/g++ flags (std, target, includes, extra
 * flags) from the user's compiler settings plus MinGW's system include
 * paths. Mirrors what executor.js actually passes to g++ so clangd's
 * diagnostics/completions (macros, #ifdef branches like -DLOCAL) match real
 * compiles. Shared by both compile_flags.txt (one flag per line) and the
 * global user config YAML (flow-sequence list) writers below.
 * @param {string[]} includePaths
 * @param {{posixPaths?: boolean}} [opts] - convert `-I` paths to forward
 *   slashes; needed for YAML since backslashes are escape characters there.
 * @returns {string[]}
 */
function buildClangdFlagsList(includePaths, opts = {}) {
    const { cppStandard, extraFlags } = getCompilerSettings();
    // Default to the GNU dialect (matches g++'s own default) rather than
    // strict c++17, preserving prior behavior when the user hasn't picked
    // a standard in Settings. If the user did pick one, mirror it exactly
    // so clangd agrees with the real compile command.
    const stdFlag = cppStandard ? `-std=${cppStandard}` : '-std=gnu++17';
    const toPath = (p) => opts.posixPaths ? p.replace(/\\/g, '/') : p;

    const flags = [
        stdFlag,
        '--target=x86_64-w64-mingw32',
        ...includePaths.flatMap(p => ['-I', toPath(p)])
    ];
    if (extraFlags) {
        flags.push(...extraFlags.split(/\s+/).filter(Boolean));
    }
    return flags;
}

function buildCompileFlagsContent(includePaths) {
    return buildClangdFlagsList(includePaths).join('\n') + '\n';
}

function yamlQuote(str) {
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * clangd only auto-discovers compile_flags.txt by walking up from a source
 * file's own directory — so a file saved anywhere outside getBasePath()
 * (Desktop, Documents, another project folder) gets NO include paths and
 * fails to resolve even <vector>. The global user config YAML (read via
 * --enable-config from a fixed OS-level path) applies to every file clangd
 * opens regardless of location, so it's the only way to make IntelliSense
 * work for files saved outside the app's install directory.
 * @param {string[]} includePaths
 * @returns {string}
 */
// %LOCALAPPDATA%\clangd\config.yaml is THE canonical global clangd user
// config — shared by every clangd process on the machine (VSCode's clangd
// extension, CLion, other IDEs, other C++ projects), not scoped to this app.
// We mark our writes so we only ever touch a file we created ourselves;
// if the user already has an unrelated clangd config there, we leave it
// alone rather than risk breaking IntelliSense in their other projects.
const USER_CONFIG_MARKER = '# Managed by Sameko Dev C++ — safe to delete, will be regenerated.';

function buildUserConfigYamlContent(includePaths) {
    const flags = buildClangdFlagsList(includePaths, { posixPaths: true });
    return `${USER_CONFIG_MARKER}\nCompileFlags:\n  Add: [${flags.map(yamlQuote).join(', ')}]\n`;
}

function getClangdUserConfigPath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'clangd', 'config.yaml');
}

/**
 * Write a file if its content differs from what's on disk. No-op otherwise.
 * @param {boolean} [requireMarker] - if true, refuse to overwrite an
 *   existing file that doesn't start with USER_CONFIG_MARKER (i.e. one we
 *   didn't create) to avoid clobbering unrelated config.
 * @returns {boolean} whether the file was written
 */
function writeIfChanged(filePath, desired, requireMarker = false) {
    try {
        const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
        if (current === desired) {
            return false;
        }
        if (requireMarker && current !== null && !current.startsWith(USER_CONFIG_MARKER)) {
            console.warn(`[Clangd] ${filePath} exists and wasn't created by this app — leaving it untouched.`);
            return false;
        }
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, desired, 'utf-8');
        console.log(`[Clangd] ${current === null ? 'Wrote' : 'Updated'} ${filePath}`);
        return true;
    } catch (err) {
        console.warn(`[Clangd] Failed to write ${filePath}:`, err.message);
        return false;
    }
}

/**
 * (Re)write compile_flags.txt (for files under getBasePath()) and the
 * global clangd user config YAML (for files saved anywhere else) if their
 * content differs from what the current settings/compiler would produce.
 * Safe to call repeatedly (e.g. every time the user saves Settings) — a
 * no-op when nothing changed.
 * @returns {Promise<boolean>} whether either file's content actually changed
 */
async function regenerateCompileFlags() {
    const includePaths = await getGccIncludePaths();
    if (includePaths.length === 0) return false;

    const flagsFile = path.join(getBasePath(), 'compile_flags.txt');
    const localChanged = writeIfChanged(flagsFile, buildCompileFlagsContent(includePaths));

    const userConfigFile = getClangdUserConfigPath();
    const globalChanged = writeIfChanged(userConfigFile, buildUserConfigYamlContent(includePaths), true);

    return localChanged || globalChanged;
}

/**
 * Called after the user saves Settings. Refreshes compile_flags.txt to
 * match the (possibly changed) cppStandard/extraFlags, and cleanly restarts
 * the clangd process so it re-reads the file — clangd only parses
 * compile_flags.txt at startup, so without a restart e.g. a new -DLOCAL
 * would silently not affect completions/diagnostics until next app launch.
 * @returns {Promise<void>}
 */
async function onSettingsChanged() {
    if (!isEnabled || isPermanentlyDisabled) return;
    const changed = await regenerateCompileFlags();
    if (!changed || !clangdProcess) return;

    isShuttingDown = true;
    try {
        clangdProcess.kill('SIGTERM');
    } catch (e) { }
    setTimeout(() => {
        isShuttingDown = false;
        spawnProcess();
    }, 300);
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
    await regenerateCompileFlags();

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
    // Handle unsaved files with a stable identifier. Use the provided
    // string (e.g. `tab-1`) directly so the same tab always maps to the
    // same URI — calling didOpen on a fresh random URI each time would
    // wipe clangd's parsed state and make completions stale.
    const id = (filePath && typeof filePath === 'string')
        ? filePath.replace(/[^a-zA-Z0-9-]/g, '_')
        : 'anon';

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
        console.warn('[Clangd-DBG] getCompletions: not ready, returning []');
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
        const items = result ? (Array.isArray(result) ? result : result.items || []) : [];
        if (process.env.SAMEKO_CLANGD_DEBUG) {
            const labels = items.slice(0, 5).map(i => i.label).join(', ');
            console.log(`[Clangd-DBG] completions @${line}:${character} uri=${fileUri} → ${items.length} items [${labels}${items.length > 5 ? ', ...' : ''}]`);
        }
        return items;
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
    isAvailable,
    onSettingsChanged
};
