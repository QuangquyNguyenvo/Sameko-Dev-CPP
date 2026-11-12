#!/usr/bin/env node
'use strict';
/*
 * Extension unit/integration tests. Plain Node, built-ins only.
 *   node extension/test/run.js
 * Prints one PASS/FAIL line per test; exits non-zero on any failure.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..');
const A = require('../shared/adapters.js');
require('../adapters/codeforces.js');
require('../adapters/atcoder.js');
require('../adapters/cses.js');
require('../adapters/dmoj.js');
const mockAdapter = require('./mock-oj/adapter.js');
const SamekoBridge = require('../background/bridge.js');
const SamekoJobs = require('../background/jobs.js');
const SamekoContent = require('../content/main.js');
const SamekoPageWorld = require('../content/page-world.js');
const { createFakeChrome } = require('./fake-chrome.js');
const { createStubApp } = require('./stub-app.js');
const { createMockOj } = require('./mock-oj/server.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── registry, helpers, pickLanguage ──────────────────────────────────────────────────────────
const CF_OPTIONS = [
    ['43', 'GNU GCC C11 5.1.0'], ['52', 'Clang++20 Diagnostics'], ['50', 'GNU G++14 6.4.0'],
    ['54', 'GNU G++17 7.3.0'], ['61', 'GNU G++17 9.2.0 (64 bit, msys 2)'], ['89', 'GNU G++20 13.2 (64 bit, winlibs)'],
    ['91', 'GNU G++23 14.2 (64 bit, msys2)'], ['65', 'C# 8, .NET Core 3.1'], ['7', 'Python 2.7.18'],
    ['31', 'Python 3.8.10'], ['40', 'PyPy 2.7.13 (7.3.0)'], ['70', 'PyPy 3.10 (7.3.15, 64bit)'],
    ['87', 'Java 21 64bit'], ['36', 'Java 8 32bit'], ['34', 'JavaScript V8 4.8.0'], ['55', 'Node.js 15.8.0 (64bit)'],
    ['75', 'Rust 1.75.0 (2021)'], ['32', 'Go 1.22.2'], ['83', 'Kotlin 1.7.20'], ['4', 'Free Pascal 3.2.2']
].map(([value, text]) => ({ value, text }));
const pick = (job, prefs, opts) => { const o = A.pickLanguage(opts || CF_OPTIONS, job, prefs); return o && o.text; };

test('registry: register, byUrl (exact hosts, www ignored), list', () => {
    assert.strictEqual(A.byUrl('https://codeforces.com/contest/1/problem/A').id, 'codeforces');
    assert.strictEqual(A.byUrl('https://www.codeforces.com/').id, 'codeforces');
    assert.strictEqual(A.byUrl('https://m2.codeforces.com/').id, 'codeforces');
    assert.strictEqual(A.byUrl('https://oj.vnoi.info/problem/x').id, 'dmoj');
    assert.strictEqual(A.byUrl('http://localhost:27190/problem/A').id, 'mock-oj');
    assert.strictEqual(A.byUrl('https://evil-codeforces.com/'), null);
    assert.strictEqual(A.byUrl('not a url'), null);
    const ids = A.list().map(a => a.id).sort();
    assert.deepStrictEqual(ids, ['atcoder', 'codeforces', 'cses', 'dmoj', 'mock-oj']);
    assert.throws(() => A.register({ id: 'x' }));
    assert.strictEqual(A.classifyUrl('https://atcoder.jp/contests/abc300/tasks/abc300_a'), 'problem');
    assert.strictEqual(A.classifyUrl('https://example.com/'), null);
});

test('pickLanguage: cpp prefers the requested std, then the newest GCC', () => {
    assert.strictEqual(pick({ language: 'cpp' }), 'GNU G++23 14.2 (64 bit, msys2)');
    assert.strictEqual(pick({ language: 'cpp', std: 'c++17' }), 'GNU G++17 9.2.0 (64 bit, msys 2)');
    assert.strictEqual(pick({ language: 'cpp', std: 'c++20' }), 'GNU G++20 13.2 (64 bit, winlibs)');
    assert.strictEqual(pick({ language: 'cpp', std: 'gnu++14' }), 'GNU G++14 6.4.0');
    assert.strictEqual(pick({ language: 'cpp', std: 'c++1z' }), 'GNU G++17 9.2.0 (64 bit, msys 2)');
    assert.strictEqual(pick({ language: 'cpp', std: 'c++11' }), 'GNU G++23 14.2 (64 bit, msys2)');    // not offered
    assert.strictEqual(pick({ language: 'cpp' }, { cpp: [/Clang/] }), 'Clang++20 Diagnostics');      // adapter order wins
    assert.strictEqual(pick({ language: 'cpp' }, null, [{ value: '1', text: 'C++ 17 (Clang 16)' }, { value: '2', text: 'C++ 20 (Clang 16)' }]), 'C++ 20 (Clang 16)');
    assert.strictEqual(pick({ language: 'cpp', std: 'c++17' }, null, [{ value: '1', text: 'C++17 (GCC 9.2.1)' }, { value: '2', text: 'C++23 (GCC 12.2)' }]), 'C++17 (GCC 9.2.1)');
});

test('pickLanguage: other languages, never a wrong language', () => {
    assert.strictEqual(pick({ language: 'c' }), 'GNU GCC C11 5.1.0');
    assert.strictEqual(pick({ language: 'python' }), 'Python 3.8.10');
    assert.strictEqual(pick({ language: 'python' }, { python: [/PyPy 3/] }), 'PyPy 3.10 (7.3.15, 64bit)');
    assert.strictEqual(pick({ language: 'java' }), 'Java 21 64bit');
    assert.strictEqual(pick({ language: 'javascript' }), 'Node.js 15.8.0 (64bit)');   // newest version among matches
    assert.strictEqual(pick({ language: 'csharp' }), 'C# 8, .NET Core 3.1');
    assert.strictEqual(pick({ language: 'pascal' }), 'Free Pascal 3.2.2');
    assert.strictEqual(pick({ language: 'go' }), 'Go 1.22.2');
    assert.strictEqual(pick({ language: 'kotlin' }), 'Kotlin 1.7.20');
    const cppOnly = [{ value: '1', text: 'GNU G++17' }, { value: '2', text: 'Java 21' }];
    assert.strictEqual(pick({ language: 'c' }, null, cppOnly), null);
    assert.strictEqual(pick({ language: 'rust' }, null, cppOnly), null);
    assert.strictEqual(pick({ language: 'javascript' }, null, cppOnly), null);
    assert.strictEqual(pick({ language: 'cobol' }), null);
    assert.strictEqual(pick({ language: 'cpp' }, null, [{ value: '', text: 'C++ (choose)' }]), null);
});

test('verdict and limit helpers', () => {
    const cases = { 'Accepted': 'AC', 'Wrong answer on test 7': 'WA', 'Time limit exceeded on test 3': 'TLE',
        'Memory limit exceeded': 'MLE', 'Runtime error on test 2': 'RE', 'RTE': 'RE', 'IR': 'RE', 'Compilation error': 'CE',
        'Output limit exceeded': 'OLE', 'Judgement failed': 'IE', 'Partial': 'PARTIAL', 'Skipped': 'OTHER', 'AC': 'AC', 'TLE': 'TLE' };
    for (const [t, c] of Object.entries(cases)) assert.strictEqual(A.normalizeVerdict(t), c, t);
    for (const t of ['Running on test 7', 'In queue', 'WJ', '3/12', 'Judging', 'Compiling', '']) assert.ok(A.isPendingVerdict(t), t);
    for (const t of ['Accepted', 'Wrong answer on test 2', 'Compilation error', 'TLE']) assert.ok(!A.isPendingVerdict(t), t);
    assert.strictEqual(A.parseTimeMs('46 ms'), 46);
    assert.strictEqual(A.parseTimeMs('2 seconds'), 2000);
    assert.strictEqual(A.parseTimeMs('1.5 s'), 1500);
    assert.strictEqual(A.parseMemoryKb('1024 KB'), 1024);
    assert.strictEqual(A.parseMemoryKb('256 megabytes'), 262144);
    assert.strictEqual(A.parseTimeMs(''), null);
});

test('manifest: files exist, every shipped adapter host is matched and permitted', () => {
    const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    assert.strictEqual(m.manifest_version, 3);
    const files = [m.background.service_worker, m.action.default_popup, ...Object.values(m.icons),
        ...m.content_scripts.flatMap(c => c.js), 'content/page-world.js', 'background/bridge.js', 'background/jobs.js'];
    for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), `missing ${f}`);
    const matches = m.content_scripts.flatMap(c => c.matches);
    for (const a of A.list().filter(x => x.id !== 'mock-oj')) {
        for (const h of a.hosts) {
            assert.ok(matches.includes(`https://${h}/*`), `content_scripts misses ${h}`);
            assert.ok(m.host_permissions.includes(`https://${h}/*`), `host_permissions misses ${h}`);
        }
    }
    assert.ok(!JSON.stringify(m).includes('mock-oj'), 'mock adapter must not ship');
    assert.ok(m.host_permissions.includes('http://127.0.0.1/*'));
});

test('locales: every data-i18n / t() / __MSG__ key exists in en, vi and zh_CN with the same placeholders', () => {
    const langs = ['en', 'vi', 'zh_CN'];
    const msgs = {};
    for (const l of langs) msgs[l] = JSON.parse(fs.readFileSync(path.join(EXT, '_locales', l, 'messages.json'), 'utf8'));
    const used = new Set();
    for (const f of ['popup/popup.html', 'welcome/welcome.html', 'manifest.json']) {
        const src = fs.readFileSync(path.join(EXT, f), 'utf8');
        for (const m of src.matchAll(/data-i18n(?:-title|-aria)?="(\w+)"/g)) used.add(m[1]);
        for (const m of src.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
    }
    for (const f of ['popup/popup.js', 'popup/ui.js', 'welcome/welcome.js', 'content/main.js']) {
        const src = fs.readFileSync(path.join(EXT, f), 'utf8');
        for (const m of src.matchAll(/\bt\('(\w+)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/'((?:st|notice|state|verdict|status|toast)[A-Z]\w*)'/g)) used.add(m[1]);   // key tables
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    assert.strictEqual(manifest.default_locale, 'en');
    assert.ok(used.size > 25, 'found the keys in use');
    for (const l of langs) {
        for (const k of used) assert.ok(msgs[l][k] && msgs[l][k].message, `${l}: missing key ${k}`);
        for (const k of Object.keys(msgs[l])) {
            assert.ok(msgs.en[k], `${l}: key ${k} not in en`);
            assert.deepStrictEqual(Object.keys(msgs[l][k].placeholders || {}), Object.keys(msgs.en[k].placeholders || {}), `${l}: placeholders of ${k}`);
            if (/^ext(Name|ActionTitle)$/.test(k)) assert.ok(msgs[l][k].message.includes('Sameko Dev C++'), `${l}: app name kept in ${k}`);
            for (const ph of Object.keys(msgs[l][k].placeholders || {})) assert.ok(msgs[l][k].message.includes('$' + ph.toUpperCase() + '$'), `${l}: ${k} uses $${ph}$`);
        }
    }
    for (const f of ['welcome/welcome.html', 'welcome/welcome.js', 'welcome/welcome.css', 'popup/ui.css', 'popup/ui.js', 'fonts/nunito-latin.woff2', 'fonts/fredoka-latin.woff2']) {
        assert.ok(fs.existsSync(path.join(EXT, f)), `missing ${f}`);
    }
    for (const f of ['popup/popup.html', 'welcome/welcome.html']) {
        const src = fs.readFileSync(path.join(EXT, f), 'utf8');
        assert.ok(!/\son\w+\s*=/.test(src) && !/<script(?![^>]*\ssrc=)/.test(src), `${f}: no inline script or handler (MV3 CSP)`);
        assert.ok(!/(?:src|href)="https?:/.test(src.replace(/href="https:\/\/sameko\.dev"/g, '')), `${f}: no remote resources`);
    }
});

test('mock adapter: classify and submitUrl', () => {
    assert.strictEqual(mockAdapter.classify('http://localhost:27190/problem/A').kind, 'problem');
    assert.strictEqual(mockAdapter.classify('http://localhost:27190/submit/A').kind, 'submit');
    assert.strictEqual(mockAdapter.classify('http://localhost:27190/status').kind, 'status');
    assert.strictEqual(mockAdapter.classify('http://localhost:27190/submission/3').kind, 'status');
    assert.strictEqual(mockAdapter.classify('http://localhost:27190/').kind, 'other');
    assert.strictEqual(mockAdapter.submitUrl('http://localhost:27190/problem/B'), 'http://localhost:27190/submit/B');
    assert.strictEqual(mockAdapter.submitUrl('http://localhost:27190/status'), null);
});

test('page-world setEditorText is self-contained (serialisable)', () => {
    const src = SamekoPageWorld.setEditorText.toString();
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${src})`)();
    assert.strictEqual(typeof fn, 'function');
    assert.ok(!/SamekoPageWorld|root\./.test(src));
});

// ── bridge against an in-test app server (PROTOCOL §1) ──────────────────────────────────────
const ORIGIN = 'chrome-extension://testextensionid';
const originFetch = (url, init) => {
    const i = Object.assign({}, init);
    i.headers = Object.assign({}, i.headers, { Origin: ORIGIN });
    return fetch(url, i);
};

function makeBridge(port, fake, extra) {
    const commands = [];
    const bridge = SamekoBridge.create(Object.assign({
        chrome: fake.chrome,
        fetch: originFetch,
        extVersion: '0.1.0',
        config: { baseUrl: `http://127.0.0.1:${port}`, pairIntervalMs: 40, pollWaitSec: 1, backoffMinMs: 30, backoffMaxMs: 120, eventRetryMs: 40, protocolRetryMs: 200 },
        getAdapters: () => A.list(),
        onCommand: cmd => commands.push(cmd)
    }, extra || {}));
    return { bridge, commands };
}

function waitState(bridge, state, timeoutMs) {
    return new Promise((resolve, reject) => {
        if (bridge.state.state === state) return resolve(bridge.state);
        const t = setTimeout(() => { off(); reject(new Error(`bridge never reached ${state} (is ${bridge.state.state}/${bridge.state.detail})`)); }, timeoutMs || 4000);
        const off = bridge.onStateChange(s => { if (s.state === state) { clearTimeout(t); off(); resolve(s); } });
    });
}

async function until(pred, timeoutMs, what) {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 4000)) {
        if (await pred()) return;
        await sleep(15);
    }
    throw new Error(`timed out: ${what}`);
}

test('bridge: pairing loop, approval, theme cached, connection state stored', async () => {
    const theme = { id: 'kawaii-dark', variant: 'dark', bg: '#1a1b26' };
    const app = createStubApp({ theme });
    const port = await app.listen(0);
    const fake = createFakeChrome();
    const { bridge } = makeBridge(port, fake);
    try {
        bridge.start();
        await waitState(bridge, 'unpaired');
        await app.waitFor(() => app.hellos.length >= 3, 3000, 'repeated hellos');
        assert.strictEqual(app.pairRequests.length, 1);
        assert.strictEqual(app.hellos[0].protocol, 1);
        assert.strictEqual(app.hellos[0].retry, false);
        assert.ok(app.hellos[0].adapters.some(a => a.id === 'codeforces'));
        app.approve(ORIGIN);
        await waitState(bridge, 'connected');
        await app.waitFor(() => app.pollPending, 2000, 'a pending poll');
        assert.strictEqual((await fake.chrome.storage.session.get('connection')).connection.state, 'connected');
        assert.deepStrictEqual((await fake.chrome.storage.local.get('theme')).theme, theme);
        assert.ok(fake.chrome.runtime.sent.some(m => m.type === 'connection' && m.connection.state === 'connected'));
    } finally { bridge.stop(); await app.close(); }
});

test('bridge: poll delivers commands; events are posted (queued while offline)', async () => {
    const app = createStubApp({ autoApprove: true });
    const port = await app.listen(0);
    const fake = createFakeChrome();
    const { bridge, commands } = makeBridge(port, fake);
    try {
        await bridge.postEvent({ type: 'submitStatus', id: 's1', state: 'opened' });   // before connecting
        bridge.start();
        await waitState(bridge, 'connected');
        await app.waitFor(() => app.events.length === 1, 2000, 'queued event');
        await app.waitFor(() => app.pollPending, 2000, 'a pending poll');
        app.queue({ type: 'fetchProblem', id: 'f1', url: null });
        await until(() => commands.length === 1, 2000, 'command delivered');
        assert.strictEqual(commands[0].id, 'f1');
        await bridge.postEvent({ type: 'fetchFailed', requestId: 'f1', error: { code: 'no-problem-tab', message: 'x' } });
        await app.waitFor(() => app.events.length === 2, 2000, 'second event');
        assert.strictEqual(app.events[1].requestId, 'f1');
        await until(() => bridge.queued === 0, 2000, 'queue drained');
        // long poll keeps going: several polls over ~1.5 s with wait=1
        const p0 = app.polls;
        await app.waitFor(() => app.polls >= p0 + 1, 3000, 'poll renewed after wait');
    } finally { bridge.stop(); await app.close(); }
});

test('bridge: a superseded poll returns empty and the bridge keeps polling', async () => {
    const app = createStubApp({ autoApprove: true });
    const port = await app.listen(0);
    const fake = createFakeChrome();
    const { bridge, commands } = makeBridge(port, fake, { config: { baseUrl: `http://127.0.0.1:${port}`, pollWaitSec: 5, backoffMinMs: 30, pairIntervalMs: 40 } });
    try {
        bridge.start();
        await waitState(bridge, 'connected');
        await app.waitFor(() => app.pollPending, 2000, 'bridge poll');
        const polls = app.polls;
        // Another poller (e.g. a second browser profile) takes over; the bridge's poll ends empty.
        const other = originFetch(`http://127.0.0.1:${port}/sameko/v1/poll`, { method: 'POST', body: JSON.stringify({ wait: 5 }) }).then(r => r.json());
        await app.waitFor(() => app.polls >= polls + 2, 2000, 'bridge re-polled');   // other + bridge again
        const otherBody = await other;                                                // superseded by the bridge
        assert.deepStrictEqual(otherBody.commands, []);
        app.queue({ type: 'submit', id: 's9', url: 'http://localhost/problem/A', source: 'x', language: 'cpp' });
        await until(() => commands.length === 1, 2000, 'command after supersede');
        assert.strictEqual(bridge.state.state, 'connected');
    } finally { bridge.stop(); await app.close(); }
});

test('bridge: app goes away → disconnected with backoff → reconnects', async () => {
    let app = createStubApp({ autoApprove: true });
    const port = await app.listen(0);
    const fake = createFakeChrome();
    const { bridge, commands } = makeBridge(port, fake);
    try {
        bridge.start();
        await waitState(bridge, 'connected');
        await app.close();
        const s = await waitState(bridge, 'disconnected');
        assert.strictEqual(s.detail, 'unreachable');
        await bridge.postEvent({ type: 'submitStatus', id: 's2', state: 'failed' });   // queued while down
        await sleep(150);
        app = createStubApp({ autoApprove: true });
        await app.listen(port);
        bridge.kick();
        await waitState(bridge, 'connected', 3000);
        await app.waitFor(() => app.events.some(e => e.id === 's2'), 2000, 'queued event after reconnect');
        await app.waitFor(() => app.pollPending, 2000, 'poll after reconnect');
        app.queue({ type: 'fetchProblem', id: 'f2' });
        await until(() => commands.some(c => c.id === 'f2'), 2000, 'command after reconnect');
    } finally { bridge.stop(); await app.close(); }
});

test('bridge: denial parks the loop; retry() sends retry:true and pairs again', async () => {
    const app = createStubApp();
    const port = await app.listen(0);
    app.deny(ORIGIN);
    const fake = createFakeChrome();
    const { bridge } = makeBridge(port, fake);
    try {
        bridge.start();
        await waitState(bridge, 'denied');
        const n = app.hellos.length;
        bridge.kick();                                   // alarms do not lift a denial
        await sleep(200);
        assert.strictEqual(app.hellos.length, n, 'no hellos while denied');
        await bridge.retry();
        await app.waitFor(() => app.hellos.length > n, 2000, 'retry hello');
        assert.strictEqual(app.hellos[n].retry, true);
        await waitState(bridge, 'unpaired');
        assert.ok(app.hellos.slice(n + 1).every(h => h.retry === false), 'only one retry hello');
        app.approve(ORIGIN);
        await waitState(bridge, 'connected');
    } finally { bridge.stop(); await app.close(); }
});

test('bridge: denied state survives a worker restart', async () => {
    const app = createStubApp();
    const port = await app.listen(0);
    const fake = createFakeChrome();
    await fake.chrome.storage.session.set({ connection: { state: 'denied' } });
    const { bridge } = makeBridge(port, fake);
    try {
        bridge.start();
        await sleep(150);
        assert.strictEqual(bridge.state.state, 'denied');
        assert.strictEqual(app.hellos.length, 0);
    } finally { bridge.stop(); await app.close(); }
});

test('bridge: protocol mismatch and 401 on poll', async () => {
    const app = createStubApp({ protocol: 2, autoApprove: true });
    const port = await app.listen(0);
    const fake = createFakeChrome();
    const { bridge } = makeBridge(port, fake);
    try {
        bridge.start();
        const s = await waitState(bridge, 'disconnected');
        await until(() => bridge.state.detail === 'protocol', 2000, 'protocol detail');
        assert.ok(s);
    } finally { bridge.stop(); await app.close(); }

    const app2 = createStubApp({ autoApprove: true });
    const port2 = await app2.listen(0);
    const { bridge: b2 } = makeBridge(port2, createFakeChrome());
    try {
        b2.start();
        await waitState(b2, 'connected');
        app2.unpair(ORIGIN);
        app2.queue({ type: 'noop' });                     // ends the pending poll; the next one gets 401
        await waitState(b2, 'unpaired');
        app2.approve(ORIGIN);
        await waitState(b2, 'connected');
    } finally { b2.stop(); await app2.close(); }
});

// ── jobs state machine with a fake chrome ───────────────────────────────────────────────────
const PROBLEM_URL = 'http://localhost:27190/problem/A';
const PROBLEM = { name: 'A. Sum of Two', group: 'Mock OJ', url: PROBLEM_URL, timeLimit: 1000, memoryLimit: 256, tests: [{ input: '1 2\n', output: '3\n' }] };

function makeJobs(opts) {
    const fake = createFakeChrome(opts && opts.fake);
    const events = [];
    const clock = { t: 1000000 };
    const jobs = SamekoJobs.create({
        chrome: fake.chrome, adapters: A,
        emit: ev => { events.push(ev); },
        now: () => clock.t,
        setTimeout: () => 0,                               // tests call checkTimeouts() themselves
        contentFiles: ['shared/adapters.js', 'adapters/mock-oj.js', 'content/main.js'],
        pageWorld: SamekoPageWorld
    });
    fake.chrome.tabs.onRemoved.addListener(id => jobs.onTabRemoved(id));
    const settle = async () => { for (let i = 0; i < 4; i++) { await jobs.idle(); await sleep(1); } };
    const msg = (tabId, m, active) => jobs.handleMessage(m, { tab: { id: tabId, active: active !== false }, frameId: 0 });
    const states = (id) => events.filter(e => e.type === 'submitStatus' && e.id === id).map(e => e.state);
    return { fake, jobs, events, clock, settle, msg, states };
}

const submitCmd = (id, extra) => Object.assign({ type: 'submit', id, url: PROBLEM_URL, source: 'int main(){}', language: 'cpp', std: 'c++17', fileName: 'a.cpp', autoSubmit: true }, extra || {});

test('jobs: submit happy path opened → filled → submitted → judging → done; tab reused', async () => {
    const { fake, jobs, events, msg, states, settle } = makeJobs();
    await jobs.handleCommand(submitCmd('s1'));
    const created = fake.calls.filter(c => c[0] === 'tabs.create');
    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0][1].url, 'http://localhost:27190/submit/A');
    const tabId = Array.from(fake.tabs.keys())[0];
    let me = await msg(tabId, { type: 'whoami' });
    assert.strictEqual(me.stage, 'fill');
    assert.strictEqual(me.job.source, 'int main(){}');
    assert.strictEqual(me.adapterId, 'mock-oj');
    assert.deepStrictEqual(await msg(999, { type: 'whoami' }), { job: null });
    await msg(tabId, { type: 'submitted', id: 's1' });
    me = await msg(tabId, { type: 'whoami' });
    assert.strictEqual(me.stage, 'watch');
    const running = (n) => ({ final: false, code: null, text: `Running on test ${n}`, submissionUrl: 'http://localhost:27190/submission/1' });
    await msg(tabId, { type: 'verdict', id: 's1', result: running(1) });
    await msg(tabId, { type: 'verdict', id: 's1', result: running(1) });
    await msg(tabId, { type: 'verdict', id: 's1', result: running(2) });
    await msg(tabId, { type: 'verdict', id: 's1', result: { final: true, code: 'WA', text: 'Wrong answer on test 2', test: 2, timeMs: 15, memoryKb: 512, points: null } });
    assert.deepStrictEqual(states('s1'), ['opened', 'filled', 'submitted', 'judging', 'judging', 'done']);
    const done = events[events.length - 1];
    assert.deepStrictEqual(done.verdict, { code: 'WA', text: 'Wrong answer on test 2', test: 2, timeMs: 15, memoryKb: 512, points: null });
    assert.strictEqual(done.submissionUrl, 'http://localhost:27190/submission/1');
    assert.strictEqual(events.filter(e => e.state === 'judging')[0].message, 'Running on test 1');
    assert.deepStrictEqual(await msg(tabId, { type: 'whoami' }), { job: null });
    const recent = await jobs.recent();
    assert.strictEqual(recent.length, 1);
    assert.strictEqual(recent[0].state, 'done');
    assert.strictEqual(recent[0].verdict.code, 'WA');

    await jobs.handleCommand(submitCmd('s2'));
    assert.strictEqual(fake.calls.filter(c => c[0] === 'tabs.create').length, 1, 'no new tab');
    assert.ok(fake.calls.some(c => c[0] === 'tabs.update' && c[1] === tabId && c[2].url.endsWith('/submit/A')));
    assert.strictEqual((await msg(tabId, { type: 'whoami' })).job.id, 's2');
    await settle();
});

test('jobs: autoSubmit false stops at filled; the setting overrides the app', async () => {
    const { fake, jobs, msg, states } = makeJobs();
    await jobs.handleCommand(submitCmd('s1', { autoSubmit: false }));
    const tabId = Array.from(fake.tabs.keys())[0];
    assert.strictEqual((await msg(tabId, { type: 'whoami' })).job.autoSubmit, false);
    await msg(tabId, { type: 'filled', id: 's1' });
    assert.deepStrictEqual(states('s1'), ['opened', 'filled']);
    assert.deepStrictEqual(await msg(tabId, { type: 'whoami' }), { job: null });

    await jobs.setSetting('autoSubmit', false);
    await jobs.setSetting('submitInBackground', true);
    await jobs.handleCommand(submitCmd('s2', { autoSubmit: true }));
    const me = await msg(tabId, { type: 'whoami' });
    assert.strictEqual(me.job.autoSubmit, false);
    assert.strictEqual(fake.calls.filter(c => c[0] === 'tabs.update').pop()[2].active, false);
});

test('jobs: content script fill stage → not-logged-in, adapter error, success', async () => {
    const { fake, jobs, msg, states, events } = makeJobs();
    const win = { setInterval: setInterval, clearInterval, setTimeout, clearTimeout, location: { href: 'http://localhost:27190/submit/A' } };
    const doc = { documentElement: null };
    const contentChrome = (tabId) => ({ runtime: { sendMessage: (m) => msg(tabId, m) } });

    await jobs.handleCommand(submitCmd('s1'));
    let tabId = Array.from(fake.tabs.keys())[0];
    let me = await msg(tabId, { type: 'whoami' });
    const loggedOut = Object.assign({}, mockAdapter, { isLoggedIn: () => false });
    assert.strictEqual(await SamekoContent.runFill({ chrome: contentChrome(tabId), doc, win, adapters: A, adapter: loggedOut, job: me.job }), 'failed');
    assert.deepStrictEqual(states('s1'), ['opened', 'failed']);
    assert.strictEqual(events.pop().error.code, 'not-logged-in');

    await jobs.handleCommand(submitCmd('s2', { language: 'cobol' }));
    me = await msg(tabId, { type: 'whoami' });
    const noLang = Object.assign({}, mockAdapter, {
        isLoggedIn: () => true,
        async fillAndSubmit(d, job, h) { if (!h.pickLanguage([{ value: '1', text: 'GNU G++17' }], job)) throw h.error('language-not-found', 'no cobol'); }
    });
    await SamekoContent.runFill({ chrome: contentChrome(tabId), doc, win, adapters: A, adapter: noLang, job: me.job });
    assert.strictEqual(events.pop().error.code, 'language-not-found');

    await jobs.handleCommand(submitCmd('s3'));
    me = await msg(tabId, { type: 'whoami' });
    let reads = 0;
    const ok = Object.assign({}, mockAdapter, {
        isLoggedIn: () => true,
        async fillAndSubmit(d, job, h) { await h.aboutToSubmit(); },
        readSubmitError: null,
        readVerdict() { reads++; return reads < 2 ? { final: false, text: 'Running on test 1' } : { final: true, code: 'AC', text: 'Accepted', timeMs: 46, memoryKb: 1024 }; }
    });
    const r = await SamekoContent.runFill({ chrome: contentChrome(tabId), doc, win, adapters: A, adapter: ok, job: me.job });
    assert.strictEqual(r, 'submitted');
    await until(() => states('s3').includes('done'), 4000, 'done via watch timer');
    assert.deepStrictEqual(states('s3'), ['opened', 'filled', 'submitted', 'judging', 'done']);
    tabId = null;
});

test('jobs: watch stage reports a judge rejection (readSubmitError)', async () => {
    const { fake, jobs, msg, events } = makeJobs();
    await jobs.handleCommand(submitCmd('s1'));
    const tabId = Array.from(fake.tabs.keys())[0];
    await msg(tabId, { type: 'submitted', id: 's1' });
    const me = await msg(tabId, { type: 'whoami' });
    const win = { setInterval, clearInterval, setTimeout, clearTimeout, location: { href: 'http://localhost:27190/submit/A' } };
    const adapter = Object.assign({}, mockAdapter, { readSubmitError: () => 'You have submitted exactly the same code before.', readVerdict: () => null });
    SamekoContent.startWatch({ chrome: { runtime: { sendMessage: m => msg(tabId, m) } }, doc: {}, win, adapter, job: me.job });
    await until(() => events.some(e => e.state === 'failed'), 2000, 'rejected');
    assert.strictEqual(events.find(e => e.state === 'failed').error.code, 'rejected');
});

test('jobs: unsupported-site, tab-closed, timeouts', async () => {
    const { fake, jobs, events, clock, msg, states, settle } = makeJobs();
    await jobs.handleCommand(submitCmd('u1', { url: 'https://example.com/problem/1' }));
    assert.strictEqual(events.pop().error.code, 'unsupported-site');
    await jobs.handleCommand(submitCmd('u2', { url: 'https://codeforces.com/blog/entry/1' }));   // a page the adapter cannot submit to: submitUrl null
    assert.strictEqual(events.pop().error.code, 'unsupported-site');
    assert.strictEqual(fake.tabs.size, 0);

    await jobs.handleCommand(submitCmd('c1'));
    const tabId = Array.from(fake.tabs.keys())[0];
    fake.closeTab(tabId);
    await settle();
    assert.deepStrictEqual(states('c1'), ['opened', 'failed']);
    assert.strictEqual(events.pop().error.code, 'tab-closed');

    await jobs.handleCommand(submitCmd('t1'));
    clock.t += 59000;
    await jobs.checkTimeouts();
    assert.deepStrictEqual(states('t1'), ['opened']);
    clock.t += 2000;
    await jobs.checkTimeouts();
    assert.deepStrictEqual(states('t1'), ['opened', 'failed']);
    assert.strictEqual(events.pop().error.code, 'timeout');

    await jobs.handleCommand(submitCmd('t2'));
    const tab2 = Array.from(fake.tabs.keys()).pop();
    await msg(tab2, { type: 'submitted', id: 't2' });
    clock.t += 5 * 60 * 1000;
    await jobs.checkTimeouts();
    assert.ok(!states('t2').includes('failed'), 'watch stage survives 60 s');
    clock.t += 5 * 60 * 1000 + 1;
    await jobs.checkTimeouts();
    assert.strictEqual(states('t2').pop(), 'failed');
    assert.strictEqual(events.pop().error.code, 'timeout');
});

test('jobs: fetchProblem with a URL opens an inactive tab, answers, closes it', async () => {
    const { fake, jobs, events, msg, settle } = makeJobs();
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f1', url: PROBLEM_URL });
    const create = fake.calls.find(c => c[0] === 'tabs.create');
    assert.strictEqual(create[1].active, false);
    const tabId = Array.from(fake.tabs.keys())[0];
    fake.setTabHandler(tabId, (m) => (m.type === 'getProblem' ? { problem: PROBLEM } : undefined));
    await msg(tabId, { type: 'pageInfo', url: PROBLEM_URL, kind: 'problem', hasProblem: true, adapterId: 'mock-oj' }, false);
    await settle();
    assert.deepStrictEqual(events, [{ type: 'problem', requestId: 'f1', auto: false, problem: PROBLEM }]);
    assert.ok(!fake.tabs.has(tabId), 'fetch tab closed');

    // already open → read it in place, no new tab
    const open = fake.addTab({ url: PROBLEM_URL + '#statement' });
    fake.setTabHandler(open.id, () => ({ problem: PROBLEM }));
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f2', url: PROBLEM_URL });
    assert.strictEqual(fake.calls.filter(c => c[0] === 'tabs.create').length, 1);
    assert.strictEqual(events.pop().requestId, 'f2');

    // unknown site, and a tab that never loads
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f3', url: 'https://example.com/p/1' });
    assert.strictEqual(events.pop().error.code, 'unsupported-site');
});

test('jobs: fetchProblem timeout and tab-closed', async () => {
    const { fake, jobs, events, clock, settle } = makeJobs();
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f1', url: 'http://localhost:27190/problem/B' });
    clock.t += 31000;
    await jobs.checkTimeouts();
    await settle();
    assert.deepStrictEqual(events.pop(), { type: 'fetchFailed', requestId: 'f1', error: { code: 'timeout', message: 'The problem page did not load within 30 s.' } });
    assert.strictEqual(fake.tabs.size, 0);
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f2', url: 'http://localhost:27190/problem/B' });
    fake.closeTab(Array.from(fake.tabs.keys())[0]);
    await settle();
    assert.strictEqual(events.pop().error.code, 'tab-closed');
});

test('jobs: fetchProblem without a URL uses the problem tab looked at last', async () => {
    const { fake, jobs, events, clock, msg } = makeJobs();
    fake.addTab({ url: 'http://localhost:27190/status' });
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f1' });
    assert.deepStrictEqual(events.pop(), { type: 'fetchFailed', requestId: 'f1', error: { code: 'no-problem-tab', message: 'No online judge problem is open in the browser.' } });

    const a = fake.addTab({ url: 'http://localhost:27190/problem/A' });
    const b = fake.addTab({ url: 'http://localhost:27190/problem/B' });
    fake.setTabHandler(a.id, () => ({ problem: Object.assign({}, PROBLEM, { name: 'A' }) }));
    fake.setTabHandler(b.id, () => ({ problem: Object.assign({}, PROBLEM, { name: 'B' }) }));
    await msg(a.id, { type: 'pageInfo', url: a.url, kind: 'problem', hasProblem: true }, true);
    clock.t += 1000;
    await msg(b.id, { type: 'pageInfo', url: b.url, kind: 'problem', hasProblem: true }, true);
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f2' });
    assert.strictEqual(events.pop().problem.name, 'B');
    clock.t += 1000;
    await jobs.onTabActivated(a.id);
    await jobs.handleCommand({ type: 'fetchProblem', id: 'f3', url: null });
    const ev = events.pop();
    assert.strictEqual(ev.problem.name, 'A');
    assert.strictEqual(ev.requestId, 'f3');
});

test('jobs: missing content script is injected, then asked again', async () => {
    let injected = null;
    const ctx = makeJobs({ fake: { onExecuteScript: (d) => { injected = d; ctx.fake.setTabHandler(d.target.tabId, () => ({ problem: PROBLEM })); return [{ result: null }]; } } });
    const t = ctx.fake.addTab({ url: PROBLEM_URL, active: true });
    const r = await ctx.jobs.sendActiveTab();
    assert.deepStrictEqual(r, { ok: true, name: PROBLEM.name });
    assert.deepStrictEqual(injected.files, ['shared/adapters.js', 'adapters/mock-oj.js', 'content/main.js']);
    assert.strictEqual(injected.target.tabId, t.id);
    assert.deepStrictEqual(ctx.events.pop(), { type: 'problem', auto: false, problem: PROBLEM });
    const info = await ctx.jobs.activeTabInfo();
    assert.strictEqual(info.canSend, true);
    assert.strictEqual(info.adapter, 'Mock OJ');
});

test('jobs: auto-send on problem page load is opt-in and de-duplicated', async () => {
    const { fake, jobs, events, msg, settle } = makeJobs();
    const t = fake.addTab({ url: PROBLEM_URL, active: true });
    fake.setTabHandler(t.id, () => ({ problem: PROBLEM }));
    const info = { type: 'pageInfo', url: PROBLEM_URL, kind: 'problem', hasProblem: true, adapterId: 'mock-oj' };
    await msg(t.id, info); await settle();
    assert.strictEqual(events.length, 0, 'off by default');
    await jobs.setSetting('autoSendProblems', true);
    await msg(t.id, info); await settle();
    await msg(t.id, info); await settle();
    assert.deepStrictEqual(events, [{ type: 'problem', auto: true, problem: PROBLEM }]);
});

test('jobs: setEditorText runs page-world code in the MAIN world of the sender frame', async () => {
    const ctx = makeJobs({ fake: { onExecuteScript: () => [{ result: { ok: true, editor: 'ace' } }] } });
    const r = await ctx.jobs.handleMessage({ type: 'setEditorText', selector: '#editor', text: 'x' }, { tab: { id: 5 }, frameId: 0 });
    assert.deepStrictEqual(r, { ok: true, editor: 'ace' });
    const call = ctx.fake.calls.find(c => c[0] === 'scripting.executeScript')[1];
    assert.strictEqual(call.world, 'MAIN');
    assert.deepStrictEqual(call.target, { tabId: 5, frameIds: [0] });
    assert.strictEqual(call.func, SamekoPageWorld.setEditorText);
    assert.deepStrictEqual(call.args, ['#editor', 'x']);
});

// ── mock OJ server ──────────────────────────────────────────────────────────────────────────
test('mock OJ: login wall, submit, live verdict, duplicate rejected', async () => {
    const oj = createMockOj({ verdictDelayMs: 200 });
    const port = await oj.listen(0);
    const base = `http://127.0.0.1:${port}`;
    try {
        let html = await (await fetch(`${base}/submit/A`)).text();
        assert.ok(html.includes('Log in required') && !html.includes('submit-form'));
        const login = await fetch(`${base}/login?as=alice&next=/submit/A`, { redirect: 'manual' });
        const cookie = login.headers.get('set-cookie').split(';')[0];
        html = await (await fetch(`${base}/submit/A`, { headers: { cookie } })).text();
        assert.ok(html.includes('id="submit-form"') && html.includes('GNU G++17 9.2.0'));
        const body = new URLSearchParams({ language: '61', source: 'int main(){}' }).toString();
        const post = (b) => fetch(`${base}/submit/A`, { method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: b });
        const r = await post(body);
        assert.strictEqual(r.status, 302);
        html = await (await fetch(`${base}/status`, { headers: { cookie } })).text();
        assert.ok(/Running on test \d/.test(html));
        await sleep(250);
        const v = await (await fetch(`${base}/api/submission/1`)).json();
        assert.deepStrictEqual([v.text, v.final], ['Accepted', true]);
        const dup = await post(body);
        assert.strictEqual(dup.status, 400);
        assert.ok((await dup.text()).includes('exactly the same code'));
        html = await (await fetch(`${base}/problem/B`)).text();
        assert.ok(html.includes('Vector &lt;int&gt;'));
    } finally { await oj.close(); }
});

// ── runner ──────────────────────────────────────────────────────────────────────────────────
(async () => {
    let failed = 0;
    for (const t of tests) {
        const t0 = Date.now();
        try {
            await Promise.race([t.fn(), sleep(15000).then(() => { throw new Error('test timed out (15 s)'); })]);
            console.log(`PASS ${t.name} (${Date.now() - t0} ms)`);
        } catch (e) {
            failed++;
            console.log(`FAIL ${t.name}\n     ${(e && e.stack || String(e)).split('\n').slice(0, 6).join('\n     ')}`);
        }
    }
    console.log(`\n${tests.length - failed}/${tests.length} passed`);
    process.exit(failed ? 1 : 0);
})();
