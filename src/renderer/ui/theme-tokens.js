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

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const isPlainObject = (value) => {
    if (value === null || typeof value !== 'object') return false;
    if (Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) return true;
    // Object literals crossing a VM/iframe boundary have a different
    // Object.prototype identity, but are still safe theme records.
    const constructor = prototype.constructor;
    return typeof constructor === 'function'
        && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object);
};

const cloneValue = (value) => {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (isPlainObject(value)) {
        const copy = {};
        for (const [key, child] of Object.entries(value)) copy[key] = cloneValue(child);
        return copy;
    }
    return value;
};

const toFiniteNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
};

const syntaxHexPattern = /^#?(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const colorHexPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const colorFunctionPattern = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(\s*([^()<>;]+)\s*\)$/i;
const colorKeywordPattern = /^(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|cyan|magenta|lime|navy|teal|olive|maroon|silver|aqua|fuchsia|transparent|currentcolor|rebeccapurple)$/i;
const customColorPattern = /^var\(\s*--[a-z0-9_-]+(?:\s*,\s*[^()<>;]+)?\s*\)$/i;

const isCssColor = (value) => {
    if (typeof value !== 'string') return false;
    const color = value.trim();
    if (!color || /[\u0000-\u001f<>]/.test(color)) return false;

    // Renderer validation gets the browser's actual CSS parser when available.
    // The Node-side fallback intentionally covers the formats used by saved themes.
    const cssApi = typeof CSS !== 'undefined' ? CSS : null;
    if (cssApi && typeof cssApi.supports === 'function') {
        try {
            return cssApi.supports('color', color);
        } catch (_) {
            // Fall through to the conservative parser below.
        }
    }

    const functionMatch = colorFunctionPattern.exec(color);
    const functionParts = functionMatch
        ? functionMatch[2].trim().split(/[,\s/]+/).filter(Boolean)
        : [];
    const functionName = functionMatch?.[1].toLowerCase();
    const validFunction = functionMatch && (
        (/^rgba?$/.test(functionName) || /^hsla?$/.test(functionName))
            ? functionParts.length >= 3 && functionParts.length <= 4
            : functionParts.length >= 2
    );

    return colorHexPattern.test(color)
        || validFunction
        || colorKeywordPattern.test(color)
        || customColorPattern.test(color);
};

const isImageValue = (value) => {
    if (typeof value !== 'string') return false;
    const image = value.trim();
    // An empty string is the persisted explicit-clear sentinel. Missing keys
    // still mean "use the builtin/default background" to ThemeManager.
    if (image === '') return value === '';
    if (/[\u0000-\u001f<>]/.test(image)) return false;
    if (image === 'none') return true;
    if (/^url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)$/i.test(image)) return true;
    if (/^data:(?:image|video)\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(image)) return true;
    if (/^(?:https?|file|blob|app):\/\//i.test(image)) return true;
    // Theme assets are stored as relative paths; local absolute paths are accepted
    // for imported themes and are resolved by the caller before CSS is applied.
    return /^(?:\.\.?(?:[\\/])|[a-z]:[\\/]|[^\\/:<>"\u0000-\u001f]+(?:[\\/][^<>"\u0000-\u001f]+)*)$/i.test(image);
};

const positionPartPattern = '(?:left|center|right|top|bottom|[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:%|px|em|rem|vh|vw|vmin|vmax)?|calc\\([^;{}]+\\))';
const positionPattern = new RegExp(`^${positionPartPattern}(?:\\s+${positionPartPattern})?$`, 'i');

const isBackgroundPosition = (value) => {
    return typeof value === 'string' && positionPattern.test(value.trim());
};

