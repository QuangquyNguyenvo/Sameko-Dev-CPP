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
    const actualText = String(actual ?? '');
    const expectedText = String(expected ?? '');
    let matched;
    if (mode === 'lines') {
        matched = normalizeOutput(actualText) === normalizeOutput(expectedText);
    } else {
        // Walk both outputs word by word in place and stop at the first difference: no
        // normalized copies or word arrays, which for a 16 MB output cost ~1 s and ~450 MB.
        // /\S+/g finds the same words as normalizeOutput(text).split(/\s+/).
        const nocase = mode === 'nocase';
        const wa = /\S+/g;
        const we = /\S+/g;
        matched = true;
        for (;;) {
            const ma = wa.exec(actualText);
            const me = we.exec(expectedText);
            if (!ma || !me) { matched = !ma && !me; break; }
            const a = nocase ? ma[0].toLowerCase() : ma[0];
            const e = nocase ? me[0].toLowerCase() : me[0];
            if (!sameToken(a, e)) { matched = false; break; }
        }
    }
    // Callers read these only for a WA message or debug hashes: build them on first use.
    let actualNorm = null;
    let expectedNorm = null;
    return {
        matched,
        get actualNorm() { return actualNorm ??= normalizeOutput(actualText); },
        get expectedNorm() { return expectedNorm ??= normalizeOutput(expectedText); },
    };
}

/** The comparison modes compareOutputs knows, as stored in settings and problems. */
const COMPARE_MODES = ['tokens', 'nocase', 'lines'];

module.exports = {
    COMPARE_MODES,
    normalizeOutput,
    compareOutputs,
};
