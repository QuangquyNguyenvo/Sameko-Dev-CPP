#!/usr/bin/env node
'use strict';
/*
 * Write a development copy of the extension to extension/.dev/ that also runs on the mock OJ
 * (http://localhost:<any port>/), then load extension/.dev/ unpacked instead of extension/.
 *
 *   node extension/test/make-dev.js [--app-url http://127.0.0.1:27121] [--out <dir>]
 *
 * --app-url points the worker at a stub app instead of the real one (used by test/e2e.js).
 * Re-run after editing extension files: the copy does not follow them.
 */
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..');
const SKIP = new Set(['.dev', 'test', '.gitignore', 'PROTOCOL.md', 'README.md']);

function arg(name, def) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (src === EXT && SKIP.has(entry.name)) continue;
        const s = path.join(src, entry.name), d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function makeDev({ out, appUrl } = {}) {
    const dst = out || path.join(EXT, '.dev');
    fs.rmSync(dst, { recursive: true, force: true });
    copyDir(EXT, dst);
    fs.copyFileSync(path.join(__dirname, 'mock-oj', 'adapter.js'), path.join(dst, 'adapters', 'mock-oj.js'));

    const manifestPath = path.join(dst, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // name is a __MSG_…__ key: resolve it from the default locale so the dev copy shows a real name
    const m = /^__MSG_(\w+)__$/.exec(manifest.name);
    if (m) manifest.name = JSON.parse(fs.readFileSync(path.join(EXT, '_locales', manifest.default_locale, 'messages.json'), 'utf8'))[m[1]].message;
    manifest.name += ' (dev)';
    manifest.host_permissions.push('http://localhost/*');
    // A separate entry, so the shipped OJ entry stays exactly as in manifest.json.
    manifest.content_scripts.push({
        matches: ['http://localhost/*'],
        js: ['shared/adapters.js', 'adapters/mock-oj.js', 'content/main.js'],
        run_at: 'document_idle'
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    if (appUrl) {
        const swPath = path.join(dst, 'background', 'service-worker.js');
        const sw = fs.readFileSync(swPath, 'utf8');
        const next = sw.replace(/^const APP_URL = '[^']*';$/m, `const APP_URL = ${JSON.stringify(appUrl).replace(/"/g, "'")};`);
        if (next === sw) throw new Error('APP_URL line not found in service-worker.js');
        fs.writeFileSync(swPath, next);
    }
    return dst;
}

module.exports = { makeDev };

if (require.main === module) {
    const dst = makeDev({ out: arg('--out'), appUrl: arg('--app-url') });
    console.log(`Dev extension written to ${dst}\nLoad it unpacked (chrome://extensions → Developer mode → Load unpacked).`);
}
