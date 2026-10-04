/**
 * Sameko Dev C++ IDE - renderer: The shortcut table (ACTION_HANDLERS), key handling, code formatting.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================
// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

let currentShortcutMap = new Map();
let ctrlKTimer = null;
let ctrlKPressed = false;

// Action dispatcher
const ACTION_HANDLERS = {
    'compile': () => compileOnly(),
    // While a debug session is live, F11/F10 act as Step Into / Step Over
    // (standard IDE behavior); otherwise they build/run as usual.
    'buildRun': () => (window.Debugger && window.Debugger.isActive()) ? window.Debugger.stepInto() : buildRun(),
    'run': () => (window.Debugger && window.Debugger.isActive()) ? window.Debugger.stepOver() : run(),
    'stop': () => { if (window.Debugger && window.Debugger.isActive()) window.Debugger.stop(); else stop(); },
    'debugStart': () => { if (window.Debugger) window.Debugger.start(); },
    'debugStepOut': () => { if (window.Debugger && window.Debugger.isActive()) window.Debugger.stepOut(); },
    'save': () => save(),
    'saveAs': () => saveAs(),
    'newFile': () => newFile(),
    'openFile': () => openFile(),
    'newTab': () => newFile(),
    'closeTab': () => { if (App.activeTabId) closeTab(App.activeTabId); },
    'nextTab': () => cycleTab(1),
    'prevTab': () => cycleTab(-1),
    'toggleProblems': () => toggleProblems(),
    'settings': () => openSettings(),
    'toggleSplit': () => toggleSplit(),
    'formatCode': () => formatCode(),
    'toggleExplorer': () => { if (window.FileExplorer) window.FileExplorer.toggle(); },
    'commentLine': () => getActiveEditor()?.getAction('editor.action.commentLine')?.run(),
    'selectNextOccurrence': () => getActiveEditor()?.getAction('editor.action.addSelectionToNextFindMatch')?.run(),
    'selectAllOccurrences': () => getActiveEditor()?.getAction('editor.action.selectHighlights')?.run(),
    'moveLineUp': () => getActiveEditor()?.getAction('editor.action.moveLinesUpAction')?.run(),
    'moveLineDown': () => getActiveEditor()?.getAction('editor.action.moveLinesDownAction')?.run(),
    'copyLineUp': () => getActiveEditor()?.getAction('editor.action.copyLinesUpAction')?.run(),
    'copyLineDown': () => getActiveEditor()?.getAction('editor.action.copyLinesDownAction')?.run(),
    'uiZoomIn': () => stepUiScale(1),
    'uiZoomOut': () => stepUiScale(-1),
    'uiZoomReset': () => setUiScale('auto'),
};

/** Ctrl+Tab / Ctrl+Shift+Tab: the next or previous tab in the tab bar, wrapping around. */
function cycleTab(step) {
    if (App.tabs.length < 2) return;
    const i = App.tabs.findIndex(t => t.id === App.activeTabId);
    setActive(App.tabs[(i + step + App.tabs.length) % App.tabs.length].id);
}

// Interface Scale (Settings › Appearance). Saving the setting is enough: the
// main process applies it as the page zoom.
const UI_SCALE_STEPS = [80, 90, 100, 110, 125, 150, 175, 200];

function setUiScale(value) {
    App.settings.appearance.uiScale = value;
    saveSettings();
    setStatus(value === 'auto' ? 'Interface scale: Auto' : `Interface scale: ${value}%`, 'ready');
}

function stepUiScale(direction) {
    let current = Number(App.settings.appearance.uiScale);
    if (!Number.isFinite(current)) {
        // "auto" is resolved in the main process; in this frameless window the
        // zoom in effect is the ratio of the window width to the page width.
        current = Math.round((window.outerWidth / window.innerWidth) * 100);
    }
    const next = direction > 0
        ? (UI_SCALE_STEPS.find((s) => s > current + 1) ?? UI_SCALE_STEPS[UI_SCALE_STEPS.length - 1])
        : ([...UI_SCALE_STEPS].reverse().find((s) => s < current - 1) ?? UI_SCALE_STEPS[0]);
    setUiScale(next);
}

function normalizeKeyCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    let key = e.key;
    // With a modifier held, take letters and digits from the physical key: a
    // Vietnamese IME or a non-Latin layout can report e.key as "Process" or
    // another character, and Ctrl+W / Ctrl+T then matched nothing.
    if ((e.ctrlKey || e.altKey) && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)) key = e.code.slice(-1);
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    else if (key.startsWith('Arrow')) key = key.replace('Arrow', '');
    else if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null; // Ignore modifiers alone

    parts.push(key);
    return parts.join('+');
}

function getEffectiveKeybindings() {
    return { ...DEFAULT_SETTINGS.keybindings, ...(App.settings.keybindings || {}) };
}

function updateShortcutMap() {
    currentShortcutMap.clear();
    const bindings = getEffectiveKeybindings();

    for (const [action, combo] of Object.entries(bindings)) {
        if (combo) {
            currentShortcutMap.set(combo, action);
        }
    }

    updateMenuShortcutLabels();
}

/**
 * Update dropdown menu .key labels to match current keybindings
 */
