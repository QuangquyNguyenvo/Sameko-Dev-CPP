'use strict';
/**
 * Bundles the Monaco editor (ESM build) into src/vendor/monaco/ with esbuild.
 *
 * The entry is generated from monaco-editor's own editor.main.js, minus what the
 * IDE never uses: the TypeScript/JSON/CSS/HTML language services (and their
 * workers), the LSP client, the diff editor and the GPU renderer. Basic
 * languages stay: their tokenizers are separate chunks loaded on first use
 * (the Markdown preview colours code blocks in any of them).
 *
 * The bundle sets window.monaco and dispatches nothing else; the renderer's
 * plain <script> files keep using the global as before.
 *
 *   node scripts/build-monaco.js           # minified release bundle
 *   node scripts/build-monaco.js --dev     # unminified, with source maps
 *   node scripts/build-monaco.js --if-stale  # skip when the bundle is current
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MONACO = path.join(ROOT, 'node_modules', 'monaco-editor');
const ESM = path.join(MONACO, 'esm', 'vs', 'editor');
const OUT = path.join(ROOT, 'src', 'vendor', 'monaco');
const STAMP = path.join(OUT, '.build-stamp.json');

const args = new Set(process.argv.slice(2));
const dev = args.has('--dev');

/** Imports of editor.main.js the IDE does not need. */
const EXCLUDE = [
    /monaco-lsp-client/,
    /languages\/features\//,          // TS/JSON/CSS/HTML language services + workers
    /diffEditor/,
    /gpu\//,
    /iPadShowKeyboard/,
    /inspectTokens/,
    /toggleHighContrast/,
];

function monacoVersion() {
    return JSON.parse(fs.readFileSync(path.join(MONACO, 'package.json'), 'utf8')).version;
}

function stampFor() {
    return {
        monaco: monacoVersion(),
        script: fs.statSync(__filename).mtimeMs,
        dev,
    };
}

function isCurrent() {
    try {
        const old = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
        const now = stampFor();
        return old.monaco === now.monaco && old.script === now.script && old.dev === now.dev
            && fs.existsSync(path.join(OUT, 'editor.js'));
    } catch (_) {
        return false;
    }
}

/** The bundle entry: editor.main.js's side-effect imports, filtered. */
function buildEntry() {
    const main = fs.readFileSync(path.join(ESM, 'editor.main.js'), 'utf8');
    const imports = [];
    for (const line of main.split(/\r?\n/)) {
        const m = /^import (?:\* as \w+ from )?'([^']+)';$/.exec(line.trim());
        if (!m) continue;
        if (EXCLUDE.some((re) => re.test(m[1]))) continue;
        imports.push(`import '${m[1]}';`);
    }
    if (imports.length < 40) {
        throw new Error(`editor.main.js parsed to only ${imports.length} imports; its format changed`);
    }
    return [
        // Must run before Monaco reads it: a separate module evaluated first.
        `import './__env.js';`,
        ...imports,
        `import * as monaco from './editor.api.js';`,
        `globalThis.monaco = monaco;`,
    ].join('\n');
}

const ENV = `
// Relative to the page (src/index.html): import.meta.url would name whichever
// chunk this module ends up in.
const workerUrl = new URL('vendor/monaco/editor.worker.js', document.baseURI).href;
globalThis.MonacoEnvironment = {
    getWorker() {
        return new Worker(workerUrl, { name: 'editorWorkerService' });
    },
};
`;

async function main() {
    if (args.has('--if-stale') && isCurrent()) return;
    const esbuild = require('esbuild');
    const started = Date.now();
    fs.rmSync(OUT, { recursive: true, force: true });

    // Virtual modules resolved next to editor.main.js so its relative imports work.
    const virtual = {
        [path.join(ESM, '__entry.js')]: buildEntry(),
        [path.join(ESM, '__env.js')]: ENV,
    };
    const virtualPlugin = {
        name: 'monaco-entry',
        setup(build) {
            build.onResolve({ filter: /__(entry|env)\.js$/ }, (a) => ({
                path: path.isAbsolute(a.path) ? a.path : path.join(a.resolveDir || ESM, a.path),
                namespace: 'file',
            }));
            build.onLoad({ filter: /__(entry|env)\.js$/ }, (a) => ({
                contents: virtual[a.path],
                loader: 'js',
                resolveDir: ESM,
            }));
        },
    };

    const common = {
        bundle: true,
        minify: !dev,
        sourcemap: dev ? 'linked' : false,
        target: 'chrome140',
        legalComments: 'none',
        logLevel: 'warning',
    };

    await esbuild.build({
        ...common,
        entryPoints: { editor: path.join(ESM, '__entry.js') },
        outdir: OUT,
        format: 'esm',
        splitting: true,
        chunkNames: 'chunks/[name]-[hash]',
        assetNames: 'assets/[name]-[hash]',
        loader: { '.ttf': 'file' },
        plugins: [virtualPlugin],
    });
    // Language chunks that import editor code get a copy of its CSS; nothing loads
    // those (editor.css already holds all of it).
    const chunks = path.join(OUT, 'chunks');
    for (const name of fs.readdirSync(chunks)) {
        if (name.endsWith('.css')) fs.rmSync(path.join(chunks, name));
    }
    await esbuild.build({
        ...common,
        entryPoints: { 'editor.worker': path.join(ESM, 'editor.worker.js') },
        outdir: OUT,
        format: 'iife',
    });

    fs.writeFileSync(STAMP, JSON.stringify(stampFor()));
    let bytes = 0;
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size;
    });
    walk(OUT);
    console.log(`monaco ${monacoVersion()} -> src/vendor/monaco (${(bytes / 1048576).toFixed(1)} MB, ${Date.now() - started} ms)`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
