/**
 * Sameko Dev C++ IDE - renderer: Tabs (new/activate/close/render), menus, save and save-as.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// TABS
// ============================================================================
function newFile() {
    const id = createRestoredTabId();

    const templateCode = App.settings.template?.code || DEFAULT_CODE;
    const tab = { id, name: 'untitled.cpp', path: null, untitledHistoryKey: createUntitledHistoryKey(), content: templateCode, original: templateCode, modified: false, viewState: null };
    App.tabs.push(tab);
    setActive(id);
    updateUI();
    scheduleSessionSave();
}

function persistCurrentTabIO() {
    const tabId = getPreferredTabId();
    if (!tabId) return;

    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    if (!inputArea || !expectedArea) return;

    App.ioByTab[tabId] = {
        input: inputArea.value || '',
        expected: expectedArea.value || ''
    };
}

function restoreTabIO(tabId) {
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    if (!inputArea || !expectedArea) return;

    const ioState = App.ioByTab[tabId] || { input: '', expected: '' };
    inputArea.value = ioState.input || '';
    expectedArea.value = ioState.expected || '';
}

function setActive(id) {
    const tab = App.tabs.find(t => t.id === id);
    if (!tab) return;

    // Any tab being shown means we need the editor — kick off the (deferred)
    // Monaco load now if it hasn't started. Idempotent and cheap when already loaded.
    ensureMonaco();

    // Test cases travel with the tab that owns them.
    const previousTab = App.tabs.find(t => t.id === App.activeTabId) || null;
    const switchingTabs = !previousTab || previousTab.id !== id;
    if (previousTab && switchingTabs) saveTestStateToTab(previousTab);

    if (App.activeTabId && App.editor && App.ready) {
        const cur = App.tabs.find(t => t.id === App.activeTabId);
        if (cur) {
            cur.content = App.editor.getValue();
            cur.viewState = App.editor.saveViewState();
        }
        persistCurrentTabIO();
    }

    App.activeTabId = id;
    if (App.editor && App.ready) {
        // Our decorations are tracked by id against the model being replaced.
        clearEditorDecorationsBeforeSwitch();
        showTabInEditor(App.editor, tab);
        if (tab.viewState) {
            App.editor.restoreViewState(tab.viewState);
        } else {
            App.editor.setPosition({ lineNumber: 1, column: 1 });
            App.editor.setScrollTop(0);
            App.editor.setScrollLeft(0);
        }

        // Re-paint breakpoint glyphs + the current-line marker for the file now
        // shown (they are keyed by file path, not stored on the model).
        if (window.Debugger) { try { window.Debugger.onFileShown(); } catch (_) { } }

        // Warm up clangd for this document as soon as it's shown, instead of
        // waiting for the user's first completion request. Building the
        // preamble for a #include<bits/stdc++.h> file takes ~1-2s; without
        // this, that first request races the build and clangd falls back to
        // its dumb "identifiers from buffer" completion (see cpp-suggestions.js).
        if (window.electronAPI?.getClangdCompletions) {
            window.electronAPI.getClangdCompletions(tab.path || tab.id, tab.content, 0, 0).catch(() => {});
        }
    }

    if (tab.path && window.FileExplorer?.handleFileOpened) {
        window.FileExplorer.handleFileOpened(tab.path);
    }

    restoreTabIO(id);
    if (switchingTabs) loadTestStateFromTab(tab);
    clearErrorDecorations();
    renderTabs();
    // Reset cursor tracker so presence shows Ln 1, Col 1 for the new tab
    _discordLastPos = { line: 1, col: 1 };
    if (_discordCursorTimer) { clearTimeout(_discordCursorTimer); _discordCursorTimer = null; }
    updateDiscordPresence(tab, 1, 1);
}

async function closeTab(id) {
    const idx = App.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = App.tabs[idx];

    if (App.isRunning) {
        const confirmed = await showConfirmDialog({
            title: 'Process Running',
            message: `A process is running. Stop it and close "${tab.name}"?`,
            confirmText: 'Stop & Close',
            danger: true
        });
        if (!confirmed) return;
        stop();
    }

    if (tab.modified) {
        const confirmed = await showConfirmDialog({
            title: 'Unsaved Changes',
            message: `"${tab.name}" has unsaved changes. Close without saving?`,
            confirmText: 'Close',
            danger: true
        });
        if (!confirmed) return;
    }


    if (tab.path) stopFileWatch(tab.path);
    // Let clangd drop this document, and do not keep 20 full copies of an
    // untitled tab in localStorage after the tab itself is gone.
    window.electronAPI?.clangdCloseDocument?.(tab.path || tab.id)?.catch?.(() => { });
    if (!tab.path && typeof LocalHistory !== 'undefined') {
        try { LocalHistory.clearUntitledHistory(tab); } catch (_) { }
    }

    delete App.tabDiagnostics[id];

    App.tabs.splice(idx, 1);
    delete App.ioByTab[id];


    if (App.splitTabId === id) closeSplit();

    if (App.activeTabId === id) {
        // The tab is already gone from App.tabs, so setActive() must not try
        // to save state into it; clear our decorations off its model here.
        App.activeTabId = null;
        if (App.editor && App.ready) clearEditorDecorationsBeforeSwitch();
        if (App.tabs.length) setActive(App.tabs[Math.min(idx, App.tabs.length - 1)].id);
        else {
            if (App.editor) showEmptyModel(App.editor);
            loadTestStateFromTab(null);
            updateDiscordPresence(null);
        }
    }
    disposeTabModel(tab);
    renderTabs();
    updateUI();
    if (App.tabs.length === 0) {
        clearSession();
    } else {
        scheduleSessionSave();
    }
}

/**
 * Open a file from a given path (for File Explorer integration)
 * Creates a new tab or switches to existing tab if file is already open
 */
