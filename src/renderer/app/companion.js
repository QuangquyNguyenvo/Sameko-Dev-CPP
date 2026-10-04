/**
 * Sameko Dev C++ IDE - renderer: Competitive Companion, test-case state per tab, test navigation.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// COMPETITIVE COMPANION
// ============================================================================
let ccConnected = false;
// The problem/test cases, selected test and last results of the ACTIVE tab.
// They are swapped in and out by setActive() (saveTestStateToTab /
// loadTestStateFromTab), so each tab keeps its own set.
let ccProblem = null;
let ccTestIndex = 0;
let ccHasReceivedProblem = false;

function saveTestStateToTab(tab) {
    if (!tab) return;
    tab.testState = (ccProblem || batchTestResults.length)
        ? { problem: ccProblem, index: ccTestIndex, results: batchTestResults }
        : null;
}

function loadTestStateFromTab(tab) {
    const st = tab && tab.testState;
    ccProblem = st ? st.problem : null;
    ccTestIndex = st ? (st.index || 0) : 0;
    batchTestResults = st ? (st.results || []) : [];
    const count = ccProblem?.tests?.length || 0;
    if (count > 0) ccTestIndex = Math.min(ccTestIndex, count - 1);
    updateTestNavUI();
    updateDockedTestNavUI();
    renderTestResults();

    // Show the selected test (and its last result) without taking keyboard
    // focus away from the editor — this runs on every tab switch.
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    const diffDisplay = document.getElementById('expected-diff');
    if (count > 0) {
        const test = ccProblem.tests[ccTestIndex];
        if (inputArea) inputArea.value = test.input || '';
        if (expectedArea) expectedArea.value = test.output || '';
        const result = batchTestResults.find(r => r.testIndex === ccTestIndex);
        const actual = result?.actualOutput ?? result?.output;
        if (result && actual !== undefined) {
            showTestResultDiff(test.output || '', actual);
            return;
        }
    }
    if (expectedArea && diffDisplay) {
        expectedArea.style.display = 'block';
        diffDisplay.style.display = 'none';
    }
}

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

    const importTargetSelect = document.getElementById('cc-import-target');
    const importMergeSelect = document.getElementById('cc-import-merge');
    const importMergeRow = document.getElementById('cc-import-merge-row');

    if (!App.settings.oj) App.settings.oj = {};
    if (!App.settings.oj.importTarget) App.settings.oj.importTarget = 'new-tab';
    if (!App.settings.oj.importMerge) App.settings.oj.importMerge = 'replace';

    const updateCCImportUI = () => {
        if (importTargetSelect) importTargetSelect.value = App.settings.oj.importTarget || 'new-tab';
        if (importMergeSelect) importMergeSelect.value = App.settings.oj.importMerge || 'replace';
        if (importMergeRow) {
            importMergeRow.style.display = (App.settings.oj.importTarget === 'current-tab') ? 'flex' : 'none';
        }
    };

    importTargetSelect?.addEventListener('change', () => {
        App.settings.oj.importTarget = importTargetSelect.value;
        updateCCImportUI();
        saveSettings();
    });

    importMergeSelect?.addEventListener('change', () => {
        App.settings.oj.importMerge = importMergeSelect.value;
        saveSettings();
    });

    updateCCImportUI();

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
    resetTestRunResults();
    ccTestIndex = ccProblem.tests.length - 1;
    switchTestCase(ccTestIndex);
    updateTestNavUI();
    renderTestResults(); // Refresh list
    log(`Test Case ${ccTestIndex + 1} added`, 'info');
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
    resetTestRunResults();

    if (ccProblem.tests.length === 0) {
        document.getElementById('input-area').value = '';
        document.getElementById('expected-area').value = '';
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
    resetTestRunResults();

    if (ccProblem.tests.length === 0) {
        document.getElementById('input-area').value = '';
        document.getElementById('expected-area').value = '';
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

    resetTestRunResults();
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

async function handleProblemReceived(problem) {

    if (!ccHasReceivedProblem) {
        ccHasReceivedProblem = true;
        if (!App.settings.oj) App.settings.oj = {};
        App.settings.oj.verified = true;
        saveSettings();
    }

    const importTarget = App.settings.oj?.importTarget || 'new-tab';
    const importMerge = App.settings.oj?.importMerge || 'replace';
    const useCurrentTab = importTarget === 'current-tab' && App.activeTabId && App.tabs.length > 0;

    if (useCurrentTab) {
        // Import tests into the current active tab \u2014 don't create a new tab
        if (importMerge === 'append' && ccProblem && ccProblem.tests) {
            // Append new tests to existing ones
            ccProblem.tests = ccProblem.tests.concat(problem.tests || []);
            ccProblem.name = problem.name;
            ccProblem.timeLimit = problem.timeLimit;
            ccProblem.memoryLimit = problem.memoryLimit;
            ccProblem.url = problem.url;
            ccProblem.group = problem.group;
        } else {
            // Replace all tests
            ccProblem = problem;
        }
        ccTestIndex = 0;
    } else {
        // Create a new tab that owns this problem's tests (setActive() below
        // makes them the live ones).

        const removeVietnameseDiacritics = (str) => {
            return str
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\u0111/g, 'd')
                .replace(/\u0110/g, 'D');
        };

        const safeName = removeVietnameseDiacritics(problem.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .substring(0, 50);
        const fileName = safeName + '.cpp';

        const id = 'tab_' + Date.now();
        const template = App.settings.template?.code || DEFAULT_CODE;

        let targetPath = null;
        let finalFileName = fileName;

        if (typeof FileExplorer !== 'undefined' && FileExplorer.currentFolder) {
            // Find or create "Fetched Problems" category
            let targetCategory = FileExplorer.categories.find(c => c.name === 'Fetched Problems');
            if (!targetCategory) {
                const catId = 'cat_' + Date.now();
                const colors = ['#ff9800', '#2196f3', '#4caf50', '#e91e63', '#9c27b0', '#00bcd4'];
                const randomColor = colors[Math.floor(Math.random() * colors.length)];
                const folderPath = `${FileExplorer.currentFolder}/Fetched Problems`.replace(/\\/g, '/');

                // Create physical directory
                try {
                    if (window.electronAPI && window.electronAPI.createDirectory) {
                        await window.electronAPI.createDirectory(folderPath);
                    }
                } catch (err) {
                    console.error('Failed to create Fetched Problems folder:', err);
                }

                targetCategory = {
                    id: catId,
                    name: 'Fetched Problems',
                    type: 'collection',
                    color: randomColor,
                    folderPath: folderPath,
                    items: [],
                    createdAt: Date.now()
                };
                FileExplorer.categories.push(targetCategory);
                FileExplorer.saveState();
            }

            const folder = targetCategory.folderPath || FileExplorer.currentFolder;
            let counter = 1;
            let checkPath = `${folder}/${fileName}`.replace(/\\/g, '/');
            let fileExists = true;
            while (fileExists) {
                try {
                    await window.electronAPI.readFile(checkPath);
                    counter++;
                    finalFileName = `${safeName}_${counter}.cpp`;
                    checkPath = `${folder}/${finalFileName}`.replace(/\\/g, '/');
                } catch (err) {
                    fileExists = false;
                }
            }
            targetPath = checkPath;

            // Save file physically to disk
            try {
                const r = await window.electronAPI.saveFile({ path: targetPath, content: template });
                if (r.success) {
                    // Add to category in file explorer
                    FileExplorer.addFileToCategory(targetCategory.id, targetPath, finalFileName.replace(/\.[^.]+$/, ''));
                    FileExplorer.saveState();

                    // Expose to file watcher
                    if (typeof startFileWatch === 'function') {
                        startFileWatch(targetPath);
                    }

                    // If FileExplorer is open, refresh it
                    if (typeof FileExplorer.refreshTree === 'function') {
                        await FileExplorer.refreshTree();
                    }
                }
            } catch (err) {
                console.error('Failed to auto-save fetched problem:', err);
                targetPath = null; // fallback to untitled tab
            }
        }

        App.tabs.push({
            id,
            name: targetPath ? finalFileName : fileName,
            path: targetPath,
            untitledHistoryKey: targetPath ? null : createUntitledHistoryKey(),
            content: template,
            original: targetPath ? template : '',
            modified: !targetPath,
            testState: { problem, index: 0, results: [] }
        });

        // setActive() saves the tab being left (text, scroll position, I/O
        // panels) and attaches this tab's own model; assigning activeTabId
        // directly used to skip all of that.
        setActive(id);
        updateUI();
    }

    // Load first test into UI
    const testCount = ccProblem?.tests?.length || 0;
    if (testCount > 0) {
        const inputArea = document.getElementById('input-area');
        const expectedArea = document.getElementById('expected-area');

        if (inputArea) inputArea.value = ccProblem.tests[0].input || '';
        if (expectedArea) expectedArea.value = ccProblem.tests[0].output || '';
    }

    // Clear any stale Expected/Actual comparison from a previous problem/run
    resetTestRunResults();

    updateTestNavUI();
    renderTestResults(); // Initialize list

    if (!App.showIO) toggleIO();

    const timeLimit = problem.timeLimit ? `${problem.timeLimit}ms` : '-';
    const memLimit = problem.memoryLimit ? `${problem.memoryLimit}MB` : '-';

    log(`[OJ] ${problem.name}`, 'success');
    log(`     ${testCount} test | ${timeLimit} | ${memLimit}`, 'info');
    if (useCurrentTab) {
        log(`     Imported to current tab (${importMerge})`, 'info');
    }

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
