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
        fontFamily: "Consolas, monospace",
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
        keywords: true   // Enable keyword suggestions
    },
    compiler: {
        cppStandard: '',
        optimization: '',
        warnings: false,
        useLLD: true,
        singleFileMode: true,
        fastDebugMode: true,
        disableExceptions: false,
        disableRTTI: false
    },
    execution: {
        timeLimitEnabled: false,
        timeLimitSeconds: 3,
        clearTerminal: true,
        autoSendInput: true,
        useExternalTerminal: false,
        panelFontSize: 13,
        noBuildCache: false
    },
    appearance: {
        theme: 'kawaii-light',
        bgOpacity: 50,
        bgUrl: '',
        performanceMode: true
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
        ioWidth: null,
        termWidth: null,
        problemsHeight: null
    },
    oj: {
        verified: false
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
        save: 'Ctrl+S',
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
        copyLineDown: 'Shift+Alt+Down'
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
    initMonaco();
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
    if (typeof FileExplorer !== 'undefined') FileExplorer.init();
    initSessionPersistence();

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

function initMonaco() {
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
            App.activeEditor = 1;

            renderTabs();
        });


        initCtrlWheelZoom();


        if (typeof registerCppIntellisense === 'function') {
            registerCppIntellisense(monaco);
        }
    });
}

function initCtrlWheelZoom() {

    window.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;

        const editorContainer = e.target.closest('#editor-container, #editor-container-2');
        const panelContainer = e.target.closest('.terminal-body, .terminal-input, .panel-textarea, .docked-io-textarea, .diff-display, #expected-diff, #docked-expected-diff, .io-section, .terminal-section');

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
                saveSettings();
            }
        } else if (panelContainer) {
            // Zoom panel font size (terminal, I/O panels)
            const currentSize = App.settings.execution.panelFontSize || 13;
            const newSize = Math.min(30, Math.max(8, currentSize + delta));
            if (newSize !== currentSize) {
                App.settings.execution.panelFontSize = newSize;
                document.documentElement.style.setProperty('--panel-font-size', newSize + 'px');
                // Update settings slider if visible
                const slider = document.getElementById('set-panelFontSize');
                const valSpan = document.getElementById('val-panelFontSize');
                if (slider) slider.value = newSize;
                if (valSpan) valSpan.textContent = newSize + 'px';
                saveSettings();
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
        cursorBlinking: App.settings.appearance.performanceMode ? 'solid' : 'smooth',
        smoothScrolling: !App.settings.appearance.performanceMode,
        bracketPairColorization: { enabled: !App.settings.appearance.performanceMode },
        padding: { top: 12 },
        mouseWheelZoom: !App.settings.appearance.performanceMode,

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

        quickSuggestions: {
            other: (App.settings.editor.intellisense !== false || App.settings.editor.snippets !== false),
            comments: false,
            strings: (App.settings.editor.intellisense !== false || App.settings.editor.snippets !== false)
        },
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: 'on',
        tabCompletion: 'on',
        wordBasedSuggestions: App.settings.editor.intellisense !== false ? 'allDocuments' : 'off',
        parameterHints: { enabled: App.settings.editor.intellisense !== false },
        snippetSuggestions: 'top',
        suggest: {
            showKeywords: App.settings.editor.intellisense !== false && App.settings.editor.keywords !== false,
            showSnippets: App.settings.editor.snippets !== false,
            showWords: App.settings.editor.intellisense !== false,
            showClasses: App.settings.editor.intellisense !== false && App.settings.editor.keywords !== false,
            showFunctions: App.settings.editor.intellisense !== false && App.settings.editor.keywords !== false,
            showVariables: App.settings.editor.intellisense !== false,
            showValues: App.settings.editor.intellisense !== false,
            showIcons: true,
            showMethods: App.settings.editor.intellisense !== false,
            showProperties: App.settings.editor.intellisense !== false,
            showModules: App.settings.editor.intellisense !== false,
            showOperators: App.settings.editor.intellisense !== false,
            showReferences: false,
            showFolders: false,
            showTypeParameters: App.settings.editor.intellisense !== false,
            showStatusBar: false,
            preview: true,
            insertMode: 'insert'
        },
        suggestSelection: 'first',
        suggestFontSize: 13.5,
        suggestLineHeight: 26
    });

    editor.onDidChangeCursorPosition(e => {
        document.getElementById('cursor-pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        scheduleDiscordCursorUpdate(e.position.lineNumber, e.position.column);
    });

    editor.onDidChangeModelContent(() => {
        const tabId = containerId === 'editor-container' ? App.activeTabId : App.splitTabId;
        if (tabId) {
            const tab = App.tabs.find(t => t.id === tabId);
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

    editor.addCommand(monaco.KeyCode.F9, compileOnly);
    editor.addCommand(monaco.KeyCode.F11, buildRun);
    editor.addCommand(monaco.KeyCode.F10, run);
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F5, stop);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, newFile);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, openFile);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, toggleProblems);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Comma, openSettings);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, toggleSplit);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyA, formatCode);

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

// ============================================================================
// SPLIT EDITOR
// ============================================================================
function toggleSplit() {
    if (App.isSplit) {
        closeSplit();
    } else {
        openSplit();
    }
}

function openSplit() {
    if (App.isSplit || App.tabs.length < 1) return;

    App.isSplit = true;
    document.body.classList.add('split-active');


    const pane2 = document.getElementById('editor-pane-2');
    const resizer = document.getElementById('resizer-split');

    pane2.style.display = 'flex';
    resizer.style.display = 'block';


    if (!App.editor2) {
        App.editor2 = createEditor('editor-container-2');
        document.getElementById('editor-container-2').addEventListener('mousedown', () => {
            App.activeEditor = 2;

            renderTabs();
        });
    }


    if (App.editor) App.editor.updateOptions({ minimap: { enabled: false } });
    if (App.editor2) App.editor2.updateOptions({ minimap: { enabled: false } });


    if (App.tabs.length > 1) {

        const otherTab = App.tabs.find(t => t.id !== App.activeTabId);
        if (otherTab) {
            App.splitTabId = otherTab.id;
            App.editor2.setValue(otherTab.content);
        }
    } else {

        App.splitTabId = App.activeTabId;
        const tab = App.tabs.find(t => t.id === App.activeTabId);
        if (tab) App.editor2.setValue(tab.content);
    }


    // Use transitionend to trigger layout exactly when animation finishes
    const onTransitionEnd = (e) => {
        if (e.propertyName === 'width' || e.propertyName === 'flex-grow') {
            if (App.editor) App.editor.layout();
            if (App.editor2) App.editor2.layout();
            pane2.removeEventListener('transitionend', onTransitionEnd);
        }
    };
    pane2.addEventListener('transitionend', onTransitionEnd);

    // Fallback in case transition doesn't fire (e.g. hidden)
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
        pane2.removeEventListener('transitionend', onTransitionEnd);
    }, 350); // Slightly longer than CSS transition time
}

function closeSplit() {
    if (!App.isSplit) return;


    if (App.splitTabId && App.editor2) {
        const tab = App.tabs.find(t => t.id === App.splitTabId);
        if (tab) tab.content = App.editor2.getValue();
    }

    App.isSplit = false;
    App.splitTabId = null;
    App.activeEditor = 1;
    document.body.classList.remove('split-active');

    document.getElementById('editor-pane-2').style.display = 'none';
    document.getElementById('resizer-split').style.display = 'none';


    const minimapEnabled = App.settings?.editor?.minimap !== false;
    if (App.editor) App.editor.updateOptions({ minimap: { enabled: minimapEnabled } });


    const resizer = document.getElementById('resizer-split');
    const onTransitionEnd = (e) => {
        if (App.editor) App.editor.layout();
        resizer.removeEventListener('transitionend', onTransitionEnd);
    };
    resizer.addEventListener('transitionend', onTransitionEnd);

    // Fallback
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        resizer.removeEventListener('transitionend', onTransitionEnd);
    }, 350);

    // Reset pane 1 to full width
    const pane1 = document.getElementById('editor-pane-1');
    if (pane1) {
        pane1.style.flex = '1';
        pane1.style.width = '';
        pane1.style.maxWidth = '';
    }
}

// Swap files between left and right editors
function swapSplitEditors() {
    if (!App.isSplit || !App.editor2) return;


    const leftTab = App.tabs.find(t => t.id === App.activeTabId);
    const rightTab = App.tabs.find(t => t.id === App.splitTabId);

    if (leftTab) leftTab.content = App.editor.getValue();
    if (rightTab) rightTab.content = App.editor2.getValue();


    const tempId = App.activeTabId;
    App.activeTabId = App.splitTabId;
    App.splitTabId = tempId;


    const leftContent = App.editor.getValue();
    const rightContent = App.editor2.getValue();

    App.editor.setValue(rightContent);
    App.editor2.setValue(leftContent);


    renderTabs();
}

function initTabDrag() {

    const container = document.getElementById('tabs-container');
    const editorPane1 = document.getElementById('editor-pane-1');
    const editorPane2 = document.getElementById('editor-pane-2');

    let draggedTabId = null;
    let draggedTabEl = null;
    let dropIndicator = null;


    function createDropIndicator() {
        if (!dropIndicator) {
            dropIndicator = document.createElement('div');
            dropIndicator.className = 'tab-drop-indicator';
        }
        return dropIndicator;
    }

    container.addEventListener('dragstart', e => {
        const tab = e.target.closest('.tab');
        if (tab) {
            draggedTabId = tab.dataset.id;
            draggedTabEl = tab;
            e.dataTransfer.effectAllowed = 'move';
            tab.classList.add('dragging');

            // Set custom type to prevent drop into editor
            e.dataTransfer.setData('application/x-sameko-tab', tab.dataset.id);

            e.dataTransfer.setDragImage(tab, tab.offsetWidth / 2, tab.offsetHeight / 2);
        }
    });

    // Cache for drag operations to prevent layout thrashing
    let cachedTabs = [];

    container.addEventListener('dragstart', e => {
        const tab = e.target.closest('.tab');
        if (tab) {
            draggedTabId = tab.dataset.id;
            draggedTabEl = tab;
            e.dataTransfer.effectAllowed = 'move';
            tab.classList.add('dragging');
            e.dataTransfer.setDragImage(tab, tab.offsetWidth / 2, tab.offsetHeight / 2);

            // Cache positions once at start
            cachedTabs = [...container.querySelectorAll('.tab:not(.dragging)')].map(child => ({
                element: child,
                rect: child.getBoundingClientRect(),
                offset: 0
            }));
        }
    });

    container.addEventListener('dragend', e => {
        const tab = e.target.closest('.tab');
        if (tab) tab.classList.remove('dragging');
        draggedTabId = null;
        draggedTabEl = null;

        if (dropIndicator && dropIndicator.parentNode) {
            dropIndicator.parentNode.removeChild(dropIndicator);
        }

        cachedTabs = []; // Clear cache
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
    });


    let dragOverRafId = null;
    container.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        if (!draggedTabEl) return;

        if (dragOverRafId) return;

        dragOverRafId = requestAnimationFrame(() => {
            const afterElement = getDragAfterElement(container, e.clientX);
            const indicator = createDropIndicator();

            container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));

            if (afterElement) {
                afterElement.classList.add('drag-over-left');
            } else {
                const lastTab = container.querySelector('.tab:last-of-type');
                if (lastTab && lastTab !== draggedTabEl) {
                    lastTab.classList.add('drag-over-right');
                }
            }
            dragOverRafId = null;
        });
    });

    container.addEventListener('dragleave', e => {

        if (e.target === container) {
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
        }
    });

    container.addEventListener('drop', e => {
        e.preventDefault();

        if (!draggedTabId) return;


        const droppedOnTab = e.target.closest('.tab');
        const droppedOnContainer = e.target.closest('.tabs-container');

        if (droppedOnContainer || droppedOnTab) {

            const draggedIndex = App.tabs.findIndex(t => t.id === draggedTabId);
            if (draggedIndex === -1) return;

            const afterElement = getDragAfterElement(container, e.clientX);
            let targetIndex;

            if (afterElement) {
                const afterId = afterElement.dataset.id;
                targetIndex = App.tabs.findIndex(t => t.id === afterId);
            } else {
                targetIndex = App.tabs.length;
            }


            if (draggedIndex !== targetIndex && draggedIndex !== targetIndex - 1) {
                const [draggedTab] = App.tabs.splice(draggedIndex, 1);

                if (draggedIndex < targetIndex) {
                    targetIndex--;
                }
                App.tabs.splice(targetIndex, 0, draggedTab);
                renderTabs();
            }
        }


        container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
    });


    function getDragAfterElement(container, x) {
        // Use cached tabs if available, otherwise query (fallback)
        const elementsInfo = cachedTabs.length > 0 ? cachedTabs :
            [...container.querySelectorAll('.tab:not(.dragging)')].map(child => ({
                element: child,
                rect: child.getBoundingClientRect()
            }));

        return elementsInfo.reduce((closest, childInfo) => {
            const box = childInfo.rect;
            const offset = x - box.left - box.width / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: childInfo.element };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }


    [editorPane1, editorPane2].forEach((pane, idx) => {
        pane.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            pane.classList.add('drop-target');
        });

        pane.addEventListener('dragleave', () => {
            pane.classList.remove('drop-target');
        });

        pane.addEventListener('drop', e => {
            e.preventDefault();
            pane.classList.remove('drop-target');

            if (!draggedTabId) return;


            if (e.target.closest('.tabs-container')) return;

            const tab = App.tabs.find(t => t.id === draggedTabId);
            if (!tab) return;

            if (idx === 0) {

                setActive(draggedTabId);
            } else {

                if (!App.isSplit) openSplit();
                App.splitTabId = draggedTabId;
                if (App.editor2) App.editor2.setValue(tab.content);
            }
        });
    });
}


function setupSplitResizer() {
    const resizer = document.getElementById('resizer-split');
    const pane1 = document.getElementById('editor-pane-1');
    const pane2 = document.getElementById('editor-pane-2');
    let dragging = false;
    let startX, startW1, startW2;

    resizer.onmousedown = e => {
        dragging = true;
        startX = e.clientX;
        startW1 = pane1.offsetWidth;
        startW2 = pane2.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    };

    let rafId = null;
    document.addEventListener('mousemove', e => {
        if (!dragging) return;

        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            const dx = e.clientX - startX;
            const totalWidth = startW1 + startW2;

            // Calc new width for pane1, clamping min 200px
            let newW1 = startW1 + dx;

            // Constraint: pane1 min 200px
            if (newW1 < 200) newW1 = 200;
            // Constraint: pane2 min 200px (meaning pane1 max = total - 200)
            if (newW1 > totalWidth - 200) newW1 = totalWidth - 200;

            // Convert to percentage
            const p1 = (newW1 / totalWidth) * 100;
            const p2 = 100 - p1;

            pane1.style.flex = 'none';
            pane2.style.flex = 'none';
            pane1.style.width = `${p1}%`;
            pane2.style.width = `${p2}%`;

            // Layout immediately during resize for responsiveness
            if (App.editor) App.editor.layout();
            if (App.editor2) App.editor2.layout();

            rafId = null;
        });
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            persistPanelSize(targetId, target.offsetWidth);
        }
    });
}

// ============================================================================
// SETTINGS
// ============================================================================
function loadSettings() {
    try {
        let saved = null;
        if (window.electronAPI?.loadSettings) {
            saved = window.electronAPI.loadSettings();
        } else {
            const storedStr = localStorage.getItem('ide-settings');
            if (storedStr) saved = JSON.parse(storedStr);
        }

        if (saved) {
            App.settings = {
                editor: { ...DEFAULT_SETTINGS.editor, ...saved.editor },
                compiler: { ...DEFAULT_SETTINGS.compiler, ...saved.compiler },
                execution: { ...DEFAULT_SETTINGS.execution, ...saved.execution },
                appearance: sanitizeAppearanceSettings({
                    ...DEFAULT_SETTINGS.appearance,
                    ...saved.appearance,
                    perTheme: saved.appearance?.perTheme || {}
                }),
                startup: { ...DEFAULT_SETTINGS.startup, ...saved.startup },
                terminal: { ...DEFAULT_SETTINGS.terminal, ...saved.terminal },
                panels: { ...DEFAULT_SETTINGS.panels, ...saved.panels },
                oj: { ...DEFAULT_SETTINGS.oj, ...saved.oj },
                template: { ...DEFAULT_SETTINGS.template, ...saved.template },
                keybindings: { ...DEFAULT_SETTINGS.keybindings, ...saved.keybindings },
                snippets: saved.snippets || DEFAULT_SETTINGS.snippets,
                localHistory: { ...DEFAULT_SETTINGS.localHistory, ...saved.localHistory },
                discord: { ...DEFAULT_SETTINGS.discord, ...saved.discord }
            };
        }

        // Load panels state from settings
        if (App.settings.panels) {
            App.showIO = App.settings.panels.showIO ?? false;
            App.showTerm = App.settings.panels.showTerm ?? true;
            App.showProblems = App.settings.panels.showProblems ?? false;
        }
    } catch (e) {
        console.log('Using default settings', e);
    }
}

function clearThemeBackgroundOverrides() {
    try {
        if (typeof ThemeManager !== 'undefined' && ThemeManager.builtinThemeIds) {
            ThemeManager.builtinThemeIds.forEach(id => {
                localStorage.removeItem(`theme-bg-${id}`);
            });
        }
    } catch (e) {
        console.warn('Failed to clear saved theme backgrounds', e);
    }
}

function sanitizeAppearanceSettings(appearance) {
    if (!appearance) return DEFAULT_SETTINGS.appearance;

    const normalizeBgUrl = (url) => {
        if (!url) return '';
        const cleaned = String(url).trim();
        if (!cleaned) return '';

        // Guard against bogus values like '\\' or root-only paths that break background loading
        const invalidSingletons = ['\\', '/', '.', './', '..'];
        if (invalidSingletons.includes(cleaned)) return '';

        // If url starts with just 'file://' with nothing else, treat as invalid
        if (cleaned.toLowerCase() === 'file://' || cleaned.toLowerCase() === 'file:') return '';

        return cleaned;
    };

    const cleanedAppearance = { ...appearance };
    cleanedAppearance.bgUrl = normalizeBgUrl(appearance.bgUrl);

    if (!cleanedAppearance.perTheme) cleanedAppearance.perTheme = {};
    for (const themeId of Object.keys(cleanedAppearance.perTheme)) {
        const bgUrl = cleanedAppearance.perTheme[themeId]?.bgUrl;
        const normalized = normalizeBgUrl(bgUrl);
        if (normalized) {
            cleanedAppearance.perTheme[themeId] = {
                ...cleanedAppearance.perTheme[themeId],
                bgUrl: normalized
            };
        } else {
            delete cleanedAppearance.perTheme[themeId].bgUrl;
        }
    }

    return cleanedAppearance;
}

function saveSettings() {
    try {
        console.log('[Settings] Saving:', JSON.stringify(App.settings.appearance));
        if (window.electronAPI?.saveSettings) {
            return window.electronAPI.saveSettings(App.settings);
        } else {
            localStorage.setItem('ide-settings', JSON.stringify(App.settings));
            return Promise.resolve({ success: true });
        }
    } catch (e) {
        console.error('Failed to save settings', e);
        return Promise.reject(e);
    }
}

function initSettings() {
    document.getElementById('btn-settings').onclick = openSettings;
    document.getElementById('settings-close').onclick = closeSettings;
    document.getElementById('settings-overlay').onclick = e => {
        if (e.target.id === 'settings-overlay') closeSettings();
    };

    // Header restart/update button
    const headerUpdateBtn = document.getElementById('btn-restart-update');
    if (headerUpdateBtn) {
        headerUpdateBtn.onclick = () => {
            if (isPortableVersion) {
                // Portable: Open download page
                window.electronAPI?.openReleasePage?.('https://github.com/nicolenathanael/sameko-cpp-ide/releases');
            } else if (updateDownloaded && window.electronAPI?.quitAndInstall) {
                // Installer: Restart to install
                window.electronAPI.quitAndInstall();
            }
        };
    }

    // Tab switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.onclick = () => {
            // Remove active from all tabs
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));

            // Add active to clicked tab
            tab.classList.add('active');
            const panelId = 'panel-' + tab.dataset.tab;
            document.getElementById(panelId)?.classList.add('active');

            // Re-apply theme colors to fix inline styles
            updateThemePreview();

            // Refresh snippets list if switching to snippets tab
            if (tab.dataset.tab === 'snippets' && typeof renderSnippetsList === 'function') {
                renderSnippetsList();
            }

            // Initialize marketplace carousel when opening appearance tab
            if (tab.dataset.tab === 'appearance' && typeof ThemeMarketplace !== 'undefined') {
                ThemeMarketplace.renderCarousel();
            }
        };
    });

    // Appearance: open marketplace fullscreen
    const openMarketplaceBtn = document.getElementById('btn-theme-marketplace');
    if (openMarketplaceBtn) {
        openMarketplaceBtn.onclick = () => {
            if (typeof ThemeMarketplace !== 'undefined') {
                ThemeMarketplace.openModal();
            }
        };
    }

    // Appearance: open customizer for current theme
    const customizeBtn = document.getElementById('btn-open-customizer');
    if (customizeBtn) {
        customizeBtn.onclick = () => {
            const currentThemeId = document.getElementById('set-theme')?.value || App.settings?.appearance?.theme;
            if (typeof ThemeCustomizer !== 'undefined') {
                ThemeCustomizer.open(currentThemeId || null);
            }
        };
    }

    const fontSizeSlider = document.getElementById('set-fontSize');
    fontSizeSlider.oninput = () => {
        document.getElementById('val-fontSize').textContent = fontSizeSlider.value + 'px';
    };

    const fontFamilySelect = document.getElementById('set-fontFamily');
    const fontFamilyCustom = document.getElementById('set-fontFamilyCustom');
    if (fontFamilySelect && fontFamilyCustom) {
        fontFamilySelect.onchange = () => {
            const isCustom = fontFamilySelect.value === 'custom';
            fontFamilyCustom.style.display = isCustom ? 'block' : 'none';
            if (isCustom) {
                if (!fontFamilyCustom.value.trim()) {
                    fontFamilyCustom.value = App.settings.editor.fontFamily || DEFAULT_SETTINGS.editor.fontFamily;
                }
                fontFamilyCustom.focus();
                fontFamilyCustom.select();
            }
        };
    }

    // Live Background Opacity (optional - may not exist if Background section removed)
    const bgOpacitySlider = document.getElementById('set-bgOpacity');
    if (bgOpacitySlider) {
        bgOpacitySlider.oninput = () => {
            const val = bgOpacitySlider.value;
            document.getElementById('val-bgOpacity').textContent = val + '%';
        };
    }

    // Live Theme Update
    document.getElementById('set-theme').onchange = () => {
        const newTheme = document.getElementById('set-theme').value;
        // Apply to whole app immediately
        if (typeof ThemeManager !== 'undefined') {
            ThemeManager.setTheme(newTheme);
            // Update background input for this theme (if exists)
            const perTheme = App.settings.appearance.perTheme || {};
            const themeSettings = perTheme[newTheme] || {};
            const themeBgUrl = themeSettings.bgUrl || '';
            const bgUrlInput = document.getElementById('set-bgUrl');
            if (bgUrlInput) bgUrlInput.value = themeBgUrl;

            const oldTheme = App.settings.appearance.theme;
            App.settings.appearance.theme = newTheme;
            applyBackgroundSettings();
            App.settings.appearance.theme = oldTheme;

            updateThemePreview();
        }
    };

    const bgFileInput = document.getElementById('set-bgFile');
    if (bgFileInput) {
        bgFileInput.onchange = e => {
            const file = e.target.files[0];
            if (file) {
                if (file.path) {
                    const cleanPath = file.path.replace(/\\/g, '/');
                    const bgUrlInput = document.getElementById('set-bgUrl');
                    if (bgUrlInput) bgUrlInput.value = cleanPath;
                } else {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const bgUrlInput = document.getElementById('set-bgUrl');
                        if (bgUrlInput) bgUrlInput.value = ev.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            }
        };
    }

    // AutoSave Checkbox Toggle
    const autoSaveSwitch = document.getElementById('set-autoSave');
    const autoSaveInput = document.getElementById('set-autoSaveDelay');
    if (autoSaveSwitch && autoSaveInput) {
        autoSaveSwitch.onchange = () => {
            autoSaveInput.disabled = !autoSaveSwitch.checked;
            autoSaveInput.style.opacity = autoSaveSwitch.checked ? '1' : '0.5';
        };
    }

    // Reset background button (optional - may not exist if Background section removed)
    const resetBgBtn = document.getElementById('btn-reset-bg');
    if (resetBgBtn) {
        resetBgBtn.onclick = () => {
            const bgUrlInput = document.getElementById('set-bgUrl');
            if (bgUrlInput) bgUrlInput.value = '';
        };
    }

    document.getElementById('btn-save-settings').onclick = saveSettingsAndClose;
    document.getElementById('btn-reset-settings').onclick = resetSettings;

    // Template reset button
    const templateResetBtn = document.getElementById('btn-template-reset');
    if (templateResetBtn) {
        templateResetBtn.onclick = resetTemplate;
    }

    // Template Monaco editor will be initialized when settings panel opens


    // Keybindings reset button
    const keybindingsResetBtn = document.getElementById('btn-keybindings-reset');
    if (keybindingsResetBtn) {
        keybindingsResetBtn.onclick = resetKeybindings;
    }

    // Initialize About & Updates
    initAbout();
}

// Template editor (Monaco mini editor for settings)
let templateEditor = null;

function initTemplateEditor() {
    const container = document.getElementById('template-editor-container');
    if (!container || templateEditor) return;

    templateEditor = monaco.editor.create(container, {
        value: App.settings.template?.code || DEFAULT_SETTINGS.template.code,
        language: 'cpp',
        theme: App.settings.appearance.theme || 'kawaii-dark',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Consolas', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        lineNumbers: 'on',
        folding: false,
        renderWhitespace: 'none',
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        }
    });

    // Sync to hidden textarea on change
    templateEditor.onDidChangeModelContent(() => {
        document.getElementById('set-template').value = templateEditor.getValue();
    });
}

