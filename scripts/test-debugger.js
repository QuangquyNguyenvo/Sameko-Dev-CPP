#!/usr/bin/env node
/**
 * Sameko Dev C++ IDE - Debugger regression tests (manual runner)
 *
 * There is no test framework in this repo (no `npm test`). This is a plain
 * Node script — `node scripts/test-debugger.js` — that locks in the two pieces
 * of the debugger that were verified by hand but never committed as tests:
 *
 *   Part A  mi-parser.js unit tests   — pure, always runs on any machine.
 *   Part B  gdb-session.js E2E        — needs a real gdb; auto-SKIPs if absent.
 *
 * No dependencies beyond Node core (assert/fs/path/os/child_process).
 * Exit code is 0 unless something FAILED.
 *
 * @module scripts/test-debugger
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// ---- tiny harness ---------------------------------------------------------
let passed = 0, failed = 0, skipped = 0;
const fails = [];

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log('  PASS  ' + name);
    } catch (err) {
        failed++;
        fails.push(name);
        console.log('  FAIL  ' + name + '\n        ' + (err && err.message ? err.message : err));
    }
}
function skip(name, why) {
    skipped++;
    console.log('  SKIP  ' + name + (why ? '  (' + why + ')' : ''));
}

// ===========================================================================
// PART A — mi-parser (pure unit tests)
// ===========================================================================
function partA() {
    console.log('\nPart A — mi-parser.js (unit)');
    const { parseLine } = require(path.join(ROOT, 'app/services/debugger/mi-parser'));

    check('result: ^done', () => {
        const r = parseLine('^done');
        assert.strictEqual(r.type, 'result');
        assert.strictEqual(r.class, 'done');
        assert.strictEqual(r.token, null);
    });

    check('result with token + nested tuple', () => {
        const r = parseLine('42^done,bkpt={number="1",line="10"}');
        assert.strictEqual(r.type, 'result');
        assert.strictEqual(r.token, 42);
        assert.strictEqual(r.results.bkpt.number, '1');
        assert.strictEqual(r.results.bkpt.line, '10');
    });

    check('error with escaped quotes in msg', () => {
        const r = parseLine('^error,msg="No symbol \\"x\\" in current context."');
        assert.strictEqual(r.type, 'result');
        assert.strictEqual(r.class, 'error');
        assert.strictEqual(r.results.msg, 'No symbol "x" in current context.');
    });

    check('exec: *stopped', () => {
        const r = parseLine('*stopped,reason="breakpoint-hit",frame={func="main",line="12"}');
        assert.strictEqual(r.type, 'exec');
        assert.strictEqual(r.class, 'stopped');
        assert.strictEqual(r.results.reason, 'breakpoint-hit');
        assert.strictEqual(r.results.frame.func, 'main');
    });

    check('notify: =breakpoint-modified', () => {
        const r = parseLine('=breakpoint-modified,bkpt={number="1",line="12"}');
        assert.strictEqual(r.type, 'notify');
        assert.strictEqual(r.class, 'breakpoint-modified');
        assert.strictEqual(r.results.bkpt.line, '12');
    });

    check('stream: console / log / target', () => {
        const con = parseLine('~"hello\\n"');
        assert.deepStrictEqual(con, { type: 'stream', stream: 'console', text: 'hello\n' });
        assert.strictEqual(parseLine('&"log"').stream, 'log');
        assert.strictEqual(parseLine('@"prog"').stream, 'target');
    });

    check('prompt: (gdb)', () => {
        assert.strictEqual(parseLine('(gdb)').type, 'prompt');
        assert.strictEqual(parseLine('(gdb) ').type, 'prompt');
    });

    // The core robustness/security invariant: program output that merely looks
    // like MI must NOT be swallowed as protocol.
    check('whitelist: bogus classes fall through to program output', () => {
        assert.strictEqual(parseLine('^garbage').type, 'output');
        assert.strictEqual(parseLine('*bogus').type, 'output');
        assert.strictEqual(parseLine('=unknownclass,x="1"').type, 'output');
        // a real line of program output that starts with a sigil
        assert.strictEqual(parseLine('*** all tests passed ***').type, 'output');
    });

    check('nested list of tuples (children=[child={..},child={..}])', () => {
        const r = parseLine('^done,children=[child={name="v.0",exp="0",value="1"},child={name="v.1",exp="1",value="2"}]');
        assert.ok(Array.isArray(r.results.children));
        assert.strictEqual(r.results.children.length, 2);
        assert.strictEqual(r.results.children[0].exp, '0');
        assert.strictEqual(r.results.children[1].value, '2');
    });

    check('duplicate keys collapse into <name>List', () => {
        const r = parseLine('^done,frame={level="0"},frame={level="1"}');
        assert.ok(Array.isArray(r.results.frameList));
        assert.strictEqual(r.results.frameList.length, 2);
        assert.strictEqual(r.results.frame.level, '1'); // last wins
    });
}

// ===========================================================================
// PART B — gdb-session (integration; SKIP without gdb)
// ===========================================================================
function locateToolchain() {
    // Bundled MinGW lives at <repo>/Sameko-GCC/bin. Fall back to nothing.
    const bin = path.join(ROOT, 'Sameko-GCC', 'bin');
    const gpp = path.join(bin, 'g++.exe');
    const gdb = path.join(bin, 'gdb.exe');
    if (fs.existsSync(gpp) && fs.existsSync(gdb)) {
        let printerDir = null;
        const shareDir = path.join(ROOT, 'Sameko-GCC', 'share');
        try {
            for (const e of fs.readdirSync(shareDir)) {
                if (/^gcc-/i.test(e)) {
                    const p = path.join(shareDir, e, 'python');
                    if (fs.existsSync(path.join(p, 'libstdcxx', 'v6', 'printers.py'))) { printerDir = p; break; }
                }
            }
        } catch (_) { /* no share dir */ }
        return { gpp, gdb, bin, printerDir };
    }
    return null;
}

