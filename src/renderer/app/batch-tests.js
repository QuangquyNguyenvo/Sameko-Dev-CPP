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
    showTestInBoxes(null);
    switchToExpectedEdit();
}

function initBatchTesting() {
    const runAllBtn = document.getElementById('btn-run-all-tests');
    if (runAllBtn) {
        runAllBtn.addEventListener('click', runAllTests);
    }

    const problemsPanel = document.getElementById('problems-panel');
    if (problemsPanel) {
        problemsPanel.querySelectorAll('.panel-title[data-panel]').forEach(tab => {
            tab.addEventListener('click', () => switchProblemsTab(tab.dataset.panel));
        });
    }
}

function syncProblemStatusWithExplorer(tab = App.tabs.find(t => t.id === getPreferredTabId()), problem = ccProblem, results = batchTestResults) {
    if (!window.FileExplorer) return;
    if (!tab || !tab.path) return;

    if (!problem || !problem.tests || problem.tests.length === 0) return;

    // Check if we have results
    if (!results || results.length === 0) return;
    const ccProblem = problem;
    const batchTestResults = results;

    // Determine overall status
    let overallEvent = null;

    const totalCount = ccProblem.tests.filter(t => !t.disabled).length;

    // Find if there is any failure in the current results
    // The explorer has no MLE state; a memory verdict shows as a runtime error there.
    const hasRE = batchTestResults.some(r => r.status === 'RE' || r.status === 'MLE');
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

/** The current text of a tab, read from its own model (whichever pane shows it). */
function tabSourceText(tab) {
    return tab.model && !tab.model.isDisposed() ? tab.model.getValue() : (tab.content || '');
}

/**
 * Results of a test run belong to the tab that was tested. If that tab is still
 * focused they go to the live list; otherwise into the state it saved when the
 * user switched away, so they never land on another tab's tests.
 * @returns {boolean} true when the live list was updated
 */
function storeTestResults(tab, problem, results) {
    if (getPreferredTabId() === tab.id && ccProblem === problem) {
        batchTestResults = results;
        return true;
    }
    if (tab.testState && tab.testState.problem === problem) {
        tab.testState.results = results;
    }
    return false;
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

    // Everything a run depends on is taken now: the user may switch tabs while
    // g++ is busy, and the program must be judged with its own tests.
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    if (!tab) {
        log('No file is currently open!', 'error');
        return;
    }
    if (!isBuildableTab(tab)) {
        log(notBuildableMessage(tab), 'warning');
        return;
    }
    const changedOnDisk = externalChangeBlocksBuild(tab.path);
    if (changedOnDisk) { log(changedOnDisk, 'warning'); return; }
    const problem = ccProblem;
    const tests = problem.tests.slice();
    // Positions of the tests that are turned on; results keep each test's own number.
    const order = tests.map((_, i) => i).filter(i => !tests[i].disabled);
    if (!order.length) {
        log('Every test is turned off. Tick one in the TESTS list.', 'warning');
        return;
    }
    const content = tabSourceText(tab);

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
    if (!App.showTerm && !DockingState.terminalDocked && App.settings.execution.showTerminalOnRun !== false) {
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
        const compileFlags = buildCompileFlags({ judge: true });

        const compileResult = await window.electronAPI.compile({
            filePath: tab.path,
            untitledId: tab.path ? '' : tab.id,
            untitledExt: tab.path ? '' : fileExtension(tab.name),
            content: content,
            flags: compileFlags,
            singleFileMode: App.settings.compiler.singleFileMode !== false,
            useLLD: App.settings.compiler.useLLD !== false,
            realtimeOutput: App.settings.execution.realtimeOutput !== false,
            variant: 'judge'
        });

        if (!compileResult.success) {
            log('Compile Error!', 'error');
            log(compileResult.error, 'error');
            setStatus('Compile Error', 'error');
            return;
        }

        App.exePath = compileResult.outputPath;
        tab.exePath = compileResult.outputPath;
        log(compileResult.cached ? 'Source unchanged: reused the last build' : `Compiled in ${compileResult.time}ms`, 'success');

        // The problem's checker (checker.js): a testlib program is compiled now.
        const judging = await prepareChecker(problem);
        if (judging.error) {
            log(`${judging.error.title}!`, 'error');
            if (judging.error.detail) log(judging.error.detail, 'error');
            setStatus(judging.error.title, 'error');
            return;
        }
        const judge = { ...judgeOptions(problem), ...judging };

        // Input and output files, or a testlib interactor (test-manager.js).
        const runOptions = await problemRunOptions(problem, content);
        if (runOptions.error) {
            log(`${runOptions.error.title}!`, 'error');
            if (runOptions.error.detail) log(runOptions.error.detail, 'error');
            setStatus(runOptions.error.title, 'error');
            return;
        }
        if (runOptions.fileIO) {
            log(I18n.t('Judging through files: {0}', [runOptions.fileIO.input, runOptions.fileIO.output].filter(Boolean).join(' → ')), 'info');
        }

        const timeLimit = problem.timeLimit || (App.settings.execution.timeLimitSeconds * 1000) || 3000;


        const totalTests = order.length;
        let passedCount = 0;

        const lastSlash = tab.path ? Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\')) : -1;
        const sourceDir = lastSlash !== -1 ? tab.path.substring(0, lastSlash) : null;

        // Warm-up run (not counted) to reduce first-test cold-start skew on Windows.
        // This improves consistency of displayed timings between test cases.
        if (totalTests > 0 && !runOptions.interactor) {
            try {
                setStatus('Warming up...', '');
                const warmupTest = tests[order[0]] || { input: '' };
                await window.electronAPI.runTest({
                    exePath: tab.exePath,
                    ...testRunArgs(warmupTest),
                    expectedOutput: null,
                    expectedPath: undefined,
                    timeLimit: timeLimit,
                    ...judgeOptions(problem),
                    ...runOptions,
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
        const exePath = tab.exePath;
        const poolSize = App.settings.execution.parallelTests === false
            ? 1
            : Math.max(1, Math.min(4, totalTests, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
        const results = new Array(totalTests);
        let nextIndex = 0;
        let finished = 0;
        const worker = async () => {
            while (nextIndex < totalTests) {
                const position = nextIndex++;
                const i = order[position];
                const test = tests[i];
                const result = await window.electronAPI.runTest({
                    exePath,
                    ...testRunArgs(test),
                    timeLimit: timeLimit,
                    ...judge,
                    ...runOptions,
                    cwd: sourceDir,
                    debug: true,
                    testMeta: { index: i, name: `Test ${i + 1}` }
                });
                result.testIndex = i;
                result.testName = `Test ${i + 1}`;
                result.actualOutput = result.output ?? '';
                results[position] = result;
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
            for (let position = 0; position < totalTests; position++) {
                const i = order[position];
                const first = results[position];
                if (first.status !== 'TLE' && !(first.executionTime > timeLimit * 0.6)) continue;
                setStatus(`Re-checking test ${i + 1} alone...`, '');
                const again = await window.electronAPI.runTest({
                    exePath,
                    ...testRunArgs(tests[i]),
                    timeLimit: timeLimit,
                    ...judge,
                    ...runOptions,
                    cwd: sourceDir,
                    debug: true,
                    testMeta: { index: i, name: `Test ${i + 1}` }
                });
                again.testIndex = i;
                again.testName = `Test ${i + 1}`;
                again.actualOutput = again.output ?? '';
                results[position] = again;
            }
        }

        // Report in test order, whatever order they finished in.
        const finalResults = [];
        let ranCount = 0;
        for (let position = 0; position < totalTests; position++) {
            const i = order[position];
            const result = results[position];
            finalResults.push(result);

            if (result.status === 'AC') {
                passedCount++;
                log(`  Test ${i + 1}: AC (${result.executionTime}ms)`, 'success');
            } else if (result.status === 'RAN') {
                ranCount++;
                log(`  Test ${i + 1}: RAN (${result.executionTime}ms), no expected output`, 'info');
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
        const notJudged = ranCount ? `, ${ranCount} not judged (no expected output)` : '';
        log(`\n=== ${tab.name}: ${passedCount}/${totalTests} AC${notJudged} ===`, allPassed ? 'success' : 'warning');
        setStatus(`${passedCount}/${totalTests} AC`, allPassed ? 'success' : '');

        // Update UI
        if (storeTestResults(tab, problem, finalResults)) {
            renderTestResults();
            if (typeof showTestsTab === 'function') showTestsTab();
        }

        // Sync status with explorer
        syncProblemStatusWithExplorer(tab, problem, finalResults);

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

    const problem = ccProblem;
    const test = problem.tests[testIndex];
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    if (!tab) {
        log('No file is currently open!', 'error');
        return;
    }
    if (!isBuildableTab(tab)) {
        log(notBuildableMessage(tab), 'warning');
        return;
    }

    const changedOnDisk = externalChangeBlocksBuild(tab.path);
    if (changedOnDisk) { log(changedOnDisk, 'warning'); return; }

    const runBtn = document.querySelector(`.test-run-btn[data-run-index="${testIndex}"]`);
    if (runBtn) runBtn.classList.add('running');
    isBatchTesting = true;

    try {
        setStatus(`Single test ${testIndex + 1}: compiling...`, '');
        const content = tabSourceText(tab);
        const compileFlags = buildCompileFlags({ judge: true });
        const compileResult = await window.electronAPI.compile({
            filePath: tab.path,
            untitledId: tab.path ? '' : tab.id,
            untitledExt: tab.path ? '' : fileExtension(tab.name),
            content: content,
            flags: compileFlags,
            singleFileMode: App.settings.compiler.singleFileMode !== false,
            useLLD: App.settings.compiler.useLLD !== false,
            realtimeOutput: App.settings.execution.realtimeOutput !== false,
            variant: 'judge'
        });

        if (!compileResult.success) {
            log('Compile Error!', 'error');
            log(compileResult.error, 'error');
            setStatus('Compile Error', 'error');
            return;
        }

        App.exePath = compileResult.outputPath;
        tab.exePath = compileResult.outputPath;

        const judging = await prepareChecker(problem);
        if (judging.error) {
            log(`${judging.error.title}!`, 'error');
            if (judging.error.detail) log(judging.error.detail, 'error');
            setStatus(judging.error.title, 'error');
            return;
        }

        const runOptions = await problemRunOptions(problem, content);
        if (runOptions.error) {
            log(`${runOptions.error.title}!`, 'error');
            if (runOptions.error.detail) log(runOptions.error.detail, 'error');
            setStatus(runOptions.error.title, 'error');
            return;
        }

        const timeLimit = problem.timeLimit || (App.settings.execution.timeLimitSeconds * 1000) || 3000;
        const lastSlash = tab.path ? Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\')) : -1;
        const sourceDir = lastSlash !== -1 ? tab.path.substring(0, lastSlash) : null;

        setStatus(`Running test ${testIndex + 1}...`, '');
        const result = await window.electronAPI.runTest({
            exePath: tab.exePath,
            ...testRunArgs(test),
            timeLimit: timeLimit,
            ...judgeOptions(problem),
            ...judging,
            ...runOptions,
            cwd: sourceDir,
            debug: true,
            testMeta: { index: testIndex, name: `Test ${testIndex + 1}` }
        });

        result.testIndex = testIndex;
        result.testName = `Test ${testIndex + 1}`;
        result.actualOutput = result.output ?? '';

        const live = getPreferredTabId() === tab.id && ccProblem === problem;
        const owned = live ? batchTestResults : (tab.testState && tab.testState.problem === problem ? tab.testState.results : null);
        const list = Array.isArray(owned) ? owned.slice() : [];
        const existingIdx = list.findIndex(r => r.testIndex === testIndex);
        if (existingIdx >= 0) list.splice(existingIdx, 1, result);
        else list.push(result);

        if (storeTestResults(tab, problem, list)) {
            renderTestResults();
            switchTestCase(testIndex);
        }

        const timeStr = result.executionTime >= 1000
            ? (result.executionTime / 1000).toFixed(2) + 's'
            : result.executionTime + 'ms';

        if (result.status === 'AC') {
            log(`Single Test ${testIndex + 1}: AC (${timeStr})`, 'success');
            setStatus(`Test ${testIndex + 1}: AC`, 'success');
        } else if (result.status === 'RAN') {
            log(`Single Test ${testIndex + 1}: RAN (${timeStr}), no expected output`, 'info');
            setStatus(`Test ${testIndex + 1}: RAN`, '');
        } else {
            log(`Single Test ${testIndex + 1}: ${result.status} (${timeStr})`, result.status === 'WA' ? 'error' : 'warning');
            setStatus(`Test ${testIndex + 1}: ${result.status}`, 'warning');
        }

        // Sync status with explorer
        syncProblemStatusWithExplorer(tab, problem, list);
    } catch (e) {
        log(`Single test error: ${e.message}`, 'error');
        setStatus('Single Test Error', 'error');
    } finally {
        isBatchTesting = false;
        if (runBtn) runBtn.classList.remove('running');
    }
}

/** "23 ms", "1.01 s" for a test's run time. */
function formatTestTime(ms) {
    return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
}

/** Highlights the TESTS row of the test shown in the Input/Expected boxes (ccTestIndex). */
function markSelectedTestRow() {
    document.querySelectorAll('#tests-results-list .test-result-item').forEach(item => {
        item.classList.toggle('selected', Number(item.dataset.index) === ccTestIndex);
    });
}

function renderTestResults() {
    const container = document.getElementById('tests-results-list');
    const countEl = document.getElementById('test-results-count');
    const problemsPanel = document.getElementById('problems-panel');

    if (!container) return;

    // Use ccProblem.tests as base if available, otherwise fall back to batch results
    const tests = ccProblem && ccProblem.tests ? ccProblem.tests : [];
    const results = batchTestResults || [];
    const total = tests.filter(t => !t.disabled).length;   // the tests a run covers

    // Calculate passed from results that match existing tests
    // Note: batchTestResults might be cleared or partial.
    const passed = results.filter(r => r.status === 'AC').length;
    const notJudged = results.filter(r => r.status === 'RAN').length;   // no expected output
    const executed = results.length;


    if (countEl) {
        // Show Passed/Total if run, or just Total count if not
        if (executed > 0) {
            countEl.textContent = `${passed}/${total}`;
        } else {
            countEl.textContent = String(total);
        }
        countEl.style.display = tests.length > 0 ? 'inline' : 'none';
    }

    // Auto-expand panel when we have test cases (like docked terminal)
    if (problemsPanel) {
        if (tests.length > 0) {
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
        // One segment per test, in its verdict's color.
        const bar = tests.flatMap((t, idx) => {
            const r = results.find(x => x.testIndex === idx);
            if (t.disabled && !r) return [];
            return [`<span class="${r ? escHtml(r.status) : 'pending'}"></span>`];
        }).join('');
        html += `
                <div class="${summaryClass}">
                    <span class="test-summary-ratio">${passed}/${total}</span>
                    <span class="test-summary-stat passed">✓ ${passed} passed</span>
                    <span class="test-summary-stat failed">✗ ${executed - passed - notJudged} failed</span>
                    ${notJudged ? `<span class="test-summary-stat">${notJudged} not judged</span>` : ''}
                    <span class="test-summary-stat total">${formatTestTime(totalTime)}</span>
                    <div class="test-summary-bar">${bar}</div>
                </div>
                `;
    }

    // List Tests
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    tests.forEach((test, idx) => {
        // Find result for this test index
        const result = results.find(r => r.testIndex === idx);

        let status = test.disabled ? 'OFF' : 'PENDING';
        let timeStr = '';
        let memStr = '';
        let details = '';
        let statusClass = test.disabled ? 'off' : 'pending';

        if (result) {
            status = result.status;
            statusClass = result.status;
            timeStr = formatTestTime(result.executionTime || 0);
            if (result.peakMemoryKB > 0) memStr = (result.peakMemoryKB / 1024).toFixed(1) + ' MB';
            details = translateTestDetails(result);
        } else {
            // Format sample inputs for display if no result
            const inputPreview = (test.input || '').replace(/\n/g, ' ').substring(0, 20);
            details = test.inputPath ? `File: ${test.source || test.inputPath}`
                : inputPreview ? `In: ${inputPreview}...` : 'Empty input';
        }

        const isAC = result && result.status === 'AC';
        const selected = typeof ccTestIndex === 'number' && ccTestIndex === idx;
        const itemClass = `test-result-item status-${escHtml(statusClass)}${isAC ? ' item-ac' : ''}${test.disabled ? ' item-off' : ''}${selected ? ' selected' : ''}`;

        html += `
                <div class="${itemClass}" data-index="${idx}">
                    <input type="checkbox" class="test-enable" data-enable-index="${idx}" ${test.disabled ? '' : 'checked'}
                        title="Include in Run All" aria-label="Include in Run All">
                    <span class="test-result-status ${escHtml(statusClass)}">${escHtml(status)}</span>
                    <div class="test-result-info">
                        <span class="test-result-title">Test ${idx + 1}</span>
                        <span class="test-result-details" title="${escHtml(details)}">${escHtml(details)}</span>
                    </div>
                    <span class="test-result-meta">
                        <span class="test-result-time">${timeStr}</span>
                        <span class="test-result-mem">${memStr}</span>
                    </span>
                    <div class="test-row-actions">
                    <button class="test-run-btn" data-run-index="${idx}" title="Run this test case">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="8 5 19 12 8 19 8 5"></polygon>
                        </svg>
                    </button>
                    ${TestRowTools.buttons(tab, result)}
                    ${result && result.status !== 'AC' && typeof (result.actualOutput ?? result.output) === 'string' ? `<button type="button" class="test-tool-btn test-use-output" data-use-output="${idx}" title="Use this output as expected" aria-label="Use this output as expected">
                        <svg class="ico" width="16" height="16" viewBox="0 0 256 256" aria-hidden="true"><use href="#i-download-simple"/></svg>
                    </button>` : ''}
                    <button class="test-delete-btn" data-delete-index="${idx}" title="Delete this test case">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    </div>
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
    container.classList.toggle('hide-ac', !!ccProblem?.hideAC);

    container.querySelectorAll('.test-enable').forEach(box => {
        box.addEventListener('click', e => e.stopPropagation());
        box.addEventListener('change', () => setTestEnabled(Number(box.dataset.enableIndex), box.checked));
    });
    container.querySelectorAll('.test-use-output').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            useOutputAsExpected(Number(btn.dataset.useOutput));
        });
    });

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

    container.querySelectorAll('.test-tool-btn[data-test-tool]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            return TestRowTools.runAction(btn.dataset.testTool, Number(btn.closest('.test-result-item').dataset.index));
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

/**
 * How a test is judged besides its time limit: the problem's memory limit (Competitive Companion
 * sends one), else the one in Settings › Execution (0 = none); and the output comparison.
 */
function judgeOptions(problem) {
    const fromProblem = Number(problem && problem.memoryLimit);
    const fromSettings = Number(App.settings.execution.memoryLimitMB ?? 256);
    return {
        memoryLimit: fromProblem > 0 ? fromProblem : (fromSettings > 0 ? fromSettings : 0),
        compare: typeof checkerCompareMode === 'function' ? checkerCompareMode(problem) : 'tokens'
    };
}

/**
 * A test's details in the interface language. They are built in the main process from fixed
 * English pieces (crash name and cause from app/shared/exit-codes.js, verdict texts), which have
 * locale entries; the values around them (exit code, stderr) stay as they are.
 */
function translateTestDetails(result) {
    let text = result.details || '';
    if (typeof I18n === 'undefined' || !text) return text;
    // The two antivirus texts are whole templates with the folder in them (locale files).
    if (/^(The program built a moment ago is gone|Windows or an antivirus blocked)/.test(text)) return I18n.t(text);
    const pieces = [result.crash && result.crash.name, result.crash && result.crash.hint, result.startErrorMessage,
        'Runtime error', 'Time limit exceeded', 'Memory limit exceeded', 'No expected output to compare with',
        'Output limit exceeded (more than 16 MB printed)', 'Wrong answer', 'Partial points', 'Checker failed'];
    for (const piece of pieces) {
        if (piece && text.includes(piece)) text = text.replace(piece, I18n.t(piece));
    }
    return text;
}

/**
 * @param {{judge?: boolean}} [options] judge: for Run All Tests and single tests. Judges compile
 *   with -O2, and STL-heavy code runs ~3x slower at -O0 (sort + set + map + Dijkstra on n = 2e5
 *   with the bundled GCC: 760-870 ms at -O0, 270-330 ms at -O2), so a time verdict from the
 *   default -O0 build misled. The tests get -O2 unless a higher level is set.
 */
function buildCompileFlags(options = {}) {
    const flags = [];
    if (App.settings.compiler.cppStandard) {
        flags.push(`-std=${App.settings.compiler.cppStandard}`);
        if (['c++23', 'c++26'].includes(App.settings.compiler.cppStandard)) {
            flags.push('-lstdc++exp');
        }
    }

    const fastDebugMode = App.settings.compiler.fastDebugMode !== false;
    const hasUserOptimization = !!App.settings.compiler.optimization;

    if (options.judge && (!hasUserOptimization || App.settings.compiler.optimization === '-O0')) {
        flags.push('-O2');
    } else if (hasUserOptimization) {
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

    // Windows gives a program 2 MB of stack, so a DFS 100,000 levels deep (a path-shaped tree,
    // n = 1e5) crashes with 0xC00000FD here while Codeforces, which allows 256 MB, accepts it.
    // Only address space is reserved; memory is used as the stack actually grows. Before the
    // extra flags, so a user's own -Wl,--stack=… wins (ld takes the last one).
    // macOS gives 8 MB and its linker spells the option differently. Linux takes the stack size
    // from a limit, which the run launcher sets (run-launcher.js), so no flag is needed there.
    if (App.settings.compiler.largeStack !== false) {
        if (IS_MAC_UI) flags.push('-Wl,-stack_size,0x10000000');
        else if (/^win/i.test(navigator.platform || '')) flags.push('-Wl,--stack=268435456');
    }

    if (App.settings.compiler.extraFlags) {
        flags.push(App.settings.compiler.extraFlags.trim());
    }

    return flags.join(' ');
}


initBatchTesting();
