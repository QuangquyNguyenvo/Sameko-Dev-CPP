/**
 * Sameko Dev C++ IDE - Compiler Detector
 * Detects and manages C++ compiler (g++) installations
 * @module app/services/compiler/detector
 */

'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

let detectedCompiler = null;

let compilerInfo = {
    name: 'Unknown',
    version: '',
    path: '',
    bundled: false,
    hasLLD: false
};

function getPortableDir() {
    return process.env.PORTABLE_EXECUTABLE_DIR || null;
}

function getBasePath() {
    if (__dirname.includes('app.asar')) {
        return __dirname.replace('app.asar', 'app.asar.unpacked');
    }
    return path.join(__dirname, '..', '..', '..');
}

function getResourcesPath() {
    if (app.isPackaged) {
        return process.resourcesPath;
    }
    return getBasePath();
}

function getBundledCompilerPaths() {
    const paths = [];
    const portableDir = getPortableDir();

    if (app.isPackaged) {
        paths.push(path.join(process.resourcesPath, 'Sameko-GCC', 'bin', 'g++.exe'));
    }

    if (portableDir) {
        paths.push(path.join(portableDir, 'Sameko-GCC', 'bin', 'g++.exe'));
        paths.push(path.join(portableDir, 'resources', 'Sameko-GCC', 'bin', 'g++.exe'));
    }

    const basePath = getBasePath();
    paths.push(path.join(basePath, 'Sameko-GCC', 'bin', 'g++.exe'));

    return paths;
}

function detectCompiler() {
    const bundledPaths = getBundledCompilerPaths();
    const portableDir = getPortableDir();

    console.log('[Compiler] Detection started');
    console.log(`[Compiler] isPackaged: ${app.isPackaged}`);
    console.log(`[Compiler] resourcesPath: ${process.resourcesPath}`);
    console.log(`[Compiler] portableDir: ${portableDir || 'N/A'}`);

    for (const compilerPath of bundledPaths) {
        const exists = fs.existsSync(compilerPath);
        console.log(`[Compiler] Checking: ${compilerPath} -> ${exists ? 'FOUND' : 'not found'}`);

        if (exists) {
            detectedCompiler = compilerPath;
            compilerInfo.name = 'Bundled MinGW';
            compilerInfo.path = compilerPath;
            compilerInfo.bundled = true;

            const binDir = path.dirname(compilerPath);
            compilerInfo.hasLLD = fs.existsSync(path.join(binDir, 'ld.lld.exe'));

            console.log(`[Compiler] Selected bundled: ${compilerPath} (LLD: ${compilerInfo.hasLLD})`);
            return compilerPath;
        }
    }

    detectedCompiler = 'g++';
    compilerInfo.name = 'System GCC';
    compilerInfo.path = 'g++ (from PATH)';
    compilerInfo.bundled = false;
    console.log('[Compiler] Fallback to g++ from PATH');
    return 'g++';
}

detectCompiler();

async function getCompilerVersion() {
    return new Promise((resolve) => {
        const compiler = detectedCompiler || 'g++';
        exec(`"${compiler}" --version`, (error, stdout) => {
            if (error) {
                resolve('Unknown');
                return;
            }
            const match = stdout.match(/g\+\+.*?(\d+\.\d+\.\d+)/);
            if (match) {
                compilerInfo.version = match[1];
                resolve(match[1]);
            } else {
                resolve('Unknown');
            }
        });
    });
}

function getDetectedCompiler() {
    return detectedCompiler;
}

function getCompilerInfo() {
    return { ...compilerInfo };
}

function getCompilerBinDir() {
    if (detectedCompiler && path.isAbsolute(detectedCompiler)) {
        return path.dirname(detectedCompiler);
    }
    return '';
}

function getCompilerEnv() {
    const env = { ...process.env };
    const binDir = getCompilerBinDir();
    if (binDir) {
        env.PATH = `${binDir}${path.delimiter}${env.PATH}`;
    }
    return env;
}

/**
 * Path to the bundled gdb.exe (same bin dir as g++). Falls back to PATH.
 * @returns {string}
 */
function getDebuggerPath() {
    const binDir = getCompilerBinDir();
    if (binDir) {
        const gdb = path.join(binDir, 'gdb.exe');
        if (fs.existsSync(gdb)) return gdb;
    }
    return 'gdb';
}

/**
 * Directory holding the libstdc++ GDB pretty-printers
 * (<toolchain>/share/gcc-<ver>/python, containing libstdcxx/v6/printers.py).
 * Returns null if not found — the debugger still runs, just without STL pretty
 * printing.
 * @returns {string|null}
 */
function getPrinterPythonDir() {
    const binDir = getCompilerBinDir();
    if (!binDir) return null;
    const shareDir = path.join(path.dirname(binDir), 'share');
    try {
        for (const entry of fs.readdirSync(shareDir)) {
            if (/^gcc-/i.test(entry)) {
                const pdir = path.join(shareDir, entry, 'python');
                if (fs.existsSync(path.join(pdir, 'libstdcxx', 'v6', 'printers.py'))) {
                    return pdir;
                }
            }
        }
    } catch (_) { /* share dir missing */ }
    return null;
}

function getUnbufferObjectPath() {
    const resourcesPath = getResourcesPath();
    const objPath = path.join(resourcesPath, 'Sameko-GCC', 'lib', 'sameko_unbuffer.o');
    if (fs.existsSync(objPath)) {
        return objPath;
    }
    return null;
}

module.exports = {
    detectCompiler,
    getCompilerVersion,
    getDetectedCompiler,
    getCompilerInfo,
    getCompilerBinDir,
    getCompilerEnv,
    getBasePath,
    getResourcesPath,
    getUnbufferObjectPath,
    getDebuggerPath,
    getPrinterPythonDir,
};
