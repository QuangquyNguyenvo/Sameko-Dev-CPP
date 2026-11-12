/*
 * Jobs: the submit and fetchProblem state machines (PROTOCOL.md §6 "Submit job"), tab tracking,
 * and the worker side of every content-script / popup message about problems and submissions.
 *
 * createJobs() takes its dependencies (chrome, adapters registry, emit, clock, timers) so the
 * Node tests drive it with a fake chrome. Classic script in the worker (self.SamekoJobs),
 * require()-able in Node.
 *
 * chrome.storage.session (survives a worker restart, cleared when the browser closes):
 *   jobTabs     { [tabId]: { job, adapterId, stage: 'fill'|'watch', startedAt, filled, judging, lastMessage, submissionUrl } }
 *   submitTabs  { [adapterId]: tabId }            the tab reused for that judge's next submit
 *   fetchTabs   { [tabId]: { requestId, url, startedAt } }   inactive tabs opened by fetchProblem
 *   tabSeen     { [tabId]: { url, kind, adapterId, at } }    for "the problem tab the user looked at last"
 *   autoSent    [url]                             auto-send de-duplication
 * chrome.storage.local:
 *   settings    { autoSendProblems, autoSubmit, submitInBackground }
 *   recent      the last 10 submissions, newest first
 */
