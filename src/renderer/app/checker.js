/**
 * Sameko Dev C++ IDE - renderer: how a test's output is judged (the "checker").
 *
 * Each problem (the focused tab's `ccProblem`) keeps its choice in `problem.checker`:
 *   ''              Settings › Execution › Compare Output (the default)
 *   'tokens'        same words in order, real numbers within 1e-6 (app/shared/judge.js)
 *   'nocase'        the same, letter case ignored (YES = yes)
 *   'lines'         every line must match
 *   'file:<path>'   a testlib checker (C++), compiled like the tests and run by the main
 *                   process for each test (app/services/competitive/checker.js)
 * Run All Tests, a single test and the stress test all judge with it. The choice shows in the
 * TESTS tab's header and in the STRESS setup; both selects are the same setting.
 *
 * One of the plain <script> files of src/renderer/app/ (see CODEBASE.md §9). Loaded after
 * batch-tests.js (buildCompileFlags, tabSourceText) and before stress-test.js.
 */

const CHECKER_SOURCE_EXT = /\.(cpp|cc|cxx)$/i;
const CHECKER_NAME = /(check|chk|cmp|judge|interact)/i;
const CHECKER_MODES = {
    tokens: 'Words (numbers within 1e-6)',
    nocase: 'Words, ignore case (YES = yes)',
    lines: 'Exact lines'
};

const CHECKER_TEMPLATE = `#include "testlib.h"
using namespace std;

// Checker: judges a test when more than one answer is right.
// Sameko runs it as "checker input output answer" for every test:
//   inf = the test's input, ouf = your program's output, ans = the expected output.
// quitf(_ok, ...) accepts the output; quitf(_wa, ...) rejects it, and the message shows in TESTS.
// testlib.h comes with Sameko: https://github.com/MikeMirzayanov/testlib
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);

    // Example: the output must print the same number as the expected answer.
    long long expected = ans.readLong();
    long long found = ouf.readLong();
    if (found != expected) quitf(_wa, "expected %lld, found %lld", expected, found);
    quitf(_ok, "answer is %lld", found);
}
`;

const Checker = {
    folder: null,   // folder of the focused saved tab, whose checker files the selects list
    files: [],      // checker-looking C++ files in it
    listSeq: 0,
};

function checkerDirOf(filePath) {
    const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return i > 0 ? filePath.substring(0, i) : null;
}

function checkerJoin(dir, name) {
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    return dir.replace(/[/\\]+$/, '') + sep + name;
}

function checkerBaseName(filePath) {
    return String(filePath || '').split(/[/\\]/).pop();
}

/** The focused tab's choice, always a known value. */
function checkerChoice(problem = ccProblem) {
    const c = problem && typeof problem.checker === 'string' ? problem.checker : '';
    if (c.startsWith('file:') && c.length > 5) return c;
    return CHECKER_MODES[c] ? c : '';
}

function checkerFilePath(choice) {
    return choice.startsWith('file:') ? choice.slice(5) : '';
}

/** The comparison in the main process when no checker program judges: a CHECKER_MODES key. */
function checkerCompareMode(problem) {
    const c = checkerChoice(problem);
    if (CHECKER_MODES[c]) return c;
    const s = App.settings.execution.compareMode;
    return CHECKER_MODES[s] ? s : 'tokens';
}

function setCheckerChoice(value) {
    if (!ccProblem) ccProblem = { name: 'Manual Problem', tests: [] };
    if (!ccProblem.tests) ccProblem.tests = [];
    ccProblem.checker = value;
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    if (tab && typeof saveTestStateToTab === 'function') saveTestStateToTab(tab);
    if (typeof scheduleSessionSave === 'function') scheduleSessionSave();
    fillCheckerSelects();
}

// ---------------------------------------------------------------------------
// Selects: TESTS header and STRESS setup
// ---------------------------------------------------------------------------

async function refreshCheckerFiles() {
    const seq = ++Checker.listSeq;
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    const folder = tab && tab.path ? checkerDirOf(tab.path) : null;
    let files = [];
    if (folder && window.electronAPI?.readDirectory) {
        try {
            const entries = await window.electronAPI.readDirectory(folder);
            const own = pathKey(tab.path);
            files = entries
                .filter(e => e.isFile && CHECKER_SOURCE_EXT.test(e.name) && CHECKER_NAME.test(e.name)
                    && pathKey(checkerJoin(folder, e.name)) !== own)
                .map(e => e.name)
                .sort((a, b) => a.localeCompare(b));
        } catch (_) { files = []; }
    }
    if (seq !== Checker.listSeq) return;
    Checker.folder = folder;
    Checker.files = files;
    fillCheckerSelects();
}

