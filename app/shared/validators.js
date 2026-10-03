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

module.exports = {
    validateCompilerFlags,
};
