'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const artifacts = path.join(ROOT, 'plans', '_smoke-artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifacts, 'theme-gui-'));
let application;
let page;
const errors = [];
let passed = 0;

async function launch() {
    application = await electron.launch({ executablePath: require('electron'),
        args: [ROOT, '--user-data-dir=' + profile], cwd: ROOT, timeout: 60000 });
    application.on('window', window => window.on('pageerror', error => errors.push(error.message)));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        page = application.windows().find(window => window.url().includes('index.html'));
        if (page) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page, 'Main window did not open');
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof App !== 'undefined' && App.ready
        && typeof ThemeCustomizer !== 'undefined' && ThemeManager.themes.size >= 6);
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
}

async function check(name, run) {
    await run();
    passed++;
    console.log('PASS ' + name);
}

async function main() {
    try {
        await launch();
        await check('Customize opens one editing session', async () => {
            const calls = await page.evaluate(() => {
                const original = ThemeCustomizer.open;
                let count = 0;
                ThemeCustomizer.open = () => count++;
                document.getElementById('btn-open-customizer').click();
                ThemeCustomizer.open = original;
                return count;
            });
            assert.equal(calls, 1);
        });
        await check('All six builtins open with the correct variant', async () => {
            for (const id of ['kawaii-dark', 'kawaii-light', 'sakura', 'dracula', 'monokai', 'nord']) {
                await page.evaluate(id => ThemeCustomizer.open(id), id);
                const result = await page.evaluate(() => {
                    const host = document.querySelector('.tcf-preview-host');
                    const preview = host?.shadowRoot?.querySelector('.app-container');
                    return { popup: !!ThemeCustomizer.popup, variant: preview?.getAttribute('data-theme-variant'),
                        expected: ThemeCustomizer.workingTheme.type,
                        locked: document.querySelectorAll('.tc6-locked-overlay').length };
                });
                assert.ok(result.popup);
                assert.equal(result.variant, result.expected);
                assert.equal(result.locked, 0);
                await page.evaluate(() => ThemeCustomizer.close(true));
            }
        });
        await page.evaluate(() => ThemeCustomizer.open('monokai'));
        await check('Editing previews every token without changing the main editor', async () => {
            const result = await page.evaluate(() => {
                const root = document.documentElement;
                const before = root.style.getPropertyValue('--accent');
                const original = monaco.editor.setTheme;
                const calls = [];
                monaco.editor.setTheme = id => { calls.push(id); original.call(monaco.editor, id); };
                ThemeCustomizer.setToken('accent', '#123456');
                ThemeCustomizer.setToken('successDark', '#654321');
                const preview = document.querySelector('.tcf-preview-host').shadowRoot.querySelector('.app-container');
                const result = { before, after: root.style.getPropertyValue('--accent'),
                    accent: preview.style.getPropertyValue('--accent'),
                    success: preview.style.getPropertyValue('--success-dark'), calls };
                monaco.editor.setTheme = original;
                return result;
            });
            assert.equal(result.before, result.after);
            assert.equal(result.accent, '#123456');
            assert.equal(result.success, '#654321');
            assert.deepEqual(result.calls, []);
        });
        await check('Undo and Redo restore the last color edit', async () => {
            await page.locator('[data-tcf-action="undo"]').click();
            assert.notEqual(await page.evaluate(() => ThemeCustomizer.workingTheme.colors.successDark), '#654321');
            await page.locator('[data-tcf-action="redo"]').click();
            assert.equal(await page.evaluate(() => ThemeCustomizer.workingTheme.colors.successDark), '#654321');
        });
        await check('Continuous brightness edit becomes one reversible change', async () => {
            const result = await page.evaluate(() => {
                const t = ThemeCustomizer, before = t.workingTheme.colors.bgBrightness, history = t.historyStack.length;
                t.setToken('bgBrightness', 130, { commit: false });
                t.setToken('bgBrightness', 150, { commit: false });
                t.setToken('bgBrightness', 150, { commit: true });
                const count = t.historyStack.length - history;
                t.undo(); const undo = t.workingTheme.colors.bgBrightness;
                t.redo(); return { before, count, undo, redo: t.workingTheme.colors.bgBrightness };
            });
            assert.equal(result.count, 1);
            assert.equal(result.undo, result.before);
            assert.equal(result.redo, 150);
        });
        await page.locator('[data-tcf-panel="advanced"]').click();
        await check('JSON Apply preserves its editing field and rejects invalid values', async () => {
            const result = await page.evaluate(() => {
                const t = ThemeCustomizer, field = document.querySelector('[data-tcf-json]');
                const value = JSON.parse(field.value); value.colors.accent = '#445566';
                field.value = JSON.stringify(value); const valid = t.applyJson(field.value);
                const sameField = field === document.querySelector('[data-tcf-json]') && field.isConnected;
                const baseline = JSON.stringify(t.workingTheme);
                value.colors.appBackground = 42;
                const invalid = t.applyJson(JSON.stringify(value));
                return { valid, sameField, invalid, unchanged: baseline === JSON.stringify(t.workingTheme) };
            });
            assert.ok(result.valid && result.sameField && result.unchanged);
            assert.equal(result.invalid, false);
        });
        await check('Copy from keeps the destination identity and name', async () => {
            const result = await page.evaluate(() => {
                const t = ThemeCustomizer, id = t.sourceThemeId, name = t.workingTheme.name;
                t.setBaseTheme('nord');
                return { id, after: t.sourceThemeId, draftId: t.workingTheme.id, name, afterName: t.workingTheme.name, base: t.baseThemeId };
            });
            assert.equal(result.id, result.after);
            assert.equal(result.id, result.draftId);
            assert.equal(result.name, result.afterName);
            assert.equal(result.base, 'nord');
        });
        await check('Selecting the editor preview focuses its actual color control', async () => {
            await page.locator('.editors-container[data-preview-token="editorBg"]').click();
            const result = await page.evaluate(() => ({ panel: ThemeCustomizer.activePanel,
                focused: document.activeElement?.getAttribute('data-key') }));
            assert.equal(result.panel, 'colors');
            assert.equal(result.focused, 'editorBg');
        });
        await page.evaluate(() => ThemeCustomizer.close(true));
        await page.evaluate(() => ThemeCustomizer.open('kawaii-dark'));
        await check('Video preview uses one filtered background layer', async () => {
            const result = await page.evaluate(() => {
                const preview = document.querySelector('.tcf-preview-host').shadowRoot.querySelector('.app-container');
                const video = preview.querySelector('.tcf-preview-video');
                return { video: !!video, muted: video?.muted, autoplay: video?.autoplay,
                    doubleFilter: !!video?.style.filter, source: video?.getAttribute('src') };
            });
            assert.ok(result.video && result.muted);
            assert.equal(result.autoplay, false);
            assert.equal(result.doubleFilter, false);
            assert.ok(result.source.includes('darkblue.webm'));
        });
        await check('Cleared builtin background saves and becomes the selected theme', async () => {
            const result = await page.evaluate(async () => {
                const t = ThemeCustomizer;
                t.clearBackground('appBackground');
                const saved = await t.save({ backgroundOnly: true });
                return { saved, stored: ThemeManager.getBackgroundOverrides('kawaii-dark').appBackground,
                    selected: App.settings.appearance.theme, active: ThemeManager.activeThemeId,
                    image: document.documentElement.style.getPropertyValue('--app-bg-image') };
            });
            assert.ok(result.saved);
            assert.equal(result.stored, '');
            assert.equal(result.selected, 'kawaii-dark');
            assert.equal(result.active, result.selected);
            assert.equal(result.image, 'none');
        });
        await check('Reset and reopen cannot remove the new dialog', async () => {
            const result = await page.evaluate(async () => {
                const t = ThemeCustomizer;
                const confirm = t._confirm; t._confirm = async () => true;
                await t.reset(); t._confirm = confirm;
                await t.close(true); await t.open('kawaii-light');
                await new Promise(resolve => setTimeout(resolve, 400));
                return { popup: !!t.popup, connected: t.popup?.isConnected, source: t.sourceThemeId };
            });
            assert.ok(result.popup && result.connected);
            assert.equal(result.source, 'kawaii-light');
        });
        await page.screenshot({ path: path.join(artifacts, 'customizer-light.png') });
        await page.evaluate(() => ThemeCustomizer.close(true));
        await page.evaluate(() => ThemeCustomizer.open('monokai'));
        await check('Uploaded background exports as portable data and saves with chosen editor scheme', async () => {
            const result = await page.evaluate(async () => {
                const t = ThemeCustomizer;
                const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='), c => c.charCodeAt(0));
                await t.setBackgroundFile(new File([bytes], 'pixel.png', { type: 'image/png' }), 'appBackground');
                t.setName('Customizer Regression');
                App.settings.editor.colorScheme = 'dracula';
                const saved = await t.save({ asNew: true });
                const portable = JSON.parse(await ThemeManager.exportThemePortable(t.sourceThemeId));
                return { saved, id: t.sourceThemeId, asset: t.workingTheme.colors.appBackground,
                    embedded: portable.colors.appBackground.startsWith('data:image/'), scheme: App.settings.editor.colorScheme };
            });
            assert.ok(result.saved, 'Custom theme save failed');
            assert.equal(result.id, 'customizer-regression');
            assert.ok(result.asset.startsWith('file:'));
            assert.ok(result.embedded);
            assert.equal(result.scheme, 'dracula');
        });
        await page.screenshot({ path: path.join(artifacts, 'customizer-dark.png') });
        await check('Import blocks both builtin ID formats', async () => {
            const result = await page.evaluate(() => [
                ThemeManager.importTheme(JSON.stringify({ id: 'nord', name: 'Blocked', colors: {} })),
                ThemeManager.importTheme(JSON.stringify({ meta: { id: 'nord', name: 'Blocked' }, colors: {} }))
            ].map(result => result.success));
            assert.deepEqual(result, [false, false]);
        });
        await page.evaluate(() => ThemeCustomizer.close(true));
        await application.close(); application = null;
        await launch();
        await check('Theme and cleared builtin background survive restart', async () => {
            const result = await page.evaluate(() => ({ active: ThemeManager.activeThemeId,
                settings: App.settings.appearance.theme, scheme: App.settings.editor.colorScheme,
                exists: ThemeManager.themes.has('customizer-regression'),
                cleared: ThemeManager.getBackgroundOverrides('kawaii-dark')?.appBackground }));
            assert.equal(result.active, 'customizer-regression');
            assert.equal(result.settings, result.active);
            assert.equal(result.scheme, 'dracula');
            assert.ok(result.exists);
            assert.equal(result.cleared, '');
        });
        await check('Normal Settings save preserves the theme background', async () => {
            const result = await page.evaluate(async () => {
                const id = App.settings.appearance.theme;
                const before = ThemeManager.themes.get(id).colors.appBackground;
                openSettings();
                document.getElementById('set-fontSize').value = App.settings.editor.fontSize + 1;
                await saveSettingsAndClose();
                return { before, after: ThemeManager.themes.get(id).colors.appBackground };
            });
            assert.equal(result.before, result.after);
        });
        await check('Failed Settings save restores the previous settings', async () => {
            const result = await page.evaluate(async () => {
                const before = App.settings.editor.fontSize;
                openSettings();
                document.getElementById('set-fontSize').value = before + 2;
                const original = saveSettings;
                saveSettings = async () => ({ success: false, error: 'simulated failure' });
                try { await saveSettingsAndClose(); } finally { saveSettings = original; closeSettings(); }
                return { before, after: App.settings.editor.fontSize };
            });
            assert.equal(result.before, result.after);
        });
        await check('Failed theme deletion restores the theme and selected settings', async () => {
            const result = await page.evaluate(async () => {
                await ThemeCustomizer.open('customizer-regression');
                const originalSave = saveSettings, originalConfirm = ThemeCustomizer._confirm;
                ThemeCustomizer._confirm = async () => true;
                saveSettings = async () => ({ success: false, error: 'simulated failure' });
                try { await ThemeCustomizer.deleteTheme(); }
                finally { saveSettings = originalSave; ThemeCustomizer._confirm = originalConfirm; }
                return { exists: ThemeManager.themes.has('customizer-regression'), selected: App.settings.appearance.theme };
            });
            assert.ok(result.exists);
            assert.equal(result.selected, 'customizer-regression');
        });
        await check('Deleting the active custom theme persists a valid replacement', async () => {
            const result = await page.evaluate(async () => {
                const original = ThemeCustomizer._confirm;
                ThemeCustomizer._confirm = async () => true;
                try { await ThemeCustomizer.deleteTheme(); } finally { ThemeCustomizer._confirm = original; }
                const stored = await window.electronAPI.stateRead('themes');
                return { exists: ThemeManager.themes.has('customizer-regression'), selected: App.settings.appearance.theme,
                    stored: stored.themes.some(theme => theme.id === 'customizer-regression'), popup: !!ThemeCustomizer.popup };
            });
            assert.equal(result.exists, false);
            assert.equal(result.stored, false);
            assert.equal(result.popup, false);
            assert.equal(result.selected, 'kawaii-dark');
        });
        assert.deepEqual(errors, [], 'Unexpected renderer errors');
        console.log(`${passed} theme GUI checks passed. Isolated profile: ${profile}`);
    } finally {
        if (application) await application.close();
    }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