async function openFileFromPath(filePath) {
    if (!filePath) return;

    // Normalize path for comparison
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Check if file is already open
    const existingTab = App.tabs.find(t => t.path && t.path.replace(/\\/g, '/') === normalizedPath);
    if (existingTab) {
        setActive(existingTab.id);
        return;
    }

    // Read file content
    try {
        let content;
        if (window.electronAPI && window.electronAPI.readFile) {
            content = await window.electronAPI.readFile(filePath);
        } else {
            console.error('[openFileFromPath] electronAPI.readFile not available');
            return;
        }

        // Create new tab
        const id = createRestoredTabId();
        const fileName = filePath.split(/[/\\]/).pop();
        const tab = {
            id,
            name: fileName,
            path: filePath,
            untitledHistoryKey: null,
            content: content,
            original: content,
            modified: false
        };
        App.tabs.push(tab);
        setActive(id);
        updateUI();
        scheduleSessionSave();
        startFileWatch(filePath);

        // Hide welcome screen
        const welcome = document.getElementById('welcome');
        if (welcome) welcome.style.display = 'none';

    } catch (err) {
        // ipcRenderer wraps the handler's message: "Error invoking remote method '…': Error: …"
        const msg = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        showToast(msg, 'error');
    }
}

// Expose to window for FileExplorer
window.openFromPath = openFileFromPath;

function renderTabs() {
    const c = document.getElementById('tabs-container');
    c.innerHTML = '';
    App.tabs.forEach(t => {
        const isActiveTab = t.id === App.activeTabId;
        const isSplitTab = App.isSplit && t.id === App.splitTabId;
        const isFocused = (App.activeEditor === 1 && isActiveTab) || (App.activeEditor === 2 && isSplitTab);
        const diagnostics = App.tabDiagnostics[t.id] || null;
        const tabHasErrors = !!diagnostics?.errors;
        const tabHasWarnings = !tabHasErrors && !!diagnostics?.warnings;

        const el = document.createElement('div');
        let className = 'tab';
        if (isActiveTab) className += ' active';
        if (isSplitTab) className += ' split';
        if (isFocused) className += ' focused';
        if (t.modified) className += ' modified';
        if (tabHasErrors) className += ' has-errors';
        else if (tabHasWarnings) className += ' has-warnings';

        el.className = className;
        el.dataset.id = t.id;
        el.draggable = true;
        const diagnosticsBadge = diagnostics && (diagnostics.errors || diagnostics.warnings)
            ? `<span class="tab-diagnostics ${tabHasErrors ? 'error' : 'warning'}" title="${diagnostics.errors || 0} errors, ${diagnostics.warnings || 0} warnings">${tabHasErrors ? diagnostics.errors : diagnostics.warnings}${tabHasErrors ? 'E' : 'W'}</span>`
            : '';
        el.innerHTML = `<span class="tab-name">${escapeHtml(t.name)}</span>${diagnosticsBadge}<span class="tab-dot"></span><span class="tab-x">×</span>`;
        el.onclick = e => {
            if (!e.target.classList.contains('tab-x')) {
                if (App.isSplit && isSplitTab) {

                    App.activeEditor = 2;
                    renderTabs();
                } else {
                    setActive(t.id);
                    App.activeEditor = 1;
                }
            }
        };
        // Right-click context menu for Local History
        el.oncontextmenu = e => {
            e.preventDefault();
            e.stopPropagation();
            showTabContextMenu(e, t);
        };
        el.querySelector('.tab-x').onclick = e => { e.stopPropagation(); closeTab(t.id); };
        c.appendChild(el);
    });

    setTimeout(() => {
        const focusedTab = c.querySelector('.tab.focused') || c.querySelector('.tab.active');
        if (focusedTab) {
            focusedTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, 10);
}

// ============================================================================
// MENUS
// ============================================================================
let activeMenu = null;

function initMenus() {
    document.querySelectorAll('.menu-btn').forEach(btn => {
        btn.onclick = e => { toggleMenu('menu-' + btn.dataset.menu, btn); e.stopPropagation(); };
    });
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.onclick = () => { doAction(item.dataset.action); closeMenus(); };
    });
    document.onclick = closeMenus;
}

