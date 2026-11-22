/**
 * Sameko Dev C++ IDE - renderer: managing a problem's tests.
 *
 * Turning tests on and off, hiding passed ones, tests kept as files on disk (imported from a
 * folder), limits per problem, problems judged through files (BAI.INP / BAI.OUT, found in the
 * source by FileIODetect), a testlib interactor, the stopwatch and the head comment.
 * A problem keeps these on itself, so they follow its tab and the session:
 *   test.disabled, test.inputPath, test.outputPath, test.source
 *   problem.hideAC, problem.fileIO {input, output}, problem.interactor, problem.stopwatch
 *
 * One of the plain <script> files of src/renderer/app/ (see CODEBASE.md §9). Loaded after
 * checker.js and before stress-test.js.
 */

// ---------------------------------------------------------------------------
// What a run needs from a test and its problem
// ---------------------------------------------------------------------------

/** runTest's input and expected output: text, or the paths of a test kept on disk. */
function testRunArgs(test) {
    return {
        input: test.inputPath ? '' : (test.input || ''),
        ...(test.inputPath ? { inputPath: test.inputPath } : {}),
        ...(test.outputPath ? { expectedPath: test.outputPath } : { expectedOutput: test.output || '' }),
    };
}

/** The files this solution is judged through: the problem's own names, else read from the source. */
function problemFileIO(problem, source) {
    const set = problem && problem.fileIO;
    const detected = typeof FileIODetect !== 'undefined' ? FileIODetect.detect(source) : null;
    const input = (set && set.input) || (detected && detected.input) || '';
    const output = (set && set.output) || (detected && detected.output) || '';
    return input || output ? { input, output } : null;
}

/** Compiles the problem's interactor like a checker. */
async function prepareInteractor(problem) {
    const file = problem && problem.interactor;
    if (!file) return {};
    const name = checkerBaseName(file);
    let content;
    try {
        const open = App.tabs.find(t => t.path && pathKey(t.path) === pathKey(file));
        content = open ? tabSourceText(open) : await window.electronAPI.readFile(file);
    } catch (err) {
        return { error: { title: I18n.t('Could not read the interactor {0}', name), detail: String(err?.message || err) } };
    }
    if (typeof content !== 'string') return { error: { title: I18n.t('Could not read the interactor {0}', name), detail: '' } };
    const changed = externalChangeBlocksBuild(file);
    if (changed) return { error: { title: changed, detail: '' } };
    setStatus(I18n.t('Compiling {0}...', name), '');
    const res = await window.electronAPI.compile({
        filePath: file, untitledId: '', content,
        flags: buildCompileFlags({ judge: true }),
        singleFileMode: true,
        useLLD: App.settings.compiler.useLLD !== false,
        realtimeOutput: false,
        variant: 'judge',
    });
    if (!res || !res.success) {
        return { error: { title: I18n.t('Compile error in the interactor {0}', name), detail: (res && res.error) || '' } };
    }
    return { interactor: res.outputPath };
}

/** Everything a test run adds for this problem. { error } when the interactor cannot be built. */
async function problemRunOptions(problem, source) {
    const interactive = await prepareInteractor(problem);
    if (interactive.error) return interactive;
    if (interactive.interactor) return interactive;
    const fileIO = problemFileIO(problem, source);
    return fileIO ? { fileIO } : {};
}

/** Where a debug session of this test reads from. */
async function testDebugOptions(problem, test, source) {
    const options = {};
    if (test.inputPath) options.stdinPath = test.inputPath;
    const fileIO = problemFileIO(problem, source);
    if (fileIO && fileIO.input) {
        const res = await window.electronAPI.testsDebugDir({ fileIO, input: test.input || '', inputPath: test.inputPath || '' });
        if (res && res.success) options.cwd = res.dir;
    }
    return options;
}

// ---------------------------------------------------------------------------
// The Input / Expected boxes for a test kept on disk
// ---------------------------------------------------------------------------

