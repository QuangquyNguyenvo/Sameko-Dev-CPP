#!/usr/bin/env node
'use strict';

/*
 * Checks the Linux AppImage as users get it: the inner binary of the extracted AppImage, launched
 * with APPIMAGE set, working on a project whose path has spaces and Vietnamese letters. Uses the
 * system g++, gdb, clangd and astyle.
 *
 *   node test/linux/packaged.js <squashfs-root>/sameko-dev-cpp <path/to/the.AppImage> [shot-dir]
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const [, , executableArg, appImageArg, shotDir] = process.argv;
if (!executableArg || !appImageArg) {
    console.error('usage: node test/linux/packaged.js <squashfs-root>/sameko-dev-cpp <the.AppImage> [shot-dir]');
    process.exit(2);
}
const executablePath = path.resolve(executableArg);
const appImage = path.resolve(appImageArg);
const TAG = `sameko-linux-check-${process.pid}`;
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${TAG}-`)));
const project = path.join(root, 'dir with space', 'bài tập');
const profile = path.join(root, 'profile');
const dataHome = path.join(root, 'xdg-data');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(profile);
fs.mkdirSync(dataHome);
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
    for (let i = 0; i < 50 && running(pattern); i++) await sleep(100);
    assert.equal(running(pattern), '', `still running: ${pattern}`);
}

async function mainPage(app) {
    const deadline = Date.now() + 90000;
    let page;
    while (!page && Date.now() < deadline) {
        page = app.windows().find((w) => { try { return w.url().includes('index.html'); } catch (_) { return false; } });
        if (!page) await sleep(100);
    }
    assert.ok(page, 'main window opened');
    await page.waitForFunction(() => typeof App !== 'undefined' && App.ready === true, null, { timeout: 90000 });
    await page.evaluate(async () => {
        await ensureMonaco();
        if (!App.tabs.length) newFile();
    });
    return page;
}

async function main() {
    console.log('Sameko packaged Linux (AppImage) checks');
    const app = await _electron.launch({
        executablePath,
        args: [`--user-data-dir=${profile}`, '--lang=en-US'],
        env: { ...process.env, APPIMAGE: appImage, XDG_DATA_HOME: dataHome },
        timeout: 90000,
    });
    const page = await mainPage(app);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const shot = async (name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) }); };

    let firstBuild = true;
    const build = async (name, code, flags = '-O2 -std=c++20') => {
        const file = path.join(project, name);
        fs.writeFileSync(file, code);
        const timeout = firstBuild ? 120000 : 60000;
        firstBuild = false;
        const result = await Promise.race([
            page.evaluate(({ file, code, flags }) => window.electronAPI.compile({
                filePath: file, content: code, flags, useLLD: true, realtimeOutput: false,
            }), { file, code, flags }),
            sleep(timeout).then(() => { throw new Error(`compile of ${name} took more than ${timeout / 1000} s`); }),
        ]);
        assert.ok(result.success, `compile failed: ${JSON.stringify(result).slice(0, 900)}`);
        return result.outputPath;
    };
    const judge = (exePath, input, expectedOutput, timeLimit = 2000, memoryLimit = 256) => page.evaluate(
        (data) => window.electronAPI.runTest(data),
        { exePath, input, expectedOutput, timeLimit, memoryLimit, cwd: project },
    );
    // Starts Build & Run on a fresh untitled tab with an empty input area.
    const buildRunUntitled = async (code) => {
        const seq = await page.evaluate(() => App.runSeq || 0);
        await page.evaluate((code) => {
            newFile();
            setTabText(App.tabs.find((t) => t.id === App.activeTabId), code);
            document.getElementById('input-area').value = '';
            clearTerm();
            ACTION_HANDLERS.buildRun();
        }, code);
        await page.waitForFunction((s) => (App.runSeq || 0) > s, seq, { timeout: 120000 });
    };
    const stopRun = async () => {
        await page.evaluate(() => ACTION_HANDLERS.stop());
        await page.waitForFunction(() => !App.isRunning, null, { timeout: 10000 });
    };

    await check('bits/stdc++.h builds and is judged AC in a path with spaces and Vietnamese', async () => {
        const exe = await build('tổng.cpp', '#include <bits/stdc++.h>\nusing namespace std;\nint main(){long long a,b;cin>>a>>b;cout<<a+b<<"\\n";}\n');
        const r = await judge(exe, '40 2\n', '42\n');
        assert.equal(r.status, 'AC', JSON.stringify(r));
        assert.ok(r.peakMemoryKB > 0, `memory is measured: ${r.peakMemoryKB}`);
        assert.ok(r.executionTime >= 0 && r.executionTime < 1000, `time: ${r.executionTime}`);
        await shot('main');
    });

    await check('Large Stack runs a recursion 1,000,000 deep, which crashes when it is saved off', async () => {
        const code = '#include <iostream>\nint f(int d){volatile char a[64];a[0]=1;return d?f(d-1)+a[0]:0;}\nint main(){std::cout<<f(1000000)<<"\\n";}\n';
        const flags = await page.evaluate(() => buildCompileFlags({ judge: true }));
        const setLargeStack = (on) => page.evaluate(async (on) => {
            App.settings.compiler.largeStack = on;
            await saveSettings();
        }, on);
        try {
            await setLargeStack(true);
            const deep = await build('deep.cpp', code, `${flags} -O0`);
            const r = await judge(deep, '', '1000000\n', 5000, 1024);
            assert.equal(r.status, 'AC', JSON.stringify(r).slice(0, 400));
            await setLargeStack(false);
            const small = await judge(deep, '', '1000000\n', 5000, 1024);
            assert.equal(small.status, 'RE', JSON.stringify(small).slice(0, 400));
        } finally {
            await setLargeStack(true);
        }
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

    await check('using more memory than the limit is MLE every time, and a smaller program is AC', async () => {
        const program = (mb) => `#include <vector>\n#include <iostream>\nint main(){std::vector<char> v(${mb}ull<<20,1);long s=0;for(size_t i=0;i<v.size();i+=4096)s+=v[i];std::cout<<(s>0)<<"\\n";}\n`;
        const big = await build('mem400.cpp', program(400));
        for (let i = 1; i <= 5; i++) {
            const r = await judge(big, '', '1\n', 5000, 256);
            assert.equal(r.status, 'MLE', `run ${i}: ${JSON.stringify(r).slice(0, 400)}`);
        }
        const small = await build('mem100.cpp', program(100));
        const r = await judge(small, '', '1\n', 5000, 256);
        assert.equal(r.status, 'AC', JSON.stringify(r).slice(0, 400));
    });

    await check('2 MB of input and output pass through intact', async () => {
        const exe = await build('echo.cpp', '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ios::sync_with_stdio(0);cin.tie(0);string s;while(getline(cin,s))cout<<s<<"\\n";}\n');
        const text = Array.from({ length: 200000 }, (_, i) => String(i % 1000000).padStart(9, '0')).join('\n') + '\n';
        const r = await judge(exe, text, text, 5000);
        assert.equal(r.status, 'AC', r.status);
    });

    await check('Build & Run, then Stop, ends the program and the child it forked', async () => {
        const code = '#include <iostream>\n#include <unistd.h>\nint main(){fork();std::cout<<"started"<<std::endl;volatile int x=0;for(;;)x=x+1;}\n';
        await buildRunUntitled(code);
        // Parent and child both print it, unit-buffered, so the two can share a line ("startedstarted").
        await page.waitForFunction(() => TerminalManager.getLines().some((l) => l.text.includes('started')), null, { timeout: 30000 });
        await sleep(300);
        assert.ok(running('temp_code'), 'the program is running before Stop');
        await stopRun();
        await noProcess('temp_code');
    });

    await check('a prompt printed without a flush shows before scanf waits, and typed input is answered', async () => {
        const code = '#include <cstdio>\nint main(){int n;printf("Enter n: ");scanf("%d",&n);printf("%d\\n",n*2);return 0;}\n';
        await buildRunUntitled(code);
        await page.waitForFunction(
            () => TerminalManager.getLines().some((l) => l.text.includes('Enter n:')) || document.body.innerText.includes('Enter n:'),
            null, { timeout: 10000 },
        );
        assert.ok(await page.evaluate(() => App.isRunning), 'still waiting for input');
        await page.evaluate(() => window.electronAPI.sendInput('21'));
        await page.waitForFunction(() => TerminalManager.getLines().some((l) => l.text.trim() === '42' || l.text.includes('Enter n: 42')), null, { timeout: 10000 });
        await page.waitForFunction(() => !App.isRunning, null, { timeout: 10000 }).catch(() => stopRun());
        await noProcess('temp_code');
    });

    await check('a program the system will not start gives an error that does not mention Windows', async () => {
        const exe = await build('blocked.cpp', '#include <iostream>\nint main(){std::cout<<1<<"\\n";}\n');
        fs.chmodSync(exe, 0o644);
        const r = await judge(exe, '', '1\n');
        const text = JSON.stringify(r);
        assert.notEqual(r.status, 'AC', text);
        assert.ok(r.error || r.details, `an error is reported: ${text.slice(0, 400)}`);
        assert.doesNotMatch(text, /windows|antivirus/i, text.slice(0, 500));
    });

    await check('gdb stops at a breakpoint in the packaged app, reads a local, and Stop leaves nothing', async () => {
        const source = path.join(project, 'dbg.cpp');
        const exe = await build('dbg.cpp', '#include <iostream>\nint main() {\n    int value = 41;\n    value++;\n    std::cout << value << "\\n";\n}\n', '-g -O0 -std=c++20');
        await page.evaluate(() => {
            window.linuxStops = [];
            window.electronAPI.onDebugStopped((s) => window.linuxStops.push(s));
        });
        const started = await page.evaluate(({ exe, source, project }) => window.electronAPI.debugStart({
            exePath: exe, cwd: project, stdin: '', breakpoints: [{ file: source, line: 5, enabled: true }],
        }), { exe, source, project });
        assert.ok(started.ok, JSON.stringify(started));
        await page.waitForFunction(() => window.linuxStops.length > 0, null, { timeout: 30000 });
        const stop = await page.evaluate(() => window.linuxStops[0]);
        assert.equal(stop.frame.line, 5, JSON.stringify(stop.frame));
        assert.ok(stop.locals.some((l) => l.name === 'value' && String(l.value) === '42'), JSON.stringify(stop.locals));
        await page.evaluate(() => window.electronAPI.debugStop());
        await noProcess('gdb');
        await noProcess(`${TAG}.*dbg`);
    });

    await check('clangd completes std::vector members from bits/stdc++.h', async () => {
        const file = path.join(project, 'complete.cpp');
        const code = '#include <bits/stdc++.h>\nint main(){std::vector<int> v;v.\n}\n';
        fs.writeFileSync(file, code);
        let text = '';
        for (let i = 0; i < 16 && !text.includes('push_back'); i++) {
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

    await check("the AppImage's own .desktop file offers C++ files and the samekodev:// scheme", async () => {
        const dir = path.dirname(executablePath);
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop'));
        assert.ok(files.length, `no .desktop file in ${dir}`);
        const text = fs.readFileSync(path.join(dir, files[0]), 'utf8');
        const mime = (text.match(/^MimeType=(.*)$/m) || [])[1] || '';
        assert.ok(mime.includes('text/x-c++src'), `MimeType: ${mime}`);
        assert.ok(mime.includes('x-scheme-handler/samekodev'), `MimeType: ${mime}`);
    });

    await check('the running AppImage registered samekodev:// for itself', async () => {
        const file = path.join(dataHome, 'applications', 'sameko-dev-cpp-url.desktop');
        for (let i = 0; i < 100 && !fs.existsSync(file); i++) await sleep(100);
        assert.ok(fs.existsSync(file), `missing ${file}`);
        const text = fs.readFileSync(file, 'utf8');
        assert.ok(text.includes(`Exec="${appImage}" -- %u`), text);
        assert.match(text, /^NoDisplay=true$/m);
        assert.match(text, /^MimeType=x-scheme-handler\/samekodev;$/m);
    });

    await check('no renderer errors so far', async () => assert.deepEqual(pageErrors, []));

    await app.close();
    await check('quitting leaves no clangd or program running', async () => {
        await noProcess('clangd');
        await noProcess(TAG);
        await noProcess('temp_code');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exitCode = failed;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { }
    setTimeout(() => process.exit(), 200);
});
