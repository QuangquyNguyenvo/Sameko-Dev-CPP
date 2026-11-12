/**
 * Sameko Dev C++ IDE - renderer: submitting to an online judge through the Sameko browser extension.
 *
 * The extension (extension/, contract in extension/PROTOCOL.md) talks to the main process
 * (app/services/competitive/extension-bridge.js); this file is the renderer half of §5:
 * - Submit (TESTS header button, Run menu, `submitToOJ` shortcut) sends the focused tab's text to
 *   the problem URL of its test state (`ccProblem.url`), asking for the URL once when there is none.
 * - The progress and verdict of a tab's last submission live on the tab (`tab.ojSubmission`) and
 *   show in the chip next to the Submit button, the status bar and the terminal log.
 * - The Sameko section of the Get Tests popup (#cc-overlay): connection state and fetching a problem.
 * - The pairing prompt, and the theme snapshot (§4) sent after each theme change.
 *
 * Everything the extension reports (verdicts, messages, URLs) comes from web pages: it is shown with
 * textContent only.
 */

// ============================================================================
// STATE
// ============================================================================
let ojBridge = { running: false, connected: false, paired: false, browser: '', extVersion: '', adapters: [], pendingPair: null };
const ojSubmitTabs = new Map();      // submission id -> tab id
const ojFetchRequests = new Set();   // fetchProblem ids asked from the popup
let ojPairShowing = null;            // origin whose pairing prompt is open
let ojThemeTimer = null;

const OJ_LANGUAGE_BY_EXT = {
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', py: 'python', java: 'java', pas: 'pascal',
    rs: 'rust', go: 'go', kt: 'kotlin', cs: 'csharp', js: 'javascript'
};
const OJ_STATE_LABELS = {
    queued: 'Waiting for the browser',
    opened: 'Opening the judge',
    filled: 'Form filled',
    submitted: 'Submitted',
    judging: 'Judging',
    failed: 'Submit failed'
};
const OJ_VERDICT_KIND = { AC: 'ac', WA: 'bad', TLE: 'bad', MLE: 'bad', RE: 'bad', OLE: 'bad', CE: 'warn', PARTIAL: 'warn', IE: 'warn', OTHER: 'warn' };

/** A terminal line with the [OJ] prefix; the message itself is translated (templates included). */
function ojLog(message, type) {
    log('[OJ] ' + (typeof I18n !== 'undefined' ? I18n.t(message) : message), type);
}

/** The text of a web page made safe for one terminal/status line. */
function ojPlain(text, max = 300) {
    return String(text ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max);
}

function ojHttpUrl(value) {
    let s = String(value ?? '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
        const u = new URL(s);
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u.href : null;
    } catch (_) {
        return null;
    }
}

/** The same problem page whatever its fragment or trailing slash. */
function ojSameUrl(a, b) {
    const norm = (u) => String(u || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
    return !!a && !!b && norm(a) === norm(b);
}

/** The tab whose problem (live for the focused tab, saved for the others) has this URL. */
function ojTabWithProblemUrl(url) {
    const focused = getPreferredTabId();
    return App.tabs.find((t) => {
        const problem = t.id === focused ? ccProblem : t.testState?.problem;
        return problem && ojSameUrl(problem.url, url);
    }) || null;
}

/**
 * Called by handleProblemReceived for a problem from the Sameko extension. Returns the problem
 * without the transport fields, or null when it must be ignored: sent automatically for a page
 * that an open tab already holds.
 */
function ojAcceptProblem(problem) {
    const { via, auto, requestId, ...clean } = problem;
    if (requestId && ojFetchRequests.delete(requestId)) {
        ojSetFetchMessage('');
        hideCCPopup();
    }
    if (auto === true && clean.url && ojTabWithProblemUrl(clean.url)) return null;
    return clean;
}

// ============================================================================
// SUBMIT
// ============================================================================
function ojLanguageOf(tab) {
    const ext = fileExtension(tab.path || tab.name);
    if (!ext) return isCppTab(tab) ? 'cpp' : null;
    return OJ_LANGUAGE_BY_EXT[ext] || null;
}

/** The C++ standard the app builds with: the last -std= of the extra flags, else the setting. */
function ojCppStandard() {
    const c = App.settings.compiler || {};
    const fromFlags = [...String(c.extraFlags || '').matchAll(/(?:^|\s)-std=(\S+)/g)].pop();
    return (fromFlags && fromFlags[1]) || c.cppStandard || 'c++17';
}

function ojHostSupported(url) {
    const adapters = ojBridge.adapters || [];
    if (!adapters.length) return true;   // not known yet: the extension answers unsupported-site itself
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return false; }
    return adapters.some((a) => (a.hosts || []).some((h) => {
        const hh = String(h).toLowerCase();
        return host === hh || host === 'www.' + hh || hh === 'www.' + host;
    }));
}

