/**
 * Sameko Dev C++ IDE - testlib checkers
 *
 * A checker judges a test when one answer is not the only right one. It is a testlib program
 * run as `checker <input> <output> <answer>`; its exit code is the verdict (0 ok, 1 wrong
 * answer, 2 presentation error, 3 the checker itself failed, 7 partial points) and it explains
 * it in one line on stderr ("wrong answer 1st numbers differ - expected: '3', found: '4'").
 *
 * The bundled testlib.h (app/assets/testlib, MIT) lives in the asar archive, which g++ cannot
 * read, so it is copied once to a temp folder; executor.js and clangd add that folder with
 * -idirafter, so `#include "testlib.h"` works for checkers and generators, and a testlib.h of
 * the user's own next to the source still wins.
 * @module app/services/competitive/checker
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { IS_WIN, appTempDir, ensurePrivateDir, killProcessTree } = require('../../shared/platform');
const { getCompilerEnv } = require('../compiler/detector');

const TESTLIB_SOURCE = path.join(__dirname, '..', '..', 'assets', 'testlib', 'testlib.h');
const CHECKER_TIME_LIMIT = 10000;   // a checker reads three files; longer than this is stuck
const MESSAGE_CHARS = 2000;

let includeDir = null;

/** The folder holding testlib.h for g++ and clangd ('' if it could not be written). */
function testlibIncludeDir() {
    if (includeDir !== null) return includeDir;
    try {
        const dir = appTempDir('cpp-ide-testlib');
        const dest = path.join(dir, 'testlib.h');
        const src = fs.readFileSync(TESTLIB_SOURCE);
        let same = false;
        try { same = fs.readFileSync(dest).equals(src); } catch (_) { }
        if (!same) {
            ensurePrivateDir(dir);
            fs.writeFileSync(dest, src);
        }
        includeDir = dir;
    } catch (err) {
        console.warn('[Checker] testlib.h not available:', err.message);
        includeDir = '';
    }
    return includeDir;
}

/** testlib exit code -> verdict. */
function verdictOf(code) {
    if (code === 0) return 'AC';
    if (code === 1 || code === 2) return 'WA';   // judges count a presentation error as WA
    if (code === 7) return 'PC';                 // partial points: not accepted
    return 'FAIL';                               // 3 = the checker's own assert, or a crash
}

/**
 * Runs a compiled checker on one test.
 * @param {{checkerPath: string, input: string, output: string, answer: string}} options
 * @returns {Promise<{verdict: 'AC'|'WA'|'PC'|'FAIL', message: string, exitCode: number|null}>}
 */
function runChecker({ checkerPath, input, output, answer }) {
    return new Promise((resolve) => {
        let dir;
        try {
            dir = path.join(appTempDir('cpp-ide-checker'), crypto.randomBytes(6).toString('hex'));
            ensurePrivateDir(dir);
            fs.writeFileSync(path.join(dir, 'input.txt'), input ?? '');
            fs.writeFileSync(path.join(dir, 'output.txt'), output ?? '');
            fs.writeFileSync(path.join(dir, 'answer.txt'), answer ?? '');
        } catch (err) {
            resolve({ verdict: 'FAIL', message: `Could not write the checker's files: ${err.message}`, exitCode: null });
            return;
        }
        const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { } };

        let message = '';
        let done = false;
        let timedOut = false;
        let proc;
        try {
            proc = spawn(checkerPath, ['input.txt', 'output.txt', 'answer.txt'], {
                // The bundled toolchain's runtime DLLs, as for the tested program (batch-tester.js).
                cwd: dir, env: getCompilerEnv(), windowsHide: true, detached: !IS_WIN, stdio: ['ignore', 'pipe', 'pipe']
            });
        } catch (err) {
            cleanup();
            resolve({ verdict: 'FAIL', message: `Could not start the checker: ${err.message}`, exitCode: null });
            return;
        }
        const collect = (d) => { if (message.length < MESSAGE_CHARS) message += d; };
        proc.stdout.setEncoding('utf8');
        proc.stderr.setEncoding('utf8');
        proc.stdout.on('data', collect);
        proc.stderr.on('data', collect);
        const timer = setTimeout(() => { timedOut = true; killProcessTree(proc); }, CHECKER_TIME_LIMIT);
        const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            cleanup();
            resolve(result);
        };
        proc.on('error', (err) => finish({ verdict: 'FAIL', message: `Could not start the checker: ${err.message}`, exitCode: null }));
        proc.on('close', (code) => {
            const text = message.replace(/\r\n?/g, '\n').trim().slice(0, MESSAGE_CHARS);
            if (timedOut) finish({ verdict: 'FAIL', message: `The checker ran longer than ${CHECKER_TIME_LIMIT / 1000} s`, exitCode: code });
            else finish({ verdict: verdictOf(code), message: text, exitCode: code });
        });
    });
}

module.exports = { testlibIncludeDir, runChecker, verdictOf };
