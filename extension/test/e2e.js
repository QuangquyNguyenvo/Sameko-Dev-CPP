#!/usr/bin/env node
'use strict';
/*
 * Real-browser end-to-end check (not part of npm test): loads a dev copy of the extension into a
 * locally installed Chromium browser, against the mock OJ and the stub app server.
 *
 *   node extension/test/e2e.js [--browser <path to chrome/msedge/chromium>] [--headful]
 *
 * Flow: stub app (auto-approves pairing) → extension connects → log in to the mock OJ →
 * `submit` command → events opened … done(AC) → duplicate submit → failed(rejected) →
 * `fetchProblem` with a URL → `problem` event. Prints PASS/FAIL/SKIP lines.
 * Uses the browser's DevTools port only to open the login tab; the rest is the extension's own work.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { makeDev } = require('./make-dev.js');
const { createStubApp } = require('./stub-app.js');
const { createMockOj } = require('./mock-oj/server.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

function findBrowser() {
    const given = arg('--browser');
    if (given) return given;
    const candidates = process.platform === 'win32' ? [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Chromium/Application/chrome.exe')
    ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge'];
    return candidates.find(p => p && fs.existsSync(p)) || null;
}

async function cdpOpen(port, url) {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    return r.json();
}

function cdpEval(wsUrl, expression) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const t = setTimeout(() => { ws.close(); reject(new Error('cdp timeout')); }, 5000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
        ws.onmessage = (m) => {
            const d = JSON.parse(m.data);
            if (d.id !== 1) return;
            clearTimeout(t);
            ws.close();
            resolve(d.result && d.result.result ? d.result.result.value : null);
        };
        ws.onerror = (e) => { clearTimeout(t); reject(new Error('cdp socket error')); };
    });
}

(async () => {
    const browserPath = findBrowser();
    if (!browserPath) { console.log('SKIP e2e: no Chromium-based browser found (pass --browser)'); return; }

    const app = createStubApp({ autoApprove: true, theme: { id: 'e2e', variant: 'dark', bg: '#000000' } });
    const appPort = await app.listen(0);
    const oj = createMockOj({ verdictDelayMs: 1500 });
    const ojPort = await oj.listen(0);
    const OJ = `http://localhost:${ojPort}`;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-ext-e2e-'));
    const extDir = makeDev({ out: path.join(profile, 'ext'), appUrl: `http://127.0.0.1:${appPort}` });

    const args = [
        `--user-data-dir=${path.join(profile, 'profile')}`,
        `--load-extension=${extDir}`,
        `--disable-extensions-except=${extDir}`,
        '--remote-debugging-port=0',
        '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--disable-features=DisableLoadExtensionCommandLineSwitch',
        process.argv.includes('--headful') ? null : '--headless=new',
        'about:blank'
    ].filter(Boolean);
    const browser = spawn(browserPath, args, { stdio: 'ignore' });
    let failed = 0;
    const check = (ok, name, extra) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };

    try {
        // DevTools port (for opening the login tab).
        const portFile = path.join(profile, 'profile', 'DevToolsActivePort');
        let devPort = null;
        for (let i = 0; i < 100 && !devPort; i++) {
            if (fs.existsSync(portFile)) devPort = +fs.readFileSync(portFile, 'utf8').split('\n')[0];
            else await sleep(100);
        }
        if (!devPort) throw new Error('browser did not start (no DevToolsActivePort)');

        try {
            await app.waitFor(() => app.hellos.length > 0, 15000, 'hello');
        } catch (_) {
            console.log(`SKIP e2e: the extension did not load in ${path.basename(browserPath)} (--load-extension may be disabled in this build)`);
            return;
        }
        check(true, 'extension loaded and sent hello', `${app.hellos[0].browser} ${app.hellos[0].extVersion}, adapters: ${app.hellos[0].adapters.map(a => a.id).join(', ')}`);
        await app.waitFor(() => app.pollPending, 10000, 'poll');
        check(true, 'paired and polling');

        await cdpOpen(devPort, `${OJ}/login?as=alice&next=/problem/A`);
        await sleep(1500);

        const submit = (id, source) => app.queue({ type: 'submit', id, url: `${OJ}/problem/A`, source, language: 'cpp', std: 'c++17', fileName: 'a.cpp', autoSubmit: true });
        const states = (id) => app.events.filter(e => e.type === 'submitStatus' && e.id === id).map(e => e.state);

        submit('s1', '#include <cstdio>\nint main(){int a,b;scanf("%d%d",&a,&b);printf("%d\\n",a+b);}\n');
        try {
            await app.waitFor(() => states('s1').includes('done') || states('s1').includes('failed'), 30000, 's1 final');
        } catch (e) { /* reported below */ }
        const s1 = app.events.filter(e => e.id === 's1');
        const done = s1.find(e => e.state === 'done');
        check(done && done.verdict.code === 'AC', 'submit → done AC', JSON.stringify(states('s1')));
        check(['opened', 'filled', 'submitted', 'judging'].every(s => states('s1').includes(s)), 'submit went through opened → filled → submitted → judging');
        const sub = oj.submissions[0];
        check(sub && sub.languageText === 'GNU G++17 9.2.0 (64 bit, msys 2)', 'picked GNU G++17 9.2.0 for c++17', sub && sub.languageText);
        check(sub && sub.source.includes('scanf'), 'source arrived via the CodeMirror-like editor');
        check(done && /\/submission\/1$/.test(done.submissionUrl || ''), 'submissionUrl reported', done && done.submissionUrl);

        submit('s2', sub ? sub.source : 'x');   // identical → the judge rejects it
        try { await app.waitFor(() => states('s2').includes('failed'), 20000, 's2 failed'); } catch (_) { /* below */ }
        const f2 = app.events.find(e => e.id === 's2' && e.state === 'failed');
        check(f2 && f2.error.code === 'rejected', 'duplicate submit → failed(rejected)', f2 && f2.error.message);

        app.queue({ type: 'fetchProblem', id: 'f1', url: `${OJ}/problem/B` });
        try { await app.waitFor(() => app.events.some(e => e.requestId === 'f1'), 20000, 'f1'); } catch (_) { /* below */ }
        const p = app.events.find(e => e.requestId === 'f1');
        check(p && p.type === 'problem' && p.problem.name === 'B. Vector <int> Reverse' && p.problem.tests.length === 1 && p.problem.timeLimit === 2000 && p.problem.memoryLimit === 512,
            'fetchProblem with URL → problem', p && JSON.stringify(p).slice(0, 160));

        app.queue({ type: 'fetchProblem', id: 'f2' });
        try { await app.waitFor(() => app.events.some(e => e.requestId === 'f2'), 15000, 'f2'); } catch (_) { /* below */ }
        const p2 = app.events.find(e => e.requestId === 'f2');
        check(p2 && p2.type === 'problem' && p2.problem.name === 'A. Sum of Two', 'fetchProblem without URL → last problem tab', p2 && (p2.problem ? p2.problem.name : JSON.stringify(p2.error)));

        // The popup page, opened as a tab: connection state and recent submissions render.
        const extId = /^chrome-extension:\/\/([a-z]+)/.exec(app.hellos[0].origin)[1];
        const target = await cdpOpen(devPort, `chrome-extension://${extId}/popup/popup.html`);
        await sleep(1000);
        const popup = await cdpEval(target.webSocketDebuggerUrl, `JSON.stringify({
            state: document.querySelector('.connection').dataset.state,
            label: document.querySelector('.connection-label').textContent,
            recent: Array.from(document.querySelectorAll('.recent-item')).map(li => li.textContent.trim())
        })`);
        const pv = JSON.parse(popup || '{}');
        check(pv.state === 'connected' && pv.recent && pv.recent.length === 2 && /AC/.test(pv.recent[1]) && /Failed/.test(pv.recent[0]),
            'popup shows connected + recent submissions', popup);
    } catch (e) {
        failed++;
        console.log(`FAIL e2e: ${e && e.message}`);
    } finally {
        browser.kill();
        await sleep(500);
        await app.close();
        await oj.close();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* browser may still hold files */ }
        console.log(failed ? `\n${failed} failed` : '\nall passed');
        process.exit(failed ? 1 : 0);
    }
})();
