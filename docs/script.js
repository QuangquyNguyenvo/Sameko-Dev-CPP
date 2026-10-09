// ===== REVEAL ANIMATIONS (Critical — must run first) =====
try {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
} catch (e) {
    // Fallback: show all content immediately if observer fails
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('active'));
    console.warn('Reveal observer failed, showing content directly:', e);
}

// ===== DROPDOWN LOGIC =====
var dlTrigger = document.getElementById('download-trigger');
var dlWrapper = document.querySelector('.dropdown-wrapper');
var dlMenu = document.getElementById('download-menu')
    || (dlWrapper && dlWrapper.querySelector('.drop-menu'));
var dlPopoverEnabled = Boolean(dlMenu
    && dlMenu.hasAttribute('popover')
    && typeof dlMenu.showPopover === 'function'
    && typeof dlMenu.hidePopover === 'function');
var dlPositionFrame = 0;
var dlPopoverStyles = [
    'position', 'inset', 'top', 'right', 'bottom', 'left', 'margin',
    'max-width', 'max-height', 'overflow-y'
];
var dlFallbackStyles = ['display', 'opacity', 'visibility', 'transform'];

function isDownloadMenuOpen() {
    if (dlMenu && dlPopoverEnabled) {
        try {
            return dlMenu.matches(':popover-open');
        } catch (e) {
            // Older Chromium builds do not parse :popover-open even if the
            // methods exist. The wrapper class remains a safe fallback.
        }
    }
    return Boolean(dlWrapper && dlWrapper.classList.contains('active'));
}

function syncDownloadMenuAria(open) {
    var isOpen = typeof open === 'boolean' ? open : isDownloadMenuOpen();
    if (dlTrigger) {
        dlTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (dlMenu && dlMenu.id) dlTrigger.setAttribute('aria-controls', dlMenu.id);
    }
    if (dlMenu) {
        dlMenu.classList.toggle('drop-menu--open', isOpen);
        dlMenu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }
}

function clearDownloadMenuPosition() {
    if (!dlMenu) return;
    dlPopoverStyles.forEach(function (property) {
        dlMenu.style.removeProperty(property);
    });
}

function clearDownloadMenuFallbackStyles() {
    if (!dlMenu) return;
    dlFallbackStyles.forEach(function (property) {
        dlMenu.style.removeProperty(property);
    });
}

function prepareDownloadMenuFallback() {
    if (!dlMenu) return;

    // A failed showPopover() can leave the UA's popover rule (display:none)
    // behind. Removing the attribute switches the element back to normal CSS.
    if (dlMenu.hasAttribute('popover')) dlMenu.removeAttribute('popover');
    if (document.body && dlMenu.parentNode !== document.body) {
        // A fixed menu inside a transformed/clipped section is still confined
        // by that section in older engines; body makes the viewport contract
        // reliable. The explicit open class keeps the menu's CSS state intact.
        document.body.appendChild(dlMenu);
    }
    dlMenu.style.setProperty('display', 'block');
    dlMenu.style.setProperty('opacity', '1');
    dlMenu.style.setProperty('visibility', 'visible');
    dlMenu.style.setProperty('transform', 'none');
}

function getDownloadViewport() {
    var viewport = window.visualViewport;
    return {
        left: viewport && Number.isFinite(viewport.offsetLeft) ? viewport.offsetLeft : 0,
        top: viewport && Number.isFinite(viewport.offsetTop) ? viewport.offsetTop : 0,
        width: viewport && viewport.width ? viewport.width : window.innerWidth,
        height: viewport && viewport.height ? viewport.height : window.innerHeight
    };
}