const editorColorKeys = [
    'background', 'foreground', 'lineHighlight', 'selection', 'cursor',
    'lineNumber', 'lineNumberActive', 'scrollbar', 'scrollbarHover', 'scrollbarActive'
];

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
        // Status extras — load-bearing per-theme tokens moved out of themes.css
        // (no `group`: applied inline but not shown in the grouped color pickers).
        successDark: { cssVar: '--success-dark', type: 'color' },
        successHover: { cssVar: '--success-hover', type: 'color' },
        errorDark: { cssVar: '--error-dark', type: 'color' },
        danger: { cssVar: '--danger', type: 'color' },

        // ============= EXPLORER / MISC (moved from themes.css [data-theme]) =============
        folderIconClosed: { cssVar: '--folder-icon-closed', type: 'color' },
        folderIconOpen: { cssVar: '--folder-icon-open', type: 'color' },
        borderGlassEdge: { cssVar: '--border-glass-edge', type: 'color' },
        terminalText: { cssVar: '--terminal-text', type: 'color' },

        // Terminal line-type colors (success/error/warning/info/system/input).
        // Previously hardcoded in theme.css/.themes.css → now token-driven so
        // custom themes and the customizer preview follow the real terminal.
        termLineSuccess: { cssVar: '--term-line-success', type: 'color', group: 'terminal' },
        termLineError:   { cssVar: '--term-line-error',   type: 'color', group: 'terminal' },
        termLineWarning: { cssVar: '--term-line-warning', type: 'color', group: 'terminal' },
        termLineInfo:    { cssVar: '--term-line-info',    type: 'color', group: 'terminal' },
        termLineSystem:  { cssVar: '--term-line-system',  type: 'color', group: 'terminal' },
        termLineInput:   { cssVar: '--term-line-input',   type: 'color', group: 'terminal' },

        // Test/verdict result colors (pass/fail/pending). Base rules fall back to
        // success/danger/text-secondary so builtins are unchanged; sakura sets the
        // darker on-light values it used to hardcode.
        testPass:    { cssVar: '--test-pass',    type: 'color', group: 'status' },
        testFail:    { cssVar: '--test-fail',    type: 'color', group: 'status' },
        testPending: { cssVar: '--test-pending', type: 'color', group: 'status' },

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
     * Normalize legacy `{ meta: {...}, colors, editor, terminal }` themes and
     * the current flat draft shape into one non-mutating representation.
     * Missing optional sections are kept empty so callers can fill defaults
     * after validation without changing the source object.
     *
     * @param {Object} theme - Theme JSON object
     * @returns {Object} Canonical flat theme draft
     */
    normalizeTheme(theme) {
        if (!isPlainObject(theme)) return theme;

        const meta = isPlainObject(theme.meta) ? theme.meta : {};
        const read = (key) => theme[key] !== undefined ? theme[key] : meta[key];
        const normalized = {};

        for (const key of ['id', 'name', 'author', 'type', 'version', 'description', 'tags']) {
            const value = read(key);
            if (value !== undefined) normalized[key] = cloneValue(value);
        }

        normalized.colors = theme.colors === undefined ? undefined : cloneValue(theme.colors);
        normalized.editor = cloneValue(theme.editor === undefined ? {} : theme.editor);
        normalized.terminal = cloneValue(theme.terminal === undefined ? {} : theme.terminal);

        // Sliders historically serialized numbers as strings in a few paths.
        // Normalize only typed numeric tokens; leave unknown legacy values alone.
        if (isPlainObject(normalized.colors)) {
            for (const [key, definition] of Object.entries(this.definitions)) {
                if (!['opacity', 'brightness', 'blur'].includes(definition.type)) continue;
                if (!hasOwn(normalized.colors, key)) continue;
                const number = toFiniteNumber(normalized.colors[key]);
                if (number !== null) {
                    // Early custom themes stored welcome opacity as a CSS alpha
                    // (0.4) while all current opacity tokens use percentages.
                    normalized.colors[key] = key === 'welcomeBoxOpacity' && number > 0 && number < 1
                        ? number * 100
                        : number;
                }
            }
        }

        return normalized;
    },

    /**
     * Validate a theme without requiring every token to be present. Builtins
     * and old user themes intentionally omit many optional tokens; callers can
     * run fillDefaults() after this check. The result is stable and suitable
     * for displaying in an import/customizer error message.
     *
     * @param {Object} theme - Theme JSON object, flat or legacy meta-shaped
     * @returns {{valid: boolean, errors: string[]}}
     */
    validateTheme(theme) {
        const errors = [];
        if (!isPlainObject(theme)) {
            return { valid: false, errors: ['theme must be an object'] };
        }

        const normalized = this.normalizeTheme(theme);
        const add = (path, message) => errors.push(`${path} ${message}`);

        const validateText = (value, path, required = false) => {
            if (value === undefined || value === null) {
                if (required) add(path, 'must be a non-empty string');
                return;
            }
            if (typeof value !== 'string' || (required && !value.trim()) || /[\u0000-\u001f]/.test(value)) {
                add(path, 'must be a non-empty string');
            }
        };

        // ID and name identify the persisted theme. Other metadata is optional
        // for legacy themes and is validated only when it is supplied.
        validateText(normalized.id, 'id', true);
        validateText(normalized.name, 'name', true);
        validateText(normalized.author, 'author');
        validateText(normalized.type, 'type');
        validateText(normalized.version, 'version');
        validateText(normalized.description, 'description');
        if (typeof normalized.type === 'string' && normalized.type.trim()
            && !['dark', 'light'].includes(normalized.type.trim().toLowerCase())) {
            add('type', 'must be dark or light');
        }
        if (normalized.tags !== undefined && (!Array.isArray(normalized.tags)
            || normalized.tags.some(tag => typeof tag !== 'string'))) {
            add('tags', 'must be an array of strings');
        }

        if (!isPlainObject(normalized.colors)) {
            add('colors', 'must be an object');
        } else {
            for (const [key, value] of Object.entries(normalized.colors)) {
                const definition = this.definitions[key];
                if (!definition || value === undefined || value === null) continue;

                switch (definition.type) {
                    case 'color':
                        if (!isCssColor(value)) add(`colors.${key}`, 'must be a valid CSS color');
                        break;
                    case 'opacity': {
                        const opacity = toFiniteNumber(value);
                        if (opacity === null || opacity < 0 || opacity > 100) {
                            add(`colors.${key}`, 'must be a number from 0 to 100');
                        }
                        break;
                    }
                    case 'brightness': {
                        const brightness = toFiniteNumber(value);
                        if (brightness === null || brightness < 0 || brightness > 200) {
                            add(`colors.${key}`, 'must be a number from 0 to 200');
                        }
                        break;
                    }
                    case 'blur': {
                        const blur = toFiniteNumber(value);
                        if (blur === null || blur < 0 || blur > 100) {
                            add(`colors.${key}`, 'must be a number from 0 to 100');
                        }
                        break;
                    }
                    case 'image':
                        if (!isImageValue(value)) add(`colors.${key}`, 'must be a valid image or video URL');
                        break;
                    case 'position':
                        if (!isBackgroundPosition(value)) add(`colors.${key}`, 'must be a valid background position');
                        break;
                    case 'raw':
                        if (typeof value !== 'string') add(`colors.${key}`, 'must be a string');
                        break;
                    default:
                        break;
                }
            }
        }

        if (!isPlainObject(normalized.editor)) {
            add('editor', 'must be an object');
        } else {
            for (const key of editorColorKeys) {
                if (normalized.editor[key] !== undefined && !isCssColor(normalized.editor[key])) {
                    add(`editor.${key}`, 'must be a valid CSS color');
                }
            }
            if (normalized.editor.base !== undefined) validateText(normalized.editor.base, 'editor.base');
            if (normalized.editor.inherit !== undefined && typeof normalized.editor.inherit !== 'boolean') {
                add('editor.inherit', 'must be a boolean');
            }

            const syntax = normalized.editor.syntax;
            if (syntax !== undefined && !isPlainObject(syntax)) {
                add('editor.syntax', 'must be an object');
            } else if (isPlainObject(syntax)) {
                for (const [key, entry] of Object.entries(syntax)) {
                    if (!isPlainObject(entry)) {
                        add(`editor.syntax.${key}`, 'must be an object');
                        continue;
                    }
                    if (typeof entry.color !== 'string' || !syntaxHexPattern.test(entry.color)) {
                        add(`editor.syntax.${key}.color`, 'must be a hexadecimal color');
                    }
                    if (entry.fontStyle !== undefined
                        && (typeof entry.fontStyle !== 'string' || !/^[a-z ]+$/i.test(entry.fontStyle))) {
                        add(`editor.syntax.${key}.fontStyle`, 'must be a CSS font style string');
                    }
                }
            }
        }

        if (!isPlainObject(normalized.terminal)) add('terminal', 'must be an object');

        return { valid: errors.length === 0, errors };
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
                if (typeof value !== 'string') return;
                if (value && value !== 'none' && !value.startsWith('url(')) {
                    if (value.startsWith('data:')) {
                        element.style.setProperty(cssVar, `url("${value}")`);
                    } else {
                        // A relative path ("assets/backgrounds/x.jpg") inside a custom property
                        // resolves against the stylesheet that uses it (styles/base.css), not the
                        // page, so it pointed at styles/assets/... and the image never loaded.
                        const isRelative = !/^([a-z][a-z0-9+.-]*:|[\\/])/i.test(value);
                        const url = isRelative ? new URL(value, document.baseURI).href : value;
                        const escaped = url.replace(/'/g, "\\'");
                        element.style.setProperty(cssVar, `url('${escaped}')`);
                    }
                } else {
                    element.style.setProperty(cssVar, value || 'none');
                }
                break;

            case 'opacity': {
                const opacity = toFiniteNumber(value);
                if (opacity === null || opacity < 0 || opacity > 100) return;
                element.style.setProperty(cssVar, (opacity / 100).toString());
                break;
            }

            case 'brightness': {
                const brightness = toFiniteNumber(value);
                if (brightness === null || brightness < 0 || brightness > 200) return;
                element.style.setProperty(cssVar, (brightness / 100).toString());
                break;
            }

            case 'blur': {
                const blur = toFiniteNumber(value);
                if (blur === null || blur < 0 || blur > 100) return;
                element.style.setProperty(cssVar, `${blur}px`);
                break;
            }

            case 'position':
                if (typeof value !== 'string') return;
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
            if (data && typeof data.color === 'string' && syntaxHexPattern.test(data.color)) {
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
        if (!isPlainObject(c)) return c;

        const legacyWelcomeOpacity = toFiniteNumber(c.welcomeBoxOpacity);
        if (legacyWelcomeOpacity !== null && legacyWelcomeOpacity > 0 && legacyWelcomeOpacity < 1) {
            c.welcomeBoxOpacity = legacyWelcomeOpacity * 100;
        }

        // References are explicit so a literal such as '#ffffff' or 'rgba(...)'
        // can never be mistaken for a token key. This also keeps future token names
        // from silently changing the meaning of an existing literal fallback.
        const ref = (key) => ({ __themeTokenRef: key });
        const d = (key, ...fallbacks) => {
            if (c[key] !== undefined && c[key] !== null) return;
            for (const f of fallbacks) {
                if (f && typeof f === 'object' && hasOwn(f, '__themeTokenRef')) {
                    const sourceKey = f.__themeTokenRef;
                    if (c[sourceKey] !== undefined && c[sourceKey] !== null) {
                        c[key] = c[sourceKey];
                        return;
                    }
                    continue;
                }
                c[key] = f;
                return;
            }
        };

        // Numeric / effect defaults
        d('bgOpacity',           50);
        d('bgBrightness',        100);
        d('bgBlur',              0);
        d('editorBgOpacity',     15);
        d('editorBgBrightness',  100);
        d('editorBgBlur',        0);
        d('terminalOpacity',     100);
        d('panelOpacity',        100);
        d('welcomeBoxOpacity',   40);

        // Derived color defaults — order matters (dependents after their sources)
        d('accentHover',             ref('accent'), '#5eb7e0');
        d('borderStrong',            ref('accent'), '#88c9ea');
        d('bgGlassBorder',           ref('border'), ref('borderStrong'), '#3a6075');
        d('bgBase',                  ref('bgOceanDark'), ref('editorBg'), '#0d1a25');
        d('bgSurface',               ref('bgOceanLight'), ref('bgPanel'), '#1a3a50');
        d('buttonTextOnAccent',      '#ffffff');
        d('settingsLabelColor',      ref('textSecondary'), ref('textPrimary'), '#a0c0d0');
        d('settingsSectionColor',    ref('accent'), '#88c9ea');
        d('bgButton',                ref('bgOceanLight'), '#243040');
        d('bgButtonHover',           ref('bgOceanMedium'), '#3a5060');

        // Button tokens
        d('btnBg',                   ref('bgButton'),      'rgba(255, 255, 255, 0.1)');
        d('btnBgHover',              ref('bgButtonHover'), ref('bgOceanLight'), 'rgba(255, 255, 255, 0.15)');
        d('btnBorder',               ref('border'),        '#a0c8e0');
        d('btnText',                 ref('textPrimary'),   ref('textSecondary'), '#e0f0ff');
        d('btnTextHover',            ref('accent'),        '#88c9ea');
        d('btnPrimaryBg',            ref('accent'),        ref('bgOceanDeep'), '#4a9bc9');
        d('btnPrimaryBgHover',       ref('accentHover'),   ref('bgOceanMedium'), '#3a8ab8');
        d('btnPrimaryText',          ref('buttonTextOnAccent'), '#ffffff');
        d('btnSuccessBg',            ref('success'),       '#50fa7b');
        d('btnSuccessText',          ref('buttonTextOnAccent'), '#ffffff');
        d('btnErrorBg',              ref('error'),         '#ff5555');
        d('btnErrorText',            ref('buttonTextOnAccent'), '#ffffff');

        // Welcome box tokens
        d('welcomeBoxBg',            ref('bgGlass'), ref('bgPanel'), 'rgba(37, 64, 90, 0.4)');
        d('welcomeBtnBorder',        ref('borderStrong'), ref('border'), '#88c9ea');
        d('welcomeBtnPrimaryBorder', ref('accent'), '#88c9ea');

        // Load-bearing tokens promoted from themes.css in Phase 06. Defaults match
        // the exact theme.css :root / usage fallback each resolves to today, so a
        // theme missing them keeps rendering identically — just now self-contained.
        d('successDark',      '#1b7d3f');
        d('successHover',     '#219150');
        d('errorDark',        '#a8071a');
        d('danger',           ref('error'), '#d84860');
        d('folderIconClosed', '#f0c674');
        d('folderIconOpen',   '#f5b942');
        d('borderGlassEdge',  'rgba(255, 255, 255, 0.4)');
        d('terminalText',     '#e0f0ff');

        // Terminal line-type defaults = the dark palette that theme.css hardcoded.
        d('termLineSuccess',  '#98c379');
        d('termLineError',    '#e06c75');
        d('termLineWarning',  '#e5c07b');
        d('termLineInfo',     '#61afef');
        d('termLineSystem',   '#5c6370');
        d('termLineInput',    '#56b6c2');

        // Test result colors inherit the theme's semantic colors by default.
        d('testPass',    ref('success'), '#2ecc71');
        d('testFail',    ref('error'),   '#e74c3c');
        d('testPending', ref('textSecondary'), '#7f8c8d');

        return c;
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

// Make globally available in the renderer and importable in isolated Node tests.
if (typeof module !== 'undefined' && module.exports) module.exports = ThemeTokens;
else window.ThemeTokens = ThemeTokens;

