'use strict';

/**
 * Shared judge utilities used by both main process and renderer (via preload).
 * Single source of truth for output normalization and verdict comparison.
 */

/**
 * Normalize output for judge comparison.
 * Rules:
 * - Normalize line endings to \n
 * - Trim trailing spaces per line
 * - Trim leading/trailing blank space of whole output
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeOutput(text) {
    return String(text ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim();
}

/**
 * Compare actual and expected output using shared normalization.
 *
 * @param {string} actual
 * @param {string} expected
 * @returns {{ matched: boolean, actualNorm: string, expectedNorm: string }}
 */
function compareOutputs(actual, expected) {
    const actualNorm = normalizeOutput(actual);
    const expectedNorm = normalizeOutput(expected);
    return {
        matched: actualNorm === expectedNorm,
        actualNorm,
        expectedNorm,
    };
}

module.exports = {
    normalizeOutput,
    compareOutputs,
};
