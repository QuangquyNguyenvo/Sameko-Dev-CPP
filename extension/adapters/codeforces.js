/*
 * Codeforces adapter (codeforces.com and the m1/m2/m3 mirrors).
 *
 * Written from real pages saved under test/fixtures/codeforces/ (problem pages, public status
 * tables). The submit form and "my submissions" need a login, so their fixtures are reconstructed
 * from open-source submitters (see the comment at the top of each fixture).
 *
 * Problem → submit page:
 *   /contest/<id>/problem/<i>              /contest/<id>/submit            select submittedProblemIndex
 *   /gym/<id>/problem/<i>                  /gym/<id>/submit                select submittedProblemIndex
 *   /problemset/gymProblem/<id>/<i>        /gym/<id>/submit                select submittedProblemIndex
 *   /group/<g>/contest/<id>/problem/<i>    /group/<g>/contest/<id>/submit  select submittedProblemIndex
 *   /edu/course/…/practice/contest/<id>/problem/<i>   …/practice/contest/<id>/submit
 *   /problemset/problem/<id>/<i>           /problemset/submit              text submittedProblemCode = "<id><i>"
 *   /problemsets/acmsguru/problem/99999/<n>  /problemsets/acmsguru/submit/99999/<n>   (code "<n>" if a text field is empty)
 * After submitting, Codeforces lands on the user's own status page (/contest/<id>/my,
 * /problemset/status?my=on, …): readVerdict reads its table.status-frame-datatable.
 *
 * Must not touch the DOM at load time: the service worker imports this file too.
 */
