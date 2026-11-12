#!/usr/bin/env node
'use strict';
/*
 * Mock online judge for the extension's manual and automated end-to-end checks.
 *
 *   node extension/test/mock-oj/server.js [port]      (default 27190, http://localhost:<port>/)
 *
 * Pages (shaped like a small real judge, so test/mock-oj/adapter.js reads real-looking HTML):
 *   /problem/:id      statement, limits, sample tests
 *   /submit/:id       login required; a form with a language <select> and a CodeMirror-5-like
 *                     editor over a hidden <textarea>
 *   POST /submit/:id  rejects an identical resubmission; otherwise redirects to /status
 *   /status           your submissions; the verdict cell says "Running on test N" for
 *                     `verdictDelayMs` (2 s) and is then updated in place by the page's own script
 *   /submission/:sid  one submission, same live cell
 *   /login?as=alice&next=/submit/A   logs in without a form (handy for scripts); /login shows a form
 * Verdict: source containing WRONG → "Wrong answer on test 2", COMPILE_ERROR → "Compilation error",
 * otherwise "Accepted".
 * JSON for tests: GET /api/state, POST /api/reset, GET /api/submission/:sid.
 */
const http = require('http');
const { URL } = require('url');

const PROBLEMS = {
    A: { name: 'A. Sum of Two', timeLimit: '1 second', memoryLimit: '256 megabytes',
        statement: 'Print a + b.', tests: [{ input: '1 2\n', output: '3\n' }, { input: '-5 5\n', output: '0\n' }] },
    B: { name: 'B. Vector <int> Reverse', timeLimit: '2 seconds', memoryLimit: '512 megabytes',
        statement: 'Reverse the array.', tests: [{ input: '3\n1 2 3\n', output: '3 2 1\n' }] }
};

