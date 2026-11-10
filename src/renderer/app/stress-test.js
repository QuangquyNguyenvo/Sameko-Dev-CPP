/**
 * Sameko Dev C++ IDE - renderer: stress test, the STRESS tab of the bottom panel.
 *
 * Each test: the generator prints a random input for a seed, the brute force (slow but surely
 * correct) gives the expected output, and the focused tab's solution must match it. Tests run
 * one after another until the first mismatch, the test count, the time budget or Stop.
 * Every program runs through the main process's runTest, so the solution is judged like in
 * Run All Tests (time and memory limits, output comparison). The generator gets its seed as
 * argv[1]: rerunning a seed gives the same test.
 *
 * One of the plain <script> files of src/renderer/app/ (see CODEBASE.md §9). Loaded after
 * batch-tests.js: it uses tabSourceText, buildCompileFlags, judgeOptions, translateTestDetails
 * and holds the isBatchTesting flag while it runs, so Run All Tests cannot rebuild the
 * solution under it.
 */

// C++ and the other languages the app builds (OTHER_LANGUAGES in core.js): a generator in
// Python can feed a C++ solution.
const STRESS_SOURCE_EXT = /\.(cpp|cc|cxx|c|py|java|kt|rs|go|pas|pp|js)$/i;
const STRESS_GEN_NAME = /^(gen|generator|rand|random)/i;
const STRESS_BRUTE_NAME = /(brute|naive|trau|slow|stupid|dumb|bf)/i;
const STRESS_HELPER_TIME_LIMIT = 10000;   // generator and brute force: they are not judged
const STRESS_SHOWN_CHARS = 20000;         // per column; the whole text is kept for Add / Copy

const STRESS_GEN_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

// Stress test generator: prints one random test.
// Sameko runs it as "gen <seed>": the same seed always gives the same test.
int main(int argc, char* argv[]) {
    mt19937 rng(argc > 1 ? atoi(argv[1]) : random_device{}());
    auto rnd = [&](long long l, long long r) { return uniform_int_distribution<long long>(l, r)(rng); };

    int n = rnd(1, 10);   // keep tests small, so the brute force stays fast
    cout << n << '\\n';
    for (int i = 0; i < n; i++) cout << rnd(1, 100) << " \\n"[i == n - 1];
}
`;

const STRESS_BRUTE_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

// Brute force: a slow but surely correct solution. Its output is the expected answer.
int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

}
`;

const Stress = {
    running: false,
    stopping: false,
    folder: null,        // folder of the focused saved tab, whose files the selects list
    files: [],           // source files in it, the solution itself left out
    choice: new Map(),   // pathKey(folder) -> { gen, brute }: the user's picks
    listSeq: 0,
    run: null,           // the current or last run (see startStressTest)
    paintTimer: null,
};

function stressEl(id) { return document.getElementById(id); }

function stressFocusedTab() {
    return App.tabs.find(t => t.id === getPreferredTabId()) || null;
}

function stressDirOf(filePath) {
    const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return i > 0 ? filePath.substring(0, i) : null;
}

function stressBaseName(filePath) {
    return filePath.split(/[/\\]/).pop();
}

function stressJoin(dir, name) {
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    return dir.replace(/[/\\]+$/, '') + sep + name;
}

function stressViewVisible() {
    const panel = stressEl('problems-panel');
    return !!panel && panel.dataset.view === 'stress' && App.showProblems && !panel.classList.contains('collapsed');
}

function stressSettings() {
    const ex = App.settings.execution;
    const clamp = (v, lo, hi, d) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : d;
    };
    return {
        tests: clamp(ex.stressTests, 1, 100000, 1000),
        seconds: clamp(ex.stressSeconds, 1, 3600, 60)
    };
}

// ---------------------------------------------------------------------------
// Files: the selects list the source files next to the solution
// ---------------------------------------------------------------------------

