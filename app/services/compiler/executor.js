/**
 * Sameko Dev C++ IDE - Compiler Executor
 * Handles compilation and execution of C++ programs
 * @module app/services/compiler/executor
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec } = require('child_process');
const { getDetectedCompiler, getCompilerInfo, getCompilerEnv, getWritableBasePath, getUnbufferObjectPath } = require('./detector');
const { ensurePCH } = require('./pch-manager');
const { validateCompilerFlags } = require('../../shared/validators');
const { EXE_SUFFIX, IS_WIN, IS_MAC, IS_LINUX, ensurePrivateDir, readProcMemoryKB, which, appTempDir } = require('../../shared/platform');

let runningProcess = null;
let activeCompilerProcess = null;

let lastRunningPID = null;

let runningExeName = null;

let runningMemoryPollInterval = null;

const MAX_BUILD_ARTIFACTS = 30;

/** @type {Function|null} - Callback for file watcher mtime update */
let updateFileWatcherMtimeCallback = null;

/** @type {Function|null} - Callback for sending messages to renderer */
let sendToRendererCallback = null;

function setFileWatcherCallback(callback) {
    updateFileWatcherMtimeCallback = callback;
}

function setSendToRendererCallback(callback) {
    sendToRendererCallback = callback;
}

function cleanupOldBuildArtifacts(buildsDir) {
    try {
        if (!fs.existsSync(buildsDir)) return;
        // buildsDir is app-owned (<temp>/cpp-ide-builds) and only ever holds
        // compiler output: `<name>.exe` on Windows, extension-less `<name>` on POSIX.
        const isArtifact = (name) => (IS_WIN
            ? name.toLowerCase().endsWith('.exe')
            : path.extname(name) === '');
        const entries = fs.readdirSync(buildsDir, { withFileTypes: true })
            .filter((e) => e.isFile() && isArtifact(e.name))
            .map((e) => {
                const fullPath = path.join(buildsDir, e.name);
                const stat = fs.statSync(fullPath);
                return { fullPath, mtimeMs: stat.mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);

        if (entries.length <= MAX_BUILD_ARTIFACTS) return;

        for (const item of entries.slice(MAX_BUILD_ARTIFACTS)) {
            try {
                fs.unlinkSync(item.fullPath);
            } catch (_) { }
        }
    } catch (_) { }
}

function sanitizeUserFlags(flags, content) {
    const tokens = (flags || '').split(' ').filter((f) => f.trim());
    const hasMain = /\b(?:int\s+)?main\s*\(/.test(content);
    const hasWinMain = /\b(?:w)?WinMain\s*\(/.test(content);

    if (hasMain && !hasWinMain) {
        const hadMwindows = tokens.includes('-mwindows');
        const sanitized = tokens.filter((f) => f !== '-mwindows');
        return {
            flags: sanitized.join(' '),
            removedMwindows: hadMwindows
        };
    }

    return {
        flags: tokens.join(' '),
        removedMwindows: false
    };
}

/**
 * Send message to renderer if callback is set
 * @param {string} channel
 * @param {*} data
 */
function sendToRenderer(channel, data) {
    if (sendToRendererCallback) {
        sendToRendererCallback(channel, data);
    }
}

/**
 * Compile C++ source code
 * 
 * @param {Object} options
 * @param {string|null} options.filePath - Source file path (null for unsaved)
 * @param {string} options.content - Source code content
 * @param {string} [options.flags] - Compiler flags
 * @returns {Promise<import('../../../shared/types').CompileResult>}
 */
async function compile({ filePath, content, flags, useLLD, noBuildCache = false, singleFileMode = false, realtimeOutput = true }) {
    const startTime = Date.now();

    const flagsCheck = validateCompilerFlags(flags);
    if (!flagsCheck.valid) {
        return {
            success: false,
            error: `${flagsCheck.error}. Check your Additional Compile Flags in Settings > Compiler.`,
            outputPath: null,
            time: Date.now() - startTime
        };
    }

    if (activeCompilerProcess) {
        try {
            activeCompilerProcess.kill();
        } catch (e) { }
        activeCompilerProcess = null;
        console.log(`[Compile] Cancelled previous active compilation`);
        // Minimal pause to allow process teardown
        await new Promise(r => setTimeout(r, 10));
    }

    // Kill any running process first (to release .exe lock)
    if (runningProcess) {
        runningProcess.kill();
        runningProcess = null;
        // Minimal delay - just enough to release file lock
        await new Promise(r => setTimeout(r, 10));
    }

    try {
        const syntax = require('../syntax');
        syntax.cancelSyntaxCheck();
    } catch (e) { }

    // Use temp file if no filePath provided (unsaved file)
    let actualFilePath = filePath;
    let usingTempFile = false;

    if (!filePath) {
        const tempDir = appTempDir('cpp-ide');
        if (!fs.existsSync(tempDir)) {
            ensurePrivateDir(tempDir);
        }
        actualFilePath = path.join(tempDir, 'temp_code.cpp');
        usingTempFile = true;
    }

    // OPTIMIZATION: Only write file if different
    let needsWrite = true;
    try {
        if (fs.existsSync(actualFilePath)) {
            const existingContent = fs.readFileSync(actualFilePath, 'utf-8');
            if (existingContent === content) {
                needsWrite = false;
            }
        }
    } catch (e) { }

    if (needsWrite) {
        fs.writeFileSync(actualFilePath, content, 'utf-8');
        if (updateFileWatcherMtimeCallback) {
            updateFileWatcherMtimeCallback(actualFilePath);
        }
    }

    const dir = path.dirname(actualFilePath);
    const baseName = path.basename(actualFilePath, path.extname(actualFilePath));

    // Use system temp directory for compiler output.
    // On POSIX `temp` is the shared /tmp, so the dir is both per-user
    // (appTempDir) and private (0700).
    const buildsDir = appTempDir('cpp-ide-builds');
    if (!fs.existsSync(buildsDir)) {
        ensurePrivateDir(buildsDir);
    }
    cleanupOldBuildArtifacts(buildsDir);

    const outputPath = path.join(buildsDir, baseName + EXE_SUFFIX);

    // ===== MULTI-FILE PROJECT SUPPORT (fast lookup) =====
    let sourceFiles = [actualFilePath];
    let linkedFiles = [];

    if (!usingTempFile && !singleFileMode) {
        try {
            if (content.includes('#include "')) {
                const includeRegex = /#include\s*"([^"]+)"/g;
                let match;
                const includedHeaders = new Set();
                while ((match = includeRegex.exec(content)) !== null) {
                    const headerBase = path.basename(match[1], path.extname(match[1])).toLowerCase();
                    if (headerBase) includedHeaders.add(headerBase);
                }

                if (includedHeaders.size > 0) {
                    const currentBase = path.basename(actualFilePath).toLowerCase();
                    const sourceExts = ['.cpp', '.c', '.cc', '.cxx'];
                    const seen = new Set();

                    for (const base of includedHeaders) {
                        for (const ext of sourceExts) {
                            const candidate = path.join(dir, base + ext);
                            const candidateName = (base + ext).toLowerCase();
                            if (candidateName === currentBase) continue;
                            if (seen.has(candidateName)) continue;

                            if (fs.existsSync(candidate)) {
                                sourceFiles.push(candidate);
                                linkedFiles.push(path.basename(candidate));
                                seen.add(candidateName);
                                break;
                            }
                        }
                    }
                }
            }
        } catch (e) { }
    }

    // Resolve flags FIRST so PCH uses the same flags as compilation
    let resolvedFlags = flags;
    if (flags) {
        const sanitized = sanitizeUserFlags(flags, content);
        resolvedFlags = sanitized.flags;

        if (sanitized.removedMwindows) {
            sendToRenderer('system-message', {
                type: 'warning',
                message: 'Ignored -mwindows for console program (main). Use WinMain if you need GUI subsystem.'
            });
        }

        const flagsArr = resolvedFlags.split(' ').filter(f => f.trim());
        const hasStdFlag = flagsArr.some(f => f.startsWith('-std='));
        if (!hasStdFlag) {
            // Inject default standard so PCH and compilation match
            resolvedFlags = '-std=c++17 ' + resolvedFlags;
        }
    } else {
        resolvedFlags = '-std=c++17 -O0 -w';
    }

    // PCH optimization - use resolvedFlags so PCH matches actual compilation
    const pch = (!noBuildCache && content.includes('bits/stdc++.h'))
        ? await ensurePCH(resolvedFlags, (msg) => sendToRenderer('system-message', msg))
        : { ready: false };

    const unbufferObj = getUnbufferObjectPath();

    const args = [
        ...sourceFiles,
        '-o', outputPath,
        '-I', dir,
        '-pipe'
    ];

    // Link the realtime-output shim (unit-buffers std::cout/cerr) so program
    // output appears line-by-line in the terminal. Skipped when the user
    // disables it for max throughput on heavy competitive-programming output.
    if (unbufferObj && realtimeOutput !== false) {
        args.push(unbufferObj);
    }

    // Apply resolved flags
    args.push(...resolvedFlags.split(' ').filter(f => f.trim()));

    const compilerExe = getDetectedCompiler() || 'g++';
    const compilerInfo = getCompilerInfo();

    // LLD Linker support
    if (useLLD !== false && compilerInfo.hasLLD) {
        args.push('-fuse-ld=lld');
    }

    // Strip only when optimization enabled to keep debug builds faster
    const hasOptimization = /(^|\s)-O(1|2|3|s|fast)(\s|$)/.test(resolvedFlags);
    if (hasOptimization) {
        args.push('-s');
    }

    if (pch.ready) {
        args.push('-I', pch.pchSubDir);
        args.push('-include', 'stdc++.h');
        console.log(`[Compile] Using PCH from: ${pch.pchSubDir}`);
    }

    console.log(`[Compile] Command: ${compilerExe} ${args.join(' ')}`);

    const env = getCompilerEnv();

    return new Promise((resolve) => {
        const compiler = spawn(compilerExe, args, { cwd: dir, env: env });
        activeCompilerProcess = compiler;

        let stderr = '';

        compiler.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        compiler.on('close', (code) => {
            // Unset if it's still us
            if (activeCompilerProcess === compiler) {
                activeCompilerProcess = null;
            } else {
                // Return cancelled state if we were killed by newer compile
                return resolve({
                    success: false,
                    cancelled: true,
                    error: 'Compilation cancelled by new request.',
                    outputPath: null,
                    time: Date.now() - startTime
                });
            }

            const compileTime = Date.now() - startTime;
            console.log(`[Compile] Finished in ${compileTime}ms (exit code: ${code})`);

            if (code !== 0) {
                // Log error for debugging
                try {
                    fs.writeFileSync(path.join(getWritableBasePath(), 'compile_error.log'), stderr);
                } catch (e) { }

                resolve({
                    success: false,
                    error: stderr || `Compilation failed with code ${code}`,
                    outputPath: null,
                    time: compileTime,
                    linkedFiles: linkedFiles
                });
            } else {
                resolve({
                    success: true,
                    message: 'Compilation successful!',
                    outputPath: outputPath,
                    warnings: stderr || '',
                    compiler: compilerInfo.name,
                    linker: (useLLD !== false && compilerInfo.hasLLD) ? 'LLD' : null,
                    time: compileTime,
                    linkedFiles: linkedFiles
                });
            }
        });

        compiler.on('error', (err) => {
            if (activeCompilerProcess === compiler) activeCompilerProcess = null;
            let errorMessage = err.message;
            if (err.code === 'ENOENT') {
                errorMessage = `Compiler not found: ${compilerExe}\n\nPlease ensure the bundled compiler is available or install MinGW/TDM-GCC.`;
                console.error(`[Compile] ENOENT - Compiler not found at: ${compilerExe}`);
            }
            resolve({
                success: false,
                error: errorMessage,
                outputPath: null
            });
        });
    });
}

/**
 * Run compiled executable in an external terminal window.
 * Dispatches to a per-platform implementation; Windows keeps the original
 * `start /wait cmd /c` behaviour untouched.
 *
 * @param {Object} options
 * @param {string} options.exePath - Path to executable
 * @param {string} [options.cwd] - Working directory
 * @returns {Promise<import('../../../shared/types').RunResult>}
 */
async function runExternal({ exePath, cwd }) {
    if (!exePath || !fs.existsSync(exePath)) {
        return { success: false, error: 'Executable not found. Please compile first.' };
    }

    const workingDir = cwd || path.dirname(exePath);
    const env = getCompilerEnv();
    const startTime = Date.now();

    if (IS_WIN) return runExternalWindows({ exePath, workingDir, env, startTime });
    if (IS_MAC) return runExternalMac({ exePath, workingDir, env, startTime });
    return runExternalLinux({ exePath, workingDir, env, startTime });
}

/**
 * Windows implementation — unchanged behaviour, just moved out of runExternal().
 * @returns {Promise<import('../../../shared/types').RunResult>}
 */
async function runExternalWindows({ exePath, workingDir, env, startTime }) {
    const exeName = path.basename(exePath);
    let peakMemoryKB = 0;
    let memoryPollInterval = null;

    const commandParts = [
        `@echo off`,
        `cls`,
        `"${exePath}"`,
        `echo.`,
        `echo.`,
        `echo --------------------------------`,
        `echo Program finished. Press any key to close...`,
        `pause >nul`
    ];

    const shellCommand = commandParts.join(' & ');
    // Open in a dedicated external CMD window and wait for it to fully close.
    const waitCommand = `start "" /wait cmd /c "${shellCommand}"`;
    const externalShell = exec(waitCommand, {
        cwd: workingDir,
        env,
        windowsHide: false
    });

    // Windows-only: on POSIX the program runs as a grandchild of the terminal
    // emulator (see phase-05), so we have no reliable pid to sample. External
    // runs therefore report peakMemoryKB = 0 on Linux/macOS by design.
    const pollExternalMemory = () => {
        if (process.platform !== 'win32') return;
        exec(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, (err, stdout) => {
            if (err || !stdout) return;

            const rows = String(stdout)
                .split(/\r?\n/)
                .map((r) => r.trim())
                .filter((r) => r && !/^INFO:/i.test(r));

            for (const row of rows) {
                const match = row.match(/"([0-9][0-9.,\s]*)\s*K"/i);
                if (!match) continue;
                const memKB = parseInt(match[1].replace(/[,\.\s]/g, ''), 10);
                if (!Number.isNaN(memKB) && memKB > peakMemoryKB) {
                    peakMemoryKB = memKB;
                }
            }
        });
    };

    if (process.platform === 'win32') {
        pollExternalMemory();
        memoryPollInterval = setInterval(pollExternalMemory, 500);
    }

    externalShell.on('exit', () => {
        if (memoryPollInterval) {
            clearInterval(memoryPollInterval);
            memoryPollInterval = null;
        }

        const execTime = Date.now() - startTime;
        sendToRenderer('process-external-exit', {
            executionTime: execTime,
            peakMemoryKB
        });
    });

    externalShell.on('error', () => {
        if (memoryPollInterval) {
            clearInterval(memoryPollInterval);
            memoryPollInterval = null;
        }
    });

    sendToRenderer('process-external-started');
    return { success: true, external: true, message: 'Running in external terminal' };
}

/**
 * Build the shell script that a POSIX terminal emulator will execute: run the
 * program, show the exit code, then wait for a keypress so the window does not
 * vanish instantly.
 *
 * Paths are single-quoted (with `'` escaped as `'\''`) so spaces, `$`, backticks
 * and double quotes in the path are all inert.
 *
 * @param {string} exePath
 * @param {string} workingDir
 * @returns {string}
 */
function buildPosixRunnerScript(exePath, workingDir) {
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    return [
        '#!/usr/bin/env bash',
        '# self-delete: the file stays readable via the open fd while bash runs it',
        'rm -f -- "$0"',
        `cd ${q(workingDir)} || exit 1`,
        'clear',
        `${q(exePath)}`,
        'CODE=$?',
        'echo',
        'echo "--------------------------------"',
        'echo "Program finished (exit code: $CODE). Press ENTER to close..."',
        'read -r _',
    ].join('\n') + '\n';
}

/** Remove leftover runner scripts (crash / terminal killed before self-delete). */
function sweepStaleRunnerScripts() {
    try {
        const dir = os.tmpdir();
        const cutoff = Date.now() - 6 * 60 * 60 * 1000;   // 6h
        for (const name of fs.readdirSync(dir)) {
            if (!/^sameko-run-.*\.(sh|command)$/.test(name)) continue;
            const full = path.join(dir, name);
            try {
                if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
            } catch (_) { }
        }
    } catch (_) { }
}

// Ordered by "most likely to be installed AND behaves correctly".
// `waits: true`  -> the spawned process stays alive until the window closes
//                   => child 'exit' is a trustworthy end-of-run signal.
// `waits: false` -> it forks immediately; we must NOT treat 'exit' as end-of-run.
const LINUX_TERMINALS = [
    { bin: 'konsole', waits: true, args: (s) => ['--nofork', '-e', 'bash', s] },
    { bin: 'gnome-terminal', waits: true, args: (s) => ['--wait', '--', 'bash', s] },
    { bin: 'xterm', waits: true, args: (s) => ['-e', 'bash', s] },
    { bin: 'alacritty', waits: true, args: (s) => ['-e', 'bash', s] },
    { bin: 'wezterm', waits: true, args: (s) => ['start', '--', 'bash', s] },
    { bin: 'kitty', waits: true, args: (s) => ['bash', s] },
    { bin: 'xfce4-terminal', waits: true, args: (s) => ['--disable-server', '-x', 'bash', s] },
    { bin: 'mate-terminal', waits: false, args: (s) => ['--', 'bash', s] },
    { bin: 'tilix', waits: false, args: (s) => ['-e', `bash ${s}`] },
    // Debian's generic alternative — LAST on purpose: it may resolve to
    // gnome-terminal, whose `-e` is deprecated/removed in newer versions, so we
    // only reach for it when nothing above exists.
    { bin: 'x-terminal-emulator', waits: false, args: (s) => ['-e', 'bash', s] },
];

/** @returns {{bin:string, waits:boolean, args:Function}|null} */
function findLinuxTerminal() {
    for (const t of LINUX_TERMINALS) {
        if (which(t.bin)) return t;
    }
    return null;
}

/**
 * Linux implementation — write a runner script to tmp, hand it to whichever
 * terminal emulator is installed.
 * @returns {Promise<import('../../../shared/types').RunResult>}
 */
async function runExternalLinux({ exePath, workingDir, env, startTime }) {
    sweepStaleRunnerScripts();

    const term = findLinuxTerminal();
    if (!term) {
        return {
            success: false,
            error: 'No terminal emulator found. Install one of: gnome-terminal, konsole, xterm — '
                + 'or turn off "Run in external terminal" in Settings.',
        };
    }

    const scriptPath = path.join(os.tmpdir(), `sameko-run-${process.pid}-${Date.now()}.sh`);
    try {
        fs.writeFileSync(scriptPath, buildPosixRunnerScript(exePath, workingDir), { mode: 0o700 });
    } catch (err) {
        return { success: false, error: `Failed to prepare runner script: ${err.message}` };
    }

    let child;
    try {
        // spawn (not exec) — no shell, so no quoting problems with the args array.
        child = spawn(term.bin, term.args(scriptPath), { cwd: workingDir, env });
    } catch (err) {
        try { fs.unlinkSync(scriptPath); } catch (_) { }
        return { success: false, error: `Failed to launch ${term.bin}: ${err.message}` };
    }

    child.on('error', (err) => {
        console.warn(`[Run] external terminal error (${term.bin}):`, err.message);
        try { fs.unlinkSync(scriptPath); } catch (_) { }
        // Let the UI leave "running" state instead of hanging forever.
        sendToRenderer('process-external-exit', { executionTime: Date.now() - startTime, peakMemoryKB: 0 });
    });

    child.on('exit', () => {
        // NOTE: do NOT unlink scriptPath here — forking terminals fire 'exit'
        // immediately and the script would vanish before bash reads it. The script
        // deletes itself (`rm -f -- "$0"`); sweepStaleRunnerScripts() is the backstop.
        if (!term.waits) return;   // meaningless timing for forking terminals
        sendToRenderer('process-external-exit', {
            executionTime: Date.now() - startTime,
            peakMemoryKB: 0,       // no reliable pid through the terminal — see phase-04 4B
        });
    });

    if (!term.waits) {
        // The terminal detached; we will never learn when the program ends.
        // Tell the UI right away so it doesn't sit in "running" forever.
        sendToRenderer('process-external-exit', { executionTime: 0, peakMemoryKB: 0 });
    }

    sendToRenderer('process-external-started');
    return { success: true, external: true, message: `Running in external terminal (${term.bin})` };
}

/**
 * macOS implementation — hand a .command script to Terminal.app. `open` returns
 * immediately, so there is no reliable exit signal.
 * @returns {Promise<import('../../../shared/types').RunResult>}
 */
async function runExternalMac({ exePath, workingDir, env, startTime }) {
    sweepStaleRunnerScripts();
    const scriptPath = path.join(os.tmpdir(), `sameko-run-${process.pid}-${Date.now()}.command`);
    try {
        fs.writeFileSync(scriptPath, buildPosixRunnerScript(exePath, workingDir), { mode: 0o700 });
    } catch (err) {
        return { success: false, error: `Failed to prepare runner script: ${err.message}` };
    }
    const child = spawn('open', ['-a', 'Terminal', scriptPath], { cwd: workingDir, env });
    child.on('error', () => { try { fs.unlinkSync(scriptPath); } catch (_) { } });

    sendToRenderer('process-external-started');
    sendToRenderer('process-external-exit', { executionTime: 0, peakMemoryKB: 0 });
    return { success: true, external: true, message: 'Running in external terminal' };
}

/**
 * Run compiled executable
 *
 * @param {Object} options
 * @param {string} options.exePath - Path to executable
 * @param {string} [options.cwd] - Working directory
 * @returns {Promise<import('../../../shared/types').RunResult>}
 */
async function run({ exePath, cwd }) {
    if (!exePath || !fs.existsSync(exePath)) {
        return { success: false, error: 'Executable not found. Please compile first.' };
    }

    const workingDir = cwd || path.dirname(exePath);
    const runStartTime = Date.now();
    let peakMemoryKB = 0;

    const env = getCompilerEnv();

    runningProcess = spawn(exePath, [], {
        cwd: workingDir,
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    runningExeName = path.basename(exePath);
    lastRunningPID = runningProcess.pid;

    const pid = runningProcess.pid;

    // Memory polling. Windows: `tasklist` (instantaneous working set, so we
    // keep the running max). Linux: /proc/<pid>/status VmHWM, which IS the
    // kernel-tracked peak — one successful read is enough.
    const pollMemory = () => {
        if (!runningProcess || !pid) return;
        if (IS_WIN) {
            exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
                if (!err && stdout) {
                    const match = stdout.match(/"([0-9][0-9.,\s]*)\s*K"/i);
                    if (match) {
                        const memKB = parseInt(match[1].replace(/[,.\s]/g, ''), 10);
                        if (memKB > peakMemoryKB) {
                            peakMemoryKB = memKB;
                        }
                    }
                }
            });
        } else {
            const memKB = readProcMemoryKB(pid);   // VmHWM on Linux; 0 on macOS
            if (memKB > peakMemoryKB) peakMemoryKB = memKB;
        }
    };

    // Start memory polling
    if (pid && (IS_WIN || IS_LINUX)) {
        pollMemory();
        runningMemoryPollInterval = setInterval(pollMemory, IS_WIN ? 500 : 100);
    }

    // Coalesce program output: a tight `while(1) cout<<...` loop fires the
    // 'data' event thousands of times per second. Emitting one IPC message per
    // chunk floods the renderer and lags the machine, so batch chunks and flush
    // on a short timer (~24ms) or once the pending buffer crosses a size cap.
    // We do NOT retain the full output (it was previously accumulated into
    // unused `output`/`errorOutput` strings -> unbounded memory under infinite
    // loops); we only hold what hasn't been flushed yet.
    const FLUSH_INTERVAL_MS = 24;
    const FLUSH_THRESHOLD_BYTES = 64 * 1024;

    let pendingOut = '';
    let pendingErr = '';
    let flushTimer = null;

    const flush = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (pendingOut) {
            sendToRenderer('process-output', pendingOut);
            pendingOut = '';
        }
        if (pendingErr) {
            sendToRenderer('process-error', pendingErr);
            pendingErr = '';
        }
    };

    const scheduleFlush = () => {
        if (pendingOut.length + pendingErr.length >= FLUSH_THRESHOLD_BYTES) {
            flush();
            return;
        }
        if (!flushTimer) {
            flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
        }
    };

    runningProcess.stdout.on('data', (data) => {
        pendingOut += data.toString();
        scheduleFlush();
    });

    runningProcess.stderr.on('data', (data) => {
        pendingErr += data.toString();
        scheduleFlush();
    });

    runningProcess.on('close', (code) => {
        flush(); // emit any buffered output before signalling exit
        if (runningMemoryPollInterval) {
            clearInterval(runningMemoryPollInterval);
            runningMemoryPollInterval = null;
        }
        const executionTime = Date.now() - runStartTime;
        runningProcess = null;
        sendToRenderer('process-exit', {
            code,
            executionTime,
            peakMemoryKB
        });
    });

    runningProcess.on('error', (err) => {
        flush();
        if (runningMemoryPollInterval) {
            clearInterval(runningMemoryPollInterval);
            runningMemoryPollInterval = null;
        }
        runningProcess = null;
    });

    // Send initial signal
    sendToRenderer('process-started');
    return { success: true, started: true, pid };
}

/**
 * Send input to running process
 * @param {string} input
 * @returns {{success: boolean, error?: string}}
 */
function sendInput(input) {
    if (runningProcess && runningProcess.stdin) {
        // If input contains newlines, send as-is (bulk input mode)
        // Otherwise add newline for single-line input
        if (input.includes('\n')) {
            runningProcess.stdin.write(input + '\n');
        } else {
            runningProcess.stdin.write(input + '\n');
        }
        return { success: true };
    }
    return { success: false, error: 'No running process' };
}

/**
 * Stop running process
 */
function stopProcess() {
    // Clear memory polling
    if (runningMemoryPollInterval) {
        clearInterval(runningMemoryPollInterval);
        runningMemoryPollInterval = null;
    }

    // KILL STRATEGY 1: Taskkill by PID (Windows)
    if (lastRunningPID && process.platform === 'win32') {
        exec(`taskkill /pid ${lastRunningPID} /f /t`, () => { });
    }

    // KILL STRATEGY 2: Taskkill by Image Name (Windows)
    const targetExes = new Set();
    if (runningExeName) targetExes.add(runningExeName);
    targetExes.add('temp_code.exe');

    if (process.platform === 'win32') {
        for (const exe of targetExes) {
            exec(`taskkill /im ${exe} /f`, () => { });
        }
    }

    // KILL STRATEGY 3: Node Process Kill (PID) — also the primary path on POSIX.
    // NOTE: this kills only the process itself, not a forked child tree. Killing a
    // group would require spawning run() with `detached: true`, which risks breaking
    // the stdin/stdout pipes the output panel depends on. Single-process programs
    // (the CP use case) are fully covered. Revisit only if a real need appears.
    if (lastRunningPID) {
        try {
            process.kill(lastRunningPID, 'SIGKILL');
        } catch (e) { }
    }

    // KILL STRATEGY 4: Object Kill & Pipe Destruction
    if (runningProcess) {
        if (runningProcess.stdin) runningProcess.stdin.destroy();
        if (runningProcess.stdout) runningProcess.stdout.destroy();
        if (runningProcess.stderr) runningProcess.stderr.destroy();
        runningProcess.kill();
        runningProcess = null;
    }

    // Notify UI
    sendToRenderer('process-stopped');
}

function isProcessRunning() {
    return runningProcess !== null;
}

function getRunningProcess() {
    return runningProcess;
}

module.exports = {
    compile,
    run,
    runExternal,
    sendInput,
    stopProcess,
    isProcessRunning,
    getRunningProcess,
    setFileWatcherCallback,
    setSendToRendererCallback,
};