const linkedInputFiles = new Set();

function isLinkedTest(test) {
    return !!(test && (test.inputPath || test.outputPath));
}

/** What the user typed goes into the test, except the sides that live in a file. */
function storeBoxesInTest(test) {
    if (!test) return;
    if (!test.inputPath) test.input = document.getElementById('input-area').value;
    if (!test.outputPath) test.output = document.getElementById('expected-area').value;
}

let expectedPreviewJob = 0;

/** Shows a test in the boxes; null only releases a file-backed test's read-only state. */
function showTestInBoxes(test) {
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    if (!inputArea || !expectedArea) return;
    const job = ++expectedPreviewJob;
    const tabId = getPreferredTabId();
    const attached = getTabInputFile(tabId);

    if (test && test.inputPath) {
        inputArea.value = '';
        linkedInputFiles.add(test.inputPath);
        if (attached !== test.inputPath) setInputFile(test.inputPath);
    } else {
        if (attached && linkedInputFiles.has(attached)) setInputFile(null);
        if (test) inputArea.value = test.input || '';
    }

    expectedArea.readOnly = !!(test && test.outputPath);
    if (test && test.outputPath) {
        expectedArea.value = '';
        window.electronAPI.inputFileInfo(test.outputPath).then((info) => {
            if (job !== expectedPreviewJob) return;
            expectedArea.value = info && info.success
                ? info.head + (info.truncated ? `\n… (${formatBytes(info.size)})` : '')
                : I18n.t('Cannot read this file');
        }).catch(() => { });
    } else if (test) {
        expectedArea.value = test.output || '';
    }
}

