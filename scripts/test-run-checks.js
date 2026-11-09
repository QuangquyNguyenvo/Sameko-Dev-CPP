'use strict';
/**
 * Unit checks for what a run reports: crash names (app/shared/exit-codes.js) and the shared
 * judge rules (app/services/competitive/judge-selftest.js). No Electron, no compiler.
 *   node scripts/test-run-checks.js
 */

const assert = require('assert');
const { describeExit } = require('../app/shared/exit-codes');
const { runJudgeSelfTests } = require('../app/services/competitive/judge-selftest');

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('  PASS  ' + name); } catch (err) { failed++; console.log('  FAIL  ' + name + '\n        ' + err.message); }
}

check('crash codes have names, as Node reports them (unsigned) and as signed ints', () => {
    // Exit codes measured with the bundled GCC 16 (UCRT): see exit-codes.js.
    assert.equal(describeExit(3221225725).name, 'Stack overflow');           // 0xC00000FD, DFS 1e5 deep
    assert.equal(describeExit(3221225725).hex, '0xC00000FD');
    assert.equal(describeExit(3221225477).hex, '0xC0000005');                // null / out-of-range access
    assert.equal(describeExit(3221225620).name, 'Division by zero');         // / and % by 0
    assert.equal(describeExit(3221226505).name, 'Program aborted');          // abort, assert, uncaught exception
    assert.equal(describeExit(-1073741571).name, 'Stack overflow');          // same status, signed
});

check('normal and chosen exit codes are not crashes', () => {
    assert.equal(describeExit(0), null);
    assert.equal(describeExit(1), null);
    assert.equal(describeExit(3), null);
    assert.equal(describeExit(126), null);
    assert.equal(describeExit(null), null);
    assert.equal(describeExit(undefined), null);
});

check('POSIX signals are described, code null', () => {
    assert.equal(describeExit(null, 'SIGSEGV').name, 'Segmentation fault');
    assert.equal(describeExit(null, 'SIGFPE').name, 'Division by zero');
    assert.equal(describeExit(null, 'SIGABRT').hex, 'SIGABRT');
    assert.equal(describeExit(null, 'SIGWINCH'), null);
});

check('every crash has a hint unless there is nothing to do', () => {
    for (const code of [0xC0000005, 0xC00000FD, 0xC0000094, 0xC0000409, 0xC0000374, 0xC000001D, 0xC0000017, 0xC0000135]) {
        assert.ok(describeExit(code).hint.length > 10, '0x' + code.toString(16));
    }
});

check('judge rules (judge-selftest.js)', () => { assert.equal(runJudgeSelfTests(), true); });

console.log(`\n${failed ? 'FAILED' : 'ok'}`);
process.exitCode = failed ? 1 : 0;