(function (root) {
    'use strict';

    const DEFAULT_SETTINGS = Object.freeze({
        autoSendProblems: false,    // send a problem to the app when its page loads (auto:true)
        autoSubmit: true,           // off: every submit only fills the form, whatever the app asked
        submitInBackground: false   // open/reuse the submit tab without focusing it
    });

    const LIMITS = { fillMs: 60 * 1000, doneMs: 10 * 60 * 1000, fetchMs: 30 * 1000 };
    const RECENT_MAX = 10;

    function err(code, message) { return { code, message }; }

    function hostOf(url) {
        try { return new URL(url).hostname; } catch (_) { return String(url || ''); }
    }

    function sameUrl(a, b) {
        const n = (u) => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch (_) { return String(u || ''); } };
        return n(a) === n(b);
    }

    function createJobs(opts) {
        const chrome = opts.chrome;
        const A = opts.adapters;
        const emit = opts.emit;
        const now = opts.now || Date.now;
        const setT = opts.setTimeout || setTimeout;
        const log = opts.log || (() => {});
        const limits = Object.assign({}, LIMITS, opts.limits || {});
        const isConnected = opts.isConnected || (() => true);
        const contentFiles = opts.contentFiles || [];
        const pageWorld = opts.pageWorld || null;
        const S = chrome.storage.session;
        const L = chrome.storage.local;

        // Every state change runs through this queue, so storage read-modify-write never races
        // (e.g. a content script's whoami waits until the job opening its tab is recorded).
        let lock = Promise.resolve();
        function serial(fn) {
            const p = lock.then(fn);
            lock = p.catch(() => {});
            return p;
        }

        async function load(key, def) {
            const got = await S.get(key);
            return got[key] == null ? def : got[key];
        }
        async function save(key, value) { await S.set({ [key]: value }); }

        async function getSettings() {
            const got = await L.get('settings');
            return Object.assign({}, DEFAULT_SETTINGS, got.settings || {});
        }

        async function setSetting(key, value) {
            if (!(key in DEFAULT_SETTINGS)) return getSettings();
            const s = await getSettings();
            s[key] = !!value;
            await L.set({ settings: s });
            return s;
        }

        // ── events to the app ───────────────────────────────────────────────────────────
        async function status(job, state, extra) {
            const ev = Object.assign({ type: 'submitStatus', id: job.id, state }, extra || {});
            try { await emit(ev); } catch (e) { log('emit', e); }
            await remember(job, ev);
            return ev;
        }

        async function remember(job, ev) {
            try {
                const got = await L.get('recent');
                const recent = Array.isArray(got.recent) ? got.recent : [];
                let item = recent.find(r => r.id === job.id);
                if (!item) {
                    item = { id: job.id, url: job.url, language: job.language, std: job.std || null, startedAt: now() };
                    recent.unshift(item);
                }
                item.state = ev.state;
                item.updatedAt = now();
                if (ev.message) item.message = ev.message;
                if (ev.submissionUrl) item.submissionUrl = ev.submissionUrl;
                if (ev.verdict) item.verdict = ev.verdict;
                if (ev.error) item.error = ev.error;
                await L.set({ recent: recent.slice(0, RECENT_MAX) });
            } catch (e) { log('recent', e); }
        }

        async function fetchFailed(requestId, code, message) {
            try { await emit({ type: 'fetchFailed', requestId, error: err(code, message) }); } catch (e) { log('emit', e); }
        }

        async function sendProblem(problem, extra, tabId) {
            try { await emit(Object.assign({ type: 'problem' }, extra, { problem })); } catch (e) { log('emit', e); }
            if (tabId != null) notifyTab(tabId, isConnected() ? 'sent' : 'offline');
        }

        /** Feedback on the judge page itself: a toast in the tab and a mark on the toolbar icon. */
        function notifyTab(tabId, kind) {
            try {
                Promise.resolve(chrome.tabs.sendMessage(tabId, { type: 'toast', kind })).catch(() => {});
                if (chrome.action && chrome.action.setBadgeText) {
                    const ok = kind === 'sent';
                    Promise.resolve(chrome.action.setBadgeBackgroundColor({ tabId, color: ok ? '#3f9a6a' : '#d6496b' })).catch(() => {});
                    Promise.resolve(chrome.action.setBadgeText({ tabId, text: ok ? '\u2713' : '!' })).catch(() => {});
                }
            } catch (e) { log('notifyTab', e); }
        }

        function schedule(ms) {
            try { setT(() => { checkTimeouts().catch(e => log('timeouts', e)); }, ms + 50); } catch (_) { /* ignore */ }
        }

        // ── problems from tabs ──────────────────────────────────────────────────────────
        /** Ask the content script in a tab to parse its problem; inject it first if it is missing. */
        async function problemFromTab(tabId) {
            const ask = () => chrome.tabs.sendMessage(tabId, { type: 'getProblem' });
            let r;
            try {
                r = await ask();
            } catch (e) {
                if (!contentFiles.length) return { problem: null, error: String(e && e.message || e) };
                try {
                    await chrome.scripting.executeScript({ target: { tabId }, files: contentFiles });
                    r = await ask();
                } catch (e2) {
                    return { problem: null, error: String(e2 && e2.message || e2) };
                }
            }
            return { problem: (r && r.problem) || null, error: (r && r.error) || null };
        }

        async function lastProblemTab() {
            const seen = await load('tabSeen', {});
            const fetchTabs = await load('fetchTabs', {});
            const jobTabs = await load('jobTabs', {});
            const tabs = await chrome.tabs.query({});
            const candidates = tabs.filter(t => t.url && !fetchTabs[t.id] && !jobTabs[t.id] &&
                A.classifyUrl(t.url) === 'problem');
            if (!candidates.length) return null;
            const score = t => Math.max((seen[t.id] && seen[t.id].at) || 0, t.lastAccessed || 0);
            candidates.sort((a, b) => (score(b) - score(a)) || ((b.active ? 1 : 0) - (a.active ? 1 : 0)));
            return candidates[0];
        }

        // ── commands from the app ───────────────────────────────────────────────────────
        function handleCommand(cmd) {
            if (!cmd || typeof cmd !== 'object') return Promise.resolve();
            if (cmd.type === 'submit') return serial(() => startSubmit(cmd));
            if (cmd.type === 'fetchProblem') return serial(() => startFetch(cmd));
            log('unknown command', cmd.type);
            return Promise.resolve();
        }

        async function startSubmit(cmd) {
            const settings = await getSettings();
            const job = {
                id: String(cmd.id || ''),
                url: String(cmd.url || ''),
                source: String(cmd.source || ''),
                language: String(cmd.language || 'cpp'),
                std: cmd.std || null,
                fileName: cmd.fileName || null,
                autoSubmit: cmd.autoSubmit !== false && settings.autoSubmit !== false
            };
            const adapter = A.byUrl(job.url);
            if (!adapter) {
                return status(job, 'failed', { error: err('unsupported-site', `Sameko Companion cannot submit to ${hostOf(job.url)}.`) });
            }
            let target = null;
            try { target = adapter.submitUrl(job.url); } catch (e) { log('submitUrl', e); }
            if (!target) {
                return status(job, 'failed', { error: err('unsupported-site', `${adapter.name} submitting is not supported for this URL.`) });
            }

            const jobTabs = await load('jobTabs', {});
            const submitTabs = await load('submitTabs', {});
            const fetchTabs = await load('fetchTabs', {});
            const active = !settings.submitInBackground;
            const record = { job, adapterId: adapter.id, stage: 'fill', startedAt: now(), filled: false, judging: false, lastMessage: null, submissionUrl: null };

            // Reuse this judge's previous submit tab when it is still open and idle.
            let tabId = submitTabs[adapter.id];
            let tab = null;
            if (tabId != null && !jobTabs[tabId] && !fetchTabs[tabId]) {
                try { tab = await chrome.tabs.get(tabId); } catch (_) { tab = null; }
            }
            try {
                if (tab) {
                    jobTabs[tab.id] = record;          // recorded before the navigation starts
                    await save('jobTabs', jobTabs);
                    tab = await chrome.tabs.update(tab.id, { url: target, active });
                } else {
                    tab = await chrome.tabs.create({ url: target, active });
                    jobTabs[tab.id] = record;
                    await save('jobTabs', jobTabs);
                }
            } catch (e) {
                if (tab && jobTabs[tab.id] === record) { delete jobTabs[tab.id]; await save('jobTabs', jobTabs); }
                return status(job, 'failed', { error: err('internal', `Could not open the submit page: ${e && e.message || e}`) });
            }
            if (active && tab.windowId != null && chrome.windows && chrome.windows.update) {
                chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
            }
            submitTabs[adapter.id] = tab.id;
            await save('submitTabs', submitTabs);
            schedule(limits.fillMs);
            return status(job, 'opened');
        }

        async function startFetch(cmd) {
            const requestId = String(cmd.id || '');
            if (cmd.url) {
                const adapter = A.byUrl(cmd.url);
                if (!adapter) return fetchFailed(requestId, 'unsupported-site', `Sameko Companion cannot read problems from ${hostOf(cmd.url)}.`);
                // Already open in a tab? Read it there.
                const tabs = await chrome.tabs.query({});
                const open = tabs.find(t => t.url && sameUrl(t.url, cmd.url));
                if (open) {
                    const r = await problemFromTab(open.id);
                    if (r.problem) return sendProblem(r.problem, { requestId, auto: false }, open.id);
                }
                let tab;
                try {
                    tab = await chrome.tabs.create({ url: cmd.url, active: false });
                } catch (e) {
                    return fetchFailed(requestId, 'internal', `Could not open ${cmd.url}: ${e && e.message || e}`);
                }
                const fetchTabs = await load('fetchTabs', {});
                fetchTabs[tab.id] = { requestId, url: cmd.url, startedAt: now() };
                await save('fetchTabs', fetchTabs);
                schedule(limits.fetchMs);
                return;   // finished by the tab's pageInfo (fulfilFetch)
            }
            const tab = await lastProblemTab();
            if (!tab) return fetchFailed(requestId, 'no-problem-tab', 'No online judge problem is open in the browser.');
            const r = await problemFromTab(tab.id);
            if (!r.problem) return fetchFailed(requestId, 'parse-failed', `Could not read the problem on ${tab.url}${r.error ? `: ${r.error}` : '.'}`);
            return sendProblem(r.problem, { requestId, auto: false }, tab.id);
        }

        async function fulfilFetch(tabId) {
            const fetchTabs = await load('fetchTabs', {});
            const f = fetchTabs[tabId];
            if (!f) return;
            delete fetchTabs[tabId];
            await save('fetchTabs', fetchTabs);
            const r = await problemFromTab(tabId);
            if (r.problem) await sendProblem(r.problem, { requestId: f.requestId, auto: false });
            else await fetchFailed(f.requestId, 'parse-failed', `Could not read the problem on ${f.url}${r.error ? `: ${r.error}` : '.'}`);
            chrome.tabs.remove(tabId).catch(() => {});
        }

        async function autoSend(tabId, url) {
            const settings = await getSettings();
            if (!settings.autoSendProblems) return;
            const sent = await load('autoSent', []);
            const key = url.replace(/#.*$/, '');
            if (sent.includes(key)) return;
            const r = await problemFromTab(tabId);
            if (!r.problem) return;
            sent.push(key);
            await save('autoSent', sent.slice(-500));
            await sendProblem(r.problem, { auto: true }, tabId);
        }

        /** The popup's "Send this problem to the app". */
        async function sendActiveTab() {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (!tab || !tab.url) return { ok: false, error: err('no-problem-tab', 'No tab is active.') };
            if (A.classifyUrl(tab.url) !== 'problem') return { ok: false, error: err('no-problem-tab', 'This tab is not an online judge problem page.') };
            const r = await problemFromTab(tab.id);
            if (!r.problem) return { ok: false, error: err('parse-failed', r.error || 'Could not read the problem on this page.') };
            await sendProblem(r.problem, { auto: false }, tab.id);
            return { ok: true, name: r.problem.name || null };
        }

        // ── messages from content scripts ───────────────────────────────────────────────
        /** Returns a promise of the response. Unknown types resolve to undefined. */
        function handleMessage(msg, sender) {
            if (!msg || typeof msg !== 'object') return Promise.resolve(undefined);
            const tabId = sender && sender.tab ? sender.tab.id : null;
            switch (msg.type) {
                case 'whoami': return serial(() => whoami(tabId));
                case 'pageInfo': return serial(() => pageInfo(tabId, msg, sender));
                case 'submitted': return serial(() => onSubmitted(tabId, msg));
                case 'filled': return serial(() => onFilled(tabId, msg));
                case 'verdict': return serial(() => onVerdict(tabId, msg));
                case 'failed': return serial(() => onFailed(tabId, msg));
                case 'setEditorText': return setEditorText(sender, msg);
                default: return Promise.resolve(undefined);
            }
        }

        async function jobFor(tabId, id) {
            const jobTabs = await load('jobTabs', {});
            const rec = tabId == null ? null : jobTabs[tabId];
            if (!rec || (id != null && rec.job.id !== id)) return { jobTabs, rec: null };
            return { jobTabs, rec };
        }

        async function whoami(tabId) {
            const { rec } = await jobFor(tabId, null);
            if (!rec) return { job: null };
            // submittedAt lets readVerdict ignore rows older than this submission.
            const job = rec.submittedAt ? Object.assign({}, rec.job, { submittedAt: rec.submittedAt }) : rec.job;
            return { job, stage: rec.stage, adapterId: rec.adapterId };
        }

        async function pageInfo(tabId, msg, sender) {
            if (tabId == null) return {};
            const seen = await load('tabSeen', {});
            const prev = seen[tabId] || {};
            seen[tabId] = {
                url: String(msg.url || ''), kind: msg.kind || 'other', adapterId: msg.adapterId || null,
                at: sender.tab.active ? now() : (prev.at || 0)
            };
            await save('tabSeen', seen);
            const fetchTabs = await load('fetchTabs', {});
            if (fetchTabs[tabId]) {
                if (msg.kind === 'problem') serial(() => fulfilFetch(tabId)).catch(e => log('fetch', e));
                return {};
            }
            const jobTabs = await load('jobTabs', {});
            if (msg.kind === 'problem' && msg.hasProblem && !jobTabs[tabId]) {
                serial(() => autoSend(tabId, String(msg.url || ''))).catch(e => log('autoSend', e));
            }
            return {};
        }

        async function onSubmitted(tabId, msg) {
            const { jobTabs, rec } = await jobFor(tabId, msg.id);
            if (!rec) return { ok: false };
            if (!rec.filled) { rec.filled = true; await status(rec.job, 'filled'); }
            rec.stage = 'watch';
            rec.submittedAt = now();
            await save('jobTabs', jobTabs);
            await status(rec.job, 'submitted');
            schedule(limits.doneMs - (now() - rec.startedAt));
            return { ok: true };
        }

        async function onFilled(tabId, msg) {
            const { jobTabs, rec } = await jobFor(tabId, msg.id);
            if (!rec) return { ok: false };
            delete jobTabs[tabId];                 // autoSubmit false: filled is terminal
            await save('jobTabs', jobTabs);
            await status(rec.job, 'filled');
            return { ok: true };
        }

        async function onVerdict(tabId, msg) {
            const { jobTabs, rec } = await jobFor(tabId, msg.id);
            const r = msg.result;
            if (!rec || !r) return { ok: false };
            if (r.submissionUrl) rec.submissionUrl = String(r.submissionUrl);
            const extra = rec.submissionUrl ? { submissionUrl: rec.submissionUrl } : {};
            if (r.final) {
                delete jobTabs[tabId];
                await save('jobTabs', jobTabs);
                const code = A.VERDICT_CODES.includes(r.code) ? r.code : A.normalizeVerdict(r.text);
                await status(rec.job, 'done', Object.assign(extra, {
                    verdict: {
                        code,
                        text: r.text == null ? null : String(r.text),
                        test: r.test == null ? null : r.test,
                        timeMs: r.timeMs == null ? null : r.timeMs,
                        memoryKb: r.memoryKb == null ? null : r.memoryKb,
                        points: r.points == null ? null : r.points
                    }
                }));
                return { ok: true, done: true };
            }
            const message = r.text == null ? null : String(r.text);
            if (!rec.judging || message !== rec.lastMessage) {
                rec.judging = true;
                rec.lastMessage = message;
                await save('jobTabs', jobTabs);
                await status(rec.job, 'judging', Object.assign(extra, message ? { message } : {}));
            } else {
                await save('jobTabs', jobTabs);
            }
            return { ok: true };
        }

        async function onFailed(tabId, msg) {
            const { jobTabs, rec } = await jobFor(tabId, msg.id);
            if (!rec) return { ok: false };
            delete jobTabs[tabId];
            await save('jobTabs', jobTabs);
            const e = msg.error || {};
            await status(rec.job, 'failed', { error: err(e.code || 'internal', e.message || 'The submit failed.') });
            return { ok: true };
        }

        async function setEditorText(sender, msg) {
            if (!pageWorld || !sender || !sender.tab) return { ok: false, reason: 'unavailable' };
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
                    world: 'MAIN',
                    func: pageWorld.setEditorText,
                    args: [String(msg.selector || ''), String(msg.text == null ? '' : msg.text)]
                });
                return (results && results[0] && results[0].result) || { ok: false, reason: 'no-result' };
            } catch (e) {
                return { ok: false, reason: String(e && e.message || e) };
            }
        }

        // ── tab events and timeouts ─────────────────────────────────────────────────────
        function onTabRemoved(tabId) {
            return serial(async () => {
                const jobTabs = await load('jobTabs', {});
                const rec = jobTabs[tabId];
                if (rec) {
                    delete jobTabs[tabId];
                    await save('jobTabs', jobTabs);
                    await status(rec.job, 'failed', { error: err('tab-closed', 'The submit tab was closed before the verdict arrived.') });
                }
                const fetchTabs = await load('fetchTabs', {});
                const f = fetchTabs[tabId];
                if (f) {
                    delete fetchTabs[tabId];
                    await save('fetchTabs', fetchTabs);
                    await fetchFailed(f.requestId, 'tab-closed', 'The problem tab was closed before it loaded.');
                }
                const submitTabs = await load('submitTabs', {});
                let changed = false;
                for (const k of Object.keys(submitTabs)) if (submitTabs[k] === tabId) { delete submitTabs[k]; changed = true; }
                if (changed) await save('submitTabs', submitTabs);
                const seen = await load('tabSeen', {});
                if (seen[tabId]) { delete seen[tabId]; await save('tabSeen', seen); }
            });
        }

        function onTabActivated(tabId) {
            return serial(async () => {
                const seen = await load('tabSeen', {});
                seen[tabId] = Object.assign({}, seen[tabId] || {}, { at: now() });
                await save('tabSeen', seen);
            });
        }

        function checkTimeouts() {
            return serial(async () => {
                const t = now();
                const jobTabs = await load('jobTabs', {});
                for (const [tabId, rec] of Object.entries(jobTabs)) {
                    let message = null;
                    if (rec.stage === 'fill' && t - rec.startedAt >= limits.fillMs) {
                        message = `The ${rec.adapterId} submit page did not submit within ${Math.round(limits.fillMs / 1000)} s.`;
                    } else if (t - rec.startedAt >= limits.doneMs) {
                        message = `No final verdict within ${Math.round(limits.doneMs / 60000)} minutes.`;
                    }
                    if (!message) continue;
                    delete jobTabs[tabId];
                    await save('jobTabs', jobTabs);
                    await status(rec.job, 'failed', { error: err('timeout', message) });
                }
                const fetchTabs = await load('fetchTabs', {});
                for (const [tabId, f] of Object.entries(fetchTabs)) {
                    if (t - f.startedAt < limits.fetchMs) continue;
                    delete fetchTabs[tabId];
                    await save('fetchTabs', fetchTabs);
                    await fetchFailed(f.requestId, 'timeout', `The problem page did not load within ${Math.round(limits.fetchMs / 1000)} s.`);
                    chrome.tabs.remove(Number(tabId)).catch(() => {});
                }
            });
        }

        /** Popup helper: what the active tab is, without touching it. */
        async function activeTabInfo() {
            let tab = null;
            try { [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch (_) { tab = null; }
            if (!tab || !tab.url) return { url: null, kind: null, adapter: null, canSend: false };
            const a = A.byUrl(tab.url);
            const kind = A.classifyUrl(tab.url);
            return { url: tab.url, kind, adapter: a ? a.name : null, canSend: kind === 'problem' };
        }

        async function recent() {
            const got = await L.get('recent');
            return Array.isArray(got.recent) ? got.recent : [];
        }

        return {
            handleCommand, handleMessage, onTabRemoved, onTabActivated, checkTimeouts,
            sendActiveTab, activeTabInfo, getSettings, setSetting, recent,
            idle: () => lock
        };
    }

    const SamekoJobs = { create: createJobs, DEFAULT_SETTINGS, LIMITS };
    root.SamekoJobs = SamekoJobs;
    if (typeof module !== 'undefined' && module.exports) module.exports = SamekoJobs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
