// Dev-C++ comparison pages: theme toggle and the FAQ accordion.
// Every answer is open in the HTML; this script collapses them, so the page
// stays fully readable without JavaScript.
(function () {
    'use strict';
    const html = document.documentElement;

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', function () {
            const dark = html.getAttribute('data-theme') !== 'dark';
            if (dark) html.setAttribute('data-theme', 'dark');
            else html.removeAttribute('data-theme');
            try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (error) { /* Storage may be disabled. */ }
        });
    }

    document.querySelectorAll('.faq-list').forEach(function (list) {
        const items = Array.from(list.querySelectorAll('.faq-item'));
        function setOpen(item, open) {
            item.classList.toggle('active', open);
            const button = item.querySelector('.faq-question');
            if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        items.forEach(function (item) {
            setOpen(item, false);
            const button = item.querySelector('.faq-question');
            if (!button) return;
            button.addEventListener('click', function () {
                const open = !item.classList.contains('active');
                items.forEach(function (other) { if (other !== item) setOpen(other, false); });
                setOpen(item, open);
            });
        });
        list.classList.add('faq-list--js');
    });
})();