/** Asks for a problem URL in the app's small text dialog. Resolves the URL, or null. */
function ojAskProblemUrl() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'note-dialog-overlay';
        overlay.innerHTML = `
            <div class="note-dialog input-dialog oj-url-dialog">
                <div class="note-dialog-header">
                    <h3>Problem URL</h3>
                    <button class="note-dialog-close" title="Close"><svg class="ico" width="16" height="16"><use href="#i-x"/></svg></button>
                </div>
                <div class="note-dialog-body">
                    <p class="oj-url-hint">This tab has no online judge problem yet. Paste the link of the problem page; it is remembered for this tab.</p>
                    <input type="url" class="input-dialog-field" spellcheck="false" placeholder="https://codeforces.com/contest/1900/problem/A" />
                    <p class="oj-url-error" hidden>Enter an http:// or https:// link.</p>
                </div>
                <div class="note-dialog-footer">
                    <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                    <button class="note-dialog-btn note-dialog-save">Submit</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('.input-dialog-field');
        const error = overlay.querySelector('.oj-url-error');
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            overlay.remove();
            resolve(value);
        };
        const submit = () => {
            const url = ojHttpUrl(input.value);
            if (!url) { error.hidden = false; input.focus(); return; }
            finish(url);
        };
        overlay.querySelector('.note-dialog-save').addEventListener('click', submit);
        overlay.querySelector('.note-dialog-cancel').addEventListener('click', () => finish(null));
        overlay.querySelector('.note-dialog-close').addEventListener('click', () => finish(null));
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(null); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
        });
        try { document.activeElement?.blur(); } catch (_) { }
        setTimeout(() => { window.focus(); input.focus(); }, 60);
    });
}

/** Keeps the URL on the tab's problem; a tab without one gets a problem with no tests. */
function ojRememberProblemUrl(tab, url) {
    if (getPreferredTabId() === tab.id) {
        if (!ccProblem) ccProblem = { name: 'Manual Problem', tests: [] };
        ccProblem.url = url;
        return;
    }
    if (!tab.testState) tab.testState = { problem: null, index: 0, results: [] };
    if (!tab.testState.problem) tab.testState.problem = { name: 'Manual Problem', tests: [] };
    tab.testState.problem.url = url;
}

/** The record of a failed attempt, shown like a failed submission. */
function ojFailLocally(tab, message, url) {
    tab.ojSubmission = { id: null, state: 'failed', url: url || '', error: { code: 'internal', message } };
    renderOjVerdictChip();
    ojLog(message, 'warning');
    setStatus(message, 'warning');
}

async function submitToOJ() {
    const api = window.electronAPI;
    if (!api?.ojSubmit) return;
    const tab = App.tabs.find((t) => t.id === getPreferredTabId());
    if (!tab) {
        setStatus('Open a file to submit', 'warning');
        return;
    }
    const language = ojLanguageOf(tab);
    if (!language) {
        ojFailLocally(tab, 'This file type cannot be submitted to an online judge.');
        return;
    }
    const source = tabSourceText(tab);
    if (!source.trim()) {
        ojFailLocally(tab, 'There is no source code to submit.');
        return;
    }

    let url = ojHttpUrl(getPreferredTabId() === tab.id ? ccProblem?.url : tab.testState?.problem?.url);
    if (!url) {
        url = await ojAskProblemUrl();
        if (!url || !App.tabs.includes(tab)) return;
        ojRememberProblemUrl(tab, url);
    }

    try { ojBridge = (await api.ojBridgeStatus()) || ojBridge; } catch (_) { }
    renderOjBridgeState();
    if (!ojHostSupported(url)) {
        let host = url;
        try { host = new URL(url).hostname; } catch (_) { }
        ojFailLocally(tab, `${host} is not supported by the Sameko extension yet.`, url);
        return;
    }

    const job = { url, source, language, fileName: tab.name, autoSubmit: true };
    if (language === 'cpp') job.std = ojCppStandard();
    let result;
    try {
        result = await api.ojSubmit(job);
    } catch (e) {
        result = { success: false, error: { message: String(e && e.message || e) } };
    }
    if (!result || !result.success) {
        const message = ojPlain(result?.error?.message) || 'The submission could not be sent.';
        ojFailLocally(tab, message, url);
        return;
    }

    ojSubmitTabs.set(result.id, tab.id);
    tab.ojSubmission = { id: result.id, state: 'queued', url };
    renderOjVerdictChip();
    ojLog(`Submitting ${tab.name}`, 'info');
    if (ojBridge.connected) {
        setStatus('Submitting…', 'running');
    } else {
        const msg = 'The browser extension is not connected. Open the browser with the Sameko extension; the submission waits 60 seconds for it.';
        ojLog(msg, 'warning');
        setStatus('Waiting for the browser extension…', 'warning');
    }
}

function ojVerdictLine(verdict) {
    const parts = [verdict.code];
    const text = ojPlain(verdict.text, 200);
    if (text && text !== verdict.code) parts.push(text);
    if (Number.isFinite(verdict.timeMs)) parts.push(`${verdict.timeMs} ms`);
    if (Number.isFinite(verdict.memoryKb)) parts.push(`${Math.round(verdict.memoryKb / 1024 * 10) / 10} MB`);
    return parts.join(' · ');
}

function onOjSubmitStatus(ev) {
    if (!ev || typeof ev.id !== 'string') return;
    const tab = App.tabs.find((t) => t.id === ojSubmitTabs.get(ev.id));
    const sub = tab && tab.ojSubmission && tab.ojSubmission.id === ev.id ? tab.ojSubmission : null;
    if (sub) {
        sub.state = ev.state;
        if (ev.message !== undefined) sub.message = ev.message;
        if (ev.submissionUrl) sub.submissionUrl = ev.submissionUrl;
        if (ev.verdict) sub.verdict = ev.verdict;
        if (ev.error) sub.error = ev.error;
        renderOjVerdictChip();
    }
    if (ev.state === 'done' || ev.state === 'failed') ojSubmitTabs.delete(ev.id);
    if (!sub) return;   // the tab closed or submitted again since

    const name = tab.name;
    switch (ev.state) {
        case 'opened':
            ojLog('Opened the submit page in the browser', 'info');
            setStatus('Opening the judge…', 'running');
            break;
        case 'filled':
            ojLog('Filled in the submit form', 'info');
            break;
        case 'submitted':
            ojLog('Submitted, waiting for the verdict', 'info');
            setStatus('Submitted, judging…', 'running');
            break;
        case 'judging': {
            const message = ojPlain(ev.message, 120);
            setStatus(message ? `Judging: ${message}` : 'Judging…', 'running');
            break;
        }
        case 'done': {
            const v = ev.verdict || { code: 'OTHER' };
            const line = ojVerdictLine(v);
            log(`[OJ] ${name}: ${line}`, v.code === 'AC' ? 'success' : (OJ_VERDICT_KIND[v.code] === 'bad' ? 'error' : 'warning'));
            setStatus(`${name}: ${v.code}`, v.code === 'AC' ? 'success' : 'error');
            break;
        }
        case 'failed': {
            const message = ojPlain(ev.error?.message) || 'The submission failed.';
            ojLog(`Submit failed: ${message}`, 'error');
            setStatus('Submit failed', 'error');
            break;
        }
    }
}

// ============================================================================
// VERDICT CHIP (TESTS header, next to Submit)
// ============================================================================
function renderOjVerdictChip() {
    const chip = document.getElementById('oj-verdict');
    if (!chip) return;
    const tab = App.tabs.find((t) => t.id === getPreferredTabId());
    const sub = tab && tab.ojSubmission;
    chip.textContent = '';
    if (!sub) {
        chip.hidden = true;
        chip.removeAttribute('title');
        return;
    }
    chip.hidden = false;
    let kind = 'progress';
    const add = (text, cls, raw) => {
        const span = document.createElement('span');
        span.className = cls;
        if (raw) span.setAttribute('translate', 'no');
        span.textContent = text;
        chip.appendChild(span);
    };
    let title = '';
    if (sub.state === 'done' && sub.verdict) {
        kind = OJ_VERDICT_KIND[sub.verdict.code] || 'warn';
        add(sub.verdict.code, 'oj-verdict-code', true);
        const text = ojPlain(sub.verdict.text, 200);
        if (text && text !== sub.verdict.code) add(text, 'oj-verdict-text', true);
        title = ojVerdictLine(sub.verdict);
    } else if (sub.state === 'failed') {
        kind = 'bad';
        add(OJ_STATE_LABELS.failed, 'oj-verdict-code');
        title = ojPlain(sub.error?.message);
    } else {
        add(OJ_STATE_LABELS[sub.state] || OJ_STATE_LABELS.queued, 'oj-verdict-code');
        const message = sub.state === 'judging' ? ojPlain(sub.message, 120) : '';
        if (message) add(message, 'oj-verdict-text', true);
        title = message;
    }
    const link = sub.submissionUrl && ojHttpUrl(sub.submissionUrl) === sub.submissionUrl ? sub.submissionUrl : '';
    chip.dataset.kind = kind;
    chip.classList.toggle('has-link', !!link);
    if (link) title = (title ? title + '\n' : '') + link;
    if (title) chip.title = title; else chip.removeAttribute('title');
}

function openOjSubmission() {
    const tab = App.tabs.find((t) => t.id === getPreferredTabId());
    const url = tab?.ojSubmission?.submissionUrl;
    if (url && /^https?:\/\//i.test(url)) window.electronAPI?.openExternalLink?.(url);
}

// ============================================================================
// GET TESTS POPUP: the Sameko extension section
// ============================================================================
function renderOjBridgeState() {
    const state = document.getElementById('oj-ext-state');
    if (!state) return;
    let key = 'off';
    let text = 'Not connected';
    if (ojBridge.pendingPair) { key = 'pending'; text = 'Waiting for approval'; }
    else if (ojBridge.connected && ojBridge.paired) { key = 'on'; text = 'Connected'; }
    state.dataset.state = key;
    state.textContent = text;
    const browser = ojPlain(ojBridge.browser, 32);
    state.title = key === 'on' && browser ? `${browser} ${ojPlain(ojBridge.extVersion, 32)}`.trim() : '';
}

function ojSetFetchMessage(text, kind = '') {
    const el = document.getElementById('oj-ext-msg');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.dataset.kind = kind;
}

async function ojFetchProblem(url) {
    const api = window.electronAPI;
    if (!api?.ojFetchProblem) return;
    let req = {};
    if (url !== undefined) {
        const clean = ojHttpUrl(url);
        if (!clean) {
            ojSetFetchMessage('Enter an http:// or https:// link.', 'error');
            return;
        }
        req = { url: clean };
    }
    let result;
    try {
        result = await api.ojFetchProblem(req);
    } catch (e) {
        result = { success: false, error: { message: String(e && e.message || e) } };
    }
    if (!result || !result.success) {
        ojSetFetchMessage(ojPlain(result?.error?.message) || 'The request could not be sent.', 'error');
        return;
    }
    ojFetchRequests.add(result.id);
    ojSetFetchMessage(ojBridge.connected
        ? 'Asked the browser for the problem…'
        : 'Waiting for the browser extension (60 seconds)…', ojBridge.connected ? '' : 'warn');
}

const OJ_FETCH_ERRORS = {
    'no-problem-tab': 'No online judge problem is open in the browser.',
    'unsupported-site': 'The Sameko extension does not support this site yet.',
    'parse-failed': 'The extension could not read the problem on that page.',
    'timeout': 'The problem page took too long to load in the browser.',
    'tab-closed': 'The browser tab was closed before the problem was read.'
};

function onOjFetchFailed(ev) {
    if (!ev || !ojFetchRequests.delete(ev.requestId)) return;
    // The extension's own wording is English only; known codes get the app's (translated) text.
    const message = OJ_FETCH_ERRORS[ev.error?.code] || ojPlain(ev.error?.message) || 'The browser could not get the problem.';
    ojSetFetchMessage(message, 'error');
    ojLog(message, 'warning');
    setStatus('Could not get the problem', 'warning');
}

// ============================================================================
// PAIRING
// ============================================================================
async function ojPromptPair(req) {
    const api = window.electronAPI;
    if (!req || typeof req.origin !== 'string' || !api?.ojPairRespond) return;
    if (ojPairShowing === req.origin) return;
    // Another question is open in the shared confirm dialog: ask after it.
    if (ojPairShowing || document.getElementById('confirm-dialog')?.classList.contains('active')) {
        setTimeout(() => {
            if (ojBridge.pendingPair && ojBridge.pendingPair.origin === req.origin) ojPromptPair(req);
        }, 700);
        return;
    }
    ojPairShowing = req.origin;
    const browserRaw = ojPlain(req.browser, 32) || 'browser';
    const browser = browserRaw.charAt(0).toUpperCase() + browserRaw.slice(1);
    const extId = ojPlain(req.origin, 160).replace(/^[a-z-]+:\/\//i, '');
    const answer = showConfirmDialog({
        title: 'Connect the browser extension?',
        message: `The Sameko extension in ${browser} will receive the code you submit. ID: ${extId}`,
        confirmText: 'Allow',
        cancelText: 'Deny'
    });
    // Enter answers with the focused button: start on Deny, so a key typed into the editor as the
    // prompt appears cannot approve it.
    document.getElementById('confirm-dialog-cancel')?.focus();
    const allow = await answer;
    ojPairShowing = null;
    try { await api.ojPairRespond({ origin: req.origin, allow: !!allow }); } catch (_) { }
    ojLog(allow ? 'Browser extension connected' : 'Browser extension denied', allow ? 'success' : 'info');
}

function onOjBridgeStatus(status) {
    if (!status || typeof status !== 'object') return;
    ojBridge = status;
    renderOjBridgeState();
    if (status.pendingPair) ojPromptPair(status.pendingPair);
}

// ============================================================================
// THEME SNAPSHOT (PROTOCOL §4)
// ============================================================================
/** Debounced and run when idle: called on every ThemeManager.setTheme. */
function scheduleOjThemeSnapshot() {
    if (!window.electronAPI?.ojSetTheme) return;
    clearTimeout(ojThemeTimer);
    ojThemeTimer = setTimeout(() => {
        const send = () => {
            try { window.electronAPI.ojSetTheme(ojThemeSnapshot())?.catch?.(() => { }); } catch (_) { }
        };
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(send, { timeout: 2000 });
        else send();
    }, 400);
}

function ojThemeSnapshot() {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    // Resolve each token to rgb()/rgba() through a probe, so color-mix() or names arrive as colours.
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const color = (name, opaque) => {
        const raw = cs.getPropertyValue(name).trim();
        if (!raw) return undefined;
        probe.style.color = '';
        probe.style.color = raw;
        let out = probe.style.color ? getComputedStyle(probe).color : '';
        if (opaque) out = out.replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/, 'rgb($1,$2,$3)');
        return out || undefined;
    };
    const snap = {
        id: (typeof ThemeManager !== 'undefined' && ThemeManager.activeThemeId) || root.getAttribute('data-theme') || '',
        variant: root.getAttribute('data-theme-variant') === 'light' ? 'light' : 'dark',
        bg: color('--editor-bg', true),
        surface: color('--bg-panel', true),
        border: color('--border'),
        text: color('--text-primary'),
        textMuted: color('--text-muted'),
        accent: color('--accent'),
        accentText: color('--btn-primary-text'),
        success: color('--success'),
        warning: color('--warning'),
        error: color('--error')
    };
    probe.remove();
    for (const k of Object.keys(snap)) if (snap[k] === undefined) delete snap[k];
    return snap;
}

// ============================================================================
// INIT
// ============================================================================
function initOjSubmit() {
    const api = window.electronAPI;
    document.getElementById('btn-oj-submit')?.addEventListener('click', () => submitToOJ());
    document.getElementById('oj-verdict')?.addEventListener('click', openOjSubmission);
    document.getElementById('oj-fetch-current')?.addEventListener('click', () => ojFetchProblem());
    const urlInput = document.getElementById('oj-fetch-url');
    document.getElementById('oj-fetch-url-btn')?.addEventListener('click', () => ojFetchProblem(urlInput?.value || ''));
    urlInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); ojFetchProblem(urlInput.value); }
    });
    if (!api?.onOjBridgeStatus) return;
    api.onOjBridgeStatus(onOjBridgeStatus);
    api.onOjSubmitStatus(onOjSubmitStatus);
    api.onOjFetchFailed(onOjFetchFailed);
    api.onOjPairRequest((req) => ojPromptPair(req));
    // After startup settles: a prompt that came before this page (a reload) is still pending.
    setTimeout(() => {
        api.ojBridgeStatus().then(onOjBridgeStatus).catch(() => { });
    }, 1500);
}

initOjSubmit();

if (typeof module !== 'undefined' && module.exports) module.exports = { submitToOJ, ojThemeSnapshot }; else window.submitToOJ = submitToOJ;
