#!/usr/bin/env node
/**
 * Sameko Dev C++ IDE - GUI smoke test (manual runner)
 *
 * There is no test framework in this repo (no `npm test`). This is a plain Node
 * script — `node scripts/test-gui-smoke.js` — that drives the real Electron app
 * through Playwright's first-party `_electron` API and automates the checks that
 * were previously "open the app and look at it by hand":
 *
 *   1. Main process boots and stays alive.
 *   2. Splash window appears, then the main window (index.html) takes over.
 *   3. Monaco editor actually mounts (not just an empty shell).
 *   4. Theme tokens resolve — catches a broken CSS variable pipeline.
 *   5. NO failed resource loads. On a case-sensitive filesystem (Linux) a
 *      mis-cased asset path 404s here while working fine on Windows, so this is
 *      the automated form of the "sweep the DevTools console" step.
 *   6. NO uncaught renderer exceptions.
 *
 * Only devDependency used is `playwright-core` (no browsers downloaded, and
 * electron-builder never packages devDependencies, so it cannot reach a build).
 *
 * Usage:
 *   node scripts/test-gui-smoke.js              # run, keep artifacts
 *   SMOKE_KEEP_OPEN=1 node scripts/...          # leave the app open at the end
 *
 * Exit code is 0 unless something FAILED.
 *
 * @module scripts/test-gui-smoke
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'plans', '_smoke-artifacts'); // plans/ is gitignored
const WINDOW_TIMEOUT_MS = 60000; // cold start on a slow disk is genuinely slow

// ---- tiny harness (same shape as scripts/test-debugger.js) ----------------
let passed = 0, failed = 0, skipped = 0;
const fails = [];

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log('  PASS  ' + name);
    } catch (err) {
        failed++;
        fails.push(name);
        console.log('  FAIL  ' + name + '\n        ' + (err && err.message ? err.message : err));
    }
}
function skip(name, why) {
    skipped++;
    console.log('  SKIP  ' + name + (why ? '  (' + why + ')' : ''));
}

/** Resolve the Electron binary the app itself would use. */
function electronBinary() {
    try {
        const p = require('electron');
        return typeof p === 'string' ? p : null;
    } catch (_) {
        return null;
    }
}

/**
 * Poll open windows until one is serving `index.html`.
 * The app shows `splash.html` first, so `firstWindow()` is not enough.
 */
async function waitForMainWindow(app, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const w of app.windows()) {
            let url = '';
            try { url = w.url(); } catch (_) { continue; }
            if (url.includes('index.html')) return w;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('no window serving index.html after ' + timeoutMs + 'ms');
}

