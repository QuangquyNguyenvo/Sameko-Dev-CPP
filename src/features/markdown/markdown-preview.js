/**
 * Sameko Dev C++ IDE - Markdown preview
 * A rendered view of a .md file beside its editor, in the same pane: updates while typing. The two
 * sides scroll independently. Each tab remembers whether its preview is open (`tab.mdPreview`,
 * open by default). marked + DOMPurify are loaded on first use.
 */

const MarkdownPreview = {
    // UMD bundles: they set window.marked and window.DOMPurify.
    LIB_SCRIPTS: [
        '../node_modules/marked/lib/marked.umd.js',
        '../node_modules/dompurify/dist/purify.min.js',
    ],
    LANG_ALIASES: { 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp', c: 'cpp', js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', ps1: 'powershell', yml: 'yaml', md: 'markdown', 'c#': 'csharp', cs: 'csharp' },
    RENDER_DELAY: 120,
    ID_PREFIX: 'md-',  // on every id in the preview (fixUp)

    libs: null,      // Promise<{ marked, DOMPurify } | null>
    states: [],      // one per editor: { editor, pane, el, button, timer, renderId, shownModel, shownTab, cache, cacheLinks }
    langCache: new Map(),  // code-fence name -> Monaco language id (or null)

    loadLibs() {
        if (!this.libs) {
            this.libs = Promise.all(this.LIB_SCRIPTS.map((src) => loadScript(src)))
                .then(() => ({ marked: window.marked, DOMPurify: window.DOMPurify }), (err) => {
                    console.error('[MarkdownPreview] Failed to load marked/DOMPurify:', err && err.message ? err.message : err);
                    this.libs = null;
                    return null;
                });
        }
        return this.libs;
    },

    /** Called once per Monaco editor, right after it is created. */
    attach(editor) {
        const area = editor.getContainerDomNode().closest('.editor-area');
        const pane = area && area.closest('.editor-pane');
        if (!pane) return;

        const el = document.createElement('div');
        el.className = 'md-preview';
        el.hidden = true;
        el.tabIndex = -1;
        pane.appendChild(el);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'md-preview-toggle';
        button.hidden = true;
        area.appendChild(button);

        const state = { editor, pane, el, button, timer: null, renderId: 0, shownModel: null, shownTab: null, cache: new Map(), cacheLinks: null };
        this.states.push(state);

        button.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's focus
        button.addEventListener('click', () => this.toggle(editor));
        el.addEventListener('click', (e) => this.onClick(state, e));

        editor.onDidChangeModel(() => this.sync(editor));
        editor.onDidChangeModelLanguage(() => this.sync(editor));
        editor.onDidChangeModelContent(() => {
            if (!this.isOpen(state)) return;
            clearTimeout(state.timer);
            state.timer = setTimeout(() => this.render(state), this.RENDER_DELAY);
        });
        this.sync(editor);
    },

    stateFor(editor) {
        return this.states.find((s) => s.editor === editor) || null;
    },

    tabOf(editor) {
        const model = editor.getModel();
        return model && typeof getTabForModel === 'function' ? getTabForModel(model) : null;
    },

    isMarkdown(editor) {
        const model = editor.getModel();
        return !!model && model.getLanguageId() === 'markdown' && !!this.tabOf(editor);
    },

    isOpen(state) {
        return !state.el.hidden;
    },

    /** Show or hide the preview to match the tab now shown in `editor`. */
    sync(editor) {
        const state = this.stateFor(editor);
        if (!state) return;
        const md = this.isMarkdown(editor);
        const open = md && this.tabOf(editor).mdPreview !== false;
        state.button.hidden = !md;
        state.button.classList.toggle('active', open);
        const key = (typeof App !== 'undefined' && App.settings?.keybindings?.markdownPreview) || 'Ctrl+Shift+V';
        state.button.title = `${open ? 'Close' : 'Open'} the preview (${key})`;
        state.button.textContent = open ? 'Close Preview' : 'Preview';
        if (!open) this.forget(state);
        state.el.hidden = !open;
        state.pane.classList.toggle('md-preview-open', open);
        clearTimeout(state.timer);
        if (open) {
            this.render(state);
        } else {
            state.renderId++;
        }
    },

    /** Empty the preview, remembering how far its tab was scrolled for when it comes back. */
    forget(state) {
        if (state.shownTab) state.shownTab.mdPreviewTop = state.el.scrollTop;
        state.shownModel = null;
        state.shownTab = null;
        state.el.textContent = '';
    },

    /** Ctrl+Shift+V, the View menu and the button in the editor. */
    toggle(editor) {
        editor = editor || (typeof getActiveEditor === 'function' ? getActiveEditor() : null);
        if (!editor) return;
        if (!this.isMarkdown(editor)) {
            if (typeof setStatus === 'function') setStatus('Markdown preview is for .md files', 'info');
            return;
        }
        const tab = this.tabOf(editor);
        tab.mdPreview = tab.mdPreview === false;
        // Every pane showing this tab follows.
        for (const s of this.states) if (s.editor.getModel() === editor.getModel()) this.sync(s.editor);
    },

    async render(state) {
        const id = ++state.renderId;
        const model = state.editor.getModel();
        const tab = this.tabOf(state.editor);
        if (!model || !tab) return;
        const libs = await this.loadLibs();
        if (id !== state.renderId || !this.isOpen(state)) return;
        if (!libs) {
            this.forget(state);
            state.el.innerHTML = '<p class="md-preview-error">The Markdown renderer could not be loaded.</p>';
            return;
        }

        let clean = '';
        try {
            clean = this.toHtml(state, libs, model.getValue());
        } catch (e) {
            clean = `<p class="md-preview-error">${escHtml(e.message)}</p>`;
        }

        // Another file than the one shown: start empty, at the scroll position it was left at.
        let scrollTop = state.el.scrollTop;
        if (state.shownModel !== model) {
            this.forget(state);
            state.shownModel = model;
            state.shownTab = tab;
            scrollTop = tab.mdPreviewTop || 0;
        }
        const tpl = document.createElement('template');
        tpl.innerHTML = clean || '<p class="md-preview-empty">Nothing to preview yet.</p>';
        // Text outside any element (from a raw HTML block such as `<br>` + a line) is wrapped so
        // it is a block too.
        const blocks = [];
        for (const node of [...tpl.content.childNodes]) {
            if (node.nodeType === Node.ELEMENT_NODE) blocks.push(node);
            else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                const span = document.createElement('span');
                span.append(node);
                blocks.push(span);
            }
        }
        const fresh = this.patch(state.el, blocks);
        this.fixUp(state, tab, fresh);
        state.el.scrollTop = scrollTop;
    },

    /**
     * Sanitized HTML for `source`. Sanitizing is most of the cost (about 150 ms for 3000 blocks),
     * so it runs per top-level block and a block whose source is unchanged reuses last time's
     * result (`state.cache`, source -> HTML). Reference links (`[x][ref]`) can change any block,
     * so a change to their definitions empties the cache.
     */
    toHtml(state, { marked, DOMPurify }, source) {
        const tokens = marked.lexer(source, { gfm: true });
        const links = JSON.stringify(tokens.links || {});
        if (links !== state.cacheLinks) {
            state.cache = new Map();
            state.cacheLinks = links;
        }
        const cache = new Map();
        let html = '';
        for (const group of this.groups(tokens)) {
            const key = group.map((t) => t.raw).join('');
            let part = cache.get(key) ?? state.cache.get(key);
            if (part === undefined) {
                group.links = tokens.links;
                // The file is untrusted: no scripts, styles that could restyle the IDE, or form controls.
                part = DOMPurify.sanitize(marked.parser(group, { gfm: true }), {
                    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
                    FORBID_ATTR: ['style'],
                });
            }
            cache.set(key, part);
            html += part;
        }
        state.cache = cache;
        return html;
    },

    /**
     * Top-level tokens in the groups that are rendered together: a raw HTML block that leaves a
     * tag open (`<details>` ... `</details>` around Markdown) takes the tokens up to its close,
     * since sanitizing the halves apart would close the tag early.
     */
    groups(tokens) {
        const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
        const depthOf = (raw) => {
            let d = 0;
            for (const m of raw.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
                if (!m[3] && !VOID.test(m[2])) d += m[1] ? -1 : 1;
            }
            return d;
        };
        const out = [];
        let group = null;
        let depth = 0;
        for (const t of tokens) {
            if (t.type === 'space' && !group) continue;
            if (!group) group = [];
            group.push(t);
            if (t.type === 'html') depth += depthOf(t.raw);
            if (depth <= 0) {
                out.push(group);
                group = null;
                depth = 0;
            }
        }
        if (group) out.push(group);
        return out;
    },

    /**
     * Swap in only the top-level blocks that changed. A keystroke changes one place, so the
     * blocks before and after it (with their loaded images and coloured code) stay as they are.
     * Each block is compared by its HTML before fixUp, kept on the node as `mdSource`.
     * @returns {Element[]} the blocks inserted
     */
    patch(el, next) {
        for (const n of next) n.mdSource = n.outerHTML;
        const prev = [...el.children];
        let start = 0;
        while (start < prev.length && start < next.length && prev[start].mdSource === next[start].mdSource) start++;
        let end = 0;
        while (end < prev.length - start && end < next.length - start
            && prev[prev.length - 1 - end].mdSource === next[next.length - 1 - end].mdSource) end++;
        const anchor = end ? prev[prev.length - end] : null;
        for (const n of prev.slice(start, prev.length - end)) n.remove();
        const fresh = next.slice(start, next.length - end);
        for (const n of fresh) el.insertBefore(n, anchor);
        return fresh;
    },

    /** Relative image paths, task-list boxes and code colouring in `blocks`; heading anchors everywhere. */
    fixUp(state, tab, blocks) {
        const each = (selector, fn) => {
            for (const b of blocks) {
                if (b.matches(selector)) fn(b);
                for (const n of b.querySelectorAll(selector)) fn(n);
            }
        };
        const base = tab.path ? this.fileUrl(tab.path) : null;
        // Pictures and videos next to the file (or anywhere on disk) load through
        // localUrl(): the page is app://, which cannot load file:// URLs.
        // A network share is refused: a file that opens with <img src="//host/x.png">
        // would make Windows connect to that host over SMB just by previewing it.
        const resolve = (src) => {
            // The file's own app:// URL could carry any path (app://app/@local?p=\\srv\...).
            if (/^\s*app:/i.test(src)) return '';
            let abs = src;
            if (base && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[\\/]{2}/.test(src)) {
                try { abs = new URL(src, base).href; } catch (_) { return src; }
            }
            return isNetworkPath(abs) ? '' : localUrl(abs);   // an absolute path in an untitled tab too
        };
        each('img[src], video[src], audio[src], source[src], track[src]', (n) => {
            n.setAttribute('src', resolve(n.getAttribute('src')));
        });
        each('video[poster]', (n) => { n.setAttribute('poster', resolve(n.getAttribute('poster'))); });
        each('img[srcset], source[srcset]', (n) => {
            const out = this.parseSrcset(n.getAttribute('srcset')).map(({ url, descriptors }) => {
                const r = resolve(url);
                return r ? (descriptors ? r + ' ' + descriptors : r) : '';
            }).filter(Boolean);
            n.setAttribute('srcset', out.join(', '));
        });

        // Task-list boxes stay (read-only); any other input from the file goes.
        each('input', (input) => {
            if (input.type === 'checkbox') input.disabled = true;
            else input.remove();
        });

        each('pre > code[class*="language-"]', (code) => {
            const lang = this.monacoLanguage((/language-(\S+)/.exec(code.className) || [])[1]);
            if (!lang) return;
            const text = code.textContent.replace(/\n$/, '');
            monaco.editor.colorize(text, lang, { tabSize: App.settings?.editor?.tabSize || 4 }).then((colored) => {
                // Monaco escapes the text it colours. A block replaced meanwhile is detached.
                if (code.isConnected) code.innerHTML = colored;
            }).catch(() => { });
        });

        // Ids from the file get a prefix, as GitHub does: `## Status` or `<div id="status">` would
        // otherwise share an id with the IDE's own elements, and the preview comes first in the
        // page, so getElementById('status') would find the file's element.
        each('[id]', (n) => { n.id = this.ID_PREFIX + n.id; });

        // Duplicate titles are numbered in document order, so ids are redone across the file.
        const used = new Map();
        for (const h of state.el.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
            let slug = h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
            const n = used.get(slug) || 0;
            used.set(slug, n + 1);
            if (n) slug += '-' + n;
            h.id = this.ID_PREFIX + slug;
        }
    },

    monacoLanguage(name) {
        if (!name || typeof monaco === 'undefined') return null;
        const key = name.toLowerCase();
        if (!this.langCache.has(key)) {
            const id = this.LANG_ALIASES[key] || key;
            const known = monaco.languages.getLanguages().find((l) => l.id === id || (l.aliases || []).some((a) => a.toLowerCase() === id));
            this.langCache.set(key, known ? known.id : null);
        }
        return this.langCache.get(key);
    },

    /**
     * Split a srcset into candidates as the HTML spec does: a URL may itself
     * contain commas (a,b.png); a candidate ends at whitespace + descriptors + ",",
     * or at a comma right after the URL.
     * @param {string} value
     * @returns {{url: string, descriptors: string}[]}
     */
    parseSrcset(value) {
        const out = [];
        const s = String(value || '');
        const ws = /[\t\n\f\r ]/;   // ASCII whitespace only: a no-break space is part of a URL
        let i = 0;
        while (i < s.length) {
            while (i < s.length && (ws.test(s[i]) || s[i] === ',')) i++;
            if (i >= s.length) break;
            let j = i;
            while (j < s.length && !ws.test(s[j])) j++;
            let url = s.slice(i, j);
            let descriptors = '';
            if (/,+$/.test(url)) {
                url = url.replace(/,+$/, '');
            } else {
                // "(" opens a parenthesised part that the first ")" closes (no nesting).
                let k = j, inParens = false;
                while (k < s.length && !(s[k] === ',' && !inParens)) {
                    if (s[k] === '(') inParens = true;
                    else if (s[k] === ')') inParens = false;
                    k++;
                }
                descriptors = s.slice(j, k).trim();
                j = k + 1;
            }
            if (url) out.push({ url, descriptors });
            i = j;
        }
        return out;
    },

    fileUrl(filePath) {
        const p = String(filePath).replace(/\\/g, '/');
        return 'file://' + (p.startsWith('/') ? '' : '/') + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
    },

    onClick(state, e) {
        const a = e.target.closest('a[href]');
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href.startsWith('#')) {
            let target = null;
            try { target = state.el.querySelector('#' + CSS.escape(this.ID_PREFIX + decodeURIComponent(href.slice(1)))); } catch (_) { }
            if (target) state.el.scrollTop = target.offsetTop - 8;
            return;
        }
        if (/^(https?:|mailto:)/i.test(href)) {
            window.electronAPI?.openExternalLink?.(href);
            return;
        }
        // A relative link to another file next to this one: open it in a tab.
        const tab = this.tabOf(state.editor);
        if (!tab?.path || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
        try {
            const url = new URL(href, this.fileUrl(tab.path));
            let p = decodeURIComponent(url.pathname);
            if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
            if (typeof window.openFromPath === 'function') window.openFromPath(p);
        } catch (_) { }
    },
};

if (typeof module !== 'undefined' && module.exports) module.exports = MarkdownPreview; else window.MarkdownPreview = MarkdownPreview;
