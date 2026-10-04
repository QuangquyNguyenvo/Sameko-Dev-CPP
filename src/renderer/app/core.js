/**
 * C++ IDE - Renderer Process
 * 
 * Main application logic for the C++ IDE including:
 * - Monaco Editor integration with syntax highlighting
 * - Tab management and split editor support
 * - Build system integration (compile, run, stop)
 * - Settings management and theme system
 * - Terminal and I/O panel handling
 * 
 * @author Project IDE Team
 * @license MIT
 */

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================
const DEFAULT_SETTINGS = {
    editor: {
        fontSize: 14,
        fontFamily: "'JetBrains Mono', monospace",
        tabSize: 4,
        minimap: true,
        wordWrap: false,
        multiCursorModifier: 'ctrlCmd',
        colorScheme: 'auto',
        autoSave: true,
        autoSaveDelay: 30,  // seconds
        liveCheck: false,  // Real-time syntax checking
        liveCheckDelay: 1000,  // milliseconds
        snippets: true,  // Enable snippet suggestions
        keywords: true,  // Enable keyword suggestions
        intellisense: true  // Clangd-backed completions + hover
    },
    compiler: {
        cppStandard: '',
        optimization: '',
        warnings: false,
        useLLD: true,
        singleFileMode: true,
        fastDebugMode: true,
        disableExceptions: false,
        disableRTTI: false,
        extraFlags: ''
    },
    execution: {
        parallelTests: true,   // batch tests run on a small worker pool
        timeLimitEnabled: false,
        timeLimitSeconds: 3,
        clearTerminal: true,
        autoSendInput: true,
        useExternalTerminal: false,
        panelFontSize: 13,
        noBuildCache: false,
        realtimeOutput: true
    },
    appearance: {
        theme: 'monokai',
        bgOpacity: 50,
        bgUrl: '',
        performanceMode: true,
        uiScale: 'auto'   // 'auto' or a percentage; applied by the main process as the page zoom
    },
    startup: {
        behavior: 'restore-previous-session'
    },
    terminal: {
        colorScheme: 'ansi-16'
    },
    panels: {
        showIO: false,
        showTerm: true,
        showProblems: false,
        terminalDocked: true,
        ioWidth: null,
        termWidth: null,
        problemsHeight: null
    },
    oj: {
        verified: false,
        importTarget: 'new-tab',   // 'new-tab' | 'current-tab'
        importMerge: 'replace'     // 'replace' | 'append' (only used when importTarget = 'current-tab')
    },
    localHistory: {
        enabled: true,
        maxVersions: 20,
        maxAgeDays: 7,
        maxFileSizeKB: 1024
    },
    template: {
        code: `#include<bits/stdc++.h>
using namespace std;

int main() {
    cout << "hello gaialime";
    return 0;
}`
    },
    keybindings: {
        compile: 'F9',
        buildRun: 'F11',
        run: 'F10',
        stop: 'Shift+F5',
        debugStart: 'F5',
        debugStepOut: 'Shift+F11',
        save: 'Ctrl+S',
        saveAs: 'Ctrl+Shift+S',
        newFile: 'Ctrl+N',
        openFile: 'Ctrl+O',
        closeTab: 'Ctrl+W',
        toggleProblems: 'Ctrl+J',
        settings: 'Ctrl+,',
        toggleSplit: 'Ctrl+\\',
        formatCode: 'Ctrl+Shift+A',
        toggleExplorer: 'Ctrl+E',
        commentLine: 'Ctrl+/',
        selectNextOccurrence: 'Ctrl+D',
        selectAllOccurrences: 'Ctrl+Shift+L',
        moveLineUp: 'Alt+Up',
        moveLineDown: 'Alt+Down',
        copyLineUp: 'Shift+Alt+Up',
        copyLineDown: 'Shift+Alt+Down',
        uiZoomIn: 'Ctrl+=',
        uiZoomOut: 'Ctrl+-',
        uiZoomReset: 'Ctrl+0'
    },
    snippets: [
        { trigger: 'hello', name: 'Hello World', content: '#include <iostream>\nusing namespace std;\n\nint main() {\n\tcout << "Hello World!";\n\treturn 0;\n}', isBuiltin: true },
    ],
    discord: {
        enabled: true
    }
};