async function main() {
    console.log('Sameko GUI smoke test');
    console.log('  root: ' + ROOT);

    const bin = electronBinary();
    if (!bin) {
        console.log('\n  SKIP  everything — the `electron` package did not resolve to a binary path.');
        console.log('        Run `npm install` first.');
        process.exit(0);
    }
    console.log('  electron: ' + bin);

    // Collected across the whole session, asserted at the end.
    const failedRequests = [];
    const pageErrors = [];
    const consoleErrors = [];

    let app;
    try {
        app = await electron.launch({
            executablePath: bin,
            args: [ROOT],
            cwd: ROOT,
            timeout: WINDOW_TIMEOUT_MS
        });
    } catch (err) {
        console.log('\n  FAIL  electron.launch()\n        ' + (err && err.message ? err.message : err));
        process.exit(1);
    }

    // Attach listeners to every window, including the splash, from the moment
    // it opens — a 404 during initial paint is exactly what we are hunting.
    const wire = (w) => {
        w.on('requestfailed', (req) => {
            failedRequests.push(req.url() + '  <- ' + (req.failure() ? req.failure().errorText : '?'));
        });
        w.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
        w.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
    };
    app.windows().forEach(wire);
    app.on('window', wire);

    console.log('\nPart A — process & windows');

    let mainInfo = null;
    try {
        mainInfo = await app.evaluate(async ({ app: electronApp }) => ({
            name: electronApp.getName(),
            version: electronApp.getVersion(),
            userData: electronApp.getPath('userData'),
            packaged: electronApp.isPackaged
        }));
        passed++;
        console.log('  PASS  main process reachable');
    } catch (err) {
        failed++;
        fails.push('main process reachable');
        console.log('  FAIL  main process reachable\n        ' + err.message);
    }

    if (mainInfo) {
        console.log('        name=' + mainInfo.name + ' version=' + mainInfo.version + ' packaged=' + mainInfo.packaged);
        console.log('        userData=' + mainInfo.userData);
        check('userData folder matches package.json name', () => {
            assert.ok(
                path.basename(mainInfo.userData) === 'sameko-dev-cpp',
                'expected userData to end in "sameko-dev-cpp", got ' + mainInfo.userData
            );
        });
    }

    let win;
    try {
        win = await waitForMainWindow(app, WINDOW_TIMEOUT_MS);
        passed++;
        console.log('  PASS  main window (index.html) opened');
    } catch (err) {
        failed++;
        fails.push('main window opened');
        console.log('  FAIL  main window opened\n        ' + err.message);
    }

    if (win) {
        console.log('\nPart B — renderer');

        // Monaco is loaded lazily; give it room but do not hang forever.
        let monacoReady = false;
        try {
            await win.waitForSelector('.monaco-editor', { timeout: 30000, state: 'attached' });
            monacoReady = true;
            passed++;
            console.log('  PASS  Monaco editor mounted');
        } catch (err) {
            failed++;
            fails.push('Monaco editor mounted');
            console.log('  FAIL  Monaco editor mounted\n        ' + err.message);
        }

        if (monacoReady) {
            const probe = await win.evaluate(() => {
                const cs = getComputedStyle(document.documentElement);
                const fontFamily = window.monaco && window.monaco.editor
                    ? (window.monaco.editor.getEditors()[0] || {}).getRawOptions
                        ? window.monaco.editor.getEditors()[0].getRawOptions().fontFamily
                        : null
                    : null;
                return {
                    variant: document.documentElement.getAttribute('data-theme-variant'),
                    theme: document.documentElement.getAttribute('data-theme'),
                    // Probe tokens that are actually EMITTED at runtime, verified by
                    // walking documentElement's inline style on a live app. Do not probe
                    // --bg-primary (never defined anywhere) nor --bg-base / --bg-surface
                    // (declared in ThemeTokens.definitions but only filled in by
                    // ThemeTokens.fillDefaults, which builtin themes never go through).
                    bg: cs.getPropertyValue('--bg-panel').trim(),
                    editorBg: cs.getPropertyValue('--editor-bg').trim(),
                    fg: cs.getPropertyValue('--text-primary').trim(),
                    editorFont: fontFamily,
                    title: document.title
                };
            });
            console.log('        theme=' + probe.theme + ' variant=' + probe.variant);
            console.log('        --bg-panel=' + (probe.bg || '(empty)')
                + '  --editor-bg=' + (probe.editorBg || '(empty)')
                + '  --text-primary=' + (probe.fg || '(empty)'));
            if (probe.editorFont) console.log('        editor fontFamily=' + probe.editorFont);

            check('theme tokens resolve (--bg-panel non-empty)', () => {
                assert.ok(probe.bg && probe.bg.length > 0, '--bg-panel resolved to empty');
            });
            check('theme tokens resolve (--editor-bg non-empty)', () => {
                assert.ok(probe.editorBg && probe.editorBg.length > 0, '--editor-bg resolved to empty');
            });
            check('theme tokens resolve (--text-primary non-empty)', () => {
                assert.ok(probe.fg && probe.fg.length > 0, '--text-primary resolved to empty');
            });
            check('theme variant attribute present', () => {
                assert.ok(
                    probe.variant === 'dark' || probe.variant === 'light',
                    'data-theme-variant was ' + JSON.stringify(probe.variant)
                );
            });
        }

        // Screenshot for the launch page / visual regression baseline.
        try {
            fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
            const shot = path.join(ARTIFACT_DIR, 'main-window-' + process.platform + '.png');
            await win.screenshot({ path: shot });
            console.log('        screenshot -> ' + shot);
        } catch (err) {
            console.log('        (screenshot failed: ' + err.message + ')');
        }
    } else {
        skip('renderer checks', 'no main window');
    }

    console.log('\nPart C — console hygiene (the case-sensitivity / 404 sweep)');

    check('no failed resource loads', () => {
        assert.ok(
            failedRequests.length === 0,
            failedRequests.length + ' failed request(s):\n        ' + failedRequests.join('\n        ')
        );
    });
    check('no uncaught renderer exceptions', () => {
        assert.ok(
            pageErrors.length === 0,
            pageErrors.length + ' page error(s):\n        ' + pageErrors.join('\n        ')
        );
    });
    if (consoleErrors.length) {
        // Reported, not failed: third-party libs log benign errors and we do not
        // want a red build over a Monaco warning. Read them, then decide.
        console.log('  NOTE  ' + consoleErrors.length + ' console.error line(s) — review manually:');
        consoleErrors.slice(0, 15).forEach((l) => console.log('        · ' + l));
        if (consoleErrors.length > 15) console.log('        … ' + (consoleErrors.length - 15) + ' more');
    } else {
        passed++;
        console.log('  PASS  no console.error output');
    }

    if (process.env.SMOKE_KEEP_OPEN) {
        console.log('\nSMOKE_KEEP_OPEN set — leaving the app running. Close it yourself.');
    } else {
        try { await app.close(); } catch (_) { /* already gone */ }
    }

    console.log('\n' + '-'.repeat(60));
    console.log('passed=' + passed + '  failed=' + failed + '  skipped=' + skipped);
    if (failed) {
        console.log('FAILED: ' + fails.join(', '));
        process.exit(1);
    }
    console.log('OK');
    process.exit(0);
}

main().catch((err) => {
    console.error('\nunexpected error: ' + (err && err.stack ? err.stack : err));
    process.exit(1);
});
