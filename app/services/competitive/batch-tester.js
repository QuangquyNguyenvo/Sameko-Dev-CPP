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
const { runChecker } = require('./checker');
const { describeExit, describeStartError, startErrorCode } = require('../../shared/exit-codes');
const { wasBuiltThisSession } = require('../compiler/executor');
const { blockedStartMessage, IS_WIN, IS_LINUX, readProcMemoryKB, killProcessTree, appTempDir, ensurePrivateDir } = require('../../shared/platform');
const { normalizeFileIO } = require('./test-files');
const { ensureLauncher, getLauncherIfReady, launcherEnv, newStatsFile, readStats } = require('../compiler/run-launcher');
const languages = require('../compiler/languages');

const EXPECTED_PREVIEW_CHARS = 64 * 1024;

/**
 * Run a single test case
 * 
 * @param {Object} options
 * @param {string} options.exePath - Path to executable
 * @param {string} options.input - Test input
 * @param {string} [options.expectedOutput] - Expected output for comparison
 * @param {number} [options.timeLimit=3000] - Time limit in ms
 * @param {number} [options.memoryLimit] - Memory limit in MB (peak commit, as judges count it); none if 0
 * @param {string} [options.compare] - how output is judged ('tokens' by default, see app/shared/judge.js)
 * @param {string} [options.checker] - a compiled testlib checker that judges the output instead
 *   (competitive/checker.js); it also judges a test without an expected output
 * @param {string} [options.cwd] - Working directory
 * @param {string[]} [options.args] - command-line arguments for the program (a stress-test
 *   generator's seed): plain words only, anything else is dropped
 * @param {string} [options.inputPath] - the test's input is this file (a large test kept on disk)
 * @param {string} [options.expectedPath] - the expected output is this file
 * @param {{input?: string, output?: string}} [options.fileIO] - a problem judged through files:
 *   the program runs in a private folder holding the input file, and the output file is judged
 * @param {string} [options.interactor] - a compiled testlib interactor that plays and judges
 * @returns {Promise<import('../../shared/types').BatchTestResult>}
 */
