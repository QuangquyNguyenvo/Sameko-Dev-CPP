'use strict';
/**
 * The Sameko Companion extension bridge (/sameko/v1/*, app/services/competitive/extension-bridge.js)
 * on the real Competitive Companion server, over HTTP on a free port. Plain Node, no Electron.
 *   node scripts/test-oj-bridge.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const server = require('../app/services/competitive/companion-server');

const EXT_A = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const EXT_B = 'moz-extension://0a1b2c3d-1111-2222-3333-444455556666';
const THEME1 = { id: 'kawaii-dark', variant: 'dark', bg: '#1a1b26', surface: '#24283b', border: '#414868', text: '#c0caf5',
    textMuted: '#565f89', accent: '#ff9eb5', accentText: '#1a1b26', success: '#9ece6a', warning: '#e0af68', error: '#f7768e' };
const THEME2 = { ...THEME1, id: 'kawaii-light', variant: 'light', bg: 'rgb(255, 255, 255)' };
const HELLO = { protocol: 1, extVersion: '0.1.0', browser: 'chrome',
    adapters: [{ id: 'codeforces', name: 'Codeforces', hosts: ['codeforces.com', 'bad host!'] }] };
const JOB = { url: 'https://codeforces.com/contest/1900/problem/A', source: 'int main(){}', language: 'cpp', std: 'c++17', fileName: 'a.cpp', autoSubmit: true };

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oj-bridge-'));
let port = 0;
let log;
function resetLog() { log = { pair: [], status: [], submit: [], fetchFailed: [], problems: [], focus: 0 }; }
resetLog();

function configure() {
    return server.configureBridge({
        stateDir,
        appInfo: { name: 'Sameko Dev C++', version: '9.9.9' },
        commandTtlMs: 300,
        connectedGraceMs: 200,
        pollUnitMs: 100, // poll?wait=N holds N * 100 ms
        onPairRequest: (r) => log.pair.push(r),
        onStatusChange: (s) => log.status.push(s),
        onSubmitStatus: (e) => log.submit.push(e),
        onFetchFailed: (e) => log.fetchFailed.push(e),
    });
}
server.setOnProblemReceived((p) => log.problems.push(p));
server.setOnFocusWindow(() => { log.focus++; });

function request(method, urlPath, { origin, body, raw } = {}) {
    return new Promise((resolve, reject) => {
        const data = raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : null);
        const headers = {};
        if (origin) headers.Origin = origin;
        if (data !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
        const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(text); } catch (_) { }
                resolve({ status: res.statusCode, text, json, type: res.headers['content-type'] || '' });
            });
        });
        req.on('error', reject);
        if (data !== null) req.write(data);
        req.end();
    });
}
const hello = (origin, body = HELLO) => request('POST', '/sameko/v1/hello', { origin, body });
const poll = (origin, wait = 1) => request('POST', '/sameko/v1/poll', { origin, body: { wait } });
const postEvents = (origin, events) => request('POST', '/sameko/v1/events', { origin, body: { events } });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const bridge = () => server.getBridge();

let failed = 0;
async function check(name, fn) {
    try { await fn(); console.log('  PASS  ' + name); } catch (err) { failed++; console.log('  FAIL  ' + name + '\n        ' + (err && err.stack || err)); }
}

async function start() {
    const r = await server.startServer({ port: 0 });
    assert.equal(r.success, true, JSON.stringify(r));
    port = server.getStatus().port;
}

(async () => {
    configure();
    await start();

    await check('/sameko/v1/* refuses a missing or web Origin with 403', async () => {
        assert.equal((await request('POST', '/sameko/v1/hello', { body: HELLO })).status, 403);
        assert.equal((await request('POST', '/sameko/v1/hello', { origin: 'https://evil.example', body: HELLO })).status, 403);
        assert.equal((await request('POST', '/sameko/v1/poll', { origin: 'http://localhost:3000', body: { wait: 1 } })).status, 403);
        assert.equal((await request('POST', '/sameko/v1/events', { origin: 'null', body: { events: [] } })).status, 403);
        assert.equal(log.pair.length, 0);
    });

    await check('Competitive Companion POST / is unchanged', async () => {
        const problem = { name: 'A. Test', group: 'G', url: 'https://x/1', timeLimit: 1000, memoryLimit: 256, tests: [{ input: '1\n', output: '2\n' }], extra: 1 };
        const ok = await request('POST', '/', { body: problem });
        assert.equal(ok.status, 200); assert.equal(ok.text, 'OK');
        assert.deepEqual(log.problems.pop(), { name: 'A. Test', group: 'G', url: 'https://x/1', timeLimit: 1000, memoryLimit: 256, tests: [{ input: '1\n', output: '2\n' }] });
        assert.equal(log.focus, 1);
        const web = await request('POST', '/', { origin: 'https://evil.example', body: problem });
        assert.equal(web.status, 403); assert.equal(web.text, 'Forbidden');
        assert.equal((await request('POST', '/', { raw: '{' })).text, 'Parse Error');
        assert.equal((await request('GET', '/')).status, 405);
        log.focus = 0;
    });

    await check('protocol mismatch answers ok:false', async () => {
        const r = await hello(EXT_A, { ...HELLO, protocol: 2 });
        assert.equal(r.status, 200);
        assert.deepEqual(r.json, { ok: false, error: 'protocol', protocol: 1 });
    });

    bridge().setTheme(THEME1);

    await check('hello from an unknown origin: paired:false, one pair request', async () => {
        const r = await hello(EXT_A);
        assert.equal(r.status, 200);
        assert.ok(r.type.startsWith('application/json'));
        assert.equal(r.json.ok, true); assert.equal(r.json.paired, false); assert.equal(r.json.denied, false);
        assert.deepEqual(r.json.app, { name: 'Sameko Dev C++', version: '9.9.9' });
        await hello(EXT_A);
        assert.deepEqual(log.pair, [{ origin: EXT_A, browser: 'chrome', extVersion: '0.1.0' }]);
        const st = bridge().getStatus();
        assert.equal(st.paired, false); assert.equal(st.running, true);
        assert.deepEqual(st.adapters, [{ id: 'codeforces', name: 'Codeforces', hosts: ['codeforces.com'] }]);
        assert.deepEqual(st.pendingPair, { origin: EXT_A, browser: 'chrome', extVersion: '0.1.0' });
    });

    await check('poll and events answer 401 while unpaired', async () => {
        const p = await poll(EXT_A);
        assert.equal(p.status, 401); assert.deepEqual(p.json, { error: 'unpaired' });
        assert.equal((await postEvents(EXT_A, [])).status, 401);
    });

    await check('deny: hello reports denied:true', async () => {
        log.pair = [];
        await hello(EXT_B);
        assert.equal(log.pair.length, 1);
        assert.deepEqual(bridge().respondPair({ origin: EXT_B, allow: false }), { success: true });
        const r = await hello(EXT_B);
        assert.equal(r.json.paired, false); assert.equal(r.json.denied, true);
        assert.equal(log.pair.length, 1);
        assert.equal(bridge().respondPair({ origin: 'https://evil.example', allow: true }).success, false);
        assert.equal(bridge().getStatus().pendingPair.origin, EXT_A, 'the answered prompt is no longer pending');
    });

    await check('hello with retry:true clears a denial and prompts again', async () => {
        log.pair = [];
        const r = await hello(EXT_B, { ...HELLO, retry: true });
        assert.equal(r.json.paired, false); assert.equal(r.json.denied, false);
        assert.deepEqual(log.pair, [{ origin: EXT_B, browser: 'chrome', extVersion: '0.1.0' }]);
        assert.equal(bridge().getStatus().pendingPair.origin, EXT_B);
        await hello(EXT_B, { ...HELLO, retry: true });
        assert.equal(log.pair.length, 1, 'one prompt while it is unanswered');
        bridge().respondPair({ origin: EXT_B, allow: false });
        assert.equal((await hello(EXT_B)).json.denied, true);
    });

    await check('approve: paired, persisted, theme in hello', async () => {
        assert.deepEqual(bridge().respondPair({ origin: EXT_A, allow: true }), { success: true });
        const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'oj-extension.json'), 'utf8'));
        assert.deepEqual(saved, { approved: [EXT_A] });
        const r = await hello(EXT_A);
        assert.equal(r.json.paired, true); assert.equal(r.json.denied, false);
        assert.deepEqual(r.json.theme, THEME1);
        assert.equal(bridge().getStatus().paired, true);
        assert.equal(bridge().getStatus().pendingPair, null);
        assert.ok(log.status.some((s) => s.paired));
    });

    await check('poll times out empty; theme not repeated; connected flips on and off', async () => {
        log.status = [];
        const t0 = Date.now();
        const p = poll(EXT_A, 3);
        await delay(50);
        assert.equal(bridge().getStatus().connected, true);
        const r = await p;
        assert.ok(Date.now() - t0 >= 290, 'held for the wait');
        assert.deepEqual(r.json, { commands: [], theme: null });
        await delay(350);
        assert.equal(bridge().getStatus().connected, false);
        assert.deepEqual(log.status.map((s) => s.connected), [true, false]);
    });

    await check('poll is POST {wait}: GET answers 405, an invalid body waits the default', async () => {
        const g = await request('GET', '/sameko/v1/poll?wait=1', { origin: EXT_A });
        assert.equal(g.status, 405);
        const t0 = Date.now();
        const p = request('POST', '/sameko/v1/poll', { origin: EXT_A, raw: 'not json' });
        await delay(400);
        assert.equal(bridge().getStatus().connected, true, 'still held after 4 units: default 25');
        const s = bridge().submit(JOB);
        const r = await p;
        assert.ok(Date.now() - t0 < 1500);
        assert.equal(r.json.commands[0].id, s.id);
        const z = Date.now();
        assert.deepEqual((await poll(EXT_A, 0)).json.commands, []);
        assert.ok(Date.now() - z >= 90, 'wait 0 is clamped to 1');
    });

    await check('theme change reaches the next poll once', async () => {
        const p = poll(EXT_A, 30);
        await delay(50);
        bridge().setTheme(THEME2);
        const r = await p;
        assert.deepEqual(r.json, { commands: [], theme: THEME2 });
        assert.equal((await poll(EXT_A, 1)).json.theme, null);
        bridge().setTheme(THEME2); // unchanged: nothing to send
        assert.equal((await poll(EXT_A, 1)).json.theme, null);
    });

    await check('poll returns a queued command; a waiting poll gets one at once', async () => {
        const res = bridge().submit(JOB);
        assert.equal(res.success, true); assert.match(res.id, /^s_\d+_\d+$/);
        const r = await poll(EXT_A, 30);
        assert.deepEqual(r.json.commands, [{ type: 'submit', id: res.id, ...JOB }]);
        const p = poll(EXT_A, 30);
        await delay(50);
        const t0 = Date.now();
        const f = bridge().fetchProblem({ url: 'https://atcoder.jp/contests/abc300/tasks/abc300_a' });
        const r2 = await p;
        assert.ok(Date.now() - t0 < 500);
        assert.deepEqual(r2.json.commands, [{ type: 'fetchProblem', id: f.id, url: 'https://atcoder.jp/contests/abc300/tasks/abc300_a' }]);
        assert.equal(bridge().fetchProblem({}).success, true);
        assert.equal((await poll(EXT_A, 1)).json.commands[0].url, null);
        assert.equal(bridge().submit({ ...JOB, language: 'brainfuck' }).success, false);
        assert.equal(bridge().submit({ ...JOB, url: 'javascript:alert(1)' }).success, false);
    });

    await check('a newer poll makes the older one return at once', async () => {
        const t0 = Date.now();
        const older = poll(EXT_A, 30);
        await delay(50);
        const newer = poll(EXT_A, 1);
        const r = await older;
        assert.ok(Date.now() - t0 < 800, 'older returned early');
        assert.deepEqual(r.json, { commands: [] });
        assert.deepEqual((await newer).json.commands, []);
    });

    await check('commands nobody polls for expire as no-extension', async () => {
        const s = bridge().submit(JOB);
        const f = bridge().fetchProblem({});
        await delay(450);
        assert.deepEqual(log.submit, [{ type: 'submitStatus', id: s.id, state: 'failed', error: { code: 'no-extension', message: log.submit[0].error.message } }]);
        assert.ok(log.submit[0].error.message.length > 10);
        assert.equal(log.fetchFailed.length, 1);
        assert.equal(log.fetchFailed[0].type, 'fetchFailed');
        assert.equal(log.fetchFailed[0].requestId, f.id);
        assert.equal(log.fetchFailed[0].error.code, 'no-extension');
        assert.deepEqual((await poll(EXT_A, 1)).json.commands, []);
        log.submit = []; log.fetchFailed = [];
    });

    await check('events: problems forwarded with via/auto/requestId; auto does not focus', async () => {
        const f = bridge().fetchProblem({});
        await poll(EXT_A, 1);
        log.problems = []; log.focus = 0;
        const problem = { name: 'A. Cover in Water', group: 'Codeforces', url: 'https://codeforces.com/contest/1900/problem/A', timeLimit: 1000, memoryLimit: 256, tests: [{ input: '1\n', output: '2\n' }] };
        const r = await postEvents(EXT_A, [
            { type: 'problem', requestId: f.id, auto: false, problem },
            { type: 'problem', auto: true, problem: { ...problem, name: 'auto' } },
            { type: 'problem', requestId: 'f_1_999999', problem: { ...problem, name: 'unknown id' } },
            { type: 'problem', problem: { name: '' } },
            { type: 'whatever', x: 1 },
            null,
        ]);
        assert.equal(r.status, 200); assert.deepEqual(r.json, { ok: true });
        assert.equal(log.problems.length, 3);
        assert.deepEqual(log.problems[0], { ...problem, via: 'sameko', auto: false, requestId: f.id });
        assert.deepEqual(log.problems[1], { ...problem, name: 'auto', via: 'sameko', auto: true });
        assert.equal('requestId' in log.problems[2], false);
        assert.equal(log.focus, 2);
    });

    await check('events: fetchFailed and submitStatus forwarded and sanitised', async () => {
        const s = bridge().submit(JOB);
        const f = bridge().fetchProblem({});
        await poll(EXT_A, 1);
        await postEvents(EXT_A, [
            { type: 'fetchFailed', requestId: f.id, error: { code: 'no-problem-tab', message: 'No tab', junk: 1 } },
            { type: 'fetchFailed', requestId: 'f_1_1', error: { code: 'x' } },
            { type: 'submitStatus', id: s.id, state: 'judging', message: 'x'.repeat(5000), submissionUrl: 'javascript:alert(1)', evil: '<b>' },
            { type: 'submitStatus', id: s.id, state: 'done', submissionUrl: 'https://codeforces.com/s/1',
                verdict: { code: 'XYZ', text: 'Wrong answer on test 7', test: 7.5, timeMs: -1, memoryKb: '1024', points: 3, extra: 1 } },
            { type: 'submitStatus', id: s.id, state: 'failed', error: { code: 'weird', message: 42 } },
            { type: 'submitStatus', id: s.id, state: 'exploded' },
            { type: 'submitStatus', id: 's_1_1', state: 'opened' },
        ]);
        assert.deepEqual(log.fetchFailed, [{ type: 'fetchFailed', requestId: f.id, error: { code: 'no-problem-tab', message: 'No tab' } }]);
        assert.equal(log.submit.length, 3);
        assert.deepEqual(log.submit[0], { type: 'submitStatus', id: s.id, state: 'judging', message: 'x'.repeat(500) });
        assert.deepEqual(log.submit[1], { type: 'submitStatus', id: s.id, state: 'done', submissionUrl: 'https://codeforces.com/s/1',
            verdict: { code: 'OTHER', text: 'Wrong answer on test 7', test: 7, timeMs: null, memoryKb: null, points: 3 } });
        assert.deepEqual(log.submit[2], { type: 'submitStatus', id: s.id, state: 'failed', error: { code: 'internal', message: '' } });
        assert.equal((await request('POST', '/sameko/v1/events', { origin: EXT_A, body: { events: 'no' } })).status, 400);
    });

    await check('events body over 4 MiB answers 413', async () => {
        const big = JSON.stringify({ events: [{ type: 'x', pad: 'x'.repeat(4 * 1024 * 1024) }] });
        let r;
        try { r = await request('POST', '/sameko/v1/events', { origin: EXT_A, raw: big }); } catch (e) { r = { status: 'error ' + e.code }; }
        assert.equal(r.status, 413);
    });

    await check('stopping the server releases a waiting poll', async () => {
        const p = poll(EXT_A, 30);
        await delay(50);
        const t0 = Date.now();
        server.stopServer();
        const r = await p;
        assert.ok(Date.now() - t0 < 500);
        assert.deepEqual(r.json, { commands: [] });
        assert.equal(bridge().getStatus().running, false);
        assert.equal(bridge().submit(JOB).error.code, 'no-extension');
    });

    await check('approval survives a restart; a denial does not', async () => {
        configure();
        await start();
        log.pair = [];
        assert.equal((await hello(EXT_A)).json.paired, true);
        const b = await hello(EXT_B);
        assert.equal(b.json.paired, false); assert.equal(b.json.denied, false);
        assert.deepEqual(log.pair.map((p) => p.origin), [EXT_B]);
    });

    server.stopServer();
    bridge().dispose();
    fs.rmSync(stateDir, { recursive: true, force: true });
    console.log(`\n${failed ? 'FAILED' : 'ok'}`);
    process.exitCode = failed ? 1 : 0;
})();
