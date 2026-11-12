/**
 * File Explorer Module - CP Edition
 * 
 * Provides a sidebar file tree for navigating and opening files.
 * Features:
 * - Toggle on/off with animation
 * - Folder selection dialog
 * - Tree view with expand/collapse
 * - File icons based on extension
 * - Resizable sidebar
 * - Contest mode with Quick Status Bar & progress
 * - Multi-approach per problem with snapshots
 * - Session timer per problem
 * - New Contest Wizard
 *
 * This file holds state, persistence, open/close, directory loading and contest/approach
 * metadata. The rest of the object is added by the files loaded right after it in index.html:
 *   file-explorer-tree.js — file collection, filtering and rendering of the tree; tree event listeners
 *   file-explorer-menus.js — status and notes, context menus, input dialogs, rename/delete/open, file icons
 *   file-explorer-approaches.js — approach versioning, pinned and recent items
 *   file-explorer-contest.js — contest mode: listeners, context menus, add/delete problem, New Contest wizard
 *   file-explorer-categories.js — categories (collections): data operations and rendering
 *   file-explorer-category-ui.js — categories (collections): listeners, drag and drop, menus, create/save dialogs
 */

const FileExplorer = {
    isOpen: false,
    wasOpenBeforeStartup: false,
    startupAutoRevealHandled: false,
    currentFolder: null,
    width: 200,
    tree: [],
    expandedFolders: new Set(),
    fileStatuses: {}, // Legacy: { path: 'working' | 'done' | 'stuck' | 'review' }
    fileNotes: {}, // { path: 'note text content' }

    // Approach versioning (legacy localStorage-based, migrated to .sameko in contest mode)
    fileApproaches: {}, // { path: { current: 'id', versions: [...] } }
    expandedFiles: new Set(), // Track which .cpp files show their children

    // Pin & Recent
    pinnedItems: [], // Array of paths
    recentFiles: [], // Last N opened files (FIFO, max 5)

    // File selection & keyboard clipboard
    selectedFilePath: null,
    clipboardFile: null, // { path, mode: 'copy' | 'cut' }

    // Chip multi-select (contest mode)
    selectedChips: new Set(),   // Set of problem IDs
    lastChipClickIdx: -1,       // For shift-range selection

    // ==================== CATEGORIES (Collections) STATE ====================
    categories: [],            // Array of category objects
    collapsedCategories: new Set(), // Set of collapsed category IDs
    dragState: null,           // { filePath, fileName } for drag-and-drop
    contestCollapsed: false,   // Whether contest problem list is collapsed
    contestSectionCollapsed: false,
    collectionsSectionCollapsed: false,
    recentSectionCollapsed: false,
    filesSectionCollapsed: false,
    showBuildFiles: false,     // compiler output (.exe, .o, .dSYM, ...) is hidden unless asked for
    hiddenBuildCount: 0,       // how many were hidden in the loaded part of the tree
    filterText: '',
    _allFiles: null,           // every file under the folder, for the filter; null = not walked yet
    _allFilesScan: null,       // { gen, promise } of the walk in progress
    _allFilesGen: 0,           // bumped on refresh, so an older walk cannot fill the cache

    // ==================== CONTEST MODE STATE ====================
    displayMode: 'normal', // 'normal' | 'contest'
    contestMeta: null,     // Parsed .sameko data for current folder
    contestFolder: null,   // The folder path recognized as contest

    // CP Status definitions (Lucide-based SVG icons)
    CP_STATUSES: {
        todo: { label: 'Not Started', color: '#555' },
        coding: { label: 'In Progress', color: '#64b5f6' },
        testing: { label: 'Testing', color: '#ffb74d' },
        ac: { label: 'Accepted', color: '#66bb6a' },
        wa: { label: 'Wrong Answer', color: '#ef5350' },
        tle: { label: 'Time Limit Exceeded', badge: 'TLE', color: '#ffa726' },
        re: { label: 'Runtime Error', color: '#ab47bc' },
    },

    // Lucide-based SVG icon strings for CP statuses
    STATUS_ICONS: {
        todo: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#555" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8" stroke-dasharray="5 5"/></svg>',
        coding: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#64b5f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
        testing: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ffb74d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31M14 9.3V1.99M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><circle cx="12" cy="16" r="1" fill="#ffb74d" stroke="none"/></svg>',
        ac: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#66bb6a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 13 10 18 19 7"/></svg>',
        wa: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ef5350" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        tle: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ffa726" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>',
        re: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ab47bc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 20h20L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
    },

    // Session Timer — on-demand, no setInterval
    SessionTimer: {
        accumulated: {},   // { problemId: ms } — loaded from .sameko
        sessionStart: null,
        currentProblem: null,

        onFileOpen(problemId) {
            if (this.currentProblem && this.sessionStart) {
                const elapsed = Date.now() - this.sessionStart;
                this.accumulated[this.currentProblem] = (this.accumulated[this.currentProblem] || 0) + elapsed;
            }
            this.currentProblem = problemId;
            this.sessionStart = Date.now();
        },

        flush() {
            if (this.currentProblem && this.sessionStart) {
                const elapsed = Date.now() - this.sessionStart;
                this.accumulated[this.currentProblem] = (this.accumulated[this.currentProblem] || 0) + elapsed;
                this.sessionStart = Date.now(); // reset start
            }
        },

        getTimeMs(problemId) {
            const saved = this.accumulated[problemId] || 0;
            const live = (problemId === this.currentProblem && this.sessionStart)
                ? Date.now() - this.sessionStart : 0;
            return saved + live;
        },

        getDisplay(problemId) {
            return FileExplorer.formatDuration(this.getTimeMs(problemId));
        },

        loadFromMeta(contestMeta) {
            if (!contestMeta || !contestMeta.problems) return;
            for (const p of contestMeta.problems) {
                this.accumulated[p.id] = p.timeSpentMs || 0;
            }
        },

        saveToMeta(contestMeta) {
            this.flush();
            if (!contestMeta || !contestMeta.problems) return;
            for (const p of contestMeta.problems) {
                p.timeSpentMs = this.accumulated[p.id] || 0;
            }
        },

        /** Start over for another contest: problem ids (A, B, …) repeat across contests. */
        reset() {
            this.accumulated = {};
            this.sessionStart = null;
            this.currentProblem = null;
        }
    },

    // SVG Icons - no emojis, all inline SVGs
    ICONS: {
        // Note icon (pencil)
        note: '<svg class="icon-note" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',

        // Pin icon
        pin: '<svg class="icon-pin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 10.76V6l-3-3h12l-3 3v4.76l3 3.24H6l3-3.24z"/></svg>',

        // Unpin icon (pin with slash)
        unpin: '<svg class="icon-unpin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 10.76V6l-3-3h12l-3 3v4.76l3 3.24H6l3-3.24z"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',

        // Save/Approach icon (branch/git)
        approach: '<svg class="icon-approach" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6M18 15V6h-9"/></svg>',

        // Checkmark icon
        check: '<svg class="icon-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',

        // X mark icon
        cross: '<svg class="icon-cross" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',

        // Clock icon (for working status)
        clock: '<svg class="icon-clock" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',

        // Timer icon (for TLE)
        timer: '<svg class="icon-timer" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3l2 2M19 3l-2 2M12 2v2"/></svg>',

        // Memory icon (for MLE)
        memory: '<svg class="icon-memory" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/></svg>',

        // Warning icon (for RTE)
        warning: '<svg class="icon-warning" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',

        // Expand arrow
        arrow: '<svg class="icon-arrow" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',

        // Recent icon (history)
        recent: '<svg class="icon-recent" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 10"/><path d="M2 12h2M20 12h2"/></svg>',

        // Collection icon
        collection: '<svg class="icon-collection" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>',

        // Submenu arrow
        submenuArrow: '<svg class="icon-submenu" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',

        // Close button (X)
        close: '<svg class="icon-close" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    },

    // Status definitions (colored dots)
    STATUS_TYPES: {
        working: { label: 'Working', color: '#ffc107', dotClass: 'status-working' },
        done: { label: 'Done', color: '#4caf50', dotClass: 'status-done' },
        stuck: { label: 'Stuck', color: '#f44336', dotClass: 'status-stuck' },
        review: { label: 'Review', color: '#2196f3', dotClass: 'status-review' }
    },

    // Approach status definitions - using SVG icons instead of emojis
    APPROACH_STATUS_TYPES: {
        working: { label: 'Working', iconKey: 'clock', color: '#ffc107' },
        ac: { label: 'Accepted', iconKey: 'check', color: '#4caf50' },
        wa: { label: 'Wrong Answer', iconKey: 'cross', color: '#f44336' },
        tle: { label: 'Time Limit Exceeded', iconKey: 'timer', color: '#ff9800' },
        mle: { label: 'Memory Limit Exceeded', iconKey: 'memory', color: '#9c27b0' },
        rte: { label: 'Runtime Error', iconKey: 'warning', color: '#f44336' }
    },

    // DOM Elements
    elements: {
        sidebar: null,
        tree: null,
        resizer: null,
        toggleBtn: null,
        openFolderBtn: null,
    },

    /**
     * Initialize the file explorer
     */
    async init() {
        this.elements.sidebar = document.getElementById('explorer-sidebar');
        this.elements.tree = document.getElementById('explorer-tree');
        this.elements.resizer = document.getElementById('explorer-resizer');
        this.elements.toggleBtn = document.getElementById('btn-toggle-explorer');
        this.elements.openFolderBtn = document.getElementById('btn-open-folder');

        if (!this.elements.sidebar) {
            console.error('[FileExplorer] Sidebar element not found!');
            return;
        }

        // Load saved state
        await this.loadStateDoc();
        this.loadState();

        // Setup event listeners
        this.setupEventListeners();

        // Setup resizer
        this.setupResizer();

        // Apply saved width
        this.elements.sidebar.style.width = this.width + 'px';

        // Render empty state initially
        this.renderEmptyState();

        // Startup rule: keep explorer closed initially.
        // It may auto-open later when a file is opened, based on previous persisted state.
        this.close();

    },

    // ---- Persistence -------------------------------------------------------
    // Everything below is one document, userData/state/explorer.json:
    //   { state: {...}, categories: { "<folder>" | "__global__": {...} } }
    // It used to be localStorage, rewritten in full on every click; approach
    // snapshots (whole files) could fill the quota and break every later save.
    // Writes are now batched and flushed when the window closes.

    _stateDoc: null,
    _stateSaveTimer: null,

    async loadStateDoc() {
        let doc = null;
        try { doc = await window.electronAPI?.stateRead?.('explorer'); } catch (_) { }
        if (!doc) doc = this.migrateLocalStorageState();
        else this.removeLegacyStateKeys();
        this._stateDoc = { state: doc?.state || null, categories: doc?.categories || {} };
        window.addEventListener('beforeunload', () => this.flushStateDoc(true));
    },

    /** One-time import of the old localStorage keys; they are removed once written. */
    migrateLocalStorageState() {
        try {
            const doc = { state: null, categories: {} };
            const legacyKeys = [];
            const saved = localStorage.getItem('explorerState');
            if (saved) { doc.state = JSON.parse(saved); legacyKeys.push('explorerState'); }
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith('explorerCategories:')) continue;
                doc.categories[key.slice('explorerCategories:'.length)] = JSON.parse(localStorage.getItem(key));
                legacyKeys.push(key);
            }
            // Oldest format: one global list, attached to the folder that was open.
            const oldGlobal = localStorage.getItem('explorerCategories');
            if (oldGlobal) {
                const folder = doc.state?.currentFolder ? this.categoriesKey(doc.state.currentFolder) : null;
                if (folder && !doc.categories[folder]) doc.categories[folder] = JSON.parse(oldGlobal);
                legacyKeys.push('explorerCategories');
            }
            if (legacyKeys.length === 0) return null;
            window.electronAPI?.stateWrite?.('explorer', doc).then((r) => {
                if (r?.success) legacyKeys.forEach((k) => localStorage.removeItem(k));
            }).catch(() => { });
            return doc;
        } catch (e) {
            console.error('[FileExplorer] Failed to migrate saved state:', e);
            return null;
        }
    },

    /** The file is authoritative once it exists; old keys are never read again. */
    removeLegacyStateKeys() {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key === 'explorerState' || key?.startsWith('explorerCategories')) keys.push(key);
            }
            keys.forEach((k) => localStorage.removeItem(k));
        } catch (_) { }
    },

    scheduleStateDocSave() {
        clearTimeout(this._stateSaveTimer);
        this._stateSaveTimer = setTimeout(() => this.flushStateDoc(false), 400);
    },

    flushStateDoc(sync) {
        if (!this._stateDoc) return;
        const pending = this._stateSaveTimer !== null;
        clearTimeout(this._stateSaveTimer);
        this._stateSaveTimer = null;
        if (sync) {
            if (pending) window.electronAPI?.stateWriteSync?.('explorer', this._stateDoc);
        } else {
            window.electronAPI?.stateWrite?.('explorer', this._stateDoc).catch(() => { });
        }
    },

    categoriesKey(folderPath) {
        return folderPath ? folderPath.replace(/\\/g, '/') : '__global__';
    },

    loadState() {
        try {
            const state = this._stateDoc?.state;
            if (state) {
                this.width = Math.max(150, Math.min(400, state.width || 200));
                this.currentFolder = state.currentFolder || null;
                this.expandedFolders = new Set(state.expandedFolders || []);
                this.fileStatuses = state.fileStatuses || {};
                this.fileNotes = state.fileNotes || {};
                this.wasOpenBeforeStartup = !!state.isOpen;
                this.isOpen = false;
                this.fileApproaches = state.fileApproaches || {};
                this.expandedFiles = new Set(state.expandedFiles || []);
                this.pinnedItems = state.pinnedItems || [];
                this.recentFiles = state.recentFiles || [];
                this.contestSectionCollapsed = !!state.contestSectionCollapsed;
                this.collectionsSectionCollapsed = !!state.collectionsSectionCollapsed;
                this.recentSectionCollapsed = !!state.recentSectionCollapsed;
                this.filesSectionCollapsed = !!state.filesSectionCollapsed;
                this.showBuildFiles = !!state.showBuildFiles;
                this.activeContestId = state.activeContestId || null;
            }
            this.loadCategoriesForFolder(this.currentFolder);
        } catch (e) {
            console.error('Failed to load explorer state:', e);
        }
    },

    saveState() {
        // Nothing to save into until the document has loaded; saving defaults
        // here would overwrite the user's state.
        if (!this._stateDoc) return;
        this._stateDoc.state = {
            width: this.width,
            currentFolder: this.currentFolder,
            expandedFolders: Array.from(this.expandedFolders),
            fileStatuses: this.fileStatuses,
            fileNotes: this.fileNotes,
            isOpen: this.isOpen,
            fileApproaches: this.fileApproaches,
            expandedFiles: Array.from(this.expandedFiles),
            pinnedItems: this.pinnedItems,
            recentFiles: this.recentFiles,
            contestSectionCollapsed: this.contestSectionCollapsed,
            collectionsSectionCollapsed: this.collectionsSectionCollapsed,
            recentSectionCollapsed: this.recentSectionCollapsed,
            filesSectionCollapsed: this.filesSectionCollapsed,
            showBuildFiles: this.showBuildFiles,
            activeContestId: this.activeContestId,
        };
        this.saveCategoriesForFolder(this.currentFolder);
    },

    loadCategoriesForFolder(folderPath) {
        this.categories = [];
        this.collapsedCategories = new Set();
        const catData = this._stateDoc?.categories[this.categoriesKey(folderPath)];
        if (!catData) return;
        this.categories = catData.categories || [];
        // Ensure all loaded categories have a color and an item list
        this.categories.forEach((cat, index) => {
            if (!Array.isArray(cat.items)) cat.items = [];
            if (!cat.color) {
                cat.color = this.CATEGORY_COLORS[index % this.CATEGORY_COLORS.length];
            }
        });
        this.collapsedCategories = new Set(catData.collapsedCategories || []);
    },

    saveCategoriesForFolder(folderPath) {
        if (!this._stateDoc) return;
        this._stateDoc.categories[this.categoriesKey(folderPath)] = {
            categories: this.categories,
            collapsedCategories: Array.from(this.collapsedCategories),
        };
        this.scheduleStateDocSave();
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (this.elements.toggleBtn) {
            this.elements.toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggle();
            });
        } else {
            console.warn('[FileExplorer] Toggle button not found!');
        }

        // Open folder button
        if (this.elements.openFolderBtn) {
            this.elements.openFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openFolderDialog();
            });
        }

        document.getElementById('btn-explorer-new-file')?.addEventListener('click', () => this.promptNewFile());
        document.getElementById('btn-explorer-refresh')?.addEventListener('click', () => this.refreshTree());

        const filter = document.getElementById('explorer-filter');
        const clear = document.getElementById('explorer-filter-clear');
        if (filter) {
            filter.addEventListener('input', () => this.setFilter(filter.value));
            filter.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { filter.value = ''; this.setFilter(''); filter.blur(); }
                // Enter opens the first match.
                if (e.key === 'Enter') {
                    const first = this.elements.tree.querySelector('.explorer-item.file.filter-hit');
                    if (first) this.openFile(first.dataset.path);
                }
            });
            clear?.addEventListener('click', (e) => {
                e.preventDefault();
                filter.value = '';
                this.setFilter('');
                filter.focus();
            });
        }

        // Keyboard shortcuts when explorer is open and a file is selected
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen || !this.selectedFilePath) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            this.handleExplorerKeydown(e);
        });
    },

    /**
     * Toggle explorer open/close
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    /**
     * Open the explorer sidebar
     */
    open() {
        this.isOpen = true;
        this.elements.sidebar.classList.add('visible');
        this.elements.resizer.classList.add('visible');
        if (this.elements.toggleBtn) {
            this.elements.toggleBtn.classList.add('active');
        }

        // If we have a saved folder, load it
        if (this.currentFolder) {
            this.refreshTree();
        }

        this.saveState();

        // Trigger editor layout
        setTimeout(() => {
            if (window.App && window.App.editor) {
                window.App.editor.layout();
            }
            if (window.App && window.App.editor2) {
                window.App.editor2.layout();
            }
        }, 250);
    },

    /**
     * Close the explorer sidebar
     */
    close() {
        this.isOpen = false;
        this.elements.sidebar.classList.remove('visible');
        this.elements.resizer.classList.remove('visible');
        if (this.elements.toggleBtn) {
            this.elements.toggleBtn.classList.remove('active');
        }

        // Flush timer data to .sameko before saving state
        if (this.displayMode === 'contest' && this.contestMeta && this.contestFolder) {
            this.SessionTimer.flush();
            this.SessionTimer.saveToMeta(this.contestMeta);
            this.saveContestMeta(this.contestFolder, this.contestMeta);
        }

        this.saveState();

        // Trigger editor layout
        setTimeout(() => {
            if (window.App && window.App.editor) {
                window.App.editor.layout();
            }
            if (window.App && window.App.editor2) {
                window.App.editor2.layout();
            }
        }, 250);
    },

    /**
     * Setup the resizer for dragging
     */
    setupResizer() {
        if (!this.elements.resizer) return;

        let startX, startWidth;

        const onMouseMove = (e) => {
            const newWidth = startWidth + (e.clientX - startX);
            if (newWidth >= 150 && newWidth <= 400) {
                this.width = newWidth;
                this.elements.sidebar.style.width = newWidth + 'px';
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            this.saveState();

            // Trigger editor layout
            if (window.App && window.App.editor) {
                window.App.editor.layout();
            }
            if (window.App && window.App.editor2) {
                window.App.editor2.layout();
            }
        };

        this.elements.resizer.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            startWidth = this.width;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
    },

    /**
     * Open folder dialog via Electron IPC
     */
    async openFolderDialog() {
        try {
            if (window.electronAPI && window.electronAPI.showOpenDialog) {
                const result = await window.electronAPI.showOpenDialog({
                    properties: ['openDirectory']
                });

                if (!result.canceled && result.filePaths.length > 0) {
                    // Migrate global categories to the new folder if needed
                    const globalCats = this.categories.filter(c => !c.folderPath);
                    this.currentFolder = result.filePaths[0];
                    this.filterText = '';
                    const filterInput = document.getElementById('explorer-filter');
                    if (filterInput) filterInput.value = '';
                    document.getElementById('explorer-filter-clear')?.classList.add('hidden');
                    this.expandedFolders.clear();
                    this.expandedFolders.add(this.currentFolder);
                    this.loadCategoriesForFolder(this.currentFolder);

                    // Merge in any orphaned global categories
                    if (globalCats.length > 0 && this.categories.length === 0) {
                        for (const cat of globalCats) {
                            const sanitizedName = cat.name.replace(/[<>:"/\\|?*]/g, '_');
                            cat.folderPath = `${this.currentFolder}/${sanitizedName}`.replace(/\\/g, '/');
                            this.categories.push(cat);
                        }
                        this.saveCategoriesForFolder(this.currentFolder);
                        // Clear global storage
                        if (this._stateDoc) delete this._stateDoc.categories.__global__;
                    }

                    await this.refreshTree();
                    this.saveState();
                }
            } else {
                console.warn('Electron API not available for folder dialog');
            }
        } catch (e) {
            console.error('Failed to open folder dialog:', e);
        }
    },

    /**
     * Refresh the tree view
     */
    async refreshTree() {
        if (!this.currentFolder) {
            this.renderEmptyState();
            return;
        }

        try {
            if (window.electronAPI && window.electronAPI.readDirectory) {
                this.tree = await this.loadDirectory(this.currentFolder);
                this._allFiles = null;
                this._allFilesGen++;
                if (this.filterText) await this.collectAllFiles();

                // Determine display mode (contest or normal)
                this.displayMode = this.resolveDisplayMode(this.currentFolder, this.tree);

                if (this.displayMode === 'contest') {
                    if (this.contestFolder !== this.currentFolder) this.leaveContest();
                    this.contestFolder = this.currentFolder;
                    // Load .sameko if exists
                    const meta = await this.loadContestMeta(this.currentFolder);
                    if (meta) {
                        this.contestMeta = meta;
                        this.SessionTimer.loadFromMeta(meta);
                    } else {
                        // Auto-generate .sameko from detected files
                        this.contestMeta = this.generateContestMeta(this.tree);
                        await this.saveContestMeta(this.currentFolder, this.contestMeta);
                        this.SessionTimer.loadFromMeta(this.contestMeta);
                    }
                } else if (this.contestFolder) {
                    this.leaveContest();
                }

                // Sync collection folders with disk contents
                await this.syncAllCategories();

                this.renderTree();
            } else {
                console.warn('Electron API not available for reading directory');
                this.renderEmptyState();
            }
        } catch (e) {
            console.error('Failed to refresh tree:', e);
            this.renderEmptyState();
        }
    },

    /**
     * Auto-generate contest metadata from detected files
     */
    generateContestMeta(items) {
        const problems = [];
        for (const item of items) {
            if (!item.isDirectory && /^[A-Z]\.(cpp|c|cc|cxx)$/i.test(item.name)) {
                const id = item.name.charAt(0).toUpperCase();
                problems.push({
                    id,
                    fileName: item.name,   // A.c / B.cc: not always <id>.cpp
                    label: '',
                    status: 'todo',
                    timeSpentMs: 0,
                    activeApproach: null,
                    approaches: []
                });
            }
        }
        problems.sort((a, b) => a.id.localeCompare(b.id));

        const folderName = this.currentFolder.split(/[/\\]/).pop();
        return {
            type: 'contest',
            name: folderName,
            platform: 'Other',
            date: new Date().toISOString().split('T')[0],
            problems
        };
    },

    /**
     * Load directory contents recursively
     */
    async loadDirectory(dirPath, depth = 0, stats = { hidden: 0 }) {
        if (depth > 10) return []; // Max depth protection

        try {
            const items = await window.electronAPI.readDirectory(dirPath);
            const result = [];
            let hasSameko = false;

            for (const item of items) {
                const fullPath = `${dirPath}/${item.name}`.replace(/\\/g, '/');

                // Detect .sameko file but don't add to tree
                if (item.name === '.sameko') {
                    hasSameko = true;
                    continue;
                }

                // Skip hidden files and common ignored directories
                if (item.name.startsWith('.') ||
                    item.name === 'node_modules' ||
                    item.name === '__pycache__') {
                    continue;
                }

                // Compiler output is counted, and shown only when the user asks for it.
                const isBuild = this.isBuildOutput(item.name, item.isDirectory);
                if (isBuild && !this.showBuildFiles) {
                    stats.hidden++;
                    continue;
                }

                const entry = {
                    name: item.name,
                    path: fullPath,
                    isDirectory: item.isDirectory,
                    isBuild,
                    children: null,
                };

                // Load children if folder is expanded
                if (item.isDirectory && this.expandedFolders.has(fullPath)) {
                    entry.children = await this.loadDirectory(fullPath, depth + 1, stats);
                }

                result.push(entry);
            }

            // Sort: folders first, then alphabetically
            // Then group companion files (.inp, .out) with their .cpp parent
            const sorted = result.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            // Group companion files with their parent .cpp
            const grouped = this.groupCompanionFiles(sorted);

            // Auto-detect contest mode for root-level folder
            if (depth === 0) {
                grouped._hasSameko = hasSameko;
                // Per call, so two loads running at once cannot add to each other's count.
                this.hiddenBuildCount = stats.hidden;
            }

            return grouped;
        } catch (e) {
            console.error('Failed to load directory:', dirPath, e);
            return [];
        }
    },

    /**
     * Detect folder type based on file patterns
     */
    detectFolderType(items) {
        const singleLetterCpp = items.filter(
            i => !i.isDirectory && /^[A-Z]\.(cpp|c|cc|cxx)$/i.test(i.name)
        );
        if (singleLetterCpp.length >= 2) return 'contest';
        return 'normal';
    },

    /**
     * Resolve display mode: .sameko > manual override > auto-detect
     */
    resolveDisplayMode(folderPath, items) {
        if (items._hasSameko) return 'contest';

        const manualOverride = localStorage.getItem(`cp-mode:${folderPath}`);
        if (manualOverride) return manualOverride;

        return this.detectFolderType(items);
    },

    /**
     * Save the active contest's metadata (with the time spent so far) and stop
     * editing it. Called before another contest becomes the active one, so a
     * status change can never write one contest's .sameko into another folder.
     */
    leaveContest() {
        if (this.contestMeta && this.contestFolder && window.electronAPI?.writeSameko) {
            this.SessionTimer.saveToMeta(this.contestMeta);
            window.electronAPI.writeSameko(this.contestFolder, this.contestMeta).catch(() => { });
        }
        this.SessionTimer.reset();
        this.contestMeta = null;
        this.contestFolder = null;
    },

    /**
     * Older versions numbered a new approach by the count of approaches, so
     * after a deletion two could share an id and picking the newer one loaded
     * the older. Give each later duplicate an unused id.
     */
    dedupeApproachIds(meta) {
        for (const prob of (meta && Array.isArray(meta.problems) ? meta.problems : [])) {
            if (!Array.isArray(prob.approaches)) continue;
            const seen = new Set();
            for (const a of prob.approaches) {
                if (!a || !seen.has(a.id)) { if (a) seen.add(a.id); continue; }
                a.id = this.nextApproachId(prob);
                seen.add(a.id);
            }
        }
        return meta;
    },

    /** v1, v2, … : one more than the highest number in use (deleting v2 of v1..v3 gives v4 next). */
    nextApproachId(prob) {
        const used = (prob.approaches || [])
            .map(a => parseInt(String(a && a.id || '').replace(/^v/, ''), 10))
            .filter(n => Number.isFinite(n));
        return 'v' + (Math.max((prob.approaches || []).length, 0, ...used) + 1);
    },

    /**
     * Load .sameko metadata for a contest folder
     */
    async loadContestMeta(folderPath) {
        if (!window.electronAPI || !window.electronAPI.readSameko) return null;
        try {
            const result = await window.electronAPI.readSameko(folderPath);
            if (result.exists && result.data) {
                return this.dedupeApproachIds(result.data);
            }
        } catch (e) {
            console.error('[FileExplorer] Failed to load .sameko:', e);
        }
        return null;
    },

    /**
     * Save .sameko metadata for a contest folder
     */
    async saveContestMeta(folderPath, data) {
        if (!window.electronAPI || !window.electronAPI.writeSameko) return;
        try {
            // Flush timer data before saving
            this.SessionTimer.saveToMeta(data);
            await window.electronAPI.writeSameko(folderPath, data);
        } catch (e) {
            console.error('[FileExplorer] Failed to save .sameko:', e);
        }
    },

    /**
     * Get problem metadata by ID from contestMeta
     */
    getProblemMeta(problemId) {
        if (!this.contestMeta || !this.contestMeta.problems) return null;
        return this.contestMeta.problems.find(p => p.id === problemId);
    },

    /** The source file of a contest problem (its recorded name, else <id>.cpp). */
    problemFilePath(problemId) {
        const prob = this.getProblemMeta(problemId);
        // .sameko is untrusted: only a plain file name inside the contest folder
        // (no separators, no "..") is used, so delete cannot reach outside it.
        const recorded = prob && typeof prob.fileName === 'string' ? prob.fileName : '';
        const safe = recorded && !/[\\/:]/.test(recorded) && recorded !== '.' && recorded !== '..';
        const name = safe ? recorded : `${String(problemId).replace(/[\\/:]|\.\./g, '_')}.cpp`;
        return `${this.contestFolder}/${name}`.replace(/\\/g, '/');
    },

    /**
     * Delete one problem's file. True when it is gone (also when it was already
     * missing); a failure is reported and keeps the problem's data.
     */
    async deleteProblemFile(problemId) {
        if (!window.electronAPI || !window.electronAPI.deleteFile) return true;
        try {
            await window.electronAPI.deleteFile(this.problemFilePath(problemId));
            return true;
        } catch (err) {
            const message = String(err && err.message || err);
            if (/ENOENT/.test(message)) return true;
            alert(`Could not delete problem ${problemId}: ${message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')}`);
            return false;
        }
    },

    /**
     * Set problem status in contestMeta and save
     */
    async setProblemStatus(problemId, status) {
        if (!this.contestMeta) return;
        let prob = this.contestMeta.problems.find(p => p.id === problemId);
        if (!prob) {
            prob = { id: problemId, label: '', status: 'todo', timeSpentMs: 0, approaches: [] };
            this.contestMeta.problems.push(prob);
        }
        prob.status = status;
        await this.saveContestMeta(this.contestFolder, this.contestMeta);
        this.renderTree();
    },

    /**
     * Auto-update problem/category item status based on build/run events.
     * Called from app.js when compiling/running files.
     * @param {string} filePath - The file being compiled/run
     * @param {'compile-start'|'compile-ok'|'compile-fail'|'run-start'|'run-exit-0'|'run-exit-fail'} event
     */
    notifyBuildEvent(filePath, event) {
        if (!filePath) return;
        const normalizedPath = filePath.replace(/\\/g, '/');
        const fileName = normalizedPath.split('/').pop();
        const problemId = fileName.replace(/\.[^.]+$/, '').toUpperCase();

        // Determine new status from event, considering current status
        const getNewStatus = (currentStatus) => {
            switch (event) {
                case 'compile-start':
                    // Only upgrade from todo
                    return currentStatus === 'todo' ? 'coding' : null;
                case 'compile-ok':
                    return currentStatus === 'todo' ? 'coding' : null;
                case 'compile-fail':
                    // Compile error = still coding
                    return currentStatus === 'todo' ? 'coding' : currentStatus === 'testing' ? 'coding' : null;
                case 'run-start':
                    // Running = testing for any non-testing state
                    return currentStatus === 'testing' ? null : 'testing';
                case 'run-exit-0':
                    // Clean exit — keep testing, compareOutput will determine AC/WA later
                    return null;
                case 'run-exit-fail':
                    // Non-zero exit = RE
                    return 're';
                case 'edit':
                    // Editing means back to in-progress
                    return currentStatus === 'todo' ? 'coding' : currentStatus === 'coding' ? null : 'coding';
                case 'judge-ac':
                    return 'ac';
                case 'judge-wa':
                    return 'wa';
                case 'judge-tle':
                    return 'tle';
                case 'judge-re':
                case 'judge-rte':
                    return 're';
                default:
                    return null;
            }
        };

        let changed = false;

        // 1) Update contest problem (main contest mode), only for a file in the
        // contest's own folder: another folder's A.cpp is not this contest's A.
        const key = (p) => (typeof pathKey === 'function' ? pathKey(p) : String(p || '').replace(/\\/g, '/'));
        const inContest = !!this.contestFolder
            && key(normalizedPath.slice(0, normalizedPath.lastIndexOf('/'))) === key(this.contestFolder).replace(/\/+$/, '');
        if (inContest && this.contestMeta && this.contestMeta.problems) {
            const prob = this.contestMeta.problems.find(p => p.id === problemId || p.id === problemId.toLowerCase());
            if (prob) {
                const ns = getNewStatus(prob.status);
                if (ns && prob.status !== ns) {
                    prob.status = ns;
                    this.saveContestMeta(this.contestFolder, this.contestMeta);
                    changed = true;
                }
            }
        }

        // 2) Update category items that reference this file
        for (const cat of this.categories) {
            for (const item of cat.items) {
                const itemPath = (item.filePath || '').replace(/\\/g, '/');
                if (itemPath === normalizedPath) {
                    const ns = getNewStatus(item.status);
                    if (ns && item.status !== ns) {
                        item.status = ns;
                        changed = true;
                    }
                }
            }
        }

        if (changed) {
            this.saveState();
            this.renderTree();
        }
    },

    /** The open tab of a file, or null. */
    findOpenTab(filePath) {
        const app = window.App;
        if (!app || !Array.isArray(app.tabs) || !filePath) return null;
        const key = (p) => (typeof pathKey === 'function' ? pathKey(p) : String(p || '').replace(/\\/g, '/'));
        const target = key(filePath);
        return app.tabs.find(t => t.path && key(t.path) === target) || null;
    },

    /** Current text of a file: its tab's document when open, else the file on disk (null if unreadable). */
    async readCurrentFileText(filePath) {
        const tab = this.findOpenTab(filePath);
        if (tab) {
            return tab.model && !tab.model.isDisposed() ? tab.model.getValue() : (tab.content || '');
        }
        try {
            return await window.electronAPI.readFile(filePath);
        } catch (err) {
            console.error('[FileExplorer] Could not read file:', err);
            return null;
        }
    },

    /** Replace the whole text of a tab as one undoable edit; the tab becomes modified. */
    replaceTabText(tab, text) {
        const model = tab.model && !tab.model.isDisposed()
            ? tab.model
            : (typeof getTabModel === 'function' ? getTabModel(tab) : null);
        if (model) {
            model.pushStackElement();
            model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
            model.pushStackElement();
        }
        tab.content = text;
        tab.modified = text !== tab.original;
        window.App?.renderTabs?.();
    },

    /**
     * Save a problem's current code as a new approach in .sameko.
     * @param {string} [filePath] the problem's source file; its own text is saved,
     *   not whatever the editor happens to show.
     */
    async saveApproachToMeta(problemId, name, filePath) {
        if (!this.contestMeta) return;
        const prob = this.getProblemMeta(problemId);
        if (!prob) return;

        let content = '';
        if (filePath) {
            content = await this.readCurrentFileText(filePath);
            if (content === null) {
                alert('Cannot save approach - the file could not be read.');
                return;
            }
        } else if (window.App && window.App.editor) {
            content = window.App.editor.getValue();
        }
        if (!content) return;

        if (!Array.isArray(prob.approaches)) prob.approaches = [];
        const id = this.nextApproachId(prob);
        const approach = {
            id,
            name: name || `Approach ${id.slice(1)}`,
            status: prob.status || 'coding',
            savedAt: new Date().toISOString(),
            snapshot: content
        };
        prob.approaches.push(approach);
        prob.activeApproach = id;

        await this.saveContestMeta(this.contestFolder, this.contestMeta);
        this.renderTree();
    },

    /**
     * Load an approach snapshot into its problem's tab (opened first if needed).
     * Applied as one undoable edit, so Ctrl+Z brings the previous code back.
     */
    async loadApproachFromMeta(problemId, approachId, filePath) {
        if (!this.contestMeta) return;
        const prob = this.getProblemMeta(problemId);
        if (!prob) return;

        const approach = prob.approaches.find(a => a.id === approachId);
        if (!approach || !approach.snapshot) return;

        if (filePath) await this.openFile(filePath);
        const tab = filePath ? this.findOpenTab(filePath) : null;
        if (!tab) return;

        // Unsaved edits are about to be replaced: ask first (Ctrl+Z still undoes it).
        const current = tab.model && !tab.model.isDisposed() ? tab.model.getValue() : (tab.content || '');
        if (current !== approach.snapshot && tab.modified
            && !confirm(`Load approach "${approach.name || approach.id}"?\n\nYour unsaved changes in ${tab.name} will be replaced (Ctrl+Z can bring them back).`)) {
            return;
        }

        prob.activeApproach = approachId;
        if (current !== approach.snapshot) this.replaceTabText(tab, approach.snapshot);

        this.saveContestMeta(this.contestFolder, this.contestMeta);
        this.renderTree();
    },

    /**
     * Delete approach from .sameko
     */
    async deleteApproachFromMeta(problemId, approachId) {
        if (!this.contestMeta) return;
        const prob = this.getProblemMeta(problemId);
        if (!prob) return;

        const idx = prob.approaches.findIndex(a => a.id === approachId);
        if (idx === -1) return;

        prob.approaches.splice(idx, 1);
        if (prob.activeApproach === approachId) {
            prob.activeApproach = prob.approaches.length > 0 ? prob.approaches[0].id : null;
        }

        await this.saveContestMeta(this.contestFolder, this.contestMeta);
        this.renderTree();
    },

    /**
     * Format milliseconds to human-readable duration
     */
    formatDuration(ms) {
        if (!ms || ms <= 0) return '';
        if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
        if (ms < 3600000) return `${Math.floor(ms / 60000)} min`;
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return `${h}h ${m}m`;
    },

    /**
     * Format a date string to a relative label (e.g. "today", "3d ago", "Jan 15")
     */
    _formatRelativeDate(dateStr) {
        try {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (diffDays === 0) return 'today';
            if (diffDays === 1) return 'yesterday';
            if (diffDays < 7) return `${diffDays}d ago`;
            if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const sameYear = date.getFullYear() === now.getFullYear();
            if (sameYear) return `${months[date.getMonth()]} ${date.getDate()}`;
            return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
        } catch (_) {
            return '';
        }
    },

};

// Export for use in app.js
window.FileExplorer = FileExplorer;