function fillCheckerSelect(select) {
    if (!select) return;
    const choice = checkerChoice();
    const settingsMode = CHECKER_MODES[App.settings.execution.compareMode] ? App.settings.execution.compareMode : 'tokens';
    select.textContent = '';
    const add = (parent, value, text, noTranslate) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        if (noTranslate) opt.setAttribute('translate', 'no');
        parent.appendChild(opt);
    };
    const builtins = document.createElement('optgroup');
    builtins.label = I18n.t('Compare output');
    add(builtins, '', I18n.t('Default: {0}', I18n.t(CHECKER_MODES[settingsMode])));
    for (const [value, text] of Object.entries(CHECKER_MODES)) add(builtins, value, text);
    select.appendChild(builtins);

    const chosenFile = checkerFilePath(choice);
    const names = new Set(Checker.files);
    const group = document.createElement('optgroup');
    group.label = I18n.t('testlib checker');
    for (const name of Checker.files) add(group, 'file:' + checkerJoin(Checker.folder, name), name, true);
    // A checker picked earlier that is not listed (another folder, renamed): keep it shown.
    if (chosenFile && !(Checker.folder && names.has(checkerBaseName(chosenFile))
        && pathKey(checkerJoin(Checker.folder, checkerBaseName(chosenFile))) === pathKey(chosenFile))) {
        add(group, choice, checkerBaseName(chosenFile), true);
    }
    if (group.children.length) select.appendChild(group);
    select.value = choice;
    if (select.value !== choice) select.value = '';
    select.title = chosenFile || I18n.t('How the output of each test is judged');
    select.classList.toggle('is-custom', !!choice);
}

function fillCheckerSelects() {
    fillCheckerSelect(document.getElementById('checker-select'));
    fillCheckerSelect(document.getElementById('stress-checker'));
}

/** Creates checker.cpp (or checker2.cpp…) next to the solution from the template and opens it. */
async function createCheckerFile() {
    const tab = App.tabs.find(t => t.id === getPreferredTabId());
    if (!tab || !tab.path) {
        showToast('Save this file first: the checker goes in its folder.', 'warning');
        return;
    }
    const folder = checkerDirOf(tab.path);
    let entries = [];
    try { entries = await window.electronAPI.readDirectory(folder); } catch (_) { }
    const taken = new Set(entries.map(e => e.name.toLowerCase()));
    let name = 'checker.cpp';
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `checker${i}.cpp`;
    const filePath = checkerJoin(folder, name);
    const res = await window.electronAPI.saveFile({ path: filePath, content: CHECKER_TEMPLATE });
    if (!res || !res.success) {
        showToast(I18n.t('Could not create {0}: {1}', name, (res && res.error) || '?'), 'error');
        return;
    }
    setCheckerChoice('file:' + filePath);   // on the solution's problem, before the new tab takes focus
    if (window.FileExplorer?.refresh) { try { window.FileExplorer.refresh(); } catch (_) { } }
    await openFileFromPath(filePath);
}

// ---------------------------------------------------------------------------
// Before a run: compile the checker program
// ---------------------------------------------------------------------------

/**
 * What runTest needs to judge `problem`'s tests: { compare } for a built-in mode, plus
 * { checker: <exe> } for a testlib checker, compiled now (-O2, cached by its text like any
 * build). { error: {title, detail} } when it cannot be built.
 */
async function prepareChecker(problem) {
    const compare = checkerCompareMode(problem);
    const file = checkerFilePath(checkerChoice(problem));
    if (!file) return { compare };
    const name = checkerBaseName(file);
    let content;
    try {
        const open = App.tabs.find(t => t.path && pathKey(t.path) === pathKey(file));
        content = open ? tabSourceText(open) : await window.electronAPI.readFile(file);
    } catch (err) {
        return { error: { title: I18n.t('Could not read the checker {0}', name), detail: String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') } };
    }
    if (typeof content !== 'string') {
        return { error: { title: I18n.t('Could not read the checker {0}', name), detail: '' } };
    }
    setStatus(I18n.t('Compiling {0}...', name), '');
    const res = await window.electronAPI.compile({
        filePath: file,
        untitledId: '',
        content,
        flags: buildCompileFlags({ judge: true }),
        singleFileMode: true,
        useLLD: App.settings.compiler.useLLD !== false,
        realtimeOutput: false,
        variant: 'judge'
    });
    if (!res || !res.success) {
        return { error: { title: I18n.t('Compile error in the checker {0}', name), detail: (res && res.error) || '' } };
    }
    return { compare, checker: res.outputPath };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function initChecker() {
    for (const id of ['checker-select', 'stress-checker']) {
        const select = document.getElementById(id);
        if (!select) continue;
        select.addEventListener('change', (e) => setCheckerChoice(e.target.value));
        // A checker created or renamed elsewhere shows up the next time the select is opened.
        select.addEventListener('focus', () => refreshCheckerFiles());
        select.addEventListener('click', (e) => e.stopPropagation());
    }
    for (const id of ['checker-new', 'stress-new-checker']) {
        document.getElementById(id)?.addEventListener('click', (e) => {
            e.stopPropagation();
            createCheckerFile();
        });
    }
    fillCheckerSelects();
}

initChecker();

