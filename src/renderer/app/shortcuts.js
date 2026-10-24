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
    'save': () => window.ThemeCustomizer?.popup ? ThemeCustomizer.save() : save(),
    'saveAs': () => window.ThemeCustomizer?.popup ? ThemeCustomizer.save({ asNew: true }) : saveAs(),
    'newFile': () => newFile(),
    'openFile': () => openFile(),
    'newTab': () => newFile(),
    'closeTab': () => { const id = getPreferredTabId(); if (id) closeTab(id); },
    'nextTab': () => cycleTab(1),
    'prevTab': () => cycleTab(-1),
    'toggleProblems': () => toggleProblems(),
    'settings': () => openSettings(),
    'toggleSplit': () => toggleSplit(),
    'formatCode': () => formatCode(),
    'markdownPreview': () => window.MarkdownPreview?.toggle(getActiveEditor()),
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
    const right = App.activeEditor === 2 && App.isSplit && !!App.splitTabId;
    const i = App.tabs.findIndex(t => t.id === (right ? App.splitTabId : App.activeTabId));
    const next = App.tabs[(i + step + App.tabs.length) % App.tabs.length];
    if (right && typeof showInSplitPane === 'function') {
        showInSplitPane(next);
        focusEditorPane(2);
    } else {
        setActive(next.id);
    }
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

        // A theme editing session owns focus. Text fields retain native undo/redo;
        // only the configured Save actions are dispatched to the draft.
        if (window.ThemeCustomizer?.popup) {
            const action = currentShortcutMap.get(normalizeKeyCombo(e));
            if (action === 'save' || action === 'saveAs') {
                e.preventDefault();
                e.stopPropagation();
                ACTION_HANDLERS[action]();
            }
            return;
        }

        // Escape closes Settings from anywhere, including while the editor
        // (a textarea) still has focus behind the overlay.
        // A search in Settings is cleared first; the next Escape closes.
        if (e.key === 'Escape' && !clearSettingsSearch()) closeSettings();

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
// Labels for the AStyle presets in app/services/formatter/styles.js.
const FORMAT_STYLE_NAMES = {
    google: 'Google', allman: 'Allman', java: 'Java', kr: 'K&R', stroustrup: 'Stroustrup',
    whitesmith: 'Whitesmith', vtk: 'VTK', ratliff: 'Ratliff', gnu: 'GNU', linux: 'Linux',
    horstmann: 'Horstmann', lisp: 'Lisp', pico: 'Pico'
};

/**
 * The edits that turn `model` into `text`, touching only lines that changed, so breakpoints,
 * error marks and the caret stay on their code. Lines are paired when they are equal apart
 * from whitespace; a reindented line is edited in place, and runs that were split or joined
 * are replaced as a block. Returns null when the files differ too much to be worth pairing.
 */
function formatEdits(model, text) {
    const eol = model.getEOL();
    const a = model.getLinesContent();
    const b = text.split(/\r\n|\n/);
    const key = (s) => s.replace(/\s+/g, '');
    const pairs = matchLines(a.map(key), b.map(key), 2000);
    if (!pairs) return null;

    const starts = (lines) => { const s = [0]; for (let i = 0; i < lines.length; i++) s.push(s[i] + lines[i].length + eol.length); return s; };
    const sa = starts(a), sb = starts(b);
    const oldText = a.join(eol), newText = b.join(eol);
    const end = (s, lines, i) => (i < 0 ? 0 : s[i] + lines[i].length);
    const begin = (s, lines, i) => (i >= lines.length ? end(s, lines, lines.length - 1) : s[i]);

    const edits = [];
    const replace = (from, to, str) => edits.push({
        range: monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to)),
        text: str
    });
    let pi = -1, pj = -1;
    for (const [i, j] of [...pairs, [a.length, b.length]]) {
        // the text between this pair and the previous one, line breaks included
        const from = end(sa, a, pi), to = begin(sa, a, i);
        const str = newText.slice(end(sb, b, pj), begin(sb, b, j));
        if (oldText.slice(from, to) !== str) replace(from, to, str);
        if (i < a.length && a[i] !== b[j]) replace(sa[i], sa[i] + a[i].length, b[j]);
        pi = i; pj = j;
    }
    return edits;
}

