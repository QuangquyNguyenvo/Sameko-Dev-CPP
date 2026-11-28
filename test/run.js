#!/usr/bin/env node
'use strict';

/*
 * The test runner. Every suite is its own script in a child process; one line per suite, and a
 * suite's whole output only when it fails (or with --verbose).
 *
 * Run with --help for suite selection. A suite prints
 * "  PASS  <name>" / "  FAIL  <name>" lines for its checks and exits non-zero on a failure.
 * To add one: write the script in test/<group>/, then add a line to SUITES.
 */

const { execFileSync, spawn } = require('child_process');
const path = require('path');
const { parseArgs } = require('util');
const ROOT = path.resolve(__dirname, '..');

const SUITES = [
    // unit
    { name: 'theme tokens', group: 'unit', file: 'unit/theme-tokens.js' },
    { name: 'theme manager', group: 'unit', file: 'unit/theme-manager.js' },
    { name: 'customizer state', group: 'unit', file: 'unit/theme-customizer-state.js' },
    { name: 'judge', group: 'unit', file: 'unit/judge.js' },
    { name: 'run checks', group: 'unit', file: 'unit/run-checks.js' },
    { name: 'test row tools unit', group: 'unit', file: 'unit/test-row-tools.js' },
    { name: 'source bundler', group: 'unit', file: 'unit/source-bundler.js' },
    { name: 'editor batch unit', group: 'unit', file: 'unit/editor-batch.js' },
    { name: 'test manager unit', group: 'unit', file: 'unit/test-manager.js' },
    { name: 'function prototypes', group: 'unit', file: 'unit/function-prototypes.js' },
    { name: 'mi-parser', group: 'unit', file: 'e2e/debugger.js', args: ['--unit'] },
    { name: 'oj bridge', group: 'unit', file: 'unit/oj-bridge.js' },
    { name: 'oj round trip', group: 'unit', file: 'unit/oj-roundtrip.js' },
    { name: 'update asset', group: 'unit', file: 'unit/update-asset.js' },
    { name: 'readme badges', group: 'unit', file: 'unit/badges.js' },
    { name: 'extension', group: 'unit', file: '../extension/test/run.js' },
    { name: 'extension adapters', group: 'unit', file: '../extension/test/adapter-fixtures.js' },
    // gui
    { name: 'gui', group: 'gui', file: 'gui/app.js' },
    { name: 'theme customizer gui', group: 'gui', file: 'gui/theme-customizer.js' },
    { name: 'checker gui', group: 'gui', file: 'gui/checker.js' },
    { name: 'function prototypes gui', group: 'gui', file: 'gui/function-prototypes.js' },
    { name: 'editor batch gui', group: 'gui', file: 'gui/editor-batch.js' },
    { name: 'run fixes gui', group: 'gui', file: 'gui/run-fixes.js' },
    { name: 'test row tools gui', group: 'gui', file: 'gui/test-row-tools.js' },
    { name: 'test manager gui', group: 'gui', file: 'gui/test-manager.js' },
    { name: 'docking gui', group: 'gui', file: 'gui/docking.js' },
    // e2e
    { name: 'gdb e2e', group: 'e2e', file: 'e2e/debugger.js', args: ['--e2e'] },
].map((suite, index) => ({ ...suite, id: index + 1, file: path.posix.normalize(`test/${suite.file}`) }));
const GROUPS = ['unit', 'gui', 'e2e'];

function selectSuites(selectors) {
    const groups = selectors.filter(selector => GROUPS.includes(selector));
    const matches = selectors.filter(selector => !GROUPS.includes(selector)).map(selector => {
        if (!selector) throw new Error('Empty suite selector. Run npm test -- --list to see the catalog.');
        if (!/^\d/.test(selector)) {
            return suite => suite.name.includes(selector) || path.basename(suite.file, '.js') === selector ||
                suite.file === selector;
        }
        const range = /^(\d+)(?:-(\d+))?$/.exec(selector);
        const first = Number(range?.[1]);
        const last = Number(range?.[2] ?? range?.[1]);
        if (!range || first < 1 || last < first || last > SUITES.length) {
            throw new Error(`Invalid suite number or range ${selector}. Use 1 through ${SUITES.length} from --list.`);
        }
        return suite => suite.id >= first && suite.id <= last;
    });
    return SUITES.filter(suite => (!groups.length || groups.includes(suite.group)) &&
        (!matches.length || matches.some(match => match(suite))));
}

