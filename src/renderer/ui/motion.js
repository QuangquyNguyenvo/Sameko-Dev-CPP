/**
 * Sameko Dev C++ IDE - Motion
 * GSAP effects that CSS transitions handle poorly: menu items that cascade in, the Settings
 * popup springing open, and the Run button reacting to a build result.
 *
 * GSAP is not part of startup. It is loaded through Monaco's AMD loader (a UMD bundle loaded
 * after loader.js registers as an anonymous AMD module, so a <script> tag would not set
 * window.gsap) once the editor is up and the page is idle. Until then, and while Performance
 * Mode or the OS "reduce motion" setting is on, every call does nothing and the UI simply
 * appears in its final state.
 *
 * @module src/renderer/ui/motion
 */

const Motion = (() => {
    const GSAP_PATH = '../node_modules/gsap/dist/gsap.min';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let gsap = null;
    let loading = null;

    function load() {
        if (!loading) {
            loading = new Promise((resolve) => {
                window.require.config({ paths: { gsap: GSAP_PATH } });
                window.require(['gsap'], (mod) => {
                    gsap = mod.gsap || mod.default || null;
                    resolve();
                }, (err) => {
                    console.warn('[Motion] GSAP failed to load:', err && err.message ? err.message : err);
                    resolve();
                });
            });
        }
        return loading;
    }

    /** Loads GSAP once the editor is ready and the page has a quiet moment. */
    function loadWhenIdle() {
        const start = () => (window.requestIdleCallback || setTimeout)(load, { timeout: 4000 });
        // App is a top-level const in core.js, so it is not a window property.
        const wait = () => (typeof App !== 'undefined' && App.ready ? start() : setTimeout(wait, 250));
        wait();
    }

    function enabled() {
        return !!gsap && !reducedMotion.matches && !document.body.classList.contains('performance-mode');
    }

    /** Dropdown menu: items slide in one after another. */
    function menuIn(menu) {
        if (!enabled() || !menu) return;
        const items = menu.querySelectorAll(':scope > .dropdown-item, :scope > .dropdown-sep');
        gsap.fromTo(items, { opacity: 0, x: -8 }, {
            opacity: 1, x: 0, duration: 0.28, stagger: 0.025, ease: 'power3.out', clearProps: 'opacity,transform',
        });
    }

    /** Modal popup: the backdrop fades, the card springs up from slightly smaller. */
    function popIn(overlay, card) {
        if (!enabled() || !card) return;
        gsap.killTweensOf([overlay, card]);
        if (overlay) gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out', clearProps: 'opacity' });
        gsap.fromTo(card, { opacity: 0, scale: 0.94, y: 14 }, {
            opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.5)', clearProps: 'opacity,transform',
        });
    }

    /** Run button after a build: a bounce on success, a shake on failure. */
    function buildResult(button, ok) {
        if (!enabled() || !button) return;
        const icon = button.querySelector('.ico');
        gsap.killTweensOf([button, icon]);
        if (ok) {
            gsap.timeline({ defaults: { clearProps: 'transform' } })
                .to(icon, { y: -6, scale: 1.25, duration: 0.16, ease: 'power2.out' })
                .to(icon, { y: 0, scale: 1, duration: 0.5, ease: 'bounce.out' });
        } else {
            gsap.fromTo(button, { x: 0 }, {
                keyframes: { x: [0, -6, 6, -4, 4, -2, 0] }, duration: 0.42, ease: 'power1.out', clearProps: 'transform',
            });
        }
    }

    loadWhenIdle();

    return { load, enabled, menuIn, popIn, buildResult };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Motion; else window.Motion = Motion;
