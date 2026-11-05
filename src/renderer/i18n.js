/**
 * Sameko Dev C++ IDE - interface language (English, Tiếng Việt, 简体中文).
 *
 * The interface is written in English. A locale file (src/renderer/locales/*.js)
 * maps each English string to its translation:
 *
 *     I18n.register('vi', { 'Settings': 'Cài đặt', 'Saved {0}': 'Đã lưu {0}' });
 *
 * Once a language other than English is chosen, the whole page is translated in
 * place: text nodes and the attributes in ATTRS whose trimmed text is a key of
 * the dictionary. A MutationObserver translates everything the app adds or
 * changes later, so app code keeps writing English and needs no t() calls.
 * Keys with {0}, {1}... are templates: "Saved {0}" also matches "Saved main.cpp".
 * {#0} matches only a number ("{#0} errors"); the translation still writes {0}.
 *
 * User content is never touched: code (Monaco), terminal output, text inputs,
 * file names and anything inside an element marked translate="no" or
 * data-i18n-skip are skipped. The English source of every translated node is
 * kept, so switching language (or back to English) needs no reload.
 *
 * Code that builds a string a node cannot hold on its own (a tooltip joined
 * from parts, a native dialog) can call I18n.t('English text', arg0, ...).
 */
const I18n = {
    /** Language codes offered in Settings, with their own names. */
    LANGUAGES: [
        { code: 'en', name: 'English' },
        { code: 'vi', name: 'Tiếng Việt' },
        { code: 'zh-CN', name: '简体中文' }
    ],
    ATTRS: ['title', 'placeholder', 'aria-label', 'data-tooltip', 'data-title', 'data-placeholder', 'alt'],
    // Never translated: code, terminal, typed text, program output, file and variable names.
    SKIP: [
        '.monaco-editor', '.monaco-diff-editor', '.xterm', 'textarea', 'input', 'pre', 'code', 'script', 'style',
        '[contenteditable="true"]', '[translate="no"]', '[data-i18n-skip]',
        '.tab-name', '.explorer-item-name', '.cp-contest-name', '.cat-name', '.cat-list-item-name',
        '.reload-notification-file', '.problem-message', '.sdbg-name', '.sdbg-val', '.sdbg-frame',
        '.match-compact', '.diff-wrong', '.diff-right', '.theme-pill-name', '.theme-carousel-name', '.mp-card-name'
    ].join(', '),
    /** Skipped for their content, but their own hints (placeholder, title) are interface text. */
    HINT_HOSTS: 'input, textarea, pre',

    lang: 'en',
    _dicts: {},          // lang -> { exact: Map, templates: [{ re, out }] }
    _textSrc: new WeakMap(),   // text node -> { src, out } (English source, value we wrote)
    _attrSrc: new WeakMap(),   // element -> { [attr]: { src, out } }
    _observer: null,
    _listeners: [],
    missing: null,

    /**
     * Adds a dictionary. Called by each locale file.
     * @param {string} lang
     * @param {Object<string,string>} strings English -> translation
     */
    register(lang, strings) {
        const dict = this._dicts[lang] || (this._dicts[lang] = { exact: new Map(), templates: [] });
        // Keys copied from HTML may hold entities the page shows decoded (&#10; in a
        // multi-line tooltip, &copy;): store them the way the DOM reports the text.
        const decode = (s) => s.replace(/&#10;/g, '\n').replace(/&copy;/g, '©').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        for (const [rawSrc, rawOut] of Object.entries(strings || {})) {
            if (typeof rawOut !== 'string' || !rawOut) continue;
            const out = decode(rawOut);
            const key = this._norm(decode(rawSrc));
            if (/\{#?\d+\}/.test(key)) {
                // "Saved {0} in {1}ms" -> /^Saved (.+?) in (.+?)ms$/. {#0} matches only a
                // number, so "{#0} error" fits "2 errors" but not "Syntax error".
                const order = [];
                const body = key.split(/(\{#?\d+\})/).map((part) => {
                    const m = /^\{(#?)(\d+)\}$/.exec(part);
                    if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    order.push(Number(m[2]));
                    return m[1] ? '(\\d[\\d.,]*)' : '([\\s\\S]+?)';
                }).join('');
                dict.templates.push({ re: new RegExp('^' + body + '$'), order, out });
            } else {
                dict.exact.set(key, out);
            }
        }
        // Longer templates first, so "Saved {0} in {1}" wins over "Saved {0}".
        dict.templates.sort((a, b) => b.re.source.length - a.re.source.length);
    },

    /** A code with no dictionary (including the old 'auto') falls back to English. */
    resolve(code) {
        return code && this._dicts[code] ? code : 'en';
    },

    /**
     * Translates an English string into the current language (unchanged if no
     * translation exists). Extra arguments fill {0}, {1}... in the result.
     */
    t(src, ...args) {
        let out = this._lookup(this._norm(String(src ?? '')));
        if (out === null) out = String(src ?? '');
        return args.length ? out.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : out;
    },

    /**
     * Switches the interface language and retranslates the page.
     * @param {string} code 'en', 'vi', 'zh-CN'
     */
    setLanguage(code) {
        const lang = this.resolve(code);
        const changed = lang !== this.lang;
        this.lang = lang;
        document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : lang;
        document.documentElement.dataset.lang = lang;
        if (lang === 'en') this._stopObserver();
        if (changed || lang !== 'en') this.translateTree(document.body);
        if (lang !== 'en') this._startObserver();
        if (changed) this._listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
    },

    /**
     * The English text of an element (its text and titles before translation),
     * so a search box can match English words in any language.
     */
    sourceText(el) {
        if (this.lang === 'en' || !el) return '';
        const parts = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const rec = this._textSrc.get(node);
            if (rec && rec.out !== rec.src) parts.push(rec.src);
        }
        for (const t of [el, ...el.querySelectorAll('[title]')]) {
            const rec = this._attrSrc.get(t)?.title;
            if (rec && rec.out !== rec.src) parts.push(rec.src);
        }
        return parts.join(' ');
    },

    /** Calls fn(lang) after every language change. */
    onChange(fn) { this._listeners.push(fn); },

    /** Translates (or restores to English) every text node and attribute under root. */
    translateTree(root) {
        if (!root) return;
        if (root.nodeType === Node.TEXT_NODE) { this._translateText(root); return; }
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
        if (root.nodeType === Node.ELEMENT_NODE && this._skipped(root)) {
            if (root.matches(this.HINT_HOSTS) && !this._skipped(root.parentElement)) this._translateAttrs(root);
            return;
        }
        if (root.nodeType === Node.ELEMENT_NODE) this._translateAttrs(root);
        const self = this;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
                if (!node.matches(self.SKIP)) return NodeFilter.FILTER_ACCEPT;
                // Inputs are skipped for what the user typed, not for their hints.
                if (node.matches(self.HINT_HOSTS) && !self._skipped(node.parentElement)) self._translateAttrs(node);
                return NodeFilter.FILTER_REJECT;
            }
        });
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === Node.TEXT_NODE) this._translateText(node);
            else this._translateAttrs(node);
        }
        if (root.shadowRoot) this.translateTree(root.shadowRoot);
    },

    // ---------------------------------------------------------------- internals

    _norm(s) { return s.replace(/\s+/g, ' ').trim(); },

    _lookup(key) {
        if (!key || this.lang === 'en') return null;
        const dict = this._dicts[this.lang];
        if (!dict) return null;
        const hit = dict.exact.get(key);
        if (hit !== undefined) return hit;
        if (!/[A-Za-z]/.test(key)) return null;
        for (const tpl of dict.templates) {
            const m = tpl.re.exec(key);
            if (!m) continue;
            const vals = [];
            tpl.order.forEach((idx, i) => { vals[idx] = m[i + 1]; });
            // Filled-in values stay as they are: they are usually names or program output.
            return tpl.out.replace(/\{(\d+)\}/g, (s, i) => (vals[i] !== undefined ? vals[i] : s));
        }
        return null;
    },

    /** Translation of `src` keeping its leading/trailing whitespace, or null. */
    _render(src) {
        const key = this._norm(src);
        const out = this._lookup(key);
        if (out === null) {
            // Tests set I18n.missing = new Set() to list English text with no translation.
            if (this.missing && this.lang !== 'en' && /[A-Za-z]{2}/.test(key)) this.missing.add(key);
            return null;
        }
        const lead = /^\s*/.exec(src)[0];
        const trail = /\s*$/.exec(src)[0];
        return lead + out + (key ? trail : '');
    },

    _skipped(el) {
        return !!(el && el.closest && el.closest(this.SKIP));
    },

    _translateText(node) {
        const value = node.nodeValue;
        if (!value || !value.trim()) return;
        let rec = this._textSrc.get(node);
        // A value we did not write is new English text from the app.
        if (!rec || value !== rec.out) rec = { src: value, out: value };
        const out = this._render(rec.src);
        rec.out = out === null ? rec.src : out;
        this._textSrc.set(node, rec);
        if (node.nodeValue !== rec.out) node.nodeValue = rec.out;
    },

    _translateAttrs(el) {
        if (!el.hasAttribute) return;
        let recs = this._attrSrc.get(el);
        for (const attr of this.ATTRS) {
            if (!el.hasAttribute(attr)) continue;
            const value = el.getAttribute(attr);
            if (!value || !value.trim()) continue;
            if (!recs) { recs = {}; this._attrSrc.set(el, recs); }
            let rec = recs[attr];
            if (!rec || value !== rec.out) rec = { src: value, out: value };
            const out = this._render(rec.src);
            rec.out = out === null ? rec.src : out;
            recs[attr] = rec;
            if (value !== rec.out) el.setAttribute(attr, rec.out);
        }
    },

    _startObserver() {
        if (this._observer) return;
        this._observer = new MutationObserver((records) => this._onMutations(records));
        this._observer.observe(document.body, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: this.ATTRS
        });
    },

    _stopObserver() {
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
    },

    _onMutations(records) {
        for (const r of records) {
            if (r.type === 'childList') {
                for (const node of r.addedNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        if (!this._skipped(node.parentElement)) this._translateText(node);
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (!this._skipped(node.parentElement)) this.translateTree(node);
                    }
                }
            } else if (r.type === 'characterData') {
                if (!this._skipped(r.target.parentElement)) this._translateText(r.target);
            } else if (r.type === 'attributes') {
                const el = r.target;
                // Inputs and textareas are skipped for their content, not their hints.
                const host = el.matches(this.HINT_HOSTS) ? el.parentElement : el;
                if (!this._skipped(host)) this._translateAttrs(el);
            }
        }
        // Our own writes queue records too; drop them so they are not handled twice.
        if (this._observer) this._observer.takeRecords();
    }
};

// Native dialogs are outside the DOM walk: translate their message here.
// Untranslated text (and its newlines) passes through unchanged.
if (typeof window !== 'undefined' && !window.__i18nDialogsWrapped) {
    window.__i18nDialogsWrapped = true;
    for (const name of ['alert', 'confirm', 'prompt']) {
        const native = window[name];
        if (typeof native !== 'function') continue;
        window[name] = function (message, ...rest) {
            if (typeof message === 'string') message = I18n.t(message);
            return native.call(window, message, ...rest);
        };
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = I18n; else window.I18n = I18n;
