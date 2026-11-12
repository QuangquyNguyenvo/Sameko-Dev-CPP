'use strict';
/*
 * A stand-in for the app's side of PROTOCOL.md §1 (hello / poll / events), for the bridge tests
 * and the browser end-to-end check. Not the app's implementation — just enough to exercise the
 * extension: origin check, pairing with approve/deny/retry, one long poller at a time, events.
 *
 *   node extension/test/stub-app.js [port] [--approve]
 * runs it standalone (default port 27121): pairing requests are approved when --approve is given,
 * and commands can be queued by POSTing a command JSON to /stub/queue.
 */
const http = require('http');

function createStubApp(options) {
    const opts = Object.assign({ autoApprove: false, theme: null, protocol: 1 }, options || {});
    const approved = new Set();
    const denied = new Set();
    const pairRequests = [];
    const events = [];
    const hellos = [];
    let queue = [];
    let poller = null;            // { res, timer, origin }
    let theme = opts.theme;
    let themeSent = null;
    let polls = 0;
    const waiters = new Set();
    const sockets = new Set();

    function json(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    }

    function notify() { for (const w of Array.from(waiters)) w(); }

    function readJson(req) {
        return new Promise((resolve) => {
            let data = '';
            req.on('data', d => { data += d; });
            req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve(null); } });
        });
    }

    function answerPoll() {
        if (!poller) return;
        const p = poller;
        poller = null;
        clearTimeout(p.timer);
        const commands = queue;
        queue = [];
        const body = { commands };
        if (theme && theme !== themeSent) { body.theme = theme; themeSent = theme; } else body.theme = null;
        json(p.res, 200, body);
    }

    async function handle(req, res) {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/stub/queue' && req.method === 'POST') {   // standalone helper
            const cmd = await readJson(req);
            api.queue(cmd);
            return json(res, 200, { ok: true });
        }
        if (!url.pathname.startsWith('/sameko/v1/')) return json(res, 404, { error: 'not-found' });
        const origin = req.headers.origin || '';
        if (process.env.STUB_APP_LOG) console.log('[stub-app]', req.method, url.pathname, JSON.stringify(origin));
        if (!/^(chrome|moz)-extension:\/\//.test(origin)) return json(res, 403, { error: 'forbidden' });

        if (url.pathname === '/sameko/v1/hello' && req.method === 'POST') {
            const body = await readJson(req);
            if (!body) return json(res, 400, { error: 'bad-json' });
            hellos.push(Object.assign({ origin }, body));
            notify();
            if (body.protocol !== opts.protocol) return json(res, 200, { ok: false, error: 'protocol', protocol: opts.protocol });
            if (body.retry) denied.delete(origin);
            if (!approved.has(origin) && !denied.has(origin)) {
                if (opts.autoApprove) approved.add(origin);
                else if (!pairRequests.some(r => r.origin === origin)) pairRequests.push({ origin, browser: body.browser, extVersion: body.extVersion });
            }
            return json(res, 200, {
                ok: true, paired: approved.has(origin), denied: denied.has(origin), protocol: opts.protocol,
                app: { name: 'Sameko Dev C++', version: '0.0.0-stub' }, theme
            });
        }
        if (url.pathname === '/sameko/v1/poll' && req.method === 'POST') {
            const pollBody = await readJson(req);
            if (!approved.has(origin)) return json(res, 401, { error: 'unpaired' });
            polls++;
            if (poller) { const old = poller; poller = null; clearTimeout(old.timer); json(old.res, 200, { commands: [], theme: null }); }
            const wait = Math.min(30, Math.max(1, +((pollBody && pollBody.wait) || 25)));
            poller = { res, origin, timer: setTimeout(() => { if (poller && poller.res === res) answerPoll(); }, wait * 1000) };
            res.on('close', () => { if (poller && poller.res === res) { clearTimeout(poller.timer); poller = null; } });
            if (queue.length) answerPoll();
            notify();
            return;
        }
        if (url.pathname === '/sameko/v1/events' && req.method === 'POST') {
            if (!approved.has(origin)) return json(res, 401, { error: 'unpaired' });
            const body = await readJson(req);
            if (!body || !Array.isArray(body.events)) return json(res, 400, { error: 'bad-json' });
            events.push(...body.events);
            notify();
            return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'not-found' });
    }

    const server = http.createServer((req, res) => { handle(req, res).catch(e => json(res, 500, { error: String(e) })); });
    server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

    const api = {
        server, events, hellos, pairRequests, approved, denied,
        get polls() { return polls; },
        get pollPending() { return !!poller; },
        listen(port) {
            return new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port || 0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
            });
        },
        close() {
            if (poller) { clearTimeout(poller.timer); poller = null; }
            for (const s of sockets) s.destroy();
            return new Promise(r => server.close(() => r()));
        },
        approve(origin) { approved.add(origin); denied.delete(origin); },
        deny(origin) { denied.add(origin); approved.delete(origin); },
        unpair(origin) { approved.delete(origin); },
        setTheme(t) { theme = t; },
        queue(cmd) { queue.push(cmd); answerPoll(); },
        /** Resolve when pred() is truthy (checked on every request), reject after timeoutMs. */
        waitFor(pred, timeoutMs, what) {
            return new Promise((resolve, reject) => {
                const check = () => {
                    let v; try { v = pred(); } catch (_) { v = null; }
                    if (v) { waiters.delete(check); clearTimeout(t); resolve(v); }
                };
                const t = setTimeout(() => { waiters.delete(check); reject(new Error(`timed out waiting for ${what || 'condition'}`)); }, timeoutMs || 5000);
                waiters.add(check);
                check();
            });
        }
    };
    return api;
}

module.exports = { createStubApp };

if (require.main === module) {
    const port = +(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 27121);
    const app = createStubApp({ autoApprove: process.argv.includes('--approve') });
    app.listen(port).then(p => {
        console.log(`Stub app on http://127.0.0.1:${p}/sameko/v1/  (autoApprove ${process.argv.includes('--approve')})`);
        console.log(`Queue a command: curl -X POST http://127.0.0.1:${p}/stub/queue -d '{"type":"fetchProblem","id":"f1"}'`);
        let seen = 0;
        setInterval(() => { while (seen < app.events.length) console.log('event', JSON.stringify(app.events[seen++])); }, 200);
    });
}
