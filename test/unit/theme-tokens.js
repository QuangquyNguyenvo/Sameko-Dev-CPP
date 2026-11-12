'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'src', 'renderer', 'ui', 'theme-tokens.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = { console, window: {} };
vm.runInNewContext(source, sandbox, { filename: sourcePath });

const ThemeTokens = sandbox.window.ThemeTokens;
assert(ThemeTokens, 'ThemeTokens should be exposed by the renderer script');

const themeManagerPath = path.join(__dirname, '..', 'src', 'renderer', 'ui', 'theme-manager.js');
const themeManagerSource = fs.readFileSync(themeManagerPath, 'utf8');
vm.runInNewContext(themeManagerSource, sandbox, { filename: themeManagerPath });
const ThemeManager = sandbox.window.ThemeManager;
assert(ThemeManager, 'ThemeManager should be exposed by the renderer script');

const baseTheme = (colors = {}) => ({
    id: 'contract-test',
    name: 'Contract Test',
    colors,
    editor: { syntax: {} },
    terminal: {}
});

const assertValid = (theme, message) => {
    const result = ThemeTokens.validateTheme(theme);
    assert.strictEqual(result.valid, true, `${message || 'theme'}: ${result.errors.join('; ')}`);
};

const assertInvalid = (theme, expectedPath) => {
    const result = ThemeTokens.validateTheme(theme);
    assert.strictEqual(result.valid, false, `expected invalid theme: ${expectedPath}`);
    assert(result.errors.some(error => error.startsWith(expectedPath)),
        `${expectedPath} was not reported: ${result.errors.join('; ')}`);
};

// Defaults use explicit references, so literal CSS colors are preserved.
const defaults = ThemeTokens.fillDefaults({});
assert.strictEqual(defaults.buttonTextOnAccent, '#ffffff');
assert.strictEqual(defaults.borderGlassEdge, 'rgba(255, 255, 255, 0.4)');
assert.strictEqual(defaults.bgOpacity, 50);
assert.strictEqual(defaults.editorBgOpacity, 15);
assert.strictEqual(defaults.terminalOpacity, 100);
assert.strictEqual(defaults.panelOpacity, 100);
assert.strictEqual(defaults.welcomeBoxOpacity, 40);

const inherited = ThemeTokens.fillDefaults({
    accent: '#123456',
    border: '#334455',
    bgOceanDark: '#101820'
});
assert.strictEqual(inherited.accentHover, '#123456');
assert.strictEqual(inherited.borderStrong, '#123456');
assert.strictEqual(inherited.bgGlassBorder, '#334455');
assert.strictEqual(inherited.bgBase, '#101820');

for (const [key, definition] of Object.entries(ThemeTokens.definitions)) {
    if (definition.type !== 'opacity') continue;
    assert(Number.isFinite(defaults[key]), `${key} should receive a numeric default`);
    assert(defaults[key] >= 0 && defaults[key] <= 100, `${key} should use 0..100 units`);
}

// Legacy metadata is normalized without mutating the source object.
const legacy = {
    meta: { id: 'legacy', name: 'Legacy', author: 'Test', type: 'dark' },
    colors: { bgOpacity: '25' },
    editor: { syntax: {} },
    terminal: {}
};
const normalized = ThemeTokens.normalizeTheme(legacy);
assert.strictEqual(normalized.id, 'legacy');
assert.strictEqual(normalized.name, 'Legacy');
assert.strictEqual(normalized.colors.bgOpacity, 25);
assert.strictEqual(legacy.colors.bgOpacity, '25');
assertValid(legacy, 'legacy theme');

const legacyWelcome = ThemeTokens.normalizeTheme(baseTheme({ welcomeBoxOpacity: 0.4 }));
assert.strictEqual(legacyWelcome.colors.welcomeBoxOpacity, 40);
const filledLegacyWelcome = ThemeTokens.fillDefaults({ welcomeBoxOpacity: 0.4 });
assert.strictEqual(filledLegacyWelcome.welcomeBoxOpacity, 40);

