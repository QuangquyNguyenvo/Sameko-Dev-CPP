/**
 * Sameko Dev C++ IDE - renderer: Compile, run, stop; error highlighting; Problems panel; terminal logging, status bar, output diff.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// BUILD & RUN
// ============================================================================


let isBuilding = false;

/**
 * A live debug session holds the .exe open, so any build would fail at the LINK
 * step with a raw "cannot open output file … Permission denied" from ld — which
 * reads like a broken toolchain to a beginner. Catch it here and say what is
 * actually going on, in plain words.
 * @param {string} action - what the user was trying to do ("Build", "Run", …)
 * @returns {boolean} true if the action must be refused
 */
function blockedByDebugSession(action) {
    if (!(window.Debugger && typeof window.Debugger.isActive === 'function' && window.Debugger.isActive())) {
        return false;
    }
    log(`${action} is unavailable while debugging — the debugger is using the program file.`, 'warning');
    log('Stop the debug session first: press Shift+F5, or the ■ button in the debug panel.', 'system');
    setStatus('Debug session active', 'warning');
    return true;
}

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


/**
 * Save, compile and (optionally) run the tab in the focused editor.
 * compileOnly() and buildRun() used to be two ~100-line copies of this that
 * had already drifted apart (one ignored the "Use LLD" setting, only one
 * switched to the Problems tab on failure).
 * @param {{runAfter: boolean}} options
 */
async function buildActiveTab({ runAfter }) {
    // Anti-spam check
    if (isBuilding) {
        log('Build in progress...', 'warning');
        return;
    }
    const verb = runAfter ? 'Build' : 'Compile';
    if (blockedByDebugSession(runAfter ? 'Build & Run' : 'Compile')) return;

    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    const editor = getActiveEditor();
    if (!tab) { log('No file open', 'warning'); return; }
    if (!isCppTab(tab)) { log(`${tab.name} is not a C/C++ file. Switch to the solution's tab to ${verb.toLowerCase()} it.`, 'warning'); return; }

    setBuildingState(true);
    let built = false;

    try {
        tab.content = tab.model && !tab.model.isDisposed() ? tab.model.getValue() : editor.getValue();

        if (tab.path) {
            // Compiling the old file after a failed save would build stale code
            // and mark the unsaved edits clean.
            const text = tab.content;
            const saved = await window.electronAPI.saveFile({ path: tab.path, content: text });
            if (!saved || saved.success === false) {
                const reason = (saved && saved.error) || 'unknown error';
                log(`Could not save ${tab.name}: ${reason}. Nothing was compiled.`, 'error');
                setStatus('Save failed', 'error');
                return;
            }
            markTabSaved(tab, text);
        }

        if (!App.showTerm) {
            App.showTerm = true;
            if (App.settings.panels) App.settings.panels.showTerm = true;
            saveSettings();
            updateUI();
        }
        if (runAfter && DockingState.terminalDocked) {
            showBottomPanel('terminal');
        }

        if (App.settings.execution.clearTerminal) clearTerm();
        clearProblems(tab.id);
        clearErrorDecorations();
        hasBuildProblems = false; // Reset before new build

        log(runAfter ? 'Building...' : 'Compiling...', 'info');
        setStatus(runAfter ? 'Building...' : 'Compiling...', 'building');

        // Notify explorer: compile started
        if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-start');

        const t0 = Date.now();
        const r = await window.electronAPI.compile({
            filePath: tab.path,
            untitledId: tab.path ? '' : tab.id,
            content: tab.content,
            flags: buildCompileFlags(),
            singleFileMode: App.settings.compiler.singleFileMode !== false,
            useLLD: App.settings.compiler.useLLD !== false,
            noBuildCache: App.settings.execution.noBuildCache === true,
            realtimeOutput: App.settings.execution.realtimeOutput !== false
        });
        const ms = Date.now() - t0;

        if (r.success) {
            App.exePath = r.outputPath;
            tab.exePath = r.outputPath;
            // Show linked files if multi-file project
            if (r.linkedFiles && r.linkedFiles.length > 0) {
                log(`Linked: ${r.linkedFiles.join(', ')}`, 'system');
            }
            log(r.cached ? `${verb} OK (${ms}ms, source unchanged: reused the last build)` : `${verb} OK (${ms}ms)`, 'success');
            if (r.warnings) {
                log(r.warnings, 'warning');
                parseProblems(r.warnings, 'warning');
            }
            setStatus(`${verb}: ${ms}ms`, 'success');
            if (window.Motion) Motion.buildResult(document.getElementById('btn-buildrun'), true);
            if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-ok');
            built = true;
        } else {
            log(`${verb} failed`, 'error');
            log(r.error, 'error');

            const errText = String(r.error || '');
            const isFileLocked = /permission denied|cannot open output file/i.test(errText);
            const isMultiDef = /multiple definition of/i.test(errText);
            const linkerLikeError = /undefined reference|undefined symbol|ld returned|collect2\.exe: error/i.test(errText);

            if (isFileLocked) {
                log('Hint: your program is still running and is holding the .exe open. Press ■ Stop (or Shift+F5 if you are debugging), then build again.', 'warning');
            } else if (isMultiDef) {
                log('Hint: Multiple symbol definitions detected. Check for duplicate main() or functions.', 'warning');
            } else if ((App.settings.compiler.singleFileMode !== false) && linkerLikeError) {
                log('Hint: This may require multi-file linking. Retry with Single-file mode OFF in Compiler settings.', 'warning');
            }

            parseProblems(r.error, 'error');
            hasBuildProblems = true; // Lock problems list from live-check overwrite
            highlightErrorLines(tab);
            setStatus(`${verb} failed`, 'error');
            if (window.Motion) Motion.buildResult(document.getElementById('btn-buildrun'), false);
            App.exePath = null;
            tab.exePath = null;
            if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-fail');

            showBottomPanel(DockingState.terminalDocked ? 'problems' : null);
        }
    } finally {
        // Unlock before running so the Stop button works
        setBuildingState(false);
    }

    if (built && runAfter) {
        // run() works on the focused tab (its exe, Input box, tests). If the user
        // switched tabs while g++ was busy, that is a different program: do not
        // start it, or worse, start the new tab's old build.
        if (getPreferredTabId() !== tab.id || !App.tabs.includes(tab)) {
            log(`${tab.name} was built, but another tab is now active, so it was not run. Switch back and press Run.`, 'warning');
            return;
        }
        await run(false); // Don't clear terminal - keep build info visible
    }
}