// Theme color palettes for preview and settings
const THEME_COLORS = {
    'kawaii-dark': {
        headerBg: '#2d3748', editorBg: '#1a202c', terminalBg: '#171923', statusBg: '#2d3748', ioBg: '#1e2530',
        text: '#e2e8f0', textMuted: '#a0aec0', lineNum: '#4a5568',
        keyword: '#88c9ea', string: '#a3d9a5', type: '#ebcb8b', func: '#88c9ea',
        accent: '#88c9ea', success: '#68d391', info: '#63b3ed',
        // Settings popup colors
        popupBg: '#2d3748', sidebarBg: '#1e2530', contentBg: '#1a202c',
        border: '#4a5568', borderLight: '#3d4a5c', accentColor: '#88c9ea'
    },
    'kawaii-light': {
        headerBg: '#88c9ea', editorBg: '#f8fafc', terminalBg: '#1e2530', statusBg: '#88c9ea', ioBg: '#ffffff',
        text: '#2d3748', textMuted: '#64748b', lineNum: '#a0aec0',
        keyword: '#3182ce', string: '#38a169', type: '#d69e2e', func: '#9f7aea',
        accent: '#88c9ea', success: '#38a169', info: '#3182ce',
        // Settings popup colors
        popupBg: '#e8f4fc', sidebarBg: '#ffffff', contentBg: '#ffffff',
        border: '#b8e2f5', borderLight: '#d4eef8', accentColor: '#7fc4e8',
        headerFooterBg: '#c8e7f5'
    },
    'sakura': {
        headerBg: '#ffb7c5', editorBg: '#2d1f2f', terminalBg: '#251a26', statusBg: '#ffb7c5', ioBg: '#fff0f5',
        text: '#f8e8f0', textMuted: '#8b7080', lineNum: '#6d5060',
        keyword: '#ff69b4', string: '#98d998', type: '#da75e3', func: '#ffb07a',
        accent: '#ff69b4', success: '#77dd77', info: '#ffb7c5',
        // Settings popup colors
        popupBg: '#fff0f5', sidebarBg: '#ffe4e1', contentBg: '#fffafa',
        border: '#ffc0cb', borderLight: '#ffb7c5', accentColor: '#ff69b4',
        headerFooterBg: '#ffe4e1'
    },
    'dracula': {
        headerBg: '#282a36', editorBg: '#282a36', terminalBg: '#1e1f29', statusBg: '#282a36', ioBg: '#21222c',
        text: '#f8f8f2', textMuted: '#6272a4', lineNum: '#6272a4',
        keyword: '#ff79c6', string: '#50fa7b', type: '#8be9fd', func: '#ffb86c',
        accent: '#bd93f9', success: '#50fa7b', info: '#8be9fd',
        // Settings popup colors
        popupBg: '#282a36', sidebarBg: '#21222c', contentBg: '#282a36',
        border: '#6272a4', borderLight: '#44475a', accentColor: '#bd93f9'
    },
    'monokai': {
        headerBg: '#272822', editorBg: '#272822', terminalBg: '#1e1f1c', statusBg: '#272822', ioBg: '#1e1f1c',
        text: '#f8f8f2', textMuted: '#75715e', lineNum: '#75715e',
        keyword: '#f92672', string: '#a6e22e', type: '#66d9ef', func: '#e6db74',
        accent: '#a6e22e', success: '#a6e22e', info: '#66d9ef',
        // Settings popup colors
        popupBg: '#272822', sidebarBg: '#1e1f1c', contentBg: '#272822',
        border: '#75715e', borderLight: '#49483e', accentColor: '#a6e22e'
    },
    'nord': {
        headerBg: '#3b4252', editorBg: '#2e3440', terminalBg: '#242933', statusBg: '#3b4252', ioBg: '#2e3440',
        text: '#eceff4', textMuted: '#4c566a', lineNum: '#4c566a',
        keyword: '#b48ead', string: '#a3be8c', type: '#88c0d0', func: '#ebcb8b',
        accent: '#88c0d0', success: '#a3be8c', info: '#88c0d0',
        // Settings popup colors
        popupBg: '#2e3440', sidebarBg: '#3b4252', contentBg: '#2e3440',
        border: '#4c566a', borderLight: '#434c5e', accentColor: '#88c0d0'
    },
    'one-dark': {
        headerBg: '#282c34', editorBg: '#282c34', terminalBg: '#21252b', statusBg: '#282c34', ioBg: '#21252b',
        text: '#abb2bf', textMuted: '#5c6370', lineNum: '#4b5263',
        keyword: '#c678dd', string: '#98c379', type: '#61afef', func: '#e5c07b',
        accent: '#61afef', success: '#98c379', info: '#61afef',
        // Settings popup colors
        popupBg: '#282c34', sidebarBg: '#21252b', contentBg: '#282c34',
        border: '#5c6370', borderLight: '#3e4452', accentColor: '#61afef'
    }
};

/**
 * Populate theme dropdown from ThemeManager
 */
function populateThemeDropdowns() {
    if (typeof ThemeManager === 'undefined') return;

    const themeList = ThemeManager.getThemeList();
    const themeSelect = document.getElementById('set-theme');
    const editorColorSelect = document.getElementById('set-editorColorScheme');

    if (themeSelect) {
        // Keep current value
        const currentValue = themeSelect.value;

        // Clear existing options except first (for editor color which has 'auto')
        themeSelect.innerHTML = '';

        // Add themes from ThemeManager
        themeList.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            themeSelect.appendChild(option);
        });

        // Restore value if still exists
        if ([...themeSelect.options].some(o => o.value === currentValue)) {
            themeSelect.value = currentValue;
        }
    }

    if (editorColorSelect) {
        const currentValue = editorColorSelect.value;

        // Keep 'auto' option
        editorColorSelect.innerHTML = '<option value="auto">Auto (Match Theme)</option>';

        // Add themes
        themeList.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            editorColorSelect.appendChild(option);
        });

        if ([...editorColorSelect.options].some(o => o.value === currentValue)) {
            editorColorSelect.value = currentValue;
        }
    }

    // Also render horizontal theme carousel
    populateThemeCarousel(themeList);
}

let _themeCarouselBound = false;
function populateThemeCarousel(themeList) {
    const carousel = document.getElementById('theme-carousel');
    if (!carousel) return;

    const selected = document.getElementById('set-theme')?.value || App.settings?.appearance?.theme || '';

    carousel.innerHTML = '';
    themeList.forEach(t => {
        const themeObj = ThemeManager.themes.get(t.id);
        const bg = themeObj?.editor?.background || themeObj?.colors?.editorBg || '#1a2530';
        const accent = themeObj?.colors?.accent || '#88c9ea';

        const pill = document.createElement('div');
        pill.className = 'theme-pill' + (t.id === selected ? ' active' : '');
        pill.dataset.themeId = t.id;
        pill.innerHTML = `
            <div class="theme-pill-swatch" style="background:${bg}; border-color:${accent}"></div>
            <div class="theme-pill-title">
                <div class="theme-pill-name">${t.name}</div>
                <div class="theme-pill-meta">${t.isBuiltin ? 'Built-in' : 'Custom'} • ${t.type || ''}</div>
            </div>
        `;

        // Note: Click handling is done in bindThemeCarouselInteractions via pointerup
        // to properly distinguish between drag and click

        carousel.appendChild(pill);
    });

    if (!_themeCarouselBound) {
        _themeCarouselBound = true;
        bindThemeCarouselInteractions();
    }
}

function selectThemeFromCarousel(themeId, scrollIntoView = false) {
    const select = document.getElementById('set-theme');
    if (!select) return;
    select.value = themeId;

    // Update carousel active state
    const carousel = document.getElementById('theme-carousel');
    if (carousel) {
        carousel.querySelectorAll('.theme-pill').forEach(el => {
            el.classList.toggle('active', el.dataset.themeId === themeId);
        });
        if (scrollIntoView) {
            const active = carousel.querySelector(`.theme-pill[data-theme-id="${themeId}"]`);
            active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    // Trigger existing flow
    select.dispatchEvent(new Event('change'));
}

function bindThemeCarouselInteractions() {
    const carousel = document.getElementById('theme-carousel');
    const leftBtn = document.getElementById('theme-carousel-left');
    const rightBtn = document.getElementById('theme-carousel-right');
    if (!carousel) return;

    // Wheel: vertical scroll => horizontal browse
    carousel.addEventListener('wheel', (e) => {
        // Allow normal scrolling if user is using trackpad horizontal (deltaX)
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        carousel.scrollLeft += delta;
        e.preventDefault();
    }, { passive: false });

    // Simple click to select theme - no drag functionality
    carousel.addEventListener('click', (e) => {
        const pill = e.target.closest('.theme-pill');
        if (pill && pill.dataset.themeId) {
            selectThemeFromCarousel(pill.dataset.themeId, false);
        }
    });

    if (leftBtn) {
        leftBtn.addEventListener('click', () => carousel.scrollBy({ left: -320, behavior: 'smooth' }));
    }
    if (rightBtn) {
        rightBtn.addEventListener('click', () => carousel.scrollBy({ left: 320, behavior: 'smooth' }));
    }
}

function updateThemePreview() {
    const theme = document.getElementById('set-theme').value;
    const preview = document.getElementById('theme-preview');
    if (!preview) return;

    // Prefer ThemeManager data (supports custom themes)
    const tmTheme = (typeof ThemeManager !== 'undefined') ? ThemeManager.themes.get(theme) : null;
    if (tmTheme) {
        const ui = tmTheme.colors || {};
        const ed = tmTheme.editor || {};
        const syntax = ed.syntax || {};

        const headerBg = ui.bgHeader || ui.bgOceanDark || 'rgba(0,0,0,0.2)';
        const panelBg = ui.bgPanel || ui.bgGlass || 'rgba(0,0,0,0.2)';
        const editorBg = ed.background || ui.editorBg || '#1a2530';
        const text = ui.textPrimary || ed.foreground || '#e0f0ff';
        const muted = ui.textMuted || ui.textSecondary || '#7990a0';
        const accent = ui.accent || '#88c9ea';

        preview.style.background = editorBg;
        preview.style.borderColor = headerBg;

        const header = preview.querySelector('.preview-header');
        if (header) header.style.background = headerBg;

        const tab = preview.querySelector('.preview-tab');
        if (tab) {
            tab.style.background = panelBg;
            tab.style.color = text;
        }

        const body = preview.querySelector('.preview-body');
        if (body) body.style.background = panelBg;

        const editor = preview.querySelector('.preview-editor');
        if (editor) {
            editor.style.background = editorBg;
            editor.style.color = text;
            editor.style.borderColor = ui.border || 'rgba(255,255,255,0.12)';
        }

        preview.querySelectorAll('.preview-io-panel').forEach(panel => {
            panel.style.background = panelBg;
            panel.style.borderColor = ui.border || 'rgba(255,255,255,0.12)';
        });
        preview.querySelectorAll('.preview-io-header').forEach(h => {
            h.style.color = accent;
            h.style.background = ui.bgButtonHover || 'rgba(0,0,0,0.12)';
        });
        preview.querySelectorAll('.preview-io-body').forEach(b => {
            b.style.color = muted;
        });

        const term = preview.querySelector('.preview-terminal');
        if (term) {
            term.style.background = ui.terminalBg || ui.bgPanel || 'rgba(0,0,0,0.2)';
            term.style.borderColor = ui.border || 'rgba(255,255,255,0.12)';
        }
        const termHeader = preview.querySelector('.preview-term-header');
        if (termHeader) {
            termHeader.style.color = accent;
            termHeader.style.background = ui.bgButtonHover || 'rgba(0,0,0,0.12)';
        }

        const status = preview.querySelector('.preview-statusbar');
        if (status) {
            status.style.background = headerBg;
            status.style.color = text;
        }

        // Syntax colors
        const setSyntax = (sel, key, fallback) => {
            const el = preview.querySelector(sel);
            if (!el) return;
            const raw = syntax?.[key]?.color;
            el.style.color = raw ? (raw.startsWith('#') ? raw : `#${raw}`) : fallback;
        };
        setSyntax('.kw', 'keyword', accent);
        setSyntax('.str', 'string', '#a3d9a5');
        setSyntax('.type', 'type', '#e8a8b8');
        setSyntax('.fn', 'function', '#7ec8e3');

        // Line numbers
        preview.querySelectorAll('.ln').forEach(ln => (ln.style.color = muted));

        return;
    }

    const colors = THEME_COLORS[theme] || THEME_COLORS['kawaii-dark'];
    const isLight = theme === 'kawaii-light';


    preview.style.background = colors.editorBg;
    preview.style.borderColor = colors.headerBg;


    const header = preview.querySelector('.preview-header');
    if (header) {
        header.style.background = colors.headerBg;
    }


    const tab = preview.querySelector('.preview-tab');
    if (tab) {
        tab.style.background = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.1)';
        tab.style.color = isLight ? colors.text : colors.textMuted;
    }


    const body = preview.querySelector('.preview-body');
    if (body) {
        body.style.background = isLight ? 'rgba(136,201,234,0.15)' : 'rgba(0,0,0,0.2)';
    }


    const editor = preview.querySelector('.preview-editor');
    if (editor) {
        editor.style.background = colors.editorBg;
        editor.style.color = colors.text;
        editor.style.borderColor = isLight ? 'rgba(136,201,234,0.4)' : 'rgba(255,255,255,0.1)';
    }


    preview.querySelectorAll('.preview-io-panel').forEach(panel => {
        panel.style.background = colors.ioBg;
        panel.style.borderColor = isLight ? 'rgba(136,201,234,0.4)' : 'rgba(255,255,255,0.1)';
    });
    preview.querySelectorAll('.preview-io-header').forEach(h => {
        h.style.color = colors.accent;
        h.style.background = isLight ? 'rgba(136,201,234,0.2)' : 'rgba(136,201,234,0.1)';
    });
    preview.querySelectorAll('.preview-io-body').forEach(b => {
        b.style.color = colors.textMuted;
    });


    const terminal = preview.querySelector('.preview-terminal');
    if (terminal) {
        terminal.style.background = colors.terminalBg;
        terminal.style.borderColor = isLight ? 'rgba(136,201,234,0.4)' : 'rgba(255,255,255,0.1)';
    }
    const termHeader = preview.querySelector('.preview-term-header');
    if (termHeader) {
        termHeader.style.color = colors.accent;
    }
    const termContent = preview.querySelector('.preview-term-content');
    if (termContent) {
        termContent.style.color = colors.text;
    }


    preview.querySelectorAll('.ln').forEach(el => el.style.color = colors.lineNum);
    preview.querySelectorAll('.kw').forEach(el => el.style.color = colors.keyword);
    preview.querySelectorAll('.str').forEach(el => el.style.color = colors.string);
    preview.querySelectorAll('.type').forEach(el => el.style.color = colors.type);
    preview.querySelectorAll('.fn').forEach(el => el.style.color = colors.func);


    preview.querySelectorAll('.term-success').forEach(el => el.style.color = colors.success);
    preview.querySelectorAll('.term-output').forEach(el => el.style.color = colors.text);
    preview.querySelectorAll('.term-info').forEach(el => el.style.color = colors.info);


    const statusbar = preview.querySelector('.preview-statusbar');
    if (statusbar) {
        statusbar.style.background = colors.statusBg;
        statusbar.style.color = isLight ? colors.text : colors.textMuted;
    }


    const statusDot = preview.querySelector('.status-dot');
    if (statusDot) {
        statusDot.style.background = colors.success;
    }


    const popup = document.querySelector('.settings-popup');
    const sidebar = document.querySelector('.settings-sidebar');
    const content = document.querySelector('.settings-content');
    const settingsHeader = document.querySelector('.settings-header');
    const footer = document.querySelector('.settings-footer');
    const container = document.querySelector('.settings-container');

    if (popup) {
        popup.style.background = colors.popupBg;
        popup.style.borderColor = colors.border;
    }
    if (sidebar) {
        sidebar.style.background = colors.sidebarBg;
        sidebar.style.borderColor = colors.border;
    }
    if (content) {
        content.style.background = colors.contentBg;
        content.style.borderColor = colors.border;
    }

    // Use headerFooterBg if available (for kawaii-light), else popupBg
    const hfBg = colors.headerFooterBg || colors.popupBg;

    if (settingsHeader) {
        settingsHeader.style.background = hfBg;
        settingsHeader.style.borderColor = colors.borderLight;
        const h2 = settingsHeader.querySelector('h2');
        if (h2) h2.style.color = colors.accentColor;
    }
    if (footer) {
        footer.style.background = hfBg;
        footer.style.borderColor = colors.borderLight;
    }
    if (container) {
        container.style.background = colors.popupBg;
    }


    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.style.background = 'transparent';
        tab.style.color = colors.textMuted;
    });
    document.querySelectorAll('.settings-tab.active').forEach(tab => {
        tab.style.background = colors.accentColor;
        tab.style.color = '#ffffff';
    });


    document.querySelectorAll('.settings-panel h3').forEach(h3 => {
        h3.style.color = colors.accentColor;
        h3.style.borderColor = colors.borderLight;
    });


    document.querySelectorAll('.setting-row').forEach(row => {
        row.style.background = isLight ? '#f5fafd' : colors.sidebarBg;
        row.style.borderColor = colors.borderLight;
        const label = row.querySelector('label');
        if (label) label.style.color = colors.textMuted;
    });


    const btnSave = document.querySelector('.btn-save');
    if (btnSave) {
        btnSave.style.background = colors.accentColor;
        btnSave.style.borderColor = colors.accent;
        // Get button text color from CSS variable (set by ThemeManager)
        const buttonTextColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--button-text-on-accent').trim();
        if (buttonTextColor) {
            btnSave.style.color = buttonTextColor;
        }
    }
    const btnReset = document.querySelector('.btn-reset');
    if (btnReset) {
        btnReset.style.background = colors.contentBg;
        btnReset.style.color = colors.accentColor;
        btnReset.style.borderColor = colors.border;
    }
}

function normalizeFontFamilyInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_SETTINGS.editor.fontFamily;
    return raw;
}

function setFontFamilyInputs(fontFamily) {
    const selectEl = document.getElementById('set-fontFamily');
    const customEl = document.getElementById('set-fontFamilyCustom');
    if (!selectEl || !customEl) return;

    const normalized = normalizeFontFamilyInput(fontFamily);
    const isBuiltIn = BUILTIN_FONT_FAMILIES.has(normalized);

    if (isBuiltIn) {
        selectEl.value = normalized;
        customEl.value = '';
        customEl.style.display = 'none';
    } else {
        selectEl.value = 'custom';
        customEl.value = normalized;
        customEl.style.display = 'block';
    }
}

function getSelectedFontFamily() {
    const selectEl = document.getElementById('set-fontFamily');
    const customEl = document.getElementById('set-fontFamilyCustom');
    if (!selectEl) return DEFAULT_SETTINGS.editor.fontFamily;

    if (selectEl.value === 'custom') {
        return normalizeFontFamilyInput(customEl?.value || '');
    }

    return normalizeFontFamilyInput(selectEl.value);
}

function openSettings() {
    // Populate theme dropdowns dynamically from ThemeManager first
    populateThemeDropdowns();

    // Render theme carousel if marketplace is available
    if (typeof ThemeMarketplace !== 'undefined') {
        ThemeMarketplace.renderCarousel();
    }

    document.getElementById('set-fontSize').value = App.settings.editor.fontSize;
    document.getElementById('val-fontSize').textContent = App.settings.editor.fontSize + 'px';
    setFontFamilyInputs(App.settings.editor.fontFamily);
    document.getElementById('set-tabSize').value = App.settings.editor.tabSize;
    document.getElementById('set-minimap').checked = App.settings.editor.minimap;
    document.getElementById('set-wordWrap').checked = App.settings.editor.wordWrap;
    document.getElementById('set-startupBehavior').value = App.settings.startup?.behavior || DEFAULT_SETTINGS.startup.behavior;
    const autoSaveEnabled = App.settings.editor.autoSave || false;
    document.getElementById('set-autoSave').checked = autoSaveEnabled;
    const autoSaveDelayInput = document.getElementById('set-autoSaveDelay');
    autoSaveDelayInput.value = App.settings.editor.autoSaveDelay || 3;
    autoSaveDelayInput.disabled = !autoSaveEnabled;
    autoSaveDelayInput.style.opacity = autoSaveEnabled ? '1' : '0.5';
    document.getElementById('set-liveCheck').checked = App.settings.editor.liveCheck || false;
    document.getElementById('set-liveCheckDelay').value = App.settings.editor.liveCheckDelay || 1000;
    document.getElementById('set-intellisense').checked = App.settings.editor.intellisense !== false;
    document.getElementById('set-keywords').checked = App.settings.editor.keywords !== false;
    document.getElementById('set-snippets-enabled').checked = App.settings.editor.snippets !== false;

    document.getElementById('set-cppStandard').value = App.settings.compiler.cppStandard;
    document.getElementById('set-optimization').value = App.settings.compiler.optimization;
    document.getElementById('set-warnings').checked = App.settings.compiler.warnings;
    const lldToggle = document.getElementById('set-useLLD');
    if (lldToggle) lldToggle.checked = App.settings.compiler.useLLD !== false;
    const singleFileToggle = document.getElementById('set-singleFileMode');
    if (singleFileToggle) singleFileToggle.checked = App.settings.compiler.singleFileMode !== false;

    document.getElementById('set-timeLimitEnabled').checked = App.settings.execution.timeLimitEnabled;
    document.getElementById('set-timeLimitSeconds').value = App.settings.execution.timeLimitSeconds;
    document.getElementById('set-clearTerminal').checked = App.settings.execution.clearTerminal;
    document.getElementById('set-autoSendInput').checked = App.settings.execution.autoSendInput;
    document.getElementById('set-useExternalTerminal').checked = App.settings.execution.useExternalTerminal || false;

    document.getElementById('set-terminalColorScheme').value = App.settings.terminal?.colorScheme || 'ansi-16';

    // Panel font size
    const panelFontSize = App.settings.execution.panelFontSize || 13;
    const panelFSSlider = document.getElementById('set-panelFontSize');
    const panelFSVal = document.getElementById('val-panelFontSize');
    if (panelFSSlider) {
        panelFSSlider.value = panelFontSize;
        if (panelFSVal) panelFSVal.textContent = panelFontSize + 'px';
        panelFSSlider.oninput = () => {
            if (panelFSVal) panelFSVal.textContent = panelFSSlider.value + 'px';
        };
    }

    // Set theme values after dropdown is populated
    document.getElementById('set-theme').value = App.settings.appearance.theme;
    // Sync carousel selection to saved theme
    selectThemeFromCarousel(App.settings.appearance.theme, true);
    document.getElementById('set-editorColorScheme').value = App.settings.editor.colorScheme || 'auto';
    document.getElementById('set-performanceMode').checked = App.settings.appearance.performanceMode || false;

    // Background settings (optional - may not exist if Background section removed)
    const bgOpacitySlider = document.getElementById('set-bgOpacity');
    const bgOpacityVal = document.getElementById('val-bgOpacity');
    if (bgOpacitySlider) bgOpacitySlider.value = App.settings.appearance.bgOpacity || 50;
    if (bgOpacityVal) bgOpacityVal.textContent = (App.settings.appearance.bgOpacity || 50) + '%';

    // Load per-theme setting
    const currentTheme = App.settings.appearance.theme;
    const perThemeStore = App.settings.appearance.perTheme || {};
    const themeSpecific = perThemeStore[currentTheme] || {};
    const bgUrlInput = document.getElementById('set-bgUrl');
    if (bgUrlInput) bgUrlInput.value = themeSpecific.bgUrl || '';

    // Template - sync to hidden textarea and update Monaco editor
    const templateCode = App.settings.template?.code || DEFAULT_SETTINGS.template.code;
    document.getElementById('set-template').value = templateCode;

    // Initialize template editor if not exists, or update its content
    if (!templateEditor) {
        // Delay to ensure container is visible
        setTimeout(() => {
            initTemplateEditor();
        }, 100);
    } else {
        templateEditor.setValue(templateCode);
    }


    renderKeybindings();

    // Discord settings
    const discordEnabledEl = document.getElementById('set-discordEnabled');
    if (discordEnabledEl) {
        discordEnabledEl.checked = App.settings.discord?.enabled !== false;
        updateDiscordPreview();
    }

    // Update theme preview to match current theme
    updateThemePreview();


    if (typeof renderSnippetsList === 'function') {
        renderSnippetsList();
    }

    document.getElementById('settings-overlay').classList.add('show');
}

function closeSettings() {
    document.getElementById('settings-overlay').classList.remove('show');
}

function saveSettingsAndClose() {
    App.settings.editor.fontSize = parseInt(document.getElementById('set-fontSize').value);
    App.settings.editor.fontFamily = normalizeFontFamilyInput(getSelectedFontFamily());
    App.settings.editor.tabSize = parseInt(document.getElementById('set-tabSize').value);
    App.settings.editor.minimap = document.getElementById('set-minimap').checked;
    App.settings.editor.wordWrap = document.getElementById('set-wordWrap').checked;
    if (!App.settings.startup) App.settings.startup = {};
    App.settings.startup.behavior = document.getElementById('set-startupBehavior').value;
    App.settings.editor.colorScheme = document.getElementById('set-editorColorScheme').value;
    App.settings.editor.autoSave = document.getElementById('set-autoSave').checked;

    // Validate and clamp autoSaveDelay
    let delay = parseInt(document.getElementById('set-autoSaveDelay').value);
    if (isNaN(delay) || delay < 1) delay = 3;
    if (delay > 300) delay = 300;
    App.settings.editor.autoSaveDelay = delay;

    App.settings.editor.liveCheck = document.getElementById('set-liveCheck').checked;
    App.settings.editor.liveCheckDelay = parseInt(document.getElementById('set-liveCheckDelay').value) || 1000;
    App.settings.editor.intellisense = document.getElementById('set-intellisense').checked;
    App.settings.editor.keywords = document.getElementById('set-keywords').checked;
    App.settings.editor.snippets = document.getElementById('set-snippets-enabled').checked;

    App.settings.compiler.cppStandard = document.getElementById('set-cppStandard').value;
    App.settings.compiler.optimization = document.getElementById('set-optimization').value;
    App.settings.compiler.warnings = document.getElementById('set-warnings').checked;
    const lldToggle = document.getElementById('set-useLLD');
    if (lldToggle) App.settings.compiler.useLLD = lldToggle.checked;
    const singleFileToggle = document.getElementById('set-singleFileMode');
    if (singleFileToggle) App.settings.compiler.singleFileMode = singleFileToggle.checked;

    App.settings.execution.timeLimitEnabled = document.getElementById('set-timeLimitEnabled').checked;
    App.settings.execution.timeLimitSeconds = parseInt(document.getElementById('set-timeLimitSeconds').value);
    App.settings.execution.clearTerminal = document.getElementById('set-clearTerminal').checked;
    App.settings.execution.autoSendInput = document.getElementById('set-autoSendInput').checked;
    App.settings.execution.useExternalTerminal = document.getElementById('set-useExternalTerminal').checked;

    if (!App.settings.terminal) App.settings.terminal = {};
    App.settings.terminal.colorScheme = document.getElementById('set-terminalColorScheme').value;

    // Panel font size
    const panelFSInput = document.getElementById('set-panelFontSize');
    if (panelFSInput) App.settings.execution.panelFontSize = parseInt(panelFSInput.value) || 13;

    App.settings.appearance.theme = document.getElementById('set-theme').value;
    App.settings.appearance.performanceMode = document.getElementById('set-performanceMode').checked;

    // Background settings (optional - may not exist if Background section removed)
    const bgOpacityEl = document.getElementById('set-bgOpacity');
    if (bgOpacityEl) {
        App.settings.appearance.bgOpacity = parseInt(bgOpacityEl.value);
    }

    // Save per-theme background setting (optional)
    const targetTheme = document.getElementById('set-theme').value;
    const bgUrlEl = document.getElementById('set-bgUrl');
    const normalizeBgInput = (url) => {
        if (!url) return '';
        const cleaned = String(url).trim();
        if (!cleaned) return '';
        const invalidSingletons = ['\\', '/', '.', './', '..'];
        if (invalidSingletons.includes(cleaned)) return '';
        if (cleaned.toLowerCase() === 'file://' || cleaned.toLowerCase() === 'file:') return '';
        return cleaned;
    };

    const targetBgUrl = normalizeBgInput(bgUrlEl ? bgUrlEl.value : '');

    if (!App.settings.appearance.perTheme) App.settings.appearance.perTheme = {};
    if (!App.settings.appearance.perTheme[targetTheme]) App.settings.appearance.perTheme[targetTheme] = {};

    if (targetBgUrl) {
        App.settings.appearance.perTheme[targetTheme].bgUrl = targetBgUrl;
    } else {
        delete App.settings.appearance.perTheme[targetTheme].bgUrl;
    }


    if (!App.settings.template) App.settings.template = {};
    App.settings.template.code = document.getElementById('set-template').value;

    // Discord RPC toggle
    const discordEnabledEl = document.getElementById('set-discordEnabled');
    if (discordEnabledEl) {
        const newEnabled = discordEnabledEl.checked;
        const wasEnabled = App.settings.discord?.enabled !== false;
        if (!App.settings.discord) App.settings.discord = {};
        App.settings.discord.enabled = newEnabled;
        if (newEnabled !== wasEnabled) {
            _discordAppliedEnabled = newEnabled; // keep guard in sync
            if (newEnabled) {
                window.electronAPI?.discordEnable?.();
            } else {
                window.electronAPI?.discordDisable?.();
            }
        }
    }

    applySettings();
    saveSettings();
    updateShortcutMap(); // Apply new shortcuts immediately
    closeSettings();
    log('Settings saved', 'success');
}

