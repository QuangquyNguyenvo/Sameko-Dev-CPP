/*
 * AtCoder adapter (atcoder.jp). Written from the real pages saved under test/fixtures/atcoder/
 * (task pages fetched anonymously) and, for the login-only pages (submit form, submissions/me),
 * from AtCoder's own public js/contest.js plus open-source clients — each fixture says which.
 *
 *   problem      /contests/<contest>/tasks/<task>
 *   submit       /contests/<contest>/submit?taskScreenName=<task>   (submitUrl: the dedicated page;
 *                the task page also has the form at the bottom, but only while submitting is open,
 *                and it is the page the user reads — a dedicated tab is easier to reuse and check)
 *   status       /contests/<contest>/submissions/me   (AtCoder redirects here after a submit)
 *                /contests/<contest>/submissions/<id>
 *
 * Form facts (js/contest.js): form.form-code-submit; the source is an Ace editor (#editor) and
 * textarea#plain-textarea (name="sourceCode", the posted field). On submit the page copies the Ace
 * text into the textarea unless "Toggle Editor" (plain mode) is on — so both are set here. The
 * language <select> sits in #select-lang > #select-lang-<task>, enhanced by select2, and the page
 * restores the user's last language once select2 is ready: wait for that before choosing.
 * A Cloudflare Turnstile widget may guard the form; its token must exist before submitting.
 */
