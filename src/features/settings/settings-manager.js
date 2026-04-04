/**
 * Sameko Dev C++ IDE - Settings Manager
 * Settings load, save, and UI management
 * 
 * @module src/features/settings/settings-manager
 */

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

const DEFAULT_SETTINGS = {
    editor: {
        fontSize: 14,
        fontFamily: "Consolas, monospace",
        tabSize: 4,
        minimap: true,
        wordWrap: false,
        colorScheme: 'auto',
        autoSave: true,
        autoSaveDelay: 2000,
        liveCheck: true,
        liveCheckDelay: 500,
        autoFormat: false,
        formatStyle: 'google'
    },
    build: {
        compilerFlags: '-std=c++17',
        warnings: true,
        showConsole: true,
        useExternalTerminal: false
    },
    appearance: {
        theme: 'monokai'
    },
    startup: {
        behavior: 'restore-previous-session'
    },
    history: {
        enabled: true,
        maxVersions: 20,
        maxAgeDays: 7,
        maxFileSizeKB: 1024
    },
    template: {
        code: `#include<bits/stdc++.h>
using namespace std;

int main() {
    cout << "hello gaialime";
    return 0;
}`
    },
    keybindings: {
        compile: 'F9',
        buildRun: 'F11',
        run: 'F10',
        stop: 'Shift+F5',
        save: 'Ctrl+S',
        newFile: 'Ctrl+N',
        openFile: 'Ctrl+O',
        closeTab: 'Ctrl+W',
        toggleProblems: 'Ctrl+J',
        settings: 'Ctrl+,',
        toggleSplit: 'Ctrl+\\',
        formatCode: 'Ctrl+Shift+A'
    }
};

// ============================================================================
// SETTINGS STATE
// ============================================================================

let currentSettings = null;

// ============================================================================
// SETTINGS FUNCTIONS
// ============================================================================

/**
 * Load settings from storage
 * @returns {Object}
 */
function loadSettings() {
    try {
        const saved = window.electronAPI?.loadSettings?.();
        if (saved) {
            currentSettings = mergeDeep(structuredClone(DEFAULT_SETTINGS), saved);
        } else {
            currentSettings = structuredClone(DEFAULT_SETTINGS);
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
        currentSettings = structuredClone(DEFAULT_SETTINGS);
    }
    return currentSettings;
}

/**
 * Save settings to storage
 * @param {Object} settings
 */
async function saveSettings(settings = currentSettings) {
    try {
        await window.electronAPI?.saveSettings?.(settings);
        currentSettings = settings;
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

/**
 * Get current settings
 * @returns {Object}
 */
function getSettings() {
    if (!currentSettings) {
        loadSettings();
    }
    return currentSettings;
}

/**
 * Update specific setting
 * @param {string} path - Dot notation path (e.g., 'editor.fontSize')
 * @param {*} value
 */
function updateSetting(path, value) {
    const keys = path.split('.');
    let obj = currentSettings;
    for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    saveSettings();
}

/**
 * Reset settings to defaults
 */
function resetSettings() {
    currentSettings = structuredClone(DEFAULT_SETTINGS);
    saveSettings();
}

/**
 * Deep merge objects
 */
function mergeDeep(target, source) {
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key]) target[key] = {};
            mergeDeep(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DEFAULT_SETTINGS,
        loadSettings,
        saveSettings,
        getSettings,
        updateSetting,
        resetSettings
    };
}

if (typeof window !== 'undefined') {
    window.SettingsManager = {
        DEFAULT_SETTINGS,
        loadSettings,
        saveSettings,
        getSettings,
        updateSetting,
        resetSettings
    };
}
