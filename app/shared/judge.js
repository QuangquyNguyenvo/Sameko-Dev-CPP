'use strict';

/**
 * Shared judge utilities used by both main process and renderer (via preload).
 * Single source of truth for output normalization and verdict comparison.
 */

/**
 * Normalize output for display and for the 'lines' comparison.
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

// A real number the way programs print one: 3, -0.5, 1e-9, .5 (no hex, inf or nan).
const REAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Absolute or relative error allowed between two real numbers (Codeforces' usual 1e-6). */
const EPS = 1e-6;

/**
 * Two output words are the same answer. Equal text always is. When the expected word is a real
 * number written with a decimal point or exponent, the output may differ from it by EPS,
 * absolute or relative, as judges check real-valued answers; integers must match exactly.
 */
function sameToken(actual, expected) {
    if (actual === expected) return true;
    if (!/[.eE]/.test(expected) || !REAL.test(expected) || !REAL.test(actual)) return false;
    const a = Number(actual);
    const e = Number(expected);
    if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
    const diff = Math.abs(a - e);
    return diff <= EPS || diff <= EPS * Math.abs(e);
}

/**
 * Compare actual and expected output.
 *
 * 'tokens' (the default) is how Codeforces' standard checkers judge: the outputs are the same
 * words in the same order, however they are split into spaces and lines, with real numbers
 * compared within EPS. 'nocase' is 'tokens' with letter case ignored (YES = yes = Yes), as
 * most problems with a yes/no answer say. 'lines' is the old strict rule: the same lines once
 * line endings and trailing spaces are normalized, so an extra blank line or a doubled space is
 * a WA.
 *
 * @param {string} actual
 * @param {string} expected
 * @param {'tokens'|'nocase'|'lines'} [mode='tokens']
 * @returns {{ matched: boolean, actualNorm: string, expectedNorm: string }}
 */
function compareOutputs(actual, expected, mode = 'tokens') {
    const actualNorm = normalizeOutput(actual);
    const expectedNorm = normalizeOutput(expected);
    let matched;
    if (mode === 'lines') {
        matched = actualNorm === expectedNorm;
    } else {
        const words = (text) => {
            const list = text ? text.split(/\s+/) : [];
            return mode === 'nocase' ? list.map(w => w.toLowerCase()) : list;
        };
        const a = words(actualNorm);
        const e = words(expectedNorm);
        matched = a.length === e.length && a.every((t, i) => sameToken(t, e[i]));
    }
    return {
        matched,
        actualNorm,
        expectedNorm,
    };
}

/** The comparison modes compareOutputs knows, as stored in settings and problems. */
const COMPARE_MODES = ['tokens', 'nocase', 'lines'];

module.exports = {
    COMPARE_MODES,
    normalizeOutput,
    compareOutputs,
};
