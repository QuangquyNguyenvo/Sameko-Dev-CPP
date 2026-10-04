(function () {
    'use strict';
    if (!document.body.classList.contains('sameko-home')) return;

    const story = document.querySelector('.story');
    const ide = story && story.querySelector('.ide');
    const chapters = story ? Array.from(story.querySelectorAll('.chapter')) : [];
    const tabs = story ? Array.from(story.querySelectorAll('[data-go]')) : [];
    const statusLabel = story && story.querySelector('[data-status]');
    const storyNum = story && story.querySelector('[data-story-num]');
    const swatches = story ? Array.from(story.querySelectorAll('[data-swatch]')) : [];
    const codeLines = story ? Array.from(story.querySelectorAll('.ide__code li')) : [];
    const exec = story && story.querySelector('.ide__exec');
    const stamp = story && story.querySelector('.ide__stamp');
    const suggest = story && story.querySelector('.ide__suggest');
    const tests = story ? Array.from(story.querySelectorAll('.ide__tests li')) : [];
    const watch = story ? {
        i: story.querySelector('[data-watch="i"]'),
        ai: story.querySelector('[data-watch="ai"]'),
        sum: story.querySelector('[data-watch="sum"]')
    } : {};
    const values = [4, 8, 15, 16, 23];
    const sums = [4, 12, 27, 43, 66];
    const STATUS = ['Built in 0.48 s', 'Debugging', 'Kawaii Light'];
    const THEMES = ['kawaii-light', 'sakura', 'kawaii-dark', 'nord'];
    let activeChapter = -1;
    let chapterLoop = null;
    let storyTrigger = null;

    const hasGsap = Boolean(window.gsap && window.ScrollTrigger);
    function reducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    function siteTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'kawaii-dark' : 'kawaii-light';
    }
    function setIdeTheme(id) {
        if (!ide) return;
        ide.setAttribute('data-ide-theme', id);
        swatches.forEach(swatch => swatch.classList.toggle('is-on', swatch.getAttribute('data-swatch') === id));
        if (activeChapter === 2 && statusLabel) {
            const swatch = swatches.find(item => item.getAttribute('data-swatch') === id);
            statusLabel.textContent = swatch ? swatch.textContent : STATUS[2];
        }
    }
    function setWatch(step) {
        if (!watch.i) return;
        watch.i.textContent = String(step);
        watch.ai.textContent = String(values[step]);
        watch.sum.textContent = String(sums[step]);
    }
    function lineTop(index) {
        const line = codeLines[index];
        return line ? line.offsetTop + line.parentElement.offsetTop : 0;
    }

    // Undo whatever a chapter's loop left behind before the next one starts.
    function resetStage() {
        if (chapterLoop) { chapterLoop.kill(); chapterLoop = null; }
        if (!hasGsap) return;
        const watchParts = Array.from(story.querySelectorAll('.ide__watch b, .ide__watch li'));
        gsap.killTweensOf([ide, stamp, suggest, exec].concat(codeLines, tests, swatches, watchParts));
        gsap.set(codeLines.concat(tests, swatches, watchParts), { clearProps: 'all' });
        gsap.set([stamp, suggest, exec], { autoAlpha: 0 });
        gsap.set(ide, { clearProps: 'transform' });
    }

    // Each chapter owns one small loop inside the mock window.
    function playChapter(index) {
        const animate = hasGsap && !reducedMotion();
        if (index === 0) {
            if (!animate) { if (stamp) { stamp.style.opacity = '1'; stamp.style.visibility = 'visible'; } return; }
            chapterLoop = gsap.timeline({ repeat: -1, repeatDelay: 1.6 })
                .set(stamp, { autoAlpha: 0 })
                .fromTo(codeLines, { clipPath: 'inset(0 100% 0 0)' },
                    { clipPath: 'inset(0 0% 0 0)', duration: 0.22, stagger: 0.08, ease: 'none' })
                .fromTo(stamp, { autoAlpha: 0, scale: 0.2, rotation: -40 },
                    { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.5, ease: 'back.out(3)' })
                .fromTo(tests, { y: 14, scale: 0.6, autoAlpha: 0 },
                    { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, stagger: 0.12, ease: 'back.out(3)', immediateRender: false }, '-=0.2');
        } else if (index === 1) {
            if (!exec) return;
            const forTop = lineTop(6);
            const bodyTop = lineTop(7);
            if (!animate) {
                exec.style.opacity = '1'; exec.style.visibility = 'visible';
                exec.style.transform = 'translateY(' + bodyTop + 'px)';
                setWatch(3);
                return;
            }
            gsap.set(exec, { autoAlpha: 1, y: forTop });
            chapterLoop = gsap.timeline({ repeat: -1 });
            values.forEach((_, step) => {
                chapterLoop.to(exec, { y: forTop, duration: 0.28, ease: 'power3.inOut' })
                    .to(exec, { y: bodyTop, duration: 0.28, ease: 'power3.inOut' }, '+=0.3')
                    .call(() => setWatch(step))
                    .fromTo(story.querySelectorAll('.ide__watch b'), { scale: 1.6, y: -4 },
                        { scale: 1, y: 0, duration: 0.45, ease: 'back.out(3)', immediateRender: false })
                    .fromTo(story.querySelectorAll('.ide__watch li'), { y: -6 },
                        { y: 0, duration: 0.4, stagger: 0.05, ease: 'bounce.out', immediateRender: false }, '<')
                    .to({}, { duration: 0.35 });
            });
        } else if (index === 2) {
            if (!animate) {
                if (suggest) { suggest.style.opacity = '1'; suggest.style.visibility = 'visible'; }
                setIdeTheme(THEMES[0]);
                return;
            }
            gsap.fromTo(suggest, { autoAlpha: 0, scale: 0.4, y: 10 },
                { autoAlpha: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(3)', delay: 0.2 });
            chapterLoop = gsap.timeline({ repeat: -1 });
            THEMES.forEach((id, i) => {
                chapterLoop.call(() => setIdeTheme(id))
                    .fromTo(ide, { scaleX: 1.04, scaleY: 0.95 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1, 0.45)', immediateRender: false })
                    .fromTo(swatches[i], { scale: 1.25 }, { scale: 1, duration: 0.4, ease: 'back.out(3)', immediateRender: false }, '<')
                    .to({}, { duration: 1.2 });
            });
        }
    }

    function setChapter(index) {
        if (!story || index === activeChapter) return;
        const direction = index > activeChapter ? 1 : -1;
        const first = activeChapter < 0;
        activeChapter = index;
        story.setAttribute('data-chapter', String(index));
        chapters.forEach((chapter, i) => chapter.classList.toggle('is-active', i === index));
        tabs.forEach((tab, i) => tab.setAttribute('aria-current', i === index ? 'true' : 'false'));
        if (statusLabel) statusLabel.textContent = STATUS[index];
        if (storyNum) storyNum.textContent = String(index + 1).padStart(2, '0');
        if (story.querySelector('.ide__stamp')) {
            [stamp, suggest, exec].forEach(el => { if (el) el.removeAttribute('style'); });
        }
        resetStage();
        if (index !== 2) setIdeTheme(siteTheme());

        if (hasGsap && !reducedMotion() && !first) {
            gsap.fromTo(chapters[index].children, { y: 40 * direction, autoAlpha: 0 },
                { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.07, ease: 'back.out(1.6)', clearProps: 'transform,opacity,visibility' });
            gsap.fromTo('.story__stage', { rotation: -3 * direction, scale: 0.95 },
                { rotation: 0, scale: 1, duration: 0.7, ease: 'back.out(2.2)', overwrite: true, clearProps: 'transform' });
            gsap.fromTo(storyNum, { scale: 0.3, rotation: -25 * direction }, { scale: 1, rotation: -8, duration: 0.6, ease: 'back.out(3)' });
        }
        playChapter(index);
    }

    if (story) {
        setIdeTheme(siteTheme());
        new MutationObserver(() => { if (activeChapter !== 2) setIdeTheme(siteTheme()); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        tabs.forEach((tab, i) => tab.addEventListener('click', () => {
            if (storyTrigger) {
                const target = storyTrigger.start + (storyTrigger.end - storyTrigger.start) * ((i + 0.5) / chapters.length);
                window.scrollTo({ top: target, behavior: reducedMotion() ? 'instant' : 'smooth' });
            } else {
                setChapter(i);
            }
        }));
    }

    if (!hasGsap) {
        if (story) setChapter(0);
        return;
    }
    gsap.registerPlugin(ScrollTrigger);

    // Wrap each word of a heading so it can light up as the reader scrolls.
    function splitWords(element) {
        if (element.dataset.split) return element.querySelectorAll('.w');
        element.dataset.split = 'true';
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode: node => node.parentElement.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            const fragment = document.createDocumentFragment();
            node.textContent.split(/(\s+)/).forEach(part => {
                if (!part) return;
                if (/^\s+$/.test(part)) { fragment.appendChild(document.createTextNode(part)); return; }
                const span = document.createElement('span');
                span.className = 'w';
                span.textContent = part;
                fragment.appendChild(span);
            });
            node.parentNode.replaceChild(fragment, node);
        });
        return element.querySelectorAll('.w');
    }

    function navBottom() {
        const nav = document.querySelector('.nav');
        return nav ? Math.ceil(nav.getBoundingClientRect().bottom) : 80;
    }

    const initialHash = window.location.hash;
    let introPlayed = false;
    let initialNavigationCanceled = false;
    const cancelInitialNavigation = () => { initialNavigationCanceled = true; };
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(type =>
        window.addEventListener(type, cancelInitialNavigation, { passive: true, once: true }));

    gsap.to('.scroll-progress span', {
        scaleX: 1, ease: 'none',
        scrollTrigger: { start: 0, end: 'max', scrub: 0.3 }
    });

    const media = gsap.matchMedia();
    media.add({
        desktop: '(min-width: 901px)',
        mobile: '(max-width: 900px)',
        reduced: '(prefers-reduced-motion: reduce)'
    }, context => {
        const { desktop, reduced } = context.conditions;
        const clear = 'transform,opacity,visibility';
        const steps = document.querySelector('.steps');

        // 03: the whole story pins; scrolling picks a chapter, text and window swap together.
        if (story) {
            story.classList.add('is-pinned');
            const pick = self => setChapter(Math.min(chapters.length - 1, Math.floor(self.progress * chapters.length)));
            storyTrigger = ScrollTrigger.create({
                trigger: story,
                pin: true,
                start: () => {
                    const room = window.innerHeight - navBottom();
                    const offset = navBottom() + Math.max(12, (room - story.offsetHeight) / 2);
                    return 'top ' + Math.round(offset) + 'px';
                },
                end: () => '+=' + Math.round(window.innerHeight * 1.8),
                // The hero pin above adds scroll space; measure this one after it.
                refreshPriority: -1,
                invalidateOnRefresh: true,
                onUpdate: pick,
                onRefresh: pick
            });
            if (activeChapter < 0) setChapter(0);
            if (!reduced) {
                gsap.timeline({ scrollTrigger: { trigger: story, start: () => storyTrigger.start, end: () => storyTrigger.end, scrub: 0.8, refreshPriority: -2 } })
                    .to('.story__blob--sky', { rotation: 160, x: -30, ease: 'none' }, 0)
                    .to('.story__blob--butter', { rotation: -200, y: -40, ease: 'none' }, 0);
            }
        }

        if (reduced) {
            return () => {
                if (story) story.classList.remove('is-pinned');
                storyTrigger = null;
            };
        }

        // Hero: shapes and the highlight arrive, then the scene comes apart on scroll.
        const hlPaths = document.querySelectorAll('.hero__highlight path');
        if (!introPlayed && !initialHash) {
            const intro = gsap.timeline({ defaults: { duration: 0.8, ease: 'power3.out', clearProps: clear } });
            intro.from('.hero__badge', { y: 14, autoAlpha: 0, ease: 'back.out(2)' }, 0)
                .from('.hero__title > span', { y: 56, autoAlpha: 0, stagger: 0.14, ease: 'back.out(1.6)' }, 0.1)
                .from('.hero__lede, .hero__actions, .dl-hint', { y: 18, autoAlpha: 0, stagger: 0.08 }, 0.45)
                .from('.hero__sun', { scale: 0, duration: 0.7, ease: 'back.out(2.5)' }, 0.4)
                .from('.hero__visual img', { y: 60, autoAlpha: 0, duration: 1, ease: 'back.out(1.4)' }, 0.3)
                .from('.hero__word', { xPercent: 20, autoAlpha: 0, duration: 1.2 }, 0.1)
                .from('.shape', { scale: 0, autoAlpha: 0, stagger: 0.05, duration: 0.6, ease: 'back.out(3)' }, 0.4)
                .from('.hero__spark, .hero__sticker, .hero__chip', { y: 16, scale: 0.4, autoAlpha: 0, stagger: 0.08, ease: 'back.out(2.4)' }, 0.8);
            intro.fromTo('.hero__highlight', { '--highlight-scale': 0 }, {
                '--highlight-scale': 1, duration: 0.6, ease: 'back.out(1.6)', clearProps: '--highlight-scale'
            }, 0.7);
            intro.fromTo(hlPaths, { '--draw': 1 }, { '--draw': 0, duration: 0.7, stagger: 0.25, ease: 'power2.inOut' }, 1.1);
        }
        introPlayed = true;

        if (desktop) {
            const apart = gsap.timeline({
                defaults: { ease: 'none' },
                scrollTrigger: { trigger: '.hero-band', start: 'top top', end: '+=75%', scrub: 0.8, pin: true }
            });
            apart.to('.hero__title > span:first-child', { xPercent: -18, opacity: 0.15 }, 0)
                .to('.hero__title > span:last-child', { xPercent: 14, opacity: 0.15 }, 0)
                .to('.hero__badge, .hero__lede, .hero__actions, .dl-hint', { y: -50, opacity: 0, stagger: 0.04 }, 0)
                .to('.hero__visual img', { scale: 1.16, y: -30, rotation: -3 }, 0)
                .to('.hero__sun', { x: 120, y: -140, scale: 0.6 }, 0)
                .to('.hero__sticker--compiler', { x: -260, y: -120, rotation: -30, opacity: 0 }, 0)
                .to('.hero__sticker--run', { x: 240, y: 60, rotation: 30, opacity: 0 }, 0)
                .to('.hero__chip--lint', { x: -200, y: -160, rotation: -20, opacity: 0 }, 0)
                .to('.hero__chip--ac', { x: 220, y: -140, rotation: 20, opacity: 0 }, 0)
                .to('.hero__spark', { scale: 2.4, rotation: 180, opacity: 0 }, 0)
                .to('.hero__word', { xPercent: -45 }, 0)
                .to('.hero__scroll', { opacity: 0 }, 0);
            document.querySelectorAll('.shape').forEach((shape, i) => {
                apart.to(shape, { y: -(220 + (i % 4) * 110), rotation: (i % 2 ? 1 : -1) * (120 + i * 25), scale: 1.3 }, 0);
            });
        } else {
            gsap.to('.hero__word', {
                xPercent: -30, ease: 'none',
                scrollTrigger: { trigger: '.hero-band', start: 'top top', end: 'bottom top', scrub: 0.6 }
            });
        }

        // Each divider starts flat and swells into a wave as its section rises.
        document.querySelectorAll('.band').forEach(band => {
            gsap.fromTo(band, { '--wave': 0.25 }, {
                '--wave': 1.15, ease: 'none',
                scrollTrigger: { trigger: band, start: 'top bottom', end: 'top 45%', scrub: 0.6 }
            });
        });

        document.querySelectorAll('.band__head').forEach(head => {
            const heading = head.querySelector('.h-section');
            if (heading) {
                gsap.fromTo(splitWords(heading), { autoAlpha: 0.12, y: 18 }, {
                    autoAlpha: 1, y: 0, stagger: 0.08, ease: 'none',
                    scrollTrigger: { trigger: heading, start: 'top 88%', end: 'top 52%', scrub: 0.6 }
                });
            }
            gsap.from(head.querySelectorAll('.eyebrow, .lede'), {
                y: 16, autoAlpha: 0, stagger: 0.15, duration: 0.7, ease: 'back.out(2)', clearProps: clear,
                scrollTrigger: { trigger: head, start: 'top 85%', once: true }
            });
        });
        const ctaHeading = document.querySelector('#cta .h-section');
        if (ctaHeading) {
            gsap.fromTo(splitWords(ctaHeading), { autoAlpha: 0.1, y: 30 }, {
                autoAlpha: 1, y: 0, stagger: 0.1, ease: 'none',
                scrollTrigger: { trigger: '#cta', start: 'top 80%', end: 'top 35%', scrub: 0.6 }
            });
            const ctaMark = { trigger: '#cta .hl', start: 'top 75%', once: true };
            gsap.fromTo('#cta .hl', { '--highlight-scale': 0 }, {
                '--highlight-scale': 1, ease: 'back.out(1.6)', duration: 0.6, scrollTrigger: ctaMark
            });
            gsap.fromTo('#cta .hl path', { '--draw': 1 }, {
                '--draw': 0, duration: 0.8, ease: 'power2.inOut', delay: 0.3, scrollTrigger: ctaMark
            });
            gsap.from('#cta .lede, #cta .cta__actions, #cta .cta__links', {
                y: 24, autoAlpha: 0, stagger: 0.12, duration: 0.8, ease: 'back.out(1.8)', clearProps: clear,
                scrollTrigger: { trigger: '#cta .cta__actions', start: 'top 92%', once: true }
            });
        }

        // 01: the number falls from the slowest build to Sameko's as the bars fill.
        const benchNumber = document.getElementById('bench-number');
        const bench = document.querySelector('.bench');
        if (bench && benchNumber) {
            const counter = { value: 2500 };
            // Plays once as the chart arrives, so 500 ms is visible right away.
            gsap.timeline({ scrollTrigger: { trigger: bench, start: 'top 80%', once: true } })
                .fromTo('.bench__bars li', { '--p': 0 }, { '--p': 1, duration: 0.9, ease: 'power3.out', stagger: { each: 0.1, from: 'end' } }, 0)
                .fromTo(counter, { value: 2500 }, {
                    value: 500, ease: 'power3.out', duration: 1.4,
                    onUpdate: () => { benchNumber.textContent = String(Math.round(counter.value / 10) * 10); }
                }, 0);
            gsap.from('.std-row li', {
                y: 20, scale: 0.6, autoAlpha: 0, stagger: 0.06, duration: 0.5, ease: 'back.out(3)', clearProps: clear,
                scrollTrigger: { trigger: '.std-row', start: 'top 92%', once: true }
            });
        }

        // 02: a bar fills through the steps and pops each number it reaches.
        if (steps) {
            const items = Array.from(steps.querySelectorAll('.steps__item'));
            steps.classList.add('is-live');
            gsap.fromTo(steps, { '--line': 0 }, {
                '--line': 1, ease: 'none',
                scrollTrigger: {
                    trigger: steps, start: 'top 72%', end: 'bottom 55%', scrub: 0.5,
                    onUpdate: self => items.forEach((item, i) => {
                        const on = self.progress >= i / (items.length - 1) - 0.02;
                        if (on && !item.classList.contains('is-on')) {
                            gsap.fromTo(item.querySelector('.steps__num'), { scale: 0.7 }, { scale: 1, duration: 0.5, ease: 'back.out(3.5)', clearProps: 'transform' });
                        }
                        item.classList.toggle('is-on', on);
                    })
                }
            });
            gsap.from(steps.querySelectorAll('h3, p'), {
                y: 16, autoAlpha: 0, stagger: 0.08, duration: 0.6, ease: 'power3.out', clearProps: clear,
                scrollTrigger: { trigger: steps, start: 'top 82%', once: true }
            });
        }

        const line = document.querySelector('.stack__line');
        if (line) {
            const pass = { trigger: '.stack', start: 'top bottom', end: 'bottom top', scrub: 0.6, invalidateOnRefresh: true };
            gsap.fromTo(line, { x: 0 }, { x: () => -Math.max(0, line.scrollWidth - window.innerWidth), ease: 'none', scrollTrigger: pass });
            gsap.fromTo(line.children, { rotation: -4 }, { rotation: 4, ease: 'none', stagger: { each: 0.02, from: 'center' }, scrollTrigger: pass });
        }

        const table = document.querySelector('.cmp');
        if (table) {
            gsap.from(table, {
                y: 40, rotation: 1.5, autoAlpha: 0, duration: 0.8, ease: 'back.out(1.6)', clearProps: clear,
                scrollTrigger: { trigger: table, start: 'top 85%', once: true }
            });
            gsap.from(table.querySelectorAll('tbody :is(.cmp__yes, .cmp__part, .cmp__no)'), {
                scale: 0, duration: 0.4, stagger: 0.015, ease: 'back.out(3)', clearProps: 'transform',
                scrollTrigger: { trigger: table, start: 'top 70%', once: true }
            });
        }

        // 05: keys drop in, then get "pressed" in order.
        const keys = document.querySelector('.keys');
        if (keys) {
            const keyCaps = Array.from(keys.querySelectorAll('kbd'));
            const press = gsap.timeline({ scrollTrigger: { trigger: keys, start: 'top 75%', once: true } });
            press.from(keys.children, { y: 40, rotation: () => gsap.utils.random(-8, 8), autoAlpha: 0, stagger: 0.06, duration: 0.6, ease: 'back.out(2.2)', clearProps: clear });
            keyCaps.forEach((cap, i) => {
                press.call(() => cap.classList.add('is-pressed'), null, 0.6 + i * 0.07)
                    .call(() => cap.classList.remove('is-pressed'), null, 0.72 + i * 0.07);
            });
        }

        gsap.from('.faq-item', {
            y: 26, autoAlpha: 0, stagger: 0.07, duration: 0.55, ease: 'back.out(2)', clearProps: clear,
            scrollTrigger: { trigger: '.faq-list', start: 'top 88%', once: true }
        });

        return () => {
            if (story) story.classList.remove('is-pinned');
            if (steps) steps.classList.remove('is-live');
            storyTrigger = null;
        };
    });

    const navLinks = Array.from(document.querySelectorAll('.nav__links a[href^="#"]'));
    function updateNav(id) {
        navLinks.forEach(link => {
            if (link.hash === '#' + id) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        });
    }
    navLinks.forEach(link => {
        const section = document.querySelector(link.hash);
        if (!section) return;
        ScrollTrigger.create({
            trigger: section, start: 'top 35%', end: 'bottom 35%',
            onToggle: self => {
                if (self.isActive) updateNav(section.id);
                else link.removeAttribute('aria-current');
            }
        });
    });

    // Expanded answers move every later trigger.
    document.querySelectorAll('.faq-answer').forEach(answer => {
        answer.addEventListener('transitionend', event => {
            if (event.propertyName === 'grid-template-rows') ScrollTrigger.refresh();
        });
    });

    // Measure after images and fonts, then restore a direct section link once,
    // without moving anyone who has already started scrolling.
    const loaded = document.readyState === 'complete' ? Promise.resolve() :
        new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    Promise.all([loaded, fonts]).then(() => requestAnimationFrame(() => {
        ScrollTrigger.refresh();
        requestAnimationFrame(() => {
            if (!initialNavigationCanceled && initialHash && initialHash === window.location.hash && initialHash !== '#download-trigger') {
                const target = document.getElementById(initialHash.slice(1));
                if (target) window.scrollTo({
                    top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - navBottom() - 16),
                    behavior: 'instant'
                });
            }
            ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(type =>
                window.removeEventListener(type, cancelInitialNavigation));
        });
    }));
})();
