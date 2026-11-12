'use strict';

/**
 * Lightweight self-tests for shared judge behavior.
 * Run manually: node test/unit/judge.js
 */

const assert = require('assert');
const { compareOutputs, normalizeOutput } = require('../../app/shared/judge');

function runJudgeSelfTests() {
    // Newline normalization
    assert.strictEqual(normalizeOutput('a\r\nb\r\n'), 'a\nb');
    assert.strictEqual(normalizeOutput('a\rb\r'), 'a\nb');

    // Trailing whitespace normalization
    assert.strictEqual(normalizeOutput('a   \n b\t\n'), 'a\n b');

    // Empty output behavior
    assert.strictEqual(normalizeOutput('   \n\n'), '');
    assert.strictEqual(compareOutputs('', '').matched, true);
    assert.strictEqual(compareOutputs('x', '').matched, false);

    // Same meaning across different newline styles
    assert.strictEqual(compareOutputs('1\r\n2\r\n', '1\n2\n').matched, true);

    // 'lines': an extra blank line or a doubled space is a WA
    assert.strictEqual(compareOutputs('1\n\n2', '1\n2', 'lines').matched, false);
    assert.strictEqual(compareOutputs('1  2', '1 2', 'lines').matched, false);
    assert.strictEqual(compareOutputs(' 42\n', '42', 'lines').matched, true);

    // 'tokens' (default): the same words in order, as Codeforces' standard checkers judge
    assert.strictEqual(compareOutputs('1\n\n2', '1\n2').matched, true);
    assert.strictEqual(compareOutputs('1  2', '1 2').matched, true);
    assert.strictEqual(compareOutputs('1 2 3', '1\n2\n3').matched, true);
    assert.strictEqual(compareOutputs('1 2', '1 2 3').matched, false);
    assert.strictEqual(compareOutputs('YES', 'yes').matched, false);
    assert.strictEqual(compareOutputs('YES\nno', 'yes\nNO', 'nocase').matched, true);
    assert.strictEqual(compareOutputs('YES', 'no', 'nocase').matched, false);
    assert.strictEqual(compareOutputs('0.3333333', '0.333333', 'nocase').matched, true);
    assert.strictEqual(compareOutputs('12', '012').matched, false);

    // Real numbers within 1e-6, absolute or relative; integers exactly
    assert.strictEqual(compareOutputs('0.3333333', '0.333333').matched, true);
    assert.strictEqual(compareOutputs('0.3334', '0.333333').matched, false);
    assert.strictEqual(compareOutputs('1000000.5', '1000000.0').matched, true);
    assert.strictEqual(compareOutputs('2.0000001 x', '2.0 x').matched, true);
    assert.strictEqual(compareOutputs('1e-9', '0.0').matched, true);
    assert.strictEqual(compareOutputs('3.0', '3').matched, false);
    assert.strictEqual(compareOutputs('abc', '1.5').matched, false);

    return true;
}

if (require.main === module) {
    try {
        runJudgeSelfTests();
        console.log('Judge self-tests: OK');
        process.exit(0);
    } catch (err) {
        console.error('Judge self-tests: FAILED');
        console.error(err);
        process.exit(1);
    }
}

module.exports = { runJudgeSelfTests };