async function resetSettings() {
    const confirmed = await showConfirmDialog({
        title: 'Reset Settings',
        message: 'Reset all settings to defaults? This action cannot be undone.',
        confirmText: 'Reset',
        danger: true
    });
    if (confirmed) {
        App.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        // Clear any saved per-theme background overrides (Customizer)
        clearThemeBackgroundOverrides();
        App.settings.appearance.perTheme = {};
        App.settings.appearance.bgUrl = '';

        // Force clear all background CSS variables and inline styles
        const root = document.documentElement;
        root.style.removeProperty('--app-bg-image');
        root.style.removeProperty('--app-bg-opacity');
        root.style.removeProperty('--app-bg-position');
        root.style.removeProperty('--app-bg-blur');
        root.style.removeProperty('--editor-bg-image');
        root.style.removeProperty('--editor-bg-opacity');
        document.body.style.background = '';
        document.body.style.backgroundImage = '';

        // Restore hardcoded built-in themes in memory (drop previous overrides)
        if (typeof ThemeManager !== 'undefined' && ThemeManager.restoreAllBuiltinThemes) {
            ThemeManager.restoreAllBuiltinThemes();
            // Re-apply theme to load hardcoded backgrounds
            ThemeManager.setTheme(DEFAULT_SETTINGS.appearance.theme);
        }
        applySettings();
        saveSettings();
        openSettings();
        log('Settings reset to defaults', 'info');
    }
}

// ============================================================================
// KEYBINDINGS MANAGEMENT
// ============================================================================
const KEYBINDING_LABELS = {
    compile: 'Compile Only',
    buildRun: 'Compile & Run',
    run: 'Run Only',
    stop: 'Stop Process',
    save: 'Save File',
    newFile: 'New File',
    openFile: 'Open File',
    closeTab: 'Close Tab',
    toggleProblems: 'Toggle Problems',
    settings: 'Open Settings',
    toggleSplit: 'Toggle Split',
    formatCode: 'Format Code'
};

let editingKeybinding = null;

function renderKeybindings() {
    const container = document.getElementById('keybindings-list');
    if (!container) return;

    const keybindings = App.settings.keybindings || DEFAULT_SETTINGS.keybindings;

    container.innerHTML = Object.entries(keybindings).map(([key, value]) => `
        <div class="keybinding-item" data-action="${key}">
            <span class="keybinding-name">${KEYBINDING_LABELS[key] || key}</span>
            <button class="keybinding-key" data-action="${key}">${value}</button>
        </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.keybinding-key').forEach(btn => {
        btn.addEventListener('click', startEditingKeybinding);
    });
}

function startEditingKeybinding(e) {
    const btn = e.target;
    const action = btn.dataset.action;

    // Remove editing from all
    document.querySelectorAll('.keybinding-key').forEach(b => b.classList.remove('editing'));

    btn.classList.add('editing');
    btn.textContent = 'Press a key...';
    editingKeybinding = action;

    // Listen for key press
    document.addEventListener('keydown', captureKeybinding);
}

function captureKeybinding(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!editingKeybinding) return;

    // Escape to cancel
    if (e.key === 'Escape') {
        cancelEditingKeybinding();
        return;
    }

    // Build key string
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    // Get the key name
    let keyName = e.key;
    if (keyName === ' ') keyName = 'Space';
    else if (keyName.length === 1) keyName = keyName.toUpperCase();
    else if (keyName.startsWith('Arrow')) keyName = keyName.replace('Arrow', '');

    // Don't add modifier keys alone
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        parts.push(keyName);
    } else {
        return; // Wait for non-modifier key
    }

    const keyCombo = parts.join('+');

    // Save the new keybinding
    if (!App.settings.keybindings) {
        App.settings.keybindings = { ...DEFAULT_SETTINGS.keybindings };
    }
    App.settings.keybindings[editingKeybinding] = keyCombo;

    // Update ShortcutsManager binding
    if (window.ShortcutsManager?.setKeybinding) {
        window.ShortcutsManager.setKeybinding(editingKeybinding, keyCombo);
    }

    // Update UI
    const btn = document.querySelector(`.keybinding-key[data-action="${editingKeybinding}"]`);
    if (btn) {
        btn.textContent = keyCombo;
        btn.classList.remove('editing');
    }

    // Persist changes
    saveSettings();

    // Cleanup
    editingKeybinding = null;
    document.removeEventListener('keydown', captureKeybinding);
}

function cancelEditingKeybinding() {
    if (!editingKeybinding) return;

    const keybindings = App.settings.keybindings || DEFAULT_SETTINGS.keybindings;
    const btn = document.querySelector(`.keybinding-key[data-action="${editingKeybinding}"]`);
    if (btn) {
        btn.textContent = keybindings[editingKeybinding];
        btn.classList.remove('editing');
    }

    editingKeybinding = null;
    document.removeEventListener('keydown', captureKeybinding);
}

async function resetKeybindings() {
    const confirmed = await showConfirmDialog({
        title: 'Reset Keybindings',
        message: 'Reset all keybindings to defaults?',
        confirmText: 'Reset',
        danger: true
    });
    if (confirmed) {
        App.settings.keybindings = { ...DEFAULT_SETTINGS.keybindings };
        renderKeybindings();
        log('Keybindings reset to defaults', 'info');
    }
}

async function resetTemplate() {
    const confirmed = await showConfirmDialog({
        title: 'Reset Template',
        message: 'Reset template to default?',
        confirmText: 'Reset'
    });
    if (confirmed) {
        const defaultCode = DEFAULT_SETTINGS.template.code;
        const textarea = document.getElementById('set-template');
        if (textarea) {
            textarea.value = defaultCode;
        }
        // Also update Monaco editor if exists
        if (templateEditor) {
            templateEditor.setValue(defaultCode);
        }
    }
}

// ============================================================================
// AUTO-SAVE
// ============================================================================
let autoSaveTimer = null;

function scheduleAutoSave() {
    if (!App.settings.editor.autoSave) return;


    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }


    const delay = (App.settings.editor.autoSaveDelay || 3) * 1000;
    autoSaveTimer = setTimeout(() => {
        autoSaveCurrentFile();
    }, delay);
}

async function autoSaveCurrentFile() {
    const tabId = App.activeEditor === 2 ? App.splitTabId : App.activeTabId;
    if (!tabId) return;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab || !tab.path || !tab.modified) return;


    const editor = App.activeEditor === 2 ? App.editor2 : App.editor;
    if (!editor) return;

    const content = editor.getValue();

    try {
        const result = await window.electronAPI.saveFile({ path: tab.path, content });
        if (result.success) {
            tab.original = content;
            tab.modified = false;
            renderTabs();
            // Silent save - no log message
        }
    } catch (e) {
        console.log('Auto-save failed:', e);
    }
}

// ============================================================================
// SESSION PERSISTENCE (Checkpoint for unsaved files)
// ============================================================================
const SESSION_STORAGE_KEY = 'ide-session-checkpoint';
const SESSION_SAVE_DEBOUNCE = 5000; // 5 seconds debounce
const SESSION_PERIODIC_INTERVAL = 30000; // 30 seconds periodic save
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const STARTUP_BEHAVIORS = Object.freeze({
    EMPTY: 'empty',
    REOPEN_SAVED: 'reopen-saved-tabs',
    RESTORE_PREVIOUS: 'restore-previous-session'
});

const BUILTIN_FONT_FAMILIES = new Set([
    "'JetBrains Mono', monospace",
    "'Fira Code', monospace",
    'Consolas, monospace',
    "'Cascadia Code', monospace"
]);
let sessionSaveTimer = null;
let sessionPeriodicTimer = null;
let sessionRestored = false;

function normalizeTabPath(filePath) {
    return filePath ? filePath.replace(/\\/g, '/') : null;
}

function createRestoredTabId() {
    return 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
}

function getStartupBehavior() {
    return App.settings?.startup?.behavior || DEFAULT_SETTINGS.startup.behavior;
}

function getStoredSession() {
    try {
        const saved = localStorage.getItem(SESSION_STORAGE_KEY);
        if (!saved) return null;

        const session = JSON.parse(saved);
        if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) {
            clearSession();
            return null;
        }

        if (session.timestamp && (Date.now() - session.timestamp) > SESSION_MAX_AGE) {
            clearSession();
            return null;
        }

        return session;
    } catch (e) {
        console.error('[Session] Failed to parse stored session:', e);
        clearSession();
        return null;
    }
}

function buildSessionRestoreSummary(session) {
    const unsavedTabs = session.tabs.filter(t => !t.path || t.modified);
    const untitledCount = unsavedTabs.filter(t => !t.path).length;
    const modifiedCount = unsavedTabs.filter(t => t.path && t.modified).length;
    const parts = [];

    if (untitledCount > 0) parts.push(`${untitledCount} unsaved file${untitledCount > 1 ? 's' : ''}`);
    if (modifiedCount > 0) parts.push(`${modifiedCount} modified file${modifiedCount > 1 ? 's' : ''}`);

    return parts.length > 0
        ? `Your previous session contains ${parts.join(' and ')}. Restore now?`
        : 'Restore previous session?';
}

async function reopenSessionTabs(session, { includeUnsaved }) {
    const restoredIds = new Map();

    for (const tabData of session.tabs) {
        const normalizedPath = normalizeTabPath(tabData.path);

        if (normalizedPath) {
            const existing = App.tabs.find(t => normalizeTabPath(t.path) === normalizedPath);
            if (existing) {
                restoredIds.set(tabData.id, existing.id);
                continue;
            }

            try {
                let diskContent = '';
                if (window.electronAPI?.readFile) {
                    diskContent = await window.electronAPI.readFile(tabData.path);
                }

                const isModified = includeUnsaved && tabData.modified && tabData.content != null;
                const restoredTab = {
                    id: createRestoredTabId(),
                    name: tabData.name,
                    path: tabData.path,
                    untitledHistoryKey: tabData.untitledHistoryKey || null,
                    content: isModified ? tabData.content : diskContent,
                    original: diskContent,
                    modified: isModified,
                };

                App.tabs.push(restoredTab);
                restoredIds.set(tabData.id, restoredTab.id);
            } catch (_) {
                if (!includeUnsaved || tabData.content == null) continue;

                const fallbackTab = {
                    id: createRestoredTabId(),
                    name: tabData.name,
                    path: null,
                    untitledHistoryKey: tabData.untitledHistoryKey || createUntitledHistoryKey(),
                    content: tabData.content,
                    original: '',
                    modified: true,
                };

                App.tabs.push(fallbackTab);
                restoredIds.set(tabData.id, fallbackTab.id);
            }
            continue;
        }

        if (!includeUnsaved) continue;

        const restoredTab = {
            id: createRestoredTabId(),
            name: tabData.name,
            path: null,
            untitledHistoryKey: tabData.untitledHistoryKey || createUntitledHistoryKey(),
            content: tabData.content || '',
            original: tabData.original || '',
            modified: tabData.modified ?? true,
        };

        App.tabs.push(restoredTab);
        restoredIds.set(tabData.id, restoredTab.id);
    }

    const preferredActiveId = restoredIds.get(session.activeTabId) || App.tabs[0]?.id || null;
    if (preferredActiveId) {
        setActive(preferredActiveId);
    }

    updateUI();
    return restoredIds.size;
}

/**
 * Save the current session (all open tabs including unsaved ones) to localStorage.
 * This ensures unsaved work survives accidental app closure.
 */
function saveSession() {
    try {
        if (App.tabs.length === 0) {
            clearSession();
            return;
        }

        // Sync current editor content to active tab
        if (App.activeTabId && App.editor && App.ready) {
            const activeTab = App.tabs.find(t => t.id === App.activeTabId);
            if (activeTab) activeTab.content = App.editor.getValue();
        }
        if (App.splitTabId && App.editor2 && App.ready) {
            const splitTab = App.tabs.find(t => t.id === App.splitTabId);
            if (splitTab) splitTab.content = App.editor2.getValue();
        }

        const session = {
            tabs: App.tabs.map(t => ({
                id: t.id,
                name: t.name,
                path: t.path || null,
                untitledHistoryKey: t.untitledHistoryKey || null,
                // Always save content for unsaved/modified tabs; for saved unmodified tabs, skip content (re-read from disk)
                content: (!t.path || t.modified) ? (t.content || '') : null,
                original: t.original || '',
                modified: t.modified || false,
            })),
            activeTabId: App.activeTabId,
            splitTabId: App.splitTabId,
            isSplit: App.isSplit,
            timestamp: Date.now(),
        };

        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
        console.warn('[Session] Failed to save session checkpoint:', e);
    }
}

/**
 * Schedule a debounced session save (called on every content change)
 */
function scheduleSessionSave() {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
        saveSession();
    }, SESSION_SAVE_DEBOUNCE);
}

/**
 * Start periodic session saves
 */
function startSessionPeriodicSave() {
    if (sessionPeriodicTimer) clearInterval(sessionPeriodicTimer);
    sessionPeriodicTimer = setInterval(() => {
        saveSession();
    }, SESSION_PERIODIC_INTERVAL);
}

/**
 * Clear saved session (called after successful restore or when user explicitly closes all tabs)
 */
function clearSession() {
    try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (_) {}
}

function showSessionRestoreNotification(summary) {
    return new Promise((resolve) => {
        const existing = document.getElementById('session-restore-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.id = 'session-restore-notification';
        notification.className = 'session-restore-notification';
        notification.innerHTML = `
            <div class="session-restore-content">
                <div class="session-restore-icon">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                        <path d="M3 3v5h5"></path>
                    </svg>
                </div>
                <div class="session-restore-text">
                    <div class="session-restore-title">Restore previous session</div>
                    <div class="session-restore-desc">${summary}</div>
                </div>
                <div class="session-restore-actions">
                    <button class="session-restore-btn secondary" data-action="dismiss">Dismiss</button>
                    <button class="session-restore-btn primary" data-action="restore">Restore</button>
                </div>
            </div>
        `;

        const cleanup = (result) => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 180);
            resolve(result);
        };

        notification.querySelector('[data-action="dismiss"]').onclick = () => cleanup(false);
        notification.querySelector('[data-action="restore"]').onclick = () => cleanup(true);

        document.body.appendChild(notification);
        requestAnimationFrame(() => notification.classList.add('show'));
    });
}

/**
 * Restore session from localStorage on app startup.
 * Recovers all open tabs including unsaved files with their content.
 */
async function restoreSession() {
    if (sessionRestored) return;
    sessionRestored = true;

    const behavior = getStartupBehavior();
    const session = getStoredSession();

    if (!session) return;

    if (behavior === STARTUP_BEHAVIORS.EMPTY) {
        clearSession();
        return;
    }

    try {
        if (behavior === STARTUP_BEHAVIORS.REOPEN_SAVED) {
            const reopenedCount = await reopenSessionTabs(session, { includeUnsaved: false });
            clearSession();
            if (reopenedCount > 0) {
                log(`Reopened ${reopenedCount} file(s) from previous session ✓`, 'success');
            }
            return;
        }

        const unsavedTabs = session.tabs.filter(t => !t.path || t.modified);
        if (unsavedTabs.length > 0) {
            const confirmed = await showSessionRestoreNotification(buildSessionRestoreSummary(session));

            if (!confirmed) {
                clearSession();
                return;
            }
        }

        const restoredCount = await reopenSessionTabs(session, { includeUnsaved: true });
        if (restoredCount > 0) {
            log('Previous session restored ✓', 'success');
        }

        clearSession();
    } catch (e) {
        console.error('[Session] Failed to restore session:', e);
        clearSession();
    }
}

/**
 * Initialize session persistence system
 */
function initSessionPersistence() {
    // Start periodic saves
    startSessionPeriodicSave();

    // Save session before window unloads
    window.addEventListener('beforeunload', () => {
        saveSession();
    });

    // Restore previous session if any (delayed to ensure Monaco is ready)
    setTimeout(() => restoreSession(), 300);
}

// ============================================================================
// LIVE SYNTAX CHECKING
// ============================================================================
let liveCheckTimer = null;
let isLiveChecking = false;
let hasBuildProblems = false; // Prevents live-check from overwriting build errors
let liveCheckQueued = false;
let liveCheckRevision = 0;
let liveCheckUIState = 'disabled';

const STATUS_TYPES = new Set(['ready', 'success', 'warning', 'error', 'building', 'checking', 'running', 'formatting']);

function pluralizeIssue(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function getProblemSummary() {
    return App.problems.reduce((summary, problem) => {
        const type = (problem?.type || problem?.severity || 'info').toLowerCase();
        if (type === 'error') summary.errors += 1;
        else if (type === 'warning') summary.warnings += 1;
        else summary.info += 1;
        return summary;
    }, { errors: 0, warnings: 0, info: 0 });
}

function updateProblemSummaryUI() {
    const summary = getProblemSummary();
    const errorsBadge = document.getElementById('status-errors-count');
    const warningsBadge = document.getElementById('status-warnings-count');
    const problemsBtn = document.getElementById('btn-toggle-problems');
    const problemsBadge = document.getElementById('btn-problems-badge');
    const totalVisible = summary.errors + summary.warnings;

    if (errorsBadge) {
        errorsBadge.textContent = `${summary.errors}E`;
        errorsBadge.classList.toggle('hidden', summary.errors === 0);
    }
    if (warningsBadge) {
        warningsBadge.textContent = `${summary.warnings}W`;
        warningsBadge.classList.toggle('hidden', summary.warnings === 0);
    }

    if (problemsBtn) {
        problemsBtn.classList.toggle('has-errors', summary.errors > 0);
        problemsBtn.classList.toggle('has-warnings', summary.warnings > 0);
    }

    if (problemsBadge) {
        problemsBadge.textContent = totalVisible > 99 ? '99+' : String(totalVisible);
        problemsBadge.classList.toggle('hidden', totalVisible === 0);
        problemsBadge.classList.toggle('warning', summary.errors === 0 && summary.warnings > 0);
    }
}

function setLiveCheckUIState(state) {
    liveCheckUIState = state;

    const liveState = document.getElementById('live-check-state');
    const problemsBtn = document.getElementById('btn-toggle-problems');
    if (!liveState) return;

    const summary = getProblemSummary();
    let text = 'Live off';
    let tone = '';

    if (App.settings.editor.liveCheck) {
        switch (state) {
            case 'pending':
                text = 'Typing…';
                tone = 'checking';
                break;
            case 'checking':
                text = 'Checking…';
                tone = 'checking';
                break;
            case 'issues':
                text = summary.errors > 0
                    ? `${summary.errors} error${summary.errors === 1 ? '' : 's'}`
                    : `${summary.warnings} warning${summary.warnings === 1 ? '' : 's'}`;
                tone = summary.errors > 0 ? 'error' : 'warning';
                break;
            case 'clean':
                text = 'No issues';
                tone = 'success';
                break;
            default:
                text = 'Live ready';
                break;
        }
    }

    liveState.className = 'status-item live-check-state' + (tone ? ' ' + tone : '');
    liveState.textContent = text;

    if (problemsBtn) {
        problemsBtn.classList.toggle('checking', state === 'pending' || state === 'checking');
    }
}

function scheduleLiveCheck() {
    if (!App.settings.editor.liveCheck || !window.electronAPI?.syntaxCheck) {
        setLiveCheckUIState('disabled');
        return;
    }

    liveCheckRevision += 1;

    if (liveCheckTimer) {
        clearTimeout(liveCheckTimer);
    }

    if (!isBuilding && !App.isRunning) {
        setLiveCheckUIState('pending');
        setStatus('Typing…', 'checking');
    }

    const delay = App.settings.editor.liveCheckDelay || 1000;
    const targetRevision = liveCheckRevision;
    liveCheckTimer = setTimeout(() => doLiveCheck(targetRevision), delay);
}

async function doLiveCheck(targetRevision = liveCheckRevision) {
    if (isBuilding || !App.editor) return;
    if (isLiveChecking) {
        liveCheckQueued = true;
        return;
    }

    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;
    const tabId = App.activeEditor === 2 ? App.splitTabId : App.activeTabId;
    const tab = App.tabs.find(t => t.id === tabId);
    const model = editor?.getModel?.();
    if (!editor || !model) return;

    const code = editor.getValue();
    if (!code || !code.trim()) {
        clearLiveCheckMarkers();
        if (!hasBuildProblems) {
            App.problems = [];
            renderProblems();
        }
        setLiveCheckUIState('idle');
        if (!isBuilding && !App.isRunning) {
            setStatus('Ready', 'ready');
        }
        return;
    }

    isLiveChecking = true;
    liveCheckQueued = false;
    setLiveCheckUIState('checking');
    if (!isBuilding && !App.isRunning) {
        setStatus('Checking syntax...', 'checking');
    }

    try {
        const result = await window.electronAPI.syntaxCheck(code, tab?.path || null);
        const isStale = targetRevision !== liveCheckRevision || editor.getModel() !== model;
        if (isStale) {
            liveCheckQueued = true;
            return;
        }

        if (result && result.diagnostics && result.diagnostics.length > 0) {
            applyLiveCheckMarkers(editor, result.diagnostics);
        } else if (result && result.success) {
            // No errors - clear markers silently
            clearLiveCheckMarkers();
            if (!hasBuildProblems) {
                App.problems = [];
                renderProblems();
            }
            setLiveCheckUIState('clean');
            if (!isBuilding && !App.isRunning) {
                setStatus('No issues', 'success');
            }
        }
    } catch (e) {
        // Silent fail - don't spam terminal
    } finally {
        isLiveChecking = false;
        if (liveCheckQueued || targetRevision !== liveCheckRevision) {
            const queuedRevision = liveCheckRevision;
            liveCheckQueued = false;
            setTimeout(() => doLiveCheck(queuedRevision), 0);
        }
    }
}

function applyLiveCheckMarkers(editor, diagnostics) {
    const model = editor.getModel();
    if (!model) return;


    const markers = diagnostics.map(d => ({
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error :
            d.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                monaco.MarkerSeverity.Info,
        startLineNumber: d.line,
        startColumn: d.column || 1,
        endLineNumber: d.line,
        endColumn: d.column ? d.column + 50 : 1000,
        message: d.message,
        source: 'g++'
    }));


    monaco.editor.setModelMarkers(model, 'live-check', markers);

    // Don't overwrite build problems with live-check results
    if (!hasBuildProblems) {
        App.problems = diagnostics.map(d => ({
            file: d.file || 'untitled.cpp',
            type: d.severity,
            line: d.line,
            col: d.column || 1,
            message: d.message
        }));
        renderProblems();

        const summary = getProblemSummary();
        setLiveCheckUIState((summary.errors + summary.warnings) > 0 ? 'issues' : 'clean');
        if (!isBuilding && !App.isRunning) {
            if (summary.errors > 0) {
                setStatus(`${pluralizeIssue(summary.errors, 'error')}${summary.warnings ? ` · ${pluralizeIssue(summary.warnings, 'warning')}` : ''}`, 'error');
            } else if (summary.warnings > 0) {
                setStatus(pluralizeIssue(summary.warnings, 'warning'), 'warning');
            } else {
                setStatus('No issues', 'success');
            }
        }
    }
}

function clearLiveCheckMarkers() {
    if (App.editor) {
        const model1 = App.editor.getModel();
        if (model1) monaco.editor.setModelMarkers(model1, 'live-check', []);
    }
    if (App.editor2) {
        const model2 = App.editor2.getModel();
        if (model2) monaco.editor.setModelMarkers(model2, 'live-check', []);
    }
}

function applySettings() {
    const opts = {
        fontSize: App.settings.editor.fontSize,
        fontFamily: App.settings.editor.fontFamily,
        tabSize: App.settings.editor.tabSize,
        minimap: { enabled: App.settings.editor.minimap },
        wordWrap: App.settings.editor.wordWrap ? 'on' : 'off',
        multiCursorModifier: resolveMultiCursorModifier(),
        quickSuggestions: {
            other: (App.settings.editor.intellisense !== false || App.settings.editor.snippets !== false),
            comments: false,
            strings: (App.settings.editor.intellisense !== false || App.settings.editor.snippets !== false)
        },
        wordBasedSuggestions: App.settings.editor.intellisense !== false ? 'allDocuments' : 'off',
        parameterHints: { enabled: App.settings.editor.intellisense !== false },
        suggest: {
            showKeywords: App.settings.editor.intellisense !== false && App.settings.editor.keywords !== false,
            showSnippets: App.settings.editor.snippets !== false,
            showWords: App.settings.editor.intellisense !== false,
            showClasses: App.settings.editor.intellisense !== false && App.settings.editor.keywords !== false,
            showFunctions: App.settings.editor.intellisense !== false && App.settings.editor.keywords !== false,
            showVariables: App.settings.editor.intellisense !== false,
            showValues: App.settings.editor.intellisense !== false,
            showMethods: App.settings.editor.intellisense !== false,
            showProperties: App.settings.editor.intellisense !== false,
            showModules: App.settings.editor.intellisense !== false,
            showOperators: App.settings.editor.intellisense !== false,
            showTypeParameters: App.settings.editor.intellisense !== false
        }
    };

    // Performance optimizations
    if (App.settings.appearance.performanceMode) {
        opts.minimap = { enabled: false };
        opts.bracketPairColorization = { enabled: false };
        opts.cursorBlinking = 'solid';
        opts.smoothScrolling = false;
        opts.mouseWheelZoom = false;
    }

    if (App.editor) App.editor.updateOptions(opts);
    if (App.editor2) App.editor2.updateOptions(opts);

    // Apply panel font size to terminal, I/O panels
    const panelFontSize = App.settings.execution.panelFontSize || 13;
    document.documentElement.style.setProperty('--panel-font-size', panelFontSize + 'px');

    if (App.settings.appearance.performanceMode) {
        document.body.classList.add('performance-mode');
    } else {
        document.body.classList.remove('performance-mode');
    }


    applyTheme(App.settings.appearance.theme);

    // Apply Discord RPC enabled/disabled state
    applyDiscordSetting();
    updateProblemSummaryUI();
    setLiveCheckUIState(App.settings.editor.liveCheck ? (App.problems.length > 0 ? 'issues' : 'idle') : 'disabled');
}

/**
 * Enable or disable Discord RPC based on the current settings value.
 * Safe to call multiple times — it compares against the previously applied state.
 */
let _discordAppliedEnabled = true; // matches the service default (enabled at startup)
    hasBuildProblems = false;

function applyDiscordSetting() {
    const shouldBeEnabled = App.settings?.discord?.enabled !== false;
    if (shouldBeEnabled === _discordAppliedEnabled) return; // no change
    _discordAppliedEnabled = shouldBeEnabled;
    if (shouldBeEnabled) {
        window.electronAPI?.discordEnable?.();
    } else {
        window.electronAPI?.discordDisable?.();
    }
}

// ============================================================================
// THEME APPLICATION
// ============================================================================
function applyTheme(themeName) {
    // Delegate to ThemeManager for UI theme
    ThemeManager.setTheme(themeName);

    // Apply editor color scheme (can be different from UI theme)
    applyEditorColorScheme();

    // Additional app-specific background logic (opacity, image...)
    applyBackgroundSettings();
}

/**
 * Apply editor-specific color scheme (separate from UI theme)
 */
function applyEditorColorScheme() {
    const editorScheme = App.settings.editor?.colorScheme || 'auto';
    const uiTheme = App.settings.appearance?.theme || 'kawaii-dark';

    // Determine which theme to use for editor
    const monacoTheme = (editorScheme === 'auto') ? uiTheme : editorScheme;

    // Apply to Monaco editors
    if (typeof monaco !== 'undefined') {
        try {
            // Ensure theme is registered in ThemeManager
            if (ThemeManager.themes.has(monacoTheme)) {
                monaco.editor.setTheme(monacoTheme);
            } else {
                // Fallback to UI theme
                monaco.editor.setTheme(uiTheme);
            }
        } catch (e) {
            console.warn('[Theme] Failed to apply editor color scheme:', e);
        }
    }
}

function applyBackgroundSettings() {
    const theme = App.settings.appearance.theme || 'kawaii-dark';
    const opacity = (App.settings.appearance.bgOpacity || 50) / 100;


    const themeBackgrounds = {
        'kawaii-dark': {
            default: 'linear-gradient(135deg, #1a2530 0%, #152535 100%)',
            overlay: `rgba(26, 37, 48, ${0.3 + opacity * 0.5})`
        },
        'kawaii-light': {
            default: 'linear-gradient(135deg, #e8f4fc 0%, #d4eaf7 50%, #c5e3f6 100%)',
            overlay: `rgba(255, 255, 255, ${opacity * 0.15})`
        },
        'sakura': {
            default: 'linear-gradient(135deg, #fff0f5 0%, #ffe4e1 50%, #ffb7c5 100%)',
            overlay: `rgba(255, 240, 245, ${opacity * 0.15})`
        },
        'dracula': {
            default: 'linear-gradient(135deg, #282a36 0%, #21222c 100%)',
            overlay: `rgba(40, 42, 54, ${0.3 + opacity * 0.5})`
        },
        'monokai': {
            default: 'linear-gradient(135deg, #272822 0%, #1e1f1c 100%)',
            overlay: `rgba(39, 40, 34, ${0.3 + opacity * 0.5})`
        },
        'nord': {
            default: 'linear-gradient(135deg, #2e3440 0%, #242931 100%)',
            overlay: `rgba(46, 52, 64, ${0.3 + opacity * 0.5})`
        },
        'one-dark': {
            default: 'linear-gradient(135deg, #282c34 0%, #21252b 100%)',
            overlay: `rgba(40, 44, 52, ${0.3 + opacity * 0.5})`
        }
    };

    const themeConfig = themeBackgrounds[theme] || themeBackgrounds['kawaii-dark'];

    const normalizeBgUrl = (url) => {
        if (!url) return '';
        const cleaned = String(url).trim();
        if (!cleaned) return '';
        const invalidSingletons = ['\\', '/', '.', './', '..'];
        if (invalidSingletons.includes(cleaned)) return '';
        if (cleaned.toLowerCase() === 'file://' || cleaned.toLowerCase() === 'file:') return '';
        return cleaned;
    };

    // Get theme-specific background from USER settings
    const perTheme = App.settings.appearance.perTheme || {};
    const userThemeBg = normalizeBgUrl(perTheme[theme]?.bgUrl || App.settings.appearance.bgUrl);

    // Get theme-specific background from THEME definition (default)
    const themeObj = ThemeManager.themes.get(theme);
    const themeDefaultBg = themeObj?.colors?.appBackground; // e.g. 'assets/backgrounds/pink.gif'

    console.log('[BG] Theme:', theme, 'User BG:', userThemeBg, 'Default BG:', themeDefaultBg);

    if (userThemeBg) {
        document.body.style.backgroundImage = `url('${userThemeBg.replace(/'/g, "\\'")}')`;
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundPosition = 'center center';
        document.body.style.backgroundAttachment = 'fixed';
        document.body.style.backgroundSize = 'cover';
    } else if (themeDefaultBg) {
        document.body.style.backgroundImage = `url('${themeDefaultBg.replace(/'/g, "\\'")}')`;
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundPosition = 'center center';
        document.body.style.backgroundAttachment = 'fixed';
        document.body.style.backgroundSize = 'cover';
    } else {
        document.body.style.background = themeConfig.default;
        document.body.style.backgroundImage = 'none';
    }


    const appContainer = document.querySelector('.app-container');
    if (appContainer) {
        if (userThemeBg || themeDefaultBg) {
            appContainer.style.background = themeConfig.overlay;
        } else {
            appContainer.style.background = 'transparent';
        }
    }
}

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
    'buildRun': () => buildRun(),
    'run': () => run(),
    'stop': () => stop(),
    'save': () => save(),
    'newFile': () => newFile(),
    'openFile': () => openFile(),
    'closeTab': () => { if (App.activeTabId) closeTab(App.activeTabId); },
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
};

function normalizeKeyCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    let key = e.key;
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
    console.log('[Shortcuts] Updated map:', currentShortcutMap);

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
            ACTION_HANDLERS[actionName]();
            return;
        }

        // Handling for Escape (hardcoded for settings close)
        if (e.key === 'Escape') {
            closeSettings();
        }
    });

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
            termLog(`⚠ Format thất bại: ${result.error}`, 'error');
        }
    } catch (err) {
        setStatus('error', 'Format error');
        termLog(`⚠ Lỗi format: ${err.message}`, 'error');
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

// ============================================================================
// UI UPDATE
// ============================================================================
function updateUI() {
    const hasTabs = App.tabs.length > 0;
    document.getElementById('welcome').style.display = hasTabs ? 'none' : 'flex';
    document.getElementById('editor-section').style.display = hasTabs ? 'flex' : 'none';

    // Force hide panels if the welcome screen is open (no tabs)
    const showIO = hasTabs && App.showIO;
    const showTerm = hasTabs && App.showTerm;
    const showProblems = hasTabs && App.showProblems;

    document.getElementById('io-section').classList.toggle('panel-hidden', !showIO);
    document.getElementById('resizer-io').classList.toggle('panel-hidden', !showIO);
    document.getElementById('btn-toggle-io').classList.toggle('active', showIO);

    document.getElementById('terminal-section').classList.toggle('panel-hidden', !showTerm);
    document.getElementById('resizer-term').classList.toggle('panel-hidden', !showTerm);
    document.getElementById('btn-toggle-term').classList.toggle('active', showTerm);

    document.getElementById('problems-panel').classList.toggle('hidden', !showProblems);
    document.getElementById('resizer-problems').classList.toggle('panel-hidden', !showProblems);
    document.getElementById('btn-toggle-problems').classList.toggle('active', showProblems);
}

// ============================================================================
// HEADER
// ============================================================================
function initHeader() {
    document.getElementById('btn-new-tab').onclick = newFile;
    document.getElementById('btn-buildrun').onclick = buildRun;
    document.getElementById('btn-run-only').onclick = run;
    document.getElementById('btn-stop').onclick = stop;
    document.getElementById('btn-toggle-io').onclick = toggleIO;
    document.getElementById('btn-toggle-term').onclick = toggleTerm;
    document.getElementById('btn-toggle-problems').onclick = toggleProblems;

    document.getElementById('welcome-new').onclick = newFile;
    document.getElementById('welcome-open').onclick = openFile;

    document.getElementById('btn-close').onclick = () => window.electronAPI?.closeWindow?.();
    document.getElementById('btn-min').onclick = () => window.electronAPI?.minimizeWindow?.();
    document.getElementById('btn-max').onclick = () => window.electronAPI?.maximizeWindow?.();

    document.getElementById('tabs-container').onmousedown = e => {
        if (e.button === 1) {
            const tab = e.target.closest('.tab');
            if (tab) closeTab(tab.dataset.id);
        }
    };


    const hamburgerBtn = document.getElementById('btn-hamburger');
    const menuGroup = document.getElementById('menu-group');
    if (hamburgerBtn && menuGroup) {
        hamburgerBtn.onclick = (e) => {
            e.stopPropagation();
            hamburgerBtn.classList.toggle('active');
            menuGroup.classList.toggle('show');
        };


        document.addEventListener('click', (e) => {
            if (!menuGroup.contains(e.target) && !hamburgerBtn.contains(e.target)) {
                hamburgerBtn.classList.remove('active');
                menuGroup.classList.remove('show');
            }
        });


        menuGroup.querySelectorAll('.menu-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                hamburgerBtn.classList.remove('active');
                menuGroup.classList.remove('show');
            });
        });
    }

    setupSplitResizer();
}

function toggleIO() {
    if (DockingState.ioDocked) {
        const problemsPanel = document.getElementById('problems-panel');
        const isIOActive = document.getElementById('docked-io-tab')?.classList.contains('active');

        if (!App.showProblems) {
            App.showProblems = true;
            if (!App.settings.panels) App.settings.panels = {};
            App.settings.panels.showProblems = true;
            saveSettings();
            updateUI();
            switchDockedPanel('io');
        } else {
            if (isIOActive) {
                toggleProblems();
            } else {
                switchDockedPanel('io');
            }
        }
        return;
    }

    App.showIO = !App.showIO;
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.showIO = App.showIO;
    saveSettings();
    updateUI();

    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
}
function toggleTerm() {
    if (DockingState.terminalDocked) {
        const problemsPanel = document.getElementById('problems-panel');
        const isTerminalActive = document.getElementById('docked-terminal-tab')?.classList.contains('active');

        if (!App.showProblems) {
            // If hidden, show and switch to terminal
            App.showProblems = true;
            if (!App.settings.panels) App.settings.panels = {};
            App.settings.panels.showProblems = true;
            saveSettings();
            updateUI();
            switchDockedPanel('terminal');
        } else {
            // If shown...
            if (isTerminalActive) {
                // If already looking at terminal, close problems
                toggleProblems();
            } else {
                // If looking at something else, switch to terminal
                switchDockedPanel('terminal');
            }
        }
        return;
    }

    App.showTerm = !App.showTerm;
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.showTerm = App.showTerm;
    saveSettings();
    updateUI();

    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
}
function toggleProblems() {
    App.showProblems = !App.showProblems;
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.showProblems = App.showProblems;
    saveSettings();
    updateUI();
    // Refresh editor layout after panel visibility changes
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
}

// ============================================================================
// PANELS
// ============================================================================
function initPanels() {

    const clearInput = document.getElementById('clear-input');
    const clearOutput = document.getElementById('clear-output');

    if (clearInput) {
        clearInput.onclick = () => { document.getElementById('input-area').value = ''; };
    }
    if (clearOutput) {
        clearOutput.onclick = () => {
            document.getElementById('expected-area').value = '';
            document.getElementById('expected-area').style.display = 'block';
            document.getElementById('expected-diff').style.display = 'none';
            document.getElementById('expected-diff').innerHTML = '';
        };
    }

    document.getElementById('clear-term').onclick = clearTerm;
    document.getElementById('close-problems').onclick = () => { App.showProblems = false; updateUI(); };

    document.getElementById('btn-send').onclick = sendInput;




    document.getElementById('expected-diff').onclick = switchToExpectedEdit;


    const setupRightClickPaste = (element) => {
        if (!element) return;
        element.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            try {
                const text = await navigator.clipboard.readText();
                const start = element.selectionStart;
                const end = element.selectionEnd;
                element.value = element.value.slice(0, start) + text + element.value.slice(end);
                element.selectionStart = element.selectionEnd = start + text.length;
            } catch (err) {
                console.log('Clipboard access denied:', err);
            }
        });
    };

    setupRightClickPaste(document.getElementById('input-area'));
    setupRightClickPaste(document.getElementById('expected-area'));
    setupRightClickPaste(document.getElementById('terminal-in'));

    // Setup 2-way sync between main IO panels and docked IO panels
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');

    if (inputArea) {
        inputArea.addEventListener('input', () => {
            const dockedInput = document.getElementById('docked-input');
            if (dockedInput) dockedInput.value = inputArea.value;
        });
    }

    if (expectedArea) {
        expectedArea.addEventListener('input', () => {
            const dockedExpected = document.getElementById('docked-expected');
            if (dockedExpected) dockedExpected.value = expectedArea.value;
        });
    }


    initDockablePanels();
}

// ============================================================================
// SIMPLE DOCKING SYSTEM - Dock Terminal and I/O into Problems panel
// ============================================================================

// Docking state
const DockingState = {
    draggedPanel: null,
    terminalDocked: false,
    ioDocked: false
};

function initDockablePanels() {

    const terminalSection = document.getElementById('terminal-section');
    const ioSection = document.getElementById('io-section');
    const problemsPanel = document.getElementById('problems-panel');
    const terminalHead = terminalSection?.querySelector('.panel-head');
    const ioHead = ioSection?.querySelector('.panel-head');

    if (!problemsPanel) return;


    if (terminalHead) {
        terminalHead.setAttribute('draggable', 'true');
        terminalHead.style.cursor = 'grab';

        terminalHead.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'terminal');
            e.dataTransfer.effectAllowed = 'move';
            terminalSection.classList.add('panel-dragging');
            DockingState.draggedPanel = 'terminal';
        });

        terminalHead.addEventListener('dragend', () => {
            terminalSection.classList.remove('panel-dragging');
            DockingState.draggedPanel = null;
            document.querySelectorAll('.dock-drop-target').forEach(el => {
                el.classList.remove('dock-drop-target');
            });
        });
    }

    // Make IO header draggable
    if (ioHead) {
        ioHead.setAttribute('draggable', 'true');
        ioHead.style.cursor = 'grab';

        ioHead.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'io');
            e.dataTransfer.effectAllowed = 'move';
            ioSection.classList.add('panel-dragging');
            DockingState.draggedPanel = 'io';
        });

        ioHead.addEventListener('dragend', () => {
            ioSection.classList.remove('panel-dragging');
            DockingState.draggedPanel = null;
            document.querySelectorAll('.dock-drop-target').forEach(el => {
                el.classList.remove('dock-drop-target');
            });
        });
    }

    // Problems panel as drop target
    problemsPanel.addEventListener('dragover', (e) => {
        if (DockingState.draggedPanel !== 'terminal' && DockingState.draggedPanel !== 'io') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        problemsPanel.classList.add('dock-drop-target');
    });

    problemsPanel.addEventListener('dragleave', (e) => {
        if (!problemsPanel.contains(e.relatedTarget)) {
            problemsPanel.classList.remove('dock-drop-target');
        }
    });

    problemsPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        problemsPanel.classList.remove('dock-drop-target');

        // Check for custom panel drag type
        const panelType = e.dataTransfer.getData('application/x-sameko-panel');

        if (panelType === 'terminal' || DockingState.draggedPanel === 'terminal') {
            dockTerminalToProblems();
        } else if (panelType === 'io' || DockingState.draggedPanel === 'io') {
            dockIOToProblems();
        }
    });

    // Load saved state
    if (App.settings?.panels?.terminalDocked) {
        setTimeout(() => dockTerminalToProblems(), 100);
    }
    if (App.settings?.panels?.ioDocked) {
        setTimeout(() => dockIOToProblems(), 150);
    }
}

function dockTerminalToProblems() {
    if (DockingState.terminalDocked) return;

    const terminalSection = document.getElementById('terminal-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerTerm = document.getElementById('resizer-term');

    if (!terminalSection || !problemsPanel) return;

    // Hide terminal section
    terminalSection.classList.add('docked-away');
    if (resizerTerm) resizerTerm.classList.add('docked-away');

    // Add Terminal tab to the panel-head, right after PROBLEMS
    const panelHead = problemsPanel.querySelector('.panel-head');
    if (panelHead) {
        // Create Terminal tab that looks like PROBLEMS title
        const terminalTab = document.createElement('span');
        terminalTab.className = 'panel-title terminal docked-tab';
        terminalTab.id = 'docked-terminal-tab';
        terminalTab.innerHTML = 'TERMINAL <span class="dock-undock" title="Drag to detach">×</span>';
        terminalTab.setAttribute('draggable', 'true');


        const problemCount = panelHead.querySelector('.problem-count');
        if (problemCount) {
            problemCount.after(terminalTab);
        } else {
            const problemsTitle = panelHead.querySelector('.panel-title');
            if (problemsTitle) {
                problemsTitle.after(terminalTab);
            }
        }


        const problemsTitle = panelHead.querySelector('.panel-title.problems');
        if (problemsTitle) {
            problemsTitle.classList.add('active');
        }

        // Click to switch tabs
        terminalTab.onclick = (e) => {
            if (e.target.classList.contains('dock-undock')) {
                undockTerminal();
                return;
            }
            switchDockedPanel('terminal');
        };


        const problemsTitleEl = panelHead.querySelector('.panel-title.problems');
        if (problemsTitleEl) {
            problemsTitleEl.onclick = () => switchDockedPanel('problems');
        }

        // Drag to undock
        terminalTab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'undock-terminal');
            e.dataTransfer.effectAllowed = 'move';
            terminalTab.classList.add('dragging');
        });

        terminalTab.addEventListener('dragend', () => {
            terminalTab.classList.remove('dragging');

            undockTerminal();
        });
    }

    DockingState.terminalDocked = true;

    // Save state
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.terminalDocked = true;
    saveSettings();

    // Show problems if hidden
    if (!App.showProblems) {
        App.showProblems = true;
        updateUI();
    }

    log('Terminal docked to Problems', 'info');
    refreshEditorLayout();
}

function switchDockedPanel(panelId) {
    const problemsPanel = document.getElementById('problems-panel');
    if (!problemsPanel) return;

    const problemsTitle = problemsPanel.querySelector('.panel-title.problems');
    const testsTitle = problemsPanel.querySelector('.panel-title.tests');
    const terminalTab = document.getElementById('docked-terminal-tab');
    const ioTab = document.getElementById('docked-io-tab');

    const problemsBody = problemsPanel.querySelector('.problems-body');
    const testsBody = document.getElementById('tests-results-list');
    let terminalView = problemsPanel.querySelector('.docked-terminal-view');
    let ioView = problemsPanel.querySelector('.docked-io-view');

    // Deactivate all headers
    problemsTitle?.classList.remove('active');
    testsTitle?.classList.remove('active');
    terminalTab?.classList.remove('active');
    ioTab?.classList.remove('active');

    // Hide all bodies
    if (problemsBody) problemsBody.style.display = 'none';
    if (testsBody) testsBody.style.display = 'none';
    if (terminalView) terminalView.style.display = 'none';
    if (ioView) ioView.style.display = 'none';

    if (panelId === 'problems') {
        problemsTitle?.classList.add('active');
        if (problemsBody) problemsBody.style.display = '';
    } else if (panelId === 'tests') {
        testsTitle?.classList.add('active');
        if (testsBody) testsBody.style.display = 'block';
    } else if (panelId === 'terminal') {
        terminalTab?.classList.add('active');
        if (!terminalView) {
            createDockedTerminalView(problemsPanel);
            terminalView = problemsPanel.querySelector('.docked-terminal-view');
        }
        if (terminalView) terminalView.style.display = 'flex';
        syncTerminalContent();
    } else if (panelId === 'io') {
        ioTab?.classList.add('active');
        if (!ioView) {
            createDockedIOView(problemsPanel);
            ioView = problemsPanel.querySelector('.docked-io-view');
        }
        if (ioView) ioView.style.display = 'flex';
        syncIOContent();
    }
}

function createDockedTerminalView(container) {
    const view = document.createElement('div');
    view.className = 'docked-terminal-view';
    view.innerHTML = `
        <div class="docked-terminal-body" id="docked-terminal-output"></div>
        <div class="docked-terminal-input">
            <span class="prompt"></span>
            <textarea id="docked-terminal-in" rows="1" placeholder="Input..."></textarea>
            <button class="send-btn" id="docked-send-btn">➤</button>
        </div>
    `;
    container.appendChild(view);


    const input = view.querySelector('#docked-terminal-in');
    const sendBtn = view.querySelector('#docked-send-btn');

    const sendDockedInput = () => {
        if (input.value && App.isRunning) {
            // Send each line separately
            const lines = input.value.split('\n');
            lines.forEach(line => {
                log(line, 'input');
                window.electronAPI?.sendInput(line);
            });
            input.value = '';
            input.rows = 1;
        }
    };


    input.onkeydown = (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            sendDockedInput();
        } else if (e.key === 'Enter' && !e.shiftKey && input.rows === 1) {
            // Single line mode: Enter sends
            e.preventDefault();
            sendDockedInput();
        }
    };

    // Auto-resize logic with paste fix
    const handleResize = function () {
        if (this.value === '') {
            this.style.height = '';
            return;
        }
        this.style.height = 0;
        this.style.height = (this.scrollHeight) + 'px';
    };
    input.addEventListener('input', handleResize);
    input.addEventListener('paste', function () {
        setTimeout(() => handleResize.call(this), 10);
    });


    input.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        try {
            const text = await navigator.clipboard.readText();
            const start = input.selectionStart;
            const end = input.selectionEnd;
            input.value = input.value.slice(0, start) + text + input.value.slice(end);
            input.selectionStart = input.selectionEnd = start + text.length;
            input.dispatchEvent(new Event('input')); // Trigger resize
        } catch (err) {
            console.log('Clipboard access denied:', err);
        }
    });

    sendBtn.onclick = sendDockedInput;


    view.addEventListener('contextmenu', async (e) => {
        // Ignore if valid interactive elements
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

        e.preventDefault();
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                const start = input.selectionStart;
                const end = input.selectionEnd;
                input.value = input.value.slice(0, start) + text + input.value.slice(end);

                // Trigger events for auto-resize
                input.dispatchEvent(new Event('input'));
                input.focus();

                // Update cursor
                input.selectionStart = input.selectionEnd = start + text.length;
            }
        } catch (err) {
            console.warn('Paste failed', err);
        }
    });

    syncTerminalContent();
}

function syncTerminalContent() {
    const original = document.getElementById('terminal');
    const docked = document.getElementById('docked-terminal-output');
    if (original && docked) {
        docked.innerHTML = original.innerHTML;
        // Scroll to bottom
        scrollDockedTerminalToBottom();
    }
}

function scrollDockedTerminalToBottom() {
    const docked = document.getElementById('docked-terminal-output');
    if (docked) {
        docked.scrollTop = docked.scrollHeight;
    }
}

function undockTerminal() {
    if (!DockingState.terminalDocked) return;

    const terminalSection = document.getElementById('terminal-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerTerm = document.getElementById('resizer-term');


    terminalSection?.classList.remove('docked-away');
    resizerTerm?.classList.remove('docked-away');


    const terminalTab = document.getElementById('docked-terminal-tab');
    terminalTab?.remove();


    const dockedView = problemsPanel?.querySelector('.docked-terminal-view');
    dockedView?.remove();


    const problemsBody = problemsPanel?.querySelector('.problems-body');
    if (problemsBody) problemsBody.style.display = '';


    const problemsTitle = problemsPanel?.querySelector('.panel-title.problems');
    if (problemsTitle) {
        problemsTitle.classList.remove('active');
        problemsTitle.onclick = null; // Remove click handler
    }

    DockingState.terminalDocked = false;

    // Save state
    if (App.settings.panels) {
        App.settings.panels.terminalDocked = false;
        saveSettings();
    }

    // Refresh tests list if has tests
    if (ccProblem?.tests?.length > 0) {
        renderTestResults();
        switchProblemsTab('tests');
    }

    log('Terminal undocked', 'info');
    refreshEditorLayout();
}

// ============================================================================
// I/O DOCKING FUNCTIONS
// ============================================================================

function dockIOToProblems() {
    if (DockingState.ioDocked) return;

    const ioSection = document.getElementById('io-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerIO = document.getElementById('resizer-io');

    if (!ioSection || !problemsPanel) return;


    ioSection.classList.add('docked-away');
    if (resizerIO) resizerIO.classList.add('docked-away');


    const panelHead = problemsPanel.querySelector('.panel-head');
    if (panelHead) {
        const ioTab = document.createElement('span');
        ioTab.className = 'panel-title io docked-tab';
        ioTab.id = 'docked-io-tab';
        ioTab.innerHTML = 'I/O <span class="dock-undock" title="Drag to detach">×</span>';
        ioTab.setAttribute('draggable', 'true');


        const terminalTab = document.getElementById('docked-terminal-tab');
        const problemCount = panelHead.querySelector('.problem-count');
        if (terminalTab) {
            terminalTab.after(ioTab);
        } else if (problemCount) {
            problemCount.after(ioTab);
        } else {
            const problemsTitle = panelHead.querySelector('.panel-title');
            if (problemsTitle) problemsTitle.after(ioTab);
        }

        // Click to switch tabs
        ioTab.onclick = (e) => {
            if (e.target.classList.contains('dock-undock')) {
                undockIO();
                return;
            }
            switchDockedPanel('io');
        };

        // Drag to undock
        ioTab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-sameko-panel', 'undock-io');
            e.dataTransfer.effectAllowed = 'move';
            ioTab.classList.add('dragging');
        });

        ioTab.addEventListener('dragend', () => {
            ioTab.classList.remove('dragging');
            undockIO();
        });
    }

    DockingState.ioDocked = true;

    // Save state
    if (!App.settings.panels) App.settings.panels = {};
    App.settings.panels.ioDocked = true;
    saveSettings();

    // Show problems if hidden
    if (!App.showProblems) {
        App.showProblems = true;
        updateUI();
    }

    log('I/O docked to Problems', 'info');
    refreshEditorLayout();
}

