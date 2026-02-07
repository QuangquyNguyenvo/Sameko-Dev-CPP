const canvas = document.getElementById('grid-canvas');
const ctx = canvas.getContext('2d');
let width, height;
let points = [];
let spacing = 50;
const mouse = { x: -1000, y: -1000 };
let animationFrameId;
let isAnimating = false;

function init() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;

    // Increase spacing on mobile to improve performance
    spacing = window.innerWidth < 768 ? 70 : 50;

    points = [];

    if (width * height > 50000000) return;

    for (let x = 0; x < width + spacing; x += spacing) {
        for (let y = 0; y < height + spacing; y += spacing) {
            points.push({
                originX: x,
                originY: y,
                x: x,
                y: y,
                vx: 0,
                vy: 0
            });
        }
    }
}

window.addEventListener('resize', init);
window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

function checkAnimationStatus() {
    const shouldAnimate = window.scrollY < window.innerHeight + 100;

    if (shouldAnimate && !isAnimating) {
        isAnimating = true;
        animate();
    } else if (!shouldAnimate && isAnimating) {
        isAnimating = false;
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        ctx.clearRect(0, 0, width, height);
    }
}

window.addEventListener('scroll', checkAnimationStatus, { passive: true });

function animate() {
    if (!isAnimating) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = window.dotColor || 'rgba(100, 181, 246, 0.36)';
    ctx.beginPath();

    const maxDist = 150; // Reduced interaction radius
    const maxDistSq = maxDist * maxDist;
    const stiffness = 0.03; // Spring stiffness
    const damping = 0.9;    // Friction
    const mouseForce = 30;  // Reduced force

    for (let i = 0; i < points.length; i++) {
        const p = points[i];

        // Calculate distance to mouse
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const distSq = dx * dx + dy * dy;

        // Mouse interaction (Repulsion)
        if (distSq < maxDistSq) {
            const dist = Math.sqrt(distSq);
            // Non-linear interaction for smoother feel
            const force = Math.pow((maxDist - dist) / maxDist, 2) * mouseForce;
            const angle = Math.atan2(dy, dx);

            p.vx -= Math.cos(angle) * force;
            p.vy -= Math.sin(angle) * force;
        }

        // Spring Force (Return to origin)
        const dxHome = p.originX - p.x;
        const dyHome = p.originY - p.y;

        p.vx += dxHome * stiffness;
        p.vy += dyHome * stiffness;

        // Apply Velocity & Damping
        p.vx *= damping;
        p.vy *= damping;

        p.x += p.vx;
        p.y += p.vy;

        ctx.moveTo(p.x + 1.5, p.y);
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    }

    ctx.fill();
    animationFrameId = requestAnimationFrame(animate);
}

init();
checkAnimationStatus();
if (window.scrollY < window.innerHeight + 100) {
    isAnimating = true;
    animate();
}

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

// Dropdown Logic
const dlTrigger = document.getElementById('download-trigger');
const dlWrapper = document.querySelector('.dropdown-wrapper');

function openDownloadMenu() {
    if (dlWrapper && !dlWrapper.classList.contains('active')) {
        dlWrapper.classList.add('active');
    }
}

if (dlTrigger && dlWrapper) {
    dlTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dlWrapper.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!dlWrapper.contains(e.target)) {
            dlWrapper.classList.remove('active');
        }
    });
}

// Fetch Releases
fetch('https://api.github.com/repos/QuangquyNguyenvo/Sameko-Dev-CPP/releases')
    .then(res => res.json())
    .then(data => {
        if (data && data.length > 0) {
            // Find latest pre-release or release
            const latest = data[0];
            // Note: Users asked for "latest pre-release", usually API returns sorted by date.
            // If we strictly want specific types, we can filter. 
            // data[0] is usually the latest created, which includes pre-releases if not filtered.

            const installerBtn = document.getElementById('dl-installer');
            const portableBtn = document.getElementById('dl-portable');

            let installerUrl = latest.html_url; // Fallback
            let portableUrl = latest.html_url;  // Fallback

            if (latest.assets && latest.assets.length > 0) {
                latest.assets.forEach(asset => {
                    const name = asset.name.toLowerCase();
                    if (name.endsWith('.exe')) {
                        installerUrl = asset.browser_download_url;
                    } else if (name.endsWith('.rar') || name.endsWith('.zip')) {
                        portableUrl = asset.browser_download_url;
                    }
                });
            }

            if (installerBtn) installerBtn.href = installerUrl;
            if (portableBtn) portableBtn.href = portableUrl;
        }
    })
    .catch(e => console.log('GitHub API warning: ', e));

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

// ===== THEME TOGGLE =====
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

    // Update canvas dot color based on theme
    updateCanvasColor(theme);
}

// Update canvas animation color based on theme
function updateCanvasColor(theme) {
    const isDark = theme === 'dark';
    // The animate function will use this color
    window.dotColor = isDark ? 'rgba(100, 181, 246, 0.5)' : 'rgba(100, 181, 246, 0.36)';
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

// ===== SCROLL TO TOP =====
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
            // Account for sticky header height (approx 80px)
            const headerOffset = 80;
            const elementPosition = targetElement.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            smoothScrollTo(offsetPosition, 1000, () => {
                if (targetId === 'download-trigger') {
                    openDownloadMenu();
                    if (dlTrigger) dlTrigger.focus();
                }
            });

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

// ===== FAQ ACCORDION =====
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
