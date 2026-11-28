/**
 * Sameko Dev C++ IDE - renderer: Applying the theme and the app background.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// THEME APPLICATION
// ============================================================================
function applyTheme(themeName) {
    // ThemeManager owns the UI theme AND Monaco. An explicit editor color scheme
    // (App.settings.editor.colorScheme) overrides the editor theme; 'auto' follows
    // the UI theme. Passing it in lets ThemeManager set Monaco exactly once (no
    // double-set / flash).
    const editorScheme = App.settings.editor?.colorScheme || 'auto';
    ThemeManager.setTheme(themeName, { editorScheme });

    // Additional app-specific background logic (opacity, image...)
    applyBackgroundSettings();

    // Re-color the xterm terminal to match the new theme.
    if (typeof syncTerminalTheme === 'function') syncTerminalTheme();

    saveSplashPalette();
}

// The splash window is shown before this page loads, so it cannot read the theme.
// Save the few colours it uses; the main process passes them to it on the next launch
// (app/windows/splash-window.js). Written only when they change.
let lastSplashPalette = '';
function saveSplashPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    // The splash window is transparent, so a see-through panel colour is made opaque.
    const opaque = (c) => c.replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/, 'rgb($1,$2,$3)');
    const palette = {
        type: document.documentElement.getAttribute('data-theme-variant') || 'dark',
        bg: opaque(v('--editor-bg')),
        panel: opaque(v('--bg-panel')),
        accent: v('--accent'),
        text: v('--text-primary'),
        muted: v('--text-muted'),
        accentText: v('--btn-primary-text')
    };
    const json = JSON.stringify(palette);
    if (json === lastSplashPalette) return;
    lastSplashPalette = json;
    window.electronAPI?.stateWrite?.('splash', palette)?.catch?.(() => { });
}

function themeBackgroundOverlay(theme, background = theme?.colors?.appBackground) {
    const colors = theme?.colors || {};
    if (!background || background === 'none' || colors.appOverlay === 'none') return 'transparent';

    const light = (theme?.type || theme?.meta?.type) === 'light';
    // appOverlay is not a token. Only accept RGB channels from imported themes.
    const rgb = typeof colors.appOverlay === 'string' && /^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/.test(colors.appOverlay)
        ? colors.appOverlay : light ? '255, 255, 255' : '26, 37, 48';
    const legacyOpacity = Number(App.settings.appearance.bgOpacity ?? 50) / 100;
    const baseAlpha = light ? legacyOpacity * 0.15 : 0.3 + legacyOpacity * 0.5;
    const defaultOpacity = ThemeTokens.isVideoBackground(background) ? 100 : 50;
    const opacity = Number(colors.bgOpacity ?? defaultOpacity);
    // Keep the theme's normal tint, but fade it out with the background layer.
    const scale = Math.max(0, Math.min(1, opacity / defaultOpacity));
    return scale ? `rgba(${rgb}, ${baseAlpha * scale})` : 'transparent';
}

function applyBackgroundSettings() {
    const theme = App.settings.appearance.theme || 'kawaii-dark';
    const themeObj = ThemeManager.themes.get(theme);
    const tc = themeObj?.colors || {};

    // default: fallback gradient, shown only when a theme has no bg image/video
    // (i.e. custom themes). Derived from the theme's own base tones.
    const gradTop = tc.editorBg || tc.bgOceanMedium || '#1a2530';
    const gradBottom = tc.bgOceanDark || tc.bgOceanMedium || '#152535';

    const normalizeBgUrl = (url) => {
        if (!url) return '';
        const cleaned = String(url).trim();
        if (!cleaned || cleaned.toLowerCase() === 'none') return '';
        const invalidSingletons = ['\\', '/', '.', './', '..'];
        if (invalidSingletons.includes(cleaned)) return '';
        if (cleaned.toLowerCase() === 'file://' || cleaned.toLowerCase() === 'file:') return '';
        return cleaned;
    };

    // Get theme-specific background from USER settings
    const perTheme = App.settings.appearance.perTheme || {};
    const canonical = ThemeManager.getBackgroundOverrides(theme);
    // Explicit clears and newly saved backgrounds win over the legacy Settings URL.
    const hasCanonical = canonical !== null && canonical !== undefined;
    // Until ThemeManager has loaded the stored backgrounds, paint none (no flash of the default).
    const bgKnown = !ThemeManager.isLoading?.();
    const userThemeBg = hasCanonical || !bgKnown ? '' : normalizeBgUrl(perTheme[theme]?.bgUrl || App.settings.appearance.bgUrl);

    const themeDefaultBg = bgKnown ? normalizeBgUrl(themeObj?.colors?.appBackground) : '';

    // body::before draws the still image and ThemeManager manages #app-bg-video.
    const root = document.documentElement;
    const bgVideo = document.getElementById('app-bg-video');
    // Relative paths are made absolute: in a custom property they would resolve
    // against styles/base.css, not the page.
    const absolute = (u) => (/^([a-z][a-z0-9+.-]*:|[\\/])/i.test(u) ? u : new URL(u, document.baseURI).href);
    const toBgUrl = (u) => u.startsWith('data:') ? `url("${u}")` : `url('${localUrl(absolute(u)).replace(/'/g, "\\'")}')`;
    if (userThemeBg) {
        // A user override wins over the theme's own background, including a video.
        root.style.setProperty('--app-bg-image', toBgUrl(userThemeBg));
        if (bgVideo) bgVideo.style.display = 'none';
        document.body.style.background = '';
    } else if (themeDefaultBg) {
        // Owned by ThemeManager: --app-bg-image (still image) or #app-bg-video (video).
        document.body.style.background = '';
    } else {
        // No image/video for this theme → fallback gradient behind the empty layer.
        root.style.setProperty('--app-bg-image', 'none');
        document.body.style.background = `linear-gradient(135deg, ${gradTop} 0%, ${gradBottom} 100%)`;
    }


    const appContainer = document.querySelector('.app-container');
    if (appContainer) {
        appContainer.style.background = themeBackgroundOverlay(themeObj, userThemeBg || themeDefaultBg || '');
    }

    // A video hidden behind a user image would otherwise keep decoding.
    ThemeManager.syncBackgroundVideo();
}

// Minimised or fully covered: stop decoding the background video until it is seen again.
document.addEventListener('visibilitychange', () => ThemeManager.syncBackgroundVideo());
// Working in another window (or sharing the screen from one): pause it there too.
window.addEventListener('focus', () => ThemeManager.syncBackgroundVideo());
window.addEventListener('blur', () => ThemeManager.syncBackgroundVideo());
window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => ThemeManager.syncBackgroundVideo());