function undockIO() {
    if (!DockingState.ioDocked) return;

    const ioSection = document.getElementById('io-section');
    const problemsPanel = document.getElementById('problems-panel');
    const resizerIO = document.getElementById('resizer-io');


    ioSection?.classList.remove('docked-away');
    resizerIO?.classList.remove('docked-away');


    const ioTab = document.getElementById('docked-io-tab');
    ioTab?.remove();


    const dockedView = problemsPanel?.querySelector('.docked-io-view');
    dockedView?.remove();


    if (!DockingState.terminalDocked) {
        const problemsBody = problemsPanel?.querySelector('.problems-body');
        if (problemsBody) problemsBody.style.display = '';
    }

    DockingState.ioDocked = false;

    // Save state
    if (App.settings.panels) {
        App.settings.panels.ioDocked = false;
        saveSettings();
    }

    // Refresh tests list if has tests
    if (ccProblem?.tests?.length > 0) {
        renderTestResults();
        switchProblemsTab('tests');
    }

    log('I/O undocked', 'info');
    refreshEditorLayout();
}

function createDockedIOView(container) {

    let dockedIOView = container.querySelector('.docked-io-view');
    if (!dockedIOView) {
        dockedIOView = document.createElement('div');
        dockedIOView.className = 'docked-io-view';
        dockedIOView.innerHTML = `
            <div class="docked-io-header-bar">
                <span class="docked-io-title">Test Cases</span>
                <div class="docked-test-nav" id="docked-test-nav">
                    <button class="docked-nav-btn" id="docked-btn-add-test" title="Add test">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <button class="docked-nav-btn" id="docked-btn-prev-test" title="Previous test">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <span class="docked-test-label" id="docked-test-label">0/0</span>
                    <button class="docked-nav-btn" id="docked-btn-next-test" title="Next test">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                    <button class="docked-nav-btn danger" id="docked-btn-delete-test" title="Delete test">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="docked-io-split">
                <div class="docked-io-panel">
                    <div class="docked-io-header">INPUT</div>
                    <textarea class="docked-io-textarea" id="docked-input" placeholder="Enter test data..."></textarea>
                </div>
                <div class="docked-io-divider"></div>
                <div class="docked-io-panel">
                    <div class="docked-io-header">EXPECTED</div>
                    <textarea class="docked-io-textarea" id="docked-expected" placeholder="Expected output..."></textarea>
                    <div class="docked-io-textarea" id="docked-expected-diff" style="display: none; overflow: auto; cursor: text;"></div>
                </div>
            </div>
        `;
        container.appendChild(dockedIOView);


        syncIOContent();
        updateDockedTestNavUI();


        const dockedInput = document.getElementById('docked-input');
        const dockedExpected = document.getElementById('docked-expected');

        dockedInput?.addEventListener('input', () => {
            const original = document.getElementById('input-area');
            if (original) original.value = dockedInput.value;
            // Also update current test case if exists
            if (ccProblem?.tests?.[ccTestIndex]) {
                ccProblem.tests[ccTestIndex].input = dockedInput.value;
            }
        });

        dockedExpected?.addEventListener('input', () => {
            const original = document.getElementById('expected-area');
            if (original) original.value = dockedExpected.value;
            // Also update current test case if exists
            if (ccProblem?.tests?.[ccTestIndex]) {
                ccProblem.tests[ccTestIndex].output = dockedExpected.value;
            }
        });

        // Bind docked nav buttons
        document.getElementById('docked-btn-add-test')?.addEventListener('click', addTestCase);
        document.getElementById('docked-btn-prev-test')?.addEventListener('click', prevTestCase);
        document.getElementById('docked-btn-next-test')?.addEventListener('click', nextTestCase);
        document.getElementById('docked-btn-delete-test')?.addEventListener('click', deleteTestCase);

        // Bind docked diff click to switch to edit
        document.getElementById('docked-expected-diff')?.addEventListener('click', switchToExpectedEdit);
    }
    return dockedIOView;
}

// Update docked test navigation UI
function updateDockedTestNavUI() {
    const testLabel = document.getElementById('docked-test-label');
    const prevBtn = document.getElementById('docked-btn-prev-test');
    const nextBtn = document.getElementById('docked-btn-next-test');
    const deleteBtn = document.getElementById('docked-btn-delete-test');

    if (!testLabel) return;

    const testCount = ccProblem?.tests?.length || 0;

    if (testCount > 0) {
        testLabel.textContent = `${ccTestIndex + 1}/${testCount}`;
        if (prevBtn) prevBtn.style.display = 'flex';
        if (nextBtn) nextBtn.style.display = 'flex';
        if (deleteBtn) deleteBtn.style.display = 'flex';
    } else {
        testLabel.textContent = '0/0';
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
}

function syncIOContent() {
    const originalInput = document.getElementById('input-area');
    const originalExpected = document.getElementById('expected-area');
    const dockedInput = document.getElementById('docked-input');
    const dockedExpected = document.getElementById('docked-expected');
    const dockedDiffDisplay = document.getElementById('docked-expected-diff');

    if (originalInput && dockedInput) {
        dockedInput.value = originalInput.value;
    }
    if (originalExpected && dockedExpected) {
        dockedExpected.value = originalExpected.value;
    }

    // If docked diff is visible, refresh comparison so it stays consistent with latest expected/actual
    if (dockedDiffDisplay && dockedDiffDisplay.style.display !== 'none') {
        compareOutput();
    }
}

function refreshEditorLayout() {
    setTimeout(() => {
        if (App.editor) App.editor.layout();
        if (App.editor2) App.editor2.layout();
    }, 50);
}


// ============================================================================
// RESIZERS
// ============================================================================
function applySavedPanelSizes() {
    const panelSettings = App.settings.panels || {};

    const ioSection = document.getElementById('io-section');
    const termSection = document.getElementById('terminal-section');
    const problemsPanel = document.getElementById('problems-panel');

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    // Keep enough room for Monaco editor on small/odd aspect ratios.
    const viewportWidth = window.innerWidth || 1280;
    const minEditorWidth = 420;
    const reserved = 120; // header paddings/gaps/safety
    const maxPanelWidth = Math.max(150, Math.floor((viewportWidth - minEditorWidth - reserved) / 2));

    if (ioSection && Number.isFinite(panelSettings.ioWidth) && panelSettings.ioWidth > 0) {
        ioSection.style.width = clamp(panelSettings.ioWidth, 150, maxPanelWidth) + 'px';
    }
    if (termSection && Number.isFinite(panelSettings.termWidth) && panelSettings.termWidth > 0) {
        termSection.style.width = clamp(panelSettings.termWidth, 150, maxPanelWidth) + 'px';
    }
    if (problemsPanel && Number.isFinite(panelSettings.problemsHeight) && panelSettings.problemsHeight > 0) {
        const maxProblemsHeight = Math.max(120, Math.floor((window.innerHeight || 800) * 0.55));
        problemsPanel.style.height = clamp(panelSettings.problemsHeight, 80, maxProblemsHeight) + 'px';
    }
}

function persistPanelSize(targetId, sizeValue) {
    if (!App.settings.panels) App.settings.panels = {};

    if (targetId === 'io-section') {
        App.settings.panels.ioWidth = sizeValue;
    } else if (targetId === 'terminal-section') {
        App.settings.panels.termWidth = sizeValue;
    } else if (targetId === 'problems-panel') {
        App.settings.panels.problemsHeight = sizeValue;
    }

    saveSettings();
}

function initResizers() {
    applySavedPanelSizes();
    setupResizer('resizer-io', 'io-section', 150, 500);
    setupResizer('resizer-term', 'terminal-section', 150, 600);
    setupResizerH('resizer-problems', 'problems-panel', 80, 400);

    window.addEventListener('resize', () => {
        applySavedPanelSizes();
    });
}

function setupResizer(resizerId, targetId, min, max) {
    const resizer = document.getElementById(resizerId);
    const target = document.getElementById(targetId);
    let dragging = false;
    let startX, startW;

    const getDynamicMax = () => {
        const viewportWidth = window.innerWidth || 1280;
        const minEditorWidth = 420;
        const reserved = 120;
        const computedMax = Math.max(min, Math.floor((viewportWidth - minEditorWidth - reserved) / 2));
        return Math.min(max, computedMax);
    };

    resizer.onmousedown = e => {
        dragging = true;
        startX = e.clientX;
        startW = target.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    };

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const dx = startX - e.clientX;
        const dynamicMax = getDynamicMax();
        const newW = Math.min(dynamicMax, Math.max(min, startW + dx));
        target.style.width = newW + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            persistPanelSize(targetId, target.offsetWidth);
        }
    });
}

function setupResizerH(resizerId, targetId, min, max) {
    const resizer = document.getElementById(resizerId);
    const target = document.getElementById(targetId);
    let dragging = false;
    let startY, startH;

    resizer.onmousedown = e => {
        dragging = true;
        startY = e.clientY;
        startH = target.offsetHeight;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
    };

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const dy = startY - e.clientY;
        const newH = Math.min(max, Math.max(min, startH + dy));
        target.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            persistPanelSize(targetId, target.offsetHeight);
        }
    });
}

// ============================================================================
// DISCORD RICH PRESENCE
// ============================================================================

let _discordCursorTimer = null;
let _discordLastPos = { line: 1, col: 1 };

function updateDiscordPresence(tab, line, col) {
    // Respect the enabled setting
    if (App.settings?.discord?.enabled === false) return;
    if (!window.electronAPI?.discordUpdatePresence) return;

    const fileName = tab?.name || null;
    let workspaceName = null;
    if (tab?.path) {
        const parts = tab.path.replace(/\\/g, '/').split('/');
        if (parts.length >= 2) workspaceName = parts[parts.length - 2];
    }

    const ln = line || _discordLastPos.line;
    const cl = col || _discordLastPos.col;

    window.electronAPI.discordUpdatePresence({ fileName, workspaceName, line: ln, col: cl }).catch(() => { });
}

/**
 * Called on cursor move — throttled to avoid spamming the RPC socket
 */
function scheduleDiscordCursorUpdate(line, col) {
    if (App.settings?.discord?.enabled === false) return;
    _discordLastPos = { line, col };
    if (_discordCursorTimer) return; // already scheduled
    _discordCursorTimer = setTimeout(() => {
        _discordCursorTimer = null;
        const activeTab = App.tabs.find(t => t.id === App.activeTabId) || null;
        updateDiscordPresence(activeTab, _discordLastPos.line, _discordLastPos.col);
    }, 5000); // update presence every 5 s at most on cursor movement
}

/**
 * Update the Discord preview card inside settings panel
 */
function updateDiscordPreview() {
    const detailsEl = document.getElementById('discord-preview-details');
    const stateEl = document.getElementById('discord-preview-state');
    if (!detailsEl || !stateEl) return;
    const activeTab = App.tabs.find(t => t.id === App.activeTabId);
    if (activeTab?.name) {
        detailsEl.textContent = `Working on ${activeTab.name}`;
        const folder = activeTab.path
            ? activeTab.path.replace(/\\/g, '/').split('/').slice(-2, -1)[0]
            : null;
        stateEl.textContent = folder
            ? `In ${folder} \u2014 Ln ${_discordLastPos.line}, Col ${_discordLastPos.col}`
            : `Sameko Dev C++ \u2014 Ln ${_discordLastPos.line}, Col ${_discordLastPos.col}`;
    } else {
        detailsEl.textContent = 'Idle';
        stateEl.textContent = 'Sameko Dev C++';
    }
}

// ============================================================================
// TABS
// ============================================================================
function newFile() {
    const id = 'tab_' + Date.now();

    const templateCode = App.settings.template?.code || DEFAULT_CODE;
    const tab = { id, name: 'untitled.cpp', path: null, untitledHistoryKey: createUntitledHistoryKey(), content: templateCode, original: '', modified: true };
    App.tabs.push(tab);
    setActive(id);
    updateUI();
    scheduleSessionSave();
}

function persistCurrentTabIO() {
    const tabId = getPreferredTabId();
    if (!tabId) return;

    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    if (!inputArea || !expectedArea) return;

    App.ioByTab[tabId] = {
        input: inputArea.value || '',
        expected: expectedArea.value || ''
    };
}

function restoreTabIO(tabId) {
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    if (!inputArea || !expectedArea) return;

    const ioState = App.ioByTab[tabId] || { input: '', expected: '' };
    inputArea.value = ioState.input || '';
    expectedArea.value = ioState.expected || '';

    const dockedInput = document.getElementById('docked-input');
    const dockedExpected = document.getElementById('docked-expected');
    if (dockedInput) dockedInput.value = inputArea.value;
    if (dockedExpected) dockedExpected.value = expectedArea.value;
}

function setActive(id) {
    const tab = App.tabs.find(t => t.id === id);
    if (!tab) return;


    if (App.activeTabId && App.editor && App.ready) {
        const cur = App.tabs.find(t => t.id === App.activeTabId);
        if (cur) cur.content = App.editor.getValue();
        persistCurrentTabIO();
    }

    App.activeTabId = id;
    if (App.editor && App.ready) {
        App.isSettingValue = true;
        App.editor.setValue(tab.content);
        App.isSettingValue = false;
    }

    if (tab.path && window.FileExplorer?.handleFileOpened) {
        window.FileExplorer.handleFileOpened(tab.path);
    }

    restoreTabIO(id);
    clearErrorDecorations();
    renderTabs();
    // Reset cursor tracker so presence shows Ln 1, Col 1 for the new tab
    _discordLastPos = { line: 1, col: 1 };
    if (_discordCursorTimer) { clearTimeout(_discordCursorTimer); _discordCursorTimer = null; }
    updateDiscordPresence(tab, 1, 1);
}

async function closeTab(id) {
    const idx = App.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = App.tabs[idx];

    if (App.isRunning) {
        const confirmed = await showConfirmDialog({
            title: 'Process Running',
            message: `A process is running. Stop it and close "${tab.name}"?`,
            confirmText: 'Stop & Close',
            danger: true
        });
        if (!confirmed) return;
        stop();
    }

    if (tab.modified) {
        const confirmed = await showConfirmDialog({
            title: 'Unsaved Changes',
            message: `"${tab.name}" has unsaved changes. Close without saving?`,
            confirmText: 'Close',
            danger: true
        });
        if (!confirmed) return;
    }


    if (tab.path) stopFileWatch(tab.path);

    delete App.tabDiagnostics[id];

    App.tabs.splice(idx, 1);
    delete App.ioByTab[id];


    if (App.splitTabId === id) closeSplit();

    if (App.activeTabId === id) {
        if (App.tabs.length) setActive(App.tabs[Math.min(idx, App.tabs.length - 1)].id);
        else {
            App.activeTabId = null;
            if (App.editor) App.editor.setValue('');
            updateDiscordPresence(null);
        }
    }
    renderTabs();
    updateUI();
    if (App.tabs.length === 0) {
        clearSession();
    } else {
        scheduleSessionSave();
    }
}

/**
 * Open a file from a given path (for File Explorer integration)
 * Creates a new tab or switches to existing tab if file is already open
 */
async function openFileFromPath(filePath) {
    if (!filePath) return;

    // Normalize path for comparison
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Check if file is already open
    const existingTab = App.tabs.find(t => t.path && t.path.replace(/\\/g, '/') === normalizedPath);
    if (existingTab) {
        setActive(existingTab.id);
        return;
    }

    // Read file content
    try {
        let content;
        if (window.electronAPI && window.electronAPI.readFile) {
            content = await window.electronAPI.readFile(filePath);
        } else {
            console.error('[openFileFromPath] electronAPI.readFile not available');
            return;
        }

        // Create new tab
        const id = 'tab_' + Date.now();
        const fileName = filePath.split(/[/\\]/).pop();
        const tab = {
            id,
            name: fileName,
            path: filePath,
            untitledHistoryKey: null,
            content: content,
            original: content,
            modified: false
        };
        App.tabs.push(tab);
        setActive(id);
        updateUI();
        scheduleSessionSave();

        // Hide welcome screen
        const welcome = document.getElementById('welcome');
        if (welcome) welcome.style.display = 'none';

        console.log(`[openFileFromPath] Opened: ${fileName}`);
    } catch (err) {
        console.error('[openFileFromPath] Failed to open file:', err);
    }
}

// Expose to window for FileExplorer
window.openFromPath = openFileFromPath;

function renderTabs() {
    const c = document.getElementById('tabs-container');
    c.innerHTML = '';
    App.tabs.forEach(t => {
        const isActiveTab = t.id === App.activeTabId;
        const isSplitTab = App.isSplit && t.id === App.splitTabId;
        const isFocused = (App.activeEditor === 1 && isActiveTab) || (App.activeEditor === 2 && isSplitTab);
        const diagnostics = App.tabDiagnostics[t.id] || null;
        const tabHasErrors = !!diagnostics?.errors;
        const tabHasWarnings = !tabHasErrors && !!diagnostics?.warnings;

        const el = document.createElement('div');
        let className = 'tab';
        if (isActiveTab) className += ' active';
        if (isSplitTab) className += ' split';
        if (isFocused) className += ' focused';
        if (t.modified) className += ' modified';
        if (tabHasErrors) className += ' has-errors';
        else if (tabHasWarnings) className += ' has-warnings';

        el.className = className;
        el.dataset.id = t.id;
        el.draggable = true;
        const diagnosticsBadge = diagnostics && (diagnostics.errors || diagnostics.warnings)
            ? `<span class="tab-diagnostics ${tabHasErrors ? 'error' : 'warning'}" title="${diagnostics.errors || 0} errors, ${diagnostics.warnings || 0} warnings">${tabHasErrors ? diagnostics.errors : diagnostics.warnings}${tabHasErrors ? 'E' : 'W'}</span>`
            : '';
        el.innerHTML = `<span class="tab-name">${t.name}</span>${diagnosticsBadge}<span class="tab-dot"></span><span class="tab-x">×</span>`;
        el.onclick = e => {
            if (!e.target.classList.contains('tab-x')) {
                if (App.isSplit && isSplitTab) {

                    App.activeEditor = 2;
                    renderTabs();
                } else {
                    setActive(t.id);
                    App.activeEditor = 1;
                }
            }
        };
        // Right-click context menu for Local History
        el.oncontextmenu = e => {
            e.preventDefault();
            e.stopPropagation();
            showTabContextMenu(e, t);
        };
        el.querySelector('.tab-x').onclick = e => { e.stopPropagation(); closeTab(t.id); };
        c.appendChild(el);
    });

    setTimeout(() => {
        const focusedTab = c.querySelector('.tab.focused') || c.querySelector('.tab.active');
        if (focusedTab) {
            focusedTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, 10);
}

// ============================================================================
// MENUS
// ============================================================================
let activeMenu = null;

function initMenus() {
    document.querySelectorAll('.menu-btn').forEach(btn => {
        btn.onclick = e => { toggleMenu('menu-' + btn.dataset.menu, btn); e.stopPropagation(); };
    });
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.onclick = () => { doAction(item.dataset.action); closeMenus(); };
    });
    document.onclick = closeMenus;
}

function toggleMenu(id, el) {
    const menu = document.getElementById(id);
    if (activeMenu === id) { closeMenus(); return; }
    closeMenus();
    menu.classList.add('show');
    el.classList.add('active');
    const rect = el.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    activeMenu = id;
}

function closeMenus() {
    document.querySelectorAll('.dropdown').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    activeMenu = null;
}

function doAction(action) {
    const map = {
        new: newFile, open: openFile, save, run, buildrun: buildRun, stop,
        exit: () => window.electronAPI?.closeWindow?.(),
        undo: () => getActiveEditor()?.trigger('keyboard', 'undo'),
        redo: () => getActiveEditor()?.trigger('keyboard', 'redo'),
        find: () => getActiveEditor()?.trigger('keyboard', 'actions.find'),
        // Temporarily disabled: toggleexplorer
        // toggleexplorer: () => {
        //     if (typeof FileExplorer !== 'undefined') {
        //         FileExplorer.toggle();
        //     }
        // },
        toggleio: toggleIO,
        toggleterm: toggleTerm,
        toggleproblems: toggleProblems,
        spliteditor: openSplit,
        swapsplit: swapSplitEditors,
        closesplit: closeSplit,
        settings: openSettings,
        localhistory: () => {
            const activeTabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
            const tab = App.tabs.find(t => t.id === activeTabId);
            if (tab && typeof LocalHistory !== 'undefined') {
                if (tab.path) {
                    LocalHistory.showHistoryModal(tab.path);
                } else {
                    LocalHistory.showUntitledHistoryModal(tab);
                }
            }
        }
    };
    map[action]?.();
}

function getActiveEditor() {
    return App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================
async function openFile() { await window.electronAPI.openFile(); }

async function save() {

    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.content = editor.getValue();

    if (tab.path) {
        // Create backup before saving (async, non-blocking)
        if (typeof LocalHistory !== 'undefined' && LocalHistory.settings.enabled) {
            LocalHistory.createBackup(tab.path, tab.content).catch(e =>
                console.warn('[LocalHistory] Backup failed:', e)
            );
        }

        const r = await window.electronAPI.saveFile({ path: tab.path, content: tab.content });
        if (r.success) { tab.original = tab.content; tab.modified = false; renderTabs(); setStatus(`Saved ${tab.name}`, 'success'); scheduleSessionSave(); }
    } else await saveAs(tabId);
}

async function saveAs(tabIdOverride = null) {

    const tabId = tabIdOverride || (App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId);
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.content = editor.getValue();
    const r = await window.electronAPI.saveFileDialog(tab.content);
    if (r.success) {
        tab.path = r.path;
        tab.name = r.path.split(/[/\\]/).pop();
        tab.original = tab.content;
        tab.modified = false;
        renderTabs();
        setStatus('Saved', 'success');
        scheduleSessionSave();
    }
}

// ============================================================================
// BUILD & RUN
// ============================================================================


let isBuilding = false;

function setBuildingState(building) {
    isBuilding = building;
    const btnBuildRun = document.getElementById('btn-buildrun');
    const btnRunOnly = document.getElementById('btn-run-only');
    const btnRunAll = document.getElementById('btn-run-all-tests');

    if (btnBuildRun) btnBuildRun.disabled = building;
    if (btnRunOnly) btnRunOnly.disabled = building;
    if (btnRunAll) btnRunAll.disabled = building;


    if (btnBuildRun) {
        if (building) {
            btnBuildRun.classList.add('building');
        } else {
            btnBuildRun.classList.remove('building');
        }
    }

    if (!building && App.settings.editor.liveCheck) {
        setLiveCheckUIState(App.problems.length > 0 ? 'issues' : 'idle');
    }
}


async function compileOnly() {
    // Anti-spam check
    if (isBuilding) {
        log('Build in progress...', 'warning');
        return;
    }

    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) { log('No file open', 'warning'); return; }

    setBuildingState(true);

    try {
        tab.content = editor.getValue();


        if (tab.path) {
            await window.electronAPI.saveFile({ path: tab.path, content: tab.content });
            tab.original = tab.content; tab.modified = false; renderTabs();
        }


        if (!App.showTerm) {
            App.showTerm = true;
            if (App.settings.panels) App.settings.panels.showTerm = true;
            saveSettings();
            updateUI();
        }

        if (App.settings.execution.clearTerminal) clearTerm();
        clearProblems();
        clearErrorDecorations();
        hasBuildProblems = false; // Reset before new build

        log('Compiling...', 'info');
        setStatus('Compiling...', 'building');

        // Notify explorer: compile started
        if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-start');

        const t0 = Date.now();

        const flags = buildCompileFlags();

        const r = await window.electronAPI.compile({
            filePath: tab.path,
            content: tab.content,
            flags,
            singleFileMode: App.settings.compiler.singleFileMode !== false,
            noBuildCache: App.settings.execution.noBuildCache === true
        });
        const ms = Date.now() - t0;

        if (r.success) {
            App.exePath = r.outputPath;
            if (r.linkedFiles && r.linkedFiles.length > 0) {
                log(`Linked: ${r.linkedFiles.join(', ')}`, 'system');
            }
            log(`Compile OK (${ms}ms)`, 'success');
            if (r.warnings) {
                log(r.warnings, 'warning');
                parseProblems(r.warnings, 'warning');
            }
            setStatus(`Compile: ${ms}ms`, 'success');
            if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-ok');
        } else {
            log('Compile failed', 'error');
            log(r.error, 'error');

            const linkerLikeError = /undefined reference|ld returned|collect2\.exe: error/i.test(String(r.error || ''));
            if ((App.settings.compiler.singleFileMode !== false) && linkerLikeError) {
                log('Hint: This may require multi-file linking. Retry with Single-file mode OFF in Compiler settings.', 'warning');
            }

            parseProblems(r.error, 'error');
            hasBuildProblems = true; // Lock problems list from live-check overwrite
            highlightErrorLines();
            setStatus('Compile failed', 'error');
            App.exePath = null;
            if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-fail');

            if (DockingState.terminalDocked) {
                switchDockedPanel('problems');
            }
        }
    } finally {
        setBuildingState(false);
    }
}

