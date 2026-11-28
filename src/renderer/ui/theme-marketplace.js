/**
 * Theme Marketplace v3.0
 * Clean theme browser and carousel
 * 
 * @author Sameko Team
 */

const ThemeMarketplace = {
    _catalogEntries: [],
    _catalog: [],
    _catalogOverrides: undefined,
    _carouselCatalog: null,
    _marketplaceCatalog: null,
    _returnFocus: null,
    _selectionVersion: 0,
    _bound: false,

    /**
     * Initialize
     */
    async init() {
        if (this._bound) return;
        this._bound = true;
        this._setupButtons();
    },

    /**
     * Setup button handlers
     */
    _setupButtons() {
        document.getElementById('btn-open-marketplace')?.addEventListener('click', () => {
            this.openMarketplace();
        });

        // Settings owns the Customize button; binding it here as well opens two sessions.

        document.getElementById('btn-import-file')?.addEventListener('click', () => this._importFile());
        document.getElementById('btn-import-gist')?.addEventListener('click', () => this._importGist());
        document.getElementById('btn-export-file')?.addEventListener('click', () => this._exportFile());
        document.getElementById('btn-create-theme')?.addEventListener('click', () => {
            this.closeMarketplace();
            ThemeCustomizer.open(null);
        });
        document.getElementById('marketplace-close')?.addEventListener('click', () => this.closeMarketplace());
        const popup = document.getElementById('marketplace-popup');
        popup?.querySelector('.fullscreen-popup-overlay')?.addEventListener('click', () => {
            this.closeMarketplace();
        });
        popup?.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const buttons = popup.querySelectorAll('button:not(:disabled)');
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if ((event.shiftKey && event.target === first) || (!event.shiftKey && event.target === last)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            }
        });

        document.getElementById('marketplace-themes-list')?.addEventListener('click', event => {
            const button = event.target.closest('.mp-card [data-action]');
            const id = button?.closest('.mp-card')?.dataset.themeId;
            if (!id || button.disabled) return;
            switch (button.dataset.action) {
                case 'apply': this._selectTheme(id); break;
                case 'edit': this.closeMarketplace(); ThemeCustomizer.open(id); break;
                case 'export': this._exportTheme(id); break;
                case 'delete': this._deleteTheme(id); break;
            }
        });

        const carousel = document.getElementById('theme-carousel');
        if (!carousel) return;
        carousel.addEventListener('click', event => {
            const card = event.target.closest('.theme-carousel-card');
            if (card) this._selectTheme(card.dataset.themeId);
        });
        carousel.addEventListener('wheel', event => {
            const before = carousel.scrollLeft;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            carousel.scrollLeft += delta;
            if (carousel.scrollLeft !== before) event.preventDefault();
        }, { passive: false });
        document.getElementById('theme-carousel-left')?.addEventListener('click',
            () => carousel.scrollBy({ left: -320, behavior: 'instant' }));
        document.getElementById('theme-carousel-right')?.addEventListener('click',
            () => carousel.scrollBy({ left: 320, behavior: 'instant' }));
    },

    _getCatalog() {
        // Registering a theme replaces its record. A builtin's saved background lives in
        // ThemeManager.backgroundOverrides, which every save replaces, and the previews show it.
        const entries = [...ThemeManager.themes];
        const overrides = ThemeManager.backgroundOverrides;
        if (overrides !== this._catalogOverrides || entries.length !== this._catalogEntries.length || entries.some(([id, theme], i) => {
            const previous = this._catalogEntries[i];
            return !previous || id !== previous[0] || theme !== previous[1];
        })) {
            this._catalogEntries = entries;
            this._catalogOverrides = overrides;
            this._catalog = ThemeManager.getThemeList();
        }
        return this._catalog;
    },

    refreshCatalog() {
        populateThemeDropdowns(this._getCatalog());
        this._syncSelection(App.settings.appearance.theme);
        if (document.querySelector('#settings-overlay.show #panel-appearance.active')) this.renderCarousel();
        if (this.isOpen()) this._renderMarketplaceContent();
    },

    renderCarousel({ revealActive = false } = {}) {
        const carousel = document.getElementById('theme-carousel');
        if (!carousel) return;

        const themes = this._getCatalog();
        if (themes !== this._carouselCatalog) {
            carousel.innerHTML = themes.map(theme => this._carouselCard(theme)).join('');
            this._carouselCatalog = themes;
        }

        this._syncSelection(App.settings.appearance.theme);
        const active = revealActive && carousel.querySelector('.theme-carousel-card.active');
        if (active) {
            const card = active.getBoundingClientRect();
            const viewport = carousel.getBoundingClientRect();
            carousel.scrollLeft += card.left - viewport.left + (card.width - viewport.width) / 2;
        }
    },

    _carouselCard(theme) {
        const p = this._previewColors(theme.id);
        return `
            <button type="button" class="theme-carousel-card" aria-pressed="false" data-theme-id="${escHtml(theme.id)}" title="${escHtml(theme.name)}">
                ${this._renderPreview(p, 'theme-carousel-preview')}
                <span class="theme-carousel-info">
                    <span class="theme-carousel-text">
                        <span class="theme-carousel-title">
                            <span class="theme-carousel-name" translate="no">${escHtml(theme.name)}</span>
                            ${this._activeMark()}
                        </span>
                        <span class="theme-carousel-meta">
                            <span class="theme-carousel-type">${escHtml(theme.type)}</span>
                            ${theme.isBuiltin ? '' : '<span class="theme-carousel-badge">Custom</span>'}
                        </span>
                    </span>
                    ${this._renderSwatches(p)}
                </span>
            </button>`;
    },

    /**
     * The colours a theme card is drawn with. The values go into style="" attributes and
     * may come from an imported theme file, so anything that is not a plain CSS value is
     * replaced by a fallback. A builtin's saved background override is included (its
     * registry entry gets it only while the theme is applied).
     * @param {string} themeId
     */
    _previewColors(themeId) {
        const theme = ThemeManager.getEffectiveTheme(themeId);
        if (!theme) return null;
        const colors = { ...(theme.colors || {}) };
        if (typeof ThemeTokens !== 'undefined') ThemeTokens.fillDefaults(colors);
        const editor = theme.editor || {};
        const syntax = editor.syntax || {};
        const css = (value, fallback) => (/^[#\w(),.%\s-]{1,64}$/.test(String(value ?? '')) ? String(value) : fallback);
        const hex = (value, fallback) => (/^[0-9a-fA-F]{3,8}$/.test(String(value ?? '')) ? '#' + value : fallback);
        const pct = (value, fallback) => {
            const n = Number(value);
            return (Number.isFinite(n) ? Math.max(0, Math.min(200, n)) : fallback) / 100;
        };
        const accent = css(colors.accent, '#88c9ea');
        const muted = css(colors.textMuted, '#7a8a99');
        return {
            theme,
            colors,
            accent,
            vars: {
                '--tp-base': css(colors.bgOceanLight, '#1a2530'),
                '--tp-base-2': css(colors.bgOceanMedium, '#101820'),
                '--tp-panel': css(colors.bgPanel, '#1a2530'),
                '--tp-border': css(colors.border, 'rgba(255, 255, 255, 0.12)'),
                '--tp-editor': css(colors.editorBg, css(editor.background, '#1a2530')),
                '--tp-code-bg': css(editor.background, css(colors.editorBg, '#1a2530')),
                '--tp-line': css(editor.lineHighlight, 'transparent'),
                '--tp-gutter': css(editor.lineNumber, muted),
                '--tp-gutter-active': css(editor.lineNumberActive, css(colors.textPrimary, '#e0f0ff')),
                '--tp-text': css(colors.textPrimary, '#e0f0ff'),
                '--tp-fg': css(editor.foreground, css(colors.textPrimary, '#e0f0ff')),
                '--tp-text-2': css(colors.textSecondary, muted),
                '--tp-muted': muted,
                '--tp-accent': accent,
                '--tp-logo': css(colors.bgOceanDeep, accent),
                '--tp-btn': css(colors.btnPrimaryBg, accent),
                '--tp-btn-text': css(colors.btnPrimaryText, css(colors.buttonTextOnAccent, '#ffffff')),
                '--tp-ok': css(colors.success, '#4cc38a'),
                '--tp-warn': css(colors.warning, '#f5a23a'),
                '--tp-cursor': css(editor.cursor, accent),
                '--tp-wall-opacity': pct(colors.bgOpacity, 100),
                '--tp-wall-brightness': pct(colors.bgBrightness, 100),
                '--tp-wall-position': css(colors.bgPosition, 'center'),
            },
            syntax: {
                comment: hex(syntax.comment?.color, muted),
                keyword: hex(syntax.keyword?.color, '#88c9ea'),
                string: hex(syntax.string?.color, '#a3d9a5'),
                number: hex(syntax.number?.color, '#f0b27a'),
                type: hex(syntax.type?.color, '#e8a8b8'),
                function: hex(syntax.function?.color, '#7ec8e3'),
                variable: hex(syntax.variable?.color, 'inherit'),
                operator: hex(syntax.operator?.color, 'inherit'),
            },
        };
    },

    /**
     * The theme's wallpaper as an <img> or <video> for a card, or '' when it has none.
     * Bundled background videos have a still frame in assets/backgrounds/thumbs/
     * (scripts/make-theme-thumbs.js), so the cards never decode a video for them.
     */
    _renderWallpaper(colors) {
        let value = typeof colors.appBackground === 'string' ? colors.appBackground.trim() : '';
        const inner = /^url\(\s*(['"]?)(.*?)\1\s*\)$/i.exec(value);
        if (inner) value = inner[2];
        if (!value || value === 'none') return '';
        const bundled = /^assets\/backgrounds\/([\w-]+)\.(?:webm|mp4)$/i.exec(value);
        if (bundled) {
            return `<img class="tp-wall" src="assets/backgrounds/thumbs/${bundled[1]}.webp" alt="" decoding="async">`;
        }
        const src = typeof localUrl === 'function' ? localUrl(value) : value;
        if (typeof ThemeTokens !== 'undefined' && ThemeTokens.isVideoBackground(value)) {
            // Seeking a little way in avoids the black first frame many loops fade in from.
            const at = src.startsWith('data:') || src.includes('#') ? '' : '#t=1';
            return `<video class="tp-wall" src="${escHtml(src + at)}" muted preload="metadata" tabindex="-1"></video>`;
        }
        return `<img class="tp-wall" src="${escHtml(src)}" alt="" decoding="async">`;
    },

    /**
     * A theme card's picture: the theme's wallpaper with the main window drawn small on
     * it, laid out like the real one (header islands, editor with highlighted code, I/O
     * column, status bar), in the theme's own colours so two themes can be told apart at a
     * glance. Hovering the card dims the window so the wallpaper shows through.
     * @param {object|null} p the theme's _previewColors()
     * @param {string} className the card's own class for the picture
     */
    _renderPreview(p, className) {
        if (!p) return `<span class="${className} tp" aria-hidden="true"></span>`;
        const style = Object.entries(p.vars).map(([key, value]) => `${key}: ${value}`).join('; ');
        const s = p.syntax;
        const t = (key, text) => `<span style="color: ${s[key]}${key === 'comment' ? '; font-style: italic' : ''}">${text}</span>`;
        const ico = (id, cls) => `<svg class="tp-ico${cls ? ' ' + cls : ''}"><use href="#${id}"/></svg>`;
        const lines = [
            `${t('keyword', '#include')} ${t('string', '&lt;bits/stdc++.h&gt;')}`,
            `${t('keyword', 'using namespace')} ${t('type', 'std')}${t('operator', ';')}`,
            `${t('type', 'int')} ${t('function', 'main')}() {`,
            `    ${t('type', 'int')} ${t('variable', 'n')}${t('operator', ';')} ${t('variable', 'cin')} ${t('operator', '&gt;&gt;')} ${t('variable', 'n')}${t('operator', ';')}<span class="tp-caret"></span>`,
            `    ${t('variable', 'cout')} ${t('operator', '&lt;&lt;')} ${t('string', '"Hi "')} ${t('operator', '&lt;&lt;')} ${t('variable', 'n')}${t('operator', ';')}`,
            '}',
        ].map((line, i) => `<span class="tp-ln${i === 3 ? ' tp-ln-active' : ''}"><b>${i + 1}</b>${line}</span>`).join('');
        const io = (dot, title, text, verdict) => `<span class="tp-island tp-io" style="--tp-dot: var(${dot})">`
            + `<span class="tp-io-head"><b></b>${title}${verdict ? '<span class="tp-ac">AC</span>' : ''}</span>`
            + `<span class="tp-io-text">${text}</span></span>`;
        // A picture, not UI: it stays in English like a screenshot would.
        return `
            <span class="${className} tp" aria-hidden="true" translate="no" style="${style}">
                ${this._renderWallpaper(p.colors)}
                <span class="tp-ui">
                    <span class="tp-head">
                        <span class="tp-island tp-nav"><span class="tp-logo">C++</span><span class="tp-btn tp-on">${ico('i-folder-simple-fill')}</span><span class="tp-btn">${ico('i-list')}</span></span>
                        <span class="tp-island tp-tabs"><span class="tp-tab">main.cpp${ico('i-x', 'tp-x')}</span>${ico('i-plus', 'tp-plus')}</span>
                        <span class="tp-island tp-actions"><span class="tp-btn tp-on">${ico('i-terminal-window-fill')}</span><span class="tp-run">${ico('i-play-fill')}${ico('i-caret-down', 'tp-run-caret')}</span><span class="tp-btn">${ico('i-gear-six-duo')}</span></span>
                        <span class="tp-island tp-win">${ico('i-minus')}${ico('i-square')}${ico('i-x')}</span>
                    </span>
                    <span class="tp-main">
                        <span class="tp-island tp-editor"><span class="tp-code">${lines}</span></span>
                        <span class="tp-side">
                            ${io('--tp-accent', 'Input', '5')}
                            ${io('--tp-warn', 'Output', 'Hi 5', true)}
                            ${io('--tp-ok', 'Expected', 'Hi 5')}
                        </span>
                    </span>
                    <span class="tp-island tp-status"><b></b>Ready<span class="tp-status-right">Ln 4, Col 21<span class="tp-chip">C++20</span></span></span>
                </span>
            </span>`;
    },

    /** The check shown next to the active theme's name. */
    _activeMark() {
        return '<span class="theme-active-mark" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span>';
    },

    /** A row of the theme's main colours: accent, then four syntax colours. */
    _renderSwatches(p) {
        if (!p) return '';
        const colors = [p.accent, p.syntax.keyword, p.syntax.string, p.syntax.function, p.syntax.type];
        return `<span class="theme-swatches" aria-hidden="true">${colors.map(color =>
            `<i style="background: ${color}"></i>`).join('')}</span>`;
    },

    /**
     * Select and apply theme
     */
    async _selectTheme(themeId) {
        const appearance = App.settings.appearance;
        const previous = appearance.theme;
        if (!ThemeManager.themes.has(themeId) || (previous === themeId && ThemeManager.activeThemeId === themeId)) return;
        const version = ++this._selectionVersion;
        appearance.theme = themeId;
        applyTheme(themeId);
        this._syncSelection(themeId);
        try {
            const result = await saveSettings();
            if (result?.success === false) throw new Error(result.error || 'Could not save active theme settings.');
        } catch (error) {
            if (version === this._selectionVersion && appearance.theme === themeId && ThemeManager.themes.has(previous)) {
                appearance.theme = previous;
                applyTheme(previous);
                this._syncSelection(previous);
            }
            this._notify(error.message, 'error');
        }
    },

    _syncSelection(themeId) {
        const select = document.getElementById('set-theme');
        if (select && select.value !== themeId) select.value = themeId;
        for (const card of document.querySelectorAll('.theme-carousel-card, .mp-card')) {
            const active = card.dataset.themeId === themeId;
            card.classList.toggle('active', active);
            const button = card.matches('.theme-carousel-card') ? card : card.querySelector('.mp-card-main');
            if (button && button.getAttribute('aria-pressed') !== String(active)) button.setAttribute('aria-pressed', String(active));
        }
    },

    /**
     * Open marketplace popup
     */
    openMarketplace() {
        const popup = document.getElementById('marketplace-popup');
        if (!popup || this.isOpen()) return;
        this._returnFocus = document.activeElement;
        popup.style.display = 'flex';
        this._renderMarketplaceContent();
        popup.querySelector('#marketplace-close')?.focus({ preventScroll: true });
    },

    /**
     * Close marketplace popup
     */
    closeMarketplace() {
        const popup = document.getElementById('marketplace-popup');
        if (!popup || !this.isOpen()) return;
        popup.style.display = 'none';
        if (this._returnFocus?.isConnected) this._returnFocus.focus({ preventScroll: true });
        this._returnFocus = null;
    },

    isOpen() {
        return document.getElementById('marketplace-popup')?.style.display === 'flex';
    },

    /**
     * Render marketplace content
     */
    _renderMarketplaceContent() {
        const container = document.getElementById('marketplace-themes-list');
        if (!container) return;

        const themes = this._getCatalog();
        if (this._marketplaceCatalog !== themes) {
            const sections = [
                ['My Custom Themes', themes.filter(theme => !theme.isBuiltin)],
                ['Built-in Themes', themes.filter(theme => theme.isBuiltin)],
            ];
            container.innerHTML = sections.filter(([, items]) => items.length).map(([title, items]) => `
                <section class="mp-section">
                    <h3 class="mp-section-title">${title}</h3>
                    <div class="mp-grid">${items.map(theme => this._renderThemeCard(theme)).join('')}</div>
                </section>
            `).join('');
            this._marketplaceCatalog = themes;
        }
        this._syncSelection(App.settings.appearance.theme);
    },

    /**
     * Render a theme card
     */
    _renderThemeCard(theme) {
        const themeData = ThemeManager.themes.get(theme.id);
        const p = this._previewColors(theme.id);
        const desc = themeData?.description || '';
        const author = theme.author === 'Unknown' ? '' : theme.author;

        // The card itself applies the theme (like the Settings carousel); the other actions are
        // quiet icon buttons, so a grid of themes is not a wall of accent-coloured buttons.
        const tool = (action, iconId, label, extra = '') =>
            `<button type="button" class="mp-tool${extra}" data-action="${action}" title="${label}" aria-label="${label}">`
            + `<svg class="ico" aria-hidden="true"><use href="#${iconId}"/></svg></button>`;
        return `
            <article class="mp-card" data-theme-id="${escHtml(theme.id)}">
                <button type="button" class="mp-card-main" data-action="apply" aria-pressed="false">
                    ${this._renderPreview(p, 'mp-card-preview')}
                    <span class="mp-card-title">
                        <span class="mp-card-name" translate="no">${escHtml(theme.name)}</span>
                        ${this._activeMark()}
                        ${this._renderSwatches(p)}
                    </span>
                    ${desc ? `<span class="mp-card-desc" translate="no">${escHtml(desc)}</span>` : ''}
                </button>
                <div class="mp-card-foot">
                    <span class="mp-card-meta">
                        <span>${escHtml(theme.type)}</span>
                        ${author ? `<span translate="no">${escHtml(author)}</span>` : ''}
                    </span>
                    <span class="mp-card-tools">
                        ${tool('edit', 'i-paint-brush', 'Edit theme')}
                        ${tool('export', 'i-download-simple', 'Export theme')}
                        ${theme.isBuiltin ? '' : tool('delete', 'i-trash', 'Delete theme', ' danger')}
                    </span>
                </div>
            </article>
        `;
    },

    /**
     * Export theme to file
     */
    async _exportTheme(themeId) {
        let json;
        try { json = await ThemeManager.exportThemePortable(themeId); }
        catch (error) { this._notify('Export failed: ' + error.message, 'error'); return; }
        if (!json) return;

        const theme = ThemeManager.themes.get(themeId);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${theme?.id || themeId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Delete custom theme
     */
    _deleteTheme(themeId) {
        if (ThemeManager.builtinThemeIds.includes(themeId)) {
            this._notify('Cannot delete built-in theme', 'warning');
            return;
        }

        const theme = ThemeManager.themes.get(themeId);
        if (!theme) {
            this._notify('Theme not found', 'warning');
            return;
        }

        this._confirm(`Delete theme "${theme.name || themeId}"?`, 'Delete theme', 'Delete', true).then(async (confirmed) => {
            if (!confirmed) return;

            const isCurrentTheme = App?.settings?.appearance?.theme === themeId;

            const result = await ThemeManager.deleteTheme(themeId);
            if (result.success) {
                if (isCurrentTheme) {
                    const themes = ThemeManager.getThemeList();
                    if (themes.length > 0) {
                        const firstTheme = themes[0].id;
                        await this._selectTheme(firstTheme);
                    }
                }
                this.refreshCatalog();
            } else {
                this._notify(result.message || 'Failed to delete theme', 'error');
            }
        }).catch(error => this._notify('Delete failed: ' + error.message, 'error'));
    },

    /**
     * Import from file
     */
    _importFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const result = ThemeManager.importTheme(event.target.result);
                    if (result.success) {
                        await result.persistence;
                        this.refreshCatalog();
                        this._notify(`Imported: ${result.message}`, 'success');
                    } else {
                        this._notify(`Import failed: ${result.message}`, 'error');
                    }
                } catch (err) {
                    this._notify(`Import error: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    /**
     * Import from GitHub Gist
     */
    async _importGist() {
        const url = await this._promptText('Import from GitHub Gist', 'Enter GitHub Gist URL or ID:');
        if (!url) return;

        const match = url.match(/gist\.github\.com\/[\w-]+\/([\w]+)/) || url.match(/^([\w]+)$/);
        if (!match) {
            this._notify('Invalid Gist URL or ID', 'warning');
            return;
        }

        try {
            const response = await fetch(`https://api.github.com/gists/${match[1]}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const gist = await response.json();
            for (const [filename, file] of Object.entries(gist.files)) {
                if (!filename.endsWith('.json')) continue;
                let content = file.content;
                // GitHub cuts content over 1 MB (an embedded background) and gives
                // the whole file at raw_url instead.
                if (file.truncated && /^https:\/\/gist\.githubusercontent\.com\//.test(file.raw_url || '')) {
                    if (file.size > 64 * 1024 * 1024) continue;
                    const raw = await fetch(file.raw_url);
                    if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
                    content = await raw.text();
                }
                if (content) {
                    const result = ThemeManager.importTheme(content);
                    if (result.success) {
                        await result.persistence;
                        this.refreshCatalog();
                        this._notify(`Imported: ${result.message}`, 'success');
                        return;
                    }
                }
            }
            this._notify('No valid theme found in Gist', 'warning');
        } catch (err) {
            this._notify(`Gist import failed: ${err.message}`, 'error');
        }
    },

    async _confirm(message, title = 'Confirm', confirmText = 'OK', danger = false) {
        if (typeof window.showConfirmDialog === 'function') {
            return !!(await window.showConfirmDialog({
                title,
                message,
                confirmText,
                cancelText: 'Cancel',
                danger
            }));
        }
        return window.confirm(message);
    },

    _notify(message, type = 'info') {
        if (typeof log === 'function') {
            log(message, type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'success');
            return;
        }
        console[type === 'error' ? 'error' : 'log']('[ThemeMarketplace]', message);
    },

    _promptText(title, placeholder = '') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'note-dialog-overlay';
            overlay.innerHTML = `
                <div class="note-dialog input-dialog">
                    <div class="note-dialog-header">
                        <h3>${escHtml(title)}</h3>
                        <button class="note-dialog-close" title="Close">×</button>
                    </div>
                    <div class="note-dialog-body">
                        <input type="text" class="input-dialog-field" value="" placeholder="${escHtml(placeholder)}" />
                    </div>
                    <div class="note-dialog-footer">
                        <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                        <button class="note-dialog-btn note-dialog-save">OK</button>
                    </div>
                </div>
            `;

            const previousFocus = document.activeElement;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('.input-dialog-field');
            try { document.activeElement?.blur?.(); } catch (_) {}
            const close = (value = null) => {
                overlay.remove();
                if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
                resolve(value);
            };

            overlay.querySelector('.note-dialog-close').onclick = () => close(null);
            overlay.querySelector('.note-dialog-cancel').onclick = () => close(null);
            overlay.querySelector('.note-dialog-save').onclick = () => close(input.value.trim() || null);
            input.onkeydown = (e) => {
                if (e.key === 'Escape') close(null);
                if (e.key === 'Enter') close(input.value.trim() || null);
            };

            window.focus();
            input.focus();
            input.select();
        });
    },

    /**
     * Export current theme
     */
    _exportFile() {
        const currentId = App?.settings?.appearance?.theme || 'kawaii-dark';
        this._exportTheme(currentId);
    }
};

window.ThemeMarketplace = ThemeMarketplace;
