// ============================================================================
// VIM MODE - monaco-vim, Settings › Editor › Vim Mode
// ============================================================================
// The keymap is vendor/monaco/vim.js (a second entry of the Monaco bundle, see
// scripts/build-monaco.js), imported on first use so the editor starts without it.
// While Vim Mode is on, shortcuts come from the Vim keybinding profile
// (DEFAULT_SETTINGS.keybindingsVim), which leaves the Ctrl keys Vim needs to Vim.

let vimBundle = null;            // promise of window.MonacoVim
let VimStatusBar = null;         // monaco-vim's status bar, minus the "<Esc>" it leaves in the key buffer
const vimEditors = new Map();    // editor -> { adapter, node, focusListener }

function isVimModeOn() {
    return App.settings?.editor?.vimMode === true;
}

function loadVimBundle() {
    if (!vimBundle) {
        vimBundle = import(new URL('vendor/monaco/vim.js', document.baseURI).href)
            .then(() => {
                const { StatusBar, VimMode } = window.MonacoVim;
                VimStatusBar = class extends StatusBar {
                    setKeyBuffer(keys) { super.setKeyBuffer(keys.replace(/<Esc>/g, '')); }
                };
                defineVimExCommands(VimMode.Vim);
                return window.MonacoVim;
            })
            .catch(err => {
                vimBundle = null;   // let the next attempt retry
                throw err;
            });
    }
    return vimBundle;
}

// :w saves, :q closes the tab, :wq / :x do both, all on the focused pane's tab.
function defineVimExCommands(Vim) {
    const saveThenClose = async () => {
        await ACTION_HANDLERS.save();
        ACTION_HANDLERS.closeTab();
    };
    Vim.defineEx('write', 'w', () => { ACTION_HANDLERS.save(); });
    Vim.defineEx('quit', 'q', () => ACTION_HANDLERS.closeTab());
    Vim.defineEx('wq', 'wq', saveThenClose);
    Vim.defineEx('xit', 'x', saveThenClose);
}

/**
 * Attaches or detaches Vim on every editor to match the setting. `editor` is one being created
 * right now, before createEditor's caller has stored it in App.editor / App.editor2.
 */
async function applyVimMode(editor) {
    const editors = [App.editor, App.editor2, editor].filter(Boolean);
    if (!isVimModeOn()) {
        for (const ed of [...vimEditors.keys()]) detachVim(ed);
        showVimStatusFor(null);
        return;
    }
    let MonacoVim;
    try {
        MonacoVim = await loadVimBundle();
    } catch (err) {
        console.error('Vim Mode: could not load vendor/monaco/vim.js', err);
        if (typeof showToast === 'function') showToast('Vim Mode could not be loaded', 'error');
        return;
    }
    if (!isVimModeOn()) return;   // turned off while the bundle loaded
    for (const ed of editors) {
        if (!vimEditors.has(ed)) attachVim(ed, MonacoVim);
    }
    showVimStatusFor(getActiveEditor());
}

function attachVim(editor, MonacoVim) {
    const container = document.getElementById('vim-status');
    const node = document.createElement('span');
    node.className = 'vim-status-pane';
    if (container) container.appendChild(node);
    const adapter = MonacoVim.initVimMode(editor, node, VimStatusBar);
    const focusListener = editor.onDidFocusEditorText(() => showVimStatusFor(editor));
    vimEditors.set(editor, { adapter, node, focusListener });
}

function detachVim(editor) {
    const entry = vimEditors.get(editor);
    if (!entry) return;
    vimEditors.delete(editor);
    entry.focusListener.dispose();
    try {
        entry.adapter.dispose();   // gives the keys back to Monaco
    } catch (err) {
        console.warn('Vim Mode: dispose failed', err);
    }
    // monaco-vim leaves its insert-mode cursor (a flat "blink"); restore the app's.
    editor.updateOptions({
        cursorStyle: 'line',
        cursorWidth: 0,
        cursorBlinking: App.settings.appearance.performanceMode ? 'solid' : 'smooth'
    });
    entry.node.remove();
}

// One status line per editor; only the focused pane's is shown (the left one when none is).
// monaco-vim sets an inline display on its node, so visibility is set the same way.
function showVimStatusFor(editor) {
    const container = document.getElementById('vim-status');
    if (container) container.classList.toggle('hidden', vimEditors.size === 0);
    const shown = vimEditors.has(editor) ? editor : App.editor;
    for (const [ed, entry] of vimEditors) {
        entry.node.style.display = ed === shown ? '' : 'none';
    }
}
