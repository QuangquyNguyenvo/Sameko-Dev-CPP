/*
 * Welcome page: explains the three steps and shows the live connection state, re-checked
 * every 2 s through the worker's popup:getState (which also makes the worker retry its hello).
 * The supported-site list comes from the adapters the manifest ships: their files are loaded
 * here with script tags (adapters do nothing at load time but register themselves).
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const APP_SITE = 'https://sameko.dev';
const CHECK_MS = 2000;

function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
}

// state → the one line shown; the optional detail overrides for disconnected.
const STATUS_KEYS = { disconnected: 'noticeOffline', unpaired: 'noticeWaiting', denied: 'noticeDenied', connected: 'statusReady' };
const DETAIL_KEYS = { protocol: 'noticeProtocol', forbidden: 'noticePort', 'bad-response': 'noticePort' };

function renderStatus(c) {
    const state = (c && c.state) || 'disconnected';
    const detail = c && c.detail;
    const key = (state === 'disconnected' && DETAIL_KEYS[detail]) || STATUS_KEYS[state] || STATUS_KEYS.disconnected;
    $('.status').dataset.state = state;
    $('.status-title').textContent = t(key);
    const offline = state === 'disconnected';
    const notRunning = offline && (!detail || detail === 'unreachable');
    $('.status-open').hidden = !notRunning;
    $('.status-getapp').hidden = !(notRunning || (offline && detail === 'protocol'));
    $('.status-getapp').classList.toggle('btn-primary', !notRunning);
    $('.status-retry').hidden = state !== 'denied';
    $('.sites').hidden = state !== 'connected' || !$('.sites').children.length;
}

async function check() {
    const s = await send({ type: 'popup:getState' });
    if (s && s.connection) renderStatus(s.connection);
}

async function showSites() {
    await loadAdapters();
    if (typeof SamekoAdapters === 'undefined') return;
    const list = $('.sites');
    for (const a of SamekoAdapters.list().filter(x => x.id !== 'mock-oj')) {
        const li = document.createElement('li');
        li.className = 'site';
        li.textContent = a.name;
        li.title = (a.hosts || []).filter(h => !/^m\d\./.test(h)).join(', ');   // mirrors left out
        list.append(li);
    }
}

loadI18n().then(() => { applyI18n(); check(); });
loadTheme();
// Starts the app through its samekodev:// link; the 2 s check below notices when it answers.
$('.status-open').addEventListener('click', () => { send({ type: 'popup:openApp' }); });
$('.status-getapp').addEventListener('click', (e) => { e.preventDefault(); openTab(APP_SITE); });
$('.status-retry').addEventListener('click', async () => {
    const r = await send({ type: 'popup:retry' });
    if (r && r.connection) renderStatus(r.connection);
});
chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'connection') renderStatus(msg.connection);
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) applyTheme(changes.theme.newValue);
    if (area === 'local' && changes.uiLanguage) loadI18n().then(() => { applyI18n(); check(); });
});
check();
setInterval(check, CHECK_MS);
showSites().then(check).catch(() => {});
