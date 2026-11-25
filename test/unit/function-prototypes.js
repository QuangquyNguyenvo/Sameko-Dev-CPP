'use strict';

// Add Function Prototypes (issue #78): src/features/suggestions/function-prototypes.js.
// Each generated file is also compiled with the bundled g++ when it is there, so a
// prototype that only looks right still fails the suite.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const FP = require('../../src/features/suggestions/function-prototypes');

let failed = 0;
function check(name, ok, detail) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '\n        ' + detail}`);
    if (!ok) failed++;
}

function apply(text) {
    const r = FP.analyze(text);
    if (!r.main || !r.prototypes.length) return { r, text };
    const lines = text.split('\n');
    lines.splice(r.insertLine - 1, 0, ...FP.insertionText(r).split('\n').slice(0, -1));
    return { r, text: lines.join('\n') };
}

const gpp = ['Sameko-GCC/bin/g++.exe', 'Sameko-GCC/bin/g++'].map((p) => path.join(__dirname, '../..', p)).find((p) => fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-proto-'));
function compiles(text) {
    if (!gpp) return true;
    const file = path.join(tmp, 'a.cpp');
    fs.writeFileSync(file, text);
    try {
        execFileSync(gpp, ['-std=c++17', '-fsyntax-only', file], { stdio: 'pipe', env: { ...process.env, PATH: path.dirname(gpp) + path.delimiter + process.env.PATH } });
        return true;
    } catch (e) {
        return String(e.stderr || e.message);
    }
}

// The example from the issue.
{
    const src = 'int main() {\n    float a[3] = {1, 2, 3};\n    return (int)loadArray(a, 3);\n}\n\nfloat loadArray(float inputArray[], int N) { return inputArray[N - 1]; }\n';
    const { r, text } = apply(src);
    check('issue example: types only', r.prototypes.join('|') === 'float loadArray(float[], int);', r.prototypes.join('|'));
    check('issue example: goes above main', text.startsWith('float loadArray(float[], int);\n\nint main()'), JSON.stringify(text.slice(0, 60)));
    const ok = compiles(text);
    check('issue example: compiles', ok === true, ok);
    check('running it twice adds nothing', FP.analyze(text).prototypes.length === 0);
}

// A typical school/CP file.
{
    const src = [
        '#include <bits/stdc++.h>',
        'using namespace std;',
        '#define ll long long',
        '/* int fake(int x) { } */',
        'struct Edge { int u, v; bool operator<(const Edge &o) const { return u < o.u; } };',
        'int declared(int);',
        'void before(int x) { cout << x; }',
        '',
        '// entry point',
        'int main()',
        '{',
        '    string s = "void inString(int a) {";',
        '    vector<vector<int>> g(3);',
        '    cout << sum(g, 0) << declared(1) << twice(2) << twice(2.5) << name(s) << fast(1) << (ptr(nullptr, 0) != nullptr) << digits();',
        '    noop();',
        '    swapPair(nullptr);',
        '    return 0;',
        '}',
        '',
        'long long sum(const vector<vector<int>> &g, int start) { return g.size() + start; }',
        'int declared(int x) { return x; }',
        'int twice(int x) { return 2 * x; }',
        'double twice(double x) { return 2 * x; }',
        'string name(std::string s) { return s; }',
        'static inline int fast(unsigned long long) { return 1; }',
        'void noop(void) {}',
        'char *ptr(int **p, size_t n) { return nullptr; }',
        'void swapPair(pair<int, int> *p) noexcept {}',
        'template <class T> T id(T x) { return x; }',
        'int withDefault(int a, int b = 2) { return a + b; }',
        'auto deduced(int x) { return x; }',
        'namespace ns { int inner(int x) { return x; } }',
        'int Edge2(int);',
        'struct Q { int f(); };',
        'int Q::f() { return 1; }',
        'int digits() { return 1\'000\'000; }',
    ].join('\n');
    const { r, text } = apply(src);
    const want = [
        'long long sum(const vector<vector<int>> &, int);',
        'int twice(int);',
        'double twice(double);',
        'string name(std::string);',
        'static inline int fast(unsigned long long);',
        'void noop(void);',
        'char *ptr(int **, size_t);',
        'void swapPair(pair<int, int> *) noexcept;',
        'int digits();',
    ];
    check('CP file: the right prototypes', JSON.stringify(r.prototypes) === JSON.stringify(want), JSON.stringify(r.prototypes, null, 1));
    check('CP file: template, default argument and auto are skipped', JSON.stringify(r.skipped) === JSON.stringify(['id', 'withDefault', 'deduced']), JSON.stringify(r.skipped));
    check('CP file: inserted on main\'s first line, below the comment', r.insertLine === 10, r.insertLine);
    const ok = compiles(text);
    check('CP file: compiles', ok === true, ok);
    check('CP file: second run adds nothing', FP.analyze(text).prototypes.length === 0, JSON.stringify(FP.analyze(text).prototypes));
}

{
    const r = FP.analyze('void f() {}\n');
    check('no main: nothing to do', r.main === false && r.prototypes.length === 0);
    const r2 = FP.analyze('int main() { return 0; }\nint f(int x) { return x; }\nint f(int y);\n');
    check('a declaration below main does not count as declared above it', r2.prototypes.length === 1);
}

for (const [input, want] of [
    ['float inputArray[]', 'float[]'], ['int N', 'int'], ['const vector<int> &v', 'const vector<int> &'],
    ['char* argv[]', 'char*[]'], ['int a[][5]', 'int[][5]'], ['long long', 'long long'], ['const int', 'const int'],
    ['string', 'string'], ['unsigned n', 'unsigned'], ['int (*cmp)(int, int)', 'int (*cmp)(int, int)'], ['int&& x', 'int&&'],
]) check(`typeOnly(${input})`, FP.typeOnly(input) === want, FP.typeOnly(input));

fs.rmSync(tmp, { recursive: true, force: true });
if (!gpp) console.log('  (bundled g++ not found: compile checks skipped)');
process.exit(failed ? 1 : 0);
