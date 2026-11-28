/**
 * Sameko Dev C++ IDE - interactive problems judged by a testlib interactor.
 *
 * The solution's stdout goes to the interactor's stdin and back. The interactor runs as
 * `interactor input.txt output.txt answer.txt` and its exit code is the verdict, as on Codeforces.
 * A wrong answer is reported even if the solution then dies on the closed pipe.
 * @module app/services/competitive/interactor
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getCompilerEnv } = require('../compiler/toolchain/detector');
const languages = require('../compiler/toolchain/languages');
const { getLauncherIfReady, launcherEnv, newStatsFile, readStats } = require('../compiler/run/run-launcher');
const { describeExit, describeStartError } = require('../../shared/exit-codes');
const { IS_WIN, appTempDir, ensurePrivateDir, killProcessTree } = require('../../shared/platform');
const { verdictOf } = require('./checker');

const TRANSCRIPT_CHARS = 256 * 1024;
const MESSAGE_CHARS = 2000;
const EXIT_GRACE_MS = 2000;

/** Turns the two processes' outcome into a verdict. Exported for the unit tests. */
function interactiveVerdict({ timedOut, memoryHit, solutionCode, solutionSignal, interactorCode, interactorKilled }) {
    if (timedOut) return 'TLE';
    if (memoryHit) return 'MLE';
    const crashed = !!solutionSignal || (solutionCode !== 0 && solutionCode !== null);
    if (interactorKilled) return crashed ? 'RE' : 'TLE';
    const judged = verdictOf(interactorCode);
    if (judged === 'WA' || judged === 'PC') return 'WA';
    if (crashed) return 'RE';
    return judged === 'AC' ? 'AC' : 'FAIL';
}

function appendCapped(current, text) {
    return current.length < TRANSCRIPT_CHARS ? current + text.slice(0, TRANSCRIPT_CHARS - current.length) : current;
}

