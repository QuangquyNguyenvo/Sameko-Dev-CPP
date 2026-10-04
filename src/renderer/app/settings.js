/**
 * Sameko Dev C++ IDE - renderer: Settings load/save, the Settings dialog, keybinding editor, auto-save.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// SETTINGS
// ============================================================================
function loadSettings() {
    try {
        let saved = null;
        if (window.electronAPI?.loadSettings) {
            saved = window.electronAPI.loadSettings();
        } else {
            const storedStr = localStorage.getItem('ide-settings');
            if (storedStr) saved = JSON.parse(storedStr);
        }

        if (saved) {
            App.settings = {
                editor: { ...DEFAULT_SETTINGS.editor, ...saved.editor },
                compiler: { ...DEFAULT_SETTINGS.compiler, ...saved.compiler },
                execution: { ...DEFAULT_SETTINGS.execution, ...saved.execution },
                appearance: sanitizeAppearanceSettings({
                    ...DEFAULT_SETTINGS.appearance,
                    ...saved.appearance,
                    perTheme: saved.appearance?.perTheme || {}
                }),
                startup: { ...DEFAULT_SETTINGS.startup, ...saved.startup },
                terminal: { ...DEFAULT_SETTINGS.terminal, ...saved.terminal },
                panels: { ...DEFAULT_SETTINGS.panels, ...saved.panels },
                oj: { ...DEFAULT_SETTINGS.oj, ...saved.oj },
                template: { ...DEFAULT_SETTINGS.template, ...saved.template },
                keybindings: { ...DEFAULT_SETTINGS.keybindings, ...saved.keybindings },
                snippets: saved.snippets || DEFAULT_SETTINGS.snippets,
                localHistory: { ...DEFAULT_SETTINGS.localHistory, ...saved.localHistory },
                discord: { ...DEFAULT_SETTINGS.discord, ...saved.discord }
            };
        }

        // Load panels state from settings
        if (App.settings.panels) {
            App.showIO = App.settings.panels.showIO ?? false;
            App.showTerm = App.settings.panels.showTerm ?? true;
            App.showProblems = App.settings.panels.showProblems ?? false;
        }
    } catch (e) {
        console.log('Using default settings', e);
    }
}

function clearThemeBackgroundOverrides() {
    try {
        if (typeof ThemeManager !== 'undefined' && ThemeManager.builtinThemeIds) {
            ThemeManager.builtinThemeIds.forEach(id => {
                localStorage.removeItem(`theme-bg-${id}`);
            });
        }
    } catch (e) {
        console.warn('Failed to clear saved theme backgrounds', e);
    }
}

function sanitizeAppearanceSettings(appearance) {
    if (!appearance) return DEFAULT_SETTINGS.appearance;

    const normalizeBgUrl = (url) => {
        if (!url) return '';
        const cleaned = String(url).trim();
        if (!cleaned) return '';

        // Guard against bogus values like '\\' or root-only paths that break background loading
        const invalidSingletons = ['\\', '/', '.', './', '..'];
        if (invalidSingletons.includes(cleaned)) return '';

        // If url starts with just 'file://' with nothing else, treat as invalid
        if (cleaned.toLowerCase() === 'file://' || cleaned.toLowerCase() === 'file:') return '';

        return cleaned;
    };

    const cleanedAppearance = { ...appearance };
    cleanedAppearance.bgUrl = normalizeBgUrl(appearance.bgUrl);

    if (!cleanedAppearance.perTheme) cleanedAppearance.perTheme = {};
    for (const themeId of Object.keys(cleanedAppearance.perTheme)) {
        const bgUrl = cleanedAppearance.perTheme[themeId]?.bgUrl;
        const normalized = normalizeBgUrl(bgUrl);
        if (normalized) {
            cleanedAppearance.perTheme[themeId] = {
                ...cleanedAppearance.perTheme[themeId],
                bgUrl: normalized
            };
        } else {
            delete cleanedAppearance.perTheme[themeId].bgUrl;
        }
    }

    return cleanedAppearance;
}

// Coalesce bursts (every Ctrl+wheel tick used to rewrite settings.json).
let saveSettingsTimer = null;
function saveSettingsSoon(delay = 400) {
    if (saveSettingsTimer) clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(() => { saveSettingsTimer = null; saveSettings(); }, delay);
}

function saveSettings() {
    try {
        if (window.electronAPI?.saveSettings) {
            return window.electronAPI.saveSettings(App.settings);
        } else {
            localStorage.setItem('ide-settings', JSON.stringify(App.settings));
            return Promise.resolve({ success: true });
        }
    } catch (e) {
        console.error('Failed to save settings', e);
        return Promise.reject(e);
    }
}

function initSettings() {
    document.getElementById('btn-settings').onclick = openSettings;
    document.getElementById('settings-close').onclick = closeSettings;
    document.getElementById('settings-overlay').onclick = e => {
        if (e.target.id === 'settings-overlay') closeSettings();
    };

    // Header restart/update button
    const headerUpdateBtn = document.getElementById('btn-restart-update');
    if (headerUpdateBtn) {
        headerUpdateBtn.onclick = () => {
            if (isPortableVersion) {
                // Portable: Open download page
                window.electronAPI?.openReleasePage?.('https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/releases');
            } else if (updateDownloaded && window.electronAPI?.quitAndInstall) {
                // Installer: Restart to install
                window.electronAPI.quitAndInstall();
            }
        };
    }

    // Tab switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.onclick = () => {
            // Remove active from all tabs
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));

            // Add active to clicked tab
            tab.classList.add('active');
            const panelId = 'panel-' + tab.dataset.tab;
            document.getElementById(panelId)?.classList.add('active');

            // Re-apply theme colors to fix inline styles
            updateThemePreview();

            // Refresh snippets list if switching to snippets tab
            if (tab.dataset.tab === 'snippets' && typeof renderSnippetsList === 'function') {
                renderSnippetsList();
            }

            // Initialize marketplace carousel when opening appearance tab
            if (tab.dataset.tab === 'appearance' && typeof ThemeMarketplace !== 'undefined') {
                ThemeMarketplace.renderCarousel();
            }
        };
    });

    // Appearance: open marketplace fullscreen
    const openMarketplaceBtn = document.getElementById('btn-theme-marketplace');
    if (openMarketplaceBtn) {
        openMarketplaceBtn.onclick = () => {
            if (typeof ThemeMarketplace !== 'undefined') {
                ThemeMarketplace.openModal();
            }
        };
    }

    // Appearance: open customizer for current theme
    const customizeBtn = document.getElementById('btn-open-customizer');
    if (customizeBtn) {
        customizeBtn.onclick = () => {
            const currentThemeId = document.getElementById('set-theme')?.value || App.settings?.appearance?.theme;
            if (typeof ThemeCustomizer !== 'undefined') {
                ThemeCustomizer.open(currentThemeId || null);
            }
        };
    }

    const fontSizeSlider = document.getElementById('set-fontSize');
    fontSizeSlider.oninput = () => {
        document.getElementById('val-fontSize').textContent = fontSizeSlider.value + 'px';
    };

    const fontFamilySelect = document.getElementById('set-fontFamily');
    const fontFamilyCustom = document.getElementById('set-fontFamilyCustom');
    if (fontFamilySelect && fontFamilyCustom) {
        fontFamilySelect.onchange = () => {
            const isCustom = fontFamilySelect.value === 'custom';
            fontFamilyCustom.style.display = isCustom ? 'block' : 'none';
            if (isCustom) {
                if (!fontFamilyCustom.value.trim()) {
                    fontFamilyCustom.value = App.settings.editor.fontFamily || DEFAULT_SETTINGS.editor.fontFamily;
                }
                fontFamilyCustom.focus();
                fontFamilyCustom.select();
            }
        };
    }

    // Live Background Opacity (optional - may not exist if Background section removed)
    const bgOpacitySlider = document.getElementById('set-bgOpacity');
    if (bgOpacitySlider) {
        bgOpacitySlider.oninput = () => {
            const val = bgOpacitySlider.value;
            document.getElementById('val-bgOpacity').textContent = val + '%';
        };
    }

    // Live Theme Update
    document.getElementById('set-theme').onchange = () => {
        const newTheme = document.getElementById('set-theme').value;
        // Apply to whole app immediately
        if (typeof ThemeManager !== 'undefined') {
            ThemeManager.setTheme(newTheme);
            // Update background input for this theme (if exists)
            const perTheme = App.settings.appearance.perTheme || {};
            const themeSettings = perTheme[newTheme] || {};
            const themeBgUrl = themeSettings.bgUrl || '';
            const bgUrlInput = document.getElementById('set-bgUrl');
            if (bgUrlInput) bgUrlInput.value = themeBgUrl;

            const oldTheme = App.settings.appearance.theme;
            App.settings.appearance.theme = newTheme;
            applyBackgroundSettings();
            App.settings.appearance.theme = oldTheme;

            updateThemePreview();
        }
    };

    const bgFileInput = document.getElementById('set-bgFile');
    if (bgFileInput) {
        bgFileInput.onchange = e => {
            const file = e.target.files[0];
            if (file) {
                const filePath = window.electronAPI?.getPathForFile?.(file) || '';
                if (filePath) {
                    const cleanPath = filePath.replace(/\\/g, '/');
                    const bgUrlInput = document.getElementById('set-bgUrl');
                    if (bgUrlInput) bgUrlInput.value = cleanPath;
                } else {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const bgUrlInput = document.getElementById('set-bgUrl');
                        if (bgUrlInput) bgUrlInput.value = ev.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            }
        };
    }

    // AutoSave Checkbox Toggle
    const autoSaveSwitch = document.getElementById('set-autoSave');
    const autoSaveInput = document.getElementById('set-autoSaveDelay');
    if (autoSaveSwitch && autoSaveInput) {
        autoSaveSwitch.onchange = () => {
            autoSaveInput.disabled = !autoSaveSwitch.checked;
            autoSaveInput.style.opacity = autoSaveSwitch.checked ? '1' : '0.5';
        };
    }

    // Reset background button (optional - may not exist if Background section removed)
    const resetBgBtn = document.getElementById('btn-reset-bg');
    if (resetBgBtn) {
        resetBgBtn.onclick = () => {
            const bgUrlInput = document.getElementById('set-bgUrl');
            if (bgUrlInput) bgUrlInput.value = '';
        };
    }

    document.getElementById('btn-save-settings').onclick = saveSettingsAndClose;
    document.getElementById('btn-reset-settings').onclick = resetSettings;

    // Clear PCH Cache button
    const clearPchBtn = document.getElementById('btn-clear-pch');
    if (clearPchBtn) {
        clearPchBtn.onclick = async () => {
            const originalText = clearPchBtn.textContent;
            clearPchBtn.textContent = 'Clearing...';
            clearPchBtn.disabled = true;

            const flags = buildCompileFlags();
            const result = await window.electronAPI.cleanPCHCache({ flags });

            if (result && result.success) {
                clearPchBtn.textContent = 'Rebuilding PCH...';
                setTimeout(() => {
                    clearPchBtn.textContent = 'Done!';
                    setTimeout(() => {
                        clearPchBtn.textContent = originalText;
                        clearPchBtn.disabled = false;
                    }, 1500);
                }, 800);
            } else {
                clearPchBtn.textContent = 'Failed!';
                clearPchBtn.style.backgroundColor = 'var(--red-primary)';
                setTimeout(() => {
                    clearPchBtn.textContent = originalText;
                    clearPchBtn.disabled = false;
                    clearPchBtn.style.backgroundColor = '';
                }, 2000);
            }
        };
    }

    // Template reset button
    const templateResetBtn = document.getElementById('btn-template-reset');
    if (templateResetBtn) {
        templateResetBtn.onclick = resetTemplate;
    }

    // Template Monaco editor will be initialized when settings panel opens


    // Keybindings reset button
    const keybindingsResetBtn = document.getElementById('btn-keybindings-reset');
    if (keybindingsResetBtn) {
        keybindingsResetBtn.onclick = resetKeybindings;
    }

    // Initialize About & Updates
    initAbout();
}

// Template editor (Monaco mini editor for settings)
let templateEditor = null;

function initTemplateEditor() {
    const container = document.getElementById('template-editor-container');
    if (!container || templateEditor) return;

    templateEditor = monaco.editor.create(container, {
        value: App.settings.template?.code || DEFAULT_SETTINGS.template.code,
        language: 'cpp',
        theme: App.settings.appearance.theme || 'kawaii-dark',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Consolas', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        lineNumbers: 'on',
        folding: false,
        renderWhitespace: 'none',
        emptySelectionClipboard: false,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        }
    });

    // Sync to hidden textarea on change
    templateEditor.onDidChangeModelContent(() => {
        document.getElementById('set-template').value = templateEditor.getValue();
    });
}

// Theme color palettes for preview and settings
/**
 * Populate theme dropdown from ThemeManager
 */
