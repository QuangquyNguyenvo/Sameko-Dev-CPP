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
const { binName, systemCompilerPaths, which } = require('../../shared/platform');

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

let writableBasePath = null;

/**
 * Directory for the files the app writes next to itself at runtime: clangd's
 * compile_flags.txt, the mock paths backing untitled tabs, compile_error.log.
 *
 * getBasePath() is the install directory, and it is only writable by accident:
 * a per-user NSIS install on Windows happens to be, but a .deb lands in
 * root-owned /opt and an AppImage is a read-only squashfs mount — both gave
 * `EACCES: permission denied` there. Fall back to userData, which is always
 * ours. Keep the install dir when it genuinely is writable so existing Windows
 * installs keep using the exact same paths as before.
 *
 * Everything that has to sit next to compile_flags.txt (the untitled mock
 * files, clangd's root URI) must come from here too, or clangd walks up from a
 * directory that has no compile_flags.txt in it and resolves no headers.
 * @returns {string}
 */
function getWritableBasePath() {
    if (writableBasePath) return writableBasePath;

    const base = getBasePath();
    try {
        // In a packaged build `base` is the app.asar.unpacked path, which
        // electron-builder only creates for files it actually unpacks — so it
        // often does not exist yet and has to be created before it can be
        // tested. On Windows that succeeds and the paths stay exactly where
        // they have always been; on /opt or a squashfs mount it throws.
        fs.mkdirSync(base, { recursive: true });
        fs.accessSync(base, fs.constants.W_OK);
        writableBasePath = base;
        return writableBasePath;
    } catch (_) { /* read-only install (deb /opt, AppImage mount) */ }

    writableBasePath = app.getPath('userData');
    return writableBasePath;
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
        paths.push(path.join(process.resourcesPath, 'Sameko-GCC', 'bin', binName('g++')));
    }

    if (portableDir) {
        paths.push(path.join(portableDir, 'Sameko-GCC', 'bin', binName('g++')));
        paths.push(path.join(portableDir, 'resources', 'Sameko-GCC', 'bin', binName('g++')));
    }

    const basePath = getBasePath();
    paths.push(path.join(basePath, 'Sameko-GCC', 'bin', binName('g++')));

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
            compilerInfo.hasLLD = fs.existsSync(path.join(binDir, binName('ld.lld')));

            console.log(`[Compiler] Selected bundled: ${compilerPath} (LLD: ${compilerInfo.hasLLD})`);
            return compilerPath;
        }
    }

    // No bundled toolchain: fall back to a SYSTEM g++.
    // We must resolve an ABSOLUTE path here (not bare 'g++'), because
    // getCompilerBinDir() returns '' for non-absolute compilers, which in turn
    // disables clangd (it looks for `clangd` next to g++) and breaks
    // --query-driver. See plans/linux-support/phase-02 "BLOCKER #1".
    const systemCandidates = systemCompilerPaths();
    let systemPath = null;
    for (const candidate of systemCandidates) {
        if (fs.existsSync(candidate)) { systemPath = candidate; break; }
    }
    if (!systemPath) {
        // Not in the well-known locations — ask the OS (`which` / `where`).
        systemPath = which('g++');
    }

    if (systemPath) {
        detectedCompiler = systemPath;
        compilerInfo.name = 'System GCC';
        compilerInfo.path = systemPath;
        compilerInfo.bundled = false;

        const sysBinDir = path.dirname(systemPath);
        compilerInfo.hasLLD = fs.existsSync(path.join(sysBinDir, binName('ld.lld')));

        console.log(`[Compiler] Selected system: ${systemPath} (LLD: ${compilerInfo.hasLLD})`);
        return systemPath;
    }

    // Last resort: bare 'g++' and hope it is on PATH. Degraded mode —
    // clangd/IntelliSense will be unavailable because bin dir is unknown.
    detectedCompiler = 'g++';
    compilerInfo.name = 'System GCC';
    compilerInfo.path = 'g++ (from PATH)';
    compilerInfo.bundled = false;
    console.warn('[Compiler] Fallback to bare g++ from PATH (clangd will be unavailable)');
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
        const gdb = path.join(binDir, binName('gdb'));
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
    getWritableBasePath,
    getResourcesPath,
    getUnbufferObjectPath,
    getDebuggerPath,
    getPrinterPythonDir,
};