(function (root) {
    'use strict';

    const A = root.SamekoAdapters;

    const SEG = '([^/?#]+)';
    const IDX = '([A-Za-z0-9_]+)';
    // Each problem shape: path regex, and how to build its submit path / problem key.
    const PROBLEM_SHAPES = [
        { re: new RegExp(`^/contest/(\\d+)/problem/${IDX}/?$`), submit: m => `/contest/${m[1]}/submit`, contest: m => m[1], index: m => m[2], field: 'index' },
        { re: new RegExp(`^/gym/(\\d+)/problem/${IDX}/?$`), submit: m => `/gym/${m[1]}/submit`, contest: m => m[1], index: m => m[2], field: 'index' },
        { re: new RegExp(`^/problemset/gymProblem/(\\d+)/${IDX}/?$`), submit: m => `/gym/${m[1]}/submit`, contest: m => m[1], index: m => m[2], field: 'index' },
        { re: new RegExp(`^/group/${SEG}/contest/(\\d+)/problem/${IDX}/?$`), submit: m => `/group/${m[1]}/contest/${m[2]}/submit`, contest: m => m[2], index: m => m[3], field: 'index' },
        { re: new RegExp(`^(/edu/course/\\d+/lesson/\\d+/\\d+/practice/contest/(\\d+))/problem/${IDX}/?$`), submit: m => `${m[1]}/submit`, contest: m => m[2], index: m => m[3], field: 'index' },
        { re: new RegExp(`^/problemset/problem/(\\d+)/${IDX}/?$`), submit: () => '/problemset/submit', contest: m => m[1], index: m => m[2], field: 'code' },
        { re: /^\/problemsets\/acmsguru\/problem\/(\d+)\/(\d+)\/?$/, submit: m => `/problemsets/acmsguru/submit/${m[1]}/${m[2]}`, contest: m => m[1], index: m => m[2], field: 'sguru' }
    ];
    const SUBMIT_PATH = new RegExp('^(?:/(?:contest|gym)/\\d+/submit(?:/[^/]+)?|/group/[^/]+/contest/\\d+/submit(?:/[^/]+)?|' +
        '/edu/course/\\d+/lesson/\\d+/\\d+/practice/contest/\\d+/submit(?:/[^/]+)?|/problemset/submit(?:/\\d+/[^/]+)?|' +
        '/problemsets/acmsguru/submit(?:/\\d+/\\d+)?)/?$');
    const STATUS_PATH = new RegExp('^(?:/(?:contest|gym)/\\d+/(?:my|status|submission/\\d+)(?:/.*)?|' +
        '/group/[^/]+/contest/\\d+/(?:my|status|submission/\\d+)(?:/.*)?|' +
        '/edu/course/\\d+/lesson/\\d+/\\d+/practice/contest/\\d+/(?:my|status|submission/\\d+)(?:/.*)?|' +
        '/problemset/(?:status|submission/\\d+/\\d+)(?:/.*)?|/problemsets/acmsguru/(?:status|submission/\\d+/\\d+)(?:/.*)?|' +
        '/submissions/[^/]+(?:/.*)?)/?$');

    const STATE_KEY = 'sameko-cf-submit';     // sessionStorage: { jobId, at, baselineId } set just before submitting

    function parse(url) {
        try { return new URL(url); } catch (_) { return null; }
    }

    /** { shape, m, contest, index } for a problem URL, or null. */
    function problemOf(url) {
        const u = parse(url);
        if (!u) return null;
        for (const shape of PROBLEM_SHAPES) {
            const m = shape.re.exec(u.pathname);
            if (m) return { u, shape, m, contest: shape.contest(m), index: shape.index(m).toUpperCase() };
        }
        return null;
    }

    /** "1900/A": the same key for the contest, problemset, gym and group URL of one problem. */
    function problemKey(url) {
        const p = problemOf(url);
        return p ? `${p.contest}/${p.index}` : null;
    }

    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

    /** A sample <pre> as text: one line per .test-example-line div, or <br> → newline. No innerText. */
    function preText(pre) {
        const lines = pre.querySelectorAll('.test-example-line');
        let t;
        if (lines.length) {
            t = Array.from(lines).map(l => l.textContent).join('\n');
        } else {
            const copy = pre.cloneNode(true);
            copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
            copy.querySelectorAll('div, p').forEach(d => d.append('\n'));
            t = copy.textContent;
        }
        return oneNewline(t);
    }

    /** Normalise line ends, drop leading/trailing blank lines, end with exactly one "\n". */
    function oneNewline(s) {
        const t = String(s || '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
        return t + '\n';
    }

    /** The text of a header property (".time-limit") without its "time limit per test" label. */
    function propertyText(el) {
        if (!el) return '';
        const copy = el.cloneNode(true);
        copy.querySelectorAll('.property-title').forEach(t => t.remove());
        return text(copy);
    }

    function cleanUrl(url) {
        const u = parse(url);
        if (!u) return String(url || '');
        u.hash = '';
        u.search = '';
        return u.href;
    }

    function contestName(doc, url) {
        const path = (parse(url) || {}).pathname || '';
        if (path.startsWith('/edu/')) {
            const crumbs = Array.from(doc.querySelectorAll('.eduBreadcrumb > a')).map(text).filter(Boolean);
            crumbs.pop();
            if (crumbs.length) return crumbs.join(' - ');
        }
        const links = Array.from(doc.querySelectorAll('#sidebar .rtable th a, .rtable > tbody > tr > th > a'));
        const a = links.find(l => /\/(contest|gym)\/\d+\/?$/.test(l.getAttribute('href') || '')) || links[0];
        return a ? text(a) : '';
    }

    function parseSguru(doc, url) {
        const holder = doc.querySelector('.problemindexholder .ttypography') || doc.querySelector('.ttypography');
        if (!holder) return null;
        const all = holder.textContent.replace(/\s+/g, ' ');
        const tl = /time\s+limit(?:\s+per\s+test)?:\s*([\d.]+)\s*(sec|ms|s)/i.exec(all);
        const ml = /memory\s+limit(?:\s+per\s+test)?:\s*(\d+)\s*(KB|kilobytes|MB|megabytes)/i.exec(all);
        let pres = Array.from(holder.querySelectorAll('font > pre'));
        if (pres.length < 2) pres = Array.from(holder.querySelectorAll('pre'));
        const tests = [];
        for (let i = 0; i + 1 < pres.length; i += 2) tests.push({ input: preText(pres[i]), output: preText(pres[i + 1]) });
        return {
            name: text(holder.querySelector('h3, h4')),
            group: 'Codeforces - acm.sgu.ru archive',
            url: cleanUrl(url),
            timeLimit: tl ? A.parseTimeMs(`${tl[1]} ${tl[2]}`) : null,
            memoryLimit: ml ? Math.round(A.parseMemoryKb(`${ml[1]} ${ml[2]}`) / 1024) : null,
            tests
        };
    }

    // ── Verdict rows ───────────────────────────────────────────────────────────────────────
    const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

    /** "Nov/11/2026 10:36" (or "11.11.2026 10:36") in the page's utc_offset → epoch ms; null if unknown. */
    function rowTime(row, doc) {
        const span = row.querySelector('.format-time');
        const meta = doc.querySelector('meta[name="utc_offset"]');
        if (!span || !meta) return null;
        const off = /^([+-])(\d{1,2}):?(\d{2})$/.exec((meta.getAttribute('content') || '').trim());
        const t = text(span);
        let y, mo, d, hh, mm, m;
        if ((m = /^([A-Za-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(t)) && MONTHS[m[1].toLowerCase()] != null) {
            [y, mo, d, hh, mm] = [+m[3], MONTHS[m[1].toLowerCase()], +m[2], +m[4], +m[5]];
        } else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/.exec(t))) {
            [y, mo, d, hh, mm] = [+m[3], +m[2] - 1, +m[1], +m[4], +m[5]];
        } else {
            return null;
        }
        if (!off) return null;
        const offMs = (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +off[3]) * 60000;
        return Date.UTC(y, mo, d, hh, mm) - offMs;
    }

    function rowProblemKey(row, base) {
        const links = Array.from(row.querySelectorAll('td a[href*="/problem/"], td a[href*="/gymProblem/"]'));
        for (const a of links) {
            const k = problemKey(new URL(a.getAttribute('href'), base).href);
            if (k) return k;
        }
        return null;
    }

    /** What this tab remembered when it submitted the job (sessionStorage survives the redirect). */
    function submitState(doc, job) {
        const s = { at: job && Number.isFinite(job.submittedAt) ? job.submittedAt : null,
            baselineId: job && Number.isFinite(job.baselineId) ? job.baselineId : null };
        try {
            const store = doc.defaultView && doc.defaultView.sessionStorage;
            const saved = store ? JSON.parse(store.getItem(STATE_KEY) || 'null') : null;
            if (saved && saved.jobId === (job && job.id)) {
                if (s.at == null && Number.isFinite(saved.at)) s.at = saved.at;
                if (s.baselineId == null && Number.isFinite(saved.baselineId)) s.baselineId = saved.baselineId;
            }
        } catch (_) { /* storage blocked: match on the problem only */ }
        return s;
    }

    /** The highest submission id linked anywhere on the page (sidebar "last submissions"), or 0. */
    function maxSubmissionId(doc) {
        let max = 0;
        doc.querySelectorAll('a[href*="/submission/"], [data-submission-id]').forEach(el => {
            const m = /\/submission\/(?:\d+\/)?(\d+)/.exec(el.getAttribute('href') || '') || /^(\d+)$/.exec(el.getAttribute('data-submission-id') || '');
            if (m) max = Math.max(max, +m[1]);
        });
        return max;
    }

    // ── Language picking ───────────────────────────────────────────────────────────────────
    // Option texts seen in 2026: "C++17 (GCC 7-32)", "C++20 (GCC 13-64)", "C++23 (GCC 14-64, msys2)",
    // "GNU C11", "Python 3", "PyPy 3-64", "Java 21", "Rust 2024", "Node.js"; older forms such as
    // "GNU G++20 13.2 (64 bit, winlibs)" match too. GCC first; Clang/MSVC only as a fallback.
    const LANGUAGE_PREFERENCES = {
        cpp: [/\bG\+\+|\bGCC\b/i, /C\+\+/i],
        java: [/\bJava\s*(?:2\d|1[7-9])\b/i, /\bJava\b/i],
        rust: [/\bRust\s*2024\b/i, /\bRust\b/i],
        javascript: [/node\.?js/i, /javascript|\bV8\b/i],
        pascal: [/\bFPC\b|free\s*pascal/i, /pascal|delphi/i],
        csharp: [/C#\s*1\d\b/i, /C#/i]
    };

    function chooseLanguage(select, job, pick) {
        const options = Array.from(select.options).filter(o => !o.disabled).map(o => ({ value: o.value, text: text(o) }));
        return pick(options, job, LANGUAGE_PREFERENCES);
    }

    function findForm(doc) {
        const forms = Array.from(doc.querySelectorAll('form'));
        return forms.find(f => f.querySelector('[name="programTypeId"]') && f.querySelector('[name="source"], [name="sourceFile"]')) || null;
    }

    function turnstileToken(doc, form) {
        const el = form.querySelector('[name="cf-turnstile-response"]') || doc.querySelector('[name="cf-turnstile-response"]');
        return el && el.value ? el.value.trim() : '';
    }

    function hasTurnstile(doc, form) {
        return !!(form.querySelector('.cf-turnstile, [data-sitekey], [name="cf-turnstile-response"], iframe[src*="challenges.cloudflare.com"]') ||
            doc.querySelector('[name="cf-turnstile-response"]'));
    }

    const adapter = {
        id: 'codeforces',
        name: 'Codeforces',
        hosts: ['codeforces.com', 'm1.codeforces.com', 'm2.codeforces.com', 'm3.codeforces.com'],   // keep in sync with manifest.json

        // ── pure: also runs in the worker ──────────────────────────────────────────────────
        classify(url) {
            const u = parse(url);
            if (!u) return { kind: 'other' };
            if (problemOf(url)) return { kind: 'problem' };
            if (SUBMIT_PATH.test(u.pathname)) return { kind: 'submit' };
            if (STATUS_PATH.test(u.pathname)) return { kind: 'status' };
            return { kind: 'other' };
        },

        submitUrl(problemUrl) {
            const p = problemOf(problemUrl);
            return p ? `${p.u.origin}${p.shape.submit(p.m)}` : null;
        },

        // ── DOM: content script only ───────────────────────────────────────────────────────
        parseProblem(doc, url) {
            if (/^\/problemsets\/acmsguru\//.test((parse(url) || {}).pathname || '')) return parseSguru(doc, url);
            const st = doc.querySelector('.problem-statement');
            if (!st) return null;                       // PDF statement, login wall, or not a problem page
            const header = st.querySelector('.header');
            const inputs = Array.from(st.querySelectorAll('.sample-test .input pre'));
            const outputs = Array.from(st.querySelectorAll('.sample-test .output pre'));
            const tests = [];
            for (let i = 0; i < inputs.length && i < outputs.length; i++) tests.push({ input: preText(inputs[i]), output: preText(outputs[i]) });
            const name = contestName(doc, url);
            const mem = A.parseMemoryKb(propertyText(header && header.querySelector('.memory-limit')));
            return {
                name: text(header && header.querySelector('.title')),
                group: name ? `Codeforces - ${name}` : 'Codeforces',
                url: cleanUrl(url),
                timeLimit: A.parseTimeMs(propertyText(header && header.querySelector('.time-limit'))),
                memoryLimit: mem == null ? null : Math.round(mem / 1024),
                tests
            };
        },

        isLoggedIn(doc) {
            const box = doc.querySelector('#header .lang-chooser') || doc.querySelector('.lang-chooser') || doc.querySelector('#header');
            if (!box) return false;
            return !!box.querySelector('a[href*="/logout"], a[href^="/profile/"], a[href*="codeforces.com/profile/"]');
        },

        /** Test hook and fill step: the <option> fillAndSubmit would choose → { value, text } or null. */
        chooseLanguage(doc, url, job) {
            const form = findForm(doc);
            const select = form && form.querySelector('select[name="programTypeId"]');
            return select ? chooseLanguage(select, job, A.pickLanguage) : null;
        },

        async fillAndSubmit(doc, job, h) {
            const form = await h.waitFor(() => findForm(doc), 8000);
            if (!form) {
                throw h.error('form-not-found', 'The Codeforces submit form did not load. Open the problem in this browser and check that you can submit to it (contest registration or practice mode), then try again.');
            }
            const p = problemOf(job.url);

            // Problem: a select of indexes (contest, gym, group, edu) or a text code (problemset).
            const indexSelect = form.querySelector('select[name="submittedProblemIndex"]');
            const codeInput = form.querySelector('input[name="submittedProblemCode"]');
            if (indexSelect && p) {
                const opt = Array.from(indexSelect.options).find(o => o.value.toUpperCase() === p.index);
                if (!opt) throw h.error('form-not-found', `Problem ${p.index} is not in the Codeforces submit form. Check that this contest accepts your submissions, then try again.`);
                h.setValue(indexSelect, opt.value);
            } else if (codeInput && p) {
                const code = p.shape.field === 'sguru' ? p.index : `${p.contest}${p.index}`;
                if (p.shape.field !== 'sguru' || !codeInput.value.trim()) h.setValue(codeInput, code);
            }

            const select = form.querySelector('select[name="programTypeId"]');
            if (!select) throw h.error('form-not-found', 'The language list was not found on the Codeforces submit page.');
            const choice = chooseLanguage(select, job, h.pickLanguage);
            if (!choice) throw h.error('language-not-found', `Codeforces has no compiler for ${job.language}${job.std ? ` (${job.std})` : ''}.`);
            h.setValue(select, choice.value);

            // Source: the form posts the textarea "source". Codeforces keeps its Ace editor and that
            // textarea in sync both ways, so set Ace first, then the textarea last: whatever the
            // "Switch off editor" toggle says, the posted field holds exactly our text.
            const source = String(job.source || '').replace(/\r\n?/g, '\n');
            const area = form.querySelector('textarea[name="source"]') || form.querySelector('#sourceCodeTextarea');
            if (area) {
                await h.setEditorText('#editor', source);
                h.setValue(area, source);
            } else {
                h.setFile(form.querySelector('input[name="sourceFile"]'), job.fileName || 'main.cpp', source);
            }

            if (!job.autoSubmit) return;                // fill only: the user presses Submit

            // Cloudflare Turnstile: wait for its token (usually automatic, sometimes a click).
            if (hasTurnstile(doc, form) && !turnstileToken(doc, form)) {
                const ok = await h.waitFor(() => turnstileToken(doc, form), 40000);
                if (!ok) throw h.error('timeout', 'Codeforces is asking you to confirm you are human. Complete the check in the Codeforces tab, then submit again.');
            }

            const button = form.querySelector('#singlePageSubmitButton, input.submit[type="submit"], input[type="submit"], button[type="submit"]');
            if (button && button.disabled) await h.waitFor(() => !button.disabled, 5000);

            try {
                const store = doc.defaultView && doc.defaultView.sessionStorage;
                if (store) store.setItem(STATE_KEY, JSON.stringify({ jobId: job.id, at: Date.now(), baselineId: maxSubmissionId(doc) }));
            } catch (_) { /* readVerdict then matches on the problem only */ }

            await h.aboutToSubmit();                    // before navigating: stage → watch
            if (button && !button.disabled) button.click();
            else if (form.requestSubmit) form.requestSubmit();
            else form.submit();
        },

        readSubmitError(doc, url) {
            if (this.classify(url).kind !== 'submit') return null;
            const form = findForm(doc) || doc;
            const msg = Array.from(form.querySelectorAll('span.error, .error[class*="for__"]')).map(text).find(Boolean);
            return msg || null;
        },

        readVerdict(doc, url, job) {
            const table = doc.querySelector('table.status-frame-datatable');
            if (!table) return null;
            const want = problemKey(job && job.url);
            const state = submitState(doc, job);
            let best = null;
            for (const row of table.querySelectorAll('tr[data-submission-id]')) {
                const id = +row.getAttribute('data-submission-id');
                if (!id) continue;
                if (want && rowProblemKey(row, url) !== want) continue;
                if (state.baselineId != null && id <= state.baselineId) continue;     // existed before we submitted
                if (state.at != null) {
                    const t = rowTime(row, doc);                                       // minute precision; allow 3 min clock skew
                    if (t != null && t + 60000 < state.at - 180000) continue;
                }
                if (!best || id > +best.getAttribute('data-submission-id')) best = row;
            }
            if (!best) return null;

            const cell = best.querySelector('.status-verdict-cell');
            const wrapper = best.querySelector('.submissionVerdictWrapper');
            const verdict = text(cell || wrapper);
            const attr = wrapper ? (wrapper.getAttribute('submissionVerdict') || wrapper.getAttribute('submissionverdict') || '') : '';
            const link = best.querySelector('a.view-source') || best.querySelector('td a[href*="/submission/"]');
            const submissionUrl = link ? new URL(link.getAttribute('href'), url).href : null;
            const judged = best.querySelector('.verdict-format-judged');
            const testMatch = /test\s+(\d+)/i.exec(verdict);
            const test = judged && /^\d+$/.test(text(judged)) ? +text(judged) : testMatch ? +testMatch[1] : null;

            const pending = wrapper
                ? (!attr || /^(TESTING|SUBMITTED|null)$/i.test(attr))
                : ((cell && cell.getAttribute('waiting') === 'true') || A.isPendingVerdict(verdict));
            if (pending) {
                return { final: false, code: null, text: verdict || 'In queue', test, timeMs: null, memoryKb: null, points: null, submissionUrl };
            }
            const code = A.normalizeVerdict(verdict);
            const pointsEl = best.querySelector('.verdict-format-points');
            const pm = /(\d+(?:\.\d+)?)\s*points?/i.exec(verdict);
            return {
                final: true,
                code,
                text: verdict,
                test: code === 'AC' || code === 'CE' ? null : test,
                timeMs: A.parseTimeMs(text(best.querySelector('.time-consumed-cell'))),
                memoryKb: A.parseMemoryKb(text(best.querySelector('.memory-consumed-cell'))),
                points: pointsEl ? parseFloat(text(pointsEl)) : pm ? parseFloat(pm[1]) : null,
                submissionUrl
            };
        }
    };

    A.register(adapter);
    if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
