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

function syncDownloadMenuAria() {
    if (dlTrigger && dlWrapper) {
        dlTrigger.setAttribute('aria-expanded', dlWrapper.classList.contains('active') ? 'true' : 'false');
    }
}

function openDownloadMenu() {
    if (dlWrapper && !dlWrapper.classList.contains('active')) {
        dlWrapper.classList.add('active');
        syncDownloadMenuAria();
    }
}

try {

if (dlTrigger && dlWrapper) {
    dlTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dlWrapper.classList.toggle('active');
        syncDownloadMenuAria();
    });

    document.addEventListener('click', (e) => {
        if (!dlWrapper.contains(e.target)) {
            dlWrapper.classList.remove('active');
            syncDownloadMenuAria();
        }
    });

    // Esc đóng menu và trả focus về nút mở
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dlWrapper.classList.contains('active')) {
            dlWrapper.classList.remove('active');
            syncDownloadMenuAria();
            dlTrigger.focus();
        }
    });
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
            const hit = assets.find(a => MATCHERS[id](a.name.toLowerCase()));

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
    window.scrollTo(0, 0);
    document.addEventListener('DOMContentLoaded', () => {
        window.scrollTo(0, 0);
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

// Generic Smooth Scroll Function
function smoothScrollTo(targetY, duration = 1000, onComplete) {
    const startY = window.scrollY;
    // Handle document height limit
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const effectiveTargetY = Math.min(targetY, maxScroll);

    const diff = effectiveTargetY - startY;

    // If distance is 0, don't animate
    if (diff === 0) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    const startTime = performance.now();

    function scrollStep(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // Ease out cubic

        // Force behavior: 'auto' to bypass any CSS smooth scrolling that might persist
        window.scrollTo({
            top: startY + diff * ease,
            left: 0,
            behavior: "auto"
        });

        if (progress < 1) {
            requestAnimationFrame(scrollStep);
        } else if (typeof onComplete === 'function') {
            onComplete();
        }
    }

    requestAnimationFrame(scrollStep);
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

            // Account for sticky header height (approx 80px)
            const headerOffset = 80;
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

/* ===== DYNAMIC BACKGROUND (Anti-Gravity Dots) ===== */
try {
document.addEventListener('DOMContentLoaded', () => {
    // Người dùng tắt animation thì không dựng canvas — rAF không tự dừng theo
    // media query, phải chặn từ đây.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // .hero-wrapper đã bị bỏ khi viết lại hero; giờ container là .hero-band.
    const heroWrapper = document.querySelector('.hero-band');
    if (!heroWrapper) return;

    const canvas = document.createElement('canvas');
    if (!canvas || !canvas.getContext) return;
    canvas.id = 'bg-canvas';
    heroWrapper.insertBefore(canvas, heroWrapper.firstChild);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width, height;
    let particles = [];

    // Config
    const gap = 45;
    const radius = 1.5;
    const mouseRadius = 180;
    const returnSpeed = 0.08;
    const pushWeb = 0.8;

    function resize() {
        width = heroWrapper.offsetWidth;
        height = heroWrapper.offsetHeight;
        canvas.width = width;
        canvas.height = height;
        initParticles();
    }

    function initParticles() {
        particles = [];
        for (let x = 0; x < width; x += gap) {
            for (let y = 0; y < height; y += gap) {
                particles.push({
                    x: x,
                    y: y,
                    originX: x,
                    originY: y,
                    vx: 0,
                    vy: 0
                });
            }
        }
    }

    let mouse = { x: -1000, y: -1000 };

    // Update mouse position relative to canvas
    window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    });

    function animate() {
        ctx.clearRect(0, 0, width, height);

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        ctx.fillStyle = isDark ? 'rgba(100, 181, 246, 0.25)' : 'rgba(2, 136, 209, 0.18)';

        particles.forEach(p => {
            const dx = mouse.x - p.x;
            const dy = mouse.y - p.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < mouseRadius) {
                const forceDirectionX = dx / distance;
                const forceDirectionY = dy / distance;
                const force = (mouseRadius - distance) / mouseRadius;
                const directionX = forceDirectionX * force * pushWeb;
                const directionY = forceDirectionY * force * pushWeb;

                p.vx -= directionX;
                p.vy -= directionY;
            }

            const odx = p.originX - p.x;
            const ody = p.originY - p.y;

            p.vx += odx * returnSpeed * 0.5;
            p.vy += ody * returnSpeed * 0.5;

            p.vx *= 0.85;
            p.vy *= 0.85;

            p.x += p.vx;
            p.y += p.vy;

            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
        });

        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    resize(); // Init
    animate();
});
} catch (e) { console.warn('Dynamic background error:', e); }

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