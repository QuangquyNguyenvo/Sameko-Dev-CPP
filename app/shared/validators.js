/**
 * Sameko Dev C++ IDE - Input Validators (main process)
 * @module shared/validators
 */

'use strict';

const { COMPILER } = require('./constants');

/**
 * Validate compiler flags
 * @param {string} flags - Compiler flags string
 * @returns {{ valid: boolean, error?: string, sanitized: string }}
 */
function validateCompilerFlags(flags) {
    if (!flags || typeof flags !== 'string') {
        return { valid: true, sanitized: COMPILER.DEFAULT_FLAGS };
    }

    // Remove potentially dangerous flags
    const dangerousPatterns = [
        /-B/,           // Change compiler search path
        /-plugin/,      // Load plugins
        /@/,            // Response files (could load arbitrary files)
        /--specs=/,     // Override specs
    ];

    let sanitized = flags;
    for (const pattern of dangerousPatterns) {
        if (pattern.test(flags)) {
            return {
                valid: false,
                error: 'Compiler flags contain potentially unsafe options',
                sanitized: COMPILER.DEFAULT_FLAGS
            };
        }
    }

    // Limit length
    if (sanitized.length > 500) {
        sanitized = sanitized.substring(0, 500);
    }

    return { valid: true, sanitized: sanitized.trim() };
}

/**
 * Split a flags string on whitespace, keeping "..." or '...' as part of one
 * argument (-I"C:/My Headers" -> -IC:/My Headers). Backslashes stay as they
 * are, so Windows paths survive.
 * @param {string} flags
 * @returns {string[]}
 */
function splitFlags(flags) {
    const out = [];
    let cur = '';
    let quote = '';
    let started = false;
    for (const ch of String(flags || '')) {
        if (quote) {
            if (ch === quote) quote = '';
            else cur += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            started = true;
        } else if (/\s/.test(ch)) {
            if (started) out.push(cur);
            cur = '';
            started = false;
        } else {
            cur += ch;
            started = true;
        }
    }
    if (started) out.push(cur);
    return out;
}

/** Inverse of splitFlags for arguments that contain spaces. */
function joinFlags(tokens) {
    return tokens.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' ');
}

module.exports = {
    validateCompilerFlags,
    splitFlags,
    joinFlags,
};
