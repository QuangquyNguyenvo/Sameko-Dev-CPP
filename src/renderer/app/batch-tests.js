/**
 * Sameko Dev C++ IDE - renderer: Run All Tests, single test, results list, buildCompileFlags.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// BATCH TESTING - Run All Test Cases
// ============================================================================
let batchTestResults = [];
let isBatchTesting = false;

function resetTestRunResults() {
    batchTestResults = [];
    switchToExpectedEdit();
}

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

function syncProblemStatusWithExplorer() {
    if (!window.FileExplorer || !App.activeTabId) return;
    const tab = App.tabs.find(t => t.id === App.activeTabId);
    if (!tab || !tab.path) return;

    if (!ccProblem || !ccProblem.tests || ccProblem.tests.length === 0) return;

    // Check if we have results
    if (batchTestResults.length === 0) return;

    // Determine overall status
    let overallEvent = null;

    const totalCount = ccProblem.tests.length;

    // Find if there is any failure in the current results
    const hasRE = batchTestResults.some(r => r.status === 'RE');
    const hasTLE = batchTestResults.some(r => r.status === 'TLE');
    const hasWA = batchTestResults.some(r => r.status === 'WA');
    const allAC = batchTestResults.filter(r => r.status === 'AC').length === totalCount;

    if (hasRE) {
        overallEvent = 'judge-re';
    } else if (hasTLE) {
        overallEvent = 'judge-tle';
    } else if (hasWA) {
        overallEvent = 'judge-wa';
    } else if (allAC) {
        overallEvent = 'judge-ac';
    } else {
        // Some tests run and passed, but not all. Keep status as testing/run-start.
        overallEvent = 'run-start';
    }

    if (overallEvent) {
        window.FileExplorer.notifyBuildEvent(tab.path, overallEvent);
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

    if (blockedByDebugSession('Running tests')) return;

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
            singleFileMode: App.settings.compiler.singleFileMode !== false,
            useLLD: App.settings.compiler.useLLD !== false,
            realtimeOutput: App.settings.execution.realtimeOutput !== false
        });

        if (!compileResult.success) {
            log('Compile Error!', 'error');
            log(compileResult.error, 'error');
            setStatus('Compile Error', 'error');
            return;
        }

        App.exePath = compileResult.outputPath;
        tab.exePath = compileResult.outputPath;
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

        // Run the tests on a small pool of workers instead of one after the
        // other. Each test is its own process and measures its own time, so
        // running a few side by side changes the total, not the per-test
        // numbers — as long as the pool stays well below the core count.
        const tests = ccProblem.tests.slice();
        const exePath = App.exePath;
        const poolSize = App.settings.execution.parallelTests === false
            ? 1
            : Math.max(1, Math.min(4, totalTests, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
        const results = new Array(totalTests);
        let nextIndex = 0;
        let finished = 0;
        const worker = async () => {
            while (nextIndex < totalTests) {
                const i = nextIndex++;
                const test = tests[i];
                const result = await window.electronAPI.runTest({
                    exePath,
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
                results[i] = result;
                finished++;
                setStatus(`Testing ${finished}/${totalTests}...`, '');
            }
        };
        setStatus(`Testing 0/${totalTests}...`, '');
        await Promise.all(Array.from({ length: poolSize }, worker));

        // Tests sharing the machine run a little slower (memory-heavy ones by
        // up to ~35%). So a verdict that hinges on time is never taken from a
        // crowded run: anything that timed out or came close to the limit is
        // run again on its own and that result is the one reported.
        if (poolSize > 1) {
            for (let i = 0; i < totalTests; i++) {
                const first = results[i];
                if (first.status !== 'TLE' && !(first.executionTime > timeLimit * 0.6)) continue;
                setStatus(`Re-checking test ${i + 1} alone...`, '');
                const again = await window.electronAPI.runTest({
                    exePath,
                    input: tests[i].input || '',
                    expectedOutput: tests[i].output || '',
                    timeLimit: timeLimit,
                    cwd: sourceDir,
                    debug: true,
                    testMeta: { index: i, name: `Test ${i + 1}` }
                });
                again.testIndex = i;
                again.testName = `Test ${i + 1}`;
                again.actualOutput = again.output ?? '';
                results[i] = again;
            }
        }

        // Report in test order, whatever order they finished in.
        for (let i = 0; i < totalTests; i++) {
            const result = results[i];
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

        // Sync status with explorer
        syncProblemStatusWithExplorer();

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
        log('Test case does not exist.', 'warning');
        return;
    }

    if (isBatchTesting) {
        log('Batch tests are running. Please wait.', 'warning');
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
            singleFileMode: App.settings.compiler.singleFileMode !== false,
            useLLD: App.settings.compiler.useLLD !== false,
            realtimeOutput: App.settings.execution.realtimeOutput !== false
        });

        if (!compileResult.success) {
            log('Compile Error!', 'error');
            log(compileResult.error, 'error');
            setStatus('Compile Error', 'error');
            return;
        }

        App.exePath = compileResult.outputPath;
        tab.exePath = compileResult.outputPath;

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

        // Sync status with explorer
        syncProblemStatusWithExplorer();
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
        const totalTime = results.reduce((s, r) => s + (r.executionTime || 0), 0);
        const summaryClass = allPassed ? 'test-results-summary all-passed' : 'test-results-summary has-failed';
        html += `
                <div class="${summaryClass}">
                    <span class="test-summary-ratio">${passed}/${total}</span>
                    <span class="test-summary-stat passed">✓ ${passed} passed</span>
                    <span class="test-summary-stat failed">✗ ${executed - passed} failed</span>
                    <span class="test-summary-stat total">${totalTime}ms</span>
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
        const itemClass = `test-result-item status-${escapeHtml(statusClass)}${isAC ? ' item-ac' : ''}`;

        html += `
                <div class="${itemClass}" data-index="${idx}">
                    <span class="test-result-status ${escapeHtml(statusClass)}">${escapeHtml(status)}</span>
                    <div class="test-result-info">
                        <span class="test-result-title">Test ${idx + 1}</span>
                        <span class="test-result-details">${escapeHtml(details)}</span>
                    </div>
                    <span class="test-result-time">${timeStr}</span>
                    <button class="test-run-btn" data-run-index="${idx}" title="Run this test case">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="8 5 19 12 8 19 8 5"></polygon>
                        </svg>
                    </button>
                    <button class="test-delete-btn" data-delete-index="${idx}" title="Delete this test case">
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
                Add New Test Case
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
        if (['c++23', 'c++26'].includes(App.settings.compiler.cppStandard)) {
            flags.push('-lstdc++exp');
        }
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

    if (App.settings.compiler.extraFlags) {
        flags.push(App.settings.compiler.extraFlags.trim());
    }

    return flags.join(' ');
}


initBatchTesting();
