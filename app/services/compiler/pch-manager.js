/**
 * Sameko Dev C++ IDE - Precompiled Header Manager
 * Manages PCH for faster compilation with bits/stdc++.h
 * @module app/services/compiler/pch-manager
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getDetectedCompiler, getCompilerEnv } = require('./detector');
const { ensurePrivateDir, appTempDir } = require('../../shared/platform');

const pchDir = appTempDir('cpp-ide-pch');

// A .gch for bits/stdc++.h is 110-120 MB, and every distinct flag set gets its
// own. Keep the most recently used few and delete the rest.
const MAX_PCH_VARIANTS = 4;

/** Builds in flight, keyed by PCH key, so two callers never write one .gch at once. */
const inFlight = new Map();

/**
 * `-f` options that do not change what a precompiled header contains. Everything
 * else starting with `-f` is treated as relevant: being wrong in that direction
 * only costs one extra PCH, being wrong the other way makes GCC silently reject
 * the PCH and re-parse the whole header on every compile.
 */
const IRRELEVANT_F = /^-f(?:max-errors|diagnostics|no-diagnostics|message-length|syntax-only|use-ld|stack-usage|lto|no-lto|ltrans|wpa)/;

/**
 * Extract the flags a PCH must be built with to be usable by a compile that
 * uses `flags`. GCC rejects a PCH (and falls back to the textual header,
 * silently under `-w`) when the optimisation level, language standard, debug
 * info, command-line macros or most `-f`/`-m` options differ.
 *
 * @param {string} [flags='']
 * @returns {string[]} flags in their original order
 */
function getPCHFlags(flags = '') {
    const tokens = String(flags).split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (/^-O(?:fast|[0-3sgz])?$/.test(t)) out.push(t);
        else if (/^-std=/.test(t)) out.push(t);
        else if (/^-g/.test(t)) { if (t !== '-g0') out.push(t); }
        else if ((t === '-D' || t === '-U') && tokens[i + 1]) { out.push(t + tokens[++i]); }
        else if (/^-[DU]./.test(t)) out.push(t);
        else if (/^-f/.test(t)) { if (!IRRELEVANT_F.test(t)) out.push(t); }
        else if (/^-m/.test(t)) { if (t !== '-mwindows' && t !== '-mconsole') out.push(t); }
        else if (t === '-pthread') out.push(t);
    }
    return out;
}

/**
 * Generate PCH key based on compiler flags.
 * The plain `-O` + `-std` case keeps the historical readable key
 * (e.g. 'O0_stdc17') so existing caches stay valid; any further relevant flag
 * adds a short hash of the whole set.
 *
 * @param {string} [flags=''] - Compiler flags
 * @returns {string} PCH key
 */
function getPCHKey(flags = '') {
    const relevant = getPCHFlags(flags);
    const opt = relevant.filter((f) => /^-O/.test(f)).pop() || '-O0';
    const std = relevant.filter((f) => /^-std=/.test(f)).pop() || '';
    const base = `${opt}_${std}`.replace(/[^a-zA-Z0-9_]/g, '');
    const rest = relevant.filter((f) => !/^-O/.test(f) && !/^-std=/.test(f));
    if (rest.length === 0) return base;
    const hash = crypto.createHash('sha1').update(rest.join(' ')).digest('hex').slice(0, 10);
    return `${base}_${hash}`;
}

/** Identity of the compiler binary; a toolchain update changes it. */
function compilerFingerprint(compilerExe) {
    try {
        const st = fs.statSync(compilerExe);
        return `${st.size}:${Math.round(st.mtimeMs)}`;
    } catch (_) {
        return '';
    }
}