function compileOnly() { return buildActiveTab({ runAfter: false }); }
function buildRun() { return buildActiveTab({ runAfter: true }); }

// A run being started (stopping the previous program, launching the new one).
// A second Run pressed meanwhile is ignored: two launches racing each other let
// the replaced program's "stopped" event end the newest run.
let runStarting = false;

async function run(clearTerminal = true) {
    if (runStarting) return;
    runStarting = true;
    try {
        await runNow(clearTerminal);
    } finally {
        runStarting = false;
    }
}

async function runNow(clearTerminal) {
    if (blockedByDebugSession('Run')) return;
    // Run the executable built from THIS tab, not whichever tab was built last.
    const exeTab = App.tabs.find(t => t.id === getPreferredTabId());
    const exePath = exeTab ? exeTab.exePath : null;
    if (!exePath) { log('Build first (F11)', 'warning'); return; }
    const tabId = exeTab.id;

    // This tab's input, read now: the user may switch tabs while we wait below.
    // An attached input file replaces the Input box (#49). The box is sent as
    // typed (leading spaces and blank lines matter to getline); the main process
    // adds the final newline, so one trailing newline is dropped here.
    const inputFile = getTabInputFile(tabId);
    const inputValue = inputFile ? '' : document.getElementById('input-area').value;
    const inputText = inputValue.replace(/\r?\n$/, '');
    const hasInput = !inputFile && inputValue.length > 0;

    // Run Only while a program runs: stop it first, so its "stopped" event and
    // its time limit cannot end the new run.
    if (App.isRunning) await stop();
    const runSeq = ++App.runSeq;

    if (!App.showTerm) {
        App.showTerm = true;
        updateUI();
    }

    if (DockingState.terminalDocked) {
        showBottomPanel('terminal');
    }


    if (clearTerminal) clearTerm();

    log('--- Running ---', 'system');
    setStatus('Running...', '');
    beginRunCapture(tabId);
    setTabOutput(tabId, { text: '', state: 'running' });
    setRunning(true);

    // Notify explorer: run started
    const _runTab = exeTab;
    if (window.FileExplorer && _runTab) window.FileExplorer.notifyBuildEvent(_runTab.path, 'run-start');


    if (DockingState.terminalDocked) {
        switchDockedPanel('terminal');

        setTimeout(() => {
            const termInput = document.getElementById('terminal-in');
            if (termInput) termInput.focus();
        }, 100);
    }

    if (App.settings.execution.timeLimitEnabled && App.settings.execution.timeLimitSeconds > 0) {
        App.runTimeout = setTimeout(() => {
            App.runTimeout = null;
            if (App.isRunning && App.runSeq === runSeq) {
                log('\nTime limit exceeded!', 'error');
                stop();
            }
        }, App.settings.execution.timeLimitSeconds * 1000);
    }

    const tab = exeTab;
    let sourceDir = null;
    if (tab && tab.path) {
        const lastSlash = Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\'));
        if (lastSlash !== -1) sourceDir = tab.path.substring(0, lastSlash);
    }

    let runResult;
    try {
        runResult = await window.electronAPI.run({
            exePath,
            cwd: sourceDir,
            useExternalTerminal: App.settings.execution.useExternalTerminal
        });
    } catch (err) {
        runResult = { success: false, error: err?.message || String(err) };
    }

    // The program never started (e.g. the .exe was deleted): no exit event will
    // come, so leave the "Running" state here.
    if (runResult && runResult.success === false) {
        if (App.runTimeout) {
            clearTimeout(App.runTimeout);
            App.runTimeout = null;
        }
        setRunning(false);
        setTabOutput(tabId, { text: '', state: 'stopped' });
        if (exeTab && exeTab.exePath === exePath) exeTab.exePath = null;
        log(runResult.error || 'Could not start the program.', 'error');
        setStatus('Run failed', 'error');
        if (window.FileExplorer && _runTab) window.FileExplorer.notifyBuildEvent(_runTab.path, 'run-exit-fail');
        return;
    }

    // Skip auto-send input if using external terminal
    if (App.settings.execution.useExternalTerminal) {
        return;
    }

    if (inputFile && App.settings.execution.autoSendInput) {
        // Streamed by the main process; the terminal shows one line instead of the whole file.
        log(`< ${inputFile.split(/[\\/]/).pop()}`, 'input');
        window.electronAPI.sendInputFile(inputFile).then((r) => {
            if (r && !r.success && App.isRunning) log(`Could not read the input file: ${r.error}`, 'error');
        });
        return;
    }

    // Send all input at once (like freopen) for maximum speed
    if (hasInput && App.settings.execution.autoSendInput) {
        App.autoInputTimer = setTimeout(() => {
            App.autoInputTimer = null;
            if (App.isRunning && App.runSeq === runSeq) {
                // Echo the input as a single block. Splitting huge input into one
                // log() (and one DOM node) per line froze the UI for minutes before
                // any program output appeared. (#48)
                const echoLineCount = (inputText.match(/\n/g) || []).length + 1;
                const ECHO_LINE_CAP = 5000;
                if (echoLineCount > ECHO_LINE_CAP) {
                    const head = inputText.split('\n').slice(0, ECHO_LINE_CAP).join('\n');
                    log(head, 'input');
                    log(`... (${echoLineCount - ECHO_LINE_CAP} more input lines hidden)`, 'system');
                } else {
                    log(inputText, 'input');
                }

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
    if (App.autoInputTimer) {
        clearTimeout(App.autoInputTimer);
        App.autoInputTimer = null;
    }

    setRunning(false);
    log('\n[System] Process terminated.', 'system');

    await window.electronAPI.stopProcess();
}

// ============================================================================
// ERROR HIGHLIGHTING
// ============================================================================
// Build-error line marks live on the built tab's model, not on an editor: they
// show in whichever pane shows that file (the left editor used to get them even
// when the right pane was built), and survive a tab switch until the file is
// edited or built again.
let errorDecorationModel = null;

/** True when problem `p` is reported for `tab`'s file (not for a header it includes). */
function problemIsInTab(p, tab) {
    if (!tab.path) return true; // untitled: g++ saw a temp copy of this tab
    return !!p.file && pathKey(p.file) === pathKey(tab.path);
}

function highlightErrorLines(tab) {
    clearErrorDecorations();
    const model = tab && tab.model;
    if (!model || model.isDisposed()) return;
    const lastLine = model.getLineCount();
    const decorations = App.problems
        .filter(p => p.type === 'error' && problemIsInTab(p, tab))
        .map(p => {
            const line = Math.min(Math.max(1, Number(p.line) || 1), lastLine);
            return {
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: true,
                    className: 'error-line-decoration',
                    glyphMarginClassName: 'error-glyph'
                }
            };
        });
    if (decorations.length === 0) return;
    App.errorDecorations = model.deltaDecorations([], decorations);
    errorDecorationModel = model;
}

/** Remove the build-error marks; given a model, only when the marks are on it. */
function clearErrorDecorations(model) {
    if (App.errorDecorations.length === 0) return;
    if (model && model !== errorDecorationModel) return;
    if (errorDecorationModel && !errorDecorationModel.isDisposed()) {
        errorDecorationModel.deltaDecorations(App.errorDecorations, []);
    }
    App.errorDecorations = [];
    errorDecorationModel = null;
}

// ============================================================================
// PROBLEMS PANEL
// ============================================================================
/** @param {string|null} tabId the tab the next problems belong to */
function clearProblems(tabId = null) {
    App.problems = [];
    App.problemsTabId = tabId;
    renderProblems();
}

/** Show a problem: in the tab with the file it names, else in the tab that produced it. */
async function revealProblem(p) {
    const key = p.file ? pathKey(p.file) : '';
    let tab = key ? App.tabs.find(t => t.path && pathKey(t.path) === key) : null;
    if (!tab && p.file && /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(p.file) && !/[\\/]temp_code(?:-[\w-]+)?\.cpp$/i.test(p.file)) {
        // A header the problem is in, not open yet.
        await openFileFromPath(p.file);
        tab = App.tabs.find(t => t.path && pathKey(t.path) === key) || null;
    }
    if (!tab) tab = App.tabs.find(t => t.id === App.problemsTabId) || null;
    if (!tab) return;

    let editor = [App.editor2, App.editor].find(ed => ed && tab.model && ed.getModel() === tab.model);
    if (editor) {
        if (typeof focusEditorPane === 'function') focusEditorPane(editor === App.editor2 ? 2 : 1);
    } else {
        setActive(tab.id);
        editor = getActiveEditor();
    }
    if (!editor || editor.getModel() !== tab.model) return;
    const line = Math.max(1, Number(p.line) || 1);
    const column = Math.max(1, Number(p.col) || 1);
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column });
    editor.focus();
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
    count.classList.toggle('hidden', App.problems.length === 0);
    list.innerHTML = '';
    updateProblemSummaryUI();
    // The badge goes on the tab the problems belong to, which is not always the
    // focused one (focus can move while a build or a check runs).
    setTabDiagnostics(App.problemsTabId || getPreferredTabId(), App.problems);

    App.problems.forEach(p => {
        const el = document.createElement('div');
        el.className = 'problem-item ' + (['error', 'warning', 'note', 'info'].includes(p.type) ? p.type : 'info');
        const icon = p.type === 'error'
            ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
            : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>';
        el.innerHTML = `<span class="problem-icon">${icon}</span>
      <span class="problem-message">${escHtml(p.message)}</span>
      <span class="problem-location" style="margin-left:auto;opacity:0.7;color:var(--text-secondary)">${escHtml(String(p.file || '').split(/[/\\]/).pop())}:${Number(p.line) || 0}</span>`;
        el.onclick = () => { revealProblem(p); };
        list.appendChild(el);
    });
}


const TERMINAL_MESSAGE_COLORS = {
    'ansi-16': { success: '#98c379', error: '#e06c75', warning: '#e5c07b', info: '#61afef', system: '#7a8a9a' },
    'ansi-256': { success: '#98c379', error: '#e06c75', warning: '#e5c07b', info: '#61afef', system: '#7a8a9a' },
    'dracula': { success: '#50fa7b', error: '#ff5555', warning: '#f1fa8c', info: '#bd93f9', system: '#6272a4' },
    'monokai': { success: '#a6e22e', error: '#f92672', warning: '#f4bf75', info: '#66d9ef', system: '#75715e' },
    'nord': { success: '#a3be8c', error: '#bf616a', warning: '#ebcb8b', info: '#81a1c1', system: '#4c566a' },
    'solarized': { success: '#859900', error: '#dc322f', warning: '#b58900', info: '#268bd2', system: '#586e75' }
};


function normalizeLogType(type) {
    if (!type) return '';
    if (type === 'warn') return 'warning';
    if (type === 'ok') return 'success';
    return type;
}

/** True when the theme's --terminal-bg is a light colour (relative luminance above 0.5). */
function isLightTerminal() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--terminal-bg').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(bg);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.5;
}

