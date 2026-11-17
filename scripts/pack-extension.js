'use strict';

/**
 * Packs the browser extension for the Chrome Web Store / Edge Add-ons:
 *
 *   node scripts/pack-extension.js        → samekodevcpp/extension/sameko-companion-<version>.zip
 *
 * Only what the extension runs ships: the manifest and the folders it uses. test/ (saved judge
 * HTML), .dev/, README.md and PROTOCOL.md stay out. The zip is for the stores only: never attach
 * it to a GitHub Release (the app's updater and winget read those).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const SHIP = ['manifest.json', '_locales', 'adapters', 'background', 'content', 'fonts', 'icons', 'popup', 'shared', 'welcome'];

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const outDir = path.join(ROOT, 'samekodevcpp', 'extension');
const out = path.join(outDir, `sameko-companion-${manifest.version}.zip`);

// Every file the manifest names must be in a shipped folder.
const named = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((c) => c.js)];
for (const f of named) {
    if (!SHIP.includes(f.split('/')[0]) || !fs.existsSync(path.join(EXT, f))) throw new Error(`manifest names ${f}, which would not ship`);
}
if (JSON.stringify(manifest).includes('mock-oj')) throw new Error('the mock adapter must not ship');

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-ext-'));
try {
    for (const item of SHIP) fs.cpSync(path.join(EXT, item), path.join(stage, item), { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.rmSync(out, { force: true });
    // bsdtar writes a zip from the .zip name: Windows' own (not Git Bash's GNU tar), macOS'.
    // Linux: zip(1).
    if (process.platform === 'linux') {
        execFileSync('zip', ['-qr', out, ...SHIP], { cwd: stage, stdio: 'inherit' });
    } else {
        const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
        execFileSync(tar, ['-a', '-cf', out, ...SHIP], { cwd: stage, stdio: 'inherit' });
    }
} finally {
    fs.rmSync(stage, { recursive: true, force: true });
}
console.log(`${path.relative(ROOT, out)}  ${Math.round(fs.statSync(out).size / 1024)} KB`);
