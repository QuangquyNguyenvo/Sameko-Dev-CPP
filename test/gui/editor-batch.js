'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchApp, checker, waitInPage } = require('../helpers/app');

async function main() {
    const t = checker();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sameko-editor-batch-'));
    const paths = Object.fromEntries(['main.cpp', 'other.cpp', 'value.hpp', 'quick.cpp', 'wide.cpp', 'hint.cpp', 'matches.txt'].map(name =>
        [name, path.join(dir, name)]
    ));
    const source = {
        'main.cpp': '#include "value.hpp"\nint main() { return sharedValue() + sharedValue(); }\n',
        'other.cpp': '#include "value.hpp"\nint other() { return sharedValue(); }\n',
        'value.hpp': '#pragma once\ninline int sharedValue() { return 1; }\n',
        'quick.cpp': 'int main() {\n    int n = 1\n    return n;\n}\n',
        'wide.cpp': 'int main() {\n    return 0； // keep this ；\n}\n',
        'hint.cpp': 'int main() { return 0 }\n',
        'matches.txt': 'skip\n<Widget.7>\nwidgetx8\nwidget.9\n'
    };
    for (const [name, text] of Object.entries(source)) await fs.writeFile(paths[name], text);
    const compileCommands = ['main.cpp', 'other.cpp'].map(name => ({
        directory: dir, file: paths[name], arguments: ['clang++', '-std=c++17', '-c', paths[name]]
    }));
    await fs.writeFile(path.join(dir, 'compile_commands.json'), JSON.stringify(compileCommands));

    let session;
    try {
        session = await launchApp({ settings: { appearance: { language: 'en' } } });
        const { page, pageErrors } = session;
        const open = name => page.evaluate(file => openFileFromPath(file), paths[name]);
        const position = (lineNumber, column) => page.evaluate(pos => {
            const editor = getActiveEditor();
            editor.setPosition(pos);
            editor.focus();
        }, { lineNumber, column });
        const activeFile = () => page.evaluate(() => getTabForModel(getActiveEditor().getModel()).name);

        await t.check('F12 opens a header and Shift+F12 previews and opens a reference in an unopened file', async () => {
            await open('main.cpp');
            await position(2, 25);
            await page.keyboard.press('F12');
            await waitInPage(page, () => getTabForModel(getActiveEditor().getModel())?.name === 'value.hpp', null, 20000);
            assert.equal(await page.evaluate(() => getActiveEditor().getPosition().lineNumber), 2);
            await waitInPage(page, async () => {
                const model = getActiveEditor().getModel();
                const refs = await window.electronAPI.getClangdReferences({
                    filePath: getTabForModel(model).path, content: model.getValue(),
                    position: { line: 1, character: 11 }, includeDeclaration: true
                });
                return refs.some(ref => /[/\\]other\.cpp$/.test(ref.file));
            }, null, 20000);
            await page.keyboard.press('Shift+F12');
            const peek = page.locator('.reference-zone-widget');
            await peek.waitFor({ state: 'visible', timeout: 20000 });
            assert.match(await peek.innerText(), /main\.cpp/);
            assert.equal(await page.evaluate(() => App.tabs.some(tab => tab.name === 'other.cpp')), false);
            const group = peek.locator('.monaco-list-row[aria-expanded]').filter({ hasText: 'other.cpp' });
            if (await group.getAttribute('aria-expanded') === 'false') await group.click();
            await peek.locator('.monaco-list-row[aria-label*="in other.cpp on line 2"]').dblclick();
            await waitInPage(page, () => getTabForModel(getActiveEditor().getModel())?.name === 'other.cpp');
            assert.equal(await page.evaluate(() => getActiveEditor().getPosition().lineNumber), 2);
            await page.keyboard.press('Escape');
            await waitInPage(page, () => !monaco.editor.getModels().some(model => model.uri.scheme === 'file'), null, 5000);
        });

        await t.check('Ctrl+. applies a clangd edit and Monaco undo restores the source', async () => {
            await open('quick.cpp');
            await position(3, 5);
            const fixes = await page.evaluate(async () => {
                const model = getActiveEditor().getModel();
                return window.electronAPI.getClangdCodeActions({
                    filePath: getTabForModel(model).path, content: model.getValue(),
                    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 4 } }
                });
            });
            assert.ok(fixes.some(fix => fix.edits.some(edit => edit.newText === ';')), JSON.stringify(fixes));
            const fix = fixes.find(fix => fix.edits.some(edit => edit.newText === ';'));
            await page.keyboard.press('ControlOrMeta+Period');
            await page.getByText(fix.title, { exact: true }).click({ timeout: 10000 });
            assert.match(await page.evaluate(() => getActiveEditor().getValue()), /int n = 1;/);
            await page.keyboard.press('ControlOrMeta+z');
            assert.equal(await page.evaluate(() => getActiveEditor().getValue()), source['quick.cpp']);
        });

        await t.check('Ctrl+Shift+F searches with both toggles and opens the selected line', async () => {
            await page.evaluate(folder => { FileExplorer.currentFolder = folder; }, dir);
            await page.keyboard.press('ControlOrMeta+Shift+f');
            const input = page.locator('#find-files-query');
            const hits = page.locator('.find-files-match');
            await input.fill('Widget.');
            await input.press('Enter');
            await page.waitForFunction(() => document.querySelectorAll('.find-files-match').length === 2);
            await page.getByLabel('Match case').check();
            await input.press('Enter');
            await page.waitForFunction(() => document.querySelectorAll('.find-files-match').length === 1);
            await page.getByLabel('Match case').uncheck();
            await page.getByLabel('Use regex').check();
            await input.fill('widget.\\d');
            await input.press('Enter');
            await page.waitForFunction(() => document.querySelectorAll('.find-files-match').length === 3);
            await hits.filter({ hasText: '<Widget.7>' }).click();
            assert.equal(await activeFile(), 'matches.txt');
            assert.equal(await page.evaluate(() => getActiveEditor().getPosition().lineNumber), 2);
            // Explorer.open schedules an editor layout after the sidebar settles.
            await page.waitForTimeout(350);
        });

        await t.check('with a file selected in the explorer, Ctrl+C/V and Delete in the editor stay with the editor', async () => {
            await page.evaluate(() => { FindInFiles.close(); FileExplorer.open(); return FileExplorer.refreshTree(); });
            await page.locator('.explorer-item', { hasText: 'other.cpp' }).first().click();
            await waitInPage(page, () => /other\.cpp$/.test(FileExplorer.selectedFilePath || ''));
            await page.keyboard.press('ControlOrMeta+c');
            assert.match(await page.evaluate(() => FileExplorer.clipboardFile?.path || ''), /other\.cpp$/, 'Ctrl+C on the explorer copies the file');
            await page.evaluate(() => { FileExplorer.clipboardFile = null; });
            // The click opened other.cpp; copy all of it and paste it at the end.
            await page.locator('.monaco-editor .view-lines').first().click();
            const before = await page.evaluate(() => getActiveEditor().getValue());
            await page.keyboard.press('ControlOrMeta+a');
            await page.keyboard.press('ControlOrMeta+c');
            await page.keyboard.press('ControlOrMeta+End');
            await page.keyboard.press('ControlOrMeta+v');
            await waitInPage(page, want => getActiveEditor().getValue() === want, before + before, 5000)
                .catch(() => {});
            assert.equal(await page.evaluate(() => getActiveEditor().getValue()), before + before, 'the file was pasted after itself');
            await page.keyboard.press('ControlOrMeta+z');
            const popups = () => page.evaluate(() => [...document.querySelectorAll('.cc-popup, dialog[open]')]
                .filter(el => el.offsetParent || el.open).map(el => el.className || el.tagName).join('|'));
            const popupsBefore = await popups();
            await page.keyboard.press('Delete');
            await page.waitForTimeout(200);
            assert.equal(await popups(), popupsBefore, 'Delete did not ask to delete the file');
            assert.equal(await page.evaluate(() => FileExplorer.clipboardFile), null);
        });

        await t.check('the compile error offers an undoable punctuation fix and preserves comments', async () => {
            await open('wide.cpp');
            await page.evaluate(() => compileOnly());
            await position(2, 13);
            await page.keyboard.press('ControlOrMeta+Period');
            await page.getByText('Replace full-width punctuation with ASCII', { exact: true }).click({ timeout: 10000 });
            assert.equal(await page.evaluate(() => getActiveEditor().getModel().getLineContent(2)), '    return 0; // keep this ；');
            await page.keyboard.press('ControlOrMeta+z');
            assert.equal(await page.evaluate(() => getActiveEditor().getValue()), source['wide.cpp']);
        });

        await t.check('live check offers the punctuation fix from the lightbulb', async () => {
            await open('wide.cpp');
            await page.evaluate(() => {
                App.settings.editor.liveCheck = true;
                scheduleLiveCheck();
            });
            await waitInPage(page, () => monaco.editor.getModelMarkers({
                resource: getActiveEditor().getModel().uri, owner: 'live-check'
            }).some(marker => marker.startLineNumber === 2));
            await position(2, 13);
            await page.locator('.lightBulbWidget').filter({ visible: true }).click({ timeout: 10000 });
            await page.getByText('Replace full-width punctuation with ASCII', { exact: true }).click({ timeout: 10000 });
            assert.equal(await page.evaluate(() => getActiveEditor().getModel().getLineContent(2)), '    return 0; // keep this ；');
            await page.evaluate(() => { App.settings.editor.liveCheck = false; });
        });

        await t.check('the first GCC error is explained in Problems in all three languages', async () => {
            await open('hint.cpp');
            await page.evaluate(() => compileOnly());
            const hint = page.locator('#problems-list .problem-hint');
            assert.match(await hint.innerText(), /Add a semicolon/);
            await page.evaluate(() => I18n.setLanguage('vi'));
            assert.match(await hint.innerText(), /Thêm dấu chấm phẩy/);
            await page.evaluate(() => I18n.setLanguage('zh-CN'));
            assert.match(await hint.innerText(), /加分号/);
            assert.deepEqual(pageErrors, []);
        });
    } finally {
        await session?.close();
        await fs.rm(dir, { recursive: true, force: true });
    }
    t.finish();
}

main().catch(error => {
    console.error('  FAIL ', error);
    process.exitCode = 1;
});