// IDE status / build messages: each call is a discrete colored line.
function log(msg, type = '') {
    if (!window.TerminalManager) return;

    const normalizedType = normalizeLogType(type);
    const colorScheme = App.settings?.terminal?.colorScheme || 'ansi-16';
    const colorEnabled = colorScheme !== 'disabled';

    let hexColor = null;
    if (colorEnabled && normalizedType) {
        const messageColors = TERMINAL_MESSAGE_COLORS[colorScheme] || TERMINAL_MESSAGE_COLORS['ansi-16'];
        hexColor = messageColors[normalizedType] || null;
        // The schemes are tuned for dark terminals; on a light one (kawaii-light) use the
        // theme's darker --term-line-* colours, or the lines are too pale to read.
        if (hexColor && isLightTerminal()) {
            const themed = getComputedStyle(document.documentElement).getPropertyValue(`--term-line-${normalizedType}`).trim();
            if (themed) hexColor = themed;
        }
    }

    TerminalManager.writeMessage(msg, hexColor, colorEnabled);
}

// Raw program output (stdout/stderr): written verbatim so the program controls
// its own newlines and ANSI colors. stderr is tinted with the 'error' color.
function logProgram(data, isError = false) {
    if (!window.TerminalManager) return;

    const colorScheme = App.settings?.terminal?.colorScheme || 'ansi-16';
    const colorEnabled = colorScheme !== 'disabled';

    let hexColor = null;
    if (isError && colorEnabled) {
        const messageColors = TERMINAL_MESSAGE_COLORS[colorScheme] || TERMINAL_MESSAGE_COLORS['ansi-16'];
        hexColor = messageColors.error || null;
    }

    TerminalManager.writeProgram(data, hexColor, colorEnabled);
}

