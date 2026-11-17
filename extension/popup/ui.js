/*
 * Helpers shared by the popup and the welcome page (classic script, loaded first):
 *   t(key, subs)        the text in the language picked in the popup (shared/i18n.js, loaded
 *                       before this file), else chrome.i18n; '' when missing, so the English
 *                       text of the HTML stays
 *   loadI18n()          reads the picked language; await it before applyI18n
 *   loadAdapters()      loads the adapter files the manifest ships (they only register themselves)
 *   applyI18n(root)     fills [data-i18n] (text), [data-i18n-title] and [data-i18n-aria]
 *   applyTheme(theme)   sets the colour variables from the app's snapshot (PROTOCOL §4)
 *   openTab(url)        chrome.tabs.create
 * Judge-provided text never goes through here; it is inserted with textContent by the callers.
 */
'use strict';

function t(key, subs) {
    if (typeof SamekoI18n !== 'undefined') return SamekoI18n.get(chrome, key, subs);
    try { return chrome.i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs)) || ''; } catch (_) { return ''; }
}

function loadI18n() {
    if (typeof SamekoI18n === 'undefined') return Promise.resolve('auto');
    return SamekoI18n.load(chrome, (u) => fetch(u)).catch(() => 'auto');
}

function uiLocale() {
    if (typeof SamekoI18n !== 'undefined') return SamekoI18n.locale(chrome);
    try { return chrome.i18n.getUILanguage(); } catch (_) { return 'en'; }
}

let adaptersLoaded = null;
function loadAdapters() {
    if (adaptersLoaded) return adaptersLoaded;
    const manifest = chrome.runtime.getManifest();
    const files = Array.from(new Set((manifest.content_scripts || []).flatMap(c => c.js || [])))
        .filter(f => f.startsWith('shared/') || f.startsWith('adapters/'));
    adaptersLoaded = files.reduce((p, f) => p.then(() => new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = '../' + f;
        s.onload = s.onerror = resolve;
        document.head.append(s);
    })), Promise.resolve()).then(() => (typeof SamekoAdapters !== 'undefined' ? SamekoAdapters : null));
    return adaptersLoaded;
}

function applyI18n(root) {
    root = root || document;
    for (const el of root.querySelectorAll('[data-i18n]')) {
        const m = t(el.dataset.i18n);
        if (m) el.textContent = m;
    }
    for (const el of root.querySelectorAll('[data-i18n-title]')) {
        const m = t(el.dataset.i18nTitle);
        if (m) el.title = m;
    }
    for (const el of root.querySelectorAll('[data-i18n-aria]')) {
        const m = t(el.dataset.i18nAria);
        if (m) el.setAttribute('aria-label', m);
    }
    document.documentElement.lang = uiLocale();
    const title = t('extName');
    if (title && !document.title) document.title = title;
}

const THEME_VARS = { bg: '--bg', surface: '--surface', border: '--border', text: '--text', textMuted: '--text-muted', accent: '--accent', accentText: '--accent-text', success: '--success', warning: '--warning', error: '--error' };

function applyTheme(theme) {
    const root = document.documentElement;
    for (const v of Object.values(THEME_VARS)) root.style.removeProperty(v);
    if (!theme || typeof theme !== 'object') { delete root.dataset.variant; return; }
    // A snapshot with holes still gets the built-in colours of its own variant for the missing ones.
    root.dataset.variant = theme.variant === 'light' ? 'light' : 'dark';
    for (const [k, v] of Object.entries(THEME_VARS)) {
        if (typeof theme[k] === 'string' && theme[k]) root.style.setProperty(v, theme[k]);
    }
}

function openTab(url) {
    try { chrome.tabs.create({ url }); } catch (_) { window.open(url, '_blank'); }
}

function loadTheme() {
    return chrome.storage.local.get('theme').then(r => applyTheme(r.theme)).catch(() => applyTheme(null));
}