/** The diff of a test's last run; for an answer on disk, its first part. */
function showTestDiff(test, result, actual) {
    if (!test.outputPath) {
        showTestResultDiff(test.output || '', actual);
        return;
    }
    const preview = result.expectedPreview || '';
    showTestResultDiff(preview, String(actual).slice(0, preview.length));
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

function touchProblem() {
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    if (tab) saveTestStateToTab(tab);
    if (typeof scheduleSessionSave === 'function') scheduleSessionSave();
}

function setTestEnabled(index, enabled) {
    const test = ccProblem?.tests?.[index];
    if (!test) return;
    if (enabled) delete test.disabled;
    else test.disabled = true;
    touchProblem();
    renderTestResults();
}

function setAllTestsEnabled() {
    for (const test of ccProblem?.tests || []) delete test.disabled;
    touchProblem();
    renderTestResults();
}

function disablePassedTests() {
    const passed = new Set(batchTestResults.filter(r => r.status === 'AC').map(r => r.testIndex));
    (ccProblem?.tests || []).forEach((test, i) => { if (passed.has(i)) test.disabled = true; });
    touchProblem();
    renderTestResults();
}

const MAX_INLINE_ANSWER = 1024 * 1024;

/** The program's output of a test becomes its expected output. */
async function useOutputAsExpected(index) {
    const test = ccProblem?.tests?.[index];
    const result = batchTestResults.find(r => r.testIndex === index);
    const output = result?.actualOutput ?? result?.output;
    if (!test || typeof output !== 'string') return;
    if (output.length > MAX_INLINE_ANSWER) {
        showToast('This output is too large to keep as the expected output.', 'warning');
        return;
    }
    if (test.outputPath || (test.output || '').trim()) {
        const confirmed = await showConfirmDialog({
            title: 'Use output as expected',
            message: I18n.t('Replace the expected output of Test {0}?', index + 1),
            confirmText: 'Replace',
        });
        if (!confirmed) return;
    }
    delete test.outputPath;
    test.output = output;
    batchTestResults = batchTestResults.filter(r => r.testIndex !== index);
    touchProblem();
    renderTestResults();
    switchTestCase(index);
}

// ---------------------------------------------------------------------------
// Tests as files
// ---------------------------------------------------------------------------

async function pickFolder(title) {
    const result = await window.electronAPI.showOpenDialog({ title: I18n.t(title), properties: ['openDirectory', 'createDirectory'] });
    return result && !result.canceled && result.filePaths?.length ? result.filePaths[0] : null;
}

async function importTestsFromFolder() {
    const folder = await pickFolder('Choose the folder with the tests');
    if (!folder) return;
    const res = await window.electronAPI.testsImport(folder);
    if (!res || !res.success) {
        showToast(I18n.t('Could not read the folder: {0}', (res && res.error) || '?'), 'error');
        return;
    }
    if (!res.tests.length) {
        showToast('No test files found (.in/.inp with .out/.ans).', 'warning');
        return;
    }
    if (!ccProblem) ccProblem = { name: 'Manual Problem', tests: [] };
    if (!ccProblem.tests) ccProblem.tests = [];
    ccProblem.tests.push(...res.tests);
    resetTestRunResults();
    touchProblem();
    updateTestNavUI();
    renderTestResults();
    if (typeof showTestsTab === 'function') showTestsTab();
    log(I18n.t('Imported {0} tests from {1}', res.tests.length, folder), 'success');
    if (res.capped) log('Only the first 500 tests were imported.', 'warning');
}

async function exportTestsToFolder() {
    const tests = ccProblem?.tests || [];
    if (!tests.length) {
        showToast('There are no tests to save.', 'warning');
        return;
    }
    const folder = await pickFolder('Choose where to save the tests');
    if (!folder) return;
    const res = await window.electronAPI.testsExport({ folder, tests });
    if (res && res.success) {
        log(I18n.t('Saved {0} tests to {1}', res.count, folder), 'success');
    } else if (res && res.exists) {
        showToast(I18n.t('{0} already exists there. Nothing was saved.', res.exists), 'warning');
    } else {
        showToast(I18n.t('Could not save the tests: {0}', (res && res.error) || '?'), 'error');
    }
}

// ---------------------------------------------------------------------------
// Problem options dialog
// ---------------------------------------------------------------------------

const INTERACTOR_NAME = /interact/i;

async function interactorFiles(tab) {
    const folder = tab && tab.path ? checkerDirOf(tab.path) : null;
    if (!folder) return [];
    try {
        const own = pathKey(tab.path);
        return (await window.electronAPI.readDirectory(folder))
            .filter(e => e.isFile && CHECKER_SOURCE_EXT.test(e.name) && INTERACTOR_NAME.test(e.name)
                && pathKey(checkerJoin(folder, e.name)) !== own)
            .map(e => checkerJoin(folder, e.name))
            .sort((a, b) => a.localeCompare(b));
    } catch (_) {
        return [];
    }
}

async function openTestOptions() {
    if (document.querySelector('.test-options-dialog')) return;
    if (!ccProblem) ccProblem = { name: 'Manual Problem', tests: [] };
    if (!ccProblem.tests) ccProblem.tests = [];
    const problem = ccProblem;
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    const detected = tab && isCppTab(tab) ? FileIODetect.detect(tabSourceText(tab)) : null;

    const dialog = document.createElement('dialog');
    dialog.className = 'test-tool-dialog test-options-dialog';
    dialog.setAttribute('aria-labelledby', 'test-options-title');
    // Static markup: every value goes in through .value or textContent below.
    dialog.innerHTML = `
        <header><div><h2 id="test-options-title">Problem options</h2><p class="test-options-problem" translate="no"></p></div>
            <form method="dialog"><button type="submit" class="test-tool-close" title="Close (Esc)" aria-label="Close">
                <svg class="ico" width="14" height="14" aria-hidden="true"><use href="#i-x"/></svg></button></form>
        </header>
        <div class="test-tool-body test-options-body">
            <section>
                <h3>Limits</h3>
                <div class="test-options-grid">
                    <label>Time limit (ms)<input name="time" type="number" min="1" max="600000" step="100"></label>
                    <label>Memory limit (MB)<input name="memory" type="number" min="0" max="8192" step="1"></label>
                </div>
            </section>
            <section>
                <h3>Input and output files</h3>
                <div class="test-options-grid">
                    <label>Input file<input name="fileIn" type="text" maxlength="64" spellcheck="false" translate="no"></label>
                    <label>Output file<input name="fileOut" type="text" maxlength="64" spellcheck="false" translate="no"></label>
                </div>
                <p class="test-options-hint" data-role="io-hint"></p>
            </section>
            <section>
                <h3>Interactor</h3>
                <select name="interactor" aria-label="Interactor"></select>
                <p class="test-options-hint">A testlib program named interactor*.cpp next to your solution. It talks to your program and gives the verdict.</p>
            </section>
            <section>
                <h3>Tests</h3>
                <label class="test-options-check"><input name="hideAC" type="checkbox"> Hide passed tests</label>
                <div class="test-options-actions">
                    <button type="button" data-do="enable">Turn all on</button>
                    <button type="button" data-do="disable">Turn passed off</button>
                    <button type="button" data-do="import">Import from folder…</button>
                    <button type="button" data-do="export">Save to folder…</button>
                    <button type="button" data-do="checker">New checker</button>
                    <button type="button" data-do="stopwatch"></button>
                    <button type="button" class="danger" data-do="delete">Delete all tests</button>
                </div>
            </section>
        </div>`;
    dialog.querySelector('.test-options-problem').textContent = problem.name || '';
    const field = name => dialog.querySelector(`[name="${name}"]`);
    const defaultTime = (App.settings.execution.timeLimitSeconds * 1000) || 3000;
    const defaultMemory = Number(App.settings.execution.memoryLimitMB ?? 256);
    field('time').value = problem.timeLimit || '';
    field('time').placeholder = String(defaultTime);
    field('memory').value = problem.memoryLimit || '';
    field('memory').placeholder = String(defaultMemory);
    field('fileIn').value = problem.fileIO?.input || '';
    field('fileIn').placeholder = detected?.input || I18n.t('Standard input');
    field('fileOut').value = problem.fileIO?.output || '';
    field('fileOut').placeholder = detected?.output || I18n.t('Standard output');
    dialog.querySelector('[data-role="io-hint"]').textContent = detected
        ? I18n.t('Found in your code: {0}', [detected.input, detected.output].filter(Boolean).join(', '))
        : I18n.t('Leave empty to read them from freopen or fstream in your code.');
    field('hideAC').checked = !!problem.hideAC;
    const stopwatchButton = dialog.querySelector('[data-do="stopwatch"]');
    const paintStopwatchButton = () => {
        stopwatchButton.textContent = I18n.t(problem.stopwatch?.startedAt ? 'Pause stopwatch' : 'Start stopwatch');
    };
    paintStopwatchButton();

    const select = field('interactor');
    const addOption = (value, text) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        if (value) option.setAttribute('translate', 'no');
        select.appendChild(option);
    };
    addOption('', I18n.t('None'));
    const files = await interactorFiles(tab);
    if (problem.interactor && !files.some(f => pathKey(f) === pathKey(problem.interactor))) files.unshift(problem.interactor);
    for (const file of files) addOption(file, checkerBaseName(file));
    select.value = problem.interactor || '';

    const apply = () => {
        const positive = (value) => {
            const n = parseInt(value, 10);
            return Number.isFinite(n) && n > 0 ? n : null;
        };
        problem.timeLimit = positive(field('time').value) || undefined;
        problem.memoryLimit = positive(field('memory').value) || undefined;
        const clean = value => (/^[A-Za-z0-9_][\w.+-]{0,63}$/.test(value.trim()) ? value.trim() : '');
        const input = clean(field('fileIn').value);
        const output = clean(field('fileOut').value);
        if (input || output) problem.fileIO = { input, output };
        else delete problem.fileIO;
        if (select.value) problem.interactor = select.value;
        else delete problem.interactor;
        problem.hideAC = field('hideAC').checked || undefined;
        touchProblem();
        renderTestResults();
    };
    dialog.addEventListener('change', apply);
    dialog.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-do]')?.dataset.do;
        if (!action) return;
        apply();
        if (action === 'enable') setAllTestsEnabled();
        else if (action === 'disable') disablePassedTests();
        else if (action === 'import') await importTestsFromFolder();
        else if (action === 'export') await exportTestsToFolder();
        else if (action === 'stopwatch') {
            toggleStopwatch();
            paintStopwatchButton();
        } else if (action === 'checker') {
            dialog.close();
            await createCheckerFile();
        } else if (action === 'delete') {
            dialog.close();
            await deleteAllTestCases();
        }
    });
    dialog.addEventListener('close', () => { apply(); dialog.remove(); });
    document.body.appendChild(dialog);
    dialog.showModal();
}

