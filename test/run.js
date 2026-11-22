#!/usr/bin/env node
'use strict';

/*
 * The test runner. Every suite is its own script in a child process; one line per suite, and a
 * suite's whole output only when it fails (or with --verbose).
 *
 *   node test/run.js                 everything (npm test): unit first, then the gui suites one
 *                                    app at a time while e2e runs beside them
 *   node test/run.js --parallel      the same, with every gui suite at once (faster, more RAM)
 *   node test/run.js unit            one group (npm run test:unit / test:gui / test:e2e)
 *   node test/run.js checker oj      suites whose name contains a word
 *   node test/run.js --list          the suites and their groups
 *   node test/run.js -v ...          print every suite's output
 *
 * Groups: unit (plain Node, no Electron, no compiler: seconds), gui (the real app on a temp
 * profile, through Playwright), e2e (the bundled toolchain: gdb). A suite prints
 * "  PASS  <name>" / "  FAIL  <name>" lines for its checks and exits non-zero on a failure.
 * To add one: write the script in test/<group>/, then add a line to SUITES.
 */

const { spawn } = require('child_process');
const path = require('path');

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
    { name: 'mi-parser', group: 'unit', file: 'e2e/debugger.js', args: ['--unit'] },
    { name: 'oj bridge', group: 'unit', file: 'unit/oj-bridge.js' },
    { name: 'oj round trip', group: 'unit', file: 'unit/oj-roundtrip.js' },
    { name: 'extension', group: 'unit', file: '../extension/test/run.js' },
    { name: 'extension adapters', group: 'unit', file: '../extension/test/adapter-fixtures.js' },
    // gui
    { name: 'gui', group: 'gui', file: 'gui/app.js' },
    { name: 'theme customizer gui', group: 'gui', file: 'gui/theme-customizer.js' },
    { name: 'checker gui', group: 'gui', file: 'gui/checker.js' },
    { name: 'editor batch gui', group: 'gui', file: 'gui/editor-batch.js' },
    { name: 'run fixes gui', group: 'gui', file: 'gui/run-fixes.js' },
    { name: 'test row tools gui', group: 'gui', file: 'gui/test-row-tools.js' },
    { name: 'test manager gui', group: 'gui', file: 'gui/test-manager.js' },
    { name: 'docking gui', group: 'gui', file: 'gui/docking.js' },
    // e2e
    { name: 'gdb e2e', group: 'e2e', file: 'e2e/debugger.js', args: ['--e2e'] },
];
const GROUPS = ['unit', 'gui', 'e2e'];

function runSuite(suite, verbose) {
    const t0 = Date.now();
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(__dirname, suite.file), ...(suite.args || [])],
            { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
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
            console.log(`${ok ? 'ok  ' : 'FAIL'}  ${suite.group.padEnd(5)} ${suite.name.padEnd(22)} ${counts.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            if (verbose) console.log(out.trimEnd().replace(/^/gm, '      ') + '\n');
            resolve({ name: suite.name, ok, out });
        });
    });
}

(async () => {
    const argv = process.argv.slice(2);
    const verbose = argv.some(a => a === '-v' || a === '--verbose');
    const words = argv.filter(a => !a.startsWith('-'));

    if (argv.includes('--list')) {
        for (const g of GROUPS) {
            console.log(g);
            for (const s of SUITES.filter(x => x.group === g)) console.log(`  ${s.name.padEnd(22)} test/${s.file}${s.args ? ' ' + s.args.join(' ') : ''}`);
        }
        return;
    }

    const picked = words.length
        ? SUITES.filter(s => words.some(w => s.group === w || s.name.includes(w)))
        : SUITES;
    if (!picked.length) {
        console.log(`No suite matches: ${words.join(' ')}. See: node test/run.js --list`);
        process.exitCode = 1;
        return;
    }

    // Unit suites first (fast, and a broken build is caught before Electron starts). Then the
    // gui suites one at a time, so only one app window (~500 MB) is open at once, while the
    // e2e suites (gdb, no window) run beside them. --parallel runs every gui suite at once.
    const parallel = argv.includes('--parallel');
    const stages = [picked.filter(s => s.group === 'unit'), picked.filter(s => s.group !== 'unit')].filter(st => st.length);
    const t0 = Date.now();
    const failures = [];
    for (const stage of stages) {
        if (failures.length) { console.log(`skipped ${stage.length} suite(s): an earlier stage failed`); break; }
        const gui = stage.filter(s => s.group === 'gui');
        const oneAtATime = async () => { const out = []; for (const s of gui) out.push(await runSuite(s, verbose)); return out; };
        const results = parallel || gui.length < 2
            ? await Promise.all(stage.map(s => runSuite(s, verbose)))
            : (await Promise.all([oneAtATime(), ...stage.filter(s => s.group !== 'gui').map(s => runSuite(s, verbose).then(r => [r]))])).flat();
        failures.push(...results.filter(r => !r.ok));
    }
    if (!verbose) for (const f of failures) console.log(`\n===== ${f.name} =====\n${f.out.trimEnd()}`);
    console.log(`\n${failures.length ? 'FAILED' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exitCode = failures.length ? 1 : 0;
})();
