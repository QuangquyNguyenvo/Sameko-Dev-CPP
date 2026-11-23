'use strict';

// The README's live badges (functions/badge/[name].js, a Cloudflare Pages Function).

const fs = require('fs');
const path = require('path');

let failed = 0;
function check(name, ok) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
}

(async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../functions/badge/[name].js'), 'utf8');
    const badge = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const page = new URL(url).searchParams.get('page');
        const data = String(url).includes('/releases')
            ? (page === '1' ? [{ assets: [
                { name: 'sameko-dev-cpp-setup-1.5.0.exe', download_count: 100 },
                { name: 'sameko-dev-cpp-update-1.5.0.exe', download_count: 900 },
                { name: 'sameko-dev-cpp-1.5.0-portable.zip', download_count: 20 },
                { name: 'sameko-dev-cpp-1.5.0-linux-x86_64.AppImage', download_count: 3 },
                { name: 'latest.yml', download_count: 5000 },
                { name: 'sameko-dev-cpp-setup-1.5.0.exe.blockmap', download_count: 7 },
                { name: 'shot.png', download_count: 200 },
            ] }] : [])
            : { stargazers_count: 1250 };
        return new Response(JSON.stringify(data));
    };
    try {
        check('only installers are counted', await badge.fetchDownloads() === 123);
        check('a file type needs its dot', !badge.isInstaller('notes-exe') && !badge.isInstaller('archive-tarxgz'));
        const downloads = await (await badge.onRequestGet({ params: { name: 'downloads.svg' } })).text();
        check('the downloads badge shows the count', downloads.includes('aria-label="DOWNLOADS: 123"'));
        const stars = await (await badge.onRequestGet({ params: { name: 'stars.svg' } })).text();
        check('the stars badge shortens large counts', stars.includes('aria-label="STARS: 1.3K"'));
        check('an unknown badge is a 404', (await badge.onRequestGet({ params: { name: 'constructor' } })).status === 404);
        const store = new Map();
        Object.defineProperty(globalThis, 'caches', {
            configurable: true,
            value: { default: {
                put: async (request, response) => { store.set(request.url, await response.text()); },
                match: async (request) => (store.has(request.url) ? new Response(store.get(request.url)) : undefined),
            } },
        });
        const waits = [];
        await badge.onRequestGet({ params: { name: 'downloads.svg' }, waitUntil: (p) => waits.push(p) });
        await Promise.all(waits);
        check('a live count is remembered', waits.length === 1 && [...store.values()].includes('123'));

        globalThis.fetch = async () => new Response('{}', { status: 403 });
        const down = await badge.onRequestGet({ params: { name: 'downloads.svg' } });
        check('a GitHub refusal draws the last count', down.status === 200 && (await down.text()).includes('DOWNLOADS: 123'));
        check('a refusal is cached briefly', down.headers.get('Cache-Control').includes('max-age=300'));

        store.clear();
        const first = await (await badge.onRequestGet({ params: { name: 'downloads.svg' } })).text();
        check('with no last count, the snapshot is drawn', first.includes('DOWNLOADS: 5.7K') && !first.includes(': -'));
        delete globalThis.caches;
        const noCache = await (await badge.onRequestGet({ params: { name: 'stars.svg' } })).text();
        check('it works without an edge cache', noCache.includes('STARS: 116'));
    } finally {
        globalThis.fetch = realFetch;
        delete globalThis.caches;
    }
    process.exit(failed ? 1 : 0);
})();
