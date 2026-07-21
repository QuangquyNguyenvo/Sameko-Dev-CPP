/**
 * Theme Tokens - Single Source of Truth
 * 
 * Unified token definitions for the entire theming system.
 * All other modules (ThemeManager, ThemeCustomizer, ColorRegistry) 
 * reference this file for CSS variable mappings.
 * 
 * This eliminates sync issues between preview, save, and apply.
 * 
 * @author Sameko Team
 */

// Ensure surfaces that should be solid get an alpha of 1 even if the parent is translucent
const toOpaque = (color) => {
    if (!color) return color;
    const match = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (match) {
        const [, r, g, b] = match;
        return `rgba(${r}, ${g}, ${b}, 1)`;
    }
    return color;
};

const ThemeTokens = {
    /**
     * Token Definitions
     * Each token has:
     * - cssVar: The CSS custom property name
     * - type: 'color' | 'opacity' | 'blur' | 'image' | 'position' | 'shadow' | 'raw'
     * - group: (optional) For grouping in color picker
     */
    definitions: {
        // ============= BACKGROUND GROUP =============
        bgBase: { cssVar: '--bg-base', type: 'color', group: 'background' },
        bgOceanDark: { cssVar: '--bg-ocean-dark', type: 'color', group: 'main' },
        bgOceanMedium: { cssVar: '--bg-ocean-medium', type: 'color', group: 'main' },
        editorBg: { cssVar: '--editor-bg', type: 'color', group: 'background' },
        bgInput: { cssVar: '--bg-input', type: 'color', group: 'surface' },
        terminalBg: { cssVar: '--terminal-bg', type: 'color', group: 'terminal' },

        // ============= SURFACE GROUP =============
        bgSurface: { cssVar: '--bg-surface', type: 'color', group: 'surface' },
        bgOceanLight: { cssVar: '--bg-ocean-light', type: 'color', group: 'surface' },
        bgPanel: { cssVar: '--bg-panel', type: 'color', group: 'surface' },
        'bgPanel-problems': { cssVar: '--bg-panel-problems', type: 'color', group: 'surface' },
        'bgPanel-input': { cssVar: '--bg-panel-input', type: 'color', group: 'surface' },
        'bgPanel-expected': { cssVar: '--bg-panel-expected', type: 'color', group: 'surface' },
        bgHeader: { cssVar: '--bg-header', type: 'color', group: 'surface' },
        'bgHeader-main': { cssVar: '--bg-header-main', type: 'color', group: 'surface' },
        'bgHeader-statusbar': { cssVar: '--bg-header-statusbar', type: 'color', group: 'surface' },
        bgGlass: { cssVar: '--bg-glass', type: 'color', group: 'surface' },
        bgGlassHeavy: { cssVar: '--bg-glass-heavy', type: 'color', group: 'surface' },
        bgButton: { cssVar: '--bg-button', type: 'color', group: 'surface' },
        bgButtonHover: { cssVar: '--bg-button-hover', type: 'color', group: 'surface' },

        // ============= ACCENT GROUP =============
        accent: { cssVar: '--accent', type: 'color', group: 'main' },
        accentHover: { cssVar: '--accent-hover', type: 'color', group: 'accent' },
        bgOceanDeep: { cssVar: '--bg-ocean-deep', type: 'color', group: 'accent' },
        borderStrong: { cssVar: '--border-strong', type: 'color', group: 'accent' },

        // ============= TEXT GROUP =============
        textPrimary: { cssVar: '--text-primary', type: 'color', group: 'main' },
        textSecondary: { cssVar: '--text-secondary', type: 'color', group: 'text' },
        textMuted: { cssVar: '--text-muted', type: 'color', group: 'text' },
        settingsLabelColor: { cssVar: '--settings-label-color', type: 'color', group: 'text' },
        settingsSectionColor: { cssVar: '--settings-section-color', type: 'color', group: 'text' },
        buttonTextOnAccent: { cssVar: '--button-text-on-accent', type: 'color', group: 'text' },

        // ============= BORDER GROUP =============
        border: { cssVar: '--border', type: 'color', group: 'border' },
        bgGlassBorder: { cssVar: '--bg-glass-border', type: 'color', group: 'border' },

        // ============= STATUS GROUP =============
        success: { cssVar: '--success', type: 'color', group: 'status' },
        error: { cssVar: '--error', type: 'color', group: 'status' },
        warning: { cssVar: '--warning', type: 'color', group: 'status' },

        // ============= SHADOW/EFFECTS =============
        shadowSoft: { cssVar: '--shadow-soft', type: 'raw' },
        shadowCard: { cssVar: '--shadow-card', type: 'raw' },
        glow: { cssVar: '--glow', type: 'raw' },

        // ============= BUTTON TOKENS =============
        btnBg: { cssVar: '--btn-bg', type: 'color', group: 'button' },
        btnBgHover: { cssVar: '--btn-bg-hover', type: 'color', group: 'button' },
        btnBorder: { cssVar: '--btn-border', type: 'color', group: 'button' },
        btnText: { cssVar: '--btn-text', type: 'color', group: 'button' },
        btnTextHover: { cssVar: '--btn-text-hover', type: 'color', group: 'button' },
        btnPrimaryBg: { cssVar: '--btn-primary-bg', type: 'color', group: 'button' },
        btnPrimaryBgHover: { cssVar: '--btn-primary-bg-hover', type: 'color', group: 'button' },
        btnPrimaryText: { cssVar: '--btn-primary-text', type: 'color', group: 'button' },
        btnSuccessBg: { cssVar: '--btn-success-bg', type: 'color', group: 'button' },
        btnSuccessText: { cssVar: '--btn-success-text', type: 'color', group: 'button' },
        btnErrorBg: { cssVar: '--btn-error-bg', type: 'color', group: 'button' },
        btnErrorText: { cssVar: '--btn-error-text', type: 'color', group: 'button' },

        // ============= WELCOME BOX TOKENS =============
        welcomeBoxBg: { cssVar: '--welcome-box-bg', type: 'color', group: 'welcome' },
        welcomeBoxOpacity: { cssVar: '--welcome-box-opacity', type: 'opacity', group: 'welcome' },
        welcomeBtnBorder: { cssVar: '--welcome-btn-border', type: 'color', group: 'welcome' },
        welcomeBtnPrimaryBorder: { cssVar: '--welcome-btn-primary-border', type: 'color', group: 'welcome' },

        // ============= BACKGROUND IMAGES =============
        appBackground: { cssVar: '--app-bg-image', type: 'image' },
        editorBackground: { cssVar: '--editor-bg-image', type: 'image' },

        // ============= BRIGHTNESS =============
        bgBrightness: { cssVar: '--app-bg-brightness', type: 'brightness' },
        editorBgBrightness: { cssVar: '--editor-bg-brightness', type: 'brightness' },

        // ============= POSITIONS =============
        bgPosition: { cssVar: '--app-bg-position', type: 'position' },
        editorBgPosition: { cssVar: '--editor-bg-position', type: 'position' },

        // ============= OPACITY =============
        bgOpacity: { cssVar: '--app-bg-opacity', type: 'opacity' },
        editorBgOpacity: { cssVar: '--editor-bg-opacity', type: 'opacity' },
        terminalOpacity: { cssVar: '--terminal-opacity', type: 'opacity' },
        panelOpacity: { cssVar: '--panel-opacity', type: 'opacity' },

        // ============= BLUR =============
        bgBlur: { cssVar: '--app-bg-blur', type: 'blur' },
        editorBgBlur: { cssVar: '--editor-bg-blur', type: 'blur' },
        terminalBgBlur: { cssVar: '--terminal-bg-blur', type: 'blur' },

        // ============= SYNTAX COLORS =============
        syntaxKeyword: { cssVar: '--syntax-keyword', type: 'color', group: 'syntax' },
        syntaxString: { cssVar: '--syntax-string', type: 'color', group: 'syntax' },
        syntaxNumber: { cssVar: '--syntax-number', type: 'color', group: 'syntax' },
        syntaxType: { cssVar: '--syntax-type', type: 'color', group: 'syntax' },
        syntaxFunction: { cssVar: '--syntax-function', type: 'color', group: 'syntax' },
        syntaxVariable: { cssVar: '--syntax-variable', type: 'color', group: 'syntax' },
        syntaxComment: { cssVar: '--syntax-comment', type: 'color', group: 'syntax' },
        syntaxOperator: { cssVar: '--syntax-operator', type: 'color', group: 'syntax' },
        syntaxBracket: { cssVar: '--syntax-bracket', type: 'color', group: 'syntax' }
    },

    /**
     * Inheritance rules for variant keys
     * If variant not set, inherit from parent
     */
    inheritance: {
        'bgHeader-main': 'bgHeader',
        'bgHeader-statusbar': 'bgHeader',
        'bgPanel-problems': 'bgPanel',
        'bgPanel-input': 'bgPanel',
        'bgPanel-expected': 'bgPanel'
    },

    /**
     * Get CSS variable name for a key
     * @param {string} key - Token key
     * @returns {string|null} CSS variable name
     */
    getCssVar(key) {
        return this.definitions[key]?.cssVar || null;
    },

    /**
     * Get token type
     * @param {string} key - Token key
     * @returns {string} Token type
     */
    getType(key) {
        return this.definitions[key]?.type || 'raw';
    },

    /**
     * Get all keys
     * @returns {string[]} All token keys
     */
    getAllKeys() {
        return Object.keys(this.definitions);
    },

    /**
     * Get keys by group
     * @param {string} group - Group name
     * @returns {string[]} Keys in group
     */
    getKeysByGroup(group) {
        return Object.entries(this.definitions)
            .filter(([_, def]) => def.group === group)
            .map(([key, _]) => key);
    },

    /**
     * Build var mappings object (for backward compatibility)
     * @returns {Object} key -> cssVar mapping
     */
    getVarMappings() {
        const mappings = {};
        for (const [key, def] of Object.entries(this.definitions)) {
            mappings[key] = def.cssVar;
        }
        return mappings;
    },

    /**
     * Apply a single value to an element
     * Handles type-specific transformations (opacity, blur, image, etc.)
     * 
     * @param {HTMLElement} element - Target element
     * @param {string} key - Token key
     * @param {*} value - Raw value from theme
     */
    applyValue(element, key, value) {
        if (value === undefined || value === null) return;

        const def = this.definitions[key];
        if (!def) return;

        const cssVar = def.cssVar;
        const type = def.type;

        switch (type) {
            case 'image':
                if (value && value !== 'none' && !value.startsWith('url(')) {
                    if (value.startsWith('data:')) {
                        element.style.setProperty(cssVar, `url("${value}")`);
                    } else {
                        const escaped = value.replace(/'/g, "\\'");
                        element.style.setProperty(cssVar, `url('${escaped}')`);
                    }
                } else {
                    element.style.setProperty(cssVar, value || 'none');
                }
                break;

            case 'opacity':
                element.style.setProperty(cssVar, (parseFloat(value) / 100).toString());
                break;

            case 'brightness':
                element.style.setProperty(cssVar, (parseFloat(value) / 100).toString());
                break;

            case 'blur':
                element.style.setProperty(cssVar, `${parseInt(value)}px`);
                break;

            case 'position':
                element.style.setProperty(cssVar, value || 'center center');
                break;

            default:
                element.style.setProperty(cssVar, value);
        }
    },

    /**
     * Apply all colors from a theme to an element
     * This is the main function used by both ThemeManager and ThemeCustomizer
     * 
     * @param {HTMLElement} element - Target element (document.documentElement or preview wrapper)
     * @param {Object} colors - Theme colors object
     * @param {Object} options - Options { clearFirst: boolean }
     */
    applyToElement(element, colors, options = {}) {
        if (!element || !colors) return;

        if (options.clearFirst) {
            for (const def of Object.values(this.definitions)) {
                element.style.removeProperty(def.cssVar);
            }
        }

        for (const [key, value] of Object.entries(colors)) {
            this.applyValue(element, key, value);
        }

        for (const [childKey, parentKey] of Object.entries(this.inheritance)) {
            const hasChild = colors[childKey] !== undefined && colors[childKey] !== null;
            if (!hasChild && colors[parentKey]) {
                const inherited = childKey === 'bgHeader-statusbar'
                    ? toOpaque(colors[parentKey])
                    : colors[parentKey];
                this.applyValue(element, childKey, inherited);
            }
        }
    },

    /**
     * Apply syntax colors from theme editor config
     * 
     * @param {HTMLElement} element - Target element
     * @param {Object} syntax - Syntax colors object { keyword: { color }, ... }
     */
    applySyntax(element, syntax) {
        if (!element || !syntax) return;

        const syntaxKeys = ['keyword', 'string', 'number', 'type', 'function', 'comment', 'variable', 'operator', 'bracket'];
        for (const name of syntaxKeys) {
            const data = syntax[name];
            if (data?.color) {
                const hexColor = data.color.startsWith('#') ? data.color : '#' + data.color;
                element.style.setProperty(`--syntax-${name}`, hexColor);
            }
        }
    },

    /**
     * Fill all missing token defaults for a colors object (SSOT for defaults).
     * Derives missing values from related keys where possible, then falls back
     * to a literal. Order matters: dependents come after their sources.
     * Mutates `c` in place. (Moved verbatim from ThemeCustomizer._fillAllDefaults.)
     * @param {Object} c - theme.colors (mutated in place)
     */
    fillDefaults(c) {
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
     * Exposed version of toOpaque for external callers (ThemeCustomizer etc.)
     * Forces alpha channel to 1 on any rgb/rgba color string.
     * @param {string} color
     * @returns {string}
     */
    toOpaque
};

// Freeze for immutability
Object.freeze(ThemeTokens.definitions);
Object.freeze(ThemeTokens.inheritance);
Object.freeze(ThemeTokens);

// Make globally available
window.ThemeTokens = ThemeTokens;

console.log(`[ThemeTokens] Initialized with ${Object.keys(ThemeTokens.definitions).length} token definitions`);
