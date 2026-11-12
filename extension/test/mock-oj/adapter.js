/*
 * Mock OJ adapter — the worked example for writing a real one (adapters/<id>.js).
 *
 * It is a complete adapter for test/mock-oj/server.js. It is NOT in the shipped manifest;
 * test/make-dev.js copies it into the dev build as adapters/mock-oj.js.
 *
 * Rules every adapter follows (PROTOCOL.md "Adapter contract"):
 *   - No DOM access at load time: the service worker importScripts() this file too, and only
 *     classify() / submitUrl() run there. Everything that reads `doc` runs in the content script.
 *   - Write selectors from the judge's real HTML (save it under test/fixtures/<id>/), never from
 *     memory, and prefer stable ids/classes over position.
 *   - Fail with `throw h.error(code, message)`; codes are listed in PROTOCOL §3. The message is
 *     shown to the user in the app, so say what to do ("Log in to X in this browser…").
 */
(function (root) {
    'use strict';

    const A = root.SamekoAdapters;
    const PROBLEM_PATH = /^\/problem\/([A-Za-z0-9_]+)\/?$/;
    const SUBMIT_PATH = /^\/submit\/([A-Za-z0-9_]+)\/?$/;
    const STATUS_PATH = /^\/(?:status|submission\/\d+)\/?$/;

    function parse(url) {
        try { return new URL(url); } catch (_) { return null; }
    }

    /** The problem id in a problem or submit URL ("A" for /problem/A), or null. */
    function problemId(url) {
        const u = parse(url);
        if (!u) return null;
        const m = PROBLEM_PATH.exec(u.pathname) || SUBMIT_PATH.exec(u.pathname);
        return m ? m[1] : null;
    }

    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

    // Ordered language preferences: earlier patterns win. Only languages whose option names are
    // unusual on this judge need an entry; the rest use the defaults in shared/adapters.js.
    // For cpp, pickLanguage itself prefers the requested std, then the newest GCC.
    const LANGUAGE_PREFERENCES = {
        cpp: [/GNU G\+\+/i, /Clang\+\+/i],              // GCC first, Clang only as a fallback
        python: [/^Python 3/i, /^PyPy 3/i]              // CPython unless only PyPy exists
    };

    const adapter = {
        id: 'mock-oj',
        name: 'Mock OJ',
        hosts: ['localhost'],                           // exact hosts (ports are ignored)

        // ── pure: also runs in the worker ──────────────────────────────────────────────────
        classify(url) {
            const u = parse(url);
            if (!u) return { kind: 'other' };
            if (PROBLEM_PATH.test(u.pathname)) return { kind: 'problem' };
            if (SUBMIT_PATH.test(u.pathname)) return { kind: 'submit' };
            if (STATUS_PATH.test(u.pathname)) return { kind: 'status' };
            return { kind: 'other' };
        },

        submitUrl(problemUrl) {
            const u = parse(problemUrl);
            const id = problemId(problemUrl);
            return u && id ? `${u.origin}/submit/${id}` : null;
        },

        // ── DOM: content script only ───────────────────────────────────────────────────────
        parseProblem(doc, url) {
            const root = doc.querySelector('.problem-statement');
            if (!root) return null;                     // not a problem page (or a login wall)
            const tests = Array.from(root.querySelectorAll('.sample')).map(s => ({
                // <pre> keeps the line breaks; textContent (not innerText) does not depend on layout.
                input: ensureNewline(s.querySelector('.input pre') ? s.querySelector('.input pre').textContent : ''),
                output: ensureNewline(s.querySelector('.output pre') ? s.querySelector('.output pre').textContent : '')
            }));
            return {
                name: text(root.querySelector('.title')),
                group: 'Mock OJ',
                url: String(url).replace(/#.*$/, ''),
                timeLimit: A.parseTimeMs(text(root.querySelector('.time-limit')).replace(/^[^:]*:/, '')),   // "1 second" → 1000
                memoryLimit: Math.round(A.parseMemoryKb(text(root.querySelector('.memory-limit')).replace(/^[^:]*:/, '')) / 1024), // MB
                tests
            };
        },

        isLoggedIn(doc) {
            return !!doc.querySelector('.user-menu .logout');
        },

        async fillAndSubmit(doc, job, h) {
            // The form is server-rendered here; on judges that build it with JS, waitFor covers the delay.
            const form = await h.waitFor(() => doc.querySelector('form#submit-form'), 5000);
            if (!form) throw h.error('form-not-found', 'The Mock OJ submit form was not found.');

            const select = form.querySelector('select[name="language"]');
            if (!select) throw h.error('form-not-found', 'The language list was not found on the submit page.');
            const options = Array.from(select.options).map(o => ({ value: o.value, text: text(o) }));
            const choice = h.pickLanguage(options, job, LANGUAGE_PREFERENCES);
            if (!choice) throw h.error('language-not-found', `Mock OJ has no compiler for ${job.language}${job.std ? ` (${job.std})` : ''}.`);
            h.setValue(select, choice.value);

            // Prefer the page's editor (it keeps its own state and mirrors into the form field on
            // submit); fall back to the raw textarea when the editor API is not there.
            const viaEditor = await h.setEditorText('#source-editor', job.source);
            if (!viaEditor) h.setValue(form.querySelector('textarea[name="source"]'), job.source);

            if (!job.autoSubmit) return;                // fill only: the user presses Submit

            // Tell the worker first: submitting navigates away and ends this script.
            await h.aboutToSubmit();
            if (form.requestSubmit) form.requestSubmit(form.querySelector('#submit-button') || undefined);
            else form.submit();
        },

        // Optional extension of the contract: the judge re-showed the form with an error.
        readSubmitError(doc, url) {
            if (this.classify(url).kind !== 'submit') return null;
            const alert = doc.querySelector('.alert-error');
            return alert ? text(alert) : null;
        },

        readVerdict(doc, url, job) {
            // The status page lists newest first; take the newest row for this job's problem.
            // (A real judge often shows other people's or older rows: match on the problem and,
            // when the judge exposes it, the submission id or the time after aboutToSubmit.)
            const want = problemId(job.url);
            const row = Array.from(doc.querySelectorAll('#submissions tr[data-submission-id]'))
                .find(tr => !want || tr.getAttribute('data-problem') === want);
            if (!row) return null;
            const verdict = text(row.querySelector('.verdict'));
            const link = row.querySelector('.id a');
            const submissionUrl = link ? new URL(link.getAttribute('href'), url).href : null;
            const testMatch = /test\s+(\d+)/i.exec(verdict);
            if (A.isPendingVerdict(verdict)) {
                return { final: false, code: null, text: verdict, test: testMatch ? +testMatch[1] : null,
                    timeMs: null, memoryKb: null, points: null, submissionUrl };
            }
            const code = A.normalizeVerdict(verdict);
            return {
                final: true,
                code,
                text: verdict,
                test: code === 'AC' || !testMatch ? null : +testMatch[1],
                timeMs: A.parseTimeMs(text(row.querySelector('.time'))),
                memoryKb: A.parseMemoryKb(text(row.querySelector('.memory'))),
                points: null,
                submissionUrl
            };
        }
    };

    function ensureNewline(s) {
        const t = String(s || '').replace(/\r\n/g, '\n');
        return t.endsWith('\n') ? t : t + '\n';
    }

    A.register(adapter);
    if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