async function buildRun() {
    // Anti-spam check
    if (isBuilding) {
        log('Build in progress...', 'warning');
        return;
    }


    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) { log('No file open', 'warning'); return; }

    setBuildingState(true);

    try {

        tab.content = editor.getValue();


        if (tab.path) {
            await window.electronAPI.saveFile({ path: tab.path, content: tab.content });
            tab.original = tab.content; tab.modified = false; renderTabs();
        }


        if (!App.showTerm) {
            App.showTerm = true;
            if (App.settings.panels) App.settings.panels.showTerm = true;
            saveSettings();
            updateUI();
        }
        if (DockingState.terminalDocked) {
            switchDockedPanel('terminal');
        }

        if (App.settings.execution.clearTerminal) clearTerm();
        clearProblems();
        clearErrorDecorations();
        hasBuildProblems = false; // Reset before new build

        log('Building...', 'info');
        setStatus('Building...', 'building');

        // Notify explorer: compile started
        if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-start');

        const t0 = Date.now();

        const flags = buildCompileFlags();

        const r = await window.electronAPI.compile({
            filePath: tab.path,
            content: tab.content,
            flags,
            singleFileMode: App.settings.compiler.singleFileMode !== false,
            useLLD: App.settings.compiler.useLLD !== false,
            noBuildCache: App.settings.execution.noBuildCache === true
        });
        const ms = Date.now() - t0;

        if (r.success) {
            App.exePath = r.outputPath;
            // Show linked files if multi-file project
            if (r.linkedFiles && r.linkedFiles.length > 0) {
                log(`Linked: ${r.linkedFiles.join(', ')}`, 'system');
            }
            log(`Build OK (${ms}ms)`, 'success');
            if (r.warnings) {
                log(r.warnings, 'warning');
                parseProblems(r.warnings, 'warning');
            }
            setStatus(`Build: ${ms}ms`, 'success');
            if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-ok');

            // Unlock before running so stop button works
            setBuildingState(false);
            await run(false); // Don't clear terminal - keep build info visible
        } else {
            log('Build failed', 'error');
            log(r.error, 'error');

            const linkerLikeError = /undefined reference|ld returned|collect2\.exe: error/i.test(String(r.error || ''));
            if ((App.settings.compiler.singleFileMode !== false) && linkerLikeError) {
                log('Hint: This may require multi-file linking. Retry with Single-file mode OFF in Compiler settings.', 'warning');
            }

            parseProblems(r.error, 'error');
            hasBuildProblems = true; // Lock problems list from live-check overwrite
            highlightErrorLines();
            setStatus('Build failed', 'error');
            App.exePath = null;
            if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-fail');
            setBuildingState(false);
        }
    } catch (e) {
        setBuildingState(false);
        throw e;
    }
}

async function run(clearTerminal = true) {
    if (!App.exePath) { log('Build first (F11)', 'warning'); return; }

    if (!App.showTerm) {
        App.showTerm = true;
        updateUI();
    }

    if (DockingState.terminalDocked) {
        switchDockedPanel('terminal');
    }


    if (clearTerminal) clearTerm();

    const inputText = document.getElementById('input-area').value.trim();
    if (App.settings.execution.autoSendInput) {
        App.inputLines = inputText ? inputText.split('\n') : [];
    } else {
        App.inputLines = [];
    }
    App.inputIndex = 0;

    log('--- Running ---', 'system');
    setStatus('Running...', '');
    setRunning(true);

    // Notify explorer: run started
    const _runTab = App.tabs.find(t => t.id === (App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId));
    if (window.FileExplorer && _runTab) window.FileExplorer.notifyBuildEvent(_runTab.path, 'run-start');


    if (DockingState.terminalDocked) {
        switchDockedPanel('terminal');
        scrollDockedTerminalToBottom();

        setTimeout(() => {
            const dockedInput = document.getElementById('docked-terminal-in');
            if (dockedInput) dockedInput.focus();
        }, 100);
    }

    if (App.settings.execution.timeLimitEnabled && App.settings.execution.timeLimitSeconds > 0) {
        App.runTimeout = setTimeout(() => {
            if (App.isRunning) {
                log('\nTime limit exceeded!', 'error');
                stop();
            }
        }, App.settings.execution.timeLimitSeconds * 1000);
    }

    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const tab = App.tabs.find(t => t.id === tabId);
    let sourceDir = null;
    if (tab && tab.path) {
        const lastSlash = Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\'));
        if (lastSlash !== -1) sourceDir = tab.path.substring(0, lastSlash);
    }

    await window.electronAPI.run({
        exePath: App.exePath,
        cwd: sourceDir,
        useExternalTerminal: App.settings.execution.useExternalTerminal
    });

    // Skip auto-send input if using external terminal
    if (App.settings.execution.useExternalTerminal) {
        return;
    }

    // Send all input at once (like freopen) for maximum speed
    if (inputText && App.settings.execution.autoSendInput) {
        setTimeout(() => {
            if (App.isRunning) {
                // Log each line to terminal with input styling
                inputText.split('\n').forEach(line => log(line, 'input'));

                // Send entire input to stdin at once (no per-line delay)
                window.electronAPI.sendInput(inputText);
            }
        }, 20);
    }
}

// Removed sendNextInput() - no longer needed

async function stop() {
    if (App.runTimeout) {
        clearTimeout(App.runTimeout);
        App.runTimeout = null;
    }

    setRunning(false);
    log('\n[System] Process terminated.', 'error');

    await window.electronAPI.stopProcess();
}

// ============================================================================
// ERROR HIGHLIGHTING
// ============================================================================
function highlightErrorLines() {
    if (!App.editor || App.problems.length === 0) return;

    const decorations = App.problems
        .filter(p => p.type === 'error')
        .map(p => ({
            range: new monaco.Range(p.line, 1, p.line, 1),
            options: {
                isWholeLine: true,
                className: 'error-line-decoration',
                glyphMarginClassName: 'error-glyph'
            }
        }));

    App.errorDecorations = App.editor.deltaDecorations(App.errorDecorations, decorations);
}

function clearErrorDecorations() {
    if (App.editor && App.errorDecorations.length > 0) {
        App.errorDecorations = App.editor.deltaDecorations(App.errorDecorations, []);
    }
}

// ============================================================================
// PROBLEMS PANEL
// ============================================================================
function clearProblems() {
    App.problems = [];
    renderProblems();
}

function parseProblems(text, type) {
    const lines = text.split('\n');
    const regex = /(.+):(\d+):(\d+):\s*(error|warning):\s*(.+)/;

    lines.forEach(line => {
        const m = line.match(regex);
        if (m) {
            App.problems.push({
                file: m[1],
                line: parseInt(m[2]),
                col: parseInt(m[3]),
                type: m[4],
                message: m[5]
            });
        }
    });

    if (App.problems.length > 0) {
        App.showProblems = true;
        updateUI();
    }

    renderProblems();
}

function renderProblems() {
    const list = document.getElementById('problems-list');
    const count = document.getElementById('problem-count');

    count.textContent = App.problems.length;
    list.innerHTML = '';
    updateProblemSummaryUI();
    setActiveTabDiagnostics(App.problems);

    App.problems.forEach(p => {
        const el = document.createElement('div');
        el.className = 'problem-item ' + p.type;
        const icon = p.type === 'error'
            ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
            : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>';
        el.innerHTML = `<span class="problem-icon">${icon}</span>
      <span class="problem-message">${p.message}</span>
      <span class="problem-location" style="margin-left:auto;opacity:0.7;color:var(--text-secondary)">${p.file.split(/[/\\]/).pop()}:${p.line}</span>`;
        el.onclick = () => {
            if (App.editor) {
                App.editor.revealLineInCenter(p.line);
                App.editor.setPosition({ lineNumber: p.line, column: p.col });
                App.editor.focus();
            }
        };
        list.appendChild(el);
    });
}


const ANSI_COLORS_16 = {
    // Standard colors (30-37)
    30: '#1a1a1a', // black
    31: '#e06c75', // red
    32: '#98c379', // green
    33: '#e5c07b', // yellow
    34: '#61afef', // blue
    35: '#c678dd', // magenta
    36: '#56b6c2', // cyan
    37: '#abb2bf', // white
    // Bright colors (90-97)
    90: '#5c6370', // bright black (gray)
    91: '#ff6b6b', // bright red
    92: '#a6e22e', // bright green
    93: '#f1fa8c', // bright yellow
    94: '#8be9fd', // bright blue
    95: '#ff79c6', // bright magenta
    96: '#66d9ef', // bright cyan
    97: '#f8f8f2', // bright white
    // Background colors (40-47)
    40: '#1a1a1a',
    41: '#e06c75',
    42: '#98c379',
    43: '#e5c07b',
    44: '#61afef',
    45: '#c678dd',
    46: '#56b6c2',
    47: '#abb2bf'
};


const TERMINAL_COLOR_SCHEMES = {
    'ansi-16': ANSI_COLORS_16,
    'ansi-256': ANSI_COLORS_16, // Same as 16 for basic colors
    'dracula': {
        30: '#21222c', 31: '#ff5555', 32: '#50fa7b', 33: '#f1fa8c',
        34: '#bd93f9', 35: '#ff79c6', 36: '#8be9fd', 37: '#f8f8f2',
        90: '#6272a4', 91: '#ff6e6e', 92: '#69ff94', 93: '#ffffa5',
        94: '#d6acff', 95: '#ff92df', 96: '#a4ffff', 97: '#ffffff',
        40: '#21222c', 41: '#ff5555', 42: '#50fa7b', 43: '#f1fa8c',
        44: '#bd93f9', 45: '#ff79c6', 46: '#8be9fd', 47: '#f8f8f2'
    },
    'monokai': {
        30: '#272822', 31: '#f92672', 32: '#a6e22e', 33: '#f4bf75',
        34: '#66d9ef', 35: '#ae81ff', 36: '#a1efe4', 37: '#f8f8f2',
        90: '#75715e', 91: '#f92672', 92: '#a6e22e', 93: '#e6db74',
        94: '#66d9ef', 95: '#ae81ff', 96: '#a1efe4', 97: '#f9f8f5',
        40: '#272822', 41: '#f92672', 42: '#a6e22e', 43: '#f4bf75',
        44: '#66d9ef', 45: '#ae81ff', 46: '#a1efe4', 47: '#f8f8f2'
    },
    'nord': {
        30: '#2e3440', 31: '#bf616a', 32: '#a3be8c', 33: '#ebcb8b',
        34: '#81a1c1', 35: '#b48ead', 36: '#88c0d0', 37: '#eceff4',
        90: '#4c566a', 91: '#bf616a', 92: '#a3be8c', 93: '#ebcb8b',
        94: '#81a1c1', 95: '#b48ead', 96: '#8fbcbb', 97: '#eceff4',
        40: '#2e3440', 41: '#bf616a', 42: '#a3be8c', 43: '#ebcb8b',
        44: '#81a1c1', 45: '#b48ead', 46: '#88c0d0', 47: '#eceff4'
    },
    'solarized': {
        30: '#073642', 31: '#dc322f', 32: '#859900', 33: '#b58900',
        34: '#268bd2', 35: '#d33682', 36: '#2aa198', 37: '#eee8d5',
        90: '#586e75', 91: '#cb4b16', 92: '#859900', 93: '#b58900',
        94: '#268bd2', 95: '#6c71c4', 96: '#2aa198', 97: '#fdf6e3',
        40: '#073642', 41: '#dc322f', 42: '#859900', 43: '#b58900',
        44: '#268bd2', 45: '#d33682', 46: '#2aa198', 47: '#eee8d5'
    }
};


const TERMINAL_MESSAGE_COLORS = {
    'ansi-16': { success: '#98c379', error: '#e06c75', warning: '#e5c07b', info: '#61afef', system: '#7a8a9a' },
    'ansi-256': { success: '#98c379', error: '#e06c75', warning: '#e5c07b', info: '#61afef', system: '#7a8a9a' },
    'dracula': { success: '#50fa7b', error: '#ff5555', warning: '#f1fa8c', info: '#bd93f9', system: '#6272a4' },
    'monokai': { success: '#a6e22e', error: '#f92672', warning: '#f4bf75', info: '#66d9ef', system: '#75715e' },
    'nord': { success: '#a3be8c', error: '#bf616a', warning: '#ebcb8b', info: '#81a1c1', system: '#4c566a' },
    'solarized': { success: '#859900', error: '#dc322f', warning: '#b58900', info: '#268bd2', system: '#586e75' }
};


function getTerminalColorScheme() {
    const scheme = App.settings?.terminal?.colorScheme || 'ansi-16';
    return TERMINAL_COLOR_SCHEMES[scheme] || ANSI_COLORS_16;
}


