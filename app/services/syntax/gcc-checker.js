/**
 * Sameko Dev C++ IDE - GCC Syntax Checker
 * Semantic syntax checking using g++ -fsyntax-only
 * @module app/services/syntax/gcc-checker
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getDetectedCompiler } = require('../compiler/detector');
const { ensurePCH } = require('../compiler/pch-manager');
const { getCompilerSettings } = require('../../shared/settings-reader');
const { validateCompilerFlags } = require('../../shared/validators');
const { ensurePrivateDir, appTempDir } = require('../../shared/platform');

let activeChecker = null;

/**
 * Check syntax using GCC (g++ -fsyntax-only)
 * Provides semantic error checking
 * 
 * @param {string} content - Source code
 * @param {string} [filePath] - Original file path (for include resolution)
 * @returns {Promise<import('../../../shared/types').SyntaxError[]>}
 */
async function checkSyntax(content, filePath = null) {
    const compilerExe = getDetectedCompiler() || 'g++';

    cancelSyntaxCheck();

    // Create temp file for checking
    // On POSIX `temp` is the shared /tmp, so the dir is both per-user
    // (appTempDir) and private (0700).
    const tempDir = appTempDir('cpp-ide-check');
    if (!fs.existsSync(tempDir)) {
        ensurePrivateDir(tempDir);
    }

    const tempFile = path.join(tempDir, 'check_temp.cpp');
    fs.writeFileSync(tempFile, content, 'utf-8');

    // Mirror the user's actual compile settings (cppStandard/extraFlags) so
    // live diagnostics agree with what really compiles — e.g. code guarded
    // by `#ifdef LOCAL` shouldn't show as unreachable/wrong here if the user
    // set -DLOCAL as an extra compile flag.
    const { cppStandard, extraFlags } = getCompilerSettings();
    const stdFlag = `-std=${cppStandard || 'c++17'}`;

    const args = [
        '-fsyntax-only',
        stdFlag,
        '-fmax-errors=50',
        '-Wall',
        '-Wextra',
        '-pipe',
        '-fno-exceptions',
        '-fno-rtti'
    ];

    if (extraFlags && validateCompilerFlags(extraFlags).valid) {
        args.push(...extraFlags.split(/\s+/).filter(Boolean));
    }

    try {
        const pch = await ensurePCH(`${stdFlag} -O0`);
        if (pch && pch.ready) {
            args.push('-I', pch.pchSubDir);
            args.push('-include', 'stdc++.h');
        }
    } catch (e) { }

    args.push(tempFile);

    if (filePath) {
        args.push('-I', path.dirname(filePath));
    }

    return new Promise((resolve) => {
        activeChecker = spawn(compilerExe, args, { cwd: tempDir });
        let stderr = '';

        activeChecker.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        activeChecker.on('close', (code) => {
            activeChecker = null;
            if (code === null) {
                resolve([]);
                return;
            }
            const diagnostics = parseGccOutput(stderr);
            resolve(diagnostics);
        });

        activeChecker.on('error', () => {
            activeChecker = null;
            resolve([]);
        });
    });
}

function cancelSyntaxCheck() {
    if (activeChecker) {
        try {
            activeChecker.kill('SIGKILL');
        } catch (e) { }
        activeChecker = null;
    }
}

/**
 * Parse GCC error output into structured diagnostics
 * @param {string} output - GCC stderr output
 * @returns {import('../../../shared/types').SyntaxError[]}
 */
function parseGccOutput(output) {
    const diagnostics = [];
    const lines = output.split('\n');

    for (const line of lines) {
        // Pattern: /path/file.cpp:10:5: error: message
        const match = line.match(/^(?:[A-Za-z]:)?[^:]*:(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/);
        if (match) {
            diagnostics.push({
                line: parseInt(match[1], 10),
                column: parseInt(match[2], 10),
                severity: match[3],
                message: match[4],
                source: 'gcc'
            });
        }
    }

    return diagnostics;
}

module.exports = {
    checkSyntax,
    parseGccOutput,
    cancelSyntaxCheck
};
