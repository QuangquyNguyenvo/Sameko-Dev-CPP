/**
 * Sameko Dev C++ IDE - renderer: Tab context menu and the local-history settings fields.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// TAB CONTEXT MENU
// ============================================================================
let tabContextMenu = null;

function showTabContextMenu(e, tab) {
    // Remove existing menu
    if (tabContextMenu) {
        tabContextMenu.remove();
    }

    // Create context menu - same style as dropdown menu
    tabContextMenu = document.createElement('div');
    tabContextMenu.className = 'tab-context-menu';

    // Get computed styles from document for theme-aware colors
    const computedStyle = getComputedStyle(document.documentElement);
    const bgPanel = computedStyle.getPropertyValue('--bg-panel').trim() || '#f5faff';
    const border = computedStyle.getPropertyValue('--border').trim() || '#c8e6f8';
    const textPrimary = computedStyle.getPropertyValue('--text-primary').trim() || '#3a5a78';

    tabContextMenu.style.cssText = `
        position: fixed;
        top: ${e.clientY}px;
        left: ${e.clientX}px;
        z-index: 10000;
        background: ${bgPanel};
        border: 2px solid ${border};
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(136, 201, 234, 0.25);
        min-width: 180px;
        padding: 8px;
        font-size: 13px;
        color: ${textPrimary};
    `;

    // Menu items with SVG icons
    const items = [
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
            label: 'Checkpoints',
            action: () => {
                if (typeof LocalHistory !== 'undefined') {
                    setActive(tab.id);
                    if (tab.path) {
                        LocalHistory.showHistoryModal(tab.path);
                    } else {
                        LocalHistory.showUntitledHistoryModal(tab);
                    }
                }
            },
            disabled: false
        },
        { divider: true },
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
            label: 'Copy Path',
            action: () => {
                if (tab.path) {
                    navigator.clipboard.writeText(tab.path);
                    setStatus('Path copied to clipboard', 'success');
                }
            },
            disabled: !tab.path
        },
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
            label: 'Close',
            action: () => closeTab(tab.id)
        },
        {
            icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="23" y2="11"/></svg>`,
            label: 'Close Others',
            action: () => {
                const tabsToClose = App.tabs.filter(t => t.id !== tab.id);
                tabsToClose.forEach(t => closeTab(t.id));
            },
            disabled: App.tabs.length <= 1
        }
    ];

    // Get hover color
    const bgHover = computedStyle.getPropertyValue('--bg-ocean-light').trim() || '#e8f4fc';
    const textSecondary = computedStyle.getPropertyValue('--text-secondary').trim() || '#5a9fc8';
    const accent = computedStyle.getPropertyValue('--accent').trim() || '#ff6b9d';

    items.forEach(item => {
        if (item.divider) {
            const div = document.createElement('div');
            div.style.cssText = `height: 1px; background: ${border}; margin: 6px 8px;`;
            tabContextMenu.appendChild(div);
            return;
        }

        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
            padding: 10px 16px;
            cursor: ${item.disabled ? 'not-allowed' : 'pointer'};
            display: flex;
            align-items: center;
            gap: 10px;
            opacity: ${item.disabled ? '0.5' : '1'};
            transition: all 0.15s;
            color: ${item.disabled ? textSecondary : textPrimary};
            border-radius: 10px;
            font-weight: 600;
        `;
        menuItem.innerHTML = `<span style="display:flex;align-items:center;color:${accent}">${item.icon}</span><span>${item.label}</span>`;

        if (!item.disabled) {
            menuItem.onmouseenter = () => {
                menuItem.style.background = bgHover;
                menuItem.style.color = textPrimary;
            };
            menuItem.onmouseleave = () => {
                menuItem.style.background = '';
            };
            menuItem.onclick = () => {
                item.action();
                tabContextMenu.remove();
                tabContextMenu = null;
            };
        }

        tabContextMenu.appendChild(menuItem);
    });

    document.body.appendChild(tabContextMenu);

    // Close on click outside
    const closeMenu = (e) => {
        if (tabContextMenu && !tabContextMenu.contains(e.target)) {
            tabContextMenu.remove();
            tabContextMenu = null;
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// ============================================================================
// LOCAL HISTORY SETTINGS INTEGRATION
// ============================================================================
function initLocalHistorySettings() {
    // Sync settings from App.settings to LocalHistory module
    if (typeof LocalHistory !== 'undefined' && App.settings.localHistory) {
        LocalHistory.settings = { ...LocalHistory.settings, ...App.settings.localHistory };
    }

    // Settings UI elements
    const enabledToggle = document.getElementById('set-localHistoryEnabled');
    const maxVersionsInput = document.getElementById('set-localHistoryMaxVersions');
    const maxDaysInput = document.getElementById('set-localHistoryMaxDays');
    const maxSizeInput = document.getElementById('set-localHistoryMaxSize');

    if (enabledToggle) {
        enabledToggle.checked = App.settings.localHistory?.enabled ?? true;
        enabledToggle.onchange = () => {
            App.settings.localHistory.enabled = enabledToggle.checked;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.enabled = enabledToggle.checked;
            }
        };
    }

    if (maxVersionsInput) {
        maxVersionsInput.value = App.settings.localHistory?.maxVersions ?? 20;
        maxVersionsInput.onchange = () => {
            App.settings.localHistory.maxVersions = parseInt(maxVersionsInput.value) || 20;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.maxVersions = App.settings.localHistory.maxVersions;
            }
        };
    }

    if (maxDaysInput) {
        maxDaysInput.value = App.settings.localHistory?.maxAgeDays ?? 7;
        maxDaysInput.onchange = () => {
            App.settings.localHistory.maxAgeDays = parseInt(maxDaysInput.value) || 7;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.maxAgeDays = App.settings.localHistory.maxAgeDays;
            }
        };
    }

    if (maxSizeInput) {
        maxSizeInput.value = App.settings.localHistory?.maxFileSizeKB ?? 1024;
        maxSizeInput.onchange = () => {
            App.settings.localHistory.maxFileSizeKB = parseInt(maxSizeInput.value) || 1024;
            if (typeof LocalHistory !== 'undefined') {
                LocalHistory.settings.maxFileSizeKB = App.settings.localHistory.maxFileSizeKB;
            }
        };
    }
}

// Initialize Local History settings when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for other modules to load
    setTimeout(initLocalHistorySettings, 100);
});

// Listen for theme customizer save events
window.addEventListener('themeCustomizerSave', (e) => {
    // IDE integrations can listen to this event to apply theme changes
    // e.detail.theme contains the full theme data (meta, colors, editor, terminal)
    // e.detail.timestamp contains the save timestamp
});