function parseAnsiToHtml(text) {


    const ansiRegex = /\x1b\[([0-9;]*)m/g;


    const colorScheme = App.settings?.terminal?.colorScheme || 'ansi-16';
    if (colorScheme === 'disabled') {

        return escapeHtml(text.replace(ansiRegex, ''));
    }

    let result = '';
    let lastIndex = 0;
    let currentFg = null;
    let currentBg = null;
    let isBold = false;
    let isUnderline = false;
    let match;

    while ((match = ansiRegex.exec(text)) !== null) {

        if (match.index > lastIndex) {
            const textChunk = text.slice(lastIndex, match.index);
            result += applyAnsiStyle(escapeHtml(textChunk), currentFg, currentBg, isBold, isUnderline);
        }


        const codes = match[1].split(';').map(c => parseInt(c) || 0);

        for (const code of codes) {
            if (code === 0) {
                currentFg = null;
                currentBg = null;
                isBold = false;
                isUnderline = false;
            }
            else if (code === 1) isBold = true;
            else if (code === 4) isUnderline = true;
            else if (code === 22) isBold = false;
            else if (code === 24) isUnderline = false;
            else if (code >= 30 && code <= 37) currentFg = getTerminalColorScheme()[code];
            else if (code >= 90 && code <= 97) currentFg = getTerminalColorScheme()[code];
            else if (code >= 40 && code <= 47) currentBg = getTerminalColorScheme()[code];
            else if (code === 39) { /* Default FG */ }
            else if (code === 49) { /* Default BG */ }
        }

        lastIndex = ansiRegex.lastIndex;
    }


    if (lastIndex < text.length) {
        const textChunk = text.slice(lastIndex);
        result += applyAnsiStyle(escapeHtml(textChunk), currentFg, currentBg, isBold, isUnderline);
    }

    return result;
}


function applyAnsiStyle(text, fg, bg, bold, underline) {
    if (!fg && !bg && !bold && !underline) {
        return text;
    }

    let style = '';
    if (fg) style += `color:${fg}; `;
    if (bg) style += `background:${bg}; `;
    if (bold) style += 'font-weight:bold;';
    if (underline) style += 'text-decoration:underline;';

    return `<span style="${style}">${text}</span>`;
}

function normalizeLogType(type) {
    if (!type) return '';
    if (type === 'warn') return 'warning';
    if (type === 'ok') return 'success';
    return type;
}

function log(msg, type = '') {
    const t = document.getElementById('terminal');
    const normalizedType = normalizeLogType(type);
    const l = document.createElement('pre');
    l.className = 'line' + (normalizedType ? ' ' + normalizedType : '');
    l.style.margin = '0';
    l.style.fontFamily = 'inherit';

    const colorScheme = App.settings?.terminal?.colorScheme || 'ansi-16';
    if (colorScheme !== 'disabled' && msg.includes('\x1b[')) {
        l.innerHTML = parseAnsiToHtml(msg);
    } else {
        l.textContent = msg.replace(/\x1b\[[0-9;]*m/g, '');
    }

    if (normalizedType && colorScheme !== 'disabled') {
        const messageColors = TERMINAL_MESSAGE_COLORS[colorScheme] || TERMINAL_MESSAGE_COLORS['ansi-16'];
        if (messageColors[normalizedType]) {
            l.style.color = messageColors[normalizedType];
        }
    }

    t.appendChild(l);

    // Performance: Limit terminal lines to prevent lagging
    const MAX_TERM_LINES = 1000;
    while (t.childElementCount > MAX_TERM_LINES) {
        t.removeChild(t.firstChild);
    }

    t.scrollTop = t.scrollHeight;


    if (DockingState.terminalDocked) {
        syncTerminalContent();
    }
}

function clearTerm() { document.getElementById('terminal').innerHTML = ''; }

function setRunning(v) {
    App.isRunning = v;
    document.getElementById('btn-stop').disabled = !v;
    document.getElementById('terminal-in').disabled = !v;
    document.getElementById('btn-send').disabled = !v;
    document.getElementById('btn-buildrun')?.classList.toggle('running', v);
    document.getElementById('btn-run-only')?.classList.toggle('running', v);
    document.getElementById('btn-stop')?.classList.toggle('running', v);

    const dockedTermIn = document.getElementById('docked-terminal-in');
    const dockedSendBtn = document.getElementById('docked-send-btn');
    if (dockedTermIn) dockedTermIn.disabled = !v;
    if (dockedSendBtn) dockedSendBtn.disabled = !v;

    if (v) document.getElementById('terminal-in').focus();
}

async function sendInput() {
    const inp = document.getElementById('terminal-in');
    if (inp.value && App.isRunning) {
        // Send each line separately
        const lines = inp.value.split('\n');
        for (const line of lines) {
            log(line, 'input');
            await window.electronAPI.sendInput(line);
        }
        inp.value = '';
        inp.style.height = 'auto';
    }
}

function setStatus(msg, type) {
    if (STATUS_TYPES.has(msg) && typeof type === 'string' && !STATUS_TYPES.has(type)) {
        const temp = msg;
        msg = type;
        type = temp;
    }

    const bar = document.getElementById('status-bar');
    bar.className = 'status-bar' + (type ? ' ' + type : '');
    const statusEl = document.getElementById('status');
    if (!statusEl) return;

    statusEl.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.textContent = msg;
    statusEl.append(dot, label);
}

function normalizeJudgeOutput(text) {
    if (window.electronAPI?.judgeNormalizeOutput) {
        return window.electronAPI.judgeNormalizeOutput(text);
    }

    // Fallback in case preload API is unavailable
    return String(text ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(l => l.trimEnd())
        .join('\n')
        .trim();
}

function buildInlineCharDiff(actualLine, expectedLine) {
    const actual = String(actualLine ?? '');
    const expected = String(expectedLine ?? '');

    let start = 0;
    while (start < actual.length && start < expected.length && actual[start] === expected[start]) {
        start += 1;
    }

    let endActual = actual.length - 1;
    let endExpected = expected.length - 1;
    while (endActual >= start && endExpected >= start && actual[endActual] === expected[endExpected]) {
        endActual -= 1;
        endExpected -= 1;
    }

    const actualPrefix = actual.slice(0, start);
    const expectedPrefix = expected.slice(0, start);
    const actualDiff = actual.slice(start, endActual + 1);
    const expectedDiff = expected.slice(start, endExpected + 1);
    const actualSuffix = actual.slice(endActual + 1);
    const expectedSuffix = expected.slice(endExpected + 1);

    const actualDiffHtml = actualDiff
        ? `<span class="diff-char-wrong">${escapeHtml(actualDiff)}</span>`
        : '<span class="diff-char-placeholder">∅</span>';
    const expectedDiffHtml = expectedDiff
        ? `<span class="diff-char-right">${escapeHtml(expectedDiff)}</span>`
        : '<span class="diff-char-placeholder">∅</span>';

    return {
        actualHtml: `${escapeHtml(actualPrefix)}${actualDiffHtml}${escapeHtml(actualSuffix)}`,
        expectedHtml: `${escapeHtml(expectedPrefix)}${expectedDiffHtml}${escapeHtml(expectedSuffix)}`
    };
}

function buildCompactDiffHtml(expectedRaw, actualRaw, { normalize = true } = {}) {
    const expectedText = normalize ? normalizeJudgeOutput(expectedRaw) : String(expectedRaw ?? '');
    const actualText = normalize ? normalizeJudgeOutput(actualRaw) : String(actualRaw ?? '');

    const expectedLines = expectedText.length > 0 ? expectedText.split('\n') : [];
    const actualLines = actualText.length > 0 ? actualText.split('\n') : [];

    const maxLen = Math.max(expectedLines.length, actualLines.length);
    let allMatch = true;
    let mismatchCount = 0;
    let html = '';

    for (let i = 0; i < maxLen; i++) {
        const expLine = i < expectedLines.length ? expectedLines[i] : null;
        const actLine = i < actualLines.length ? actualLines[i] : null;

        if (expLine !== null && actLine !== null && expLine === actLine) {
            html += `<div class="diff-line match-compact">${escapeHtml(expLine)}</div>`;
            continue;
        }

        allMatch = false;
        mismatchCount += 1;
        html += `<div class="diff-line mismatch-compact">`;

        if (actLine !== null && expLine !== null) {
            const { actualHtml, expectedHtml } = buildInlineCharDiff(actLine, expLine);
            html += `<span class="diff-wrong" title="Actual">${actualHtml}</span>
                     <span class="diff-arrow">→</span>
                     <span class="diff-right" title="Expected">${expectedHtml}</span>`;
        } else if (actLine !== null && expLine === null) {
            html += `<span class="diff-extra" title="Extra output">[Extra] ${escapeHtml(actLine)}</span>`;
        } else if (actLine === null && expLine !== null) {
            html += `<span class="diff-missing" title="Missing output">Missing: ${escapeHtml(expLine)}</span>`;
        }

        html += `</div>`;
    }

    return { html, allMatch, mismatchCount, expectedLines, actualLines };
}

function compareOutput() {
    const expectedRaw = document.getElementById('expected-area').value;

    const terminalEl = document.getElementById('terminal');
    const lines = Array.from(terminalEl.querySelectorAll('pre, .line'));

    // Extract output from the latest run block (not the first one),
    // so reruns don't reuse stale output from older runs.
    let currentRunLines = [];
    let latestRunLines = [];
    let capturing = false;

    for (const line of lines) {
        const text = line.textContent;

        if (text.includes('--- Running ---')) {
            capturing = true;
            currentRunLines = [];
            continue;
        }

        if (!capturing) continue;

        if (text.includes('--- Exit') || text.includes('--- Stopped')) {
            latestRunLines = currentRunLines.slice();
            capturing = false;
            continue;
        }

        if (!line.classList.contains('input') && !line.classList.contains('system') && !line.classList.contains('info')) {
            currentRunLines.push(text);
        }
    }

    // If process hasn't emitted exit yet, use currently capturing block.
    const actualText = (capturing ? currentRunLines : latestRunLines).join('\n');

    const diffDisplay = document.getElementById('expected-diff');
    const textarea = document.getElementById('expected-area');
    const dockedDiffDisplay = document.getElementById('docked-expected-diff');
    const dockedTextarea = document.getElementById('docked-expected');

    const expectedNorm = normalizeJudgeOutput(expectedRaw);
    const hasExpected = expectedNorm.length > 0;

    // Empty expected = run-only mode (do not mark WA/AC automatically)
    // Keep EXPECTED strictly as editable expected output (no auto output rendering).
    if (!hasExpected) {
        switchToExpectedEdit();
        return;
    }

    const diff = buildCompactDiffHtml(expectedRaw, actualText, { normalize: true });

    if (diffDisplay && textarea) {
        diffDisplay.innerHTML = diff.html;
        diffDisplay.style.display = 'block';
        textarea.style.display = 'none';
    }

    if (window.FileExplorer) {
        const judgeTab = App.tabs.find(t => t.id === (App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId));
        if (judgeTab && judgeTab.path) {
            window.FileExplorer.notifyBuildEvent(judgeTab.path, diff.allMatch ? 'judge-ac' : 'judge-wa');
        }
    }

    if (dockedDiffDisplay && dockedTextarea) {
        dockedDiffDisplay.innerHTML = diff.html;
        dockedDiffDisplay.style.display = 'block';
        dockedTextarea.style.display = 'none';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function switchToExpectedEdit() {
    const textarea = document.getElementById('expected-area');
    const diffDisplay = document.getElementById('expected-diff');

    if (textarea && diffDisplay) {
        textarea.style.display = 'block';
        diffDisplay.style.display = 'none';
        textarea.focus();
    }

    // Also switch Docked View
    const dockedTextarea = document.getElementById('docked-expected');
    const dockedDiffDisplay = document.getElementById('docked-expected-diff');

    if (dockedTextarea && dockedDiffDisplay) {
        dockedTextarea.style.display = 'block';
        dockedDiffDisplay.style.display = 'none';
        // If docked panel is visible, focus it
        if (document.getElementById('problems-panel')?.style.display !== 'none' &&
            DockingState.ioDocked) {
            dockedTextarea.focus();
        }
    }
}

// ============================================================================
// IPC HANDLERS
// ============================================================================
if (window.electronAPI) {
    window.electronAPI.onFileOpened?.(data => {
        const exists = App.tabs.find(t => t.path === data.path);
        if (exists) setActive(exists.id);
        else {

            const id = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            App.tabs.push({ id, name: data.path.split(/[/\\]/).pop(), path: data.path, untitledHistoryKey: null, content: data.content, original: data.content, modified: false });
            setActive(id);
            updateUI();

            startFileWatch(data.path);
        }
        log(`Opened: ${data.path}`, 'system');
    });

    window.electronAPI.onProcessStarted?.(() => setRunning(true));
    window.electronAPI.onProcessExternalStarted?.(() => {
        log('External CMD launched — running...', 'info');
        setStatus('External run...', 'running');
        setRunning(false); // Not tracking external process
    });
    window.electronAPI.onProcessExternalExit?.(data => {
        const execTime = data?.executionTime;
        const peakMemKB = data?.peakMemoryKB;

        let timeStr = '';
        if (execTime !== null && execTime !== undefined) {
            if (execTime >= 1000) {
                timeStr = (execTime / 1000).toFixed(2) + 's';
            } else {
                timeStr = execTime + 'ms';
            }
        }

        let memStr = '';
        if (peakMemKB && peakMemKB > 0) {
            if (peakMemKB >= 1024) {
                memStr = (peakMemKB / 1024).toFixed(1) + 'MB';
            } else {
                memStr = peakMemKB + 'KB';
            }
        }

        if (timeStr || memStr) {
            const parts = [];
            if (timeStr) parts.push('Time: ' + timeStr);
            if (memStr) parts.push('Memory: ' + memStr);
            log(`External process finished - ${parts.join(' | ')}`, 'system');
            setStatus(parts.join(' | '), 'success');
        } else {
            log('External process finished', 'system');
            setStatus('Done', 'success');
        }
    });
    window.electronAPI.onProcessOutput?.(d => log(d));
    window.electronAPI.onProcessError?.(d => log(d, 'error'));
    window.electronAPI.onProcessExit?.(data => {
        if (App.runTimeout) {
            clearTimeout(App.runTimeout);
            App.runTimeout = null;
        }

        const code = typeof data === 'object' ? data.code : data;
        const execTime = typeof data === 'object' ? data.executionTime : null;
        const peakMemKB = typeof data === 'object' ? data.peakMemoryKB : null;


        let timeStr = '';
        if (execTime !== null) {
            if (execTime >= 1000) {
                timeStr = (execTime / 1000).toFixed(2) + 's';
            } else {
                timeStr = execTime + 'ms';
            }
        }


        let memStr = '';
        if (peakMemKB && peakMemKB > 0) {
            if (peakMemKB >= 1024) {
                memStr = (peakMemKB / 1024).toFixed(1) + 'MB';
            } else {
                memStr = peakMemKB + 'KB';
            }
        }


        // --- Exit: 0 ---
        // Time: 757ms | Memory: 2.4MB
        log(`\n--- Exit: ${code} ---`, code === 0 ? 'success' : 'warning');


        if (timeStr || memStr) {
            const parts = [];
            if (timeStr) parts.push('Time: ' + timeStr);
            if (memStr) parts.push('Memory: ' + memStr);
            log(parts.join(' | '), 'info');
        }

        setRunning(false);

        // Refresh diff for the latest run if expected panel is present.
        if (document.getElementById('expected-area')) {
            compareOutput();
        }

        const statusParts = [];
        if (timeStr) statusParts.push(timeStr);
        if (memStr) statusParts.push(memStr);
        setStatus(code === 0 ? (statusParts.join(' | ') || 'Done') : `Exit: ${code}`, code === 0 ? 'success' : '');
        if (code === 0) setTimeout(compareOutput, 100);

        // Notify explorer: run finished
        const _exitTab = App.tabs.find(t => t.id === (App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId));
        if (window.FileExplorer && _exitTab) window.FileExplorer.notifyBuildEvent(_exitTab.path, code === 0 ? 'run-exit-0' : 'run-exit-fail');
    });
    window.electronAPI.onProcessStopped?.(() => {
        if (App.runTimeout) {
            clearTimeout(App.runTimeout);
            App.runTimeout = null;
        }
        log('\n--- Stopped ---', 'warning');
        setRunning(false);
        setStatus('Stopped', '');
    });

    window.electronAPI.onSystemMessage?.(data => {
        log(data.message, data.type || 'system');
    });
}

// ============================================================================
// COMPETITIVE COMPANION
// ============================================================================
let ccConnected = false;
let ccProblem = null;
let ccTestIndex = 0;
let ccHasReceivedProblem = false;

function initCompetitiveCompanion() {
    const btn = document.getElementById('btn-cc');
    if (!btn) return;


    ccHasReceivedProblem = App.settings?.oj?.verified || false;


    startCCServer(true);


    btn.onclick = () => {
        showCCPopup();
    };


    document.getElementById('btn-prev-test')?.addEventListener('click', prevTestCase);
    document.getElementById('btn-next-test')?.addEventListener('click', nextTestCase);
    document.getElementById('btn-add-test')?.addEventListener('click', addTestCase);
    document.getElementById('btn-delete-test')?.addEventListener('click', deleteTestCase);

    // Bind panel add button
    document.getElementById('btn-add-test-panel')?.addEventListener('click', () => {
        addTestCase();
        // If docked, switch to IO tab to edit
        if (DockingState.ioDocked) {
            switchDockedPanel('io');
        } else {
            // If floating, ensure visible
            if (!App.showIO) toggleIO();
        }
    });

    // Save changes to current test case
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');

    const saveCurrentTest = () => {
        if (ccProblem && ccProblem.tests && ccProblem.tests[ccTestIndex]) {
            ccProblem.tests[ccTestIndex].input = inputArea.value;
            ccProblem.tests[ccTestIndex].output = expectedArea.value;
        }
    };

    inputArea?.addEventListener('input', saveCurrentTest);
    expectedArea?.addEventListener('input', saveCurrentTest);


    document.getElementById('cc-close')?.addEventListener('click', hideCCPopup);
    document.getElementById('cc-cancel')?.addEventListener('click', hideCCPopup);
    document.getElementById('cc-install')?.addEventListener('click', () => {
        window.electronAPI?.ccOpenExtensionPage?.();
        hideCCPopup();
    });


    document.getElementById('cc-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'cc-overlay') hideCCPopup();
    });


    window.electronAPI?.onProblemReceived?.(handleProblemReceived);
}

function addTestCase() {
    if (!ccProblem) {
        ccProblem = { name: 'Manual Problem', tests: [] };
    }
    if (!ccProblem.tests) ccProblem.tests = [];

    // Save current before adding
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    if (ccProblem.tests.length > 0 && ccProblem.tests[ccTestIndex]) {
        ccProblem.tests[ccTestIndex].input = inputArea.value;
        ccProblem.tests[ccTestIndex].output = expectedArea.value;
    } else if (ccProblem.tests.length === 0 && (inputArea.value || expectedArea.value)) {
        // If there were no tests but we had content, treat current content as Test 1
        ccProblem.tests.push({
            input: inputArea.value,
            output: expectedArea.value
        });
    }

    ccProblem.tests.push({ input: '', output: '' });
    ccTestIndex = ccProblem.tests.length - 1;
    switchTestCase(ccTestIndex);
    updateTestNavUI();
    renderTestResults(); // Refresh list
    log(`Test Case ${ccTestIndex + 1} added`, 'info');
}

function showConfirmPopup(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
        <div class="confirm-popup">
            <div class="confirm-message">${message}</div>
            <div class="confirm-buttons">
                <button class="confirm-btn cancel">Hủy</button>
                <button class="confirm-btn confirm">Xác nhận</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = () => {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('.confirm-btn.cancel').onclick = close;
    overlay.querySelector('.confirm-btn.confirm').onclick = () => {
        close();
        onConfirm();
    };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
}

async function deleteTestCase() {
    if (!ccProblem || !ccProblem.tests || ccProblem.tests.length === 0) return;

    const confirmed = await showConfirmDialog({
        title: 'Delete Test Case',
        message: `Delete Test Case ${ccTestIndex + 1}?`,
        confirmText: 'Delete',
        danger: true
    });
    if (!confirmed) return;

    ccProblem.tests.splice(ccTestIndex, 1);

    if (ccProblem.tests.length === 0) {
        document.getElementById('input-area').value = '';
        document.getElementById('expected-area').value = '';
        const dockedInput = document.getElementById('docked-input');
        const dockedExpected = document.getElementById('docked-expected');
        if (dockedInput) dockedInput.value = '';
        if (dockedExpected) dockedExpected.value = '';
        ccTestIndex = 0;
    } else {
        ccTestIndex = Math.max(0, ccTestIndex - 1);
        switchTestCase(ccTestIndex);
    }
    updateTestNavUI();
    renderTestResults();

    setTimeout(() => {
        if (App.editor) App.editor.focus();
    }, 50);
}

async function deleteTestCaseByIndex(index) {
    if (!ccProblem || !ccProblem.tests || index < 0 || index >= ccProblem.tests.length) return;

    const confirmed = await showConfirmDialog({
        title: 'Delete Test Case',
        message: `Delete Test Case ${index + 1}?`,
        confirmText: 'Delete',
        danger: true
    });
    if (!confirmed) return;

    ccProblem.tests.splice(index, 1);

    if (ccProblem.tests.length === 0) {
        document.getElementById('input-area').value = '';
        document.getElementById('expected-area').value = '';
        const dockedInput = document.getElementById('docked-input');
        const dockedExpected = document.getElementById('docked-expected');
        if (dockedInput) dockedInput.value = '';
        if (dockedExpected) dockedExpected.value = '';
        ccTestIndex = 0;
    } else {
        if (ccTestIndex >= ccProblem.tests.length) {
            ccTestIndex = ccProblem.tests.length - 1;
        }
        switchTestCase(ccTestIndex);
    }
    updateTestNavUI();
    renderTestResults();

    setTimeout(() => {
        if (App.editor) App.editor.focus();
    }, 50);
}

async function deleteAllTestCases() {
    if (!ccProblem || !ccProblem.tests || ccProblem.tests.length === 0) return;

    const confirmed = await showConfirmDialog({
        title: 'Delete All Test Cases',
        message: `Delete all ${ccProblem.tests.length} test cases? This action cannot be undone.`,
        confirmText: 'Delete All',
        danger: true
    });
    if (!confirmed) return;

    ccProblem.tests = [];
    ccTestIndex = 0;

    document.getElementById('input-area').value = '';
    document.getElementById('expected-area').value = '';
    const dockedInput = document.getElementById('docked-input');
    const dockedExpected = document.getElementById('docked-expected');
    if (dockedInput) dockedInput.value = '';
    if (dockedExpected) dockedExpected.value = '';

    batchTestResults = [];
    updateTestNavUI();
    renderTestResults();

    setTimeout(() => {
        if (App.editor) App.editor.focus();
    }, 50);

    log('All test cases deleted', 'info');
}

function showCCPopup() {
    document.getElementById('cc-overlay')?.classList.add('show');
    document.getElementById('btn-cc')?.classList.add('active');
}

function hideCCPopup() {
    document.getElementById('cc-overlay')?.classList.remove('show');
    document.getElementById('btn-cc')?.classList.remove('active');
}

async function startCCServer(silent = false) {
    const btn = document.getElementById('btn-cc');
    if (!btn || !window.electronAPI?.ccStartServer) return;

    try {
        const result = await window.electronAPI.ccStartServer();

        if (result?.success) {
            ccConnected = true;
            btn.title = 'Get test cases from Online Judge';

            if (!silent) {
                log('OJ: Ready to receive test cases', 'success');


                if (!ccHasReceivedProblem) {
                    log('    Install extension: Chrome Web Store > "Competitive Companion"', 'info');
                    log('    Then go to VNOI/Codeforces and click the extension icon', 'info');
                }
            }
        } else if (!silent) {
            ccConnected = false;
            log('OJ: Unable to start (port 27121 is already in use)', 'warning');
        }
    } catch (e) {
        console.error('CC Server error:', e);
    }
}

function handleProblemReceived(problem) {
    console.log('Received problem:', problem);


    if (!ccHasReceivedProblem) {
        ccHasReceivedProblem = true;
        if (!App.settings.oj) App.settings.oj = {};
        App.settings.oj.verified = true;
        saveSettings();
    }


    ccProblem = problem;
    ccTestIndex = 0;


    const removeVietnameseDiacritics = (str) => {
        return str
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D');
    };

    const safeName = removeVietnameseDiacritics(problem.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 50);
    const fileName = safeName + '.cpp';


    const id = 'tab_' + Date.now();
    const template = App.settings.template?.code || DEFAULT_CODE;

    App.tabs.push({
        id,
        name: fileName,
        path: null,
        untitledHistoryKey: createUntitledHistoryKey(),
        content: template,
        original: '',
        modified: true
    });


    App.activeTabId = id;


    if (App.editor && App.ready) {
        App.isSettingValue = true;
        App.editor.setValue(template);
        App.isSettingValue = false;
    }

    renderTabs();
    updateUI();


    const testCount = problem.tests?.length || 0;
    if (testCount > 0) {
        const inputArea = document.getElementById('input-area');
        const expectedArea = document.getElementById('expected-area');

        if (inputArea) inputArea.value = problem.tests[0].input || '';
        if (expectedArea) expectedArea.value = problem.tests[0].output || '';
    }


    updateTestNavUI();
    renderTestResults(); // Initialize list


    if (!App.showIO) toggleIO();


    const timeLimit = problem.timeLimit ? `${problem.timeLimit}ms` : '-';
    const memLimit = problem.memoryLimit ? `${problem.memoryLimit}MB` : '-';

    log(`[OJ] ${problem.name}`, 'success');
    log(`     ${testCount} test | ${timeLimit} | ${memLimit}`, 'info');

    // Update status
    setStatus(`${problem.name}`, 'success');


    const btn = document.getElementById('btn-cc');
    if (btn) {
        btn.classList.add('cc-flash');
        setTimeout(() => btn.classList.remove('cc-flash'), 1000);
    }


    setTimeout(() => {
        if (App.editor) {
            App.editor.focus();
            App.editor.layout();
        }
    }, 100);
}

// Update test navigation UI
function updateTestNavUI() {
    const testNav = document.getElementById('test-nav');
    const testLabel = document.getElementById('test-nav-label');
    const runAllBtn = document.getElementById('btn-run-all-tests');
    const deleteBtn = document.getElementById('btn-delete-test');
    const deleteAllBtn = document.getElementById('btn-delete-all-tests');

    const testCount = ccProblem?.tests?.length || 0;

    // Show/hide Run All button in header
    if (runAllBtn) {
        runAllBtn.style.display = testCount > 0 ? 'flex' : 'none';
    }

    // Show/hide Delete All button in TESTS header
    if (deleteAllBtn) {
        deleteAllBtn.style.display = testCount > 0 ? 'flex' : 'none';
    }

    // Show/hide Panel Add button
    const panelAddBtn = document.getElementById('btn-add-test-panel');
    if (panelAddBtn) {
        // Always show Add button to allow manual test creation
        panelAddBtn.style.display = 'flex';
    }

    if (!testNav || !testLabel) return;

    // Always show nav if we have any tests, OR if we want to allow adding
    // Showing it always (except completely empty startup) allows adding
    const hasTests = testCount > 0;

    // But we need to allow adding manual tests even if none exist yet.
    // So we should check if I/O panel is open or file is open?
    // Let's just default to showing it if I/O is active? 
    // Actually, simply: If there are tests, show navigation. If not, show "Add" button only?
    // For simplicity, let's keep it visible but maybe simplified if 0 tests.

    if (hasTests) {
        testNav.style.display = 'flex';
        testLabel.textContent = `${ccTestIndex + 1}/${testCount}`;
        if (deleteBtn) deleteBtn.style.display = 'flex';
    } else {
        // Show only the "Add" button area?
        // For now, let's show it so user can click Add.
        testNav.style.display = 'flex';
        testLabel.textContent = '0/0';
        // Hide nav arrows if 0
        document.getElementById('btn-prev-test').style.display = 'none';
        document.getElementById('btn-next-test').style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
        return;
    }

    document.getElementById('btn-prev-test').style.display = 'flex';
    document.getElementById('btn-next-test').style.display = 'flex';

    // Also update docked test nav
    updateDockedTestNavUI();
}


function switchTestCase(index) {
    if (!ccProblem || !ccProblem.tests || index < 0 || index >= ccProblem.tests.length) return;

    ccTestIndex = index;
    const test = ccProblem.tests[index];

    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');

    if (inputArea) inputArea.value = test.input || '';
    if (expectedArea) expectedArea.value = test.output || '';


    // Also sync docked views
    const dockedInput = document.getElementById('docked-input');
    const dockedExpected = document.getElementById('docked-expected');
    if (dockedInput) dockedInput.value = inputArea.value;
    if (dockedExpected) dockedExpected.value = expectedArea.value;

    updateTestNavUI();
    updateDockedTestNavUI();

    // Show diff if we have batch test result for this test
    const result = batchTestResults?.find(r => r.testIndex === index);
    const actualOutput = result?.actualOutput ?? result?.output;
    if (result && actualOutput !== undefined) {
        showTestResultDiff(test.output || '', actualOutput);
    } else {
        // Reset to edit mode if no result
        switchToExpectedEdit();
    }
}

function showTestResultDiff(expectedText, actualText) {
    const diffDisplay = document.getElementById('expected-diff');
    const textarea = document.getElementById('expected-area');
    const dockedDiffDisplay = document.getElementById('docked-expected-diff');
    const dockedTextarea = document.getElementById('docked-expected');

    if (!String(expectedText || '').trim() && !String(actualText || '').trim()) {
        switchToExpectedEdit();
        return;
    }

    const diff = buildCompactDiffHtml(expectedText, actualText, { normalize: true });

    if (diffDisplay && textarea) {
        diffDisplay.innerHTML = diff.html;
        diffDisplay.style.display = 'block';
        textarea.style.display = 'none';
    }

    if (dockedDiffDisplay && dockedTextarea) {
        dockedDiffDisplay.innerHTML = diff.html;
        dockedDiffDisplay.style.display = 'block';
        dockedTextarea.style.display = 'none';
    }
}

function nextTestCase() {
    if (ccProblem && ccProblem.tests && ccProblem.tests.length > 0) {
        switchTestCase((ccTestIndex + 1) % ccProblem.tests.length);
    }
}

function prevTestCase() {
    if (ccProblem && ccProblem.tests && ccProblem.tests.length > 0) {
        switchTestCase((ccTestIndex - 1 + ccProblem.tests.length) % ccProblem.tests.length);
    }
}

// ============================================================================
// FILE WATCHER - Detect external changes
// ============================================================================
let pendingReloadNotifications = new Set(); // Track which files have pending notifications


function startFileWatch(filePath) {
    if (!filePath || !window.electronAPI?.watchFile) return;
    window.electronAPI.watchFile(filePath);
}


function stopFileWatch(filePath) {
    if (!filePath || !window.electronAPI?.unwatchFile) return;
    window.electronAPI.unwatchFile(filePath);
}

// Handle external file change notification
function handleExternalFileChange(filePath) {

    if (pendingReloadNotifications.has(filePath)) return;


    const tab = App.tabs.find(t => t.path === filePath);
    if (!tab) return;

    pendingReloadNotifications.add(filePath);


    showReloadNotification(tab);
}

// Show reload notification popup (similar to Dev-C++)
function showReloadNotification(tab) {

    const existingNotif = document.querySelector(`.reload-notification[data-path="${CSS.escape(tab.path)}"]`);
    if (existingNotif) existingNotif.remove();

    const notification = document.createElement('div');
    notification.className = 'reload-notification';
    notification.dataset.path = tab.path;

    notification.innerHTML = `
                <div class="reload-notification-content">
                    <div class="reload-notification-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
                    <div class="reload-notification-text">
                        <div class="reload-notification-title">File đã thay đổi</div>
                        <div class="reload-notification-file">${tab.name}</div>
                        <div class="reload-notification-desc">File has been changed externally. Do you want to reload?</div>
                    </div>
                    <div class="reload-notification-actions">
                        <button class="reload-btn reload-btn-yes" title="Reload from disk">Reload</button>
                        <button class="reload-btn reload-btn-no" title="Keep current">Ignore</button>
                    </div>
                </div>
                `;


    notification.querySelector('.reload-btn-yes').onclick = async () => {
        const result = await window.electronAPI?.reloadFile?.(tab.path);
        if (result?.success) {
            tab.content = result.content;
            tab.original = result.content;
            tab.modified = false;


            if (tab.id === App.activeTabId && App.editor) {
                const position = App.editor.getPosition();
                App.editor.setValue(result.content);
                if (position) App.editor.setPosition(position);
            }
            if (tab.id === App.splitTabId && App.editor2) {
                const position = App.editor2.getPosition();
                App.editor2.setValue(result.content);
                if (position) App.editor2.setPosition(position);
            }

            renderTabs();
            log(`Reloaded: ${tab.name}`, 'system');
        }
        pendingReloadNotifications.delete(tab.path);
        notification.remove();
    };


    notification.querySelector('.reload-btn-no').onclick = () => {
        pendingReloadNotifications.delete(tab.path);
        notification.remove();
        log(`Kept local version: ${tab.name}`, 'system');
    };

    document.body.appendChild(notification);


    setTimeout(() => {
        if (document.body.contains(notification)) {
            pendingReloadNotifications.delete(tab.path);
            notification.remove();
        }
    }, 30000);
}

// Initialize file watcher listener
if (window.electronAPI?.onFileChangedExternal) {
    window.electronAPI.onFileChangedExternal(data => {
        handleExternalFileChange(data.path);
    });
}

// ============================================================================
// BATCH TESTING - Run All Test Cases
// ============================================================================
let batchTestResults = [];
let isBatchTesting = false;

function initBatchTesting() {
    const runAllBtn = document.getElementById('btn-run-all-tests');
    if (runAllBtn) {
        runAllBtn.addEventListener('click', runAllTests);
    }

    const deleteAllBtn = document.getElementById('btn-delete-all-tests');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', deleteAllTestCases);
    }

    const problemsPanel = document.getElementById('problems-panel');
    if (problemsPanel) {
        problemsPanel.querySelectorAll('.panel-title[data-panel]').forEach(tab => {
            tab.addEventListener('click', () => switchProblemsTab(tab.dataset.panel));
        });
    }
}

async function runAllTests() {
    if (!ccProblem || !ccProblem.tests || ccProblem.tests.length === 0) {
        log('No test cases to run. Get test cases from OJ first!', 'warning');
        return;
    }

    if (isBatchTesting) {
        log('Tests are already running...', 'warning');
        return;
    }

    const runAllBtn = document.getElementById('btn-run-all-tests');
    if (runAllBtn) {
        runAllBtn.classList.add('running');
    }

    isBatchTesting = true;
    batchTestResults = [];

    // Ensure Problems panel is visible to show results
    if (!App.showProblems) {
        App.showProblems = true;
        updateUI();
        await new Promise(r => setTimeout(r, 50));
    }

    // Ensure Terminal is visible for logs
    if (!App.showTerm && !DockingState.terminalDocked) {
        App.showTerm = true;
        updateUI();
    }

    // Switch to Tests tab if available
    const problemsPanel = document.getElementById('problems-panel');
    const testsTab = problemsPanel?.querySelector('.panel-title[data-panel="tests"]');
    if (testsTab && !testsTab.classList.contains('active')) {
        testsTab.click();
    }

    log('=== Run All Tests ===', 'system');
    setStatus('Compiling...', '');

    try {
        const tab = App.tabs.find(t => t.id === App.activeTabId);
        if (!tab) {
            log('No file is currently open!', 'error');
            return;
        }

        const content = App.editor ? App.editor.getValue() : tab.content;
        const compileFlags = buildCompileFlags();

        const compileResult = await window.electronAPI.compile({
            filePath: tab.path,
            content: content,
            flags: compileFlags,
            singleFileMode: App.settings.compiler.singleFileMode !== false
        });

        if (!compileResult.success) {
            log('Compile Error!', 'error');
            log(compileResult.error, 'error');
            setStatus('Compile Error', 'error');
            return;
        }

        App.exePath = compileResult.outputPath;
        log(`Compiled in ${compileResult.time}ms`, 'success');


        const timeLimit = ccProblem.timeLimit || (App.settings.execution.timeLimitSeconds * 1000) || 3000;


        const totalTests = ccProblem.tests.length;
        let passedCount = 0;

        const lastSlash = tab.path ? Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\')) : -1;
        const sourceDir = lastSlash !== -1 ? tab.path.substring(0, lastSlash) : null;

        // Warm-up run (not counted) to reduce first-test cold-start skew on Windows.
        // This improves consistency of displayed timings between test cases.
        if (totalTests > 0) {
            try {
                setStatus('Warming up...', '');
                const warmupTest = ccProblem.tests[0] || { input: '' };
                await window.electronAPI.runTest({
                    exePath: App.exePath,
                    input: warmupTest.input || '',
                    expectedOutput: null,
                    timeLimit: timeLimit,
                    cwd: sourceDir
                });
            } catch (_) {
                // Ignore warm-up failures and continue with actual judged runs.
            }
        }

        for (let i = 0; i < totalTests; i++) {
            const test = ccProblem.tests[i];
            setStatus(`Testing ${i + 1}/${totalTests}...`, '');

            const result = await window.electronAPI.runTest({
                exePath: App.exePath,
                input: test.input || '',
                expectedOutput: test.output || '',
                timeLimit: timeLimit,
                cwd: sourceDir,
                debug: true,
                testMeta: { index: i, name: `Test ${i + 1}` }
            });

            result.testIndex = i;
            result.testName = `Test ${i + 1}`;
            result.actualOutput = result.output ?? '';
            batchTestResults.push(result);

            if (result.status === 'AC') {
                passedCount++;
                log(`  Test ${i + 1}: AC (${result.executionTime}ms)`, 'success');
            } else {
                log(`  Test ${i + 1}: ${result.status} (${result.executionTime}ms)`,
                    result.status === 'WA' ? 'error' : 'warning');

                if (result.debug) {
                    const dbg = result.debug;
                    const dbgLine = [
                        `pid=${dbg.pid ?? 'n/a'}`,
                        `exit=${dbg.exitCode ?? 'n/a'}`,
                        `signal=${dbg.signal ?? 'none'}`,
                        `timeout=${dbg.timeoutKilled ? 'yes' : 'no'}`,
                        `in#${dbg.inputHash || 'n/a'}`,
                        `exp#${dbg.expectedNormHash || dbg.expectedHash || 'n/a'}`,
                        `act#${dbg.actualNormHash || dbg.actualHash || 'n/a'}`,
                    ].join(' | ');
                    log(`    debug: ${dbgLine}`, 'info');
                }
            }
        }


        const allPassed = passedCount === totalTests;
        log(`\n=== ${passedCount}/${totalTests} AC ===`, allPassed ? 'success' : 'warning');
        setStatus(`${passedCount}/${totalTests} AC`, allPassed ? 'success' : '');

        // Update UI
        renderTestResults();
        if (typeof showTestsTab === 'function') showTestsTab();

    } catch (e) {
        log(`Error running tests: ${e.message}`, 'error');
        setStatus('Test Error', 'error');
    } finally {
        isBatchTesting = false;
        runAllBtn?.classList.remove('running');
    }
}

async function runSingleTestByIndex(testIndex) {
    if (!ccProblem || !ccProblem.tests || !ccProblem.tests[testIndex]) {
        log('Test case không tồn tại.', 'warning');
        return;
    }

    if (isBatchTesting) {
        log('Đang chạy batch test, vui lòng đợi xong.', 'warning');
        return;
    }

    const test = ccProblem.tests[testIndex];
    const tab = App.tabs.find(t => t.id === App.activeTabId);
    if (!tab) {
        log('No file is currently open!', 'error');
        return;
    }

    const runBtn = document.querySelector(`.test-run-btn[data-run-index="${testIndex}"]`);
    if (runBtn) runBtn.classList.add('running');

    try {
        setStatus(`Single test ${testIndex + 1}: compiling...`, '');

        const content = App.editor ? App.editor.getValue() : tab.content;
        const compileFlags = buildCompileFlags();
        const compileResult = await window.electronAPI.compile({
            filePath: tab.path,
            content: content,
            flags: compileFlags,
            singleFileMode: App.settings.compiler.singleFileMode !== false
        });

        if (!compileResult.success) {
            log('Compile Error!', 'error');
            log(compileResult.error, 'error');
            setStatus('Compile Error', 'error');
            return;
        }

        App.exePath = compileResult.outputPath;
        const timeLimit = ccProblem.timeLimit || (App.settings.execution.timeLimitSeconds * 1000) || 3000;
        const lastSlash = tab.path ? Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\')) : -1;
        const sourceDir = lastSlash !== -1 ? tab.path.substring(0, lastSlash) : null;

        setStatus(`Running test ${testIndex + 1}...`, '');
        const result = await window.electronAPI.runTest({
            exePath: App.exePath,
            input: test.input || '',
            expectedOutput: test.output || '',
            timeLimit: timeLimit,
            cwd: sourceDir,
            debug: true,
            testMeta: { index: testIndex, name: `Test ${testIndex + 1}` }
        });

        result.testIndex = testIndex;
        result.testName = `Test ${testIndex + 1}`;
        result.actualOutput = result.output ?? '';

        const existingIdx = batchTestResults.findIndex(r => r.testIndex === testIndex);
        if (existingIdx >= 0) batchTestResults.splice(existingIdx, 1, result);
        else batchTestResults.push(result);

        renderTestResults();
        switchTestCase(testIndex);

        const timeStr = result.executionTime >= 1000
            ? (result.executionTime / 1000).toFixed(2) + 's'
            : result.executionTime + 'ms';

        if (result.status === 'AC') {
            log(`Single Test ${testIndex + 1}: AC (${timeStr})`, 'success');
            setStatus(`Test ${testIndex + 1}: AC`, 'success');
        } else {
            log(`Single Test ${testIndex + 1}: ${result.status} (${timeStr})`, result.status === 'WA' ? 'error' : 'warning');
            setStatus(`Test ${testIndex + 1}: ${result.status}`, 'warning');
        }
    } catch (e) {
        log(`Single test error: ${e.message}`, 'error');
        setStatus('Single Test Error', 'error');
    } finally {
        if (runBtn) runBtn.classList.remove('running');
    }
}

function renderTestResults() {
    const container = document.getElementById('tests-results-list');
    const countEl = document.getElementById('test-results-count');
    const problemsPanel = document.getElementById('problems-panel');

    if (!container) return;

    // Use ccProblem.tests as base if available, otherwise fall back to batch results
    const tests = ccProblem && ccProblem.tests ? ccProblem.tests : [];
    const results = batchTestResults || [];
    const total = tests.length;

    // Calculate passed from results that match existing tests
    // Note: batchTestResults might be cleared or partial.
    const passed = results.filter(r => r.status === 'AC').length;
    const executed = results.length;


    if (countEl) {
        // Show Passed/Total if run, or just Total count if not
        if (executed > 0) {
            countEl.textContent = `${passed}/${total}`;
        } else {
            countEl.textContent = `${total} tests`;
        }
        countEl.style.display = total > 0 ? 'inline' : 'none';
    }

    // Auto-expand panel when we have test cases (like docked terminal)
    if (problemsPanel) {
        if (total > 0) {
            problemsPanel.classList.add('has-tests');
        } else {
            problemsPanel.classList.remove('has-tests');
        }
    }


    let html = '';

    // Summary if run
    if (executed > 0) {
        const allPassed = passed === total && total > 0;
        html += `
                <div class="test-results-summary">
                    <span class="test-summary-stat passed">✓ ${passed} passed</span>
                    <span class="test-summary-stat failed">✗ ${executed - passed} failed</span>
                    <span class="test-summary-stat total">${results.reduce((s, r) => s + (r.executionTime || 0), 0)}ms total</span>
                </div>
                `;
    }

    // List Tests
    tests.forEach((test, idx) => {
        // Find result for this test index
        const result = results.find(r => r.testIndex === idx);

        let status = 'PENDING';
        let timeStr = '';
        let details = '';
        let statusClass = 'pending';

        if (result) {
            status = result.status;
            statusClass = result.status;
            timeStr = result.executionTime >= 1000
                ? (result.executionTime / 1000).toFixed(2) + 's'
                : result.executionTime + 'ms';
            details = result.details || '';
        } else {
            // Format sample inputs for display if no result
            const inputPreview = (test.input || '').replace(/\n/g, ' ').substring(0, 20);
            details = inputPreview ? `In: ${inputPreview}...` : 'Empty input';
        }

        const isAC = result && result.status === 'AC';
        const itemClass = isAC ? 'test-result-item item-ac' : 'test-result-item';

        html += `
                <div class="${itemClass}" data-index="${idx}">
                    <span class="test-result-status ${statusClass}">${status}</span>
                    <div class="test-result-info">
                        <span class="test-result-title">Test Case ${idx + 1}</span>
                        <span class="test-result-details">${details}</span>
                    </div>
                    <span class="test-result-time">${timeStr}</span>
                    <button class="test-run-btn" data-run-index="${idx}" title="Run test case này">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="8 5 19 12 8 19 8 5"></polygon>
                        </svg>
                    </button>
                    <button class="test-delete-btn" data-delete-index="${idx}" title="Xóa test case này">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
                `;
    });

    // Add "Add Test" button
    html += `
            <div class="test-result-add-btn" id="btn-list-add-test">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Thêm Test Case Mới
            </div>
        `;

    container.innerHTML = html;


    container.querySelectorAll('.test-result-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.test-delete-btn')) return;
            const idx = parseInt(item.dataset.index);
            if (ccProblem && ccProblem.tests[idx]) {
                switchTestCase(idx);
                if (DockingState.ioDocked) {
                    switchDockedPanel('io');
                } else {
                    if (!App.showIO) toggleIO();
                }
            }
        });
    });

    container.querySelectorAll('.test-run-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.runIndex);
            await runSingleTestByIndex(idx);
        });
    });

    container.querySelectorAll('.test-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.deleteIndex);
            deleteTestCaseByIndex(idx);
        });
    });

    const addBtn = container.querySelector('#btn-list-add-test');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            addTestCase();
            // Switch to IO
            if (DockingState.ioDocked) {
                switchDockedPanel('io');
            } else {
                if (!App.showIO) toggleIO();
            }
        });
    }
}