function populateThemeDropdowns() {
    if (typeof ThemeManager === 'undefined') return;

    const themeList = ThemeManager.getThemeList();
    const themeSelect = document.getElementById('set-theme');
    const editorColorSelect = document.getElementById('set-editorColorScheme');

    if (themeSelect) {
        // Keep current value
        const currentValue = themeSelect.value;

        // Clear existing options except first (for editor color which has 'auto')
        themeSelect.innerHTML = '';

        // Add themes from ThemeManager
        themeList.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            themeSelect.appendChild(option);
        });

        // Restore value if still exists
        if ([...themeSelect.options].some(o => o.value === currentValue)) {
            themeSelect.value = currentValue;
        }
    }

    if (editorColorSelect) {
        const currentValue = editorColorSelect.value;

        // Keep 'auto' option
        editorColorSelect.innerHTML = '<option value="auto">Auto (Match Theme)</option>';

        // Add themes
        themeList.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            editorColorSelect.appendChild(option);
        });

        if ([...editorColorSelect.options].some(o => o.value === currentValue)) {
            editorColorSelect.value = currentValue;
        }
    }

    // Also render horizontal theme carousel
    populateThemeCarousel(themeList);
}

let _themeCarouselBound = false;
function populateThemeCarousel(themeList) {
    const carousel = document.getElementById('theme-carousel');
    if (!carousel) return;

    const selected = document.getElementById('set-theme')?.value || App.settings?.appearance?.theme || '';

    carousel.innerHTML = '';
    themeList.forEach(t => {
        const themeObj = ThemeManager.themes.get(t.id);
        const bg = themeObj?.editor?.background || themeObj?.colors?.editorBg || '#1a2530';
        const accent = themeObj?.colors?.accent || '#88c9ea';

        const pill = document.createElement('div');
        pill.className = 'theme-pill' + (t.id === selected ? ' active' : '');
        pill.dataset.themeId = t.id;
        pill.innerHTML = `
            <div class="theme-pill-swatch" style="background:${escapeHtml(bg)}; border-color:${escapeHtml(accent)}"></div>
            <div class="theme-pill-title">
                <div class="theme-pill-name">${escapeHtml(t.name)}</div>
                <div class="theme-pill-meta">${t.isBuiltin ? 'Built-in' : 'Custom'} • ${escapeHtml(t.type || '')}</div>
            </div>
        `;

        // Note: Click handling is done in bindThemeCarouselInteractions via pointerup
        // to properly distinguish between drag and click

        carousel.appendChild(pill);
    });

    if (!_themeCarouselBound) {
        _themeCarouselBound = true;
        bindThemeCarouselInteractions();
    }
}

