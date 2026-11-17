/*
 * Popup logic. Talks to the worker only through chrome.runtime.sendMessage
 * (popup:getState, popup:sendProblem, popup:retry, popup:setSetting, popup:clearRecent) and
 * reads chrome.storage for live updates. Markup lives in popup.html, styling in ui.css /
 * popup.css, texts in _locales (helpers in ui.js, language choice in shared/i18n.js).
 * Judge-provided text is only ever inserted with textContent.
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const APP_SITE = 'https://sameko.dev';

function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
}

// [status word, notice text] per connection state; the notice is hidden while connected.
const STATE_KEYS = {
    connected: ['stConnected', null],
    unpaired: ['stWaiting', 'noticeWaiting'],
    denied: ['stDenied', 'noticeDenied'],
    disconnected: ['stOffline', 'noticeOffline']
};
const DETAIL_KEYS = {
    protocol: ['stUpdate', 'noticeProtocol'],
    forbidden: ['stOffline', 'noticePort'],
    'bad-response': ['stOffline', 'noticePort']
};

let lastConnection = null;
function renderConnection(c) {
    lastConnection = c || null;
    const state = (c && c.state) || 'disconnected';
    const detail = c && c.detail;
    const keys = (state === 'disconnected' && DETAIL_KEYS[detail]) || STATE_KEYS[state] || STATE_KEYS.disconnected;
    $('.connection').dataset.state = state;
    $('.connection-label').textContent = t(keys[0]);
    $('.notice').hidden = !keys[1];
    $('.notice-text').textContent = keys[1] ? t(keys[1]) : '';
    const offline = state === 'disconnected';
    // Not running: open it (or download it). Too old: download the new one.
    const notRunning = offline && (!detail || detail === 'unreachable');
    $('.connection-open').hidden = !notRunning;
    $('.notice-foot').hidden = !notRunning;
    $('.connection-link').hidden = !(offline && detail === 'protocol');
    $('.connection-retry').hidden = state !== 'denied';
    renderOpen();
    if (!sending && !resultTimer) renderSend(null);
}

// Open: the browser asks "Open Sameko Dev C++?"; the popup then re-checks the connection for a
// while, as the app needs a few seconds to start and answer.
let openingUntil = 0;
function renderOpen() {
    const btn = $('.connection-open');
    const opening = Date.now() < openingUntil;
    btn.disabled = opening;
    btn.textContent = t(opening ? 'actionOpening' : 'actionOpenApp');
}

async function openApp() {
    openingUntil = Date.now() + 15000;
    renderOpen();
    await send({ type: 'popup:openApp' });
    const timer = setInterval(async () => {
        if (Date.now() >= openingUntil || (lastConnection && lastConnection.state !== 'disconnected')) {
            clearInterval(timer);
            openingUntil = 0;
            renderOpen();
            return;
        }
        await refresh();
    }, 1500);
}

// The button says what it will do, or what is missing; the result shows on the button itself.
let tabCanSend = false;
let resultTimer = null;
let sending = false;
function renderSend(result) {
    const btn = $('.send-problem');
    const label = $('.send-label');
    if (result) btn.dataset.result = result.ok ? 'ok' : 'fail'; else delete btn.dataset.result;
    btn.title = (result && result.title) || '';
    btn.hidden = false;
    if (sending) { btn.disabled = true; label.textContent = t('sendSending'); return; }
    if (result) { btn.disabled = true; label.textContent = t(result.ok ? 'sendOk' : 'sendFail'); return; }
    // On a problem page only; greyed out until the app is connected (the notice above says why).
    btn.hidden = !tabCanSend;
    btn.disabled = !(lastConnection && lastConnection.state === 'connected');
    label.textContent = t('sendButton');
}

function renderTab(tab) {
    tabCanSend = !!(tab && tab.canSend);
    if (!sending && !resultTimer) renderSend(null);
}

function renderSettings(settings) {
    for (const input of document.querySelectorAll('[data-setting]')) {
        input.checked = !!(settings && settings[input.dataset.setting]);
    }
}

// ── recent submissions ────────────────────────────────────────────────────────────────
const PENDING_STATES = new Set(['queued', 'opened', 'filled', 'submitted', 'judging']);
const BAD_CODES = new Set(['WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE']);
const STATE_LABELS = { queued: 'stateOpened', opened: 'stateOpened', filled: 'stateFilled', submitted: 'stateSubmitted', judging: 'stateJudging', done: 'stateDone', failed: 'stateFailed' };

/** The stored item has only the URL: show the part that names the problem, e.g. "1900 / A". */
function problemLabel(item) {
    if (item.name) return String(item.name);
    try {
        const u = new URL(item.url);
        const skip = new Set(['contest', 'contests', 'problem', 'problems', 'problemset', 'task', 'tasks', 'submit']);
        const parts = u.pathname.split('/').filter(p => p && !skip.has(p.toLowerCase())).slice(-2);
        if (parts.length) return decodeURIComponent(parts.join(' / '));
        return u.host;
    } catch (_) { return String(item.url || ''); }
}

