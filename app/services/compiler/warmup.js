/**
 * Sameko Dev C++ IDE - Compiler Warmup
 * Pre-caches compiler binaries in RAM for faster first compilation
 * @module app/services/compiler/warmup
 */

'use strict';

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { getDetectedCompiler, getCompilerInfo, getCompilerEnv } = require('./detector');
const { binName } = require('../../shared/platform');

/**
 * Perform compiler warmup
 * Background compilation to warm the OS file cache for the compiler driver and its
 * subprocesses (g++, cc1plus, as, ld) so the first real compile is not a cold start.
 * This reduces "Cold Start" latency for the first user actual compilation
 * 
 * @param {number} [delay=1000] - Delay in ms before starting warmup
 */
function performCompilerWarmup(delay = 1000) {
    setTimeout(() => {
        const compiler = getDetectedCompiler() || 'g++';
        const compilerInfo = getCompilerInfo();
        const env = getCompilerEnv();

        console.log('[System] Warming up compiler and linker binaries...');

        // Warm up Compiler - compile and link a minimal program into the temp folder.
        // Not `-o NUL`: MinGW ld appends `.exe` and writes `NUL.exe` into the cwd.
        const tmp = os.tmpdir();
        const out = path.join(tmp, binName('sameko-warmup'));
        const child = spawn(compiler, ['-x', 'c++', '-', '-o', out, '-pipe', '-s', '-O0'], {
            cwd: tmp,
            stdio: ['pipe', 'ignore', 'ignore'],
            windowsHide: true,
            env: env
        });

        child.on('error', () => {
            // Silently ignore warmup errors
        });

        if (child.stdin) {
            child.stdin.write('int main(){return 0;}');
            child.stdin.end();
        }

        // Warm up LLD Linker (if available)
        if (compilerInfo.hasLLD && path.isAbsolute(compiler)) {
            const binDir = path.dirname(compiler);
            const lldPath = path.join(binDir, binName('ld.lld'));
            const lldWarmup = spawn(lldPath, ['--version'], {
                windowsHide: true,
                stdio: 'ignore'
            });
            lldWarmup.on('error', () => {
                // Silently ignore LLD warmup errors
            });
        }

        console.log('[System] Compiler warmup initiated');
    }, delay);
}

/**
 * Quick warmup - immediate warmup without delay
 * Use when user is about to compile
 */
function quickWarmup() {
    performCompilerWarmup(0);
}

module.exports = {
    performCompilerWarmup,
    quickWarmup,
};
