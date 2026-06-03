/**
 * Theme Customizer v6.2
 * Click-to-edit live preview with background support
 * 
 * Features:
 * - Click on any element to edit its color
 * - Drag to reposition background image
 * - Full background upload/opacity/blur controls
 * - Save/Overwrite custom themes
 * 
 * @author Sameko Team
 */

const ThemeCustomizer = {
    sourceThemeId: null,
    workingTheme: null,
    popup: null,
    bgDragMode: false,
    currentColorPicker: null,
    _activeColorKey: null,
    jsonMonacoEditor: null,

    historyStack: [],
    historyIndex: -1,
    maxHistorySize: 50,

    _renderTimeout: null,
    _autoSaveTimeout: null,

    /**
     * Open customizer
     */
    open(themeId = null) {
        const themes = ThemeManager.getThemeList();
        if (themes.length === 0) {
            console.warn('[Customizer] No themes available');
            return;
        }

        if (!themeId || !ThemeManager.themes.has(themeId)) {
            themeId = App?.settings?.appearance?.theme || themes[0].id;
        }

        this.sourceThemeId = themeId;
        this.workingTheme = this._deepClone(ThemeManager.themes.get(themeId));

        if (!this.workingTheme.colors) this.workingTheme.colors = {};
        if (!this.workingTheme.editor) this.workingTheme.editor = { syntax: {} };

        this._fillAllDefaults(this.workingTheme.colors);

        if (ThemeManager.builtinThemeIds?.includes(themeId)) {
            const storageKey = `theme-bg-${themeId}`;
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    const bgSettings = JSON.parse(saved);
                    Object.assign(this.workingTheme.colors, bgSettings);
                    console.log(`[Customizer] Loaded saved background for: ${themeId}`);
                }
            } catch (e) {
                console.warn(`[Customizer] Failed to load saved background:`, e);
            }
        }

        this._migrateThemeFormat(this.workingTheme);

        this.historyStack = [this._deepClone(this.workingTheme)];
        this.historyIndex = 0;

        const root = document.documentElement;
        // Hide app background during customizer (restored via ThemeManager.setTheme on close)
        root.style.setProperty('--app-bg-opacity', '0');
        root.style.setProperty('--editor-bg-opacity', '0');
        root.style.setProperty('--app-bg-image', 'none');
        root.style.setProperty('--editor-bg-image', 'none');

        document.body.classList.add('customizer-open');

        this._createUI();
        this._bindEvents();
        this._renderPreview();
        this._setupBgDrag();
        this._updateBgStyles();
        this._updateHistoryButtons();

        requestAnimationFrame(() => {
            this.popup?.classList.add('visible');
        });
    },

    /**
     * Close customizer
     */
    close() {
        if (this.bgDragMode) {
            this._exitDragMode();
        }

        this._cleanupBgDrag();

        if (this.jsonMonacoEditor) {
            this.jsonMonacoEditor.dispose();
            this.jsonMonacoEditor = null;
        }

        if (this.popup) {
            this.popup.classList.remove('visible');
            setTimeout(() => {
                this.popup?.remove();
                this.popup = null;
            }, 300);
        }

        this._hideColorPicker();

        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }

        if (this._renderTimeout) {
            cancelAnimationFrame(this._renderTimeout);
            this._renderTimeout = null;
        }

        document.body.classList.remove('customizer-open');

        // Restore original theme cleanly — re-applies all CSS variables, bg video, Monaco theme
        if (ThemeManager.activeThemeId) {
            ThemeManager.setTheme(ThemeManager.activeThemeId);
        }

        this.workingTheme = null;
        this.sourceThemeId = null;
    },

    /**
     * Fill all missing token defaults for a colors object.
     * Called once when opening the customizer so every token has a usable value.
     * Derives missing values from related keys where possible.
     * @param {Object} c - theme.colors (mutated in place)
     */
    _fillAllDefaults(c) {
        // Helper: set key from first truthy fallback (string = key ref, other = literal)
        const d = (key, ...fallbacks) => {
            if (c[key] !== undefined && c[key] !== null) return;
            for (const f of fallbacks) {
                if (typeof f === 'string') {
                    if (c[f] !== undefined && c[f] !== null) { c[key] = c[f]; return; }
                } else {
                    c[key] = f; return;
                }
            }
        };

        // Numeric / effect defaults
        d('bgOpacity',           100);
        d('bgBrightness',        100);
        d('bgBlur',              0);
        d('editorBgOpacity',     100);
        d('editorBgBrightness',  100);
        d('editorBgBlur',        0);
        d('welcomeBoxOpacity',   0.4);

        // Derived color defaults — order matters (dependents after their sources)
        d('accentHover',             'accent', '#5eb7e0');
        d('borderStrong',            'accent', '#88c9ea');
        d('bgGlassBorder',           'border', 'borderStrong', '#3a6075');
        d('bgBase',                  'bgOceanDark', 'editorBg', '#0d1a25');
        d('bgSurface',               'bgOceanLight', 'bgPanel', '#1a3a50');
        d('buttonTextOnAccent',      '#ffffff');
        d('settingsLabelColor',      'textSecondary', 'textPrimary', '#a0c0d0');
        d('settingsSectionColor',    'accent', '#88c9ea');
        d('bgButton',                'bgOceanLight', '#243040');
        d('bgButtonHover',           'bgOceanMedium', '#3a5060');

        // Button tokens
        d('btnBg',                   'bgButton',      'rgba(255, 255, 255, 0.1)');
        d('btnBgHover',              'bgButtonHover', 'bgOceanLight', 'rgba(255, 255, 255, 0.15)');
        d('btnBorder',               'border',        '#a0c8e0');
        d('btnText',                 'textPrimary',   'textSecondary', '#e0f0ff');
        d('btnTextHover',            'accent',        '#88c9ea');
        d('btnPrimaryBg',            'accent',        'bgOceanDeep', '#4a9bc9');
        d('btnPrimaryBgHover',       'accentHover',   'bgOceanMedium', '#3a8ab8');
        d('btnPrimaryText',          'buttonTextOnAccent', '#ffffff');
        d('btnSuccessBg',            'success',       '#50fa7b');
        d('btnSuccessText',          'buttonTextOnAccent', '#ffffff');
        d('btnErrorBg',              'error',         '#ff5555');
        d('btnErrorText',            'buttonTextOnAccent', '#ffffff');

        // Welcome box tokens
        d('welcomeBoxBg',            'bgGlass', 'bgPanel', 'rgba(37, 64, 90, 0.4)');
        d('welcomeBtnBorder',        'borderStrong', 'border', '#88c9ea');
        d('welcomeBtnPrimaryBorder', 'accent', '#88c9ea');
    },

    /**
     * Migrate old theme format to new format with variant keys.
     * Handles both built-in key variants and legacy single-key themes.
     * Uses ThemeTokens.toOpaque for statusbar solid color derivation.
     * @param {object} theme - Theme object to migrate (mutated in place)
     */
    _migrateThemeFormat(theme) {
        if (!theme || !theme.colors) return;

        const colors = theme.colors;
        const toOpaque = ThemeTokens?.toOpaque;

        // bgHeader variants
        if (!colors['bgHeader-main'] && colors.bgHeader) {
            colors['bgHeader-main'] = colors.bgHeader;
        }
        if (!colors['bgHeader-statusbar'] && colors.bgHeader) {
            colors['bgHeader-statusbar'] = toOpaque ? toOpaque(colors.bgHeader) : colors.bgHeader;
        }

        // bgPanel variants
        if (!colors['bgPanel-problems'] && colors.bgPanel) {
            colors['bgPanel-problems'] = colors.bgPanel;
        }
        if (!colors['bgPanel-input'] && colors.bgPanel) {
            colors['bgPanel-input'] = colors.bgPanel;
        }
        if (!colors['bgPanel-expected'] && colors.bgPanel) {
            colors['bgPanel-expected'] = colors.bgPanel;
        }
    },

    /**
     * Create the UI
     */
    _createUI() {
        document.getElementById('theme-customizer-v6')?.remove();

        this.popup = document.createElement('div');
        this.popup.id = 'theme-customizer-v6';
        this.popup.className = 'tc6-overlay';

        const isCustomTheme = this.sourceThemeId &&
            !ThemeManager.builtinThemeIds.includes(this.sourceThemeId);

        this.popup.innerHTML = `
            <div class="tc6-container">
                <div class="tc6-header">
                    <h2>
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                        </svg>
                        <span>Theme Customizer</span>
                    </h2>
                    <button class="tc6-close" id="tc6-close">×</button>
                </div>
                
                <div class="tc6-body">
                    <!-- Toolbar -->
                    <div class="tc6-toolbar">
                        <button class="tc6-toolbar-btn active" data-category="ui">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <path d="M3 9h18M9 21V9"/>
                            </svg>
                            UI Colors
                        </button>
                        <button class="tc6-toolbar-btn" data-category="syntax">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="16 18 22 12 16 6"/>
                                <polyline points="8 6 2 12 8 18"/>
                            </svg>
                            Syntax
                        </button>
                        <button class="tc6-toolbar-btn" data-category="backgrounds">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <path d="M21 15l-5-5L5 21"/>
                            </svg>
                            Backgrounds
                        </button>
                        <button class="tc6-toolbar-btn" data-category="json">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                            </svg>
                            JSON
                        </button>
                        <button class="tc6-toolbar-btn" data-category="advanced">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
                            </svg>
                            Advanced
                        </button>
                    </div>
                    
                    <div class="tc6-main">
                        <!-- Controls Panel with Collapse -->
                        <div class="tc6-controls" id="tc6-controls">
                            <button class="tc6-controls-toggle" id="tc6-controls-toggle">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <polyline points="15 18 9 12 15 6"/>
                                </svg>
                            </button>
                            <div class="tc6-controls-content" id="tc6-controls-content"></div>
                        </div>
                        
                        <!-- Live Preview -->
                        <div class="tc6-preview">
                            <div class="tc6-edit-bar" id="tc6-edit-bar">
                                <!-- Undo/Redo - Always visible -->
                                <div class="tc6-edit-actions">
                                    <button class="tc6-edit-action" id="tc6-undo" disabled title="Undo (Ctrl+Z)">
                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                                        </svg>
                                    </button>
                                    <button class="tc6-edit-action" id="tc6-redo" disabled title="Redo (Ctrl+Y)">
                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
                                        </svg>
                                    </button>
                                </div>
                                
                                <!-- Divider -->
                                <div class="tc6-edit-divider"></div>
                                
                                <!-- Idle hint (shown when no element selected) -->
                                <span class="tc6-edit-hint" id="tc6-edit-hint">Click any element to edit</span>
                                
                                <!-- Active element info (hidden initially, replaces hint) -->
                                <div class="tc6-edit-element" id="tc6-edit-element" style="display: none;">
                                    <div class="tc6-edit-element-info">
                                        <span class="tc6-edit-element-name" id="tc6-edit-name">Element Name</span>
                                        <div class="tc6-edit-color-preview" id="tc6-edit-color"></div>
                                    </div>
                                    
                                    <div class="tc6-edit-properties" id="tc6-edit-properties"></div>
                                    
                                    <button class="tc6-edit-close" id="tc6-edit-close" title="Deselect">
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div class="tc6-preview-wrapper" id="tc6-preview-wrapper"></div>
                        </div>
                    </div>
                </div>
                
                <div class="tc6-footer">
                    <div class="tc6-footer-left">
                        <button class="tc6-btn-reset" id="tc6-reset">Reset</button>
                        ${isCustomTheme ? `
                        <button class="tc6-btn-delete" id="tc6-delete">Delete Theme</button>
                        ` : ''}
                        <!-- Auto-save indicator -->
                        <span class="tc6-autosave-indicator" id="tc6-autosave" style="display: none;">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Saved
                        </span>
                    </div>
                    <div class="tc6-footer-right">
                        ${!isCustomTheme ? `
                        <!-- Save Background Only - For built-in themes -->
                        <button class="tc6-btn-secondary" id="tc6-save-bg">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <path d="M21 15l-5-5L5 21"/>
                            </svg>
                            Save Background
                        </button>
                        ` : ''}
                        <!-- Save as New - Secondary -->
                        <button class="tc6-btn-secondary" id="tc6-save-new">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                            Create New Theme
                        </button>
                        ${isCustomTheme ? `
                        <!-- Save & Close - Primary -->
                        <button class="tc6-btn-save" id="tc6-save">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                                <polyline points="17 21 17 13 7 13 7 21"/>
                            </svg>
                            Save & Close
                        </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        this._injectStyles();
        document.body.appendChild(this.popup);

        this._renderControls();
    },

    /**
     * Inject CSS styles
     */
    _injectStyles() {
        if (document.getElementById('tc6-styles')) return;

        const style = document.createElement('style');
        style.id = 'tc6-styles';
        style.textContent = `
            /* ===== OVERLAY ===== */
            .tc6-overlay {
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(200, 230, 250, 0.6);
                backdrop-filter: blur(6px);
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            .tc6-overlay.visible { opacity: 1; }
            
            /* ===== CONTAINER - KAWAII STYLE ===== */
            .tc6-container {
                width: min(98vw, 1200px);
                height: min(95vh, 800px);
                background: var(--bg-panel, #e8f4fc);
                border: 3px solid var(--border-strong, #b3e2fa);
                border-radius: 24px 28px 26px 30px;
                box-shadow: 0 20px 60px rgba(136, 201, 234, 0.3);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                transform: scale(0.95) translateY(20px);
                transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .tc6-overlay.visible .tc6-container {
                transform: scale(1) translateY(0);
            }
            
            /* ===== HEADER - KAWAII STYLE ===== */
            .tc6-header {
                padding: 16px 24px;
                background: var(--bg-header, rgba(245, 250, 255, 0.95));
                border-bottom: 2px solid var(--border, #e0f0ff);
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
            }
            .tc6-header h2 {
                font-family: 'Fredoka', sans-serif;
                font-size: 20px;
                color: var(--text-secondary, #7eb8c5);
                display: flex;
                align-items: center;
                gap: 10px;
                margin: 0;
            }
            .tc6-header h2 svg { color: var(--accent, #88c9ea); }
            .tc6-close {
                width: 34px;
                height: 34px;
                background: var(--bg-input, #ffffff);
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 50%;
                font-size: 18px;
                cursor: pointer;
                color: var(--text-muted, #8abac5);
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
                line-height: 1;
            }
            .tc6-close:hover {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--error, #ff8fab);
                color: var(--error, #ff8fab);
                transform: rotate(90deg);
            }
            
            /* ===== BODY ===== */
            .tc6-body {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                background: var(--bg-panel, #e8f4fc);
            }
            
            /* ===== TOOLBAR ===== */
            .tc6-toolbar {
                display: flex;
                gap: 6px;
                padding: 10px 16px;
                background: var(--bg-input, #ffffff);
                border-bottom: 2px solid var(--border, #e0f0ff);
                overflow-x: auto;
                flex-shrink: 0;
            }
            .tc6-toolbar::-webkit-scrollbar { height: 0; }
            
            .tc6-toolbar-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px 14px;
                background: transparent;
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 12px 14px 13px 15px;
                color: var(--text-secondary, #7eb8c5);
                font-size: 12px;
                font-weight: 700;
                font-family: 'Fredoka', sans-serif;
                cursor: pointer;
                transition: all 0.2s ease;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .tc6-toolbar-btn svg {
                width: 16px;
                height: 16px;
                stroke-width: 2.5;
            }
            .tc6-toolbar-btn:hover {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--border-strong, #b3e2fa);
                transform: translateY(-1px);
            }
            .tc6-toolbar-btn.active {
                background: var(--bg-ocean-medium, #bce2f5);
                border-color: var(--bg-ocean-deep, #88c9ea);
                color: var(--text-primary, #2a5a75);
                box-shadow: 0 2px 6px rgba(136, 201, 234, 0.2);
            }
            .tc6-toolbar-btn.active svg {
                color: var(--bg-ocean-dark, #3a7ca5);
            }
            
            /* ===== MAIN CONTENT ===== */
            .tc6-main {
                flex: 1;
                display: flex;
                gap: 16px;
                padding: 16px 20px;
                overflow: hidden;
            }
            
            /* ===== CONTROLS PANEL ===== */
            .tc6-controls {
                width: 320px;
                flex-shrink: 0;
                background: var(--bg-input, #ffffff);
                border-right: 2px solid var(--border, #e0f0ff);
                display: flex;
                overflow: hidden;
                position: relative;
                transition: width 0.3s ease;
            }
            .tc6-controls.collapsed {
                width: 44px;
            }
            .tc6-controls.collapsed .tc6-controls-content {
                opacity: 0;
                pointer-events: none;
            }
            
            .tc6-controls-toggle {
                position: absolute;
                top: 12px;
                right: 8px;
                z-index: 10;
                width: 28px;
                height: 28px;
                background: var(--bg-panel, #e8f4fc);
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                color: var(--text-secondary, #7eb8c5);
            }
            .tc6-controls-toggle:hover {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--accent, #88c9ea);
                transform: scale(1.1);
            }
            .tc6-controls.collapsed .tc6-controls-toggle {
                left: 8px;
                right: auto;
            }
            .tc6-controls.collapsed .tc6-controls-toggle svg {
                transform: rotate(180deg);
            }
            
            .tc6-controls-content {
                flex: 1;
                overflow-y: auto;
                padding: 48px 16px 16px 16px;
                transition: opacity 0.3s ease;
            }
            .tc6-controls-content::-webkit-scrollbar { width: 6px; }
            .tc6-controls-content::-webkit-scrollbar-track { background: transparent; }
            .tc6-controls-content::-webkit-scrollbar-thumb {
                background: var(--border, #e0f0ff);
                border-radius: 10px;
            }
            .tc6-controls-content::-webkit-scrollbar-thumb:hover {
                background: var(--border-strong, #b3e2fa);
            }
            
            .tc6-category-panel {
                display: none;
            }
            .tc6-category-panel.active {
                display: block;
            }
            
            .tc6-section {
                margin-bottom: 20px;
            }
            .tc6-section:last-child { margin-bottom: 0; }
            
            .tc6-section-title {
                font-size: 11px;
                font-weight: 700;
                color: var(--settings-section-color, #5a9fc8);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                margin-bottom: 10px;
                padding-bottom: 6px;
                border-bottom: 2px solid var(--border, #e0f0ff);
            }
            
            .tc6-color-grid {
                display: grid;
                grid-template-columns: 1fr;
                gap: 8px;
            }
            
            .tc6-color-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 12px;
                background: var(--bg-panel, #e8f4fc);
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 10px 12px 11px 13px;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .tc6-color-item:hover {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--border-strong, #b3e2fa);
                transform: translateX(3px);
            }
            .tc6-color-item label {
                font-size: 11px;
                font-weight: 600;
                color: var(--settings-label-color, #5a8a95);
                cursor: pointer;
            }
            .tc6-color-item .tc6-color-swatch {
                width: 26px;
                height: 26px;
                border-radius: 6px;
                border: 2px solid var(--border, #e0f0ff);
                flex-shrink: 0;
                box-shadow: 0 2px 4px rgba(136, 201, 234, 0.1);
            }
            
            .tc6-field {
                margin-bottom: 14px;
            }
            .tc6-field:last-child { margin-bottom: 0; }
            
            .tc6-field-label {
                font-size: 11px;
                font-weight: 600;
                color: var(--settings-label-color, #5a8a95);
                margin-bottom: 6px;
                display: block;
            }
            
            .tc6-input {
                width: 100%;
                padding: 10px 14px;
                border-radius: 15px;
                border: 2px solid var(--border, #e0f0ff);
                background: var(--bg-panel, #e8f4fc);
                color: var(--text-primary, #2a5a75);
                font-size: 13px;
                font-family: inherit;
                transition: all 0.2s ease;
            }
            .tc6-input:focus {
                border-color: var(--accent, #88c9ea);
                outline: none;
                box-shadow: 0 0 0 2px rgba(136, 201, 234, 0.15);
            }
            
            .tc6-upload-row {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            .tc6-upload-row .tc6-input {
                flex: 1;
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .tc6-upload-btn {
                padding: 10px 14px;
                border-radius: 12px;
                background: var(--bg-ocean-light, #eff8fe);
                border: 2px solid var(--bg-ocean-medium, #bce2f5);
                color: var(--text-secondary, #7eb8c5);
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                white-space: nowrap;
            }
            .tc6-upload-btn:hover {
                background: var(--bg-ocean-medium, #bce2f5);
            }
            
            .tc6-bg-drag-btn {
                padding: 10px;
                border-radius: 12px;
                background: var(--bg-ocean-light, #eff8fe);
                border: 2px solid var(--bg-ocean-medium, #bce2f5);
                color: var(--text-secondary, #7eb8c5);
                font-size: 11px;
                cursor: move;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .tc6-bg-drag-btn:hover {
                background: var(--bg-ocean-medium, #bce2f5);
                color: var(--text-primary, #2a5a75);
            }
            
            .tc6-clear-btn {
                padding: 10px;
                border-radius: 12px;
                background: transparent;
                color: var(--text-muted, #8abac5);
                border: 2px solid var(--border, #e0f0ff);
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s ease;
            }
            .tc6-clear-btn:hover {
                color: var(--error, #ff8fab);
                border-color: var(--error, #ff8fab);
            }
            
            /* JSON Editor Styles - Monaco Container */
            .tc6-json-section {
                display: flex;
                flex-direction: column;
                height: 100%;
                padding-bottom: 0;
            }
            .tc6-monaco-container {
                flex: 1;
                min-height: 450px;
                border-radius: 12px;
                overflow: hidden;
                border: 2px solid var(--border, #3a6075);
            }
            .tc6-monaco-container:focus-within {
                border-color: var(--accent, #88c9ea);
            }
            .tc6-json-editor-actions {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-top: 10px;
                gap: 10px;
                flex-shrink: 0;
            }
            .tc6-json-status {
                font-size: 11px;
                font-weight: 500;
            }
            .tc6-json-status.tc6-json-valid {
                color: var(--success, #7dcea0);
            }
            .tc6-json-status.tc6-json-invalid {
                color: var(--error, #ff8fab);
            }
            .tc6-json-apply-btn {
                flex-shrink: 0;
            }
            .tc6-json-apply-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .tc6-slider-row {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .tc6-slider-row input[type="range"] {
                flex: 1;
                -webkit-appearance: none;
                appearance: none;
                background: var(--bg-panel, #e8f4fc);
                height: 10px;
                border-radius: 5px;
                border: 2px solid var(--border, #e0f0ff);
                cursor: pointer;
            }
            .tc6-slider-row input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 22px;
                height: 22px;
                background: var(--accent, #88c9ea);
                border-radius: 50%;
                border: 3px solid var(--bg-input, #ffffff);
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.15);
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .tc6-slider-row input[type="range"]:hover::-webkit-slider-thumb {
                transform: scale(1.1);
            }
            .tc6-slider-val {
                min-width: 50px;
                text-align: right;
                font-size: 12px;
                color: var(--text-secondary, #7eb8c5);
                font-weight: 700;
                font-family: 'Fredoka', sans-serif;
            }
            
            /* ===== EDIT BAR - CANVA STYLE ===== */
            .tc6-edit-bar {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 16px;
                background: var(--bg-input, #ffffff);
                border-bottom: 2px solid var(--border, #e0f0ff);
                min-height: 50px;
                transition: min-height 0.3s ease;
                flex-shrink: 0;
            }
            
            .tc6-edit-actions {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }
            
            .tc6-edit-action {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                border: 2px solid var(--border, #e0f0ff);
                background: transparent;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-secondary, #7eb8c5);
            }
            .tc6-edit-action:hover:not(:disabled) {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--border-strong, #b3e2fa);
            }
            .tc6-edit-action:disabled {
                opacity: 0.3;
                cursor: not-allowed;
            }
            
            .tc6-edit-divider {
                width: 2px;
                height: 24px;
                background: var(--border, #e0f0ff);
                border-radius: 1px;
                margin: 0 6px;
                flex-shrink: 0;
            }
            
            .tc6-edit-hint {
                font-size: 11px;
                color: var(--text-muted, #8abac5);
                font-weight: 600;
            }
            
            /* Active state - Element selected (inline) */
            .tc6-edit-element {
                display: flex;
                align-items: center;
                gap: 10px;
                flex: 1;
                animation: tc6-edit-expand 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            @keyframes tc6-edit-expand {
                from {
                    opacity: 0;
                    transform: translateX(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            
            .tc6-edit-element-info {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 6px 12px;
                background: var(--bg-ocean-light, #eff8fe);
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 12px 14px 13px 15px;
            }
            
            .tc6-edit-color-preview {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                border: 3px solid var(--border-strong, #b3e2fa);
                cursor: pointer;
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.15);
                transition: transform 0.2s ease;
            }
            .tc6-edit-color-preview:hover {
                transform: scale(1.1);
            }
            
            .tc6-edit-element-name {
                font-size: 13px;
                font-weight: 700;
                color: var(--text-primary, #2a5a75);
                font-family: 'Fredoka', sans-serif;
            }
            
            .tc6-edit-properties {
                display: flex;
                gap: 6px;
            }
            
            .tc6-edit-prop-btn {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                border: 2px solid var(--border, #e0f0ff);
                background: transparent;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                color: var(--text-secondary, #7eb8c5);
                font-size: 14px;
                font-weight: 700;
            }
            .tc6-edit-prop-btn:hover {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--border-strong, #b3e2fa);
            }
            .tc6-edit-prop-btn.active {
                background: var(--bg-ocean-medium, #bce2f5);
                border-color: var(--bg-ocean-deep, #88c9ea);
            }
            
            /* Expanded slider (inline) */
            .tc6-edit-slider-expanded {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 0 12px;
                animation: tc6-slider-expand 0.3s ease;
            }
            
            @keyframes tc6-slider-expand {
                from {
                    opacity: 0;
                    max-width: 0;
                }
                to {
                    opacity: 1;
                    max-width: 400px;
                }
            }
            
            .tc6-edit-slider-expanded input[type="range"] {
                flex: 1;
                -webkit-appearance: none;
                appearance: none;
                background: var(--bg-panel, #e8f4fc);
                height: 10px;
                border-radius: 5px;
                border: 2px solid var(--border, #e0f0ff);
            }
            .tc6-edit-slider-expanded input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 20px;
                height: 20px;
                background: var(--accent, #88c9ea);
                border-radius: 50%;
                border: 3px solid var(--bg-input, #ffffff);
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.15);
                cursor: pointer;
            }
            
            .tc6-edit-slider-value {
                min-width: 50px;
                text-align: right;
                font-size: 12px;
                font-weight: 700;
                color: var(--text-secondary, #7eb8c5);
                font-family: 'Fredoka', sans-serif;
            }
            
            .tc6-edit-close {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                border: 2px solid var(--border, #e0f0ff);
                background: transparent;
                cursor: pointer;
                margin-left: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-muted, #8abac5);
            }
            .tc6-edit-close:hover {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--error, #ff8fab);
                color: var(--error, #ff8fab);
            }
            
            /* ===== PREVIEW AREA ===== */
            .tc6-preview {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                background: var(--bg-ocean-dark, #3a7ca5);
                border: 3px solid var(--border, #e0f0ff);
                border-radius: 30px 35px 32px 38px;
                position: relative;
            }
            
            .tc6-preview-wrapper {
                flex: 1;
                margin: 12px;
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
                position: relative;
                transform-origin: center;
                transition: transform 0.3s ease;
            }
            
            /* Live IDE Preview */
            .tc6-ide {
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                position: relative;
                background: var(--editor-bg, #1e1e1e);
            }
            
            .tc6-ide-bg {
                position: absolute;
                inset: 0;
                background-size: cover;
                background-position: center;
                pointer-events: none;
                z-index: 0;
            }
            
            .tc6-ide-content {
                position: relative;
                z-index: 1;
                flex: 1;
                display: flex;
                flex-direction: column;
                transition: opacity 0.2s ease;
            }
            
            /* Drag mode - Show UI at 80% opacity so user can see how bg looks */
            .tc6-ide-content.tc6-dimmed {
                opacity: 0.8;
                pointer-events: none;
            }
            
            /* Clickable elements */
            .tc6-clickable {
                cursor: pointer;
                position: relative;
                transition: outline 0.15s ease;
            }
            .tc6-clickable:hover {
                outline: 2px dashed var(--accent, #88c9ea);
                outline-offset: 2px;
                z-index: 100;
            }
            .tc6-clickable:hover::after {
                content: attr(data-label);
                position: absolute;
                top: -26px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--accent, #88c9ea);
                color: #fff;
                padding: 4px 10px;
                border-radius: 6px;
                font-size: 10px;
                font-weight: 600;
                white-space: nowrap;
                z-index: 1000;
                pointer-events: none;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            }
            
            .tc6-color-active {
                outline: 2px solid #ffcc00 !important;
                outline-offset: 2px !important;
                box-shadow: 0 0 12px rgba(255, 204, 0, 0.5) !important;
            }
            
            /* Editor wrapper */
            .tc6-editor-wrapper {
                position: relative;
            }
            .tc6-editor-bg {
                position: absolute;
                inset: 0;
                background-size: cover;
                background-position: center;
                pointer-events: none;
            }
            
            /* ===== FOOTER - KAWAII STYLE ===== */
            .tc6-footer {
                padding: 16px 24px;
                background: var(--bg-panel, #e8f4fc);
                border-top: 3px dashed var(--border, #e0f0ff);
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 12px;
                flex-shrink: 0;
            }
            
            .tc6-btn-reset {
                background: var(--bg-input, #ffffff);
                color: var(--text-muted, #8abac5);
                border: 3px solid var(--border, #e0f0ff);
                padding: 12px 24px;
                border-radius: 18px 22px 20px 24px;
                cursor: pointer;
                font-weight: 700;
                font-size: 14px;
                font-family: 'Fredoka', sans-serif;
                transition: all 0.2s ease;
            }
            .tc6-btn-reset:hover {
                background: var(--bg-ocean-light, #eff8fe);
                color: var(--error, #ff8fab);
                border-color: var(--error, #ff8fab);
            }
            
            .tc6-btn-delete {
                background: transparent;
                color: var(--error, #ff8fab);
                border: 3px solid var(--error, #ff8fab);
                padding: 12px 24px;
                border-radius: 18px 22px 20px 24px;
                cursor: pointer;
                font-weight: 700;
                font-size: 14px;
                font-family: 'Fredoka', sans-serif;
                transition: all 0.2s ease;
            }
            .tc6-btn-delete:hover {
                background: var(--error, #ff8fab);
                color: #fff;
            }
            
            .tc6-btn-save {
                background: var(--bg-ocean-medium, #bce2f5);
                border: 3px solid var(--bg-ocean-deep, #88c9ea);
                color: var(--text-primary, #2a5a75);
                padding: 12px 32px;
                border-radius: 22px 18px 20px 16px;
                font-weight: 700;
                font-size: 14px;
                font-family: 'Fredoka', sans-serif;
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 4px 4px 0 rgba(136, 201, 234, 0.15);
            }
            .tc6-btn-save:hover {
                transform: translate(-2px, -2px);
                box-shadow: 6px 6px 0 rgba(136, 201, 234, 0.25);
            }
            
            .tc6-btn-save-new {
                background: var(--accent, #88c9ea);
                border: 3px solid var(--accent, #88c9ea);
                color: var(--button-text-on-accent, #ffffff);
                padding: 12px 32px;
                border-radius: 25px 20px 22px 18px;
                font-weight: 700;
                font-size: 14px;
                font-family: 'Fredoka', sans-serif;
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 4px 4px 0 rgba(136, 201, 234, 0.15);
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
            }
            .tc6-btn-save-new:hover {
                transform: translate(-2px, -2px);
                box-shadow: 6px 6px 0 rgba(136, 201, 234, 0.25);
                filter: brightness(1.1);
            }
            
            /* ===== COLOR PICKER ===== */
            .tc6-color-picker {
                position: fixed;
                z-index: 100001;
                background: var(--bg-panel, #e8f4fc);
                border: 2px solid var(--border, #b3e2fa);
                border-radius: 16px;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(136, 201, 234, 0.25) inset;
                padding: 0;
                min-width: 320px;
                max-width: 360px;
                display: none;
                overflow: hidden;
                backdrop-filter: blur(8px);
            }
            .tc6-color-picker.visible { display: block; }
            
            .tc6-picker-header {
                padding: 12px 16px;
                background: var(--bg-panel, #e8f4fc);
                border-bottom: 3px dashed var(--border, #e0f0ff);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .tc6-picker-title {
                font-family: 'Fredoka', sans-serif;
                font-size: 14px;
                font-weight: 700;
                color: var(--text-secondary, #7eb8c5);
            }
            .tc6-picker-close {
                background: none;
                border: none;
                font-size: 20px;
                color: var(--text-muted, #8abac5);
                cursor: pointer;
                transition: all 0.2s ease;
                line-height: 1;
                font-family: Arial, sans-serif;
            }
            .tc6-picker-close:hover {
                color: var(--error, #ff8fab);
                transform: rotate(90deg);
            }
            
            .tc6-picker-tabs {
                display: flex;
                background: var(--bg-panel, #e8f4fc);
                border-bottom: 3px dashed var(--border, #e0f0ff);
            }
            .tc6-picker-tab {
                flex: 1;
                padding: 10px 12px;
                background: transparent;
                border: none;
                color: var(--text-secondary, #7eb8c5);
                font-size: 11px;
                font-weight: 700;
                font-family: 'Fredoka', sans-serif;
                cursor: pointer;
                transition: all 0.2s;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .tc6-picker-tab:hover {
                background: var(--bg-ocean-light, #eff8fe);
            }
            .tc6-picker-tab.active {
                background: var(--bg-input, #ffffff);
                color: var(--accent, #88c9ea);
            }
            
            .tc6-picker-panel {
                display: none;
                padding: 16px;
            }
            .tc6-picker-panel.active {
                display: block;
            }
            
            .tc6-picker-section {
                margin-bottom: 14px;
            }
            .tc6-picker-section:last-child { margin-bottom: 0; }
            
            .tc6-picker-section-title {
                font-size: 10px;
                font-weight: 700;
                color: var(--settings-section-color, #5a9fc8);
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 10px;
            }
            
            .tc6-color-input-native {
                width: 100%;
                height: 50px;
                border: 3px solid var(--border, #e0f0ff);
                border-radius: 12px;
                cursor: pointer;
                margin-bottom: 12px;
            }
            .tc6-color-input-native::-webkit-color-swatch-wrapper {
                padding: 4px;
            }
            .tc6-color-input-native::-webkit-color-swatch {
                border: none;
                border-radius: 8px;
            }
            
            .tc6-hex-input {
                width: 100%;
                padding: 10px 14px;
                border-radius: 12px;
                border: 2px solid var(--border, #e0f0ff);
                background: var(--bg-panel, #e8f4fc);
                color: var(--text-primary, #2a5a75);
                font-size: 14px;
                font-family: 'JetBrains Mono', monospace;
                font-weight: 600;
                text-align: center;
                text-transform: uppercase;
                transition: all 0.2s ease;
            }
            .tc6-hex-input:focus {
                border-color: var(--accent, #88c9ea);
                outline: none;
                box-shadow: 0 0 0 2px rgba(136, 201, 234, 0.15);
            }
            
            .tc6-palette-grid {
                display: grid;
                gap: 14px;
            }
            .tc6-palette {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .tc6-palette-name {
                font-size: 11px;
                font-weight: 700;
                color: var(--text-secondary, #7eb8c5);
                font-family: 'Fredoka', sans-serif;
            }
            .tc6-palette-swatches {
                display: grid;
                grid-template-columns: repeat(8, 1fr);
                gap: 6px;
            }
            .tc6-swatch {
                aspect-ratio: 1;
                border-radius: 8px;
                border: 3px solid var(--border, #e0f0ff);
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.1);
            }
            .tc6-swatch:hover {
                transform: scale(1.15) translateY(-2px);
                box-shadow: 4px 4px 0 rgba(136, 201, 234, 0.2);
                border-color: var(--border-strong, #b3e2fa);
            }
            
            .tc6-preset-grid {
                display: grid;
                grid-template-columns: repeat(8, 1fr);
                gap: 6px;
            }
            .tc6-preset-swatch {
                aspect-ratio: 1;
                border-radius: 8px;
                border: 3px solid var(--border, #e0f0ff);
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.1);
            }
            .tc6-preset-swatch:hover {
                transform: scale(1.15) translateY(-2px);
                box-shadow: 4px 4px 0 rgba(136, 201, 234, 0.2);
                border-color: var(--border-strong, #b3e2fa);
            }
            
            .tc6-recent-colors {
                display: grid;
                grid-template-columns: repeat(10, 1fr);
                gap: 6px;
            }
            
            .tc6-opacity-row {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-top: 12px;
            }
            .tc6-opacity-row label {
                font-size: 11px;
                font-weight: 700;
                color: var(--text-secondary, #7eb8c5);
                min-width: 60px;
            }
            .tc6-opacity-row input[type="range"] {
                flex: 1;
                -webkit-appearance: none;
                appearance: none;
                background: var(--bg-panel, #e8f4fc);
                height: 10px;
                border-radius: 5px;
                border: 2px solid var(--border, #e0f0ff);
                cursor: pointer;
            }
            .tc6-opacity-row input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 20px;
                height: 20px;
                background: var(--accent, #88c9ea);
                border-radius: 50%;
                border: 3px solid var(--bg-input, #ffffff);
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.15);
                cursor: pointer;
            }
            .tc6-opacity-val {
                min-width: 45px;
                text-align: right;
                font-size: 12px;
                color: var(--text-secondary, #7eb8c5);
                font-weight: 700;
                font-family: 'Fredoka', sans-serif;
            }
            
            /* ===== DRAG MODE NOTIFICATION ===== */
            .tc6-drag-confirm-btn {
                padding: 6px 14px;
                background: var(--bg-input, #ffffff);
                border: 2px solid var(--border-strong, #b3e2fa);
                border-radius: 10px 12px 11px 13px;
                color: var(--text-primary, #2a5a75);
                font-size: 12px;
                font-weight: 700;
                font-family: 'Fredoka', sans-serif;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-left: 12px;
                transition: all 0.2s ease;
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.15);
            }
            .tc6-drag-confirm-btn:hover {
                background: var(--bg-ocean-light, #eff8fe);
                transform: translateY(-1px);
                box-shadow: 3px 3px 0 rgba(136, 201, 234, 0.25);
            }
            .tc6-drag-confirm-btn svg {
                color: var(--success, #a3d9a5);
                width: 14px;
                height: 14px;
            }
            
            /* ===== COLOR DROPDOWN (FIGMA-STYLE) ===== */
            .tc6-color-dropdown {
                position: fixed;
                z-index: 100001;
                background: var(--bg-panel, #e8f4fc);
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 14px;
                padding: 12px;
                min-width: 240px;
                box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(136, 201, 234, 0.2) inset;
                opacity: 0;
                transform: translateY(-10px) scale(0.95);
                transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
                backdrop-filter: blur(8px);
            }
            .tc6-color-dropdown.visible {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            
            .tc6-dropdown-section {
                margin-bottom: 12px;
            }
            .tc6-dropdown-section:last-child {
                margin-bottom: 0;
            }
            
            .tc6-dropdown-color-native {
                width: 100%;
                height: 50px;
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 10px;
                cursor: pointer;
                margin-bottom: 10px;
            }
            .tc6-dropdown-color-native::-webkit-color-swatch-wrapper {
                padding: 4px;
            }
            .tc6-dropdown-color-native::-webkit-color-swatch {
                border: none;
                border-radius: 6px;
            }
            
            .tc6-dropdown-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .tc6-dropdown-label {
                font-size: 11px;
                font-weight: 700;
                color: var(--text-secondary, #7eb8c5);
                min-width: 35px;
            }
            
            .tc6-dropdown-hex {
                flex: 1;
                padding: 8px 10px;
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 8px;
                background: var(--bg-panel, #e8f4fc);
                color: var(--text-primary, #2a5a75);
                font-size: 12px;
                font-family: 'JetBrains Mono', monospace;
                font-weight: 600;
                transition: border-color 0.2s;
            }
            .tc6-dropdown-hex:focus {
                border-color: var(--accent, #88c9ea);
                outline: none;
            }
            
            .tc6-dropdown-section-title {
                font-size: 10px;
                font-weight: 700;
                color: var(--settings-section-color, #5a9fc8);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                margin-bottom: 8px;
            }
            
            .tc6-dropdown-preset-grid {
                display: grid;
                grid-template-columns: repeat(8, 1fr);
                gap: 6px;
            }
            
            .tc6-dropdown-preset {
                width: 100%;
                aspect-ratio: 1;
                border-radius: 6px;
                border: 2px solid var(--border, #e0f0ff);
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 1px 1px 0 rgba(136, 201, 234, 0.1);
            }
            .tc6-dropdown-preset:hover {
                transform: scale(1.15);
                border-color: var(--accent, #88c9ea);
                box-shadow: 2px 2px 0 rgba(136, 201, 234, 0.2);
            }
            
            /* ===== PROPERTY POPOVER (MINI SLIDER) ===== */
            .tc6-property-popover {
                position: fixed;
                z-index: 100001;
                background: var(--bg-input, #ffffff);
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 10px 12px 11px 13px;
                padding: 12px 14px;
                min-width: 200px;
                box-shadow: 0 6px 18px rgba(136, 201, 234, 0.25);
                opacity: 0;
                transform: translateY(-8px) scale(0.9);
                transition: all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .tc6-property-popover.visible {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            
            .tc6-popover-label {
                font-size: 11px;
                font-weight: 700;
                color: var(--text-secondary, #7eb8c5);
                margin-bottom: 10px;
                font-family: 'Fredoka', sans-serif;
            }
            
            .tc6-popover-slider-row {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .tc6-popover-slider {
                flex: 1;
                -webkit-appearance: none;
                appearance: none;
                background: var(--bg-panel, #e8f4fc);
                height: 8px;
                border-radius: 4px;
                border: 2px solid var(--border, #e0f0ff);
                cursor: pointer;
            }
            .tc6-popover-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 18px;
                height: 18px;
                background: var(--accent, #88c9ea);
                border-radius: 50%;
                border: 3px solid var(--bg-input, #ffffff);
                box-shadow: 1px 1px 0 rgba(136, 201, 234, 0.15);
                cursor: pointer;
                transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            .tc6-popover-slider::-webkit-slider-thumb:hover {
                transform: scale(1.15);
            }
            
            .tc6-popover-value {
                min-width: 45px;
                text-align: right;
                font-size: 12px;
                font-weight: 700;
                color: var(--text-primary, #2a5a75);
                font-family: 'Fredoka', sans-serif;
            }
            
            /* ===== SAVE NOTIFICATION ===== */
            .tc6-save-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 100002;
                opacity: 0;
                transform: translateY(-20px) scale(0.9);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                pointer-events: none;
            }
            .tc6-save-notification.visible {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            .tc6-save-notification-content {
                display: flex;
                align-items: center;
                gap: 12px;
                background: var(--bg-input, #ffffff);
                border: 4px solid var(--accent, #88c9ea);
                border-radius: 20px 25px 22px 28px;
                padding: 16px 20px;
                box-shadow: 8px 8px 0 rgba(136, 201, 234, 0.15), 0 15px 40px rgba(136, 201, 234, 0.25);
                min-width: 300px;
            }
            .tc6-save-tick {
                color: var(--success, #a3d9a5);
                flex-shrink: 0;
                animation: tc6-tick-draw 0.4s ease-out;
            }
            @keyframes tc6-tick-draw {
                0% {
                    stroke-dasharray: 0, 20;
                    stroke-dashoffset: 20;
                }
                100% {
                    stroke-dasharray: 20, 0;
                    stroke-dashoffset: 0;
                }
            }
            .tc6-save-message {
                color: var(--text-primary, #2a5a75);
                font-size: 14px;
                font-weight: 700;
                font-family: 'Fredoka', sans-serif;
                flex: 1;
            }
            
            /* ===== FOOTER LAYOUT ===== */
            .tc6-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 24px;
                background: var(--bg-input, #ffffff);
                border-top: 2px solid var(--border, #e0f0ff);
                flex-shrink: 0;
            }
            
            .tc6-footer-left {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .tc6-footer-right {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .tc6-btn-secondary {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 10px 16px;
                background: transparent;
                border: 2px solid var(--border, #e0f0ff);
                border-radius: 12px 14px 13px 15px;
                color: var(--text-secondary, #7eb8c5);
                font-size: 12px;
                font-weight: 700;
                font-family: 'Fredoka', sans-serif;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .tc6-btn-secondary:hover {
                background: var(--bg-ocean-light, #eff8fe);
                border-color: var(--border-strong, #b3e2fa);
            }
            .tc6-btn-secondary svg {
                width: 14px;
                height: 14px;
            }
            
            .tc6-autosave-indicator {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                font-weight: 600;
                color: var(--success, #a3d9a5);
                font-family: 'Fredoka', sans-serif;
                animation: tc6-fade-in 0.3s ease;
            }
            .tc6-autosave-indicator svg {
                color: var(--success, #a3d9a5);
            }
            
            @keyframes tc6-fade-in {
                from { opacity: 0; transform: translateX(-10px); }
                to { opacity: 1; transform: translateX(0); }
            }
            
            /* ========================================
               PREVIEW ELEMENT STYLES
               CSS Variable-based styling for scope isolation
               Each element reads its own CSS variable with fallback
               ======================================== */
            
            /* Header - Uses --bg-header-main with fallback to --bg-header */
            .tc6-header-main {
                height: 32px;
                display: flex;
                align-items: center;
                padding: 0 10px;
                gap: 8px;
                background: var(--bg-header-main, var(--bg-header, #1a1e2e));
                border-bottom: 1px solid var(--border, #333);
            }
            
            /* Status Bar - Uses --bg-header-statusbar with fallback */
            .tc6-statusbar {
                height: 20px;
                display: flex;
                align-items: center;
                padding: 0 8px;
                gap: 6px;
                background: var(--bg-header-statusbar, var(--bg-header, #1a1e2e));
                border-top: 1px solid var(--border, #333);
                font-size: 9px;
            }
            
            /* Problem Panel - Uses --bg-panel-problems with fallback */
            .tc6-panel-problems {
                height: 60px;
                border-radius: 6px;
                background: var(--bg-panel-problems, var(--bg-panel, #1a1e2e));
                border: 1px solid var(--border, #333);
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            
            /* Input Panel - Uses --bg-panel-input with fallback */
            .tc6-panel-input {
                flex: 1;
                background: var(--bg-panel-input, var(--bg-panel, #1a1e2e));
                border: 1px solid var(--border, #333);
                border-radius: 6px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            
            /* Expected Panel - Uses --bg-panel-expected with fallback */
            .tc6-panel-expected {
                flex: 1;
                background: var(--bg-panel-expected, var(--bg-panel, #1a1e2e));
                border: 1px solid var(--border, #333);
                border-radius: 6px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            
            /* Editor Background */
            .tc6-editor-bg-container {
                flex: 1;
                min-height: 180px;
                border-radius: 8px;
                background: var(--editor-bg, #1e1e1e);
                border: 1px solid var(--border, #333);
                position: relative;
                overflow: hidden;
            }
            
            /* Terminal */
            .tc6-terminal {
                width: 160px;
                background: var(--terminal-bg, #0d1520);
                border: 1px solid var(--border, #333);
                border-radius: 6px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            
            /* Input Area */
            .tc6-input-area {
                flex: 1;
                padding: 8px;
                font-size: 10px;
                color: var(--text-muted, #888);
                background: var(--bg-input, #222);
                margin: 4px;
                border-radius: 4px;
            }
            
            /* Panel Header (shared) */
            .tc6-panel-header {
                padding: 4px 8px;
                font-size: 9px;
                font-weight: 700;
                color: var(--text-primary, #fff);
                border-bottom: 1px solid var(--border, #333);
                display: flex;
                align-items: center;
                gap: 8px;
                background: var(--bg-header, #1a1e2e);
            }
            
            /* Panel Title */
            .tc6-panel-title {
                padding: 5px 8px;
                font-size: 9px;
                font-weight: 700;
                color: var(--accent, #88c9ea);
                border-bottom: 1px solid var(--border, #333);
            }
            
            /* Panel Body */
            .tc6-panel-body {
                flex: 1;
                padding: 8px;
                font-size: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            /* Terminal Body */
            .tc6-terminal-body {
                flex: 1;
                padding: 8px;
                font-size: 10px;
                overflow: hidden;
            }
            
            /* Terminal Input */
            .tc6-terminal-input {
                padding: 4px 8px;
                border-top: 1px solid var(--border, #333);
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            /* Terminal Send Button */
            .tc6-terminal-send {
                margin-left: auto;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: var(--accent, #88c9ea);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            /* Text Color Classes */
            .tc6-text-primary { color: var(--text-primary, #fff); }
            .tc6-text-secondary { color: var(--text-secondary, #aaa); }
            .tc6-text-muted { color: var(--text-muted, #888); }
            .tc6-text-success { color: var(--success, #7dcea0); }
            .tc6-accent-text { color: var(--accent, #88c9ea); }
            .tc6-accent-bg { background: var(--accent, #88c9ea); }
            
            /* Syntax Color Classes */
            .tc6-syntax-keyword { color: var(--syntax-keyword, #569cd6); }
            .tc6-syntax-string { color: var(--syntax-string, #ce9178); }
            .tc6-syntax-type { color: var(--syntax-type, #4ec9b0); }
            .tc6-syntax-function { color: var(--syntax-function, #dcdcaa); }
            .tc6-syntax-number { color: var(--syntax-number, #b5cea8); }
            .tc6-syntax-variable { color: var(--syntax-variable, #9cdcfe); }
            .tc6-syntax-operator { color: var(--syntax-operator, #d4d4d4); }
            .tc6-syntax-bracket { color: var(--syntax-bracket, #ffd700); }
            .tc6-line-number { 
                color: var(--text-muted, #666); 
                margin-right: 12px; 
                user-select: none; 
            }
            
            /* Status Indicators */
            .tc6-indicator-success { 
                width: 8px; 
                height: 8px; 
                border-radius: 50%; 
                background: var(--success, #7dcea0); 
            }
            .tc6-indicator-error { 
                width: 8px; 
                height: 8px; 
                border-radius: 50%; 
                background: var(--error, #ff6b6b); 
            }
            .tc6-badge-error {
                background: var(--error, #ff6b6b);
                color: #fff;
                padding: 1px 6px;
                border-radius: 8px;
                font-size: 8px;
            }
            
            /* Accent Badge */
            .tc6-accent-badge {
                font-weight: 700;
                font-size: 10px;
                padding: 3px 6px;
                border-radius: 3px;
                background: var(--accent, #88c9ea);
                color: #fff;
            }
            
            /* Menu Items */
            .tc6-menu-items {
                display: flex;
                gap: 8px;
                font-size: 9px;
                color: var(--text-primary, #fff);
            }
            
            /* Header Indicators */
            .tc6-header-indicators {
                margin-left: auto;
                display: flex;
                gap: 5px;
            }
            
            /* Statusbar Right */
            .tc6-statusbar-right {
                margin-left: auto;
            }
            
            /* Code Content */
            .tc6-code-content {
                position: relative;
                z-index: 1;
                padding: 12px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 11px;
                line-height: 1.7;
            }
            
            /* Code Line */
            .tc6-code-line {
                display: block;
            }
            
            /* Main Area Layout */
            .tc6-main-area {
                display: flex;
                flex: 1;
                overflow: hidden;
                padding: 8px;
                gap: 8px;
            }
            
            /* Editor Column */
            .tc6-editor-column {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            
            /* Sidebar */
            .tc6-sidebar {
                width: 140px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
        `;
        document.head.appendChild(style);
    },

    /**
     * Render controls panel content with simplified color groups
     */
    _renderControls() {
        const container = this.popup?.querySelector('#tc6-controls-content');
        if (!container) return;

        const themes = ThemeManager.getThemeList();
        const c = this.workingTheme?.colors || {};
        const syn = this._getSyntaxColors();

        container.innerHTML = `
            <!-- UI Colors Panel - Simplified Groups -->
            <div class="tc6-category-panel active" data-panel="ui">
                <div class="tc6-section">
                    <div class="tc6-section-title">Theme Info</div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Name</label>
                        <input type="text" class="tc6-input" id="tc6-name" value="${this._escape(this.workingTheme?.name || '')}" placeholder="My Theme">
                    </div>
                </div>

                <div class="tc6-section">
                    <div class="tc6-section-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/></svg>
                        Panel Variants
                    </div>
                    <p style="font-size: 11px; color: var(--text-muted); margin: 0 0 12px;">Tune Input / Expected panels separately</p>
                    <div class="tc6-color-grid">
                        ${this._renderColorItem('bgPanel-input', 'Input Panel')}
                        ${this._renderColorItem('bgPanel-expected', 'Expected Panel')}
                    </div>
                </div>
                
                <div class="tc6-section">
                    <div class="tc6-section-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
                        Editor & Terminal
                    </div>
                    <div class="tc6-color-grid">
                        ${this._renderColorItem('editorBg', 'Editor Background')}
                        ${this._renderColorItem('terminalBg', 'Terminal Background')}
                    </div>
                </div>
                
                <div class="tc6-divider" style="opacity: 0.5; pointer-events: none; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px;">
                    <div class="tc6-section-title" style="color: var(--text-muted);">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                        Color Groups <span style="font-size: 10px; background: var(--bg-panel); padding: 2px 6px; border-radius: 4px; margin-left: 8px;">Coming Soon</span>
                    </div>
                </div>
                
                <div class="tc6-divider" style="opacity: 0.5; pointer-events: none; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px;">
                    <div class="tc6-section-title" style="color: var(--text-muted);">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                        Status Colors <span style="font-size: 10px; background: var(--bg-panel); padding: 2px 6px; border-radius: 4px; margin-left: 8px;">Coming Soon</span>
                    </div>
                </div>
            </div>
            
            <!-- Syntax Colors Panel -->
            <div class="tc6-category-panel" data-panel="syntax">
                <div class="tc6-section">
                    <div class="tc6-section-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                        Syntax Highlighting
                    </div>
                    <div class="tc6-color-grid">
                        ${this._renderColorItem('syntaxKeyword', 'Keywords')}
                        ${this._renderColorItem('syntaxString', 'Strings')}
                        ${this._renderColorItem('syntaxFunction', 'Functions')}
                        ${this._renderColorItem('syntaxType', 'Types')}
                        ${this._renderColorItem('syntaxNumber', 'Numbers')}
                        ${this._renderColorItem('syntaxComment', 'Comments')}
                        ${this._renderColorItem('syntaxVariable', 'Variables')}
                        ${this._renderColorItem('syntaxOperator', 'Operators')}
                        ${this._renderColorItem('syntaxBracket', 'Brackets')}
                    </div>
                </div>
            </div>
            
            <!-- Backgrounds Panel -->
            <div class="tc6-category-panel" data-panel="backgrounds">
                <div class="tc6-section">
                    <div class="tc6-section-title">App Background</div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Image</label>
                        <div class="tc6-upload-row">
                            <input type="text" class="tc6-input" id="tc6-app-bg-url" value="" placeholder="Image URL or upload..." readonly>
                            <button class="tc6-bg-drag-btn" id="tc6-app-bg-drag" data-bg-type="app" title="Drag to reposition background">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3"/>
                                </svg>
                            </button>
                            <button class="tc6-upload-btn" id="tc6-app-bg-btn">Upload</button>
                            <button class="tc6-clear-btn" id="tc6-app-bg-clear">✕</button>
                            <input type="file" id="tc6-app-bg-file" accept="image/*,video/*" style="display:none">
                        </div>
                    </div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Brightness</label>
                        <div class="tc6-slider-row">
                            <input type="range" min="0" max="100" value="${c.bgBrightness ?? 100}" id="tc6-app-brightness">
                            <span class="tc6-slider-val" id="tc6-app-brightness-val">${c.bgBrightness ?? 100}%</span>
                        </div>
                    </div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Blur</label>
                        <div class="tc6-slider-row">
                            <input type="range" min="0" max="20" value="${c.bgBlur ?? 0}" id="tc6-app-blur">
                            <span class="tc6-slider-val" id="tc6-app-blur-val">${c.bgBlur ?? 0}px</span>
                        </div>
                    </div>
                </div>
                
                <div class="tc6-section">
                    <div class="tc6-section-title">Editor Background</div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Image</label>
                        <div class="tc6-upload-row">
                            <input type="text" class="tc6-input" id="tc6-editor-bg-url" value="" placeholder="Image URL or upload..." readonly>
                            <button class="tc6-bg-drag-btn" id="tc6-editor-bg-drag" data-bg-type="editor" title="Drag to reposition background">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3"/>
                                </svg>
                            </button>
                            <button class="tc6-upload-btn" id="tc6-editor-bg-btn">Upload</button>
                            <button class="tc6-clear-btn" id="tc6-editor-bg-clear">✕</button>
                            <input type="file" id="tc6-editor-bg-file" accept="image/*" style="display:none">
                        </div>
                    </div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Brightness</label>
                        <div class="tc6-slider-row">
                            <input type="range" min="0" max="100" value="${c.editorBgBrightness ?? 100}" id="tc6-editor-brightness">
                            <span class="tc6-slider-val" id="tc6-editor-brightness-val">${c.editorBgBrightness ?? 100}%</span>
                        </div>
                    </div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Blur</label>
                        <div class="tc6-slider-row">
                            <input type="range" min="0" max="30" value="${c.editorBgBlur ?? 0}" id="tc6-editor-blur">
                            <span class="tc6-slider-val" id="tc6-editor-blur-val">${c.editorBgBlur ?? 0}px</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- JSON Editor Panel with Monaco -->
            <div class="tc6-category-panel" data-panel="json">
                <div class="tc6-section tc6-json-section">
                    <div class="tc6-section-title">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        Theme JSON Editor
                    </div>
                    <p style="font-size: 11px; color: var(--text-muted); margin: 0 0 10px;">Double-click color values to pick • Ctrl+Enter to apply</p>
                    <div class="tc6-monaco-container" id="tc6-monaco-container"></div>
                    <div class="tc6-json-editor-actions">
                        <span class="tc6-json-status" id="tc6-json-status"></span>
                        <button class="tc6-upload-btn tc6-json-apply-btn" id="tc6-json-apply">Apply Changes</button>
                    </div>
                </div>
            </div>
            
            <!-- Advanced Panel -->
            <div class="tc6-category-panel" data-panel="advanced">
                <div class="tc6-section">
                    <div class="tc6-section-title">Base Theme</div>
                    <div class="tc6-field">
                        <label class="tc6-field-label">Copy from</label>
                        <select class="tc6-input" id="tc6-base-theme" style="padding: 10px 14px;">
                            ${themes.map(t => `<option value="${t.id}" ${t.id === this.sourceThemeId ? 'selected' : ''}>${t.name}</option>`).join('')}
                        </select>
                    </div>
                </div>
                
                <div class="tc6-section">
                    <div class="tc6-section-title">Import / Export</div>
                    <button class="tc6-upload-btn" id="tc6-export-json" style="width: 100%; padding: 12px;">Export as JSON</button>
                    <div class="tc6-field" style="margin-top: 10px;">
                        <button class="tc6-upload-btn" id="tc6-import-json" style="width: 100%; padding: 12px;">Import from JSON</button>
                        <input type="file" id="tc6-import-json-file" accept=".json" style="display:none">
                    </div>
                </div>
            </div>
        `;

        this._bindControlsEvents();
        this._updateBgHints();
    },

    /**
     * Render a color group item (changes multiple colors at once)
     * @param {string} groupId - Group identifier
     * @param {string} label - Display label
     * @param {string} currentColor - Current color value
     * @param {string} icon - Icon type (moon, layers, star, type, square)
     */
    _renderGroupColor(groupId, label, currentColor, icon = '') {
        const icons = {
            moon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
            layers: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
            star: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            type: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
            square: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>'
        };
        const iconSvg = icons[icon] || '';

        return `
            <div class="tc6-color-item tc6-group-color" data-group="${groupId}">
                <span class="tc6-color-label">${iconSvg} ${label}</span>
                <div class="tc6-color-swatch" style="background: ${currentColor}" data-group="${groupId}"></div>
            </div>
        `;
    },

    /**
     * Render a single color item
     */
    _renderColorItem(key, label) {
        const color = this._getColor(key);
        return `
            <div class="tc6-color-item" data-key="${key}">
                <label>${label}</label>
                <div class="tc6-color-swatch" style="background: ${color}"></div>
            </div>
        `;
    },

    /**
     * Update background hints
     */
    _updateBgHints() {
        const appBgUrl = this.popup?.querySelector('#tc6-app-bg-url');
        const editorBgUrl = this.popup?.querySelector('#tc6-editor-bg-url');

        const appBg = this.workingTheme?.colors?.appBackground;
        const editorBg = this.workingTheme?.colors?.editorBackground;

        if (appBgUrl) {
            appBgUrl.value = appBg ? (appBg.startsWith('data:') ? 'Image uploaded' : appBg.substring(0, 40)) : '';
        }
        if (editorBgUrl) {
            editorBgUrl.value = editorBg ? (editorBg.startsWith('data:') ? 'Image uploaded' : editorBg.substring(0, 40)) : '';
        }
    },

    /**
     * Bind all events
     */
    _bindEvents() {
        if (!this.popup) return;

        this.popup.querySelector('#tc6-close')?.addEventListener('click', () => this.close());
        this.popup.querySelector('#tc6-reset')?.addEventListener('click', () => this._reset());
        this.popup.querySelector('#tc6-save')?.addEventListener('click', () => this._saveOverwrite());
        this.popup.querySelector('#tc6-save-new')?.addEventListener('click', () => this._saveAsNew());
        this.popup.querySelector('#tc6-delete')?.addEventListener('click', () => this._deleteTheme());
        this.popup.querySelector('#tc6-save-bg')?.addEventListener('click', () => this._saveBackgroundOnly());

        this.popup.querySelector('#tc6-undo')?.addEventListener('click', () => this._undo());
        this.popup.querySelector('#tc6-redo')?.addEventListener('click', () => this._redo());

        // NOTE: Backdrop click to close removed per user request
        // User found it frustrating when dragging backgrounds
        // this.popup.addEventListener('click', (e) => {
        //     if (e.target === this.popup) this.close();
        // });

        this._escHandler = (e) => {
            if (e.key === 'Escape') {
                if (this.currentColorPicker) {
                    this._hideColorPicker();
                } else {
                    this.close();
                }
            }
            // Undo/Redo keyboard shortcuts
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this._undo();
            }
            if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                this._redo();
            }
        };
        document.addEventListener('keydown', this._escHandler);

        this.popup.querySelectorAll('.tc6-toolbar-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const category = btn.dataset.category;
                this._switchToCategory(category);
            });
        });

        const toggleBtn = this.popup.querySelector('#tc6-controls-toggle');
        const controlsPanel = this.popup.querySelector('#tc6-controls');
        if (toggleBtn && controlsPanel) {
            toggleBtn.addEventListener('click', () => {
                controlsPanel.classList.toggle('collapsed');
            });
        }
    },

    /**
     * Switch to a category
     */
    _switchToCategory(category) {
        this.popup.querySelectorAll('.tc6-toolbar-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });

        this.popup.querySelectorAll('.tc6-category-panel').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.panel === category);
        });

        if (category === 'json') {
            setTimeout(() => {
                if (!this.jsonMonacoEditor) {
                    this._bindJsonEditor();
                } else {
                    const themeForEdit = this._prepareThemeForJsonEdit();
                    const newContent = JSON.stringify(themeForEdit, null, 2);
                    const currentContent = this.jsonMonacoEditor.getValue();

                    try {
                        const currentParsed = JSON.parse(currentContent);
                        const newParsed = JSON.parse(newContent);
                        if (JSON.stringify(currentParsed) !== JSON.stringify(newParsed)) {
                            this.jsonMonacoEditor.setValue(newContent);
                        }
                    } catch (e) {
                    }

                    this.jsonMonacoEditor.layout();
                }
            }, 50);
        }
    },

    /**
     * Bind controls panel events
     */
    _bindControlsEvents() {
        const container = this.popup?.querySelector('#tc6-controls-content');
        if (!container) return;

        container.querySelectorAll('.tc6-color-item:not(.tc6-group-color)').forEach(item => {
            item.addEventListener('click', () => {
                const key = item.dataset.key;
                const label = item.querySelector('label')?.textContent || key;
                this._updateEditBar(key, label);
            });
        });

        container.querySelector('#tc6-name')?.addEventListener('input', (e) => {
            this.workingTheme.name = e.target.value;
        });

        container.querySelector('#tc6-base-theme')?.addEventListener('change', (e) => {
            const newId = e.target.value;
            if (ThemeManager.themes.has(newId)) {
                const currentName = this.workingTheme?.name;
                const preservedEditorBg = this.workingTheme?.colors?.editorBackground;
                const preservedEditorBgOpacity = this.workingTheme?.colors?.editorBgOpacity;
                const preservedEditorBgBlur = this.workingTheme?.colors?.editorBgBlur;
                const preservedEditorBgPosition = this.workingTheme?.colors?.editorBgPosition;

                this.sourceThemeId = newId;
                this.workingTheme = this._deepClone(ThemeManager.themes.get(newId));
                if (currentName && currentName !== this.workingTheme.name) {
                    this.workingTheme.name = currentName;
                }

                if (preservedEditorBg) {
                    if (!this.workingTheme.colors) this.workingTheme.colors = {};
                    this.workingTheme.colors.editorBackground = preservedEditorBg;
                    if (preservedEditorBgOpacity !== undefined) this.workingTheme.colors.editorBgOpacity = preservedEditorBgOpacity;
                    if (preservedEditorBgBlur !== undefined) this.workingTheme.colors.editorBgBlur = preservedEditorBgBlur;
                    if (preservedEditorBgPosition) this.workingTheme.colors.editorBgPosition = preservedEditorBgPosition;
                }

                this._renderControls();
                this._renderPreview();
            }
        });

        const appBgBtn = container.querySelector('#tc6-app-bg-btn');
        const appBgFile = container.querySelector('#tc6-app-bg-file');
        const appBgClear = container.querySelector('#tc6-app-bg-clear');

        appBgBtn?.addEventListener('click', () => appBgFile?.click());
        appBgFile?.addEventListener('change', (e) => {
            this._handleFileUpload(e, 'appBackground');
        });
        appBgClear?.addEventListener('click', () => {
            delete this.workingTheme.colors.appBackground;
            this._updateBgHints();
            this._renderPreview();
        });
        const appBgDrag = container.querySelector('#tc6-app-bg-drag');
        appBgDrag?.addEventListener('click', () => {
            if (!this.workingTheme?.colors?.appBackground) {
                this._notify('Please upload an app background first!', 'warning');
                return;
            }
            this.bgDragMode = true;
            this._bgDragTarget = 'app';
            this._updateDragModeHint();

            const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
            if (wrapper) wrapper.style.cursor = 'grab';
            const ide = this.popup?.querySelector('.tc6-ide');
            const content = this.popup?.querySelector('.tc6-ide-content');
            if (ide) ide.classList.add('tc6-drag-mode');
            if (content) content.classList.add('tc6-dimmed');
        });

        const editorBgBtn = container.querySelector('#tc6-editor-bg-btn');
        const editorBgFile = container.querySelector('#tc6-editor-bg-file');
        const editorBgClear = container.querySelector('#tc6-editor-bg-clear');

        editorBgBtn?.addEventListener('click', () => editorBgFile?.click());
        editorBgFile?.addEventListener('change', (e) => {
            this._handleFileUpload(e, 'editorBackground');
        });
        editorBgClear?.addEventListener('click', () => {
            delete this.workingTheme.colors.editorBackground;
            this._updateBgHints();
            this._renderPreview();
        });
        const editorBgDrag = container.querySelector('#tc6-editor-bg-drag');
        editorBgDrag?.addEventListener('click', () => {
            if (!this.workingTheme?.colors?.editorBackground) {
                this._notify('Please upload an editor background first!', 'warning');
                return;
            }
            this.bgDragMode = true;
            this._bgDragTarget = 'editor';
            this._updateDragModeHint();

            const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
            if (wrapper) wrapper.style.cursor = 'grab';
            const ide = this.popup?.querySelector('.tc6-ide');
            const content = this.popup?.querySelector('.tc6-ide-content');
            if (ide) ide.classList.add('tc6-drag-mode');
            if (content) content.classList.add('tc6-dimmed');
        });

        this._bindSlider('#tc6-app-brightness', 'bgBrightness', '%', '#tc6-app-brightness-val');
        this._bindSlider('#tc6-app-blur', 'bgBlur', 'px', '#tc6-app-blur-val');
        this._bindSlider('#tc6-editor-brightness', 'editorBgBrightness', '%', '#tc6-editor-brightness-val');
        this._bindSlider('#tc6-editor-blur', 'editorBgBlur', 'px', '#tc6-editor-blur-val');

        container.querySelectorAll('.tc6-group-color').forEach(item => {
            const swatch = item.querySelector('.tc6-color-swatch');
            const groupId = item.dataset.group;

            const openPicker = () => {
                const group = window.ColorRegistry?.getGroup(groupId);
                if (!group) {
                    console.warn('[Customizer] No group found:', groupId);
                    return;
                }
                this._showGroupColorPicker(groupId, group.label, swatch);
            };

            item.addEventListener('click', openPicker);
        });
    },

    /**
     * Bind JSON Editor events and initialize Monaco Editor
     */
    _bindJsonEditor() {
        const container = this.popup?.querySelector('#tc6-monaco-container');
        const applyBtn = this.popup?.querySelector('#tc6-json-apply');
        const statusEl = this.popup?.querySelector('#tc6-json-status');

        if (!container) return;

        if (this.jsonMonacoEditor) {
            this.jsonMonacoEditor.dispose();
            this.jsonMonacoEditor = null;
        }

        const themeForEdit = this._prepareThemeForJsonEdit();
        const jsonContent = JSON.stringify(themeForEdit, null, 2);

        try {
            this.jsonMonacoEditor = monaco.editor.create(container, {
                value: jsonContent,
                language: 'json',
                theme: 'vs-dark',
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'off',
                glyphMargin: false,
                folding: true,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 0,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
                emptySelectionClipboard: false,
                formatOnPaste: true,
                formatOnType: true,
                renderLineHighlight: 'none',
                colorDecorators: true,
                scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8
                },
                padding: { top: 12, bottom: 12 }
            });

            let debounceTimer = null;
            this.jsonMonacoEditor.onDidChangeModelContent(() => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this._validateJsonEditor();
                }, 300);
            });

            this.jsonMonacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                this._applyJsonEditorChanges();
            });

            this._updateMonacoColorDecorations();
            this.jsonMonacoEditor.onDidChangeModelContent(() => {
                clearTimeout(this._colorDecoTimer);
                this._colorDecoTimer = setTimeout(() => {
                    this._updateMonacoColorDecorations();
                }, 100);
            });

            this._setupMonacoColorPicker();

            setTimeout(() => this._validateJsonEditor(), 100);

        } catch (err) {
            console.error('[Customizer] Failed to create Monaco editor:', err);
            container.innerHTML = '<div style="padding: 20px; color: var(--text-muted);">Monaco Editor not available</div>';
        }

        applyBtn?.addEventListener('click', () => {
            this._applyJsonEditorChanges();
        });
    },

    /**
     * Add color square decorations to JSON editor
     */
    _updateMonacoColorDecorations() {
        if (!this.jsonMonacoEditor) return;

        const model = this.jsonMonacoEditor.getModel();
        if (!model) return;

        const content = model.getValue();
        const decorations = [];

        const colorRegex = /"(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\))"/g;
        let match;

        while ((match = colorRegex.exec(content)) !== null) {
            const colorValue = match[1];
            const startPos = model.getPositionAt(match.index + 1); // +1 to skip opening quote
            const endPos = model.getPositionAt(match.index + match[0].length - 1); // -1 to skip closing quote

            decorations.push({
                range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
                options: {
                    before: {
                        content: '■',
                        inlineClassName: `tc6-color-deco-${colorValue.replace(/[^a-zA-Z0-9]/g, '')}`,
                        inlineClassNameAffectsLetterSpacing: true
                    },
                    hoverMessage: { value: `Click to pick color: ${colorValue}` }
                }
            });
        }

        this._colorDecorations = this.jsonMonacoEditor.deltaDecorations(
            this._colorDecorations || [],
            decorations
        );

        this._injectColorDecoStyles(content);
    },

    /**
     * Inject dynamic styles for color decorations
     */
    _injectColorDecoStyles(content) {
        let styleEl = document.getElementById('tc6-color-deco-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'tc6-color-deco-styles';
            document.head.appendChild(styleEl);
        }

        const colorRegex = /"(#[0-9a-fA-F]{3,8}|rgba?\s*\([^)]+\))"/g;
        let match;
        let css = '';

        while ((match = colorRegex.exec(content)) !== null) {
            const colorValue = match[1];
            const className = colorValue.replace(/[^a-zA-Z0-9]/g, '');
            css += `.tc6-color-deco-${className} { 
                color: ${colorValue} !important; 
                margin-right: 4px;
                font-size: 14px;
                text-shadow: 0 0 1px rgba(0,0,0,0.5);
            }\n`;
        }

        styleEl.textContent = css;
    },

    /**
     * Setup color picker on click for Monaco JSON editor
     */
    _setupMonacoColorPicker() {
        if (!this.jsonMonacoEditor) return;

        let colorInput = document.getElementById('tc6-monaco-color-picker');
        if (!colorInput) {
            colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.id = 'tc6-monaco-color-picker';
            colorInput.style.cssText = 'position: absolute; visibility: hidden; pointer-events: none;';
            document.body.appendChild(colorInput);
        }

        let editRange = null;

        this.jsonMonacoEditor.onMouseDown((e) => {
            if (e.event.detail !== 2) return; // Only double-click

            const model = this.jsonMonacoEditor.getModel();
            if (!model) return;

            const position = e.target.position;
            if (!position) return;

            const lineContent = model.getLineContent(position.lineNumber);

            const colorRegex = /"(#[0-9a-fA-F]{3,8})"/g;
            let match;

            while ((match = colorRegex.exec(lineContent)) !== null) {
                const startCol = match.index + 2; // Skip opening quote and first char
                const endCol = match.index + match[0].length - 1;

                if (position.column >= startCol && position.column <= endCol) {
                    const colorValue = match[1];

                    editRange = new monaco.Range(
                        position.lineNumber,
                        match.index + 2,
                        position.lineNumber,
                        match.index + match[0].length - 1
                    );
                    colorInput.value = colorValue.length === 4
                        ? `#${colorValue[1]}${colorValue[1]}${colorValue[2]}${colorValue[2]}${colorValue[3]}${colorValue[3]}`
                        : colorValue.substring(0, 7);
                    colorInput.click();
                    break;
                }
            }
        });

        colorInput.addEventListener('input', (e) => {
            if (!editRange || !this.jsonMonacoEditor) return;

            const newColor = e.target.value;
            this.jsonMonacoEditor.executeEdits('color-picker', [{
                range: editRange,
                text: newColor
            }]);
        });
    },

    /**
     * Prepare theme object for JSON editing (strip large base64 images)
     */
    _prepareThemeForJsonEdit() {
        const theme = this._deepClone(this.workingTheme);

        if (theme.colors?.appBackground?.startsWith('data:')) {
            theme.colors.appBackground = '[BASE64_IMAGE_DATA]';
        }
        if (theme.colors?.editorBackground?.startsWith('data:')) {
            theme.colors.editorBackground = '[BASE64_IMAGE_DATA]';
        }

        return theme;
    },

    /**
     * Validate JSON in Monaco editor
     */
    _validateJsonEditor() {
        const applyBtn = this.popup?.querySelector('#tc6-json-apply');
        const statusEl = this.popup?.querySelector('#tc6-json-status');

        if (!this.jsonMonacoEditor || !statusEl) return false;

        const content = this.jsonMonacoEditor.getValue();

        try {
            const parsed = JSON.parse(content);

            if (!parsed.name || typeof parsed.name !== 'string') {
                throw new Error('Theme must have a valid name');
            }
            if (!parsed.colors || typeof parsed.colors !== 'object') {
                throw new Error('Theme must have colors object');
            }

            statusEl.textContent = '✔ Valid JSON';
            statusEl.className = 'tc6-json-status tc6-json-valid';
            if (applyBtn) applyBtn.disabled = false;
            return true;
        } catch (err) {
            statusEl.textContent = `✘ ${err.message}`;
            statusEl.className = 'tc6-json-status tc6-json-invalid';
            if (applyBtn) applyBtn.disabled = true;
            return false;
        }
    },

    /**
     * Apply changes from Monaco JSON editor to working theme
     */
    _applyJsonEditorChanges() {
        const statusEl = this.popup?.querySelector('#tc6-json-status');

        if (!this.jsonMonacoEditor) return;

        const content = this.jsonMonacoEditor.getValue();

        try {
            const parsed = JSON.parse(content);

            const currentAppBg = this.workingTheme?.colors?.appBackground;
            const currentEditorBg = this.workingTheme?.colors?.editorBackground;

            this.workingTheme = this._deepClone(parsed);

            if (parsed.colors?.appBackground === '[BASE64_IMAGE_DATA]' && currentAppBg?.startsWith('data:')) {
                this.workingTheme.colors.appBackground = currentAppBg;
            }
            if (parsed.colors?.editorBackground === '[BASE64_IMAGE_DATA]' && currentEditorBg?.startsWith('data:')) {
                this.workingTheme.colors.editorBackground = currentEditorBg;
            }

            // Re-define and re-apply the Monaco theme so the real editor's syntax
            // colors reflect the edited JSON immediately. Previously this only
            // happened on Save, so the editor looked "stuck" on the old colors. (#43)
            try {
                if (typeof ThemeManager !== 'undefined' && typeof monaco !== 'undefined' && this.sourceThemeId) {
                    const normalized = ThemeManager._normalizeTheme({
                        id: this.sourceThemeId,
                        name: this.workingTheme.name,
                        type: this.workingTheme.type,
                        colors: this.workingTheme.colors,
                        editor: this.workingTheme.editor,
                        terminal: this.workingTheme.terminal
                    });
                    ThemeManager._defineMonacoTheme(normalized);
                    if (ThemeManager.activeThemeId === this.sourceThemeId) {
                        monaco.editor.setTheme(this.sourceThemeId);
                    }
                }
            } catch (e) {
                console.warn('[Customizer] Live Monaco re-theme failed:', e);
            }

            this._renderControlsWithoutJson();
            // clearStale: drop CSS variables for keys the user removed/renamed in the
            // JSON so they fall back to stylesheet defaults instead of staying stuck. (#43)
            this._renderPreview({ clearStale: true });

            if (statusEl) {
                statusEl.textContent = '✔ Applied successfully!';
                statusEl.className = 'tc6-json-status tc6-json-valid';
            }

            console.log('[Customizer] JSON changes applied');
        } catch (err) {
            console.error('[Customizer] Failed to apply JSON:', err);
            if (statusEl) {
                statusEl.textContent = `✘ ${err.message}`;
                statusEl.className = 'tc6-json-status tc6-json-invalid';
            }
        }
    },

    /**
     * Re-render controls without affecting JSON editor
     */
    _renderControlsWithoutJson() {
        const activePanel = this.popup?.querySelector('.tc6-category-panel.active')?.dataset.panel;

        this._renderControls();

        if (activePanel === 'json') {
            const jsonPanel = this.popup?.querySelector('[data-panel="json"]');
            const allPanels = this.popup?.querySelectorAll('.tc6-category-panel');
            allPanels?.forEach(p => p.classList.remove('active'));
            jsonPanel?.classList.add('active');

            const allTabs = this.popup?.querySelectorAll('.tc6-toolbar-btn');
            allTabs?.forEach(t => t.classList.remove('active'));
            this.popup?.querySelector('[data-category="json"]')?.classList.add('active');
        }
    },

    /**
     * Show color picker for a color group
     * When color changes, derives and applies all member colors
     */
    _showGroupColorPicker(groupId, label, targetEl) {
        this._hideColorPicker();

        const c = this.workingTheme?.colors || {};
        let currentColor = '#888888';

        switch (groupId) {
            case 'background':
                currentColor = c.editorBg || c.bgOceanDark || '#1a2530';
                break;
            case 'surface':
                currentColor = c.bgPanel?.replace(/rgba?\([^)]+\)/, '') || '#2a3a4a';
                if (currentColor.includes('rgba')) {
                    currentColor = '#2a3a4a';
                }
                break;
            case 'accent':
                currentColor = c.accent || '#88c9ea';
                break;
            case 'text':
                currentColor = c.textPrimary || '#e0f0ff';
                break;
            case 'border':
                currentColor = c.border || '#3a6075';
                break;
            case 'status':
                currentColor = c.success || '#10b981';
                break;
            case 'syntax':
                currentColor = c.syntaxKeyword || '#88c9ea';
                break;
        }

        const picker = document.createElement('div');
        picker.className = 'tc6-color-picker';
        picker.id = 'tc6-active-picker';
        picker.innerHTML = `
            <div class="tc6-picker-header">
                <span class="tc6-picker-title">${label}</span>
                <button class="tc6-picker-close">✕</button>
            </div>
            <div class="tc6-picker-content">
                <div class="tc6-picker-row">
                    <div class="tc6-color-swatch" style="background: ${currentColor}; width: 40px; height: 40px;"></div>
                    <input type="color" value="${currentColor}" style="width: 60px; height: 40px; border: none; cursor: pointer;">
                    <input type="text" id="tc6-hex-input" value="${currentColor.toUpperCase()}" maxlength="7" 
                        style="width: 80px; padding: 8px; font-family: monospace; text-transform: uppercase;">
                </div>
                <p style="font-size: 10px; color: var(--text-muted); margin: 8px 0 0;">
                    Changes ${window.ColorRegistry?.getGroupMembers?.(groupId)?.length || 'multiple'} colors at once
                </p>
            </div>
        `;

        const rect = targetEl.getBoundingClientRect();
        const popupRect = this.popup?.getBoundingClientRect() || { left: 0, top: 0 };
        picker.style.position = 'absolute';
        picker.style.left = `${rect.left - popupRect.left}px`;
        picker.style.top = `${rect.bottom - popupRect.top + 5}px`;
        picker.style.zIndex = '10001';

        this.popup?.appendChild(picker);
        this.currentColorPicker = picker;
        requestAnimationFrame(() => picker.classList.add('visible'));

        const colorInput = picker.querySelector('input[type="color"]');
        const hexInput = picker.querySelector('#tc6-hex-input');
        const swatch = picker.querySelector('.tc6-color-swatch');
        const closeBtn = picker.querySelector('.tc6-picker-close');

        const updateGroupColor = (newColor) => {
            swatch.style.background = newColor;
            hexInput.value = newColor.toUpperCase();
            targetEl.style.background = newColor;

            const derivedColors = window.ColorRegistry?.deriveGroupColors?.(groupId, newColor) || {};

            for (const [key, value] of Object.entries(derivedColors)) {
                this._setColor(key, value);
            }

            this._renderPreview();
        };

        // input = live drag → fast path: update CSS vars only, no DOM rebuild
        colorInput.addEventListener('input', (e) => {
            const newColor = e.target.value;
            swatch.style.background = newColor;
            hexInput.value = newColor.toUpperCase();
            targetEl.style.background = newColor;
            const derivedColors = window.ColorRegistry?.deriveGroupColors?.(groupId, newColor) || {};
            for (const [key, value] of Object.entries(derivedColors)) {
                this._setColor(key, value);
            }
            this._injectAllPreviewVariables();
        });
        // change = mouse-up → full render for final state
        colorInput.addEventListener('change', (e) => updateGroupColor(e.target.value));

        hexInput.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^0-9A-Fa-f#]/g, '');
            if (val.length === 7 && val.startsWith('#')) {
                colorInput.value = val;
                updateGroupColor(val);
            } else if (val.length === 6 && !val.startsWith('#')) {
                const color = '#' + val;
                colorInput.value = color;
                updateGroupColor(color);
            }
        });

        closeBtn.addEventListener('click', () => this._hideColorPicker());
    },

    /**
     * Bind slider
     */
    _bindSlider(inputSel, key, suffix, valSel) {
        const input = this.popup?.querySelector(inputSel);
        const valEl = this.popup?.querySelector(valSel);

        input?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (valEl) valEl.textContent = val + suffix;
            if (!this.workingTheme.colors) this.workingTheme.colors = {};
            this.workingTheme.colors[key] = val;

            // _updateBgStyles handles filter/opacity/blur updates for both image and video elements
            this._updateBgStyles();
        });
    },

    /**
     * Handle file upload
     */
    async _handleFileUpload(e, key) {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type === 'image/gif') {
            const confirmed = await this._confirm(
                'Using GIF backgrounds may cause the app to run slowly and consume more memory (RAM).\n\nYou should use video format for the smoothest experience. Do you still want to continue with this file?',
                'Use GIF background?',
                'Use GIF',
                true
            );
            if (!confirmed) {
                e.target.value = '';
                return;
            }
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            if (!this.workingTheme.colors) this.workingTheme.colors = {};

            if (key === 'appBackground') {
                const oldBg = this.popup?.querySelector('.tc6-ide-bg');
                if (oldBg) oldBg.remove();
            } else if (key === 'editorBackground') {
                const oldEditorBg = this.popup?.querySelector('.tc6-editor-bg');
                if (oldEditorBg) oldEditorBg.remove();
            }

            this.workingTheme.colors[key] = ev.target.result;
            this._updateBgHints();

            this._renderPreview();

            requestAnimationFrame(() => {
                this._updateBgStyles();
            });

            this._setupBgDrag();

            e.target.value = '';
        };
        reader.readAsDataURL(file);
    },


    /**
     * Setup background drag
     */
    _setupBgDrag() {
        const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
        if (!wrapper) return;

        if (wrapper._dragHandlers) {
            this._cleanupBgDrag();
        }

        let isDragging = false;
        let startX = 0, startY = 0;
        let startPosX = 50, startPosY = 50;
        let rafId = null;

        const dblClickHandler = (e) => {
            const editorBg = wrapper.querySelector('.tc6-editor-bg');
            const appBg = wrapper.querySelector('.tc6-ide-bg');
            const clickedEditor = editorBg && e.target.closest('.tc6-editor-wrapper');

            if (this.bgDragMode) {
                this._exitDragMode();
                return;
            }

            if (clickedEditor && this.workingTheme?.colors?.editorBackground) {
                this.bgDragMode = true;
                this._bgDragTarget = 'editor';
            } else if (appBg && this.workingTheme?.colors?.appBackground) {
                this.bgDragMode = true;
                this._bgDragTarget = 'app';
            } else {
                return;
            }

            wrapper.style.cursor = this.bgDragMode ? 'grab' : 'default';

            const ide = wrapper.querySelector('.tc6-ide');
            const content = wrapper.querySelector('.tc6-ide-content');
            if (ide) ide.classList.toggle('tc6-drag-mode', this.bgDragMode);
            if (content) content.classList.toggle('tc6-dimmed', this.bgDragMode);

            this._updateDragModeHint();
        };

        const mouseDownHandler = (e) => {
            if (!this.bgDragMode) return;

            const isEditor = this._bgDragTarget === 'editor';

            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const posKey = isEditor ? 'editorBgPosition' : 'bgPosition';
            const pos = this.workingTheme.colors[posKey] || 'center center';
            const [h, v] = pos.split(' ').map(p => {
                if (p === 'center') return 50;
                if (p === 'left' || p === 'top') return 0;
                if (p === 'right' || p === 'bottom') return 100;
                return parseInt(p) || 50;
            });
            startPosX = h;
            startPosY = v || 50;

            wrapper.style.cursor = 'grabbing';
        };

        const mouseMoveHandler = (e) => {
            if (!isDragging) return;

            // Cancel any pending animation frame
            if (rafId) cancelAnimationFrame(rafId);

            rafId = requestAnimationFrame(() => {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const rect = wrapper.getBoundingClientRect();

                const newX = Math.max(0, Math.min(100, startPosX - (dx / rect.width) * 100));
                const newY = Math.max(0, Math.min(100, startPosY - (dy / rect.height) * 100));

                const isEditor = this._bgDragTarget === 'editor';
                const posKey = isEditor ? 'editorBgPosition' : 'bgPosition';
                this.workingTheme.colors[posKey] = `${Math.round(newX)}% ${Math.round(newY)}%`;

                const bgEl = isEditor
                    ? this.popup?.querySelector('.tc6-editor-bg')
                    : this.popup?.querySelector('.tc6-ide-bg');
                if (bgEl) {
                    const video = bgEl.querySelector('video');
                    if (video) {
                        video.style.objectPosition = this.workingTheme.colors[posKey];
                    } else {
                        bgEl.style.backgroundPosition = this.workingTheme.colors[posKey];
                    }
                }
            });
        };

        const mouseUpHandler = () => {
            if (isDragging) {
                isDragging = false;
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                if (wrapper) wrapper.style.cursor = this.bgDragMode ? 'grab' : 'default';
            }
        };

        wrapper._dragHandlers = {
            dblclick: dblClickHandler,
            mousedown: mouseDownHandler,
            mousemove: mouseMoveHandler,
            mouseup: mouseUpHandler,
            rafId: () => rafId
        };

        wrapper.addEventListener('dblclick', dblClickHandler);
        wrapper.addEventListener('mousedown', mouseDownHandler);
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    },

    /**
     * Cleanup drag handlers
     */
    _cleanupBgDrag() {
        const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
        if (!wrapper) return;

        if (!wrapper._dragHandlers) return;

        const handlers = wrapper._dragHandlers;
        wrapper.removeEventListener('dblclick', handlers.dblclick);
        wrapper.removeEventListener('mousedown', handlers.mousedown);
        document.removeEventListener('mousemove', handlers.mousemove);
        document.removeEventListener('mouseup', handlers.mouseup);

        // Cancel any pending RAF
        const rafId = handlers.rafId?.();
        if (rafId) cancelAnimationFrame(rafId);

        wrapper._dragHandlers = null;
    },

    /**
     * Update drag mode hint
     */
    _updateDragModeHint() {
        const editBar = this.popup?.querySelector('#tc6-edit-bar');
        if (!editBar) return;

        if (this.bgDragMode) {
            const isEditor = this._bgDragTarget === 'editor';

            editBar.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 4px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent, #88c9ea)" stroke-width="2.5">
                            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
                        </svg>
                        <span style="font-weight: 700; color: var(--text-secondary, #7eb8c5); font-size: 13px; font-family: 'Fredoka', sans-serif;">Drag Mode Active</span>
                        <span style="color: var(--text-muted, #8abac5); font-size: 12px;">Drag to reposition ${isEditor ? 'editor' : 'app'} background</span>
                    </div>
                    <button class="tc6-drag-confirm-btn" id="tc6-drag-confirm">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                            <polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="3" fill="none"/>
                        </svg>
                        Done
                    </button>
                </div>
            `;

            editBar.style.background = 'var(--bg-header, rgba(245, 250, 255, 0.95))';
            editBar.style.border = '2px solid var(--accent, #88c9ea)';
            editBar.style.boxShadow = '0 2px 8px rgba(136, 201, 234, 0.2)';

            const confirmBtn = editBar.querySelector('#tc6-drag-confirm');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => {
                    this._exitDragMode();
                });
            }
        } else {
            editBar.innerHTML = `
                <!-- Undo/Redo - Always visible -->
                <div class="tc6-edit-actions">
                    <button class="tc6-edit-action" id="tc6-undo" disabled title="Undo (Ctrl+Z)">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                        </svg>
                    </button>
                    <button class="tc6-edit-action" id="tc6-redo" disabled title="Redo (Ctrl+Y)">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
                        </svg>
                    </button>
                </div>
                
                <!-- Divider -->
                <div class="tc6-edit-divider"></div>
                
                <!-- Idle hint -->
                <span class="tc6-edit-hint" id="tc6-edit-hint">Click any element to edit • Double-click background to drag</span>
                
                <!-- Active element info (hidden initially) -->
                <div class="tc6-edit-element" id="tc6-edit-element" style="display: none;">
                    <div class="tc6-edit-element-info">
                        <span class="tc6-edit-element-name" id="tc6-edit-name">Element Name</span>
                        <div class="tc6-edit-color-preview" id="tc6-edit-color"></div>
                    </div>
                    
                    <div class="tc6-edit-properties" id="tc6-edit-properties"></div>
                    
                    <button class="tc6-edit-close" id="tc6-edit-close" title="Deselect">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            `;

            editBar.style.background = '';
            editBar.style.border = '';
            editBar.style.boxShadow = '';

            this.popup.querySelector('#tc6-undo')?.addEventListener('click', () => this._undo());
            this.popup.querySelector('#tc6-redo')?.addEventListener('click', () => this._redo());
            this._updateHistoryButtons();
        }
    },

    /**
     * Exit drag mode
     */
    _exitDragMode() {
        this.bgDragMode = false;
        const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
        if (wrapper) {
            wrapper.style.cursor = 'default';
        }

        const ide = this.popup?.querySelector('.tc6-ide');
        const content = this.popup?.querySelector('.tc6-ide-content');
        if (ide) ide.classList.remove('tc6-drag-mode');
        if (content) content.classList.remove('tc6-dimmed');

        this._updateDragModeHint();
    },

    /**
     * Lightweight update for background styles only
     */
    _updateBgStyles() {
        const bgEl = this.popup?.querySelector('.tc6-ide-bg');
        const editorBgEl = this.popup?.querySelector('.tc6-editor-bg');

        const c = this.workingTheme?.colors || {};

        if (bgEl && c.appBackground) {
            const isVideo = c.appBackground.endsWith('.webm') || c.appBackground.endsWith('.mp4') || c.appBackground.startsWith('data:video/');
            const appBlur = c.bgBlur ?? 0;
            const appBrightness = (c.bgBrightness ?? 100) / 100;
            const appFilters = [];
            if (appBlur > 0) appFilters.push(`blur(${appBlur}px)`);
            if (appBrightness !== 1) appFilters.push(`brightness(${appBrightness})`);
            const filterStr = appFilters.length ? appFilters.join(' ') : 'none';

            if (isVideo) {
                const video = bgEl.querySelector('video');
                if (video) {
                    video.style.objectPosition = c.bgPosition || 'center center';
                    video.style.filter = filterStr; // Apply filter directly to video
                }
            } else {
                const bgUrl = c.appBackground.startsWith('data:')
                    ? `url("${c.appBackground}")`
                    : `url('${c.appBackground.replace(/'/g, "\\'")}')`;
                bgEl.style.backgroundImage = bgUrl;
                bgEl.style.backgroundPosition = c.bgPosition || 'center center';
                bgEl.style.filter = filterStr;
            }

            bgEl.style.opacity = (c.bgOpacity ?? 50) / 100;
        }

        if (editorBgEl && c.editorBackground) {
            const isVideo = c.editorBackground.endsWith('.webm') || c.editorBackground.endsWith('.mp4') || c.editorBackground.startsWith('data:video/');
            const blur = c.editorBgBlur ?? 0;
            const editorBrightness = (c.editorBgBrightness ?? 100) / 100;
            const editorFilters = [];
            if (blur > 0) editorFilters.push(`blur(${blur}px)`);
            if (editorBrightness !== 1) editorFilters.push(`brightness(${editorBrightness})`);
            const filterStr = editorFilters.length ? editorFilters.join(' ') : 'none';

            if (isVideo) {
                const video = editorBgEl.querySelector('video');
                if (video) {
                    video.style.objectPosition = c.editorBgPosition || 'center center';
                    video.style.filter = filterStr; // Apply filter directly to video
                }
            } else {
                const bgUrl = c.editorBackground.startsWith('data:')
                    ? `url("${c.editorBackground}")`
                    : `url('${c.editorBackground.replace(/'/g, "\\'")}')`;
                editorBgEl.style.backgroundImage = bgUrl;
                editorBgEl.style.backgroundPosition = c.editorBgPosition || 'center center';
                editorBgEl.style.filter = filterStr;
            }

            editorBgEl.style.opacity = (c.editorBgOpacity ?? 15) / 100;
            // Extend inset to prevent blur edge artifacts
            editorBgEl.style.inset = blur > 0 ? `-${blur}px` : '0';
        }
    },

    /**
     * Schedule a preview render, coalescing multiple calls into one RAF frame.
     * Safe to call many times — only one render will execute per animation frame.
     */
    _scheduleRender() {
        if (this._renderTimeout) return; // already queued, skip
        this._renderTimeout = requestAnimationFrame(() => {
            this._renderTimeout = null;
            if (this.popup) {
                this._renderPreview();
            }
        });
    },

    /**
     * Render live preview
     */
    _renderPreview(options = {}) {
        const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
        if (!wrapper) return;

        const c = this.workingTheme?.colors || {};
        const syn = this._getSyntaxColors();

        const appBg = c.appBackground || '';
        const editorBg = c.editorBackground || '';
        const bgOpacity = (c.bgOpacity ?? 50) / 100;
        const bgBlur = c.bgBlur ?? 0;
        const bgBrightness = (c.bgBrightness ?? 100) / 100;
        const appFilters = [];
        if (bgBlur > 0) appFilters.push('blur(' + bgBlur + 'px)');
        if (bgBrightness !== 1) appFilters.push('brightness(' + bgBrightness + ')');
        const appFilterStr = appFilters.length ? appFilters.join(' ') : 'none';
        const bgPos = c.bgPosition || 'center center';
        const editorOpacity = (c.editorBgOpacity ?? 15) / 100;
        const editorBlur = c.editorBgBlur ?? 0;
        const editorBrightness = (c.editorBgBrightness ?? 100) / 100;
        const editorFilters = [];
        if (editorBlur > 0) editorFilters.push('blur(' + editorBlur + 'px)');
        if (editorBrightness !== 1) editorFilters.push('brightness(' + editorBrightness + ')');
        const editorFilterStr = editorFilters.length ? editorFilters.join(' ') : 'none';

        const editorBgPos = c.editorBgPosition || 'center center';

        wrapper.innerHTML = `
            <div class="tc6-ide ${this.bgDragMode ? 'tc6-drag-mode' : ''}">
                ${appBg ? (appBg.endsWith('.webm') || appBg.endsWith('.mp4') || appBg.startsWith('data:video/')
                ? `<div class="tc6-ide-bg" style="opacity: ${bgOpacity}; filter: ${appFilterStr};"><video src="${appBg}" autoplay loop muted style="width: 100%; height: 100%; object-fit: cover; object-position: ${bgPos};"></video></div>`
                : `<div class="tc6-ide-bg" style="background-image: ${appBg.startsWith('data:') ? `url("${appBg}")` : `url('${appBg.replace(/'/g, "\\'")}')`}; background-position: ${bgPos}; opacity: ${bgOpacity}; filter: ${appFilterStr};"></div>`)
                : ''}
                
                <div class="tc6-ide-content ${this.bgDragMode ? 'tc6-dimmed' : ''}">
                    <!-- Header - Uses CSS variable via tc6-header-main class -->
                    <div class="tc6-clickable tc6-ui-element tc6-header-main" 
                         data-key="bgHeader-main" data-label="Header Background">
                        <div class="tc6-clickable tc6-accent-badge" 
                             data-key="accent" data-label="Accent Color">C++</div>
                        <div class="tc6-menu-items">
                            <span class="tc6-clickable tc6-text-primary" 
                                  data-key="textPrimary" data-label="Primary Text">File</span>
                            <span>Edit</span>
                            <span>View</span>
                        </div>
                        <div class="tc6-header-indicators">
                            <div class="tc6-clickable tc6-indicator-success" 
                                 data-key="success" data-label="Success"></div>
                            <div class="tc6-clickable tc6-indicator-error" 
                                 data-key="error" data-label="Error"></div>
                        </div>
                    </div>
                    
                    <!-- Main Area -->
                    <div class="tc6-main-area">
                        <!-- Editor Column -->
                        <div class="tc6-editor-column">
                            <!-- Editor -->
                            <div class="tc6-clickable tc6-ui-element tc6-editor-bg-container" 
                                 data-key="editorBg" data-label="Editor Background">
                                ${editorBg ? (editorBg.endsWith('.webm') || editorBg.endsWith('.mp4') || editorBg.startsWith('data:video/')
                ? `<div class="tc6-editor-bg" style="position: absolute; inset: ${editorBlur > 0 ? -editorBlur + 'px' : '0'}; opacity: ${editorOpacity}; filter: ${editorFilterStr}; pointer-events: none;"><video src="${editorBg}" autoplay loop muted style="width: 100%; height: 100%; object-fit: cover; object-position: ${editorBgPos};"></video></div>`
                : `<div class="tc6-editor-bg" style="position: absolute; inset: ${editorBlur > 0 ? -editorBlur + 'px' : '0'}; background-image: ${editorBg.startsWith('data:') ? `url("${editorBg}")` : `url('${editorBg.replace(/'/g, "\\'")}')`}; background-size: cover; background-position: ${editorBgPos}; opacity: ${editorOpacity}; filter: ${editorFilterStr}; pointer-events: none;"></div>`)
                : ''}
                                <div class="tc6-code-content">
                                    <div class="tc6-code-line">
                                        <span class="tc6-clickable tc6-line-number" data-key="textMuted" data-label="Line Numbers">1</span>
                                        <span class="tc6-clickable tc6-syntax-keyword" data-key="syntaxKeyword" data-label="Keywords">#include</span>
                                        <span class="tc6-clickable tc6-syntax-string" data-key="syntaxString" data-label="Strings">&lt;bits/stdc++.h&gt;</span>
                                    </div>
                                    <div class="tc6-code-line">
                                        <span class="tc6-line-number">2</span>
                                        <span class="tc6-syntax-keyword">using namespace</span>
                                        <span class="tc6-text-primary">std;</span>
                                    </div>
                                    <div class="tc6-code-line">
                                        <span class="tc6-line-number">3</span>
                                    </div>
                                    <div class="tc6-code-line">
                                        <span class="tc6-line-number">4</span>
                                        <span class="tc6-clickable tc6-syntax-type" data-key="syntaxType" data-label="Types">int</span>
                                        <span class="tc6-clickable tc6-syntax-function" data-key="syntaxFunction" data-label="Functions">main</span><span class="tc6-clickable tc6-syntax-operator" data-key="syntaxOperator" data-label="Operators">()</span> <span class="tc6-clickable tc6-syntax-bracket" data-key="syntaxBracket" data-label="Brackets">{</span>
                                    </div>
                                    <div class="tc6-code-line">
                                        <span class="tc6-line-number">5</span>
                                        <span>    </span>
                                        <span class="tc6-clickable tc6-syntax-variable" data-key="syntaxVariable" data-label="Variables">cout</span>
                                        <span class="tc6-clickable tc6-syntax-operator" data-key="syntaxOperator" data-label="Operators"> &lt;&lt; </span>
                                        <span class="tc6-syntax-string">"hello"</span>;
                                    </div>
                                    <div class="tc6-code-line">
                                        <span class="tc6-line-number">6</span>
                                        <span>    </span>
                                        <span class="tc6-syntax-keyword">return</span>
                                        <span class="tc6-clickable tc6-syntax-number" data-key="syntaxNumber" data-label="Numbers">0</span>;
                                    </div>
                                    <div class="tc6-code-line">
                                        <span class="tc6-line-number">7</span><span class="tc6-clickable tc6-syntax-bracket" data-key="syntaxBracket" data-label="Brackets">}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Problem Panel - Uses CSS variable via tc6-panel-problems class -->
                            <div class="tc6-clickable tc6-ui-element tc6-panel-problems" 
                                 data-key="bgPanel-problems" data-label="Problem Panel">
                                <div class="tc6-panel-header">
                                    <span>PROBLEMS</span>
                                    <span class="tc6-badge-error">0</span>
                                    <span class="tc6-text-muted">TESTS</span>
                                </div>
                                <div class="tc6-panel-body tc6-text-muted">
                                    No problems detected
                                </div>
                            </div>
                        </div>
                        
                        <!-- Right Sidebar -->
                        <div class="tc6-sidebar">
                            <!-- INPUT Panel - Uses CSS variable via tc6-panel-input class -->
                            <div class="tc6-clickable tc6-ui-element tc6-panel-input" 
                                 data-key="bgPanel-input" data-label="Input Panel">
                                <div class="tc6-panel-title tc6-accent-text">INPUT</div>
                                <div class="tc6-panel-body tc6-text-muted">
                                    Enter test data...
                                </div>
                            </div>
                            
                            <!-- EXPECTED Panel - Uses CSS variable via tc6-panel-expected class -->
                            <div class="tc6-clickable tc6-ui-element tc6-panel-expected" 
                                 data-key="bgPanel-expected" data-label="Expected Panel">
                                <div class="tc6-panel-title tc6-accent-text">EXPECTED</div>
                                <div class="tc6-panel-body tc6-text-muted">
                                    Expected output...
                                </div>
                            </div>
                        </div>
                        
                        <!-- Terminal - Uses CSS variable via tc6-terminal class -->
                        <div class="tc6-clickable tc6-ui-element tc6-terminal" 
                             data-key="terminalBg" data-label="Terminal">
                            <div class="tc6-panel-title tc6-accent-text">TERMINAL</div>
                            <div class="tc6-terminal-body">
                                <div class="tc6-text-success">Settings saved</div>
                            </div>
                            <div class="tc6-terminal-input">
                                <span class="tc6-text-muted">Input ...</span>
                                <div class="tc6-terminal-send tc6-accent-bg">
                                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" stroke-width="3">
                                        <path d="M5 12h14M12 5l7 7-7 7"/>
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Status Bar - Uses CSS variable via tc6-statusbar class -->
                    <div class="tc6-clickable tc6-ui-element tc6-statusbar" 
                         data-key="bgHeader-statusbar" data-label="Status Bar">
                        <div class="tc6-indicator-success"></div>
                        <span class="tc6-text-primary">Ready</span>
                        <span class="tc6-text-muted tc6-statusbar-right">Ln 1, Col 1</span>
                    </div>
                </div>
            </div>
        `;

        this._cleanupBgDrag();

        this._setupBgDrag();

        wrapper.querySelectorAll('.tc6-clickable[data-key]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.bgDragMode) return; // Don't activate edit bar in drag mode
                const key = el.dataset.key;
                const label = el.dataset.label || key;
                this._updateEditBar(key, label);
            });
        });

        this._injectAllPreviewVariables(options);
    },

    /**
     * Color presets for quick selection
     */
    _getColorPresets() {
        return {
            material: ['#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800', '#FF5722'],
            tailwind: ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF', '#EC4899'],
            pastel: ['#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#D4BAFF', '#FFBAF3', '#FFC9BA', '#FFEEBA', '#C9FFD4', '#BAF3FF', '#E1BAFF', '#FFB3E6', '#FFD4BA', '#FFFABA', '#B3FFD9'],
            kawaii: ['#FFB6D9', '#FFC9E5', '#FFD4F0', '#E5CCFF', '#D9B3FF', '#C9BAFF', '#B3E5FF', '#BAF3FF', '#B3FFF0', '#C9FFE5', '#FFFABA', '#FFEEBA', '#FFDFBA', '#FFC9D9', '#FFB3CC', '#FFE5F0']
        };
    },

    /**
     * Show advanced color picker with customization options
     */
    _showColorPicker(key, label, targetEl) {
        this._hideColorPicker();
        this._activeColorKey = key;

        const currentColor = this._getColor(key);
        const hexColor = this._toHex(currentColor);
        const c = this.workingTheme?.colors || {};

        const currentOpacity = this._getOpacity(key) ?? 100;
        const currentBorder = c.border || '#333';

        targetEl.classList.add('tc6-color-active');

        const presets = this._getColorPresets();

        const picker = document.createElement('div');
        picker.className = 'tc6-color-picker';
        picker.innerHTML = `
            <div class="tc6-color-picker-header" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border, #444);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="tc6-color-swatch" style="background: ${hexColor};"></div>
                    <span class="tc6-color-label" style="font-size: 11px; font-weight: 600; color: var(--text-primary, #fff);">${label}</span>
                </div>
                <button class="tc6-color-picker-close">✕</button>
            </div>
            
            <div class="tc6-picker-tabs">
                <button class="tc6-picker-tab active" data-tab="color">Color</button>
                <button class="tc6-picker-tab" data-tab="presets">Presets</button>
                <button class="tc6-picker-tab" data-tab="advanced">Advanced</button>
            </div>
            
            <div class="tc6-picker-content">
                <!-- Color Tab -->
                <div class="tc6-picker-tab-panel" data-panel="color" style="display: block;">
                    <div class="tc6-picker-section">
                        <input type="color" class="tc6-color-input-native" value="${hexColor}" style="width: 100%; height: 40px; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 8px;">
                        <div class="tc6-picker-row">
                            <span class="tc6-picker-label">Hex:</span>
                            <input type="text" class="tc6-input" id="tc6-hex-input" value="${hexColor.toUpperCase()}" style="flex: 1; font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 6px 8px;">
                        </div>
                    </div>
                </div>
                
                <!-- Presets Tab -->
                <div class="tc6-picker-tab-panel" data-panel="presets" style="display: none;">
                    <div class="tc6-picker-section">
                        <div class="tc6-picker-section-title">Material Design</div>
                        <div class="tc6-preset-grid">
                            ${presets.material.map(color => `<div class="tc6-preset-swatch" data-color="${color}" style="background: ${color};" title="${color}"></div>`).join('')}
                        </div>
                    </div>
                    <div class="tc6-picker-section">
                        <div class="tc6-picker-section-title">Tailwind CSS</div>
                        <div class="tc6-preset-grid">
                            ${presets.tailwind.map(color => `<div class="tc6-preset-swatch" data-color="${color}" style="background: ${color};" title="${color}"></div>`).join('')}
                        </div>
                    </div>
                    <div class="tc6-picker-section">
                        <div class="tc6-picker-section-title">Pastel</div>
                        <div class="tc6-preset-grid">
                            ${presets.pastel.map(color => `<div class="tc6-preset-swatch" data-color="${color}" style="background: ${color};" title="${color}"></div>`).join('')}
                        </div>
                    </div>
                    <div class="tc6-picker-section">
                        <div class="tc6-picker-section-title">Kawaii</div>
                        <div class="tc6-preset-grid">
                            ${presets.kawaii.map(color => `<div class="tc6-preset-swatch" data-color="${color}" style="background: ${color};" title="${color}"></div>`).join('')}
                        </div>
                    </div>
                </div>
                
                <!-- Advanced Tab -->
                <div class="tc6-picker-tab-panel" data-panel="advanced" style="display: none;">
                    <div class="tc6-picker-section">
                        <div class="tc6-picker-section-title">Opacity</div>
                        <div class="tc6-picker-row">
                            <span class="tc6-picker-label">Alpha:</span>
                            <div class="tc6-picker-control">
                                <input type="range" min="0" max="100" value="${currentOpacity}" id="tc6-opacity-slider" style="flex: 1;">
                                <span class="tc6-picker-value" id="tc6-opacity-value">${currentOpacity}%</span>
                            </div>
                        </div>
                    </div>
                    ${this._supportsBorder(key) ? `
                    <div class="tc6-picker-section">
                        <div class="tc6-picker-section-title">Border</div>
                        <div class="tc6-picker-row">
                            <span class="tc6-picker-label">Color:</span>
                            <input type="color" id="tc6-border-color" value="${this._toHex(currentBorder)}" style="width: 40px; height: 28px; border: none; border-radius: 4px; cursor: pointer;">
                            <input type="text" class="tc6-input" id="tc6-border-hex" value="${this._toHex(currentBorder).toUpperCase()}" style="flex: 1; font-family: 'JetBrains Mono', monospace; font-size: 10px; padding: 4px 6px;">
                        </div>
                        <div class="tc6-picker-row">
                            <span class="tc6-picker-label">Width:</span>
                            <div class="tc6-picker-control">
                                <input type="range" min="0" max="5" value="${c.borderWidth || 1}" id="tc6-border-width" style="flex: 1;">
                                <span class="tc6-picker-value" id="tc6-border-width-value">${c.borderWidth || 1}px</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        document.body.appendChild(picker);
        this.currentColorPicker = picker;
        this._activeTargetEl = targetEl;

        const rect = targetEl.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - 140;
        let top = rect.bottom + 8;

        if (left < 10) left = 10;
        if (left + 280 > window.innerWidth) left = window.innerWidth - 290;
        if (top + 200 > window.innerHeight) top = rect.top - 210;

        picker.style.left = left + 'px';
        picker.style.top = top + 'px';

        requestAnimationFrame(() => picker.classList.add('visible'));

        picker.querySelectorAll('.tc6-picker-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                picker.querySelectorAll('.tc6-picker-tab').forEach(t => t.classList.remove('active'));
                picker.querySelectorAll('.tc6-picker-tab-panel').forEach(p => p.style.display = 'none');
                tab.classList.add('active');
                picker.querySelector(`[data-panel="${tabName}"]`).style.display = 'block';
            });
        });

        const colorInput = picker.querySelector('input[type="color"]');
        const hexInput = picker.querySelector('#tc6-hex-input');
        const swatch = picker.querySelector('.tc6-color-swatch');

        const updateColor = (newColor) => {
            swatch.style.background = newColor;
            hexInput.value = newColor.toUpperCase();
            this._setColor(key, newColor);
            this._updatePreviewWithoutRerender(key);
        };

        colorInput.addEventListener('input', (e) => {
            updateColor(e.target.value);
        });

        hexInput.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
            if (val.length === 6) {
                const color = '#' + val;
                colorInput.value = color;
                updateColor(color);
            }
        });

        const opacitySlider = picker.querySelector('#tc6-opacity-slider');
        const opacityValue = picker.querySelector('#tc6-opacity-value');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                opacityValue.textContent = val + '%';
                this._setOpacity(key, val);
                this._updatePreviewWithoutRerender(key);
            });
        }

        if (this._supportsBorder(key)) {
            const borderColorInput = picker.querySelector('#tc6-border-color');
            const borderHexInput = picker.querySelector('#tc6-border-hex');
            const borderWidthSlider = picker.querySelector('#tc6-border-width');
            const borderWidthValue = picker.querySelector('#tc6-border-width-value');

            if (borderColorInput) {
                borderColorInput.addEventListener('input', (e) => {
                    const color = e.target.value;
                    borderHexInput.value = color.toUpperCase();
                    if (!this.workingTheme.colors) this.workingTheme.colors = {};
                    this.workingTheme.colors.border = color;
                    this._updatePreviewWithoutRerender(key);
                });
            }

            if (borderHexInput) {
                borderHexInput.addEventListener('input', (e) => {
                    const val = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
                    if (val.length === 6) {
                        const color = '#' + val;
                        borderColorInput.value = color;
                        if (!this.workingTheme.colors) this.workingTheme.colors = {};
                        this.workingTheme.colors.border = color;
                        this._updatePreviewWithoutRerender(key);
                    }
                });
            }

            if (borderWidthSlider) {
                borderWidthSlider.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value);
                    borderWidthValue.textContent = val + 'px';
                    if (!this.workingTheme.colors) this.workingTheme.colors = {};
                    this.workingTheme.colors.borderWidth = val;
                    this._updatePreviewWithoutRerender(key);
                });
            }
        }

        picker.querySelectorAll('.tc6-preset-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                colorInput.value = color;
                updateColor(color);
            });
        });

        picker.querySelector('.tc6-color-picker-close').addEventListener('click', () => this._hideColorPicker());

        this._pickerClickHandler = (e) => {
            if (!picker.contains(e.target) && !targetEl.contains(e.target)) {
                this._hideColorPicker();
            }
        };
        setTimeout(() => {
            document.addEventListener('click', this._pickerClickHandler);
        }, 100);
    },

    /**
     * Check if element supports border customization
     */
    _supportsBorder(key) {
        // Elements that can have borders (including variants)
        const borderableKeys = [
            'bgPanel', 'bgPanel-problems', 'bgPanel-input', 'bgPanel-expected',
            'bgInput',
            'editorBg',
            'bgHeader', 'bgHeader-main', 'bgHeader-statusbar'
        ];
        return borderableKeys.includes(key);
    },

    /**
     * Get opacity for a color key
     * Uses exact key (e.g., 'bgPanel-inputOpacity') not normalized base key
     */
    _getOpacity(key) {
        const c = this.workingTheme?.colors || {};
        // Use exact key for opacity (e.g., 'bgPanel-input' → 'bgPanel-inputOpacity')
        const opacityKey = key + 'Opacity';
        return c[opacityKey];
    },

    /**
     * Set opacity for a color key
     * Uses exact key for variant-specific opacity values
     */
    _setOpacity(key, value) {
        if (!this.workingTheme.colors) this.workingTheme.colors = {};
        // Use exact key (e.g., 'bgPanel-input' → 'bgPanel-inputOpacity')
        const opacityKey = key + 'Opacity';
        this.workingTheme.colors[opacityKey] = value;
    },

    /**
     * Update preview without full re-render (preserves editor background)
     * Rewrote to avoid fallback which causes visual conflicts
     */
    _updatePreviewWithoutRerender(key) {
        // Map base keys to all their variants
        const keyVariants = this._getKeyVariants(key);

        const c = this.workingTheme?.colors || {};
        const color = this._getColor(key);

        // Find all elements matching this key or its variants
        let elements = [];
        keyVariants.forEach(variantKey => {
            const found = this.popup?.querySelectorAll(`[data-key="${variantKey}"]`);
            if (found && found.length > 0) {
                elements.push(...Array.from(found));
            }
        });

        // Update all found elements
        elements.forEach(el => {
            // Check what type of color property this element uses
            const computedStyle = el.style;

            // Update colors appropriately based on element type
            if (key.startsWith('text') || key.startsWith('syntax')) {
                // Text color keys - update color property
                el.style.color = color;
            } else if (key === 'accent' || key === 'success' || key === 'error' || key === 'warning') {
                // Status/accent colors - update background for indicators, color for text
                if (el.classList.contains('tc6-clickable') && el.textContent) {
                    // Text element with accent color
                    if (el.style.background || el.style.backgroundColor) {
                        el.style.backgroundColor = color;
                    } else {
                        el.style.color = color;
                    }
                } else {
                    el.style.backgroundColor = color;
                }
            } else {
                // Background colors - apply with opacity if needed
                const opacity = this._getOpacity(key);
                if (opacity !== undefined && opacity < 100) {
                    const rgb = this._hexToRgb(color);
                    if (rgb) {
                        el.style.backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity / 100})`;
                    }
                } else {
                    el.style.backgroundColor = color;
                }

                // Update border if supported
                if (this._supportsBorder(key) && c.border) {
                    el.style.borderColor = c.border;
                    if (c.borderWidth) {
                        el.style.borderWidth = c.borderWidth + 'px';
                    }
                }
            }
        });

        // Always update background styles to keep them in sync
        this._updateBgStyles();
    },

    /**
     * Get all key variants for a given key
     * Maps base keys like 'bgHeader' to all their variants like ['bgHeader-main', 'bgHeader-statusbar']
     */
    _getKeyVariants(key) {
        const keyMap = {
            'bgHeader': ['bgHeader-main', 'bgHeader-statusbar'],
            'bgHeader-main': ['bgHeader-main'],
            'bgHeader-statusbar': ['bgHeader-statusbar'],
            'bgPanel': ['bgPanel-problems', 'bgPanel-input', 'bgPanel-expected'],
            'bgPanel-problems': ['bgPanel-problems'],
            'bgPanel-input': ['bgPanel-input'],
            'bgPanel-expected': ['bgPanel-expected']
        };

        // Return mapped variants or just the key itself if no mapping exists
        return keyMap[key] || [key];
    },

    /**
     * Convert hex to RGB
     */
    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    },

    /**
     * Hide color picker
     */
    _hideColorPicker() {
        if (this.currentColorPicker) {
            this.currentColorPicker.remove();
            this.currentColorPicker = null;
        }
        if (this._activeTargetEl) {
            this._activeTargetEl.classList.remove('tc6-color-active');
            this._activeTargetEl = null;
        }
        if (this._pickerClickHandler) {
            document.removeEventListener('click', this._pickerClickHandler);
            this._pickerClickHandler = null;
        }
        this._activeColorKey = null;
    },

    /**
     * Update edit bar - Switch between idle and active states
     * @param {string|null} elementKey - Color key (null = idle state)
     * @param {string} elementLabel - Display label for element
     */
    /**
     * Update edit bar - Switch between idle and active states
     * @param {string|null} elementKey - Color key (null = idle state)
     * @param {string} elementLabel - Display label for element
     */
    _updateEditBar(elementKey, elementLabel) {
        const editBar = this.popup?.querySelector('#tc6-edit-bar');
        if (!editBar) {
            console.warn('[Customizer] Edit bar not found');
            return;
        }

        const hintEl = editBar.querySelector('#tc6-edit-hint');
        const elementEl = editBar.querySelector('#tc6-edit-element');

        if (!elementKey) {
            // Switch to idle state - show hint, hide element
            if (hintEl) hintEl.style.display = 'inline';
            if (elementEl) elementEl.style.display = 'none';
            this._activeColorKey = null;
            return;
        }

        // Switch to active state - hide hint, show element
        this._activeColorKey = elementKey;

        // Check if this key belongs to a group
        const groupId = window.ColorRegistry?.getGroupForKey(elementKey);
        const group = groupId ? window.ColorRegistry?.getGroup(groupId) : null;

        const displayLabel = group ? `${group.label} (${elementLabel})` : elementLabel;

        if (hintEl) hintEl.style.display = 'none';
        if (elementEl) {
            elementEl.style.display = 'flex';

            // Update element name
            const nameEl = elementEl.querySelector('#tc6-edit-name');
            if (nameEl) nameEl.textContent = displayLabel;

            // Update color preview
            const colorPreview = elementEl.querySelector('#tc6-edit-color');
            if (colorPreview) {
                const color = this._getColor(elementKey);
                colorPreview.style.background = color;

                // Click handler for color dropdown
                colorPreview.onclick = (e) => {
                    e.stopPropagation();
                    // Always use individual color picker (Color Groups feature is Coming Soon)
                    this._showColorDropdown(elementKey, elementLabel, colorPreview);
                };
            }

            // Render property icons
            const propertiesContainer = elementEl.querySelector('#tc6-edit-properties');
            if (propertiesContainer) {
                propertiesContainer.innerHTML = '';
                const properties = this._renderPropertyIcons(elementKey);
                properties.forEach(prop => {
                    const btn = document.createElement('button');
                    btn.className = 'tc6-edit-prop-btn';
                    btn.title = prop.label;
                    btn.innerHTML = prop.icon;
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        this._showPropertyPopover(prop.property, prop.getValue(), btn);
                    };
                    propertiesContainer.appendChild(btn);
                });
            }

            // Close button handler
            const closeBtn = elementEl.querySelector('#tc6-edit-close');
            if (closeBtn) {
                closeBtn.onclick = () => this._updateEditBar(null);
            }
        }
    },

    /**
     * Render property icons based on element type
     * @param {string} elementKey - Color key
     * @returns {Array} Array of property objects
     */
    _renderPropertyIcons(elementKey) {
        const properties = [];

        // Blur control (for backgrounds and terminal - acrylic effect)
        if (elementKey === 'appBackground' || elementKey === 'editorBackground' || elementKey === 'terminalBg') {
            properties.push({
                icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
                    <circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" opacity="0.3"/>
                </svg>`,
                property: 'blur',
                label: 'Blur (Acrylic)',
                getValue: () => {
                    const c = this.workingTheme?.colors || {};
                    if (elementKey === 'appBackground') return c.bgBlur ?? 0;
                    if (elementKey === 'editorBackground') return c.editorBgBlur ?? 0;
                    if (elementKey === 'terminalBg') return c.terminalBgBlur ?? 0;
                    return 0;
                }
            });
        }

        return properties;
    },

    /**
     * Show color dropdown (Figma-style)
     * @param {string} key - Color key
     * @param {string} label - Element label
     * @param {HTMLElement} targetEl - Target element to position dropdown
     */
    _showColorDropdown(key, label, targetEl) {
        // Remove existing dropdown
        document.querySelectorAll('.tc6-color-dropdown').forEach(el => el.remove());

        const currentColor = this._getColor(key);
        const hexColor = this._toHex(currentColor);
        const presets = this._getColorPresets();

        const dropdown = document.createElement('div');
        dropdown.className = 'tc6-color-dropdown';
        dropdown.innerHTML = `
            <div class="tc6-dropdown-section">
                <input type="color" class="tc6-dropdown-color-native" value="${hexColor}">
                <div class="tc6-dropdown-row">
                    <span class="tc6-dropdown-label">Hex:</span>
                    <input type="text" class="tc6-dropdown-hex" value="${hexColor.toUpperCase()}" maxlength="7">
                </div>
            </div>
            <div class="tc6-dropdown-section">
                <div class="tc6-dropdown-section-title">Presets</div>
                <div class="tc6-dropdown-preset-grid">
                    ${presets.kawaii.map(color => `
                        <div class="tc6-dropdown-preset" style="background: ${color};" data-color="${color}" title="${color}"></div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(dropdown);

        // Position dropdown below color preview
        const rect = targetEl.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 8) + 'px';

        // Show with animation
        requestAnimationFrame(() => dropdown.classList.add('visible'));

        // Bind events
        const colorInput = dropdown.querySelector('.tc6-dropdown-color-native');
        const hexInput = dropdown.querySelector('.tc6-dropdown-hex');

        const updateColor = (newColor) => {
            this._saveHistorySnapshot();
            this._setColor(key, newColor);
            this._updatePreviewWithoutRerender(key);
            targetEl.style.background = newColor;
            hexInput.value = newColor.toUpperCase();
            this._triggerAutoSave();
        };

        colorInput.addEventListener('input', (e) => updateColor(e.target.value));
        hexInput.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^#0-9A-Fa-f]/g, '');
            if (val.length === 7 && val.startsWith('#')) {
                colorInput.value = val;
                updateColor(val);
            }
        });

        dropdown.querySelectorAll('.tc6-dropdown-preset').forEach(preset => {
            preset.addEventListener('click', () => {
                const color = preset.dataset.color;
                colorInput.value = color;
                updateColor(color);
            });
        });

        // Close on outside click
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!dropdown.contains(e.target) && !targetEl.contains(e.target)) {
                    dropdown.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 100);
    },

    /**
     * Show property popover (mini slider)
     * @param {string} property - Property name (opacity, blur, border)
     * @param {number} value - Current value
     * @param {HTMLElement} targetEl - Target button element
     */
    _showPropertyPopover(property, value, targetEl) {
        // Remove existing popovers
        document.querySelectorAll('.tc6-property-popover').forEach(el => el.remove());

        const config = {
            opacity: { min: 0, max: 100, suffix: '%', step: 1 },
            blur: { min: 0, max: 20, suffix: 'px', step: 1 },
            border: { min: 0, max: 5, suffix: 'px', step: 1 }
        }[property];

        if (!config) return;

        const popover = document.createElement('div');
        popover.className = 'tc6-property-popover';
        popover.innerHTML = `
            <div class="tc6-popover-label">${targetEl.title}</div>
            <div class="tc6-popover-slider-row">
                <input type="range" min="${config.min}" max="${config.max}" step="${config.step}" value="${value}" class="tc6-popover-slider">
                <span class="tc6-popover-value">${value}${config.suffix}</span>
            </div>
        `;

        document.body.appendChild(popover);

        // Position below button
        const rect = targetEl.getBoundingClientRect();
        popover.style.left = (rect.left + rect.width / 2 - 100) + 'px';
        popover.style.top = (rect.bottom + 8) + 'px';

        // Show with animation
        requestAnimationFrame(() => popover.classList.add('visible'));

        // Bind slider
        const slider = popover.querySelector('.tc6-popover-slider');
        const valueDisplay = popover.querySelector('.tc6-popover-value');

        slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            valueDisplay.textContent = val + config.suffix;

            this._saveHistorySnapshot();

            // Update based on property type
            const key = this._activeColorKey;
            if (property === 'opacity') {
                this._setOpacity(key, val);
            } else if (property === 'blur') {
                const c = this.workingTheme.colors;
                if (key === 'appBackground') c.bgBlur = val;
                else if (key === 'editorBackground') c.editorBgBlur = val;
                else if (key === 'terminalBg') c.terminalBgBlur = val;
            } else if (property === 'border') {
                this.workingTheme.colors.borderWidth = val;
            }

            this._updatePreviewWithoutRerender(key);
            this._updateHistoryButtons();
            this._triggerAutoSave();
        });

        // Mark button as active
        targetEl.classList.add('active');

        // Close on outside click
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!popover.contains(e.target) && !targetEl.contains(e.target)) {
                    popover.remove();
                    targetEl.classList.remove('active');
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 100);
    },

    /**
     * Reset theme
     */
    async _reset() {
        if (!await this._confirm('Reset all changes?', 'Reset changes', 'Reset', true)) return;

        if (this.sourceThemeId && ThemeManager.themes.has(this.sourceThemeId)) {
            this.workingTheme = this._deepClone(ThemeManager.themes.get(this.sourceThemeId));
            this._renderSettings();
            this._renderPreview();
        }
    },

    /**
     * Save as new theme
     */
    _saveAsNew() {
        const name = this.popup?.querySelector('#tc6-name')?.value?.trim();
        if (!name) {
            this._notify('Please enter a theme name', 'warning');
            return;
        }

        this.workingTheme.name = name;
        this.workingTheme.author = 'User';

        // Generate unique ID
        const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let id = baseId;
        let counter = 1;
        while (ThemeManager.themes.has(id) || ThemeManager.builtinThemeIds.includes(id)) {
            id = `${baseId}-${counter++}`;
        }

        // Deep clone all colors including bgPosition and other settings
        const colorsClone = this._deepClone(this.workingTheme.colors || {});
        const editorClone = this._deepClone(this.workingTheme.editor || {});
        const terminalClone = this._deepClone(this.workingTheme.terminal || {});

        const themeData = {
            meta: {
                id: id,
                name: name,
                author: 'User',
                version: '1.0.0',
                type: this.workingTheme.type || 'dark',
                tags: ['custom']
            },
            colors: colorsClone,
            editor: editorClone,
            terminal: terminalClone
        };

        if (ThemeManager.registerTheme(themeData)) {
            ThemeManager._saveUserThemes();
            ThemeManager.setTheme(id);

            if (typeof App !== 'undefined') {
                App.settings.appearance.theme = id;
                if (typeof saveSettings === 'function') {
                    // Await for settings to save safely
                    try {
                        const savePromise = saveSettings();
                        Promise.resolve(savePromise).then(() => {
                            console.log('[Customizer] Settings saved successfully');
                        }).catch((err) => {
                            console.error('[Customizer] Failed to save settings:', err);
                        });
                    } catch (e) {
                        console.error('[Customizer] Exception while saving settings:', e);
                    }
                }
            }

            if (typeof ThemeMarketplace !== 'undefined') {
                ThemeMarketplace.renderCarousel();
            }

            console.log(`[Customizer] Created: ${name} (${id})`);

            // Dispatch custom event for IDE integration
            this._dispatchThemeSaveEvent(themeData);

            // Show success notification
            this._showSaveNotification(`Theme "${name}" has been saved.`);

            // Update sourceThemeId to the new theme and refresh header buttons
            this.sourceThemeId = id;
            this._refreshHeaderButtons();
        } else {
            this._notify('Failed to save theme', 'error');
        }
    },

    /**
     * Overwrite existing custom theme
     */
    _saveOverwrite() {
        if (!this.sourceThemeId || ThemeManager.builtinThemeIds.includes(this.sourceThemeId)) {
            this._notify('Cannot overwrite built-in themes', 'warning');
            return;
        }

        // Exit drag mode if active
        if (this.bgDragMode) {
            this._exitDragMode();
        }

        const name = this.popup?.querySelector('#tc6-name')?.value?.trim() || this.workingTheme.name;
        this.workingTheme.name = name;

        // Deep clone all colors including bgPosition and other settings
        const colorsClone = this._deepClone(this.workingTheme.colors || {});
        const editorClone = this._deepClone(this.workingTheme.editor || {});
        const terminalClone = this._deepClone(this.workingTheme.terminal || {});

        const themeData = {
            meta: {
                id: this.sourceThemeId,
                name: name,
                author: this.workingTheme.author || 'User',
                version: '1.0.0',
                type: this.workingTheme.type || 'dark',
                tags: ['custom']
            },
            colors: colorsClone,
            editor: editorClone,
            terminal: terminalClone
        };

        if (ThemeManager.registerTheme(themeData)) {
            ThemeManager._saveUserThemes();
            ThemeManager.setTheme(this.sourceThemeId);

            if (typeof App !== 'undefined') {
                App.settings.appearance.theme = this.sourceThemeId;
                if (typeof saveSettings === 'function') {
                    // Await for settings to save before closing safely
                    try {
                        const savePromise = saveSettings();
                        Promise.resolve(savePromise).then(() => {
                            console.log('[Customizer] Settings saved successfully');
                        }).catch((err) => {
                            console.error('[Customizer] Failed to save settings:', err);
                        });
                    } catch (e) {
                        console.error('[Customizer] Exception while saving settings:', e);
                    }
                }
            }

            if (typeof ThemeMarketplace !== 'undefined') {
                ThemeMarketplace.renderCarousel();
            }

            console.log(`[Customizer] Updated: ${name}`);

            // Dispatch custom event for IDE integration
            this._dispatchThemeSaveEvent(themeData);

            // Show success notification
            this._showSaveNotification(`Theme "${name}" has been updated.`);

            // CRITICAL: Clear saved values so close() won't restore old values
            // The new theme was just applied by ThemeManager.setTheme() above
            this._savedAppBgOpacity = null;
            this._savedEditorBgOpacity = null;
            this._savedAppBgImage = null;
            this._savedEditorBgImage = null;
            this._savedAppBgBrightness = null;
            this._savedEditorBgBrightness = null;
            this._savedAppBgBlur = null;
            this._savedEditorBgBlur = null;

            // Close customizer after save (Save & Close behavior)
            this.close();
        } else {
            this._notify('Failed to save theme', 'error');
        }
    },

    /**
     * Save only background settings for built-in themes
     * This stores background customization separately without modifying the built-in theme
     */
    _saveBackgroundOnly() {
        if (!this.sourceThemeId) return;

        // Exit drag mode if active
        if (this.bgDragMode) {
            this._exitDragMode();
        }

        // Get background settings from working theme
        const bgSettings = {
            appBackground: this.workingTheme.colors?.appBackground,
            bgOpacity: this.workingTheme.colors?.bgOpacity,
            bgBrightness: this.workingTheme.colors?.bgBrightness,
            bgBlur: this.workingTheme.colors?.bgBlur,
            bgPosition: this.workingTheme.colors?.bgPosition,
            editorBackground: this.workingTheme.colors?.editorBackground,
            editorBgOpacity: this.workingTheme.colors?.editorBgOpacity,
            editorBgBrightness: this.workingTheme.colors?.editorBgBrightness,
            editorBgBlur: this.workingTheme.colors?.editorBgBlur,
            editorBgPosition: this.workingTheme.colors?.editorBgPosition
        };

        // Remove undefined values
        Object.keys(bgSettings).forEach(key => {
            if (bgSettings[key] === undefined) delete bgSettings[key];
        });

        // Store in localStorage with theme ID as key
        const storageKey = `theme-bg-${this.sourceThemeId}`;
        try {
            localStorage.setItem(storageKey, JSON.stringify(bgSettings));
            console.log(`[Customizer] Background saved for theme: ${this.sourceThemeId}`);

            // Get theme name for notification
            const activeTheme = ThemeManager.themes.get(this.sourceThemeId);

            // Re-apply the theme to show changes (setTheme will load from localStorage)
            ThemeManager.setTheme(this.sourceThemeId);

            // Clear saved values so close() won't restore old values
            this._savedAppBgOpacity = null;
            this._savedEditorBgOpacity = null;
            this._savedAppBgImage = null;
            this._savedEditorBgImage = null;
            this._savedAppBgBlur = null;
            this._savedEditorBgBlur = null;

            // Show success notification
            this._showSaveNotification(`Background for "${activeTheme?.name || this.sourceThemeId}" has been saved.`);

            this.close();
        } catch (e) {
            console.error('[Customizer] Failed to save background:', e);
            this._notify('Failed to save background settings', 'error');
        }
    },

    /**
     * Dispatch theme save event for IDE integration
     */
    _dispatchThemeSaveEvent(themeData) {
        const event = new CustomEvent('themeCustomizerSave', {
            detail: {
                theme: themeData,
                timestamp: Date.now()
            }
        });
        window.dispatchEvent(event);
        console.log('[Customizer] Dispatched themeCustomizerSave event', themeData.meta);
    },

    /**
     * Reset theme to default
     * - For built-in themes: Clears saved background from localStorage and restores hardcoded theme
     * - For custom themes: Resets to the last saved state
     */
    async _reset() {
        if (!await this._confirm('Reset to defaults? All unsaved changes will be lost.', 'Reset to defaults', 'Reset', true)) {
            return;
        }

        const isBuiltin = ThemeManager.builtinThemeIds.includes(this.sourceThemeId);

        if (isBuiltin) {
            // For built-in themes: Clear saved background from localStorage
            const storageKey = `theme-bg-${this.sourceThemeId}`;
            localStorage.removeItem(storageKey);
            console.log(`[Customizer] Cleared saved background for: ${this.sourceThemeId}`);

            // Restore hardcoded theme (without saved background)
            ThemeManager._restoreBuiltinTheme(this.sourceThemeId);

            // Re-apply theme to update UI
            ThemeManager.setTheme(this.sourceThemeId);

            // Reload customizer with clean theme
            this.close();
            setTimeout(() => this.open(this.sourceThemeId), 100);
        } else {
            // For custom themes: Reset to original saved theme data
            const originalTheme = ThemeManager.themes.get(this.sourceThemeId);
            if (originalTheme) {
                this.workingTheme = this._deepClone(originalTheme);

                if (!this.workingTheme.colors) this.workingTheme.colors = {};
                if (!this.workingTheme.editor) this.workingTheme.editor = { syntax: {} };

                this.historyStack = [this._deepClone(this.workingTheme)];
                this.historyIndex = 0;
                this._updateHistoryButtons();

                // Re-render controls and preview
                this._renderControls();
                this._renderPreview();
                this._updateBgStyles();
                this._updateBgHints();

                console.log(`[Customizer] Reset custom theme: ${this.sourceThemeId}`);
            }
        }
    },

    /**
     * Apply background settings to document root (real app, not preview)
     * Used after saving to immediately show changes on the actual app
     * @param {object} bgSettings - Background settings object
     */
    _applyBackgroundVarsToRoot(bgSettings) {
        const root = document.documentElement;

        // App background
        if (bgSettings.appBackground) {
            const bgUrl = bgSettings.appBackground.startsWith('data:')
                ? `url("${bgSettings.appBackground}")`
                : `url('${bgSettings.appBackground.replace(/'/g, "\\'")}')`;
            root.style.setProperty('--app-bg-image', bgUrl);
        }

        if (bgSettings.bgOpacity !== undefined) {
            root.style.setProperty('--app-bg-opacity', (bgSettings.bgOpacity / 100).toString());
        }

        if (bgSettings.bgBrightness !== undefined) {
            root.style.setProperty('--app-bg-brightness', (bgSettings.bgBrightness / 100).toString());
        }

        if (bgSettings.bgBlur !== undefined) {
            root.style.setProperty('--app-bg-blur', bgSettings.bgBlur + 'px');
        }

        if (bgSettings.bgPosition) {
            root.style.setProperty('--app-bg-position', bgSettings.bgPosition);
        }

        // Editor background
        if (bgSettings.editorBackground) {
            const bgUrl = bgSettings.editorBackground.startsWith('data:')
                ? `url("${bgSettings.editorBackground}")`
                : `url('${bgSettings.editorBackground.replace(/'/g, "\\'")}')`;
            root.style.setProperty('--editor-bg-image', bgUrl);
        }

        if (bgSettings.editorBgOpacity !== undefined) {
            root.style.setProperty('--editor-bg-opacity', (bgSettings.editorBgOpacity / 100).toString());
        }

        if (bgSettings.editorBgBrightness !== undefined) {
            root.style.setProperty('--editor-bg-brightness', (bgSettings.editorBgBrightness / 100).toString());
        }

        if (bgSettings.editorBgBlur !== undefined) {
            root.style.setProperty('--editor-bg-blur', bgSettings.editorBgBlur + 'px');
        }

        if (bgSettings.editorBgPosition) {
            root.style.setProperty('--editor-bg-position', bgSettings.editorBgPosition);
        }

        console.log('[Customizer] Applied background vars to root:', bgSettings);
    },

    /**
     * Refresh footer buttons (after save as new to show Save & Close/Delete)
     */
    _refreshHeaderButtons() {
        const footerRight = this.popup?.querySelector('.tc6-footer-right');
        const footerLeft = this.popup?.querySelector('.tc6-footer-left');
        if (!footerRight) return;

        const isCustomTheme = this.sourceThemeId &&
            !ThemeManager.builtinThemeIds.includes(this.sourceThemeId);

        // Rebuild footer-left HTML (Reset + Delete + Auto-save indicator)
        if (footerLeft) {
            footerLeft.innerHTML = `
                <button class="tc6-btn-reset" id="tc6-reset">Reset</button>
                ${isCustomTheme ? `
                <button class="tc6-btn-delete" id="tc6-delete">Delete Theme</button>
                ` : ''}
                <!-- Auto-save indicator -->
                <span class="tc6-autosave-indicator" id="tc6-autosave" style="display: none;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Saved
                </span>
            `;

            // Rebind footer-left button events
            footerLeft.querySelector('#tc6-reset')?.addEventListener('click', () => this._reset());
            footerLeft.querySelector('#tc6-delete')?.addEventListener('click', () => this._deleteTheme());
        }

        // Rebuild footer-right HTML (Create New + Save & Close)
        footerRight.innerHTML = `
            <!-- Save as New - Secondary -->
            <button class="tc6-btn-secondary" id="tc6-save-new">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Create New Theme
            </button>
            ${isCustomTheme ? `
            <!-- Save & Close - Primary -->
            <button class="tc6-btn-save" id="tc6-save">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                    <polyline points="17 21 17 13 7 13 7 21"/>
                </svg>
                Save & Close
            </button>
            ` : ''}
        `;

        // Rebind footer-right button events
        footerRight.querySelector('#tc6-save')?.addEventListener('click', () => this._saveOverwrite());
        footerRight.querySelector('#tc6-save-new')?.addEventListener('click', () => this._saveAsNew());
    },

    /**
     * Delete current custom theme
     */
    async _deleteTheme() {
        if (!this.sourceThemeId || ThemeManager.builtinThemeIds.includes(this.sourceThemeId)) {
            this._notify('Cannot delete built-in themes', 'warning');
            return;
        }

        const themeName = this.workingTheme?.name || this.sourceThemeId;
        if (!await this._confirm(`Delete theme "${themeName}"? This cannot be undone.`, 'Delete theme', 'Delete', true)) {
            return;
        }

        const result = ThemeManager.deleteTheme(this.sourceThemeId);
        if (result.success) {
            console.log(`[Customizer] Deleted: ${themeName}`);

            if (typeof ThemeMarketplace !== 'undefined') {
                ThemeMarketplace.renderCarousel();
            }

            this.close();
        } else {
            this._notify(result.message || 'Failed to delete theme', 'error');
        }
    },

    // ========== HELPER METHODS ==========

    /**
     * Get base key from a unique key variant
     * e.g., 'bgHeader-main' -> 'bgHeader', 'bgPanel-input' -> 'bgPanel'
     */
    _getBaseKey(key) {
        // Map unique keys back to their base keys
        const baseKeyMap = {
            'bgHeader-main': 'bgHeader',
            'bgHeader-statusbar': 'bgHeader',
            'bgPanel-problems': 'bgPanel',
            'bgPanel-input': 'bgPanel',
            'bgPanel-expected': 'bgPanel'
        };

        return baseKeyMap[key] || key;
    },

    _getColor(key) {
        const c = this.workingTheme?.colors || {};

        // Prefer exact key for variants, then fall back to base key
        if (c[key]) return c[key];

        if (key === 'bgHeader-statusbar' && c.bgHeader) {
            return ThemeTokens.toOpaque(c.bgHeader);
        }

        // Normalize unique keys to base keys
        const baseKey = this._getBaseKey(key);

        if (c[baseKey]) return c[baseKey];

        if (baseKey.startsWith('syntax')) {
            const syntaxKey = baseKey.replace('syntax', '').toLowerCase();
            const color = this.workingTheme?.editor?.syntax?.[syntaxKey]?.color;
            return color ? (color.startsWith('#') ? color : '#' + color) : '#888888';
        }

        if (baseKey === 'editorBg') {
            return this.workingTheme?.editor?.background || c.editorBg || '#1e1e1e';
        }

        return '#888888';
    },

    /**
     * Set color value for a key
     * CRITICAL: Stores EXACT key (e.g., 'bgPanel-input') instead of normalizing to base key.
     * Also injects CSS variable onto preview wrapper for scoped live preview.
     * 
     * @param {string} key - Color key (exact key like 'bgPanel-input')
     * @param {string} value - Color value (hex)
     */
    _setColor(key, value) {
        if (!this.workingTheme) return;
        if (!this.workingTheme.colors) this.workingTheme.colors = {};

        // Validate hex color format
        if (!this._isValidHexColor(value)) {
            console.warn(`[Customizer] Invalid color format for ${key}: ${value}`);
            return;
        }

        // Handle syntax colors specially - they go to editor.syntax
        if (key.startsWith('syntax')) {
            const syntaxKey = key.replace('syntax', '').toLowerCase();
            if (!this.workingTheme.editor) this.workingTheme.editor = { syntax: {} };
            if (!this.workingTheme.editor.syntax) this.workingTheme.editor.syntax = {};
            if (!this.workingTheme.editor.syntax[syntaxKey]) this.workingTheme.editor.syntax[syntaxKey] = {};
            this.workingTheme.editor.syntax[syntaxKey].color = value.replace('#', '');
        } else if (key === 'editorBg') {
            if (!this.workingTheme.editor) this.workingTheme.editor = {};
            this.workingTheme.editor.background = value;
            this.workingTheme.colors.editorBg = value;
        } else {
            this.workingTheme.colors[key] = value;
            if (key === 'bgHeader') {
                this.workingTheme.colors['bgHeader-main'] = value;
                this.workingTheme.colors['bgHeader-statusbar'] = ThemeTokens.toOpaque(value);
            }
            if (key === 'bgPanel') {
                this.workingTheme.colors['bgPanel-problems'] = value;
                this.workingTheme.colors['bgPanel-input'] = value;
                this.workingTheme.colors['bgPanel-expected'] = value;
            }
        }

        // Inject CSS variable onto preview wrapper for scoped live preview
        this._injectPreviewVariable(key, value);
    },

    /**
     * Validate hex color format
     * Accepts: #RGB, #RRGGBB, rgb, rrggbb
     */
    _isValidHexColor(color) {
        if (typeof color !== 'string') return false;
        // Match #RGB, #RRGGBB, or just RGB/RRGGBB
        const hexRegex = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
        return hexRegex.test(color);
    },

    /**
     * Inject a single CSS variable onto the preview wrapper
     * This scopes color changes to the preview only, preventing leakage to customizer UI
     * 
     * @param {string} key - Color key (e.g., 'bgPanel-input')
     * @param {string} value - Color value (hex)
     */
    _injectPreviewVariable(key, value) {
        const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
        if (!wrapper) return;

        // Use ColorRegistry to get correct CSS variable name
        const cssVar = window.ColorRegistry?.getCssVar(key);
        if (cssVar) {
            wrapper.style.setProperty(cssVar, value);
        } else {
            // Fallback: convert camelCase to kebab-case
            const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            wrapper.style.setProperty(`--${kebabKey}`, value);
        }
    },

    /**
     * Inject ALL CSS variables from workingTheme onto preview wrapper AND document root
     * This ensures both the preview AND the real app UI (e.g., settings popup) show the correct colors
     */
    _injectAllPreviewVariables(options = {}) {
        const wrapper = this.popup?.querySelector('#tc6-preview-wrapper');
        if (!wrapper) return;

        const c = this.workingTheme?.colors || {};
        const root = document.documentElement; // Apply to real app too

        // Map JSON keys to CSS variable names (match ThemeManager)
        const varMappings = {
            'bgBase': '--bg-base',
            'bgSurface': '--bg-surface',
            'bgOceanLight': '--bg-ocean-light',
            'bgOceanMedium': '--bg-ocean-medium',
            'bgOceanDeep': '--bg-ocean-deep',
            'bgOceanDark': '--bg-ocean-dark',
            'bgGlass': '--bg-glass',
            'bgGlassHeavy': '--bg-glass-heavy',
            'bgGlassBorder': '--bg-glass-border',
            'accent': '--accent',
            'accentHover': '--accent-hover',
            'textPrimary': '--text-primary',
            'textSecondary': '--text-secondary',
            'textMuted': '--text-muted',
            'success': '--success',
            'error': '--error',
            'warning': '--warning',
            'border': '--border',
            'borderStrong': '--border-strong',
            'shadowSoft': '--shadow-soft',
            'shadowCard': '--shadow-card',
            'glow': '--glow',
            'bgHeader': '--bg-header',
            'bgPanel': '--bg-panel',
            'bgInput': '--bg-input',
            'bgButton': '--bg-button',
            'bgButtonHover': '--bg-button-hover',
            'bgHeader-main': '--bg-header-main',
            'bgHeader-statusbar': '--bg-header-statusbar',
            'bgPanel-problems': '--bg-panel-problems',
            'bgPanel-input': '--bg-panel-input',
            'bgPanel-expected': '--bg-panel-expected',
            'editorBg': '--editor-bg',
            'editorBackground': '--editor-bg-image',
            'appBackground': '--app-bg-image',
            'bgPosition': '--app-bg-position',
            'editorBgPosition': '--editor-bg-position',
            'bgOpacity': '--app-bg-opacity',
            'bgBrightness': '--app-bg-brightness',
            'bgBlur': '--app-bg-blur',
            'editorBgOpacity': '--editor-bg-opacity',
            'editorBgBrightness': '--editor-bg-brightness',
            'editorBgBlur': '--editor-bg-blur',
            'terminalBg': '--terminal-bg',
            'terminalBgBlur': '--terminal-bg-blur',
            'settingsLabelColor': '--settings-label-color',
            'settingsSectionColor': '--settings-section-color',
            'buttonTextOnAccent': '--button-text-on-accent',
            'terminalOpacity': '--terminal-opacity',
            'panelOpacity': '--panel-opacity',
            // Button token colors - for header/sidebar SVG icon colors and button styling
            'btnBg': '--btn-bg',
            'btnBgHover': '--btn-bg-hover',
            'btnBorder': '--btn-border',
            'btnText': '--btn-text',
            'btnTextHover': '--btn-text-hover',
            'btnPrimaryBg': '--btn-primary-bg',
            'btnPrimaryBgHover': '--btn-primary-bg-hover',
            'btnPrimaryText': '--btn-primary-text'
        };

        // Apply all color values from workingTheme with same rules as ThemeManager
        // Helper function to apply CSS variable to both wrapper (preview) and root (real app)
        const applyVar = (target, cssVar, value) => {
            wrapper.style.setProperty(cssVar, value);
            root.style.setProperty(cssVar, value);
        };

        // clearStale: when applying edited JSON, remove every managed CSS variable
        // first so keys the user deleted/renamed fall back to stylesheet defaults
        // instead of keeping their previous inline value ("stuck on one color"). (#43)
        if (options.clearStale) {
            for (const cssVar of Object.values(varMappings)) {
                wrapper.style.removeProperty(cssVar);
                root.style.removeProperty(cssVar);
            }
            for (const [, parentCssVar] of [
                ['bgHeader-main', '--bg-header-main'],
                ['bgHeader-statusbar', '--bg-header-statusbar'],
                ['bgPanel-problems', '--bg-panel-problems'],
                ['bgPanel-input', '--bg-panel-input'],
                ['bgPanel-expected', '--bg-panel-expected']
            ]) {
                wrapper.style.removeProperty(parentCssVar);
                root.style.removeProperty(parentCssVar);
            }
        }

        for (const [key, cssVar] of Object.entries(varMappings)) {
            const value = c[key];
            if (value !== undefined && value !== null) {
                if (key === 'editorBackground' || key === 'appBackground') {
                    if (value && value !== 'none' && !value.startsWith('url(')) {
                        if (value.startsWith('data:')) {
                            applyVar(root, cssVar, `url("${value}")`);
                        } else {
                            const escapedValue = value.replace(/'/g, "\\'");
                            applyVar(root, cssVar, `url('${escapedValue}')`);
                        }
                    } else {
                        applyVar(root, cssVar, value || 'none');
                    }
                } else if (key === 'bgOpacity' || key === 'editorBgOpacity' ||
                    key === 'bgBrightness' || key === 'editorBgBrightness' ||
                    key === 'terminalOpacity' || key === 'panelOpacity') {
                    applyVar(root, cssVar, (parseFloat(value) / 100).toString());
                } else if (key === 'bgBlur' || key === 'editorBgBlur' || key === 'terminalBgBlur') {
                    applyVar(root, cssVar, `${parseInt(value)}px`);
                } else if (key === 'bgPosition' || key === 'editorBgPosition') {
                    applyVar(root, cssVar, value || 'center center');
                } else {
                    applyVar(root, cssVar, value);
                }
            }
        }

        // Apply inheritance for variant colors (match ThemeManager behavior)
        const applyInheritance = (childKey, parentKey, cssVar, transform = v => v) => {
            if (!c[childKey] && c[parentKey]) {
                const value = transform(c[parentKey]);
                wrapper.style.setProperty(cssVar, value);
                root.style.setProperty(cssVar, value);
            }
        };

        applyInheritance('bgHeader-main', 'bgHeader', '--bg-header-main');
        applyInheritance('bgHeader-statusbar', 'bgHeader', '--bg-header-statusbar', ThemeTokens.toOpaque);
        applyInheritance('bgPanel-problems', 'bgPanel', '--bg-panel-problems');
        applyInheritance('bgPanel-input', 'bgPanel', '--bg-panel-input');
        applyInheritance('bgPanel-expected', 'bgPanel', '--bg-panel-expected');

        // Also apply syntax colors
        const syn = this.workingTheme?.editor?.syntax || {};
        for (const [name, data] of Object.entries(syn)) {
            if (data?.color) {
                const hexColor = data.color.startsWith('#') ? data.color : '#' + data.color;
                wrapper.style.setProperty(`--syntax-${name}`, hexColor);
            }
        }
    },


    _getSyntaxColors() {
        const syn = this.workingTheme?.editor?.syntax || {};
        const format = (c) => c ? (c.startsWith('#') ? c : '#' + c) : '#888888';

        return {
            keyword: format(syn.keyword?.color),
            string: format(syn.string?.color),
            number: format(syn.number?.color),
            type: format(syn.type?.color),
            function: format(syn.function?.color),
            comment: format(syn.comment?.color),
            variable: format(syn.variable?.color)
        };
    },

    _toHex(color) {
        if (!color) return '#888888';
        if (typeof color !== 'string') return '#888888';

        if (color.startsWith('#')) {
            return color.length > 7 ? color.slice(0, 7) : color;
        }

        if (color.startsWith('rgb')) {
            const match = color.match(/\d+/g);
            if (match && match.length >= 3) {
                const r = parseInt(match[0]);
                const g = parseInt(match[1]);
                const b = parseInt(match[2]);
                return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
            }
        }

        return '#888888';
    },

    _deepClone(obj) {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return {};
        }
    },

    /**
     * Save current state to history stack
     */
    _saveHistorySnapshot() {
        // Remove any states after current index (when user made changes after undo)
        this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);

        // Add new snapshot
        this.historyStack.push(this._deepClone(this.workingTheme));
        this.historyIndex++;

        // Limit history size
        if (this.historyStack.length > this.maxHistorySize) {
            this.historyStack.shift();
            this.historyIndex--;
        }

        this._updateHistoryButtons();
    },

    /**
     * Undo to previous state
     */
    _undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.workingTheme = this._deepClone(this.historyStack[this.historyIndex]);
            this._renderControls();
            this._renderPreview();
            this._updateHistoryButtons();
            console.log(`[Customizer] Undo to step ${this.historyIndex}`);
        }
    },

    /**
     * Redo to next state
     */
    _redo() {
        if (this.historyIndex < this.historyStack.length - 1) {
            this.historyIndex++;
            this.workingTheme = this._deepClone(this.historyStack[this.historyIndex]);
            this._renderControls();
            this._renderPreview();
            this._updateHistoryButtons();
            console.log(`[Customizer] Redo to step ${this.historyIndex}`);
        }
    },

    /**
     * Update undo/redo button states
     */
    _updateHistoryButtons() {
        const undoBtn = this.popup?.querySelector('#tc6-undo');
        const redoBtn = this.popup?.querySelector('#tc6-redo');

        if (undoBtn) {
            undoBtn.disabled = this.historyIndex <= 0;
        }
        if (redoBtn) {
            redoBtn.disabled = this.historyIndex >= this.historyStack.length - 1;
        }
    },

    _escape(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
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
        if (type === 'success') {
            this._showSaveNotification(message);
            return;
        }

        if (typeof log === 'function') {
            log(message, type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info');
            return;
        }

        console[type === 'error' ? 'error' : 'log']('[Customizer]', message);
    },

    /**
     * Show save success notification with tick icon
     */
    _showSaveNotification(message) {
        // Remove existing notification if any
        const existing = document.querySelector('.tc6-save-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'tc6-save-notification';
        notification.innerHTML = `
            <div class="tc6-save-notification-content">
                <svg class="tc6-save-tick" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span class="tc6-save-message">${this._escape(message)}</span>
            </div>
        `;

        document.body.appendChild(notification);

        // Trigger animation
        requestAnimationFrame(() => {
            notification.classList.add('visible');
        });

        // Auto remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    },

    /**
     * Trigger auto-save (debounced)
     */
    _triggerAutoSave() {
        // Only auto-save if it's a custom theme
        if (!this.sourceThemeId || ThemeManager.builtinThemeIds.includes(this.sourceThemeId)) {
            return;
        }

        // Clear previous timeout
        if (this._autoSaveTimeout) {
            clearTimeout(this._autoSaveTimeout);
        }

        // Debounce auto-save by 2 seconds
        this._autoSaveTimeout = setTimeout(() => {
            this._performAutoSave();
        }, 2000);
    },

    /**
     * Perform the actual auto-save
     */
    _performAutoSave() {
        if (!this.sourceThemeId || ThemeManager.builtinThemeIds.includes(this.sourceThemeId)) {
            return;
        }

        const name = this.popup?.querySelector('#tc6-name')?.value?.trim() || this.workingTheme.name;
        this.workingTheme.name = name;

        const colorsClone = this._deepClone(this.workingTheme.colors || {});
        const editorClone = this._deepClone(this.workingTheme.editor || {});
        const terminalClone = this._deepClone(this.workingTheme.terminal || {});

        const themeData = {
            meta: {
                id: this.sourceThemeId,
                name: name,
                author: this.workingTheme.author || 'User',
                version: '1.0.0',
                type: this.workingTheme.type || 'dark',
                tags: ['custom']
            },
            colors: colorsClone,
            editor: editorClone,
            terminal: terminalClone
        };

        if (ThemeManager.registerTheme(themeData)) {
            ThemeManager._saveUserThemes();

            // Show auto-save indicator
            this._showAutoSaveIndicator();

            console.log(`[Customizer] Auto-saved: ${name}`);
        }
    },

    /**
     * Show auto-save indicator
     */
    _showAutoSaveIndicator() {
        const indicator = this.popup?.querySelector('#tc6-autosave');
        if (!indicator) return;

        indicator.style.display = 'flex';

        // Hide after 2 seconds
        setTimeout(() => {
            if (indicator) indicator.style.display = 'none';
        }, 2000);
    }
};

window.ThemeCustomizer = ThemeCustomizer;