function positionDownloadMenu() {
    if (!dlMenu || !dlTrigger || !isDownloadMenuOpen()) return;

    if (!dlPopoverEnabled) prepareDownloadMenuFallback();

    var viewport = getDownloadViewport();
    var margin = 12;
    var gap = 10;
    var triggerRect = dlTrigger.getBoundingClientRect();
    var availableWidth = Math.max(0, viewport.width - (margin * 2));
    var availableHeight = Math.max(0, viewport.height - (margin * 2));

    // The menu is in the top layer while open. Fixed coordinates keep it
    // aligned to the trigger while avoiding every ancestor's overflow/transform.
    dlMenu.style.setProperty('position', 'fixed');
    dlMenu.style.setProperty('inset', 'auto');
    dlMenu.style.setProperty('margin', '0');
    dlMenu.style.setProperty('max-width', availableWidth + 'px');
    dlMenu.style.setProperty('max-height', availableHeight + 'px');
    dlMenu.style.setProperty('overflow-y', 'auto');

    var menuWidth = Math.min(dlMenu.offsetWidth || 360, availableWidth);
    var menuHeight = Math.min(dlMenu.offsetHeight || 0, availableHeight);
    var left = triggerRect.left;
    var top = triggerRect.bottom + gap;
    var belowBottom = top + menuHeight;
    var aboveTop = triggerRect.top - gap - menuHeight;

    if (belowBottom > viewport.top + viewport.height - margin
        && aboveTop >= viewport.top + margin) {
        top = aboveTop;
    }

    left = Math.max(viewport.left + margin,
        Math.min(left, viewport.left + viewport.width - margin - menuWidth));
    top = Math.max(viewport.top + margin,
        Math.min(top, viewport.top + viewport.height - margin - menuHeight));

    dlMenu.style.setProperty('left', Math.round(left - viewport.left) + 'px');
    dlMenu.style.setProperty('top', Math.round(top - viewport.top) + 'px');
}

function scheduleDownloadMenuPosition() {
    if (!dlMenu || !isDownloadMenuOpen()) return;
    if (dlPositionFrame) cancelAnimationFrame(dlPositionFrame);
    dlPositionFrame = requestAnimationFrame(function () {
        dlPositionFrame = 0;
        positionDownloadMenu();
    });
}

function closeDownloadMenu(restoreFocus) {
    if (!dlWrapper) return;

    dlWrapper.classList.remove('active');
    if (dlMenu && dlPopoverEnabled && isDownloadMenuOpen()) {
        try {
            dlMenu.hidePopover();
        } catch (e) {
            // If the browser rejects the top-layer operation, fallback CSS
            // still closes the menu through the wrapper's active class.
            dlPopoverEnabled = false;
            clearDownloadMenuPosition();
            prepareDownloadMenuFallback();
        }
    }
    if (dlMenu && !dlPopoverEnabled) {
        clearDownloadMenuPosition();
        clearDownloadMenuFallbackStyles();
    }
    syncDownloadMenuAria(false);

    if (restoreFocus && dlTrigger && typeof dlTrigger.focus === 'function') {
        dlTrigger.focus({ preventScroll: true });
    }
}

function openDownloadMenu() {
    if (!dlWrapper) return;

    dlWrapper.classList.add('active');
    if (dlMenu && dlPopoverEnabled && !isDownloadMenuOpen()) {
        try {
            // Show first so the browser promotes the element to the top layer;
            // positioning happens on the next frame after its dimensions exist.
            dlMenu.showPopover();
        } catch (e) {
            dlPopoverEnabled = false;
            clearDownloadMenuPosition();
            prepareDownloadMenuFallback();
        }
    }
    if (dlMenu && !dlPopoverEnabled) prepareDownloadMenuFallback();
    syncDownloadMenuAria(true);
    scheduleDownloadMenuPosition();
}

function downloadEventInsideMenu(event) {
    if (!event) return false;
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.length > 0 && dlMenu && path.indexOf(dlMenu) !== -1) return true;
    return Boolean(dlMenu && dlMenu.contains(event.target));
}

