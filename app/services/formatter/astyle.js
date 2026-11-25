/**
 * Sameko Dev C++ IDE - AStyle Integration
 * Code formatting using Artistic Style
 * @module app/services/formatter/astyle
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getBasePath, getResourcesPath } = require('../compiler/detector');
const { binName, systemBinDirs, which, IS_WIN, IS_MAC } = require('../../shared/platform');

let detectedAStyle = null;

/**
 * Detect AStyle executable
 * Checks bundled location first, then system paths
 * @returns {string|null}
 */
function detectAStyle() {
    const basePath = getBasePath();
    const resourcesPath = getResourcesPath();

    const possiblePaths = [
        // Bundled with app (in Sameko-GCC)
        path.join(resourcesPath, 'Sameko-GCC', 'bin', binName('astyle')),
        path.join(basePath, 'Sameko-GCC', 'bin', binName('astyle')),
    ];

    if (IS_WIN) {
        possiblePaths.push(
            'C:\\TDM-GCC-64\\bin\\astyle.exe',
            'C:\\Program Files\\AStyle\\bin\\astyle.exe',
            'C:\\Program Files (x86)\\AStyle\\bin\\astyle.exe',
        );
    } else {
        for (const dir of systemBinDirs()) {
            possiblePaths.push(path.join(dir, 'astyle'));
        }
    }

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            console.log(`[AStyle] Found: ${p}`);
            return p;
        }
    }

    // Last chance: anywhere on PATH.
    const fromPath = which('astyle');
    if (fromPath) {
        console.log(`[AStyle] Found on PATH: ${fromPath}`);
        return fromPath;
    }

    console.log('[AStyle] Not found - format feature will be disabled');
    return null;
}

function getAStylePath() {
    if (detectedAStyle === null) {
        detectedAStyle = detectAStyle() || false;
    }
    return detectedAStyle;
}

function checkAStyle() {
    const astylePath = getAStylePath();
    return {
        available: !!astylePath,
        path: astylePath || null
    };
}

/**
 * Windows reports a program that could not start through its exit code. Name the two
 * loader failures instead of printing 3221225595 (issue #79).
 */
function exitMessage(exitCode, astylePath) {
    if (IS_WIN && exitCode === 0xC000007B) {
        return `AStyle could not start: ${astylePath} loaded a DLL built for the wrong architecture `
            + '(32-bit vs 64-bit). Replace it with a 64-bit astyle.exe that needs no extra DLLs.';
    }
    if (IS_WIN && exitCode === 0xC0000135) {
        return `AStyle could not start: a DLL that ${astylePath} needs is missing.`;
    }
    return `AStyle exited with code ${exitCode}`;
}

/**
 * Format code using AStyle
 * 
 * @param {string} code - Source code to format
 * @param {string} [style='google'] - Formatting style
 * @returns {Promise<{success: boolean, code?: string, error?: string}>}
 */
async function formatCode(code, style = 'google') {
    const astylePath = getAStylePath();

    if (!astylePath) {
        return {
            success: false,
            error: IS_WIN
                ? 'AStyle was not found. Download astyle.exe and place it in Sameko-GCC\\bin\\.'
                : IS_MAC
                    ? 'AStyle was not found. Run "brew install astyle" in Terminal, then restart the app.'
                    : 'AStyle was not found. Install it (e.g. `sudo apt install astyle`) or place an `astyle` binary in Sameko-GCC/bin/.'
        };
    }

    const { getStyleArgs } = require('./styles');
    const args = getStyleArgs(style);

    return new Promise((resolve) => {
        const astyle = spawn(astylePath, args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Decode once at the end: a chunk can end in the middle of a multi-byte character.
        const out = [];
        const err = [];

        astyle.stdout.on('data', (data) => out.push(data));
        astyle.stderr.on('data', (data) => err.push(data));

        astyle.on('close', (exitCode) => {
            if (exitCode === 0) {
                resolve({
                    success: true,
                    code: Buffer.concat(out).toString('utf-8')
                });
            } else {
                resolve({
                    success: false,
                    error: Buffer.concat(err).toString('utf-8') || exitMessage(exitCode, astylePath)
                });
            }
        });

        astyle.on('error', (err) => {
            resolve({
                success: false,
                error: err.message
            });
        });

        // Send code to astyle via stdin
        astyle.stdin.write(code);
        astyle.stdin.end();
    });
}

module.exports = {
    detectAStyle,
    getAStylePath,
    checkAStyle,
    formatCode,
};
