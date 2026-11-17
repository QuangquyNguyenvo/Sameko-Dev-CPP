#!/usr/bin/env node
'use strict';
/*
 * Real-browser end-to-end check in Firefox (not part of npm test): the Firefox build of the dev
 * copy (scripts/pack-extension.js firefoxManifest) is loaded as a temporary add-on through
 * Firefox's remote debugging protocol, against the mock OJ and the stub app server.
 *
 *   node extension/test/e2e-firefox.js --firefox <path to firefox.exe> [--headful]
 *
 * Flow: stub app (auto-approves pairing) → extension connects with a moz-extension:// origin →
 * `submit` command on the mock OJ → events opened … done(AC) → duplicate submit →
 * failed(rejected) → `fetchProblem` with a URL → `problem` event. Prints PASS/FAIL/SKIP lines.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { makeDev } = require('./make-dev.js');
const { createStubApp } = require('./stub-app.js');
const { createMockOj } = require('./mock-oj/server.js');
const { firefoxManifest } = require('../../scripts/pack-extension.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function findFirefox() {
    const given = arg('--firefox');
    if (given) return given;
    const candidates = process.platform === 'win32'
        ? ['C:/Program Files/Mozilla Firefox/firefox.exe', 'C:/Program Files (x86)/Mozilla Firefox/firefox.exe']
        : ['/usr/bin/firefox', '/usr/lib/firefox/firefox'];
    return candidates.find(p => fs.existsSync(p)) || null;
}

function freePort() {
    return new Promise((resolve) => {
        const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}

/** Minimal Firefox remote-protocol client: `<length>:<json>` packets over TCP. */
async function rdpConnect(port) {
    let sock;
    for (let i = 0; i < 100 && !sock; i++) {
        sock = await new Promise((resolve) => {
            const s = net.connect(port, '127.0.0.1', () => resolve(s));
            s.on('error', () => resolve(null));
        });
        if (!sock) await sleep(200);
    }
    if (!sock) throw new Error('Firefox did not open its debugger port');
    let buf = Buffer.alloc(0);
    const waiters = [];
    const packets = [];
    sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
            const colon = buf.indexOf(58);
            if (colon < 0) break;
            const len = +buf.slice(0, colon).toString();
            if (buf.length < colon + 1 + len) break;
            const msg = JSON.parse(buf.slice(colon + 1, colon + 1 + len).toString('utf8'));
            buf = buf.slice(colon + 1 + len);
            const w = waiters.findIndex(x => x.from === msg.from);
            if (w >= 0) waiters.splice(w, 1)[0].resolve(msg); else packets.push(msg);
        }
    });
    const next = (from) => {
        const i = packets.findIndex(p => p.from === from);
        if (i >= 0) return Promise.resolve(packets.splice(i, 1)[0]);
        return new Promise((resolve) => waiters.push({ from, resolve }));
    };
    const request = (to, body) => {
        const s = Buffer.from(JSON.stringify(Object.assign({ to }, body)), 'utf8');
        sock.write(`${s.length}:`);
        sock.write(s);
        return next(to);
    };
    await next('root');   // the greeting
    return { request, close: () => sock.destroy() };
}

