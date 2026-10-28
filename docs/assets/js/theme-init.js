(function () {
    'use strict';
    document.documentElement.classList.add('has-home-motion');
    let stored = null;
    try { stored = localStorage.getItem('theme'); } catch (error) { /* Storage may be disabled. */ }
    const dark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
})();