function hostOf(url) {
    try { return new URL(url).host.replace(/^www\./, ''); } catch (_) { return ''; }
}

/** The judge's own name ("Codeforces", "VNOJ") from its adapter; the host until adapters load. */
let adapterRegistry = null;
function siteLabel(url) {
    const a = adapterRegistry && adapterRegistry.byUrl(url);
    if (a) {
        try { if (typeof a.siteName === 'function') return String(a.siteName(url)); } catch (_) { /* name */ }
        return String(a.name || '');
    }
    return hostOf(url);
}

const LANGUAGE_NAMES = { cpp: 'C++', c: 'C', python: 'Python', java: 'Java', kotlin: 'Kotlin', rust: 'Rust', go: 'Go', pascal: 'Pascal', javascript: 'JavaScript', csharp: 'C#' };
function languageLabel(item) {
    const name = LANGUAGE_NAMES[item.language] || '';
    // The app sends the -std= value: "c++17", "gnu++20", "c11" → "C++17", "C11".
    const m = /(\d{2})\s*$/.exec(String(item.std || ''));
    return name && m && (item.language === 'cpp' || item.language === 'c') ? name + m[1] : name;
}

function relativeTime(ts) {
    if (!ts) return '';
    try {
        const rtf = new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'auto' });
        const s = Math.round((ts - Date.now()) / 1000);
        const abs = Math.abs(s);
        if (abs < 45) return rtf.format(0, 'second');
        if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
        return rtf.format(Math.round(s / 86400), 'day');
    } catch (_) { return ''; }
}

function usage(v) {
    const out = [];
    if (v && Number.isFinite(v.timeMs)) out.push(v.timeMs + ' ms');
    if (v && Number.isFinite(v.memoryKb)) out.push((Math.round(v.memoryKb / 102.4) / 10) + ' MB');
    return out.join(' · ');
}

