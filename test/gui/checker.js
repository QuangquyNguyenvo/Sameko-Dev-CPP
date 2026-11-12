#!/usr/bin/env node
'use strict';

/*
 * Checkers (src/renderer/app/checker.js, app/services/competitive/checker.js) in the real app:
 * a problem with more than one right answer, judged by the built-in comparisons and by testlib
 * checkers, in Run All Tests, a single test and the stress test.
 *   node test/gui/checker.js        (npm run test:gui runs it with the other gui suites)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp, checker } = require('../helpers/app');

// "Print two numbers whose sum is n": 1 n-1 is as right as the sample's 0 n. Wrong for n = 5.
const FILES = {
    'sol.cpp': `#include <bits/stdc++.h>
using namespace std;
int main() { long long n; cin >> n; if (n == 5) cout << "1 1\\n"; else cout << 1 << ' ' << n - 1 << '\\n'; }
`,
    'brute.cpp': `#include <bits/stdc++.h>
using namespace std;
int main() { long long n; cin >> n; cout << 0 << ' ' << n << '\\n'; }
`,
    // The bundled testlib.h works for generators too.
    'gen.cpp': `#include "testlib.h"
#include <iostream>
int main(int argc, char* argv[]) { registerGen(argc, argv, 1); std::cout << rnd.next(6, 100) << "\\n"; }
`,
    'checker.cpp': `#include "testlib.h"
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    long long n = inf.readLong();
    long long a = ouf.readLong(), b = ouf.readLong();
    if (a + b != n) quitf(_wa, "%lld + %lld != %lld", a, b, n);
    quitf(_ok, "%lld + %lld = %lld", a, b, n);
}
`,
    'failchk.cpp': `#include "testlib.h"
int main(int argc, char* argv[]) { registerTestlibCmd(argc, argv); quitf(_fail, "checker bug"); }
`,
    'badchk.cpp': `int main() { return 3 }
`,
    'yes.cpp': `#include <iostream>
int main() { std::cout << "YES\\n"; }
`,
};

const TESTS = [
    { input: '10\n', output: '0 10\n' },
    { input: '5\n', output: '0 5\n' },
    { input: '7\n', output: '' },   // no expected output: only a checker judges it
];

async function main() {
    console.log('Checker tests');
    const t = checker();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-checker-'));
    for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), text);
    const P = dir.split(path.sep).join('/');

    const { page, close, pageErrors } = await launchApp({ settings: { appearance: { theme: 'kawaii-dark' } } });
    try {
        const openWithTests = (file, tests) => page.evaluate(async ({ file, tests }) => {
            await openFileFromPath(file);
            ccProblem = { name: 'Sum', tests };
            batchTestResults = [];
            updateTestNavUI();
            showTestsTab();
            renderTestResults();
        }, { file, tests });
        const runAll = () => page.evaluate(async () => {
            await runAllTests();
            return batchTestResults.map(r => ({ status: r.status, details: r.details || '' }));
        });
        const choose = (value) => page.evaluate((v) => setCheckerChoice(v), value);

        await openWithTests(P + '/sol.cpp', TESTS);

        await t.check('default comparison: another right answer is WA', async () => {
            const r = await runAll();
            assert.deepEqual(r.map(x => x.status), ['WA', 'WA', 'RAN']);
        });

        await t.check('the select lists the built-in modes and the checker files next to the solution', async () => {
            await page.evaluate(() => refreshCheckerFiles());
            const values = await page.evaluate(() => [...document.querySelectorAll('#checker-select option')].map(o => o.value));
            for (const v of ['', 'tokens', 'nocase', 'lines']) assert.ok(values.includes(v), 'has ' + JSON.stringify(v));
            for (const f of ['checker.cpp', 'failchk.cpp', 'badchk.cpp']) assert.ok(values.includes('file:' + P + '/' + f), 'lists ' + f);
            assert.ok(!values.some(v => v.endsWith('/sol.cpp') || v.endsWith('/gen.cpp')), 'no other source files');
        });

        await t.check('testlib checker: AC and WA with its message; a test without expected output is judged', async () => {
            await choose('file:' + P + '/checker.cpp');
            const r = await runAll();
            assert.deepEqual(r.map(x => x.status), ['AC', 'WA', 'AC']);
            assert.match(r[0].details, /1 \+ 9 = 10/);
            assert.match(r[1].details, /1 \+ 1 != 5/);
            const sel = await page.evaluate(() => ({ v: document.getElementById('checker-select').value, custom: document.getElementById('checker-select').classList.contains('is-custom') }));
            assert.equal(sel.v, 'file:' + P + '/checker.cpp');
            assert.ok(sel.custom, 'the select is marked as a custom choice');
        });

        await t.check('an unchanged solution and checker are not compiled again', async () => {
            const cached = await page.evaluate(async (files) => {
                const out = {};
                for (const file of files) {
                    const content = await window.electronAPI.readFile(file);
                    const opts = { filePath: file, untitledId: '', content, flags: buildCompileFlags({ judge: true }), singleFileMode: true, useLLD: App.settings.compiler.useLLD !== false, realtimeOutput: false, variant: 'judge' };
                    await window.electronAPI.compile(opts);
                    out[file.split('/').pop()] = (await window.electronAPI.compile(opts)).cached === true;
                }
                return out;
            }, [P + '/sol.cpp', P + '/checker.cpp']);
            assert.deepEqual(cached, { 'sol.cpp': true, 'checker.cpp': true });
        });

        await t.check('a single test is judged by the checker too', async () => {
            const r = await page.evaluate(async () => {
                await runSingleTestByIndex(0);
                return batchTestResults.find(x => x.testIndex === 0).status;
            });
            assert.equal(r, 'AC');
        });

        await t.check('a checker that fails (_fail) gives FAIL, not WA', async () => {
            await choose('file:' + P + '/failchk.cpp');
            const r = await runAll();
            assert.deepEqual(r.map(x => x.status), ['FAIL', 'FAIL', 'FAIL']);
            assert.match(r[0].details, /Checker failed/);
        });

        await t.check('a checker that does not compile stops the run with a clear error', async () => {
            await choose('file:' + P + '/badchk.cpp');
            const r = await runAll();
            assert.deepEqual(r, []);
            const status = await page.evaluate(() => document.getElementById('status-text')?.textContent || document.querySelector('.status-bar')?.textContent || '');
            assert.match(status, /Compile error in the checker badchk\.cpp/);
        });

        await t.check('the choice belongs to the problem: it comes back after switching tabs', async () => {
            await choose('file:' + P + '/checker.cpp');
            const solTab = await page.evaluate(() => App.activeTabId);
            await page.evaluate(async (file) => { await openFileFromPath(file); }, P + '/yes.cpp');
            const other = await page.evaluate(() => document.getElementById('checker-select').value);
            assert.equal(other, '', 'another file has its own (default) choice');
            await page.evaluate((id) => setActive(id), solTab);
            const back = await page.evaluate(() => document.getElementById('checker-select').value);
            assert.equal(back, 'file:' + P + '/checker.cpp');
        });

        await t.check('stress test: judged by the checker against the brute force', async () => {
            await page.evaluate(() => {
                App.settings.execution.stressTests = 10;
                App.settings.execution.stressSeconds = 60;
                document.querySelector('.panel-title[data-panel="stress"]').click();
            });
            await page.evaluate(() => refreshStressFiles());
            const withChecker = await page.evaluate(async () => {
                await startStressTest();
                return { kind: Stress.run.result.kind, done: Stress.run.done, title: Stress.run.result.title || '' };
            });
            assert.equal(withChecker.kind, 'pass', JSON.stringify(withChecker));
            assert.equal(withChecker.done, 10);
            const shown = await page.evaluate(() => document.getElementById('stress-checker').value);
            assert.equal(shown, 'file:' + P + '/checker.cpp', 'STRESS shows the same choice');

            await choose('');
            const without = await page.evaluate(async () => {
                await startStressTest();
                return { kind: Stress.run.result.kind, verdict: Stress.run.result.verdict, testNo: Stress.run.result.testNo };
            });
            assert.deepEqual(without, { kind: 'fail', verdict: 'WA', testNo: 1 });
        });

        await t.check('ignore case: YES matches yes, the default does not', async () => {
            await page.evaluate(() => document.querySelector('.panel-title[data-panel="tests"]').click());
            await openWithTests(P + '/yes.cpp', [{ input: '', output: 'yes\n' }]);
            await choose('');
            assert.deepEqual((await runAll()).map(x => x.status), ['WA']);
            await choose('nocase');
            assert.deepEqual((await runAll()).map(x => x.status), ['AC']);
        });

        await t.check('+ creates checker.cpp from the template and selects it (a double click makes one)', async () => {
            await openWithTests(P + '/sol.cpp', TESTS);
            await page.evaluate(() => Promise.all([createCheckerFile(), createCheckerFile()]));
            assert.ok(!fs.existsSync(path.join(dir, 'checker3.cpp')), 'only one file');
            const created = path.join(dir, 'checker2.cpp');   // checker.cpp exists already
            assert.ok(fs.existsSync(created), 'checker2.cpp written');
            assert.match(fs.readFileSync(created, 'utf8'), /registerTestlibCmd/);
            const sol = await page.evaluate(() => {
                const tab = App.tabs.find(x => x.path && x.path.replace(/[\\/]/g, '/').endsWith('/sol.cpp'));
                return tab && tab.testState && tab.testState.problem && tab.testState.problem.checker;
            });
            assert.equal(sol, 'file:' + P + '/checker2.cpp', 'set on the solution, not the new tab');
        });

        await t.check('no page errors', async () => {
            assert.deepEqual(pageErrors, []);
        });
    } finally {
        await close();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { }
    }
    t.finish();
}

main().catch((err) => {
    console.log('  FAIL  checker suite crashed\n        ' + (err && err.stack || err));
    process.exitCode = 1;
});
