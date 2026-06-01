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
        path.join(resourcesPath, 'Sameko-GCC', 'bin', 'astyle.exe'),
        path.join(basePath, 'Sameko-GCC', 'bin', 'astyle.exe'),
        // System paths
        'C:\\TDM-GCC-64\\bin\\astyle.exe',
        'C:\\Program Files\\AStyle\\bin\\astyle.exe',
        'C:\\Program Files (x86)\\AStyle\\bin\\astyle.exe',
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            console.log(`[AStyle] Found: ${p}`);
            return p;
        }
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
            error: 'AStyle was not found. Download astyle.exe and place it in Sameko-GCC\\bin\\.'
        };
    }

    const { getStyleArgs } = require('./styles');
    const args = getStyleArgs(style);

    return new Promise((resolve) => {
        const astyle = spawn(astylePath, args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let formattedCode = '';
        let errorOutput = '';

        astyle.stdout.on('data', (data) => {
            formattedCode += data.toString();
        });

        astyle.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        astyle.on('close', (exitCode) => {
            if (exitCode === 0) {
                resolve({
                    success: true,
                    code: formattedCode
                });
            } else {
                resolve({
                    success: false,
                    error: errorOutput || `AStyle exited with code ${exitCode}`
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