/** Reads the solution's folder again and refills both selects (keeps the user's picks). */
async function refreshStressFiles() {
    const seq = ++Stress.listSeq;
    const tab = stressFocusedTab();
    const folder = tab && tab.path ? stressDirOf(tab.path) : null;
    let files = [];
    if (folder && window.electronAPI?.readDirectory) {
        try {
            const entries = await window.electronAPI.readDirectory(folder);
            const solKey = pathKey(tab.path);
            files = entries
                .filter(e => e.isFile && STRESS_SOURCE_EXT.test(e.name) && pathKey(stressJoin(folder, e.name)) !== solKey)
                .map(e => e.name)
                .sort((a, b) => a.localeCompare(b));
        } catch (_) { files = []; }
    }
    if (seq !== Stress.listSeq) return;   // a newer refresh is on its way
    Stress.folder = folder;
    Stress.files = files;
    fillStressSelects();
    renderStressView();
}

function stressChoiceFor(folder) {
    const key = folder ? pathKey(folder) : '';
    if (!Stress.choice.has(key)) Stress.choice.set(key, { gen: '', brute: '' });
    return Stress.choice.get(key);
}

/**
 * The files to use: the user's pick while it is listed, else a guess from the names. The pick
 * itself is kept: with gen.cpp focused it is not listed (it is the solution then), and it must
 * come back when the real solution is focused again.
 */
function resolveStressChoice() {
    const choice = stressChoiceFor(Stress.folder);
    const has = (name) => !!name && Stress.files.includes(name);
    const gen = has(choice.gen) ? choice.gen : (Stress.files.find(f => STRESS_GEN_NAME.test(f)) || '');
    const brute = has(choice.brute) ? choice.brute
        : (Stress.files.find(f => STRESS_BRUTE_NAME.test(f) && f !== gen) || '');
    return { gen, brute };
}

function fillStressSelects() {
    const choice = resolveStressChoice();
    const fill = (select, value) => {
        if (!select) return;
        select.textContent = '';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = Stress.files.length ? '(choose a file)' : '(no other source file here)';
        select.appendChild(none);
        for (const name of Stress.files) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            opt.setAttribute('translate', 'no');
            select.appendChild(opt);
        }
        select.value = value || '';
    };
    fill(stressEl('stress-gen'), choice.gen);
    fill(stressEl('stress-brute'), choice.brute);
}

