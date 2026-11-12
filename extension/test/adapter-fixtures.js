#!/usr/bin/env node
'use strict';

/*
 * Adapter fixture tests: every test/adapters/<id>.cases.js against saved judge HTML.
 *
 *   node extension/test/adapter-fixtures.js [id ...]
 *
 * A cases file:
 *   module.exports = {
 *     adapter: 'cses',
 *     pure: [                                   // run in Node, no DOM
 *       { fn: 'classify',  args: ['https://cses.fi/problemset/task/1068'], expect: { kind: 'problem' } },
 *       { fn: 'submitUrl', args: ['https://cses.fi/problemset/task/1068'], expect: 'https://cses.fi/problemset/submit/1068/' }
 *     ],
 *     dom: [                                    // run in a real Chromium DOM (Electron, hidden)
 *       { name: 'statement', fixture: 'cses/task-1068.html', url: 'https://cses.fi/problemset/task/1068',
 *         fn: 'parseProblem', expect: { name: 'Weird Algorithm', timeLimit: 1000, tests: [{ input: '3\n', output: /^3 10 5/ }] } },
 *       { fixture: 'cses/result-ac.html', url: '…', fn: 'readVerdict', job: {}, expect: { final: true, code: 'AC' } }
 *     ]
 *   };
 *
 * A dom case calls adapter[fn](doc, url, job). `doc` is the fixture parsed with DOMParser (its
 * scripts never run, nothing is fetched) with <base href=url> added, so relative links resolve.
 * A parsed document has no layout: `innerText` behaves like `textContent` there, so adapters
 * must turn <br> and block elements into newlines themselves instead of relying on innerText.
 *
 * `expect` is matched as a subset: listed keys must match, extra keys in the result are fine;
 * arrays must have the same length; a RegExp tests a string; null/primitive compare with ===.
 */

const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..');
const CASES_DIR = path.join(__dirname, 'adapters');
const FIXTURES = path.join(__dirname, 'fixtures');

function caseFiles(only) {
    if (!fs.existsSync(CASES_DIR)) return [];
    return fs.readdirSync(CASES_DIR).filter(f => f.endsWith('.cases.js')).sort()
        .map(f => require(path.join(CASES_DIR, f)))
        .filter(c => !only.length || only.includes(c.adapter));
}

function matches(actual, expect) {
    if (expect instanceof RegExp) return typeof actual === 'string' && expect.test(actual);
    if (expect === null || typeof expect !== 'object') return actual === expect;
    if (Array.isArray(expect)) {
        return Array.isArray(actual) && actual.length === expect.length && expect.every((e, i) => matches(actual[i], e));
    }
    return actual !== null && typeof actual === 'object' && Object.keys(expect).every(k => matches(actual[k], expect[k]));
}

const show = (v) => {
    const s = JSON.stringify(v, (k, x) => (x instanceof RegExp ? String(x) : x));
    return s && s.length > 600 ? s.slice(0, 600) + '…' : s;
};

let failed = 0;
function report(label, ok, actual, expect) {
    if (ok) { console.log(`PASS ${label}`); return; }
    failed++;
    console.log(`FAIL ${label}\n     expected ${show(expect)}\n     actual   ${show(actual)}`);
}

function runPure(files) {
    const A = require(path.join(EXT, 'shared', 'adapters.js'));
    for (const file of files) {
        require(path.join(EXT, 'adapters', `${file.adapter}.js`));
        const adapter = A.get(file.adapter);
        for (const c of file.pure || []) {
            const label = `${file.adapter} ${c.name || `${c.fn}(${(c.args || []).join(', ')})`}`;
            let actual;
            try { actual = adapter[c.fn](...(c.args || [])); } catch (e) { actual = { threw: String(e && e.message) }; }
            report(label, matches(actual, c.expect), actual, c.expect);
        }
    }
}

async function runDom(files) {
    const { app, BrowserWindow } = require('electron');
    app.commandLine.appendSwitch('disable-gpu');
    await app.whenReady();
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL('about:blank');
    const run = (code) => win.webContents.executeJavaScript(code, true);
    await run(fs.readFileSync(path.join(EXT, 'shared', 'adapters.js'), 'utf8') + '\n;0');
    for (const file of files) {
        await run(fs.readFileSync(path.join(EXT, 'adapters', `${file.adapter}.js`), 'utf8') + '\n;0');
        for (const c of file.dom || []) {
            const label = `${file.adapter} ${c.name || `${c.fn} ${c.fixture}`}`;
            let actual;
            try {
                const html = fs.readFileSync(path.join(FIXTURES, c.fixture), 'utf8');
                actual = await run(`(async () => {
                    const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
                    const base = doc.createElement('base');
                    base.href = ${JSON.stringify(c.url || 'about:blank')};
                    doc.head.prepend(base);
                    const r = await SamekoAdapters.get(${JSON.stringify(file.adapter)})[${JSON.stringify(c.fn)}](doc, ${JSON.stringify(c.url || '')}, ${JSON.stringify(c.job || {})});
                    return r === undefined ? null : JSON.parse(JSON.stringify(r));
                })()`);
            } catch (e) {
                actual = { threw: String(e && e.message) };
            }
            report(label, matches(actual, c.expect), actual, c.expect);
        }
    }
    app.exit(failed ? 1 : 0);
}

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const files = caseFiles(only);

if (process.versions.electron) {
    runDom(files).catch((e) => { console.log(`FAIL adapter fixtures: ${e && e.stack || e}`); process.exit(1); });
} else {
    runPure(files);
    const domCount = files.reduce((n, f) => n + (f.dom || []).length, 0);
    if (!domCount) {
        if (!files.length) console.log('PASS no adapter cases yet');
        process.exit(failed ? 1 : 0);
    }
    const electron = require(path.join(EXT, '..', 'node_modules', 'electron'));
    const child = require('child_process').spawn(electron, [__filename, ...only], { stdio: 'inherit' });
    child.on('close', (code) => process.exit(failed || code ? 1 : 0));
}