(function (root) {
    'use strict';

    const A = root.SamekoAdapters;
    const ORIGIN = 'https://atcoder.jp';
    const TASK_PATH = /^\/contests\/([^/]+)\/tasks\/([^/]+)\/?$/;
    const SUBMIT_PATH = /^\/contests\/([^/]+)\/submit\/?$/;
    const ME_PATH = /^\/contests\/([^/]+)\/submissions\/me\/?$/;
    const DETAIL_PATH = /^\/contests\/([^/]+)\/submissions\/(\d+)\/?$/;
    const STATE_KEY = 'sameko-atcoder-submit';     // sessionStorage: { jobId, at } set just before submitting
    const CLOCK_SKEW_MS = 120 * 1000;              // a row may look this much older than our submit time
    const TURNSTILE_WAIT_MS = 40 * 1000;           // the worker allows 60 s to reach "submitted"

    function parse(url) {
        try { return new URL(String(url)); } catch (_) { return null; }
    }

    /** { contest, task } from a task URL or a submit URL with taskScreenName, else null. */
    function taskOf(url) {
        const u = parse(url);
        if (!u) return null;
        let m = TASK_PATH.exec(u.pathname);
        if (m) return { contest: decodeURIComponent(m[1]), task: decodeURIComponent(m[2]) };
        m = SUBMIT_PATH.exec(u.pathname);
        const task = m && u.searchParams.get('taskScreenName');
        return task ? { contest: decodeURIComponent(m[1]), task } : null;
    }

    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

    function ensureNewline(s) {
        const t = String(s || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
        return t + '\n';
    }

    // ── Problem parsing ────────────────────────────────────────────────────────────────────
    /**
     * A sample <pre>'s text. On the live page contest.js puts the original text in a following
     * pre.source-code-for-copy before prettify turns old "prettyprint linenums" blocks into an <ol>
     * (whose textContent loses the line breaks); fixtures have neither.
     */
    function preText(pre) {
        const copy = pre.nextElementSibling;
        if (copy && copy.tagName === 'PRE' && copy.classList.contains('source-code-for-copy')) return copy.textContent;
        const lines = pre.querySelectorAll('ol.linenums > li');
        if (lines.length) return Array.from(lines, li => li.textContent).join('\n');
        return pre.textContent;
    }

    /** The first statement <pre> after `h3` in its section (new: <section><h3/><pre/>, old: <div.part><h3/><section><pre/>). */
    function preAfter(h3) {
        const scope = h3.closest('section') || h3.parentElement;
        if (!scope) return null;
        return Array.from(scope.querySelectorAll('pre')).find(p =>
            !p.classList.contains('source-code-for-copy') &&
            (h3.compareDocumentPosition(p) & 4 /* FOLLOWING */)) || null;
    }

    const SAMPLE_IN = /^\s*(?:Sample\s+Input|入力例)\s*(\d*)/i;
    const SAMPLE_OUT = /^\s*(?:Sample\s+Output|出力例)\s*(\d*)/i;

    function samplesIn(container) {
        const byNo = new Map();
        let seq = 0;
        container.querySelectorAll('h3').forEach(h3 => {
            const t = h3.textContent;               // the live page appends a "Copy" button: match the start only
            const mi = SAMPLE_IN.exec(t), mo = mi ? null : SAMPLE_OUT.exec(t);
            if (!mi && !mo) return;
            const pre = preAfter(h3);
            if (!pre) return;
            const no = (mi || mo)[1] || String(mi ? ++seq : seq);
            const rec = byNo.get(no) || {};
            rec[mi ? 'input' : 'output'] = ensureNewline(preText(pre));
            byNo.set(no, rec);
        });
        return Array.from(byNo.values()).filter(r => r.input != null)
            .map(r => ({ input: r.input, output: r.output == null ? '\n' : r.output }));
    }

    /** Samples from one language block only: English, else Japanese, else the whole statement (old tasks). */
    function parseSamples(statement) {
        for (const sel of [':scope span.lang > span.lang-en', ':scope span.lang > span.lang-ja']) {
            let block = null;
            try { block = statement.querySelector(sel); } catch (_) { block = null; }
            if (block) {
                const tests = samplesIn(block);
                if (tests.length) return tests;
            }
        }
        return samplesIn(statement);
    }

    /** "Time Limit: 2 sec / Memory Limit: 1024 MiB" or "実行時間制限: 2 sec / メモリ制限: 1024 MiB". */
    function parseLimits(doc) {
        const out = { timeLimit: null, memoryLimit: null };
        const ps = Array.from(doc.querySelectorAll('#main-container p'));
        const p = ps.find(el => /(Time Limit|実行時間制限)\s*:/.test(el.textContent));
        if (!p) return out;
        const t = text(p);
        const tm = /(?:Time Limit|実行時間制限)\s*:\s*([\d.]+\s*(?:msec|ms|sec|s)\b)/i.exec(t);
        const mm = /(?:Memory Limit|メモリ制限)\s*:\s*([\d.]+\s*[KMG]i?B)/i.exec(t);
        if (tm) out.timeLimit = A.parseTimeMs(tm[1]);
        if (mm) { const kb = A.parseMemoryKb(mm[1]); out.memoryLimit = kb == null ? null : Math.round(kb / 1024); }
        return out;
    }

    // ── Language picking ───────────────────────────────────────────────────────────────────
    // Option texts (judge of 2025-10, official list): "C++23 (GCC 15.2.0)", "C++23 (Clang 21.1.0)",
    // "C++ IOI-Style(GNU++20) (GCC 14.2.0)", "C23 (GCC 14.2.0)", "Python (CPython 3.13.7)",
    // "Python (PyPy 3.11-v7.3.20)", "Python (Codon 0.19.3)", "Java24 (OpenJDK 24.0.2)", "Go (go 1.25.1)",
    // "Go 1.18 (gccgo 15.2.0)", "C# 13.0 (.NET 9.0.8)", "C# 13.0 (.NET Native AOT 9.0.8)",
    // "JavaScript (Node.js 22.19.0)". Older judges: "C++ 20 (gcc 12.2)", "Python (CPython 3.11.4)".
    //  - cpp: GCC before Clang. "C++ IOI-Style" (a different I/O model, for IOI-style tasks only) never
    //    matches here — the patterns need "C++" right before the standard — and is only used when it is
    //    the task's sole C++ option (see chooseLanguage).
    //  - python: CPython, deliberately, over PyPy: it is what the IDE runs locally, so behaviour and
    //    libraries (numpy, …) match; PyPy is faster but is a different interpreter with its own library
    //    set. PyPy only when the task offers no CPython. Codon (a compiled Python dialect) never.
    const LANGUAGE_PREFERENCES = {
        cpp: [/^C\+\+\s*\d{2}\b.*\bgcc\b/i, /^C\+\+\s*\d{2}\b.*\bclang\b/i],
        c: [/^C\d*\s*\(.*\bgcc\b/i, /^C\d*\s*\(.*\bclang\b/i],
        python: [/\(CPython\s/i, /\bCPython\b/i, /\bPyPy\s*3/i],
        java: [/^Java\s*\d*\s*\(/i],
        go: [/^Go\s*\(go\s/i, /^Go\b/i],
        csharp: [/^C#(?!.*\bAOT\b)/i, /^C#/i],
        javascript: [/node\.?js/i, /^JavaScript\b/i],
        kotlin: [/^Kotlin\b/i],
        pascal: [/^Pascal\b/i],
        rust: [/^Rust\b/i]
    };
    const IOI_PREFERENCES = { cpp: [/^C\+\+\s*IOI/i] };

    /** The language <select> of this task (only one is named/current once contest.js ran). */
    function findLanguageSelect(doc, task) {
        const own = task ? doc.getElementById('select-lang-' + task) : null;
        return (own && own.querySelector('select')) ||
            doc.querySelector('#select-lang select.current') ||
            doc.querySelector('select[name="data.LanguageId"]') ||
            doc.querySelector('#select-lang select');
    }

    function chooseFrom(select, job, pick) {
        const options = Array.from(select.options).filter(o => !o.disabled && o.value).map(o => ({ value: o.value, text: text(o) }));
        return pick(options, job, LANGUAGE_PREFERENCES) ||
            (String(job && job.language || 'cpp').toLowerCase() === 'cpp' ? pick(options, job, IOI_PREFERENCES) : null);
    }

    // ── Submit form helpers ────────────────────────────────────────────────────────────────
    function findForm(doc) {
        return doc.querySelector('form.form-code-submit') ||
            Array.from(doc.querySelectorAll('form')).find(f => f.querySelector('[name="sourceCode"]')) || null;
    }

    function turnstileWidget(doc, form) {
        return form.querySelector('.cf-turnstile, .cf-challenge, [data-sitekey], [name="cf-turnstile-response"]') ||
            doc.querySelector('.cf-turnstile, .cf-challenge');
    }

    function turnstileToken(doc, form) {
        const el = form.querySelector('[name="cf-turnstile-response"]') || doc.querySelector('[name="cf-turnstile-response"]');
        return el && el.value ? el.value.trim() : '';
    }

    function alertMessages(doc) {
        return Array.from(doc.querySelectorAll('.alert-danger, div[role="alert"].alert-warning')).map(el => {
            const c = el.cloneNode(true);
            c.querySelectorAll('button.close, .close').forEach(b => b.remove());
            return text(c);
        }).filter(Boolean);
    }
    let staleAlerts = new Set();                    // alerts already on the form before we submitted

    const sleep = (h, ms) => { const t0 = Date.now(); return h.waitFor(() => Date.now() - t0 >= ms, ms + 1000); };

    // ── Verdict helpers ────────────────────────────────────────────────────────────────────
    function readState(doc, job) {
        let at = job && Number.isFinite(job.submittedAt) ? job.submittedAt : null;
        try {
            const store = doc.defaultView && doc.defaultView.sessionStorage;
            const saved = store ? JSON.parse(store.getItem(STATE_KEY) || 'null') : null;
            if (saved && saved.jobId === (job && job.id) && Number.isFinite(saved.at) && at == null) at = saved.at;
        } catch (_) { /* storage blocked */ }
        if (at == null && job && job.id) {           // the app's job id: s_<ms>_<n>, made before the tab opened
            const m = /^s_(\d{12,})_/.exec(String(job.id));
            if (m) at = +m[1];
        }
        return { at };
    }

    /** "2024-11-16 21:30:05+0900" (server HTML) or "2024-11-16 21:30:05" (after base.js turned it into local time). */
    function parseRowTime(s) {
        const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(String(s || ''));
        if (!m) return null;
        const [, y, mo, d, hh, mi, ss, sign, oh, om] = m;
        if (sign) {
            const off = (+oh * 60 + +om) * (sign === '-' ? -1 : 1);
            return Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss) - off * 60000;
        }
        return new Date(+y, +mo - 1, +d, +hh, +mi, +ss).getTime();
    }

    function rowInfo(tr) {
        const taskLink = tr.querySelector('a[href*="/tasks/"]');
        const tm = taskLink && /\/contests\/[^/]+\/tasks\/([^/?#]+)/.exec(taskLink.getAttribute('href') || '');
        let id = null;
        const scoreTd = tr.querySelector('td.submission-score[data-id], [data-id]');
        if (scoreTd && /^\d+$/.test(scoreTd.getAttribute('data-id') || '')) id = +scoreTd.getAttribute('data-id');
        const detail = Array.from(tr.querySelectorAll('a[href]')).find(a => /\/submissions\/\d+(?:[?#]|$)/.test(a.getAttribute('href')));
        if (id == null && detail) id = +/\/submissions\/(\d+)/.exec(detail.getAttribute('href'))[1];
        return {
            tr, id, task: tm ? decodeURIComponent(tm[1]) : null,
            time: parseRowTime(text(tr.querySelector('time') || tr.querySelector('td'))),
            detailHref: detail ? detail.getAttribute('href') : null
        };
    }

    // AtCoder's own page only polls the judge while its tab has focus; a background submit tab
    // would never update. Poll the same status endpoint (the page's `submissionAPI`) ourselves.
    let lastRefresh = 0;
    function refreshInBackground(doc, id) {
        const win = doc.defaultView;
        if (!win || typeof fetch !== 'function') return;          // fixtures: nothing to do
        const visible = doc.visibilityState === 'visible' && (typeof doc.hasFocus !== 'function' || doc.hasFocus());
        if (visible || Date.now() - lastRefresh < 3000) return;
        const script = Array.from(doc.querySelectorAll('script:not([src])')).find(s => /submissionAPI\s*=/.test(s.textContent));
        const m = script && /submissionAPI\s*=\s*["']([^"']+)["']/.exec(script.textContent);
        if (!m) return;
        lastRefresh = Date.now();
        fetch(`${m[1]}?reload=true&sids[]=${id}`, { credentials: 'same-origin' })
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                const res = data && data.Result && data.Result[id];
                if (!res || typeof res.Html !== 'string') return;
                const cell = doc.querySelector(`.waiting-judge[data-id="${id}"]`);
                if (!cell) return;
                const tbody = doc.createElement('tbody');
                tbody.innerHTML = `<tr>${res.Html}</tr>`;           // AtCoder's own status cells
                const cells = Array.from(tbody.firstElementChild ? tbody.firstElementChild.children : []);
                if (!cells.length) return;
                if (cells[0].classList.contains('waiting-judge')) {
                    const span = cells[0].querySelector('span'), old = cell.querySelector('span');
                    if (span && old) old.replaceWith(span);
                } else {
                    cell.replaceWith(...cells);
                }
                const score = doc.querySelector(`.submission-score[data-id="${id}"]`);
                if (score && res.Score != null) score.textContent = String(res.Score);
            })
            .catch(() => { /* next check retries */ });
    }

    const adapter = {
        id: 'atcoder',
        name: 'AtCoder',
        hosts: ['atcoder.jp'],   // exact hosts; keep in sync with manifest.json

        // ── pure: also runs in the worker ──────────────────────────────────────────────────
        classify(url) {
            const u = parse(url);
            if (!u) return { kind: 'other' };
            if (TASK_PATH.test(u.pathname)) return { kind: 'problem' };
            if (SUBMIT_PATH.test(u.pathname)) return { kind: 'submit' };
            if (ME_PATH.test(u.pathname) || DETAIL_PATH.test(u.pathname)) return { kind: 'status' };
            return { kind: 'other' };
        },

        submitUrl(problemUrl) {
            const t = taskOf(problemUrl);
            return t ? `${ORIGIN}/contests/${encodeURIComponent(t.contest)}/submit?taskScreenName=${encodeURIComponent(t.task)}` : null;
        },

        // ── DOM: content script only ───────────────────────────────────────────────────────
        parseProblem(doc, url) {
            const statement = doc.getElementById('task-statement');
            const h2 = doc.querySelector('#main-container span.h2');
            if (!statement || !h2) return null;
            // Direct text only: the heading also holds an "Editorial" button.
            const name = Array.from(h2.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
            const contest = text(doc.querySelector('.navbar a.contest-title'));
            const u = parse(url);
            return Object.assign({
                name: name || text(doc.querySelector('title')),
                group: contest ? `AtCoder - ${contest}` : 'AtCoder',
                url: u ? u.origin + u.pathname : String(url)
            }, parseLimits(doc), { tests: parseSamples(statement) });
        },

        isLoggedIn(doc) {
            // The head script always declares userScreenName ("" when logged out) — seen on the real pages.
            for (const s of doc.querySelectorAll('script:not([src])')) {
                const m = /userScreenName\s*=\s*"([^"]*)"/.exec(s.textContent);
                if (m) return m[1].length > 0;
            }
            return !!doc.querySelector('a[href^="javascript:form_logout"]') && !doc.querySelector('.navbar a[href^="/login"]');
        },

        /** Testable language choice: the option fillAndSubmit would pick on this page. */
        chooseLanguage(doc, url, job) {
            const t = taskOf(url) || taskOf(job && job.url);
            const select = findLanguageSelect(doc, t && t.task);
            return select ? chooseFrom(select, job, A.pickLanguage) : null;
        },

        async fillAndSubmit(doc, job, h) {
            const t = taskOf(job.url) || taskOf(doc.location && doc.location.href);
            const form = await h.waitFor(() => findForm(doc), 8000);
            if (!form) throw h.error('form-not-found', 'The AtCoder submit form was not found. Check that the contest is open for submissions, then submit again.');

            // Task: the URL preselects it; switch if the page chose another.
            const taskSelect = form.querySelector('#select-task, select[name="data.TaskScreenName"]');
            if (taskSelect && t && taskSelect.value !== t.task) {
                if (!Array.from(taskSelect.options).some(o => o.value === t.task)) {
                    throw h.error('form-not-found', `AtCoder does not accept submissions for ${t.task} here. Open the task page and check the contest is running or open for practice.`);
                }
                h.setValue(taskSelect, t.task);
            }

            // Language: wait for select2 (the page then restores the user's last language), then choose.
            let select = await h.waitFor(() => findLanguageSelect(doc, t && t.task), 5000);
            if (!select) throw h.error('form-not-found', 'The language list was not found on the AtCoder submit page.');
            await h.waitFor(() => select.classList.contains('select2-hidden-accessible'), 4000);
            await sleep(h, 200);
            select = findLanguageSelect(doc, t && t.task) || select;
            const choice = chooseFrom(select, job, h.pickLanguage);
            if (!choice) throw h.error('language-not-found', `AtCoder has no compiler for ${job.language}${job.std ? ` (${job.std})` : ''} on this task.`);
            h.setValue(select, choice.value);
            await sleep(h, 300);
            if (select.value !== choice.value) h.setValue(select, choice.value);   // the page's restore ran late

            // Source: the Ace editor and the posted textarea both (see the header).
            const area = form.querySelector('textarea[name="sourceCode"], #plain-textarea');
            if (!area) throw h.error('form-not-found', 'The source code box was not found on the AtCoder submit page.');
            const viaEditor = doc.getElementById('editor') ? await h.setEditorText('#editor', job.source) : false;
            if (!viaEditor) {
                // No usable Ace: switch to the plain textarea so the submit handler does not overwrite it.
                const toggle = form.querySelector('.btn-toggle-editor');
                if (toggle && !toggle.classList.contains('active') && doc.getElementById('editor')) toggle.click();
            }
            h.setValue(area, job.source);

            if (!job.autoSubmit) return;

            if (turnstileWidget(doc, form)) {
                const ok = await h.waitFor(() => turnstileToken(doc, form), TURNSTILE_WAIT_MS);
                if (!ok) throw h.error('timeout', "AtCoder's Cloudflare check did not finish. Complete it in the AtCoder tab and press Submit there, or submit again.");
            }

            staleAlerts = new Set(alertMessages(doc));
            try {
                const store = doc.defaultView && doc.defaultView.sessionStorage;
                if (store) store.setItem(STATE_KEY, JSON.stringify({ jobId: job.id, at: Date.now() }));
            } catch (_) { /* storage blocked: readVerdict falls back to job times */ }

            await h.aboutToSubmit();
            const button = form.querySelector('#submit, button[type="submit"]');
            // requestSubmit fires the page's submit handler (Ace → textarea); form.submit() would skip it.
            if (form.requestSubmit) form.requestSubmit(button || undefined);
            else if (button) button.click();
            else form.submit();
        },

        readSubmitError(doc, url, job) {
            const kind = this.classify(url).kind;
            if (kind !== 'submit' && kind !== 'problem') return null;
            const fresh = alertMessages(doc).filter(m => !staleAlerts.has(m));
            if (fresh.length) return fresh.join(' ');
            // The form came back without a message: this page loaded after we submitted.
            try {
                const win = doc.defaultView;
                const saved = win && win.sessionStorage ? JSON.parse(win.sessionStorage.getItem(STATE_KEY) || 'null') : null;
                if (kind === 'submit' && saved && saved.jobId === (job && job.id) && win.performance &&
                    win.performance.timeOrigin > saved.at + 500 && findForm(doc)) {
                    return 'AtCoder showed the submit form again without a message. Check the AtCoder tab, then submit again.';
                }
            } catch (_) { /* no storage */ }
            return null;
        },

        readVerdict(doc, url, job) {
            const u = parse(url);
            if (!u || !ME_PATH.test(u.pathname)) return null;
            const want = taskOf(job && job.url);
            const { at } = readState(doc, job);
            const rows = Array.from(doc.querySelectorAll('table tbody tr')).map(rowInfo)
                .filter(r => r.id != null && (!want || r.task === want.task))
                .filter(r => at == null || r.time == null || r.time >= at - CLOCK_SKEW_MS);
            if (!rows.length) return null;
            const row = rows.reduce((a, b) => (b.id > a.id ? b : a));    // newest of this task since the submit

            const label = row.tr.querySelector('span.label');
            const labelText = text(label);
            const title = label ? (label.getAttribute('title') || label.getAttribute('data-original-title') || '').trim() : '';
            const statusTd = label ? label.closest('td') : null;
            const submissionUrl = row.detailHref ? new URL(row.detailHref, url).href : null;
            const pending = (statusTd && statusTd.classList.contains('waiting-judge')) || A.isPendingVerdict(labelText);

            if (pending) {
                refreshInBackground(doc, row.id);
                const waiting = /^(WJ|WR)$/i.test(labelText) || !labelText;
                return {
                    final: false, code: null,
                    text: waiting ? (title || 'Waiting for judge') : `${title || 'Judging'} ${labelText}`,
                    test: null, timeMs: null, memoryKb: null, points: null, submissionUrl
                };
            }
            const cells = Array.from(row.tr.children).map(td => text(td));
            const timeCell = cells.find(c => /^\d+\s*ms$/i.test(c));
            const memCell = cells.find(c => /^\d+\s*(?:KiB|KB|MiB|MB)$/i.test(c));
            const scoreEl = row.tr.querySelector('td.submission-score');
            const points = scoreEl && /^-?\d+(?:\.\d+)?$/.test(text(scoreEl)) ? parseFloat(text(scoreEl)) : null;
            return {
                final: true,
                code: A.normalizeVerdict(labelText),
                text: title || labelText,
                test: null,
                timeMs: timeCell ? A.parseTimeMs(timeCell) : null,
                memoryKb: memCell ? A.parseMemoryKb(memCell) : null,
                points,
                submissionUrl
            };
        }
    };

    A.register(adapter);
    if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
