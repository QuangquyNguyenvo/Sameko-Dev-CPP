// Cloudflare Pages Function: GET /badge/stars.svg and /badge/downloads.svg
// Draws the README's live GitHub badges. Text is vector paths, so no font is needed.
const REPO = 'QuangquyNguyenvo/Sameko-Dev-CPP';
const CACHE_SECONDS = 3600;

const GLYPHS = {
  A: 'M2 96L30 4L58 96M12 66L48 66',
  B: 'M8 4L8 96M8 4C58 0 58 50 8 48C66 46 66 100 8 96',
  C: 'M58 20C38 -6 4 8 4 50C4 92 38 106 58 80',
  D: 'M8 4L8 96C74 100 74 0 8 4Z',
  E: 'M54 6L8 6L8 94L56 94M8 50L46 50',
  I: 'M8 4L8 96',
  K: 'M8 4L8 96M54 6L10 58M26 40L58 96',
  L: 'M8 4L8 96L52 96',
  M: 'M6 96L8 6L32 62L56 6L58 96',
  N: 'M6 96L6 4L56 96L56 4',
  O: 'M32 4C56 4 62 28 62 50C62 74 54 96 32 96C10 96 2 74 2 50C2 28 10 4 32 4Z',
  R: 'M8 96L8 4C66 0 66 56 8 54M28 54L56 96',
  S: 'M56 18C46 -2 8 -2 6 24C4 48 56 44 58 72C60 100 14 104 2 80',
  T: 'M2 6L62 6M32 6L32 96',
  V: 'M2 4L30 96L58 4',
  W: 'M2 4L16 96L32 36L48 96L62 4',
  0: 'M30 4C52 4 58 28 58 50C58 74 52 96 30 96C8 96 2 74 2 50C2 28 8 4 30 4Z',
  1: 'M12 22L30 4L30 96',
  2: 'M6 24C10 -4 56 -2 54 28C52 52 10 70 4 96L58 96',
  3: 'M8 14C24 -6 58 2 52 28C50 42 36 48 24 48C44 48 60 58 56 76C50 104 14 100 4 80',
  4: 'M44 96L44 4L2 68L60 68',
  5: 'M52 6L12 6L8 44C30 32 58 42 58 66C58 100 16 104 4 82',
  6: 'M50 8C24 8 6 34 6 66C6 106 56 104 56 66C56 38 12 40 8 62',
  7: 'M4 6L58 6L24 96',
  8: 'M32 48C8 44 6 6 32 4C58 6 56 44 32 48C2 52 2 98 32 98C62 98 62 52 32 48Z',
  9: 'M56 38C52 62 8 60 6 32C6 -6 56 -6 56 34C56 66 38 92 12 94',
  '.': 'M8 92L8 93',
  '-': 'M8 50L48 50',
};

const STAR = 'M-2.78 -10.15Q-1.58 -12.9 0.26 -10.56L1.39 -9.12Q3.54 -6.38 6.7 -5.87L8.35 -5.6Q11.06 -5.16 9.55 -2.82L8.63 -1.39Q6.87 1.34 7.74 4.8L8.19 6.61Q8.93 9.58 6.04 8.78L4.28 8.28Q0.9 7.34 -1.92 8.67L-3.4 9.36Q-5.82 10.5 -6.04 7.8L-6.18 6.15Q-6.43 3 -8.97 0.72L-10.3 -0.47Q-12.47 -2.42 -9.75 -3.45L-8.08 -4.07Q-4.91 -5.27 -3.51 -8.47Z';
const ICONS = {
  star: `<path d="${STAR}" fill="#ffdf73" stroke="#f0ae38" stroke-width="2.3" stroke-linejoin="round"><animateTransform attributeName="transform" type="scale" values="1;.8;1" dur="2.6s" repeatCount="indefinite"/></path>`,
  download: '<g fill="none" stroke="#3f86c2" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M0 -7V3M-4.5 -1L0 3.5L4.5 -1"><animateTransform attributeName="transform" type="translate" values="0 -1;0 1;0 -1" dur="1.8s" repeatCount="indefinite"/></path><path d="M-6.5 7.5H6.5"/></g>',
  site: '<g fill="none" stroke="#3f86c2" stroke-width="2.4" stroke-linecap="round"><circle r="9"/><path d="M-9 0H9M0 -9C-5 -4 -5 4 0 9M0 -9C5 -4 5 4 0 9"/></g>',
  release: '<g fill="none" stroke="#3f86c2" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M-8 -4L0 -8.500L8 -4V5L0 9.500L-8 5Z"/><path d="M-8 -4L0 .5L8 -4M0 .5V9.500"/></g>',
  license: '<g fill="none" stroke="#3f86c2" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M-5.5 -8H3L6 -5V8H-5.5Z"/><path d="M-2.4 1L-.4 3.2L3 -1"/></g>',
};

