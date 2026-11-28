'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { IS_WIN, IS_LINUX, appTempDir, binName, ensurePrivateDir, which } = require('../../../shared/platform');
const { splitFlags, joinFlags } = require('../../../shared/validators');

const exec = promisify(execFile);
const LINUX_CHECKS = ['-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-fno-omit-frame-pointer'];

function findGprof(binDir) {
    if (binDir) {
        const candidate = path.join(binDir, binName('gprof'));
        if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    }
    return IS_LINUX ? which('gprof') : null;
}

async function canLinkSanitizers(cwd) {
    const { getDetectedCompiler, getCompilerEnv } = require('../toolchain/detector');
    const src = path.join(cwd, 'probe.cpp');
    await fs.promises.writeFile(src, 'int main() {}\n');
    try {
        await exec(getDetectedCompiler() || 'g++', [src, '-o', path.join(cwd, binName('probe')), ...LINUX_CHECKS], {
            cwd, env: getCompilerEnv(), timeout: 10000,
        });
        return true;
    } catch (_) {
        return false;
    }
}

function instrumentationFlags(flags, mode, { windows, sanitizers }) {
    // Use a symbolized, unoptimized build, irrespective of the normal judge's options.
    const base = splitFlags(flags).filter(flag =>
        !/^-(O|g|flto|fuse-ld=)/.test(flag) && flag !== '-s' && flag !== '-Wl,--strip-all');
    if (mode === 'profile') {
        // MinGW gmon can produce an empty histogram for a relocated image.
        return joinFlags([...base, '-g', '-O0', '-pg', ...(windows ? ['-no-pie'] : [])]);
    }

    const compatible = base.filter(flag => !/^-f(no-)?sanitize/.test(flag));
    return joinFlags([
        ...compatible, '-g', '-O0', '-D_GLIBCXX_DEBUG',
        ...(!windows ? ['-D_GLIBCXX_DEBUG_PEDANTIC'] : []),
        ...(sanitizers ? LINUX_CHECKS : []),
    ]);
}

function summarizeFlatProfile(output) {
    const lines = output.trimEnd().split(/\r?\n/);
    const header = lines.findIndex(line => /^\s*time\s+seconds\s+seconds\s+calls\b/.test(line));
    if (header === -1) return '';
    const rows = lines.slice(header + 1).filter(line => /^\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d/.test(line));
    return rows.length ? [...lines.slice(0, header + 1), ...rows.slice(0, 15)].join('\n') : '';
}

async function runInstrumentedTest({ mode, filePath, content, flags, untitledId, singleFileMode, input, inputPath = '', fileIO = null, timeLimit } = {}) {
    if (mode !== 'checks' && mode !== 'profile') return { issue: 'Invalid test action.' };
    const profiling = mode === 'profile';
    let tempDir;
    let sanitizers = false;
    let stage = 'Instrumented build failed.';
    try {
        const { getCompilerBinDir, getCompilerEnv } = require('../toolchain/detector');
        const gprof = profiling ? findGprof(getCompilerBinDir()) : null;
        if (profiling && !gprof) return { issue: 'gprof is unavailable for this toolchain.' };
        if (profiling || IS_LINUX) {
            const root = appTempDir('sameko-instrumentation');
            ensurePrivateDir(root);
            tempDir = await fs.promises.mkdtemp(path.join(root, 'run-'));
        }
        sanitizers = !profiling && IS_LINUX && await canLinkSanitizers(tempDir);
        const built = await require('../executor').compile({
            filePath, content, untitledId, singleFileMode,
            flags: instrumentationFlags(flags, mode, { windows: IS_WIN, sanitizers }),
            useLLD: false, realtimeOutput: false, noBuildCache: true, variant: mode,
        });
        if (!built.success) return { issue: stage, detail: built.error, sanitizers };
        stage = 'Could not run the test.';
        const limit = Number(timeLimit);
        const run = await require('../../competitive/batch-tester').runTest({
            exePath: built.outputPath, input, inputPath, fileIO, expectedOutput: '',
            timeLimit: Math.max(5000, Number.isFinite(limit) ? limit : 0),
            cwd: profiling ? tempDir : (filePath ? path.dirname(filePath) : undefined),
            // Instrumentation has different memory requirements from the judge.
            memoryLimit: 0,
            profiling,
        });
        if (!profiling || run.status !== 'RAN') return { run, sanitizers };

        stage = 'Could not read the flat profile.';
        const data = path.join(tempDir, 'gmon.out');
        if (!fs.existsSync(data)) return { issue: 'The program produced no profiling data.', run };
        const { stdout } = await exec(gprof, ['-b', '-p', built.outputPath, data], {
            cwd: tempDir, env: { ...getCompilerEnv(), LC_ALL: 'C' },
            timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
        });
        const profile = summarizeFlatProfile(stdout);
        return profile ? { run, profile } : { run, issue: 'The profile contained no function samples.', detail: stdout.slice(0, 8192) };
    } catch (err) {
        return { issue: stage, detail: err.stderr || err.message, sanitizers };
    } finally {
        if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { runInstrumentedTest, instrumentationFlags, summarizeFlatProfile };
