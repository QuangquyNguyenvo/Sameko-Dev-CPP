'use strict';

/*
 * Theme Customizer checks in the real app (two launches: the last checks run
 * after a restart). Part of npm test; run alone with:
 *   node test/gui/theme-customizer.js
 *   KEEP_PROFILE=1   keep the temp profile (it is kept anyway on failure)
 *   SMOKE_SHOT=1     save screenshots to plans/_smoke-artifacts/
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const ROOT = path.join(__dirname, '..', '..');
const artifacts = path.join(ROOT, 'plans', '_smoke-artifacts');
const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sameko-theme-gui-')));
async function screenshot(name) {
    if (!process.env.SMOKE_SHOT) return;
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, name) });
}
let application;
let page;
const errors = [];
let passed = 0;

async function launch() {
    application = await electron.launch({ executablePath: require('electron'),
        args: [ROOT, '--user-data-dir=' + profile, '--lang=en-US'], cwd: ROOT, timeout: 60000 });
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
        && typeof ThemeCustomizer !== 'undefined'
        && ThemeManager.builtinThemeIds.every(id => ThemeManager.themes.has(id)));
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
        await check('All builtins open with the correct variant', async () => {
            const builtins = await page.evaluate(() => ThemeManager.builtinThemeIds.slice());
            assert.ok(builtins.length > 0);
            for (const id of builtins) {
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
        await check('Backgrounds opens first and preview adapts to window width', async () => {
            const initial = await page.evaluate(() => ({
                tabs: [...document.querySelectorAll('[data-tcf-panel]')].map(tab => tab.dataset.tcfPanel),
                active: ThemeCustomizer.activePanel,
            }));
            assert.deepEqual(initial, { tabs: ['backgrounds', 'colors', 'syntax', 'advanced'], active: 'backgrounds' });
            assert.ok(await page.locator('[data-tcf-panel-view="backgrounds"]').isVisible());
            await page.locator('[data-tcf-panel="backgrounds"]').press('ArrowRight');
            assert.equal(await page.evaluate(() => document.activeElement?.dataset.tcfPanel), 'colors');
            assert.ok(await page.locator('[data-tcf-panel-view="colors"]').isVisible());

            const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
            const readLayout = async size => {
                await page.setViewportSize(size);
                return page.evaluate(async () => {
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    const tabs = document.querySelector('.tcf-tabs');
                    const host = document.querySelector('.tcf-preview-host');
                    return {
                        tabs: tabs.getBoundingClientRect().toJSON(),
                        controls: document.querySelector('.tcf-main').getBoundingClientRect().toJSON(),
                        pane: document.querySelector('.tcf-preview-pane').getBoundingClientRect().toJSON(),
                        host: host.getBoundingClientRect().toJSON(),
                        stage: host.shadowRoot.querySelector('.tcf-stage').getBoundingClientRect().toJSON(),
                    };
                });
            };
            try {
                const desktop = await readLayout({ width: 1200, height: 800 });
                assert.ok(desktop.host.width >= 600 && desktop.host.width > desktop.host.height);
                assert.ok(desktop.host.left > desktop.controls.right);
                assert.ok(Math.abs(desktop.tabs.left - desktop.controls.left) <= 2
                    && Math.abs(desktop.tabs.right - desktop.controls.right) <= 2,
                    'desktop tabs should span the controls column');
                assert.ok(Math.abs(desktop.pane.top - desktop.tabs.top) <= 2,
                    'desktop preview should start alongside the tabs');
                assert.ok(desktop.host.left >= desktop.pane.left - 1 && desktop.host.right <= desktop.pane.right + 1
                    && desktop.host.top >= desktop.pane.top - 1 && desktop.host.bottom <= desktop.pane.bottom + 1,
                    'desktop preview host escapes its pane');
                assert.ok(desktop.stage.left >= desktop.host.left - 1 && desktop.stage.top >= desktop.host.top - 1
                    && desktop.stage.right <= desktop.host.right + 1 && desktop.stage.bottom <= desktop.host.bottom + 1,
                    'desktop preview stage escapes its frame');

                const narrow = await readLayout({ width: 800, height: 700 });
                assert.ok(narrow.host.top > narrow.controls.bottom);
                assert.ok(Math.abs(narrow.host.width - narrow.controls.width) <= 1);
                assert.ok(Math.abs(narrow.pane.width - narrow.controls.width) <= 1,
                    'stacked preview pane should remain full-width');
                assert.ok(narrow.stage.width > 0 && narrow.stage.height > 0);
                assert.ok(narrow.stage.left >= narrow.host.left - 1 && narrow.stage.top >= narrow.host.top - 1
                    && narrow.stage.right <= narrow.host.right + 1 && narrow.stage.bottom <= narrow.host.bottom + 1);
            } finally {
                await page.setViewportSize(originalViewport);
            }
        });
        await check('Background cards keep sources visible and reveal adjustments on demand', async () => {
            await page.locator('[data-tcf-panel="backgrounds"]').click();
            const initial = await page.evaluate(() => ['app', 'editor', 'shared'].map(key => {
                const card = document.querySelector(`[data-background-card="${key}"]`);
                const details = card?.querySelector('details.tcf-background-details');
                const url = card?.querySelector('[data-tcf-bg-url]');
                const upload = card?.querySelector('[data-tcf-action="choose-background"]');
                return { key, collapsed: details ? !details.open : false, urlVisible: !!url && !url.hidden,
                    uploadVisible: !!upload && !upload.hidden,
                    uploadIcon: upload ? [...upload.querySelectorAll('use')].map(use => use.getAttribute('href')) : [],
                    uploadLabel: upload?.getAttribute('aria-label'), uploadTitle: upload?.getAttribute('title') };
            }));
            assert.deepEqual(initial.map(({ key, collapsed, urlVisible, uploadVisible }) =>
                ({ key, collapsed, urlVisible, uploadVisible })), [
                { key: 'app', collapsed: true, urlVisible: true, uploadVisible: true },
                { key: 'editor', collapsed: true, urlVisible: true, uploadVisible: true },
                { key: 'shared', collapsed: true, urlVisible: false, uploadVisible: false },
            ]);
            assert.equal(initial[0].uploadLabel, 'Choose file…');
            assert.equal(initial[0].uploadTitle, 'Choose file…');
            assert.deepEqual(initial[0].uploadIcon, ['#i-upload-simple']);
            assert.equal(initial[1].uploadLabel, 'Choose file…');
            assert.equal(initial[1].uploadTitle, 'Choose file…');
            assert.deepEqual(initial[1].uploadIcon, ['#i-upload-simple']);
            for (const key of ['app', 'editor']) {
                assert.ok(await page.locator(`[data-background-card="${key}"] [data-tcf-bg-url]`).isVisible(),
                    `${key} source URL should remain visible while effects are collapsed`);
                assert.ok(await page.locator(`[data-background-card="${key}"] [data-tcf-action="choose-background"]`).isVisible(),
                    `${key} file button should remain visible while effects are collapsed`);
            }

            await page.locator('[data-background-card="app"] details.tcf-background-details > summary').press('Enter');
            assert.equal(await page.locator('[data-background-card="app"] details.tcf-background-details')
                .evaluate(details => details.open), true);
            assert.ok(await page.locator('[data-background-card="app"] [data-tcf-range][data-key="bgOpacity"]').isVisible());
            await page.locator('[data-background-card="editor"] details.tcf-background-details > summary').click();
            assert.equal(await page.locator('[data-background-card="editor"] details.tcf-background-details')
                .evaluate(details => details.open), true);
            assert.ok(await page.locator('[data-background-card="editor"] [data-tcf-range][data-key="editorBgOpacity"]').isVisible());

            const previewSample = page.locator('.welcome-box-sample');
            assert.equal(await previewSample.isVisible(), false);
            await page.locator('[data-background-card="shared"] details.tcf-background-details > summary').click();
            assert.equal(await page.locator('[data-background-card="shared"] details.tcf-background-details')
                .evaluate(details => details.open), true);
            assert.equal(await previewSample.isVisible(), false);
            await page.locator('[data-tcf-range][data-key="welcomeBoxOpacity"]').focus();
            assert.equal(await previewSample.isVisible(), true);
            await page.locator('[data-tcf-range][data-key="terminalOpacity"]').focus();
            assert.equal(await previewSample.isVisible(), false);
        });
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
        await check('Accent text and primary button text preview independently', async () => {
            await page.locator('.accent-text-sample').click();
            const result = await page.evaluate(() => {
                const root = document.documentElement.style;
                const preview = document.querySelector('.tcf-preview-host').shadowRoot;
                const sample = preview.querySelector('.accent-text-sample');
                const primary = preview.querySelector('.run-split');
                const live = () => ['--button-text-on-accent', '--btn-primary-text'].map(token => root.getPropertyValue(token));
                const before = live();
                const focused = document.activeElement?.dataset.key;
                const initialPrimary = getComputedStyle(primary).color;
                ThemeCustomizer.setToken('buttonTextOnAccent', '#abcdef');
                const accentOnly = getComputedStyle(primary).color;
                ThemeCustomizer.setToken('btnPrimaryText', '#fedcba');
                return { before, after: live(), focused, initialPrimary, accentOnly,
                    accent: getComputedStyle(sample).color, primary: getComputedStyle(primary).color };
            });
            assert.equal(result.focused, 'buttonTextOnAccent');
            assert.equal(result.accentOnly, result.initialPrimary);
            assert.equal(result.accent, 'rgb(171, 205, 239)');
            assert.equal(result.primary, 'rgb(254, 220, 186)');
            assert.deepEqual(result.after, result.before);
        });
        await check('Continuous brightness edit updates preview before committing one reversible change', async () => {
            await page.locator('[data-tcf-panel="backgrounds"]').click();
            const result = await page.evaluate(() => {
                const t = ThemeCustomizer, before = t.workingTheme.colors.bgBrightness, history = t.historyStack.length;
                const slider = document.querySelector('[data-tcf-range][data-key="bgBrightness"]');
                const preview = document.querySelector('.tcf-preview-host').shadowRoot.querySelector('.app-container');
                const jsonBefore = t.view.getJsonText();
                const render = t.view.render;
                let renders = 0;
                t.view.render = (...args) => { renders++; return render(...args); };
                let live;
                try {
                    for (const value of [130, 150]) {
                        slider.value = String(value);
                        slider.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    live = { value: preview.style.getPropertyValue('--app-bg-brightness'), renders,
                        jsonUnchanged: t.view.getJsonText() === jsonBefore, historyUnchanged: t.historyStack.length === history };
                    slider.dispatchEvent(new Event('change', { bubbles: true }));
                } finally {
                    t.view.render = render;
                }
                const count = t.historyStack.length - history;
                const persistedValue = JSON.parse(t.view.getJsonText()).colors.bgBrightness;
                t.undo(); const undo = t.workingTheme.colors.bgBrightness;
                t.redo(); return { before, count, undo, redo: t.workingTheme.colors.bgBrightness, live, persistedValue };
            });
            assert.deepEqual(result.live, { value: '1.5', renders: 0, jsonUnchanged: true, historyUnchanged: true });
            assert.equal(result.count, 1);
            assert.equal(result.undo, result.before);
            assert.equal(result.redo, 150);
            assert.equal(result.persistedValue, 150);
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
            assert.ok(result.source.includes('kawaii-dark.webm'));
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
            await page.evaluate(async () => {
                const t = ThemeCustomizer;
                const confirm = t._confirm; t._confirm = async () => true;
                await t.reset(); t._confirm = confirm;
                await t.close(true); await t.open('kawaii-light');
                // Let any teardown still queued from the reset run before judging.
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            await page.waitForFunction(() => !ThemeCustomizer.busy && ThemeCustomizer.popup?.isConnected,
                null, { timeout: 5000 }).catch(() => { });
            const result = await page.evaluate(() => ({ popup: !!ThemeCustomizer.popup,
                connected: ThemeCustomizer.popup?.isConnected, source: ThemeCustomizer.sourceThemeId }));
            assert.ok(result.popup && result.connected);
            assert.equal(result.source, 'kawaii-light');
        });
        await screenshot('customizer-light.png');
        await page.evaluate(() => ThemeCustomizer.close(true));
        await page.evaluate(() => ThemeCustomizer.open('monokai'));
        await check('Uploaded background exports as portable data and saves with chosen editor scheme', async () => {
            const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
            await page.locator('[data-tcf-panel="backgrounds"]').click();
            const [chooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 10000 }),
                page.locator('[data-background-card="app"] [data-tcf-action="choose-background"]').click()
            ]);
            await chooser.setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: bytes });
            await page.waitForFunction(() => /^file:|^data:image\//.test(ThemeCustomizer.workingTheme?.colors?.appBackground || ''),
                null, { timeout: 5000 });
            const result = await page.evaluate(async () => {
                const t = ThemeCustomizer;
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
        await screenshot('customizer-dark.png');
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
        await check('App and editor videos preview and save independently', async () => {
            await page.evaluate(async () => {
                if (!App.tabs.length) newFile();
                await ThemeCustomizer.open('sakura');
                const t = ThemeCustomizer;
                t.setToken('editorBackground', ThemeManager._getHardcodedThemes()['kawaii-dark'].colors.appBackground);
                t.setToken('bgOpacity', 37);
                t.setToken('bgBrightness', 72);
                t.setToken('bgBlur', 7);
                t.setToken('bgPosition', 'left top');
                t.setToken('editorBgOpacity', 28);
                t.setToken('editorBgBrightness', 126);
                t.setToken('editorBgBlur', 11);
                t.setToken('editorBgPosition', 'right bottom');
            });
            await page.waitForFunction(() => {
                const videos = document.querySelector('.tcf-preview-host').shadowRoot.querySelectorAll('.tcf-preview-video');
                return videos.length === 2 && Array.from(videos).every(video => video.readyState >= 2);
            }, null, { timeout: 5000 });
            const result = await page.evaluate(async () => {
                const shadow = document.querySelector('.tcf-preview-host').shadowRoot;
                const read = (video, layer = video) => {
                    const style = getComputedStyle(layer);
                    return { src: video.src, opacity: style.opacity, filter: style.filter,
                        position: getComputedStyle(video).objectPosition };
                };
                const appVideo = shadow.querySelector('.tcf-app-background video');
                const editorVideo = shadow.querySelector('.editor-bg-layer video');
                const preview = [read(appVideo, appVideo.parentElement), read(editorVideo, editorVideo.parentElement)];
                const overlay = getComputedStyle(shadow.querySelector('.tcf-app-overlay')).backgroundColor;
                const saved = await ThemeCustomizer.save({ backgroundOnly: true });
                const area = document.getElementById('editor-area');
                const liveEditor = area.querySelector('video');
                return { saved, preview, live: [read(document.getElementById('app-bg-video')), read(liveEditor)],
                    overlay, liveOverlay: getComputedStyle(document.querySelector('.app-container')).backgroundColor,
                    editorWidth: liveEditor.getBoundingClientRect().width, areaWidth: area.getBoundingClientRect().width,
                    still: getComputedStyle(area, '::before').backgroundImage };
            });
            assert.ok(result.saved);
            assert.deepEqual(result.preview, result.live);
            assert.notEqual(result.live[0].src, result.live[1].src);
            assert.deepEqual(result.live.map(({ opacity, filter, position }) => [opacity, filter, position]), [
                ['0.37', 'blur(7px) brightness(0.72)', '0% 0%'],
                ['0.28', 'blur(11px) brightness(1.26)', '100% 100%'],
            ]);
            assert.equal(result.liveOverlay, result.overlay);
            assert.ok(result.areaWidth > 0 && result.editorWidth >= result.areaWidth + 20);
            assert.equal(result.still, 'none');
        });
        await check('Background sliders fade the intended layers and keep Shared values on save', async () => {
            await page.evaluate(() => {
                const t = ThemeCustomizer;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                const pixel = canvas.getContext('2d');
                pixel.fillStyle = '#63d2ff';
                pixel.fillRect(0, 0, 1, 1);
                const image = canvas.toDataURL();
                t.setToken('appBackground', image);
                t.setToken('editorBackground', image);
                t.setToken('terminalBgBlur', 13);
            });
            await page.locator('[data-tcf-panel="backgrounds"]').click();
            const sliderValues = {
                bgOpacity: 0, editorBgOpacity: 0, panelOpacity: 0, terminalOpacity: 52, welcomeBoxOpacity: 0,
            };
            const sliderCards = { bgOpacity: 'app', editorBgOpacity: 'editor', panelOpacity: 'shared',
                terminalOpacity: 'shared', welcomeBoxOpacity: 'shared' };
            for (const [key, value] of Object.entries(sliderValues)) {
                await page.locator(`[data-background-card="${sliderCards[key]}"] details.tcf-background-details`)
                    .evaluate(details => { details.open = true; });
                await page.locator(`[data-tcf-range][data-key="${key}"]`).fill(String(value));
            }
            const result = await page.evaluate(async () => {
                const t = ThemeCustomizer;
                const alpha = color => {
                    const pixel = document.createElement('canvas').getContext('2d');
                    pixel.fillStyle = color;
                    pixel.fillRect(0, 0, 1, 1);
                    return pixel.getImageData(0, 0, 1, 1).data[3];
                };
                const read = (root, welcome) => {
                    const panel = getComputedStyle(root.querySelector('.problems-panel'));
                    const terminal = getComputedStyle(root.querySelector('.terminal-body'));
                    return { panel: alpha(panel.backgroundColor), panelContent: panel.opacity,
                        terminal: terminal.opacity, blur: getComputedStyle(root.querySelector('.terminal-view')).backdropFilter,
                        welcome: alpha(getComputedStyle(root.querySelector(welcome)).backgroundColor) };
                };
                const shadow = document.querySelector('.tcf-preview-host').shadowRoot;
                const preview = read(shadow, '.welcome-box-sample');
                const editorPreview = getComputedStyle(shadow.querySelector('.editor-bg-layer')).opacity;
                const saved = await t.save({ backgroundOnly: true });
                await t.close(true);
                const area = document.getElementById('editor-area');
                const editor = getComputedStyle(area, '::before');
                const app = getComputedStyle(document.body, '::before');
                const actual = { shared: read(document, '.welcome-box'), editorOpacity: editor.opacity,
                    editorImage: editor.backgroundImage, duplicate: getComputedStyle(area).backgroundImage,
                    video: !!area.querySelector('video'), appImage: app.backgroundImage, appOpacity: app.opacity,
                    overlay: getComputedStyle(document.querySelector('.app-container')).backgroundColor };
                await t.open('sakura');
                const stored = ['panelOpacity', 'terminalOpacity', 'terminalBgBlur', 'welcomeBoxOpacity']
                    .map(key => t.workingTheme.colors[key]);
                t.setToken('welcomeBoxOpacity', 100);
                t.setToken('panelOpacity', 100);
                t.setToken('bgOpacity', 100);
                t.setToken('editorBgOpacity', 100);
                const maxSaved = await t.save({ backgroundOnly: true });
                const maximum = read(document, '.welcome-box');
                maximum.app = getComputedStyle(document.body, '::before').opacity;
                maximum.editor = getComputedStyle(area, '::before').opacity;
                await t.close(true);
                await t.open('kawaii-light');
                const next = document.querySelector('.tcf-preview-host').shadowRoot;
                const editorLayer = getComputedStyle(next.querySelector('.editor-bg-layer'));
                const clean = { image: editorLayer.backgroundImage, position: editorLayer.backgroundPosition,
                    blur: getComputedStyle(next.querySelector('.terminal-view')).backdropFilter };
                await t.close(true);
                return { saved, maxSaved, preview, editorPreview, actual, stored, maximum, clean };
            });
            assert.ok(result.saved && result.maxSaved);
            assert.deepEqual(result.preview, { panel: 0, panelContent: '1', terminal: '0.52', blur: 'blur(13px)', welcome: 0 });
            assert.deepEqual(result.actual.shared, result.preview);
            assert.equal(result.editorPreview, '0');
            assert.equal(result.actual.editorOpacity, '0');
            assert.notEqual(result.actual.editorImage, 'none');
            assert.equal(result.actual.duplicate, 'none');
            assert.equal(result.actual.video, false);
            assert.notEqual(result.actual.appImage, 'none');
            assert.equal(result.actual.appOpacity, '0');
            assert.equal(result.actual.overlay, 'rgba(0, 0, 0, 0)');
            assert.deepEqual(result.stored, [0, 52, 13, 0]);
            assert.equal(result.maximum.welcome, 255);
            assert.ok(result.maximum.panel > 0);
            assert.equal(result.maximum.app, '1');
            assert.equal(result.maximum.editor, '1');
            assert.deepEqual(result.clean, { image: 'none', position: '50% 50%', blur: 'none' });
        });
        assert.deepEqual(errors, [], 'Unexpected renderer errors');
        console.log(`${passed} theme GUI checks passed.`);
    } finally {
        if (application) { try { await application.close(); } catch (_) { } }
    }
}

main().catch(error => { console.log('FAIL ' + error.stack); process.exitCode = 1; }).finally(() => {
    if (process.exitCode || process.env.KEEP_PROFILE) console.log('Profile kept: ' + profile);
    else fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
