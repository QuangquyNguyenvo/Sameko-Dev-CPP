/**
 * Sameko Dev C++ IDE - Tree-sitter Syntax Parser
 * Fast syntax checking using Tree-sitter C++ parser
 * @module app/services/syntax/tree-sitter
 */

'use strict';

let parser = null;

function initTreeSitter() {
    if (parser) return true;

    try {
        const Parser = require('tree-sitter');
        const Cpp = require('tree-sitter-cpp');
        parser = new Parser();
        parser.setLanguage(Cpp);
        console.log('[TreeSitter] Initialized successfully');
        return true;
    } catch (e) {
        console.log('[TreeSitter] Not available:', e.message);
        return false;
    }
}

function getParser() {
    return parser;
}

function isAvailable() {
    return parser !== null;
}

/**
 * Parse C++ code and find syntax errors
 * @param {string} content - Source code
 * @returns {import('../../../shared/types').SyntaxError[]}
 */
function checkSyntax(content) {
    if (!parser) {
        initTreeSitter();
    }

    if (!parser) {
        return [];
    }

    const diagnostics = [];

    try {
        const tree = parser.parse(content);

        const traverse = (node) => {
            // node.hasError is a property in native bindings
            if (node.hasError || node.type === 'ERROR') {
                if (node.type === 'ERROR') {
                    // Check if it has meaningful text
                    if (node.text && node.text.trim()) {
                        diagnostics.push({
                            line: node.startPosition.row + 1,
                            column: node.startPosition.column + 1,
                            severity: 'error',
                            message: `Unexpected '${node.text.substring(0, 30)}${node.text.length > 30 ? '...' : ''}'`,
                            source: 'treesitter'
                        });
                    }
                } else if (node.isMissing) {
                    // Missing token
                    diagnostics.push({
                        line: node.startPosition.row + 1,
                        column: node.startPosition.column + 1,
                        severity: 'error',
                        message: `Missing ${node.type}`,
                        source: 'treesitter'
                    });
                }

                // Continue traversing children
                for (let i = 0; i < node.childCount; i++) {
                    traverse(node.child(i));
                }
            }
        };

        traverse(tree.rootNode);
    } catch (e) {
        console.log('[TreeSitter] Parse error:', e.message);
    }

    return diagnostics;
}

/**
 * Parse and return AST (for advanced usage)
 * @param {string} content
 * @returns {Object|null}
 */
function parse(content) {
    if (!parser) {
        initTreeSitter();
    }

    if (!parser) {
        return null;
    }

    try {
        return parser.parse(content);
    } catch (e) {
        console.log('[TreeSitter] Parse error:', e.message);
        return null;
    }
}

/**
 * Get smart suggestions context and local variables based on cursor position
 * @param {string} content 
 * @param {number} row 0-indexed row
 * @param {number} column 0-indexed column
 * @returns {Object} context and suggestions
 */
function getSmartSuggestions(content, row, column) {
    if (!parser) initTreeSitter();
    if (!parser) return { available: false };

    try {
        const tree = parser.parse(content);
        const rootNode = tree.rootNode;

        // Find the node exactly at or just before the cursor
        // Column - 1 because cursor is usually after the character just typed
        let targetCol = Math.max(0, column - 1);
        let node = rootNode.namedDescendantForPosition({ row: row, column: targetCol });

        if (!node) {
            node = rootNode.descendantForPosition({ row: row, column: targetCol });
        }

        const context = {
            available: true,
            isComment: false,
            isString: false,
            locals: []
        };

        if (node) {
            if (node.type === 'comment') context.isComment = true;
            if (node.type === 'string_literal' || node.type === 'char_literal') context.isString = true;

            // Traverse upwards to find function boundaries to get local variables
            let current = node;
            const locals = new Set();

            while (current && current.type !== 'function_definition') {
                current = current.parent;
            }

            if (current && current.type === 'function_definition') {
                // We are inside a function, let's find all declarations before our line
                const findDeclarations = (n) => {
                    if (n.startPosition.row >= row) return; // Only get declarations before cursor

                    if (n.type === 'identifier') {
                        // Check if it's a declaration
                        if (n.parent && (n.parent.type === 'init_declarator' || n.parent.type === 'declaration' || n.parent.type === 'parameter_declaration')) {
                            locals.add(n.text);
                        }
                    }

                    for (let i = 0; i < n.childCount; i++) {
                        findDeclarations(n.child(i));
                    }
                };
                findDeclarations(current);
            }

            // Also get global variables/functions
            const findGlobals = (n) => {
                if (n.startPosition.row >= row) return;

                if (n.type === 'function_definition') {
                    const declarator = n.childForFieldName('declarator');
                    if (declarator) {
                        let id = declarator;
                        while (id && id.type !== 'identifier') {
                            id = id.childForFieldName('declarator') || id.namedChildren[0];
                        }
                        if (id && id.type === 'identifier') locals.add(id.text);
                    }
                } else if (n.type === 'declaration') {
                    for (let i = 0; i < n.childCount; i++) {
                        const child = n.child(i);
                        if (child.type === 'init_declarator') {
                            const id = child.childForFieldName('declarator');
                            if (id && id.type === 'identifier') locals.add(id.text);
                        }
                    }
                }
            };

            for (let i = 0; i < rootNode.childCount; i++) {
                findGlobals(rootNode.child(i));
            }

            context.locals = Array.from(locals);
        }

        return context;
    } catch (e) {
        console.log('[TreeSitter] Suggestion error:', e);
        return { available: false };
    }
}

module.exports = {
    initTreeSitter,
    getParser,
    isAvailable,
    checkSyntax,
    parse,
    getSmartSuggestions,
};