try {
    if (dlTrigger && dlWrapper) {
        dlTrigger.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (isDownloadMenuOpen()) closeDownloadMenu(false);
            else openDownloadMenu();
        });

        // Pointer events catch clicks even when the popover is promoted to the
        // top layer. Links close after their default navigation is preserved.
        document.addEventListener('pointerdown', function (event) {
            if (!isDownloadMenuOpen()) return;
            var insideWrapper = dlWrapper.contains(event.target);
            var insideMenu = downloadEventInsideMenu(event);
            if (!insideWrapper && !insideMenu) closeDownloadMenu(false);
        });

        dlMenu && dlMenu.addEventListener('click', function (event) {
            var link = event.target && event.target.closest
                ? event.target.closest('a') : null;
            if (link) closeDownloadMenu(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && isDownloadMenuOpen()) {
                event.preventDefault();
                closeDownloadMenu(true);
            }
        });

        window.addEventListener('resize', scheduleDownloadMenuPosition, { passive: true });
        window.addEventListener('scroll', scheduleDownloadMenuPosition, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', scheduleDownloadMenuPosition, { passive: true });
            window.visualViewport.addEventListener('scroll', scheduleDownloadMenuPosition, { passive: true });
        }

        // Release metadata can hide rows and change the menu's height while it
        // is open. Recalculate without coupling to the fetch implementation.
        if (dlMenu && typeof ResizeObserver === 'function') {
            new ResizeObserver(scheduleDownloadMenuPosition).observe(dlMenu);
        }
        syncDownloadMenuAria(false);
    }

// Fetch Releases — gán URL cho từng artifact theo nền tảng
fetch('https://api.github.com/repos/QuangquyNguyenvo/Sameko-Dev-CPP/releases')
    .then(res => res.json())
    .then(data => {
        if (!Array.isArray(data) || data.length === 0) return;

        // Bỏ qua draft và prerelease; nếu không còn gì thì mới dùng data[0]
        const latest = data.find(r => !r.draft && !r.prerelease) || data[0];
        const fallback = latest.html_url;

        // id phần tử -> hàm nhận diện tên file (đã toLowerCase)
        const MATCHERS = {
            'dl-installer': n => n.endsWith('.exe'),
            'dl-portable': n => n.endsWith('.zip'),
            'dl-appimage': n => n.endsWith('.appimage'),
            'dl-deb': n => n.endsWith('.deb'),
            'dl-targz': n => n.endsWith('.tar.gz')
        };

        const assets = Array.isArray(latest.assets) ? latest.assets : [];

        Object.keys(MATCHERS).forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            // Có hai file .exe: ưu tiên bộ cài mới (*-installer.exe từ 1.3.1, Sameko-Setup-*.exe ở 1.3.0)
            const isSetup = n => n.endsWith('-installer.exe') || n.startsWith('sameko-setup-');
            const hit = (id === 'dl-installer' && assets.find(a => isSetup(a.name.toLowerCase())))
                || assets.find(a => MATCHERS[id](a.name.toLowerCase()));

            if (hit) {
                el.href = hit.browser_download_url;
                if (hit.size) {
                    const sizeEl = el.querySelector('.drop-size');
                    if (sizeEl) sizeEl.textContent = (hit.size / 1048576).toFixed(1) + ' MB';
                }
                return;
            }

            // Không tìm thấy asset khớp.
            // - Nếu release CÓ asset (nghĩa là dữ liệu đáng tin) mà vẫn không khớp
            //   => định dạng này chưa được phát hành => ẩn hẳn, đừng dẫn người dùng vào ngõ cụt.
            // - Nếu release KHÔNG có asset nào (API lỗi / rate-limit) => giữ nguyên,
            //   href mặc định đã trỏ trang Releases.
            el.href = fallback;
            if (assets.length > 0) el.hidden = true;
            else el.classList.add('drop-item--fallback');
        });

        // Nhóm nào không còn mục nào hiện thì ẩn cả nhóm (kể cả nhãn)
        document.querySelectorAll('.drop-group').forEach(group => {
            const alive = group.querySelectorAll('.drop-item:not([hidden])').length;
            if (alive === 0) group.hidden = true;
        });

        // Dynamic hero badge with release name
        const heroBadge = document.getElementById('hero-badge');
        if (heroBadge && latest.name) {
            heroBadge.textContent = latest.name;
        }
    })
    .catch(e => console.log('GitHub API warning: ', e));

