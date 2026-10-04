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
        bg: v('--editor-bg'),
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

function applyBackgroundSettings() {
    const theme = App.settings.appearance.theme || 'kawaii-dark';
    const opacity = (App.settings.appearance.bgOpacity || 50) / 100;

    // Derive the fallback gradient + container overlay from the theme definition
    // (SSOT in ThemeManager) instead of a hardcoded per-theme table.
    const themeObj = ThemeManager.themes.get(theme);
    const tc = themeObj?.colors || {};
    const isLight = themeObj?.type === 'light';

    // overlay: tints .app-container when a bg image/video is present. Dark themes
    // use a stronger tint, light themes a very subtle one (matching the original
    // hand-tuned values). Base color is stored per-theme as `appOverlay`.
    const overlayBase = tc.appOverlay || (isLight ? '255, 255, 255' : '26, 37, 48');
    const overlayAlpha = isLight ? (opacity * 0.15) : (0.3 + opacity * 0.5);

    // default: fallback gradient, shown only when a theme has no bg image/video
    // (i.e. custom themes). Derived from the theme's own base tones.
    const gradTop = tc.editorBg || tc.bgOceanMedium || '#1a2530';
    const gradBottom = tc.bgOceanDark || tc.bgOceanMedium || '#152535';

    const themeConfig = {
        default: `linear-gradient(135deg, ${gradTop} 0%, ${gradBottom} 100%)`,
        overlay: `rgba(${overlayBase}, ${overlayAlpha})`
    };

    const normalizeBgUrl = (url) => {
        if (!url) return '';
        const cleaned = String(url).trim();
        if (!cleaned) return '';
        const invalidSingletons = ['\\', '/', '.', './', '..'];
        if (invalidSingletons.includes(cleaned)) return '';
        if (cleaned.toLowerCase() === 'file://' || cleaned.toLowerCase() === 'file:') return '';
        return cleaned;
    };

    // Get theme-specific background from USER settings
    const perTheme = App.settings.appearance.perTheme || {};
    const userThemeBg = normalizeBgUrl(perTheme[theme]?.bgUrl || App.settings.appearance.bgUrl);

    // Get theme-specific background from THEME definition (default)
    const themeDefaultBg = themeObj?.colors?.appBackground; // e.g. 'assets/backgrounds/pink.gif'


    // Single background owner (Phase 07 §4). The still image — theme default OR a
    // user override — is rendered through --app-bg-image on body::before, which is
    // the layer that applies the opacity / blur / brightness / position controls.
    // Video is rendered by ThemeManager (#app-bg-video). app.js no longer paints a
    // duplicate full-opacity image onto document.body, so the two systems can no
    // longer fight and the bg controls actually take effect.
    // VISUAL NOTE: image themes (kawaii-light, sakura) now honour the bg-opacity
    // setting (default 50%) instead of always showing at full opacity. If you want
    // the old always-full look, revert this commit.
    const root = document.documentElement;
    const bgVideo = document.getElementById('app-bg-video');
    // Relative paths are made absolute: in a custom property they would resolve
    // against styles/base.css, not the page.
    const absolute = (u) => (/^([a-z][a-z0-9+.-]*:|[\\/])/i.test(u) ? u : new URL(u, document.baseURI).href);
    const toBgUrl = (u) => u.startsWith('data:') ? `url("${u}")` : `url('${absolute(u).replace(/'/g, "\\'")}')`;
    document.body.style.backgroundImage = '';

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
        document.body.style.background = themeConfig.default;
    }


    const appContainer = document.querySelector('.app-container');
    if (appContainer) {
        if (userThemeBg || themeDefaultBg) {
            appContainer.style.background = themeConfig.overlay;
        } else {
            appContainer.style.background = 'transparent';
        }
    }

    // A video hidden behind a user image would otherwise keep decoding.
    ThemeManager.syncBackgroundVideo();

    updateFakeBlur();
}

// The background, blurred once into a small image, for the glass surfaces in islands.css
// (--app-bg-blurred). Done when the page is idle: it takes ~30 ms. Without a background image or
// video the variable is removed and the glass shows the theme's gradient through its tint.
let fakeBlurJob = 0;
function updateFakeBlur() {
    const job = ++fakeBlurJob;
    const root = document.documentElement;
    const draw = (src, width, height, opacity) => {
        if (job !== fakeBlurJob || !width || !height) return;
        const cs = getComputedStyle(root);
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = Math.round(320 * height / width);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = cs.getPropertyValue('--editor-bg').trim() || '#1a2530';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.filter = `blur(6px) brightness(${parseFloat(cs.getPropertyValue('--app-bg-brightness')) || 1})`;
        ctx.globalAlpha = opacity;
        // Drawn past the edges, so the blur does not fade them to the fill colour.
        ctx.drawImage(src, -12, -12, canvas.width + 24, canvas.height + 24);
        try {
            root.style.setProperty('--app-bg-blurred', `url("${canvas.toDataURL('image/jpeg', 0.85)}")`);
        } catch (_) {
            root.style.removeProperty('--app-bg-blurred');
        }
    };
    const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));

    const video = document.getElementById('app-bg-video');
    if (video && video.style.display !== 'none' && video.getAttribute('src')) {
        const fromVideo = () => whenIdle(() => draw(video, video.videoWidth, video.videoHeight,
            parseFloat(getComputedStyle(video).opacity) || 1));
        if (video.readyState >= 2) fromVideo();
        else video.addEventListener('loadeddata', fromVideo, { once: true });
        return;
    }
    const url = /^url\(\s*["']?(.*?)["']?\s*\)$/.exec(root.style.getPropertyValue('--app-bg-image').trim()
        || getComputedStyle(root).getPropertyValue('--app-bg-image').trim());
    if (!url) {
        root.style.removeProperty('--app-bg-blurred');
        return;
    }
    const img = new Image();
    img.src = url[1];
    img.decode().then(() => whenIdle(() => draw(img, img.naturalWidth, img.naturalHeight,
        parseFloat(getComputedStyle(document.body, '::before').opacity) || 1)))
        .catch(() => { if (job === fakeBlurJob) root.style.removeProperty('--app-bg-blurred'); });
}

// Minimised or fully covered: stop decoding the background video until it is seen again.
document.addEventListener('visibilitychange', () => ThemeManager.syncBackgroundVideo());
