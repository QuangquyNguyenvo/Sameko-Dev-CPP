/*
 * SamekoI18n: the extension's texts in the language the user picked in the popup.
 *
 * chrome.i18n follows the browser's language only, so a choice other than "auto" loads that
 * language's _locales/<lang>/messages.json and answers from it; any key it lacks (and "auto")
 * falls back to chrome.i18n. The choice is chrome.storage.local `uiLanguage`.
 *
 * Classic script for the popup, the welcome page and the worker (importScripts); require()-able
 * in Node. Nothing runs at load time.
 */
(function (root) {
    'use strict';

    const LANGUAGES = Object.freeze(['auto', 'en', 'vi', 'zh_CN']);
    let lang = 'auto';
    let table = null;

    /** Uses `pref` ('auto' or a _locales folder name); resolves to the language in use. */
    async function use(pref, chromeApi, fetchFn) {
        const next = LANGUAGES.includes(pref) ? pref : 'auto';
        let loaded = null;
        if (next !== 'auto') {
            try {
                const r = await fetchFn(chromeApi.runtime.getURL(`_locales/${next}/messages.json`));
                loaded = await r.json();
            } catch (_) { loaded = null; }
        }
        lang = loaded ? next : 'auto';
        table = loaded;
        return lang;
    }

    /** Reads the stored choice and uses it. */
    async function load(chromeApi, fetchFn) {
        let pref = 'auto';
        try { pref = (await chromeApi.storage.local.get('uiLanguage')).uiLanguage || 'auto'; } catch (_) { /* default */ }
        return use(pref, chromeApi, fetchFn);
    }

    /** "$COUNT$ submissions" with placeholders { count: { content: "$1" } } and subs [3]. */
    function format(entry, subs) {
        const list = subs === undefined ? [] : [].concat(subs).map(String);
        const named = {};
        for (const [name, ph] of Object.entries(entry.placeholders || {})) {
            const m = /^\$(\d+)$/.exec(String(ph && ph.content || ''));
            named[name.toLowerCase()] = m ? (list[Number(m[1]) - 1] || '') : String(ph && ph.content || '');
        }
        return String(entry.message || '')
            .replace(/\$(\w+)\$/g, (all, name) => (name.toLowerCase() in named ? named[name.toLowerCase()] : all))
            .replace(/\$\$/g, '$');
    }

    function get(chromeApi, key, subs) {
        if (table && table[key] && table[key].message) return format(table[key], subs);
        try { return chromeApi.i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs).map(String)) || ''; } catch (_) { return ''; }
    }

    /** A BCP 47 tag for Intl and <html lang>. */
    function locale(chromeApi) {
        if (lang === 'zh_CN') return 'zh-CN';
        if (lang !== 'auto') return lang;
        try { return chromeApi.i18n.getUILanguage() || 'en'; } catch (_) { return 'en'; }
    }

    const SamekoI18n = { LANGUAGES, use, load, get, format, locale, current: () => lang };

    if (typeof module !== 'undefined' && module.exports) module.exports = SamekoI18n;
    else root.SamekoI18n = SamekoI18n;
})(typeof self !== 'undefined' ? self : this);
