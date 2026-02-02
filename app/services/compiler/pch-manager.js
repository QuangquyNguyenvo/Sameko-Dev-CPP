/**
 * Sameko Dev C++ IDE - Precompiled Header Manager
 * Manages PCH for faster compilation with bits/stdc++.h
 * @module app/services/compiler/pch-manager
 */

'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getDetectedCompiler, getCompilerInfo, getCompilerEnv } = require('./detector');

const pchDir = path.join(app.getPath('temp'), 'cpp-ide-pch');

/**
 * Generate PCH key based on compiler flags
 * Different optimization levels need separate PCH files
 * 
 * @param {string} [flags=''] - Compiler flags
 * @returns {string} PCH key (e.g., 'O2_stdcpp17')
 */
function getPCHKey(flags = '') {
    const optMatch = flags.match(/-O[0-3|s|fast]/);
    const stdMatch = flags.match(/-std=[^ ]+/);
    const opt = optMatch ? optMatch[0] : '-O0';
    const std = stdMatch ? stdMatch[0] : '';
    return `${opt}_${std}`.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Ensure PCH is created for given flags
 * Will rebuild if compiler changed
 * 
 * @param {string} [flags=''] - Compiler flags
 * @param {Function} [onMessage] - Callback to send status messages
 * @returns {Promise<{ready: boolean, pchSubDir?: string, pchKey?: string}>}
 */
async function ensurePCH(flags = '', onMessage = null) {
    // Ensure base PCH directory exists
    if (!fs.existsSync(pchDir)) {
        fs.mkdirSync(pchDir, { recursive: true });
    }

    const pchKey = getPCHKey(flags);
    const pchSubDir = path.join(pchDir, pchKey);

    if (!fs.existsSync(pchSubDir)) {
        fs.mkdirSync(pchSubDir, { recursive: true });
    }

    const pchHeader = path.join(pchSubDir, 'stdc++.h');
    const pchFile = path.join(pchSubDir, 'stdc++.h.gch');
    const pchInfoFile = path.join(pchSubDir, 'pch-info.json');

    const compilerExe = getDetectedCompiler() || 'g++';
    const compilerInfo = getCompilerInfo();

    // Check if existing PCH is valid
    if (fs.existsSync(pchFile) && fs.existsSync(pchInfoFile)) {
        try {
            const pchInfo = JSON.parse(fs.readFileSync(pchInfoFile, 'utf-8'));
            if (pchInfo.compiler === compilerExe && pchInfo.version === compilerInfo.version) {
                return { ready: true, pchSubDir, pchKey };
            }
        } catch (e) {
            // Invalid PCH info, will rebuild
        }
    }

    // Parse flags for build
    const optMatch = flags.match(/-O[0-3|s|fast]/);
    const stdMatch = flags.match(/-std=[^ ]+/);
    const buildArgs = ['-x', 'c++-header', 'stdc++.h', '-o', 'stdc++.h.gch'];
    if (optMatch) buildArgs.push(optMatch[0]);
    if (stdMatch) buildArgs.push(stdMatch[0]);

    // Create header file if not exists
    if (!fs.existsSync(pchHeader)) {
        fs.writeFileSync(pchHeader, '#include <bits/stdc++.h>\n', 'utf-8');
    }

    // Notify user
    if (onMessage) {
        const optStr = optMatch ? optMatch[0] : '-O0';
        const stdStr = stdMatch ? ' ' + stdMatch[0] : '';
        onMessage({
            type: 'info',
            message: `Optimizing libraries for configuration ${optStr}${stdStr}...`
        });
    }

    // Build PCH
    return new Promise((resolve) => {
        const env = getCompilerEnv();

        const compiler = spawn(compilerExe, buildArgs, { cwd: pchSubDir, env: env });

        compiler.on('close', (code) => {
            if (code === 0) {
                // Save PCH info for cache validation
                fs.writeFileSync(pchInfoFile, JSON.stringify({
                    compiler: compilerExe,
                    version: compilerInfo.version,
                    flags: buildArgs.join(' ')
                }), 'utf-8');

                console.log(`[PCH] Created PCH for ${pchKey}`);
                resolve({ ready: true, pchSubDir, pchKey });
            } else {
                console.log(`[PCH] Failed to create PCH for ${pchKey}`);
                resolve({ ready: false });
            }
        });

        compiler.on('error', () => {
            resolve({ ready: false });
        });
    });
}

/**
 * Clean all PCH caches
 */
function cleanPCHCache() {
    if (fs.existsSync(pchDir)) {
        const entries = fs.readdirSync(pchDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const subDir = path.join(pchDir, entry.name);
                const files = fs.readdirSync(subDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(subDir, file));
                }
                fs.rmdirSync(subDir);
            }
        }
        console.log('[PCH] Cache cleaned');
    }
}

function getPCHDir() {
    return pchDir;
}

module.exports = {
    ensurePCH,
    getPCHKey,
    cleanPCHCache,
    getPCHDir,
};
