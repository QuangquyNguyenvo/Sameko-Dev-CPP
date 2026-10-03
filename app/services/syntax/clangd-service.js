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
const { getCompilerBinDir, getBasePath, getWritableBasePath, getDetectedCompiler } = require('../compiler/detector');
const { getCompilerSettings } = require('../../shared/settings-reader');
const { binName, NULL_DEVICE, IS_WIN, IS_MAC } = require('../../shared/platform');

/**
 * Working directory for the tools we spawn (g++, clangd).
 *
 * `getBasePath()` rewrites `app.asar` to `app.asar.unpacked`, but electron-builder
 * only creates that tree for files it actually unpacks — so in a packaged build the
 * path usually does NOT exist. Passing a non-existent `cwd` to spawn() makes Node
 * fail with a misleading `ENOENT` naming the *binary*, which reads as "g++ is
 * missing" when g++ is perfectly fine. That killed IntelliSense in packaged builds.
 * Fall back to a directory that always exists.
 *
 * Use the writable base: with --background-index clangd writes its index under
 * `.cache/clangd` in this directory, which a read-only install dir (a .deb in
 * /opt, an AppImage mount) refuses.
 * @returns {string}
 */
function getSpawnCwd() {
    try {
        const base = getWritableBasePath();
        if (base && fs.existsSync(base)) return base;
    } catch (_) { /* fall through */ }
    try {
        if (process.resourcesPath && fs.existsSync(process.resourcesPath)) return process.resourcesPath;
    } catch (_) { /* fall through */ }
    return os.tmpdir();
}

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
const documentText = new Map(); // uri -> text clangd currently has

// Diagnostics clangd publishes after each (re)parse. It computes them anyway;
// they used to be thrown away while a separate g++ process was spawned to
// produce the same information for the live check.
const publishedDiagnostics = new Map(); // uri -> { version, items }
const diagnosticWaiters = new Map();    // uri -> [{ version, resolve, timer }]

let crashTimestamps = [];
let restartTimer = null;

// Optimize initialization with a single promise
let initializationPromise = null;
let resolveInitialization = null;

/**
 * Find the clangd binary.
 * @returns {{clangdPath: string, binDir: string}|null}
 */
