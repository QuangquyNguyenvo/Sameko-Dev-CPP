#!/usr/bin/env node
'use strict';

/*
 * npm test: every test script, in parallel child processes.
 *   Stage 1  unit checks (no Electron, no gdb), well under a second.
 *   Stage 2  the Electron GUI suites and the gdb E2E, run side by side;
 *            skipped when stage 1 fails.
 * One line per suite; a suite's full output is printed only when it fails.
 */

const { spawn } = require('child_process');
const path = require('path');

const STAGES = [
    [
        ['theme tokens', 'test-theme-tokens.js'],
        ['theme manager', 'test-theme-manager.js'],
        ['customizer state', 'test-theme-customizer-state.js'],
        ['mi-parser', 'test-debugger.js', '--unit'],
        ['run checks', 'test-run-checks.js'],
        ['judge', '../app/services/competitive/judge-selftest.js']
    ],
    [
        ['gui', 'test-gui.js'],
        ['theme customizer gui', 'test-theme-customizer-gui.js'],
        ['gdb e2e', 'test-debugger.js', '--e2e']
    ]
];

function runSuite([name, file, ...args]) {
    const t0 = Date.now();
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(__dirname, file), ...args],
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
            console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${counts.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            resolve({ name, ok, out });
        });
    });
}

(async () => {
    const t0 = Date.now();
    const failures = [];
    for (const [i, stage] of STAGES.entries()) {
        if (failures.length) { console.log(`skipped stage ${i + 1} (stage ${i} failed)`); break; }
        const results = await Promise.all(stage.map(runSuite));
        failures.push(...results.filter(r => !r.ok));
    }
    for (const f of failures) console.log(`\n===== ${f.name} =====\n${f.out.trimEnd()}`);
    console.log(`\n${failures.length ? 'FAILED' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exitCode = failures.length ? 1 : 0;
})();
