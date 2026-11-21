#!/usr/bin/env node
'use strict';

/*
 * GUI checks for run and judging fixes, in one launch on a throwaway profile:
 * the Output card's verdict (RE on a crash, the tab's compare mode), end of input (EOF)
 * for `while (cin >> x)`, stress TLE suspects, builds held while a file changed on disk
 * waits for Reload, and unsaved work kept while the restore prompt waits.
 *
 *   node test/gui/run-fixes.js     (part of npm test / test:gui)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-fix-'));
let app;
let failed = 0;
let passed = 0;

async function check(name, test) {
    try {
        await test();
        passed++;
        console.log('  PASS  ' + name);
    } catch (error) {
        failed++;
        console.log('  FAIL  ' + name + '\n        ' + error.message);
    }
}

async function main() {
    console.log('Sameko run-fix GUI tests');
    const pageErrors = [];
    app = await _electron.launch({
        executablePath: require('electron'),
        args: [ROOT, '--user-data-dir=' + profile, '--lang=en-US'],
        cwd: ROOT,
        timeout: 60000
    });
    let page;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !page) {
        page = app.windows().find(w => w.url().includes('index.html'));
        if (!page) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(page, 'main window opened');
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.waitForFunction(() => typeof App !== 'undefined' && App.ready, null, { timeout: 60000 });
    await page.evaluate(async () => { await ensureMonaco(); if (!App.tabs.length) newFile(); });

    const terminal = () => page.evaluate(() => TerminalManager.getLines().map(l => l.text).join('\n'));
    // A new untitled tab with this code, Input and Expected filled, then Build & Run to the end.
    // Waits for the run to start (App.runSeq moves on), not for App.isRunning: a short program
    // can end before a poll ever sees it running.
    const runCode = async (code, input = '', expected = '') => {
        const seq = await page.evaluate(() => App.runSeq || 0);
        await page.evaluate(({ code, input, expected }) => {
            if (App.isSplit) closeSplit();
            newFile();
            setTabText(App.tabs.find(t => t.id === App.activeTabId), code);
            document.getElementById('input-area').value = input;
            document.getElementById('expected-area').value = expected;
            clearTerm();
            ACTION_HANDLERS.buildRun();
        }, { code, input, expected });
        await page.waitForFunction(s => (App.runSeq || 0) > s, seq, { timeout: 60000 });
    };
    const waitDone = () => page.waitForFunction(() => !App.isRunning && !isBuilding, null, { timeout: 30000 });
    const verdict = () => page.evaluate(() => document.getElementById('output-verdict').textContent.trim());

    await check('Output card: a crash after the right output is RE, not AC', async () => {
        await runCode('#include <cstdio>\nint main() { printf("42\\n"); return 1; }\n', '', '42');
        await waitDone();
        await page.waitForTimeout(300);
        assert.equal(await verdict(), 'RE');
        await runCode('#include <cstdio>\nint main() { printf("42\\n"); return 0; }\n', '', '42');
        await waitDone();
        await page.waitForTimeout(300);
        assert.equal(await verdict(), 'AC');
    });

    await check('Output card judges like TESTS: words by default, YES = yes with Ignore case', async () => {
        await runCode('#include <cstdio>\nint main() { printf("1\\n2\\n"); }\n', '', '1 2');
        await waitDone();
        await page.waitForTimeout(300);
        assert.equal(await verdict(), 'AC', 'same words split differently');
        const before = await page.evaluate(() => App.settings.execution.compareMode);
        await page.evaluate(() => { App.settings.execution.compareMode = 'nocase'; });
        try {
            await runCode('#include <cstdio>\nint main() { printf("yes\\n"); }\n', '', 'YES');
            await waitDone();
            await page.waitForTimeout(300);
            assert.equal(await verdict(), 'AC', 'ignore case');
        } finally {
            await page.evaluate(m => { App.settings.execution.compareMode = m; }, before);
        }
        await runCode('#include <cstdio>\nint main() { printf("yes\\n"); }\n', '', 'YES');
        await waitDone();
        await page.waitForTimeout(300);
        assert.match(await verdict(), /^WA/, 'case counts in Words mode');
    });

    const SUM = '#include <iostream>\nint main() { long long x, s = 0; while (std::cin >> x) s += x; std::cout << "sum " << s << "\\n"; }\n';

    await check('Input box sent, program still waiting: a hint names Ctrl+D, which then ends the input', async () => {
        await runCode(SUM, '1 2 3\n4');
        await page.waitForFunction(() => TerminalManager.getLines().some(l => /waiting for more input/.test(l.text)), null, { timeout: 10000 });
        assert.ok(await page.evaluate(() => App.isRunning), 'stdin stays open, so a short Input box still shows as waiting');
        await page.press('#terminal-in', 'Control+d');
        await waitDone();
        assert.match(await terminal(), /^sum 10$/m);
    });

    await check('no waiting hint for a program that ends on its own', async () => {
        await runCode('#include <iostream>\nint main() { int a; std::cin >> a; std::cout << a + 1 << "\\n"; }\n', '41');
        await waitDone();
        await page.waitForTimeout(2500);
        const t = await terminal();
        assert.match(t, /^42$/m);
        assert.doesNotMatch(t, /waiting for more input/);
    });

    await check('end of input: Ctrl+D in the terminal sends what is typed, then EOF', async () => {
        await runCode(SUM);
        await page.waitForFunction(() => App.isRunning, null, { timeout: 30000 });   // it waits for input
        await page.fill('#terminal-in', '5 6');
        await page.press('#terminal-in', 'Control+d');
        await waitDone().catch(async () => {
            const s = await page.evaluate(() => ({ running: App.isRunning, focus: document.activeElement && document.activeElement.id,
                box: document.getElementById('terminal-in').value, last: TerminalManager.getLines().map(l => l.text).slice(-5) }));
            throw new Error('still running after Ctrl+D: ' + JSON.stringify(s));
        });
        const t = await terminal();
        assert.match(t, /\^D \(EOF\)/);
        assert.match(t, /^sum 11$/m);
    });

    await check('stress test: every TLE of a crowded round is checked alone, not only the lowest', async () => {
        const r = await page.evaluate(async () => {
            const saved = { runStressTest, runStressSolution, paintStressSoon, parallel: App.settings.execution.parallelTests };
            Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
            App.settings.execution.parallelTests = true;
            // Tests 1 and 2 both look like TLE in the crowd; alone, 1 passes and 2 is still TLE.
            runStressTest = async (i) => (i <= 2
                ? { fail: { kind: 'fail', verdict: 'TLE', seed: i, testNo: i, input: 'in' + i, expected: '' } }
                : {});
            runStressSolution = async (exes, input) => (input === 'in2'
                ? { verdict: 'TLE', sol: { executionTime: 3000 } }
                : { verdict: 'AC', sol: {} });
            paintStressSoon = () => {};
            try {
                return await runStressTests({ total: 2, done: 0, startedAt: Date.now(), seconds: 60 }, { exes: {} });
            } finally {
                runStressTest = saved.runStressTest;
                runStressSolution = saved.runStressSolution;
                paintStressSoon = saved.paintStressSoon;
                App.settings.execution.parallelTests = saved.parallel;
                delete navigator.hardwareConcurrency;
            }
        });
        assert.equal(r.kind, 'fail');
        assert.equal(r.verdict, 'TLE');
        assert.equal(r.testNo, 2);
    });

    await check('a file changed on disk is not overwritten by a build while Reload is unanswered', async () => {
        const file = path.join(profile, 'changed.cpp');
        fs.writeFileSync(file, 'int main() { return 0; }\n');
        await page.evaluate(async f => { if (App.isSplit) closeSplit(); await openFileFromPath(f); }, file);
        await page.waitForTimeout(500);
        // Edited in the app, then changed by another editor: the Reload prompt is up.
        await page.evaluate(() => {
            const tab = App.tabs.find(t => t.id === App.activeTabId);
            setTabText(tab, 'int main() { return 1; }\n');
        });
        fs.writeFileSync(file, '// from another editor\nint main() { return 2; }\n');
        await page.evaluate(f => handleExternalFileChange(f), file);
        await page.evaluate(() => { clearTerm(); return buildActiveTab({ runAfter: false }); });
        assert.match(await terminal(), /changed outside the app/);
        assert.match(fs.readFileSync(file, 'utf8'), /from another editor/, 'the disk copy is kept');
        await page.evaluate(f => dismissReloadNotification(f), file);
    });

    await check('unsaved work of the last session is kept while its restore prompt waits', async () => {
        const file = path.join(profile, 'kept.cpp');
        fs.writeFileSync(file, 'int main() {}\n');
        const saved = await page.evaluate(async f => {
            sessionRestorePending = true;
            pendingStoredSession = { tabs: [{ id: 'old-1', name: 'kept.cpp', path: f, content: '// UNSAVED\nint main() {}\n', original: '', modified: true }] };
            try {
                await openFileFromPath(f);   // the same file opened again, clean
                saveSession(true);
                return await window.electronAPI.stateRead('session');
            } finally {
                sessionRestorePending = false;
                pendingStoredSession = null;
            }
        }, file);
        const entries = (saved && saved.tabs || []).filter(t => t.path && path.resolve(t.path) === path.resolve(file));
        assert.ok(entries.some(t => t.modified && /UNSAVED/.test(t.content || '')), 'the unsaved text is still in the checkpoint');
    });

    assert.deepEqual(pageErrors, [], 'page errors');
}

main()
    .catch(error => { failed++; console.log('  FAIL  setup\n        ' + (error.stack || error.message)); })
    .finally(async () => {
        try { if (app) await app.close(); } catch (_) { }
        console.log(`\n${passed} passed, ${failed} failed`);
        if (!failed) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { } }
        else console.log('Profile kept: ' + profile);
        process.exit(failed ? 1 : 0);
    });