/** Delete the least recently used PCH variants beyond MAX_PCH_VARIANTS. */
function pruneOldVariants(keepKey) {
    try {
        const dirs = fs.readdirSync(pchDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => {
                const full = path.join(pchDir, e.name);
                let used = 0;
                try { used = fs.statSync(path.join(full, 'pch-info.json')).mtimeMs; } catch (_) { }
                return { name: e.name, full, used };
            })
            .sort((a, b) => b.used - a.used);
        for (const d of dirs.slice(MAX_PCH_VARIANTS)) {
            if (d.name === keepKey || inFlight.has(d.name)) continue;
            try { fs.rmSync(d.full, { recursive: true, force: true }); } catch (_) { }
        }
    } catch (_) { }
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
    // Ensure base PCH directory exists.
    // On POSIX `temp` is the shared /tmp, and the .gch here is -include'd into
    // every compile, so keep it private (0700) to prevent cross-user tampering.
    if (!fs.existsSync(pchDir)) {
        ensurePrivateDir(pchDir);
    }

    const pchKey = getPCHKey(flags);
    const pchSubDir = path.join(pchDir, pchKey);

    // A build for this key is already running (startup warm-up vs. the user's
    // first compile, or two live checks) — wait for it instead of racing it.
    if (inFlight.has(pchKey)) return inFlight.get(pchKey);

    if (!fs.existsSync(pchSubDir)) {
        ensurePrivateDir(pchSubDir);
    }

    const pchHeader = path.join(pchSubDir, 'stdc++.h');
    const pchFile = path.join(pchSubDir, 'stdc++.h.gch');
    const pchInfoFile = path.join(pchSubDir, 'pch-info.json');

    const compilerExe = getDetectedCompiler() || 'g++';
    const fingerprint = compilerFingerprint(compilerExe);

    // Check if existing PCH is valid
    if (fs.existsSync(pchFile) && fs.existsSync(pchInfoFile)) {
        try {
            const pchInfo = JSON.parse(fs.readFileSync(pchInfoFile, 'utf-8'));
            // Caches written before the fingerprint existed have none; accept
            // them on a matching compiler path rather than forcing a rebuild.
            const sameBinary = pchInfo.fingerprint === undefined || pchInfo.fingerprint === fingerprint;
            if (pchInfo.compiler === compilerExe && sameBinary) {
                return { ready: true, pchSubDir, pchKey };
            }
        } catch (e) {
            // Invalid PCH info, will rebuild
        }
    }

    const pchFlags = getPCHFlags(flags);
    const buildArgs = ['-x', 'c++-header', 'stdc++.h', '-o', 'stdc++.h.gch', ...pchFlags];

    // Create header file if not exists
    if (!fs.existsSync(pchHeader)) {
        fs.writeFileSync(pchHeader, '#include <bits/stdc++.h>\n', 'utf-8');
    }

    // Notify user
    if (onMessage) {
        onMessage({
            type: 'info',
            message: `Optimizing libraries for configuration ${pchFlags.join(' ') || '-O0'}...`
        });
    }

    // Build PCH
    const build = new Promise((resolve) => {
        const env = getCompilerEnv();

        const compiler = spawn(compilerExe, buildArgs, { cwd: pchSubDir, env: env });

        compiler.on('close', (code) => {
            if (code === 0) {
                // Save PCH info for cache validation
                try {
                    fs.writeFileSync(pchInfoFile, JSON.stringify({
                        compiler: compilerExe,
                        fingerprint,
                        flags: buildArgs.join(' ')
                    }), 'utf-8');
                } catch (_) { }

                console.log(`[PCH] Created PCH for ${pchKey}`);
                pruneOldVariants(pchKey);
                resolve({ ready: true, pchSubDir, pchKey });
            } else {
                console.log(`[PCH] Failed to create PCH for ${pchKey}`);
                // Do not leave a half-written .gch behind.
                try { fs.unlinkSync(pchFile); } catch (_) { }
                resolve({ ready: false });
            }
        });

        compiler.on('error', () => {
            resolve({ ready: false });
        });
    });

    inFlight.set(pchKey, build);
    build.then(() => inFlight.delete(pchKey), () => inFlight.delete(pchKey));
    return build;
}

/**
 * Clean all PCH caches
 */
function cleanPCHCache() {
    if (fs.existsSync(pchDir)) {
        const entries = fs.readdirSync(pchDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                fs.rmSync(path.join(pchDir, entry.name), { recursive: true, force: true });
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
    getPCHFlags,
    cleanPCHCache,
    getPCHDir,
};
