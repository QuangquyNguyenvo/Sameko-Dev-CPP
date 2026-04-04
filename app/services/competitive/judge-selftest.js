'use strict';

/**
 * Lightweight self-tests for shared judge behavior.
 * Run manually: node app/services/competitive/judge-selftest.js
 */

const assert = require('assert');
const { compareOutputs, normalizeOutput } = require('../../shared/judge');

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

    // Extra blank line in middle is NOT ignored (strict, intentional)
    assert.strictEqual(compareOutputs('1\n\n2', '1\n2').matched, false);

    // Leading/trailing full-output spaces are ignored by trim()
    assert.strictEqual(compareOutputs(' 42\n', '42').matched, true);

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
