(function () {
    'use strict';
    // The old GitHub Pages copy of this site still serves the same files; send visitors to the official domain.
    if (location.hostname.endsWith('.github.io')) {
        location.replace('https://sameko.dev' + (location.pathname.replace(/^\/Sameko-Dev-CPP/i, '') || '/') + location.search + location.hash);
        return;
    }
    document.documentElement.classList.add('has-home-motion');
    let stored = null;
    try { stored = localStorage.getItem('theme'); } catch (error) { /* Storage may be disabled. */ }
    const dark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
})();
