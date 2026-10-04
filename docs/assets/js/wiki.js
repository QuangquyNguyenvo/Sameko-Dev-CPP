(function () {
    'use strict';

    function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // The sidebar's active link is set by the page's TOC script; this pill
    // follows whichever link holds .active.
    function bootSidebarMarker() {
        var nav = document.querySelector('.wiki-sidebar-nav');
        if (!nav) return;
        var links = Array.prototype.slice.call(nav.querySelectorAll('.wiki-nav-link'));
        if (!links.length) return;
        var marker = document.createElement('span');
        marker.className = 'wiki-nav-marker';
        marker.setAttribute('aria-hidden', 'true');
        nav.prepend(marker);
        nav.classList.add('has-marker');

        function move(animate) {
            var active = nav.querySelector('.wiki-nav-link.active');
            if (!active || !active.offsetHeight) {
                // Between linked sections nothing is active; do not leave the pill behind.
                if (window.gsap) gsap.to(marker, { opacity: 0, duration: 0.2, overwrite: true });
                else marker.style.opacity = '0';
                return;
            }
            var props = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight, opacity: 1 };
            // On short screens the sidebar scrolls; keep the active link inside it.
            var box = document.querySelector('.wiki-sidebar');
            if (box && box.scrollHeight > box.clientHeight + 2) {
                var linkTop = active.getBoundingClientRect().top - box.getBoundingClientRect().top;
                if (linkTop < 40 || linkTop + active.offsetHeight > box.clientHeight - 40) {
                    box.scrollTo({ top: box.scrollTop + linkTop - box.clientHeight / 2, behavior: animate && !reducedMotion() ? 'smooth' : 'auto' });
                }
            }
            if (window.gsap && animate && !reducedMotion()) {
                gsap.to(marker, Object.assign({ duration: 0.35, ease: 'power3.out', overwrite: true }, props));
            } else if (window.gsap) {
                gsap.set(marker, props);
            } else {
                marker.style.transform = 'translate(' + props.x + 'px, ' + props.y + 'px)';
                marker.style.width = props.width + 'px';
                marker.style.height = props.height + 'px';
                marker.style.opacity = '1';
            }
        }

        var frame = 0;
        var observer = new MutationObserver(function () {
            if (frame) return;
            frame = requestAnimationFrame(function () { frame = 0; move(true); });
        });
        links.forEach(function (link) { observer.observe(link, { attributes: true, attributeFilter: ['class'] }); });
        window.addEventListener('resize', function () { move(false); }, { passive: true });
        // The mobile sidebar is hidden until opened; measure once it shows.
        var sidebar = document.querySelector('.wiki-sidebar');
        if (sidebar) new MutationObserver(function () { move(false); })
            .observe(sidebar, { attributes: true, attributeFilter: ['class'] });
        move(false);
    }

    function splitWords(element) {
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) {
            var fragment = document.createDocumentFragment();
            node.textContent.split(/(\s+)/).forEach(function (part) {
                if (!part) return;
                if (/^\s+$/.test(part)) { fragment.appendChild(document.createTextNode(part)); return; }
                var span = document.createElement('span');
                span.className = 'w';
                span.style.display = 'inline-block';
                span.textContent = part;
                fragment.appendChild(span);
            });
            node.parentNode.replaceChild(fragment, node);
        });
        return element.querySelectorAll('.w');
    }

    function bootWikiMotion() {
        if (!window.gsap || !window.ScrollTrigger) return;
        gsap.registerPlugin(ScrollTrigger);
        document.body.classList.add('js-ready');

        var progress = document.createElement('div');
        progress.className = 'wiki-progress';
        progress.setAttribute('aria-hidden', 'true');
        progress.appendChild(document.createElement('span'));
        document.body.appendChild(progress);
        gsap.to(progress.firstChild, {
            scaleX: 1, ease: 'none',
            scrollTrigger: { start: 0, end: 'max', scrub: 0.3 }
        });

        var mm = gsap.matchMedia();
        mm.add('(prefers-reduced-motion: no-preference)', function () {
            var clear = 'transform,opacity,visibility';
            var title = document.getElementById('wiki-hero-title');
            var intro = gsap.timeline({ defaults: { ease: 'power3.out', clearProps: clear } });
            intro.from('.wiki-release-pill', { y: 12, autoAlpha: 0, duration: 0.5 }, 0);
            if (title) intro.from(splitWords(title), { y: 36, autoAlpha: 0, duration: 0.7, stagger: 0.07 }, 0.08);
            intro.from('.wiki-hero-copy > p, .wiki-search', { y: 16, autoAlpha: 0, duration: 0.6, stagger: 0.1 }, 0.35)
                .from('.wiki-hero-word', { yPercent: 18, autoAlpha: 0, duration: 0.9 }, 0.1)
                .from('.wiki-hero-art .shape', { scale: 0, autoAlpha: 0, duration: 0.6, stagger: 0.05, ease: 'back.out(3)' }, 0.3)
                .from('.wiki-sidebar', { x: -20, autoAlpha: 0, duration: 0.7 }, 0.45);
            var mark = document.querySelector('.wiki-hero .hl');
            if (mark) {
                intro.fromTo(mark, { '--highlight-scale': 0 }, { '--highlight-scale': 1, duration: 0.6, ease: 'back.out(1.6)', clearProps: '--highlight-scale' }, 0.7)
                    .fromTo(mark.querySelectorAll('path'), { '--draw': 1 }, { '--draw': 0, duration: 0.7, stagger: 0.25, ease: 'power2.inOut' }, 1);
            }

            // Scrolling away, the hero comes apart: shapes float off, the big word slides.
            // Each tween states its resting values so a fast scroll back never leaves it hidden.
            var apart = gsap.timeline({
                defaults: { ease: 'none', immediateRender: false },
                scrollTrigger: { trigger: '.wiki-hero', start: 'top top', end: 'bottom top', scrub: 0.6 }
            });
            apart.fromTo('.wiki-hero-word', { xPercent: 0 }, { xPercent: -30 }, 0)
                .fromTo('.wiki-hero-copy', { y: 0 }, { y: 80 }, 0);
            document.querySelectorAll('.wiki-hero-art .shape').forEach(function (shape, i) {
                apart.fromTo(shape, { y: 0, rotation: 0 }, { y: -(120 + (i % 3) * 90), rotation: (i % 2 ? 1 : -1) * (90 + i * 20) }, 0);
            });
            gsap.fromTo('.wiki-hero-wave', { '--wave': 1 }, {
                '--wave': 1.6, ease: 'none',
                scrollTrigger: { trigger: '.wiki-hero', start: 'bottom 90%', end: 'bottom top', scrub: true }
            });

            // Each section rises once as it arrives; its heading leads, the body follows.
            document.querySelectorAll('.wiki-content > div > section').forEach(function (section) {
                var parts = Array.prototype.slice.call(section.children).slice(0, 6);
                gsap.timeline({
                    defaults: { ease: 'power3.out', clearProps: clear },
                    scrollTrigger: { trigger: section, start: 'top 88%', once: true }
                })
                    .from(section, { y: 28, autoAlpha: 0, duration: 0.55 })
                    .from(parts, { y: 12, autoAlpha: 0, duration: 0.4, stagger: 0.05 }, 0.12)
                    .from(section, { rotation: -1.2, duration: 0.7, ease: 'back.out(2)' }, 0);
            });

            document.querySelectorAll('.wiki-update-grid, .tutorial-steps, .wiki-comparison-notes').forEach(function (grid) {
                gsap.from(grid.children, {
                    y: 14, autoAlpha: 0, duration: 0.4, ease: 'power2.out', stagger: 0.06, clearProps: clear,
                    scrollTrigger: { trigger: grid, start: 'top 88%', once: true }
                });
            });
            document.querySelectorAll('.wiki-content .callout').forEach(function (callout) {
                gsap.from(callout, {
                    x: -14, autoAlpha: 0, duration: 0.5, ease: 'power2.out', clearProps: clear,
                    scrollTrigger: { trigger: callout, start: 'top 90%', once: true }
                });
            });
        });

        window.addEventListener('load', function () {
            ScrollTrigger.refresh();
        }, { once: true, passive: true });
    }

    function bootWikiSearch() {
        var form = document.getElementById('wiki-search-form');
        var input = document.querySelector('[data-wiki-search]');
        var result = document.getElementById('wiki-search-results');
        if (!form || !input || !result) return;

        var sections = Array.prototype.slice.call(document.querySelectorAll('.wiki-content section[id]'));
        var vietnamese = document.documentElement.lang.toLowerCase().indexOf('vi') === 0;

        function showResult(text) {
            result.textContent = text;
        }

        function findAndScroll(query) {
            var normalized = query.trim().toLocaleLowerCase();
            if (!normalized) {
                showResult('');
                return;
            }

            var matches = sections.filter(function (section) {
                return section.textContent.toLocaleLowerCase().indexOf(normalized) !== -1;
            });

            if (!matches.length) {
                showResult(vietnamese
                    ? 'Chưa tìm thấy mục phù hợp. Thử “compiler”, “debugger” hoặc “tests”.'
                    : 'No matching section yet. Try “compiler”, “debugger”, or “tests”.');
                return;
            }

            var first = matches[0];
            showResult(vietnamese
                ? 'Tìm thấy ' + matches.length + ' mục phù hợp'
                : matches.length + (matches.length === 1 ? ' matching section' : ' matching sections'));
            first.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' });
            first.setAttribute('data-search-hit', 'true');
            window.setTimeout(function () { first.removeAttribute('data-search-hit'); }, 900);
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            findAndScroll(input.value);
        });

        input.addEventListener('input', function () {
            if (!input.value.trim()) showResult('');
        });
    }

    function bootWikiChrome() {
        document.querySelectorAll('.lang-btn').forEach(function (link) {
            link.addEventListener('click', function () {
                try { localStorage.setItem('wiki-lang', link.textContent.trim().toLowerCase()); } catch (error) { /* private mode */ }
            });
        });
    }

    function start() {
        bootWikiChrome();
        bootWikiSearch();
        bootSidebarMarker();
        bootWikiMotion();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