// ============================================================================
// APPLICATION STATE
// ============================================================================
const App = {
    editor: null,
    editor2: null,
    activeEditor: 1,
    isSplit: false,
    tabs: [],
    activeTabId: null,
    splitTabId: null,
    exePath: null,
    isRunning: false,
    ready: false,
    showIO: false,
    showTerm: true,
    showProblems: false,
    problems: [],
    tabDiagnostics: {},
    inputLines: [],
    inputIndex: 0,
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    errorDecorations: [],
    runTimeout: null,
    ioByTab: {},
    isSettingValue: false
};

function createUntitledHistoryKey() {
    return 'untitled_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function getPreferredTabId() {
    return App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
}

function summarizeDiagnostics(diagnostics = []) {
    return diagnostics.reduce((summary, item) => {
        const severity = String(item?.severity || item?.type || 'info').toLowerCase();
        if (severity === 'error') summary.errors += 1;
        else if (severity === 'warning') summary.warnings += 1;
        else summary.info += 1;
        return summary;
    }, { errors: 0, warnings: 0, info: 0 });
}

function setTabDiagnostics(tabId, diagnostics = []) {
    if (!tabId) return;
    const summary = summarizeDiagnostics(diagnostics);
    if ((summary.errors + summary.warnings + summary.info) === 0) {
        delete App.tabDiagnostics[tabId];
    } else {
        App.tabDiagnostics[tabId] = summary;
    }
    renderTabs();
}

function setActiveTabDiagnostics(diagnostics = []) {
    setTabDiagnostics(getPreferredTabId(), diagnostics);
}

if (typeof window !== 'undefined') {
    window.App = App;

    Object.defineProperties(App, {
        currentFilePath: {
            get() {
                const activeId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
                return App.tabs.find(t => t.id === activeId)?.path || null;
            }
        },
        renderTabs: {
            value: () => renderTabs()
        },
        updateTitle: {
            value: () => {}
        }
    });
}

const DEFAULT_CODE = `#include<bits/stdc++.h>
#define ll long long
using namespace std;
int main() {
    cout << "toi yeu gaialimi";
    return 0;
}
`;

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    applySettings();
    // Monaco is the heaviest part of startup (~0.6s of load + editor create).
    // Don't block first paint on it. It loads on demand the moment a file is
    // opened/created (ensureMonaco() inside setActive), with an idle-time
    // fallback so Monaco-embedding panels (settings template, snippets, theme
    // customizer, checkpoint preview) still work even if no file is opened.
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => ensureMonaco(), { timeout: 1500 });
    } else {
        setTimeout(() => ensureMonaco(), 800);
    }
    initHeader();
    initMenus();
    initPanels();
    initResizers();
    initShortcuts();
    initTabsScroll();
    initSettings();
    initTabDrag();
    initCompetitiveCompanion();
    detectPortableVersion();
    validateCompilerOnStartup();
    updateUI();
    updateProblemSummaryUI();
    setLiveCheckUIState(App.settings.editor.liveCheck ? 'idle' : 'disabled');
    setStatus('Ready', 'ready');
    // The explorer reads its saved state over IPC; restore the session after it,
    // so reopened files can bring the explorer back as it was.
    const explorerReady = typeof FileExplorer !== 'undefined' ? FileExplorer.init() : null;
    Promise.resolve(explorerReady).catch((e) => console.error('[FileExplorer] init failed:', e)).then(initSessionPersistence);

    let resizeRequestId = null;
    window.addEventListener('resize', () => {
        if (resizeRequestId) return;
        resizeRequestId = requestAnimationFrame(() => {
            if (App.editor) App.editor.layout();
            if (App.editor2) App.editor2.layout();
            resizeRequestId = null;
        });
    });

    // Staggered Entrance Animation
    const header = document.querySelector('.header-bar');
    const main = document.querySelector('.main');

    // Prepare for animation
    if (header) {
        header.style.opacity = '0';
        header.classList.add('animate-slide-up');
        // Reset after animation to avoid conflicts
        header.addEventListener('animationend', () => {
            header.style.opacity = '';
            header.classList.remove('animate-slide-up');
        }, { once: true });
    }

    if (main) {
        main.style.opacity = '0';
        // Small delay for main content
        setTimeout(() => {
            main.classList.add('animate-slide-up');
            main.addEventListener('animationend', () => {
                main.style.opacity = '';
                main.classList.remove('animate-slide-up');
            }, { once: true });
        }, 100);
    }
});

