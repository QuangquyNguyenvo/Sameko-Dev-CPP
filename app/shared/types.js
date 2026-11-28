/**
 * Sameko Dev C++ IDE - JSDoc Type Definitions
 * Shared type definitions for better IDE support and documentation
 * @module shared/types
 */

'use strict';

/**
 * @typedef {Object} CompilerInfo
 * @property {string} name - Compiler name (e.g., 'Bundled MinGW', 'TDM-GCC')
 * @property {string} version - Compiler version (e.g., '13.2.0')
 * @property {string} path - Full path to g++.exe
 * @property {boolean} bundled - Whether this is the bundled compiler
 * @property {boolean} hasLLD - Whether LLD linker is available
 */

/**
 * @typedef {Object} CompileResult
 * @property {boolean} success - Whether compilation succeeded
 * @property {string} [error] - Error message if failed
 * @property {string} [message] - Success message
 * @property {string} [outputPath] - Path to compiled executable
 * @property {string} [warnings] - Compiler warnings
 * @property {string} [compiler] - Compiler name used
 * @property {number} [time] - Compilation time in ms
 * @property {string[]} [linkedFiles] - Additional linked source files
 * @property {boolean} [sourceSaved] - The compile IPC wrote this source snapshot before building
 * @property {string} [saveError] - The source write failed and the build never started
 */

/**
 * @typedef {Object} RunResult
 * @property {boolean} success - Whether run started successfully
 * @property {string} [error] - Error message if failed
 * @property {number} [pid] - Process ID of running executable
 */

/**
 * @typedef {Object} FileEntry
 * @property {string} name - File/folder name
 * @property {boolean} isDirectory - Whether entry is a directory
 * @property {boolean} isFile - Whether entry is a file
 */

/**
 * @typedef {Object} TabInfo
 * @property {string} id - Unique tab identifier
 * @property {string} path - File path (or null for untitled)
 * @property {string} name - Display name
 * @property {string} content - File content
 * @property {boolean} unsaved - Whether tab has unsaved changes
 * @property {Object} editorState - Monaco editor view state
 */

/**
 * @typedef {Object} PanelConfig
 * @property {string} id - Panel identifier
 * @property {string} title - Panel title
 * @property {boolean} visible - Whether panel is visible
 * @property {number} height - Panel height in pixels
 */

/**
 * @typedef {Object} ThemeColors
 * @property {string} background - Background color
 * @property {string} foreground - Foreground/text color
 * @property {string} accent - Accent color
 * @property {string} primaryBtn - Primary button color
 * @property {string} secondaryBtn - Secondary button color
 * @property {string} border - Border color
 * @property {string} sidebarBg - Sidebar background
 * @property {string} panelBg - Panel background
 * @property {string} headerBg - Header background
 */

/**
 * @typedef {Object} ThemeDefinition
 * @property {string} id - Theme identifier
 * @property {string} name - Theme display name
 * @property {string} type - Theme type ('dark' | 'light')
 * @property {ThemeColors} colors - Theme color definitions
 * @property {Object} monacoTheme - Monaco editor theme name
 */

/**
 * @typedef {Object} Snippet
 * @property {string} id - Unique snippet identifier
 * @property {string} name - Snippet name
 * @property {string} prefix - Trigger prefix
 * @property {string} body - Snippet content
 * @property {string} description - Snippet description
 */

/**
 * @typedef {Object} AppSettings
 * @property {string} theme - Current theme ID
 * @property {number} fontSize - Editor font size
 * @property {string} fontFamily - Editor font family
 * @property {boolean} wordWrap - Enable word wrap
 * @property {boolean} minimap - Show minimap
 * @property {boolean} lineNumbers - Show line numbers
 * @property {string} compilerFlags - Default compiler flags
 * @property {boolean} autoSave - Enable auto-save
 * @property {number} autoSaveDelay - Auto-save delay in ms
 * @property {boolean} formatOnSave - Format code on save
 * @property {boolean} liveSyntaxCheck - Enable live syntax checking
 * @property {Object} keybindings - Custom keybindings
 */

/**
 * @typedef {Object} SyntaxError
 * @property {number} line - Line number (1-indexed)
 * @property {number} column - Column number
 * @property {string} message - Error message
 * @property {string} severity - 'error' | 'warning' | 'info'
 * @property {string} source - Error source ('gcc' | 'treesitter')
 */

/**
 * @typedef {Object} BatchTestCase
 * @property {string} id - Test case identifier
 * @property {string} input - Test input
 * @property {string} expectedOutput - Expected output
 * @property {string} [actualOutput] - Actual output after run
 * @property {string} status - 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'timeout'
 * @property {number} [time] - Execution time in ms
 * @property {number} [memory] - Memory usage in KB
 */

/**
 * @typedef {Object} BatchTestResult
 * @property {string} testId - Test case identifier
 * @property {boolean} passed - Whether test passed
 * @property {string} actualOutput - Program output
 * @property {number} time - Execution time in ms
 * @property {number} memory - Memory usage in KB
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} CompetitiveProblem
 * @property {string} name - Problem name
 * @property {string} group - Contest/group name
 * @property {string} url - Problem URL
 * @property {BatchTestCase[]} tests - Sample test cases
 * @property {number} timeLimit - Time limit in ms
 * @property {number} memoryLimit - Memory limit in MB
 */

// Export for type checking tools
module.exports = {};