async function runTest({ exePath, input, expectedOutput, timeLimit = 3000, memoryLimit = 0, compare, checker = '', cwd, args = [], debug = false, testMeta = null, profiling = false, inputPath = '', expectedPath = '', fileIO = null, interactor = '', outputMode = 'full' }) {
    memoryLimit = Number.isFinite(+memoryLimit) && +memoryLimit > 0 ? Math.round(+memoryLimit) : 0;
    const programArgs = programArguments(args);
    // Linux judges memory and gives Large Stack only through the launcher: wait for its first build.
    if (IS_LINUX) await ensureLauncher();

    // A test kept on disk: its file may have been moved since it was imported.
    let expectedPreview;
    for (const file of [inputPath, expectedPath]) {
        if (file && !fs.existsSync(file)) {
            return { status: 'RE', error: 'Test file not found', details: `Test file not found: ${file}`, executionTime: 0 };
        }
    }
    if (expectedPath) {
        expectedOutput = await fs.promises.readFile(expectedPath, 'utf8');
        expectedPreview = expectedOutput.slice(0, EXPECTED_PREVIEW_CHARS);
    }
    if (interactor) {
        const { runInteractive } = require('./interactor');
        const played = await runInteractive({ exePath, interactor, input, inputPath, expectedOutput, timeLimit, memoryLimit });
        return expectedPreview === undefined ? played : { ...played, expectedPreview };
    }

    // Judged through files: a folder of its own per run, so tests running side by side and the
    // user's own BAI.INP next to the source are never touched.
    const io = normalizeFileIO(fileIO);
    let ioDir = null;
    if (io) {
        if (profiling && cwd) {
            ioDir = cwd;
        } else {
            const root = appTempDir('cpp-ide-fileio');
            ensurePrivateDir(root);
            ioDir = await fs.promises.mkdtemp(path.join(root, 'run-'));
            cwd = ioDir;
        }
        if (io.input) {
            const target = path.join(ioDir, io.input);
            if (inputPath) await fs.promises.copyFile(inputPath, target);
            else await fs.promises.writeFile(target, input || '');
        }
    }

    const finished = await new Promise((resolve) => {
        if (!exePath || !fs.existsSync(exePath)) {
            // Built a moment ago and gone now: an antivirus quarantined it (executor.js).
            const gone = wasBuiltThisSession(exePath);
            resolve({
                status: gone ? 'RE' : 'CE',
                error: 'Executable not found',
                details: gone
                    ? `The program built a moment ago is gone: an antivirus most likely quarantined it. Add this folder to its exclusions: ${path.dirname(exePath)}`
                    : 'Executable not found',
                executionTime: 0
            });
            return;
        }

        const debugInfo = {
            enabled: !!debug,
            testMeta,
            pid: null,
            exitCode: null,
            signal: null,
            timeoutKilled: false,
            inputHash: debug ? hashText(input || '') : null,
            expectedHash: debug && expectedOutput !== undefined && expectedOutput !== null ? hashText(expectedOutput) : null,
            actualHash: null,
            expectedNormHash: null,
            actualNormHash: null,
            hadStderr: false,
            stderrPreview: '',
        };

        // Python/Java/Node: the interpreter and its arguments (languages.js); C++: the exe itself.
        let command;
        try {
            command = languages.runCommand(exePath, { memoryLimit });
        } catch (err) {
            resolve({ status: 'RE', error: err.message, details: err.message, executionTime: 0 });
            return;
        }
        const runEnv = { ...getCompilerEnv(), ...command.env };
        // The profile reader expects gmon.out in this run's private working directory.
        if (profiling) delete runEnv.GMON_OUT_PREFIX;

        const workingDir = cwd || path.dirname(exePath);
        let output = '';
        let errorOutput = '';
        let killed = false;
        let peakMemoryKB = 0;
        let memoryPollInterval = null;

        // Create test process. On Windows it goes through the native launcher,
        // which measures the program's own wall time and peak memory exactly.
        // POSIX: its own process group, so a timeout can stop whatever it started.
        const launcher = getLauncherIfReady();
        const statsFile = launcher ? newStatsFile() : null;
        let testProcess;
        try {
            testProcess = launcher
                ? spawn(launcher, [statsFile, command.file, String(Math.round(timeLimit)), String(memoryLimit), ...command.args, ...programArgs], { cwd: workingDir, env: { ...runEnv, ...launcherEnv() }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN })
                : spawn(command.file, [...command.args, ...programArgs], { cwd: workingDir, env: runEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN });
        } catch (err) {
            // Windows refused to create the process; Node throws ("spawn UNKNOWN") rather than
            // emitting 'error', which used to reject the whole Run All Tests.
            readStats(statsFile);
            const blocked = err && ['UNKNOWN', 'EACCES', 'EPERM'].includes(err.code);
            resolve({
                status: 'RE',
                error: err && err.message,
                executionTime: 0,
                details: blocked
                    ? blockedStartMessage(path.dirname(launcher || exePath))
                    : `Could not start the program: ${err && err.message}`
            });
            return;
        }

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

        // Windows samples by spawning `tasklist` (~150 ms). Sampling at t=0 made
        // every test pay for a process that finished long after a typical
        // test did, so the first sample waits for the interval. Linux reads
        // /proc (cheap, and VmHWM is the true peak), so it samples at once.
        if (pid && IS_LINUX) pollMemory();
        if (pid && !launcher && (IS_WIN || IS_LINUX)) {
            memoryPollInterval = setInterval(pollMemory, IS_WIN ? 500 : 100);
        }

        // 'close' waits until every copy of the output pipe is closed, so a process
        // the program started (system(), a forgotten child) could hold the test
        // open long past its limit, or forever. The whole tree is killed on
        // timeout, and the result no longer waits for the pipe once the program
        // itself has exited.
        let settled = false;
        let exitGrace = null;
        let forceFinish = null;
        // The launcher stops the program at the limit itself, counted from the program's start;
        // this timer is then only a backstop for a launcher that hangs.
        const timeout = setTimeout(() => {
            killed = true;
            debugInfo.timeoutKilled = true;
            killProcessTree(testProcess);
            forceFinish = setTimeout(() => settle(testProcess.exitCode, testProcess.signalCode || 'SIGKILL'), 1000);
        }, launcher ? timeLimit + 3000 : timeLimit);

        // Send input and start timing
        let startTime;
        // A program that exits without reading its input closes the pipe; the
        // resulting EPIPE must not surface as an uncaught exception.
        testProcess.stdin.on('error', () => { });
        if (inputPath) {
            const stream = fs.createReadStream(inputPath);
            stream.on('error', () => { try { testProcess.stdin.end(); } catch (_) { } });
            stream.pipe(testProcess.stdin);
        } else {
            if (input) {
                testProcess.stdin.write(input);
            }
            testProcess.stdin.end();
        }
        startTime = Date.now();

        // Cap what is kept: a runaway print loop inside the time limit would
        // otherwise build a string of hundreds of MB and ship it to the renderer.
        const MAX_CAPTURE_CHARS = 16 * 1024 * 1024;
        let outputTruncated = false;

        // Decoded as a stream: a character split between two chunks (😀 is four
        // bytes) must not turn into two replacement characters and a false WA.
        testProcess.stdout.setEncoding('utf8');
        testProcess.stderr.setEncoding('utf8');
        testProcess.stdout.on('data', (data) => {
            if (output.length < MAX_CAPTURE_CHARS) output += data;
            else outputTruncated = true;
        });

        testProcess.stderr.on('data', (data) => {
            if (errorOutput.length < MAX_CAPTURE_CHARS) errorOutput += data;
        });

        testProcess.on('exit', (code, signal) => {
            if (settled) return;
            // Output still in the pipe arrives before 'close'; a process left
            // running may keep the pipe open, so stop waiting after a moment.
            exitGrace = setTimeout(() => settle(code, signal), 500);
        });

        testProcess.on('close', (code, signal) => settle(code, signal));

        function settle(code, signal) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (exitGrace) clearTimeout(exitGrace);
            if (forceFinish) clearTimeout(forceFinish);
            if (memoryPollInterval) clearInterval(memoryPollInterval);
            // Release pipes another process may still hold, and stop that process
            // (POSIX: the group; the program itself has already exited).
            try { testProcess.stdout.destroy(); } catch (_) { }
            try { testProcess.stderr.destroy(); } catch (_) { }
            if (!IS_WIN) killProcessTree(testProcess);

            const stats = readStats(statsFile); // also removes the file
            // startError: the launcher could not start the program at all (antivirus, policy…).
            const startError = stats && Number.isFinite(stats.startError) ? stats.startError : null;
            const timed = stats && Number.isFinite(stats.wallMs) ? stats : null;
            const executionTime = timed ? Math.round(timed.wallMs) : Date.now() - startTime;
            if (timed) peakMemoryKB = timed.peakKB;
            if (timed && timed.timedOut) { killed = true; debugInfo.timeoutKilled = true; }
            // The answer of a file-based problem is its output file. A program that printed to
            // stdout instead (the freopen is under #ifdef) is judged on what it printed.
            let outputFileMissing = false;
            if (io && io.output) {
                const file = path.join(ioDir, io.output);
                try {
                    if (fs.statSync(file).size > MAX_CAPTURE_CHARS) outputTruncated = true;
                    else output = fs.readFileSync(file, 'utf8');
                } catch (_) {
                    outputFileMissing = !output;
                }
            }
            // Over the limit: the job refused an allocation (the program then crashes or exits
            // with bad_alloc), or it stayed under the job's cap but peaked past the limit.
            const overMemory = memoryLimit > 0 && ((timed && timed.memLimitHit) || peakMemoryKB > memoryLimit * 1024);

            debugInfo.exitCode = code;
            debugInfo.signal = signal || null;
            if (debugInfo.enabled) debugInfo.actualHash = hashText(output || '');

            // Determine status
            let status = 'AC';
            let details = '';
            let crash = null;
            let useChecker = false;   // the program ran cleanly: the checker decides

            if (startError !== null) {
                status = 'RE';
                details = `${describeStartError(startError)} (${startErrorCode(startError)}; build folder: ${path.dirname(exePath)})`;
            } else if (killed) {
                status = 'TLE';
                details = 'Time limit exceeded';
            } else if (overMemory) {
                status = 'MLE';
                details = `Memory limit exceeded (${memoryLimit} MB)`;
            } else if (outputTruncated) {
                status = 'RE';
                details = 'Output limit exceeded (more than 16 MB printed)';
            } else if (code !== 0) {
                status = 'RE';
                // 3221225725 tells a student nothing; "Stack overflow, 0xC00000FD" and what
                // usually causes it does (app/shared/exit-codes.js).
                crash = describeExit(code, signal);
                const reason = crash
                    ? `${crash.name}, ${crash.hex}`
                    : signal ? `signal: ${signal}` : `exit code: ${code}`;
                const errPreview = truncate(normalizeOutput(errorOutput || ''), 160);
                debugInfo.hadStderr = !!(errorOutput && errorOutput.length > 0);
                debugInfo.stderrPreview = errPreview;
                details = `Runtime error (${reason})${crash && crash.hint ? `\n${crash.hint}` : ''}${errPreview ? `\nStderr: ${errPreview}` : ''}`;
            } else if (checker && expectedOutput !== undefined && expectedOutput !== null) {
                useChecker = true;
            } else if (expectedOutput !== undefined && expectedOutput !== null) {
                const expectedText = String(expectedOutput ?? '');
                const hasExpected = expectedText.trim().length > 0;

                // A blank expected output means run-only: nothing to judge. It used to
                // count as AC, so a test with only an input showed a green AC and could mark
                // a contest problem solved; RAN says it ran cleanly and was not judged.
                if (!hasExpected) {
                    status = 'RAN';
                    details = 'No expected output to compare with';
                } else {
                    // Compare output using shared judge rules
                    const compared = compareOutputs(output, expectedOutput, compare);
                    // Debug is opt-in and logged only for a failed test, so an AC never
                    // normalizes its whole output just to hash it.
                    if (debugInfo.enabled && !compared.matched) {
                        debugInfo.expectedNormHash = hashText(compared.expectedNorm);
                        debugInfo.actualNormHash = hashText(compared.actualNorm);
                    }

                    if (!compared.matched) {
                        status = 'WA';
                        details = outputFileMissing
                            ? `The program did not create ${io.output}`
                            : `Expected: ${preview(expectedText, 100)}\nGot: ${preview(output, 100)}`;
                    }
                }
            }

            const response = {
                status,
                output: output,
                error: errorOutput,
                executionTime,
                peakMemoryKB,
                details,
                exitCode: code,
                crash,
                expectedPreview,
                startErrorMessage: startError !== null ? describeStartError(startError) : undefined
            };

            const finish = () => {
                if (debugInfo.enabled) {
                    response.debug = {
                        ...debugInfo,
                        status: response.status,
                        executionTime,
                        peakMemoryKB,
                    };
                }
                resolve(response);
            };
            if (!useChecker) { finish(); return; }
            runChecker({ checkerPath: checker, input: input || '', output, answer: String(expectedOutput ?? '') })
                .then((judged) => {
                    // The checker's own line ("wrong answer 1st numbers differ - expected: '3',
                    // found: '4'") is the detail shown in TESTS, so it is kept as written.
                    const msg = judged.message.split(/\n/)[0];
                    response.checkerMessage = judged.message;
                    if (judged.verdict === 'AC') {
                        response.status = 'AC';
                        response.details = msg;
                    } else if (judged.verdict === 'FAIL') {
                        response.status = 'FAIL';
                        const code = judged.exitCode !== null && judged.exitCode !== undefined ? ` (exit code ${judged.exitCode})` : '';
                        response.details = `Checker failed${code}${msg ? `: ${msg}` : ''}`;
                    } else if (judged.verdict === 'PC') {
                        response.status = 'WA';
                        response.details = `Partial points${msg ? `: ${msg}` : ''}`;
                    } else {
                        response.status = 'WA';
                        response.details = msg || 'Wrong answer';
                    }
                    finish();
                });
        }

        testProcess.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (exitGrace) clearTimeout(exitGrace);
            if (forceFinish) clearTimeout(forceFinish);
            if (memoryPollInterval) clearInterval(memoryPollInterval);
            readStats(statsFile);

            const response = { status: 'RE', error: err.message, executionTime: 0 };
            // "spawn UNKNOWN": Windows or an antivirus refused to start the file (launcher or program).
            if (err && ['UNKNOWN', 'EACCES', 'EPERM'].includes(err.code)) {
                response.details = blockedStartMessage(path.dirname(launcher || exePath));
            }
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
    // A profiling run's folder belongs to its caller, which reads gmon.out from it.
    if (ioDir && !profiling) await fs.promises.rm(ioDir, { recursive: true, force: true }).catch(() => { });
    // A warm-up result is intentionally not used by the renderer. Dropping
    // stdout before crossing IPC avoids a second large structured-clone while
    // preserving the legacy full-output shape for every normal caller.
    if (outputMode === 'discard' && finished && typeof finished.output === 'string') {
        const withoutOutput = { ...finished };
        delete withoutOutput.output;
        return withoutOutput;
    }
    return finished;
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
 * @returns {Promise<import('../../shared/types').BatchTestResult[]>}
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
 * The arguments a test may pass to the program: at most 8 plain words (letters, digits, _ . + -),
 * which the Windows launcher can quote without escaping anything.
 * @param {unknown} args
 * @returns {string[]}
 */
function programArguments(args) {
    if (!Array.isArray(args)) return [];
    return args.map(a => String(a)).filter(a => /^[\w.+-]{1,64}$/.test(a)).slice(0, 8);
}

/**
 * Truncate string
 * @param {string} s
 * @param {number} maxLen
 * @returns {string}
 */
/**
 * The start of an output, normalized and cut to maxLen like truncate(normalizeOutput(text)),
 * without normalizing a 16 MB output to show 100 characters of it.
 */
function preview(text, maxLen) {
    const head = String(text ?? '').trimStart();
    const cut = head.slice(0, maxLen * 4);   // room for the \r and trailing spaces normalizing drops
    const norm = normalizeOutput(cut);
    if (norm.length > maxLen || /\S/.test(head.slice(cut.length))) return norm.substring(0, maxLen) + '...';
    return norm;
}

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
    programArguments,
    normalizeOutput,
    compareOutputs,
};