function switchProblemsTab(tabName) {
    if (typeof switchDockedPanel === 'function') {
        switchDockedPanel(tabName);
    }

    // Explicitly render tests if switching to tests tab
    if (tabName === 'tests') {
        // Initialize manual problem if none exists
        if (!ccProblem) {
            ccProblem = { name: 'Manual Problem', tests: [] };
        }
        renderTestResults();
    }
}

function showTestsTab() {
    if (!App.showProblems) {
        App.showProblems = true;
        updateUI();
    }

    switchProblemsTab('tests');
}

function buildCompileFlags() {
    const flags = [];
    if (App.settings.compiler.cppStandard) {
        flags.push(`-std=${App.settings.compiler.cppStandard}`);
    }

    const fastDebugMode = App.settings.compiler.fastDebugMode !== false;
    const hasUserOptimization = !!App.settings.compiler.optimization;

    if (hasUserOptimization) {
        flags.push(App.settings.compiler.optimization);
    } else if (fastDebugMode) {
        flags.push('-O0', '-g0');
    }

    if (App.settings.compiler.warnings) {
        flags.push('-Wall', '-Wextra');
    }

    if (fastDebugMode) {
        if (App.settings.compiler.disableExceptions) flags.push('-fno-exceptions');
        if (App.settings.compiler.disableRTTI) flags.push('-fno-rtti');
    }

    return flags.join(' ');
}


initBatchTesting();

// ============================================================================
// AUTO UPDATE - Check for new versions
// ============================================================================
let updateInfo = null;
let updateDismissedVersion = null;

async function checkForUpdates() {
    if (!window.electronAPI?.checkForUpdates) return;

    try {
        const info = await window.electronAPI.checkForUpdates();

        if (info.hasUpdate) {

            const dismissedVersion = localStorage.getItem('dismissedUpdateVersion');
            if (dismissedVersion === info.latestVersion) {
                console.log('[Update] User previously dismissed this version');
                return;
            }

            updateInfo = info;
            showUpdateNotification(info);
        }
    } catch (error) {
        console.error('[Update] Check failed:', error);
    }
}

function showUpdateNotification(info) {
    const overlay = document.getElementById('update-overlay');
    const currentEl = document.getElementById('update-current');
    const newEl = document.getElementById('update-new');
    const notesEl = document.getElementById('update-notes');

    if (!overlay) return;

    // Update content
    if (currentEl) currentEl.textContent = `v${info.currentVersion}`;
    if (newEl) newEl.textContent = `v${info.latestVersion}`;

    if (notesEl) {
        notesEl.innerHTML = '<p style="text-align: center; font-weight: 600; font-size: 15px; margin: 10px 0;">Thằng wjbu nó mới fix bug hay thêm tính năng gì đó. Tải thử xem coi có gì khác không 🐟</p>';
    }

    overlay.classList.add('show');

    document.getElementById('update-close')?.addEventListener('click', hideUpdateNotification);
    document.getElementById('update-later')?.addEventListener('click', () => {
        hideUpdateNotification();
    });
    document.getElementById('update-download')?.addEventListener('click', () => {
        window.electronAPI.openReleasePage(info.releaseUrl);
        hideUpdateNotification();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideUpdateNotification();
    });
}

function hideUpdateNotification() {
    const overlay = document.getElementById('update-overlay');
    if (overlay) {
        overlay.classList.remove('show');
    }
}


setTimeout(() => {
    checkForUpdates();
}, 3000);


document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'F11') {
        e.preventDefault();
        runAllTests();
    }
});

// ============================================================================
// TERMINAL UX ENHANCEMENTS & LOGIC
// ============================================================================
let termHistory = [];
let termHistoryIndex = -1;
let termCurrentDraft = '';

function initTerminalUX() {
    const termSection = document.getElementById('terminal-section');
    const termInput = document.getElementById('terminal-in');

    if (termInput) {

        const handleResize = function () {
            if (this.value === '') {
                this.style.height = '';
                return;
            }
            this.style.height = 0; // Set to 0 first to correctly calculate scrollHeight
            this.style.height = (this.scrollHeight) + 'px';
        };
        termInput.addEventListener('input', handleResize);
        termInput.addEventListener('paste', function () {
            setTimeout(() => handleResize.call(this), 10);
        });


        termInput.addEventListener('keydown', (e) => {

            if (e.ctrlKey && e.key === 'c') {
                if (termInput.selectionStart === termInput.selectionEnd) {
                    e.preventDefault();
                    if (App.isRunning) {
                        stop();
                        log('^C', 'error');
                    }
                }
                return;
            }


            if (e.key === 'ArrowUp') {
                if (termHistory.length > 0) {
                    e.preventDefault();
                    if (termHistoryIndex === -1) {
                        termCurrentDraft = termInput.value;
                        termHistoryIndex = termHistory.length - 1;
                    } else if (termHistoryIndex > 0) {
                        termHistoryIndex--;
                    }
                    termInput.value = termHistory[termHistoryIndex];
                    handleResize.call(termInput);
                }
            } else if (e.key === 'ArrowDown') {
                if (termHistoryIndex !== -1) {
                    e.preventDefault();
                    if (termHistoryIndex < termHistory.length - 1) {
                        termHistoryIndex++;
                        termInput.value = termHistory[termHistoryIndex];
                    } else {
                        termHistoryIndex = -1;
                        termInput.value = termCurrentDraft;
                    }
                    handleResize.call(termInput);
                }
            }


            if (e.key === 'Enter') {
                if (e.shiftKey) {
                    // Newline
                } else {
                    e.preventDefault();
                    const val = termInput.value.trim();
                    if (val) {

                        if (termHistory.length === 0 || termHistory[termHistory.length - 1] !== val) {
                            termHistory.push(val);
                        }
                        termHistoryIndex = -1;
                        termCurrentDraft = '';
                    }
                    sendInput();
                }
            }
        });


        if (termSection && !termSection.dataset.contextMenuInitialized) {
            termSection.dataset.contextMenuInitialized = 'true';

            termSection.addEventListener('contextmenu', async (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'TEXTAREA') {
                    if (e.target.tagName === 'TEXTAREA') return;
                }

                e.preventDefault();
                try {
                    const text = await navigator.clipboard.readText();
                    if (text && !termInput.disabled) {
                        const startPos = termInput.selectionStart;
                        const endPos = termInput.selectionEnd;
                        const currentValue = termInput.value;

                        termInput.value = currentValue.substring(0, startPos) + text + currentValue.substring(endPos);


                        termInput.dispatchEvent(new Event('input'));

                        termInput.focus();


                        const newPos = startPos + text.length;
                        termInput.setSelectionRange(newPos, newPos);
                    }
                } catch (err) {
                    console.warn('Paste failed:', err);
                }
            });
        }
    }
}


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTerminalUX);
} else {
    initTerminalUX();
}

// ============================================================================
// ABOUT & UPDATE CHECK
// ============================================================================
async function initAbout() {
    if (!window.electronAPI) return;

    try {
        const version = await window.electronAPI.getCurrentVersion();
        const verEl = document.getElementById('about-version');
        if (verEl) verEl.textContent = version;

        // Populate system versions
        const sysVersions = window.electronAPI.getSystemVersions();
        if (sysVersions) {
            const elElectron = document.getElementById('about-electron');
            const elChrome = document.getElementById('about-chrome');
            const elNode = document.getElementById('about-node');

            if (elElectron) elElectron.textContent = sysVersions.electron || 'Unknown';
            if (elChrome) elChrome.textContent = sysVersions.chrome || 'Unknown';
            if (elNode) elNode.textContent = sysVersions.node || 'Unknown';
        }

        // Auto check on startup (silent)
        checkForUpdates(false);
    } catch (e) {
        console.error('[About] Init failed', e);
    }

    const checkBtn = document.getElementById('btn-check-update');
    // Remove old listeners to avoid duplicates if re-init
    if (checkBtn) {
        const newBtn = checkBtn.cloneNode(true);
        checkBtn.parentNode.replaceChild(newBtn, checkBtn);
        newBtn.onclick = () => checkForUpdates();
    }

    const githubBtn = document.getElementById('btn-github');
    if (githubBtn) {
        githubBtn.onclick = () => {
            window.electronAPI.openReleasePage('https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP');
        };
    }

    // Wire up Update Overlay buttons
    const overlay = document.getElementById('update-overlay');
    const closeBtn = document.getElementById('update-close');
    const laterBtn = document.getElementById('update-later');
    const downloadBtn = document.getElementById('update-download');
    const restartBtn = document.getElementById('update-restart');

    if (overlay) {
        const close = () => { overlay.style.display = 'none'; };
        if (closeBtn) closeBtn.onclick = close;
        if (laterBtn) laterBtn.onclick = close;
        if (downloadBtn) downloadBtn.onclick = () => downloadUpdate();
        if (restartBtn) restartBtn.onclick = () => restartToUpdate();
    }

    // Listen for update status from main process
    if (window.electronAPI?.onUpdateStatus) {
        console.log('[Update] Setup listener for update status');
        window.electronAPI.onUpdateStatus((data) => {
            console.log('[Update] Received status:', data);
            handleUpdateStatus(data);
        });
    } else {
        console.warn('[Update] onUpdateStatus not available');
    }
}

// Update state
let updateDownloaded = false;
let isPortableVersion = false;
let pendingUpdateVersion = null;

// Detect portable version (non-blocking)
function detectPortableVersion() {
    if (!window.electronAPI?.getAppInfo) return;

    window.electronAPI.getAppInfo()
        .then(info => {
            isPortableVersion = info?.isPortable || false;
            console.log('[Update] Portable version:', isPortableVersion);
        })
        .catch(() => {
            console.log('[Update] Could not detect portable version');
        });
}

// Validate compiler status on startup
function validateCompilerOnStartup() {
    if (!window.electronAPI?.getCompilerStatus) return;

    window.electronAPI.getCompilerStatus().then(status => {
        console.log('[Compiler] Status:', status);

        if (status.fallback) {
            // Compiler not bundled, using PATH fallback
            setStatus('Using system compiler (fallback)', 'warning', 5000);

            // Show toast or notification
            showToast('Bundled compiler not found. Using system g++ from PATH.', 'warning');
        } else if (status.found === false && status.error) {
            // No compiler found at all!
            setStatus('Compiler NOT found!', 'error', 10000);

            // Show critical error modal
            const message = `
                <div style="padding: 10px;">
                    <h3 style="color: var(--error); margin-bottom: 10px;">Compiler Not Found</h3>
                    <p>The C++ compiler (g++) could not be found.</p>
                    <p style="opacity: 0.8; font-size: 12px; margin-top: 5px;">
                        Method: ${status.error}<br>
                        This will prevent you from compiling code.
                    </p>
                    <p style="margin-top: 10px;">Please reinstall the application or install MinGW manually.</p>
                </div>
            `;
            // For now, we'll just log it clearly and maybe use the toast, 
            // as we don't have a generic modal function exposed yet (except About/Settings).
            // But we can reuse the "Update" overlay style or similar in future if needed.
            showToast('CRITICAL: C++ Compiler (g++) not found!', 'error', 8000);
        } else if (status.found) {
            console.log(`[Compiler] OK: ${status.path}`);
        }
    }).catch(err => {
        console.error('[Compiler] Validation check failed:', err);
    });
}


function handleUpdateStatus(data) {
    // Add null/undefined checks for data safety
    if (!data) {
        console.error('[Update] Received null or undefined update status data');
        return;
    }

    const { status, data: updateData = {}, currentVersion } = data;

    console.log('[Update]', status, updateData);

    const overlay = document.getElementById('update-overlay');
    const title = document.getElementById('update-title');
    const progress = document.getElementById('update-progress');
    const progressFill = document.getElementById('update-progress-fill');
    const progressText = document.getElementById('update-progress-text');
    const downloadBtn = document.getElementById('update-download');
    const restartBtn = document.getElementById('update-restart');
    const laterBtn = document.getElementById('update-later');

    switch (status) {
        case 'checking-for-update':
            console.log('[Update] Checking for updates...');
            break;

        case 'update-available':
            console.log('[Update] Update available:', updateData?.version);
            pendingUpdateVersion = updateData?.version;

            // Update version info
            const upCur = document.getElementById('update-current');
            const upNew = document.getElementById('update-new');
            if (upCur) upCur.textContent = 'v' + currentVersion;
            if (upNew && updateData?.version) upNew.textContent = 'v' + updateData.version;

            // Update title
            if (title) {
                title.textContent = updateData?.isPrerelease ?
                    'Pre-release Update Available' :
                    'Update Available';
            }

            if (isPortableVersion) {
                // Portable: Show header button that links to download page
                const headerUpdateBtn = document.getElementById('btn-restart-update');
                if (headerUpdateBtn) {
                    headerUpdateBtn.style.display = 'flex';
                    headerUpdateBtn.querySelector('span').textContent = 'Download v' + updateData?.version;
                }
                // Don't show overlay for portable - just header notification
                if (overlay) overlay.style.display = 'none';
            } else {
                // Installer: Auto-download handled by electron-updater (autoDownload = true)
                console.log('[Update] Update will be auto-downloaded in background...');
                // Don't show overlay - silent download
                if (overlay) overlay.style.display = 'none';
            }

            if (progress) progress.style.display = 'none';
            break;

        case 'update-not-available':
            console.log('[Update] No updates available');
            // Don't show popup when no update is available
            break;

        case 'download-started':
            console.log('[Update] Download started');

            if (title) title.textContent = 'Downloading Update...';
            if (downloadBtn) downloadBtn.disabled = true;
            if (progress) {
                progress.style.display = 'block';
                progressFill.style.width = '0%';
                progressText.textContent = 'Downloading: 0%';
            }

            // Show header progress bar
            const headerProgressStart = document.getElementById('header-update-progress');
            if (headerProgressStart) {
                headerProgressStart.style.display = 'flex';
                const fillStart = document.getElementById('header-progress-fill');
                const textStart = document.getElementById('header-progress-text');
                if (fillStart) fillStart.style.width = '0%';
                if (textStart) textStart.textContent = '0%';
            }
            break;

        case 'download-progress':
            console.log('[Update] Download progress:', updateData?.percent + '%');

            // Skip progress updates if update is already downloaded
            if (updateDownloaded) {
                console.log('[Update] Ignoring progress event - update already downloaded');
                break;
            }

            const percent = updateData?.percent || 0;

            // Update overlay progress
            if (progressFill) progressFill.style.width = percent + '%';
            if (progressText) progressText.textContent = `Downloading: ${percent}%`;

            // Update header progress bar
            const headerProgress = document.getElementById('header-update-progress');
            if (headerProgress) {
                headerProgress.style.display = 'flex';
                const headerFill = document.getElementById('header-progress-fill');
                const headerText = document.getElementById('header-progress-text');
                if (headerFill) headerFill.style.width = percent + '%';
                if (headerText) headerText.textContent = percent + '%';
            }

            // At 100%, keep waiting for a real update-downloaded event.
            // This avoids showing "Restart to Update" too early while updater is still finalizing.
            if (percent >= 100 && !updateDownloaded) {
                if (progressText) progressText.textContent = 'Verifying update package...';

                const headerTextVerifying = document.getElementById('header-progress-text');
                if (headerTextVerifying) headerTextVerifying.textContent = 'Verifying...';
            }
            break;

        case 'update-downloaded':
            console.log('[Update] Update downloaded - ready to restart');
            updateDownloaded = true;

            // Hide overlay and progress
            if (overlay) overlay.style.display = 'none';
            if (progress) progress.style.display = 'none';

            // Hide header progress bar
            const headerProgressDone = document.getElementById('header-update-progress');
            if (headerProgressDone) headerProgressDone.style.display = 'none';

            // Show "Restart to Update" button in header with badge
            const headerRestartBtn = document.getElementById('btn-restart-update');
            if (headerRestartBtn) {
                headerRestartBtn.style.display = 'flex';
                headerRestartBtn.querySelector('span').textContent = 'Restart to Update';
            }
            break;

        case 'update-error':
            console.error('[Update] Error:', updateData?.message || 'Unknown error');
            // Silent fail - don't show popup error messages
            break;
    }
}

async function checkForUpdates() {
    if (!window.electronAPI) return;

    try {
        await window.electronAPI.checkForUpdates();
    } catch (error) {
        console.error('[Update] Check failed:', error);
    }
}

async function downloadUpdate() {
    if (!window.electronAPI) return;

    try {
        await window.electronAPI.downloadUpdate();
    } catch (error) {
        console.error('[Update] Download failed:', error);
    }
}

function restartToUpdate() {
    if (!window.electronAPI || !updateDownloaded) return;

    window.electronAPI.quitAndInstall();
}

// ============================================================================
// TAB CONTEXT MENU
// ============================================================================
let tabContextMenu = null;

function showTabContextMenu(e, tab) {
    // Remove existing menu
    if (tabContextMenu) {
        tabContextMenu.remove();
    }

    // Create context menu - same style as dropdown menu
    tabContextMenu = document.createElement('div');
    tabContextMenu.className = 'tab-context-menu';

    // Get computed styles from document for theme-aware colors
    const computedStyle = getComputedStyle(document.documentElement);
    const bgPanel = computedStyle.getPropertyValue('--bg-panel').trim() || '#f5faff';
    const border = computedStyle.getPropertyValue('--border').trim() || '#c8e6f8';
    const textPrimary = computedStyle.getPropertyValue('--text-primary').trim() || '#3a5a78';

    tabContextMenu.style.cssText = `
        position: fixed;
        top: ${e.clientY}px;
        left: ${e.clientX}px;
        z-index: 10000;
        background: ${bgPanel};
        border: 2px solid ${border};
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(136, 201, 234, 0.25);
        min-width: 180px;
        padding: 8px;
        font-size: 13px;
        color: ${textPrimary};
    `;

    // Menu items with SVG icons
    const items = [
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
            label: 'Checkpoints',
            action: () => {
                if (typeof LocalHistory !== 'undefined') {
                    setActive(tab.id);
                    if (tab.path) {
                        LocalHistory.showHistoryModal(tab.path);
                    } else {
                        LocalHistory.showUntitledHistoryModal(tab);
                    }
                }
            },
            disabled: false
        },
        { divider: true },
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
            label: 'Copy Path',
            action: () => {
                if (tab.path) {
                    navigator.clipboard.writeText(tab.path);
                    setStatus('Path copied to clipboard', 'success');
                }
            },
            disabled: !tab.path
        },
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
            label: 'Close',
            action: () => closeTab(tab.id)
        },
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="23" y2="11"/></svg>`,
            label: 'Close Others',
            action: () => {
                const tabsToClose = App.tabs.filter(t => t.id !== tab.id);
                tabsToClose.forEach(t => closeTab(t.id));
            },
            disabled: App.tabs.length <= 1
        }
    ];

    // Get hover color
    const bgHover = computedStyle.getPropertyValue('--bg-ocean-light').trim() || '#e8f4fc';
    const textSecondary = computedStyle.getPropertyValue('--text-secondary').trim() || '#5a9fc8';
    const accent = computedStyle.getPropertyValue('--accent').trim() || '#ff6b9d';

    items.forEach(item => {
        if (item.divider) {
            const div = document.createElement('div');
            div.style.cssText = `height: 1px; background: ${border}; margin: 6px 8px;`;
            tabContextMenu.appendChild(div);
            return;
        }

        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
            padding: 10px 16px;
            cursor: ${item.disabled ? 'not-allowed' : 'pointer'};
            display: flex;
            align-items: center;
            gap: 10px;
            opacity: ${item.disabled ? '0.5' : '1'};
            transition: all 0.15s;
            color: ${item.disabled ? textSecondary : textPrimary};
            border-radius: 10px;
            font-weight: 600;
        `;
        menuItem.innerHTML = `<span style="display:flex;align-items:center;color:${accent}">${item.icon}</span><span>${item.label}</span>`;

        if (!item.disabled) {
            menuItem.onmouseenter = () => {
                menuItem.style.background = bgHover;
                menuItem.style.color = textPrimary;
            };
            menuItem.onmouseleave = () => {
                menuItem.style.background = '';
            };
            menuItem.onclick = () => {
                item.action();
                tabContextMenu.remove();
                tabContextMenu = null;
            };
        }

        tabContextMenu.appendChild(menuItem);
    });

    document.body.appendChild(tabContextMenu);

    // Close on click outside
    const closeMenu = (e) => {
        if (tabContextMenu && !tabContextMenu.contains(e.target)) {
            tabContextMenu.remove();
            tabContextMenu = null;
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// ============================================================================
// LOCAL HISTORY SETTINGS INTEGRATION
// ============================================================================
function initLocalHistorySettings() {
    // Sync settings from App.settings to LocalHistory module
    if (typeof LocalHistory !== 'undefined' && App.settings.localHistory) {
        LocalHistory.settings = { ...LocalHistory.settings, ...App.settings.localHistory };
    }

    // Settings UI elements
    const enabledToggle = document.getElementById('set-localHistoryEnabled');
    const maxVersionsInput = document.getElementById('set-localHistoryMaxVersions');
    const maxDaysInput = document.getElementById('set-localHistoryMaxDays');
    const maxSizeInput = document.getElementById('set-localHistoryMaxSize');

    if (enabledToggle) {
        enabledToggle.checked = App.settings.localHistory?.enabled ?? true;
        enabledToggle.onchange = () => {
            App.settings.localHistory.enabled = enabledToggle.checked;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.enabled = enabledToggle.checked;
            }
        };
    }

    if (maxVersionsInput) {
        maxVersionsInput.value = App.settings.localHistory?.maxVersions ?? 20;
        maxVersionsInput.onchange = () => {
            App.settings.localHistory.maxVersions = parseInt(maxVersionsInput.value) || 20;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.maxVersions = App.settings.localHistory.maxVersions;
            }
        };
    }

    if (maxDaysInput) {
        maxDaysInput.value = App.settings.localHistory?.maxAgeDays ?? 7;
        maxDaysInput.onchange = () => {
            App.settings.localHistory.maxAgeDays = parseInt(maxDaysInput.value) || 7;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.maxAgeDays = App.settings.localHistory.maxAgeDays;
            }
        };
    }

    if (maxSizeInput) {
        maxSizeInput.value = App.settings.localHistory?.maxFileSizeKB ?? 1024;
        maxSizeInput.onchange = () => {
            App.settings.localHistory.maxFileSizeKB = parseInt(maxSizeInput.value) || 1024;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.maxFileSizeKB = App.settings.localHistory.maxFileSizeKB;
            }
        };
    }
}

// Initialize Local History settings when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for other modules to load
    setTimeout(initLocalHistorySettings, 100);
});

// Listen for theme customizer save events
window.addEventListener('themeCustomizerSave', (e) => {
    console.log('[App] Theme saved from customizer:', e.detail.theme.meta);
    // IDE integrations can listen to this event to apply theme changes
    // e.detail.theme contains the full theme data (meta, colors, editor, terminal)
    // e.detail.timestamp contains the save timestamp
});

