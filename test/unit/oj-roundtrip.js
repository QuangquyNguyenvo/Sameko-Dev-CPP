'use strict';
/**
 * Contract test: the extension's real bridge client (extension/background/bridge.js, with a fake
 * chrome.*) against the app's real bridge (app/services/competitive/extension-bridge.js on the
 * Competitive Companion server). Each side also has its own suite against a stub of the other;
 * this is the one that fails when the two drift apart. Plain Node, no Electron, no browser.
 *   node scripts/test-oj-roundtrip.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server = require('../app/services/competitive/companion-server');
const SamekoBridge = require('../extension/background/bridge.js');
const { createFakeChrome } = require('../extension/test/fake-chrome.js');

const ORIGIN = 'chrome-extension://roundtriproundtriproundtriproundt';
const ADAPTERS = [{ id: 'codeforces', name: 'Codeforces', hosts: ['codeforces.com'] }];
const THEME = { id: 'kawaii-dark', variant: 'dark', bg: '#1a1b26', surface: '#24283b', border: '#414868', text: '#c0caf5',
    textMuted: '#565f89', accent: '#ff9eb5', accentText: '#1a1b26', success: '#9ece6a', warning: '#e0af68', error: '#f7768e' };
const JOB = { url: 'https://codeforces.com/contest/1900/problem/A', source: 'int main(){}\n', language: 'cpp', std: 'c++17', fileName: 'a.cpp', autoSubmit: true };
const PROBLEM = { name: 'A. Cover in Water', group: 'Codeforces', url: JOB.url, timeLimit: 1000, memoryLimit: 256, tests: [{ input: '1\n', output: '2\n' }] };

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-roundtrip-'));
const seen = { pair: [], submit: [], fetchFailed: [], problems: [], focus: 0 };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, timeoutMs = 4000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { const v = fn(); if (v) return v; await delay(15); }
    throw new Error(`timed out waiting for ${what}`);
}

let failed = 0;
async function check(name, fn) {
    try { await fn(); console.log('  PASS  ' + name); } catch (err) { failed++; console.log('  FAIL  ' + name + '\n        ' + (err && err.stack || err)); }
}

(async () => {
    server.configureBridge({
        stateDir,
        appInfo: { name: 'Sameko Dev C++', version: '9.9.9' },
        onPairRequest: (r) => seen.pair.push(r),
        onStatusChange: () => {},
        onSubmitStatus: (e) => seen.submit.push(e),
        onFetchFailed: (e) => seen.fetchFailed.push(e)
    });
    server.setOnProblemReceived((p) => seen.problems.push(p));
    server.setOnFocusWindow(() => { seen.focus++; });
    const started = await server.startServer({ port: 0 });
    assert.ok(started.success, 'server starts');
    const app = server.getBridge();
    app.setTheme(THEME);
    const port = server.getStatus().port;

    const fake = createFakeChrome();
    const commands = [];
    const ext = SamekoBridge.create({
        chrome: fake.chrome,
        fetch: (url, init) => fetch(url, Object.assign({}, init, { headers: Object.assign({}, init && init.headers, { Origin: ORIGIN }) })),
        extVersion: '0.1.0',
        config: { baseUrl: `http://127.0.0.1:${port}`, pairIntervalMs: 40, pollWaitSec: 2, backoffMinMs: 30, backoffMaxMs: 120, eventRetryMs: 40 },
        getAdapters: () => ADAPTERS,
        onCommand: (cmd) => commands.push(cmd)
    });
    const extState = () => ext.state.state;

    await check('unknown extension is asked about once, and waits unpaired', async () => {
        ext.start();
        await until(() => seen.pair.length === 1, 'pair request');
        assert.strictEqual(seen.pair[0].origin, ORIGIN);
        await until(() => extState() === 'unpaired', 'extension state unpaired');
        await delay(150);
        assert.strictEqual(seen.pair.length, 1, 'no second prompt while the first is open');
        assert.strictEqual(app.getStatus().pendingPair.origin, ORIGIN);
    });

    await check('Allow in the app connects the extension and tells the app its sites', async () => {
        app.respondPair({ origin: ORIGIN, allow: true });
        await until(() => extState() === 'connected', 'extension state connected');
        const s = await until(() => { const st = app.getStatus(); return st.connected && st; }, 'app status connected');
        assert.strictEqual(s.paired, true);
        assert.deepStrictEqual(s.adapters.map(a => a.id), ['codeforces']);
        assert.deepStrictEqual(s.adapters[0].hosts, ['codeforces.com']);
    });

    await check('the app theme reaches the extension cache', async () => {
        let cached = '';
        for (let i = 0; i < 100 && !cached.includes(THEME.accent); i++) {
            cached = JSON.stringify(await fake.chrome.storage.local.get(null));
            if (!cached.includes(THEME.accent)) await delay(20);
        }
        assert.ok(cached.includes(THEME.accent), 'theme snapshot cached');
    });

    let submitId;
    await check('submit command reaches the extension unchanged', async () => {
        const r = app.submit(JOB);
        assert.ok(r.success, JSON.stringify(r));
        submitId = r.id;
        const cmd = await until(() => commands.find(c => c.type === 'submit'), 'submit command');
        assert.strictEqual(cmd.id, submitId);
        for (const k of Object.keys(JOB)) assert.strictEqual(cmd[k], JOB[k], k);
    });

    await check('submit status events reach the app in order, with the verdict', async () => {
        ext.postEvent({ type: 'submitStatus', id: submitId, state: 'opened' });
        ext.postEvent({ type: 'submitStatus', id: submitId, state: 'submitted' });
        ext.postEvent({ type: 'submitStatus', id: submitId, state: 'judging', message: 'Running on test 7' });
        ext.postEvent({ type: 'submitStatus', id: submitId, state: 'done', submissionUrl: 'https://codeforces.com/contest/1900/submission/1',
            verdict: { code: 'WA', text: 'Wrong answer on test 7', test: 7, timeMs: 46, memoryKb: 1024, points: null } });
        await until(() => seen.submit.some(e => e.state === 'done'), 'done event');
        assert.deepStrictEqual(seen.submit.map(e => e.state), ['opened', 'submitted', 'judging', 'done']);
        const done = seen.submit[3];
        assert.strictEqual(done.id, submitId);
        assert.strictEqual(done.verdict.code, 'WA');
        assert.strictEqual(done.verdict.test, 7);
        assert.strictEqual(done.submissionUrl, 'https://codeforces.com/contest/1900/submission/1');
        assert.strictEqual(seen.submit[2].message, 'Running on test 7');
    });

    await check('fetchProblem round trip: command out, problem back with its request id', async () => {
        const r = app.fetchProblem({ url: JOB.url });
        assert.ok(r.success, JSON.stringify(r));
        const cmd = await until(() => commands.find(c => c.type === 'fetchProblem'), 'fetchProblem command');
        assert.strictEqual(cmd.id, r.id);
        assert.strictEqual(cmd.url, JOB.url);
        const focusBefore = seen.focus;
        ext.postEvent({ type: 'problem', requestId: cmd.id, auto: false, problem: PROBLEM });
        const p = await until(() => seen.problems[0], 'problem');
        assert.strictEqual(p.name, PROBLEM.name);
        assert.strictEqual(p.via, 'sameko');
        assert.strictEqual(p.requestId, r.id);
        assert.deepStrictEqual(p.tests, PROBLEM.tests);
        assert.strictEqual(seen.focus, focusBefore + 1, 'a requested problem raises the window');
    });

    await check('an auto-sent problem arrives without raising the window', async () => {
        const focusBefore = seen.focus;
        ext.postEvent({ type: 'problem', auto: true, problem: Object.assign({}, PROBLEM, { name: 'B. Auto' }) });
        const p = await until(() => seen.problems.find(x => x.name === 'B. Auto'), 'auto problem');
        assert.strictEqual(p.auto, true);
        assert.strictEqual(seen.focus, focusBefore);
    });

    await check('fetchFailed reaches the app', async () => {
        const r = app.fetchProblem({});
        const cmd = await until(() => commands.find(c => c.type === 'fetchProblem' && c.id === r.id), 'second fetchProblem');
        assert.ok(!cmd.url, 'no url means the last problem tab');
        ext.postEvent({ type: 'fetchFailed', requestId: r.id, error: { code: 'no-problem-tab', message: 'No online judge problem is open in the browser.' } });
        const f = await until(() => seen.fetchFailed[0], 'fetchFailed');
        assert.strictEqual(f.error.code, 'no-problem-tab');
    });

    await check('the pairing survives an extension restart', async () => {
        ext.stop();
        await delay(50);
        const again = SamekoBridge.create({
            chrome: fake.chrome,
            fetch: (url, init) => fetch(url, Object.assign({}, init, { headers: Object.assign({}, init && init.headers, { Origin: ORIGIN }) })),
            extVersion: '0.1.0',
            config: { baseUrl: `http://127.0.0.1:${port}`, pairIntervalMs: 40, pollWaitSec: 1, backoffMinMs: 30 },
            getAdapters: () => ADAPTERS
        });
        again.start();
        await until(() => again.state.state === 'connected', 'reconnected');
        assert.strictEqual(seen.pair.length, 1, 'no new prompt');
        again.stop();
    });

    server.stopServer();
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (_) { }
    console.log(failed ? `\n${failed} failed` : '\nall passed');
    setTimeout(() => process.exit(failed ? 1 : 0), 50);
})().catch((err) => { console.log('  FAIL  round trip crashed\n        ' + (err && err.stack || err)); process.exit(1); });