function textPath(text, x, y, height, advance) {
  const scale = height / 100;
  const sx = scale * 1.12;
  let at = x;
  let d = '';
  for (const ch of text) {
    if (ch === ' ') { at += advance * .62; continue; }
    d += (GLYPHS[ch] || '').replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, px, py) => `${+(at + px * sx).toFixed(1)} ${+(y + py * scale).toFixed(1)}`);
    at += ch === 'I' || ch === '1' || ch === '.' ? advance * .58 : advance;
  }
  return { d, end: at - advance * .22 };
}

export function renderBadge({ icon, label, value }) {
  const H = 44;
  const labelText = textPath(label, 46, 16.5, 11, 11.2);
  const valueStart = labelText.end + 22;
  const valueText = textPath(value, valueStart, 15.5, 13, 13.4);
  const W = Math.ceil(valueText.end + 20);
  const capX = +(labelText.end + 9).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 12}" height="${H + 14}" viewBox="-6 -4 ${W + 12} ${H + 14}" role="img" aria-label="${label}: ${value}">
  <defs><filter id="soft" x="-10%" y="-25%" width="120%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#5FA8D3" flood-opacity=".45"/></filter></defs>
  <rect width="${W}" height="${H}" rx="22" fill="#ffffff" filter="url(#soft)"/>
  <rect x="${capX}" y="5" width="${W - capX - 5}" height="${H - 10}" rx="17" fill="#88c9ea"/>
  <g transform="translate(25 22)"><circle r="15" fill="#e4f4fc"/>${ICONS[icon]}</g>
  <path d="${labelText.d}" fill="none" stroke="#4f9acb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${valueText.d}" fill="none" stroke="#1f4f80" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

export function formatCount(count) {
  if (!Number.isFinite(count) || count < 0) return '-';
  if (count < 1000) return String(Math.floor(count));
  return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(/\.0$/, '')}K`;
}

// People downloading the app: installers and portable builds, without the updater's own copy,
// update manifests, blockmaps or screenshots attached to a release.
export function isInstaller(name) {
  return /\.(exe|zip|rar|appimage|deb|dmg|tar\.gz)$/i.test(name) && !/-update-/i.test(name);
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sameko-badge' },
    cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': CACHE_SECONDS, '400-599': 0 } },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  return response.json();
}

async function fetchStars() {
  return (await github('')).stargazers_count;
}

export async function fetchDownloads() {
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const releases = await github(`/releases?per_page=100&page=${page}`);
    for (const release of releases) {
      for (const asset of release.assets) if (isInstaller(asset.name)) total += asset.download_count;
    }
    if (releases.length < 100) break;
  }
  return total;
}

const BADGES = {
  'stars.svg': { icon: 'star', label: 'STARS', load: fetchStars },
  'downloads.svg': { icon: 'download', label: 'DOWNLOADS', load: fetchDownloads },
};

// GitHub allows 60 anonymous requests an hour per address, and Workers share addresses. When it
// refuses, draw the last count this edge saw, or this snapshot if it has none yet.
const SNAPSHOT = { 'stars.svg': 116, 'downloads.svg': 5666 };
const LAST_COUNT_SECONDS = 60 * 60 * 24 * 30;
const lastCountKey = name => new Request(`https://sameko.dev/__badge-last/${name}`);
const edgeCache = () => (typeof caches !== 'undefined' && caches.default) || null;

async function rememberCount(name, count) {
  const cache = edgeCache();
  if (!cache) return;
  await cache.put(lastCountKey(name), new Response(String(count), {
    headers: { 'Cache-Control': `public, max-age=${LAST_COUNT_SECONDS}` },
  }));
}

async function lastCount(name) {
  try {
    const hit = await edgeCache()?.match(lastCountKey(name));
    const count = hit ? Number(await hit.text()) : NaN;
    if (Number.isFinite(count)) return count;
  } catch {
    // The snapshot below still draws a real number.
  }
  return SNAPSHOT[name];
}

export async function onRequestGet({ params, waitUntil }) {
  const badge = Object.hasOwn(BADGES, params.name) ? BADGES[params.name] : null;
  if (!badge) return new Response('Not found', { status: 404 });
  let count;
  let live = true;
  try {
    count = await badge.load();
    if (!Number.isFinite(count)) throw new Error('GitHub sent no count');
    const saved = rememberCount(params.name, count).catch(() => {});
    if (waitUntil) waitUntil(saved);
    else await saved;
  } catch {
    live = false;
    count = await lastCount(params.name);
  }
  return new Response(renderBadge({ icon: badge.icon, label: badge.label, value: formatCount(count) }), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${live ? CACHE_SECONDS : 300}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