function runSuite(suite, verbose) {
    const t0 = Date.now();
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(ROOT, suite.file), ...(suite.args || [])],
            { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });
        child.on('error', err => { out += String(err); });
        child.on('close', (code) => {
            const pass = (out.match(/^\s*PASS\b/gm) || []).length;
            const fail = (out.match(/^\s*FAIL\b/gm) || []).length;
            const skip = (out.match(/^\s*SKIP\b/gm) || []).length;
            const ok = code === 0;
            const counts = pass + fail ? `${pass} passed${fail ? `, ${fail} failed` : ''}${skip ? `, ${skip} skipped` : ''}` : (ok ? 'ok' : 'failed');
            console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(suite.id).padStart(2)}  ${suite.group.padEnd(5)} ${suite.name.padEnd(22)} ${counts.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            if (verbose) console.log(out.trimEnd().replace(/^/gm, '      ') + '\n');
            resolve({ name: suite.name, ok, out });
        });
    });
}

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            help: { type: 'boolean', short: 'h' },
            list: { type: 'boolean' },
            verbose: { type: 'boolean', short: 'v' },
            parallel: { type: 'boolean' },
        },
    });

    if (values.help) {
        console.log(`Usage: npm test -- [unit|gui|e2e] [name|number|first-last ...] [options]
With no selectors, run every suite. Multiple selectors match any name or number within the selected groups.
  --list      Show suite numbers and files for this selection without running tests
  -v          Show each suite's output (--verbose)
  --parallel  Run selected GUI suites together (uses more memory)
  -h          Show this help (--help)`);
        return;
    }

    const picked = selectSuites(positionals.map(selector => selector.trim().toLowerCase().replaceAll('\\', '/')));
    if (!picked.length) {
        throw new Error(`No suites match ${positionals.join(' ')}. Run npm test -- --list to see the catalog.`);
    }

    if (values.list) {
        for (const suite of picked) {
            const args = suite.args?.join(' ') ?? '';
            console.log(`${String(suite.id).padStart(2)}  ${suite.group.padEnd(5)} ${suite.name.padEnd(22)} ${suite.file}${args ? ' ' + args : ''}`);
        }
        return;
    }

    // Unit suites first (fast, and a broken build is caught before Electron starts). Then the
    // gui suites one at a time, so only one app window (~500 MB) is open at once, while the
    // e2e suites (gdb, no window) run beside them. --parallel runs every gui suite at once.
    const { parallel, verbose } = values;
    const stages = [picked.filter(s => s.group === 'unit'), picked.filter(s => s.group !== 'unit')].filter(st => st.length);
    const t0 = Date.now();
    const failures = [];
    console.log(`Running ${picked.length} of ${SUITES.length} suites`);
    for (const stage of stages) {
        if (failures.length) { console.log(`skipped ${stage.length} suite(s): an earlier stage failed`); break; }
        const gui = stage.filter(s => s.group === 'gui');
        if (gui.length) {
            execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-monaco.js'), '--if-stale'],
                { cwd: ROOT, stdio: 'inherit' });
        }
        const oneAtATime = async () => { const out = []; for (const s of gui) out.push(await runSuite(s, verbose)); return out; };
        const results = parallel || gui.length < 2
            ? await Promise.all(stage.map(s => runSuite(s, verbose)))
            : (await Promise.all([oneAtATime(), ...stage.filter(s => s.group !== 'gui').map(s => runSuite(s, verbose).then(r => [r]))])).flat();
        failures.push(...results.filter(r => !r.ok));
    }
    if (!verbose) for (const f of failures) console.log(`\n===== ${f.name} =====\n${f.out.trimEnd()}`);
    console.log(`\n${failures.length ? 'FAILED' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exitCode = failures.length ? 1 : 0;
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
