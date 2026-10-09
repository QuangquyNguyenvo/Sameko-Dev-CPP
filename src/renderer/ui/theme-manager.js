/**
 * C++ IDE - Theme Manager (v2.0)
 * 
 * JSON-based theme system with Import/Export support.
 * Handles theme registration, application, and CSS/Monaco synchronization.
 * 
 * @author Sameko Team
 */

const ThemeManager = {
    // Registry of all loaded themes
    themes: new Map(),

    // Persistent theme documents live under userData/state.  The localStorage
    // keys below remain as a one-way migration/fallback for profiles created
    // before the state store existed.
    THEME_STATE_NAME: 'themes',
    // Kept as an alias for older callers; theme and builtin-background data
    // now share one atomic `themes` state document.
    BACKGROUND_STATE_NAME: 'themes',
    LEGACY_THEME_STORAGE_KEY: 'sameko-user-themes',

    // Saves are deliberately serialized.  Asset externalization is async, so
    // a plain Promise.all over the current registry can otherwise let an older
    // save complete after a newer delete/edit and resurrect stale data.
    _themeSaveQueue: Promise.resolve(),
    _themeSaveRevision: 0,
    _backgroundSaveRevision: 0,
    backgroundOverrides: Object.create(null),
    backgroundOverridesLoaded: false,
    _themeStateLoaded: false,
    _themeStateReadFailed: false,
    _themeStateAvailable: false,
    _themeStateDocument: null,
    _legacyThemesFound: false,

    // Current active theme ID
    activeThemeId: null,

    // User customization overrides
    userOverrides: {},

    builtinThemeIds: [
        'kawaii-dark',
        'kawaii-light',
        'sakura',
        'dracula',
        'monokai',
        'nord'
    ],

    /**
     * Initialize Theme Manager
     */
    async init() {

        this._loadAllHardcodedThemes();
        await this.loadUserThemes();
        await this.loadBackgroundOverrides();
        await this._migrateLegacyState();
    },

    /**
     * Load all hardcoded themes immediately
     */
    _loadAllHardcodedThemes() {
        const hardcoded = this._getHardcodedThemes();
        for (const themeId of this.builtinThemeIds) {
            if (hardcoded[themeId]) {
                this.registerTheme(hardcoded[themeId]);
            }
        }
    },

    /**
     * Restore a built-in theme to its hardcoded definition
     */
    _restoreBuiltinTheme(themeId) {
        const hardcoded = this._getHardcodedThemes();
        if (hardcoded[themeId]) {
            this.registerTheme(hardcoded[themeId], true);
        }
    },

    /**
     * Restore all built-in themes to hardcoded defaults
     */
    restoreAllBuiltinThemes() {
        this.builtinThemeIds.forEach(id => this._restoreBuiltinTheme(id));
    },

    /**
     * Hardcoded theme definitions
     */
    _getHardcodedThemes() {
        return {
            'kawaii-dark': {
                meta: { id: 'kawaii-dark', name: 'Kawaii Dark', type: 'dark' },
                colors: {
                    appBackground: 'assets/backgrounds/darkblue.webm',
                    appOverlay: '26, 37, 48',
                    bgOceanLight: '#1a3a50',
                    bgOceanMedium: '#152535',
                    bgOceanDeep: '#88c9ea',
                    bgOceanDark: '#0d1a25',
                    bgGlass: 'rgba(26, 37, 48, 0.95)',
                    bgGlassHeavy: 'rgba(21, 37, 53, 0.97)',
                    bgGlassBorder: 'rgba(58, 96, 117, 0.8)',
                    accent: '#88c9ea',
                    accentHover: '#5eb7e0',
                    textPrimary: '#e0f0ff',
                    textSecondary: '#a0c0d0',
                    textMuted: '#7990a0',
                    success: '#7dcea0',
                    error: '#ff6b6b',
                    warning: '#fcd5ce',
                    border: '#3a6075',
                    borderStrong: '#88c9ea',
                    shadowSoft: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    shadowCard: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    glow: '0 0 15px rgba(136, 201, 234, 0.4)',
                    bgHeader: 'rgba(21, 37, 53, 0.4)',
                    bgPanel: 'rgba(26, 37, 48, 0.95)',
                    bgInput: '#1a2a3a',
                    bgButton: '#243040',
                    bgButtonHover: '#3a5060',
                    editorBg: '#1a2530',
                    terminalBg: '#152535',
                    settingsLabelColor: '#a0c0d0',
                    settingsSectionColor: '#88c9ea',
                    buttonTextOnAccent: '#ffffff',
                    btnBg: 'rgba(255, 255, 255, 0.1)',
                    btnBgHover: 'rgba(255, 255, 255, 0.15)',
                    btnBorder: '#3a6075',
                    btnText: '#e0f0ff',
                    btnTextHover: '#88c9ea',
                    btnPrimaryBg: '#88c9ea',
                    btnPrimaryBgHover: '#5eb7e0',
                    btnPrimaryText: '#ffffff',
                    // Load-bearing tokens moved from themes.css [data-theme] (Phase 06)
                    successDark: '#4caf50',
                    successHover: '#45a045',
                    errorDark: '#ff4444',
                    borderGlassEdge: 'rgba(255, 255, 255, 0.1)',
                    welcomeBoxBg: 'rgba(37, 64, 90, 0.4)'
                },
                editor: {
                    base: 'vs-dark', inherit: true,
                    background: '#1a2530', foreground: '#e0f0ff',
                    syntax: {
                        comment: { color: '6a8a9a', fontStyle: 'italic' },
                        keyword: { color: '88c9ea' },
                        string: { color: 'a3d9a5' },
                        escape: { color: 'ebcb8b', fontStyle: 'bold' },
                        number: { color: 'ebcb8b' },
                        type: { color: 'e8a8b8' },
                        function: { color: '7ec8e3' },
                        variable: { color: '9cdcfe' },
                        operator: { color: 'e0f0ff' },
                        bracket: { color: 'ffd700' }
                    }
                }
            },
            'kawaii-light': {
                meta: { id: 'kawaii-light', name: 'Kawaii Light', type: 'light' },
                colors: {
                    appBackground: 'assets/backgrounds/background.jpg',
                    appOverlay: '255, 255, 255',
                    bgOceanLight: '#e8f4fc',
                    bgOceanMedium: '#d0e8f5',
                    bgOceanDeep: '#4a9bc9',
                    bgOceanDark: '#2a7ab0',
                    bgGlass: 'rgba(232, 244, 252, 0.95)',
                    bgGlassHeavy: 'rgba(208, 232, 245, 0.97)',
                    bgGlassBorder: 'rgba(74, 155, 201, 0.5)',
                    accent: '#4a9bc9',
                    accentHover: '#3a8ab8',
                    textPrimary: '#2a4a5a',
                    textSecondary: '#4a6a7a',
                    textMuted: '#7a9aaa',
                    success: '#5dbe8a',
                    error: '#e55a5a',
                    warning: '#e5a05a',
                    border: '#b9dcf0',
                    borderStrong: '#4a9bc9',
                    shadowSoft: '0 8px 32px rgba(74, 155, 201, 0.2)',
                    shadowCard: '0 4px 12px rgba(74, 155, 201, 0.15)',
                    glow: '0 0 15px rgba(74, 155, 201, 0.3)',
                    bgHeader: 'rgba(208, 232, 245, 0.4)',
                    bgPanel: 'rgba(244, 250, 255, 0.96)',
                    bgInput: '#ffffff',
                    bgButton: '#eef7fd',
                    bgButtonHover: '#d0e8f5',
                    // A light editor and terminal: they used to be kawaii-dark's navy, a dark
                    // block in the middle of a light theme.
                    editorBg: '#fbfdff',
                    terminalBg: '#f3f9fe',
                    terminalText: '#2a4a5a',
                    settingsLabelColor: '#4a6a7a',
                    settingsSectionColor: '#4a9bc9',
                    buttonTextOnAccent: '#ffffff',
                    btnBg: '#ffffff',
                    btnBgHover: '#e8f4fc',
                    btnBorder: '#a0c8e0',
                    btnText: '#2a4a5a',
                    btnTextHover: '#4a9bc9',
                    btnPrimaryBg: '#4a9bc9',
                    btnPrimaryBgHover: '#3a8ab8',
                    btnPrimaryText: '#ffffff',
                    // Terminal line colors — kawaii-light overrides (were the
                    // [data-theme="kawaii-light"] .terminal-body .line.* rules).
                    termLineSuccess: '#3f9a6a',
                    termLineError: '#d6496b',
                    termLineWarning: '#c98a2a',
                    termLineInfo: '#2f86b8',
                    termLineSystem: '#7a9aaa',
                    termLineInput: '#2f9fb5'
                },
                editor: {
                    base: 'vs', inherit: true,
                    background: '#fbfdff', foreground: '#2a4a5a',
                    lineHighlight: '#eef7fd',
                    selection: '#cfe6f5',
                    cursor: '#4a9bc9',
                    lineNumber: '#a8c4d4',
                    lineNumberActive: '#4a9bc9',
                    // Pastel hues dark enough to read on white.
                    syntax: {
                        comment: { color: '8aa8b8', fontStyle: 'italic' },
                        keyword: { color: 'd6608a' },
                        string: { color: '3f9a6a' },
                        escape: { color: 'c98a2a', fontStyle: 'bold' },
                        number: { color: 'c27a2a' },
                        type: { color: '7a6ad0' },
                        function: { color: '2f86b8' },
                        variable: { color: '2a4a5a' },
                        operator: { color: '5a7a8a' },
                        bracket: { color: 'd99a20' }
                    }
                }
            },
            'sakura': {
                meta: { id: 'sakura', name: 'Sakura', type: 'light' },
                colors: {
                    appBackground: 'assets/backgrounds/pink.webm',
                    appOverlay: '255, 240, 245',
                    bgOceanLight: '#fff5f8',
                    bgOceanMedium: '#ffe4e1',
                    bgOceanDeep: '#ffb7c5',
                    bgOceanDark: '#e097a8',
                    bgGlass: 'rgba(255, 245, 250, 0.92)',
                    bgGlassHeavy: 'rgba(255, 228, 225, 0.97)',
                    bgGlassBorder: 'rgba(255, 182, 193, 0.6)',
                    accent: '#ff9aaf',
                    accentHover: '#ff758f',
                    textPrimary: '#5d4a4d',
                    textSecondary: '#8b5f65',
                    textMuted: '#bc8f8f',
                    success: '#b8e2b8',
                    error: '#ffb3b3',
                    warning: '#fff9c4',
                    border: '#ffcad4',
                    borderStrong: '#ffb7c5',
                    shadowSoft: '0 8px 32px rgba(255, 182, 193, 0.25)',
                    shadowCard: '0 4px 12px rgba(255, 105, 180, 0.15)',
                    glow: '0 0 15px rgba(255, 182, 193, 0.4)',
                    bgHeader: 'rgba(255, 228, 225, 0.4)',
                    bgPanel: 'rgba(255, 245, 248, 0.95)',
                    bgInput: '#fffafa',
                    bgButton: '#fff0f5',
                    bgButtonHover: '#ffe4e1',
                    editorBg: '#2d1f2f',
                    terminalBg: '#251a26',
                    settingsLabelColor: '#8b5f65',
                    settingsSectionColor: '#ff9aaf',
                    buttonTextOnAccent: '#ffffff',
                    btnBg: '#fff0f5',
                    btnBgHover: '#ffe4e1',
                    btnBorder: '#ffcad4',
                    btnText: '#5d4a4d',
                    btnTextHover: '#ff9aaf',
                    btnPrimaryBg: '#ff9aaf',
                    btnPrimaryBgHover: '#ff758f',
                    btnPrimaryText: '#ffffff',
                    // Load-bearing tokens moved from themes.css [data-theme] (Phase 06)
                    successDark: '#4caf50',
                    successHover: '#45a045',
                    errorDark: '#e06060',
                    danger: '#d84860',
                    folderIconClosed: '#ffb7c5',
                    folderIconOpen: '#ff9aaf',
                    terminalText: '#f8e8f0',
                    // Sakura test-result colors — darker text for its light bg
                    // (were the [data-theme="sakura"] .test-* hardcodes).
                    testPass: '#2d8a2d',
                    testFail: '#c0392b',
                    testPending: '#7f8c8d',
                    welcomeBoxBg: 'rgba(255, 182, 193, 0.4)'
                },
                editor: {
                    base: 'vs-dark', inherit: true,
                    background: '#2d1f2f', foreground: '#f8e8f0',
                    lineHighlight: '#3d2a3f',
                    selection: '#5d3a5f',
                    cursor: '#ff69b4',
                    lineNumber: '#6d5060',
                    lineNumberActive: '#ff69b4',
                    syntax: {
                        comment: { color: '8b7080', fontStyle: 'italic' },
                        keyword: { color: 'ff69b4' },
                        string: { color: '98d998' },
                        escape: { color: 'da75e3', fontStyle: 'bold' },
                        number: { color: 'da75e3' },
                        type: { color: 'ffb7c5', fontStyle: 'italic' },
                        function: { color: 'ffb07a' },
                        variable: { color: 'f8e8f0' },
                        operator: { color: 'ff69b4' }
                    }
                }
            },
            'dracula': {
                meta: { id: 'dracula', name: 'Dracula', type: 'dark' },
                colors: {
                    appBackground: 'assets/backgrounds/dracula.webm',
                    appOverlay: '40, 42, 54',
                    bgOceanLight: '#44475a',
                    bgOceanMedium: '#383a59',
                    bgOceanDeep: '#bd93f9',
                    bgOceanDark: '#21222c',
                    bgGlass: 'rgba(40, 42, 54, 0.95)',
                    bgGlassHeavy: 'rgba(33, 34, 44, 0.97)',
                    bgGlassBorder: 'rgba(68, 71, 90, 0.9)',
                    accent: '#ff79c6',
                    accentHover: '#ff92d0',
                    textPrimary: '#f8f8f2',
                    textSecondary: '#bd93f9',
                    textMuted: '#6272a4',
                    success: '#50fa7b',
                    error: '#ff5555',
                    warning: '#ffb86c',
                    border: '#6272a4',
                    borderStrong: '#bd93f9',
                    shadowSoft: '0 8px 32px rgba(0, 0, 0, 0.5)',
                    shadowCard: '0 4px 12px rgba(0, 0, 0, 0.4)',
                    glow: '0 0 15px rgba(189, 147, 249, 0.4)',
                    bgHeader: 'rgba(33, 34, 44, 0.4)',
                    bgPanel: 'rgba(40, 42, 54, 0.95)',
                    bgInput: '#282a36',
                    bgButton: '#44475a',
                    bgButtonHover: '#6272a4',
                    editorBg: '#282a36',
                    terminalBg: '#21222c',
                    settingsLabelColor: '#f8f8f2',
                    settingsSectionColor: '#bd93f9',
                    buttonTextOnAccent: '#ffffff',
                    btnBg: 'rgba(255, 255, 255, 0.1)',
                    btnBgHover: 'rgba(255, 255, 255, 0.15)',
                    btnBorder: '#6272a4',
                    btnText: '#f8f8f2',
                    btnTextHover: '#ff79c6',
                    btnPrimaryBg: '#ff79c6',
                    btnPrimaryBgHover: '#ff92d0',
                    btnPrimaryText: '#ffffff',
                    // Load-bearing tokens moved from themes.css [data-theme] (Phase 06)
                    successDark: '#2ecc71',
                    successHover: '#27ae60',
                    errorDark: '#ff3333',
                    folderIconClosed: '#f1fa8c',
                    folderIconOpen: '#ffb86c',
                    borderGlassEdge: 'rgba(255, 255, 255, 0.1)',
                    welcomeBoxBg: 'rgba(40, 42, 54, 0.4)'
                },
                editor: {
                    base: 'vs-dark', inherit: true,
                    background: '#282a36', foreground: '#f8f8f2',
                    syntax: {
                        comment: { color: '6272a4', fontStyle: 'italic' },
                        keyword: { color: 'ff79c6' },
                        string: { color: 'f1fa8c' },
                        escape: { color: 'ff79c6', fontStyle: 'bold' },
                        number: { color: 'bd93f9' },
                        type: { color: '8be9fd', fontStyle: 'italic' },
                        function: { color: '50fa7b' }
                    }
                }
            },
            'monokai': {
                meta: { id: 'monokai', name: 'Monokai', type: 'dark' },
                colors: {
                    appBackground: 'assets/backgrounds/monokai.webm',
                    appOverlay: '39, 40, 34',
                    bgOceanLight: '#3e3d32',
                    bgOceanMedium: '#272822',
                    bgOceanDeep: '#a6e22e',
                    bgOceanDark: '#1e1f1c',
                    bgGlass: 'rgba(39, 40, 34, 0.95)',
                    bgGlassHeavy: 'rgba(30, 31, 28, 0.97)',
                    bgGlassBorder: 'rgba(62, 61, 50, 0.9)',
                    accent: '#a6e22e',
                    accentHover: '#b8f32e',
                    textPrimary: '#f8f8f2',
                    textSecondary: '#a6e22e',
                    textMuted: '#75715e',
                    success: '#a6e22e',
                    error: '#f92672',
                    warning: '#e6db74',
                    border: '#49483e',
                    borderStrong: '#a6e22e',
                    shadowSoft: '0 8px 32px rgba(0, 0, 0, 0.5)',
                    shadowCard: '0 4px 12px rgba(0, 0, 0, 0.4)',
                    glow: '0 0 15px rgba(166, 226, 46, 0.4)',
                    bgHeader: 'rgba(30, 31, 28, 0.4)',
                    bgPanel: 'rgba(39, 40, 34, 0.95)',
                    bgInput: '#272822',
                    bgButton: '#3e3d32',
                    bgButtonHover: '#49483e',
                    editorBg: '#272822',
                    terminalBg: '#1e1f1c',
                    settingsLabelColor: '#f8f8f2',
                    settingsSectionColor: '#a6e22e',
                    buttonTextOnAccent: '#272822',

                    btnBg: 'rgba(255, 255, 255, 0.08)',
                    btnBgHover: 'rgba(255, 255, 255, 0.12)',
                    btnBorder: '#49483e',
                    btnText: '#f8f8f2',
                    btnTextHover: '#a6e22e',
                    btnPrimaryBg: '#a6e22e',
                    btnPrimaryBgHover: '#b8f32e',
                    btnPrimaryText: '#272822',
                    // Load-bearing tokens moved from themes.css [data-theme] (Phase 06)
                    successDark: '#8cc919',
                    successHover: '#7ab918',
                    errorDark: '#d91862',
                    folderIconClosed: '#e6db74',
                    folderIconOpen: '#fd971f',
                    borderGlassEdge: 'rgba(255, 255, 255, 0.1)',
                    welcomeBoxBg: 'rgba(39, 40, 34, 0.4)'
                },
                editor: {
                    base: 'vs-dark', inherit: true,
                    background: '#272822', foreground: '#f8f8f2',
                    syntax: {
                        comment: { color: '75715e', fontStyle: 'italic' },
                        keyword: { color: 'f92672' },
                        string: { color: 'e6db74' },
                        escape: { color: 'ae81ff', fontStyle: 'bold' },
                        number: { color: 'ae81ff' },
                        type: { color: '66d9ef', fontStyle: 'italic' },
                        function: { color: 'a6e22e' }
                    }
                }
            },
            'nord': {
                meta: { id: 'nord', name: 'Nord', type: 'dark' },
                colors: {
                    appBackground: 'assets/backgrounds/nord.webm',
                    appOverlay: '46, 52, 64',
                    bgOceanLight: '#3b4252',
                    bgOceanMedium: '#2e3440',
                    bgOceanDeep: '#88c0d0',
                    bgOceanDark: '#242933',
                    bgGlass: 'rgba(46, 52, 64, 0.95)',
                    bgGlassHeavy: 'rgba(36, 41, 51, 0.97)',
                    bgGlassBorder: 'rgba(59, 66, 82, 0.9)',
                    accent: '#88c0d0',
                    accentHover: '#8fbcbb',
                    textPrimary: '#eceff4',
                    textSecondary: '#d8dee9',
                    textMuted: '#616e88',
                    success: '#a3be8c',
                    error: '#bf616a',
                    warning: '#ebcb8b',
                    border: '#4c566a',
                    borderStrong: '#88c0d0',
                    shadowSoft: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    shadowCard: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    glow: '0 0 15px rgba(136, 192, 208, 0.3)',
                    bgHeader: 'rgba(36, 41, 51, 0.4)',
                    bgPanel: 'rgba(46, 52, 64, 0.95)',
                    bgInput: '#2e3440',
                    bgButton: '#3b4252',
                    bgButtonHover: '#4c566a',
                    editorBg: '#2e3440',
                    terminalBg: '#242933',
                    settingsLabelColor: '#d8dee9',
                    settingsSectionColor: '#88c0d0',
                    buttonTextOnAccent: '#2e3440',
                    btnBg: 'rgba(255, 255, 255, 0.08)',
                    btnBgHover: 'rgba(255, 255, 255, 0.12)',
                    btnBorder: '#4c566a',
                    btnText: '#eceff4',
                    btnTextHover: '#88c0d0',
                    btnPrimaryBg: '#88c0d0',
                    btnPrimaryBgHover: '#8fbcbb',
                    btnPrimaryText: '#2e3440',
                    // Load-bearing tokens moved from themes.css [data-theme] (Phase 06)
                    successDark: '#8fbf6a',
                    successHover: '#7daf5a',
                    errorDark: '#a5545c',
                    folderIconClosed: '#ebcb8b',
                    folderIconOpen: '#d08770',
                    borderGlassEdge: 'rgba(255, 255, 255, 0.1)',
                    welcomeBoxBg: 'rgba(46, 52, 64, 0.4)'
                },
                editor: {
                    base: 'vs-dark', inherit: true,
                    background: '#2e3440', foreground: '#eceff4',
                    syntax: {
                        comment: { color: '616e88', fontStyle: 'italic' },
                        keyword: { color: '81a1c1' },
                        string: { color: 'a3be8c' },
                        escape: { color: 'ebcb8b', fontStyle: 'bold' },
                        number: { color: 'b48ead' },
                        type: { color: '8fbcbb' },
                        function: { color: '88c0d0' }
                    }
                }
            },
        };
    },

    /**
     * Return a JSON-safe copy without sharing registry objects with an async
     * persistence operation. Themes are plain data, so JSON cloning is a
     * useful fallback for older Chromium builds that lack structuredClone.
     */
    _clone(value) {
        if (value === undefined || value === null) return value;
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) { }
        }
        return JSON.parse(JSON.stringify(value));
    },

    _electronAPI() {
        return typeof window !== 'undefined' ? window.electronAPI : null;
    },

    async _readState(name) {
        const api = this._electronAPI();
        if (!api || typeof api.stateRead !== 'function') return { available: false, found: false, data: null };
        const data = await api.stateRead(name);
        return { available: true, found: data !== null && data !== undefined, data };
    },

    async _writeState(name, data) {
        const api = this._electronAPI();
        if (!api || typeof api.stateWrite !== 'function') return false;
        const result = await api.stateWrite(name, data);
        if (result && result.success === false) {
            throw new Error(result.error || `Failed to write state document ${name}`);
        }
        return true;
    },

    _readLegacyThemes() {
        try {
            const stored = localStorage.getItem(this.LEGACY_THEME_STORAGE_KEY);
            if (!stored) return { found: false, themes: [] };
            const parsed = JSON.parse(stored);
            return { found: true, themes: Array.isArray(parsed) ? parsed : [] };
        } catch (e) {
            console.warn('[ThemeManager] Failed to parse legacy user themes:', e);
            return { found: false, themes: [] };
        }
    },

    /**
     * Load user-created themes from the state store.  A legacy localStorage
     * document is accepted only when the state document is absent, then is
     * migrated after the new write succeeds so a failed migration cannot lose
     * the old profile.
     */
    async loadUserThemes() {
        let source = null;
        let fromLegacy = false;
        let stateAvailable = false;
        let stateReadFailed = false;
        let stateDocument = null;

        try {
            const state = await this._readState(this.THEME_STATE_NAME);
            stateAvailable = state.available;
            if (state.found) {
                const data = state.data;
                const storedThemes = Array.isArray(data) ? data : data?.themes;
                if (Array.isArray(storedThemes)) {
                    stateDocument = data;
                    source = storedThemes;
                } else {
                    console.warn('[ThemeManager] Ignoring malformed theme state document');
                }
            }
        } catch (e) {
            stateReadFailed = true;
            console.warn('[ThemeManager] Failed to read theme state:', e);
        }

        this._themeStateLoaded = stateDocument !== null;
        this._themeStateReadFailed = stateReadFailed;
        this._themeStateAvailable = stateAvailable;
        this._themeStateDocument = stateDocument;
        if (this._themeStateLoaded && stateDocument && typeof stateDocument === 'object'
            && stateDocument.backgrounds && typeof stateDocument.backgrounds === 'object') {
            const loaded = Object.create(null);
            for (const id of this.builtinThemeIds) {
                if (Object.prototype.hasOwnProperty.call(stateDocument.backgrounds, id)) {
                    const value = stateDocument.backgrounds[id];
                    if (value && typeof value === 'object') loaded[id] = this._normalizeBackgroundSettings(value);
                }
            }
            this.backgroundOverrides = loaded;
            this.backgroundOverridesLoaded = true;
        }

        if (source === null) {
            const legacy = this._readLegacyThemes();
            source = legacy.themes;
            fromLegacy = legacy.found;
        }
        this._legacyThemesFound = fromLegacy;

        source.filter(theme => {
            const id = theme?.meta?.id || theme?.id;
            return typeof id === 'string' && id.trim() && !this.builtinThemeIds.includes(id);
        }).forEach(theme => this.registerTheme(theme));

        return source.length;
    },

    _snapshotUserThemes() {
        const userThemes = [];
        this.themes.forEach((theme, id) => {
            if (!this.builtinThemeIds.includes(id)) userThemes.push(this._clone(theme));
        });
        return userThemes;
    },

    async _saveUserThemesNow(userThemes, backgrounds = this._backgroundSnapshot()) {
        // Externalize only the immutable snapshot.  The live registry must
        // remain data-URL based until the persistence transaction succeeds.
        await Promise.all(userThemes.map(theme => this.externalizeAssets(theme.colors)));
        await Promise.all(Object.values(backgrounds || {}).map(settings => this.externalizeAssets(settings)));
        const document = { version: 1, themes: userThemes, backgrounds: backgrounds || {} };
        if (await this._writeState(this.THEME_STATE_NAME, document)) return document;
        throw new Error('Theme state storage is unavailable');
    },

    /**
     * Save user themes to storage.  Calls are serialized and each call owns a
     * deep snapshot, so the returned Promise represents that exact save.  A
     * rejection is intentionally propagated to callers that need to report a
     * failed Save action.
     */
    _saveUserThemes() {
        const snapshot = this._snapshotUserThemes();
        const revision = ++this._themeSaveRevision;
        const previous = this._themeSaveQueue;
        const next = previous.catch(() => { }).then(async () => {
            // Read backgrounds after earlier queued background operations have
            // committed, so independent theme/background edits are merged in
            // queue order instead of restoring an older background snapshot.
            await this._saveUserThemesNow(snapshot, this._backgroundSnapshot());
            return { success: true, revision, count: snapshot.length };
        });
        this._themeSaveQueue = next.catch(() => { });
        return next;
    },

    _saveUserThemesPromise() {
        return this._saveUserThemes();
    },

    /** Keys of `theme.colors` that may hold an image or video. */
    ASSET_KEYS: ['appBackground', 'editorBackground'],

    /**
     * Fields owned by the separate builtin-background override document.  A
     * missing field restores the hardcoded baseline; an empty image URL is an
     * explicit disable sentinel.
     */
    BACKGROUND_OVERRIDE_KEYS: [
        'appBackground', 'bgOpacity', 'bgBrightness', 'bgBlur', 'bgPosition',
        'editorBackground', 'editorBgOpacity', 'editorBgBrightness',
        'editorBgBlur', 'editorBgPosition'
    ],

    /**
     * Replace inline `data:` assets in a colors object with file URLs
     * (userData/theme-assets). Mutates and returns `colors`; values that are
     * not data URLs, and any that fail to save, are left untouched.
     * @param {Object} colors
     * @returns {Promise<Object>}
     */
    async externalizeAssets(colors) {
        const api = this._electronAPI();
        if (!colors) return colors;
        for (const key of this.ASSET_KEYS) {
            const value = colors[key];
            if (typeof value !== 'string' || !value.startsWith('data:')) continue;
            if (!api?.saveThemeAsset) throw new Error('Theme asset storage is unavailable');
            const result = await api.saveThemeAsset(value);
            if (!result || result.success !== true || !result.url) {
                throw new Error(result?.error || `Could not store ${key} as a file`);
            }
            colors[key] = result.url;
        }
        return colors;
    },

    /**
     * Load background overrides from userData/state.  Legacy per-theme keys
     * are still read when no state override exists and are migrated after a
     * successful state write.
     */
    async loadBackgroundOverrides() {
        let state = null;
        let stateAvailable = this._themeStateLoaded && !this._themeStateReadFailed;
        let stateReadFailed = this._themeStateReadFailed;
        if (this._themeStateLoaded) {
            state = this._themeStateDocument;
        } else {
            try {
                const result = await this._readState(this.THEME_STATE_NAME);
                stateAvailable = result.available;
                if (result.found) {
                    state = result.data;
                    this._themeStateLoaded = true;
                    this._themeStateDocument = state;
                }
            } catch (e) {
                stateReadFailed = true;
                this._themeStateReadFailed = true;
                console.warn('[ThemeManager] Failed to read background state:', e);
            }
        }

        this._themeStateAvailable = stateAvailable;
        this._themeStateReadFailed = stateReadFailed;

        const loaded = Object.create(null);
        const stateBackgrounds = state && typeof state === 'object'
            ? (state.backgrounds || state.overrides) : null;
        if (stateBackgrounds && typeof stateBackgrounds === 'object') {
            for (const id of this.builtinThemeIds) {
                if (Object.prototype.hasOwnProperty.call(stateBackgrounds, id)) {
                    const value = stateBackgrounds[id];
                    if (value && typeof value === 'object') loaded[id] = this._normalizeBackgroundSettings(value);
                }
            }
        }

        const legacyIds = this.builtinThemeIds.filter(id => !Object.prototype.hasOwnProperty.call(loaded, id));
        for (const id of legacyIds) {
            const legacy = this._readLegacyBackgroundOverride(id);
            if (legacy.found) loaded[id] = legacy.settings;
        }

        this.backgroundOverrides = loaded;
        this.backgroundOverridesLoaded = true;

        return this.backgroundOverrides;
    },

    async _migrateLegacyState() {
        const legacyBackgroundIds = this.builtinThemeIds.filter(id => this._legacyBackgroundExists(id));
        if (this._themeStateReadFailed || !this._themeStateAvailable) return;
        const existingBackgrounds = this._themeStateDocument && typeof this._themeStateDocument === 'object'
            ? (this._themeStateDocument.backgrounds || {}) : {};
        const canonicalState = !!this._themeStateDocument
            && !Array.isArray(this._themeStateDocument)
            && this._themeStateDocument.version === 1
            && Array.isArray(this._themeStateDocument.themes)
            && this._themeStateDocument.backgrounds
            && typeof this._themeStateDocument.backgrounds === 'object';
        const needsBackgroundMigration = legacyBackgroundIds.some(id =>
            !Object.prototype.hasOwnProperty.call(existingBackgrounds, id));
        const needsThemeMigration = !this._themeStateLoaded && this._legacyThemesFound;
        const needsCanonicalMigration = this._themeStateLoaded && !canonicalState;
        if (!needsThemeMigration && !needsBackgroundMigration && !needsCanonicalMigration) return;
        try {
            const document = await this._saveUserThemesNow(this._snapshotUserThemes(), this._backgroundSnapshot());
            this._themeStateLoaded = true;
            this._themeStateDocument = document;
            if (this._legacyThemesFound) localStorage.removeItem(this.LEGACY_THEME_STORAGE_KEY);
            legacyBackgroundIds.forEach(id => this._removeLegacyBackgroundOverride(id));
        } catch (e) {
            console.warn('[ThemeManager] Legacy theme state migration deferred:', e);
        }
    },

    _readLegacyBackgroundOverride(themeId) {
        try {
            const raw = localStorage.getItem(`theme-bg-${themeId}`);
            if (!raw) return { found: false, settings: null };
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { found: false, settings: null };
            return { found: true, settings: this._normalizeBackgroundSettings(parsed) };
        } catch (e) {
            console.warn(`[ThemeManager] Failed to parse background override for ${themeId}:`, e);
            return { found: false, settings: null };
        }
    },

    _legacyBackgroundExists(themeId) {
        try { return !!localStorage.getItem(`theme-bg-${themeId}`); } catch (_) { return false; }
    },

    _removeLegacyBackgroundOverride(themeId) {
        try { localStorage.removeItem(`theme-bg-${themeId}`); } catch (_) { }
    },

    _normalizeBackgroundSettings(settings) {
        const result = {};
        if (!settings || typeof settings !== 'object') return result;
        const keys = this.BACKGROUND_OVERRIDE_KEYS || [];
        for (const key of keys) {
            if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
            const value = settings[key];
            if (key === 'appBackground' || key === 'editorBackground') {
                // Empty string and the old "none" sentinel both mean an
                // explicit disabled background.  Missing means restore the
                // builtin baseline and is intentionally kept distinct.
                if (value === null || value === undefined || value === 'none') result[key] = '';
                else if (typeof value === 'string') result[key] = value;
                continue;
            }
            if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
            else if (typeof value === 'string') result[key] = value;
        }
        return result;
    },

    _backgroundSnapshot() {
        return this._clone(this.backgroundOverrides || Object.create(null));
    },

    /**
     * Persist a background migration through the same queue as all other theme
     * writes.  `overrides` is a patch of entries discovered by the migration,
     * rather than a complete snapshot: the snapshot must be taken after any
     * writes that were already queued have committed.
     */
    _persistBackgroundOverridesNow(overrides, expected = null) {
        const patch = this._clone(overrides || {});
        const expectedSnapshot = this._clone(expected || {});
        const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
        const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
        const previous = this._themeSaveQueue;
        const next = previous.catch(() => { }).then(async () => {
            const backgrounds = this._backgroundSnapshot();
            Object.keys(patch).forEach((id) => {
                // A user save may have completed while the migration was
                // converting its data URL.  Keep that newer value instead of
                // replaying the stale legacy entry over it.
                const expectedHasValue = hasOwn(expectedSnapshot, id);
                const currentHasValue = hasOwn(backgrounds, id);
                const unchanged = expectedHasValue === currentHasValue
                    && (!expectedHasValue || sameValue(backgrounds[id], expectedSnapshot[id]));
                if (unchanged) backgrounds[id] = patch[id];
            });
            const document = await this._saveUserThemesNow(this._snapshotUserThemes(), backgrounds);
            this.backgroundOverrides = backgrounds;
            this.backgroundOverridesLoaded = true;
            return document;
        });
        this._themeSaveQueue = next.catch(() => { });
        return next;
    },

    /**
     * Persist a built-in background override.  This is the async API for the
     * customizer; old localStorage writers remain readable during migration.
     */
    saveBackgroundOverrides(themeId, settings) {
        if (!this.builtinThemeIds.includes(themeId)) {
            return Promise.reject(new Error('Background overrides are only supported for builtin themes'));
        }
        const candidate = this._normalizeBackgroundSettings(settings);
        const revision = ++this._backgroundSaveRevision;
        const previous = this._themeSaveQueue;
        const next = previous.catch(() => { }).then(async () => {
            const overrides = this._backgroundSnapshot();
            overrides[themeId] = this._clone(candidate);
            await this._saveUserThemesNow(this._snapshotUserThemes(), overrides);
            this.backgroundOverrides = overrides;
            this.backgroundOverridesLoaded = true;
            this._removeLegacyBackgroundOverride(themeId);
            return { success: true, revision };
        });
        this._themeSaveQueue = next.catch(() => { });
        return next;
    },

    /**
     * Remove a built-in background override and restore the hardcoded value on
     * the next theme application.  The absent key is meaningful: it differs
     * from an explicit empty `appBackground` override.
     */
    clearBackgroundOverride(themeId) {
        if (!this.builtinThemeIds.includes(themeId)) {
            return Promise.reject(new Error('Background overrides are only supported for builtin themes'));
        }
        const revision = ++this._backgroundSaveRevision;
        const previous = this._themeSaveQueue;
        const next = previous.catch(() => { }).then(async () => {
            const overrides = this._backgroundSnapshot();
            delete overrides[themeId];
            await this._saveUserThemesNow(this._snapshotUserThemes(), overrides);
            this.backgroundOverrides = overrides;
            this.backgroundOverridesLoaded = true;
            this._removeLegacyBackgroundOverride(themeId);
            return { success: true, revision };
        });
        this._themeSaveQueue = next.catch(() => { });
        return next;
    },

    // Singular aliases keep older experimental customizer builds working while
    // the public contract uses the plural names above.
    saveBackgroundOverride(themeId, settings) {
        return this.saveBackgroundOverrides(themeId, settings);
    },

    resetBackgroundOverrides(themeId) {
        return this.clearBackgroundOverride(themeId);
    },

    getBackgroundOverrides(themeId) {
        const settings = this.backgroundOverrides?.[themeId];
        return settings ? this._clone(settings) : null;
    },

    /**
     * One-time clean-up of data already stored by older versions.  The normal
     * init path already migrates the registry and background state; this
     * method remains for callers from older startup code.
     */
    async migrateStoredAssets() {
        const hasInline = (colors) => !!colors && this.ASSET_KEYS.some(k => typeof colors[k] === 'string' && colors[k].startsWith('data:'));
        if ([...this.themes].some(([id, theme]) => !this.builtinThemeIds.includes(id) && hasInline(theme.colors))) {
            await this._saveUserThemes();
        }

        // Keep only the legacy entries found by this migration.  The state
        // snapshot is taken by _persistBackgroundOverridesNow after earlier
        // queued operations complete, so a delayed asset conversion cannot
        // overwrite a newer background/theme save.
        const migrated = Object.create(null);
        const expected = Object.create(null);
        let changed = false;
        for (const id of this.builtinThemeIds) {
            const legacy = this._readLegacyBackgroundOverride(id);
            if (!legacy.found || !hasInline(legacy.settings)) continue;
            if (Object.prototype.hasOwnProperty.call(this.backgroundOverrides || {}, id)) {
                expected[id] = this._clone(this.backgroundOverrides[id]);
            }
            await this.externalizeAssets(legacy.settings);
            migrated[id] = legacy.settings;
            changed = true;
        }
        if (changed) {
            await this._persistBackgroundOverridesNow(migrated, expected);
            this.builtinThemeIds.forEach(id => this._removeLegacyBackgroundOverride(id));
        }
    },

    /**
     * Register a theme from JSON object
     * @param {Object} themeData - Theme JSON object
     * @param {boolean} skipReapply - Skip auto re-apply if this is the active theme
     */
    registerTheme(themeData, skipReapply = false) {
        if (skipReapply && typeof skipReapply === 'object') {
            skipReapply = skipReapply.skipReapply === true;
        }
        const id = themeData?.meta?.id || themeData?.id;
        if (!id) {
            console.error('[ThemeManager] Theme must have an id');
            return false;
        }

        const normalizedTheme = this._normalizeTheme(themeData);

        this.themes.set(id, normalizedTheme);

        if (typeof monaco !== 'undefined') {
            this._defineMonacoTheme(normalizedTheme);
        }

        if (!skipReapply && id === this.activeThemeId) {
            this.setTheme(id);
        }

        return true;
    },

    /**
     * Normalize theme structure for consistent access
     */
    _normalizeTheme(themeData) {
        const meta = themeData?.meta && typeof themeData.meta === 'object' ? themeData.meta : {};
        return {
            id: meta.id || themeData?.id,
            name: meta.name || themeData?.name || 'Unnamed Theme',
            type: meta.type || themeData?.type || 'dark',
            author: meta.author || themeData?.author || 'Unknown',
            version: meta.version || themeData?.version || '1.0.0',
            description: meta.description || themeData?.description || '',
            tags: this._clone(meta.tags || themeData?.tags || []),
            colors: this._clone(themeData?.colors || {}),
            editor: this._clone(themeData?.editor || {}),
            terminal: this._clone(themeData?.terminal || {})
        };
    },

    /**
     * Define Monaco Editor theme from normalized theme data
     */
    _defineMonacoTheme(theme) {
        const editorConfig = theme.editor;
        const syntax = editorConfig.syntax || {};

        const rules = [];
        if (syntax.comment) rules.push({ token: 'comment', foreground: syntax.comment.color, fontStyle: syntax.comment.fontStyle });
        if (syntax.keyword) rules.push({ token: 'keyword', foreground: syntax.keyword.color });
        if (syntax.string) rules.push({ token: 'string', foreground: syntax.string.color });
        // Escape sequences (\n, \t, \0, etc.) - use dedicated color or derive from string
        if (syntax.escape) {
            rules.push({ token: 'string.escape', foreground: syntax.escape.color, fontStyle: syntax.escape.fontStyle || 'bold' });
        } else if (syntax.keyword && syntax.string) {
            // Auto-derive: use keyword color with bold to make escapes stand out from strings
            rules.push({ token: 'string.escape', foreground: syntax.keyword.color, fontStyle: 'bold' });
        }
        if (syntax.number) rules.push({ token: 'number', foreground: syntax.number.color });
        if (syntax.type) rules.push({ token: 'type', foreground: syntax.type.color, fontStyle: syntax.type.fontStyle });
        if (syntax.function) rules.push({ token: 'function', foreground: syntax.function.color });
        if (syntax.variable) rules.push({ token: 'variable', foreground: syntax.variable.color });
        // Built-in identifiers (cout, sort, etc.) — use function color to distinguish from plain variables
        if (syntax.function) rules.push({ token: 'variable.predefined', foreground: syntax.function.color });
        if (syntax.operator) rules.push({ token: 'operator', foreground: syntax.operator.color });
        // Include paths: #include <header> — use string color
        if (syntax.string) rules.push({ token: 'string.include', foreground: syntax.string.color });
        if (syntax.bracket) {
            rules.push({ token: 'delimiter.bracket', foreground: syntax.bracket.color });
            rules.push({ token: 'delimiter.parenthesis', foreground: syntax.bracket.color });
            rules.push({ token: 'delimiter.curly', foreground: syntax.bracket.color });
            rules.push({ token: 'delimiter.square', foreground: syntax.bracket.color });
        }

        const monacoTheme = {
            base: editorConfig.base || 'vs-dark',
            inherit: editorConfig.inherit !== false,
            rules: rules,
            colors: {
                'editor.background': editorConfig.background || '#1a2530',
                'editor.foreground': editorConfig.foreground || '#e0f0ff',
                'editor.lineHighlightBackground': editorConfig.lineHighlight || '#243040',
                'editor.selectionBackground': editorConfig.selection || '#88c9ea40',
                'editorCursor.foreground': editorConfig.cursor || '#88c9ea',
                'editorLineNumber.foreground': editorConfig.lineNumber || '#4a6a7a',
                'editorLineNumber.activeForeground': editorConfig.lineNumberActive || '#88c9ea',
                'scrollbarSlider.background': editorConfig.scrollbar || '#4a6a7a50',
                'scrollbarSlider.hoverBackground': editorConfig.scrollbarHover || '#6a8a9a70',
                'scrollbarSlider.activeBackground': editorConfig.scrollbarActive || '#88c9ea80'
            }
        };

        try {
            monaco.editor.defineTheme(theme.id, monacoTheme);
        } catch (e) {
            console.error(`[ThemeManager] Failed to define Monaco theme ${theme.id}:`, e);
        }
    },

    /**
     * Fold the old Settings `perTheme[id].bgUrl` value into the canonical state
     * document.  This method remains synchronous for the existing startup call;
     * the queued Promise is intentionally returned for tests/new callers.
     */
    _migratePerThemeBackgrounds() {
        const pending = [];
        try {
            const perTheme = (typeof App !== 'undefined' && App.settings
                && App.settings.appearance && App.settings.appearance.perTheme) || {};
            for (const [id, cfg] of Object.entries(perTheme)) {
                const url = cfg && cfg.bgUrl;
                if (!url) continue;
                if (!this.builtinThemeIds.includes(id)) continue;
                if (Object.prototype.hasOwnProperty.call(this.backgroundOverrides || {}, id)) continue;
                if (this._legacyBackgroundExists(id)) continue;
                pending.push(this.saveBackgroundOverrides(id, { appBackground: url }));
            }
        } catch (e) {
            console.warn('[ThemeManager] perTheme bg migration skipped:', e);
        }
        return Promise.all(pending).catch((e) => {
            console.warn('[ThemeManager] perTheme bg migration deferred:', e);
            return [];
        });
    },

    /**
     * Apply a theme by ID
     * @param {string} themeId
     */
    setTheme(themeId, { editorScheme = null } = {}) {
        // Auto-initialize if themes not loaded yet (called before init())
        if (this.themes.size === 0) {
            this._loadAllHardcodedThemes();
        }

        let theme = this.themes.get(themeId);

        if (!theme) {
            // Silent fallback - don't warn if theme just hasn't loaded yet
            themeId = 'kawaii-dark';
            theme = this.themes.get(themeId);
        }

        if (!theme) {
            // This should never happen now, but keep as safety net
            console.warn('[ThemeManager] Themes not initialized, deferring...');
            return;
        }

        this.activeThemeId = themeId;

        if (this.builtinThemeIds.includes(themeId)) {
            this._loadSavedBackground(themeId, theme);

            const hasBackgroundOverride = Object.prototype.hasOwnProperty.call(this.backgroundOverrides || {}, themeId)
                || this._legacyBackgroundExists(themeId);
            if (themeId === 'kawaii-light' && !hasBackgroundOverride && (!theme.colors || !theme.colors.appBackground)) {
                if (!theme.colors) theme.colors = {};
                theme.colors.appBackground = 'assets/backgrounds/background.jpg';
            }
        }

        document.documentElement.setAttribute('data-theme', themeId);
        // Expose the light/dark variant so component CSS can target a theme *type*
        // (e.g. [data-theme-variant="dark"] .menu-btn) instead of hardcoding each
        // builtin id. This is what lets CUSTOM themes inherit the correct styling
        // (they set their own tokens; the variant rules use var(--token)).
        document.documentElement.setAttribute('data-theme-variant', theme.type || 'dark');
        this._applyCSSVariables(theme);
        this._updateBackground(theme);

        // Monaco: an explicit editor color scheme overrides the UI theme; otherwise
        // the editor follows the UI theme. This is the single place that decides the
        // editor theme, so switching themes no longer double-sets Monaco.
        const monacoThemeId = (editorScheme && editorScheme !== 'auto' && this.themes.has(editorScheme))
            ? editorScheme
            : themeId;
        this._applyMonacoTheme(monacoThemeId);
    },

    /**
     * Apply a Monaco editor theme. The ONLY place that calls monaco.editor.setTheme.
     * monaco.editor.setTheme is global (themes every editor at once); the per-editor
     * updateOptions keep any editor tracking a `theme` option (splits, template) in sync.
     * @param {string} monacoThemeId
     */
    _applyMonacoTheme(monacoThemeId) {
        if (typeof monaco === 'undefined') return;
        try {
            monaco.editor.setTheme(monacoThemeId);

            if (typeof App !== 'undefined' && App.editors) {
                Object.values(App.editors).forEach(editor => {
                    if (editor && editor.updateOptions) {
                        editor.updateOptions({ theme: monacoThemeId });
                    }
                });
            }

            // Update template editor if exists
            if (typeof templateEditor !== 'undefined' && templateEditor) {
                templateEditor.updateOptions({ theme: monacoThemeId });
            }
        } catch (e) {
            console.warn('[ThemeManager] Monaco theme not ready:', e);
        }
    },

    /**
     * Load saved background settings for a built-in theme
     * @param {string} themeId - Theme ID
     * @param {object} theme - Theme object to modify
     * @private
     */
    _loadSavedBackground(themeId, theme) {
        try {
            if (!theme.colors) theme.colors = {};

            // Start from the hardcoded builtin values on every apply.  Without
            // this reset, deleting one field from an override leaves the old
            // value stuck in the live registry forever.
            const hardcoded = this._getHardcodedThemes()[themeId];
            const baseline = hardcoded?.colors || {};
            for (const key of this.BACKGROUND_OVERRIDE_KEYS) {
                if (Object.prototype.hasOwnProperty.call(baseline, key)) {
                    theme.colors[key] = this._clone(baseline[key]);
                } else {
                    delete theme.colors[key];
                }
            }

            let bgSettings = null;
            if (Object.prototype.hasOwnProperty.call(this.backgroundOverrides || {}, themeId)) {
                bgSettings = this.backgroundOverrides[themeId];
            } else {
                // Compatibility for an old customizer writing a legacy key
                // after startup. New state data wins when both are present.
                const legacy = this._readLegacyBackgroundOverride(themeId);
                if (legacy.found) bgSettings = legacy.settings;
            }
            if (bgSettings) Object.assign(theme.colors, this._clone(bgSettings));
        } catch (e) {
            console.warn(`[ThemeManager] Failed to load saved background for ${themeId}:`, e);
        }
    },

    /**
     * Apply CSS variables from theme colors
     * Uses ThemeTokens as Single Source of Truth
     */
    _applyCSSVariables(theme) {
        const root = document.documentElement;
        const colors = theme.colors || {};

        // Use unified ThemeTokens module for applying colors
        // clearFirst: true removes old values before applying new ones
        if (typeof ThemeTokens !== 'undefined') {
            ThemeTokens.applyToElement(root, colors, { clearFirst: true });
        } else {
            console.warn('[ThemeManager] ThemeTokens not loaded, colors may not apply correctly');
        }
    },

    /**
     * Apply inheritance: if child not set, use parent value
     */
    _applyInheritance(root, colors, childKey, parentKey, cssVar) {
        const hasChild = colors[childKey] !== undefined && colors[childKey] !== null;
        if (!hasChild && colors[parentKey]) {
            root.style.setProperty(cssVar, colors[parentKey]);
        }
    },


    /**
     * Get list of all available themes
     */
    getThemeList() {
        const list = [];
        this.themes.forEach((theme, id) => {
            list.push({
                id: id,
                name: theme.name,
                type: theme.type,
                author: theme.author,
                isBuiltin: this.builtinThemeIds.includes(id)
            });
        });
        return list;
    },

    /**
     * Export theme to JSON string
     */
    exportTheme(themeId) {
        const theme = this.themes.get(themeId);
        if (!theme) return null;
        return JSON.stringify(this._exportData(theme), null, 2);
    },

    _exportData(theme) {
        return {
            meta: {
                id: theme.id,
                name: theme.name,
                author: theme.author,
                version: theme.version,
                description: theme.description,
                type: theme.type,
                tags: this._clone(theme.tags || [])
            },
            colors: this._clone(theme.colors || {}),
            editor: this._clone(theme.editor || {}),
            terminal: this._clone(theme.terminal || {})
        };
    },

    _assetMimeType(assetUrl) {
        const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(String(assetUrl || ''));
        const types = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
            webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
            webm: 'video/webm', mp4: 'video/mp4'
        };
        return types[match?.[1]?.toLowerCase()] || 'application/octet-stream';
    },

    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        if (typeof btoa === 'function') return btoa(binary);
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
        throw new Error('No base64 encoder is available');
    },

    async _assetToDataUrl(assetUrl) {
        if (typeof assetUrl !== 'string' || !assetUrl.startsWith('file:')) return assetUrl;

        const api = this._electronAPI();
        if (typeof api?.readThemeAsset === 'function') {
            const result = await api.readThemeAsset(assetUrl);
            if (typeof result === 'string' && result.startsWith('data:')) return result;
            if (result?.dataUrl) return result.dataUrl;
            if (result?.data) {
                const mime = result.mimeType || this._assetMimeType(assetUrl);
                return `data:${mime};base64,${result.data}`;
            }
            if (result?.success === false) throw new Error(result.error || 'Could not read theme asset');
        }

        if (typeof fetch !== 'function') {
            throw new Error('Theme asset export requires fetch or electronAPI.readThemeAsset');
        }
        const response = await fetch(assetUrl);
        if (!response || response.ok === false) {
            throw new Error(`Could not read theme asset (${response?.status || 'unknown status'})`);
        }
        const buffer = await response.arrayBuffer();
        const mime = response.headers?.get?.('content-type')?.split(';')[0]
            || this._assetMimeType(assetUrl);
        return `data:${mime};base64,${this._arrayBufferToBase64(buffer)}`;
    },

    /**
     * Export a portable copy.  The synchronous exportTheme() contract remains
     * unchanged for existing marketplace callers; this method embeds local
     * file:// assets and is the API for the new customizer/export flow.
     */
    async exportThemePortable(themeId) {
        const theme = this.themes.get(themeId);
        if (!theme) return null;
        return this.serializeThemePortable(theme);
    },

    async serializeThemePortable(theme) {
        if (!theme || typeof theme !== 'object') return null;
        const normalized = theme.id && theme.colors ? theme : this._normalizeTheme(theme);
        const data = this._exportData(normalized);
        for (const key of this.ASSET_KEYS) {
            if (typeof data.colors[key] === 'string' && data.colors[key].startsWith('file:')) {
                data.colors[key] = await this._assetToDataUrl(data.colors[key]);
            }
        }
        return JSON.stringify(data, null, 2);
    },

    /**
     * Import theme from JSON string
     * @param {string} jsonString 
     * @returns {Object} Result with success and message
     */
    importTheme(jsonString) {
        try {
            const parsed = JSON.parse(jsonString);
            const validation = this._validateThemeDetails(parsed);
            if (!validation.valid) {
                return { success: false, message: validation.message || 'Invalid theme structure', errors: validation.errors || [] };
            }

            // Check the same resolved ID regardless of whether the file uses
            // the current meta shape or the older top-level shape.
            const id = validation.id;
            if (this.builtinThemeIds.includes(id)) {
                return { success: false, message: 'Cannot override builtin theme' };
            }

            const previousTheme = this.themes.get(id);
            const hadPreviousTheme = this.themes.has(id);
            this.registerTheme(validation.data);
            const persistence = this._saveUserThemes().catch((error) => {
                if (hadPreviousTheme) {
                    this.themes.set(id, previousTheme);
                    if (typeof monaco !== 'undefined') this._defineMonacoTheme(previousTheme);
                } else {
                    this.themes.delete(id);
                }
                throw error;
            });

            return {
                success: true,
                message: `Theme "${validation.data.meta.name}" imported successfully`,
                themeId: id,
                persistence
            };
        } catch (e) {
            return { success: false, message: `Parse error: ${e.message}` };
        }
    },

    /**
     * Update background video element if theme has a video background
     * @param {Object} theme 
     */
    _updateBackground(theme) {
        const bgVideo = document.getElementById('app-bg-video');
        if (!bgVideo) return;

        const bgPath = theme.colors?.appBackground;

        // Supported video extensions or data URI
        if (bgPath && (
            bgPath.endsWith('.webm') ||
            bgPath.endsWith('.mp4') ||
            bgPath.startsWith('data:video/')
        )) {
            // Re-assigning the same src restarts the video and shows a blank frame; the theme
            // is applied twice at startup (settings, then once Monaco has loaded).
            if (bgVideo.getAttribute('src') !== bgPath) bgVideo.src = bgPath;
            bgVideo.style.display = 'block';
            document.documentElement.style.setProperty('--app-bg-image', 'none');
            this.syncBackgroundVideo();
        } else {
            bgVideo.style.display = 'none';
            bgVideo.src = '';
            bgVideo.removeAttribute('src');
            bgVideo.load();
        }
    },

    /**
     * Play the background video only while it can be seen (not hidden behind a user image,
     * not minimised). Decoding it costs ~4% of a core in the GPU process and ~15 MB in the
     * renderer; paused, it keeps showing its current frame. Performance Mode no longer
     * pauses it.
     */
    syncBackgroundVideo() {
        const bgVideo = document.getElementById('app-bg-video');
        if (!bgVideo || !bgVideo.getAttribute('src')) return;
        const play = bgVideo.style.display !== 'none' && !document.hidden;
        bgVideo.autoplay = play;
        if (play) bgVideo.play().catch(() => { });
        else bgVideo.pause();
    },

    /**
     * Validate theme structure
     * @param {Object} theme 
     */
    _canonicalizeThemeData(theme) {
        if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
            return { valid: false, message: 'Theme must be an object' };
        }
        const meta = theme.meta && typeof theme.meta === 'object' && !Array.isArray(theme.meta)
            ? theme.meta : {};
        const topId = theme.id;
        const metaId = meta.id;
        if (topId !== undefined && typeof topId !== 'string') return { valid: false, message: 'Theme id must be a string' };
        if (metaId !== undefined && typeof metaId !== 'string') return { valid: false, message: 'Theme meta.id must be a string' };
        if (topId && metaId && topId !== metaId) return { valid: false, message: 'Theme id values disagree' };
        const id = metaId || topId;
        const topName = theme.name;
        const metaName = meta.name;
        if (topName !== undefined && typeof topName !== 'string') return { valid: false, message: 'Theme name must be a string' };
        if (metaName !== undefined && typeof metaName !== 'string') return { valid: false, message: 'Theme meta.name must be a string' };
        if (topName && metaName && topName !== metaName) return { valid: false, message: 'Theme name values disagree' };
        const name = metaName || topName;
        if (!id || !id.trim()) return { valid: false, message: 'Theme must have an id' };
        if (!name || !name.trim()) return { valid: false, message: 'Theme must have a name' };

        const canonical = this._clone(theme);
        canonical.meta = {
            ...meta,
            id: id.trim(),
            name: name.trim(),
            ...(meta.type || theme.type ? { type: meta.type || theme.type } : {}),
            ...(meta.author || theme.author ? { author: meta.author || theme.author } : {}),
            ...(meta.version || theme.version ? { version: meta.version || theme.version } : {}),
            ...(meta.description || theme.description ? { description: meta.description || theme.description } : {}),
            ...(meta.tags || theme.tags ? { tags: meta.tags || theme.tags } : {})
        };
        return { valid: true, id: id.trim(), data: canonical };
    },

    _validateThemeDetails(theme) {
        const canonical = this._canonicalizeThemeData(theme);
        if (!canonical.valid) return canonical;
        if (typeof ThemeTokens !== 'undefined' && typeof ThemeTokens.validateTheme === 'function') {
            // Validate the canonical source shape so optional metadata omitted
            // by an older file stays omitted; _normalizeTheme() supplies UI
            // defaults such as an empty description for runtime use.
            const result = ThemeTokens.validateTheme(canonical.data);
            if (result && result.valid === false) {
                return { valid: false, id: canonical.id, message: 'Invalid theme values', errors: result.errors || [] };
            }
        } else {
            const normalized = this._normalizeTheme(canonical.data);
            if (!normalized.colors || typeof normalized.colors !== 'object' || Array.isArray(normalized.colors)) {
                return { valid: false, id: canonical.id, message: 'Theme colors must be an object' };
            }
        }
        return { valid: true, id: canonical.id, data: canonical.data };
    },

    validateTheme(theme) {
        return this._validateThemeDetails(theme).valid;
    },

    /**
     * Delete a user-created theme
     * @param {string} themeId 
     */
    async deleteTheme(themeId) {
        if (this.builtinThemeIds.includes(themeId)) {
            return { success: false, message: 'Cannot delete builtin theme' };
        }

        if (!this.themes.has(themeId)) {
            return { success: false, message: 'Theme not found' };
        }

        const deletedTheme = this.themes.get(themeId);
        this.themes.delete(themeId);
        try {
            await this._saveUserThemes();
        } catch (error) {
            this.themes.set(themeId, deletedTheme);
            if (typeof monaco !== 'undefined') this._defineMonacoTheme(deletedTheme);
            throw error;
        }

        // Switch to default only after the deletion is durable.  If the write
        // fails, the old persisted theme remains available after restart.
        if (this.activeThemeId === themeId) {
            this.setTheme('kawaii-dark');
        }

        return { success: true, message: 'Theme deleted' };
    },

    /**
     * Duplicate a theme for customization
     * @param {string} sourceThemeId 
     * @param {string} newName 
     */
    async duplicateTheme(sourceThemeId, newName) {
        const source = this.themes.get(sourceThemeId);
        if (!source) {
            return { success: false, message: 'Source theme not found' };
        }

        const newId = newName.toLowerCase().replace(/\s+/g, '-');

        const newTheme = JSON.parse(JSON.stringify(source));
        newTheme.id = newId;
        newTheme.name = newName;
        newTheme.author = 'User';

        const previousTheme = this.themes.get(newId);
        const hadPreviousTheme = this.themes.has(newId);
        this.registerTheme({
            meta: {
                id: newId,
                name: newName,
                author: 'User',
                type: source.type,
                version: '1.0.0'
            },
            colors: newTheme.colors,
            editor: newTheme.editor,
            terminal: newTheme.terminal
        });

        try {
            await this._saveUserThemes();
        } catch (error) {
            if (hadPreviousTheme) {
                this.themes.set(newId, previousTheme);
                if (typeof monaco !== 'undefined') this._defineMonacoTheme(previousTheme);
            } else {
                this.themes.delete(newId);
            }
            throw error;
        }

        return { success: true, themeId: newId, message: `Created "${newName}"` };
    }
};

// Make globally available
window.ThemeManager = ThemeManager;
