'use strict';
// Tells Bing, Yandex and other IndexNow engines that sameko.dev pages changed.
// Usage: node scripts/indexnow.js            (every URL in docs/sitemap.xml)
//        node scripts/indexnow.js /vi /wiki  (only these paths)
// The key file docs/<KEY>.txt must be live on the site first.
const fs = require('fs');
const path = require('path');

const HOST = 'sameko.dev';
const KEY = 'b7ac60db4c68bacee2d8e8fbcc0cbd4d';

const args = process.argv.slice(2);
const urls = args.length
    ? args.map((p) => `https://${HOST}${p.startsWith('/') ? p : '/' + p}`)
    : [...fs.readFileSync(path.join(__dirname, '..', 'docs', 'sitemap.xml'), 'utf8')
        .matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => !u.includes('/assets/'));

fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
}).then(async (res) => {
    console.log(`IndexNow ${res.status} ${res.statusText} for ${urls.length} URL(s)`);
    urls.forEach((u) => console.log('  ' + u));
    if (res.status >= 300) { console.log(await res.text()); process.exitCode = 1; }
});