/** → { label, kind, detail } for the chip. Judge text (verdict.text, message) is data, not translated. */
function describe(item) {
    const v = item.verdict;
    if (item.state === 'done' && v) {
        const code = String(v.code || '');
        let kind = 'warn', label = code;
        if (code === 'AC') kind = 'ok';
        else if (BAD_CODES.has(code)) kind = 'bad';
        else if (code === 'PARTIAL') label = t('verdictPartial') || code;
        else if (code === 'OTHER') label = t('verdictOther') || code;
        // "Accepted" next to an AC chip says nothing new; "Wrong answer on test 7" does.
        const text = String(v.text || '');
        const same = text === code || (!/\d/.test(text) && adapterRegistry && adapterRegistry.normalizeVerdict(text) === code);
        return { label, kind, detail: same ? '' : text };
    }
    if (item.state === 'failed') return { label: t('stateFailed'), kind: 'bad', detail: (item.error && (item.error.message || item.error.code)) || '' };
    // A fill-only submit ends at filled: the user presses Submit on the judge's page.
    if (item.state === 'filled' && item.autoSubmit === false) return { label: t('stateFilled'), kind: 'info', detail: '' };
    if (PENDING_STATES.has(item.state)) return { label: t(STATE_LABELS[item.state]), kind: 'pending', detail: item.state === 'judging' ? (item.message || '') : '' };
    return { label: t(STATE_LABELS[item.state] || 'stateDone') || String(item.state || ''), kind: 'info', detail: '' };
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

const verdictTag = (d) => el('span', 'tag tag-' + d.kind, d.label);

let lastRecent = [];
function renderRecent(recent) {
    lastRecent = Array.isArray(recent) ? recent : [];
    const list = $('.recent-list');
    list.textContent = '';
    $('.recent').hidden = lastRecent.length === 0;
    $('.recent .fold-count').textContent = lastRecent.length ? String(lastRecent.length) : '';

    // Folded, the newest verdict stays in sight on the header.
    const summary = $('.recent .fold-summary');
    summary.textContent = '';
    if (lastRecent[0]) summary.append(verdictTag(describe(lastRecent[0])));

    for (const item of lastRecent) {
        const li = el('li', 'recent-item');
        li.dataset.state = item.state || '';
        if (item.verdict) li.dataset.verdict = item.verdict.code;

        const link = el('a', 'recent-link');
        link.href = item.submissionUrl || item.url;
        link.title = item.url || '';
        link.addEventListener('click', (e) => { e.preventDefault(); openTab(link.href); });

        const d = describe(item);
        const site = el('span', 'recent-site', siteLabel(item.url));
        const name = el('span', 'recent-name', problemLabel(item));
        site.setAttribute('translate', 'no');
        name.setAttribute('translate', 'no');
        link.append(site, name, verdictTag(d));

        const meta = [d.detail, item.state === 'done' ? usage(item.verdict) : '', languageLabel(item), relativeTime(item.updatedAt || item.startedAt)]
            .filter(Boolean).join(' · ');
        if (meta) link.append(el('span', 'recent-detail', meta));
        link.title = [meta, item.submissionUrl || item.url].filter(Boolean).join('\n');
        li.append(link);
        list.append(li);
    }
}

// ── folds and language ────────────────────────────────────────────────────────────────
const FOLD_DEFAULTS = { recent: true, settings: false };
const folds = Object.assign({}, FOLD_DEFAULTS);

function renderFolds() {
    for (const section of document.querySelectorAll('[data-fold]')) {
        const open = !!folds[section.dataset.fold];
        section.classList.toggle('open', open);
        section.querySelector('.fold-toggle').setAttribute('aria-expanded', String(open));
        section.querySelector('.fold-body').hidden = !open;
    }
}

async function loadFolds() {
    try {
        const got = (await chrome.storage.local.get('popupFolds')).popupFolds;
        if (got && typeof got === 'object') {
            for (const k of Object.keys(FOLD_DEFAULTS)) if (typeof got[k] === 'boolean') folds[k] = got[k];
        }
    } catch (_) { /* defaults */ }
    renderFolds();
}

/** Every text again, in the language now in use. */
function renderTexts() {
    applyI18n();
    $('.language-select').value = SamekoI18n.current();
    renderConnection(lastConnection);
    renderSend(null);
    renderRecent(lastRecent);
}

async function setLanguage(value) {
    await SamekoI18n.use(value, chrome, (u) => fetch(u));
    try { await chrome.storage.local.set({ uiLanguage: SamekoI18n.current() }); } catch (_) { /* this popup only */ }
    renderTexts();
}

async function refresh() {
    const s = await send({ type: 'popup:getState' });
    if (!s) return;
    // A worker that has just restarted answers "disconnected" with no detail before its first
    // hello; the last known state (session storage) stays until the hello settles it.
    const unchecked = s.connection && s.connection.state === 'disconnected' && !s.connection.detail;
    if (!(unchecked && lastConnection)) renderConnection(s.connection);
    renderTab(s.tab);
    renderSettings(s.settings);
    renderRecent(s.recent);
}

function bind() {
    $('.connection-link').addEventListener('click', (e) => { e.preventDefault(); openTab(APP_SITE); });
    $('.connection-download').addEventListener('click', (e) => { e.preventDefault(); openTab(APP_SITE); });
    $('.connection-open').addEventListener('click', () => { openApp(); });
    $('.connection-retry').addEventListener('click', async () => {
        const r = await send({ type: 'popup:retry' });
        if (r && r.connection) renderConnection(r.connection);
    });
    $('.send-problem').addEventListener('click', async () => {
        sending = true;
        renderSend(null);
        const r = await send({ type: 'popup:sendProblem' });
        sending = false;
        const ok = !!(r && r.ok);
        renderSend({ ok, title: ok ? String(r.name || '') : String((r && r.error && r.error.message) || '') });
        clearTimeout(resultTimer);
        resultTimer = setTimeout(() => { resultTimer = null; renderSend(null); }, 1800);
    });
    for (const btn of document.querySelectorAll('.fold-toggle')) {
        btn.addEventListener('click', () => {
            const key = btn.closest('[data-fold]').dataset.fold;
            folds[key] = !folds[key];
            renderFolds();
            chrome.storage.local.set({ popupFolds: folds }).catch(() => {});
        });
    }
    $('.recent-clear').addEventListener('click', () => {
        renderRecent([]);
        send({ type: 'popup:clearRecent' });
    });
    $('.language-select').addEventListener('change', (e) => { setLanguage(e.target.value); });
    for (const input of document.querySelectorAll('[data-setting]')) {
        input.addEventListener('change', () => send({ type: 'popup:setSetting', key: input.dataset.setting, value: input.checked }));
    }
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'connection') renderConnection(msg.connection);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.recent) renderRecent(changes.recent.newValue);
        if (area === 'local' && changes.settings) renderSettings(changes.settings.newValue);
        if (area === 'local' && changes.theme) applyTheme(changes.theme.newValue);
        if (area === 'local' && changes.uiLanguage && (changes.uiLanguage.newValue || 'auto') !== SamekoI18n.current()) {
            loadI18n().then(renderTexts);
        }
        if (area === 'session' && changes.connection) renderConnection(changes.connection.newValue);
    });
}

loadTheme();
loadFolds();
bind();
// Texts first in the picked language; the last known connection shows at once, then
// popup:getState re-checks it.
loadI18n().then(async () => {
    applyI18n();
    $('.language-select').value = SamekoI18n.current();
    try {
        const r = await chrome.storage.session.get('connection');
        if (r.connection) renderConnection(r.connection);
    } catch (_) { /* getState answers */ }
    await refresh();
});
// Judge names for the history ("VNOJ" instead of oj.vnoi.info).
loadAdapters().then((a) => { adapterRegistry = a; if (a && lastRecent.length) renderRecent(lastRecent); });