function updateMenuShortcutLabels() {
    // Map menu data-action → keybinding action name
    const menuToKeybinding = {
        'new': 'newFile',
        'open': 'openFile',
        'save': 'save',
        'saveas': 'saveAs',
        'buildrun': 'buildRun',
        'run': 'run',
        'stop': 'stop',
        'toggleproblems': 'toggleProblems',
        'settings': 'settings',
        'spliteditor': 'toggleSplit',
    };

    const bindings = getEffectiveKeybindings();

    document.querySelectorAll('.dropdown-item[data-action]').forEach(item => {
        const action = item.dataset.action;
        const keybindingKey = menuToKeybinding[action];
        if (!keybindingKey) return;

        const combo = bindings[keybindingKey];
        const keySpan = item.querySelector('.key');
        if (keySpan && combo) {
            keySpan.textContent = combo;
        }
    });
}

function initShortcuts() {
    updateShortcutMap();

    document.addEventListener('keydown', e => {
        // The Settings "press a key" capture owns the keyboard while it is active.
        if (editingKeybinding) return;

        // Escape closes Settings from anywhere, including while the editor
        // (a textarea) still has focus behind the overlay.
        if (e.key === 'Escape') closeSettings();

        // PERFORMANCE: Early exit for uninteresting keys to prevent "freeze"
        // If it's a regular key typing in an input/editor, and NO modifiers are pressed, 
        // strictly ignore it (unless we have single-key shortcuts like F-keys).
        // BUT: F1-F12 are often single keys. 
        const isModifier = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
        const isFunctionKey = e.key.startsWith('F');
        const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;

        // If user is typing in editor (isInput) and NOT pressing modifiers/Function keys,
        // let it pass immediately.
        if (isInput && !isModifier && !isFunctionKey) {
            return;
        }

        // Ctrl+K chord handling (VS Code style) - ONLY if Ctrl+K is NOT customized
        // If user mapped Ctrl+K to something else, this logic might conflict.
        // But for now, preserve existing behavior with safety checks.
        if (e.ctrlKey && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
            // Check if Ctrl+K is assigned to an action? 
            // If not, treat as chord starter.
            const kAction = currentShortcutMap.get('Ctrl+K');
            if (!kAction) {
                e.preventDefault();
                ctrlKPressed = true;
                clearTimeout(ctrlKTimer);
                ctrlKTimer = setTimeout(() => { ctrlKPressed = false; }, 2000);
                return;
            }
        }

        // Reset chord if other key pressed
        if (ctrlKPressed && e.key !== 'Control') {
            ctrlKPressed = false;
            // Here we could handle Chord actions (Ctrl+K, Ctrl+O) if we implemented them.
            // For now, just reset and fall through to normal check.
        }

        const combo = normalizeKeyCombo(e);
        if (!combo) return;

        const actionName = currentShortcutMap.get(combo);
        if (actionName && ACTION_HANDLERS[actionName]) {
            e.preventDefault(); // Stop default browser action (e.g. Ctrl+P, Ctrl+S)
            // Capture phase + stopPropagation: the app's table wins over Monaco's
            // built-in bindings, and an editor action bound here (comment line,
            // move line…) runs once instead of once here and once in Monaco.
            e.stopPropagation();
            ACTION_HANDLERS[actionName]();
            return;
        }
    }, true);

    // Also update map when settings change (in initSettings or wherever)
}

// ============================================================================
// CODE FORMATTING - AStyle Integration
// ============================================================================
async function formatCode() {
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;
    if (!editor) return;

    const code = editor.getValue();
    if (!code.trim()) return;


    const position = editor.getPosition();
    const scrollTop = editor.getScrollTop();


    setStatus('formatting', 'Formatting code...');

    try {
        if (!window.electronAPI?.formatCode) {
            setStatus('error', 'Format unavailable');
            termLog('⚠ Code formatting is not available in this environment', 'warning');
            return;
        }

        const result = await window.electronAPI.formatCode(code, 'google');

        if (result.success) {
            const model = editor.getModel();
            if (!model) return;

            // Use executeEdits to preserve undo history (allows Ctrl+Z)
            const fullRange = model.getFullModelRange();

            editor.pushUndoStop(); // Create undo point before edit
            editor.executeEdits('format-code', [{
                range: fullRange,
                text: result.code,
                forceMoveMarkers: true
            }]);
            editor.pushUndoStop();


            if (position) {
                const newLineCount = result.code.split('\n').length;
                const newLine = Math.min(position.lineNumber, newLineCount);
                editor.setPosition({ lineNumber: newLine, column: position.column });
            }
            editor.setScrollTop(scrollTop);

            setStatus('ready', 'Format successful!');
            termLog('✓ Code has been formatted (Google Style) - Press Ctrl+Z to undo', 'success');
        } else {
            setStatus('error', 'Format failed');
            termLog(`Format failed: ${result.error}`, 'error');
        }
    } catch (err) {
        setStatus('error', 'Format error');
        termLog(`Format error: ${err.message}`, 'error');
    }
}


function initTabsScroll() {
    const container = document.getElementById('tabs-container');
    container.addEventListener('wheel', e => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            container.scrollLeft += e.deltaY;
        }
    });
}
