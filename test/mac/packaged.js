#!/usr/bin/env node
'use strict';

/*
 * Checks the macOS app as users get it: the .app installed from the DMG, launched from a folder
 * with a space in its name, working on a project whose path has spaces and Vietnamese letters.
 *
 *   node test/mac/packaged.js "<...>/Sameko Dev C++.app/Contents/MacOS/Sameko Dev C++" [shot-dir]
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { describeExit } = require('../../app/shared/exit-codes');

const [, , executablePath, shotDir] = process.argv;
const TAG = `sameko-mac-check-${process.pid}`;
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${TAG}-`)));
const project = path.join(root, 'dir with space', 'bài tập');
const profile = path.join(root, 'profile');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    discord: { enabled: false },
    startup: { behavior: 'empty' },
    editor: { liveCheck: false, autoSave: false },
    appearance: { theme: 'kawaii-dark', language: 'en' },
}));

let passed = 0;
let failed = 0;
async function check(name, test) {
    try {
        await test();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        failed++;
        console.log(`  FAIL  ${name}\n        ${String(error.message).split('\n').slice(0, 8).join('\n        ')}`);
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function running(pattern) {
    try {
        return execFileSync('pgrep', ['-fl', pattern], { encoding: 'utf8' }).trim();
    } catch (_) {
        return '';
    }
}

async function noProcess(pattern) {
    for (let i = 0; i < 30 && running(pattern); i++) await sleep(100);
    assert.equal(running(pattern), '', `still running: ${pattern}`);
}

async function mainPage(app) {
    const deadline = Date.now() + 60000;
    let page;
    while (!page && Date.now() < deadline) {
        page = app.windows().find((w) => { try { return w.url().includes('index.html'); } catch (_) { return false; } });
        if (!page) await sleep(100);
    }
    assert.ok(page, 'main window opened');
    await page.waitForFunction(() => typeof App !== 'undefined' && App.ready === true, null, { timeout: 60000 });
    await page.evaluate(async () => {
        await ensureMonaco();
        if (!App.tabs.length) newFile();
    });
    return page;
}

async function main() {
    console.log('Sameko packaged macOS checks');
    const app = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`, '--lang=en-US'], timeout: 60000 });
    let page = await mainPage(app);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const shot = async (name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) }); };

    const build = async (name, code, flags = '-O2 -std=c++20') => {
        const file = path.join(project, name);
        fs.writeFileSync(file, code);
        const result = await page.evaluate(({ file, code, flags }) => window.electronAPI.compile({
            filePath: file, content: code, flags, useLLD: true, realtimeOutput: false,
        }), { file, code, flags });
        assert.ok(result.success, `compile failed: ${JSON.stringify(result).slice(0, 900)}`);
        return result.outputPath;
    };
    const judge = (exePath, input, expectedOutput, timeLimit = 2000, memoryLimit = 256) => page.evaluate(
        (data) => window.electronAPI.runTest(data),
        { exePath, input, expectedOutput, timeLimit, memoryLimit, cwd: project },
    );

    await check('native window: macOS buttons, no custom buttons, Edit menu without a Close shortcut', async () => {
        const ui = await page.evaluate(() => ({
            platform: document.documentElement.dataset.platform,
            custom: getComputedStyle(document.querySelector('.win-btns')).display,
            padding: parseFloat(getComputedStyle(document.querySelector('.header-bar')).paddingLeft),
        }));
        assert.deepEqual(ui, { platform: 'mac', custom: 'none', padding: 88 });
        const menu = await app.evaluate(({ Menu }) => {
            const walk = (m) => m.items.flatMap((i) => [i.role || i.label, ...(i.submenu ? walk(i.submenu) : [])]);
            return walk(Menu.getApplicationMenu()).map((x) => String(x).toLowerCase());
        });
        for (const role of ['copy', 'paste', 'cut', 'selectall', 'undo', 'quit']) assert.ok(menu.includes(role), `menu has ${role}`);
        assert.ok(!menu.includes('close'), 'Cmd+W must stay with the tab');
        await shot('main');
        if (shotDir) {
            await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
            await sleep(500);
            try { execFileSync('screencapture', ['-x', path.join(shotDir, 'screen.png')]); } catch (_) { }
        }
    });

    await check('shortcut labels use the macOS symbols', async () => {
        await page.waitForFunction(() => [...document.querySelectorAll('.dropdown-item .key')].some((k) => k.textContent === '⌘S'));
        const left = await page.evaluate(() => [...document.querySelectorAll('.dropdown-item .key')].map((k) => k.textContent).filter((t) => /Ctrl\+/.test(t)));
        assert.deepEqual(left, []);
    });

    await check('bits/stdc++.h builds and is judged AC in a path with spaces and Vietnamese', async () => {
        const exe = await build('tổng.cpp', '#include <bits/stdc++.h>\nusing namespace std;\nint main(){long long a,b;cin>>a>>b;cout<<a+b<<"\\n";}\n');
        const r = await judge(exe, '40 2\n', '42\n');
        assert.equal(r.status, 'AC', JSON.stringify(r));
        assert.ok(r.peakMemoryKB > 0, `memory is measured: ${r.peakMemoryKB}`);
        assert.ok(r.executionTime >= 0 && r.executionTime < 1000, `time: ${r.executionTime}`);
    });

    await check('C++23 <print> builds and runs', async () => {
        const exe = await build('print.cpp', '#include <print>\nint main(){std::println("hi {}", 7);}\n', '-O2 -std=c++23');
        const r = await judge(exe, '', 'hi 7\n');
        assert.equal(r.status, 'AC', JSON.stringify(r));
    });

    await check('Large Stack runs a recursion 1,000,000 deep, which crashes without it', async () => {
        const code = '#include <iostream>\nint f(int d){volatile char a[64];a[0]=1;return d?f(d-1)+a[0]:0;}\nint main(){std::cout<<f(1000000)<<"\\n";}\n';
        const flagsWith = (on) => page.evaluate((on) => {
            App.settings.compiler.largeStack = on;
            const flags = buildCompileFlags({ judge: true });
            App.settings.compiler.largeStack = true;
            return flags;
        }, on);
        const large = await flagsWith(true);
        assert.match(large, /-Wl,-stack_size,0x10000000/);
        const r = await judge(await build('deep.cpp', code, `${large} -O0`), '', '1000000\n', 5000, 1024);
        assert.equal(r.status, 'AC', JSON.stringify(r).slice(0, 400));
        const small = await judge(await build('shallow.cpp', code, `${await flagsWith(false)} -O0`), '', '1000000\n', 5000, 1024);
        assert.equal(small.status, 'RE', JSON.stringify(small).slice(0, 400));
    });

    await check('the app is offered for C++ files, and a file opened from Finder becomes a tab', async () => {
        const plist = path.join(path.dirname(path.dirname(executablePath)), 'Info.plist');
        const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
        const type = (info.CFBundleDocumentTypes || []).find((t) => (t.CFBundleTypeExtensions || []).includes('cpp'));
        assert.ok(type, 'Info.plist declares .cpp');
        assert.equal(type.LSHandlerRank, 'Alternate');
        const file = path.join(project, 'from finder.cpp');
        fs.writeFileSync(file, 'int main() {}\n');
        await app.evaluate(({ app: electronApp }, f) => { electronApp.emit('open-file', { preventDefault() { } }, f); }, file);
        await page.waitForFunction((f) => App.tabs.some((t) => t.path === f), file, { timeout: 10000 });
    });

    await check('wrong answer is WA', async () => {
        const exe = await build('wa.cpp', '#include <iostream>\nint main(){std::cout<<1<<"\\n";}\n');
        assert.equal((await judge(exe, '', '2\n')).status, 'WA');
    });

    await check('an endless loop is TLE and leaves no process behind', async () => {
        const exe = await build('spin.cpp', 'int main(){volatile int x=0;for(;;)x=x+1;}\n');
        const started = Date.now();
        const r = await judge(exe, '', '', 500);
        assert.equal(r.status, 'TLE', JSON.stringify(r));
        assert.ok(Date.now() - started < 3000, 'stopped near the limit');
        await noProcess(`${TAG}.*spin`);
    });

    await check('a crash is RE', async () => {
        const exe = await build('crash.cpp', '#include <cstdlib>\nint main(int c,char**){volatile int*p=nullptr;*p=c;return 0;}\n', '-O0 -std=c++20');
        const r = await judge(exe, '', '');
        assert.equal(r.status, 'RE', JSON.stringify(r));
        await noProcess(`${TAG}.*crash`);
    });

    await check('using more memory than the limit is MLE', async () => {
        const exe = await build('mem.cpp', '#include <vector>\n#include <iostream>\nint main(){std::vector<char> v(200*1024*1024,1);long s=0;for(size_t i=0;i<v.size();i+=4096)s+=v[i];std::cout<<(s>0)<<"\\n";}\n');
        const r = await judge(exe, '', '1\n', 5000, 64);
        assert.equal(r.status, 'MLE', JSON.stringify(r));
    });

    await check('2 MB of input and output pass through intact', async () => {
        const exe = await build('echo.cpp', '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ios::sync_with_stdio(0);cin.tie(0);string s;while(getline(cin,s))cout<<s<<"\\n";}\n');
        const text = Array.from({ length: 200000 }, (_, i) => String(i % 1000000).padStart(9, '0')).join('\n') + '\n';
        const r = await judge(exe, text, text, 5000);
        assert.equal(r.status, 'AC', r.status);
    });

    await check('Build & Run prints to the terminal, and Stop ends a running program', async () => {
        const code = '#include <iostream>\nint main(){std::cout<<"started"<<std::endl;volatile int x=0;for(;;)x=x+1;}\n';
        const seq = await page.evaluate(() => App.runSeq || 0);
        await page.evaluate((code) => {
            newFile();
            setTabText(App.tabs.find((t) => t.id === App.activeTabId), code);
            document.getElementById('input-area').value = '';
            clearTerm();
            ACTION_HANDLERS.buildRun();
        }, code);
        await page.waitForFunction((s) => (App.runSeq || 0) > s, seq, { timeout: 60000 });
        await page.waitForFunction(() => TerminalManager.getLines().some((l) => l.text === 'started'), null, { timeout: 15000 });
        await page.evaluate(() => ACTION_HANDLERS.stop());
        await page.waitForFunction(() => !App.isRunning, null, { timeout: 5000 });
        await noProcess('temp_code');
    });

    await check('clangd completes std::vector members from bits/stdc++.h', async () => {
        const file = path.join(project, 'complete.cpp');
        const code = '#include <bits/stdc++.h>\nint main(){std::vector<int> v;v.\n}\n';
        fs.writeFileSync(file, code);
        let text = '';
        for (let i = 0; i < 12 && !text.includes('push_back'); i++) {
            text = JSON.stringify(await page.evaluate(({ file, code }) => window.electronAPI.getClangdCompletions(file, code, 1, 32), { file, code }));
            if (!text.includes('push_back')) await sleep(2500);
        }
        assert.match(text, /push_back/, text.slice(0, 500));
    });

    await check('Format Code works', async () => {
        const r = await page.evaluate(() => window.electronAPI.formatCode('int main(){\nint a=1;\nreturn a;\n}\n', 'google'));
        assert.ok(r.success, JSON.stringify(r));
        assert.match(r.code, /int main\(\) \{\n\s+int a/);
    });

    await check('Cmd+S saves the file', async () => {
        const file = path.join(project, 'save.cpp');
        fs.writeFileSync(file, 'int main() {}\n');
        await page.evaluate(async (file) => { await openFileFromPath(file); App.editor.focus(); }, file);
        await page.evaluate(() => {
            const tab = App.tabs.find((t) => t.id === App.activeTabId);
            App.editor.executeEdits('check', [{ range: tab.model.getFullModelRange(), text: 'int main() { return 0; }\n' }]);
            App.editor.focus();
        });
        await page.keyboard.press('Meta+s');
        for (let i = 0; i < 30 && !fs.readFileSync(file, 'utf8').includes('return 0'); i++) await sleep(100);
        assert.match(fs.readFileSync(file, 'utf8'), /return 0/);
    });

    await check('Cmd+A/C/V work in a text field', async () => {
        await page.evaluate(() => {
            const field = document.createElement('textarea');
            field.id = 'mac-clipboard-check';
            field.style.cssText = 'position:fixed;left:200px;top:200px;z-index:99999';
            field.value = 'abc';
            document.body.appendChild(field);
            field.focus();
        });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.selectAll());
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.copy());
        await sleep(150);
        await page.evaluate(() => { const el = document.getElementById('mac-clipboard-check'); el.selectionStart = el.selectionEnd = el.value.length; });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
        await page.waitForFunction(() => document.getElementById('mac-clipboard-check').value === 'abcabc', null, { timeout: 3000 });
        await page.evaluate(() => document.getElementById('mac-clipboard-check').remove());
    });

    await check('LLDB stops at a breakpoint in the packaged app, reads a local, and Stop leaves nothing', async () => {
        const source = path.join(project, 'dbg.cpp');
        const exe = await build('dbg.cpp', '#include <iostream>\nint main() {\n    int value = 41;\n    value++;\n    std::cout << value << "\\n";\n}\n', '-g -O0 -std=c++20');
        await page.evaluate(() => {
            window.macStops = [];
            window.electronAPI.onDebugStopped((s) => window.macStops.push(s));
        });
        const started = await page.evaluate(({ exe, source, project }) => window.electronAPI.debugStart({
            exePath: exe, cwd: project, stdin: '', breakpoints: [{ file: source, line: 5, enabled: true }],
        }), { exe, source, project });
        assert.ok(started.ok, JSON.stringify(started));
        await page.waitForFunction(() => window.macStops.length > 0, null, { timeout: 20000 });
        const stop = await page.evaluate(() => window.macStops[0]);
        assert.equal(stop.frame.line, 5, JSON.stringify(stop.frame));
        assert.ok(stop.locals.some((l) => l.name === 'value' && String(l.value) === '42'), JSON.stringify(stop.locals));
        await page.evaluate(() => window.electronAPI.debugStop());
        await noProcess('lldb-dap');
        await noProcess(`${TAG}.*dbg`);
    });

    // Starts the debugger on a fresh -g build and returns its first stop.
    const debugFirstStop = async (name, code, breakpoints, flags = '-g -O0 -std=c++20') => {
        const source = path.join(project, name);
        const exe = await build(name, code, flags);
        await page.evaluate(() => {
            if (!window.macStops) window.electronAPI.onDebugStopped((s) => window.macStops.push(s));
            window.macStops = [];
        });
        const started = await page.evaluate(({ exe, project, bps }) => window.electronAPI.debugStart({
            exePath: exe, cwd: project, stdin: '', breakpoints: bps,
        }), { exe, project, bps: breakpoints.map((line) => ({ file: source, line, enabled: true })) });
        assert.ok(started.ok, JSON.stringify(started));
        await page.waitForFunction(() => window.macStops.length > 0, null, { timeout: 30000 });
        return page.evaluate(() => window.macStops[0]);
    };
    const endDebug = async (stem) => {
        await page.evaluate(() => window.electronAPI.debugStop());
        await noProcess('lldb-dap');
        await noProcess(`${TAG}.*${stem}`);
    };

    await check('LLDB names a null-pointer write as a segmentation fault at the user\'s line', async () => {
        try {
            const stop = await debugFirstStop('nullwrite.cpp', 'int main() {\n    int *p = nullptr;\n    *p = 1;\n    return 0;\n}\n', []);
            assert.ok(stop.crash, `no crash in the stop: ${JSON.stringify(stop).slice(0, 600)}`);
            assert.equal(stop.crash.name, describeExit(null, 'SIGSEGV').name, JSON.stringify(stop.crash));
            assert.ok(stop.frames.some((f) => f.line === 3 && /nullwrite\.cpp$/.test(f.file || '')), JSON.stringify(stop.frames.slice(0, 5)));
        } finally {
            await endDebug('nullwrite');
        }
    });

    await check('LLDB names endless recursion as a stack overflow', async () => {
        try {
            const code = 'int f(int d) {\n    volatile char a[64];\n    a[d & 63] = 1;\n    return f(d + 1) + a[0];\n}\nint main() { return f(0); }\n';
            const stop = await debugFirstStop('overflow.cpp', code, []);
            assert.ok(stop.crash, `no crash in the stop: ${JSON.stringify({ reason: stop.reason, depth: stop.depth })}`);
            assert.equal(stop.crash.name, describeExit(0xC00000FD).name, JSON.stringify({ crash: stop.crash, depth: stop.depth }));
            assert.ok(stop.depth >= 2000, `depth ${stop.depth}`);
        } finally {
            await endDebug('overflow');
        }
    });

    await check('LLDB lists threads at a breakpoint inside a std::thread, and switching thread shows its frames', async () => {
        try {
            const code = '#include <chrono>\n#include <iostream>\n#include <thread>\nvoid work(int n) {\n'
                + '    std::this_thread::sleep_for(std::chrono::milliseconds(300));\n'
                + '    std::cout << n << "\\n";\n}\nint main() {\n    std::thread t(work, 5);\n    t.join();\n}\n';
            const stop = await debugFirstStop('threadpair.cpp', code, [6], '-g -O0 -std=c++20 -pthread');
            assert.equal(stop.frame?.line, 6, JSON.stringify(stop.frame));
            assert.ok(Array.isArray(stop.threads) && stop.threads.length >= 2, JSON.stringify(stop.threads));
            const other = stop.threads.find((t) => !t.current) || stop.threads.find((t) => t.id !== String(stop.threadId));
            assert.ok(other, JSON.stringify(stop.threads));
            const r = await page.evaluate((id) => window.electronAPI.debugSelectThread(id), other.id);
            assert.ok(r.ok, JSON.stringify(r));
            assert.ok(r.frames.length > 0 && r.frames.some((f) => f.func.includes('main')), JSON.stringify(r.frames.slice(0, 8)));
        } finally {
            // Not 'threads': Chromium's own --num-raster-threads flag would match it.
            await endDebug('threadpair');
        }
    });

    await check('LLDB changes a local while paused, and the program uses the new value', async () => {
        try {
            const code = '#include <iostream>\nint main() {\n    int value = 41;\n    value++;\n    std::cout << value << "\\n";\n    return value;\n}\n';
            const stop = await debugFirstStop('assign.cpp', code, [4, 6]);
            assert.equal(stop.frame?.line, 4, JSON.stringify(stop.frame));
            // The Locals panel creates one variable object per local, then Alt+click assigns to it.
            const created = await page.evaluate(() => window.electronAPI.debugVarCreateMany([{ name: 'vmac1', expr: 'value' }]));
            assert.ok(created.ok && created.vars?.[0]?.ok, JSON.stringify(created));
            const r = await page.evaluate(() => window.electronAPI.debugVarAssign('vmac1', '7'));
            assert.ok(r.ok, JSON.stringify(r));
            assert.equal(String(r.value), '7', JSON.stringify(r));
            const update = await page.evaluate(() => window.electronAPI.debugVarUpdate());
            assert.ok(!(update.changed || []).some((c) => c.name === 'vmac1'), JSON.stringify(update));
            await page.evaluate(() => window.electronAPI.debugContinue());
            await page.waitForFunction(() => window.macStops.length > 1, null, { timeout: 20000 });
            const second = await page.evaluate(() => window.macStops[1]);
            assert.equal(second.frame?.line, 6, JSON.stringify(second.frame));
            assert.ok(second.locals.some((l) => l.name === 'value' && String(l.value) === '8'), JSON.stringify(second.locals));
        } finally {
            await endDebug('assign');
        }
    });

    await check('no renderer errors so far', async () => assert.deepEqual(pageErrors, []));

    await check('closing the window keeps the app, and the Dock icon opens it again', async () => {
        const reopened = app.waitForEvent('window', { timeout: 30000 });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await sleep(500);
        assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
        await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
        page = await reopened;
        await page.waitForFunction(() => typeof App !== 'undefined' && App.ready === true, null, { timeout: 60000 });
        const exe = await build('again.cpp', '#include <iostream>\nint main(){std::cout<<7<<"\\n";}\n');
        assert.equal((await judge(exe, '', '7\n')).status, 'AC');
    });

    await app.close();
    await check('quitting leaves no clangd or helper running', async () => {
        await noProcess('clangd');
        await noProcess(TAG);
    });

    await check('opened with Finder\'s short PATH, the app and its programs still find Homebrew', async () => {
        const finder = await _electron.launch({
            executablePath, args: [`--user-data-dir=${profile}`, '--lang=en-US'], timeout: 60000,
            env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        });
        try {
            page = await mainPage(finder);
            const dirs = (await finder.evaluate(() => process.env.PATH)).split(':');
            assert.ok(dirs.indexOf('/opt/homebrew/bin') !== -1 && dirs.indexOf('/opt/homebrew/bin') < dirs.indexOf('/usr/bin'), dirs.join(':'));
            const exe = await build('path.cpp', '#include <cstdlib>\n#include <iostream>\nint main(){std::cout<<(std::system("command -v brew >/dev/null")==0)<<"\\n";}\n');
            const r = await judge(exe, '', '1\n');
            assert.equal(r.status, 'AC', JSON.stringify(r).slice(0, 400));
        } finally {
            await finder.close();
        }
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { }
    setTimeout(() => process.exit(), 200);
});