function selectThemeFromCarousel(themeId, scrollIntoView = false) {
    const select = document.getElementById('set-theme');
    if (!select) return;
    select.value = themeId;

    // Update carousel active state
    const carousel = document.getElementById('theme-carousel');
    if (carousel) {
        carousel.querySelectorAll('.theme-pill').forEach(el => {
            el.classList.toggle('active', el.dataset.themeId === themeId);
        });
        if (scrollIntoView) {
            const active = carousel.querySelector(`.theme-pill[data-theme-id="${themeId}"]`);
            active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    // Trigger existing flow
    select.dispatchEvent(new Event('change'));
}

function bindThemeCarouselInteractions() {
    const carousel = document.getElementById('theme-carousel');
    const leftBtn = document.getElementById('theme-carousel-left');
    const rightBtn = document.getElementById('theme-carousel-right');
    if (!carousel) return;

    // Wheel: vertical scroll => horizontal browse
    carousel.addEventListener('wheel', (e) => {
        // Allow normal scrolling if user is using trackpad horizontal (deltaX)
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        carousel.scrollLeft += delta;
        e.preventDefault();
    }, { passive: false });

    // Simple click to select theme - no drag functionality
    carousel.addEventListener('click', (e) => {
        const pill = e.target.closest('.theme-pill');
        if (pill && pill.dataset.themeId) {
            selectThemeFromCarousel(pill.dataset.themeId, false);
        }
    });

    if (leftBtn) {
        leftBtn.addEventListener('click', () => carousel.scrollBy({ left: -320, behavior: 'smooth' }));
    }
    if (rightBtn) {
        rightBtn.addEventListener('click', () => carousel.scrollBy({ left: 320, behavior: 'smooth' }));
    }
}

function updateThemePreview() {
    const theme = document.getElementById('set-theme').value;
    const preview = document.getElementById('theme-preview');
    if (!preview) return;

    // Prefer ThemeManager data (supports custom themes). ThemeManager is the sole
    // source of truth for theme colors; fall back to kawaii-dark if the id is
    // somehow unregistered so the preview always has real data.
    const tmTheme = (typeof ThemeManager !== 'undefined')
        ? (ThemeManager.themes.get(theme) || ThemeManager.themes.get('kawaii-dark'))
        : null;
    if (tmTheme) {
        const ui = tmTheme.colors || {};
        const ed = tmTheme.editor || {};
        const syntax = ed.syntax || {};

        const headerBg = ui.bgHeader || ui.bgOceanDark || 'rgba(0,0,0,0.2)';
        const panelBg = ui.bgPanel || ui.bgGlass || 'rgba(0,0,0,0.2)';
        const editorBg = ed.background || ui.editorBg || '#1a2530';
        const text = ui.textPrimary || ed.foreground || '#e0f0ff';
        const muted = ui.textMuted || ui.textSecondary || '#7990a0';
        const accent = ui.accent || '#88c9ea';

        preview.style.background = editorBg;
        preview.style.borderColor = headerBg;

        const header = preview.querySelector('.preview-header');
        if (header) header.style.background = headerBg;

        const tab = preview.querySelector('.preview-tab');
        if (tab) {
            tab.style.background = panelBg;
            tab.style.color = text;
        }

        const body = preview.querySelector('.preview-body');
        if (body) body.style.background = panelBg;

        const editor = preview.querySelector('.preview-editor');
        if (editor) {
            editor.style.background = editorBg;
            editor.style.color = text;
            editor.style.borderColor = ui.border || 'rgba(255,255,255,0.12)';
        }

        preview.querySelectorAll('.preview-io-panel').forEach(panel => {
            panel.style.background = panelBg;
            panel.style.borderColor = ui.border || 'rgba(255,255,255,0.12)';
        });
        preview.querySelectorAll('.preview-io-header').forEach(h => {
            h.style.color = accent;
            h.style.background = ui.bgButtonHover || 'rgba(0,0,0,0.12)';
        });
        preview.querySelectorAll('.preview-io-body').forEach(b => {
            b.style.color = muted;
        });

        const term = preview.querySelector('.preview-terminal');
        if (term) {
            term.style.background = ui.terminalBg || ui.bgPanel || 'rgba(0,0,0,0.2)';
            term.style.borderColor = ui.border || 'rgba(255,255,255,0.12)';
        }
        const termHeader = preview.querySelector('.preview-term-header');
        if (termHeader) {
            termHeader.style.color = accent;
            termHeader.style.background = ui.bgButtonHover || 'rgba(0,0,0,0.12)';
        }

        const status = preview.querySelector('.preview-statusbar');
        if (status) {
            status.style.background = headerBg;
            status.style.color = text;
        }

        // Syntax colors
        const setSyntax = (sel, key, fallback) => {
            const el = preview.querySelector(sel);
            if (!el) return;
            const raw = syntax?.[key]?.color;
            el.style.color = raw ? (raw.startsWith('#') ? raw : `#${raw}`) : fallback;
        };
        setSyntax('.kw', 'keyword', accent);
        setSyntax('.str', 'string', '#a3d9a5');
        setSyntax('.type', 'type', '#e8a8b8');
        setSyntax('.fn', 'function', '#7ec8e3');

        // Line numbers
        preview.querySelectorAll('.ln').forEach(ln => (ln.style.color = muted));

        return;
    }

}

function normalizeFontFamilyInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return DEFAULT_SETTINGS.editor.fontFamily;
    return raw;
}

function setFontFamilyInputs(fontFamily) {
    const selectEl = document.getElementById('set-fontFamily');
    const customEl = document.getElementById('set-fontFamilyCustom');
    if (!selectEl || !customEl) return;

    const normalized = normalizeFontFamilyInput(fontFamily);
    const isBuiltIn = BUILTIN_FONT_FAMILIES.has(normalized);

    if (isBuiltIn) {
        selectEl.value = normalized;
        customEl.value = '';
        customEl.style.display = 'none';
    } else {
        selectEl.value = 'custom';
        customEl.value = normalized;
        customEl.style.display = 'block';
    }
}

function getSelectedFontFamily() {
    const selectEl = document.getElementById('set-fontFamily');
    const customEl = document.getElementById('set-fontFamilyCustom');
    if (!selectEl) return DEFAULT_SETTINGS.editor.fontFamily;

    if (selectEl.value === 'custom') {
        return normalizeFontFamilyInput(customEl?.value || '');
    }

    return normalizeFontFamilyInput(selectEl.value);
}

function openSettings() {
    // Populate theme dropdowns dynamically from ThemeManager first
    populateThemeDropdowns();

    // Render theme carousel if marketplace is available
    if (typeof ThemeMarketplace !== 'undefined') {
        ThemeMarketplace.renderCarousel();
    }

    document.getElementById('set-fontSize').value = App.settings.editor.fontSize;
    document.getElementById('val-fontSize').textContent = App.settings.editor.fontSize + 'px';
    setFontFamilyInputs(App.settings.editor.fontFamily);
    document.getElementById('set-tabSize').value = App.settings.editor.tabSize;
    document.getElementById('set-minimap').checked = App.settings.editor.minimap;
    document.getElementById('set-wordWrap').checked = App.settings.editor.wordWrap;
    document.getElementById('set-startupBehavior').value = App.settings.startup?.behavior || DEFAULT_SETTINGS.startup.behavior;
    const autoSaveEnabled = App.settings.editor.autoSave || false;
    document.getElementById('set-autoSave').checked = autoSaveEnabled;
    const autoSaveDelayInput = document.getElementById('set-autoSaveDelay');
    autoSaveDelayInput.value = App.settings.editor.autoSaveDelay || 3;
    autoSaveDelayInput.disabled = !autoSaveEnabled;
    autoSaveDelayInput.style.opacity = autoSaveEnabled ? '1' : '0.5';
    document.getElementById('set-liveCheck').checked = App.settings.editor.liveCheck || false;
    document.getElementById('set-liveCheckDelay').value = App.settings.editor.liveCheckDelay || 1000;
    document.getElementById('set-intellisense').checked = App.settings.editor.intellisense !== false;
    document.getElementById('set-keywords').checked = App.settings.editor.keywords !== false;
    document.getElementById('set-snippets-enabled').checked = App.settings.editor.snippets !== false;

    document.getElementById('set-cppStandard').value = App.settings.compiler.cppStandard;
    document.getElementById('set-optimization').value = App.settings.compiler.optimization;
    document.getElementById('set-warnings').checked = App.settings.compiler.warnings;
    const lldToggle = document.getElementById('set-useLLD');
    if (lldToggle) lldToggle.checked = App.settings.compiler.useLLD !== false;
    const singleFileToggle = document.getElementById('set-singleFileMode');
    if (singleFileToggle) singleFileToggle.checked = App.settings.compiler.singleFileMode !== false;
    const extraFlagsInput = document.getElementById('set-extraFlags');
    if (extraFlagsInput) extraFlagsInput.value = App.settings.compiler.extraFlags || '';

    document.getElementById('set-timeLimitEnabled').checked = App.settings.execution.timeLimitEnabled;
    document.getElementById('set-timeLimitSeconds').value = App.settings.execution.timeLimitSeconds;
    document.getElementById('set-clearTerminal').checked = App.settings.execution.clearTerminal;
    document.getElementById('set-autoSendInput').checked = App.settings.execution.autoSendInput;
    document.getElementById('set-useExternalTerminal').checked = App.settings.execution.useExternalTerminal || false;
    const setRealtimeOutput = document.getElementById('set-realtimeOutput');
    if (setRealtimeOutput) setRealtimeOutput.checked = App.settings.execution.realtimeOutput !== false;

    document.getElementById('set-terminalColorScheme').value = App.settings.terminal?.colorScheme || 'ansi-16';

    // Panel font size
    const panelFontSize = App.settings.execution.panelFontSize || 13;
    const panelFSSlider = document.getElementById('set-panelFontSize');
    const panelFSVal = document.getElementById('val-panelFontSize');
    if (panelFSSlider) {
        panelFSSlider.value = panelFontSize;
        if (panelFSVal) panelFSVal.textContent = panelFontSize + 'px';
        panelFSSlider.oninput = () => {
            if (panelFSVal) panelFSVal.textContent = panelFSSlider.value + 'px';
        };
    }

    // Set theme values after dropdown is populated
    document.getElementById('set-theme').value = App.settings.appearance.theme;
    // Sync carousel selection to saved theme
    selectThemeFromCarousel(App.settings.appearance.theme, true);
    document.getElementById('set-editorColorScheme').value = App.settings.editor.colorScheme || 'auto';
    document.getElementById('set-performanceMode').checked = App.settings.appearance.performanceMode || false;
    document.getElementById('set-uiScale').value = String(App.settings.appearance.uiScale ?? 'auto');

    // Background settings (optional - may not exist if Background section removed)
    const bgOpacitySlider = document.getElementById('set-bgOpacity');
    const bgOpacityVal = document.getElementById('val-bgOpacity');
    if (bgOpacitySlider) bgOpacitySlider.value = App.settings.appearance.bgOpacity || 50;
    if (bgOpacityVal) bgOpacityVal.textContent = (App.settings.appearance.bgOpacity || 50) + '%';

    // Load per-theme setting
    const currentTheme = App.settings.appearance.theme;
    const perThemeStore = App.settings.appearance.perTheme || {};
    const themeSpecific = perThemeStore[currentTheme] || {};
    const bgUrlInput = document.getElementById('set-bgUrl');
    if (bgUrlInput) bgUrlInput.value = themeSpecific.bgUrl || '';

    // Template - sync to hidden textarea and update Monaco editor
    const templateCode = App.settings.template?.code || DEFAULT_SETTINGS.template.code;
    document.getElementById('set-template').value = templateCode;

    // Initialize template editor if not exists, or update its content
    if (!templateEditor) {
        // Delay to ensure container is visible
        setTimeout(() => {
            initTemplateEditor();
        }, 100);
    } else {
        templateEditor.setValue(templateCode);
    }


    renderKeybindings();

    // Discord settings
    const discordEnabledEl = document.getElementById('set-discordEnabled');
    if (discordEnabledEl) {
        discordEnabledEl.checked = App.settings.discord?.enabled !== false;
        updateDiscordPreview();
    }

    // Update theme preview to match current theme
    updateThemePreview();


    if (typeof renderSnippetsList === 'function') {
        renderSnippetsList();
    }

    const overlay = document.getElementById('settings-overlay');
    overlay.classList.add('show');
    if (window.Motion) Motion.popIn(overlay, overlay.querySelector('.settings-popup'));
}

function closeSettings() {
    document.getElementById('settings-overlay').classList.remove('show');
}

function saveSettingsAndClose() {
    App.settings.editor.fontSize = parseInt(document.getElementById('set-fontSize').value);
    App.settings.editor.fontFamily = normalizeFontFamilyInput(getSelectedFontFamily());
    App.settings.editor.tabSize = parseInt(document.getElementById('set-tabSize').value);
    App.settings.editor.minimap = document.getElementById('set-minimap').checked;
    App.settings.editor.wordWrap = document.getElementById('set-wordWrap').checked;
    if (!App.settings.startup) App.settings.startup = {};
    App.settings.startup.behavior = document.getElementById('set-startupBehavior').value;
    App.settings.editor.colorScheme = document.getElementById('set-editorColorScheme').value;
    App.settings.editor.autoSave = document.getElementById('set-autoSave').checked;

    // Validate and clamp autoSaveDelay
    let delay = parseInt(document.getElementById('set-autoSaveDelay').value);
    if (isNaN(delay) || delay < 1) delay = 3;
    if (delay > 300) delay = 300;
    App.settings.editor.autoSaveDelay = delay;

    App.settings.editor.liveCheck = document.getElementById('set-liveCheck').checked;
    App.settings.editor.liveCheckDelay = parseInt(document.getElementById('set-liveCheckDelay').value) || 1000;
    App.settings.editor.intellisense = document.getElementById('set-intellisense').checked;
    App.settings.editor.keywords = document.getElementById('set-keywords').checked;
    App.settings.editor.snippets = document.getElementById('set-snippets-enabled').checked;

    App.settings.compiler.cppStandard = document.getElementById('set-cppStandard').value;
    App.settings.compiler.optimization = document.getElementById('set-optimization').value;
    App.settings.compiler.warnings = document.getElementById('set-warnings').checked;
    const lldToggle = document.getElementById('set-useLLD');
    if (lldToggle) App.settings.compiler.useLLD = lldToggle.checked;
    const singleFileToggle = document.getElementById('set-singleFileMode');
    if (singleFileToggle) App.settings.compiler.singleFileMode = singleFileToggle.checked;
    const extraFlagsInput = document.getElementById('set-extraFlags');
    if (extraFlagsInput) App.settings.compiler.extraFlags = extraFlagsInput.value.trim();

    App.settings.execution.timeLimitEnabled = document.getElementById('set-timeLimitEnabled').checked;
    App.settings.execution.timeLimitSeconds = parseInt(document.getElementById('set-timeLimitSeconds').value);
    App.settings.execution.clearTerminal = document.getElementById('set-clearTerminal').checked;
    App.settings.execution.autoSendInput = document.getElementById('set-autoSendInput').checked;
    App.settings.execution.useExternalTerminal = document.getElementById('set-useExternalTerminal').checked;
    const realtimeOutputToggle = document.getElementById('set-realtimeOutput');
    if (realtimeOutputToggle) App.settings.execution.realtimeOutput = realtimeOutputToggle.checked;

    if (!App.settings.terminal) App.settings.terminal = {};
    App.settings.terminal.colorScheme = document.getElementById('set-terminalColorScheme').value;

    // Panel font size
    const panelFSInput = document.getElementById('set-panelFontSize');
    if (panelFSInput) App.settings.execution.panelFontSize = parseInt(panelFSInput.value) || 13;

    App.settings.appearance.theme = document.getElementById('set-theme').value;
    App.settings.appearance.performanceMode = document.getElementById('set-performanceMode').checked;
    const uiScale = document.getElementById('set-uiScale').value;
    App.settings.appearance.uiScale = uiScale === 'auto' ? 'auto' : Number(uiScale);

    // Background settings (optional - may not exist if Background section removed)
    const bgOpacityEl = document.getElementById('set-bgOpacity');
    if (bgOpacityEl) {
        App.settings.appearance.bgOpacity = parseInt(bgOpacityEl.value);
    }

    // Save per-theme background setting (optional)
    const targetTheme = document.getElementById('set-theme').value;
    const bgUrlEl = document.getElementById('set-bgUrl');
    const normalizeBgInput = (url) => {
        if (!url) return '';
        const cleaned = String(url).trim();
        if (!cleaned) return '';
        const invalidSingletons = ['\\', '/', '.', './', '..'];
        if (invalidSingletons.includes(cleaned)) return '';
        if (cleaned.toLowerCase() === 'file://' || cleaned.toLowerCase() === 'file:') return '';
        return cleaned;
    };

    const targetBgUrl = normalizeBgInput(bgUrlEl ? bgUrlEl.value : '');

    if (!App.settings.appearance.perTheme) App.settings.appearance.perTheme = {};
    if (!App.settings.appearance.perTheme[targetTheme]) App.settings.appearance.perTheme[targetTheme] = {};

    if (targetBgUrl) {
        App.settings.appearance.perTheme[targetTheme].bgUrl = targetBgUrl;
    } else {
        delete App.settings.appearance.perTheme[targetTheme].bgUrl;
    }


    if (!App.settings.template) App.settings.template = {};
    App.settings.template.code = document.getElementById('set-template').value;

    // Discord RPC toggle
    const discordEnabledEl = document.getElementById('set-discordEnabled');
    if (discordEnabledEl) {
        const newEnabled = discordEnabledEl.checked;
        const wasEnabled = App.settings.discord?.enabled !== false;
        if (!App.settings.discord) App.settings.discord = {};
        App.settings.discord.enabled = newEnabled;
        if (newEnabled !== wasEnabled) {
            _discordAppliedEnabled = newEnabled; // keep guard in sync
            if (newEnabled) {
                window.electronAPI?.discordEnable?.();
            } else {
                window.electronAPI?.discordDisable?.();
            }
        }
    }

    applySettings();
    saveSettings();
    updateShortcutMap(); // Apply new shortcuts immediately
    closeSettings();
    log('Settings saved', 'success');
}

async function resetSettings() {
    const confirmed = await showConfirmDialog({
        title: 'Reset Settings',
        message: 'Reset all settings to defaults? This action cannot be undone.',
        confirmText: 'Reset',
        danger: true
    });
    if (confirmed) {
        App.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        // Clear any saved per-theme background overrides (Customizer)
        clearThemeBackgroundOverrides();
        App.settings.appearance.perTheme = {};
        App.settings.appearance.bgUrl = '';

        // Force clear all background CSS variables and inline styles
        const root = document.documentElement;
        root.style.removeProperty('--app-bg-image');
        root.style.removeProperty('--app-bg-opacity');
        root.style.removeProperty('--app-bg-position');
        root.style.removeProperty('--app-bg-blur');
        root.style.removeProperty('--editor-bg-image');
        root.style.removeProperty('--editor-bg-opacity');
        document.body.style.background = '';
        document.body.style.backgroundImage = '';

        // Restore hardcoded built-in themes in memory (drop previous overrides)
        if (typeof ThemeManager !== 'undefined' && ThemeManager.restoreAllBuiltinThemes) {
            ThemeManager.restoreAllBuiltinThemes();
            // Re-apply theme to load hardcoded backgrounds
            ThemeManager.setTheme(DEFAULT_SETTINGS.appearance.theme);
        }
        applySettings();
        saveSettings();
        openSettings();
        log('Settings reset to defaults', 'info');
    }
}

// ============================================================================
// KEYBINDINGS MANAGEMENT
// ============================================================================
const KEYBINDING_LABELS = {
    compile: 'Compile Only',
    buildRun: 'Compile & Run',
    run: 'Run Only',
    stop: 'Stop Process',
    save: 'Save File',
    saveAs: 'Save File As',
    newFile: 'New File',
    openFile: 'Open File',
    newTab: 'New Tab',
    closeTab: 'Close Tab',
    nextTab: 'Next Tab',
    prevTab: 'Previous Tab',
    toggleProblems: 'Toggle Problems',
    settings: 'Open Settings',
    toggleSplit: 'Toggle Split',
    formatCode: 'Format Code',
    uiZoomIn: 'Interface Scale: Larger',
    uiZoomOut: 'Interface Scale: Smaller',
    uiZoomReset: 'Interface Scale: Auto'
};

let editingKeybinding = null;

function renderKeybindings() {
    const container = document.getElementById('keybindings-list');
    if (!container) return;

    const keybindings = App.settings.keybindings || DEFAULT_SETTINGS.keybindings;

    container.innerHTML = Object.entries(keybindings).map(([key, value]) => `
        <div class="keybinding-item" data-action="${escapeHtml(key)}">
            <span class="keybinding-name">${escapeHtml(KEYBINDING_LABELS[key] || key)}</span>
            <button class="keybinding-key" data-action="${escapeHtml(key)}">${escapeHtml(value)}</button>
        </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.keybinding-key').forEach(btn => {
        btn.addEventListener('click', startEditingKeybinding);
    });
}

function startEditingKeybinding(e) {
    const btn = e.target;
    const action = btn.dataset.action;

    // Remove editing from all
    document.querySelectorAll('.keybinding-key').forEach(b => b.classList.remove('editing'));

    btn.classList.add('editing');
    btn.textContent = 'Press a key...';
    editingKeybinding = action;

    // Listen for key press
    document.addEventListener('keydown', captureKeybinding);
}

function captureKeybinding(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!editingKeybinding) return;

    // Escape to cancel
    if (e.key === 'Escape') {
        cancelEditingKeybinding();
        return;
    }

    // Build key string
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    // Get the key name
    let keyName = e.key;
    if (keyName === ' ') keyName = 'Space';
    else if (keyName.length === 1) keyName = keyName.toUpperCase();
    else if (keyName.startsWith('Arrow')) keyName = keyName.replace('Arrow', '');

    // Don't add modifier keys alone
    if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        parts.push(keyName);
    } else {
        return; // Wait for non-modifier key
    }

    const keyCombo = parts.join('+');

    // Save the new keybinding
    if (!App.settings.keybindings) {
        App.settings.keybindings = { ...DEFAULT_SETTINGS.keybindings };
    }
    App.settings.keybindings[editingKeybinding] = keyCombo;

    // Update ShortcutsManager binding
    if (window.ShortcutsManager?.setKeybinding) {
        window.ShortcutsManager.setKeybinding(editingKeybinding, keyCombo);
    }

    // Update UI
    const btn = document.querySelector(`.keybinding-key[data-action="${editingKeybinding}"]`);
    if (btn) {
        btn.textContent = keyCombo;
        btn.classList.remove('editing');
    }

    // Persist changes and make the new combo live right away
    saveSettings();
    updateShortcutMap();

    // Cleanup
    editingKeybinding = null;
    document.removeEventListener('keydown', captureKeybinding);
}

function cancelEditingKeybinding() {
    if (!editingKeybinding) return;

    const keybindings = App.settings.keybindings || DEFAULT_SETTINGS.keybindings;
    const btn = document.querySelector(`.keybinding-key[data-action="${editingKeybinding}"]`);
    if (btn) {
        btn.textContent = keybindings[editingKeybinding];
        btn.classList.remove('editing');
    }

    editingKeybinding = null;
    document.removeEventListener('keydown', captureKeybinding);
}

async function resetKeybindings() {
    const confirmed = await showConfirmDialog({
        title: 'Reset Keybindings',
        message: 'Reset all keybindings to defaults?',
        confirmText: 'Reset',
        danger: true
    });
    if (confirmed) {
        App.settings.keybindings = { ...DEFAULT_SETTINGS.keybindings };
        renderKeybindings();
        saveSettings();
        updateShortcutMap();
        log('Keybindings reset to defaults', 'info');
    }
}

async function resetTemplate() {
    const confirmed = await showConfirmDialog({
        title: 'Reset Template',
        message: 'Reset template to default?',
        confirmText: 'Reset'
    });
    if (confirmed) {
        const defaultCode = DEFAULT_SETTINGS.template.code;
        const textarea = document.getElementById('set-template');
        if (textarea) {
            textarea.value = defaultCode;
        }
        // Also update Monaco editor if exists
        if (templateEditor) {
            templateEditor.setValue(defaultCode);
        }
    }
}

// ============================================================================
// AUTO-SAVE
// ============================================================================
let autoSaveTimer = null;

function scheduleAutoSave() {
    if (!App.settings.editor.autoSave) return;


    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }


    const delay = (App.settings.editor.autoSaveDelay || 3) * 1000;
    autoSaveTimer = setTimeout(() => {
        autoSaveCurrentFile();
    }, delay);
}

async function autoSaveCurrentFile() {
    const tabId = App.activeEditor === 2 ? App.splitTabId : App.activeTabId;
    if (!tabId) return;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab || !tab.path || !tab.modified) return;


    const editor = App.activeEditor === 2 ? App.editor2 : App.editor;
    if (!editor) return;

    const content = editor.getValue();

    try {
        const result = await window.electronAPI.saveFile({ path: tab.path, content });
        if (result.success) {
            tab.original = content;
            tab.modified = false;
            renderTabs();
            // Silent save - no log message
        }
    } catch (e) {
        console.log('Auto-save failed:', e);
    }
}