function findClangd() {
    // 1. Try to find clangd in the same directory as g++
    const detectedBinDir = getCompilerBinDir();
    if (detectedBinDir) {
        const p = path.join(detectedBinDir, binName('clangd'));
        if (fs.existsSync(p)) {
            return { clangdPath: p, binDir: detectedBinDir };
        }
    }
    // 2. Fallback: check Sameko-GCC/bin/clangd relative to app base path
    const basePath = getBasePath();
    const fallbackBinDir = path.join(basePath, 'Sameko-GCC', 'bin');
    const fallbackPath = path.join(fallbackBinDir, binName('clangd'));
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
    if (message.method === 'textDocument/publishDiagnostics' && message.params) {
        const { uri, version, diagnostics } = message.params;
        const entry = { version: Number.isInteger(version) ? version : null, items: diagnostics || [] };
        publishedDiagnostics.set(uri, entry);
        const waiters = diagnosticWaiters.get(uri);
        if (waiters) {
            const still = [];
            for (const w of waiters) {
                // Without a version we cannot tell; accept the first publish.
                if (entry.version === null || entry.version >= w.version) {
                    clearTimeout(w.timer);
                    w.resolve(entry.items);
                } else {
                    still.push(w);
                }
            }
            if (still.length) diagnosticWaiters.set(uri, still); else diagnosticWaiters.delete(uri);
        }
        return;
    }
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
        const rootUri = url.pathToFileURL(getWritableBasePath()).href;
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
                    },
                    publishDiagnostics: {
                        versionSupport: true
                    }
                }
            },
            // Flags for every file that has no compile_commands.json /
            // compile_flags.txt of its own — i.e. practically every file the
            // IDE opens. This replaces writing a machine-wide clangd config.
            initializationOptions: { fallbackFlags: currentFallbackFlags }
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

        // Use the platform null device as a no-op input ('NUL' on Windows,
        // '/dev/null' on POSIX — 'nul' does NOT exist on Linux and makes g++
        // bail out before printing the include search list).
        // -E = preprocess only, -Wp,-v = verbose include path output (stderr,
        // printed between the "search starts here:" / "End of search list."
        // markers).
        const child = spawn(gpp, ['-E', '-Wp,-v', '-xc++', NULL_DEVICE], {
            cwd: getSpawnCwd()
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
    // Include paths and language flags are NOT passed here (clangd rejects -I
    // on its command line); they go in the LSP `initialize` request as
    // `fallbackFlags`. --enable-config stays on so a user's own clangd config
    // is still honoured.
    // No --clang-tidy: its checks cost CPU on every reparse and are style
    // advice a compile would never report.
    const flags = [
        '--background-index',
        '--background-index-priority=low',
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
            cwd: getSpawnCwd(),
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
            documentText.clear();
            publishedDiagnostics.clear();
            for (const waiters of diagnosticWaiters.values()) {
                for (const w of waiters) { clearTimeout(w.timer); w.resolve(null); }
            }
            diagnosticWaiters.clear();
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
 * compiles. Sent to clangd as `fallbackFlags`.
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

    const flags = [stdFlag];
    // The MinGW triple describes the bundled Windows toolchain only. On
    // Linux/macOS clangd's own default target already matches the system g++,
    // and forcing mingw here makes it parse Windows headers that do not exist.
    if (IS_WIN) flags.push('--target=x86_64-w64-mingw32');
    // The live check takes its diagnostics from clangd, so ask for the same
    // warnings the g++ check used; silence the clang-only complaint about a
    // GNU extension that g++ accepts and competitive code uses all the time.
    flags.push('-Wall', '-Wextra', '-Wno-unknown-warning-option', '-Wno-vla-cxx-extension', '-Wno-vla-extension');
    flags.push(...includePaths.flatMap(p => ['-I', toPath(p)]));
    if (extraFlags) {
        flags.push(...extraFlags.split(/\s+/).filter(Boolean));
    }
    return flags;
}

// Flags handed to clangd at initialize time. Null until first computed.
let currentFallbackFlags = [];

// Earlier versions wrote the flags to two files instead: compile_flags.txt in
// the app's base directory, and — to cover files saved anywhere else —
// %LOCALAPPDATA%\clangd\config.yaml, which is the machine-wide clangd config
// shared with VS Code, CLion and every other clangd on the PC. That forced a
// MinGW target and our include paths onto unrelated projects. Both are removed
// once; the global one only if it still carries our marker.
const USER_CONFIG_MARKER = '# Managed by Sameko Dev C++';
let legacyFilesCleaned = false;

function getClangdUserConfigPath() {
    let baseDir;
    if (IS_WIN) {
        baseDir = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    } else if (IS_MAC) {
        baseDir = path.join(os.homedir(), 'Library', 'Preferences');
    } else {
        const xdg = process.env.XDG_CONFIG_HOME;
        baseDir = (xdg && path.isAbsolute(xdg)) ? xdg : path.join(os.homedir(), '.config');
    }
    return path.join(baseDir, 'clangd', 'config.yaml');
}

function removeLegacyFlagFiles() {
    if (legacyFilesCleaned) return;
    legacyFilesCleaned = true;
    try {
        const userConfig = getClangdUserConfigPath();
        if (fs.existsSync(userConfig) && fs.readFileSync(userConfig, 'utf-8').startsWith(USER_CONFIG_MARKER)) {
            fs.unlinkSync(userConfig);
            console.log('[Clangd] Removed the global clangd config written by an earlier version');
        }
    } catch (err) {
        console.warn('[Clangd] Could not remove legacy global config:', err.message);
    }
    try {
        // A stale compile_flags.txt here would take precedence over fallbackFlags
        // for untitled tabs (their mock paths live in this directory).
        const flagsFile = path.join(getWritableBasePath(), 'compile_flags.txt');
        if (fs.existsSync(flagsFile)) fs.unlinkSync(flagsFile);
    } catch (_) { }
}

/**
 * Recompute the flags clangd should use (C++ standard, target, MinGW include
 * paths, extra flags from Settings). They take effect when clangd is
 * (re)initialised.
 * @returns {Promise<boolean>} whether the flags changed
 */
async function regenerateCompileFlags() {
    removeLegacyFlagFiles();
    const includePaths = await getGccIncludePaths();
    if (includePaths.length === 0) return false;

    const next = buildClangdFlagsList(includePaths, { posixPaths: true });
    const changed = JSON.stringify(next) !== JSON.stringify(currentFallbackFlags);
    currentFallbackFlags = next;
    return changed;
}

/**
 * Called after the user saves Settings. Recomputes the flags to
 * match the (possibly changed) cppStandard/extraFlags, and cleanly restarts
 * clangd when they changed — fallback flags are only read at initialise time,
 * so without a restart e.g. a new -DLOCAL would not affect completions or
 * diagnostics until the next app launch.
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
        console.warn('[Clangd] clangd binary not found. Clangd IntelliSense service is disabled.');
        isEnabled = false;
        return;
    }

    clangdPath = detected.clangdPath;
    binDir = detected.binDir;
    isEnabled = true;
    isShuttingDown = false;

    // Query GCC's include paths and compute the flags clangd needs so it
    // can resolve system headers. --query-driver alone does NOT pick up the
    // MinGW include paths on Windows, so they are passed explicitly.
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

    const mockPath = path.join(getWritableBasePath(), `temp_untitled_${id}.cpp`);
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
        documentText.set(fileUri, content);
    } else {
        // Hover and repeated completions usually arrive with unchanged text;
        // re-sending it made clangd rebuild the AST for nothing.
        if (documentText.get(fileUri) === content) return;
        documentText.set(fileUri, content);
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
 * Tell clangd a document is no longer open so it can drop the AST and
 * preamble it keeps for it. Without this every tab ever shown stayed loaded
 * in clangd for the whole session.
 * @param {string} filePath - same identifier that was used for completions
 */
function closeDocument(filePath) {
    if (!isEnabled || !isInitialized) return;
    const fileUri = getFileUri(filePath);
    if (!openedDocuments.has(fileUri)) return;
    sendNotification('textDocument/didClose', { textDocument: { uri: fileUri } });
    openedDocuments.delete(fileUri);
    documentText.delete(fileUri);
    publishedDiagnostics.delete(fileUri);
    delete documentVersions[fileUri];
}

/**
 * Diagnostics for a document, taken from what clangd publishes after parsing
 * it — no extra compiler process. Resolves with null when clangd is not
 * available or does not answer in time, so the caller can fall back to g++.
 *
 * @param {string} filePath - saved path, or the stable id of an untitled tab
 * @param {string} content
 * @param {number} [timeoutMs=6000]
 * @returns {Promise<Array<{line:number,column:number,endLine:number,endColumn:number,severity:string,message:string,source:string}>|null>}
 */
async function getDiagnostics(filePath, content, timeoutMs = 6000) {
    const ready = await ensureReady();
    if (!ready) return null;

    const fileUri = getFileUri(filePath);
    syncDocument(fileUri, content);
    const wanted = documentVersions[fileUri] || 1;

    const cached = publishedDiagnostics.get(fileUri);
    let items;
    if (cached && cached.version !== null && cached.version >= wanted) {
        items = cached.items;
    } else {
        items = await new Promise((resolve) => {
            const waiter = { version: wanted, resolve, timer: null };
            waiter.timer = setTimeout(() => {
                const list = (diagnosticWaiters.get(fileUri) || []).filter((w) => w !== waiter);
                if (list.length) diagnosticWaiters.set(fileUri, list); else diagnosticWaiters.delete(fileUri);
                resolve(null);
            }, timeoutMs);
            const list = diagnosticWaiters.get(fileUri) || [];
            list.push(waiter);
            diagnosticWaiters.set(fileUri, list);
        });
    }
    if (!items) return null;

    const SEVERITY = { 1: 'error', 2: 'warning', 3: 'note' };
    return items
        .filter((d) => SEVERITY[d.severity] && d.range)   // 4 = hint: not shown
        .map((d) => ({
            line: d.range.start.line + 1,
            column: d.range.start.character + 1,
            endLine: d.range.end.line + 1,
            endColumn: d.range.end.character + 1,
            severity: SEVERITY[d.severity],
            message: String(d.message || '').split('\n')[0].replace(/\s*\(fix(es)? available\)\s*$/, ''),
            source: 'clangd'
        }));
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
    getDiagnostics,
    closeDocument,
    shutdown,
    isAvailable,
    onSettingsChanged
};
