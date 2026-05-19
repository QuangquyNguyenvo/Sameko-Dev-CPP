/**
 * Sameko Dev C++ IDE - Keyboard Shortcuts Manager
 * Keybinding registration and handling
 * 
 * @module src/shared/components/shortcuts-manager
 */

// ============================================================================
// DEFAULT KEYBINDINGS
// ============================================================================

const DEFAULT_KEYBINDINGS = {
    'compile': 'F9',
    'buildRun': 'F11',
    'run': 'F10',
    'stop': 'Shift+F5',
    'save': 'Ctrl+S',
    'saveAs': 'Ctrl+Shift+S',
    'newFile': 'Ctrl+N',
    'openFile': 'Ctrl+O',
    'closeTab': 'Ctrl+W',
    'toggleProblems': 'Ctrl+J',
    'settings': 'Ctrl+,',
    'toggleSplit': 'Ctrl+\\',
    'formatCode': 'Ctrl+Shift+A',
    'toggleExplorer': 'Ctrl+E'
};

// ============================================================================
// SHORTCUTS STATE
// ============================================================================

const handlers = new Map();
let currentBindings = { ...DEFAULT_KEYBINDINGS };

// ============================================================================
// SHORTCUTS FUNCTIONS
// ============================================================================

/**
 * Initialize keyboard shortcuts
 */
function initShortcuts() {
    document.addEventListener('keydown', handleKeydown);
}

/**
 * Register shortcut handler
 * @param {string} action - Action name
 * @param {Function} handler - Handler function
 */
function registerHandler(action, handler) {
    handlers.set(action, handler);
}

/**
 * Update keybinding
 * @param {string} action
 * @param {string} keys
 */
function setKeybinding(action, keys) {
    currentBindings[action] = keys;
}

/**
 * Get keybinding
 * @param {string} action
 * @returns {string}
 */
function getKeybinding(action) {
    return currentBindings[action] || DEFAULT_KEYBINDINGS[action];
}

/**
 * Reset to default keybindings
 */
function resetKeybindings() {
    currentBindings = { ...DEFAULT_KEYBINDINGS };
}

/**
 * Handle keydown event
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
    const key = buildKeyString(e);

    for (const [action, binding] of Object.entries(currentBindings)) {
        if (normalizeKey(key) === normalizeKey(binding)) {
            const handler = handlers.get(action);
            if (handler) {
                e.preventDefault();
                handler(e);
                return;
            }
        }
    }
}

/**
 * Build key string from event
 * @param {KeyboardEvent} e
 * @returns {string}
 */
function buildKeyString(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    const key = e.key === ' ' ? 'Space' : e.key;
    if (!['Control', 'Shift', 'Alt'].includes(key)) {
        parts.push(key.length === 1 ? key.toUpperCase() : key);
    }

    return parts.join('+');
}

/**
 * Normalize key string for comparison
 * @param {string} key
 * @returns {string}
 */
function normalizeKey(key) {
    return key.toLowerCase().split('+').sort().join('+');
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initShortcuts, registerHandler, setKeybinding, getKeybinding, resetKeybindings, DEFAULT_KEYBINDINGS };
}

if (typeof window !== 'undefined') {
    window.ShortcutsManager = { initShortcuts, registerHandler, setKeybinding, getKeybinding, resetKeybindings, DEFAULT_KEYBINDINGS };
}
