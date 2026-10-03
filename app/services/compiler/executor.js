/**
 * Sameko Dev C++ IDE - Compiler Executor
 * Handles compilation and execution of C++ programs
 * @module app/services/compiler/executor
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, exec, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { getDetectedCompiler, getCompilerInfo, getCompilerEnv, getWritableBasePath, getUnbufferObjectPath } = require('./detector');
const { ensurePCH } = require('./pch-manager');
const { getLauncherIfReady, newStatsFile, readStats } = require('./run-launcher');
const { validateCompilerFlags } = require('../../shared/validators');
const { EXE_SUFFIX, IS_WIN, IS_MAC, IS_LINUX, ensurePrivateDir, readProcMemoryKB, which, appTempDir } = require('../../shared/platform');

let runningProcess = null;
let activeCompilerProcess = null;

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
 * Terminate every process whose executable is exactly `exePath` (Windows).
 * The path travels through an environment variable, so nothing from a file
 * name is ever interpolated into a command line.
 * @param {string} exePath
 * @returns {Promise<void>}
 */
function killProcessesByExePath(exePath) {
    return new Promise((resolve) => {
        const script = '$p = $env:SAMEKO_KILL_EXE; '
            + 'Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($p)) -ErrorAction SilentlyContinue | '
            + 'Where-Object { $_.Path -eq $p } | Stop-Process -Force -ErrorAction SilentlyContinue';
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            env: { ...process.env, SAMEKO_KILL_EXE: exePath },
            windowsHide: true,
            timeout: 5000
        }, () => resolve());
    });
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

    // Terminate any running process and release executable locks
    stopProcess();

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

    // Tag the artifact with a hash of the full source path: every contest has
    // an A.cpp, and two of them used to share (and overwrite) one A.exe.
    const outputTag = usingTempFile
        ? ''
        : '-' + crypto.createHash('sha1').update(path.resolve(actualFilePath).toLowerCase()).digest('hex').slice(0, 8);
    const outputPath = path.join(buildsDir, baseName + outputTag + EXE_SUFFIX);

    // Release file lock on target output executable if it exists
    if (fs.existsSync(outputPath)) {
        try {
            fs.unlinkSync(outputPath);
        } catch (e) {
            if (IS_WIN) {
                // Something still holds the file — typically a previous run in an
                // external terminal, which we have no handle for. Terminate only
                // processes whose image IS this exact file, never by name alone.
                await killProcessesByExePath(outputPath);
                try {
                    fs.unlinkSync(outputPath);
                } catch (_) { }
            }
        }
    }

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

    // Link libstdc++exp for C++23/C++26 experimental stdlib features (such as std::print, std::println, <stacktrace>)
    const isCpp23Or26 = /-std=(c\+\+|gnu\+\+)(23|26|2b|2c)/.test(resolvedFlags) || /#include\s*<print>|#include\s*<stacktrace>/.test(content);
    if (isCpp23Or26 && !args.includes('-lstdc++exp')) {
        args.push('-lstdc++exp');
    }

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

    // "Run only" pressed while a program is still running: never orphan it.
    stopProcess();

    const workingDir = cwd || path.dirname(exePath);
    const runStartTime = Date.now();
    let peakMemoryKB = 0;

    const env = getCompilerEnv();

    // Windows: run through the native launcher when it is available. It
    // reports the exact wall time and peak memory of the program itself, so no
    // sampling is needed (see run-launcher.js).
    const launcher = getLauncherIfReady();
    const statsFile = launcher ? newStatsFile() : null;

    runningProcess = launcher
        ? spawn(launcher, [statsFile, exePath], { cwd: workingDir, env: env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        : spawn(exePath, [], { cwd: workingDir, env: env, stdio: ['pipe', 'pipe', 'pipe'] });

    const child = runningProcess;
    const pid = child.pid;

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

    // Start memory polling. On Windows each sample spawns `tasklist` (~150 ms),
    // so the first one is delayed: a typical short run finishes before it and
    // is no longer slowed down by a sampler that could not have reported
    // anything for it anyway. Linux reads /proc, which is cheap.
    if (pid && IS_LINUX) pollMemory();
    if (pid && !launcher && (IS_WIN || IS_LINUX)) {
        runningMemoryPollInterval = setInterval(pollMemory, IS_WIN ? 500 : 100);
    }

    // Program output is batched and RATE-LIMITED with real flow control.
    // A tight `while(1) cout<<...` loop produces tens of MB per second; pushing
    // that to the renderer froze the whole window for ~25 s and made Stop
    // unreachable. So: at most FLUSH_MAX_CHARS go out per tick, and once the
    // backlog passes HIGH_WATER the pipes are paused, which blocks the child on
    // write() until the terminal has caught up. Nothing is dropped, memory stays
    // bounded, and normal programs (well under the budget) are unaffected.
    const FLUSH_INTERVAL_MS = 30;
    const FLUSH_MAX_CHARS = 32 * 1024;       // per tick  => ~1 MB/s to the terminal
    const HIGH_WATER_CHARS = 128 * 1024;     // pause the pipes above this backlog
    const LOW_WATER_CHARS = 32 * 1024;       // resume below this

    // StringDecoder keeps a multi-byte UTF-8 character that straddles two
    // chunks intact (plain toString() turned it into two replacement chars).
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');

    let pendingOut = '';
    let pendingErr = '';
    let flushTimer = null;
    let paused = false;

    const backlog = () => pendingOut.length + pendingErr.length;

    const setPaused = (value) => {
        if (paused === value) return;
        paused = value;
        for (const stream of [child.stdout, child.stderr]) {
            if (!stream || stream.destroyed) continue;
            if (value) stream.pause(); else stream.resume();
        }
    };

    // Send up to `budget` chars (everything when budget is Infinity).
    const flush = (budget = FLUSH_MAX_CHARS) => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (pendingOut) {
            const part = pendingOut.length > budget ? pendingOut.slice(0, budget) : pendingOut;
            pendingOut = pendingOut.slice(part.length);
            budget -= part.length;
            sendToRenderer('process-output', part);
        }
        if (pendingErr && budget > 0) {
            const part = pendingErr.length > budget ? pendingErr.slice(0, budget) : pendingErr;
            pendingErr = pendingErr.slice(part.length);
            sendToRenderer('process-error', part);
        }
        if (backlog() <= LOW_WATER_CHARS) setPaused(false);
        if (backlog() > 0) scheduleFlush();
    };

    const scheduleFlush = () => {
        if (backlog() >= HIGH_WATER_CHARS) setPaused(true);
        if (!flushTimer) {
            flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
        }
    };

    child.stdout.on('data', (data) => {
        pendingOut += outDecoder.write(data);
        scheduleFlush();
    });

    child.stderr.on('data', (data) => {
        pendingErr += errDecoder.write(data);
        scheduleFlush();
    });

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        pendingOut += outDecoder.end();
        pendingErr += errDecoder.end();
        // Emit whatever is left before signalling exit — unless the user
        // pressed Stop, in which case the backlog is discarded on purpose.
        if (runningProcess === child) flush(Infinity);
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        pendingOut = '';
        pendingErr = '';
        // Only forget the process if it is still the current one — a newer
        // run() may already have replaced it (and owns the poll timer now).
        if (runningProcess === child) {
            if (runningMemoryPollInterval) {
                clearInterval(runningMemoryPollInterval);
                runningMemoryPollInterval = null;
            }
            runningProcess = null;
            return true;
        }
        return false;
    };

    child.on('close', (code) => {
        const wasCurrent = finish();
        const stats = readStats(statsFile); // also removes the file
        // A process stopped by the user already reported 'process-stopped'.
        if (!wasCurrent) return;
        sendToRenderer('process-exit', {
            code,
            executionTime: stats ? Math.round(stats.wallMs) : Date.now() - runStartTime,
            cpuTime: stats ? Math.round(stats.cpuMs) : null,
            peakMemoryKB: stats ? stats.peakKB : peakMemoryKB
        });
    });

    child.on('error', () => {
        finish();
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
    if (runningProcess && runningProcess.stdin && !runningProcess.stdin.destroyed) {
        runningProcess.stdin.write(input + '\n');
        return { success: true };
    }
    return { success: false, error: 'No running process' };
}

/**
 * Stop the program started by run(), if any.
 *
 * Kills ONLY the process this module spawned, by its PID while we still hold
 * the handle (so the PID cannot have been recycled). It used to also run
 * `taskkill /im <name>.exe`, which terminated every process on the machine
 * with that image name — a source file called explorer.cpp took the Windows
 * shell down with it.
 * @returns {boolean} whether a process was actually stopped
 */
function stopProcess() {
    const child = runningProcess;
    if (!child) return false;
    runningProcess = null;

    if (runningMemoryPollInterval) {
        clearInterval(runningMemoryPollInterval);
        runningMemoryPollInterval = null;
    }

    const pid = child.pid;
    // Windows: /t takes the whole tree, in case the program spawned children.
    if (IS_WIN && pid && child.exitCode === null) {
        execFile('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true }, () => { });
    }

    // Tear the pipes down first so no buffered output arrives after "Stopped".
    // NOTE (POSIX): this kills only the process itself, not a forked child tree.
    // Killing a group would require spawning run() with `detached: true`, which
    // risks breaking the stdin/stdout pipes the output panel depends on.
    try { if (child.stdin) child.stdin.destroy(); } catch (_) { }
    try { if (child.stdout) child.stdout.destroy(); } catch (_) { }
    try { if (child.stderr) child.stderr.destroy(); } catch (_) { }
    try { child.kill('SIGKILL'); } catch (_) { }

    sendToRenderer('process-stopped');
    return true;
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