(async () => {
    const firefox = findFirefox();
    if (!firefox) { console.log('SKIP e2e-firefox: no Firefox found (pass --firefox)'); return; }

    const app = createStubApp({ autoApprove: true, theme: { id: 'e2e', variant: 'dark', bg: '#000000' } });
    const appPort = await app.listen(0);
    const oj = createMockOj({ verdictDelayMs: 1500 });
    const ojPort = await oj.listen(0);
    const OJ = `http://localhost:${ojPort}`;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-ext-ff-'));
    const extDir = makeDev({ out: path.join(work, 'ext'), appUrl: `http://127.0.0.1:${appPort}` });
    const mf = path.join(extDir, 'manifest.json');
    fs.writeFileSync(mf, JSON.stringify(firefoxManifest(JSON.parse(fs.readFileSync(mf, 'utf8'))), null, 2));

    const profile = path.join(work, 'profile');
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, 'user.js'), [
        ['devtools.debugger.remote-enabled', true], ['devtools.chrome.enabled', true],
        ['devtools.debugger.prompt-connection', false], ['browser.shell.checkDefaultBrowser', false],
        ['datareporting.policy.dataSubmissionEnabled', false], ['toolkit.telemetry.reportingpolicy.firstRun', false],
        ['browser.startup.homepage_override.mstone', 'ignore'], ['browser.aboutwelcome.enabled', false],
        ['extensions.autoDisableScopes', 0], ['app.update.enabled', false],
    ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));

    const rdpPort = await freePort();
    const browser = spawn(firefox, [
        '-profile', profile, '-no-remote', '-start-debugger-server', String(rdpPort),
        process.argv.includes('--headful') ? null : '-headless',
        `${OJ}/login?as=alice&next=/problem/A`,
    ].filter(Boolean), { stdio: 'ignore' });
    let failed = 0;
    const check = (ok, name, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
    let rdp = null;

    try {
        rdp = await rdpConnect(rdpPort);
        const root = await rdp.request('root', { type: 'getRoot' });
        const installed = await rdp.request(root.addonsActor, { type: 'installTemporaryAddon', addonPath: extDir });
        check(!installed.error, 'Firefox loaded the extension as a temporary add-on', installed.error ? `${installed.error}: ${installed.message}` : installed.addon && installed.addon.id);
        if (installed.error) return;

        try {
            await app.waitFor(() => app.hellos.length > 0, 20000, 'hello');
        } catch (_) {
            check(false, 'extension sent hello to the app (no request with a moz-extension:// Origin arrived)');
            return;
        }
        const h = app.hellos[0];
        check(/^moz-extension:\/\//.test(h.origin) && h.browser === 'firefox', 'hello with a moz-extension:// origin, browser firefox',
            `${h.origin} ${h.browser} ${h.extVersion}, adapters: ${h.adapters.map(a => a.id).join(', ')}`);
        await app.waitFor(() => app.pollPending, 10000, 'poll');
        check(true, 'paired and polling');

        const submit = (id, source) => app.queue({ type: 'submit', id, url: `${OJ}/problem/A`, source, language: 'cpp', std: 'c++17', fileName: 'a.cpp', autoSubmit: true });
        const states = (id) => app.events.filter(e => e.type === 'submitStatus' && e.id === id).map(e => e.state);

        submit('s1', '#include <cstdio>\nint main(){int a,b;scanf("%d%d",&a,&b);printf("%d\\n",a+b);}\n');
        try { await app.waitFor(() => states('s1').includes('done') || states('s1').includes('failed'), 30000, 's1 final'); } catch (_) { /* below */ }
        const done = app.events.find(e => e.id === 's1' && e.state === 'done');
        const fail1 = app.events.find(e => e.id === 's1' && e.state === 'failed');
        check(done && done.verdict.code === 'AC', 'submit → done AC', JSON.stringify(states('s1')) + (fail1 ? ' ' + JSON.stringify(fail1.error) : ''));
        check(['opened', 'filled', 'submitted', 'judging'].every(s => states('s1').includes(s)), 'submit went through opened → filled → submitted → judging');
        const sub = oj.submissions[0];
        check(sub && sub.languageText === 'GNU G++17 9.2.0 (64 bit, msys 2)', 'picked GNU G++17 9.2.0 for c++17', sub && sub.languageText);
        check(sub && sub.source.includes('scanf'), 'source arrived via the page editor (MAIN world)');

        submit('s2', sub ? sub.source : 'x');
        try { await app.waitFor(() => states('s2').includes('failed'), 20000, 's2 failed'); } catch (_) { /* below */ }
        const f2 = app.events.find(e => e.id === 's2' && e.state === 'failed');
        check(f2 && f2.error.code === 'rejected', 'duplicate submit → failed(rejected)', f2 && f2.error.message);

        app.queue({ type: 'fetchProblem', id: 'f1', url: `${OJ}/problem/B` });
        try { await app.waitFor(() => app.events.some(e => e.requestId === 'f1'), 20000, 'f1'); } catch (_) { /* below */ }
        const p = app.events.find(e => e.requestId === 'f1');
        check(p && p.type === 'problem' && p.problem.name === 'B. Vector <int> Reverse' && p.problem.tests.length === 1,
            'fetchProblem with URL → problem', p && JSON.stringify(p).slice(0, 160));
    } catch (e) {
        failed++;
        console.log(`FAIL e2e-firefox: ${e && e.message}`);
    } finally {
        if (rdp) rdp.close();
        browser.kill();
        await sleep(800);
        await app.close();
        await oj.close();
        try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* Firefox may still hold files */ }
        console.log(failed ? `\n${failed} failed` : '\nall passed');
        process.exit(failed ? 1 : 0);
    }
})();
