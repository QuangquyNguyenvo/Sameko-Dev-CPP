#!/usr/bin/env node
'use strict';

// Behavioral regressions against the real Electron/Monaco renderer, on a disposable profile.
// Run with: node scripts/test-editor-state.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-editor-state-'));
let app;
let failed = 0;
let passed = 0;

async function check(name, test) {
    try {
        await test();
        passed++;
        console.log('  PASS  ' + name);
    } catch (error) {
        failed++;
        console.error('  FAIL  ' + name + '\n        ' + error.message);
    }
}

async function dropFiles(page, selector, files) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, selector + ' is visible');
    const session = await page.context().newCDPSession(page);
    try {
        // CDP creates real disk-backed Files, exercising the preload path bridge too.
        for (const type of ['dragEnter', 'dragOver', 'drop']) {
            await session.send('Input.dispatchDragEvent', {
                type,
                x: Math.round(box.x + box.width / 2),
                y: Math.round(box.y + box.height / 2),
                data: { items: [], files, dragOperationsMask: 1 }
            });
        }
    } finally {
        await session.detach();
    }
}

async function main() {
    console.log('Sameko editor state regressions');
    app = await _electron.launch({
        executablePath: require('electron'),
        args: [ROOT, '--user-data-dir=' + profile],
        cwd: ROOT,
        timeout: 60000
    });
    let page;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        page = app.windows().find(window => window.url().includes('index.html'));
        if (page) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page, 'main window opened');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof App !== 'undefined' && App.ready);
    await page.evaluate(async () => {
        await ensureMonaco();
        if (!App.tabs.length) newFile();
    });

    await check('test uses an isolated user profile', async () => {
        const userData = await app.evaluate(({ app }) => app.getPath('userData'));
        assert.equal(path.resolve(userData), path.resolve(profile));
    });

    await check('template import survives delayed editor initialization', async () => {
        const content = '// Imported before the mini editor is ready\nint main() {}\n';
        const fixture = path.join(profile, 'template.cpp');
        fs.writeFileSync(fixture, content);
        await page.evaluate(() => {
            // Hold the dependency promise to exercise a slow first Monaco load.
            window.originalTemplateLoader = ensureMonaco;
            ensureMonaco = () => new Promise(resolve => { window.releaseTemplateLoader = resolve; });
            openSettings();
            document.querySelector('.settings-tab[data-tab="template"]').click();
        });
        try {
            const choosing = page.waitForEvent('filechooser');
            await page.locator('#btn-import-template-from-file').click();
            await (await choosing).setFiles(fixture);
            await page.waitForFunction(expected => document.getElementById('set-template').value === expected,
                content, { timeout: 5000 });
        } finally {
            await page.evaluate(() => {
                ensureMonaco = window.originalTemplateLoader;
                window.releaseTemplateLoader();
                delete window.originalTemplateLoader;
                delete window.releaseTemplateLoader;
            });
        }
        await page.waitForFunction(() => templateEditor !== null);
        assert.equal(await page.evaluate(() => templateEditor.getValue()), content);
        await page.evaluate(() => closeSettings());
    });

    await check('an empty saved template creates a blank file', async () => {
        const value = await page.evaluate(async () => {
            openSettings();
            templateEditor.setValue('');
            await saveSettingsAndClose();
            newFile();
            return App.editor.getValue();
        });
        assert.equal(value, '');
        const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
        assert.equal(settings.template.code, '');
    });

    await check('reopening Settings preserves the blank template', async () => {
        const values = await page.evaluate(() => {
            openSettings();
            const result = [document.getElementById('set-template').value, templateEditor.getValue()];
            closeSettings();
            return result;
        });
        assert.deepEqual(values, ['', '']);
    });

    await check('disabling Performance Mode restores bracket colors in both editors', async () => {
        const values = await page.evaluate(() => {
            openSplit();
            App.settings.appearance.performanceMode = true;
            applySettings();
            App.settings.appearance.performanceMode = false;
            applySettings();
            return [App.editor, App.editor2].map(editor => ({
                brackets: editor.getOption(monaco.editor.EditorOption.bracketPairColorization).enabled,
                smoothScroll: editor.getOption(monaco.editor.EditorOption.smoothScrolling)
            }));
        });
        assert.deepEqual(values, [
            { brackets: true, smoothScroll: false },
            { brackets: true, smoothScroll: false }
        ]);
    });

    await check('applying settings keeps minimaps disabled while split', async () => {
        const enabled = await page.evaluate(() => {
            App.settings.editor.minimap = true;
            App.settings.appearance.performanceMode = false;
            applySettings();
            return [App.editor, App.editor2].map(editor => editor.getOption(monaco.editor.EditorOption.minimap).enabled);
        });
        assert.deepEqual(enabled, [false, false]);
    });

    await check('Scroll Beyond Last Line is configurable, applied to both editors, and persisted', async () => {
        const values = await page.evaluate(async () => {
            openSettings();
            const toggle = document.getElementById('set-scrollBeyondLastLine');
            const isImmediatelyAfterTabSize = toggle.closest('.setting-row').previousElementSibling
                .querySelector('#set-tabSize') !== null;
            toggle.checked = true;
            await saveSettingsAndClose();
            openSplit();
            const enabled = [App.editor, App.editor2].map(editor =>
                editor.getOption(monaco.editor.EditorOption.scrollBeyondLastLine));
            openSettings();
            const checkedAfterReopen = toggle.checked;
            toggle.checked = false;
            await saveSettingsAndClose();
            const disabled = [App.editor, App.editor2].map(editor =>
                editor.getOption(monaco.editor.EditorOption.scrollBeyondLastLine));
            return { isImmediatelyAfterTabSize, enabled, checkedAfterReopen, disabled };
        });
        assert.deepEqual(values, {
            isImmediatelyAfterTabSize: true,
            enabled: [true, true],
            checkedAfterReopen: true,
            disabled: [false, false]
        });
        const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
        assert.equal(settings.editor.scrollBeyondLastLine, false);
    });

    await check('closing split respects Performance Mode and the minimap preference', async () => {
        const values = await page.evaluate(() => {
            const enabled = () => App.editor.getOption(monaco.editor.EditorOption.minimap).enabled;
            App.settings.appearance.performanceMode = true;
            applySettings();
            closeSplit();
            const performanceMode = enabled();
            App.settings.appearance.performanceMode = false;
            applySettings();
            const normalMode = enabled();
            App.settings.editor.minimap = false;
            applySettings();
            openSplit();
            closeSplit();
            return { performanceMode, normalMode, preferenceOff: enabled() };
        });
        assert.deepEqual(values, { performanceMode: false, normalMode: true, preferenceOff: false });
    });

    const droppedFile = path.join(profile, 'kéo file 01.cpp');
    const droppedContent = '// Opened by dragging a file\nint main() { return 42; }\n';
    fs.writeFileSync(droppedFile, droppedContent);
    await check('dropping an OS file onto Monaco opens its own tab', async () => {
        const previous = await page.evaluate(() => ({ id: App.activeTabId, content: App.editor.getValue() }));
        const url = page.url();
        await dropFiles(page, '#editor-container', [droppedFile]);
        await page.waitForFunction(file => App.tabs.find(tab => tab.id === App.activeTabId)?.path === file, droppedFile);
        const result = await page.evaluate(id => ({
            content: App.editor.getValue(),
            previous: App.tabs.find(tab => tab.id === id).content,
            language: App.editor.getModel().getLanguageId()
        }), previous.id);
        assert.deepEqual(result, { content: droppedContent, previous: previous.content, language: 'cpp' });
        assert.equal(page.url(), url);
    });

    await check('dropping an already open file preserves its unsaved draft and model', async () => {
        const originalUri = await page.evaluate(() => {
            App.editor.pushUndoStop();
            App.editor.executeEdits('regression', [{
                range: App.editor.getModel().getFullModelRange(), text: '// unsaved dropped file\n'
            }]);
            App.editor.pushUndoStop();
            return App.editor.getModel().uri.toString();
        });
        await dropFiles(page, '#editor-container', [droppedFile]);
        const result = await page.evaluate(file => ({
            count: App.tabs.filter(tab => tab.path === file).length,
            content: App.editor.getValue(),
            uri: App.editor.getModel().uri.toString()
        }), droppedFile);
        assert.deepEqual(result, { count: 1, content: '// unsaved dropped file\n', uri: originalUri });
        await page.evaluate(() => App.editor.trigger('regression', 'undo', null));
        assert.equal(await page.evaluate(() => App.editor.getValue()), droppedContent);
    });

    await check('dropping several files on the tab bar opens each in drop order', async () => {
        const files = [path.join(profile, 'data file.txt'), path.join(profile, 'readme file.md')];
        fs.writeFileSync(files[0], '1 2 3\n');
        fs.writeFileSync(files[1], '# Dropped Markdown\n');
        const url = page.url();
        await dropFiles(page, '#tabs-container', files);
        await page.waitForFunction(file => App.tabs.find(tab => tab.id === App.activeTabId)?.path === file, files[1]);
        const result = await page.evaluate(paths => ({
            order: App.tabs.filter(tab => paths.includes(tab.path)).map(tab => tab.path),
            content: App.editor.getValue(),
            language: App.editor.getModel().getLanguageId()
        }), files);
        assert.deepEqual(result, { order: files, content: '# Dropped Markdown\n', language: 'markdown' });
        assert.equal(page.url(), url);
    });

    await check('the Input file drop still attaches input instead of opening a tab', async () => {
        const inputFile = path.join(profile, 'input data.inp');
        fs.writeFileSync(inputFile, '10 20\n');
        const before = await page.evaluate(() => {
            App.showIO = true;
            updateUI();
            return App.tabs.length;
        });
        await dropFiles(page, '.io-panel-input', [inputFile]);
        await page.waitForFunction(file => getTabInputFile(getPreferredTabId()) === file, inputFile);
        assert.equal(await page.evaluate(() => App.tabs.length), before);
        await page.evaluate(() => setInputFile(null));
    });

    const openedFile = path.join(profile, 'concurrent.cpp');
    fs.writeFileSync(openedFile, 'int main() { return 0; }\n');
    await check('concurrent requests open only one tab per file', async () => {
        const count = await page.evaluate(async file => {
            await Promise.all(Array.from({ length: 8 }, () => openFileFromPath(file)));
            return App.tabs.filter(tab => tab.path === file).length;
        }, openedFile);
        assert.equal(count, 1);
    });

    await check('opening an existing tab preserves unsaved text and undo history', async () => {
        const result = await page.evaluate(async file => {
            const editor = App.editor;
            const model = editor.getModel();
            editor.executeEdits('regression', [{ range: model.getFullModelRange(), text: '// unsaved draft\n' }]);
            editor.pushUndoStop();
            await openFileFromPath(file);
            const sameModel = model === editor.getModel();
            const draft = editor.getValue();
            editor.trigger('regression', 'undo', null);
            return { sameModel, draft, afterUndo: editor.getValue() };
        }, openedFile);
        assert.deepEqual(result, {
            sameModel: true, draft: '// unsaved draft\n', afterUndo: 'int main() { return 0; }\n'
        });
    });

    await check('a failed file open can be retried', async () => {
        const missing = path.join(profile, 'retry.cpp');
        await page.evaluate(file => openFileFromPath(file), missing);
        fs.writeFileSync(missing, '// now exists\n');
        const count = await page.evaluate(async file => {
            await openFileFromPath(file);
            return App.tabs.filter(tab => tab.path === file).length;
        }, missing);
        assert.equal(count, 1);
    });

    await check('split dragging uses the final pointer position without overflow', async () => {
        const sizes = await page.evaluate(async () => {
            openSplit();
            await new Promise(requestAnimationFrame);
            const left = document.getElementById('editor-pane-1');
            const right = document.getElementById('editor-pane-2');
            const divider = document.getElementById('resizer-split');
            const before = left.getBoundingClientRect().width;
            const x = divider.getBoundingClientRect().x;
            divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x }));
            for (let delta = 1; delta <= 100; delta++) {
                document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + delta }));
            }
            document.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 120 }));
            await new Promise(requestAnimationFrame);
            return {
                delta: left.getBoundingClientRect().width - before,
                overflow: left.parentElement.scrollWidth - left.parentElement.clientWidth,
                right: right.getBoundingClientRect().width
            };
        });
        assert.ok(Math.abs(sizes.delta - 120) < 2, JSON.stringify(sizes));
        assert.ok(sizes.overflow <= 1, JSON.stringify(sizes));
        assert.ok(sizes.right >= 200, JSON.stringify(sizes));
    });

    await check('closing split cancels a pending resize and reopening is balanced', async () => {
        const sizes = await page.evaluate(async () => {
            const left = document.getElementById('editor-pane-1');
            const right = document.getElementById('editor-pane-2');
            const divider = document.getElementById('resizer-split');
            const x = divider.getBoundingClientRect().x;
            divider.dispatchEvent(new MouseEvent('mousedown', { clientX: x }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 80 }));
            closeSplit();
            await new Promise(requestAnimationFrame);
            const cursor = document.body.style.cursor;
            openSplit();
            await new Promise(requestAnimationFrame);
            return { cursor, left: left.getBoundingClientRect().width, right: right.getBoundingClientRect().width };
        });
        assert.equal(sizes.cursor, '');
        assert.ok(Math.abs(sizes.left - sizes.right) < 2, JSON.stringify(sizes));
    });

    await check('no uncaught renderer exceptions', async () => assert.deepEqual(errors, []));
}

main().catch(error => {
    failed++;
    console.error(error);
}).finally(async () => {
    if (app) await app.close();
    const resolvedProfile = path.resolve(profile);
    if (path.dirname(resolvedProfile) === path.resolve(os.tmpdir())
        && path.basename(resolvedProfile).startsWith('sameko-editor-state-')) {
        fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
});
