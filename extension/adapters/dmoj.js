/*
 * DMOJ-family adapter: VNOJ (oj.vnoi.info), LQDOJ (lqdoj.edu.vn) and DMOJ (dmoj.ca).
 *
 * The three sites run forks of DMOJ/online-judge (VNOJ = VNOI-Admin/OJ, LQDOJ = LQDJudge/online-judge).
 * Written from real anonymous pages saved under test/fixtures/dmoj/ (problem statements) and, for
 * login-only pages (submit form, /submission/<id>), from the forks' templates — each fixture says
 * at the top whether it is REAL or RECONSTRUCTED and from which files/commits.
 *
 * URLs (the same on all three):
 *   /problem/<code>                 problem (also inside a contest: the site remembers that the user joined it)
 *   /problem/<code>/submit          submit form (/problem/<code>/resubmit/<id> too); a POST that fails
 *                                   re-renders the form here, or a bare 429/403/"generic message" page
 *   /submission/<id>                where the submit redirects: a live page (websocket → #test-cases reloaded)
 *
 * Where the sites differ:
 *   problem page   VNOJ/DMOJ: .problem-info-entry .pi-value ("7.5s", "512M") in the right column.
 *                  LQDOJ: .info-block .new-pi-value above the statement.
 *   samples        VNOJ/DMOJ: <h4>Sample Input 1</h4><pre><code>…   LQDOJ: .admonition blocks with
 *                  <details><summary>Input</summary><pre>… ; tables and "Ví dụ" headings are also handled.
 *   submit form    VNOJ: also a file input for file-only languages (Scratch); never fill both (the form
 *                  rejects "missing or redundant"). LQDOJ: #id_source_file for Output/Scratch, and a
 *                  countdown that keeps the button disabled in contests.
 *   verdict        LQDOJ: #overall-row.overall-result-<CODE> once graded. VNOJ/DMOJ: no overall verdict
 *                  element when test cases are visible — the result is the worst test case status
 *                  (the judge's own rule) and "Resources: …s, … MB / Final score: a/b (p/q points)";
 *                  when cases are hidden, .sub-result.<CODE>. Grading shows a .fa-spinner (VNOJ/DMOJ).
 *
 * Must not touch the DOM at load time: the service worker imports this file too.
 */
