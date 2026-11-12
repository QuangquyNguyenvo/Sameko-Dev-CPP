/*
 * Popup logic. Talks to the worker only through chrome.runtime.sendMessage
 * (popup:getState, popup:sendProblem, popup:retry, popup:setSetting) and reads chrome.storage
 * for live updates. Markup lives in popup.html, styling in ui.css / popup.css, texts in
 * _locales (helpers in ui.js). Judge-provided text is only ever inserted with textContent.
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

function renderConnection(c) {
    const state = (c && c.state) || 'disconnected';
    const detail = c && c.detail;
    const keys = (state === 'disconnected' && DETAIL_KEYS[detail]) || STATE_KEYS[state] || STATE_KEYS.disconnected;
    $('.connection').dataset.state = state;
    $('.connection-label').textContent = t(keys[0]);
    $('.notice').hidden = !keys[1];
    $('.notice-text').textContent = keys[1] ? t(keys[1]) : '';
    const offline = state === 'disconnected';
    $('.connection-link').hidden = !(offline && (!detail || detail === 'unreachable' || detail === 'protocol'));
    $('.connection-retry').hidden = state !== 'denied';
}

// The button says what it will do, or what is missing; the result shows on the button itself.
let tabCanSend = false;
let resultTimer = null;
function renderSend(result) {
    const btn = $('.send-problem');
    const label = $('.send-label');
    if (result) btn.dataset.result = result.ok ? 'ok' : 'fail'; else delete btn.dataset.result;
    btn.title = (result && result.title) || '';
    if (sending) { btn.disabled = true; label.textContent = t('sendSending'); return; }
    if (result) { btn.disabled = true; label.textContent = t(result.ok ? 'sendOk' : 'sendFail'); return; }
    btn.disabled = !tabCanSend;
    label.textContent = t(tabCanSend ? 'sendButton' : 'sendNeedPage');
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
const PENDING_STATES = new Set(['opened', 'filled', 'submitted', 'judging']);
const BAD_CODES = new Set(['WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE']);
const STATE_LABELS = { opened: 'stateOpened', filled: 'stateFilled', submitted: 'stateSubmitted', judging: 'stateJudging', done: 'stateDone', failed: 'stateFailed' };

/** The stored item has only the URL: show the part that names the problem, e.g. "1900 / A". */
function problemLabel(item) {
    if (item.name) return String(item.name);
    try {
        const u = new URL(item.url);
        const skip = new Set(['contest', 'contests', 'problem', 'problems', 'problemset', 'task', 'tasks']);
        const parts = u.pathname.split('/').filter(p => p && !skip.has(p.toLowerCase())).slice(-2);
        if (parts.length) return decodeURIComponent(parts.join(' / '));
        return u.host;
    } catch (_) { return String(item.url || ''); }
}

function siteOf(url) {
    try { return new URL(url).host.replace(/^www\./, ''); } catch (_) { return ''; }
}

function relativeTime(ts) {
    if (!ts) return '';
    try {
        const rtf = new Intl.RelativeTimeFormat(chrome.i18n.getUILanguage(), { numeric: 'auto' });
        const s = Math.round((ts - Date.now()) / 1000);
        const abs = Math.abs(s);
        if (abs < 45) return rtf.format(0, 'second');
        if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
        if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
        return rtf.format(Math.round(s / 86400), 'day');
    } catch (_) { return ''; }
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
        return { label, kind, detail: v.text || '' };
    }
    if (item.state === 'failed') return { label: t('stateFailed'), kind: 'bad', detail: (item.error && (item.error.message || item.error.code)) || '' };
    if (PENDING_STATES.has(item.state)) return { label: t(STATE_LABELS[item.state]), kind: 'pending', detail: item.state === 'judging' ? (item.message || '') : '' };
    return { label: t(STATE_LABELS[item.state] || 'stateDone') || String(item.state || ''), kind: 'info', detail: '' };
}

function renderRecent(recent) {
    const list = $('.recent-list');
    list.textContent = '';
    const items = Array.isArray(recent) ? recent.slice(0, 5) : [];
    list.hidden = items.length === 0;
    for (const item of items) {
        const li = document.createElement('li');
        li.className = 'recent-item';
        li.dataset.state = item.state || '';
        if (item.verdict) li.dataset.verdict = item.verdict.code;

        const link = document.createElement('a');
        link.className = 'recent-link';
        link.href = item.submissionUrl || item.url;
        link.title = [siteOf(item.url), relativeTime(item.updatedAt || item.startedAt)].filter(Boolean).join(' \u00b7 ');
        link.addEventListener('click', (e) => { e.preventDefault(); openTab(link.href); });

        const name = document.createElement('span');
        name.className = 'recent-name';
        name.textContent = problemLabel(item);

        const d = describe(item);
        const tag = document.createElement('span');
        tag.className = `tag tag-${d.kind}`;
        tag.textContent = d.label;

        link.append(name, tag);
        if (d.detail) {
            const det = document.createElement('span');
            det.className = 'recent-detail';
            det.textContent = d.detail;
            link.append(det);
        }
        li.append(link);
        list.append(li);
    }
}

async function refresh() {
    const s = await send({ type: 'popup:getState' });
    if (!s) return;
    renderConnection(s.connection);
    renderTab(s.tab);
    renderSettings(s.settings);
    renderRecent(s.recent);
}

let sending = false;

function bind() {
    $('.connection-link').addEventListener('click', (e) => { e.preventDefault(); openTab(APP_SITE); });
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
        if (area === 'session' && changes.connection) renderConnection(changes.connection.newValue);
    });
}

applyI18n();
// The last known state shows at once; popup:getState then re-checks it.
chrome.storage.session.get('connection').then(r => { if (r.connection) renderConnection(r.connection); }).catch(() => {});
loadTheme();
bind();
refresh();
