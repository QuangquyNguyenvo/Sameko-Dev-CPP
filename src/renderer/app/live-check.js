/**
 * Sameko Dev C++ IDE - renderer: Live syntax check, problem summary in the status bar, applySettings.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

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

    // Status bar counters stay visible; a zero is only dimmed.
    if (errorsBadge) {
        errorsBadge.querySelector('b').textContent = summary.errors;
        errorsBadge.classList.toggle('zero', summary.errors === 0);
    }
    if (warningsBadge) {
        warningsBadge.querySelector('b').textContent = summary.warnings;
        warningsBadge.classList.toggle('zero', summary.warnings === 0);
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

/** Status bar badge: the C++ standard for C/C++ files, else the file's language. */
function updateLanguageStatus() {
    const label = document.getElementById('status-std');
    if (!label) return;
    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const tab = App.tabs.find(t => t.id === tabId);
    const language = tab ? languageForFile(tab.path || tab.name) : 'cpp';
    const std = App.settings.compiler.cppStandard;
    label.textContent = language === 'markdown' ? 'Markdown'
        : language !== 'cpp' ? 'Plain Text'
        : std ? std.toUpperCase() : 'C++';
    label.title = language === 'cpp' ? 'C++ standard (Settings › Compiler)' : 'File type';
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
    if (!isCppTab(tab)) {
        // Write-ups and test data: nothing to check.
        clearLiveCheckMarkers();
        setLiveCheckUIState('idle');
        return;
    }

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
        // The tab id lets clangd reuse the document it already has open for
        // completions (an untitled tab has no path).
        const result = await window.electronAPI.syntaxCheck(code, tab?.path || null, tab?.id || null);
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
        // clangd reports the exact range; g++ only a start position.
        endLineNumber: d.endLine || d.line,
        endColumn: d.endColumn || (d.column ? d.column + 50 : 1000),
        message: d.message,
        source: d.source === 'clangd' ? 'clangd' : 'g++'
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
                setStatus(`${pluralizeIssue(summary.errors, 'error')}${summary.warnings ? ` - ${pluralizeIssue(summary.warnings, 'warning')}` : ''}`, 'error');
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
        insertSpaces: true,
        detectIndentation: false,
        emptySelectionClipboard: false,
        minimap: { enabled: App.settings.editor.minimap },
        wordWrap: App.settings.editor.wordWrap ? 'on' : 'off',
        multiCursorModifier: resolveMultiCursorModifier(),
        quickSuggestions: buildQuickSuggestions(),
        suggestOnTriggerCharacters: App.settings.editor.intellisense !== false,
        wordBasedSuggestions: 'off',
        parameterHints: { enabled: App.settings.editor.intellisense !== false },
        suggest: buildSuggestOptions()
    };

    // Editor zoom is driven only by fontSize + initCtrlWheelZoom; never let Monaco's
    // built-in wheel zoom back on, or a settings re-apply would resurrect #36.
    opts.mouseWheelZoom = false;

    // Performance optimizations
    if (App.settings.appearance.performanceMode) {
        opts.minimap = { enabled: false };
        opts.bracketPairColorization = { enabled: false };
        opts.cursorBlinking = 'solid';
        opts.smoothScrolling = false;
    }

    if (App.editor) App.editor.updateOptions(opts);
    if (App.editor2) App.editor2.updateOptions(opts);
    applyFileTypeOptions(App.editor);
    applyFileTypeOptions(App.editor2);
    updateLanguageStatus();

    // Apply panel font size to terminal, I/O panels
    const panelFontSize = App.settings.execution.panelFontSize || 13;
    document.documentElement.style.setProperty('--panel-font-size', panelFontSize + 'px');
    if (window.TerminalManager) TerminalManager.setFontSize(panelFontSize);

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
