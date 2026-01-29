/**
 * Sameko Dev C++ IDE - Compiler Executor
 * Handles compilation and execution of C++ programs
 * @module app/services/compiler/executor
 */

'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { getDetectedCompiler, getCompilerInfo, getCompilerEnv, getBasePath } = require('./detector');
const { ensurePCH } = require('./pch-manager');

let runningProcess = null;

let lastRunningPID = null;

let runningExeName = null;

let runningMemoryPollInterval = null;

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
async function compile({ filePath, content, flags, useLLD }) {
    const startTime = Date.now();

    // Kill any running process first (to release .exe lock)
    if (runningProcess) {
        runningProcess.kill();
        runningProcess = null;
        // Minimal delay - just enough to release file lock
        await new Promise(r => setTimeout(r, 50));
    }

    // Use temp file if no filePath provided (unsaved file)
    let actualFilePath = filePath;
    let usingTempFile = false;

    if (!filePath) {
        const tempDir = path.join(app.getPath('temp'), 'cpp-ide');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
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

    // Use system temp directory for .exe output
    const buildsDir = path.join(app.getPath('temp'), 'cpp-ide-builds');
    if (!fs.existsSync(buildsDir)) {
        fs.mkdirSync(buildsDir, { recursive: true });
    }
    const outputPath = path.join(buildsDir, baseName + '.exe');

    // ===== MULTI-FILE PROJECT SUPPORT =====
    let sourceFiles = [actualFilePath];
    let linkedFiles = [];

    if (!usingTempFile) {
        try {
            if (content.includes('#include "')) {
                const includeRegex = /#include\s*"([^"]+)"/g;
                let match;
                const includedHeaders = new Set();
                while ((match = includeRegex.exec(content)) !== null) {
                    const headerBase = path.basename(match[1], path.extname(match[1])).toLowerCase();
                    includedHeaders.add(headerBase);
                }

                if (includedHeaders.size > 0) {
                    const allFiles = fs.readdirSync(dir);
                    for (const file of allFiles) {
                        const ext = path.extname(file).toLowerCase();
                        if ((ext === '.cpp' || ext === '.c' || ext === '.cc' || ext === '.cxx') &&
                            file.toLowerCase() !== path.basename(actualFilePath).toLowerCase()) {
                            const cppBase = path.basename(file, ext).toLowerCase();
                            if (includedHeaders.has(cppBase)) {
                                sourceFiles.push(path.join(dir, file));
                                linkedFiles.push(file);
                            }
                        }
                    }
                }
            }
        } catch (e) { }
    }

    // PCH optimization
    const pch = (content.includes('bits/stdc++.h'))
        ? await ensurePCH(flags, (msg) => sendToRenderer('system-message', msg))
        : { ready: false };

    // Build args
    const args = [
        ...sourceFiles,
        '-o', outputPath,
        '-I', dir,
        '-pipe',
        '-s'
    ];

    // Apply user flags
    if (flags) {
        const flagsArr = flags.split(' ').filter(f => f.trim());
        args.push(...flagsArr);
    } else {
        args.push('-O0', '-w');
    }

    const compilerExe = getDetectedCompiler() || 'g++';
    const compilerInfo = getCompilerInfo();

    // LLD Linker support
    if (useLLD !== false && compilerInfo.hasLLD) {
        args.push('-fuse-ld=lld');
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

        let stderr = '';

        compiler.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        compiler.on('close', (code) => {
            const compileTime = Date.now() - startTime;
            console.log(`[Compile] Finished in ${compileTime}ms`);

            if (code !== 0) {
                // Log error for debugging
                try {
                    fs.writeFileSync(path.join(getBasePath(), 'compile_error.log'), stderr);
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
 * Run compiled executable in external CMD window (Windows only)
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
    const exeName = path.basename(exePath);
    const startTime = Date.now();

    // Simple CMD output with separator
    const title = `C++ Program - ${exeName}`;
    const innerCommand = [
        `@echo off`,
        `cls`,
        `"${exePath}"`,
        `echo.`,
        `echo.`,
        `echo --------------------------------`,
        `echo Program finished. Press any key to close...`,
        `pause >nul`
    ].join(" & ");
    const command = `start "${title}" /D "${workingDir}" cmd /c "${innerCommand}"`;
    exec(command, {
        cwd: workingDir,
        env: env,
        windowsHide: false
    }, () => {
        // Callback when CMD window closes
        const execTime = Date.now() - startTime;
        sendToRenderer('process-external-exit', { executionTime: execTime });
    });

    sendToRenderer('process-external-started');
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

    // Memory polling function (Windows only)
    const pollMemory = () => {
        if (!runningProcess || !pid) return;
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
    };

    // Start memory polling
    if (pid && process.platform === 'win32') {
        pollMemory();
        runningMemoryPollInterval = setInterval(pollMemory, 500);
    }

    let output = '';
    let errorOutput = '';

    runningProcess.stdout.on('data', (data) => {
        output += data.toString();
        sendToRenderer('process-output', data.toString());
    });

    runningProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        sendToRenderer('process-error', data.toString());
    });

    runningProcess.on('close', (code) => {
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
        runningProcess.stdin.write(input + '\n');
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

    // KILL STRATEGY 3: Node Process Kill (PID)
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