function play({ exePath, interactor, dir, timeLimit, memoryLimit }) {
    return new Promise((resolve) => {
        let command;
        try {
            command = languages.runCommand(exePath, { memoryLimit, interactive: true });
        } catch (err) {
            resolve({ status: 'RE', error: err.message, details: err.message, executionTime: 0 });
            return;
        }
        const env = { ...getCompilerEnv(), ...command.env };
        const launcher = getLauncherIfReady();
        const statsFile = launcher ? newStatsFile() : null;
        const options = { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN };
        let solution;
        let judge;
        try {
            solution = launcher
                ? spawn(launcher, [statsFile, command.file, String(Math.round(timeLimit)), String(memoryLimit), ...command.args], { ...options, env: { ...env, ...launcherEnv() } })
                : spawn(command.file, command.args, { ...options, env });
            judge = spawn(interactor, ['input.txt', 'output.txt', 'answer.txt'], { ...options, env: getCompilerEnv() });
        } catch (err) {
            readStats(statsFile);
            if (solution) killProcessTree(solution);
            resolve({ status: 'RE', error: err.message, details: `Could not start the program: ${err.message}`, executionTime: 0 });
            return;
        }

        const startedAt = Date.now();
        let transcript = '';
        let solutionErr = '';
        let judgeErr = '';
        let solutionExit = null;
        let judgeExit = null;
        let timedOut = false;
        let judgeKilled = false;
        let settled = false;
        let graceTimer = null;

        for (const stream of [solution.stdin, judge.stdin]) stream.on('error', () => { });
        solution.stdout.setEncoding('utf8');
        judge.stdout.setEncoding('utf8');
        solution.stderr.setEncoding('utf8');
        judge.stderr.setEncoding('utf8');
        solution.stdout.on('data', (text) => {
            transcript = appendCapped(transcript, text);
            if (judge.stdin.writable) judge.stdin.write(text);
        });
        judge.stdout.on('data', (text) => {
            transcript = appendCapped(transcript, text);
            if (solution.stdin.writable) solution.stdin.write(text);
        });
        solution.stdout.on('end', () => { try { judge.stdin.end(); } catch (_) { } });
        judge.stdout.on('end', () => { try { solution.stdin.end(); } catch (_) { } });
        solution.stderr.on('data', (text) => { solutionErr = appendCapped(solutionErr, text); });
        judge.stderr.on('data', (text) => { judgeErr = appendCapped(judgeErr, text); });

        // The launcher enforces the limit on the program; this also ends two processes that
        // wait for each other, or a run without the launcher.
        const limitTimer = setTimeout(() => {
            timedOut = true;
            killProcessTree(solution);
            killProcessTree(judge);
            graceTimer = setTimeout(finish, 500);
        }, launcher ? timeLimit + 1500 : timeLimit);

        const waitForOther = () => {
            if (solutionExit && judgeExit) { finish(); return; }
            if (graceTimer) return;
            graceTimer = setTimeout(() => {
                if (!judgeExit) { judgeKilled = true; killProcessTree(judge); }
                if (!solutionExit) killProcessTree(solution);
                graceTimer = setTimeout(finish, 300);
            }, EXIT_GRACE_MS);
        };
        solution.on('close', (code, signal) => { solutionExit = { code, signal }; waitForOther(); });
        judge.on('close', (code, signal) => { judgeExit = { code, signal }; waitForOther(); });
        for (const child of [solution, judge]) {
            child.on('error', (err) => {
                solutionErr = appendCapped(solutionErr, `${err.message}\n`);
                if (child === solution) solutionExit = solutionExit || { code: -1, signal: null };
                else judgeExit = judgeExit || { code: 3, signal: null };
                waitForOther();
            });
        }

        function finish() {
            if (settled) return;
            settled = true;
            clearTimeout(limitTimer);
            clearTimeout(graceTimer);
            killProcessTree(solution);
            killProcessTree(judge);
            const stats = readStats(statsFile);
            const timed = stats && Number.isFinite(stats.wallMs) ? stats : null;
            const code = solutionExit ? solutionExit.code : null;
            const signal = solutionExit ? solutionExit.signal : null;
            const executionTime = timed ? Math.round(timed.wallMs) : Date.now() - startedAt;
            const peakMemoryKB = timed ? timed.peakKB : 0;
            const startError = stats && Number.isFinite(stats.startError) ? stats.startError : null;
            const memoryHit = memoryLimit > 0 && ((timed && timed.memLimitHit) || peakMemoryKB > memoryLimit * 1024);
            const status = startError !== null ? 'RE' : interactiveVerdict({
                timedOut: timedOut || !!(timed && timed.timedOut),
                memoryHit,
                solutionCode: code,
                solutionSignal: signal,
                interactorCode: judgeExit ? judgeExit.code : null,
                interactorKilled: judgeKilled || !judgeExit,
            });
            const message = judgeErr.trim().split(/\r?\n/)[0].slice(0, MESSAGE_CHARS);
            const crash = status === 'RE' ? describeExit(code, signal) : null;
            let details = message;
            if (startError !== null) details = describeStartError(startError);
            else if (status === 'TLE') details = 'Time limit exceeded';
            else if (status === 'MLE') details = `Memory limit exceeded (${memoryLimit} MB)`;
            else if (status === 'FAIL') details = `Checker failed${judgeExit && judgeExit.code !== null ? ` (exit code ${judgeExit.code})` : ''}${message ? `: ${message}` : ''}`;
            else if (status === 'RE') {
                const reason = crash ? `${crash.name}, ${crash.hex}` : signal ? `signal: ${signal}` : `exit code: ${code}`;
                details = `Runtime error (${reason})${crash && crash.hint ? `\n${crash.hint}` : ''}`;
            } else if (status === 'WA' && !message) details = 'Wrong answer';
            resolve({
                status, output: transcript, error: solutionErr, executionTime, peakMemoryKB, details,
                exitCode: code, crash, checkerMessage: judgeErr.slice(0, MESSAGE_CHARS),
            });
        }
    });
}

/**
 * @param {{exePath: string, interactor: string, input?: string, inputPath?: string,
 *   expectedOutput?: string, timeLimit: number, memoryLimit: number}} options
 */
async function runInteractive({ exePath, interactor, input = '', inputPath = '', expectedOutput = '', timeLimit = 3000, memoryLimit = 0 }) {
    if (!exePath || !fs.existsSync(exePath) || !interactor || !fs.existsSync(interactor)) {
        return { status: 'RE', error: 'Executable not found', details: 'Executable not found', executionTime: 0 };
    }
    const root = appTempDir('cpp-ide-interact');
    ensurePrivateDir(root);
    const dir = await fs.promises.mkdtemp(path.join(root, 'run-'));
    try {
        if (inputPath) await fs.promises.copyFile(inputPath, path.join(dir, 'input.txt'));
        else await fs.promises.writeFile(path.join(dir, 'input.txt'), input);
        await fs.promises.writeFile(path.join(dir, 'answer.txt'), expectedOutput ?? '');
        return await play({ exePath, interactor, dir, timeLimit, memoryLimit });
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

module.exports = { runInteractive, interactiveVerdict };