let __monacoLoadPromise = null;

// Load Monaco (the editor engine) on demand. Idempotent: repeated calls return
// the same promise, which resolves once the editor exists and App.ready is true.
function ensureMonaco() {
    if (!__monacoLoadPromise) {
        __monacoLoadPromise = new Promise((resolve) => initMonaco(resolve));
    }
    return __monacoLoadPromise;
}

// ============================================================================
// TAB MODELS
// ============================================================================
// Every tab owns its own Monaco text model. Showing a tab attaches its model
// to the editor (setModel) instead of overwriting one shared model's text
// (setValue), which is what used to wipe the undo history on every tab switch.
// Markers and decorations now belong to the file they were made for, and the
// same tab shown in both split panes is one live document.

/** The tab's model, created on first use. Requires Monaco to be loaded. */
function getTabModel(tab) {
    if (!tab.model || tab.model.isDisposed()) {
        tab.model = monaco.editor.createModel(tab.content || '', 'cpp');
    }
    return tab.model;
}

/** The tab a model belongs to (null for the placeholder/empty model). */
function getTabForModel(model) {
    if (!model) return null;
    return App.tabs.find(t => t.model === model) || null;
}

/** Attach a tab's model to an editor. */
function showTabInEditor(editor, tab) {
    if (!editor || !tab) return;
    const model = getTabModel(tab);
    if (editor.getModel() !== model) editor.setModel(model);
}

/** Detach whatever is shown, leaving the editor on its empty placeholder model. */
function showEmptyModel(editor) {
    if (!editor) return;
    if (!editor.__emptyModel || editor.__emptyModel.isDisposed()) {
        editor.__emptyModel = monaco.editor.createModel('', 'cpp');
    }
    if (editor.getModel() !== editor.__emptyModel) editor.setModel(editor.__emptyModel);
}

/**
 * Replace a tab's whole text from outside the editor (reload from disk,
 * imported template…). Goes through the model when there is one so every
 * editor showing the tab updates; never marks the file as "edited".
 */
function setTabText(tab, text) {
    tab.content = text;
    if (tab.model && !tab.model.isDisposed()) {
        App.isSettingValue = true;
        try { tab.model.setValue(text); } finally { App.isSettingValue = false; }
    }
}

/** Free a closed tab's model, detaching it from any editor first. */
function disposeTabModel(tab) {
    const model = tab.model;
    if (!model) return;
    tab.model = null;
    if (App.editor && App.editor.getModel() === model) showEmptyModel(App.editor);
    if (App.editor2 && App.editor2.getModel() === model) showEmptyModel(App.editor2);
    if (!model.isDisposed()) model.dispose();
}

/** Decorations live on a model: clear ours before another model is attached. */
function clearEditorDecorationsBeforeSwitch() {
    clearErrorDecorations();
    if (window.Debugger && typeof window.Debugger.onFileHidden === 'function') {
        try { window.Debugger.onFileHidden(); } catch (_) { }
    }
}

// Push the active tab's content into the editor once Monaco is ready. Covers the
// case where tabs were opened/restored before the (deferred) editor finished
// loading — replacing the old fragile "wait 300ms and hope Monaco is ready"
// assumption in initSessionPersistence with an explicit, timing-independent sync.
function syncEditorToActiveTab() {
    if (!App.editor || !App.ready || !App.activeTabId) return;
    const tab = App.tabs.find(t => t.id === App.activeTabId);
    if (!tab) return;
    showTabInEditor(App.editor, tab);
    if (tab.viewState) {
        App.editor.restoreViewState(tab.viewState);
    } else {
        App.editor.setPosition({ lineNumber: 1, column: 1 });
    }
}

