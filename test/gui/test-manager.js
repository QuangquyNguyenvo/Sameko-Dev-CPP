#!/usr/bin/env node
'use strict';

/*
 * Managing a problem's tests in the real app (src/renderer/app/test-manager.js): problems judged
 * through files, tests turned off, a folder of tests with large files, the interactor, limits,
 * the stopwatch and the head comment.
 *   node test/gui/test-manager.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, checker } = require('../helpers/app');

const FILES = {
    'fileio.cpp': `#include <bits/stdc++.h>
#define NAME "tong"
using namespace std;
int main() {
    freopen(NAME".inp", "r", stdin);
    freopen(NAME".out", "w", stdout);
    long long a, b;
    cin >> a >> b;
    cout << a + b << '\\n';
}
`,
    'noout.cpp': `#include <bits/stdc++.h>
using namespace std;
int main() {
    freopen("x.inp", "r", stdin);
    freopen("x.out", "w", stdout);
    fclose(stdout);
    remove("x.out");
}
`,
    'plain.cpp': `#include <bits/stdc++.h>
using namespace std;
int main() { long long a, b; cin >> a >> b; cout << a + b << '\\n'; }
`,
    'sumall.cpp': `#include <bits/stdc++.h>
using namespace std;
int main() { ios::sync_with_stdio(false); cin.tie(nullptr); long long x, s = 0; while (cin >> x) s += x; cout << s << '\\n'; }
`,
    'slow.cpp': `#include <chrono>
#include <thread>
#include <iostream>
int main() { std::this_thread::sleep_for(std::chrono::milliseconds(700)); std::cout << 1 << std::endl; }
`,
    'guess.cpp': `#include <bits/stdc++.h>
using namespace std;
int main() {
    int lo = 1, hi = 100;
    while (lo < hi) {
        int mid = (lo + hi) / 2;
        cout << "? " << mid << endl;
        string r; cin >> r;
        if (r == ">") lo = mid + 1; else hi = mid;
    }
    cout << "! " << lo << endl;
}
`,
    'wrongguess.cpp': `#include <iostream>
int main() { std::cout << "! 1" << std::endl; }
`,
    'interactor.cpp': `#include "testlib.h"
#include <iostream>
using namespace std;
int main(int argc, char* argv[]) {
    registerInteraction(argc, argv);
    int secret = inf.readInt();
    for (int q = 0; q < 20; q++) {
        string kind = ouf.readToken();
        int x = ouf.readInt();
        if (kind == "!") {
            if (x == secret) quitf(_ok, "found %d in %d queries", secret, q);
            quitf(_wa, "said %d, the number is %d", x, secret);
        }
        cout << (secret > x ? ">" : "<=") << endl;
    }
    quitf(_wa, "too many queries");
}
`,
};

async function main() {
    const t = checker();
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-tests-')));
    for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), text);
    const tests = path.join(dir, 'bo-test');
    fs.mkdirSync(path.join(tests, 'Test02'), { recursive: true });
    fs.mkdirSync(path.join(tests, 'Test01'), { recursive: true });
    fs.writeFileSync(path.join(tests, 'Test01', 'bai.inp'), '2 3\n');
    fs.writeFileSync(path.join(tests, 'Test01', 'bai.out'), '5\n');
    // Over the inline size: this test must stay on disk.
    const many = Array.from({ length: 90000 }, () => '1').join(' ') + '\n';
    assert.ok(many.length > 170000);
    const big = many + many;
    fs.writeFileSync(path.join(tests, 'Test02', 'bai.inp'), big);
    fs.writeFileSync(path.join(tests, 'Test02', 'bai.out'), '180000' + ' '.repeat(300000) + '\n');
    const saved = path.join(dir, 'saved');
    fs.mkdirSync(saved);

    const { app, page, profile, pageErrors, close } = await launchApp({
        settings: { appearance: { theme: 'kawaii-dark', language: 'en' }, template: { headComment: '// {name}\n// {url}' } },
    });
    page.setDefaultTimeout(30000);
    const pickFolder = folder => app.evaluate(({ dialog }, f) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, folder);
    const open = (name, problem) => page.evaluate(async ({ file, problem }) => {
        await openFileFromPath(file);
        ccProblem = problem;
        batchTestResults = [];
        ccTestIndex = -1;
        updateTestNavUI();
        showTestsTab();
        setBottomPanelCollapsed(false);
        renderTestResults();
    }, { file: path.join(dir, name), problem });
    const runAll = () => page.evaluate(async () => {
        await runAllTests();
        return batchTestResults.map(r => ({ i: r.testIndex, s: r.status, d: r.details || '', o: r.output }));
    });
    const row = i => page.locator(`.test-result-item[data-index="${i}"]`);

    try {
        await t.check('a solution with freopen and #define NAME is judged through its files', async () => {
            await open('fileio.cpp', { name: 'F', tests: [{ input: '1 2\n', output: '3\n' }, { input: '5 5\n', output: '11\n' }] });
            const r = await runAll();
            assert.deepEqual(r.map(x => x.s), ['AC', 'WA']);
            assert.equal(r[0].o.trim(), '3');
            assert.equal(fs.existsSync(path.join(dir, 'tong.inp')), false, 'nothing is written next to the source');
            assert.equal(fs.existsSync(path.join(dir, 'tong.out')), false);
        });

        await t.check('a single test is judged through files too', async () => {
            await page.evaluate(() => runSingleTestByIndex(0));
            assert.equal(await page.evaluate(() => batchTestResults.find(r => r.testIndex === 0).status), 'AC');
        });

        await t.check('debugging a file-based test reads its input file', async () => {
            await page.evaluate(() => {
                localStorage.setItem('sameko-debug-guide-seen', '1');
                window.__exits = [];
                window.__stops = [];
                window.electronAPI.onDebugProgramExited(v => window.__exits.push(v));
                window.electronAPI.onDebugStopped(v => window.__stops.push(v));
            });
            await row(0).hover();
            await row(0).locator('[data-test-tool="debug"]').click();
            await page.waitForFunction(() => window.__stops.length > 0, null, { timeout: 40000 });
            const line = FILES['fileio.cpp'].split('\n').findIndex(l => l.includes('cout << a + b')) + 1;
            for (let i = 0; i < 12; i++) {
                if ((await page.evaluate(() => window.__stops.at(-1).frame?.line)) === line) break;
                const n = await page.evaluate(() => window.__stops.length);
                await page.evaluate(() => Debugger.stepOver());
                await page.waitForFunction(c => window.__stops.length > c, n);
            }
            const a = await page.evaluate(() => window.electronAPI.debugEvaluate('a'));
            await page.evaluate(() => Debugger.stop());
            await page.waitForFunction(() => !Debugger.isActive());
            assert.equal(String(a.value), '1');
        });

        await t.check('a program that leaves no output file is told so', async () => {
            await open('noout.cpp', { name: 'N', tests: [{ input: '1\n', output: '1\n' }] });
            const [r] = await runAll();
            assert.equal(r.s, 'WA');
            assert.match(r.d, /did not create x\.out/);
        });

        await t.check('names set in the problem win over the source', async () => {
            await open('plain.cpp', { name: 'P', fileIO: { input: 'other.inp', output: 'other.out' }, tests: [{ input: '2 2\n', output: '4\n' }] });
            const [r] = await runAll();
            assert.equal(r.s, 'AC', 'no file written: it prints to stdout and is judged on that');
        });

        await t.check('a test turned off is skipped, and the count follows', async () => {
            await open('plain.cpp', { name: 'T', tests: [{ input: '1 1\n', output: '2\n' }, { input: '1 1\n', output: '9\n' }, { input: '2 2\n', output: '4\n' }] });
            await row(1).locator('.test-enable').uncheck();
            const r = await runAll();
            assert.deepEqual(r.map(x => [x.i, x.s]), [[0, 'AC'], [2, 'AC']]);
            assert.equal(await page.locator('#test-results-count').textContent(), '2/2');
            assert.match(await row(1).locator('.test-result-status').textContent(), /OFF/);
            await row(1).locator('.test-enable').check();
            assert.deepEqual((await runAll()).map(x => x.s), ['AC', 'WA', 'AC']);
        });

        await t.check('every test off: nothing runs and it says why', async () => {
            await page.evaluate(() => { ccProblem.tests.forEach(x => { x.disabled = true; }); batchTestResults = []; renderTestResults(); });
            assert.equal((await runAll()).length, 0);
            await page.evaluate(() => setAllTestsEnabled());
        });

        await t.check('hide passed tests, then bring them back', async () => {
            await runAll();
            await page.evaluate(() => { ccProblem.hideAC = true; renderTestResults(); });
            assert.equal(await row(0).isVisible(), false);
            assert.equal(await row(1).isVisible(), true);
            await page.evaluate(() => { delete ccProblem.hideAC; renderTestResults(); });
            assert.equal(await row(0).isVisible(), true);
        });

        await t.check('output becomes the expected output, after asking', async () => {
            await row(1).hover();
            await row(1).locator('.test-use-output').click();
            await page.locator('.confirm-dialog button, .modal button, dialog button').filter({ hasText: 'Replace' }).first().click();
            await page.waitForFunction(() => ccProblem.tests[1].output.trim() === '2');
            assert.deepEqual((await runAll()).map(x => x.s), ['AC', 'AC', 'AC']);
        });

        await t.check('a folder of tests comes in; a large file stays on disk', async () => {
            await open('sumall.cpp', { name: 'I', tests: [] });
            await pickFolder(tests);
            await page.evaluate(() => importTestsFromFolder());
            const list = await page.evaluate(() => ccProblem.tests.map(x => ({ len: x.input.length, inputPath: x.inputPath || '', source: x.source })));
            assert.equal(list.length, 2);
            assert.match(list[0].source, /Test01/);
            assert.equal(list[1].len, 0);
            assert.match(list[1].inputPath, /Test02/);
            const r = await runAll();
            assert.deepEqual(r.map(x => x.s), ['AC', 'AC']);
        });

        await t.check('selecting a large test shows its file; typing cannot change it', async () => {
            await page.evaluate(() => switchTestCase(1));
            await page.waitForFunction(() => getTabInputFile(getPreferredTabId())?.includes('Test02'));
            await page.evaluate(() => switchToExpectedEdit());
            assert.equal(await page.locator('#expected-area').evaluate(el => el.readOnly), true);
            await page.evaluate(() => switchTestCase(0));
            await page.waitForFunction(() => !getTabInputFile(getPreferredTabId()));
            assert.equal(await page.locator('#expected-area').evaluate(el => el.readOnly), false);
            assert.equal((await page.locator('#input-area').inputValue()).trim(), '2 3');
        });

        await t.check('the session keeps a large test by its path, not its text', async () => {
            await page.evaluate(async () => { await saveSession?.(); });
            const file = path.join(profile, 'state', 'session.json');
            for (let i = 0; i < 40 && !fs.existsSync(file); i++) await new Promise(r => setTimeout(r, 200));
            const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
            assert.ok(size < 100000, `session is ${size} bytes`);
        });

        await t.check('tests are saved to a folder, large ones included, and never overwrite', async () => {
            await pickFolder(saved);
            await page.evaluate(() => exportTestsToFolder());
            await page.waitForFunction(() => true);
            for (let i = 0; i < 40 && !fs.existsSync(path.join(saved, 'test02.out')); i++) await new Promise(r => setTimeout(r, 100));
            assert.equal(fs.readFileSync(path.join(saved, 'test01.in'), 'utf8'), '2 3\n');
            assert.equal(fs.statSync(path.join(saved, 'test02.in')).size, Buffer.byteLength(big));
            const res = await page.evaluate(async (folder) => window.electronAPI.testsExport({ folder, tests: [{ input: 'new', output: 'x' }] }), saved);
            assert.equal(res.exists, 'test01.in');
            assert.equal(fs.readFileSync(path.join(saved, 'test01.in'), 'utf8'), '2 3\n');
        });

        await t.check('time limit set for the problem is used', async () => {
            await open('slow.cpp', { name: 'L', timeLimit: 200, tests: [{ input: '', output: '1\n' }] });
            assert.equal((await runAll())[0].s, 'TLE');
            await page.evaluate(() => { ccProblem.timeLimit = 3000; });
            assert.equal((await runAll())[0].s, 'AC');
        });

        await t.check('the options dialog saves limits, files and interactor on the problem', async () => {
            await open('guess.cpp', { name: 'O', tests: [{ input: '37\n', output: '' }] });
            await page.locator('#test-options').click();
            const dialog = page.locator('.test-options-dialog');
            await dialog.locator('[name=time]').fill('1500');
            await dialog.locator('[name=fileIn]').fill('../bad');
            await dialog.locator('[name=fileOut]').fill('ok.out');
            await dialog.locator('[name=interactor]').selectOption({ label: 'interactor.cpp' });
            await dialog.locator('[name=fileOut]').press('Tab');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'detached' });
            const p = await page.evaluate(() => ({ time: ccProblem.timeLimit, io: ccProblem.fileIO, inter: ccProblem.interactor }));
            assert.equal(p.time, 1500);
            assert.deepEqual(p.io, { input: '', output: 'ok.out' });
            assert.match(p.inter, /interactor\.cpp$/);
            await page.evaluate(() => { delete ccProblem.fileIO; ccProblem.timeLimit = 3000; });
        });

        await t.check('an interactor plays the solution: AC with its message', async () => {
            const r = await runAll();
            assert.equal(r[0].s, 'AC', JSON.stringify(r[0]).slice(0, 300));
            assert.match(r[0].d, /found 37/);
            assert.match(r[0].o, /\? 50/);
        });

        await t.check('an interactor rejects a wrong answer', async () => {
            await open('wrongguess.cpp', { name: 'W', interactor: path.join(dir, 'interactor.cpp'), tests: [{ input: '37\n', output: '' }] });
            const [r] = await runAll();
            assert.equal(r.s, 'WA');
            assert.match(r.d, /the number is 37/);
        });

        await t.check('a solution that never answers the interactor is TLE, and nothing is left running', async () => {
            fs.writeFileSync(path.join(dir, 'silent.cpp'), '#include <chrono>\n#include <thread>\nint main() { std::this_thread::sleep_for(std::chrono::seconds(30)); }\n');
            await open('silent.cpp', { name: 'S', timeLimit: 500, interactor: path.join(dir, 'interactor.cpp'), tests: [{ input: '37\n', output: '' }] });
            const started = Date.now();
            const [r] = await runAll();
            assert.equal(r.s, 'TLE');
            assert.ok(Date.now() - started < 15000);
        });

        await t.check('the stopwatch runs, pauses, belongs to the problem and resets', async () => {
            await open('plain.cpp', { name: 'W1', tests: [{ input: '1 1\n', output: '2\n' }] });
            const watch = page.locator('#test-stopwatch');
            assert.equal(await watch.isVisible(), false, 'not in the header until it is started');
            await page.locator('#test-options').click();
            await page.locator('.test-options-dialog [data-do="stopwatch"]').click();
            await page.keyboard.press('Escape');
            await page.locator('.test-options-dialog').waitFor({ state: 'detached' });
            await page.waitForFunction(() => document.querySelector('#test-stopwatch span').textContent === '00:01', null, { timeout: 4000 });
            await watch.click();
            const paused = await page.evaluate(() => ccProblem.stopwatch);
            assert.equal(paused.startedAt, 0);
            assert.ok(paused.ms >= 1000);
            await watch.click({ button: 'right' });
            assert.equal(await watch.isVisible(), false, 'gone again after a reset');
        });

        await t.check('a problem from a judge gets the head comment in its new file', async () => {
            await page.evaluate(() => handleProblemReceived({ name: 'A + B', url: 'https://example.com/p/1', tests: [{ input: '1 1\n', output: '2\n' }] }));
            const text = await page.evaluate(() => getActiveEditor().getValue());
            assert.ok(text.startsWith('// A + B\n// https://example.com/p/1\n'), text.slice(0, 60));
        });

        await t.check('no page errors', async () => assert.deepEqual(pageErrors, []));
    } finally {
        await close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    t.finish();
}

main().catch((err) => { console.error(err); process.exit(1); });
