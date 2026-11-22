#!/usr/bin/env node
'use strict';

/*
 * Reading a solution's input and output files, pairing test files in a folder, and the verdict
 * of an interactive run. No Electron and no compiler.
 */

const assert = require('node:assert/strict');
const Module = require('node:module');
const FileIODetect = require('../../src/renderer/file-io-detect');

// test-files.js and interactor.js only need Electron through modules these checks do not call.
const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'electron') return { app: { getPath: () => require('node:os').tmpdir(), isPackaged: false, on() {} } };
    return load.call(this, request, ...rest);
};
const { pairTestFiles, normalizeFileIO } = require('../../app/services/competitive/test-files');
const { interactiveVerdict } = require('../../app/services/competitive/interactor');

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (err) {
        failed++;
        console.log(`  FAIL  ${name}\n        ${String(err.message).split('\n').join('\n        ')}`);
    }
}
const detect = FileIODetect.detect;

check('freopen with literal names', () => {
    assert.deepEqual(detect('int main(){freopen("bai.inp","r",stdin);freopen("bai.out","w",stdout);}'), { input: 'bai.inp', output: 'bai.out' });
});
check('#define NAME with string pasting', () => {
    assert.deepEqual(detect('#define NAME "sum"\nint main(){freopen(NAME".inp","r",stdin);freopen(NAME ".out","w",stdout);}'), { input: 'sum.inp', output: 'sum.out' });
});
check('const string NAME with c_str', () => {
    const src = 'const string NAME = "tong";\nint main(){freopen((NAME + ".inp").c_str(), "r", stdin); freopen((NAME + ".out").c_str(), "w", stdout);}';
    assert.deepEqual(detect(src), { input: 'tong.inp', output: 'tong.out' });
});
check('the if (fopen(...)) idiom', () => {
    const src = 'int main(){ if (fopen("a.inp","r")) { freopen("a.inp","r",stdin); freopen("a.out","w",stdout); } }';
    assert.deepEqual(detect(src), { input: 'a.inp', output: 'a.out' });
});
check('ifstream and ofstream, declared and opened', () => {
    assert.deepEqual(detect('ifstream fin("x.inp"); ofstream fout("x.out");'), { input: 'x.inp', output: 'x.out' });
    assert.deepEqual(detect('ifstream f; ofstream g; int main(){ f.open("y.in"); g.open("y.ans"); }'), { input: 'y.in', output: 'y.ans' });
});
check('commented-out freopen does not count', () => {
    assert.equal(detect('// freopen("a.inp","r",stdin);\n/* freopen("b.inp","r",stdin); */ int main(){}'), null);
});
check('a path or an unknown name is not a test file', () => {
    assert.equal(detect('int main(){freopen("C:/data/a.inp","r",stdin);}'), null);
    assert.equal(detect('int main(int c,char**v){freopen(v[1],"r",stdin);}'), null);
    assert.equal(detect('int main(){freopen("../a.inp","r",stdin);}'), null);
});
check('a string containing // is not a comment', () => {
    assert.deepEqual(detect('const char *u = "http://x"; int main(){freopen("c.inp","r",stdin);}'), { input: 'c.inp', output: '' });
});

check('pairs .in/.out in natural order', () => {
    assert.deepEqual(pairTestFiles(['10.in', '10.out', '2.in', '2.out', 'notes.txt']), [
        { input: '2.in', output: '2.out' }, { input: '10.in', output: '10.out' },
    ]);
});
check('pairs .INP/.OUT, any case', () => {
    assert.deepEqual(pairTestFiles(['BAI1.INP', 'BAI1.OUT']), [{ input: 'BAI1.INP', output: 'BAI1.OUT' }]);
});
check('Themis layout: one folder per test', () => {
    const p = n => `Test0${n}/bai.`;
    assert.deepEqual(pairTestFiles([p(2) + 'inp', p(2) + 'out', p(1) + 'inp', p(1) + 'out']).map(x => x.input.replace(/\\/g, '/')), ['Test01/bai.inp', 'Test02/bai.inp']);
});
check('input/ and output/ folders', () => {
    assert.deepEqual(pairTestFiles(['input/1.txt', 'output/1.txt']), [{ input: 'input/1.txt', output: 'output/1.txt' }]);
});
check('input00.txt / output00.txt', () => {
    assert.deepEqual(pairTestFiles(['input00.txt', 'output00.txt']), [{ input: 'input00.txt', output: 'output00.txt' }]);
});
check('Polygon: 01 and 01.a', () => {
    assert.deepEqual(pairTestFiles(['01', '01.a']), [{ input: '01', output: '01.a' }]);
});
check('an input alone is kept, an answer alone is not', () => {
    assert.deepEqual(pairTestFiles(['a.in', 'b.out']), [{ input: 'a.in', output: '' }]);
});
check('file names from the renderer cannot leave the folder', () => {
    assert.equal(normalizeFileIO({ input: '../evil', output: 'a/b' }), null);
    assert.equal(normalizeFileIO({ input: '..', output: 'C:\\x' }), null);
    assert.deepEqual(normalizeFileIO({ input: 'bai.inp', output: '' }), { input: 'bai.inp', output: '' });
});

const outcome = over => interactiveVerdict({ timedOut: false, memoryHit: false, solutionCode: 0, solutionSignal: null, interactorCode: 0, interactorKilled: false, ...over });
check('interactor verdicts', () => {
    assert.equal(outcome({}), 'AC');
    assert.equal(outcome({ interactorCode: 1 }), 'WA');
    assert.equal(outcome({ interactorCode: 1, solutionSignal: 'SIGPIPE' }), 'WA');
    assert.equal(outcome({ solutionCode: 3221225477 }), 'RE');
    assert.equal(outcome({ interactorCode: 3 }), 'FAIL');
    assert.equal(outcome({ timedOut: true, interactorCode: 1 }), 'TLE');
    assert.equal(outcome({ memoryHit: true }), 'MLE');
    assert.equal(outcome({ interactorKilled: true, interactorCode: null }), 'TLE');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