(function (root) {
    'use strict';

    const A = root.SamekoAdapters;

    const PROBLEM_PATH = /^\/problem\/([^/?#]+)\/?$/;
    const SUBMIT_PATH = /^\/problem\/([^/?#]+)\/(?:submit|resubmit\/\d+)\/?$/;
    const SUBMISSION_PATH = /^\/submission\/(\d+)\/?$/;
    const STATUS_PATH = /^\/(?:submission\/\d+|submissions(?:\/.*)?|problem\/[^/]+\/(?:submissions|rank)(?:\/.*)?|contest\/[^/]+\/submissions(?:\/.*)?)\/?$/;

    const SITES = { 'oj.vnoi.info': 'VNOJ', 'lqdoj.edu.vn': 'LQDOJ', 'dmoj.ca': 'DMOJ' };

    function parse(url) {
        try { return new URL(url); } catch (_) { return null; }
    }

    function siteName(url) {
        const u = parse(url);
        const host = u ? u.hostname.toLowerCase().replace(/^www\./, '') : '';
        return SITES[host] || 'DMOJ';
    }

    /** The problem code of a problem or submit URL, or null. */
    function problemCode(url) {
        const u = parse(url);
        if (!u) return null;
        const m = PROBLEM_PATH.exec(u.pathname) || SUBMIT_PATH.exec(u.pathname);
        return m ? m[1] : null;
    }

    function cleanUrl(url) {
        const u = parse(url);
        if (!u) return String(url || '');
        u.hash = '';
        u.search = '';
        return u.href;
    }

    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const num = (s) => parseFloat(String(s).replace(',', '.'));

    /** Text of a block with <br> and block elements as line breaks (no innerText: fixtures have no layout). */
    function blockText(el) {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        copy.querySelectorAll('p, div, li, tr').forEach(d => d.append('\n'));
        return copy.textContent;
    }

    /** Normalise line ends, drop leading blank lines and trailing whitespace, end with exactly one "\n". */
    function oneNewline(s) {
        return String(s || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
    }

    // ── Problem page ───────────────────────────────────────────────────────────────────────
    /** The value of the info entry whose icon is one of `icons` (language-independent), else by label. */
    function infoValue(doc, icons, label) {
        const entries = Array.from(doc.querySelectorAll('.problem-info-entry, .info-block'));
        let e = entries.find(x => icons.some(c => x.querySelector(`i.${c}`)));
        if (!e) e = entries.find(x => label.test(text(x.querySelector('.pi-name'))));
        return e ? text(e.querySelector('.pi-value, .new-pi-value')) : '';
    }

    const SAMPLE_IN = /^(?:sample|example)s?\s*(?:input|in)\b|^input\s*(?:sample|example)|^(?:input|đầu vào|dữ liệu vào|dữ liệu)\s*(?:mẫu|ví dụ)|^(?:ví dụ|mẫu)\s*(?:input|đầu vào|dữ liệu vào)|^(?:sample|ví dụ)\s*\d*\s*[-–:]?\s*(?:input|đầu vào)/i;
    const SAMPLE_OUT = /^(?:sample|example)s?\s*(?:output|out)\b|^output\s*(?:sample|example)|^(?:output|đầu ra|dữ liệu ra|kết quả)\s*(?:mẫu|ví dụ)|^(?:ví dụ|mẫu)\s*(?:output|đầu ra|dữ liệu ra|kết quả)|^(?:sample|ví dụ)\s*\d*\s*[-–:]?\s*(?:output|đầu ra)/i;
    const SAMPLE_SECTION = /^(?:samples?|examples?|sample tests?|ví dụ|các ví dụ|dữ liệu mẫu|test mẫu|bộ test mẫu|input\s*\/\s*output mẫu)\b/i;
    const NOT_SAMPLE = /solution|lời giải|giải thích|explanation|note|ghi chú|chú thích/i;
    const IN_CELL = /^(?:input|sample input|đầu vào|dữ liệu vào|dữ liệu|stdin|[\w-]*\.inp)\b/i;
    const OUT_CELL = /^(?:output|sample output|đầu ra|dữ liệu ra|kết quả|stdout|[\w-]*\.out)\b/i;

    /** A heading-like element: h1–h6, or a paragraph that is only bold text ("**Sample Input**"). */
    function headingText(el) {
        if (/^H[1-6]$/.test(el.tagName)) return text(el);
        if (el.tagName === 'P') {
            const b = el.querySelector('strong, b');
            const t = text(el);
            if (b && t && t === text(b) && t.length < 60) return t;
        }
        return null;
    }

    /** Statement <pre>s that are data, not highlighted solution code. */
    const isDataPre = (pre) => !pre.closest('.codehilite, .highlight, .sourceCode');

    /** LQDOJ: <div class="admonition"><details><summary>Input</summary><pre>… */
    function admonitionSamples(stmt) {
        const tests = [];
        for (const box of stmt.querySelectorAll('.admonition')) {
            let input = null, output = null;
            for (const d of box.querySelectorAll('details')) {
                const label = text(d.querySelector('summary'));
                const pre = d.querySelector('pre');
                if (!pre) continue;
                if (input == null && /^(?:input|đầu vào|dữ liệu vào|vào)\b/i.test(label)) input = blockText(pre);
                else if (output == null && /^(?:output|đầu ra|dữ liệu ra|kết quả|ra)\b/i.test(label)) output = blockText(pre);
            }
            if (input != null && output != null) tests.push({ input: oneNewline(input), output: oneNewline(output) });
        }
        return tests;
    }

    /** Headings + <pre>: "Sample Input 1" / "Sample Output 1" pairs, or a "Ví dụ"/"Sample" section of pre pairs. */
    function headingSamples(stmt) {
        const nodes = Array.from(stmt.querySelectorAll('h1, h2, h3, h4, h5, h6, p, pre'));
        const inputs = [], outputs = [], section = [];
        let mode = null;                                  // 'in' | 'out' | 'section' | null
        for (const el of nodes) {
            if (el.tagName === 'PRE') {
                if (!isDataPre(el) || !mode) continue;
                if (mode === 'in') { inputs.push(blockText(el)); mode = null; }
                else if (mode === 'out') { outputs.push(blockText(el)); mode = null; }
                else section.push(blockText(el));
                continue;
            }
            const h = headingText(el);
            if (h == null) continue;
            if (NOT_SAMPLE.test(h)) mode = null;
            else if (SAMPLE_IN.test(h)) mode = 'in';
            else if (SAMPLE_OUT.test(h)) mode = 'out';
            else if (SAMPLE_SECTION.test(h)) mode = 'section';
            else if (/^H[1-6]$/.test(el.tagName)) mode = null;   // any other heading ends a sample section
        }
        const tests = [];
        if (inputs.length && inputs.length === outputs.length) {
            inputs.forEach((x, i) => tests.push({ input: oneNewline(x), output: oneNewline(outputs[i]) }));
        } else if (section.length >= 2) {
            for (let i = 0; i + 1 < section.length; i += 2) tests.push({ input: oneNewline(section[i]), output: oneNewline(section[i + 1]) });
        }
        return tests;
    }

    /** Tables with an Input column and an Output column, one sample per body row. */
    function tableSamples(stmt) {
        const tests = [];
        for (const table of stmt.querySelectorAll('table')) {
            const rows = Array.from(table.querySelectorAll('tr'));
            if (rows.length < 2) continue;
            const head = Array.from(rows[0].children).map(text);
            const iIn = head.findIndex(t => IN_CELL.test(t));
            const iOut = head.findIndex(t => OUT_CELL.test(t));
            if (iIn < 0 || iOut < 0 || iIn === iOut) continue;
            for (const tr of rows.slice(1)) {
                const cells = Array.from(tr.children);
                if (cells.length <= Math.max(iIn, iOut)) continue;
                const cellText = (c) => { const pre = c.querySelector('pre'); return blockText(pre || c); };
                const input = cellText(cells[iIn]), output = cellText(cells[iOut]);
                if (input.trim() || output.trim()) tests.push({ input: oneNewline(input), output: oneNewline(output) });
            }
        }
        return tests;
    }

    function contestName(doc) {
        const a = doc.querySelector('#contest-info a');
        if (!a) return '';
        const first = Array.from(a.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
        return (first ? first.textContent : text(a)).replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
    }

    // ── Submit form ────────────────────────────────────────────────────────────────────────
    // Option texts are the language's name: "C++17", "C++20", "C11", "Python 3", "PyPy 3", "Pascal",
    // "Java 8", "Node JS"… GCC-named C++ first; anything else that says C++ only as a fallback.
    const LANGUAGE_PREFERENCES = {
        cpp: [/^\s*(?:GNU\s*)?(?:C|G)\+\+\s*\d{2}\b(?!.*clang)/i, /\bG\+\+|^\s*C\+\+/i, /C\+\+/i],
        python: [/^\s*python\s*3/i, /^\s*python\s*$/i, /^\s*pypy\s*3/i],
        javascript: [/node\.?\s*js/i, /javascript|\bjs\b|\bV8\b/i]
    };

    function findForm(doc) {
        return doc.querySelector('form#problem_submit') ||
            Array.from(doc.querySelectorAll('form')).find(f => f.querySelector('select[name="language"]') && f.querySelector('[name="source"]')) || null;
    }

    function languageOptions(select) {
        return Array.from(select.options).filter(o => !o.disabled && o.value !== '')
            .map(o => ({ value: o.value, text: o.getAttribute('data-name') || text(o), fileOnly: o.getAttribute('data-fileonly') === 'True' }));
    }

    const CAPTCHA = '.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], [name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]';

    function captchaToken(doc) {
        const el = doc.querySelector('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]');
        return el && el.value ? el.value.trim() : '';
    }

    /** The message of a page shown instead of the form (429 "too many submissions", banned, 403…). */
    function pageMessage(doc) {
        const content = doc.querySelector('#content-body') || doc.querySelector('main#content');
        const h = content ? content.querySelector('h3, h1') : doc.querySelector('body > h1, h1');
        const t = text(h);
        return t || null;
    }

    // ── Verdict ────────────────────────────────────────────────────────────────────────────
    // The judge's own order for "the worst case decides the result" (DMOJ judge_handler status_codes).
    const SEVERITY = ['SC', 'AC', 'PAC', 'WA', 'MLE', 'TLE', 'IR', 'RTE', 'OLE'];
    const CODE_OF = { AC: 'AC', PAC: 'PARTIAL', WA: 'WA', MLE: 'MLE', TLE: 'TLE', IR: 'RE', RTE: 'RE', RE: 'RE',
        OLE: 'OLE', CE: 'CE', IE: 'IE', AB: 'OTHER', SC: 'OTHER' };
    const NAME_OF = { AC: 'Accepted', PAC: 'Partially accepted', WA: 'Wrong answer', MLE: 'Memory limit exceeded',
        TLE: 'Time limit exceeded', IR: 'Invalid return', RTE: 'Runtime error', OLE: 'Output limit exceeded',
        CE: 'Compilation error', IE: 'Internal error', AB: 'Aborted' };

    /** "case-WA" → "WA" (ignores case-bad, case-icons…). */
    function statusClass(el) {
        if (!el) return null;
        for (const c of el.classList) {
            const m = /^(?:case|overall-result)-([A-Z]{2,3})$/.exec(c);
            if (m && (SEVERITY.includes(m[1]) || CODE_OF[m[1]])) return m[1];
        }
        return null;
    }

    /** Test case rows (not batch header rows), each with its status. */
    function caseRows(tc) {
        return Array.from(tc.querySelectorAll('tr.case-row[id]')).filter(tr => tr.id !== 'overall-row').map(tr => {
            const span = Array.from(tr.querySelectorAll('td span[class*="case-"]')).find(s => statusClass(s));
            return { tr, status: statusClass(span), title: span ? (span.getAttribute('title') || text(span)) : '' };
        }).filter(r => r.status);
    }

    /** Case statuses from the icon strip when the table is not shown. */
    function iconStatuses(tc) {
        return Array.from(tc.querySelectorAll('.fa-check[class*="case-"], .fa-times[class*="case-"], span.case-icons, span.case-SC'))
            .map(statusClass).filter(Boolean);
    }

    function worst(statuses) {
        let best = null;
        for (const s of statuses) if (SEVERITY.includes(s) && (best == null || SEVERITY.indexOf(s) > SEVERITY.indexOf(best))) best = s;
        return best;
    }

    const SCORE_RE = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g;

    /** VNOJ/DMOJ "Final score: 3/10 (0.3/1 points)" → { cases, total, points } from the last match. */
    function finalScore(tc) {
        let m, last = null;
        const all = tc.textContent.replace(/\s+/g, ' ');
        SCORE_RE.lastIndex = 0;
        while ((m = SCORE_RE.exec(all))) last = m;
        return last ? { cases: num(last[1]), total: num(last[2]), points: num(last[3]) } : null;
    }

    /** VNOJ/DMOJ "Resources: <span title="0.012s">0.012s,</span> 3.52 MB<br>" (direct children of #test-cases). */
    function resources(tc) {
        const span = Array.from(tc.children).find(el => el.tagName === 'SPAN' && /^\d+(?:\.\d+)?(?:e-?\d+)?s$/.test(el.getAttribute('title') || '') ||
            (el.tagName === 'SPAN' && /^---,?$/.test(text(el)) && el.previousElementSibling && el.previousElementSibling.tagName === 'B'));
        if (!span) return { timeMs: null, memoryKb: null };
        const title = span.getAttribute('title');
        let mem = '';
        for (let n = span.nextSibling; n && n.nodeName !== 'BR'; n = n.nextSibling) mem += n.textContent;
        return { timeMs: title ? Math.round(parseFloat(title) * 1000) : null, memoryKb: A.parseMemoryKb(mem.trim()) };
    }

    function result(final, code, txt, extra) {
        return Object.assign({ final, code, text: txt, test: null, timeMs: null, memoryKb: null, points: null }, extra || {});
    }

    /** The first non-AC case (1-based, counted over all rows) — the test the judge reports. */
    function firstFailing(rows) {
        const i = rows.findIndex(r => !['AC', 'PAC', 'SC'].includes(r.status));
        return i < 0 ? null : i + 1;
    }

    function readTestCases(tc) {
        const rows = caseRows(tc);

        // Internal error (both): a red h3 from internal-error-message.html.
        const ie = tc.querySelector('h3.red, h3[style*="red"]');
        if (ie && !rows.length) return result(true, 'IE', text(ie) || NAME_OF.IE);

        // LQDOJ, graded: the overall row carries the result.
        const overall = tc.querySelector('#overall-row');
        if (overall) {
            const st = statusClass(overall) || statusClass(overall.querySelector('[class*="case-"]'));
            const label = text(overall.querySelector('span[class*="case-"]')) || NAME_OF[st] || st || '';
            const cells = Array.from(overall.children);
            const pointCell = cells.find(c => /\d\s*\/\s*\d/.test(text(c)) && c !== cells[0]) || null;
            const pm = pointCell ? /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(text(pointCell)) : null;
            const timeSpan = overall.querySelector('span[title$="s"]');
            const memCell = cells[cells.length - 1];
            const memCopy = memCell ? memCell.cloneNode(true) : null;
            if (memCopy) memCopy.querySelectorAll('.col-title').forEach(t => t.remove());
            let code = CODE_OF[st] || A.normalizeVerdict(label);
            if (code === 'AC' && pm && num(pm[1]) < num(pm[2])) code = 'PARTIAL';
            return result(true, code, pm ? `${label} (${pm[1]}/${pm[2]})` : label, {
                test: code === 'AC' ? null : firstFailing(rows),
                timeMs: timeSpan ? Math.round(parseFloat(timeSpan.getAttribute('title')) * 1000) : null,
                memoryKb: memCopy ? A.parseMemoryKb(text(memCopy)) : null,
                points: pm ? num(pm[1]) : null
            });
        }

        // Grading (VNOJ/DMOJ show a spinner while not graded).
        const spinner = tc.querySelector('.fa-spinner');
        const h3s = Array.from(tc.querySelectorAll('h3'));
        const h4 = tc.querySelector('h4');
        if (spinner) {
            const n = rows.length || iconStatuses(tc).length;
            return result(false, null, n ? `Judging, test ${n}` : 'Judging', { test: n || null });
        }
        // Queued / processing: only an <h4> ("We are waiting for a suitable judge…", "…being processed…").
        if (!h3s.length) return h4 ? result(false, null, text(h4) || 'In queue') : null;

        // Compile error: one h3 directly followed by the compiler output (warnings come with a second h3).
        const first = h3s[0];
        const next = first.nextElementSibling;
        if (h3s.length === 1 && next && next.tagName === 'PRE' && !rows.length) {
            return result(true, 'CE', text(first) || NAME_OF.CE);
        }

        // LQDOJ: results hidden for this problem.
        if (first.querySelector('i.fa-check-circle') && !rows.length && !tc.querySelector('table')) {
            const p = tc.querySelector('p');
            return result(true, 'OTHER', [text(first), text(p)].filter(Boolean).join(' — '));
        }

        // VNOJ: test cases hidden — the overall result box.
        const box = tc.querySelector('.sub-result');
        if (box) {
            const st = statusClass({ classList: Array.from(box.classList).map(c => `case-${c}`) });
            const label = text(box) || NAME_OF[st] || '';
            if (!st) return result(false, null, label || 'Judging');
            return result(true, CODE_OF[st] || A.normalizeVerdict(label), label);
        }

        const statuses = rows.length ? rows.map(r => r.status) : iconStatuses(tc);
        const score = finalScore(tc);
        const lqTable = tc.querySelector('table.testcases-table');
        // LQDOJ without an overall row: graded only when the "is_graded" <br>s follow the table.
        const lqGraded = lqTable && lqTable.nextElementSibling && lqTable.nextElementSibling.tagName === 'BR';
        const aborted = Array.from(tc.querySelectorAll(':scope > b')).find(b => /abort|hủy|huỷ|dừng/i.test(text(b)));
        if (aborted) return result(true, 'OTHER', text(aborted));
        if (!score && !(lqTable && lqGraded)) {
            if (lqTable || statuses.length) return result(false, null, statuses.length ? `Judging, test ${statuses.length}` : 'Judging', { test: statuses.length || null });
            const alert = tc.querySelector('.alert');
            return alert ? result(true, 'OTHER', text(alert)) : null;
        }

        const w = worst(statuses) || 'AC';
        let code = CODE_OF[w] || 'OTHER';
        if (code === 'AC' && score && score.cases < score.total) code = 'PARTIAL';
        const failing = rows.find(r => r.status === w && w !== 'AC');
        const label = (failing && failing.title) || NAME_OF[w] || w;
        const res = resources(tc);
        return result(true, code, score ? `${label} (${fmt(score.cases)}/${fmt(score.total)})` : label, {
            test: code === 'AC' ? null : (rows.length ? firstFailing(rows) : (statuses.findIndex(s => !['AC', 'PAC', 'SC'].includes(s)) + 1) || null),
            timeMs: res.timeMs,
            memoryKb: res.memoryKb,
            points: score ? score.cases : null
        });
    }

    const fmt = (n) => String(Math.round(n * 1000) / 1000);

    const adapter = {
        id: 'dmoj',
        name: 'VNOJ / LQDOJ / DMOJ',
        hosts: ['oj.vnoi.info', 'lqdoj.edu.vn', 'dmoj.ca'],   // exact hosts; keep in sync with manifest.json

        // ── pure: also runs in the worker ──────────────────────────────────────────────────
        classify(url) {
            const u = parse(url);
            if (!u) return { kind: 'other' };
            if (PROBLEM_PATH.test(u.pathname)) return { kind: 'problem' };
            if (SUBMIT_PATH.test(u.pathname)) return { kind: 'submit' };
            if (STATUS_PATH.test(u.pathname)) return { kind: 'status' };
            return { kind: 'other' };
        },

        /** "VNOJ" | "LQDOJ" | "DMOJ" for a URL (for messages; see the report on content/main.js). */
        siteName(url) { return siteName(url); },

        submitUrl(problemUrl) {
            const u = parse(problemUrl);
            const code = problemCode(problemUrl);
            return u && code ? `${u.origin}/problem/${code}/submit` : null;
        },

        // ── DOM: content script only ───────────────────────────────────────────────────────
        parseProblem(doc, url) {
            const title = doc.querySelector('.problem-title h2') || doc.querySelector('#content .problem-title h2, h2.title-row');
            const stmt = doc.querySelector('#content-left .content-description') || doc.querySelector('.content-description');
            if (!title || !stmt) return null;            // not a problem page (login wall, 404, list)
            let tests = [];
            try {
                tests = admonitionSamples(stmt);
                if (!tests.length) tests = headingSamples(stmt);
                if (!tests.length) tests = tableSamples(stmt);
            } catch (_) { tests = []; }
            const site = siteName(url);
            const contest = contestName(doc);
            const mem = A.parseMemoryKb(infoValue(doc, ['fa-server'], /memory|bộ nhớ/i));
            const time = infoValue(doc, ['fa-clock-o', 'fa-clock'], /time|thời gian/i);
            return {
                name: text(title),
                group: contest ? `${site} - ${contest}` : site,
                url: cleanUrl(url),
                timeLimit: time ? A.parseTimeMs(time) : null,
                memoryLimit: mem == null ? null : Math.round(mem / 1024),
                tests
            };
        },

        isLoggedIn(doc) {
            // DMOJ/VNOJ: "Hello, <name>." links to /user and a logout form; LQDOJ: avatar + #logout-form.
            return !!doc.querySelector('form[action*="/accounts/logout"], #logout-form, #userlink_dropdown, #user-links a[href="/user"], #user-links a[href="/user/"]');
        },

        /** Test hook and fill step: the <option> fillAndSubmit would choose → { value, text } or null. */
        chooseLanguage(doc, url, job) {
            const form = findForm(doc);
            const select = form && form.querySelector('select[name="language"]');
            if (!select) return null;
            const options = languageOptions(select);
            const pick = A.pickLanguage(options.filter(o => !o.fileOnly), job, LANGUAGE_PREFERENCES) ||
                A.pickLanguage(options, job, LANGUAGE_PREFERENCES);
            return pick ? { value: pick.value, text: pick.text } : null;
        },

        async fillAndSubmit(doc, job, h) {
            const site = siteName(job.url);
            const form = await h.waitFor(() => findForm(doc), 8000);
            if (!form) {
                const msg = pageMessage(doc);
                if (msg) throw h.error('rejected', `${site}: ${msg}`);
                throw h.error('form-not-found', `The ${site} submit form was not found. Open the problem in this browser and check that you can submit to it (join the contest first for a contest problem), then try again.`);
            }
            const select = form.querySelector('select[name="language"]');
            if (!select) {
                const why = text(form.querySelector('span[style*="red"]'));
                throw h.error('form-not-found', why ? `${site}: ${why}` : `The language list was not found on the ${site} submit page.`);
            }
            const choice = this.chooseLanguage(doc, job.url, job);
            if (!choice) {
                const names = languageOptions(select).map(o => o.text).join(', ');
                throw h.error('language-not-found', `${site} does not accept ${job.language}${job.std ? ` (${job.std})` : ''} for this problem${names ? ` (allowed: ${names})` : ''}.`);
            }
            const option = Array.from(select.options).find(o => o.value === choice.value);
            if (select.value !== choice.value) h.setValue(select, choice.value);   // jQuery/select2 listen to "change"

            const source = String(job.source || '').replace(/\r\n?/g, '\n');
            const fileOnly = option && option.getAttribute('data-fileonly') === 'True';
            const area = form.querySelector('textarea[name="source"]');
            if (fileOnly || !area) {
                const file = form.querySelector('input[type="file"][name="submission_file"], input[type="file"][name="source_file"]');
                if (!file) throw h.error('form-not-found', `The source field was not found on the ${site} submit page.`);
                h.setFile(file, job.fileName || 'main.cpp', source);
            } else {
                // The form posts textarea#id_source; django-ace copies Ace → textarea on every change.
                // Changing the language (or page load) may fetch a language template that overwrites the
                // editor when it lands, so let it land first, then set ours, then check once more.
                const put = async () => { await h.setEditorText('#ace_source', source); h.setValue(area, source); };
                await h.waitFor(() => area.value.trim() !== '', 1200);
                await put();
                if (await h.waitFor(() => area.value.replace(/\r\n?/g, '\n') !== source, 500)) await put();
            }

            if (!job.autoSubmit) return;                // fill only: the user presses Submit

            if (form.querySelector(CAPTCHA) && !captchaToken(doc)) {
                const ok = await h.waitFor(() => captchaToken(doc), 40000);
                if (!ok) throw h.error('timeout', `${site} is asking you to confirm you are human. Complete the check in the ${site} tab, then submit again.`);
            }

            const button = form.querySelector('input[type="submit"], button[type="submit"]');
            if (button && button.disabled) {
                // LQDOJ counts down between contest submissions; otherwise no submissions are left.
                const ok = await h.waitFor(() => !button.disabled, 20000);
                if (!ok) {
                    const why = text(doc.querySelector('#countdown-timer')) || text(doc.querySelector('.alert-warning'));
                    throw h.error('rejected', `${site} does not let you submit to this problem now${why ? ` (${why.replace(/^x\s*/, '')})` : ''}.`);
                }
            }

            await h.aboutToSubmit();                    // before navigating: stage → watch
            if (button) button.click();
            else if (form.requestSubmit) form.requestSubmit();
            else form.submit();
        },

        readSubmitError(doc, url) {
            if (this.classify(url).kind !== 'submit') return null;
            const form = findForm(doc);
            if (form) {
                const msgs = Array.from(form.querySelectorAll('ul.errorlist li, .errorlist li')).map(text).filter(Boolean);
                return msgs.length ? `${siteName(url)}: ${msgs.join(' ')}` : null;
            }
            if (!doc.body || !doc.body.firstElementChild) return null;       // still loading
            const msg = pageMessage(doc);
            return msg ? `${siteName(url)}: ${msg}` : null;
        },

        readVerdict(doc, url) {
            const u = parse(url);
            if (!u || !SUBMISSION_PATH.test(u.pathname)) return null;      // only the new submission's own page
            const tc = doc.querySelector('#test-cases');
            if (!tc) return null;
            const r = readTestCases(tc);
            if (!r) return null;
            r.submissionUrl = cleanUrl(url);
            return r;
        }
    };

    A.register(adapter);
    if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
