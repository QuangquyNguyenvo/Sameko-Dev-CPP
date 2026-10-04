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
    window.electronAPI.onProcessOutput?.(d => logProgram(d, false));
    window.electronAPI.onProcessError?.(d => logProgram(d, true));
    window.electronAPI.onProcessExit?.(data => {
        if (App.runTimeout) {
            clearTimeout(App.runTimeout);
            App.runTimeout = null;
        }

        const code = typeof data === 'object' ? data.code : data;
        const execTime = typeof data === 'object' ? data.executionTime : null;
        const peakMemKB = typeof data === 'object' ? data.peakMemoryKB : null;


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
        log(`\n--- Exit: ${code} ---`, code === 0 ? 'success' : 'warning');


        if (timeStr || memStr) {
            const parts = [];
            if (timeStr) parts.push('Time: ' + timeStr);
            if (memStr) parts.push('Memory: ' + memStr);
            log(parts.join(' | '), 'info');
        }

        setRunning(false);
        showRunStats(timeStr, memStr);

        // Refresh diff for the latest run if expected panel is present.
        if (document.getElementById('expected-area')) {
            compareOutput();
        }

        // Time and memory have their own status bar item (showRunStats).
        setStatus(code === 0 ? 'Done' : `Exit: ${code}`, code === 0 ? 'success' : '');
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
        setTabOutput(getPreferredTabId(), { text: latestRunOutput(), state: 'stopped' });
        setRunning(false);
        setStatus('Stopped', '');
    });

    window.electronAPI.onSystemMessage?.(data => {
        log(data.message, data.type || 'system');
    });
}
