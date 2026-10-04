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

    setBuildingState(true);
    let built = false;

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
        if (runAfter && DockingState.terminalDocked) {
            showBottomPanel('terminal');
        }

        if (App.settings.execution.clearTerminal) clearTerm();
        clearProblems();
        clearErrorDecorations();
        hasBuildProblems = false; // Reset before new build

        log(runAfter ? 'Building...' : 'Compiling...', 'info');
        setStatus(runAfter ? 'Building...' : 'Compiling...', 'building');

        // Notify explorer: compile started
        if (window.FileExplorer) window.FileExplorer.notifyBuildEvent(tab.path, 'compile-start');

        const t0 = Date.now();
        const r = await window.electronAPI.compile({
            filePath: tab.path,
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
            highlightErrorLines();
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
        await run(false); // Don't clear terminal - keep build info visible
    }
}

function compileOnly() { return buildActiveTab({ runAfter: false }); }
function buildRun() { return buildActiveTab({ runAfter: true }); }

async function run(clearTerminal = true) {
    if (blockedByDebugSession('Run')) return;
    // Run the executable built from THIS tab, not whichever tab was built last.
    const exeTab = App.tabs.find(t => t.id === getPreferredTabId());
    const exePath = exeTab ? exeTab.exePath : null;
    if (!exePath) { log('Build first (F11)', 'warning'); return; }

    if (!App.showTerm) {
        App.showTerm = true;
        updateUI();
    }

    if (DockingState.terminalDocked) {
        showBottomPanel('terminal');
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

        setTimeout(() => {
            const termInput = document.getElementById('terminal-in');
            if (termInput) termInput.focus();
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
        exePath,
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

    setRunning(false);
    log('\n[System] Process terminated.', 'system');

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
    count.classList.toggle('hidden', App.problems.length === 0);
    list.innerHTML = '';
    updateProblemSummaryUI();
    setActiveTabDiagnostics(App.problems);

    App.problems.forEach(p => {
        const el = document.createElement('div');
        el.className = 'problem-item ' + (['error', 'warning', 'note', 'info'].includes(p.type) ? p.type : 'info');
        const icon = p.type === 'error'
            ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
            : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>';
        el.innerHTML = `<span class="problem-icon">${icon}</span>
      <span class="problem-message">${escapeHtml(p.message)}</span>
      <span class="problem-location" style="margin-left:auto;opacity:0.7;color:var(--text-secondary)">${escapeHtml(String(p.file || '').split(/[/\\]/).pop())}:${Number(p.line) || 0}</span>`;
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

    TerminalManager.writeMessage(msg, hexColor, colorEnabled, normalizedType);
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

    TerminalManager.writeProgram(data, hexColor, colorEnabled, isError ? 'error' : '');
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
    if (inp.value && App.isRunning) {
        // Echo and send the whole block at once. One IPC round trip and one
        // log line per input line made a large paste take seconds.
        const text = inp.value.replace(/\r\n/g, '\n').replace(/\n+$/, '');
        log(text, 'input');
        await window.electronAPI.sendInput(text);
        inp.value = '';
        // drop the inline sizing the auto-grow left behind (see initTerminalUX)
        inp.style.height = '';
        inp.style.maxHeight = '';
        inp.scrollTop = 0;
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

    // Read from the terminal line buffer (xterm canvas isn't DOM-queryable).
    const lines = window.TerminalManager ? TerminalManager.getLines() : [];

    // Extract output from the latest run block (not the first one),
    // so reruns don't reuse stale output from older runs.
    let currentRunLines = [];
    let latestRunLines = [];
    let capturing = false;

    for (const line of lines) {
        const text = line.text;

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

        if (line.type !== 'input' && line.type !== 'system' && line.type !== 'info') {
            currentRunLines.push(text);
        }
    }

    // If process hasn't emitted exit yet, use currently capturing block.
    const actualText = (capturing ? currentRunLines : latestRunLines).join('\n');

    const diffDisplay = document.getElementById('expected-diff');
    const textarea = document.getElementById('expected-area');

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
        diffDisplay.innerHTML = `<div class="diff-hint">Click diff to edit expected output</div>${diff.html}`;
        diffDisplay.style.display = 'block';
        diffDisplay.title = 'Click to edit expected output';
        textarea.style.display = 'none';
    }
}

// Escape for HTML text AND quoted attributes (the old textContent/innerHTML
// trick left quotes alone, so it was unsafe inside title="…" / data-…="…").
function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
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
