/**
 * Sameko Dev C++ IDE - splash colours.
 *
 * The main process passes the colours of the user's theme in the query string
 * (app/windows/splash-window.js, already checked to be plain colours). Runs in
 * <head>, before the first paint, so the splash never shows the default colours first.
 */
(function () {
    const params = new URLSearchParams(location.search);
    const root = document.documentElement;
    const map = { bg: '--bg', panel: '--panel', accent: '--accent', text: '--text', muted: '--muted', accentText: '--accent-text' };
    for (const key of Object.keys(map)) {
        const value = params.get(key);
        if (value) root.style.setProperty(map[key], value);
    }
    root.dataset.variant = params.get('type') === 'light' ? 'light' : 'dark';
})();
