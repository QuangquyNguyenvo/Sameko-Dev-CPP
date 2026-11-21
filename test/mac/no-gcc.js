#!/usr/bin/env node
'use strict';

/*
 * First launch on a Mac without Homebrew GCC: the app must open, say what to install, and fail a
 * build with a compiler message instead of hanging. CI moves g++-* away before running this.
 *
 *   node test/mac/no-gcc.js "<...>/Sameko Dev C++.app/Contents/MacOS/Sameko Dev C++"
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

async function main() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-no-gcc-'));
    fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
        discord: { enabled: false }, startup: { behavior: 'empty' }, editor: { liveCheck: false, autoSave: false },
    }));
    const app = await _electron.launch({ executablePath: process.argv[2], args: [`--user-data-dir=${profile}`, '--lang=en-US'], timeout: 60000 });
    try {
        let page;
        const deadline = Date.now() + 60000;
        while (!page && Date.now() < deadline) {
            page = app.windows().find((w) => { try { return w.url().includes('index.html'); } catch (_) { return false; } });
            if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(page, 'main window opened');
        await page.waitForFunction(() => typeof App !== 'undefined' && App.ready === true, null, { timeout: 60000 });
        await page.waitForFunction(() => TerminalManager.getLines().some((l) => /brew install gcc/.test(l.text)), null, { timeout: 20000 });
        console.log('  PASS  the app opens and says to run brew install gcc');

        await page.evaluate(async () => {
            await ensureMonaco();
            if (!App.tabs.length) newFile();
            setTabText(App.tabs.find((t) => t.id === App.activeTabId), '#include <bits/stdc++.h>\nint main() {}\n');
            ACTION_HANDLERS.compile();
        });
        await page.waitForFunction(() => TerminalManager.getLines().some((l) => /bits\/stdc\+\+\.h|failed|error/i.test(l.text)), null, { timeout: 30000 });
        await page.waitForFunction(() => !isBuilding, null, { timeout: 30000 });
        console.log('  PASS  a build ends with a compiler error instead of hanging');
    } finally {
        await app.close().catch(() => { });
        fs.rmSync(profile, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.log(`  FAIL  ${error.message}`);
    process.exitCode = 1;
});
