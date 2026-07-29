/**
 * Sameko Dev C++ IDE - Batch Tester
 * Run test cases against compiled executables
 * @module app/services/competitive/batch-tester
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');
const { getCompilerEnv } = require('../compiler/detector');
const { normalizeOutput, compareOutputs } = require('../../shared/judge');
const { IS_WIN, IS_LINUX, readProcMemoryKB } = require('../../shared/platform');

/**
 * Run a single test case
 * 
 * @param {Object} options
 * @param {string} options.exePath - Path to executable
 * @param {string} options.input - Test input
 * @param {string} [options.expectedOutput] - Expected output for comparison
 * @param {number} [options.timeLimit=3000] - Time limit in ms
 * @param {string} [options.cwd] - Working directory
 * @returns {Promise<import('../../../shared/types').BatchTestResult>}
 */
async function runTest({ exePath, input, expectedOutput, timeLimit = 3000, cwd, debug = false, testMeta = null }) {
    return new Promise((resolve) => {
        if (!exePath || !fs.existsSync(exePath)) {
            resolve({ status: 'CE', error: 'Executable not found' });
            return;
        }

        const debugInfo = {
            enabled: !!debug,
            testMeta,
            pid: null,
            exitCode: null,
            signal: null,
            timeoutKilled: false,
            inputHash: hashText(input || ''),
            expectedHash: expectedOutput !== undefined && expectedOutput !== null ? hashText(expectedOutput) : null,
            actualHash: null,
            expectedNormHash: null,
            actualNormHash: null,
            hadStderr: false,
            stderrPreview: '',
        };

        const workingDir = cwd || path.dirname(exePath);
        let output = '';
        let errorOutput = '';
        let killed = false;
        let peakMemoryKB = 0;
        let memoryPollInterval = null;

        // Create test process
        const testProcess = spawn(exePath, [], {
            cwd: workingDir,
            env: getCompilerEnv(),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const pid = testProcess.pid;
        debugInfo.pid = pid || null;

        // Memory polling. Windows: tasklist (instantaneous, keep running max).
        // Linux: /proc/<pid>/status VmHWM = kernel-tracked peak.
        const pollMemory = () => {
            if (!testProcess || !pid) return;
            if (IS_WIN) {
                exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
                    if (!err && stdout) {
                        const match = stdout.match(/"([0-9][0-9.,\s]*)\s*K"/i);
                        if (match) {
                            const memKB = parseInt(match[1].replace(/[,.\s]/g, ''), 10);
                            if (memKB > peakMemoryKB) peakMemoryKB = memKB;
                        }
                    }
                });
            } else {
                const memKB = readProcMemoryKB(pid);
                if (memKB > peakMemoryKB) peakMemoryKB = memKB;
            }
        };

        if (pid && (IS_WIN || IS_LINUX)) {
            pollMemory();
            memoryPollInterval = setInterval(pollMemory, IS_WIN ? 500 : 100);
        }

        // Set timeout
        const timeout = setTimeout(() => {
            killed = true;
            debugInfo.timeoutKilled = true;
            testProcess.kill();
            // POSIX: kill() is SIGTERM, which a program can trap/ignore. Escalate to
            // SIGKILL shortly after so one bad submission can't hang the whole batch.
            if (!IS_WIN) {
                setTimeout(() => {
                    try { if (testProcess.exitCode === null && testProcess.signalCode === null) process.kill(testProcess.pid, 'SIGKILL'); } catch (_) { }
                }, 200);
            }
        }, timeLimit);

        // Send input and start timing
        let startTime;
        if (input) {
            testProcess.stdin.write(input);
        }
        testProcess.stdin.end();
        startTime = Date.now();

        testProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        testProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        testProcess.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (memoryPollInterval) clearInterval(memoryPollInterval);

            const executionTime = Date.now() - startTime;

            debugInfo.exitCode = code;
            debugInfo.signal = signal || null;
            debugInfo.actualHash = hashText(output || '');

            // Determine status
            let status = 'AC';
            let details = '';

            if (killed) {
                status = 'TLE';
                details = 'Time limit exceeded';
            } else if (code !== 0) {
                status = 'RE';
                const reason = signal
                    ? `signal: ${signal}`
                    : `exit code: ${code}`;
                const errPreview = truncate(normalizeOutput(errorOutput || ''), 160);
                debugInfo.hadStderr = !!(errorOutput && errorOutput.length > 0);
                debugInfo.stderrPreview = errPreview;
                details = `Runtime error (${reason})${errPreview ? `\nStderr: ${errPreview}` : ''}`;
            } else if (expectedOutput !== undefined && expectedOutput !== null) {
                const expectedText = String(expectedOutput ?? '');
                const hasExpected = expectedText.trim().length > 0;

                // If expected is blank, treat as run-only (do not judge WA).
                // This avoids false WA when users only want to execute and inspect output.
                if (hasExpected) {
                    // Compare output using shared judge rules
                    const compared = compareOutputs(output, expectedOutput);
                    debugInfo.expectedNormHash = hashText(compared.expectedNorm);
                    debugInfo.actualNormHash = hashText(compared.actualNorm);

                    if (!compared.matched) {
                        status = 'WA';
                        details = `Expected: ${truncate(compared.expectedNorm, 100)}\nGot: ${truncate(compared.actualNorm, 100)}`;
                    }
                }
            }

            const response = {
                status,
                output: output,
                error: errorOutput,
                executionTime,
                peakMemoryKB,
                details
            };

            if (debugInfo.enabled) {
                response.debug = {
                    ...debugInfo,
                    status,
                    executionTime,
                    peakMemoryKB,
                };
            }

            resolve(response);
        });

        testProcess.on('error', (err) => {
            clearTimeout(timeout);
            if (memoryPollInterval) clearInterval(memoryPollInterval);

            const response = { status: 'RE', error: err.message, executionTime: 0 };
            if (debugInfo.enabled) {
                response.debug = {
                    ...debugInfo,
                    status: 'RE',
                    spawnError: err.message,
                };
            }
            resolve(response);
        });
    });
}

/**
 * Run multiple test cases
 * 
 * @param {Object} options
 * @param {string} options.exePath - Path to executable
 * @param {Array<{input: string, expectedOutput: string}>} options.tests - Test cases
 * @param {number} [options.timeLimit=3000] - Time limit per test
 * @param {string} [options.cwd] - Working directory
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<import('../../../shared/types').BatchTestResult[]>}
 */
async function runBatchTests({ exePath, tests, timeLimit = 3000, cwd, onProgress, debug = false }) {
    const results = [];

    for (let i = 0; i < tests.length; i++) {
        const test = tests[i];

        if (onProgress) {
            onProgress({ current: i + 1, total: tests.length, testId: test.id || i });
        }

        const result = await runTest({
            exePath,
            input: test.input,
            expectedOutput: test.expectedOutput,
            timeLimit,
            cwd,
            debug,
            testMeta: { index: i, id: test.id || String(i) },
        });

        results.push({
            testId: test.id || String(i),
            ...result
        });
    }

    return results;
}

/**
 * Truncate string
 * @param {string} s
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(s, maxLen) {
    if (s.length <= maxLen) return s;
    return s.substring(0, maxLen) + '...';
}

function hashText(text) {
    return crypto
        .createHash('sha256')
        .update(String(text ?? ''), 'utf8')
        .digest('hex')
        .slice(0, 12);
}

module.exports = {
    runTest,
    runBatchTests,
    normalizeOutput,
    compareOutputs,
};
