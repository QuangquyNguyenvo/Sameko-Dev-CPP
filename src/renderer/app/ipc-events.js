/**
 * Sameko Dev C++ IDE - renderer: Events from the main process (file opened, process output/exit/stopped).
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// IPC HANDLERS
// ============================================================================
if (window.electronAPI) {
    const matchesRun = runId => runId === undefined || (currentRun?.id === runId && !currentRun.finished);
    window.electronAPI.onFileOpened?.(data => {
        const exists = App.tabs.find(t => t.path && pathKey(t.path) === pathKey(data.path));
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

    window.electronAPI.onProcessStarted?.(runId => {
        if (!matchesRun(runId)) return;
        setRunning(true);
        const input = currentRun?.initialInput;
        if (input === undefined) return;
        currentRun.initialInput = undefined;
        const lineLimit = 5000;
        let lines = 1;
        let end = input.length;
        for (let at = input.indexOf('\n'); at !== -1; at = input.indexOf('\n', at + 1)) {
            if (++lines === lineLimit + 1) end = at;
        }
        log(input.slice(0, end), 'input');
        if (lines > lineLimit) log(`... (${lines - lineLimit} more input lines hidden)`, 'system');
        // The main process sent the initial input, leaving stdin open for typed replies or EOF.
        armInputWaitHint(App.runSeq);
    });
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
    const finishProcessRun = data => {
        if (!matchesRun(data?.runId)) return;
        const run = currentRun;
        if (data?.runId !== undefined && data.outputChunks > run.outputChunks) {
            run.pendingExit = data;
            return;
        }
        if (run) {
            run.initialInput = undefined;
            run.finished = true;
            run.pendingExit = undefined;
        }
        if (App.runTimeout) {
            clearTimeout(App.runTimeout);
            App.runTimeout = null;
        }

        const code = typeof data === 'object' ? data.code : data;
        const execTime = typeof data === 'object' ? data.executionTime : null;
        const peakMemKB = typeof data === 'object' ? data.peakMemoryKB : null;
        // POSIX reports a crash as a signal with no exit code ("Exit: null" before).
        const signal = typeof data === 'object' ? data.signal : null;
        const exitLabel = code === null || code === undefined ? (signal || '?') : code;
        // Name and usual cause of a crash code (app/shared/exit-codes.js), e.g. 3221225725.
        const crash = typeof data === 'object' ? data.crash : null;


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


        // --- Exit: 0 ---
        // Time: 757ms | Memory: 2.4MB
        log(`\n--- Exit: ${exitLabel} ---`, code === 0 ? 'success' : 'warning');
        if (crash) {
            const t = (s) => (typeof I18n !== 'undefined' ? I18n.t(s) : s);
            log(`${t(crash.name)} (${crash.hex})`, 'error');
            if (crash.hint) log(crash.hint, 'info');
        }


        if (timeStr || memStr) {
            const parts = [];
            if (timeStr) parts.push('Time: ' + timeStr);
            if (memStr) parts.push('Memory: ' + memStr);
            log(parts.join(' | '), 'info');
        }
        logInteractiveSummary(currentRun);

        setRunning(false);
        showRunStats(timeStr, memStr);

        // Main reports the final chunk count, so judge once with all output for this tab.
        // A crash on POSIX has no code, only a signal: still not a clean exit.
        if (run) run.exitCode = code === null || code === undefined ? (signal || null) : code;
        if (document.getElementById('expected-area')) {
            compareOutput(run);
        }

        // Time and memory have their own status bar item (showRunStats).
        setStatus(code === 0 ? 'Done' : crash ? crash.name : `Exit: ${exitLabel}`, code === 0 ? 'success' : '');

        // Notify explorer: run finished
        const _exitTab = App.tabs.find(t => t.id === (run ? run.tabId : getPreferredTabId()));
        if (window.FileExplorer && _exitTab) window.FileExplorer.notifyBuildEvent(_exitTab.path, code === 0 ? 'run-exit-0' : 'run-exit-fail');
    };
    const receiveProcessOutput = (data, runId, isError) => {
        if (!matchesRun(runId)) return;
        if (isError) captureRunStderr(data);
        else captureRunOutput(data);
        logProgram(data, isError);
        const run = currentRun;
        if (runId === undefined || !run) return;
        run.outputChunks++;
        if (run.pendingExit && run.outputChunks >= run.pendingExit.outputChunks) finishProcessRun(run.pendingExit);
    };
    window.electronAPI.onProcessOutput?.((data, runId) => receiveProcessOutput(data, runId, false));
    window.electronAPI.onProcessError?.((data, runId) => receiveProcessOutput(data, runId, true));
    window.electronAPI.onProcessExit?.(finishProcessRun);
    window.electronAPI.onProcessStopped?.(runId => {
        if (!matchesRun(runId)) return;
        if (App.runTimeout) {
            clearTimeout(App.runTimeout);
            App.runTimeout = null;
        }
        log('\n--- Stopped ---', 'warning');
        if (currentRun) {
            currentRun.initialInput = undefined;
            currentRun.pendingExit = undefined;
            currentRun.finished = true;
            setTabOutput(currentRun.tabId, { text: runOutputText(currentRun), stderr: runStderrText(currentRun), state: 'stopped' });
        }
        setRunning(false);
        setStatus('Stopped', '');
    });

    window.electronAPI.onSystemMessage?.(data => {
        log(data.message, data.type || 'system');
    });
}
