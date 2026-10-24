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
const pendingFileOpens = new Map();

/** A new untitled tab. `ext` picks the file type (right-click the + button); C++ by default.
 *  .cpp and .c start from their template in Settings > Template, other types empty. */
function newFile(ext = 'cpp') {
    if (typeof ext !== 'string') ext = 'cpp';   // called as a click handler
    const id = createRestoredTabId();

    const templateCode = ext === 'cpp' ? (App.settings.template?.code ?? DEFAULT_CODE)
        : ext === 'c' ? (App.settings.template?.cCode ?? DEFAULT_SETTINGS.template.cCode) : '';
    const tab = { id, name: 'untitled.' + ext, path: null, untitledHistoryKey: createUntitledHistoryKey(), content: templateCode, original: templateCode, modified: false, viewState: null };
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
        expected: expectedArea.value || '',
        inputFile: App.ioByTab[tabId]?.inputFile || null
    };
}

function restoreTabIO(tabId) {
    const inputArea = document.getElementById('input-area');
    const expectedArea = document.getElementById('expected-area');
    if (!inputArea || !expectedArea) return;

    const ioState = App.ioByTab[tabId] || { input: '', expected: '' };
    inputArea.value = ioState.input || '';
    expectedArea.value = ioState.expected || '';
    if (typeof renderOutputPanel === 'function') renderOutputPanel(App.outputByTab?.[tabId] || null);
    if (typeof renderInputFile === 'function') renderInputFile(ioState.inputFile || null);
}

function setActive(id) {
    const tab = App.tabs.find(t => t.id === id);
    if (!tab) return;

    // Any tab being shown means we need the editor — kick off the (deferred)
    // Monaco load now if it hasn't started. Idempotent and cheap when already loaded.
    ensureMonaco().catch(() => { });   // logged in initMonaco; the next call retries

    // Test cases and the Input/Expected boxes belong to the focused tab, which is
    // the right pane's when it has focus (getPreferredTabId).
    const previousTab = App.tabs.find(t => t.id === getPreferredTabId()) || null;
    const switchingTabs = !previousTab || previousTab.id !== id;
    if (previousTab && App.editor && App.ready) persistCurrentTabIO();
    if (previousTab && switchingTabs) saveTestStateToTab(previousTab);

    if (App.activeTabId && App.editor && App.ready) {
        const cur = App.tabs.find(t => t.id === App.activeTabId);
        if (cur) {
            cur.content = App.editor.getValue();
            cur.viewState = App.editor.saveViewState();
        }
    }

    App.activeTabId = id;
    // The tab is shown in the left editor, so that pane now has focus.
    App.activeEditor = 1;
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
        if (window.electronAPI?.getClangdCompletions && isCppTab(tab)) {
            window.electronAPI.getClangdCompletions(tab.path || tab.id, tab.content, 0, 0).catch(() => {});
        }
    }

    if (tab.path && window.FileExplorer?.handleFileOpened) {
        window.FileExplorer.handleFileOpened(tab.path);
    }

    restoreTabIO(id);
    if (switchingTabs) loadTestStateFromTab(tab);
    renderTabs();
    // Reset cursor tracker so presence shows Ln 1, Col 1 for the new tab
    _discordLastPos = { line: 1, col: 1 };
    if (_discordCursorTimer) { clearTimeout(_discordCursorTimer); _discordCursorTimer = null; }
    updateDiscordPresence(tab, 1, 1);
}

/**
 * clangd keeps one open document (text + AST) per path, or per tab id for an
 * untitled tab. Close the old one whenever a tab is closed or gets a new path
 * (Save As, rename, move), or it stays in clangd until the app exits.
 */
function closeClangdDocument(docId) {
    if (docId) window.electronAPI?.clangdCloseDocument?.(docId)?.catch?.(() => { });
}