function initMonaco(onReady) {
    require(['vs/editor/editor.main'], async function () {

        // Register enhanced C++ tokenizer with escape sequence highlighting
        monaco.languages.setMonarchTokensProvider('cpp', {
            defaultToken: '',
            tokenPostfix: '.cpp',
            keywords: [
                'abstract', 'alignas', 'alignof', 'and', 'and_eq', 'asm',
                'bitand', 'bitor', 'break', 'case', 'catch', 'class',
                'co_await', 'co_return',
                'co_yield', 'compl', 'concept', 'const', 'const_cast', 'consteval',
                'constexpr', 'constinit', 'continue', 'decltype', 'default', 'delete',
                'do', 'dynamic_cast', 'else', 'enum', 'explicit', 'export',
                'extern', 'false', 'final', 'for', 'friend', 'goto', 'if',
                'import', 'inline', 'module', 'mutable', 'namespace',
                'new', 'noexcept', 'not', 'not_eq', 'nullptr', 'operator', 'or',
                'or_eq', 'override', 'private', 'protected', 'public', 'register',
                'reinterpret_cast', 'requires', 'return', 'signed', 'sizeof',
                'static', 'static_assert', 'static_cast', 'struct', 'switch',
                'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef',
                'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual',
                'volatile', 'while', 'xor', 'xor_eq'
            ],
            typeKeywords: [
                'auto', 'bool', 'char', 'char8_t', 'char16_t', 'char32_t',
                'double', 'float', 'int', 'long', 'short',
                'void', 'wchar_t',
                'size_t', 'ptrdiff_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
                'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t'
            ],
            builtins: [
                'cout', 'cin', 'endl', 'cerr', 'clog',
                'printf', 'scanf', 'puts', 'getchar', 'putchar',
                'malloc', 'calloc', 'realloc', 'free',
                'memset', 'memcpy', 'memmove', 'memcmp',
                'strlen', 'strcmp', 'strcpy', 'strcat',
                'sort', 'reverse', 'swap', 'min', 'max',
                'abs', 'pow', 'sqrt', 'log', 'ceil', 'floor',
                'gcd', 'lcm', 'lower_bound', 'upper_bound',
                'next_permutation', 'prev_permutation',
                'accumulate', 'count', 'find', 'fill',
                'push_back', 'pop_back', 'push_front', 'pop_front',
                'begin', 'end', 'size', 'empty', 'clear',
                'insert', 'erase', 'front', 'back',
                'first', 'second', 'make_pair', 'make_tuple',
                'stoi', 'stol', 'stoll', 'stof', 'stod',
                'to_string', 'getline', 'substr'
            ],
            operators: [
                '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
                '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
                '<<', '>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
                '%=', '<<=', '>>=', '->', '::', '...'
            ],
            symbols: /[=><!~?:&|+\-*\/\^%]+/,
            escapes: /\\(?:[abfnrtv\\"'0?]|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[0-7]{1,3})/,
            tokenizer: {
                root: [
                    // Preprocessor: #include <header> with highlighted path
                    [/(^\s*#\s*include\s*)(<)([^>]*)(>)/, ['keyword', 'keyword', 'string.include', 'keyword']],
                    // Preprocessor: #include "header" (string part handled by string rules below)
                    [/^\s*#\s*include/, 'keyword'],
                    // Preprocessor directives
                    [/^\s*#\s*\w+/, 'keyword'],
                    // Identifiers and keywords
                    [/[a-zA-Z_]\w*(?=\s*\()/, {
                        cases: {
                            '@keywords': 'keyword',
                            '@typeKeywords': 'type',
                            '@builtins': 'function',
                            '@default': 'function'
                        }
                    }],
                    [/[a-zA-Z_]\w*/, {
                        cases: {
                            '@keywords': 'keyword',
                            '@typeKeywords': 'type',
                            '@builtins': 'variable.predefined',
                            '@default': 'identifier'
                        }
                    }],
                    // Whitespace
                    { include: '@whitespace' },
                    // Delimiters and operators
                    [/[{}()\[\]]/, '@brackets'],
                    [/[<>](?!@symbols)/, '@brackets'],
                    [/@symbols/, {
                        cases: {
                            '@operators': 'operator',
                            '@default': ''
                        }
                    }],
                    // Numbers
                    [/\d*\.\d+([eE][\-+]?\d+)?[fFlL]?/, 'number.float'],
                    [/0[xX][0-9a-fA-F]+[uUlL]*/, 'number.hex'],
                    [/0[bB][01]+[uUlL]*/, 'number.binary'],
                    [/0[0-7]+[uUlL]*/, 'number.octal'],
                    [/\d+[uUlL]*/, 'number'],
                    // Delimiter
                    [/[;,.]/, 'delimiter'],
                    // Strings with escape sequences
                    [/"([^"\\]|\\.)*$/, 'string.invalid'], // non-terminated string
                    [/"/, 'string', '@string_double'],
                    // Characters with escape sequences
                    [/'[^\\']'/, 'string'],
                    [/'/, 'string', '@string_single'],
                ],
                whitespace: [
                    [/[ \t\r\n]+/, ''],
                    [/\/\*/, 'comment', '@comment'],
                    [/\/\/.*$/, 'comment'],
                ],
                comment: [
                    [/[^\/*]+/, 'comment'],
                    [/\*\//, 'comment', '@pop'],
                    [/[\/*]/, 'comment']
                ],
                string_double: [
                    [/@escapes/, 'string.escape'],
                    [/[^\\"]+/, 'string'],
                    [/"/, 'string', '@pop']
                ],
                string_single: [
                    [/@escapes/, 'string.escape'],
                    [/[^\\']+/, 'string'],
                    [/'/, 'string', '@pop']
                ]
            }
        });

        // Initialize ThemeManager (async for JSON loading)
        if (typeof ThemeManager !== 'undefined') {
            try {
                await ThemeManager.init();
            } catch (e) {
                console.error('[ThemeManager] Init failed:', e);
            }
        }

        // Move background images an older version stored inline in
        // localStorage out to files (frees the storage quota).
        if (typeof ThemeManager !== 'undefined' && ThemeManager.migrateStoredAssets) {
            ThemeManager.migrateStoredAssets().catch(() => { });
        }

        // Initialize ThemeMarketplace
        if (typeof ThemeMarketplace !== 'undefined') {
            try {
                await ThemeMarketplace.init();
            } catch (e) {
                console.error('[ThemeMarketplace] Init failed:', e);
            }
        }

        App.editor = createEditor('editor-container');
        App.ready = true;

        // Bring up the debugger UI now that Monaco + the main editor exist.
        if (window.Debugger) { try { window.Debugger.init(); } catch (e) { console.error('[Debugger] init failed:', e); } }

        // If a tab was already active before Monaco finished loading (session
        // restore, or the user opened a file during the deferred load), show it.
        syncEditorToActiveTab();

        // Phase 08 §2.1 — additively fold legacy Settings "Background URL"
        // (perTheme[id].bgUrl) into the canonical `theme-bg-<id>` store before the
        // first theme apply. Copy-only: never deletes, so both UIs keep working.
        if (typeof ThemeManager !== 'undefined'
            && typeof ThemeManager._migratePerThemeBackgrounds === 'function') {
            try { ThemeManager._migratePerThemeBackgrounds(); }
            catch (e) { console.warn('[ThemeManager] bg migration failed:', e); }
        }

        // Apply saved theme
        if (typeof applyTheme === 'function') {
            applyTheme(App.settings.appearance.theme);
        } else if (typeof ThemeManager !== 'undefined') {
            try {
                ThemeManager.setTheme(App.settings.appearance.theme);
            } catch (e) {
                console.error('[ThemeManager] setTheme failed:', e);
            }
        }


        document.getElementById('editor-container').addEventListener('mousedown', () => {
            // Rebuilding every tab on each click in the editor was pure waste;
            // the tab strip only changes when focus moves between panes.
            if (App.activeEditor === 1) return;
            App.activeEditor = 1;
            renderTabs();
        });


        initCtrlWheelZoom();


        if (typeof registerCppIntellisense === 'function') {
            registerCppIntellisense(monaco);
        }

        if (typeof onReady === 'function') onReady();
    });
}

function initCtrlWheelZoom() {

    window.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;

        const editorContainer = e.target.closest('#editor-container, #editor-container-2');
        const panelContainer = e.target.closest('.terminal-body, .terminal-input, .panel-textarea, .docked-io-textarea, .diff-display, #expected-diff, .io-section, .terminal-section, .docked-io-view');

        if (!editorContainer && !panelContainer) return;

        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -1 : 1;

        if (editorContainer) {
            // Zoom editor font size
            const currentSize = App.settings.editor.fontSize;
            const newSize = Math.min(40, Math.max(8, currentSize + delta));
            if (newSize !== currentSize) {
                App.settings.editor.fontSize = newSize;
                if (App.editor) App.editor.updateOptions({ fontSize: newSize });
                if (App.editor2) App.editor2.updateOptions({ fontSize: newSize });
                saveSettingsSoon();
            }
        } else if (panelContainer) {
            // Zoom panel font size (terminal, I/O panels)
            const currentSize = App.settings.execution.panelFontSize || 13;
            const newSize = Math.min(30, Math.max(8, currentSize + delta));
            if (newSize !== currentSize) {
                App.settings.execution.panelFontSize = newSize;
                document.documentElement.style.setProperty('--panel-font-size', newSize + 'px');
                if (window.TerminalManager) TerminalManager.setFontSize(newSize);
                // Update settings slider if visible
                const slider = document.getElementById('set-panelFontSize');
                const valSpan = document.getElementById('val-panelFontSize');
                if (slider) slider.value = newSize;
                if (valSpan) valSpan.textContent = newSize + 'px';
                saveSettingsSoon();
            }
        }
    }, { passive: false, capture: true });
}

// ============================================================================
// MONACO EDITOR THEMES
// ============================================================================


function resolveMultiCursorModifier() {
    const configured = App.settings?.editor?.multiCursorModifier;
    if (configured === 'alt' || configured === 'ctrlCmd') return configured;
    return navigator.platform?.toLowerCase().includes('mac') ? 'alt' : 'ctrlCmd';
}

/**
 * Monaco's `suggest.showX` flags filter by item KIND, and any kind not listed
 * here defaults to *shown*. The old list covered a dozen kinds but not the ones
 * clangd hands back most often — Field, Struct, Enum, EnumMember, Constructor,
 * Constant, Interface — so turning "Intellisense (Code Suggestions)" off still
 * left a popup full of clangd results. Enumerate every kind Monaco knows about
 * so the switch covers the whole widget.
 *
 * These flags are only the display filter; the provider in
 * `features/suggestions/cpp-suggestions.js` also has to stop asking clangd, or
 * we would pay for an LSP round-trip per keystroke just to throw it away.
 * @returns {object}
 */
function buildSuggestOptions() {
    const smart = App.settings.editor.intellisense !== false;
    // "Keyword Suggestions" narrows the identifier-ish kinds further.
    const keywords = smart && App.settings.editor.keywords !== false;
    const snippets = App.settings.editor.snippets !== false;

    return {
        showKeywords: keywords,
        showClasses: keywords,
        showFunctions: keywords,
        showSnippets: snippets,
        showWords: smart,
        showVariables: smart,
        showValues: smart,
        showMethods: smart,
        showProperties: smart,
        showModules: smart,
        showOperators: smart,
        showTypeParameters: smart,
        showFields: smart,
        showStructs: smart,
        showEnums: smart,
        showEnumMembers: smart,
        showConstants: smart,
        showConstructors: smart,
        showInterfaces: smart,
        showEvents: smart,
        showUnits: smart,
        showColors: smart,
        showUsers: smart,
        showIssues: smart,
        showDeprecated: smart,
        showFiles: smart,          // the header list inside `#include <`
        showIcons: true,
        showReferences: false,
        showFolders: false,
        showStatusBar: false,
        preview: true,
        insertMode: 'insert'
    };
}

/**
 * Quick suggestions are what makes the widget appear while typing, so they stay
 * on as long as *either* source of suggestions is enabled.
 * @returns {object}
 */
function buildQuickSuggestions() {
    const on = App.settings.editor.intellisense !== false
        || App.settings.editor.snippets !== false;
    return { other: on, comments: false, strings: on };
}

function createEditor(containerId) {
    const editor = monaco.editor.create(document.getElementById(containerId), {
        value: '',
        language: 'cpp',
        theme: App.settings.appearance.theme || 'kawaii-dark',
        fontSize: App.settings.editor.fontSize,
        fontFamily: App.settings.editor.fontFamily,
        fontLigatures: true,
        wordWrap: App.settings.editor.wordWrap ? 'on' : 'off',
        multiCursorModifier: resolveMultiCursorModifier(),
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: App.settings.editor.tabSize,
        insertSpaces: true,
        detectIndentation: false,
        emptySelectionClipboard: false,
        cursorBlinking: App.settings.appearance.performanceMode ? 'solid' : 'smooth',
        smoothScrolling: !App.settings.appearance.performanceMode,
        bracketPairColorization: { enabled: !App.settings.appearance.performanceMode },
        // Monaco defaults this to false, which silently collapses the glyph margin
        // to 0px — every `glyphMarginClassName` decoration (debugger breakpoint
        // dots, the paused-line arrow, compiler error glyphs) was being drawn into
        // a strip with no width. Breakpoints only ever showed as a tinted line.
        glyphMargin: true,
        padding: { top: 12 },
        // Editor zoom is handled solely by initCtrlWheelZoom + fontSize. Monaco's
        // built-in mouseWheelZoom applies a separate global zoom that re-applies on
        // relayout (e.g. dragging a panel divider), shrinking only the editor. (#36)
        mouseWheelZoom: false,

        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {

            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 14,
            horizontalScrollbarSize: 14,
            arrowSize: 0,
            useShadows: false,

            verticalSliderSize: 14,
            horizontalSliderSize: 14
        },

        minimap: {
            enabled: App.settings.editor.minimap && !App.settings.appearance.performanceMode,
            showSlider: 'always',
            renderCharacters: !App.settings.appearance.performanceMode,
            scale: 1
        },

        quickSuggestions: buildQuickSuggestions(),
        suggestOnTriggerCharacters: App.settings.editor.intellisense !== false,
        acceptSuggestionOnEnter: 'on',
        tabCompletion: 'on',
        wordBasedSuggestions: 'off',
        parameterHints: { enabled: App.settings.editor.intellisense !== false },
        snippetSuggestions: 'top',
        suggest: buildSuggestOptions(),
        suggestSelection: 'first',
        suggestFontSize: 13.5,
        suggestLineHeight: 26
    });

    editor.onDidChangeCursorPosition(e => {
        document.getElementById('cursor-pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        scheduleDiscordCursorUpdate(e.position.lineNumber, e.position.column);
    });

    editor.onDidChangeModelContent(() => {
        // With the same tab open in both panes they share a model and both
        // editors report the change; the model identifies the tab either way.
        const tab = getTabForModel(editor.getModel());
        {
            if (tab) {
                tab.content = editor.getValue();
                const modified = tab.content !== tab.original;
                if (tab.modified !== modified) {
                    tab.modified = modified;
                    renderTabs();
                }
                if (!App.isSettingValue && tab.path && window.FileExplorer?.notifyBuildEvent) {
                    window.FileExplorer.notifyBuildEvent(tab.path, 'edit');
                }
                if (!tab.path && typeof LocalHistory !== 'undefined') {
                    LocalHistory.scheduleUntitledBackup(tab, tab.content);
                }
            }
        }
        clearErrorDecorations();


        scheduleAutoSave();
        scheduleSessionSave();


        scheduleLiveCheck();
    });


    // Auto-indentation after control statements
    editor.onKeyDown((e) => {
        if (e.keyCode === monaco.KeyCode.Enter && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            const position = editor.getPosition();
            const model = editor.getModel();
            if (!model) return;

            const lineNumber = position.lineNumber;
            const lineContent = model.getLineContent(lineNumber).trim();
            const fullLine = model.getLineContent(lineNumber);
            const currentIndent = fullLine.match(/^\s*/)[0];

            // Skip custom handling if line already ends with a brace - let Monaco handle it
            if (/[{}]\s*$/.test(lineContent)) return;

            // Also skip if cursor is not at end of line (user is editing mid-line)
            const lineMaxCol = model.getLineMaxColumn(lineNumber);
            if (position.column < lineMaxCol) return;

            // Case 1: Check if current line ends with statement after control structure (dedent)
            // If line ends with ; and previous line was a control statement without {}, dedent
            if (lineNumber > 1 && /;\s*$/.test(lineContent)) {
                const prevLine = model.getLineContent(lineNumber - 1).trim();
                const isPrevControlStatement = (
                    /^\s*(if|while|for|switch)\s*\([^)]*\)\s*$/.test(prevLine) ||
                    /^\s*(else|do)\s*$/.test(prevLine)
                );

                if (isPrevControlStatement) {
                    // Dedent: go back to previous line's indent level
                    e.preventDefault();
                    const prevFullLine = model.getLineContent(lineNumber - 1);
                    const prevIndent = prevFullLine.match(/^\s*/)[0];

                    editor.executeEdits('auto-dedent', [{
                        range: new monaco.Range(lineNumber, lineMaxCol, lineNumber, lineMaxCol),
                        text: '\n' + prevIndent
                    }]);

                    editor.setPosition({
                        lineNumber: lineNumber + 1,
                        column: prevIndent.length + 1
                    });
                    return;
                }
            }

            // Case 2: Check if line ends with control statement pattern (indent)
            // Match: if/while/for/else followed by condition, or do/else/case/default with :
            const shouldIndent = (
                // if (condition), while (condition), for (condition)
                /^\s*(if|while|for|switch)\s*\([^)]*\)\s*$/.test(lineContent) ||
                // else, do
                /^\s*(else|do)\s*$/.test(lineContent) ||
                // case value:, default:
                /^\s*(case\s+.+|default)\s*:\s*$/.test(lineContent)
            );

            if (shouldIndent) {
                e.preventDefault();

                const tabChar = '\t'; // Use tab character

                // Insert newline + current indent + one more tab
                const newIndent = currentIndent + tabChar;

                editor.executeEdits('auto-indent', [{
                    range: new monaco.Range(lineNumber, lineMaxCol, lineNumber, lineMaxCol),
                    text: '\n' + newIndent
                }]);

                // Set cursor position
                editor.setPosition({
                    lineNumber: lineNumber + 1,
                    column: newIndent.length + 1
                });
            }
        }
    });

    // No editor.addCommand() shortcuts here on purpose. Monaco swallowed those
    // keys before the app's shortcut table (initShortcuts) could see them, so
    // inside the editor F10/F11 always meant Run/Build even mid-debug (instead
    // of Step Over/Into), Shift+F5 stopped the wrong thing, and keybindings
    // changed in Settings had no effect. initShortcuts() now listens in the
    // capture phase and is the single place that maps keys to actions.

    // Monaco disposes a model it created itself as soon as another one is
    // attached, which would leave the editor with NO model once the last tab
    // closes. Give it an explicit placeholder model that we own instead.
    showEmptyModel(editor);

    // Prevent accidental drops into editor (from dragging panels/UI elements)
    const editorContainer = document.getElementById(containerId);
    if (editorContainer) {
        editorContainer.addEventListener('dragover', (e) => {
            // Block internal UI drags (panels, tabs)
            if (e.dataTransfer.types.includes('application/x-sameko-panel') ||
                e.dataTransfer.types.includes('application/x-sameko-tab')) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'none';
                e.dataTransfer.dropEffect = 'none';
            }
            // Allow file drops and external text
        }, true);

        editorContainer.addEventListener('drop', (e) => {
            // Block internal UI drops
            if (e.dataTransfer.types.includes('application/x-sameko-panel') ||
                e.dataTransfer.types.includes('application/x-sameko-tab')) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
            // Allow file and external text drops to proceed
        }, true);
    }

    return editor;
}