function clearTerm() {
    if (window.TerminalManager) TerminalManager.clear();
}

function setRunning(v) {
    App.isRunning = v;
    document.getElementById('btn-stop').disabled = !v;
    document.getElementById('terminal-in').disabled = !v;
    document.getElementById('btn-send').disabled = !v;
    document.getElementById('btn-buildrun')?.classList.toggle('running', v);
    document.getElementById('btn-run-only')?.classList.toggle('running', v);
    document.getElementById('btn-stop')?.classList.toggle('running', v);

    if (v) document.getElementById('terminal-in').focus();
}

/** Time and peak memory of the last run, kept in the status bar until the next one. */
function showRunStats(timeStr, memStr) {
    const item = document.getElementById('status-run');
    if (!item) return;
    document.getElementById('status-run-time').textContent = timeStr || '–';
    document.getElementById('status-run-mem').textContent = memStr || '–';
    item.classList.toggle('hidden', !timeStr && !memStr);
}

async function sendInput() {
    const inp = document.getElementById('terminal-in');
    if (App.isRunning) {
        // Echo and send the whole block at once. One IPC round trip and one
        // log line per input line made a large paste take seconds. Main adds the
        // final newline, so drop one trailing newline only: Enter on an empty box
        // sends an empty line (getline), and a pasted "a\n\n" keeps its blank line.
        const text = inp.value.replace(/\r\n/g, '\n').replace(/\n$/, '');
        log(text, 'input');
        // Cleared before the round trip: the next input typed while it is in
        // flight must not be erased when it returns.
        inp.value = '';
        // drop the inline sizing the auto-grow left behind (see initTerminalUX)
        inp.style.height = '';
        inp.style.maxHeight = '';
        inp.scrollTop = 0;
        await window.electronAPI.sendInput(text);
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
        ? `<span class="diff-char-wrong">${escHtml(actualDiff)}</span>`
        : '<span class="diff-char-placeholder">∅</span>';
    const expectedDiffHtml = expectedDiff
        ? `<span class="diff-char-right">${escHtml(expectedDiff)}</span>`
        : '<span class="diff-char-placeholder">∅</span>';

    return {
        actualHtml: `${escHtml(actualPrefix)}${actualDiffHtml}${escHtml(actualSuffix)}`,
        expectedHtml: `${escHtml(expectedPrefix)}${expectedDiffHtml}${escHtml(expectedSuffix)}`
    };
}

// The verdict covers every line, but only this much is drawn: a run near the
// 8 MB capture limit used to build ~44M characters of diff HTML (~160 MB, ~1 s).
const DIFF_MAX_ROWS = 2000;        // rows drawn before matching lines are skipped
const DIFF_MAX_MISMATCHES = 200;   // mismatching rows drawn in total

function buildCompactDiffHtml(expectedRaw, actualRaw, { normalize = true } = {}) {
    const expectedText = normalize ? normalizeJudgeOutput(expectedRaw) : String(expectedRaw ?? '');
    const actualText = normalize ? normalizeJudgeOutput(actualRaw) : String(actualRaw ?? '');

    const expectedLines = expectedText.length > 0 ? expectedText.split('\n') : [];
    const actualLines = actualText.length > 0 ? actualText.split('\n') : [];

    const maxLen = Math.max(expectedLines.length, actualLines.length);
    let allMatch = true;
    let mismatchCount = 0;
    const parts = [];
    let rows = 0, shownMismatches = 0, skipped = 0;
    const flushSkipped = () => {
        if (!skipped) return;
        parts.push(`<div class="diff-line diff-skip">… ${skipped} line${skipped === 1 ? '' : 's'} not shown</div>`);
        skipped = 0;
    };

    for (let i = 0; i < maxLen; i++) {
        const expLine = i < expectedLines.length ? expectedLines[i] : null;
        const actLine = i < actualLines.length ? actualLines[i] : null;

        if (expLine !== null && actLine !== null && expLine === actLine) {
            if (rows < DIFF_MAX_ROWS) {
                flushSkipped();
                parts.push(`<div class="diff-line match-compact">${escHtml(expLine)}</div>`);
                rows++;
            } else {
                skipped++;
            }
            continue;
        }

        allMatch = false;
        mismatchCount += 1;
        if (shownMismatches >= DIFF_MAX_MISMATCHES) {
            skipped++;
            continue;
        }
        flushSkipped();
        shownMismatches++;
        rows++;
        let html = `<div class="diff-line mismatch-compact">`;

        if (actLine !== null && expLine !== null) {
            const { actualHtml, expectedHtml } = buildInlineCharDiff(actLine, expLine);
            html += `<span class="diff-wrong" title="Actual">${actualHtml}</span>
                     <span class="diff-arrow">→</span>
                     <span class="diff-right" title="Expected">${expectedHtml}</span>`;
        } else if (actLine !== null && expLine === null) {
            html += `<span class="diff-extra" title="Extra output">[Extra] ${escHtml(actLine)}</span>`;
        } else if (actLine === null && expLine !== null) {
            html += `<span class="diff-missing" title="Missing output">Missing: ${escHtml(expLine)}</span>`;
        }

        html += `</div>`;
        parts.push(html);
    }
    flushSkipped();

    return { html: parts.join(''), allMatch, mismatchCount, expectedLines, actualLines };
}

// ============================================================================
// INPUT FROM A FILE (#49): a tab can take its input from a file instead of the
// Input box. The main process streams the file to the program; the renderer only
// keeps the path (App.ioByTab[tabId].inputFile) and shows the first lines.
// ============================================================================
const INPUT_PREVIEW_LINES = 30;
let inputFileRenderJob = 0;

function getTabInputFile(tabId) {
    return (tabId && App.ioByTab[tabId]?.inputFile) || null;
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function chooseInputFile() {
    const result = await window.electronAPI.showOpenDialog({
        title: 'Load input from a file',
        properties: ['openFile'],
        filters: [{ name: 'Test input', extensions: ['txt', 'in', 'inp'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (result && !result.canceled && result.filePaths?.length) setInputFile(result.filePaths[0]);
}

/** Attach a file to the current tab's input, or detach it with null. */
function setInputFile(filePath) {
    const tabId = getPreferredTabId();
    if (!tabId) return;
    persistCurrentTabIO();
    App.ioByTab[tabId] = Object.assign({ input: '', expected: '' }, App.ioByTab[tabId], { inputFile: filePath || null });
    renderInputFile(filePath || null);
}

async function renderInputFile(filePath) {
    const job = ++inputFileRenderJob;
    const panel = document.querySelector('.io-panel-input');
    const box = document.getElementById('input-file');
    if (!panel || !box) return;
    panel.classList.toggle('has-file', !!filePath);
    box.classList.toggle('hidden', !filePath);
    if (!filePath) return;

    const name = filePath.split(/[\\/]/).pop();
    document.getElementById('input-file-name').textContent = name;
    document.getElementById('input-file-name').title = filePath;
    const meta = document.getElementById('input-file-meta');
    const head = document.getElementById('input-file-head');
    meta.textContent = 'Reading…';
    head.textContent = '';
    head.classList.remove('error');

    const info = await window.electronAPI.inputFileInfo(filePath);
    if (job !== inputFileRenderJob) return;
    if (!info || !info.success) {
        meta.textContent = '';
        head.textContent = `Cannot read this file: ${info?.error || 'unknown error'}`;
        head.classList.add('error');
        return;
    }
    meta.textContent = `${formatBytes(info.size)} · ${info.lines.toLocaleString('en-US')} line${info.lines === 1 ? '' : 's'}`;
    // Only the first 4 KB are read, so the last line shown may be cut short.
    const shown = info.head.replace(/\r/g, '').split('\n').slice(0, INPUT_PREVIEW_LINES);
    if (shown.length > 1 && shown[shown.length - 1] === '') shown.pop();
    const more = info.lines - shown.length;
    const tail = more > 0 ? `… ${more.toLocaleString('en-US')} more line${more === 1 ? '' : 's'}`
        : info.truncated ? '… (only the start is shown)' : '';
    head.textContent = shown.join('\n') + (tail ? '\n' + tail : '');
}

// ============================================================================
// OUTPUT CARD (I/O column): the last run's output for each tab, with a verdict
// when Expected is filled. Kept in memory only; the terminal still has the full log.
// ============================================================================
App.outputByTab = App.outputByTab || {};

/**
 * @param {{text: string, state: 'running'|'done'|'stopped', verdict?: 'ac'|'wa', mismatches?: number}|null} out
 */
function renderOutputPanel(out) {
    const body = document.getElementById('output-area');
    const verdict = document.getElementById('output-verdict');
    if (!body || !verdict) return;

    const text = out ? out.text : '';
    body.textContent = text;
    body.classList.toggle('empty', !text);
    body.dataset.placeholder = out && out.state === 'running' ? 'Running…'
        : out ? 'No output' : 'No output yet';

    let label = '';
    let kind = '';
    if (out && out.state === 'running') { label = 'Running'; kind = 'running'; }
    else if (out && out.state === 'stopped') { label = 'Stopped'; kind = 'stopped'; }
    else if (out && out.verdict === 'ac') { label = 'AC'; kind = 'ac'; }
    else if (out && out.verdict === 'wa') {
        label = out.mismatches ? `WA · ${out.mismatches} line${out.mismatches === 1 ? '' : 's'}` : 'WA';
        kind = 'wa';
    }
    verdict.textContent = label;
    verdict.className = 'io-verdict' + (kind ? ' ' + kind : ' hidden');
}

function setTabOutput(tabId, out) {
    if (!tabId || !App.tabs.some(t => t.id === tabId)) return;   // closed meanwhile
    App.outputByTab[tabId] = out;
    if (tabId === getPreferredTabId()) renderOutputPanel(out);
}

// ============================================================================
// RUN OUTPUT
// ============================================================================
// What the program printed on stdout, collected per run. The result is judged
// against the Expected box of the tab that started the run, wherever the focus
// is when it ends. It used to be read back from the terminal, which keeps only
// its last 5000 lines, mixes in input echo, stderr and status lines, and could
// be fooled by a program printing "--- Running ---".
const MAX_RUN_OUTPUT_CHARS = 8 * 1024 * 1024;
let currentRun = null;   // { tabId, text, truncated }

function beginRunCapture(tabId) {
    currentRun = { tabId, text: '', truncated: false };
}

/** Free the last run's output (up to 8 MB) when its tab closes, unless it still runs. */
function releaseRunCapture(tabId) {
    if (currentRun && currentRun.tabId === tabId && !App.isRunning) currentRun = null;
}

function captureRunOutput(data) {
    if (!currentRun || data == null) return;
    if (currentRun.text.length >= MAX_RUN_OUTPUT_CHARS) { currentRun.truncated = true; return; }
    currentRun.text += String(data);
}

function runOutputText(run) {
    return run ? run.text.replace(/\r\n/g, '\n') : '';
}

/** Judge a finished run against its own tab's Expected text. */
function compareOutput(run = currentRun) {
    if (!run || !App.tabs.some(t => t.id === run.tabId)) return;
    const focused = run.tabId === getPreferredTabId();
    const textarea = document.getElementById('expected-area');
    const diffDisplay = document.getElementById('expected-diff');
    const expectedRaw = focused ? (textarea ? textarea.value : '') : (App.ioByTab[run.tabId]?.expected || '');
    const actualText = runOutputText(run);

    const expectedNorm = normalizeJudgeOutput(expectedRaw);
    const hasExpected = expectedNorm.length > 0;

    // Empty expected = run-only mode (do not mark WA/AC automatically)
    // Keep EXPECTED strictly as editable expected output (no auto output rendering).
    if (!hasExpected || run.truncated) {
        if (run.truncated) log('Output is over 8 MB: shown in part and not compared with Expected.', 'warning');
        setTabOutput(run.tabId, { text: actualText, state: 'done' });
        if (focused && !hasExpected) switchToExpectedEdit();
        return;
    }

    const diff = buildCompactDiffHtml(expectedRaw, actualText, { normalize: true });
    setTabOutput(run.tabId, {
        text: actualText,
        state: 'done',
        verdict: diff.allMatch ? 'ac' : 'wa',
        mismatches: diff.mismatchCount
    });

    if (focused && diffDisplay && textarea) {
        diffDisplay.innerHTML = diff.html;
        diffDisplay.style.display = 'block';
        diffDisplay.title = 'Click to edit expected output';
        textarea.style.display = 'none';
    }
}

function switchToExpectedEdit() {
    const textarea = document.getElementById('expected-area');
    const diffDisplay = document.getElementById('expected-diff');

    if (textarea && diffDisplay) {
        textarea.style.display = 'block';
        diffDisplay.style.display = 'none';
        textarea.focus();
    }
}
