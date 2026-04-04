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
 */

const FileExplorer = {
    isOpen: false,
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
        tle: { label: 'Time Limit', color: '#ffa726' },
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
        tle: { label: 'Time Limit', iconKey: 'timer', color: '#ff9800' },
        mle: { label: 'Memory Limit', iconKey: 'memory', color: '#9c27b0' },
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
    init() {
        console.log('[FileExplorer] Initializing...');

        this.elements.sidebar = document.getElementById('explorer-sidebar');
        this.elements.tree = document.getElementById('explorer-tree');
        this.elements.resizer = document.getElementById('explorer-resizer');
        this.elements.toggleBtn = document.getElementById('btn-toggle-explorer');
        this.elements.openFolderBtn = document.getElementById('btn-open-folder');

        console.log('[FileExplorer] Found elements:', {
            sidebar: !!this.elements.sidebar,
            tree: !!this.elements.tree,
            resizer: !!this.elements.resizer,
            toggleBtn: !!this.elements.toggleBtn,
            openFolderBtn: !!this.elements.openFolderBtn
        });

        if (!this.elements.sidebar) {
            console.error('[FileExplorer] Sidebar element not found!');
            return;
        }

        // Load saved state
        this.loadState();

        // Setup event listeners
        this.setupEventListeners();

        // Setup resizer
        this.setupResizer();

        // Apply saved width
        this.elements.sidebar.style.width = this.width + 'px';

        // Render empty state initially
        this.renderEmptyState();

        // If was open before, restore state
        if (this.isOpen) {
            this.elements.sidebar.classList.add('visible');
            this.elements.resizer.classList.add('visible');
            if (this.elements.toggleBtn) {
                this.elements.toggleBtn.classList.add('active');
            }
            if (this.currentFolder) {
                this.refreshTree();
            }
        }

        console.log('[FileExplorer] Initialization complete');
    },

    /**
     * Load saved state from localStorage
     */
    loadState() {
        try {
            const saved = localStorage.getItem('explorerState');
            if (saved) {
                const state = JSON.parse(saved);
                this.width = Math.max(150, Math.min(400, state.width || 200));
                this.currentFolder = state.currentFolder || null;
                this.expandedFolders = new Set(state.expandedFolders || []);
                this.fileStatuses = state.fileStatuses || {};
                this.fileNotes = state.fileNotes || {};
                this.isOpen = state.isOpen || false;

                // NEW: Load approach versions, expanded files, pins, and recent
                this.fileApproaches = state.fileApproaches || {};
                this.expandedFiles = new Set(state.expandedFiles || []);
                this.pinnedItems = state.pinnedItems || [];
                this.recentFiles = state.recentFiles || [];
                this.contestSectionCollapsed = !!state.contestSectionCollapsed;
                this.collectionsSectionCollapsed = !!state.collectionsSectionCollapsed;
            }

            // Load categories for the current folder (per-folder storage)
            this.loadCategoriesForFolder(this.currentFolder);

            // Migrate old global categories to current folder (one-time)
            if (this.categories.length === 0 && this.currentFolder) {
                try {
                    const oldGlobal = localStorage.getItem('explorerCategories');
                    if (oldGlobal) {
                        const oldData = JSON.parse(oldGlobal);
                        if (oldData.categories && oldData.categories.length > 0) {
                            this.categories = oldData.categories;
                            this.collapsedCategories = new Set(oldData.collapsedCategories || []);
                            this.saveCategoriesForFolder(this.currentFolder);
                            localStorage.removeItem('explorerCategories');
                        }
                    }
                } catch (_) { }
            }
        } catch (e) {
            console.error('Failed to load explorer state:', e);
        }
    },

    /**
     * Save state to localStorage
     */
    saveState() {
        try {
            const state = {
                width: this.width,
                currentFolder: this.currentFolder,
                expandedFolders: Array.from(this.expandedFolders),
                fileStatuses: this.fileStatuses,
                fileNotes: this.fileNotes,
                isOpen: this.isOpen,

                // NEW: Save approach versions, expanded files, pins, and recent
                fileApproaches: this.fileApproaches,
                expandedFiles: Array.from(this.expandedFiles),
                pinnedItems: this.pinnedItems,
                recentFiles: this.recentFiles,
                contestSectionCollapsed: this.contestSectionCollapsed,
                collectionsSectionCollapsed: this.collectionsSectionCollapsed,
            };
            localStorage.setItem('explorerState', JSON.stringify(state));

            // Save categories for the current folder (per-folder storage)
            this.saveCategoriesForFolder(this.currentFolder);
        } catch (e) {
            console.error('Failed to save explorer state:', e);
        }
    },

    /**
     * Load categories for a specific folder from localStorage
     */
    loadCategoriesForFolder(folderPath) {
        this.categories = [];
        this.collapsedCategories = new Set();
        // Use a global fallback key when no folder is open
        const key = folderPath
            ? 'explorerCategories:' + folderPath.replace(/\\/g, '/')
            : 'explorerCategories:__global__';
        try {
            const catSaved = localStorage.getItem(key);
            if (catSaved) {
                const catData = JSON.parse(catSaved);
                this.categories = catData.categories || [];
                this.collapsedCategories = new Set(catData.collapsedCategories || []);
            }
        } catch (e) {
            console.error('[FileExplorer] Failed to load categories:', e);
        }
    },

    /**
     * Save categories for the current folder to localStorage
     */
    saveCategoriesForFolder(folderPath) {
        // Use a global fallback key when no folder is open
        const key = folderPath
            ? 'explorerCategories:' + folderPath.replace(/\\/g, '/')
            : 'explorerCategories:__global__';
        try {
            localStorage.setItem(key, JSON.stringify({
                categories: this.categories,
                collapsedCategories: Array.from(this.collapsedCategories),
            }));
        } catch (e) {
            console.error('[FileExplorer] Failed to save categories:', e);
        }
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (this.elements.toggleBtn) {
            console.log('[FileExplorer] Attaching click handler to toggle button');
            this.elements.toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[FileExplorer] Toggle button clicked');
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
                console.log('[FileExplorer] Open folder button clicked');
                this.openFolderDialog();
            });
        }

        // Refresh handled automatically — no separate button needed

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
        console.log('[FileExplorer] Toggle called, isOpen:', this.isOpen);
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
                        try { localStorage.removeItem('explorerCategories:__global__'); } catch (_) { }
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

                // Determine display mode (contest or normal)
                this.displayMode = this.resolveDisplayMode(this.currentFolder, this.tree);

                if (this.displayMode === 'contest') {
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
                } else {
                    this.contestMeta = null;
                    this.contestFolder = null;
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
    async loadDirectory(dirPath, depth = 0) {
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

                // Skip hidden files, common ignored directories, and .exe files
                if (item.name.startsWith('.') ||
                    item.name === 'node_modules' ||
                    item.name === '__pycache__' ||
                    item.name.endsWith('.exe') ||
                    item.name.endsWith('.o') ||
                    item.name.endsWith('.obj')) {
                    continue;
                }

                const entry = {
                    name: item.name,
                    path: fullPath,
                    isDirectory: item.isDirectory,
                    children: null,
                };

                // Load children if folder is expanded
                if (item.isDirectory && this.expandedFolders.has(fullPath)) {
                    entry.children = await this.loadDirectory(fullPath, depth + 1);
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
     * Load .sameko metadata for a contest folder
     */
    async loadContestMeta(folderPath) {
        if (!window.electronAPI || !window.electronAPI.readSameko) return null;
        try {
            const result = await window.electronAPI.readSameko(folderPath);
            if (result.exists && result.data) {
                return result.data;
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
                    // Non-zero exit = RE (unless already AC)
                    return (currentStatus !== 'ac') ? 're' : null;
                case 'edit':
                    // Editing means back to in-progress
                    return currentStatus === 'todo' ? 'coding' : currentStatus === 'coding' ? null : 'coding';
                case 'judge-ac':
                    return 'ac';
                case 'judge-wa':
                    return (currentStatus !== 'ac') ? 'wa' : null;
                default:
                    return null;
            }
        };

        let changed = false;

        // 1) Update contest problem (main contest mode)
        if (this.contestMeta && this.contestMeta.problems) {
            const prob = this.contestMeta.problems.find(p => p.id === problemId || p.id === problemId.toLowerCase());
            if (prob) {
                const ns = getNewStatus(prob.status);
                if (ns) {
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
                    if (ns) {
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

    /**
     * Save current editor content as a new approach in .sameko
     */
    async saveApproachToMeta(problemId, name) {
        if (!this.contestMeta) return;
        const prob = this.getProblemMeta(problemId);
        if (!prob) return;

        let content = '';
        if (window.App && window.App.editor) {
            content = window.App.editor.getValue();
        }
        if (!content) return;

        const id = 'v' + (prob.approaches.length + 1);
        const approach = {
            id,
            name: name || `Approach ${prob.approaches.length + 1}`,
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
     * Load approach snapshot into editor
     */
    loadApproachFromMeta(problemId, approachId) {
        if (!this.contestMeta) return;
        const prob = this.getProblemMeta(problemId);
        if (!prob) return;

        const approach = prob.approaches.find(a => a.id === approachId);
        if (!approach || !approach.snapshot) return;

        prob.activeApproach = approachId;

        if (window.App && window.App.editor) {
            const model = window.App.editor.getModel();
            if (model) {
                model.setValue(approach.snapshot);
            }
        }

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

    /**
     * Group companion files (.inp, .out, .txt) with their parent .cpp files
     */
    groupCompanionFiles(items) {
        const cppFiles = new Map(); // baseName -> cpp item
        const companionExts = ['.inp', '.out', '.txt', '.in', '.ans'];

        // First pass: find all .cpp files
        for (const item of items) {
            if (!item.isDirectory && /\.(cpp|c|cc|cxx)$/i.test(item.name)) {
                const baseName = item.name.replace(/\.[^.]+$/, '').toLowerCase();
                cppFiles.set(baseName, item);
                item.companions = [];
            }
        }

        // Second pass: attach companions to their parent
        const result = [];
        const attached = new Set();

        for (const item of items) {
            if (item.isDirectory) {
                result.push(item);
                continue;
            }

            const ext = item.name.substring(item.name.lastIndexOf('.')).toLowerCase();
            const baseName = item.name.replace(/\.[^.]+$/, '').toLowerCase();

            // Check if this is a companion file
            if (companionExts.includes(ext) && cppFiles.has(baseName)) {
                const parent = cppFiles.get(baseName);
                parent.companions.push(item);
                attached.add(item.path);
            }
        }

        // Third pass: build final list
        for (const item of items) {
            if (item.isDirectory) continue;
            if (attached.has(item.path)) continue;
            result.push(item);
        }

        return result;
    },

    /**
     * Render the file tree
     */
    renderTree() {
        if (!this.elements.tree) return;

        if ((!this.tree || this.tree.length === 0) && !this.currentFolder) {
            this.renderEmptyState();
            return;
        }

        // If folder is open but tree is empty, show contest section + categories + new file option
        if ((!this.tree || this.tree.length === 0) && this.currentFolder) {
            const contestSectionHtml = this.renderContestSection();
            const categoriesHtml = this.renderCategories();
            this.elements.tree.innerHTML = `
                ${contestSectionHtml}
                ${categoriesHtml}
                <div class="explorer-empty" style="padding:20px 16px">
                    <p style="font-size:12px;opacity:0.6">Empty folder</p>
                    <button class="explorer-open-btn" data-action="new-file-here" style="font-size:11px;padding:6px 12px">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New File
                    </button>
                </div>
            `;
            // Attach new file action
            this.elements.tree.querySelectorAll('[data-action="new-file-here"]').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); this.promptNewFile(); });
            });
            this.attachContestEventListeners();
            this.attachCategoryEventListeners();
            return;
        }

        // Build contest sub-categories section
        const contestSectionHtml = this.renderContestSection();

        // Build categories section (collections only)
        const categoriesHtml = this.renderCategories();

        // Build recent section HTML
        let recentHtml = '';
        if (this.recentFiles.length > 0) {
            const validRecent = this.recentFiles.filter(p => {
                return p.startsWith(this.currentFolder);
            }).slice(0, 5);
            if (validRecent.length > 0) {
                recentHtml = `
                    <div class="explorer-recent-section">
                        <div class="explorer-section-title">${this.ICONS.recent} RECENT</div>
                        <div class="explorer-section-items">
                            ${validRecent.map(path => {
                    const name = path.split(/[/\\]/).pop();
                    return `
                                    <div class="explorer-item file recent-item" data-path="${path}" style="padding-left: 12px">
                                        ${this.getFileIcon(name)}
                                        <span class="explorer-item-name">${name}</span>
                                    </div>
                                `;
                }).join('')}
                        </div>
                    </div>
                `;
            }
        }

        // ==================== CONTEST MODE RENDERING ====================
        if (this.displayMode === 'contest' && this.contestMeta) {
            const contestHeader = this.renderContestHeader();
            const progressBar = this.contestCollapsed ? '' : this.renderProgressBar();
            const problemList = this.renderContestProblemList();

            this.elements.tree.innerHTML = `
                ${contestHeader}
                ${progressBar}
                ${problemList}
                ${contestSectionHtml}
                ${categoriesHtml}
                ${recentHtml}
            `;
        } else {
            // ==================== NORMAL MODE ====================
            this.elements.tree.innerHTML = `
                ${contestSectionHtml}
                ${categoriesHtml}
                ${recentHtml}
            `;
        }

        // Attach event listeners
        this.attachTreeEventListeners();
        this.attachContestEventListeners();
        this.attachCategoryEventListeners();
    },

    /**
     * Render contest header with name, platform badge, and actions
     */
    renderContestHeader() {
        const meta = this.contestMeta;
        const platformBadge = meta.platform && meta.platform !== 'Other'
            ? `<span class="cp-platform-badge">${meta.platform}</span>` : '';
        const collapseIcon = this.contestCollapsed
            ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>'
            : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';

        return `
            <div class="cp-contest-header">
                <div class="cp-contest-info">
                    <span class="cp-contest-collapse" data-action="toggle-contest-collapse" title="${this.contestCollapsed ? 'Expand' : 'Collapse'}">${collapseIcon}</span>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ffa726" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    <span class="cp-contest-name" title="Double-click to rename">${meta.name || 'Contest'}</span>
                    ${platformBadge}
                </div>
                <div class="cp-contest-actions">
                    <button class="cp-action-btn" data-action="add-problem" title="Add Problem">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    <button class="cp-action-btn" data-action="contest-menu" title="Contest Settings">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                    </button>
                </div>
            </div>
        `;
    },

    /**
     * Render quick status bar (clickable problem chips)
     */
    renderQuickStatusBar() {
        if (!this.contestMeta || !this.contestMeta.problems) return '';

        const chips = this.contestMeta.problems.map((prob, idx) => {
            const statusInfo = this.CP_STATUSES[prob.status] || this.CP_STATUSES.todo;
            const icon = this.STATUS_ICONS[prob.status] || this.STATUS_ICONS.todo;
            const timeStr = this.SessionTimer.getDisplay(prob.id);
            const tooltip = `${prob.id}${prob.label ? ' · ' + prob.label : ''} · ${statusInfo.label}${timeStr ? ' · ' + timeStr : ''}\nCtrl+click to select · Shift+click for range`;
            const isActive = this.isActiveProblem(prob.id);
            const isSelected = this.selectedChips.has(prob.id);
            // Show truncated label if set (max ~8 chars)
            const shortLabel = prob.label ? (prob.label.length > 8 ? prob.label.slice(0, 7) + '…' : prob.label) : '';

            return `
                <div class="cp-problem-chip ${isActive ? 'active' : ''} ${isSelected ? 'cp-chip-selected' : ''} cp-status-${prob.status || 'todo'}"
                     data-problem="${prob.id}" data-chip-idx="${idx}" title="${tooltip}">
                    <span class="cp-chip-label">${prob.id}</span>
                    ${shortLabel ? `<span class="cp-chip-sublabel">${shortLabel}</span>` : ''}
                    <span class="cp-chip-icon">${icon}</span>
                </div>
            `;
        }).join('');

        const selCount = this.selectedChips.size;
        const selBar = selCount > 0 ? `
            <div class="cp-chip-selbar">
                <span class="cp-chip-selcount">${selCount} selected</span>
                <button class="cp-chip-del-btn" data-action="delete-selected-problems" title="Delete selected problems">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    Delete ${selCount}
                </button>
                <button class="cp-chip-clear-btn" data-action="clear-chip-selection" title="Clear selection">
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>` : '';

        return `<div class="cp-status-bar">${chips}</div>${selBar}`;
    },

    /**
     * Render progress bar showing solved / total
     */
    renderProgressBar() {
        if (!this.contestMeta || !this.contestMeta.problems) return '';

        const total = this.contestMeta.problems.length;
        const solved = this.contestMeta.problems.filter(p => p.status === 'ac').length;
        const pct = total > 0 ? Math.round((solved / total) * 100) : 0;

        return `
            <div class="cp-progress-section">
                <div class="cp-progress-bar">
                    <div class="cp-progress-fill" style="width: ${pct}%"></div>
                </div>
                <span class="cp-progress-text">${solved} / ${total} solved</span>
            </div>
        `;
    },

    /**
     * Render contest problem list — inline chip blocks for each problem
     */
    renderContestProblemList() {
        if (!this.contestMeta || !this.contestMeta.problems) return '';
        if (this.contestMeta.problems.length === 0) return '';

        // If contest is collapsed, don't render problem list
        if (this.contestCollapsed) return '';

        let html = '<div class="cp-problem-list">';
        html += '<div class="cp-list-label">PROBLEMS</div>';
        html += '<div class="cp-problem-rows">';

        this.contestMeta.problems.forEach((prob, idx) => {
            const statusInfo = this.CP_STATUSES[prob.status] || this.CP_STATUSES.todo;
            const icon = this.STATUS_ICONS[prob.status] || this.STATUS_ICONS.todo;
            const isActive = this.isActiveProblem(prob.id);
            const isSelected = this.selectedChips.has(prob.id);
            const filePath = `${this.contestFolder}/${prob.id}.cpp`.replace(/\\/g, '/');
            const timeStr = this.SessionTimer.getDisplay(prob.id);
            const tooltip = `Click to open · Right-click for options\nCtrl+click to select · Shift+click for range`;

            html += `
                <div class="cp-problem-row-item ${isActive ? 'active' : ''} ${isSelected ? 'cp-chip-selected' : ''} cp-status-${prob.status || 'todo'}"
                     data-problem="${prob.id}" data-chip-idx="${idx}" data-path="${filePath}" title="${tooltip}">
                    <span class="cp-row-status">${icon}</span>
                    <span class="cp-row-id">${prob.id}</span>
                    <span class="cp-row-label">${prob.label || ''}</span>
                    <span class="cp-row-badge cp-badge-${prob.status || 'todo'}">${statusInfo.label}</span>
                    ${timeStr ? `<span class="cp-row-time">${timeStr}</span>` : ''}
                </div>
            `;
        });

        html += '</div>';

        // Selection action bar
        const selCount = this.selectedChips.size;
        if (selCount > 0) {
            html += `
                <div class="cp-chip-selbar">
                    <span class="cp-chip-selcount">${selCount} selected</span>
                    <button class="cp-chip-del-btn" data-action="delete-selected-problems" title="Delete selected problems">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        Delete ${selCount}
                    </button>
                    <button class="cp-chip-clear-btn" data-action="clear-chip-selection" title="Clear selection">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;
        }

        html += '</div>';
        return html;
    },

    /**
     * Check if a problem ID corresponds to the currently open file
     */
    isActiveProblem(problemId) {
        const currentPath = window.App?.currentFilePath || window.currentFilePath;
        if (!currentPath) return false;
        const fileName = currentPath.split(/[/\\]/).pop();
        return fileName.replace(/\.[^.]+$/, '').toUpperCase() === problemId.toUpperCase();
    },

    /**
     * Render items recursively
     */
    renderItems(items, depth) {
        return items.map(item => {
            const indent = depth * 12;
            const isExpanded = this.expandedFolders.has(item.path);

            if (item.isDirectory) {
                return `
                    <div class="explorer-item folder ${isExpanded ? 'expanded' : ''}" 
                         data-path="${item.path}" 
                         style="padding-left: ${indent + 8}px">
                        <span class="explorer-item-arrow">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </span>
                        ${this.getFolderIcon(isExpanded)}
                        <span class="explorer-item-name">${item.name}</span>
                    </div>
                    ${isExpanded && item.children ?
                        `<div class="explorer-children">${this.renderItems(item.children, depth + 1)}</div>`
                        : ''}
                `;
            } else {
                const isCpp = /\.(cpp|c|cc|cxx|h|hpp)$/i.test(item.name);
                const hasCompanions = item.companions && item.companions.length > 0;
                const isFileExpanded = this.expandedFiles.has(item.path);
                const note = this.fileNotes[item.path];
                const hasNote = !!note;

                // ==================== CONTEST MODE FILE RENDERING ====================
                if (this.displayMode === 'contest' && this.contestMeta && isCpp) {
                    const baseName = item.name.replace(/\.[^.]+$/, '').toUpperCase();
                    const prob = this.getProblemMeta(baseName);
                    const cpStatus = prob ? prob.status : 'todo';
                    const cpStatusInfo = this.CP_STATUSES[cpStatus] || this.CP_STATUSES.todo;
                    const cpIcon = this.STATUS_ICONS[cpStatus] || this.STATUS_ICONS.todo;
                    const timeStr = this.SessionTimer.getDisplay(baseName);
                    const metaApproaches = prob ? prob.approaches : [];
                    const hasMetaApproaches = metaApproaches.length > 0;
                    const hasChildren = hasCompanions || hasMetaApproaches;

                    let childCount = 0;
                    if (hasCompanions) childCount += item.companions.length;
                    if (hasMetaApproaches) childCount += metaApproaches.length;

                    let html = `
                        <div class="explorer-item file cp-file has-status cp-status-${cpStatus} ${hasChildren ? 'has-children' : ''} ${isFileExpanded ? 'expanded' : ''}" 
                             data-path="${item.path}" data-problem-id="${baseName}"
                             ${hasNote ? `title="${note.replace(/"/g, '&quot;')}"` : ''}
                             style="padding-left: ${indent + 8}px">
                            ${hasChildren ? `
                                <span class="explorer-file-arrow" data-action="toggle-file">
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="9 18 15 12 9 6"/>
                                    </svg>
                                </span>
                            ` : '<span class="explorer-file-spacer"></span>'}
                            <span class="cp-status-icon" title="${cpStatusInfo.label}">${cpIcon}</span>
                            ${this.getFileIcon(item.name)}
                            <span class="explorer-item-name">${item.name}</span>
                            ${hasNote ? '<span class="explorer-note-icon" title="Click to edit">' + this.ICONS.note + '</span>' : ''}
                            ${timeStr ? `<span class="cp-time-display">${timeStr}</span>` : ''}
                            ${hasChildren ? `<span class="child-count">[${childCount}]</span>` : ''}
                        </div>
                    `;

                    // Render children when expanded
                    if (hasChildren && isFileExpanded) {
                        html += '<div class="explorer-file-children">';

                        // Render approaches from .sameko
                        if (hasMetaApproaches) {
                            html += `<div class="cp-approach-group"><div class="cp-group-label">Approaches</div>`;
                            for (const appr of metaApproaches) {
                                const isActive = prob.activeApproach === appr.id;
                                const apprStatus = this.CP_STATUSES[appr.status] || this.CP_STATUSES.todo;
                                const apprIcon = this.STATUS_ICONS[appr.status] || this.STATUS_ICONS.todo;
                                html += `
                                    <div class="explorer-item approach cp-approach ${isActive ? 'current' : ''}" 
                                         data-path="${item.path}" data-problem-id="${baseName}"
                                         data-approach-id="${appr.id}"
                                         style="padding-left: ${indent + 32}px">
                                        <span class="cp-approach-icon">${apprIcon}</span>
                                        <span class="explorer-item-name">${appr.name}</span>
                                        ${isActive ? '<span class="current-marker" title="Active">' + this.ICONS.check + '</span>' : ''}
                                    </div>
                                `;
                            }
                            html += '</div>';
                        }

                        // Render companion files
                        if (hasCompanions) {
                            html += `<div class="cp-companion-group"><div class="cp-group-label">Test Files</div>`;
                            for (const comp of item.companions) {
                                html += `
                                    <div class="explorer-item file companion" 
                                         data-path="${comp.path}" 
                                         style="padding-left: ${indent + 32}px">
                                        ${this.getFileIcon(comp.name)}
                                        <span class="explorer-item-name">${comp.name}</span>
                                    </div>
                                `;
                            }
                            html += '</div>';
                        }

                        html += '</div>';
                    }

                    return html;
                }

                // ==================== NORMAL MODE FILE RENDERING ====================
                const status = this.fileStatuses[item.path];
                const statusInfo = status ? this.STATUS_TYPES[status] : null;
                const approaches = this.fileApproaches[item.path];
                const hasApproaches = approaches && approaches.versions && approaches.versions.length > 0;
                const hasChildren = hasCompanions || hasApproaches;

                let childCount = 0;
                if (hasCompanions) childCount += item.companions.length;
                if (hasApproaches) childCount += approaches.versions.length;

                let html = `
                    <div class="explorer-item file ${status ? 'has-status status-' + status : ''} ${hasChildren ? 'has-children' : ''} ${isFileExpanded ? 'expanded' : ''}" 
                         data-path="${item.path}" 
                         ${hasNote ? `title="${note.replace(/"/g, '&quot;')}"` : ''}
                         style="padding-left: ${indent + 8}px">
                        ${hasChildren ? `
                            <span class="explorer-file-arrow" data-action="toggle-file">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="9 18 15 12 9 6"/>
                                </svg>
                            </span>
                        ` : '<span class="explorer-file-spacer"></span>'}
                        ${statusInfo ? `<span class="explorer-status-dot" style="background: ${statusInfo.color}" title="${statusInfo.label}"></span>` : ''}
                        ${this.getFileIcon(item.name)}
                        <span class="explorer-item-name">${item.name}</span>
                        ${hasNote ? '<span class="explorer-note-icon" title="Click to edit" data-note="' + note.replace(/"/g, '&quot;').replace(/\n/g, ' ') + '">' + this.ICONS.note + '</span>' : ''}
                        ${hasChildren ? `<span class="child-count" title="${childCount} child item(s)">[${childCount}]</span>` : ''}
                        ${isCpp ? '<span class="explorer-mark-btn" title="Mark status"></span>' : ''}
                    </div>
                `;

                // Render children (companions + approaches) when expanded
                if (hasChildren && isFileExpanded) {
                    html += '<div class="explorer-file-children">';

                    // Render approach versions first
                    if (hasApproaches) {
                        for (const approach of approaches.versions) {
                            const isCurrent = approaches.current === approach.id;
                            const approachStatus = approach.status ? this.APPROACH_STATUS_TYPES[approach.status] : null;
                            html += `
                                <div class="explorer-item approach ${isCurrent ? 'current' : ''}" 
                                     data-path="${item.path}"
                                     data-approach-id="${approach.id}"
                                     style="padding-left: ${indent + 32}px">
                                    <svg class="explorer-icon approach-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#9c27b0" stroke-width="2">
                                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                    </svg>
                                    <span class="explorer-item-name">${approach.name}</span>
                                    ${approachStatus ? `<span class="approach-status" style="color: ${approachStatus.color}" title="${approachStatus.label}">${this.ICONS[approachStatus.iconKey]}</span>` : ''}
                                    ${isCurrent ? '<span class="current-marker" title="Current approach">' + this.ICONS.check + '</span>' : ''}
                                </div>
                            `;
                        }
                    }

                    // Render companion files
                    if (hasCompanions) {
                        for (const comp of item.companions) {
                            html += `
                                <div class="explorer-item file companion" 
                                     data-path="${comp.path}" 
                                     style="padding-left: ${indent + 32}px">
                                    ${this.getFileIcon(comp.name)}
                                    <span class="explorer-item-name">${comp.name}</span>
                                </div>
                            `;
                        }
                    }

                    html += '</div>';
                }

                return html;
            }
        }).join('');
    },

    /**
     * Render empty state — now shows categories + actions even without a folder
     */
    renderEmptyState() {
        if (!this.elements.tree) return;

        const categoriesHtml = this.renderCategories();

        this.elements.tree.innerHTML = `
            ${categoriesHtml}
            <div class="explorer-empty">
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1" opacity="0.4">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <p style="font-size:12px;margin:8px 0">No folder opened</p>
                <div class="explorer-empty-actions">
                    <button class="explorer-open-btn" id="btn-explorer-open-empty">Open Folder</button>
                    <button class="explorer-open-btn cat-new-btn-empty" id="btn-new-category-empty">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        New Collection
                    </button>
                </div>
            </div>
        `;

        // Attach open folder event
        const openBtn = document.getElementById('btn-explorer-open-empty');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.openFolderDialog());
        }
        // Attach new category event
        const newCatBtn = document.getElementById('btn-new-category-empty');
        if (newCatBtn) {
            newCatBtn.addEventListener('click', () => this.promptCreateCategory());
        }
        // Attach category event listeners
        this.attachCategoryEventListeners();
    },

    /**
     * Attach event listeners to tree items
     */
    attachTreeEventListeners() {
        const items = this.elements.tree.querySelectorAll('.explorer-item');

        items.forEach(item => {
            item.addEventListener('click', (e) => {
                // Check if clicked on file arrow (to toggle expand/collapse)
                if (e.target.closest('.explorer-file-arrow')) {
                    e.stopPropagation();
                    const path = item.dataset.path;
                    this.toggleFileExpansion(path);
                    return;
                }

                // Check if clicked on mark button
                if (e.target.classList.contains('explorer-mark-btn')) {
                    e.stopPropagation();
                    this.cycleStatus(item.dataset.path);
                    return;
                }

                const path = item.dataset.path;

                // Track selection
                this.selectedFilePath = path;
                this.elements.tree.querySelectorAll('.explorer-item.selected').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');

                // Handle approach click (contest mode uses .sameko approaches)
                if (item.classList.contains('approach')) {
                    if (item.classList.contains('cp-approach') && item.dataset.problemId) {
                        // Contest mode approach — load from .sameko
                        const problemId = item.dataset.problemId;
                        const approachId = item.dataset.approachId;
                        this.openFile(path);
                        setTimeout(() => this.loadApproachFromMeta(problemId, approachId), 300);
                    } else {
                        // Legacy approach
                        const approachId = item.dataset.approachId;
                        this.switchToApproach(path, approachId);
                    }
                    return;
                }

                // Handle folder click
                if (item.classList.contains('folder')) {
                    this.toggleFolder(path);
                } else if (!item.classList.contains('companion')) {
                    // Handle file click
                    this.openFile(path);
                    // In contest mode, track timer for this problem
                    if (this.displayMode === 'contest' && item.dataset.problemId) {
                        this.SessionTimer.onFileOpen(item.dataset.problemId);
                    }
                }
            });

            item.addEventListener('dblclick', (e) => {
                const path = item.dataset.path;
                if (!item.classList.contains('folder') && !item.classList.contains('approach')) {
                    this.openFile(path, true);
                }
            });

            // Right-click context menu for files and approaches
            if (item.classList.contains('file')) {
                item.addEventListener('contextmenu', (e) => {
                    const path = item.dataset.path;
                    e.preventDefault();

                    if (this.displayMode === 'contest' && item.dataset.problemId) {
                        this.showContestFileContextMenu(e, path, item.dataset.problemId);
                    } else if (/\.(cpp|c|cc|cxx|h|hpp)$/i.test(path)) {
                        this.showContextMenu(e, path);
                    } else {
                        this.showSimpleContextMenu(e, path);
                    }
                });
            } else if (item.classList.contains('folder')) {
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showFolderContextMenu(e, item.dataset.path);
                });
            } else if (item.classList.contains('approach')) {
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const path = item.dataset.path;
                    const approachId = item.dataset.approachId;
                    if (item.classList.contains('cp-approach') && item.dataset.problemId) {
                        this.showContestApproachContextMenu(e, path, item.dataset.problemId, approachId);
                    } else {
                        this.showApproachContextMenu(e, path, approachId);
                    }
                });
            }
        });
    },

    /**
     * Set status on a file
     */
    setStatus(filePath, status) {
        if (status) {
            this.fileStatuses[filePath] = status;
        } else {
            delete this.fileStatuses[filePath];
        }
        this.saveState();
        this.renderTree();
    },

    /**
     * Cycle through statuses when clicking mark button
     */
    cycleStatus(filePath) {
        const statuses = ['working', 'done', 'stuck', 'review', null];
        const current = this.fileStatuses[filePath];
        const currentIdx = current ? statuses.indexOf(current) : -1;
        const nextIdx = (currentIdx + 1) % statuses.length;
        this.setStatus(filePath, statuses[nextIdx]);
    },

    /**
     * Set note for a file
     */
    setNote(filePath, noteText) {
        if (noteText && noteText.trim()) {
            this.fileNotes[filePath] = noteText.trim();
        } else {
            delete this.fileNotes[filePath];
        }
        this.saveState();
        this.renderTree();
    },

    /**
     * Get note for a file
     */
    getNote(filePath) {
        return this.fileNotes[filePath] || '';
    },

    /**
     * Position a context menu so it stays within the viewport.
     * Must be called AFTER appending menu to body.
     */
    positionMenu(menu, clientX, clientY) {
        menu.style.left = clientX + 'px';
        menu.style.top = clientY + 'px';
        document.body.appendChild(menu);
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            const pad = 8;
            if (rect.right > window.innerWidth - pad)
                menu.style.left = Math.max(pad, clientX - rect.width) + 'px';
            if (rect.bottom > window.innerHeight - pad)
                menu.style.top = Math.max(pad, clientY - rect.height) + 'px';
        });
    },

    /**
     * Close menu when clicking outside (single-use listener)
     */
    bindCloseOnOutsideClick(menu) {
        setTimeout(() => {
            const closeMenu = () => {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            };
            document.addEventListener('click', closeMenu, { once: true });
        }, 10);
    },

    /**
     * Safe clipboard helper with fallback
     */
    async copyText(text) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) { }

        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return !!ok;
        } catch (_) {
            return false;
        }
    },

    /**
     * Show context menu for file
     */
    showContextMenu(e, filePath) {
        // Remove existing menus and submenus
        document.querySelectorAll('.explorer-context-menu, .context-submenu').forEach(el => el.remove());

        const currentStatus = this.fileStatuses[filePath];
        const hasNote = !!this.fileNotes[filePath];
        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        // Build status submenu content
        let statusSubmenu = '';
        for (const [key, info] of Object.entries(this.STATUS_TYPES)) {
            const isActive = currentStatus === key;
            statusSubmenu += `
                <div class="context-item ${isActive ? 'active' : ''}" data-action="status" data-status="${key}">
                    <span class="status-dot-mini" style="background: ${info.color}"></span>
                    ${info.label}
                    ${isActive ? ' ' + this.ICONS.check : ''}
                </div>
            `;
        }
        if (currentStatus) {
            statusSubmenu += `
                <div class="context-separator"></div>
                <div class="context-item" data-action="clear-status">
                    Clear Status
                </div>
            `;
        }

        // Build main menu
        const isPinned = this.pinnedItems.includes(filePath);
        menu.innerHTML = `
            <div class="context-item has-submenu" data-action="status-menu">
                <span>Set Status</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu status-submenu">
                    ${statusSubmenu}
                </div>
            </div>
            <div class="context-item" data-action="note">
                ${this.ICONS.note} <span>${hasNote ? 'Edit Note' : 'Add Note'}</span>
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="save-approach">
                ${this.ICONS.approach} Save as New Approach
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="create-inp">
                Create .inp
            </div>
            <div class="context-item" data-action="create-out">
                Create .out
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="rename">
                Rename
            </div>
            <div class="context-item" data-action="delete">
                Delete
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="${isPinned ? 'unpin' : 'pin'}">
                ${isPinned ? this.ICONS.unpin : this.ICONS.pin} ${isPinned ? 'Unpin from Top' : 'Pin to Top'}
            </div>
            ${this.categories.length > 0 ? `
            <div class="context-item has-submenu" data-action="add-to-cat-menu">
                <span>Add to Collection</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu cat-target-submenu">
                    ${this.categories.map(c => `
                        <div class="context-item" data-action="add-to-cat" data-cat-id="${c.id}">
                            <span class="cat-color-dot-mini" style="background: ${c.color}"></span>
                            ${c.name}
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}
            <div class="context-separator"></div>
            <div class="context-item" data-action="copy-path">
                Copy Path
            </div>
            <div class="context-item" data-action="open-folder">
                Show in Explorer
            </div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        // Status submenu handlers
        const statusMenuItem = menu.querySelector('[data-action="status-menu"]');
        const statusSubmenuEl = menu.querySelector('.status-submenu');

        let submenuTimeout;
        statusMenuItem.addEventListener('mouseenter', () => {
            clearTimeout(submenuTimeout);
            statusSubmenuEl.classList.add('visible');
        });

        statusMenuItem.addEventListener('mouseleave', () => {
            submenuTimeout = setTimeout(() => {
                if (!statusSubmenuEl.matches(':hover')) {
                    statusSubmenuEl.classList.remove('visible');
                }
            }, 200);
        });

        statusSubmenuEl.addEventListener('mouseenter', () => {
            clearTimeout(submenuTimeout);
        });

        statusSubmenuEl.addEventListener('mouseleave', () => {
            statusSubmenuEl.classList.remove('visible');
        });

        // Status selection handlers
        statusSubmenuEl.querySelectorAll('[data-action="status"]').forEach(item => {
            item.onclick = () => {
                const clickedStatus = item.dataset.status;
                const newStatus = (currentStatus === clickedStatus) ? null : clickedStatus;
                this.setStatus(filePath, newStatus);
                menu.remove();
            };
        });


        // Clear status handler
        const clearStatusBtn = statusSubmenuEl.querySelector('[data-action="clear-status"]');
        if (clearStatusBtn) {
            clearStatusBtn.onclick = () => {
                this.setStatus(filePath, null);
                menu.remove();
            };
        }

        menu.querySelector('[data-action="note"]').onclick = () => {
            menu.remove();
            this.promptNote(filePath);
        };

        menu.querySelector('[data-action="save-approach"]').onclick = () => {
            menu.remove();
            this.saveAsApproach(filePath);
        };

        menu.querySelector('[data-action="create-inp"]').onclick = () => {
            this.createCompanionFile(filePath, '.inp');
            menu.remove();
        };

        menu.querySelector('[data-action="create-out"]').onclick = () => {
            this.createCompanionFile(filePath, '.out');
            menu.remove();
        };

        menu.querySelector('[data-action="rename"]').onclick = () => {
            menu.remove();
            this.promptRename(filePath);
        };

        menu.querySelector('[data-action="delete"]').onclick = () => {
            menu.remove();
            this.confirmDelete(filePath);
        };

        const pinBtn = menu.querySelector('[data-action="pin"], [data-action="unpin"]');
        if (pinBtn) {
            pinBtn.onclick = () => {
                if (this.pinnedItems.includes(filePath)) {
                    this.unpinItem(filePath);
                } else {
                    this.pinItem(filePath);
                }
                menu.remove();
            };
        }

        // Add to Collection submenu
        const addToCatMenu = menu.querySelector('[data-action="add-to-cat-menu"]');
        const catTargetSubmenu = menu.querySelector('.cat-target-submenu');
        if (addToCatMenu && catTargetSubmenu) {
            let catSubTimeout;
            addToCatMenu.addEventListener('mouseenter', () => { clearTimeout(catSubTimeout); catTargetSubmenu.classList.add('visible'); });
            addToCatMenu.addEventListener('mouseleave', () => {
                catSubTimeout = setTimeout(() => { if (!catTargetSubmenu.matches(':hover')) catTargetSubmenu.classList.remove('visible'); }, 200);
            });
            catTargetSubmenu.addEventListener('mouseenter', () => clearTimeout(catSubTimeout));
            catTargetSubmenu.addEventListener('mouseleave', () => catTargetSubmenu.classList.remove('visible'));

            catTargetSubmenu.querySelectorAll('[data-action="add-to-cat"]').forEach(el => {
                el.onclick = () => {
                    const catId = el.dataset.catId;
                    const fileName = filePath.split(/[/\\]/).pop();
                    const name = fileName.replace(/\.[^.]+$/, '');
                    this.addFileToCategory(catId, filePath.replace(/\\/g, '/'), name);
                    menu.remove();
                    this.renderTree();
                };
            });
        }

        // Copy path handler
        menu.querySelector('[data-action="copy-path"]').onclick = async () => {
            await this.copyText(filePath);
            menu.remove();
        };

        // Open folder handler
        menu.querySelector('[data-action="open-folder"]').onclick = () => {
            this.openContainingFolder(filePath);
            menu.remove();
        };

        // Close on click outside
        this.bindCloseOnOutsideClick(menu);
    },

    /**
     * Show simple context menu for companion files (.inp, .out, etc.)
     */
    showSimpleContextMenu(e, filePath) {
        const existing = document.querySelector('.explorer-context-menu');
        if (existing) existing.remove();

        const hasNote = !!this.fileNotes[filePath];
        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';
        menu.innerHTML = `
            <div class="context-item" data-action="note">
                ${this.ICONS.note} <span>${hasNote ? 'Edit Note' : 'Add Note'}</span>
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="rename">
                Rename
            </div>
            <div class="context-item" data-action="delete">
                Delete
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="copy-path">
                Copy Path
            </div>
            <div class="context-item" data-action="open-folder">
                Show in Explorer
            </div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        menu.querySelector('[data-action="note"]').onclick = () => {
            menu.remove();
            this.promptNote(filePath);
        };

        menu.querySelector('[data-action="rename"]').onclick = () => {
            menu.remove();
            this.promptRename(filePath);
        };

        menu.querySelector('[data-action="delete"]').onclick = () => {
            menu.remove();
            this.confirmDelete(filePath);
        };

        menu.querySelector('[data-action="copy-path"]').onclick = async () => {
            await this.copyText(filePath);
            menu.remove();
        };

        menu.querySelector('[data-action="open-folder"]').onclick = () => {
            this.openContainingFolder(filePath);
            menu.remove();
        };

        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    /**
     * Show context menu for folders
     */
    showFolderContextMenu(e, folderPath) {
        document.querySelectorAll('.explorer-context-menu').forEach(el => el.remove());

        const folderName = folderPath.split(/[/\\]/).pop();
        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        menu.innerHTML = `
            <div class="context-item" data-action="new-file">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                New File Here
            </div>
            <div class="context-item" data-action="new-subfolder">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                New Subfolder
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="open-in-explorer">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                Show in Explorer
            </div>
            <div class="context-item" data-action="copy-path">
                Copy Path
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="set-as-root">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                Open as Root Folder
            </div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        menu.querySelector('[data-action="new-file"]').onclick = () => {
            menu.remove();
            this.showInputDialog('New File in ' + folderName, 'solution.cpp', (fileName) => {
                if (!fileName || !fileName.trim()) return;
                const filePath = `${folderPath}/${fileName.trim()}`.replace(/\\/g, '/');

                let template = '';
                if (/\.(cpp|c|cc|cxx)$/i.test(fileName)) {
                    const baseName = fileName.replace(/\.[^.]+$/, '');
                    template = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n\n    // TODO: solve ${baseName}\n\n    return 0;\n}\n`;
                }

                if (window.electronAPI && window.electronAPI.saveFile) {
                    window.electronAPI.saveFile({ path: filePath, content: template }).then(() => {
                        this.refreshTree();
                        this.openFile(filePath);
                    }).catch((err) => {
                        console.error('[FileExplorer] Failed to create file in folder:', err);
                        alert('Failed to create file: ' + (err?.message || err));
                    });
                }
            });
        };

        menu.querySelector('[data-action="new-subfolder"]').onclick = () => {
            menu.remove();
            this.showInputDialog('New Subfolder in ' + folderName, '', async (name) => {
                if (!name || !name.trim()) return;
                const newPath = `${folderPath}/${name.trim()}`.replace(/\\/g, '/');
                if (window.electronAPI && window.electronAPI.createDirectory) {
                    await window.electronAPI.createDirectory(newPath);
                    this.expandedFolders.add(folderPath);
                    await this.refreshTree();
                }
            });
        };

        menu.querySelector('[data-action="open-in-explorer"]').onclick = () => {
            menu.remove();
            if (window.electronAPI && window.electronAPI.showItemInFolder) {
                window.electronAPI.showItemInFolder(folderPath);
            }
        };

        menu.querySelector('[data-action="copy-path"]').onclick = async () => {
            await this.copyText(folderPath);
            menu.remove();
        };

        menu.querySelector('[data-action="set-as-root"]').onclick = () => {
            menu.remove();
            this.currentFolder = folderPath;
            this.expandedFolders.clear();
            this.expandedFolders.add(folderPath);
            this.loadCategoriesForFolder(this.currentFolder);
            this.refreshTree();
            this.saveState();
        };

        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    /**
     * Prompt for adding/editing note
     */
    promptNote(filePath) {
        const fileName = filePath.split(/[/\\]/).pop();
        const currentNote = this.getNote(filePath);

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'note-dialog-overlay';

        overlay.innerHTML = `
            <div class="note-dialog">
                <div class="note-dialog-header">
                    <h3>Note for ${fileName}</h3>
                    <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                </div>
                <div class="note-dialog-body">
                    <textarea 
                        class="note-dialog-input" 
                        placeholder="Enter your note here..."
                        rows="6"
                    >${currentNote}</textarea>
                </div>
                <div class="note-dialog-footer">
                    <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                    <button class="note-dialog-btn note-dialog-save">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const textarea = overlay.querySelector('.note-dialog-input');
        const saveBtn = overlay.querySelector('.note-dialog-save');
        const cancelBtn = overlay.querySelector('.note-dialog-cancel');
        const closeBtn = overlay.querySelector('.note-dialog-close');

        // Focus textarea
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }, 50);

        const closeDialog = () => {
            overlay.remove();
        };

        const saveNote = () => {
            const noteText = textarea.value.trim();
            this.setNote(filePath, noteText);
            closeDialog();
        };

        saveBtn.onclick = saveNote;
        cancelBtn.onclick = closeDialog;
        closeBtn.onclick = closeDialog;

        // Keyboard shortcuts
        textarea.onkeydown = (e) => {
            if (e.key === 'Escape') {
                closeDialog();
            } else if (e.key === 'Enter' && e.ctrlKey) {
                saveNote();
            }
        };
    },

    /**
     * Show custom input dialog (replacement for native prompt)
     */
    showInputDialog(title, defaultValue, callback) {
        const overlay = document.createElement('div');
        overlay.className = 'note-dialog-overlay';

        overlay.innerHTML = `
            <div class="note-dialog input-dialog">
                <div class="note-dialog-header">
                    <h3>${title}</h3>
                    <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                </div>
                <div class="note-dialog-body">
                    <input 
                        type="text" 
                        class="input-dialog-field" 
                        value="${defaultValue || ''}"
                        placeholder="Enter value..."
                    />
                </div>
                <div class="note-dialog-footer">
                    <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                    <button class="note-dialog-btn note-dialog-save">OK</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input = overlay.querySelector('.input-dialog-field');
        const saveBtn = overlay.querySelector('.note-dialog-save');
        const cancelBtn = overlay.querySelector('.note-dialog-cancel');
        const closeBtn = overlay.querySelector('.note-dialog-close');

        // Blur Monaco editor to prevent it from stealing focus
        if (window.App && window.App.editor) {
            try { document.activeElement?.blur(); } catch (_) { }
        }

        setTimeout(() => {
            window.focus();
            input.focus();
            input.select();
        }, 80);

        const closeDialog = () => {
            overlay.remove();
        };

        const submit = () => {
            const value = input.value.trim();
            if (value) {
                callback(value);
            }
            closeDialog();
        };

        saveBtn.onclick = submit;
        cancelBtn.onclick = closeDialog;
        closeBtn.onclick = closeDialog;

        input.onkeydown = (e) => {
            if (e.key === 'Escape') {
                closeDialog();
            } else if (e.key === 'Enter') {
                submit();
            }
        };
    },

    /**
     * Prompt for rename using custom dialog
     */
    promptRename(filePath) {
        const fileName = filePath.split(/[/\\]/).pop();
        this.showInputDialog('Rename File', fileName, (newName) => {
            if (newName && newName !== fileName) {
                this.renameFile(filePath, newName);
            }
        });
    },

    /**
     * Rename file
     */
    async renameFile(oldPath, newName) {
        const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        const sanitizedName = String(newName || '').trim().replace(/[<>:"/\\|?*]/g, '_');
        if (!sanitizedName) return;
        const newPath = dir + '/' + sanitizedName;

        try {
            if (window.electronAPI && window.electronAPI.renameFile) {
                await window.electronAPI.renameFile(oldPath, newPath);
                this.refreshTree();
            } else {
                console.error('[FileExplorer] Rename API not available');
            }
        } catch (err) {
            console.error('[FileExplorer] Rename failed:', err);
            alert('Failed to rename file: ' + err.message);
        }
    },

    /**
     * Confirm and delete file
     */
    confirmDelete(filePath) {
        const fileName = filePath.split(/[/\\]/).pop();
        if (confirm(`Delete "${fileName}"?`)) {
            this.deleteFile(filePath);
        }
    },

    /**
     * Delete file
     */
    async deleteFile(filePath) {
        try {
            if (window.electronAPI && window.electronAPI.deleteFile) {
                await window.electronAPI.deleteFile(filePath);
                this.refreshTree();
            } else {
                console.error('[FileExplorer] Delete API not available');
            }
        } catch (err) {
            console.error('[FileExplorer] Delete failed:', err);
            alert('Failed to delete file: ' + err.message);
        }
    },

    /**
     * Open containing folder in system explorer
     */
    async openContainingFolder(filePath) {
        try {
            if (window.electronAPI && window.electronAPI.showItemInFolder) {
                await window.electronAPI.showItemInFolder(filePath);
            } else {
                console.error('[FileExplorer] showItemInFolder API not available');
            }
        } catch (err) {
            console.error('[FileExplorer] Failed to open folder:', err);
        }
    },

    /**
     * Create companion file (.inp or .out)
     */
    async createCompanionFile(sourcePath, extension) {
        const baseName = sourcePath.replace(/\.[^.]+$/, '');
        const newPath = baseName + extension;

        try {
            // Check if electronAPI has writeFile
            if (window.electronAPI && window.electronAPI.saveFile) {
                await window.electronAPI.saveFile({ path: newPath, content: '' });
                this.refreshTree();
                console.log(`[FileExplorer] Created: ${newPath}`);
            } else {
                console.error('[FileExplorer] Cannot create file - API not available');
            }
        } catch (err) {
            console.error('[FileExplorer] Failed to create file:', err);
        }
    },

    /**
     * Toggle folder expand/collapse
     */
    async toggleFolder(path) {
        if (this.expandedFolders.has(path)) {
            this.expandedFolders.delete(path);
        } else {
            this.expandedFolders.add(path);
        }

        // Reload tree to get children
        this.tree = await this.loadDirectory(this.currentFolder);
        this.renderTree();
        this.saveState();
    },

    /**
     * Open a file in the editor
     */
    openFile(filePath, permanent = true) {
        console.log('[FileExplorer] openFile called:', filePath);

        // Add to recent files
        this.addToRecent(filePath);

        // Track timer in contest mode
        if (this.displayMode === 'contest') {
            const fileName = filePath.split(/[/\\]/).pop();
            const problemId = fileName.replace(/\.[^.]+$/, '').toUpperCase();
            if (/^[A-Z]$/.test(problemId)) {
                this.SessionTimer.onFileOpen(problemId);
                // Auto-set status to 'coding' if it's still 'todo'
                const prob = this.getProblemMeta(problemId);
                if (prob && prob.status === 'todo') {
                    prob.status = 'coding';
                    this.saveContestMeta(this.contestFolder, this.contestMeta);
                }
            }
        }

        // Highlight current file
        const items = this.elements.tree.querySelectorAll('.explorer-item.file');
        items.forEach(item => item.classList.remove('active'));
        const currentItem = this.elements.tree.querySelector(`[data-path="${filePath}"]`);
        if (currentItem) {
            currentItem.classList.add('active');
        }

        // Open file via app's existing function
        if (window.openFromPath) {
            console.log('[FileExplorer] Using window.openFromPath');
            window.openFromPath(filePath);
        } else if (window.electronAPI && window.electronAPI.readFile) {
            console.log('[FileExplorer] Fallback: using electronAPI.readFile');
            // Fallback: read file and create new tab
            window.electronAPI.readFile(filePath).then(content => {
                if (window.newTab) {
                    const fileName = filePath.split(/[/\\]/).pop();
                    window.newTab(content, filePath, fileName);
                }
            }).catch(err => {
                console.error('Failed to open file:', err);
            });
        } else {
            console.error('[FileExplorer] No method available to open file!');
        }
    },

    /**
     * Get folder icon SVG
     */
    getFolderIcon(isOpen) {
        if (isOpen) {
            return `<svg class="explorer-icon folder-open" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                <path d="M2 10h20"/>
            </svg>`;
        }
        return `<svg class="explorer-icon folder-closed" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
        </svg>`;
    },

    /**
     * Get file icon based on extension
     */
    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();

        const iconMap = {
            // C/C++
            'cpp': { color: '#519aba', icon: 'code' },
            'c': { color: '#519aba', icon: 'code' },
            'cc': { color: '#519aba', icon: 'code' },
            'cxx': { color: '#519aba', icon: 'code' },
            'h': { color: '#a074c4', icon: 'code' },
            'hpp': { color: '#a074c4', icon: 'code' },
            'hxx': { color: '#a074c4', icon: 'code' },

            // Web
            'js': { color: '#f1e05a', icon: 'code' },
            'ts': { color: '#3178c6', icon: 'code' },
            'jsx': { color: '#61dafb', icon: 'code' },
            'tsx': { color: '#3178c6', icon: 'code' },
            'html': { color: '#e34c26', icon: 'code' },
            'htm': { color: '#e34c26', icon: 'code' },
            'css': { color: '#563d7c', icon: 'code' },
            'scss': { color: '#c6538c', icon: 'code' },
            'less': { color: '#1d365d', icon: 'code' },

            // Data
            'json': { color: '#f5de19', icon: 'braces' },
            'xml': { color: '#f16529', icon: 'code' },
            'yaml': { color: '#cb171e', icon: 'file' },
            'yml': { color: '#cb171e', icon: 'file' },

            // Text
            'txt': { color: '#6d8086', icon: 'file' },
            'md': { color: '#083fa1', icon: 'file' },
            'markdown': { color: '#083fa1', icon: 'file' },

            // Python
            'py': { color: '#3572A5', icon: 'code' },

            // Java
            'java': { color: '#b07219', icon: 'code' },

            // Config
            'gitignore': { color: '#f14e32', icon: 'file' },
            'env': { color: '#faf743', icon: 'file' },
        };

        const config = iconMap[ext] || { color: '#6d8086', icon: 'file' };

        if (config.icon === 'code') {
            return `<svg class="explorer-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${config.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
            </svg>`;
        } else if (config.icon === 'braces') {
            return `<svg class="explorer-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${config.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H7a2 2 0 00-2 2v5a2 2 0 01-2 2 2 2 0 012 2v5c0 1.1.9 2 2 2h1"/>
                <path d="M16 21h1a2 2 0 002-2v-5c0-1.1.9-2 2-2a2 2 0 01-2-2V5a2 2 0 00-2-2h-1"/>
            </svg>`;
        }

        return `<svg class="explorer-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${config.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
        </svg>`;
    },

    /**
     * Highlight the currently open file in the tree
     */
    highlightFile(filePath) {
        if (!this.elements.tree) return;

        const items = this.elements.tree.querySelectorAll('.explorer-item.file');
        items.forEach(item => {
            if (item.dataset.path === filePath) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    },

    // ==================== APPROACH VERSIONING ====================

    /**
     * Toggle file expansion (show/hide approaches and companions)
     */
    toggleFileExpansion(filePath) {
        if (this.expandedFiles.has(filePath)) {
            this.expandedFiles.delete(filePath);
        } else {
            this.expandedFiles.add(filePath);
        }
        this.renderTree();
        this.saveState();
    },

    /**
     * Save current file content as a new approach
     */
    saveAsApproach(filePath) {
        // Check if this file is currently open in editor
        const currentFilePath = window.App?.currentFilePath || window.currentFilePath;

        if (!currentFilePath || currentFilePath !== filePath) {
            alert('Please open the file first before saving as approach.\n\nFile: ' + filePath.split(/[/\\]/).pop());
            return;
        }

        this.showInputDialog('Save as New Approach', 'My Approach', (name) => {
            if (!name || !name.trim()) return;

            // Get current file content from editor
            let content = '';
            if (window.App && window.App.editor) {
                content = window.App.editor.getValue();
            }

            if (!content) {
                alert('Cannot save approach - editor content is empty.');
                return;
            }

            // Generate unique ID
            const id = 'approach-' + Date.now();

            // Initialize approaches structure if needed
            if (!this.fileApproaches[filePath]) {
                this.fileApproaches[filePath] = {
                    current: id,
                    versions: []
                };
            }

            // Add new approach
            const newApproach = {
                id,
                name: name.trim(),
                content,
                timestamp: Date.now(),
                status: 'working'
            };

            this.fileApproaches[filePath].versions.push(newApproach);
            this.fileApproaches[filePath].current = id;

            // Expand the file to show new approach
            this.expandedFiles.add(filePath);

            this.saveState();
            this.renderTree();

            console.log(`[FileExplorer] Saved approach "${name}" for ${filePath}`);
            console.log(`[FileExplorer] Content length: ${content.length} chars`);
        });
    },

    /**
     * Switch to a different approach
     */
    switchToApproach(filePath, approachId) {
        const approaches = this.fileApproaches[filePath];
        if (!approaches) return;

        const approach = approaches.versions.find(a => a.id === approachId);
        if (!approach) return;

        // Check if this file is currently open
        const currentFilePath = window.App?.currentFilePath || window.currentFilePath;

        if (!currentFilePath || currentFilePath !== filePath) {
            // Open the file first, then switch approach
            alert('Please open the file first, then click the approach again to switch.\n\nFile: ' + filePath.split(/[/\\]/).pop());
            this.openFile(filePath);
            return;
        }

        // Confirm before switching (will lose unsaved changes)
        if (!confirm(`Switch to approach "${approach.name}"?\n\nNote: Current editor content will be replaced.`)) {
            return;
        }

        // Set as current
        approaches.current = approachId;

        // Load content into editor using execCommand to preserve some undo capability
        if (window.App && window.App.editor) {
            const editor = window.App.editor;
            // Select all and replace - this can be undone with Ctrl+Z
            editor.execCommand('selectAll');
            editor.replaceSelection(approach.content);
            editor.setCursor(0, 0);
            console.log(`[FileExplorer] Switched to approach "${approach.name}"`);
        }

        this.saveState();
        this.renderTree();
    },

    /**
     * Delete an approach
     */
    deleteApproach(filePath, approachId) {
        const approaches = this.fileApproaches[filePath];
        if (!approaches) return;

        const index = approaches.versions.findIndex(a => a.id === approachId);
        if (index === -1) return;

        const approach = approaches.versions[index];
        if (!confirm(`Delete approach "${approach.name}"?`)) return;

        approaches.versions.splice(index, 1);

        // If deleted the current approach, switch to first available
        if (approaches.current === approachId && approaches.versions.length > 0) {
            this.switchToApproach(filePath, approaches.versions[0].id);
        } else if (approaches.versions.length === 0) {
            delete this.fileApproaches[filePath];
        }

        this.saveState();
        this.renderTree();
    },

    /**
     * Rename an approach
     */
    renameApproach(filePath, approachId) {
        const approaches = this.fileApproaches[filePath];
        if (!approaches) return;

        const approach = approaches.versions.find(a => a.id === approachId);
        if (!approach) return;

        const newName = prompt('Enter new name:', approach.name);
        if (!newName || !newName.trim()) return;

        approach.name = newName.trim();
        this.saveState();
        this.renderTree();
    },

    /**
     * Update approach status
     */
    setApproachStatus(filePath, approachId, status) {
        const approaches = this.fileApproaches[filePath];
        if (!approaches) return;

        const approach = approaches.versions.find(a => a.id === approachId);
        if (!approach) return;

        approach.status = status;
        this.saveState();
        this.renderTree();
    },

    /**
     * Show context menu for approach items
     */
    showApproachContextMenu(e, filePath, approachId) {
        const existing = document.querySelector('.explorer-context-menu');
        if (existing) existing.remove();

        const approaches = this.fileApproaches[filePath];
        const approach = approaches?.versions.find(a => a.id === approachId);
        if (!approach) return;

        const isCurrent = approaches.current === approachId;
        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        // Build status submenu
        let statusSubmenu = '';
        for (const [key, info] of Object.entries(this.APPROACH_STATUS_TYPES)) {
            const isActive = approach.status === key;
            statusSubmenu += `
                <div class="context-item ${isActive ? 'active' : ''}" data-action="approach-status" data-status="${key}">
                    <span style="color: ${info.color}">${this.ICONS[info.iconKey]}</span> ${info.label}
                    ${isActive ? ' ' + this.ICONS.check : ''}
                </div>
            `;
        }

        menu.innerHTML = `
            ${!isCurrent ? '<div class="context-item" data-action="switch">Switch to this Approach</div>' : ''}
            ${!isCurrent ? '<div class="context-separator"></div>' : ''}
            <div class="context-item has-submenu" data-action="status-menu">
                <span>Set Status</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu approach-status-submenu">
                    ${statusSubmenu}
                </div>
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="rename">Rename</div>
            <div class="context-item" data-action="delete">Delete</div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        // Status submenu handlers
        const statusMenuItem = menu.querySelector('[data-action="status-menu"]');
        const statusSubmenuEl = menu.querySelector('.approach-status-submenu');

        if (statusMenuItem && statusSubmenuEl) {
            let submenuTimeout;
            statusMenuItem.addEventListener('mouseenter', () => {
                clearTimeout(submenuTimeout);
                statusSubmenuEl.classList.add('visible');
            });

            statusMenuItem.addEventListener('mouseleave', () => {
                submenuTimeout = setTimeout(() => {
                    if (!statusSubmenuEl.matches(':hover')) {
                        statusSubmenuEl.classList.remove('visible');
                    }
                }, 200);
            });

            statusSubmenuEl.addEventListener('mouseenter', () => clearTimeout(submenuTimeout));
            statusSubmenuEl.addEventListener('mouseleave', () => statusSubmenuEl.classList.remove('visible'));

            statusSubmenuEl.querySelectorAll('[data-action="approach-status"]').forEach(item => {
                item.onclick = () => {
                    this.setApproachStatus(filePath, approachId, item.dataset.status);
                    menu.remove();
                };
            });
        }

        // Switch handler
        const switchBtn = menu.querySelector('[data-action="switch"]');
        if (switchBtn) {
            switchBtn.onclick = () => {
                this.switchToApproach(filePath, approachId);
                menu.remove();
            };
        }

        const renameBtn = menu.querySelector('[data-action="rename"]');
        if (renameBtn) {
            renameBtn.onclick = () => {
                this.renameApproach(filePath, approachId);
                menu.remove();
            };
        }

        const deleteBtn = menu.querySelector('[data-action="delete"]');
        if (deleteBtn) {
            deleteBtn.onclick = () => {
                this.deleteApproach(filePath, approachId);
                menu.remove();
            };
        }

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    // ==================== PIN & RECENT ====================

    /**
     * Add file to recent files list
     */
    addToRecent(filePath) {
        // Remove if already exists
        this.recentFiles = this.recentFiles.filter(p => p !== filePath);

        // Add to front
        this.recentFiles.unshift(filePath);

        // Keep max 5
        if (this.recentFiles.length > 5) {
            this.recentFiles = this.recentFiles.slice(0, 5);
        }

        this.saveState();
    },

    /**
     * Pin an item
     */
    pinItem(filePath) {
        if (!this.pinnedItems.includes(filePath)) {
            this.pinnedItems.push(filePath);
            this.saveState();
            this.renderTree();
        }
    },

    /**
     * Unpin an item
     */
    unpinItem(filePath) {
        this.pinnedItems = this.pinnedItems.filter(p => p !== filePath);
        this.saveState();
        this.renderTree();
    },

    // ==================== CONTEST MODE EVENT LISTENERS ====================

    /**
     * Attach event listeners for contest-mode UI elements
     */
    attachContestEventListeners() {
        // "New Contest" button (navigates into new contest folder)
        const newContestBtn = this.elements.tree.querySelector('[data-action="new-contest"]');
        if (newContestBtn) {
            newContestBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showNewContestDialog();
            });
        }

        // "New Sub-Contest" button in CONTEST section (creates sub-contest, stays in current view)
        const newSubContestBtn = this.elements.tree.querySelector('[data-action="new-sub-contest"]');
        if (newSubContestBtn) {
            newSubContestBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptAddProblem();
            });
        }

        if (this.displayMode !== 'contest') {
            return;
        }

        // Contest collapse toggle
        const collapseBtn = this.elements.tree.querySelector('[data-action="toggle-contest-collapse"]');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.contestCollapsed = !this.contestCollapsed;
                this.renderTree();
            });
        }

        // Quick Status Bar chips & problem row items
        const chips = this.elements.tree.querySelectorAll('.cp-problem-chip, .cp-problem-row-item');
        chips.forEach(chip => {
            chip.addEventListener('click', (e) => {
                const problemId = chip.dataset.problem;
                const chipIdx = parseInt(chip.dataset.chipIdx, 10);

                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: toggle this chip's selection
                    e.preventDefault();
                    if (this.selectedChips.has(problemId)) {
                        this.selectedChips.delete(problemId);
                    } else {
                        this.selectedChips.add(problemId);
                        this.lastChipClickIdx = chipIdx;
                    }
                    this.renderTree();
                    return;
                }

                if (e.shiftKey && this.lastChipClickIdx >= 0) {
                    // Shift+click: range-select between lastChipClickIdx and current
                    e.preventDefault();
                    const probs = this.contestMeta.problems;
                    const lo = Math.min(this.lastChipClickIdx, chipIdx);
                    const hi = Math.max(this.lastChipClickIdx, chipIdx);
                    for (let i = lo; i <= hi; i++) {
                        this.selectedChips.add(probs[i].id);
                    }
                    this.lastChipClickIdx = chipIdx;
                    this.renderTree();
                    return;
                }

                // Plain click: open file (clear selection if any)
                if (this.selectedChips.size > 0) {
                    this.selectedChips.clear();
                    this.renderTree();
                    return;
                }

                this.lastChipClickIdx = chipIdx;
                // Open the file
                const filePath = chip.dataset.path || `${this.currentFolder}/${problemId}.cpp`.replace(/\\/g, '/');
                this.openFile(filePath);
                this.SessionTimer.onFileOpen(problemId);
            });

            chip.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const filePath = chip.dataset.path || `${this.currentFolder}/${chip.dataset.problem}.cpp`.replace(/\\/g, '/');
                this.showContestFileContextMenu(e, filePath, chip.dataset.problem);
            });
        });

        // Selection bar: delete + clear
        const delBtn = this.elements.tree.querySelector('[data-action="delete-selected-problems"]');
        if (delBtn) {
            delBtn.addEventListener('click', () => this.deleteSelectedProblems());
        }
        const clearBtn = this.elements.tree.querySelector('[data-action="clear-chip-selection"]');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.selectedChips.clear();
                this.lastChipClickIdx = -1;
                this.renderTree();
            });
        }

        // Contest header actions
        const addProbBtn = this.elements.tree.querySelector('[data-action="add-problem"]');
        if (addProbBtn) {
            addProbBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptAddProblem();
            });
        }

        const contestMenuBtn = this.elements.tree.querySelector('[data-action="contest-menu"]');
        if (contestMenuBtn) {
            contestMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showContestSettingsMenu(e);
            });
        }

        // New file button in normal mode
        const newFileBtn = this.elements.tree.querySelector('[data-action="new-file-here"]');
        if (newFileBtn) {
            newFileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptNewFile();
            });
        }

        // Contest name click to rename
        const contestName = this.elements.tree.querySelector('.cp-contest-name');
        if (contestName) {
            contestName.addEventListener('dblclick', () => {
                this.showInputDialog('Rename Contest', this.contestMeta.name, (newName) => {
                    if (newName && newName.trim()) {
                        this.contestMeta.name = newName.trim();
                        this.saveContestMeta(this.contestFolder, this.contestMeta);
                        this.renderTree();
                    }
                });
            });
        }

        // Sub-items (approaches, test files) click to open
        this.elements.tree.querySelectorAll('.cp-prob-sub-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const path = item.dataset.path;
                if (path) this.openFile(path);
            });
        });
    },

    /**
     * Show contest-mode context menu for .cpp files
     */
    showContestFileContextMenu(e, filePath, problemId) {
        document.querySelectorAll('.explorer-context-menu, .context-submenu').forEach(el => el.remove());

        const prob = this.getProblemMeta(problemId);
        const currentStatus = prob ? prob.status : 'todo';
        const hasNote = !!this.fileNotes[filePath];
        const isPinned = this.pinnedItems.includes(filePath);

        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        // Build CP status submenu
        let statusSubmenu = '';
        for (const [key, info] of Object.entries(this.CP_STATUSES)) {
            const isActive = currentStatus === key;
            const icon = this.STATUS_ICONS[key];
            statusSubmenu += `
                <div class="context-item ${isActive ? 'active' : ''}" data-action="cp-status" data-status="${key}">
                    <span class="cp-menu-icon">${icon}</span> ${info.label}
                    ${isActive ? ' ' + this.ICONS.check : ''}
                </div>
            `;
        }

        menu.innerHTML = `
            <div class="context-item has-submenu" data-action="status-menu">
                <span>Mark Status</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu cp-status-submenu">
                    ${statusSubmenu}
                </div>
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="rename-problem">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                Rename / Set Label
            </div>
            <div class="context-item" data-action="save-approach-meta">
                ${this.ICONS.approach} Save as New Approach
            </div>
            <div class="context-item" data-action="note">
                ${this.ICONS.note} <span>${hasNote ? 'Edit Note' : 'Add Note'}</span>
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="create-inp">Create .inp</div>
            <div class="context-item" data-action="create-out">Create .out</div>
            <div class="context-separator"></div>
            ${this.categories.length > 0 ? `
            <div class="context-item has-submenu" data-action="add-to-cat-menu">
                <span>Add to Collection</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu cat-target-submenu">
                    ${this.categories.map(c => `
                        <div class="context-item" data-action="add-to-cat" data-cat-id="${c.id}">
                            <span class="cat-color-dot-mini" style="background: ${c.color}"></span>
                            ${c.name}
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}
            <div class="context-item" data-action="copy-path">Copy Path</div>
            <div class="context-separator"></div>
            <div class="context-item danger" data-action="delete-problem" style="color:#ef5350">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ef5350" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                Delete Problem
            </div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        // Status submenu hover
        const statusMenuItem = menu.querySelector('[data-action="status-menu"]');
        const statusSubmenuEl = menu.querySelector('.cp-status-submenu');
        let submenuTimeout;

        statusMenuItem.addEventListener('mouseenter', () => {
            clearTimeout(submenuTimeout);
            statusSubmenuEl.classList.add('visible');
        });
        statusMenuItem.addEventListener('mouseleave', () => {
            submenuTimeout = setTimeout(() => {
                if (!statusSubmenuEl.matches(':hover')) statusSubmenuEl.classList.remove('visible');
            }, 200);
        });
        statusSubmenuEl.addEventListener('mouseenter', () => clearTimeout(submenuTimeout));
        statusSubmenuEl.addEventListener('mouseleave', () => statusSubmenuEl.classList.remove('visible'));

        // Status selection
        statusSubmenuEl.querySelectorAll('[data-action="cp-status"]').forEach(item => {
            item.onclick = () => {
                this.setProblemStatus(problemId, item.dataset.status);
                menu.remove();
            };
        });

        // Save approach
        menu.querySelector('[data-action="save-approach-meta"]').onclick = () => {
            menu.remove();
            this.showInputDialog('Save Approach', 'My Approach', (name) => {
                if (name) this.saveApproachToMeta(problemId, name);
            });
        };

        // Rename / Set label
        menu.querySelector('[data-action="rename-problem"]').onclick = () => {
            menu.remove();
            const prob = this.getProblemMeta(problemId);
            const currentLabel = prob?.label || '';
            this.showInputDialog(`Label for Problem ${problemId}`, currentLabel, (newLabel) => {
                if (newLabel !== null && prob) {
                    prob.label = newLabel.trim();
                    this.saveContestMeta(this.contestFolder, this.contestMeta);
                    this.renderTree();
                }
            });
        };

        // Note
        menu.querySelector('[data-action="note"]').onclick = () => {
            menu.remove();
            this.promptNote(filePath);
        };

        // Create companion files
        menu.querySelector('[data-action="create-inp"]').onclick = () => {
            this.createCompanionFile(filePath, '.inp');
            menu.remove();
        };
        menu.querySelector('[data-action="create-out"]').onclick = () => {
            this.createCompanionFile(filePath, '.out');
            menu.remove();
        };

        // Copy path
        menu.querySelector('[data-action="copy-path"]').onclick = async () => {
            await this.copyText(filePath);
            menu.remove();
        };

        // Add to Collection submenu
        const addToCatMenu = menu.querySelector('[data-action="add-to-cat-menu"]');
        const catTargetSubmenu = menu.querySelector('.cat-target-submenu');
        if (addToCatMenu && catTargetSubmenu) {
            let catSubTimeout;
            addToCatMenu.addEventListener('mouseenter', () => { clearTimeout(catSubTimeout); catTargetSubmenu.classList.add('visible'); });
            addToCatMenu.addEventListener('mouseleave', () => {
                catSubTimeout = setTimeout(() => { if (!catTargetSubmenu.matches(':hover')) catTargetSubmenu.classList.remove('visible'); }, 200);
            });
            catTargetSubmenu.addEventListener('mouseenter', () => clearTimeout(catSubTimeout));
            catTargetSubmenu.addEventListener('mouseleave', () => catTargetSubmenu.classList.remove('visible'));

            catTargetSubmenu.querySelectorAll('[data-action="add-to-cat"]').forEach(el => {
                el.onclick = () => {
                    const catId = el.dataset.catId;
                    const name = problemId;
                    this.addFileToCategory(catId, filePath.replace(/\\/g, '/'), name);
                    menu.remove();
                    this.renderTree();
                };
            });
        }

        menu.querySelector('[data-action="delete-problem"]').onclick = () => {
            menu.remove();
            this.deleteProblemFromContest(problemId);
        };

        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    /**
     * Show context menu for contest-mode approach items 
     */
    showContestApproachContextMenu(e, filePath, problemId, approachId) {
        document.querySelectorAll('.explorer-context-menu').forEach(el => el.remove());

        const prob = this.getProblemMeta(problemId);
        if (!prob) return;
        const approach = prob.approaches.find(a => a.id === approachId);
        if (!approach) return;

        const isActive = prob.activeApproach === approachId;
        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        // Status submenu
        let statusSubmenu = '';
        for (const [key, info] of Object.entries(this.CP_STATUSES)) {
            const isCurrentStatus = approach.status === key;
            statusSubmenu += `
                <div class="context-item ${isCurrentStatus ? 'active' : ''}" data-action="appr-status" data-status="${key}">
                    <span class="cp-menu-icon">${this.STATUS_ICONS[key]}</span> ${info.label}
                    ${isCurrentStatus ? ' ' + this.ICONS.check : ''}
                </div>
            `;
        }

        menu.innerHTML = `
            ${!isActive ? '<div class="context-item" data-action="load-approach">Load this Approach</div><div class="context-separator"></div>' : ''}
            <div class="context-item has-submenu" data-action="status-menu">
                <span>Mark Status</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu">${statusSubmenu}</div>
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="rename-approach">Rename</div>
            <div class="context-item" data-action="delete-approach">Delete</div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        // Submenu hover
        const statusMenuItem = menu.querySelector('[data-action="status-menu"]');
        const subEl = menu.querySelector('.context-submenu');
        let subTimeout;
        if (statusMenuItem && subEl) {
            statusMenuItem.addEventListener('mouseenter', () => { clearTimeout(subTimeout); subEl.classList.add('visible'); });
            statusMenuItem.addEventListener('mouseleave', () => { subTimeout = setTimeout(() => { if (!subEl.matches(':hover')) subEl.classList.remove('visible'); }, 200); });
            subEl.addEventListener('mouseenter', () => clearTimeout(subTimeout));
            subEl.addEventListener('mouseleave', () => subEl.classList.remove('visible'));

            subEl.querySelectorAll('[data-action="appr-status"]').forEach(item => {
                item.onclick = () => {
                    approach.status = item.dataset.status;
                    this.saveContestMeta(this.contestFolder, this.contestMeta);
                    this.renderTree();
                    menu.remove();
                };
            });
        }

        // Load approach
        const loadBtn = menu.querySelector('[data-action="load-approach"]');
        if (loadBtn) {
            loadBtn.onclick = () => {
                this.openFile(filePath);
                setTimeout(() => this.loadApproachFromMeta(problemId, approachId), 300);
                menu.remove();
            };
        }

        // Rename
        const renameBtn = menu.querySelector('[data-action="rename-approach"]');
        if (renameBtn) {
            renameBtn.onclick = () => {
                menu.remove();
                this.showInputDialog('Rename Approach', approach.name, (name) => {
                    if (name) {
                        approach.name = name.trim();
                        this.saveContestMeta(this.contestFolder, this.contestMeta);
                        this.renderTree();
                    }
                });
            };
        }

        // Delete
        const deleteBtn = menu.querySelector('[data-action="delete-approach"]');
        if (deleteBtn) {
            deleteBtn.onclick = () => {
                if (confirm(`Delete approach "${approach.name}"?`)) {
                    this.deleteApproachFromMeta(problemId, approachId);
                }
                menu.remove();
            };
        }

        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    /**
     * Show contest settings dropdown menu
     */
    showContestSettingsMenu(e) {
        document.querySelectorAll('.explorer-context-menu').forEach(el => el.remove());

        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';
        menu.innerHTML = `
            <div class="context-item" data-action="rename-contest">Rename Contest</div>
            <div class="context-item" data-action="set-platform">Set Platform</div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="reset-all-status">Reset All Status</div>
            <div class="context-item" data-action="remove-contest-marker">Remove Contest Marker</div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="delete-contest-folder" style="color:#ef5350">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ef5350" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                Delete Contest Folder
            </div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        menu.querySelector('[data-action="rename-contest"]').onclick = () => {
            menu.remove();
            this.showInputDialog('Rename Contest', this.contestMeta.name, (name) => {
                if (name) {
                    this.contestMeta.name = name.trim();
                    this.saveContestMeta(this.contestFolder, this.contestMeta);
                    this.renderTree();
                }
            });
        };

        menu.querySelector('[data-action="set-platform"]').onclick = () => {
            menu.remove();
            this.showInputDialog('Set Platform (CF, VNOJ, SPOJ, Other)', this.contestMeta.platform || 'Other', (val) => {
                if (val) {
                    this.contestMeta.platform = val.trim();
                    this.saveContestMeta(this.contestFolder, this.contestMeta);
                    this.renderTree();
                }
            });
        };

        menu.querySelector('[data-action="reset-all-status"]').onclick = () => {
            menu.remove();
            if (confirm('Reset all problem statuses to "Not Started"?')) {
                for (const p of this.contestMeta.problems) {
                    p.status = 'todo';
                }
                this.saveContestMeta(this.contestFolder, this.contestMeta);
                this.renderTree();
            }
        };

        menu.querySelector('[data-action="remove-contest-marker"]').onclick = () => {
            menu.remove();
            localStorage.removeItem(`cp-mode:${this.currentFolder}`);
            this.displayMode = 'normal';
            this.contestMeta = null;
            this.contestFolder = null;
            this.refreshTree();
        };

        menu.querySelector('[data-action="delete-contest-folder"]').onclick = () => {
            menu.remove();
            this.deleteContestFolder();
        };

        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    // ==================== NEW CONTEST WIZARD ====================

    /**
     * Prompt to add a new sub-contest (category) within the current contest folder.
     * Creates a subfolder with .sameko and problem files A..Z based on last ID.
     */
    promptAddProblem() {
        if (!this.contestFolder && !this.currentFolder) return;
        const parentFolder = this.contestFolder || this.currentFolder;

        const overlay = document.createElement('div');
        overlay.className = 'note-dialog-overlay';

        overlay.innerHTML = `
            <div class="note-dialog cp-wizard-dialog" style="max-width:360px">
                <div class="note-dialog-header">
                    <h3>+ New Contest Category</h3>
                    <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                </div>
                <div class="note-dialog-body">
                    <div class="cp-wizard-field">
                        <label>Category / Contest Name</label>
                        <input type="text" class="input-dialog-field" id="cp-add-name" placeholder="e.g. CF-Round-1000" autofocus />
                    </div>
                    <div class="cp-wizard-field">
                        <label>Last Problem ID <span style="opacity:.55;font-size:11px">(optional, e.g. F → A B C D E F)</span></label>
                        <input type="text" class="input-dialog-field" id="cp-add-last-id" placeholder="e.g. F" value="" maxlength="2" style="text-transform:uppercase;letter-spacing:2px" />
                    </div>
                    <div id="cp-add-preview" style="font-size:11px;opacity:.7;padding:4px 2px"></div>
                </div>
                <div class="note-dialog-footer">
                    <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                    <button class="note-dialog-btn note-dialog-save">Create</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const nameInput = document.getElementById('cp-add-name');
        const lastIdInput = document.getElementById('cp-add-last-id');
        const preview = document.getElementById('cp-add-preview');
        const saveBtn = overlay.querySelector('.note-dialog-save');
        const cancelBtn = overlay.querySelector('.note-dialog-cancel');
        const closeBtn = overlay.querySelector('.note-dialog-close');

        const updatePreview = () => {
            const val = lastIdInput.value.trim().toUpperCase();
            const ids = this._idsUpTo(val);
            preview.textContent = ids.length ? 'Will create: ' + ids.join(', ') : '';
        };

        lastIdInput.oninput = updatePreview;
        updatePreview();
        setTimeout(() => nameInput && nameInput.focus(), 50);

        const closeDialog = () => overlay.remove();

        const createSubContest = async () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }

            const lastIdRaw = lastIdInput.value.trim().toUpperCase();
            const problemIds = lastIdRaw ? this._idsUpTo(lastIdRaw) : [];

            // Create subfolder
            const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
            const subFolder = `${parentFolder}/${safeName}`.replace(/\\/g, '/');

            if (window.electronAPI && window.electronAPI.createContest) {
                const result = await window.electronAPI.createContest({
                    parentDir: parentFolder,
                    name: safeName,
                    problemIds,
                    platform: this.contestMeta?.platform || 'Other'
                });

                if (result.success) {
                    // Add as a contest sub-category (separate from collections)
                    const color = this.CATEGORY_COLORS[this.categories.length % this.CATEGORY_COLORS.length];
                    const catId = 'cat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
                    const newCat = {
                        id: catId,
                        name: name,
                        color: color,
                        type: 'contest',
                        folderPath: result.contestDir,
                        items: [],
                        createdAt: new Date().toISOString(),
                    };

                    // Add the created problem files to the category
                    for (const pid of problemIds) {
                        const filePath = `${result.contestDir}/${pid}.cpp`.replace(/\\/g, '/');
                        newCat.items.push({
                            filePath,
                            name: pid,
                            fileName: `${pid}.cpp`,
                            status: 'todo',
                            addedAt: Date.now(),
                        });
                    }

                    this.categories.push(newCat);
                    this.saveState();
                    await this.refreshTree();
                    closeDialog();
                } else {
                    alert('Failed: ' + (result.error || 'Unknown error'));
                }
            } else {
                // Fallback: create folder and files manually
                try {
                    if (window.electronAPI && window.electronAPI.createDirectory) {
                        await window.electronAPI.createDirectory(subFolder);
                    }

                    const color = this.CATEGORY_COLORS[this.categories.length % this.CATEGORY_COLORS.length];
                    const catId = 'cat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                    const newCat = { id: catId, name, color, type: 'contest', folderPath: subFolder, items: [], createdAt: new Date().toISOString() };

                    for (const pid of problemIds) {
                        const filePath = `${subFolder}/${pid}.cpp`.replace(/\\/g, '/');
                        const template = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n\n    // TODO: solve ${pid}\n\n    return 0;\n}\n`;
                        if (window.electronAPI && window.electronAPI.saveFile) {
                            await window.electronAPI.saveFile({ path: filePath, content: template });
                        }
                        newCat.items.push({
                            filePath,
                            name: pid,
                            fileName: `${pid}.cpp`,
                            status: 'todo',
                            addedAt: Date.now(),
                        });
                    }

                    this.categories.push(newCat);
                    this.saveState();
                    await this.refreshTree();
                    closeDialog();
                } catch (err) {
                    alert('Failed: ' + (err.message || err));
                }
            }
        };

        saveBtn.onclick = createSubContest;
        cancelBtn.onclick = closeDialog;
        closeBtn.onclick = closeDialog;

        nameInput.onkeydown = (e) => {
            if (e.key === 'Escape') closeDialog();
            if (e.key === 'Enter') lastIdInput.focus();
        };
        lastIdInput.onkeydown = (e) => {
            if (e.key === 'Escape') closeDialog();
            if (e.key === 'Enter') createSubContest();
        };
    },

    /**
     * Handle keyboard shortcuts when explorer is focused (Ctrl+C/X/V, Delete)
     */
    handleExplorerKeydown(e) {
        if (!this.selectedFilePath) return;

        if (e.key === 'Delete' && !e.ctrlKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.confirmDelete(this.selectedFilePath);

        } else if (e.key === 'c' && e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.clipboardFile = { path: this.selectedFilePath, mode: 'copy' };
            // Remove any cut-visual from tree items
            this.elements.tree.querySelectorAll('.explorer-item.cut').forEach(el => el.classList.remove('cut'));

        } else if (e.key === 'x' && e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.clipboardFile = { path: this.selectedFilePath, mode: 'cut' };
            // Visual indicator: dim the cut item
            this.elements.tree.querySelectorAll('.explorer-item.cut').forEach(el => el.classList.remove('cut'));
            const selectedEl = this.elements.tree.querySelector(`.explorer-item[data-path="${CSS.escape(this.selectedFilePath)}"]`);
            if (selectedEl) selectedEl.classList.add('cut');

        } else if (e.key === 'v' && e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.pasteFile();
        }
    },

    /**
     * Paste file from clipboard into current folder
     */
    async pasteFile() {
        if (!this.clipboardFile || !this.currentFolder) return;
        const { path: srcPath, mode } = this.clipboardFile;
        const fileName = srcPath.split(/[/\\]/).pop();
        const destPath = `${this.currentFolder}/${fileName}`.replace(/\\/g, '/');

        // Normalize paths for comparison
        const normSrc = srcPath.replace(/\\/g, '/');
        const normDest = destPath;
        if (normSrc === normDest) return;

        try {
            if (mode === 'cut') {
                if (window.electronAPI && window.electronAPI.moveFile) {
                    await window.electronAPI.moveFile(srcPath, destPath);
                }
                this.clipboardFile = null;
                this.selectedFilePath = destPath;
            } else {
                if (window.electronAPI && window.electronAPI.copyFile) {
                    await window.electronAPI.copyFile(srcPath, destPath);
                }
            }
            await this.refreshTree();
        } catch (err) {
            console.error('[FileExplorer] Paste failed:', err);
            alert('Paste failed: ' + (err.message || err));
        }
    },

    /**
     * Show a quick status picker for a contest problem (from right-click on chip)
     */
    showQuickStatusMenu(e, problemId) {
        document.querySelectorAll('.explorer-context-menu').forEach(el => el.remove());

        const prob = this.getProblemMeta(problemId);
        const currentStatus = prob ? prob.status : 'todo';

        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        let itemsHtml = `<div class="context-label" style="padding:4px 12px 2px;font-size:11px;opacity:.6;">Set Status — ${problemId}</div>`;
        for (const [key, info] of Object.entries(this.CP_STATUSES)) {
            const isActive = currentStatus === key;
            itemsHtml += `
                <div class="context-item ${isActive ? 'active' : ''}" data-status="${key}" style="gap:6px">
                    <span>${this.STATUS_ICONS[key]}</span>
                    <span>${info.label}</span>
                    ${isActive ? this.ICONS.check : ''}
                </div>`;
        }
        menu.innerHTML = itemsHtml;

        this.positionMenu(menu, e.clientX, e.clientY);

        menu.querySelectorAll('[data-status]').forEach(item => {
            item.onclick = () => {
                this.setProblemStatus(problemId, item.dataset.status);
                menu.remove();
            };
        });

        setTimeout(() => {
            document.addEventListener('click', function close() {
                menu.remove();
                document.removeEventListener('click', close);
            });
        }, 10);
    },

    /**
     * Delete a single problem from the contest (.cpp file + remove from .sameko)
     */
    async deleteProblemFromContest(problemId) {
        if (!this.contestMeta) return;
        const prob = this.getProblemMeta(problemId);
        const label = prob?.label ? ` "${prob.label}"` : '';
        if (!confirm(`Delete problem ${problemId}${label} and its .cpp file?`)) return;

        // Remove the .cpp file
        const filePath = `${this.contestFolder}/${problemId}.cpp`.replace(/\\/g, '/');
        if (window.electronAPI && window.electronAPI.deleteFile) {
            try { await window.electronAPI.deleteFile(filePath); } catch (_) { }
        }
        // Remove from .sameko
        this.contestMeta.problems = this.contestMeta.problems.filter(p => p.id !== problemId);
        this.selectedChips.delete(problemId);
        await this.saveContestMeta(this.contestFolder, this.contestMeta);
        await this.refreshTree();
    },

    /**
     * Delete all currently selected chips (problems)
     */
    async deleteSelectedProblems() {
        if (!this.contestMeta || this.selectedChips.size === 0) return;
        const ids = [...this.selectedChips];
        if (!confirm(`Delete ${ids.length} problem(s): ${ids.join(', ')}? This will remove the .cpp files.`)) return;

        for (const problemId of ids) {
            const filePath = `${this.contestFolder}/${problemId}.cpp`.replace(/\\/g, '/');
            if (window.electronAPI && window.electronAPI.deleteFile) {
                try { await window.electronAPI.deleteFile(filePath); } catch (_) { }
            }
        }
        this.contestMeta.problems = this.contestMeta.problems.filter(p => !ids.includes(p.id));
        this.selectedChips.clear();
        this.lastChipClickIdx = -1;
        await this.saveContestMeta(this.contestFolder, this.contestMeta);
        await this.refreshTree();
    },

    /**
     * Delete the entire contest folder
     */
    async deleteContestFolder() {
        if (!this.contestFolder) return;
        const folderName = this.contestFolder.split(/[/\\]/).pop();
        if (!confirm(`Delete entire contest folder "${folderName}" and ALL its files? This cannot be undone.`)) return;

        if (window.electronAPI && window.electronAPI.deleteFolder) {
            try {
                await window.electronAPI.deleteFolder(this.contestFolder);
            } catch (err) {
                alert('Failed: ' + err.message);
                return;
            }
        } else if (window.electronAPI && window.electronAPI.showItemInFolder) {
            // Fallback: open the folder in explorer so user can delete manually
            await window.electronAPI.showItemInFolder(this.contestFolder);
            alert('Auto-delete not available. The folder has been revealed in Explorer — please delete it manually.');
            return;
        }

        // Clear contest mode override from localStorage
        localStorage.removeItem(`cp-mode:${this.contestFolder}`);
        localStorage.removeItem(`cp-mode:${this.currentFolder}`);

        // Navigate up to parent folder
        const parentFolder = this.contestFolder.replace(/[/\\][^/\\]+$/, '');
        this.contestFolder = null;
        this.contestMeta = null;
        this.displayMode = 'normal';
        this.selectedChips.clear();
        this.currentFolder = parentFolder || null;
        this.loadCategoriesForFolder(this.currentFolder);
        this.saveState();
        this.refreshTree();
    },

    /**
     * Show New Contest Wizard inline dialog
     */
    showNewContestDialog() {
        const overlay = document.createElement('div');
        overlay.className = 'note-dialog-overlay';

        overlay.innerHTML = `
            <div class="note-dialog cp-wizard-dialog">
                <div class="note-dialog-header">
                    <h3>✦ New Contest</h3>
                    <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                </div>
                <div class="note-dialog-body">
                    <div class="cp-wizard-field">
                        <label>Folder / Contest Name</label>
                        <input type="text" class="input-dialog-field" id="cp-wizard-name" placeholder="CF-Round-1000" />
                    </div>
                    <div class="cp-wizard-field">
                        <label>Last Problem ID <span style="opacity:.55;font-size:11px">(e.g. G → creates A B C D E F G)</span></label>
                        <input type="text" class="input-dialog-field" id="cp-wizard-last-id" placeholder="F" value="F" maxlength="2" style="text-transform:uppercase;letter-spacing:2px" />
                    </div>
                    <div class="cp-wizard-field">
                        <label>Platform</label>
                        <select class="input-dialog-field" id="cp-wizard-platform">
                            <option value="CF">Codeforces</option>
                            <option value="VNOJ">VNOJ</option>
                            <option value="SPOJ">SPOJ</option>
                            <option value="Atcoder">AtCoder</option>
                            <option value="Other" selected>Other</option>
                        </select>
                    </div>
                    <div class="cp-wizard-preview" id="cp-wizard-preview" style="font-size:11px;opacity:.7;padding:4px 2px"></div>
                </div>
                <div class="note-dialog-footer">
                    <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                    <button class="note-dialog-btn note-dialog-save">Create →</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const nameInput = document.getElementById('cp-wizard-name');
        const lastIdInput = document.getElementById('cp-wizard-last-id');
        const platformSelect = document.getElementById('cp-wizard-platform');
        const preview = document.getElementById('cp-wizard-preview');
        const saveBtn = overlay.querySelector('.note-dialog-save');
        const cancelBtn = overlay.querySelector('.note-dialog-cancel');
        const closeBtn = overlay.querySelector('.note-dialog-close');

        const updatePreview = () => {
            const val = lastIdInput.value.trim().toUpperCase();
            const ids = this._idsUpTo(val);
            preview.textContent = ids.length ? 'Will create: ' + ids.join(', ') : '';
        };

        lastIdInput.oninput = updatePreview;
        updatePreview();
        setTimeout(() => nameInput && nameInput.focus(), 50);

        const closeDialog = () => overlay.remove();

        const createContest = async () => {
            const name = nameInput.value.trim();
            const lastIdRaw = lastIdInput.value.trim().toUpperCase();
            const platform = platformSelect.value;

            if (!name) { nameInput.focus(); return; }
            if (!lastIdRaw) { lastIdInput.focus(); return; }

            const problemIds = this._idsUpTo(lastIdRaw);
            if (problemIds.length === 0) { lastIdInput.focus(); return; }

            if (!this.currentFolder) {
                alert('Open a folder first.');
                return;
            }

            if (window.electronAPI && window.electronAPI.createContest) {
                const result = await window.electronAPI.createContest({
                    parentDir: this.currentFolder,
                    name,
                    problemIds,
                    platform
                });

                if (result.success) {
                    this.currentFolder = result.contestDir;
                    this.expandedFolders.clear();
                    this.expandedFolders.add(result.contestDir);
                    this.loadCategoriesForFolder(this.currentFolder);
                    await this.refreshTree();
                    this.saveState();
                    closeDialog();
                } else {
                    alert('Failed to create contest: ' + (result.error || 'Unknown error'));
                }
            }
        };

        saveBtn.onclick = createContest;
        cancelBtn.onclick = closeDialog;
        closeBtn.onclick = closeDialog;

        nameInput.onkeydown = (e) => {
            if (e.key === 'Escape') closeDialog();
            if (e.key === 'Enter') lastIdInput.focus();
        };
        lastIdInput.onkeydown = (e) => {
            if (e.key === 'Escape') closeDialog();
            if (e.key === 'Enter') createContest();
        };
    },

    /**
     * Generate an array of problem IDs from A up to a given letter (single char A-Z or two chars AA-ZZ)
     */
    _idsUpTo(lastId) {
        if (!lastId) return [];
        lastId = lastId.toUpperCase();
        const problems = [];
        if (lastId.length === 1) {
            // A–Z range
            const end = lastId.charCodeAt(0);
            if (end < 65 || end > 90) return [];
            for (let c = 65; c <= end; c++) problems.push(String.fromCharCode(c));
        } else if (lastId.length === 2) {
            // AA–ZZ range (26 single + AA onwards)
            for (let c = 65; c <= 90; c++) problems.push(String.fromCharCode(c));
            const end1 = lastId.charCodeAt(0);
            const end2 = lastId.charCodeAt(1);
            for (let c1 = 65; c1 <= end1; c1++) {
                const c2Max = (c1 === end1) ? end2 : 90;
                for (let c2 = 65; c2 <= c2Max; c2++) {
                    problems.push(String.fromCharCode(c1) + String.fromCharCode(c2));
                }
            }
        }
        return problems;
    },

    // ==================== CATEGORIES (Collections) SYSTEM ====================

    /**
     * Category colors palette
     */
    CATEGORY_COLORS: [
        '#64b5f6', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc',
        '#26c6da', '#ffca28', '#8d6e63', '#78909c', '#ec407a',
        '#7e57c2', '#29b6f6', '#9ccc65', '#ff7043',
    ],

    /**
     * Create a new category (folder-backed: creates a real folder on disk)
     */
    async createCategory(name, color) {
        const id = 'cat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        const sanitizedName = name.trim().replace(/[<>:"/\\|?*]/g, '_');

        // Create folder on disk if we have a current folder
        let folderPath = null;
        if (this.currentFolder) {
            folderPath = `${this.currentFolder}/${sanitizedName}`.replace(/\\/g, '/');
            try {
                if (window.electronAPI && window.electronAPI.createDirectory) {
                    await window.electronAPI.createDirectory(folderPath);
                }
            } catch (err) {
                console.warn('[FileExplorer] Could not create collection folder:', err);
            }
        }

        const cat = {
            id,
            name: name.trim(),
            color: color || this.CATEGORY_COLORS[this.categories.length % this.CATEGORY_COLORS.length],
            items: [],
            folderPath: folderPath,
            createdAt: new Date().toISOString(),
        };
        this.categories.push(cat);
        this.saveState();
        if (folderPath) this.refreshTree();
        return cat;
    },

    /**
     * Rename a category (also renames folder on disk)
     */
    async renameCategory(catId, newName) {
        const cat = this.categories.find(c => c.id === catId);
        if (cat && newName && newName.trim()) {
            const oldName = cat.name;
            cat.name = newName.trim();

            // Rename folder on disk if it exists
            if (cat.folderPath && this.currentFolder) {
                const sanitizedNew = newName.trim().replace(/[<>:"/\\|?*]/g, '_');
                const newFolderPath = `${this.currentFolder}/${sanitizedNew}`.replace(/\\/g, '/');
                if (cat.folderPath !== newFolderPath) {
                    try {
                        if (window.electronAPI && window.electronAPI.moveFile) {
                            await window.electronAPI.moveFile(cat.folderPath, newFolderPath);
                            // Update all item paths
                            const oldPrefix = cat.folderPath.replace(/\\/g, '/');
                            const newPrefix = newFolderPath;
                            for (const item of cat.items) {
                                if (item.filePath.replace(/\\/g, '/').startsWith(oldPrefix)) {
                                    item.filePath = item.filePath.replace(/\\/g, '/').replace(oldPrefix, newPrefix);
                                    item.fileName = item.filePath.split('/').pop();
                                }
                            }
                            cat.folderPath = newFolderPath;
                        }
                    } catch (err) {
                        console.warn('[FileExplorer] Could not rename collection folder:', err);
                    }
                }
            }

            this.saveState();
        }
    },

    /**
     * Change category color
     */
    setCategoryColor(catId, color) {
        const cat = this.categories.find(c => c.id === catId);
        if (cat) {
            cat.color = color;
            this.saveState();
        }
    },

    /**
     * Delete a category (does NOT delete the actual files)
     */
    deleteCategory(catId) {
        this.categories = this.categories.filter(c => c.id !== catId);
        this.collapsedCategories.delete(catId);
        this.saveState();
    },

    /**
     * Add file to a category
     */
    addFileToCategory(catId, filePath, displayName, status) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;

        // Don't add duplicates
        if (cat.items.some(i => i.filePath === filePath)) return;

        const fileName = filePath.split(/[/\\]/).pop();
        cat.items.push({
            filePath,
            name: displayName || fileName.replace(/\.[^.]+$/, ''),
            fileName,
            status: status || 'todo',
            addedAt: Date.now(),
        });
        this.saveState();
    },

    /**
     * Create a new problem file inside a category's folder
     */
    async createProblemInCategory(catId, problemName) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;

        // Determine folder path
        let folderPath = cat.folderPath;
        if (!folderPath && this.currentFolder) {
            const sanitizedName = cat.name.replace(/[<>:"/\\|?*]/g, '_');
            folderPath = `${this.currentFolder}/${sanitizedName}`.replace(/\\/g, '/');
            cat.folderPath = folderPath;
        }
        if (!folderPath) return;

        // Ensure folder exists
        try {
            if (window.electronAPI && window.electronAPI.createDirectory) {
                await window.electronAPI.createDirectory(folderPath);
            }
        } catch (_) { }

        // Sanitize problem name for file
        const safeName = problemName.trim().replace(/[<>:"/\\|?*]/g, '_');
        const fileName = safeName.endsWith('.cpp') ? safeName : `${safeName}.cpp`;
        const filePath = `${folderPath}/${fileName}`.replace(/\\/g, '/');

        // Generate template
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const template = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n\n    // TODO: solve ${baseName}\n\n    return 0;\n}\n`;

        // Create file
        if (window.electronAPI && window.electronAPI.saveFile) {
            const result = await window.electronAPI.saveFile({ path: filePath, content: template });
            if (result && result.success !== false) {
                // Add to category
                this.addFileToCategory(catId, filePath, baseName, 'todo');
                await this.refreshTree();
                this.openFile(filePath);
            }
        }
    },

    /**
     * Sync a category's items with the files actually present in its folder.
     * Adds new files found on disk, removes items whose files no longer exist.
     */
    async syncCategoryWithFolder(catId) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat || !cat.folderPath) return;

        try {
            if (!window.electronAPI || !window.electronAPI.readDirectory) return;
            const entries = await window.electronAPI.readDirectory(cat.folderPath);
            if (!entries || !Array.isArray(entries) || entries.length === 0) return;

            const files = entries.filter(e => e.isFile && /\.(cpp|c|cc|cxx|h|hpp|py|java)$/i.test(e.name));
            const existingPaths = new Set(cat.items.map(i => i.filePath.replace(/\\/g, '/')));

            let changed = false;
            for (const file of files) {
                const filePath = `${cat.folderPath}/${file.name}`.replace(/\\/g, '/');
                if (!existingPaths.has(filePath)) {
                    const baseName = file.name.replace(/\.[^.]+$/, '');
                    cat.items.push({
                        filePath,
                        name: baseName,
                        fileName: file.name,
                        status: 'todo',
                        addedAt: Date.now(),
                    });
                    changed = true;
                }
            }

            // Remove items whose files no longer exist on disk
            const diskPaths = new Set(files.map(f => `${cat.folderPath}/${f.name}`.replace(/\\/g, '/')));
            const before = cat.items.length;
            cat.items = cat.items.filter(item => {
                const normalPath = item.filePath.replace(/\\/g, '/');
                // Only remove if the file was in this category's folder (not external files)
                if (normalPath.startsWith(cat.folderPath.replace(/\\/g, '/'))) {
                    return diskPaths.has(normalPath);
                }
                return true; // keep external files
            });
            if (cat.items.length !== before) changed = true;

            if (changed) this.saveState();
        } catch (err) {
            console.warn('[FileExplorer] syncCategoryWithFolder error:', err);
        }
    },

    /**
     * Sync ALL categories with their disk folders
     */
    async syncAllCategories() {
        for (const cat of this.categories) {
            if (cat.folderPath) {
                await this.syncCategoryWithFolder(cat.id);
            }
        }
    },

    /**
     * Remove file from a category
     */
    removeFileFromCategory(catId, filePath) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;
        cat.items = cat.items.filter(i => i.filePath !== filePath);
        this.saveState();
    },

    /**
     * Rename a file item within a category
     */
    renameCategoryItem(catId, filePath, newName) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;
        const item = cat.items.find(i => i.filePath === filePath);
        if (item && newName && newName.trim()) {
            item.name = newName.trim();
            this.saveState();
        }
    },

    /**
     * Set status on a category item
     */
    setCategoryItemStatus(catId, filePath, status) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;
        const item = cat.items.find(i => i.filePath === filePath);
        if (item) {
            item.status = status;
            this.saveState();
        }
    },

    /**
     * Toggle category collapse
     */
    toggleCategoryCollapse(catId) {
        if (this.collapsedCategories.has(catId)) {
            this.collapsedCategories.delete(catId);
        } else {
            this.collapsedCategories.add(catId);
        }
        this.saveState();
    },

    /**
     * Move category up/down
     */
    moveCategoryOrder(catId, direction) {
        const idx = this.categories.findIndex(c => c.id === catId);
        if (idx < 0) return;
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= this.categories.length) return;
        [this.categories[idx], this.categories[newIdx]] = [this.categories[newIdx], this.categories[idx]];
        this.saveState();
    },

    /**
     * Render the CONTEST sub-categories section (type === 'contest')
     * Shows contest sub-folders as collapsible items separate from COLLECTIONS
     */
    renderContestSection() {
        const contestCats = this.categories
            .filter(c => c.type === 'contest')
            .sort((a, b) => {
                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return dateB - dateA; // newest first
            });

        let html = '<div class="cp-sub-contest-section">';
        html += `<div class="cat-section-header">
            <button class="cat-section-toggle ${this.contestSectionCollapsed ? 'collapsed' : ''}" data-action="toggle-section" data-section="contest" title="${this.contestSectionCollapsed ? 'Expand' : 'Collapse'} Contest section">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <span class="cat-section-title">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffa726" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>CONTEST
            </span>
            <button class="cat-add-btn" data-action="new-sub-contest" title="New Contest">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
        </div>`;

        if (this.contestSectionCollapsed) {
            html += '</div>';
            return html;
        }

        if (contestCats.length === 0) {
            html += `
                <div class="cat-empty-hint">
                    <span style="font-size:11px;opacity:0.5">No contests — click + to create one</span>
                </div>
            `;
            html += '</div>';
            return html;
        }

        for (const cat of contestCats) {
            const isCollapsed = this.collapsedCategories.has(cat.id);
            const itemCount = cat.items.length;
            const solvedCount = cat.items.filter(i => i.status === 'ac').length;
            const pct = itemCount > 0 ? Math.round((solvedCount / itemCount) * 100) : 0;

            const dateLabel = cat.createdAt ? this._formatRelativeDate(cat.createdAt) : '';

            html += `
                <div class="cat-group ${isCollapsed ? 'collapsed' : ''}" data-cat-id="${cat.id}"
                     style="--cat-color: ${cat.color}">
                    <div class="cat-header" data-cat-id="${cat.id}">
                        <span class="cat-arrow">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </span>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffa726" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        <span class="cat-name">${cat.name}</span>
                        ${dateLabel ? `<span class="cat-date">${dateLabel}</span>` : ''}
                        <span class="cat-count">${solvedCount}/${itemCount}</span>
                        <button class="cat-new-problem-btn" data-cat-id="${cat.id}" data-action="new-problem-quick" title="New Problem">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>
                    </div>
            `;

            if (!isCollapsed) {
                // Mini progress bar
                if (itemCount > 0) {
                    html += `
                        <div class="cat-progress">
                            <div class="cat-progress-bar">
                                <div class="cat-progress-fill" style="width: ${pct}%; background: ${cat.color}"></div>
                            </div>
                        </div>
                    `;
                }

                // Problem items (list style for better readability)
                if (itemCount > 0) {
                    const sortedItems = [...cat.items].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
                    html += '<div class="cat-items-list">';
                    for (const item of sortedItems) {
                        const statusInfo = this.CP_STATUSES[item.status] || this.CP_STATUSES.todo;
                        const statusIcon = this.STATUS_ICONS[item.status] || this.STATUS_ICONS.todo;
                        const isActive = this.isActiveFile(item.filePath);
                        html += `
                            <div class="cat-list-item ${isActive ? 'active' : ''} cp-status-${item.status || 'todo'}"
                                 data-cat-id="${cat.id}" data-file-path="${item.filePath}"
                                 draggable="true" title="${item.fileName}">
                                <span class="cat-list-item-status">${statusIcon}</span>
                                <span class="cat-list-item-name">${item.name}</span>
                                <span class="cat-list-item-badge cp-badge-${item.status || 'todo'}">${statusInfo.label}</span>
                            </div>
                        `;
                    }
                    html += '</div>';
                } else {
                    html += `
                        <div class="cat-empty-drop" data-cat-id="${cat.id}">
                            <span>No problems yet</span>
                            <button class="cat-add-file-btn" data-cat-id="${cat.id}" data-action="new-problem-quick">+ New Problem</button>
                        </div>
                    `;
                }

                // Drop zone
                html += `<div class="cat-drop-zone" data-cat-id="${cat.id}">Drop here to add</div>`;
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Render COLLECTIONS section HTML (type !== 'contest')
     */
    renderCategories() {
        const collectionCats = this.categories
            .filter(c => c.type !== 'contest')
            .sort((a, b) => {
                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return dateB - dateA; // newest first
            });

        let html = '<div class="cat-section">';
        html += `<div class="cat-section-header">
            <button class="cat-section-toggle ${this.collectionsSectionCollapsed ? 'collapsed' : ''}" data-action="toggle-section" data-section="collections" title="${this.collectionsSectionCollapsed ? 'Expand' : 'Collapse'} Collections section">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <span class="cat-section-title">${this.ICONS.collection} COLLECTIONS</span>
            <button class="cat-add-btn" data-action="new-category" title="New Collection">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
        </div>`;

        if (this.collectionsSectionCollapsed) {
            html += '</div>';
            return html;
        }

        if (collectionCats.length === 0) {
            html += `
                <div class="cat-empty-hint">
                    <span style="font-size:11px;opacity:0.5">Create a collection to organize problems</span>
                </div>
            `;
            html += '</div>';
            return html;
        }

        for (const cat of collectionCats) {
            const isCollapsed = this.collapsedCategories.has(cat.id);
            const itemCount = cat.items.length;
            const solvedCount = cat.items.filter(i => i.status === 'ac').length;
            const pct = itemCount > 0 ? Math.round((solvedCount / itemCount) * 100) : 0;

            html += `
                <div class="cat-group ${isCollapsed ? 'collapsed' : ''}" data-cat-id="${cat.id}"
                     style="--cat-color: ${cat.color}">
                    <div class="cat-header" data-cat-id="${cat.id}">
                        <span class="cat-arrow">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </span>
                        <span class="cat-kind-icon" title="Collection">${this.ICONS.collection}</span>
                        <span class="cat-color-dot" style="background: ${cat.color}"></span>
                        <span class="cat-name">${cat.name}</span>
                        <span class="cat-count">${solvedCount}/${itemCount}</span>
                        <button class="cat-new-problem-btn" data-cat-id="${cat.id}" data-action="new-problem-quick" title="New Problem">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        </button>
                    </div>
            `;

            if (!isCollapsed) {
                // Mini progress bar
                if (itemCount > 0) {
                    html += `
                        <div class="cat-progress">
                            <div class="cat-progress-bar">
                                <div class="cat-progress-fill" style="width: ${pct}%; background: ${cat.color}"></div>
                            </div>
                        </div>
                    `;
                }

                // Items (list style for better readability)
                if (itemCount > 0) {
                    // Sort items by addedAt descending (newest first)
                    const sortedItems = [...cat.items].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
                    html += '<div class="cat-items-list">';
                    for (const item of sortedItems) {
                        const statusInfo = this.CP_STATUSES[item.status] || this.CP_STATUSES.todo;
                        const statusIcon = this.STATUS_ICONS[item.status] || this.STATUS_ICONS.todo;
                        const isActive = this.isActiveFile(item.filePath);
                        html += `
                            <div class="cat-list-item ${isActive ? 'active' : ''} cp-status-${item.status || 'todo'}"
                                 data-cat-id="${cat.id}" data-file-path="${item.filePath}" 
                                 draggable="true" title="${item.fileName}">
                                <span class="cat-list-item-status">${statusIcon}</span>
                                <span class="cat-list-item-name">${item.name}</span>
                                <span class="cat-list-item-badge cp-badge-${item.status || 'todo'}">${statusInfo.label}</span>
                            </div>
                        `;
                    }
                    html += '</div>';
                } else {
                    html += `
                        <div class="cat-empty-drop" data-cat-id="${cat.id}">
                            <span>Drop files here or</span>
                            <button class="cat-add-file-btn" data-cat-id="${cat.id}" data-action="new-problem-quick">+ New Problem</button>
                        </div>
                    `;
                }

                // Drop zone (visible during drag)
                html += `<div class="cat-drop-zone" data-cat-id="${cat.id}">Drop here to add</div>`;
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Check if a file path matches the currently open file
     */
    isActiveFile(filePath) {
        const currentPath = window.App?.currentFilePath || window.currentFilePath;
        if (!currentPath) return false;
        return currentPath.replace(/\\/g, '/') === filePath.replace(/\\/g, '/');
    },

    /**
     * Attach event listeners for category UI
     */
    attachCategoryEventListeners() {
        this.elements.tree.querySelectorAll('[data-action="toggle-section"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const section = btn.dataset.section;
                if (section === 'contest') {
                    this.contestSectionCollapsed = !this.contestSectionCollapsed;
                } else if (section === 'collections') {
                    this.collectionsSectionCollapsed = !this.collectionsSectionCollapsed;
                }
                this.saveState();
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            });
        });

        // New category button
        const newCatBtn = this.elements.tree.querySelector('[data-action="new-category"]');
        if (newCatBtn) {
            newCatBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptCreateCategory();
            });
        }

        // Category headers (collapse toggle)
        this.elements.tree.querySelectorAll('.cat-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) return;
                const catId = header.dataset.catId;
                this.toggleCategoryCollapse(catId);
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            });

            // Right-click context menu on category header
            header.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showCategoryContextMenu(e, header.dataset.catId);
            });
        });

        // Category items (click to open, right-click for menu) - supports both .cat-item and .cat-list-item
        this.elements.tree.querySelectorAll('.cat-item, .cat-list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const filePath = item.dataset.filePath;
                if (filePath) {
                    this.openFile(filePath);
                }
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showCategoryItemContextMenu(e, item.dataset.catId, item.dataset.filePath);
            });

            // Drag start from category item (to move between categories)
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/cat-item', JSON.stringify({
                    catId: item.dataset.catId,
                    filePath: item.dataset.filePath,
                }));
                e.dataTransfer.effectAllowed = 'move';
                item.classList.add('dragging');

                // Create custom drag preview
                const ghost = this._createDragGhost(item);
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 12, 12);
                setTimeout(() => ghost.remove(), 0);

                // Show target hints on other categories
                this.elements.tree.querySelectorAll('.cat-group').forEach(g => {
                    if (g.dataset.catId !== item.dataset.catId) {
                        g.classList.add('drag-target-hint');
                    }
                });
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                // Hide all drop zone hints
                this.elements.tree.querySelectorAll('.cat-group').forEach(g => g.classList.remove('drag-target-hint'));
                this.elements.tree.querySelectorAll('.cat-drop-zone').forEach(z => z.classList.remove('visible'));
            });
        });

        // Add file buttons in empty categories
        this.elements.tree.querySelectorAll('[data-action="add-file-to-cat"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptAddFileToCategory(btn.dataset.catId);
            });
        });

        // New problem quick buttons (header + and empty state)
        this.elements.tree.querySelectorAll('[data-action="new-problem-quick"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const catId = btn.dataset.catId;
                this.showInputDialog('New Problem Name', '', async (name) => {
                    if (name && name.trim()) {
                        await this.createProblemInCategory(catId, name.trim());
                        this.renderTree ? this.renderTree() : this.renderEmptyState();
                    }
                });
            });
        });

        // Drop zones for categories
        this.elements.tree.querySelectorAll('.cat-group').forEach(group => {
            const catId = group.dataset.catId;

            group.addEventListener('dragover', (e) => {
                e.preventDefault();
                // Use 'move' for tab drags (effectAllowed='move'), 'copy' for file drags
                if (e.dataTransfer.types.includes('application/x-sameko-tab') || e.dataTransfer.types.includes('text/cat-item')) {
                    e.dataTransfer.dropEffect = 'move';
                } else {
                    e.dataTransfer.dropEffect = 'copy';
                }
                group.classList.add('drag-over');
                const dropZone = group.querySelector('.cat-drop-zone');
                if (dropZone) dropZone.classList.add('visible');
            });

            group.addEventListener('dragleave', (e) => {
                // Only remove if leaving the group entirely
                if (!group.contains(e.relatedTarget)) {
                    group.classList.remove('drag-over');
                    const dropZone = group.querySelector('.cat-drop-zone');
                    if (dropZone) dropZone.classList.remove('visible');
                }
            });

            group.addEventListener('drop', (e) => {
                e.preventDefault();
                group.classList.remove('drag-over');
                const dropZone = group.querySelector('.cat-drop-zone');
                if (dropZone) dropZone.classList.remove('visible');

                // Handle drop from category item (move between categories)
                const catItemData = e.dataTransfer.getData('text/cat-item');
                if (catItemData) {
                    try {
                        const { catId: fromCatId, filePath } = JSON.parse(catItemData);
                        if (fromCatId !== catId) {
                            // Get item info from source category
                            const fromCat = this.categories.find(c => c.id === fromCatId);
                            const itemData = fromCat?.items.find(i => i.filePath === filePath);
                            if (itemData) {
                                this.addFileToCategory(catId, itemData.filePath, itemData.name, itemData.status);
                                this.removeFileFromCategory(fromCatId, filePath);
                                this.renderTree ? this.renderTree() : this.renderEmptyState();
                            }
                        }
                    } catch (_) { }
                    return;
                }

                // Handle drop from file tree item
                const filePath = e.dataTransfer.getData('text/explorer-path');
                if (filePath) {
                    const fileName = filePath.split(/[/\\]/).pop();
                    const name = fileName.replace(/\.[^.]+$/, '');
                    this.addFileToCategory(catId, filePath, name);
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                    return;
                }

                // Handle drop from editor tab (including untitled files)
                const tabId = e.dataTransfer.getData('application/x-sameko-tab');
                if (tabId && window.App && window.App.tabs) {
                    const tab = window.App.tabs.find(t => t.id === tabId);
                    if (!tab) {
                        console.warn('[FileExplorer] Drop: tab not found for id:', tabId);
                        return;
                    }

                    // Validate category still exists
                    const targetCat = this.categories.find(c => c.id === catId);
                    if (!targetCat) {
                        console.warn('[FileExplorer] Drop: category not found:', catId);
                        if (typeof log === 'function') log('Collection không tồn tại. Hãy tạo mới.', 'warning');
                        this.renderTree ? this.renderTree() : this.renderEmptyState();
                        return;
                    }

                    // Sync editor content to tab before processing
                    if (tab.id === window.App.activeTabId && window.App.editor) {
                        tab.content = window.App.editor.getValue();
                    } else if (tab.id === window.App.splitTabId && window.App.editor2) {
                        tab.content = window.App.editor2.getValue();
                    }

                    if (tab.path) {
                        // Saved file — just add to category
                        const fName = tab.path.split(/[/\\]/).pop();
                        const dName = fName.replace(/\.[^.]+$/, '');
                        this.addFileToCategory(catId, tab.path.replace(/\\/g, '/'), dName);
                        this.renderTree ? this.renderTree() : this.renderEmptyState();
                    } else {
                        // Untitled file — prompt for name and save
                        console.log('[FileExplorer] Drop untitled tab into category:', catId, 'content length:', (tab.content || '').length);
                        this.promptSaveUntitledToCategory(catId, tab);
                    }
                    return;
                }

                // Handle external file drop (from OS)
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    for (const file of e.dataTransfer.files) {
                        const path = file.path || file.name;
                        if (path) {
                            const name = path.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
                            this.addFileToCategory(catId, path.replace(/\\/g, '/'), name);
                        }
                    }
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }
            });
        });

        // Make tree items draggable into categories with custom drag preview
        this.elements.tree.querySelectorAll('.explorer-item.file').forEach(item => {
            if (!item.getAttribute('draggable')) {
                item.setAttribute('draggable', 'true');
                item.addEventListener('dragstart', (e) => {
                    const path = item.dataset.path;
                    if (path) {
                        e.dataTransfer.setData('text/explorer-path', path);
                        e.dataTransfer.effectAllowed = 'copyMove';
                        item.classList.add('dragging');

                        // Create custom drag preview
                        const ghost = this._createDragGhost(item);
                        document.body.appendChild(ghost);
                        e.dataTransfer.setDragImage(ghost, 12, 12);
                        setTimeout(() => ghost.remove(), 0);

                        // Show all drop zones
                        this.elements.tree.querySelectorAll('.cat-group').forEach(g => g.classList.add('drag-target-hint'));
                    }
                });
                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    // Hide all drop zone hints
                    this.elements.tree.querySelectorAll('.cat-group').forEach(g => g.classList.remove('drag-target-hint'));
                    this.elements.tree.querySelectorAll('.cat-drop-zone').forEach(z => z.classList.remove('visible'));
                });
            }
        });

        // Reorder support within categories (drag between list items)
        this.elements.tree.querySelectorAll('.cat-items-list').forEach(list => {
            list.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = list.querySelector('.dragging');
                if (!dragging) return;

                const siblings = [...list.querySelectorAll('.cat-list-item:not(.dragging)')];
                const afterElement = siblings.reduce((closest, child) => {
                    const box = child.getBoundingClientRect();
                    const offset = e.clientY - box.top - box.height / 2;
                    if (offset < 0 && offset > closest.offset) {
                        return { offset, element: child };
                    }
                    return closest;
                }, { offset: Number.NEGATIVE_INFINITY }).element;

                if (afterElement) {
                    list.insertBefore(dragging, afterElement);
                } else {
                    list.appendChild(dragging);
                }
            });

            list.addEventListener('drop', (e) => {
                // After reorder, save the new ordering
                const catId = list.closest('.cat-group')?.dataset.catId;
                if (!catId) return;

                const cat = this.categories.find(c => c.id === catId);
                if (!cat) return;

                // Read new order from DOM
                const newOrder = [];
                list.querySelectorAll('.cat-list-item').forEach(el => {
                    const filePath = el.dataset.filePath;
                    const item = cat.items.find(i => i.filePath === filePath);
                    if (item) newOrder.push(item);
                });

                if (newOrder.length === cat.items.length) {
                    cat.items = newOrder;
                    this.saveState();
                }
            });
        });
    },

    /**
     * Create a lightweight drag ghost element for better drag UX
     */
    _createDragGhost(sourceEl) {
        const ghost = document.createElement('div');
        ghost.className = 'explorer-drag-ghost';
        const name = sourceEl.querySelector('.explorer-item-name, .cat-list-item-name, .cat-item-name');
        ghost.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>${name ? name.textContent : 'File'}</span>
        `;
        // Position offscreen so it doesn't flash
        ghost.style.position = 'fixed';
        ghost.style.left = '-9999px';
        ghost.style.top = '-9999px';
        return ghost;
    },

    /**
     * Show context menu for a category header
     */
    showCategoryContextMenu(e, catId) {
        document.querySelectorAll('.explorer-context-menu').forEach(el => el.remove());

        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;

        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        // Build color submenu
        const colorsHtml = this.CATEGORY_COLORS.map(color =>
            `<span class="cat-color-option ${cat.color === color ? 'active' : ''}" 
                   data-color="${color}" style="background: ${color}"></span>`
        ).join('');

        const catIdx = this.categories.indexOf(cat);

        menu.innerHTML = `
            <div class="context-item" data-action="new-problem">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                New Problem
            </div>
            <div class="context-item" data-action="add-file">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Existing File
            </div>
            <div class="context-item" data-action="add-current-file">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Add Current File
            </div>
            ${cat.folderPath ? `
            <div class="context-item" data-action="open-folder">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                Open Folder
            </div>` : ''}
            <div class="context-separator"></div>
            <div class="context-item" data-action="rename">
                Rename
            </div>
            <div class="context-item has-submenu" data-action="color-menu">
                <span>Change Color</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu cat-color-submenu">
                    <div class="cat-color-grid">${colorsHtml}</div>
                </div>
            </div>
            <div class="context-separator"></div>
            ${catIdx > 0 ? '<div class="context-item" data-action="move-up">Move Up</div>' : ''}
            ${catIdx < this.categories.length - 1 ? '<div class="context-item" data-action="move-down">Move Down</div>' : ''}
            ${catIdx > 0 || catIdx < this.categories.length - 1 ? '<div class="context-separator"></div>' : ''}
            <div class="context-item has-submenu danger" data-action="delete-menu">
                <span>Delete Collection</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu delete-submenu">
                    <div class="context-item danger" data-action="delete-collection-only">Remove collection only</div>
                    ${cat.folderPath ? '<div class="context-item danger" data-action="delete-collection-folder">Delete folder on disk</div>' : ''}
                </div>
            </div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        // Color submenu hover
        const colorMenuItem = menu.querySelector('[data-action="color-menu"]');
        const colorSubmenu = menu.querySelector('.cat-color-submenu');
        if (colorMenuItem && colorSubmenu) {
            let subTimeout;
            colorMenuItem.addEventListener('mouseenter', () => { clearTimeout(subTimeout); colorSubmenu.classList.add('visible'); });
            colorMenuItem.addEventListener('mouseleave', () => {
                subTimeout = setTimeout(() => { if (!colorSubmenu.matches(':hover')) colorSubmenu.classList.remove('visible'); }, 200);
            });
            colorSubmenu.addEventListener('mouseenter', () => clearTimeout(subTimeout));
            colorSubmenu.addEventListener('mouseleave', () => colorSubmenu.classList.remove('visible'));

            colorSubmenu.querySelectorAll('.cat-color-option').forEach(opt => {
                opt.onclick = () => {
                    this.setCategoryColor(catId, opt.dataset.color);
                    menu.remove();
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                };
            });
        }

        const deleteMenuItem = menu.querySelector('[data-action="delete-menu"]');
        const deleteSubmenu = menu.querySelector('.delete-submenu');
        if (deleteMenuItem && deleteSubmenu) {
            let deleteTimeout;
            deleteMenuItem.addEventListener('mouseenter', () => { clearTimeout(deleteTimeout); deleteSubmenu.classList.add('visible'); });
            deleteMenuItem.addEventListener('mouseleave', () => {
                deleteTimeout = setTimeout(() => { if (!deleteSubmenu.matches(':hover')) deleteSubmenu.classList.remove('visible'); }, 200);
            });
            deleteSubmenu.addEventListener('mouseenter', () => clearTimeout(deleteTimeout));
            deleteSubmenu.addEventListener('mouseleave', () => deleteSubmenu.classList.remove('visible'));
        }

        menu.querySelector('[data-action="add-file"]').onclick = () => {
            menu.remove();
            this.promptAddFileToCategory(catId);
        };

        menu.querySelector('[data-action="new-problem"]').onclick = () => {
            menu.remove();
            this.showInputDialog('New Problem Name', '', async (name) => {
                if (name && name.trim()) {
                    await this.createProblemInCategory(catId, name.trim());
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }
            });
        };

        const openFolderBtn = menu.querySelector('[data-action="open-folder"]');
        if (openFolderBtn) {
            openFolderBtn.onclick = () => {
                menu.remove();
                if (cat.folderPath && window.electronAPI && window.electronAPI.showItemInFolder) {
                    window.electronAPI.showItemInFolder(cat.folderPath);
                }
            };
        }

        menu.querySelector('[data-action="add-current-file"]').onclick = () => {
            menu.remove();
            const currentPath = window.App?.currentFilePath || window.currentFilePath;
            if (currentPath) {
                const name = currentPath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
                this.addFileToCategory(catId, currentPath.replace(/\\/g, '/'), name);
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            }
        };

        menu.querySelector('[data-action="rename"]').onclick = () => {
            menu.remove();
            this.showInputDialog('Rename Collection', cat.name, async (newName) => {
                if (newName) {
                    await this.renameCategory(catId, newName);
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }
            });
        };

        const moveUpBtn = menu.querySelector('[data-action="move-up"]');
        if (moveUpBtn) {
            moveUpBtn.onclick = () => {
                this.moveCategoryOrder(catId, 'up');
                menu.remove();
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            };
        }

        const moveDownBtn = menu.querySelector('[data-action="move-down"]');
        if (moveDownBtn) {
            moveDownBtn.onclick = () => {
                this.moveCategoryOrder(catId, 'down');
                menu.remove();
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            };
        }

        const deleteOnlyBtn = menu.querySelector('[data-action="delete-collection-only"]');
        if (deleteOnlyBtn) {
            deleteOnlyBtn.onclick = () => {
                this.deleteCategory(catId);
                menu.remove();
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            };
        }

        const deleteFolderBtn = menu.querySelector('[data-action="delete-collection-folder"]');
        if (deleteFolderBtn) {
            deleteFolderBtn.onclick = async () => {
                if (cat.folderPath && window.electronAPI?.deleteFolder) {
                    try {
                        await window.electronAPI.deleteFolder(cat.folderPath);
                    } catch (err) {
                        console.warn('[FileExplorer] Could not delete collection folder:', err);
                    }
                }
                this.deleteCategory(catId);
                menu.remove();
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            };
        }

        /* legacy single-action delete removed in favor of submenu choices */

        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    /**
     * Show context menu for a category item
     */
    showCategoryItemContextMenu(e, catId, filePath) {
        document.querySelectorAll('.explorer-context-menu').forEach(el => el.remove());

        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;
        const item = cat.items.find(i => i.filePath === filePath);
        if (!item) return;

        const menu = document.createElement('div');
        menu.className = 'explorer-context-menu';

        // Status submenu
        let statusHtml = '';
        for (const [key, info] of Object.entries(this.CP_STATUSES)) {
            const isActive = item.status === key;
            statusHtml += `
                <div class="context-item ${isActive ? 'active' : ''}" data-action="set-status" data-status="${key}">
                    <span class="cp-menu-icon">${this.STATUS_ICONS[key]}</span> ${info.label}
                    ${isActive ? ' ' + this.ICONS.check : ''}
                </div>
            `;
        }

        // Other categories submenu for moving
        let moveHtml = '';
        const otherCats = this.categories.filter(c => c.id !== catId);
        if (otherCats.length > 0) {
            moveHtml = otherCats.map(c =>
                `<div class="context-item" data-action="move-to" data-target-cat="${c.id}">
                    <span class="cat-color-dot-mini" style="background: ${c.color}"></span>
                    ${c.name}
                </div>`
            ).join('');
        }

        menu.innerHTML = `
            <div class="context-item" data-action="open">Open File</div>
            <div class="context-separator"></div>
            <div class="context-item has-submenu" data-action="status-menu">
                <span>Set Status</span>
                <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                <div class="context-submenu cat-status-submenu">${statusHtml}</div>
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="rename-item">Rename Label</div>
            ${otherCats.length > 0 ? `
                <div class="context-item has-submenu" data-action="move-menu">
                    <span>Move to</span>
                    <span class="submenu-arrow">${this.ICONS.submenuArrow}</span>
                    <div class="context-submenu cat-move-submenu">${moveHtml}</div>
                </div>
            ` : ''}
            <div class="context-separator"></div>
            <div class="context-item" data-action="copy-path">Copy Path</div>
            <div class="context-item" data-action="remove" style="color:#ef5350">Remove from Collection</div>
        `;

        this.positionMenu(menu, e.clientX, e.clientY);

        // Status submenu hover
        const statusMenuItem = menu.querySelector('[data-action="status-menu"]');
        const statusSubmenu = menu.querySelector('.cat-status-submenu');
        if (statusMenuItem && statusSubmenu) {
            let subTimeout;
            statusMenuItem.addEventListener('mouseenter', () => { clearTimeout(subTimeout); statusSubmenu.classList.add('visible'); });
            statusMenuItem.addEventListener('mouseleave', () => {
                subTimeout = setTimeout(() => { if (!statusSubmenu.matches(':hover')) statusSubmenu.classList.remove('visible'); }, 200);
            });
            statusSubmenu.addEventListener('mouseenter', () => clearTimeout(subTimeout));
            statusSubmenu.addEventListener('mouseleave', () => statusSubmenu.classList.remove('visible'));

            statusSubmenu.querySelectorAll('[data-action="set-status"]').forEach(el => {
                el.onclick = () => {
                    this.setCategoryItemStatus(catId, filePath, el.dataset.status);
                    menu.remove();
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                };
            });
        }

        // Move submenu hover
        const moveMenuItem = menu.querySelector('[data-action="move-menu"]');
        const moveSubmenu = menu.querySelector('.cat-move-submenu');
        if (moveMenuItem && moveSubmenu) {
            let subTimeout;
            moveMenuItem.addEventListener('mouseenter', () => { clearTimeout(subTimeout); moveSubmenu.classList.add('visible'); });
            moveMenuItem.addEventListener('mouseleave', () => {
                subTimeout = setTimeout(() => { if (!moveSubmenu.matches(':hover')) moveSubmenu.classList.remove('visible'); }, 200);
            });
            moveSubmenu.addEventListener('mouseenter', () => clearTimeout(subTimeout));
            moveSubmenu.addEventListener('mouseleave', () => moveSubmenu.classList.remove('visible'));

            moveSubmenu.querySelectorAll('[data-action="move-to"]').forEach(el => {
                el.onclick = () => {
                    const targetCat = el.dataset.targetCat;
                    this.addFileToCategory(targetCat, item.filePath, item.name, item.status);
                    this.removeFileFromCategory(catId, filePath);
                    menu.remove();
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                };
            });
        }

        menu.querySelector('[data-action="open"]').onclick = () => {
            menu.remove();
            this.openFile(filePath);
        };

        menu.querySelector('[data-action="rename-item"]').onclick = () => {
            menu.remove();
            this.showInputDialog('Rename Label', item.name, (newName) => {
                if (newName) {
                    this.renameCategoryItem(catId, filePath, newName);
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }
            });
        };

        menu.querySelector('[data-action="copy-path"]').onclick = async () => {
            await this.copyText(filePath);
            menu.remove();
        };

        menu.querySelector('[data-action="remove"]').onclick = () => {
            this.removeFileFromCategory(catId, filePath);
            menu.remove();
            this.renderTree ? this.renderTree() : this.renderEmptyState();
        };

        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
    },

    /**
     * Prompt to create a new category
     */
    promptCreateCategory() {
        this.showInputDialog('New Collection Name', '', async (name) => {
            if (name && name.trim()) {
                await this.createCategory(name);
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            }
        });
    },

    /**
     * Prompt to add file to a specific category (shows dialog to choose from current folder or type path)
     */
    promptAddFileToCategory(catId) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat) return;

        // If current file is open, offer to add it directly
        const currentPath = window.App?.currentFilePath || window.currentFilePath;

        // Show file picker dialog
        if (currentPath) {
            const fileName = currentPath.split(/[/\\]/).pop();
            const name = fileName.replace(/\.[^.]+$/, '');
            // Ask if they want to add the current file
            const overlay = document.createElement('div');
            overlay.className = 'note-dialog-overlay';
            overlay.innerHTML = `
                <div class="note-dialog input-dialog">
                    <div class="note-dialog-header">
                        <h3>Add to "${cat.name}"</h3>
                        <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                    </div>
                    <div class="note-dialog-body">
                        <p style="font-size:12px;margin-bottom:12px;color:var(--text-secondary)">Add the currently open file, or browse for a file.</p>
                        <div class="cat-add-option" data-action="add-current" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:2px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:8px;transition:border-color 0.15s;">
                            ${this.getFileIcon(fileName)}
                            <div>
                                <div style="font-weight:600;font-size:13px">${fileName}</div>
                                <div style="font-size:10px;opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:250px">${currentPath}</div>
                            </div>
                        </div>
                        <div class="cat-add-option" data-action="browse" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:2px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color 0.15s;">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                            <span style="font-weight:600;font-size:13px">Browse for File...</span>
                        </div>
                        <div style="margin-top:12px">
                            <label style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Display Name</label>
                            <input type="text" class="input-dialog-field" id="cat-add-name" value="${name}" placeholder="Problem name..." />
                        </div>
                    </div>
                    <div class="note-dialog-footer">
                        <button class="note-dialog-btn note-dialog-cancel">Cancel</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const closeDialog = () => overlay.remove();
            overlay.querySelector('.note-dialog-close').onclick = closeDialog;
            overlay.querySelector('.note-dialog-cancel').onclick = closeDialog;

            overlay.querySelector('[data-action="add-current"]').onclick = () => {
                const displayName = document.getElementById('cat-add-name').value.trim() || name;
                this.addFileToCategory(catId, currentPath.replace(/\\/g, '/'), displayName);
                closeDialog();
                this.renderTree ? this.renderTree() : this.renderEmptyState();
            };

            overlay.querySelector('[data-action="browse"]').onclick = async () => {
                closeDialog();
                await this.browseAndAddToCategory(catId);
            };

            setTimeout(() => document.getElementById('cat-add-name')?.focus(), 50);
        } else {
            // No file open, just browse
            this.browseAndAddToCategory(catId);
        }
    },

    /**
     * Browse for a file and add it to a category
     */
    async browseAndAddToCategory(catId) {
        try {
            if (window.electronAPI && window.electronAPI.showOpenDialog) {
                const result = await window.electronAPI.showOpenDialog({
                    properties: ['openFile', 'multiSelections'],
                    filters: [
                        { name: 'Source Files', extensions: ['cpp', 'c', 'cc', 'cxx', 'h', 'hpp', 'py', 'java'] },
                        { name: 'All Files', extensions: ['*'] }
                    ]
                });

                if (!result.canceled && result.filePaths.length > 0) {
                    for (const filePath of result.filePaths) {
                        const normalizedPath = filePath.replace(/\\/g, '/');
                        const fileName = normalizedPath.split('/').pop();
                        const name = fileName.replace(/\.[^.]+$/, '');
                        this.addFileToCategory(catId, normalizedPath, name);
                    }
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }
            }
        } catch (e) {
            console.error('[FileExplorer] Browse failed:', e);
        }
    },

    /**
     * Prompt to create a new file in the current folder
     */
    promptNewFile() {
        if (!this.currentFolder) return;
        this.showInputDialog('New File Name', 'solution.cpp', (fileName) => {
            if (!fileName || !fileName.trim()) return;
            const filePath = `${this.currentFolder}/${fileName.trim()}`.replace(/\\/g, '/');

            let template = '';
            if (/\.(cpp|c|cc|cxx)$/i.test(fileName)) {
                const baseName = fileName.replace(/\.[^.]+$/, '');
                template = `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n\n    // TODO: solve ${baseName}\n\n    return 0;\n}\n`;
            }

            if (window.electronAPI && window.electronAPI.saveFile) {
                window.electronAPI.saveFile({ path: filePath, content: template }).then(() => {
                    this.refreshTree();
                    this.openFile(filePath);
                }).catch((err) => {
                    console.error('[FileExplorer] Failed to create new file:', err);
                    alert('Failed to create file: ' + (err?.message || err));
                });
            }
        });
    },

    /**
     * Prompt user to save an untitled tab into a category folder.
     * Supports both folder-based and no-folder mode (uses Save As dialog fallback).
     */
    promptSaveUntitledToCategory(catId, tab) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat) {
            console.warn('[FileExplorer] promptSaveUntitled: category not found:', catId);
            return;
        }

        // Determine the folder to save into
        let folderPath = cat.folderPath;
        if (!folderPath && this.currentFolder) {
            const sanitizedName = cat.name.replace(/[<>:"/\\|?*]/g, '_');
            folderPath = `${this.currentFolder}/${sanitizedName}`.replace(/\\/g, '/');
            cat.folderPath = folderPath;
        }
        if (!folderPath) {
            folderPath = this.currentFolder;
        }

        // No folder available — use Save As dialog as fallback
        if (!folderPath) {
            console.log('[FileExplorer] No folder path available, using Save As dialog');
            this._saveUntitledViaSaveAs(catId, tab);
            return;
        }

        const defaultName = tab.name || 'solution.cpp';
        this.showInputDialog(`Save to "${cat.name}"`, defaultName, async (fileName) => {
            if (!fileName || !fileName.trim()) return;
            fileName = fileName.trim();
            if (!/\.[^.]+$/.test(fileName)) fileName += '.cpp';

            const filePath = `${folderPath}/${fileName}`.replace(/\\/g, '/');
            const content = tab.content || '';

            // Ensure folder exists
            try {
                if (window.electronAPI && window.electronAPI.createDirectory) {
                    await window.electronAPI.createDirectory(folderPath);
                }
            } catch (err) {
                console.warn('[FileExplorer] Failed to create directory:', folderPath, err);
            }

            // Save file
            try {
                if (window.electronAPI && window.electronAPI.saveFile) {
                    const result = await window.electronAPI.saveFile({ path: filePath, content });
                    if (result && result.success !== false) {
                        const baseName = fileName.replace(/\.[^.]+$/, '');
                        this.addFileToCategory(catId, filePath, baseName, 'todo');

                        // Update the tab to point to the saved file
                        tab.path = filePath;
                        tab.name = fileName;
                        tab.modified = false;
                        if (window.App && window.App.renderTabs) window.App.renderTabs();
                        if (window.App && window.App.updateTitle) window.App.updateTitle();

                        await this.refreshTree();
                        this.openFile(filePath);
                    } else {
                        console.error('[FileExplorer] saveFile returned failure:', result);
                    }
                }
            } catch (err) {
                console.error('[FileExplorer] Failed to save untitled file:', err);
            }
        });
    },

    /**
     * Fallback: save untitled file via system Save As dialog, then add to category.
     * Used when no currentFolder is available.
     */
    async _saveUntitledViaSaveAs(catId, tab) {
        const content = tab.content || '';
        try {
            if (window.electronAPI && window.electronAPI.saveFileDialog) {
                const result = await window.electronAPI.saveFileDialog(content);
                if (result && result.success && result.path) {
                    const savedPath = result.path.replace(/\\/g, '/');
                    const fileName = savedPath.split(/[/\\]/).pop();
                    const baseName = fileName.replace(/\.[^.]+$/, '');

                    // Add to category
                    this.addFileToCategory(catId, savedPath, baseName, 'todo');

                    // Update the tab to point to the saved file
                    tab.path = savedPath;
                    tab.name = fileName;
                    tab.modified = false;
                    if (window.App && window.App.renderTabs) window.App.renderTabs();
                    if (window.App && window.App.updateTitle) window.App.updateTitle();

                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }
            }
        } catch (err) {
            console.error('[FileExplorer] Save As dialog failed:', err);
        }
    },

};

// Export for use in app.js
window.FileExplorer = FileExplorer;