function waitForEvent(emitter, event, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { emitter.removeListener(event, onEv); reject(new Error('timeout waiting for ' + event)); }, ms);
        function onEv(payload) { clearTimeout(timer); resolve(payload); }
        emitter.once(event, onEv);
    });
}

const SAMPLE = [
    '#include <bits/stdc++.h>',   // 1
    'using namespace std;',       // 2
    'int main(){',                // 3
    '    vector<int> v={1,2,3};', // 4
    '    int x=41;',              // 5
    '    x++;',                   // 6  <- breakpoint (x still 41 when stopped here)
    '    cout<<x;',               // 7
    '    return 0;',              // 8
    '}',                          // 9
    '',
].join('\n');
const BP_LINE = 6;

async function partB() {
    console.log('\nPart B — gdb-session.js (integration)');
    const tc = locateToolchain();
    if (!tc) { skip('gdb-session E2E', 'bundled gdb/g++ not found'); return; }

    const { GdbSession } = require(path.join(ROOT, 'app/services/debugger/gdb-session'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-dbgtest-'));
    const src = path.join(tmp, 'prog.cpp');
    const exe = path.join(tmp, 'prog.exe');
    fs.writeFileSync(src, SAMPLE, 'utf8');

    const env = { ...process.env, PATH: tc.bin + path.delimiter + process.env.PATH };

    try {
        execFileSync(tc.gpp, ['-g', '-O0', '-std=c++17', src, '-o', exe], { env, timeout: 60000, stdio: 'pipe' });
    } catch (err) {
        check('compile sample -g', () => { throw new Error('compile failed: ' + (err.message || err)); });
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { }
        return;
    }
    check('compile sample -g', () => { assert.ok(fs.existsSync(exe), 'exe not produced'); });

    const session = new GdbSession({ gdbPath: tc.gdb, exePath: exe, printerPythonDir: tc.printerDir, cwd: tmp, env });
    let outBuf = '';
    session.on('programOut', (t) => { outBuf += t; });
    session.on('error', () => { /* surfaced via assertions below */ });

    try {
        // 1) start
        await Promise.race([session.start(), waitForEvent(session, 'error', 20000).then(() => { throw new Error('gdb error on start'); })]);
        check('start() reaches ready', () => { assert.ok(session.proc, 'gdb process not spawned'); });

        // 2) breakpoint
        const bp = await session.setBreakpoint(src, BP_LINE);
        check('setBreakpoint returns numeric id', () => { assert.ok(Number.isInteger(bp.id), 'id=' + bp.id); });

        // 3) run to breakpoint
        const stoppedP = waitForEvent(session, 'stopped', 20000);
        await session.run();
        const stop = await stoppedP;
        check('run() stops at breakpoint', () => { assert.ok(/break/.test(stop.reason), 'reason=' + stop.reason); });

        // 4) locals + variable objects + STL pretty-print
        const locals = await session.listLocals();
        const names = (locals.variables || []).map((v) => v.name);
        check('listLocals has v and x', () => {
            assert.ok(names.includes('v'), 'locals=' + names.join(','));
            assert.ok(names.includes('x'), 'locals=' + names.join(','));
        });

        const vv = await session.varCreate('t', 'v');
        // A pretty-printed std::vector is a *dynamic* varobj: it reports
        // numchild="0" with dynamic="1"/has_more="1"; children materialize only
        // via -var-list-children. The UI must treat this as expandable.
        check('varCreate(v) is expandable (dynamic container)', () => {
            const expandable = parseInt(vv.numchild || '0', 10) > 0 || vv.dynamic === '1' || vv.has_more === '1';
            assert.ok(expandable, 'not expandable: ' + JSON.stringify(vv));
        });

        const kids = await session.varListChildren('t', 0, 10);
        check('varListChildren(v) yields 1,2,3 (STL pretty-print)', () => {
            const vals = (kids.children || []).map((c) => String(c.value));
            for (const want of ['1', '2', '3']) assert.ok(vals.includes(want), 'children values=' + vals.join(',') + (tc.printerDir ? '' : ' [no printer dir]'));
        });

        // 5) evaluate x (== 41 before x++), then run to completion
        const ev = await session.evaluate('x');
        check('evaluate(x) == 41', () => { assert.strictEqual(String(ev.value), '41'); });

        const exitedP = waitForEvent(session, 'programExited', 20000);
        await session.cont();
        const exited = await exitedP;
        check('program exits with code 0', () => { assert.strictEqual(exited.code, 0); });
        check('program output contains "42"', () => { assert.ok(/42/.test(outBuf), 'out=' + JSON.stringify(outBuf)); });
    } catch (err) {
        check('E2E flow completes without fatal error', () => { throw err; });
    } finally {
        try { await session.dispose(); } catch (_) { }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { }
    }
}

// ===========================================================================
(async function main() {
    console.log('Sameko debugger regression tests');
    try { partA(); } catch (err) { console.error('Part A crashed:', err); failed++; }
    try { await partB(); } catch (err) { console.error('Part B crashed:', err); failed++; }

    console.log('\n----------------------------------------');
    console.log(`PASSED ${passed} / FAILED ${failed} / SKIPPED ${skipped}`);
    if (fails.length) console.log('Failures: ' + fails.join('; '));
    process.exit(failed ? 1 : 0);
})();
