#!/usr/bin/env node
'use strict';

/*
 * First launch on a Mac without Homebrew GCC: the app must open, say what to install, and fail a
 * build with a compiler message instead of hanging. CI moves g++-* away before running this.
 * With a second argument (the folder they were moved to and the folder to put them back in),
 * it then installs them while the app runs, as `brew install gcc` would, and the next build
 * must use Homebrew GCC without a restart (#58).
 *
 *   node test/mac/no-gcc.js "<...>/Sameko Dev C++.app/Contents/MacOS/Sameko Dev C++" [awayDir binDir]
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
    // The main process's own lines about which compiler and Homebrew it picked, for the log.
    app.process().stdout.on('data', (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) if (/\[(Platform|Compiler)\]/.test(line)) console.log(`  app   ${line.trim()}`);
    });
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

        await page.waitForFunction(() => TerminalManager.getLines().some((l) => /Apple Clang \(\/usr\/bin\/g\+\+\) has no/.test(l.text)), null, { timeout: 10000 });
        console.log('  PASS  the error says Apple Clang has no bits/stdc++.h and to run brew install gcc');

        const [awayDir, binDir] = process.argv.slice(3);
        if (awayDir && binDir) {
            for (const name of fs.readdirSync(awayDir)) fs.renameSync(path.join(awayDir, name), path.join(binDir, name));
            await page.evaluate(() => { TerminalManager.clear(); ACTION_HANDLERS.compile(); });
            await page.waitForFunction(() => TerminalManager.getLines().some((l) => /Compile OK|Compile failed/.test(l.text)), null, { timeout: 120000 });
            const lines = await page.evaluate(() => TerminalManager.getLines().map((l) => l.text).join('\n'));
            assert.match(lines, /Compile OK/, 'build after installing GCC:\n' + lines.slice(-2000));
            console.log('  PASS  GCC installed while the app runs is used by the next build, no restart');
        }
    } finally {
        await app.close().catch(() => { });
        fs.rmSync(profile, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.log(`  FAIL  ${error.message}`);
    process.exitCode = 1;
});