function toggleMenu(id, el) {
    const menu = document.getElementById(id);
    if (activeMenu === id) { closeMenus(); return; }
    closeMenus();
    menu.classList.add('show');
    el.classList.add('active');
    const rect = el.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    if (window.Motion) Motion.menuIn(menu);
    activeMenu = id;
}

function closeMenus() {
    document.querySelectorAll('.dropdown').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    activeMenu = null;
}

function doAction(action) {
    const map = {
        new: newFile, open: openFile, save, saveas: () => saveAs(), run, buildrun: buildRun, stop,
        compile: compileOnly,
        // Same as the toolbar button, which narrow windows hide.
        gettests: () => document.getElementById('btn-cc')?.click(),
        debugstart: () => window.Debugger?.start(),
        debugstepover: () => window.Debugger?.stepOver(),
        debugstepinto: () => window.Debugger?.stepInto(),
        debugstepout: () => window.Debugger?.stepOut(),
        debugstop: () => window.Debugger?.stop(),
        exit: () => window.electronAPI?.closeWindow?.(),
        undo: () => getActiveEditor()?.trigger('keyboard', 'undo'),
        redo: () => getActiveEditor()?.trigger('keyboard', 'redo'),
        find: () => getActiveEditor()?.trigger('keyboard', 'actions.find'),
        // Temporarily disabled: toggleexplorer
        // toggleexplorer: () => {
        //     if (typeof FileExplorer !== 'undefined') {
        //         FileExplorer.toggle();
        //     }
        // },
        toggleio: toggleIO,
        toggleterm: toggleTerm,
        toggleproblems: toggleProblems,
        spliteditor: openSplit,
        swapsplit: swapSplitEditors,
        closesplit: closeSplit,
        settings: openSettings,
        localhistory: () => {
            const activeTabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
            const tab = App.tabs.find(t => t.id === activeTabId);
            if (tab && typeof LocalHistory !== 'undefined') {
                if (tab.path) {
                    LocalHistory.showHistoryModal(tab.path);
                } else {
                    LocalHistory.showUntitledHistoryModal(tab);
                }
            }
        }
    };
    map[action]?.();
}

function getActiveEditor() {
    return App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================
async function openFile() { await window.electronAPI.openFile(); }

async function save() {

    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.content = editor.getValue();

    if (tab.path) {
        // Create backup before saving (async, non-blocking)
        if (typeof LocalHistory !== 'undefined' && LocalHistory.settings.enabled) {
            LocalHistory.createBackup(tab.path, tab.content).catch(e =>
                console.warn('[LocalHistory] Backup failed:', e)
            );
        }

        const r = await window.electronAPI.saveFile({ path: tab.path, content: tab.content });
        if (r.success) { tab.original = tab.content; tab.modified = false; renderTabs(); setStatus(`Saved ${tab.name}`, 'success'); scheduleSessionSave(); }
    } else await saveAs(tabId);
}

async function saveAs(tabIdOverride = null) {

    const tabId = tabIdOverride || (App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId);
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.content = editor.getValue();
    const oldPath = tab.path;
    const r = await window.electronAPI.saveFileDialog({
        content: tab.content,
        defaultPath: tab.path || tab.name || 'untitled.cpp'
    });
    if (r.success) {
        tab.path = r.path;
        tab.name = r.path.split(/[/\\]/).pop();
        tab.original = tab.content;
        tab.modified = false;
        if (oldPath && oldPath !== r.path) stopFileWatch(oldPath);
        startFileWatch(r.path);
        renderTabs();
        setStatus(`Saved ${tab.name}`, 'success');
        scheduleSessionSave();
    }
}