// Đoán nền tảng để làm nổi nhóm phù hợp trong dropdown
(function detectOS() {
    const ua = navigator.userAgent;
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    let os = 'other';
    if (/Win/i.test(plat) || /Windows/i.test(ua)) os = 'windows';
    else if (/Linux/i.test(plat) && !/Android/i.test(ua)) os = 'linux';
    else if (/Mac/i.test(plat)) os = 'mac';

    document.documentElement.setAttribute('data-os', os);

    const hint = document.getElementById('dl-hint');
    if (!hint) return;
    if (os === 'windows') hint.textContent = 'Windows 10/11 · 64-bit · Free & open source';
    else if (os === 'linux') hint.textContent = 'Linux x64 · AppImage, .deb, tar.gz · Free & open source';
    else if (os === 'mac') hint.textContent = 'No official macOS build yet — see the wiki to build from source';
    else hint.textContent = 'Windows 10/11 · Linux x64 · Free & open source';
})();
} catch (e) { console.warn('Dropdown/fetch section error:', e); }

try {
const barObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const bars = entry.target.querySelectorAll('.bar-value');
            bars.forEach((bar, index) => {
                setTimeout(() => bar.classList.add('animate'), index * 100);
            });
            barObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.3 });

const benchmarkCard = document.getElementById('benchmark-card');
if (benchmarkCard) barObserver.observe(benchmarkCard);
} catch (e) { console.warn('Benchmark bar animation error:', e); }

// Handle #download-trigger hash on page load (from external links like wiki)
if (window.location.hash === '#download-trigger') {
    // Prevent browser default jump to anchor
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.addEventListener('DOMContentLoaded', () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        setTimeout(() => {
            openDownloadMenu();
            if (dlTrigger) dlTrigger.focus();
        }, 300);
        if (history.pushState) {
            history.pushState(null, null, ' ');
        }
    });
}