/** @param {{quiet?: boolean}} [options] quiet: no prompts (the caller knows nothing is lost) */
async function closeTab(id, { quiet = false } = {}) {
    const idx = App.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = App.tabs[idx];

    if (App.isRunning && !quiet) {
        const confirmed = await showConfirmDialog({
            title: 'Process Running',
            message: `A process is running. Stop it and close "${tab.name}"?`,
            confirmText: 'Stop & Close',
            danger: true
        });
        if (!confirmed) return;
        stop();
    }

    if (tab.modified && !quiet) {
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
    closeClangdDocument(tab.path || tab.id);
    if (!tab.path && typeof LocalHistory !== 'undefined') {
        try { LocalHistory.clearUntitledHistory(tab); } catch (_) { }
    }

    delete App.tabDiagnostics[id];

    // Other tabs may have closed while the confirmation was open: the index
    // found before it may now name another (unsaved) tab.
    const at = App.tabs.indexOf(tab);
    if (at === -1) return;   // already closed by another close
    App.tabs.splice(at, 1);
    delete App.ioByTab[id];
    delete App.outputByTab[id];
    releaseRunCapture(id);


    if (App.splitTabId === id) closeSplit();

    if (App.activeTabId === id) {
        // The tab is already gone from App.tabs, so setActive() must not try
        // to save state into it; clear our decorations off its model here.
        App.activeTabId = null;
        if (App.editor && App.ready) clearEditorDecorationsBeforeSwitch();
        if (App.tabs.length) setActive(App.tabs[Math.min(at, App.tabs.length - 1)].id);
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

    // Windows and macOS ignore case: main.cpp and Main.cpp are one file and one tab.
    const normalizedPath = pathKey(filePath);

    // Check if file is already open
    const existingTab = App.tabs.find(t => t.path && pathKey(t.path) === normalizedPath);
    if (existingTab) {
        setActive(existingTab.id);
        return;
    }

    // Concurrent Explorer/session requests share one read and one tab creation.
    if (pendingFileOpens.has(normalizedPath)) return pendingFileOpens.get(normalizedPath);
    const opening = (async () => {
        try {
            let content;
            if (window.electronAPI && window.electronAPI.readFile) {
                content = await window.electronAPI.readFile(filePath);
            } else {
                console.error('[openFileFromPath] electronAPI.readFile not available');
                return;
            }

            // Another opening route may have added the tab while the read was pending.
            const openedTab = App.tabs.find(t => t.path && pathKey(t.path) === normalizedPath);
            if (openedTab) {
                setActive(openedTab.id);
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
    })();
    pendingFileOpens.set(normalizedPath, opening);
    try {
        await opening;
    } finally {
        pendingFileOpens.delete(normalizedPath);
    }
}

// Expose to window for FileExplorer
window.openFromPath = openFileFromPath;

function initFileDrop() {
    const shouldOpenFiles = event => event.dataTransfer?.types?.includes('Files')
        && !event.target.closest?.('.io-panel-input, .cat-group, input[type="file"]');

    // Capture before Monaco or Chromium can insert the file/path or navigate away.
    document.addEventListener('dragover', event => {
        if (!shouldOpenFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
    }, true);

    document.addEventListener('drop', async event => {
        if (!shouldOpenFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();

        // Snapshot the protected drag data before the first asynchronous read.
        const paths = new Set(Array.from(event.dataTransfer.files,
            file => window.electronAPI?.getPathForFile?.(file) || '').filter(Boolean));
        for (const filePath of paths) await openFileFromPath(filePath);
    }, true);
}

function renderTabs() {
    const c = document.getElementById('tabs-container');
    c.innerHTML = '';
    App.tabs.forEach(t => {
        // Every rename and Save As ends here; a new extension may mean a new language.
        syncTabLanguage(t);
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
        el.innerHTML = `<span class="tab-name">${escHtml(t.name)}</span>${diagnosticsBadge}<span class="tab-dot"></span><span class="tab-x">×</span>`;
        el.onclick = e => {
            if (!e.target.classList.contains('tab-x')) {
                if (App.isSplit && isSplitTab) {
                    focusEditorPane(2);
                } else {
                    setActive(t.id);
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
        // Scroll only the tab strip. scrollIntoView also scrolls every ancestor,
        // overflow:hidden ones included, which shifted the whole window sideways
        // once the tabs no longer fit.
        if (focusedTab) {
            const left = focusedTab.offsetLeft - (c.clientWidth - focusedTab.offsetWidth) / 2;
            c.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
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
    // Items without data-action (Run without building, Debug panel) carry their own handlers.
    document.querySelectorAll('.dropdown-item[data-action]').forEach(item => {
        item.onclick = () => { doAction(item.dataset.action); closeMenus(); };
    });
    const runMenuBtn = document.getElementById('btn-run-menu');
    if (runMenuBtn) runMenuBtn.onclick = e => { toggleMenu('menu-runbtn', runMenuBtn); e.stopPropagation(); };
    document.onclick = closeMenus;
}

function toggleMenu(id, el) {
    const menu = document.getElementById(id);
    if (activeMenu === id) { closeMenus(); return; }
    closeMenus();
    menu.classList.add('show');
    el.classList.add('active');
    const rect = el.getBoundingClientRect();
    // Keep menus opened from the right side of the header inside the window.
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    if (window.Motion) Motion.menuIn(menu);
    activeMenu = id;
}

function closeMenus() {
    document.querySelectorAll('.dropdown').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.menu-btn, .menu-trigger').forEach(b => b.classList.remove('active'));
    activeMenu = null;
}

function doAction(action) {
    const map = {
        new: newFile, open: openFile, save, saveas: () => saveAs(), run, buildrun: buildRun, stop,
        compile: compileOnly,
        mdpreview: () => window.MarkdownPreview?.toggle(getActiveEditor()),
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
// The Open dialog starts in the active file's folder, else the open Explorer folder; main falls
// back to the folder of the last file opened or saved through a dialog.
async function openFile() {
    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const tabPath = App.tabs.find(t => t.id === tabId)?.path;
    const slash = tabPath ? Math.max(tabPath.lastIndexOf('/'), tabPath.lastIndexOf('\x5c')) : -1;
    const dir = slash > 0 ? tabPath.slice(0, slash) : (window.FileExplorer?.currentFolder || '');
    await window.electronAPI.openFile({ defaultPath: dir || undefined });
}

async function save() {

    const tabId = App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId;
    const editor = App.activeEditor === 2 && App.editor2 ? App.editor2 : App.editor;

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (App.settings.editor.formatOnSave) {
        await formatCode(editor, { silent: true });
        // The editor may show another tab by now, or this one was closed: read the tab's own model.
        if (!App.tabs.includes(tab)) return;
    }
    tab.content = getTabModel(tab).getValue();

    if (tab.path) {
        // Create backup before saving (async, non-blocking)
        if (typeof LocalHistory !== 'undefined' && LocalHistory.settings.enabled) {
            LocalHistory.createBackup(tab.path, tab.content).catch(e =>
                console.warn('[LocalHistory] Backup failed:', e)
            );
        }

        const text = tab.content;
        const r = await window.electronAPI.saveFile({ path: tab.path, content: text });
        if (r && r.success) { markTabSaved(tab, text); setStatus(`Saved ${tab.name}`, 'success'); scheduleSessionSave(); }
        else {
            const reason = (r && r.error) || 'unknown error';
            setStatus(`Save failed: ${reason}`, 'error');
            log(`Could not save ${tab.name}: ${reason}`, 'error');
        }
    } else await saveAs(tabId);
}

/**
 * The text that was written becomes the tab's baseline. Typing that happened
 * while the save was in flight was not written, so the tab stays modified.
 */
function markTabSaved(tab, savedText) {
    tab.original = savedText;
    const current = tab.model && !tab.model.isDisposed() ? tab.model.getValue() : tab.content;
    tab.modified = current !== savedText;
    renderTabs();
}

/**
 * Save As onto a file that another tab has open: that tab still holds the old
 * text in its own model and would write it back on its next save. An unchanged
 * tab is closed (this one now shows the file); one with unsaved edits keeps
 * them as an untitled copy.
 */
async function releaseOtherTabsOfPath(keepTab, filePath) {
    const key = pathKey(filePath);
    const others = App.tabs.filter(t => t !== keepTab && t.path && pathKey(t.path) === key);
    for (const other of others) {
        if (other.modified) {
            closeClangdDocument(other.path);
            other.path = null;
            // a.cpp -> "a (unsaved copy).cpp": the extension picks the language and tools.
            const dot = other.name.lastIndexOf('.');
            other.name = dot > 0
                ? `${other.name.slice(0, dot)} (unsaved copy)${other.name.slice(dot)}`
                : `${other.name} (unsaved copy)`;
        } else {
            await closeTab(other.id, { quiet: true });
        }
    }
    if (others.length) renderTabs();
}

async function saveAs(tabIdOverride = null) {

    const tabId = tabIdOverride || (App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId);

    const tab = App.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.content = getTabModel(tab).getValue();
    const text = tab.content;
    const oldPath = tab.path;
    const r = await window.electronAPI.saveFileDialog({
        content: text,
        defaultPath: tab.path || tab.name || 'untitled.cpp'
    });
    if (r.success) {
        const oldDocId = tab.path || tab.id;
        tab.path = r.path;
        tab.name = r.path.split(/[/\\]/).pop();
        if (oldDocId !== tab.path) closeClangdDocument(oldDocId);
        if (oldPath && oldPath !== r.path) stopFileWatch(oldPath);
        await releaseOtherTabsOfPath(tab, r.path);
        startFileWatch(r.path);
        markTabSaved(tab, text);
        setStatus(`Saved ${tab.name}`, 'success');
        scheduleSessionSave();
    }
}

/**
 * Renames a tab. A saved file is renamed on disk first, never over another file; an untitled
 * tab only changes its name, which also sets its language and the name Save offers.
 */
async function renameTab(tabId, newName) {
    const tab = App.tabs.find(t => t.id === tabId);
    const name = String(newName || '').trim().replace(/[<>:"/\\|?*]/g, '_');
    if (!tab || !name || name === tab.name) return false;
    if (!tab.path) {
        tab.name = name;
        renderTabs();
        scheduleSessionSave();
        return true;
    }
    const cut = Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\'));
    const newPath = tab.path.slice(0, cut + 1) + name;
    try {
        await window.electronAPI.renameFile(tab.path, newPath);
    } catch (err) {
        const reason = String(err.message || err).replace(/^.*?Error: /, '');
        setStatus('error', `Rename failed: ${reason}`);
        log(`Cannot rename ${tab.name}: ${reason}`, 'error');
        return false;
    }
    onFileRenamed(tab.path, newPath);
    if (typeof FileExplorer !== 'undefined' && FileExplorer.refreshTree) FileExplorer.refreshTree();
    return true;
}

/** A file was renamed on disk (from its tab or the Explorer): open tabs and the Explorer's
 *  status, notes, pins and categories, and its breakpoints follow it. */
function onFileRenamed(oldPath, newPath) {
    const key = pathKey;
    if (typeof FileExplorer !== 'undefined' && FileExplorer.movePathState) FileExplorer.movePathState(oldPath, newPath);
    let changed = false;
    for (const tab of App.tabs) {
        if (!tab.path || key(tab.path) !== key(oldPath)) continue;
        stopFileWatch(tab.path);
        if (tab.path !== newPath) closeClangdDocument(tab.path);
        tab.path = newPath;
        tab.name = newPath.split(/[/\\]/).pop();
        startFileWatch(newPath);
        changed = true;
    }
    // After the tabs: the debugger redraws the breakpoints of the active tab's (new) path.
    window.Debugger?.onFileRenamed?.(oldPath, newPath);
    if (changed) {
        renderTabs();
        scheduleSessionSave();
    }
}

/** A folder was renamed or moved on disk: every open tab inside it follows. */
function onFolderRenamed(oldDir, newDir) {
    const prefix = pathKey(oldDir).replace(/\/+$/, '') + '/';
    const target = String(newDir).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    for (const tab of App.tabs.slice()) {
        if (!tab.path || !pathKey(tab.path).startsWith(prefix)) continue;
        onFileRenamed(tab.path, target + tab.path.replace(/\\/g, '/').slice(prefix.length));
    }
    // Files inside it that have no tab keep their approaches, pins and statuses.
    if (typeof FileExplorer !== 'undefined' && FileExplorer.moveFolderState) FileExplorer.moveFolderState(oldDir, newDir);
}

/** Turns the tab's name into a text box; Enter or clicking away renames, Esc cancels. */
function startTabRename(tabId) {
    const el = document.querySelector(`#tabs-container .tab[data-id="${CSS.escape(tabId)}"]`);
    const tab = App.tabs.find(t => t.id === tabId);
    const label = el?.querySelector('.tab-name');
    if (!tab || !label) return;
    const input = document.createElement('input');
    input.className = 'tab-rename';
    input.value = tab.name;
    input.spellcheck = false;
    const size = () => { input.style.width = Math.max(60, Math.min(260, input.value.length * 7.5 + 16)) + 'px'; };
    size();
    label.replaceWith(input);
    el.draggable = false;
    let done = false;
    const finish = async (commit) => {
        if (done) return;
        done = true;
        if (!commit || !(await renameTab(tabId, input.value))) renderTabs();
    };
    input.addEventListener('input', size);
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.focus();
    // select the name without its extension, like renaming in the Explorer
    const dot = tab.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : tab.name.length);
}
