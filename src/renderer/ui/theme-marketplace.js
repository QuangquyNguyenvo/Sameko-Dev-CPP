/**
 * Theme Marketplace v3.0
 * Clean theme browser and carousel
 * 
 * @author Sameko Team
 */

const ThemeMarketplace = {

    /**
     * Initialize
     */
    async init() {
        console.log('[ThemeMarketplace] Initializing v3.0...');
        this._setupCarousel();
        this._setupButtons();
        this.renderCarousel();
    },

    /**
     * Setup carousel interactions
     */
    _setupCarousel() {
        const carousel = document.getElementById('theme-carousel');
        if (!carousel) return;

        document.getElementById('theme-carousel-left')?.addEventListener('click', () => {
            carousel.scrollBy({ left: -180, behavior: 'smooth' });
        });

        document.getElementById('theme-carousel-right')?.addEventListener('click', () => {
            carousel.scrollBy({ left: 180, behavior: 'smooth' });
        });

        carousel.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.preventDefault();
                carousel.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    },

    /**
     * Setup button handlers
     */
    _setupButtons() {
        document.getElementById('btn-open-marketplace')?.addEventListener('click', () => {
            this.openMarketplace();
        });

        document.getElementById('btn-open-customizer')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentTheme = App?.settings?.appearance?.theme;
            if (typeof ThemeCustomizer !== 'undefined') {
                ThemeCustomizer.open(currentTheme);
            } else {
                console.error('[ThemeMarketplace] ThemeCustomizer not available');
            }
        });

        document.getElementById('btn-import-file')?.addEventListener('click', () => this._importFile());
        document.getElementById('btn-import-gist')?.addEventListener('click', () => this._importGist());
        document.getElementById('btn-export-file')?.addEventListener('click', () => this._exportFile());
        document.getElementById('btn-create-theme')?.addEventListener('click', () => {
            this.closeMarketplace();
            ThemeCustomizer.open(null);
        });
        document.getElementById('marketplace-close')?.addEventListener('click', () => this.closeMarketplace());
        document.querySelector('#marketplace-popup .fullscreen-popup-overlay')?.addEventListener('click', () => {
            this.closeMarketplace();
        });
    },

    /**
     * Render theme carousel
     */
    renderCarousel() {
        const carousel = document.getElementById('theme-carousel');
        const hiddenSelect = document.getElementById('set-theme');
        if (!carousel) return;

        const themes = ThemeManager.getThemeList();
        const currentTheme = App?.settings?.appearance?.theme || 'kawaii-dark';

        if (hiddenSelect) {
            hiddenSelect.innerHTML = themes.map(t =>
                `<option value="${t.id}" ${t.id === currentTheme ? 'selected' : ''}>${t.name}</option>`
            ).join('');
        }

        carousel.innerHTML = themes.map(theme => {
            const themeData = ThemeManager.themes.get(theme.id);
            const preview = this._generatePreview(themeData);
            const isActive = theme.id === currentTheme;
            const isCustom = !theme.isBuiltin;

            return `
                <div class="theme-carousel-card ${isActive ? 'active' : ''}" data-theme-id="${theme.id}">
                    <div class="theme-carousel-preview" style="background: ${preview.bg};">
                        ${preview.html}
                    </div>
                    <div class="theme-carousel-info">
                        <div class="theme-carousel-name">${theme.name}</div>
                        <div class="theme-carousel-meta">
                            <span class="theme-carousel-type">${theme.type}</span>
                            ${isCustom ? '<span class="theme-carousel-badge">Custom</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        carousel.querySelectorAll('.theme-carousel-card').forEach(card => {
            card.addEventListener('click', () => {
                this._selectTheme(card.dataset.themeId);
            });
        });

        requestAnimationFrame(() => {
            const active = carousel.querySelector('.theme-carousel-card.active');
            if (active) {
                const cardLeft = active.offsetLeft;
                const cardWidth = active.offsetWidth;
                const containerWidth = carousel.offsetWidth;
                carousel.scrollLeft = cardLeft - (containerWidth / 2) + (cardWidth / 2);
            }
        });
    },

    /**
     * Generate mini preview HTML
     */
    _generatePreview(theme) {
        if (!theme) return { bg: '#1a2530', html: '' };

        const editor = theme.editor || {};
        const syntax = editor.syntax || {};
        const bg = editor.background || theme.colors?.editorBg || '#1a2530';
        const fg = editor.foreground || '#e0f0ff';

        const kw = '#' + (syntax.keyword?.color || '88c9ea');
        const str = '#' + (syntax.string?.color || 'a3d9a5');
        const fn = '#' + (syntax.function?.color || '7ec8e3');
        const type = '#' + (syntax.type?.color || 'e8a8b8');

        const html = `
            <div class="mini-code" style="color: ${fg}; font-size: 9px; line-height: 1.4; padding: 6px;">
                <div><span style="color:${kw}">#include</span> <span style="color:${str}">&lt;iostream&gt;</span></div>
                <div><span style="color:${type}">int</span> <span style="color:${fn}">main</span>() {</div>
                <div>  cout &lt;&lt; <span style="color:${str}">"Hi"</span>;</div>
                <div>}</div>
            </div>
        `;

        return { bg, html };
    },

    /**
     * Select and apply theme
     */
    _selectTheme(themeId) {
        document.querySelectorAll('.theme-carousel-card').forEach(card => {
            card.classList.toggle('active', card.dataset.themeId === themeId);
        });

        const select = document.getElementById('set-theme');
        if (select) select.value = themeId;

        ThemeManager.setTheme(themeId);
        if (typeof App !== 'undefined') {
            App.settings.appearance.theme = themeId;
            if (typeof saveSettings === 'function') {
                saveSettings();
            }
            if (typeof applyBackgroundSettings === 'function') {
                applyBackgroundSettings();
            }
        }
    },

    /**
     * Open marketplace popup
     */
    openMarketplace() {
        const popup = document.getElementById('marketplace-popup');
        if (popup) {
            popup.style.display = 'flex';
            this._renderMarketplaceContent();
        }
    },

    /**
     * Close marketplace popup
     */
    closeMarketplace() {
        const popup = document.getElementById('marketplace-popup');
        if (popup) popup.style.display = 'none';
    },

    /**
     * Render marketplace content
     */
    _renderMarketplaceContent() {
        const container = document.getElementById('marketplace-themes-list');
        if (!container) return;

        const themes = ThemeManager.getThemeList();
        const builtinThemes = themes.filter(t => t.isBuiltin);
        const customThemes = themes.filter(t => !t.isBuiltin);
        const currentTheme = App?.settings?.appearance?.theme;

        let html = '';

        html += `
            <div class="mp-section">
                <h3 class="mp-section-title">Built-in Themes</h3>
                <div class="mp-grid">
                    ${builtinThemes.map(t => this._renderThemeCard(t, currentTheme, true)).join('')}
                </div>
            </div>
        `;

        if (customThemes.length > 0) {
            html += `
                <div class="mp-section">
                    <h3 class="mp-section-title">My Custom Themes</h3>
                    <div class="mp-grid">
                        ${customThemes.map(t => this._renderThemeCard(t, currentTheme, false)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

        container.querySelectorAll('.mp-card').forEach(card => {
            const id = card.dataset.themeId;

            card.querySelector('.mp-btn-apply')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._selectTheme(id);
                this.renderCarousel();
                this._renderMarketplaceContent();
            });

            card.querySelector('.mp-btn-edit')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeMarketplace();
                ThemeCustomizer.open(id);
            });

            card.querySelector('.mp-btn-export')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._exportTheme(id);
            });

            card.querySelector('.mp-btn-delete')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._deleteTheme(id);
            });
        });
    },

    /**
     * Render a theme card
     */
    _renderThemeCard(theme, currentThemeId, isBuiltin) {
        const themeData = ThemeManager.themes.get(theme.id);
        const preview = this._generatePreview(themeData);
        const isActive = theme.id === currentThemeId;
        const desc = themeData?.description || '';

        return `
            <div class="mp-card ${isActive ? 'active' : ''}" data-theme-id="${theme.id}">
                <div class="mp-card-preview" style="background: ${preview.bg};">
                    ${preview.html}
                    ${isActive ? '<div class="mp-active-badge">Active</div>' : ''}
                </div>
                <div class="mp-card-info">
                    <div class="mp-card-name">${theme.name}</div>
                    ${desc ? `<div class="mp-card-desc">${desc}</div>` : ''}
                    <div class="mp-card-meta">
                        <span>${theme.type}</span>
                        <span>by ${theme.author || 'Unknown'}</span>
                    </div>
                    <div class="mp-card-actions">
                        <button class="mp-btn mp-btn-apply ${isActive ? 'disabled' : ''}" ${isActive ? 'disabled' : ''}>
                            ${isActive ? 'Active' : 'Apply'}
                        </button>
                        <button class="mp-btn mp-btn-edit" title="Edit theme">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                            Edit
                        </button>
                        <button class="mp-btn mp-btn-export" title="Export theme">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                            </svg>
                            Export
                        </button>
                        ${!isBuiltin ? `<button class="mp-btn mp-btn-delete danger" title="Delete theme">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                            Delete
                        </button>` : ''}
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Export theme to file
     */
    _exportTheme(themeId) {
        const json = ThemeManager.exportTheme(themeId);
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

        this._confirm(`Delete theme "${theme.name || themeId}"?`, 'Delete theme', 'Delete', true).then((confirmed) => {
            if (!confirmed) return;

            const isCurrentTheme = App?.settings?.appearance?.theme === themeId;

            const result = ThemeManager.deleteTheme(themeId);
            if (result.success) {
                if (isCurrentTheme) {
                    const themes = ThemeManager.getThemeList();
                    if (themes.length > 0) {
                        const firstTheme = themes[0].id;
                        this._selectTheme(firstTheme);
                    }
                }
                this.renderCarousel();
                this._renderMarketplaceContent();
            } else {
                this._notify(result.message || 'Failed to delete theme', 'error');
            }
        });
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
            reader.onload = (event) => {
                try {
                    const result = ThemeManager.importTheme(event.target.result);
                    if (result.success) {
                        this.renderCarousel();
                        this._renderMarketplaceContent();
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
                if (filename.endsWith('.json') && file.content) {
                    const result = ThemeManager.importTheme(file.content);
                    if (result.success) {
                        this.renderCarousel();
                        this._renderMarketplaceContent();
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
                        <h3>${title}</h3>
                        <button class="note-dialog-close" title="Close">×</button>
                    </div>
                    <div class="note-dialog-body">
                        <input type="text" class="input-dialog-field" value="" placeholder="${placeholder}" />
                    </div>
                    <div class="note-dialog-footer">
                        <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                        <button class="note-dialog-btn note-dialog-save">OK</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            const input = overlay.querySelector('.input-dialog-field');
            try { document.activeElement?.blur?.(); } catch (_) {}
            const close = (value = null) => {
                overlay.remove();
                resolve(value);
            };

            overlay.querySelector('.note-dialog-close').onclick = () => close(null);
            overlay.querySelector('.note-dialog-cancel').onclick = () => close(null);
            overlay.querySelector('.note-dialog-save').onclick = () => close(input.value.trim() || null);
            input.onkeydown = (e) => {
                if (e.key === 'Escape') close(null);
                if (e.key === 'Enter') close(input.value.trim() || null);
            };

            setTimeout(() => {
                window.focus();
                input.focus();
                input.select();
            }, 50);
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
