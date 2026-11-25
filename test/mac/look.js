#!/usr/bin/env node
'use strict';

/*
 * A screenshot tour of the macOS app, for a person (or an agent) to look at: the window, a
 * build and run, the explorer, a panel drag, Format, Add Function Prototypes, Settings and a
 * light theme. Each step is a PNG in <shot-dir> plus a line in look.log; a failed step is
 * logged and the tour goes on. Run by .github/workflows/mac-check.yml.
 *
 *   node test/mac/look.js "<...>/Sameko Dev C++.app/Contents/MacOS/Sameko Dev C++" <shot-dir>
 *   LOOK_APP_DIR=. node test/mac/look.js node_modules/electron/dist/electron.exe <shot-dir>   (from source)
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const [, , executablePath, shotDir = 'mac-shots'] = process.argv;
fs.mkdirSync(shotDir, { recursive: true });
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-look-')));
const project = path.join(root, 'bài tập');
const profile = path.join(root, 'profile');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    discord: { enabled: false }, startup: { behavior: 'empty' },
    editor: { liveCheck: false, autoSave: false },
    appearance: { theme: 'kawaii-dark', language: 'en' },
    panels: { showIO: true, ioDocked: false, terminalDocked: false },
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const note = (s) => { console.log(s); lines.push(s); };
let failed = 0;

const SOURCE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n; cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    cout << total(a) << "\\n";
    return 0;
}

long long total(const vector<long long> &a) { long long s = 0; for (long long x : a) s += x; return s; }
`;

async function main() {
    const app = await _electron.launch({ executablePath, args: [...(process.env.LOOK_APP_DIR ? [process.env.LOOK_APP_DIR] : []), `--user-data-dir=${profile}`, '--lang=en-US'], timeout: 60000 });
    let mainLog = '';
    app.process().stdout?.on('data', (d) => { mainLog += d; });
    app.process().stderr?.on('data', (d) => { mainLog += d; });
    const pageErrors = [];
    let page;
    try {
        const deadline = Date.now() + 60000;
        while (!page && Date.now() < deadline) {
            page = app.windows().find((w) => { try { return w.url().includes('index.html'); } catch (_) { return false; } });
            if (!page) await sleep(100);
        }
        page.on('pageerror', (e) => pageErrors.push(e.message));
        await page.waitForFunction(() => typeof App !== 'undefined' && App.ready === true, null, { timeout: 60000 });
        // Fill the screen's work area, so the full-screen shot shows the whole window.
        await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds(screen.getPrimaryDisplay().workArea); w.show(); w.focus(); });
        await sleep(1500);

        let n = 0;
        const step = async (name, fn) => {
            const file = `${String(++n).padStart(2, '0')}-${name}.png`;
            try {
                const info = await fn();
                await sleep(400);
                await page.screenshot({ path: path.join(shotDir, file) });
                note(`ok    ${file}${info ? '  ' + JSON.stringify(info) : ''}`);
            } catch (e) {
                failed++;
                try { await page.screenshot({ path: path.join(shotDir, file) }); } catch (_) { }
                note(`FAIL  ${file}  ${String(e.message).split('\n').slice(0, 6).join(' | ')}`);
            }
        };
        const terminalText = () => page.evaluate(() => TerminalManager.getLines().map((l) => l.text).join('\n'));

        await step('startup', async () => page.evaluate(() => ({
            compiler: document.querySelector('#compiler-info, .compiler-info')?.textContent?.trim() || null,
        })));

        // The whole screen once, with the native title bar and traffic lights.
        try { execFileSync('screencapture', ['-x', path.join(shotDir, '00-screen.png')]); note('ok    00-screen.png'); } catch (e) { note('skip  00-screen.png ' + e.message); }

        const file = path.join(project, 'tổng.cpp');
        fs.writeFileSync(file, SOURCE);
        await step('file-open', async () => {
            await page.evaluate(async (f) => { await openFileFromPath(f); }, file);
            await page.waitForFunction(() => App.tabs.some((t) => /tổng\.cpp$/.test(t.path || '')), null, { timeout: 15000 });
        });

        await step('prototypes', async () => {
            const added = await page.evaluate(() => addFunctionPrototypes(App.editor));
            const text = await page.evaluate(() => App.editor.getModel().getValue());
            if (added !== 1 || !text.includes('long long total(const vector<long long> &);\n\nint main()')) throw new Error(`added ${added}: ${text.slice(0, 200)}`);
            return { added };
        });

        await step('format', async () => {
            const ok = await page.evaluate(() => formatCode(App.editor));
            if (!ok) throw new Error('format returned false: ' + (await terminalText()).slice(-400));
        });

        await step('build-and-run', async () => {
            await page.evaluate(() => {
                const input = document.getElementById('input') || document.querySelector('#io-section textarea');
                if (input) { input.value = '3\n1 2 39\n'; input.dispatchEvent(new Event('input', { bubbles: true })); }
            });
            await page.evaluate(() => ACTION_HANDLERS.compile());
            await page.waitForFunction(() => TerminalManager.getLines().some((l) => /Compile OK|Compile failed/.test(l.text)), null, { timeout: 120000 });
            const text = await terminalText();
            if (!/Compile OK/.test(text)) throw new Error(text.slice(-600));
            const exe = await page.evaluate((f) => window.electronAPI.compile({ filePath: f, content: App.editor.getValue(), flags: '-O2 -std=c++17', realtimeOutput: false }), file);
            const r = await page.evaluate((exePath) => window.electronAPI.runTest({ exePath, input: '3\n1 2 39\n', expectedOutput: '42\n', timeLimit: 2000, memoryLimit: 256 }), exe.outputPath);
            if (r.status !== 'AC') throw new Error(JSON.stringify(r).slice(0, 400));
            return { judge: r.status, ms: r.executionTime };
        });

        await step('explorer', async () => {
            await page.evaluate(() => { if (window.FileExplorer && !document.querySelector('.explorer-sidebar.visible')) FileExplorer.toggle(); });
        });

        await step('drag-terminal-divider', async () => {
            const b = await page.evaluate(() => { const el = document.getElementById('resizer-term'); const r = el?.getBoundingClientRect(); return r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
            if (!b) throw new Error('terminal divider not visible');
            const before = await page.evaluate(() => document.getElementById('terminal-section').offsetWidth);
            await page.mouse.move(b.x, b.y); await page.mouse.down();
            for (let i = 1; i <= 15; i++) await page.mouse.move(b.x - i * 10, b.y);
            await page.mouse.up();
            await sleep(300);
            const after = await page.evaluate(() => ({ w: document.getElementById('terminal-section').offsetWidth, resizing: document.body.classList.contains('panel-resizing') }));
            if (after.w <= before || after.resizing) throw new Error(JSON.stringify({ before, after }));
            return { before, after: after.w };
        });

        await step('settings', async () => { await page.evaluate(() => openSettings()); });
        await step('settings-closed', async () => { await page.keyboard.press('Escape'); });

        await step('light-theme', async () => {
            const variant = await page.evaluate(() => { App.settings.appearance.theme = 'kawaii-light'; applyTheme('kawaii-light'); return document.documentElement.dataset.themeVariant; });
            if (variant !== 'light') throw new Error('theme variant: ' + variant);
        });

        try { await page.keyboard.press('Escape'); execFileSync('screencapture', ['-x', path.join(shotDir, '12-screen-end.png')]); note('ok    12-screen-end.png'); } catch (e) { note('skip  12-screen-end.png ' + e.message); }

        await step('context-menu', async () => {
            await page.evaluate(() => { applyTheme('kawaii-dark'); });
            const box = await page.evaluate(() => { const r = document.querySelector('#editor-container .view-lines').getBoundingClientRect(); return { x: r.x + 120, y: r.y + 60 }; });
            await page.mouse.click(box.x, box.y, { button: 'right' });
            await sleep(500);
            // Monaco draws its context menu inside a shadow root.
            const items = await page.evaluate(() => {
                const roots = [document, ...[...document.querySelectorAll('*')].map((e) => e.shadowRoot).filter(Boolean)];
                return roots.flatMap((r) => [...r.querySelectorAll('.monaco-menu .action-label')]).map((e) => e.textContent.trim()).filter(Boolean);
            });
            if (!items.includes('Add Function Prototypes')) throw new Error(JSON.stringify(items));
            return { items: items.length };
        });
    } finally {
        if (pageErrors.length) { failed++; note('FAIL  page errors: ' + pageErrors.join(' | ')); }
        fs.writeFileSync(path.join(shotDir, 'main-process.log'), mainLog);
        fs.writeFileSync(path.join(shotDir, 'look.log'), lines.join('\n') + '\n');
        await app.close().catch(() => { });
    }
}

main().then(() => {
    console.log(failed ? `${failed} step(s) failed` : 'all steps ok');
    process.exitCode = failed ? 1 : 0;
}).catch((e) => {
    console.log(`FAIL  ${e.message}`);
    process.exitCode = 1;
});
