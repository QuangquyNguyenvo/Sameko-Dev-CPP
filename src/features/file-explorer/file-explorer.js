/**
 * File Explorer Module
 * 
 * Provides a sidebar file tree for navigating and opening files.
 * Features:
 * - Toggle on/off with animation
 * - Folder selection dialog
 * - Tree view with expand/collapse
 * - File icons based on extension
 * - Resizable sidebar
 */

const FileExplorer = {
    isOpen: false,
    currentFolder: null,
    width: 200,
    tree: [],
    expandedFolders: new Set(),
    fileStatuses: {}, // { path: 'working' | 'done' | 'stuck' | 'review' }
    fileNotes: {}, // { path: 'note text content' }

    // NEW: Approach versioning
    fileApproaches: {}, // { path: { current: 'id', versions: [...] } }
    expandedFiles: new Set(), // Track which .cpp files show their children (companions + approaches)

    // NEW: Pin & Recent
    pinnedItems: [], // Array of paths
    recentFiles: [], // Last N opened files (FIFO, max 5)

    // SVG Icons - no emojis, all inline SVGs
    ICONS: {
        // Note icon (pencil)
        note: '<svg class="icon-note" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',

        // Pin icon
        pin: '<svg class="icon-pin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76V6l-3-3h12l-3 3v4.76l3 3.24H6l3-3.24z"/></svg>',

        // Unpin icon (pin with slash)
        unpin: '<svg class="icon-unpin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76V6l-3-3h12l-3 3v4.76l3 3.24H6l3-3.24z"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',

        // Save/Approach icon (branch/git)
        approach: '<svg class="icon-approach" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6M18 15V6h-9"/></svg>',

        // Checkmark icon
        check: '<svg class="icon-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',

        // X mark icon
        cross: '<svg class="icon-cross" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',

        // Clock icon (for working status)
        clock: '<svg class="icon-clock" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',

        // Timer icon (for TLE)
        timer: '<svg class="icon-timer" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3l2 2M19 3l-2 2M12 2v2"/></svg>',

        // Memory icon (for MLE)
        memory: '<svg class="icon-memory" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/></svg>',

        // Warning icon (for RTE)
        warning: '<svg class="icon-warning" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',

        // Expand arrow
        arrow: '<svg class="icon-arrow" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',

        // Recent icon (history)
        recent: '<svg class="icon-recent" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 10"/><path d="M2 12h2M20 12h2"/></svg>',

        // Submenu arrow
        submenuArrow: '<svg class="icon-submenu" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',

        // Close button (X)
        close: '<svg class="icon-close" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
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
                this.width = state.width || 200;
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
            };
            localStorage.setItem('explorerState', JSON.stringify(state));
        } catch (e) {
            console.error('Failed to save explorer state:', e);
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

        const refreshBtn = document.getElementById('btn-refresh-explorer');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.refreshTree();
            });
        }
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
                    this.currentFolder = result.filePaths[0];
                    this.expandedFolders.clear();
                    this.expandedFolders.add(this.currentFolder);
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
     * Load directory contents recursively
     */
    async loadDirectory(dirPath, depth = 0) {
        if (depth > 10) return []; // Max depth protection

        try {
            const items = await window.electronAPI.readDirectory(dirPath);
            const result = [];

            for (const item of items) {
                const fullPath = `${dirPath}/${item.name}`.replace(/\\/g, '/');

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
            return this.groupCompanionFiles(sorted);
        } catch (e) {
            console.error('Failed to load directory:', dirPath, e);
            return [];
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

        if (!this.tree || this.tree.length === 0) {
            this.renderEmptyState();
            return;
        }

        // Get folder name for header
        const folderName = this.currentFolder.split(/[/\\]/).pop();

        // Build pinned section HTML
        let pinnedHtml = '';
        if (this.pinnedItems.length > 0) {
            const validPins = this.pinnedItems.filter(p => {
                // Check if pinned item still exists in tree
                return p.startsWith(this.currentFolder);
            });
            if (validPins.length > 0) {
                pinnedHtml = `
                    <div class="explorer-pinned-section">
                        <div class="explorer-section-title">${this.ICONS.pin} PINNED</div>
                        <div class="explorer-section-items">
                            ${validPins.map(path => {
                    const name = path.split(/[/\\]/).pop();
                    return `
                                    <div class="explorer-item file pinned-item" data-path="${path}" style="padding-left: 12px">
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

        this.elements.tree.innerHTML = `
            ${pinnedHtml}
            <div class="explorer-folder-header">
                <span class="explorer-folder-name" title="${this.currentFolder}">${folderName}</span>
            </div>
            <div class="explorer-items">
                ${this.renderItems(this.tree, 0)}
            </div>
            ${recentHtml}
        `;

        // Attach event listeners
        this.attachTreeEventListeners();
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
                const status = this.fileStatuses[item.path];
                const statusInfo = status ? this.STATUS_TYPES[status] : null;
                const isCpp = /\.(cpp|c|cc|cxx|h|hpp)$/i.test(item.name);
                const hasCompanions = item.companions && item.companions.length > 0;
                const approaches = this.fileApproaches[item.path];
                const hasApproaches = approaches && approaches.versions && approaches.versions.length > 0;
                const hasChildren = hasCompanions || hasApproaches;
                const isFileExpanded = this.expandedFiles.has(item.path);
                const note = this.fileNotes[item.path];
                const hasNote = !!note;

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
                        ${isCpp ? '<span class="explorer-mark-btn" title="Danh dau trang thai"></span>' : ''}
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
     * Render empty state
     */
    renderEmptyState() {
        if (!this.elements.tree) return;

        this.elements.tree.innerHTML = `
            <div class="explorer-empty">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <p>No folder opened</p>
                <button class="explorer-open-btn" id="btn-explorer-open-empty">Open Folder</button>
            </div>
        `;

        // Attach open folder event
        const openBtn = document.getElementById('btn-explorer-open-empty');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.openFolderDialog());
        }
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

                // Handle approach click
                if (item.classList.contains('approach')) {
                    const approachId = item.dataset.approachId;
                    this.switchToApproach(path, approachId);
                    return;
                }

                // Handle folder click
                if (item.classList.contains('folder')) {
                    this.toggleFolder(path);
                } else if (!item.classList.contains('companion')) {
                    // Handle file click (but not companion files, they are already shown nested)
                    this.openFile(path);
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

                    if (/\.(cpp|c|cc|cxx|h|hpp)$/i.test(path)) {
                        // Full menu for code files
                        this.showContextMenu(e, path);
                    } else {
                        // Simple menu for companion/other files
                        this.showSimpleContextMenu(e, path);
                    }
                });
            } else if (item.classList.contains('approach')) {
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const path = item.dataset.path;
                    const approachId = item.dataset.approachId;
                    this.showApproachContextMenu(e, path, approachId);
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
            <div class="context-separator"></div>
            <div class="context-item" data-action="copy-path">
                Copy Path
            </div>
            <div class="context-item" data-action="open-folder">
                Show in Explorer
            </div>
        `;

        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        document.body.appendChild(menu);

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

        // Copy path handler
        menu.querySelector('[data-action="copy-path"]').onclick = () => {
            navigator.clipboard.writeText(filePath);
            menu.remove();
        };

        // Open folder handler
        menu.querySelector('[data-action="open-folder"]').onclick = () => {
            this.openContainingFolder(filePath);
            menu.remove();
        };

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 10);
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

        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        document.body.appendChild(menu);

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

        menu.querySelector('[data-action="copy-path"]').onclick = () => {
            navigator.clipboard.writeText(filePath);
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

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                closeDialog();
            }
        };

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

        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);

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
        overlay.onclick = (e) => {
            if (e.target === overlay) closeDialog();
        };

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
        const newPath = dir + '/' + newName;

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
            return `<svg class="explorer-icon folder-open" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M20 19a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v2H6v10h14v-5h2v5z"/>
            </svg>`;
        }
        return `<svg class="explorer-icon folder-closed" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
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
            return `<svg class="explorer-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${config.color}" stroke-width="2">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
            </svg>`;
        } else if (config.icon === 'braces') {
            return `<svg class="explorer-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${config.color}" stroke-width="2">
                <path d="M8 3H7a2 2 0 00-2 2v5a2 2 0 01-2 2 2 2 0 012 2v5c0 1.1.9 2 2 2h1"/>
                <path d="M16 21h1a2 2 0 002-2v-5c0-1.1.9-2 2-2a2 2 0 01-2-2V5a2 2 0 00-2-2h-1"/>
            </svg>`;
        }

        return `<svg class="explorer-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${config.color}" stroke-width="2">
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

        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        document.body.appendChild(menu);

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
    }

};

// Export for use in app.js
window.FileExplorer = FileExplorer;
