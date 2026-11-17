'use strict';

/**
 * Packs the browser extension for the stores:
 *
 *   node scripts/pack-extension.js        → samekodevcpp/extension/sameko-companion-<version>.zip          (Chrome Web Store, Edge Add-ons)
 *                                         → samekodevcpp/extension/sameko-companion-<version>-firefox.zip  (addons.mozilla.org)
 *   node scripts/pack-extension.js --firefox-dir <dir>
 *                                         → the Firefox build unpacked in <dir>, for about:debugging › Load Temporary Add-on
 *
 * extension/manifest.json is the Chrome one and the only source. Firefox (128+) gets a copy
 * that runs the worker as an event page: `background.scripts` lists, in order, what
 * service-worker.js would importScripts, plus an add-on id (firefoxManifest below).
 *
 * Only what the extension runs ships: the manifest and the folders it uses. test/ (saved judge
 * HTML), .dev/, README.md and PROTOCOL.md stay out. The zips are for the stores only: never
 * attach them to a GitHub Release (the app's updater and winget read those).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const SHIP = ['manifest.json', '_locales', 'adapters', 'background', 'content', 'fonts', 'icons', 'popup', 'shared', 'welcome'];
const FIREFOX_ID = 'companion@sameko.dev';

/** The Firefox manifest made from the Chrome one. */
function firefoxManifest(manifest) {
    const m = JSON.parse(JSON.stringify(manifest));
    const content = Array.from(new Set((m.content_scripts || []).flatMap((c) => c.js || [])));
    // The order service-worker.js imports them in (keep the two the same).
    const scripts = [
        'shared/adapters.js',
        'shared/i18n.js',
        ...content.filter((f) => f.startsWith('adapters/')),
        'content/page-world.js',
        'background/bridge.js',
        'background/jobs.js',
        m.background.service_worker,
    ];
    m.background = { scripts };
    delete m.minimum_chrome_version;
    m.browser_specific_settings = {
        gecko: {
            id: FIREFOX_ID,
            // world: 'MAIN' in scripting.executeScript (setting the judge's code editor) is 128+.
            strict_min_version: '128.0',
            data_collection_permissions: { required: ['none'] },
        },
    };
    return m;
}

function checkManifest(manifest) {
    // Every file the manifest names must be in a shipped folder.
    const named = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons),
        ...manifest.content_scripts.flatMap((c) => c.js)];
    for (const f of named) {
        if (!SHIP.includes(f.split('/')[0]) || !fs.existsSync(path.join(EXT, f))) throw new Error(`manifest names ${f}, which would not ship`);
    }
    if (JSON.stringify(manifest).includes('mock-oj')) throw new Error('the mock adapter must not ship');
}

/** Copies the shipped files to dir, with the given manifest. */
function stageTo(dir, manifest) {
    for (const item of SHIP) {
        if (item !== 'manifest.json') fs.cpSync(path.join(EXT, item), path.join(dir, item), { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function zipDir(dir, out) {
    fs.rmSync(out, { force: true });
    // bsdtar writes a zip from the .zip name: Windows' own (not Git Bash's GNU tar), macOS'.
    // Linux: zip(1).
    if (process.platform === 'linux') {
        execFileSync('zip', ['-qr', out, ...SHIP], { cwd: dir, stdio: 'inherit' });
    } else {
        const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
        execFileSync(tar, ['-a', '-cf', out, ...SHIP], { cwd: dir, stdio: 'inherit' });
    }
    console.log(`${path.relative(ROOT, out)}  ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

function main() {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    checkManifest(manifest);
    const firefox = firefoxManifest(manifest);

    const at = process.argv.indexOf('--firefox-dir');
    if (at > 0) {
        const dir = path.resolve(process.argv[at + 1] || '');
        if (!process.argv[at + 1]) throw new Error('--firefox-dir needs a folder');
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        stageTo(dir, firefox);
        console.log(`Firefox build in ${dir}`);
        return;
    }

    const outDir = path.join(ROOT, 'samekodevcpp', 'extension');
    fs.mkdirSync(outDir, { recursive: true });
    for (const [suffix, m] of [['', manifest], ['-firefox', firefox]]) {
        const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-ext-'));
        try {
            stageTo(stage, m);
            zipDir(stage, path.join(outDir, `sameko-companion-${manifest.version}${suffix}.zip`));
        } finally {
            fs.rmSync(stage, { recursive: true, force: true });
        }
    }
}

if (require.main === module) main();

module.exports = { firefoxManifest, FIREFOX_ID };