const LANGUAGES = [
    ['10', 'GNU GCC C11 5.1.0'],
    ['50', 'GNU G++14 6.4.0'],
    ['54', 'GNU G++17 7.3.0'],
    ['61', 'GNU G++17 9.2.0 (64 bit, msys 2)'],
    ['89', 'GNU G++20 13.2 (64 bit, winlibs)'],
    ['91', 'GNU G++23 14.2 (64 bit, msys2)'],
    ['52', 'Clang++20 Diagnostics'],
    ['31', 'Python 3.8.10'],
    ['70', 'PyPy 3.10 (7.3.15, 64bit)'],
    ['87', 'Java 21 64bit'],
    ['75', 'Rust 1.75.0 (2021)']
];

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function createMockOj(options) {
    const opts = Object.assign({ verdictDelayMs: 2000 }, options || {});
    let submissions = [];
    let nextId = 1;

    function verdictOf(s) {
        const elapsed = Date.now() - s.at;
        if (elapsed < opts.verdictDelayMs) {
            const test = Math.min(3, 1 + Math.floor(elapsed / Math.max(1, opts.verdictDelayMs / 3)));
            return { text: `Running on test ${test}`, final: false, timeMs: null, memoryKb: null };
        }
        if (/COMPILE_ERROR/.test(s.source)) return { text: 'Compilation error', final: true, timeMs: null, memoryKb: null };
        if (/WRONG/.test(s.source)) return { text: 'Wrong answer on test 2', final: true, timeMs: 15, memoryKb: 512 };
        return { text: 'Accepted', final: true, timeMs: 46, memoryKb: 1024 };
    }

    function userOf(req) {
        const m = /(?:^|;\s*)mockoj_session=([A-Za-z0-9_]+)/.exec(req.headers.cookie || '');
        return m ? m[1] : null;
    }

    function page(res, user, title, body, status) {
        const nav = user
            ? `<span class="user-menu">Logged in as <b class="handle">${esc(user)}</b> · <a class="logout" href="/logout">Log out</a></span>`
            : '<span class="user-menu"><a class="login" href="/login">Log in</a></span>';
        res.writeHead(status || 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} - Mock OJ</title></head>
<body><header class="site-header"><a href="/">Mock OJ</a> · <a href="/status">My submissions</a> · ${nav}</header>
<main>${body}</main></body></html>`);
    }

    function verdictCell(s) {
        const v = verdictOf(s);
        return `<td class="verdict" data-submission="${s.id}" data-final="${v.final}">${esc(v.text)}</td>
<td class="time">${v.timeMs == null ? '' : `${v.timeMs} ms`}</td><td class="memory">${v.memoryKb == null ? '' : `${v.memoryKb} KB`}</td>`;
    }

    // The page's own script refreshes running verdicts, like a real judge's status page.
    const LIVE_SCRIPT = `<script>
(function () {
  function tick() {
    var cells = document.querySelectorAll('td.verdict[data-final="false"]');
    if (!cells.length) return;
    cells.forEach(function (cell) {
      fetch('/api/submission/' + cell.dataset.submission).then(function (r) { return r.json(); }).then(function (v) {
        cell.textContent = v.text;
        cell.dataset.final = String(v.final);
        var row = cell.parentNode;
        row.querySelector('.time').textContent = v.timeMs == null ? '' : v.timeMs + ' ms';
        row.querySelector('.memory').textContent = v.memoryKb == null ? '' : v.memoryKb + ' KB';
      });
    });
    setTimeout(tick, 500);
  }
  setTimeout(tick, 500);
})();
</script>`;

    function submitForm(id, user, error, values) {
        const p = PROBLEMS[id];
        const v = values || {};
        const options = LANGUAGES.map(([val, text]) => `<option value="${val}"${v.language === val ? ' selected' : ''}>${esc(text)}</option>`).join('');
        return `<h1>Submit: ${esc(p.name)}</h1>
${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
<form id="submit-form" method="post" action="/submit/${id}">
  <label>Language <select name="language" id="language"><option value="">-- choose --</option>${options}</select></label>
  <div id="source-editor" class="CodeMirror" style="border:1px solid #888;min-height:120px;white-space:pre;font-family:monospace"></div>
  <textarea name="source" id="source" style="display:none">${esc(v.source || '')}</textarea>
  <button type="submit" id="submit-button">Submit</button>
</form>
<script>
(function () {
  // A tiny stand-in for CodeMirror 5: the wrapper exposes .CodeMirror and mirrors into the textarea.
  var wrap = document.getElementById('source-editor'), ta = document.getElementById('source');
  var value = ta.value;
  wrap.textContent = value;
  wrap.CodeMirror = {
    getValue: function () { return value; },
    setValue: function (v) { value = String(v); wrap.textContent = value; ta.value = value; },
    save: function () { ta.value = value; }
  };
})();
</script>`;
    }

    function readBody(req) {
        return new Promise((resolve) => {
            let data = '';
            req.on('data', d => { data += d; if (data.length > 1e6) req.destroy(); });
            req.on('end', () => resolve(data));
        });
    }

    async function handle(req, res) {
        const url = new URL(req.url, 'http://localhost');
        const user = userOf(req);
        const path = url.pathname;
        let m;

        if (path === '/') {
            return page(res, user, 'Problems', `<h1>Problems</h1><ul>${Object.entries(PROBLEMS).map(([id, p]) => `<li><a href="/problem/${id}">${esc(p.name)}</a></li>`).join('')}</ul>`);
        }
        if ((m = /^\/problem\/([A-Z])$/.exec(path)) && PROBLEMS[m[1]]) {
            const p = PROBLEMS[m[1]];
            const samples = p.tests.map(t => `<div class="sample"><div class="input"><h4>Input</h4><pre>${esc(t.input)}</pre></div><div class="output"><h4>Output</h4><pre>${esc(t.output)}</pre></div></div>`).join('');
            return page(res, user, p.name, `<div class="problem-statement" data-problem="${m[1]}">
<h1 class="title">${esc(p.name)}</h1>
<p class="time-limit">time limit per test: ${esc(p.timeLimit)}</p>
<p class="memory-limit">memory limit per test: ${esc(p.memoryLimit)}</p>
<div class="legend"><p>${esc(p.statement)}</p></div>
<div class="sample-tests">${samples}</div>
<p><a class="submit-link" href="/submit/${m[1]}">Submit</a></p></div>`);
        }
        if ((m = /^\/submit\/([A-Z])$/.exec(path)) && PROBLEMS[m[1]]) {
            const id = m[1];
            if (!user) {
                return page(res, user, 'Log in', `<h1>Log in required</h1><p>You must <a href="/login?next=/submit/${id}">log in</a> to submit.</p>`);
            }
            if (req.method === 'POST') {
                const form = new URLSearchParams(await readBody(req));
                const language = form.get('language') || '';
                const source = form.get('source') || '';
                const values = { language, source };
                if (!LANGUAGES.some(([v]) => v === language)) return page(res, user, 'Submit', submitForm(id, user, 'Choose a language.', values), 400);
                if (!source.trim()) return page(res, user, 'Submit', submitForm(id, user, 'The source code is empty.', values), 400);
                if (submissions.some(s => s.user === user && s.problem === id && s.source === source)) {
                    return page(res, user, 'Submit', submitForm(id, user, 'You have submitted exactly the same code before.', values), 400);
                }
                const s = { id: nextId++, user, problem: id, language, languageText: LANGUAGES.find(([v]) => v === language)[1], source, at: Date.now() };
                submissions.push(s);
                res.writeHead(302, { Location: '/status' });
                return res.end();
            }
            return page(res, user, 'Submit', submitForm(id, user, null, null));
        }
        if (path === '/status') {
            const mine = submissions.filter(s => s.user === user).slice().reverse();
            const rows = mine.map(s => `<tr data-submission-id="${s.id}" data-problem="${s.problem}"><td class="id"><a href="/submission/${s.id}">${s.id}</a></td>
<td class="problem"><a href="/problem/${s.problem}">${esc(PROBLEMS[s.problem].name)}</a></td><td class="lang">${esc(s.languageText)}</td>${verdictCell(s)}</tr>`).join('');
            return page(res, user, 'My submissions', `<h1>My submissions</h1>
<table id="submissions"><thead><tr><th>#</th><th>Problem</th><th>Language</th><th>Verdict</th><th>Time</th><th>Memory</th></tr></thead>
<tbody>${rows}</tbody></table>${LIVE_SCRIPT}`);
        }
        if ((m = /^\/submission\/(\d+)$/.exec(path))) {
            const s = submissions.find(x => x.id === +m[1]);
            if (!s) return page(res, user, 'Not found', '<h1>No such submission</h1>', 404);
            return page(res, user, `Submission ${s.id}`, `<h1>Submission ${s.id}</h1>
<table id="submissions"><tbody><tr data-submission-id="${s.id}" data-problem="${s.problem}"><td class="id"><a href="/submission/${s.id}">${s.id}</a></td>
<td class="problem"><a href="/problem/${s.problem}">${esc(PROBLEMS[s.problem].name)}</a></td><td class="lang">${esc(s.languageText)}</td>${verdictCell(s)}</tr></tbody></table>
<pre class="source">${esc(s.source)}</pre>${LIVE_SCRIPT}`);
        }
        if (path === '/login') {
            const next = url.searchParams.get('next') || '/';
            const as = url.searchParams.get('as') || (req.method === 'POST' ? new URLSearchParams(await readBody(req)).get('handle') : null);
            if (as && /^[A-Za-z0-9_]+$/.test(as)) {
                res.writeHead(302, { 'Set-Cookie': `mockoj_session=${as}; Path=/; SameSite=Lax`, Location: next.startsWith('/') ? next : '/' });
                return res.end();
            }
            return page(res, user, 'Log in', `<h1>Log in</h1><form method="post" action="/login?next=${encodeURIComponent(next)}"><input name="handle" value="alice"><button>Log in</button></form>`);
        }
        if (path === '/logout') {
            res.writeHead(302, { 'Set-Cookie': 'mockoj_session=; Path=/; Max-Age=0', Location: '/' });
            return res.end();
        }
        if ((m = /^\/api\/submission\/(\d+)$/.exec(path))) {
            const s = submissions.find(x => x.id === +m[1]);
            res.writeHead(s ? 200 : 404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(s ? Object.assign({ id: s.id }, verdictOf(s)) : { error: 'not found' }));
        }
        if (path === '/api/state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ submissions: submissions.map(s => Object.assign({}, s, { verdict: verdictOf(s) })) }));
        }
        if (path === '/api/reset' && req.method === 'POST') {
            submissions = [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"ok":true}');
        }
        return page(res, user, 'Not found', '<h1>Not found</h1>', 404);
    }

    const server = http.createServer((req, res) => {
        handle(req, res).catch(e => { res.writeHead(500); res.end(String(e && e.stack || e)); });
    });

    return {
        server,
        listen(port, host) {
            return new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port || 0, host || '127.0.0.1', () => resolve(server.address().port));
            });
        },
        close() { server.closeAllConnections && server.closeAllConnections(); return new Promise(r => server.close(() => r())); },
        get submissions() { return submissions; },
        PROBLEMS, LANGUAGES
    };
}

module.exports = { createMockOj, PROBLEMS, LANGUAGES };

if (require.main === module) {
    const port = +(process.argv[2] || 27190);
    const oj = createMockOj();
    oj.listen(port).then(p => console.log(`Mock OJ on http://localhost:${p}/  (problems /problem/A, /problem/B)`));
}
