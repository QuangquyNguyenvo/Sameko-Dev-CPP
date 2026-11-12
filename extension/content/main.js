/*
 * Content script on OJ pages (after shared/adapters.js and adapters/*.js).
 *
 * On load: find this page's adapter, tell the worker what the page is (pageInfo), ask it
 * `whoami`, and run the stage it returns:
 *   fill   isLoggedIn → adapter.fillAndSubmit(doc, job, h); `submitted` is sent from
 *          h.aboutToSubmit() before the form navigates, `filled` when autoSubmit is false
 *   watch  adapter.readVerdict() on DOM changes and once a second → `verdict` messages
 * It also answers the worker's `getProblem` with adapter.parseProblem().
 *
 * Everything takes its dependencies so test code can run it; in a page it starts itself.
 */
(function (root) {
    'use strict';

    function makeError(code, message) {
        const e = new Error(message || code);
        e.name = 'SamekoError';
        e.code = code;
        return e;
    }

    function sender(chrome) {
        return async function send(msg) {
            try { return await chrome.runtime.sendMessage(msg); } catch (_) { return null; }
        };
    }

    /** The helper object `h` passed to adapter.fillAndSubmit (PROTOCOL §6). */
    function makeHelpers({ chrome, win, adapters, onAboutToSubmit }) {
        const send = sender(chrome);
        return {
            error: makeError,
            aboutToSubmit: () => onAboutToSubmit(),
            pickLanguage: (options, job, preferences) => adapters.pickLanguage(options, job, preferences),

            /** Set an input/textarea/select value the way a user would (frameworks see it). */
            setValue(el, text) {
                if (!el) throw makeError('form-not-found', 'A form field is missing.');
                const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype
                    : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
                const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                if (desc && desc.set) desc.set.call(el, text); else el.value = text;
                el.dispatchEvent(new win.Event('input', { bubbles: true }));
                el.dispatchEvent(new win.Event('change', { bubbles: true }));
            },

            /** Put `text` into an <input type=file> as a file called `name`. */
            setFile(input, name, text) {
                if (!input) throw makeError('form-not-found', 'The file input is missing.');
                const dt = new win.DataTransfer();
                dt.items.add(new win.File([text], name || 'main.cpp', { type: 'text/plain' }));
                input.files = dt.files;
                input.dispatchEvent(new win.Event('input', { bubbles: true }));
                input.dispatchEvent(new win.Event('change', { bubbles: true }));
            },

            /** Set the page's code editor (Ace / CodeMirror / Monaco) at `selector`. → true when it worked. */
            async setEditorText(selector, text) {
                const r = await send({ type: 'setEditorText', selector, text });
                return !!(r && r.ok);
            },

            /** Resolve fn()'s first truthy value, polling every 100 ms; null after timeoutMs. */
            waitFor(fn, timeoutMs) {
                const limit = timeoutMs == null ? 10000 : timeoutMs;
                const t0 = Date.now();
                return new Promise(resolve => {
                    const tick = () => {
                        let v = null;
                        try { v = fn(); } catch (_) { v = null; }
                        if (v) return resolve(v);
                        if (Date.now() - t0 >= limit) return resolve(null);
                        win.setTimeout(tick, 100);
                    };
                    tick();
                });
            }
        };
    }

    async function runFill({ chrome, doc, win, adapters, adapter, job }) {
        const send = sender(chrome);
        let submitted = false;
        const h = makeHelpers({
            chrome, win, adapters,
            onAboutToSubmit: async () => {
                if (submitted) return;
                submitted = true;
                await send({ type: 'submitted', id: job.id });   // stage → watch before navigating
            }
        });
        try {
            let loggedIn = false;
            try { loggedIn = !!adapter.isLoggedIn(doc); } catch (_) { loggedIn = false; }
            if (!loggedIn) {
                // One adapter can serve several sites (dmoj): name the one this tab is on.
                let site = adapter.name;
                try { if (typeof adapter.siteName === 'function') site = adapter.siteName(doc.location ? doc.location.href : '') || site; } catch (_) { }
                throw makeError('not-logged-in', `Log in to ${site} in this browser, then submit again.`);
            }
            await adapter.fillAndSubmit(doc, job, h);
        } catch (e) {
            await send({ type: 'failed', id: job.id, error: { code: (e && e.code) || 'internal', message: (e && e.message) || String(e) } });
            return 'failed';
        }
        if (!job.autoSubmit) {
            await send({ type: 'filled', id: job.id });
            return 'filled';
        }
        if (!submitted) {
            await send({ type: 'failed', id: job.id, error: { code: 'internal', message: `The ${adapter.name} adapter finished without submitting.` } });
            return 'failed';
        }
        // The form may have submitted without navigating (AJAX); watch this page too.
        startWatch({ chrome, doc, win, adapter, job });
        return 'submitted';
    }

    /** Watch stage: readVerdict on DOM changes and at least once a second, until a final result. */
    function startWatch({ chrome, doc, win, adapter, job }) {
        const send = sender(chrome);
        let done = false;
        let lastKey = null;
        let debounce = null;
        const interval = win.setInterval(check, 1000);
        const observer = win.MutationObserver ? new win.MutationObserver(() => {
            if (debounce) return;
            debounce = win.setTimeout(() => { debounce = null; check(); }, 150);
        }) : null;
        if (observer && doc.documentElement) observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

        function stop() {
            done = true;
            win.clearInterval(interval);
            if (debounce) win.clearTimeout(debounce);
            if (observer) observer.disconnect();
        }

        function check() {
            if (done) return;
            const url = win.location.href;
            let r = null;
            try {
                // Optional adapter extension: the judge refused the submission (duplicate code, …).
                if (typeof adapter.readSubmitError === 'function') {
                    const e = adapter.readSubmitError(doc, url, job);
                    if (e) {
                        stop();
                        const message = typeof e === 'string' ? e : (e.message || 'The judge rejected the submission.');
                        send({ type: 'failed', id: job.id, error: { code: (e && e.code) || 'rejected', message } });
                        return;
                    }
                }
                r = adapter.readVerdict(doc, url, job);
            } catch (_) {
                return;
            }
            if (!r) return;
            const key = JSON.stringify(r);
            if (key === lastKey) return;
            lastKey = key;
            if (r.final) {
                stop();
                showToast({ chrome, doc, win }, r.code === 'AC' ? 'ok' : 'bad', String(r.text || r.code || '').slice(0, 80));
            }
            send({ type: 'verdict', id: job.id, result: r });
        }

        check();
        return { stop, check };
    }

    const TOAST_KEYS = { sent: 'toastSent', offline: 'toastOffline', submitting: 'toastSubmitting' };
    const TOAST_FALLBACK = { sent: 'Sent to Sameko Dev C++', offline: 'Sameko Dev C++ is not running', submitting: 'Submitting\u2026' };

    /**
     * A small message in the corner of the judge page: the problem went to the app, a submit is
     * being filled in, the verdict. In a shadow root, so the page's CSS cannot restyle it and
     * ours cannot leak; coloured from the app's theme snapshot when there is one. `text` is
     * judge-provided (a verdict): inserted with textContent only.
     */
    async function showToast({ chrome, doc, win }, kind, text) {
        try {
            let label = text || '';
            if (!label) {
                try { label = chrome.i18n.getMessage(TOAST_KEYS[kind]) || ''; } catch (_) { label = ''; }
                label = label || TOAST_FALLBACK[kind] || '';
            }
            if (!label || !doc.body) return;
            let theme = null;
            try { theme = (await chrome.storage.local.get('theme')).theme || null; } catch (_) { theme = null; }
            const c = Object.assign({ bg: '#121633', text: '#eef0ff', border: '#2f3870', accent: '#ff9ec4', success: '#8fe0b4', error: '#ff7a8f' }, theme || {});
            const tone = kind === 'sent' || kind === 'ok' ? c.success : (kind === 'offline' || kind === 'bad' ? c.error : c.accent);
            const old = doc.getElementById('sameko-companion-toast');
            if (old) old.remove();
            const host = doc.createElement('div');
            host.id = 'sameko-companion-toast';
            host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
            const shadow = host.attachShadow({ mode: 'closed' });
            const box = doc.createElement('div');
            box.setAttribute('role', 'status');
            box.style.cssText = 'display:flex;align-items:center;gap:8px;max-width:320px;padding:9px 14px;border-radius:999px;' +
                'font:600 13px/1.3 system-ui,"Segoe UI",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);' +
                'transition:opacity .2s,transform .2s;opacity:0;transform:translateY(6px);';
            box.style.background = c.bg;
            box.style.color = c.text;
            box.style.border = '1.5px solid ' + c.border;
            const dot = doc.createElement('span');
            dot.style.cssText = 'flex:none;width:8px;height:8px;border-radius:50%;';
            dot.style.background = tone;
            const span = doc.createElement('span');
            span.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            span.textContent = label;
            box.append(dot, span);
            shadow.append(box);
            doc.body.append(host);
            win.setTimeout(() => { box.style.opacity = '1'; box.style.transform = 'none'; }, 20);
            win.setTimeout(() => { box.style.opacity = '0'; }, 3200);
            win.setTimeout(() => host.remove(), 3500);
        } catch (_) { /* a toast must never break the page or the job */ }
    }

    async function runContent({ chrome, doc, win, adapters }) {
        const send = sender(chrome);
        const url = win.location.href;
        const adapter = adapters.byUrl(url);
        if (!adapter) return null;

        chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
            if (msg && msg.type === 'toast') { showToast({ chrome, doc, win }, msg.kind, null); return false; }
            if (!msg || msg.type !== 'getProblem') return false;
            let problem = null, error = null;
            try { problem = adapter.parseProblem(doc, win.location.href) || null; } catch (e) { error = String(e && e.message || e); }
            sendResponse({ problem, error });
            return false;
        });

        const kind = adapters.classifyUrl(url) || 'other';
        let hasProblem = false;
        if (kind === 'problem') {
            try { hasProblem = !!adapter.parseProblem(doc, url); } catch (_) { hasProblem = false; }
        }
        await send({ type: 'pageInfo', url, kind, hasProblem, adapterId: adapter.id });

        const me = await send({ type: 'whoami' });
        if (!me || !me.job) return null;
        const a = adapters.get(me.adapterId) || adapter;
        if (me.stage === 'fill') {
            showToast({ chrome, doc, win }, 'submitting', null);
            return runFill({ chrome, doc, win, adapters, adapter: a, job: me.job });
        }
        if (me.stage === 'watch') return startWatch({ chrome, doc, win, adapter: a, job: me.job });
        return null;
    }

    const SamekoContent = { makeHelpers, makeError, runFill, startWatch, runContent };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SamekoContent;
    } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && typeof document !== 'undefined') {
        // Once per page, even when the worker injects the scripts again (scripting.executeScript).
        if (!root.__samekoContentStarted) {
            root.__samekoContentStarted = true;
            runContent({ chrome, doc: document, win: window, adapters: root.SamekoAdapters })
                .catch(e => console.warn('[Sameko Companion]', e));
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
