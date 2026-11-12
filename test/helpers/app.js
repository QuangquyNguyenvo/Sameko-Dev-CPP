'use strict';

/**
 * Shared pieces for the gui suites: the real app on a throwaway profile, and PASS/FAIL lines in
 * the format test/run.js counts. A new gui suite should start from this rather than copy the
 * launch code of test/gui/app.js.
 *
 *   const { launchApp, checker } = require('../helpers/app');
 *   const t = checker();
 *   const { page, close } = await launchApp({ settings: { appearance: { theme: 'kawaii-dark' } } });
 *   await t.check('does a thing', async () => { ... });
 *   await close();
 *   t.finish();   // prints the count, sets the exit code
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Starts the app with a temp user-data dir (under the OS temp folder, so the Companion server
 * takes a random port, see competitive-handlers.js) and waits until App.ready.
 * @param {{settings?: object, timeout?: number}} [options] settings: written as settings.json
 * @returns {Promise<{app, page, profile: string, pageErrors: string[], close: () => Promise<void>}>}
 */
async function launchApp({ settings = {}, timeout = 60000 } = {}) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-test-'));
    const base = { discord: { enabled: false }, startup: { behavior: 'empty' }, editor: { liveCheck: false, autoSave: false } };
    const merged = { ...base, ...settings, editor: { ...base.editor, ...(settings.editor || {}) } };
    fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(merged));
    const app = await _electron.launch({
        executablePath: require('electron'),
        args: [ROOT, '--user-data-dir=' + profile, '--lang=en-US'],
        cwd: ROOT,
        timeout
    });
    const close = async () => {
        try { await app.close(); } catch (_) { }
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { }
    };
    try {
        const deadline = Date.now() + timeout;
        let page = null;
        while (!page) {
            page = app.windows().find(w => { try { return w.url().includes('index.html'); } catch (_) { return false; } }) || null;
            if (!page) {
                if (Date.now() > deadline) throw new Error('the main window did not open');
                await sleep(100);
            }
        }
        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(e.message));
        await page.waitForLoadState('load');
        await page.waitForFunction(() => typeof App !== 'undefined' && App.ready === true, null, { timeout });
        return { app, page, profile, pageErrors, close };
    } catch (err) {
        await close();
        throw err;
    }
}

/** Waits until fn() (run in the page) is truthy. */
async function waitInPage(page, fn, arg, timeout = 60000) {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
}

/** PASS/FAIL lines and the exit code, as test/run.js expects. */
function checker() {
    let passed = 0;
    let failed = 0;
    return {
        async check(name, fn) {
            const t0 = Date.now();
            try {
                await fn();
                passed++;
                console.log('  PASS  ' + name + (process.env.TEST_TIMES ? `  (${((Date.now() - t0) / 1000).toFixed(1)} s)` : ''));
            } catch (error) {
                failed++;
                console.log('  FAIL  ' + name + '\n        ' + String(error && error.message || error).replace(/\n/g, '\n        '));
            }
        },
        finish() {
            console.log(`\n${passed} passed, ${failed} failed`);
            process.exitCode = failed ? 1 : 0;
        },
        get failed() { return failed; }
    };
}

module.exports = { ROOT, launchApp, waitInPage, checker, sleep };
