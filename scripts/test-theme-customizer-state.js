'use strict';

/*
 * Focused controller checks. These run without Electron or a DOM and exercise
 * the draft/persistence boundaries that are easy to miss in a GUI smoke test.
 * The assertions describe the intended contract; failures identify controller
 * regressions that still need a UI-side fix.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const tokenSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'ui', 'theme-tokens.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'ui', 'theme-customizer.js'), 'utf8');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createHarness(options = {}) {
    const calls = { registered: [], saved: 0, backgroundSaves: [], applied: [], monaco: [], notifications: [] };
    const baseTheme = {
        id: 'custom',
        name: 'Original',
        type: 'dark',
        colors: {
            appBackground: 'assets/backgrounds/original.jpg',
            editorBackground: 'none',
            accent: '#112233',
            bgBrightness: 100,
            editorBgBrightness: 100
        },
        editor: { base: 'vs-dark', syntax: { keyword: { color: 'ff0000' } } },
        terminal: {}
    };
    const builtin = {
        id: 'kawaii-dark',
        name: 'Kawaii Dark',
        type: 'dark',
        colors: { appBackground: 'assets/backgrounds/darkblue.webm', accent: '#88c9ea' },
        editor: { base: 'vs-dark', syntax: { keyword: { color: '88c9ea' } } },
        terminal: {}
    };
    const themes = new Map([
        ['custom', clone(baseTheme)],
        ['kawaii-dark', clone(builtin)]
    ]);
    const manager = {
        themes,
        builtinThemeIds: ['kawaii-dark'],
        ASSET_KEYS: ['appBackground', 'editorBackground'],
        externalizeAssets: async colors => colors,
        registerTheme(theme) {
            this.themes.set(theme.id, clone(theme));
            calls.registered.push(theme.id);
            return true;
        },
        async _saveUserThemes() {
            calls.saved++;
            if (options.themeSaveError) throw new Error(options.themeSaveError);
            return { success: true };
        },
        async saveBackgroundOverrides(id, colors) {
            if (options.backgroundSaveError) throw new Error(options.backgroundSaveError);
            calls.backgroundSaves.push({ id, colors: clone(colors) });
            this.backgroundOverrides = this.backgroundOverrides || {};
            this.backgroundOverrides[id] = clone(colors);
            return { success: true };
        },
        resetBackgroundOverrides(id) {
            if (this.backgroundOverrides) delete this.backgroundOverrides[id];
            return Promise.resolve({ success: true });
        },
        getBackgroundOverrides(id) {
            return clone(this.backgroundOverrides?.[id]);
        },
        _defineMonacoTheme(theme) { calls.monaco.push(theme.id); },
        _getHardcodedThemes() { return { 'kawaii-dark': clone(builtin) }; },
        getThemeList() { return Array.from(this.themes.values()); },
        async deleteTheme(id) { this.themes.delete(id); return { success: true }; }
    };
    const app = {
        settings: {
            appearance: { theme: 'custom', bgUrl: '', perTheme: {} },
            editor: { colorScheme: 'auto' }
        },
        editors: {}
    };
    let jsonText = '';
    const view = {
        element: { addEventListener() { }, removeEventListener() { }, remove() { } },
        render() { },
        renderPreview() { },
        setJsonText(text) { jsonText = String(text); },
        getJsonText() { return jsonText; },
        focus() { },
        destroy() { },
        notify() { }
    };
    const window = {
        dispatchEvent() { },
        showConfirmDialog: async () => true
    };
    function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; }
    const context = {
        console,
        window,
        ThemeManager: manager,
        App: app,
        ThemeCustomizerView: { create() { return view; } },
        CustomEvent,
        saveSettings: async () => options.settingsResult || { success: true },
        applyTheme: id => calls.applied.push(id),
        document: { activeElement: null, body: { classList: { add() { }, remove() { } } } },
        Promise,
        Map,
        Object,
        Array,
        JSON,
        Error,
        String,
        Number,
        Date,
        RegExp,
        console
    };
    vm.runInNewContext(tokenSource, context, { filename: 'theme-tokens.js' });
    context.ThemeTokens = context.window.ThemeTokens;
    vm.runInNewContext(controllerSource, context, { filename: 'theme-customizer.js' });
    const controller = context.window.ThemeCustomizer;
    controller._refreshMarketplace = () => { };
    controller.notify = (message, type) => calls.notifications.push({ message, type });

    function begin(themeId = 'custom') {
        controller.sourceThemeId = themeId;
        controller.workingTheme = controller._draft(manager.themes.get(themeId));
        controller._baseline = controller._clone(controller.workingTheme);
        controller.historyStack = [controller._clone(controller.workingTheme)];
        controller.historyIndex = 0;
        controller.activePanel = 'colors';
        controller.busy = false;
        controller.dirty = false;
        controller.view = view;
        controller.popup = view.element;
        jsonText = JSON.stringify(controller._prepareThemeForJsonEdit());
    }

    return { controller, manager, app, calls, view, begin };
}

async function testClearBackgroundUsesAcceptedSentinel() {
    const harness = createHarness();
    harness.begin();
    const changed = harness.controller.clearBackground('appBackground');
    assert.strictEqual(changed, true, 'Clear must update the draft');
    assert(['', 'none'].includes(harness.controller.workingTheme.colors.appBackground),
        'Clear must use the explicit disabled-background sentinel');
}

async function testJsonEditsDoNotClobberLaterHeaderEdit() {
    const harness = createHarness();
    harness.begin();
    harness.controller.activePanel = 'advanced';
    // Keep the JSON textarea at the old draft while the header changes.
    harness.view.setJsonText(JSON.stringify(harness.controller._prepareThemeForJsonEdit()));
    harness.controller.setName('Header Name');
    const saved = await harness.controller.save();
    assert.strictEqual(saved, true, 'save should succeed');
    assert.strictEqual(harness.manager.themes.get('custom').name, 'Header Name',
        'a later header edit must not be overwritten by stale JSON');
}

async function testSaveSettingsFailureRollsBackThemeAndSettings() {
    const harness = createHarness({ settingsResult: { success: false, error: 'settings write failed' } });
    harness.begin();
    harness.controller.setName('Saved Copy');
    const saved = await harness.controller.save({ asNew: true });
    assert.strictEqual(saved, false, 'save should report settings failure');
    assert.strictEqual(harness.manager.themes.has('saved-copy'), false,
        'failed settings persistence must roll back the newly registered theme');
    assert.strictEqual(harness.app.settings.appearance.theme, 'custom',
        'failed settings persistence must restore the active theme setting');
}

async function testBackgroundSaveSettingsFailureRollsBackOverride() {
    const harness = createHarness({ settingsResult: { success: false, error: 'settings write failed' } });
    harness.begin('kawaii-dark');
    harness.controller.setToken('bgOpacity', 70);
    const saved = await harness.controller.save({ backgroundOnly: true });
    assert.strictEqual(saved, false, 'background save should report settings failure');
    assert.strictEqual(Boolean(harness.manager.backgroundOverrides?.['kawaii-dark']), false,
        'failed settings persistence must roll back the background override');
    assert.strictEqual(harness.app.settings.appearance.theme, 'custom',
        'failed background save must restore the active theme setting');
}

async function testBrightnessRangeMatchesVisibleControl() {
    const harness = createHarness();
    harness.begin();
    assert.strictEqual(harness.controller.setToken('bgBrightness', 150), true,
        'the visible brightness slider allows values through 200');
}

async function testInvalidJsonDoesNotReplaceDraft() {
    const harness = createHarness();
    harness.begin();
    harness.controller.activePanel = 'advanced';
    const before = harness.controller._clone(harness.controller.workingTheme);
    harness.view.setJsonText('{ invalid json');
    assert.strictEqual(harness.controller.applyJson(), false,
        'invalid JSON must be rejected');
    assert.deepStrictEqual(harness.controller.workingTheme, before,
        'invalid JSON must not replace the current draft');
}

async function testBaseCopyKeepsSourceIdentity() {
    const harness = createHarness();
    harness.begin('custom');
    harness.controller.setBaseTheme('kawaii-dark');
    assert.strictEqual(harness.controller.sourceThemeId, 'custom',
        'changing the base must keep the source theme identity');
    assert.strictEqual(harness.controller.workingTheme.id, 'custom',
        'a base change must keep the draft id');
    assert.strictEqual(harness.controller.workingTheme.name, 'Original',
        'a base change must keep the draft name');
    assert.strictEqual(harness.controller.baseThemeId, 'kawaii-dark',
        'the selected base theme should be tracked separately');
}

async function testUndoRedoKeepsDraftOnly() {
    const harness = createHarness();
    harness.begin();
    const before = harness.controller.workingTheme.colors.accent;
    harness.controller.setToken('accent', '#abcdef');
    assert.strictEqual(harness.manager.themes.get('custom').colors.accent, '#112233',
        'editing the draft must not mutate the registry');
    harness.controller.undo();
    assert.strictEqual(harness.controller.workingTheme.colors.accent, before);
    harness.controller.redo();
    assert.strictEqual(harness.controller.workingTheme.colors.accent, '#abcdef');
}

async function testDraftDoesNotTouchGlobalMonaco() {
    const harness = createHarness();
    harness.begin();
    harness.controller.setToken('accent', '#abcdef');
    assert.deepStrictEqual(harness.calls.monaco, [],
        'draft edits must not define or activate a global Monaco theme');
}

(async () => {
    const tests = [
        ['clear background uses accepted sentinel', testClearBackgroundUsesAcceptedSentinel],
        ['JSON edits do not clobber later header edit', testJsonEditsDoNotClobberLaterHeaderEdit],
        ['settings failure rolls back theme and settings', testSaveSettingsFailureRollsBackThemeAndSettings],
        ['background settings failure rolls back override', testBackgroundSaveSettingsFailureRollsBackOverride],
        ['brightness range matches visible control', testBrightnessRangeMatchesVisibleControl],
        ['invalid JSON does not replace draft', testInvalidJsonDoesNotReplaceDraft],
        ['base copy keeps source identity', testBaseCopyKeepsSourceIdentity],
        ['undo/redo keeps draft only', testUndoRedoKeepsDraftOnly],
        ['draft does not touch global Monaco', testDraftDoesNotTouchGlobalMonaco]
    ];
    const failures = [];
    for (const [name, test] of tests) {
        try {
            await test();
            console.log(`PASS ${name}`);
        } catch (error) {
            failures.push({ name, error });
            console.error(`FAIL ${name}: ${error.message}`);
        }
    }
    if (failures.length) {
        console.error(`${failures.length} theme customizer state test(s) failed`);
        process.exitCode = 1;
    } else {
        console.log('theme customizer state tests passed');
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
