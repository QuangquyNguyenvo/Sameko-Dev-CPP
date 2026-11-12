/*
 * CSES adapter (cses.fi).
 *
 * Verified against the real site: task pages (problemset and course tasks), the language list
 * (cses.fi/howto) and the login-state header. NOT verified (login-only pages, written from the
 * references listed in test/fixtures/cses/*.html): the submit form's option select and the result
 * page. Those spots are marked "UNVERIFIED" below; the code is deliberately tolerant there.
 *
 * Pages:
 *   /<course>/task/<id>[/]      task statement (course = "problemset", or a course/contest slug such as "dt")
 *   /<course>/submit/<id>[/]    submit form: <input type=file name=file>, <select id=lang>, an option <select>
 *   /<course>/result/<sid>[/]   one submission; reloads itself while the status is pending
 */
(function (root) {
    'use strict';

    const A = root.SamekoAdapters;
    const TASK_PATH = /^\/([A-Za-z0-9_-]+)\/task\/(\d+)\/?$/;
    const SUBMIT_PATH = /^\/([A-Za-z0-9_-]+)\/submit\/(\d+)\/?$/;
    const RESULT_PATH = /^\/([A-Za-z0-9_-]+)\/result\/(\d+)\/?$/;

    function parse(url) {
        try { return new URL(url); } catch (_) { return null; }
    }

    /** { course, id } for a task or submit URL, or null. */
    function taskRef(url) {
        const u = parse(url);
        if (!u) return null;
        const m = TASK_PATH.exec(u.pathname) || SUBMIT_PATH.exec(u.pathname);
        return m ? { course: m[1], id: m[2] } : null;
    }

    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

    function ensureNewline(s) {
        const t = String(s || '').replace(/\r\n/g, '\n');
        return t.endsWith('\n') ? t : t + '\n';
    }

    /** <pre> text with <br> as newlines; textContent, so it does not depend on layout. */
    function preText(pre) {
        const c = pre.cloneNode(true);
        c.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        return c.textContent;
    }

    // Language names on the form are exactly those of cses.fi/howto ("C", "C++", "Python3", "Node.js"…).
    // The built-in patterns in shared/adapters.js cover them; "C" must not match "C++" (the built-in
    // exclude does that) and Python2 is excluded.
    const OPTION_EXPECT = {                                  // what the option select holds per language
        cpp: /c\+\+\s*\d{2}/i,
        python: /python|pypy/i,
        rust: /20\d\d/
    };
    const EXT = { cpp: 'cpp', c: 'c', python: 'py', java: 'java', pascal: 'pas', rust: 'rs', javascript: 'js' };

    /** A file name with an extension CSES recognises for this language. */
    function submitFileName(job) {
        const ext = EXT[String(job.language || 'cpp').toLowerCase()] || 'txt';
        const given = String(job.fileName || '').replace(/^.*[\\/]/, '');
        if (given && new RegExp(`\\.${ext}$`, 'i').test(given)) return given;
        return ext === 'java' ? 'Main.java' : `solution.${ext}`;
    }

    /** The option <option> to choose in the language-dependent select, or null to leave it alone. */
    function pickOption(options, job) {
        const list = options.filter(o => o.value !== '' && !o.disabled);
        if (!list.length) return null;
        const language = String(job.language || 'cpp').toLowerCase();
        const byText = (re) => list.find(o => re.test(o.text) || re.test(o.value));
        if (language === 'cpp' || language === 'c') {
            const num = (o) => { const m = /(\d{2})\s*$|\+\+\s*(\d{2})|c\s*(\d{2})/i.exec(o.text); return m ? +(m[1] || m[2] || m[3]) : 0; };
            const want = job.std ? A.parseStd(job.std, language) : null;
            const exact = want != null && list.find(o => num(o) === want);
            if (exact) return exact;
            return list.find(o => num(o) === 17) || list.slice().sort((a, b) => num(b) - num(a))[0];
        }
        if (language === 'python') return byText(/cpython/i) || byText(/python/i) || list[0];
        if (language === 'rust') return byText(/2021/) || list[list.length - 1];
        return null;                                         // other languages: keep the page's default
    }

    /** Summary table of the result page as { 'status': 'READY', 'result': 'ACCEPTED', … }. */
    function summaryFields(doc) {
        const fields = {};
        const rows = doc.querySelectorAll('table.summary-table tr, .content table tr');
        rows.forEach(tr => {
            const cells = tr.children;
            if (!cells || cells.length !== 2) return;
            const key = text(cells[0]).replace(/:\s*$/, '').toLowerCase();
            if (key && !(key in fields)) fields[key] = text(cells[1]);
        });
        return fields;
    }

    /** Rows of the "Test results" table: [{ n, verdict, timeMs }]. */
    function testRows(doc) {
        for (const table of doc.querySelectorAll('table')) {
            const rows = Array.from(table.querySelectorAll('tr'));
            const head = rows.find(r => r.querySelector('th')) || rows[0];
            if (!head) continue;
            const names = Array.from(head.children).map(c => text(c).toLowerCase());
            const iTest = names.findIndex(n => /^(test|#)/.test(n));
            const iVerdict = names.findIndex(n => /verdict|result/.test(n));
            if (iTest < 0 || iVerdict < 0) continue;
            const iTime = names.findIndex(n => /time/.test(n));
            const out = [];
            rows.forEach(tr => {
                if (tr === head || tr.querySelector('th')) return;
                const c = tr.children;
                const n = /(\d+)/.exec(text(c[iTest]));
                if (!n || !c[iVerdict]) return;
                out.push({ n: +n[1], verdict: text(c[iVerdict]), timeMs: iTime >= 0 ? A.parseTimeMs(text(c[iTime])) : null });
            });
            return out;
        }
        return [];
    }

    const adapter = {
        id: 'cses',
        name: 'CSES',
        hosts: ['cses.fi'],

        // ── pure: also runs in the worker ──────────────────────────────────────────────────
        classify(url) {
            const u = parse(url);
            if (!u) return { kind: 'other' };
            if (TASK_PATH.test(u.pathname)) return { kind: 'problem' };
            if (SUBMIT_PATH.test(u.pathname)) return { kind: 'submit' };
            if (RESULT_PATH.test(u.pathname)) return { kind: 'status' };
            return { kind: 'other' };
        },

        // UNVERIFIED for courses: /problemset/submit/<id>/ is certain, /<course>/submit/<id>/ follows the same pattern.
        submitUrl(problemUrl) {
            const u = parse(problemUrl);
            const ref = taskRef(problemUrl);
            return u && ref ? `${u.origin}/${ref.course}/submit/${ref.id}/` : null;
        },

        // ── DOM: content script only ───────────────────────────────────────────────────────
        parseProblem(doc, url) {
            const md = doc.querySelector('.content .md');
            const constraints = doc.querySelector('.task-constraints');
            const title = text(doc.querySelector('.title-block h1'));
            if (!md || !constraints || !title) return null;

            let timeText = '', memText = '';
            const items = Array.from(constraints.querySelectorAll('li'));
            items.forEach((li, i) => {
                const label = text(li.querySelector('b'));
                const value = text(li).slice(label.length).replace(/^[\s:]+/, '');
                if (/time|aika/i.test(label) || (!label && i === 0)) timeText = timeText || value;
                else if (/mem|muisti/i.test(label) || (!label && i === 1)) memText = memText || value;
            });
            if (!timeText && items[0]) timeText = text(items[0]).replace(/^[^:]*:/, '');
            if (!memText && items[1]) memText = text(items[1]).replace(/^[^:]*:/, '');
            const memKb = A.parseMemoryKb(memText);

            // Examples: in each section (between <h1> headings) every two consecutive <pre> are an
            // input and an output. A section with a single <pre> (a code sample) is not an example.
            const tests = [];
            let group = [];
            const flush = () => {
                if (group.length >= 2) {
                    for (let i = 0; i + 1 < group.length; i += 2) {
                        tests.push({ input: ensureNewline(preText(group[i])), output: ensureNewline(preText(group[i + 1])) });
                    }
                }
                group = [];
            };
            Array.from(md.children).forEach(el => {
                if (/^H[1-6]$/.test(el.tagName)) flush();
                else if (el.tagName === 'PRE') group.push(el);
            });
            flush();

            const heading = doc.querySelector('.title-block h3');
            return {
                name: title,
                group: text(heading) || 'CSES Problem Set',
                url: String(url).replace(/#.*$/, ''),
                timeLimit: timeText ? A.parseTimeMs(timeText) : null,
                memoryLimit: memKb == null ? null : Math.round(memKb / 1024),
                tests
            };
        },

        // Logged out the header shows <a class="account" href="/login">Login</a> (verified on the real site).
        // Logged in it shows the user's account link / a logout link (UNVERIFIED wording, so test the negative).
        isLoggedIn(doc) {
            const account = doc.querySelector('.controls a.account');
            if (account) return !/\/login\b/.test(account.getAttribute('href') || '');
            return !!doc.querySelector('a[href*="/logout"]');
        },

        async fillAndSubmit(doc, job, h) {
            const fileInput = await h.waitFor(() => doc.querySelector('input[type="file"][name="file"], input[type="file"]'), 6000);
            const form = fileInput && fileInput.form;
            if (!form) throw h.error('form-not-found', 'The CSES submit form was not found. Open the task on CSES, check that you can submit it, then try again.');
            const langSelect = form.querySelector('select#lang, select[name="lang"]');
            if (!langSelect) throw h.error('form-not-found', 'The language list was not found on the CSES submit page.');

            // 1) language
            const options = Array.from(langSelect.options).map(o => ({ value: o.value, text: text(o) }));
            const choice = h.pickLanguage(options, job, null);
            if (!choice) {
                throw h.error('language-not-found', `CSES has no ${job.language || 'cpp'} option for this task. Choose another language, or submit by hand.`);
            }
            h.setValue(langSelect, choice.value);   // fires input + change: the page fills the option select

            // 2) language option (C++ standard, CPython/PyPy, Rust edition). UNVERIFIED which element
            // and when: take any other <select> of the form and wait until it holds this language's choices.
            const language = String(job.language || 'cpp').toLowerCase();
            const expect = OPTION_EXPECT[language];
            const optionSelect = () => form.querySelector('select#option, select[name="option"]') ||
                Array.from(form.querySelectorAll('select')).find(s => s !== langSelect) || null;
            const settled = () => {
                const sel = optionSelect();
                if (!sel) return null;
                const opts = Array.from(sel.options);
                return !expect || opts.some(o => expect.test(text(o)) || expect.test(o.value)) ? sel : null;
            };
            let sel = await h.waitFor(settled, expect ? 4000 : 600);
            if (!sel) sel = optionSelect();
            if (sel && !(expect && !settled())) {
                const opts = Array.from(sel.options).map(o => ({ value: o.value, text: text(o), disabled: o.disabled }));
                const pick = pickOption(opts, job);
                if (pick) h.setValue(sel, pick.value);
            }

            // 3) the file
            h.setFile(fileInput, submitFileName(job), job.source);
            if (!fileInput.files || !fileInput.files.length) throw h.error('form-not-found', 'The browser did not accept the source file for the CSES form.');

            if (!job.autoSubmit) return;            // fill only: the user presses Submit

            await h.aboutToSubmit();
            const button = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
            if (form.requestSubmit) form.requestSubmit(button || undefined);
            else form.submit();
        },

        // UNVERIFIED element: the submit page shown again with a message. Only a submit page counts.
        readSubmitError(doc, url) {
            if (this.classify(url).kind !== 'submit') return null;
            const el = doc.querySelector('.content .error, .content .alert, .content .alert-error, .content .warning, .content .notification');
            const msg = text(el);
            return msg || null;
        },

        readVerdict(doc, url, job) {
            const u = parse(url);
            const m = u && RESULT_PATH.exec(u.pathname);
            if (!m) return null;                    // only a /result/<id>/ page shows a verdict
            const submissionUrl = `${u.origin}${u.pathname}`;

            const fields = summaryFields(doc);
            const status = fields.status || '';
            const result = fields.result || '';
            if (!status && !result) return null;

            // The page links the task; ignore a result page of another task.
            const want = taskRef(job && job.url);
            const taskLink = doc.querySelector('table.summary-table a[href*="/task/"], .content table a[href*="/task/"]');
            const got = taskLink && taskRef(new URL(taskLink.getAttribute('href'), url).href);
            if (want && got && want.id !== got.id) return null;

            const rows = testRows(doc);
            const done = status ? /^\s*ready\s*$/i.test(status) && !!result : !A.isPendingVerdict(result);
            if (!done) {
                const text0 = status || result;
                return { final: false, code: null, text: text0, test: rows.length || null, timeMs: null, memoryKb: null, points: null, submissionUrl };
            }

            const code = A.normalizeVerdict(result);
            const firstBad = rows.find(r => A.normalizeVerdict(r.verdict) !== 'AC' && !A.isPendingVerdict(r.verdict));
            const times = rows.map(r => r.timeMs).filter(t => t != null);
            return {
                final: true,
                code,
                text: result,
                test: code === 'AC' || code === 'CE' || !firstBad ? null : firstBad.n,
                timeMs: times.length ? Math.max(...times) : null,
                memoryKb: null,                     // CSES shows no per-submission memory
                points: null,
                submissionUrl
            };
        }
    };

    A.register(adapter);
    if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