// ---------------------------------------------------------------------------
// Stopwatch: per problem, survives tab switches and restarts
// ---------------------------------------------------------------------------

let stopwatchTimer = null;

function stopwatchMs(watch) {
    if (!watch) return 0;
    return (watch.ms || 0) + (watch.startedAt ? Math.max(0, Date.now() - watch.startedAt) : 0);
}

function formatStopwatch(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor(total / 60) % 60;
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function renderStopwatch() {
    const button = document.getElementById('test-stopwatch');
    if (!button) return;
    const watch = ccProblem?.stopwatch;
    const running = !!watch?.startedAt;
    button.hidden = !running && !stopwatchMs(watch);
    button.querySelector('span').textContent = formatStopwatch(stopwatchMs(watch));
    button.classList.toggle('running', running);
    button.setAttribute('aria-pressed', String(running));
    if (running && !stopwatchTimer) stopwatchTimer = setInterval(renderStopwatch, 1000);
    if (!running && stopwatchTimer) {
        clearInterval(stopwatchTimer);
        stopwatchTimer = null;
    }
}

function toggleStopwatch() {
    if (!ccProblem) ccProblem = { name: 'Manual Problem', tests: [] };
    if (!ccProblem.tests) ccProblem.tests = [];
    const watch = ccProblem.stopwatch || { ms: 0, startedAt: 0 };
    if (watch.startedAt) {
        watch.ms = stopwatchMs(watch);
        watch.startedAt = 0;
    } else {
        watch.startedAt = Date.now();
    }
    ccProblem.stopwatch = watch;
    touchProblem();
    renderStopwatch();
}

function resetStopwatch() {
    if (!ccProblem) return;
    delete ccProblem.stopwatch;
    touchProblem();
    renderStopwatch();
}

// ---------------------------------------------------------------------------
// Head comment of a problem's new file
// ---------------------------------------------------------------------------

/** Settings › Code Template › Head comment, with {name} {url} {group} {time} {memory} {date}. */
function applyHeadComment(code, problem) {
    const format = App.settings.template?.headComment;
    if (!format || !format.trim()) return code;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const values = {
        name: problem?.name || '',
        url: problem?.url || '',
        group: problem?.group || '',
        time: problem?.timeLimit ? `${problem.timeLimit} ms` : '',
        memory: problem?.memoryLimit ? `${problem.memoryLimit} MB` : '',
        date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    };
    const head = format.replace(/\{(name|url|group|time|memory|date)\}/g, (_, key) => values[key]).replace(/\s+$/, '');
    return `${head}\n${code}`;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function initTestManager() {
    document.getElementById('test-options')?.addEventListener('click', openTestOptions);
    const stopwatch = document.getElementById('test-stopwatch');
    if (stopwatch) {
        stopwatch.addEventListener('click', toggleStopwatch);
        stopwatch.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            resetStopwatch();
        });
    }
    renderStopwatch();
}

initTestManager();
