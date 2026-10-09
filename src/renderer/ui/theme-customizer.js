/** Theme editing session. The draft never mutates the live IDE before Save. */
const ThemeCustomizer = {
    sourceThemeId: null,
    workingTheme: null,
    popup: null,
    view: null,
    activePanel: 'colors',
    historyStack: [],
    historyIndex: -1,
    dirty: false,
    busy: false,
    _generation: 0,
    _baseline: null,
    _lastFocus: null,
    _assetRequests: {},
    _jsonSnapshot: '',
    baseThemeId: null,

    _clone(value) { return JSON.parse(JSON.stringify(value)); },
    _isBuiltin() { return ThemeManager.builtinThemeIds.includes(this.sourceThemeId); },

    _draft(data) {
        const draft = this._clone(ThemeTokens.normalizeTheme(data));
        draft.colors ||= {};
        draft.editor ||= {};
        draft.editor.syntax ||= {};
        const result = ThemeTokens.validateTheme(draft);
        if (!result.valid) throw new Error(result.errors.join('\n'));
        ThemeTokens.fillDefaults(draft.colors);
        return draft;
    },

    async open(themeId = null) {
        if (this.busy) return;
        if (!ThemeManager.themes.size) await ThemeManager.init();
        const id = ThemeManager.themes.has(themeId) ? themeId
            : (App?.settings?.appearance?.theme || ThemeManager.getThemeList()[0]?.id);
        if (!ThemeManager.themes.has(id)) return;
        if (this.popup) {
            if (id === this.sourceThemeId) { this.view.focus(); return; }
            if (!await this.close()) return;
        }
        this._generation++;
        this._assetRequests = {};
        this.sourceThemeId = id;
        this.baseThemeId = id;
        this.workingTheme = this._draft(ThemeManager.themes.get(id));
        this._baseline = this._clone(this.workingTheme);
        this.historyStack = [this._clone(this.workingTheme)];
        this.historyIndex = 0;
        this.activePanel = 'colors';
        this.dirty = false;
        this._lastFocus = document.activeElement;
        this.view = ThemeCustomizerView.create(this);
        this.popup = this.view.element;
        // Inside .app-container, like the Settings overlay: the confirm dialog lives there too,
        // and from <body> the customizer covered it whatever its z-index.
        (document.querySelector('.app-container') || document.body).appendChild(this.popup);
        document.body.classList.add('customizer-open');
        this.popup.addEventListener('keydown', e => this._keyDown(e));
        // On the document: after a row's revert button hides itself, focus is outside the popup.
        this._historyKeys = e => this._historyKey(e);
        document.addEventListener('keydown', this._historyKeys);
        this._render({ force: true, syncJson: true });
        this.view.focus();
    },

    async close(force = false) {
        if (this.busy) return false;
        if (!this.popup) return true;
        if (!force && (this.dirty || this._hasJsonEdits())) {
            if (!await this._confirm('Discard unsaved theme changes?', 'Unsaved theme', 'Discard')) return false;
        }
        this._generation++;
        this.view.destroy();
        document.removeEventListener('keydown', this._historyKeys);
        this._historyKeys = null;
        this.popup.remove();
        this.popup = null;
        this.view = null;
        this.workingTheme = null;
        this.sourceThemeId = null;
        this._baseline = null;
        this._jsonSnapshot = '';
        this.baseThemeId = null;
        this.historyStack = [];
        this.historyIndex = -1;
        this.dirty = false;
        document.body.classList.remove('customizer-open');
        if (this._lastFocus?.isConnected) this._lastFocus.focus();
        this._lastFocus = null;
        return true;
    },

    // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) step through the draft's history. Text fields keep their own
    // undo, and an open confirm dialog gets the keys first.
    _historyKey(event) {
        const key = event.key.toLowerCase();
        if (!(event.ctrlKey || event.metaKey) || event.altKey || (key !== 'z' && key !== 'y')) return;
        if (event.target.matches?.('textarea, input[type="text"], input[type="search"]')) return;
        if (document.querySelector('.confirm-dialog.active')) return;
        event.preventDefault();
        event.stopPropagation();
        if (key === 'y' || event.shiftKey) this.redo(); else this.undo();
    },

    _keyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        } else if (event.key === 'Tab') {
            const items = [...this.popup.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
                .filter(el => !el.disabled && el.getClientRects().length);
            if (!items.length) { event.preventDefault(); return; }
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    },

    _render({ force = false, syncJson = false } = {}) {
        if (!this.view || !this.workingTheme) return;
        this.dirty = JSON.stringify(this.workingTheme) !== JSON.stringify(this._baseline);
        this.view.render(this.workingTheme, {
            panel: this.activePanel, dirty: this.dirty, busy: this.busy,
            canUndo: this.historyIndex > 0,
            canRedo: this.historyIndex < this.historyStack.length - 1,
            isBuiltin: this._isBuiltin(), force
        });
        this.view.renderPreview(this.workingTheme);
        if (syncJson) {
            this._jsonSnapshot = JSON.stringify(this._prepareThemeForJsonEdit(), null, 2);
            this.view.setJsonText(this._jsonSnapshot);
        }
    },

    _prepareThemeForJsonEdit() {
        const theme = this._clone(this.workingTheme);
        for (const key of ThemeManager.ASSET_KEYS) {
            if (theme.colors[key]?.startsWith('data:')) theme.colors[key] = '[BASE64_IMAGE_DATA]';
        }
        return theme;
    },

    _hasJsonEdits() {
        if (!this.view || !this.workingTheme || this.activePanel !== 'advanced') return false;
        try {
            return JSON.stringify(JSON.parse(this.view.getJsonText())) !== JSON.stringify(JSON.parse(this._jsonSnapshot));
        } catch (_) { return true; }
    },

    _record() {
        const current = JSON.stringify(this.workingTheme);
        if (current === JSON.stringify(this.historyStack[this.historyIndex])) return;
        this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
        this.historyStack.push(this._clone(this.workingTheme));
        if (this.historyStack.length > 50) this.historyStack.shift();
        this.historyIndex = this.historyStack.length - 1;
    },

    _change(mutate, { commit = true, force = false } = {}) {
        if (!this.workingTheme || this.busy) return false;
        if (this._hasJsonEdits() && !this.applyJson()) return false;
        const next = this._clone(this.workingTheme);
        mutate(next);
        const validation = ThemeTokens.validateTheme(next);
        if (!validation.valid) { this.notify(validation.errors.join('\n'), 'error'); return false; }
        this.workingTheme = next;
        if (commit) this._record();
        this._render({ force, syncJson: true });
        return true;
    },

    setName(value) {
        if (this.busy || !this.workingTheme) return;
        if (this._hasJsonEdits() && !this.applyJson()) return;
        this.workingTheme.name = String(value);
        this._record();
        this._render({ syncJson: true });
    },
    setType(value) {
        return this._change(theme => { theme.type = value; theme.editor.base = value === 'light' ? 'vs' : 'vs-dark'; });
    },
    selectPanel(panel) {
        if (!['colors', 'syntax', 'backgrounds', 'advanced'].includes(panel)) return;
        const wasJson = this.activePanel === 'advanced';
        if (wasJson && panel !== 'advanced' && this._hasJsonEdits() && !this.applyJson()) return;
        this.activePanel = panel;
        this._render({ force: true, syncJson: panel === 'advanced' && !wasJson });
    },
    setToken(key, value, options = {}) {
        if (!ThemeTokens.definitions[key]) return false;
        if (key.startsWith('syntax')) return this.setSyntax(key.slice(6).toLowerCase(), value, options);
        return this._change(theme => {
            theme.colors[key] = value;
            if (key === 'editorBg') theme.editor.background = value;
            if (key === 'bgHeader') {
                theme.colors['bgHeader-main'] = value;
                theme.colors['bgHeader-statusbar'] = ThemeTokens.toOpaque(value);
            }
            if (key === 'bgPanel') {
                for (const part of ['problems', 'input', 'expected']) theme.colors['bgPanel-' + part] = value;
            }
        }, options);
    },
    setSyntax(key, value, options = {}) {
        return this._change(theme => {
            theme.editor.syntax[key] = { ...theme.editor.syntax[key], color: value.replace(/^#/, '') };
            const tokenKey = 'syntax' + key[0].toUpperCase() + key.slice(1);
            if (ThemeTokens.definitions[tokenKey]) theme.colors[tokenKey] = value.startsWith('#') ? value : '#' + value;
        }, options);
    },
    clearBackground(key) { return this.setToken(key, ''); },

    // The value a color had when the theme was opened or last saved.
    savedValue(key) {
        return this._baseline?.colors?.[key];
    },
    savedSyntax(name) {
        const value = this._baseline?.editor?.syntax?.[name];
        return value && typeof value === 'object' ? value.color : value;
    },
    // Puts one color back to its saved value, as one undoable step. setToken() also writes
    // the keys derived from it, so those are restored with it.
    revertToken(key) {
        if (!this._baseline || !ThemeTokens.definitions[key]) return false;
        const syntax = /^syntax[A-Z]/.test(key) ? key[6].toLowerCase() + key.slice(7) : null;
        const derived = { bgHeader: ['bgHeader-main', 'bgHeader-statusbar'],
            bgPanel: ['bgPanel-problems', 'bgPanel-input', 'bgPanel-expected'] }[key] || [];
        const base = this._baseline;
        return this._change(theme => {
            for (const name of [key, ...derived]) {
                if (base.colors?.[name] === undefined) delete theme.colors[name];
                else theme.colors[name] = base.colors[name];
            }
            if (key === 'editorBg') theme.editor.background = base.editor?.background;
            if (syntax) {
                const saved = base.editor?.syntax?.[syntax];
                if (saved === undefined) delete theme.editor.syntax[syntax];
                else theme.editor.syntax[syntax] = this._clone(saved);
            }
        }, { force: true });
    },

    async setBackgroundFile(file, key) {
        if (!file || !ThemeManager.ASSET_KEYS.includes(key) || this.busy) return;
        if (file.size > 64 * 1024 * 1024) { this.notify('Background files must be smaller than 64 MB.', 'error'); return; }
        if (!['image/png','image/jpeg','image/gif','image/webp','image/svg+xml','image/avif','image/bmp','video/webm','video/mp4'].includes(file.type)) {
            this.notify('Choose a supported image, MP4 or WebM video.', 'error'); return;
        }
        const generation = this._generation;
        const request = (this._assetRequests[key] || 0) + 1;
        this._assetRequests[key] = request;
        try {
            const url = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Could not read background file.'));
                reader.readAsDataURL(file);
            });
            // Keep snapshots small: history stores file URLs instead of repeated base64 blobs.
            const assets = { [key]: url };
            await ThemeManager.externalizeAssets(assets);
            if (generation === this._generation && request === this._assetRequests[key]) {
                this.setToken(key, assets[key], { force: true });
            }
        } catch (error) { if (generation === this._generation) this.notify(error.message, 'error'); }
    },

    setBaseTheme(id) {
        if (this.busy || !ThemeManager.themes.has(id)) return;
        if (this._hasJsonEdits() && !this.applyJson()) return;
        const name = this.workingTheme.name;
        const identity = this.sourceThemeId;
        const next = this._draft(ThemeManager.themes.get(id));
        next.id = identity;
        next.name = name;
        this.workingTheme = next;
        this.baseThemeId = id;
        this._record();
        this._render({ force: true, syncJson: true });
    },
    undo() {
        if (this.busy || this.historyIndex <= 0) return;
        if (this._hasJsonEdits() && !this.applyJson()) return;
        this.historyIndex--;
        this.workingTheme = this._clone(this.historyStack[this.historyIndex]);
        this._render({ force: true, syncJson: true });
    },
    redo() {
        if (this.busy || this.historyIndex >= this.historyStack.length - 1) return;
        if (this._hasJsonEdits() && !this.applyJson()) return;
        this.historyIndex++;
        this.workingTheme = this._clone(this.historyStack[this.historyIndex]);
        this._render({ force: true, syncJson: true });
    },
    async reset() {
        if (this.busy || !await this._confirm('Reset this draft? Changes are saved only when you choose Save.', 'Reset theme', 'Reset')) return;
        const next = this._isBuiltin()
            ? this._draft(ThemeManager._getHardcodedThemes()[this.sourceThemeId])
            : this._clone(this._baseline);
        this.workingTheme = next;
        this._record();
        this._render({ force: true, syncJson: true });
    },

    applyJson(text = this.view?.getJsonText()) {
        if (this.busy) return false;
        try {
            const parsed = JSON.parse(text);
            const raw = parsed?.meta ? { ...parsed, id: parsed.meta.id, name: parsed.meta.name } : parsed;
            for (const key of ThemeManager.ASSET_KEYS) {
                if (raw.colors?.[key] === '[BASE64_IMAGE_DATA]') raw.colors[key] = this.workingTheme.colors[key] || '';
            }
            const next = this._draft(raw);
            next.id = this.sourceThemeId;
            this.workingTheme = next;
            this._record();
            this._render({ force: true, syncJson: true });
            this.notify('JSON applied to preview.', 'success');
            return true;
        } catch (error) { this.notify(error.message, 'error'); return false; }
    },

    async importFile(file) {
        if (!file || this.busy) return;
        const generation = this._generation;
        try {
            if (file.size > 100 * 1024 * 1024) throw new Error('Theme file is too large.');
            const text = await file.text();
            if (generation !== this._generation) return;
            if (this.applyJson(text)) this.notify('Theme imported into the draft. Choose Save As New to create a copy.', 'success');
        } catch (error) { this.notify(error.message, 'error'); }
    },

    _newId(name) {
        const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom-theme';
        let id = base, index = 2;
        while (ThemeManager.themes.has(id)) id = `${base}-${index++}`;
        return id;
    },

    async save({ asNew = false, backgroundOnly = false } = {}) {
        if (this.busy || !this.workingTheme) return false;
        if (this._hasJsonEdits() && !this.applyJson()) return false;
        const validation = ThemeTokens.validateTheme(this.workingTheme);
        if (!validation.valid || !this.workingTheme.name.trim()) {
            this.notify(validation.errors.join('\n') || 'Enter a theme name.', 'error'); return false;
        }
        if (this._isBuiltin() && !asNew && !backgroundOnly) asNew = true;
        this.busy = true;
        this._render();
        const draft = this._clone(this.workingTheme);
        draft.name = draft.name.trim();
        const id = asNew ? this._newId(draft.name) : this.sourceThemeId;
        const previous = ThemeManager.themes.has(id) ? this._clone(ThemeManager.themes.get(id)) : null;
        const previousBackground = ThemeManager.getBackgroundOverrides(id);
        const previousAppearance = this._clone(App.settings.appearance);
        const previousActive = ThemeManager.activeThemeId;
        let themeSaved = false;
        try {
            await ThemeManager.externalizeAssets(draft.colors);
            if (backgroundOnly) {
                await ThemeManager.saveBackgroundOverrides(id, draft.colors);
            } else {
                draft.id = id;
                if (!ThemeManager.registerTheme(draft, true)) throw new Error('Could not register theme.');
                await ThemeManager._saveUserThemes();
            }
            themeSaved = true;
            App.settings.appearance.theme = id;
            // A background saved in the customizer is the theme's canonical value.
            if (App.settings.appearance.perTheme?.[id]) delete App.settings.appearance.perTheme[id].bgUrl;
            App.settings.appearance.bgUrl = '';
            const result = await saveSettings();
            if (result?.success === false) throw new Error(result.error || 'Could not save active theme settings.');
            applyTheme(id);
            this.sourceThemeId = id;
            this.workingTheme = this._draft(ThemeManager.themes.get(id));
            this._baseline = this._clone(this.workingTheme);
            this.historyStack = [this._clone(this.workingTheme)];
            this.historyIndex = 0;
            this._refreshMarketplace();
            window.dispatchEvent(new CustomEvent('themeCustomizerSave', { detail: {
                theme: { meta: { id, name: draft.name, type: draft.type }, colors: draft.colors, editor: draft.editor, terminal: draft.terminal },
                timestamp: Date.now()
            } }));
            this.notify(backgroundOnly ? 'Background saved.' : 'Theme saved.', 'success');
            return true;
        } catch (error) {
            App.settings.appearance = previousAppearance;
            if (previous) { ThemeManager.themes.set(id, previous); ThemeManager._defineMonacoTheme(previous); }
            else ThemeManager.themes.delete(id);
            let rollbackError = '';
            if (themeSaved) {
                try {
                    if (backgroundOnly) {
                        if (previousBackground) await ThemeManager.saveBackgroundOverrides(id, previousBackground);
                        else await ThemeManager.resetBackgroundOverrides(id);
                    } else await ThemeManager._saveUserThemes();
                    await saveSettings();
                } catch (restoreError) { rollbackError = ' Could not restore saved data: ' + restoreError.message; }
            }
            if (previousActive) applyTheme(previousActive);
            themeSaved = false;
            this.notify('Save failed: ' + error.message + rollbackError, 'error');
            return false;
        } finally {
            this.busy = false;
            this._render({ force: true, syncJson: themeSaved });
        }
    },

    async exportTheme() {
        if (this.busy || !this.workingTheme) return;
        if (this._hasJsonEdits() && !this.applyJson()) return;
        try {
            const json = await ThemeManager.serializeThemePortable(this.workingTheme);
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = (this.sourceThemeId || 'custom-theme') + '.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.notify('Theme exported with its background assets.', 'success');
        } catch (error) { this.notify('Export failed: ' + error.message, 'error'); }
    },

    async deleteTheme() {
        if (this.busy || this._isBuiltin()) return;
        if (!await this._confirm('Delete this custom theme?', 'Delete theme', 'Delete', true)) return;
        this.busy = true;
        this._render();
        const deletedTheme = this._clone(ThemeManager.themes.get(this.sourceThemeId));
        const previousAppearance = this._clone(App.settings.appearance);
        const previousScheme = App.settings.editor.colorScheme;
        try {
            const id = this.sourceThemeId;
            const result = await ThemeManager.deleteTheme(id);
            if (!result.success) throw new Error(result.message);
            if (App.settings.appearance.theme === id) {
                App.settings.appearance.theme = 'kawaii-dark';
                if (App.settings.editor.colorScheme === id) App.settings.editor.colorScheme = 'auto';
                const saved = await saveSettings();
                if (saved?.success === false) throw new Error(saved.error || 'Could not save settings.');
                applyTheme('kawaii-dark');
            }
            this._refreshMarketplace();
            this.busy = false;
            await this.close(true);
        } catch (error) {
            App.settings.appearance = previousAppearance;
            App.settings.editor.colorScheme = previousScheme;
            if (!ThemeManager.themes.has(deletedTheme.id)) {
                ThemeManager.registerTheme(deletedTheme, true);
                try { await ThemeManager._saveUserThemes(); } catch (_) { }
            }
            applyTheme(previousAppearance.theme);
            this.busy = false;
            this._render();
            this.notify(error.message, 'error');
        }
    },

    _refreshMarketplace() {
        if (typeof ThemeMarketplace !== 'undefined') {
            ThemeMarketplace.renderCarousel();
            if (document.querySelector('#marketplace-popup.open, #marketplace-popup.visible')) ThemeMarketplace._renderMarketplaceContent();
        }
        const select = document.getElementById('set-theme');
        if (select) {
            const selected = App.settings.appearance.theme;
            select.replaceChildren(...ThemeManager.getThemeList().map(theme => {
                const option = document.createElement('option'); option.value = theme.id; option.textContent = theme.name; return option;
            }));
            select.value = selected;
        }
    },
    notify(message, type = 'info') {
        if (this.view?.notify) this.view.notify(message, type);
        else if (this.popup) {
            const status = this.popup.querySelector('[role="status"]');
            if (status) { status.textContent = message; status.dataset.type = type; }
        }
    },
    async _confirm(message, title, confirmText, danger = false) {
        if (typeof window.showConfirmDialog === 'function') return !!await window.showConfirmDialog({ title, message, confirmText, cancelText: 'Cancel', danger });
        return window.confirm(message);
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = ThemeCustomizer;
else window.ThemeCustomizer = ThemeCustomizer;
