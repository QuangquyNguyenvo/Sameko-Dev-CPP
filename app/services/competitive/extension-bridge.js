/**
 * Sameko Dev C++ IDE - Sameko Companion browser-extension bridge
 *
 * The `/sameko/v1/*` routes of the Competitive Companion listener
 * (companion-server.js). The extension long-polls for commands (submit this
 * source, fetch this problem) and posts events back (problems, submit
 * progress). Contract: extension/PROTOCOL.md.
 *
 * Free of Electron: the state folder, app info and every callback are injected,
 * so test/unit/oj-bridge.js runs it in plain Node.
 *
 * @module app/services/competitive/extension-bridge
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync } = require('../../shared/fs-atomic');

const PROTOCOL = 1;
const PREFIX = '/sameko/v1/';
const STATE_FILE = 'oj-extension.json';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_CHARS = 4 * 1024 * 1024 - 64 * 1024; // room for the rest of the command
const MAX_EVENTS = 100;
const MAX_ISSUED_IDS = 500;
const CONNECTED_GRACE_MS = 5000;
const DEFAULT_COMMAND_TTL_MS = 60 * 1000;

const ORIGIN_RE = /^(?:chrome-extension|moz-extension):\/\/[A-Za-z0-9._-]{1,128}$/;
const SUBMIT_ID_RE = /^s_\d{1,16}_\d{1,9}$/;
const FETCH_ID_RE = /^f_\d{1,16}_\d{1,9}$/;
const LANGUAGES = new Set(['cpp', 'c', 'python', 'java', 'pascal', 'rust', 'go', 'kotlin', 'csharp', 'javascript']);
const SUBMIT_STATES = new Set(['opened', 'filled', 'submitted', 'judging', 'done', 'failed']);
const VERDICT_CODES = new Set(['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE', 'PARTIAL', 'OTHER']);
const SUBMIT_ERRORS = new Set(['not-logged-in', 'unsupported-site', 'language-not-found', 'form-not-found',
    'rejected', 'timeout', 'tab-closed', 'no-extension', 'internal']);
const THEME_COLORS = ['bg', 'surface', 'border', 'text', 'textMuted', 'accent', 'accentText', 'success', 'warning', 'error'];
const CSS_COLOR_RE = /^[#(),.%\w\s/+-]{1,64}$/;

const NO_EXTENSION_SUBMIT = 'The browser extension did not pick up the submission. Check that the browser is open and the extension is connected.';
const NO_EXTENSION_FETCH = 'The browser extension did not answer. Check that the browser is open and the extension is connected.';

// ---------------------------------------------------------------- sanitising

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const httpUrl = (v) => (typeof v === 'string' && v.length <= 2000 && /^https?:\/\/[^\s]+$/i.test(v) ? v : null);

function errorObj(raw, allowed) {
    const e = raw && typeof raw === 'object' ? raw : {};
    let code = typeof e.code === 'string' ? e.code : '';
    if (allowed ? !allowed.has(code) : !/^[a-z0-9-]{1,40}$/.test(code)) code = 'internal';
    return { code, message: str(e.message, 500) };
}

function sanitizeAdapters(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 64).filter((a) => a && typeof a === 'object' && typeof a.id === 'string' && a.id).map((a) => ({
        id: a.id.slice(0, 64),
        name: str(a.name, 100),
        hosts: (Array.isArray(a.hosts) ? a.hosts : [])
            .filter((h) => typeof h === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(h)).slice(0, 32)
    }));
}

function sanitizeTheme(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const t = {
        id: str(raw.id, 64),
        variant: raw.variant === 'light' ? 'light' : 'dark'
    };
    for (const key of THEME_COLORS) {
        if (typeof raw[key] === 'string' && CSS_COLOR_RE.test(raw[key])) t[key] = raw[key];
    }
    return t;
}

function sanitizeSubmitStatus(ev) {
    if (typeof ev.id !== 'string' || !SUBMIT_ID_RE.test(ev.id) || !SUBMIT_STATES.has(ev.state)) return null;
    const out = { type: 'submitStatus', id: ev.id, state: ev.state };
    const message = optStr(ev.message, 500);
    if (message !== undefined) out.message = message;
    const submissionUrl = httpUrl(ev.submissionUrl);
    if (submissionUrl) out.submissionUrl = submissionUrl;
    if (ev.state === 'done') {
        const v = ev.verdict && typeof ev.verdict === 'object' ? ev.verdict : {};
        const test = num(v.test);
        out.verdict = {
            code: VERDICT_CODES.has(v.code) ? v.code : 'OTHER',
            text: str(v.text, 500),
            test: test === null ? null : Math.floor(test),
            timeMs: num(v.timeMs),
            memoryKb: num(v.memoryKb),
            points: typeof v.points === 'number' && Number.isFinite(v.points) ? v.points : null
        };
    }
    if (ev.state === 'failed') out.error = errorObj(ev.error, SUBMIT_ERRORS);
    return out;
}

// ---------------------------------------------------------------- HTTP helpers

function sendJson(res, status, body) {
    if (res.writableEnded || res.destroyed) return;
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
}

/** Read a JSON body (≤ 4 MiB). Calls back with the value, or answers the error itself. */
function readJson(req, res, cb) {
    const chunks = [];
    let received = 0;
    let rejected = false;
    req.on('data', (chunk) => {
        if (rejected) return;
        received += chunk.length;
        if (received > MAX_BODY_BYTES) {
            rejected = true;
            sendJson(res, 413, { error: 'too-large' });
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (rejected) return;
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {
            sendJson(res, 400, { error: 'bad-json' });
            return;
        }
        cb(value);
    });
    req.on('error', () => { });
}

// ---------------------------------------------------------------- the bridge

/**
 * @param {object} opts
 * @param {string} opts.stateDir                 folder holding oj-extension.json (userData/state)
 * @param {{name:string, version:string}} [opts.appInfo]
 * @param {number} [opts.commandTtlMs=60000]     how long a command waits for a poll
 * @param {number} [opts.connectedGraceMs=5000]  still "connected" this long after a poll ends
 * @param {number} [opts.pollUnitMs=1000]        length of one `wait` unit (tests shorten it)
 * @param {(problem:object)=>object|null} opts.sanitizeProblem
 * @param {(problem:object)=>void} [opts.onProblem]       problem plus via/auto/requestId
 * @param {()=>void} [opts.onFocusWindow]                 for problems not sent with auto:true
 * @param {(ev:object)=>void} [opts.onSubmitStatus]
 * @param {(ev:object)=>void} [opts.onFetchFailed]
 * @param {(req:{origin,browser,extVersion})=>void} [opts.onPairRequest]
 * @param {(status:object)=>void} [opts.onStatusChange]
 */
function createBridge(opts) {
    const o = opts || {};
    const commandTtlMs = o.commandTtlMs > 0 ? o.commandTtlMs : DEFAULT_COMMAND_TTL_MS;
    const graceMs = o.connectedGraceMs > 0 ? o.connectedGraceMs : CONNECTED_GRACE_MS;
    const pollUnitMs = o.pollUnitMs > 0 ? o.pollUnitMs : 1000;
    const appInfo = { name: str(o.appInfo && o.appInfo.name, 100) || 'Sameko Dev C++', version: str(o.appInfo && o.appInfo.version, 40) };
    const call = (fn, ...args) => { if (typeof fn === 'function') { try { fn(...args); } catch (e) { console.error('[OJ] Callback failed:', e.message); } } };

    let approved = null;               // Set<string>, loaded on first use
    const denied = new Set();          // this run only
    const pendingPairs = new Set();    // origins the user was asked about
    const extensions = new Map();      // origin -> { browser, extVersion, adapters }
    let activeOrigin = null;           // last origin that said hello / polled
    let running = false;
    let seq = 0;

    let queue = [];                    // [{ cmd, timer }]
    const issued = new Set();          // ids handed out this run (bounded)
    let poll = null;                   // { res, origin, timer }
    let lastPollEnd = 0;
    let graceTimer = null;

    let theme = null;
    let themeVersion = 0;
    const themeSeen = new Map();       // origin -> themeVersion delivered

    let lastStatusJson = '';

    // ---- persistence
    const stateFile = () => path.join(o.stateDir, STATE_FILE);
    function loadApproved() {
        if (approved) return approved;
        approved = new Set();
        try {
            const data = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
            for (const origin of (data && Array.isArray(data.approved) ? data.approved : [])) {
                if (typeof origin === 'string' && ORIGIN_RE.test(origin)) approved.add(origin);
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.error('[OJ] Failed to read approved extensions:', e.message);
        }
        return approved;
    }
    function saveApproved() {
        try {
            fs.mkdirSync(o.stateDir, { recursive: true });
            writeFileAtomicSync(stateFile(), JSON.stringify({ approved: [...loadApproved()] }), 'utf8');
        } catch (e) {
            console.error('[OJ] Failed to save approved extensions:', e.message);
        }
    }
    const isPaired = (origin) => loadApproved().has(origin);

    // ---- status
    function isConnected() {
        return !!poll || (lastPollEnd > 0 && Date.now() - lastPollEnd < graceMs);
    }
    function getStatus() {
        const ext = activeOrigin ? extensions.get(activeOrigin) : null;
        return {
            running,
            connected: running && isConnected(),
            paired: activeOrigin ? isPaired(activeOrigin) : loadApproved().size > 0,
            browser: ext ? ext.browser : '',
            extVersion: ext ? ext.extVersion : '',
            adapters: ext ? ext.adapters : [],
            pendingPair: pendingPairInfo()
        };
    }
    /** The pairing prompt still unanswered (the newest), or null. */
    function pendingPairInfo() {
        let last = null;
        for (const origin of pendingPairs) last = origin;
        if (!last) return null;
        const ext = extensions.get(last);
        return { origin: last, browser: ext ? ext.browser : '', extVersion: ext ? ext.extVersion : '' };
    }
    function refreshStatus() {
        const status = getStatus();
        const json = JSON.stringify(status);
        if (json === lastStatusJson) return;
        lastStatusJson = json;
        call(o.onStatusChange, status);
    }
    function pollEnded() {
        lastPollEnd = Date.now();
        clearTimeout(graceTimer);
        graceTimer = setTimeout(refreshStatus, graceMs + 10);
        if (graceTimer.unref) graceTimer.unref();
    }

    // ---- commands
    function rememberId(id) {
        issued.add(id);
        if (issued.size > MAX_ISSUED_IDS) issued.delete(issued.values().next().value);
    }
    function expire(entry) {
        queue = queue.filter((e) => e !== entry);
        const { cmd } = entry;
        if (cmd.type === 'submit') {
            call(o.onSubmitStatus, { type: 'submitStatus', id: cmd.id, state: 'failed', error: { code: 'no-extension', message: NO_EXTENSION_SUBMIT } });
        } else {
            call(o.onFetchFailed, { type: 'fetchFailed', requestId: cmd.id, error: { code: 'no-extension', message: NO_EXTENSION_FETCH } });
        }
    }
    function enqueue(cmd) {
        rememberId(cmd.id);
        const entry = { cmd, timer: null };
        entry.timer = setTimeout(() => expire(entry), commandTtlMs);
        if (entry.timer.unref) entry.timer.unref();
        queue.push(entry);
        if (poll) answerPoll();
    }
    function takeCommands() {
        const cmds = queue.map((e) => { clearTimeout(e.timer); return e.cmd; });
        queue = [];
        return cmds;
    }
    function nextId(prefix) { return `${prefix}_${Date.now()}_${++seq}`; }

    function submit(job) {
        const j = job && typeof job === 'object' ? job : {};
        const fail = (message) => ({ success: false, error: { code: 'internal', message } });
        const url = httpUrl(j.url);
        if (!url) return fail('The problem has no online judge URL.');
        if (typeof j.source !== 'string' || !j.source.trim()) return fail('There is no source code to submit.');
        if (j.source.length > MAX_SOURCE_CHARS) return fail('The source code is too large to submit.');
        if (!LANGUAGES.has(j.language)) return fail('This language cannot be submitted.');
        if (!running) return { success: false, error: { code: 'no-extension', message: NO_EXTENSION_SUBMIT } };
        const cmd = { type: 'submit', id: nextId('s'), url, source: j.source, language: j.language };
        if ((j.language === 'cpp' || j.language === 'c') && typeof j.std === 'string' && /^[A-Za-z0-9+]{1,16}$/.test(j.std)) cmd.std = j.std;
        cmd.fileName = str(j.fileName, 255);
        cmd.autoSubmit = j.autoSubmit === true;
        enqueue(cmd);
        return { success: true, id: cmd.id };
    }

    function fetchProblem(req) {
        const r = req && typeof req === 'object' ? req : {};
        if (!running) return { success: false, error: { code: 'no-extension', message: NO_EXTENSION_FETCH } };
        const cmd = { type: 'fetchProblem', id: nextId('f'), url: httpUrl(r.url) };
        enqueue(cmd);
        return { success: true, id: cmd.id };
    }

    // ---- theme
    function setTheme(t) {
        const next = sanitizeTheme(t);
        if (JSON.stringify(next) === JSON.stringify(theme)) return { success: true };
        theme = next;
        themeVersion++;
        // Let a waiting poll carry it now rather than at its timeout.
        if (poll) answerPoll();
        return { success: true };
    }
    function themeFor(origin) {
        if ((themeSeen.get(origin) || 0) === themeVersion) return null;
        themeSeen.set(origin, themeVersion);
        return theme;
    }

    // ---- pairing
    function respondPair(r) {
        const origin = r && typeof r.origin === 'string' ? r.origin : '';
        if (!ORIGIN_RE.test(origin)) return { success: false, error: 'Invalid origin' };
        pendingPairs.delete(origin);
        if (r.allow === true) {
            denied.delete(origin);
            loadApproved().add(origin);
            saveApproved();
        } else {
            denied.add(origin);
            if (loadApproved().delete(origin)) saveApproved();
        }
        refreshStatus();
        return { success: true };
    }

    // ---- routes
    function hello(req, res, origin) {
        readJson(req, res, (body) => {
            const b = body && typeof body === 'object' ? body : {};
            if (b.protocol !== PROTOCOL) {
                sendJson(res, 200, { ok: false, error: 'protocol', protocol: PROTOCOL });
                return;
            }
            const ext = { browser: str(b.browser, 32), extVersion: str(b.extVersion, 32), adapters: sanitizeAdapters(b.adapters) };
            extensions.set(origin, ext);
            activeOrigin = origin;
            const paired = isPaired(origin);
            // "Try again" in the popup: forget this run's denial and ask again.
            if (b.retry === true && !paired) denied.delete(origin);
            const isDenied = !paired && denied.has(origin);
            if (!paired && !isDenied && !pendingPairs.has(origin)) {
                pendingPairs.add(origin);
                call(o.onPairRequest, { origin, browser: ext.browser, extVersion: ext.extVersion });
            }
            themeSeen.set(origin, themeVersion);
            sendJson(res, 200, { ok: true, paired, denied: isDenied, protocol: PROTOCOL, app: appInfo, theme });
            refreshStatus();
        });
    }

    function answerPoll(commands) {
        if (!poll) return;
        const p = poll;
        poll = null;
        clearTimeout(p.timer);
        sendJson(p.res, 200, { commands: commands || takeCommands(), theme: themeFor(p.origin) });
        pollEnded();
        refreshStatus();
    }

    /** POST /poll with `{ wait }` (Chromium sends no Origin on an extension's GET). */
    function pollRoute(req, res, origin) {
        if (!isPaired(origin)) {
            sendJson(res, 401, { error: 'unpaired' });
            req.resume();
            return;
        }
        // An empty or invalid body is the default wait, not an error.
        const chunks = [];
        let received = 0;
        req.on('data', (chunk) => {
            received += chunk.length;
            if (received <= 4096) chunks.push(chunk);
        });
        req.on('end', () => {
            let wait;
            try { wait = JSON.parse(Buffer.concat(chunks).toString('utf8')).wait; } catch (_) { wait = undefined; }
            startPoll(req, res, origin, wait);
        });
        req.on('error', () => { });
    }

    function startPoll(req, res, origin, rawWait) {
        if (!isPaired(origin)) { sendJson(res, 401, { error: 'unpaired' }); return; }
        activeOrigin = origin;
        if (poll) {
            // One poller at a time: the older one returns at once, empty.
            const old = poll;
            poll = null;
            clearTimeout(old.timer);
            sendJson(old.res, 200, { commands: [] });
        }
        if (queue.length) {
            sendJson(res, 200, { commands: takeCommands(), theme: themeFor(origin) });
            pollEnded();
            refreshStatus();
            return;
        }
        let wait = typeof rawWait === 'number' ? Math.floor(rawWait) : parseInt(rawWait, 10);
        if (!Number.isFinite(wait)) wait = 25;
        wait = Math.min(30, Math.max(1, wait));
        const p = { res, origin, timer: null };
        p.timer = setTimeout(() => { if (poll === p) answerPoll([]); }, wait * pollUnitMs);
        poll = p;
        res.on('close', () => {
            if (poll !== p) return;
            // The extension went away mid-poll.
            poll = null;
            clearTimeout(p.timer);
            pollEnded();
            refreshStatus();
        });
        refreshStatus();
    }

    function events(req, res, origin) {
        if (!isPaired(origin)) {
            sendJson(res, 401, { error: 'unpaired' });
            req.resume();
            return;
        }
        readJson(req, res, (body) => {
            const list = body && Array.isArray(body.events) ? body.events : null;
            if (!list) { sendJson(res, 400, { error: 'bad-request' }); return; }
            for (const ev of list.slice(0, MAX_EVENTS)) {
                if (!ev || typeof ev !== 'object') continue;
                try { handleEvent(ev); } catch (e) { console.error('[OJ] Event failed:', e.message); }
            }
            sendJson(res, 200, { ok: true });
        });
    }

    function handleEvent(ev) {
        if (ev.type === 'problem') {
            const problem = o.sanitizeProblem ? o.sanitizeProblem(ev.problem) : null;
            if (!problem) return;
            const auto = ev.auto === true;
            const out = { ...problem, via: 'sameko', auto };
            if (typeof ev.requestId === 'string' && FETCH_ID_RE.test(ev.requestId) && issued.has(ev.requestId)) out.requestId = ev.requestId;
            call(o.onProblem, out);
            if (!auto) call(o.onFocusWindow);
        } else if (ev.type === 'fetchFailed') {
            if (typeof ev.requestId !== 'string' || !issued.has(ev.requestId) || !FETCH_ID_RE.test(ev.requestId)) return;
            call(o.onFetchFailed, { type: 'fetchFailed', requestId: ev.requestId, error: errorObj(ev.error) });
        } else if (ev.type === 'submitStatus') {
            const out = sanitizeSubmitStatus(ev);
            if (out && issued.has(out.id)) call(o.onSubmitStatus, out);
        }
        // Unknown event types are ignored.
    }

    /**
     * Answer a request if its path is under /sameko/v1/. Returns false (and
     * leaves the request alone) otherwise.
     */
    function handle(req, res) {
        let url;
        try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch (_) { return false; }
        if (!url.pathname.startsWith(PREFIX)) return false;
        const origin = String(req.headers.origin || '');
        if (!ORIGIN_RE.test(origin)) {
            sendJson(res, 403, { error: 'forbidden' });
            req.resume();
            return true;
        }
        const route = url.pathname.slice(PREFIX.length);
        if (route === 'hello' && req.method === 'POST') hello(req, res, origin);
        else if (route === 'poll' && req.method === 'POST') pollRoute(req, res, origin);
        else if (route === 'events' && req.method === 'POST') events(req, res, origin);
        else {
            const known = route === 'hello' || route === 'poll' || route === 'events';
            sendJson(res, known ? 405 : 404, { error: known ? 'method' : 'not-found' });
            req.resume();
        }
        return true;
    }

    function setRunning(value) {
        running = !!value;
        if (!running) releasePolls();
        refreshStatus();
    }

    /** Answer a waiting poll with no commands (server stopping). */
    function releasePolls() {
        if (!poll) return;
        const p = poll;
        poll = null;
        clearTimeout(p.timer);
        sendJson(p.res, 200, { commands: [] });
        pollEnded();
    }

    /** Stop every timer; queued commands are dropped without a report. */
    function dispose() {
        releasePolls();
        for (const e of queue) clearTimeout(e.timer);
        queue = [];
        clearTimeout(graceTimer);
        running = false;
    }

    return {
        handle,
        getStatus,
        submit,
        fetchProblem,
        respondPair,
        setTheme,
        setRunning,
        releasePolls,
        dispose,
    };
}

module.exports = { createBridge, PROTOCOL, PREFIX, STATE_FILE };
