'use strict';

/*
 * Focused, dependency-free checks for the ThemeManager persistence contract.
 * Run with: node scripts/test-theme-manager.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'ui', 'theme-manager.js'), 'utf8');
const tokenSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'ui', 'theme-tokens.js'), 'utf8');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createHarness(options = {}) {
    const local = new Map(Object.entries(options.localStorage || {}));
    const state = options.state || new Map();
    const writes = [];
    const assetResolvers = [];
    const document = {
        documentElement: {
            setAttribute() { },
            style: { setProperty() { }, removeProperty() { } }
        },
        getElementById() { return null; }
    };
    const api = {
        async stateRead(name) {
            if (options.readError) throw new Error(options.readError);
            return state.has(name) ? clone(state.get(name)) : null;
        },
        async stateWrite(name, data) {
            if (options.writeError) return { success: false, error: options.writeError };
            writes.push({ name, data: clone(data) });
            state.set(name, clone(data));
            return { success: true };
        },
        async saveThemeAsset(dataUrl) {
            if (options.assetError) return { success: false, error: options.assetError };
            if (options.delayAssets) {
                return new Promise((resolve) => assetResolvers.push(() => resolve({
                    success: true,
                    url: `file:///asset-${assetResolvers.length}.png`
                })));
            }
            return { success: true, url: `file:///asset-${Buffer.byteLength(dataUrl)}.png` };
        }
    };
    const window = { electronAPI: api };
    const context = {
        window,
        document,
        localStorage: {
            getItem(key) { return local.has(key) ? local.get(key) : null; },
            setItem(key, value) { local.set(key, String(value)); },
            removeItem(key) { local.delete(key); }
        },
        console,
        Promise,
        Map,
        Object,
        Array,
        JSON,
        Error,
        Number,
        String,
        Uint8Array,
        btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
        fetch: options.fetch,
        setTimeout,
        clearTimeout
    };
    if (options.useTokens) vm.runInNewContext(tokenSource, context, { filename: 'theme-tokens.js' });
    vm.runInNewContext(source, context, { filename: 'theme-manager.js' });
    return {
        manager: context.window.ThemeManager,
        state,
        writes,
        local,
        releaseAssets() { assetResolvers.splice(0).forEach(resolve => resolve()); }
    };
}

async function testSerializedImmutableSaves() {
    const harness = createHarness({ delayAssets: true });
    const manager = harness.manager;
    manager.themes = new Map([
        ['custom', manager._normalizeTheme({
            id: 'custom', name: 'Custom', colors: { appBackground: 'data:image/png;base64,AAAA' }
        })]
    ]);

    const first = manager._saveUserThemes();
    manager.themes.delete('custom');
    const second = manager._saveUserThemes();
    await new Promise(resolve => setImmediate(resolve));
    harness.releaseAssets();
    await first;
    await second;

    const final = harness.state.get('themes');
    assert.deepStrictEqual(final.themes, [], 'the latest delete must win');
    assert.strictEqual(manager.themes.size, 0, 'asset externalization must not mutate the registry snapshot');
    assert.strictEqual(harness.writes.length, 2, 'both saves should complete in order');
}

async function testLegacyMigrationAndBackgroundReset() {
    const harness = createHarness({
        localStorage: {
            'sameko-user-themes': JSON.stringify([{ id: 'legacy', name: 'Legacy', colors: {} }]),
            'theme-bg-kawaii-dark': JSON.stringify({ appBackground: '' })
        }
    });
    const manager = harness.manager;
    await manager.init();

    assert.ok(manager.themes.has('legacy'), 'legacy custom themes should migrate');
    assert.deepStrictEqual(manager.getBackgroundOverrides('kawaii-dark'), { appBackground: '' });
    assert.ok(harness.state.has('themes'), 'migration should use the state store');
    assert.ok(!harness.local.has('sameko-user-themes'), 'legacy theme key is removed after migration');
    assert.ok(!harness.local.has('theme-bg-kawaii-dark'), 'legacy background key is removed after migration');

    manager.setTheme('kawaii-dark');
    assert.strictEqual(manager.themes.get('kawaii-dark').colors.appBackground, '', 'explicit empty background disables the builtin');
    await manager.resetBackgroundOverrides('kawaii-dark');
    manager.setTheme('kawaii-dark');
    assert.strictEqual(manager.themes.get('kawaii-dark').colors.appBackground, 'assets/backgrounds/darkblue.webm', 'reset restores builtin baseline');
}

async function testLegacyStateShapeUpgrade() {
    const state = new Map([['themes', [{ id: 'old-shape', name: 'Old shape', colors: {} }]]]);
    const harness = createHarness({ state });
    await harness.manager.init();
    const document = state.get('themes');
    assert.strictEqual(document.version, 1);
    assert.ok(Array.isArray(document.themes));
    assert.ok(document.backgrounds && typeof document.backgrounds === 'object');
}

async function testMigrationKeepsLegacyOnWriteFailure() {
    const legacy = JSON.stringify([{ id: 'legacy', name: 'Legacy', colors: {} }]);
    const harness = createHarness({ localStorage: { 'sameko-user-themes': legacy }, writeError: 'disk full' });
    await harness.manager.init();
    assert.strictEqual(harness.local.get('sameko-user-themes'), legacy, 'failed migration must retain the legacy source');
}

async function testCanonicalImportAndBuiltinGuard() {
    const harness = createHarness({ useTokens: true });
    const manager = harness.manager;
    manager._loadAllHardcodedThemes();

    const builtin = manager.importTheme(JSON.stringify({ id: 'kawaii-dark', name: 'Injected', colors: {} }));
    assert.strictEqual(builtin.success, false, 'top-level builtin IDs must be protected');

    const invalid = manager.importTheme(JSON.stringify({ id: 'invalid', name: 'Invalid', colors: { appBackground: 42 } }));
    assert.strictEqual(invalid.success, false, 'typed token validation must reject invalid image values');

    const imported = manager.importTheme(JSON.stringify({
        id: 'portable', name: 'Portable', colors: {}, editor: {}, terminal: {}
    }));
    assert.strictEqual(imported.success, true);
    assert.strictEqual(imported.themeId, 'portable');
    await imported.persistence;
    assert.strictEqual(manager.themes.get('portable').name, 'Portable');
}

async function testBackgroundQueueMergesWithThemeSave() {
    const harness = createHarness();
    const manager = harness.manager;
    manager.registerTheme({ id: 'custom', name: 'Custom', colors: {} });
    const backgroundSave = manager.saveBackgroundOverrides('kawaii-dark', { appBackground: '' });
    manager.registerTheme({ id: 'second', name: 'Second', colors: {} });
    const themeSave = manager._saveUserThemes();
    await Promise.all([backgroundSave, themeSave]);
    const final = harness.state.get('themes');
    assert.deepStrictEqual(final.backgrounds['kawaii-dark'], { appBackground: '' });
    assert.deepStrictEqual(final.themes.map(theme => theme.id), ['custom', 'second']);
}

async function testAssetMigrationSharesBackgroundQueue() {
    const harness = createHarness({
        delayAssets: true,
        localStorage: {
            'theme-bg-kawaii-dark': JSON.stringify({ appBackground: 'data:image/png;base64,AAAA' })
        }
    });
    const manager = harness.manager;
    manager._loadAllHardcodedThemes();

    // The migration pauses while the legacy asset is externalized.  A normal
    // background save can complete first; migration must merge it, not write
    // its pre-delay background snapshot over it.
    const migration = manager.migrateStoredAssets();
    await new Promise(resolve => setImmediate(resolve));
    const backgroundSave = manager.saveBackgroundOverrides('nord', { appBackground: 'user-background' });
    const sameIdSave = manager.saveBackgroundOverrides('kawaii-dark', { appBackground: 'newer-background' });
    harness.releaseAssets();

    await Promise.all([migration, backgroundSave, sameIdSave]);
    const final = harness.state.get('themes');
    assert.deepStrictEqual(final.backgrounds.nord, { appBackground: 'user-background' },
        'migration must preserve a background save that completed while asset conversion was pending');
    assert.strictEqual(final.backgrounds['kawaii-dark'].appBackground, 'newer-background',
        'a newer same-key save must win over the delayed legacy migration');

    const migratedOnlyHarness = createHarness({
        delayAssets: true,
        localStorage: {
            'theme-bg-kawaii-dark': JSON.stringify({ appBackground: 'data:image/png;base64,AAAA' })
        }
    });
    migratedOnlyHarness.manager._loadAllHardcodedThemes();
    const migratedOnly = migratedOnlyHarness.manager.migrateStoredAssets();
    await new Promise(resolve => setImmediate(resolve));
    migratedOnlyHarness.releaseAssets();
    await migratedOnly;
    assert.strictEqual(migratedOnlyHarness.state.get('themes').backgrounds['kawaii-dark'].appBackground,
        'file:///asset-0.png', 'legacy assets should still be persisted when no newer save supersedes them');
}

async function testSaveFailurePropagates() {
    const harness = createHarness({ writeError: 'disk full' });
    const manager = harness.manager;
    manager.registerTheme({ id: 'custom', name: 'Custom', colors: {} });
    await assert.rejects(manager._saveUserThemes(), /disk full/);

    manager.activeThemeId = 'custom';
    await assert.rejects(manager.deleteTheme('custom'), /disk full/);
    assert.ok(manager.themes.has('custom'), 'failed deletion should roll back the registry');

    const imported = manager.importTheme(JSON.stringify({ id: 'new-theme', name: 'New theme', colors: {} }));
    await assert.rejects(imported.persistence, /disk full/);
    assert.ok(!manager.themes.has('new-theme'), 'failed import should roll back the registry');
}

async function testPortableExport() {
    const harness = createHarness({
        fetch: async () => ({
            ok: true,
            headers: { get() { return 'image/png'; } },
            async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; }
        })
    });
    const manager = harness.manager;
    manager.registerTheme({ id: 'portable', name: 'Portable', colors: { appBackground: 'file:///asset.png' } });
    const json = await manager.exportThemePortable('portable');
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.colors.appBackground, 'data:image/png;base64,AQID');
}

(async () => {
    await testSerializedImmutableSaves();
    await testLegacyMigrationAndBackgroundReset();
    await testLegacyStateShapeUpgrade();
    await testMigrationKeepsLegacyOnWriteFailure();
    await testCanonicalImportAndBuiltinGuard();
    await testBackgroundQueueMergesWithThemeSave();
    await testAssetMigrationSharesBackgroundQueue();
    await testSaveFailurePropagates();
    await testPortableExport();
    console.log('theme-manager tests passed');
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