/** Pairs [i, j] of equal entries of a and b in order (Myers diff), or null past maxD changes. */
function matchLines(a, b, maxD) {
    const n = a.length, m = b.length, off = n + m + 1;
    const v = new Int32Array(2 * off + 1);
    const trace = [];
    for (let d = 0; d <= Math.min(n + m, maxD); d++) {
        for (let k = -d; k <= d; k += 2) {
            let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) { x++; y++; }
            v[off + k] = x;
            if (x >= n && y >= m) {
                trace.push(v.slice(off - d, off + d + 1));
                return backtrack(trace, n, m);
            }
        }
        trace.push(v.slice(off - d, off + d + 1));
    }
    return null;
}

function backtrack(trace, n, m) {
    const pairs = [];
    let x = n, y = m;
    for (let d = trace.length - 1; d > 0; d--) {
        const prev = trace[d - 1], at = (k) => prev[k + d - 1];
        const k = x - y;
        const pk = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
        const px = at(pk), py = px - pk;
        while (x > px && y > py) { x--; y--; pairs.push([x, y]); }
        x = px; y = py;
    }
    while (x > 0 && y > 0) { x--; y--; pairs.push([x, y]); }
    return pairs.reverse();
}

/**
 * Format the C/C++ file in `editor` (the active one by default) with the style from Settings.
 * The result is one undoable edit. `silent` (format on save) skips the success message.
 * Resolves to true when the text was formatted.
 */
async function formatCode(editor = null, { silent = false } = {}) {
    editor = editor || (App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor);
    if (!editor) return false;
    const model = editor.getModel();
    // AStyle formats C/C++ only; on a write-up it would reflow the text as code.
    if (!model || !isCppTab(getTabForModel(model))) return false;

    const code = model.getValue();
    if (!code.trim()) return false;

    const style = FORMAT_STYLE_NAMES[App.settings.editor?.formatStyle] ? App.settings.editor.formatStyle : 'google';
    const position = editor.getPosition();
    const scrollTop = editor.getScrollTop();

    if (!silent) setStatus('formatting', 'Formatting code...');

    try {
        if (!window.electronAPI?.formatCode) {
            setStatus('error', 'Format unavailable');
            log('⚠ Code formatting is not available in this environment', 'warning');
            return false;
        }

        const result = await window.electronAPI.formatCode(code, style);

        if (result.success) {
            // The user may have switched files or kept typing while AStyle ran.
            if (editor.getModel() !== model || model.getValue() !== code) return false;
            if (result.code === code) {
                if (!silent) setStatus('ready', 'Code is already formatted');
                return true;
            }

            // Use executeEdits to preserve undo history (allows Ctrl+Z)
            const edits = formatEdits(model, result.code);
            editor.pushUndoStop();
            editor.executeEdits('format-code', edits || [{
                range: model.getFullModelRange(),
                text: result.code,
                forceMoveMarkers: true
            }]);
            editor.pushUndoStop();

            // Line-by-line edits keep the caret on its line; a whole-file replace loses it.
            if (!edits && position) {
                const newLine = Math.min(position.lineNumber, model.getLineCount());
                editor.setPosition({ lineNumber: newLine, column: position.column });
            }
            editor.setScrollTop(scrollTop);

            if (!silent) {
                setStatus('ready', 'Format successful!');
                log(`✓ Code has been formatted (${FORMAT_STYLE_NAMES[style]} style) - Press Ctrl+Z to undo`, 'success');
            }
            return true;
        } else {
            setStatus('error', 'Format failed');
            log(`Format failed: ${result.error}`, 'error');
        }
    } catch (err) {
        setStatus('error', 'Format error');
        log(`Format error: ${err.message}`, 'error');
    }
    return false;
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