/** Creates gen.cpp / brute.cpp (or gen2.cpp…) next to the solution from a template and opens it. */
async function createStressFile(kind) {
    const tab = stressFocusedTab();
    if (!tab || !tab.path) {
        showToast('Save this file first: the generator and brute force go in its folder.', 'warning');
        return;
    }
    const folder = stressDirOf(tab.path);
    const stem = kind === 'gen' ? 'gen' : 'brute';
    let entries = [];
    try { entries = await window.electronAPI.readDirectory(folder); } catch (_) { }
    const taken = new Set(entries.map(e => e.name.toLowerCase()));
    let name = `${stem}.cpp`;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${stem}${i}.cpp`;
    const filePath = stressJoin(folder, name);
    const res = await window.electronAPI.saveFile({ path: filePath, content: kind === 'gen' ? STRESS_GEN_TEMPLATE : STRESS_BRUTE_TEMPLATE });
    if (!res || !res.success) {
        showToast(`Could not create ${name}: ${(res && res.error) || '?'}`, 'error');
        return;
    }
    const choice = stressChoiceFor(folder);
    choice[kind] = name;
    if (window.FileExplorer?.refresh) { try { window.FileExplorer.refresh(); } catch (_) { } }
    await openFileFromPath(filePath);
    // The new tab is focused now; the selects follow the folder, which is the same one.
    await refreshStressFiles();
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

async function stressSource(filePath) {
    const open = App.tabs.find(t => t.path && pathKey(t.path) === pathKey(filePath));
    if (open) return tabSourceText(open);
    return window.electronAPI.readFile(filePath);
}

async function compileStressProgram(filePath, content, flags) {
    return window.electronAPI.compile({
        filePath,
        untitledId: '',
        content,
        flags,
        singleFileMode: App.settings.compiler.singleFileMode !== false,
        useLLD: App.settings.compiler.useLLD !== false,
        realtimeOutput: App.settings.execution.realtimeOutput !== false,
        variant: 'judge'
    });
}

/** A generator or brute force that did not run cleanly stops the run: say which and why. */
function stressHelperError(role, name, result, seed) {
    const what = role === 'gen' ? 'generator' : 'brute force';
    if (result.status === 'TLE') {
        return {
            kind: 'error', seed,
            title: `The ${what} ${name} ran longer than ${STRESS_HELPER_TIME_LIMIT / 1000} s`,
            detail: 'Make the generated tests smaller.'
        };
    }
    return { kind: 'error', seed, title: `The ${what} ${name} failed`, detail: translateTestDetails(result) || result.error || '' };
}

async function startStressTest() {
    if (Stress.running) return;
    if (isBatchTesting) { showToast('Tests are already running...', 'warning'); return; }
    if (typeof isBuilding !== 'undefined' && isBuilding) { showToast('A build is running. Try again when it ends.', 'warning'); return; }
    if (blockedByDebugSession('Stress test')) return;

    const tab = stressFocusedTab();
    if (!tab) { showToast('No file is currently open!', 'warning'); return; }
    if (!tab.path) {
        Stress.run = { tabId: tab.id, solName: tab.name, result: { kind: 'error', title: 'Save this file first', detail: 'The generator and brute force are picked from its folder.' } };
        renderStressView();
        return;
    }
    if (!isBuildableTab(tab)) {
        Stress.run = { tabId: tab.id, solName: tab.name, result: { kind: 'error', title: 'Not a source file', detail: notBuildableMessage(tab) } };
        renderStressView();
        return;
    }
    await refreshStressFiles();
    const choice = resolveStressChoice();
    const folder = stressDirOf(tab.path);
    const missing = !choice.gen ? 'Choose a generator' : !choice.brute ? 'Choose a brute force' : choice.gen === choice.brute ? 'The generator and the brute force are the same file' : '';
    if (missing) {
        Stress.run = { tabId: tab.id, solName: tab.name, result: { kind: 'error', title: missing, detail: 'Pick them on the left, or create them from a template with +.' } };
        renderStressView();
        return;
    }

    const { tests: total, seconds } = stressSettings();
    const problem = ccProblem;
    const timeLimit = (problem && problem.timeLimit) || (App.settings.execution.timeLimitSeconds * 1000) || 3000;
    const judge = judgeOptions(problem);
    const genPath = stressJoin(folder, choice.gen);
    const brutePath = stressJoin(folder, choice.brute);
    const solContent = tabSourceText(tab);

    const run = {
        tabId: tab.id, solName: tab.name, genName: choice.gen, bruteName: choice.brute,
        total, seconds, done: 0, phase: 'compile', compiling: '', startedAt: 0,
        solMax: 0, bruteMax: 0, result: null
    };
    Stress.run = run;
    Stress.running = true;
    Stress.stopping = false;
    isBatchTesting = true;
    renderStressView();
    log(`=== Stress test: ${tab.name} vs ${choice.brute} (generator ${choice.gen}) ===`, 'system');

    try {
        // Built like Run All Tests (-O2, the judge build), so the solution's build is shared.
        const flags = buildCompileFlags({ judge: true });
        const exes = {};
        for (const [role, filePath, name, getContent] of [
            ['gen', genPath, choice.gen, () => stressSource(genPath)],
            ['brute', brutePath, choice.brute, () => stressSource(brutePath)],
            ['sol', tab.path, tab.name, () => solContent]
        ]) {
            if (Stress.stopping) break;
            run.compiling = name;
            paintStressSoon();
            setStatus(`Compiling ${name}...`, '');
            let content;
            try {
                content = await getContent();
            } catch (err) {
                run.result = { kind: 'error', title: `Could not read ${name}`, detail: String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') };
                break;
            }
            const res = await compileStressProgram(filePath, content, flags);
            if (!res.success) {
                log(`Compile Error in ${name}!`, 'error');
                log(res.error, 'error');
                run.result = { kind: 'compile', title: `Compile error in ${name}`, detail: res.error || '' };
                break;
            }
            exes[role] = res.outputPath;
            if (role === 'sol') tab.exePath = res.outputPath;
        }

        if (!run.result && !Stress.stopping) {
            run.phase = 'test';
            run.startedAt = Date.now();
            run.result = await runStressTests(run, { exes, cwd: folder, timeLimit, judge });
        } else if (!run.result) {
            run.result = { kind: 'stopped' };
        }
    } catch (e) {
        run.result = { kind: 'error', title: 'Stress test error', detail: String(e?.message || e) };
    } finally {
        Stress.running = false;
        Stress.stopping = false;
        isBatchTesting = false;
        run.endedAt = Date.now();
        reportStressResult(run);
        renderStressView();
    }
}

/** The solution on one test, judged against the brute force's answer. */
async function runStressSolution(exes, input, expected, { cwd, timeLimit, judge }) {
    const sol = await window.electronAPI.runTest({
        exePath: exes.sol, input, expectedOutput: expected, timeLimit, ...judge, cwd
    });
    // The brute force printing nothing makes runTest say RAN (no answer to judge); here an
    // empty answer is the answer, so any output from the solution is wrong.
    let verdict = sol.status;
    if (verdict === 'RAN') verdict = (sol.output || '').trim() ? 'WA' : 'AC';
    return { sol, verdict };
}

/**
 * One test: generator, brute force, solution.
 * @returns {Promise<{ok: true}|{error: object}|{fail: object}>}
 */
async function runStressTest(i, seed, run, ctx) {
    const { exes, cwd } = ctx;
    const gen = await window.electronAPI.runTest({
        exePath: exes.gen, input: '', expectedOutput: null,
        timeLimit: STRESS_HELPER_TIME_LIMIT, memoryLimit: 0, cwd, args: [String(seed)]
    });
    if (gen.status !== 'AC') return { error: stressHelperError('gen', run.genName, gen, seed) };
    const input = gen.output || '';
    if (!input.trim()) return { error: { kind: 'error', seed, title: `The generator ${run.genName} printed nothing`, detail: '' } };

    const brute = await window.electronAPI.runTest({
        exePath: exes.brute, input, expectedOutput: null,
        timeLimit: STRESS_HELPER_TIME_LIMIT, memoryLimit: 0, cwd
    });
    if (brute.status !== 'AC') return { error: stressHelperError('brute', run.bruteName, brute, seed) };
    const expected = brute.output || '';
    run.bruteMax = Math.max(run.bruteMax, brute.executionTime || 0);

    const { sol, verdict } = await runStressSolution(exes, input, expected, ctx);
    run.solMax = Math.max(run.solMax, sol.executionTime || 0);
    if (verdict === 'AC') return { ok: true };
    return {
        fail: {
            kind: 'fail', verdict, seed, testNo: i, input, expected,
            output: sol.output || '',
            time: sol.executionTime || 0,
            details: verdict === 'WA' ? '' : (translateTestDetails(sol) || sol.error || '')
        }
    };
}

/**
 * The tests, on a small pool of workers like Run All Tests (each test is three short
 * processes, most of whose time is Windows starting them, so a pool about doubles the rate).
 * The failure with the lowest test number is the one reported. A TLE seen while tests share
 * the machine is run again alone before it counts, as Run All Tests does.
 */
async function runStressTests(run, ctx) {
    const poolSize = App.settings.execution.parallelTests === false
        ? 1
        : Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
    // Different seeds every run, so running again tests something new.
    const seedBase = 1 + Math.floor(Math.random() * 900000000);
    let next = 1;
    let stop = null;      // the first failure or helper error (lowest test number)
    let suspect = null;   // a TLE from a crowded run, checked alone
    let timeUp = false;
    const keep = (r, i) => { if (!stop || i < stop.testNo) stop = { ...r, testNo: i }; };

    const worker = async () => {
        while (!Stress.stopping && !stop && !suspect && next <= run.total) {
            if (Date.now() - run.startedAt >= run.seconds * 1000) { timeUp = true; return; }
            const i = next++;
            const r = await runStressTest(i, seedBase + i, run, ctx);
            if (r.error) keep(r.error, i);
            else if (r.fail && r.fail.verdict === 'TLE' && poolSize > 1) {
                if (!suspect || i < suspect.testNo) suspect = r.fail;
            } else if (r.fail) keep(r.fail, i);
            else run.done++;
            paintStressSoon();
        }
    };

    for (;;) {
        await Promise.all(Array.from({ length: poolSize }, worker));
        if (stop || !suspect || Stress.stopping) break;
        const s = suspect;
        suspect = null;
        const again = await runStressSolution(ctx.exes, s.input, s.expected, ctx);
        if (again.verdict !== 'AC') {
            keep({
                ...s, verdict: again.verdict, output: again.sol.output || '', time: again.sol.executionTime || 0,
                details: again.verdict === 'WA' ? '' : (translateTestDetails(again.sol) || again.sol.error || '')
            }, s.testNo);
            break;
        }
        run.done++;   // it was the crowding; carry on
    }
    if (stop) return stop;
    if (Stress.stopping) return { kind: 'stopped' };
    if (timeUp) return { kind: 'timeup' };
    return { kind: 'pass' };
}

function stopStressTest() {
    if (!Stress.running) return;
    Stress.stopping = true;
    renderStressView();
}

function toggleStressTest() {
    if (Stress.running) stopStressTest();
    else startStressTest();
}

function stressElapsedSeconds(run) {
    if (!run || !run.startedAt) return 0;
    return Math.max(0, Math.round(((run.endedAt || Date.now()) - run.startedAt) / 1000));
}

/** Terminal line and status bar for the finished run. */
function reportStressResult(run) {
    const r = run.result || {};
    const secs = stressElapsedSeconds(run);
    if (r.kind === 'fail') {
        log(`Stress test: ${r.verdict} on test ${r.testNo} (seed ${r.seed})`, 'error');
        setStatus(`Stress: ${r.verdict} on test ${r.testNo}`, 'error');
    } else if (r.kind === 'pass' || r.kind === 'timeup' || r.kind === 'stopped') {
        log(`Stress test: ${run.done} tests, no difference (${secs} s)`, 'success');
        setStatus(`Stress: ${run.done} tests OK`, 'success');
    } else {
        log(`Stress test: ${r.title || 'error'}${r.detail && r.kind !== 'compile' ? ' - ' + r.detail : ''}`, 'warning');
        setStatus('Stress test stopped', 'warning');
    }
}

// ---------------------------------------------------------------------------
// The failing test: Add to tests, Copy input
// ---------------------------------------------------------------------------

function addStressCaseToTests() {
    const run = Stress.run;
    const r = run && run.result;
    if (!r || r.kind !== 'fail' || r.addedAs) return;
    const tab = App.tabs.find(t => t.id === run.tabId);
    if (!tab) { showToast('The tested file was closed.', 'warning'); return; }
    const test = { input: r.input, output: r.expected };

    if (getPreferredTabId() === tab.id) {
        if (!ccProblem) ccProblem = { name: 'Manual Problem', tests: [] };
        if (!ccProblem.tests) ccProblem.tests = [];
        // No tests yet but text in the boxes: keep it as Test 1, as Add Test does.
        const inputArea = stressEl('input-area');
        const expectedArea = stressEl('expected-area');
        if (!ccProblem.tests.length && ((inputArea && inputArea.value) || (expectedArea && expectedArea.value))) {
            ccProblem.tests.push({ input: inputArea ? inputArea.value : '', output: expectedArea ? expectedArea.value : '' });
        }
        ccProblem.tests.push(test);
        r.addedAs = ccProblem.tests.length;
        switchTestCase(ccProblem.tests.length - 1);
        updateTestNavUI();
        renderTestResults();
    } else {
        // Not focused any more: into the test state it saved when the user switched away.
        if (!tab.testState) tab.testState = { problem: null, index: 0, results: [] };
        const st = tab.testState;
        if (!st.problem) st.problem = { name: 'Manual Problem', tests: [] };
        if (!st.problem.tests) st.problem.tests = [];
        st.problem.tests.push(test);
        st.index = st.problem.tests.length - 1;
        r.addedAs = st.problem.tests.length;
    }
    if (typeof scheduleSessionSave === 'function') scheduleSessionSave();
    log(`Test ${r.addedAs} added from the stress test`, 'info');
    renderStressView();
}

async function copyStressInput() {
    const r = Stress.run && Stress.run.result;
    if (!r || r.kind !== 'fail') return;
    try {
        await navigator.clipboard.writeText(r.input);
        showToast('Input copied', 'success');
    } catch (_) {
        showToast('Could not copy the input', 'error');
    }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function paintStressSoon() {
    if (Stress.paintTimer) return;
    Stress.paintTimer = setTimeout(() => { Stress.paintTimer = null; renderStressView(); }, 100);
}

function stressMs(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

/** Text lines as HTML; the lines listed in `marked` (0-based) get the diff color. */
function stressLinesHtml(text, marked) {
    let shown = String(text ?? '');
    let cut = false;
    if (shown.length > STRESS_SHOWN_CHARS) { shown = shown.slice(0, STRESS_SHOWN_CHARS); cut = true; }
    const lines = shown.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    const html = lines.map((line, i) => marked && marked.has(i)
        ? `<span class="stress-line-diff">${escHtml(line) || ' '}</span>`
        : escHtml(line)).join('\n');
    return html + (cut ? `\n<span class="stress-cut">…</span>` : '');
}

/** Lines where the two outputs differ (after trimming), for the highlight. */
function stressDiffLines(a, b) {
    const la = String(a ?? '').replace(/\r\n?/g, '\n').trimEnd().split('\n');
    const lb = String(b ?? '').replace(/\r\n?/g, '\n').trimEnd().split('\n');
    const out = new Set();
    const n = Math.max(la.length, lb.length);
    for (let i = 0; i < n && out.size < 200; i++) {
        if ((la[i] ?? '').trim().split(/\s+/).join(' ') !== (lb[i] ?? '').trim().split(/\s+/).join(' ')) out.add(i);
    }
    return out;
}

function renderStressView() {
    const main = stressEl('stress-main');
    const runBtn = stressEl('btn-stress-run');
    if (!main) return;
    const run = Stress.run;
    const r = run && run.result;

    // Header button and the setup controls.
    if (runBtn) {
        runBtn.classList.toggle('running', Stress.running);
        runBtn.classList.toggle('stopping', Stress.stopping);
        runBtn.title = Stress.running ? 'Stop the stress test' : 'Start the stress test';
        const label = runBtn.querySelector('.stress-run-label');
        if (label) label.textContent = Stress.running ? (Stress.stopping ? 'Stopping...' : 'Stop') : 'Start';
    }
    for (const id of ['stress-gen', 'stress-brute', 'stress-count', 'stress-seconds', 'stress-new-gen', 'stress-new-brute']) {
        const el = stressEl(id);
        if (el) el.disabled = Stress.running;
    }

    const tab = stressFocusedTab();
    let html = '';

    if (run && Stress.running) {
        const solName = escHtml(run.solName);
        if (run.phase === 'compile') {
            html = `
                <div class="stress-head">
                    <span class="stress-spinner"></span>
                    <span class="stress-title">Compiling</span>
                    <span class="stress-file" translate="no">${escHtml(run.compiling)}</span>
                </div>
                <div class="stress-progress"><span></span></div>
                <div class="stress-hint">Programs are built with -O2, like Run All Tests.</div>`;
        } else {
            html = `
                <div class="stress-head">
                    <span class="stress-ratio"><b>${run.done}</b><span class="stress-ratio-total">/ ${run.total}</span></span>
                    <span class="stress-chip">${stressElapsedSeconds(run)} s / ${run.seconds} s</span>
                    <span class="stress-chip" title="Slowest run of your solution so far"><span>Solution</span> <b>${stressMs(run.solMax)}</b></span>
                    <span class="stress-chip" title="Slowest run of the brute force so far"><span>Brute force</span> <b>${stressMs(run.bruteMax)}</b></span>
                </div>
                <div class="stress-progress"><span></span></div>
                <div class="stress-hint"><span class="stress-file" translate="no">${solName}</span> <span>vs</span> <span class="stress-file" translate="no">${escHtml(run.bruteName)}</span><span class="stress-sep">·</span><span>Stops at the first test where the outputs differ.</span></div>`;
        }
    } else if (r && r.kind === 'fail') {
        const diff = r.verdict === 'WA' ? stressDiffLines(r.output, r.expected) : null;
        html = `
            <div class="stress-head">
                <span class="test-result-status ${escHtml(r.verdict)}">${escHtml(r.verdict)}</span>
                <span class="stress-title"><span>Test</span> <b>${r.testNo}</b></span>
                <span class="stress-chip" title="The generator's argument for this test"><span>seed</span> <b translate="no">${r.seed}</b></span>
                <span class="stress-chip" title="Run time of your solution">${stressMs(r.time)}</span>
                <span class="stress-file stress-file-muted" translate="no">${escHtml(run.solName)}</span>
                <span class="stress-actions">
                    <button class="stress-btn primary" id="stress-add" ${r.addedAs ? 'disabled' : ''}>${r.addedAs ? `Added as Test ${r.addedAs}` : 'Add to tests'}</button>
                    <button class="stress-btn" id="stress-copy">Copy input</button>
                </span>
            </div>
            ${r.details ? `<div class="stress-details" title="${escHtml(r.details)}">${escHtml(r.details)}</div>` : ''}
            <div class="stress-case">
                <div class="stress-col"><div class="stress-col-title">Input</div><pre class="stress-pre">${stressLinesHtml(r.input)}</pre></div>
                <div class="stress-col bad"><div class="stress-col-title">Your output</div><pre class="stress-pre">${stressLinesHtml(r.output, diff)}</pre></div>
                <div class="stress-col good"><div class="stress-col-title">Brute force</div><pre class="stress-pre">${stressLinesHtml(r.expected, diff)}</pre></div>
            </div>`;
    } else if (r && (r.kind === 'pass' || r.kind === 'timeup' || r.kind === 'stopped')) {
        const note = r.kind === 'pass' ? 'All tests passed' : r.kind === 'timeup' ? 'Time is up' : 'Stopped';
        html = `
            <div class="test-results-summary all-passed stress-summary">
                <span class="test-summary-ratio">${run.done}</span>
                <span class="test-summary-stat passed">✓ <span>${run.done ? 'No difference found' : 'Nothing was tested'}</span></span>
                <span class="stress-chip">${note}</span>
                <span class="test-summary-stat total">${stressElapsedSeconds(run)} s</span>
            </div>
            <div class="stress-hint">
                <span class="stress-file" translate="no">${escHtml(run.solName)}</span> <span>vs</span> <span class="stress-file" translate="no">${escHtml(run.bruteName)}</span><span class="stress-sep">·</span><span>Solution</span> <b>${stressMs(run.solMax)}</b><span class="stress-sep">·</span><span>Brute force</span> <b>${stressMs(run.bruteMax)}</b>
            </div>
            <div class="stress-hint">Each run uses new random seeds. Press Start to test again.</div>`;
    } else if (r && (r.kind === 'error' || r.kind === 'compile')) {
        html = `
            <div class="test-results-summary has-failed stress-summary">
                <span class="test-result-status ${r.kind === 'compile' ? 'CE' : 'RE'}">${r.kind === 'compile' ? 'CE' : '!'}</span>
                <span class="stress-title">${escHtml(r.title || '')}</span>
                ${r.seed ? `<span class="stress-chip"><span>seed</span> <b translate="no">${r.seed}</b></span>` : ''}
            </div>
            ${r.detail ? (r.kind === 'compile'
                ? `<pre class="stress-pre stress-error-text">${escHtml(r.detail)}</pre>`
                : `<div class="stress-hint">${escHtml(r.detail)}</div>`) : ''}`;
    } else {
        // Idle: what this is, and what is missing.
        const saved = tab && tab.path;
        const choice = saved ? resolveStressChoice() : null;
        let need = '';
        if (!tab) need = 'Open your solution first.';
        else if (!saved) need = 'Save this file first: the generator and brute force are picked from its folder.';
        else if (!choice.gen || !choice.brute) need = 'Pick a generator and a brute force on the left, or create them with +.';
        html = `
            <div class="stress-head">
                <span class="stress-title">Stress test</span>
                ${tab ? `<span class="stress-file" translate="no">${escHtml(tab.name)}</span>` : ''}
            </div>
            <div class="stress-steps">
                <span class="stress-step"><b>1</b><span>Generator prints a random test</span></span>
                <span class="stress-step"><b>2</b><span>Brute force gives the answer</span></span>
                <span class="stress-step"><b>3</b><span>Your solution must match it</span></span>
            </div>
            <div class="stress-hint ${need ? 'stress-need' : ''}">${need ? escHtml(need) : 'Press Start. It stops at the first test where the outputs differ.'}</div>`;
    }

    main.innerHTML = html;

    const bar = main.querySelector('.stress-progress > span');
    if (bar && run) {
        const byCount = run.total ? run.done / run.total : 0;
        const byTime = run.startedAt ? (Date.now() - run.startedAt) / (run.seconds * 1000) : 0;
        bar.style.width = run.phase === 'compile' ? '0%' : `${Math.min(100, Math.max(byCount, byTime) * 100).toFixed(1)}%`;
    }
    main.querySelector('#stress-add')?.addEventListener('click', addStressCaseToTests);
    main.querySelector('#stress-copy')?.addEventListener('click', copyStressInput);
    // The elapsed time moves on even while one slow test runs.
    if (Stress.running) paintStressSoonAfter(1000);
}

let stressTickTimer = null;
function paintStressSoonAfter(ms) {
    if (stressTickTimer) return;
    stressTickTimer = setTimeout(() => { stressTickTimer = null; if (Stress.running) renderStressView(); }, ms);
}

/** Called by switchDockedPanel when the STRESS tab is shown. */
function onStressViewShown() {
    if (!Stress.running) refreshStressFiles();
    else renderStressView();
}

/** Called when the focused tab changes (loadTestStateFromTab). */
function onStressTabChanged() {
    if (Stress.running || !stressViewVisible()) return;
    refreshStressFiles();
}

function initStressTest() {
    stressEl('btn-stress-run')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleStressTest();
    });
    const pick = (kind) => (e) => {
        const choice = stressChoiceFor(Stress.folder);
        choice[kind] = e.target.value;
        renderStressView();
    };
    stressEl('stress-gen')?.addEventListener('change', pick('gen'));
    stressEl('stress-brute')?.addEventListener('change', pick('brute'));
    // A file created or renamed elsewhere shows up the next time a select is opened.
    for (const id of ['stress-gen', 'stress-brute']) {
        stressEl(id)?.addEventListener('focus', () => { if (!Stress.running) refreshStressFiles(); });
    }
    stressEl('stress-new-gen')?.addEventListener('click', () => createStressFile('gen'));
    stressEl('stress-new-brute')?.addEventListener('click', () => createStressFile('brute'));

    const count = stressEl('stress-count');
    const secs = stressEl('stress-seconds');
    const sync = () => {
        const s = stressSettings();
        if (count) count.value = s.tests;
        if (secs) secs.value = s.seconds;
    };
    const save = () => {
        App.settings.execution.stressTests = Number(count?.value);
        App.settings.execution.stressSeconds = Number(secs?.value);
        const s = stressSettings();   // clamped
        App.settings.execution.stressTests = s.tests;
        App.settings.execution.stressSeconds = s.seconds;
        sync();
        saveSettingsSoon();
    };
    count?.addEventListener('change', save);
    secs?.addEventListener('change', save);
    sync();
    renderStressView();
}

initStressTest();
