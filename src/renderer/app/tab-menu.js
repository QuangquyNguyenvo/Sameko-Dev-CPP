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

    // Styled by islands.css (.tab-context-menu), from the theme's tokens.
    tabContextMenu = document.createElement('div');
    tabContextMenu.className = 'tab-context-menu';

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

    items.forEach(item => {
        if (item.divider) {
            const div = document.createElement('div');
            div.className = 'tab-context-sep';
            tabContextMenu.appendChild(div);
            return;
        }

        const menuItem = document.createElement('div');
        menuItem.className = 'tab-context-item' + (item.disabled ? ' disabled' : '');
        menuItem.innerHTML = `<span class="tab-context-icon">${item.icon}</span><span>${item.label}</span>`;

        if (!item.disabled) {
            menuItem.onclick = () => {
                item.action();
                tabContextMenu.remove();
                tabContextMenu = null;
            };
        }

        tabContextMenu.appendChild(menuItem);
    });

    // Kept inside the window when opened near its right or bottom edge.
    tabContextMenu.style.left = '0px';
    tabContextMenu.style.top = '0px';
    document.body.appendChild(tabContextMenu);
    const rect = tabContextMenu.getBoundingClientRect();
    tabContextMenu.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - rect.width - 8))}px`;
    tabContextMenu.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - rect.height - 8))}px`;

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
