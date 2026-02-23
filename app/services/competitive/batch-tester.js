/**
 * Sameko Dev C++ IDE - Batch Tester
 * Run test cases against compiled executables
 * @module app/services/competitive/batch-tester
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const { getCompilerEnv } = require('../compiler/detector');

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
async function runTest({ exePath, input, expectedOutput, timeLimit = 3000, cwd }) {
    return new Promise((resolve) => {
        if (!exePath || !fs.existsSync(exePath)) {
            resolve({ status: 'CE', error: 'Executable not found' });
            return;
        }

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

        // Memory polling (Windows)
        const pollMemory = () => {
            if (!testProcess || !pid) return;
            exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
                if (!err && stdout) {
                    const match = stdout.match(/"([0-9][0-9.,\s]*)\s*K"/i);
                    if (match) {
                        const memKB = parseInt(match[1].replace(/[,.\s]/g, ''), 10);
                        if (memKB > peakMemoryKB) peakMemoryKB = memKB;
                    }
                }
            });
        };

        if (pid && process.platform === 'win32') {
            pollMemory();
            memoryPollInterval = setInterval(pollMemory, 500);
        }

        // Set timeout
        const timeout = setTimeout(() => {
            killed = true;
            testProcess.kill();
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

        testProcess.on('close', (code) => {
            clearTimeout(timeout);
            if (memoryPollInterval) clearInterval(memoryPollInterval);

            const executionTime = Date.now() - startTime;

            // Determine status
            let status = 'AC';
            let details = '';

            if (killed) {
                status = 'TLE';
                details = 'Time limit exceeded';
            } else if (code !== 0) {
                status = 'RE';
                details = `Runtime error (exit code: ${code})`;
            } else if (expectedOutput) {
                // Compare output (flexible: ignore trailing whitespace)
                const actualNorm = normalizeOutput(output);
                const expectedNorm = normalizeOutput(expectedOutput);

                if (actualNorm !== expectedNorm) {
                    status = 'WA';
                    details = `Expected: ${truncate(expectedNorm, 100)}\nGot: ${truncate(actualNorm, 100)}`;
                }
            }

            resolve({
                status,
                output: output,
                error: errorOutput,
                executionTime,
                peakMemoryKB,
                details
            });
        });

        testProcess.on('error', (err) => {
            clearTimeout(timeout);
            if (memoryPollInterval) clearInterval(memoryPollInterval);
            resolve({ status: 'RE', error: err.message, executionTime: 0 });
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
async function runBatchTests({ exePath, tests, timeLimit = 3000, cwd, onProgress }) {
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
            cwd
        });

        results.push({
            testId: test.id || String(i),
            ...result
        });
    }

    return results;
}

/**
 * Normalize output for comparison
 * @param {string} s
 * @returns {string}
 */
function normalizeOutput(s) {
    return s.split('\n').map(l => l.trimEnd()).join('\n').trim();
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

module.exports = {
    runTest,
    runBatchTests,
    normalizeOutput,
};
