/**
 * Sameko Dev C++ IDE - Syntax Services Index
 * Combines Tree-sitter and GCC checking
 * @module app/services/syntax
 */

'use strict';

const treeSitter = require('./tree-sitter');
const gccChecker = require('./gcc-checker');

/**
 * Perform combined syntax check using Tree-sitter and GCC
 * Tree-sitter provides fast syntax errors, GCC provides semantic errors
 * 
 * @param {string} content - Source code
 * @param {string} [filePath] - Original file path
 * @returns {Promise<{success: boolean, diagnostics: import('../../shared/types').SyntaxError[]}>}
 */
async function checkSyntax(content, filePath = null) {
    let allDiagnostics = [];

    // 1. Tree-sitter (fast syntax check)
    const tsDiagnostics = treeSitter.checkSyntax(content);
    allDiagnostics.push(...tsDiagnostics);

    // 2. GCC (semantic check)
    const gccDiagnostics = await gccChecker.checkSyntax(content, filePath);

    // 3. Merge results - deduplicate by line/column
    gccDiagnostics.forEach(d => {
        const exists = allDiagnostics.some(
            ts => ts.line === d.line && Math.abs(ts.column - d.column) < 5
        );
        if (!exists) {
            allDiagnostics.push(d);
        }
    });

    return {
        success: allDiagnostics.length === 0,
        diagnostics: allDiagnostics
    };
}

module.exports = {
    // Combined
    checkSyntax,

    // Tree-sitter
    initTreeSitter: treeSitter.initTreeSitter,
    getParser: treeSitter.getParser,
    isTreeSitterAvailable: treeSitter.isAvailable,
    checkSyntaxTreeSitter: treeSitter.checkSyntax,
    parse: treeSitter.parse,
    getSmartSuggestions: treeSitter.getSmartSuggestions,

    // GCC
    checkSyntaxGcc: gccChecker.checkSyntax,
    parseGccOutput: gccChecker.parseGccOutput,
    cancelSyntaxCheck: gccChecker.cancelSyntaxCheck,
};