// ===== THEME TOGGLE =====
try {
const themeToggle = document.getElementById('theme-toggle');
const html = document.documentElement;

// Get stored theme or detect system preference
function getPreferredTheme() {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) {
        return storedTheme;
    }
    // Check system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Apply theme
function applyTheme(theme) {
    if (theme === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else {
        html.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', theme);
}

// Toggle theme
function toggleTheme() {
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
}

// Initialize theme
applyTheme(getPreferredTheme());

// Add click listener
if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only apply if no stored preference
    if (!localStorage.getItem('theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
    }
});

} catch (e) { console.warn('Theme toggle error:', e); }

// ===== SCROLL TO TOP =====
try {
const scrollTopBtn = document.getElementById('scroll-top');
let smoothScrollFrame = 0;

// Generic Smooth Scroll Function
function smoothScrollTo(targetY, duration = 1000, onComplete) {
    if (smoothScrollFrame) {
        cancelAnimationFrame(smoothScrollFrame);
        smoothScrollFrame = 0;
    }

    const startY = window.scrollY;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const requestedTarget = Number.isFinite(Number(targetY)) ? Number(targetY) : 0;
    const effectiveTargetY = Math.max(0, Math.min(requestedTarget, maxScroll));
    const scrollDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0;

    const diff = effectiveTargetY - startY;
    const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Reduced motion and zero-duration requests jump immediately.
    if (diff === 0 || reducedMotion || scrollDuration <= 0) {
        window.scrollTo({ top: effectiveTargetY, left: 0, behavior: 'instant' });
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    const startTime = performance.now();

    function scrollStep(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / scrollDuration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // Ease out cubic

        // Instant writes prevent html { scroll-behavior: smooth } from stacking
        // a second animation on every requestAnimationFrame tick.
        window.scrollTo({
            top: startY + diff * ease,
            left: 0,
            behavior: 'instant'
        });

        if (progress < 1) {
            smoothScrollFrame = requestAnimationFrame(scrollStep);
        } else if (typeof onComplete === 'function') {
            smoothScrollFrame = 0;
            onComplete();
        } else {
            smoothScrollFrame = 0;
        }
    }

    smoothScrollFrame = requestAnimationFrame(scrollStep);
}

function checkScrollTop() {
    if (window.scrollY > 300) {
        scrollTopBtn.classList.add('visible');
    } else {
        scrollTopBtn.classList.remove('visible');
    }
}

function scrollToTop() {
    smoothScrollTo(0);
}

// Bind smooth scroll to nav links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');

        // Handle scroll to top for href="#"
        if (href === '#') {
            e.preventDefault();
            smoothScrollTo(0);
            history.pushState(null, null, ' '); // Clear hash from URL
            return;
        }

        // Handle scroll to specific element
        const targetId = href.substring(1);
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
            e.preventDefault();

            // Special handling: CTA download scrolls to top then opens dropdown
            if (targetId === 'download-trigger') {
                smoothScrollTo(0, 800, () => {
                    setTimeout(() => {
                        openDownloadMenu();
                        if (dlTrigger) dlTrigger.focus();
                    }, 150);
                });
                if (history.pushState) {
                    history.pushState(null, null, ' ');
                }
                return;
            }

            // Account for the actual sticky header height; wiki pages may not
            // render the shared nav, so retain the historical 80px fallback.
            const nav = document.querySelector('.nav');
            const headerOffset = nav && nav.getBoundingClientRect().height
                ? nav.getBoundingClientRect().height : 80;
            const elementPosition = targetElement.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            smoothScrollTo(offsetPosition, 1000);

            // Optional: Update URL without jumping
            // Optional: Update URL without jumping (deferred to avoid stutter)
            if (history.pushState) {
                history.pushState(null, null, '#' + targetId);
            }
        }
    });
});

if (scrollTopBtn) {
    window.addEventListener('scroll', checkScrollTop, { passive: true });
    scrollTopBtn.addEventListener('click', scrollToTop);
    checkScrollTop();
}

} catch (e) { console.warn('Scroll/nav error:', e); }

// ===== FAQ ACCORDION =====
try {
document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isActive = item.classList.contains('active');

        document.querySelectorAll('.faq-item.active').forEach(el => {
            el.classList.remove('active');
            el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        });

        if (!isActive) {
            item.classList.add('active');
            btn.setAttribute('aria-expanded', 'true');
        }
    });
});

} catch (e) { console.warn('FAQ accordion error:', e); }

/* ===== AUTO-WRAP TABLES IN SCROLLABLE WRAPPER ===== */
try {
document.querySelectorAll('.wiki-content table').forEach(table => {
    if (table.parentElement.classList.contains('wiki-table-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'wiki-table-wrapper';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
});

} catch (e) { console.warn('Table wrapper error:', e); }

/* ===== NAV: đổi trạng thái khi rời khỏi đỉnh trang =====
   Dùng IntersectionObserver thay vì thêm scroll listener thứ hai
   (script.js đã có một cái cho nút scroll-to-top). */
try {
(function navOnScroll() {
    const nav = document.querySelector('.nav');
    if (!nav || !('IntersectionObserver' in window)) return;
    const sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:0;left:0;height:1px;width:1px;pointer-events:none;';
    document.body.prepend(sentinel);
    new IntersectionObserver(([e]) => {
        nav.classList.toggle('nav--scrolled', !e.isIntersecting);
    }).observe(sentinel);
})();
} catch (e) { console.warn('Nav scroll state error:', e); }
