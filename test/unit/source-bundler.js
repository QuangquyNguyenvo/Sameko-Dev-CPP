'use strict';
/**
 * Unit checks for the one-file source sent to online judges
 * (app/services/competitive/source-bundler.js). Builds a small library in a temp folder.
 *   node test/unit/source-bundler.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bundleIncludes } = require('../../app/services/competitive/source-bundler');

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  PASS  ' + name); } catch (err) { failed++; console.log('  FAIL  ' + name + '\n        ' + err.message); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-bundle-'));
const write = (rel, text) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
};
write('lib/dsu.hpp', '#pragma once\n#include "util.hpp"\nstruct DSU { int p[10]; };\n');
write('lib/util.hpp', '#pragma once\ntypedef long long ll;\n');
write('lib/seg.hpp', '#pragma once\n#include "util.hpp"\nstruct Seg { ll t[4]; };\n');
write('bits/stdc++.h', '#include <vector>\n');
const main = path.join(root, 'a.cpp');

try {
    check('a solution without local headers is sent unchanged', () => {
        const src = '#include <bits/stdc++.h>\n#include "testlib.h"\nint main(){}\r\n';
        const r = bundleIncludes(src, main);
        assert.strictEqual(r.source, src);
        assert.deepStrictEqual(r.merged, []);
    });

    check('local headers are pasted in place, each once, nested ones too', () => {
        const src = '#include <bits/stdc++.h>\n#include "lib/dsu.hpp"\n#include "lib/seg.hpp"\nint main(){}\n';
        const r = bundleIncludes(src, main);
        assert.deepStrictEqual(r.merged, ['lib/dsu.hpp', 'lib/util.hpp', 'lib/seg.hpp']);
        assert.strictEqual((r.source.match(/typedef long long ll;/g) || []).length, 1);
        assert.ok(!/#\s*include\s*"/.test(r.source.replace(/^\/\/.*$/gm, '')), 'no live quoted include left');
        assert.ok(!/pragma once/.test(r.source));
        assert.ok(r.source.indexOf('struct DSU') < r.source.indexOf('int main'));
        assert.ok(r.source.startsWith('#include <bits/stdc++.h>\n'));
    });

    check('a copied bits/stdc++.h is never pasted in', () => {
        const src = '#include "bits/stdc++.h"\nint main(){}\n';
        assert.strictEqual(bundleIncludes(src, main).source, src);
    });

    check('an open header with unsaved edits is used as in the editor', () => {
        const src = '#include "lib/util.hpp"\n';
        const r = bundleIncludes(src, main, { openFiles: { [path.join(root, 'lib/util.hpp')]: 'typedef int ll; // edited\n' } });
        assert.ok(r.source.includes('// edited'));
    });

    check('a header including itself does not loop', () => {
        write('loop.h', '#include "loop.h"\nint x;\n');
        const r = bundleIncludes('#include "loop.h"\n', main);
        assert.strictEqual((r.source.match(/int x;/g) || []).length, 1);
    });

    check('an unsaved file (no path) is sent unchanged', () => {
        const src = '#include "lib/dsu.hpp"\n';
        assert.strictEqual(bundleIncludes(src, '').source, src);
    });
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${failed ? 'FAILED' : 'ok'}`);
process.exitCode = failed ? 1 : 0;
