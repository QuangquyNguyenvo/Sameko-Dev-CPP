/*
 * Helpers shared by the popup and the welcome page (classic script, loaded first):
 *   t(key, subs)        chrome.i18n.getMessage with the English text of the HTML as the fallback
 *   applyI18n(root)     fills [data-i18n] (text), [data-i18n-title] and [data-i18n-aria]
 *   applyTheme(theme)   sets the colour variables from the app's snapshot (PROTOCOL §4)
 *   openTab(url)        chrome.tabs.create
 * Judge-provided text never goes through here; it is inserted with textContent by the callers.
 */
'use strict';

function t(key, subs) {
    let msg = '';
    try { msg = chrome.i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs)); } catch (_) { /* no i18n */ }
    return msg || '';
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
    try { document.documentElement.lang = chrome.i18n.getUILanguage(); } catch (_) { /* keep */ }
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