assertValid(baseTheme({
    accent: '#123456',
    bgGlass: 'rgba(18, 52, 86, 0.8)',
    appBackground: 'assets/backgrounds/background.jpg',
    editorBackground: 'none',
    bgOpacity: 50,
    editorBgOpacity: 15,
    bgBrightness: 100,
    bgBlur: 2,
    bgPosition: '50% 20%',
    shadowSoft: '0 0 4px rgba(0, 0, 0, 0.2)'
}), 'valid token theme');
assertValid(baseTheme({
    // An exact empty string is the persisted explicit-clear sentinel. Missing
    // keys remain distinct and allow the builtin background to be inherited.
    appBackground: '',
    editorBackground: '',
    bgBrightness: 150,
    editorBgBrightness: 200
}), 'explicitly cleared backgrounds and extended brightness');

assertValid(baseTheme({ accent: '#123456' }), 'theme with optional tokens omitted');
assertValid({ ...baseTheme({ accent: '#123456' }), author: '', version: '', description: '', type: 'light' },
    'theme with empty legacy metadata');
assertInvalid({ ...baseTheme({ accent: '#123456' }), type: 'custom' }, 'type');

assertInvalid(baseTheme({ accent: 'not-a-color' }), 'colors.accent');
assertInvalid(baseTheme({ bgOpacity: -1 }), 'colors.bgOpacity');
assertInvalid(baseTheme({ bgOpacity: 101 }), 'colors.bgOpacity');
assertInvalid(baseTheme({ bgOpacity: '40%' }), 'colors.bgOpacity');
assertInvalid(baseTheme({ bgBrightness: 201 }), 'colors.bgBrightness');
assertInvalid(baseTheme({ appBackground: 42 }), 'colors.appBackground');
assertInvalid(baseTheme({ bgBlur: -1 }), 'colors.bgBlur');
assertInvalid(baseTheme({ bgPosition: 'left; color: red' }), 'colors.bgPosition');
assertInvalid({ id: 'missing-colors', name: 'Missing Colors', editor: {}, terminal: {} }, 'colors');

assertInvalid({
    ...baseTheme(),
    editor: { syntax: { keyword: { color: 'rgba(1, 2, 3, 0.5)' } } }
}, 'editor.syntax.keyword.color');
assertInvalid({
    ...baseTheme(),
    editor: { syntax: { keyword: { color: 'ff00aa', fontStyle: '<script>' } } }
}, 'editor.syntax.keyword.fontStyle');
assertInvalid({
    ...baseTheme(),
    editor: { syntax: [] }
}, 'editor.syntax');

// Validate the exact normalized shape used by the registry, including the
// empty description that ThemeManager supplies for builtin themes.
for (const [id, theme] of Object.entries(ThemeManager._getHardcodedThemes())) {
    assertValid(ThemeManager._normalizeTheme(theme), `normalized builtin ${id}`);
}

// Renderer application keeps percentage values consistent with the validator.
const style = {
    values: new Map(),
    setProperty(name, value) { this.values.set(name, value); },
    removeProperty(name) { this.values.delete(name); }
};
ThemeTokens.applyValue({ style }, 'welcomeBoxOpacity', 40);
ThemeTokens.applyValue({ style }, 'bgOpacity', 50);
ThemeTokens.applyValue({ style }, 'bgBrightness', 150);
ThemeTokens.applyValue({ style }, 'appBackground', '');
assert.strictEqual(style.values.get('--welcome-box-opacity'), '0.4');
assert.strictEqual(style.values.get('--app-bg-opacity'), '0.5');
assert.strictEqual(style.values.get('--app-bg-brightness'), '1.5');
assert.strictEqual(style.values.get('--app-bg-image'), 'none');

console.log('theme token contract tests passed');
