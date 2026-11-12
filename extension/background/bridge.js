/*
 * Bridge: the extension side of PROTOCOL.md §1 — hello / pairing, the long-poll loop that
 * receives commands, and the event queue that reports back to the app.
 *
 * createBridge() takes every dependency (chrome, fetch, timers, clock), so the Node tests drive
 * it against an in-test HTTP server with a fake chrome. Classic script in the worker
 * (self.SamekoBridge), require()-able in Node.
 *
 * Connection states (chrome.storage.session `connection`, broadcast as { type: 'connection' }):
 *   disconnected  app not reachable (detail: 'unreachable' | 'protocol' | 'forbidden' | 'bad-response')
 *   unpaired      app reachable, waiting for the user to approve this extension
 *   denied        the user denied it; parked until retry() (the popup's "Try again")
 *   connected     paired, a poll is running
 */
(function (root) {
    'use strict';

    const PROTOCOL = 1;
    const DEFAULTS = {
        baseUrl: 'http://127.0.0.1:27121',
        pairIntervalMs: 2000,      // hello cadence while unpaired (§1 Pairing)
        pollWaitSec: 25,           // POST /poll { wait }
        backoffMinMs: 1000,        // app unreachable: 1 s, 2 s, 4 s … up to backoffMaxMs
        backoffMaxMs: 30000,
        protocolRetryMs: 60000,    // protocol mismatch: retry rarely (an alarm/kick also retries)
        eventRetryMs: 2000,        // failed POST /events
        requestTimeoutMs: 10000,   // hello / events
        maxQueuedEvents: 200
    };

    function createBridge(opts) {
        const chrome = opts.chrome;
        const fetchFn = opts.fetch;
        const setT = opts.setTimeout || setTimeout;
        const clearT = opts.clearTimeout || clearTimeout;
        const now = opts.now || Date.now;
        const log = opts.log || (() => {});
        const cfg = Object.assign({}, DEFAULTS, opts.config || {});
        const getAdapters = opts.getAdapters || (() => []);
        let onCommand = opts.onCommand || (() => {});

        let state = 'disconnected';
        let detail = null;
        let app = null;
        let denied = false;
        let retryNext = false;       // next hello carries retry:true (popup "Try again")
        let running = false;
        let stopped = false;
        let wakeFn = null;           // resolves the current interruptible sleep
        let backoff = cfg.backoffMinMs;
        const inflight = new Set();   // AbortControllers of running requests
        let queue = [];
        let flushing = false;
        let flushTimer = null;
        const listeners = new Set();

        const restored = restore();

        async function restore() {
            try {
                const got = await chrome.storage.session.get(['connection', 'eventQueue']);
                if (got.connection && got.connection.state === 'denied') denied = true;
                if (Array.isArray(got.eventQueue)) queue = got.eventQueue.concat(queue);
            } catch (e) { log('bridge restore', e); }
        }

        // ── state ───────────────────────────────────────────────────────────────────────
        function snapshot() {
            return { state, detail, app, at: now() };
        }

        async function setState(next, nextDetail) {
            nextDetail = nextDetail || null;
            if (next === state && nextDetail === detail) return;
            state = next;
            detail = nextDetail;
            const snap = snapshot();
            try { await chrome.storage.session.set({ connection: snap }); } catch (e) { log('state save', e); }
            try {
                const p = chrome.runtime.sendMessage({ type: 'connection', connection: snap });
                if (p && p.catch) p.catch(() => {});   // no popup open: nobody listens
            } catch (_) { /* ignore */ }
            for (const fn of listeners) { try { fn(snap); } catch (_) { /* ignore */ } }
        }

        // ── timers ──────────────────────────────────────────────────────────────────────
        /** Sleep that kick()/retry()/stop() can cut short. ms = Infinity parks until woken. */
        function sleep(ms) {
            return new Promise(resolve => {
                let t = null;
                const done = () => { if (t) clearT(t); if (wakeFn === done) wakeFn = null; resolve(); };
                wakeFn = done;
                if (Number.isFinite(ms)) t = setT(done, ms);
            });
        }

        function wake() { if (wakeFn) wakeFn(); }

        // ── HTTP ────────────────────────────────────────────────────────────────────────
        async function request(method, path, body, timeoutMs) {
            const ctl = new AbortController();
            inflight.add(ctl);
            const t = setT(() => ctl.abort(), timeoutMs || cfg.requestTimeoutMs);
            try {
                const res = await fetchFn(cfg.baseUrl + path, {
                    method,
                    headers: body ? { 'Content-Type': 'application/json' } : {},
                    body: body ? JSON.stringify(body) : undefined,
                    signal: ctl.signal,
                    cache: 'no-store'
                });
                let json = null;
                try { json = await res.json(); } catch (_) { json = null; }
                return { status: res.status, body: json || {} };
            } finally {
                clearT(t);
                inflight.delete(ctl);
            }
        }

        async function saveTheme(theme) {
            if (!theme || typeof theme !== 'object') return;
            try { await chrome.storage.local.set({ theme }); } catch (e) { log('theme save', e); }
        }

        function keepAlive() {
            // Any extension API call resets the MV3 worker's idle timer.
            try {
                const p = chrome.runtime.getPlatformInfo();
                if (p && p.catch) p.catch(() => {});
            } catch (_) { /* ignore */ }
        }

        async function backoffSleep() {
            const ms = backoff;
            backoff = Math.min(backoff * 2, cfg.backoffMaxMs);
            await sleep(ms);
        }

        // ── main loop ───────────────────────────────────────────────────────────────────
        async function hello() {
            const retry = retryNext;
            let r;
            try {
                r = await request('POST', '/sameko/v1/hello', {
                    protocol: PROTOCOL,
                    extVersion: opts.extVersion || '0.0.0',
                    browser: opts.browser || 'chrome',
                    retry,
                    adapters: getAdapters()
                });
            } catch (e) {
                if (stopped) return;
                await setState('disconnected', 'unreachable');
                await backoffSleep();
                return;
            }
            if (retry) retryNext = false;
            backoff = cfg.backoffMinMs;
            const b = r.body;
            if (r.status === 200 && b.ok === false && b.error === 'protocol') {
                log('protocol mismatch: app speaks', b.protocol);
                await setState('disconnected', 'protocol');
                await sleep(cfg.protocolRetryMs);
                return;
            }
            if (r.status === 403) {
                await setState('disconnected', 'forbidden');
                await backoffSleep();
                return;
            }
            if (r.status !== 200 || !b.ok) {
                await setState('disconnected', 'bad-response');
                await backoffSleep();
                return;
            }
            if (b.app) app = b.app;
            await saveTheme(b.theme);
            if (b.denied) {
                denied = true;
                await setState('denied');
                return;
            }
            if (!b.paired) {
                await setState('unpaired');
                await sleep(cfg.pairIntervalMs);
                return;
            }
            await setState('connected');
            flush();
        }

        async function poll() {
            let r;
            try {
                // POST, not GET: Chromium sends no Origin header on an extension's GET (PROTOCOL §1).
                r = await request('POST', '/sameko/v1/poll', { wait: cfg.pollWaitSec }, (cfg.pollWaitSec + 10) * 1000);
            } catch (e) {
                if (stopped) return;
                await setState('disconnected', 'unreachable');   // the next hello backs off
                return;
            }
            keepAlive();
            if (r.status === 401) { await setState('unpaired'); return; }
            if (r.status !== 200) {
                await setState('disconnected', r.status === 403 ? 'forbidden' : 'bad-response');
                await backoffSleep();
                return;
            }
            await saveTheme(r.body.theme);
            const commands = Array.isArray(r.body.commands) ? r.body.commands : [];
            for (const cmd of commands) {
                // Do not hold up the next poll while a tab opens.
                Promise.resolve().then(() => onCommand(cmd)).catch(e => log('command failed', cmd && cmd.type, e));
            }
            if (queue.length) flush();
        }

        async function loop() {
            if (running) return;
            running = true;
            try {
                await restored;
                while (!stopped) {
                    if (denied) {
                        await setState('denied');
                        await sleep(Infinity);         // until retry() or stop()
                        continue;
                    }
                    if (state !== 'connected') await hello();
                    else await poll();
                }
            } catch (e) {
                log('bridge loop crashed', e);
            } finally {
                running = false;
            }
        }

        // ── events ──────────────────────────────────────────────────────────────────────
        async function persistQueue() {
            try { await chrome.storage.session.set({ eventQueue: queue }); } catch (e) { log('queue save', e); }
        }

        async function postEvent(event) {
            await restored;
            queue.push(event);
            if (queue.length > cfg.maxQueuedEvents) queue.splice(0, queue.length - cfg.maxQueuedEvents);
            await persistQueue();
            flush();
        }

        async function flush() {
            if (flushing || state !== 'connected' || !queue.length || stopped) return;
            flushing = true;
            if (flushTimer) { clearT(flushTimer); flushTimer = null; }
            let retry = false;
            try {
                while (queue.length && state === 'connected' && !stopped) {
                    const batch = queue.slice(0, 50);
                    let r;
                    try {
                        r = await request('POST', '/sameko/v1/events', { events: batch });
                    } catch (e) { retry = true; break; }
                    if (r.status === 401) { await setState('unpaired'); wake(); break; }
                    if (r.status !== 200) { retry = true; break; }
                    queue.splice(0, batch.length);
                    await persistQueue();
                }
            } finally {
                flushing = false;
            }
            if (retry && !stopped) flushTimer = setT(() => { flushTimer = null; flush(); }, cfg.eventRetryMs);
        }

        // ── public ──────────────────────────────────────────────────────────────────────
        return {
            start() { stopped = false; loop(); },
            /** Retry now (alarm, OJ page load, popup opened). Does not lift a denial. */
            kick() {
                if (stopped) return;
                backoff = cfg.backoffMinMs;
                if (state !== 'connected') wake();
                loop();
            },
            /** The popup's "Try again": the next hello carries retry:true. */
            async retry() {
                await restored;
                denied = false;
                retryNext = true;
                await setState('disconnected', null);
                backoff = cfg.backoffMinMs;
                wake();
                loop();
            },
            stop() {
                stopped = true;
                for (const c of inflight) c.abort();
                if (flushTimer) { clearT(flushTimer); flushTimer = null; }
                wake();
            },
            postEvent,
            flush,
            get state() { return snapshot(); },
            get queued() { return queue.length; },
            setCommandHandler(fn) { onCommand = fn; },
            onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
        };
    }

    const SamekoBridge = { create: createBridge, PROTOCOL, DEFAULTS };
    root.SamekoBridge = SamekoBridge;
    if (typeof module !== 'undefined' && module.exports) module.exports = SamekoBridge;
})(typeof globalThis !== 'undefined' ? globalThis : this);
