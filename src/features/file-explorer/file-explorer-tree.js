/**
 * File Explorer — file collection, filtering and rendering of the tree; tree event listeners.
 * Part of the FileExplorer object; loaded after file-explorer.js (see index.html).
 */

Object.assign(FileExplorer, {
    /** Compiler output: executables, objects, debug-symbol files and macOS .dSYM bundles. */
    isBuildOutput(name, isDirectory) {
        if (isDirectory) return /\.dSYM$/i.test(name);
        return /\.(exe|o|obj|ilk|pdb|gch)$/i.test(name);
    },

    /**
     * Every source-like file under the open folder, for the filter box. Walked once per
     * refresh (collapsed folders are not loaded into this.tree) and capped so a huge folder
     * cannot stall the renderer.
     */
    async collectAllFiles() {
        if (this._allFiles || !this.currentFolder) return this._allFiles || [];
        // One walk per refresh, shared by the filter keystrokes that arrive while it
        // runs (each keystroke used to start its own recursive walk).
        const gen = this._allFilesGen;
        if (this._allFilesScan && this._allFilesScan.gen === gen) return this._allFilesScan.promise;
        const root = this.currentFolder;
        const promise = this._walkAllFiles(root).then((out) => {
            if (gen === this._allFilesGen && root === this.currentFolder) this._allFiles = out;
            return out;
        });
        this._allFilesScan = { gen, promise };
        try {
            return await promise;
        } finally {
            if (this._allFilesScan && this._allFilesScan.promise === promise) this._allFilesScan = null;
        }
    },

    async _walkAllFiles(root) {
        const out = [];
        const LIMIT = 3000;
        const walk = async (dir, depth) => {
            if (depth > 8 || out.length >= LIMIT) return;
            let items = [];
            try { items = await window.electronAPI.readDirectory(dir); } catch (_) { return; }
            for (const item of items) {
                if (out.length >= LIMIT) return;
                if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === '__pycache__') continue;
                if (this.isBuildOutput(item.name, item.isDirectory)) continue;
                const full = `${dir}/${item.name}`.replace(/\\/g, '/');
                if (item.isDirectory) await walk(full, depth + 1);
                else out.push({ name: item.name, path: full });
            }
        };
        await walk(root.replace(/\\/g, '/'), 0);
        return out;
    },

    async setFilter(text) {
        const value = String(text || '').trim();
        this.filterText = value;
        document.getElementById('explorer-filter-clear')?.classList.toggle('hidden', !value);
        if (value) await this.collectAllFiles();
        if (this.filterText !== value) return; // a newer keystroke renders
        this.renderTree();
    },

    /** Header shows the open folder's name; the filter and folder buttons only make sense with one. */
    updateHeader() {
        const title = document.getElementById('explorer-title');
        const sidebar = this.elements.sidebar;
        if (title) {
            const name = this.currentFolder ? this.currentFolder.split(/[/\\]/).filter(Boolean).pop() : '';
            title.textContent = name || 'Explorer';
            title.title = this.currentFolder || '';
        }
        sidebar?.classList.toggle('has-folder', !!this.currentFolder);
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
        this.updateHeader();

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

        const recentHtml = this.renderRecentSection();

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
            // A filter replaces the whole view with a flat list of matches.
            this.elements.tree.innerHTML = this.filterText
                ? this.renderFilterResults()
                : `
                    ${recentHtml}
                    ${this.renderFilesSection()}
                    ${contestSectionHtml}
                    ${categoriesHtml}
                `;
        }

        // Attach event listeners
        this.attachTreeEventListeners();
        this.attachContestEventListeners();
        this.attachCategoryEventListeners();
    },

    /** A collapsible section header, styled like the Contest and Collections ones. */
    renderSectionHeader(section, title, collapsed, extraHtml = '') {
        return `<div class="cat-section-header ex-section-header" data-action="toggle-section" data-section="${section}">
            <button class="cat-section-toggle ${collapsed ? 'collapsed' : ''}" data-action="toggle-section" data-section="${section}" title="${collapsed ? 'Expand' : 'Collapse'}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <span class="cat-section-title">${title}</span>
            ${extraHtml}
        </div>`;
    },

    /**
     * Status pill at the right end of a source-file row. Empty until the file is marked; the
     * empty pill appears on hover. Clicking it cycles the status (attachTreeEventListeners).
     */
    renderStatusBadge(filePath) {
        const status = this.fileStatuses[filePath];
        const info = status ? this.STATUS_TYPES[status] : null;
        return `<span class="explorer-mark-btn ${info ? 'set status-' + status : ''}" title="${info ? escHtml(info.label) + ' (click to change)' : 'Mark status'}">${info ? escHtml(info.label) : ''}</span>`;
    },

    /** The three most recent files in this folder. */
    renderRecentSection() {
        const root = (this.currentFolder || '').replace(/\\/g, '/');
        const recent = this.recentFiles
            .filter(p => root && p.replace(/\\/g, '/').startsWith(root + '/'))
            .slice(0, 3);
        if (recent.length === 0) return '';

        let html = '<div class="explorer-recent-section">';
        html += this.renderSectionHeader('recent', 'RECENT', this.recentSectionCollapsed);
        if (!this.recentSectionCollapsed) {
            html += recent.map(path => {
                const name = path.split(/[/\\]/).pop();
                const isSource = /\.(cpp|c|cc|cxx)$/i.test(name);
                return `
                    <div class="explorer-item file recent-item ${this.isActiveFile(path) ? 'active' : ''}" data-path="${escHtml(path)}" style="padding-left: 12px">
                        ${this.getFileIcon(name)}
                        <span class="explorer-item-name">${escHtml(name)}</span>
                        ${isSource ? this.renderStatusBadge(path) : ''}
                    </div>`;
            }).join('');
        }
        return html + '</div>';
    },

    /** The folder tree, with a note for the compiler output it hides. */
    renderFilesSection() {
        let html = '<div class="explorer-files-section">';
        html += this.renderSectionHeader('files', 'FILES', this.filesSectionCollapsed);
        if (!this.filesSectionCollapsed) {
            html += `<div class="explorer-items">${this.renderItems(this.tree, 0)}</div>`;
            if (this.hiddenBuildCount > 0 || this.showBuildFiles) {
                html += `<button class="explorer-build-toggle" data-action="toggle-build-files">${this.showBuildFiles
                    ? 'Hide build files'
                    : `${this.hiddenBuildCount} build file${this.hiddenBuildCount === 1 ? '' : 's'} hidden · Show`}</button>`;
            }
        }
        return html + '</div>';
    },

    /** Files whose name contains the filter text, best matches first. */
    renderFilterResults() {
        const q = this.filterText.toLowerCase();
        const root = (this.currentFolder || '').replace(/\\/g, '/');
        const hits = (this._allFiles || [])
            .filter(f => f.name.toLowerCase().includes(q))
            .sort((a, b) => {
                const pa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
                const pb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
                return pa - pb || a.name.length - b.name.length || a.name.localeCompare(b.name);
            })
            .slice(0, 200);
        if (hits.length === 0) {
            return `<div class="explorer-filter-empty">No files match “${escHtml(this.filterText)}”</div>`;
        }
        return hits.map(f => {
            const at = f.name.toLowerCase().indexOf(q);
            const name = escHtml(f.name.slice(0, at)) + '<mark>' + escHtml(f.name.slice(at, at + q.length)) + '</mark>' + escHtml(f.name.slice(at + q.length));
            const rel = f.path.startsWith(root + '/') ? f.path.slice(root.length + 1) : f.path;
            const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
            const isSource = /\.(cpp|c|cc|cxx)$/i.test(f.name);
            return `
                <div class="explorer-item file filter-hit ${this.isActiveFile(f.path) ? 'active' : ''}" data-path="${escHtml(f.path)}" style="padding-left: 12px">
                    ${this.getFileIcon(f.name)}
                    <span class="explorer-item-name">${name}</span>
                    ${dir ? `<span class="explorer-item-dir">${escHtml(dir)}</span>` : ''}
                    ${isSource ? this.renderStatusBadge(f.path) : ''}
                </div>`;
        }).join('');
    },

    /** Files marked Done anywhere under a folder. */
    countDoneUnder(folderPath) {
        const prefix = folderPath.replace(/\\/g, '/') + '/';
        let n = 0;
        for (const [p, s] of Object.entries(this.fileStatuses)) {
            if (s === 'done' && p.replace(/\\/g, '/').startsWith(prefix)) n++;
        }
        return n;
    },

    /**
     * Render contest header with name, platform badge, and actions
     */
    renderContestHeader() {
        const meta = this.contestMeta;
        const platformBadge = meta.platform && meta.platform !== 'Other'
            ? `<span class="cp-platform-badge">${escHtml(meta.platform)}</span>` : '';
        const collapseIcon = this.contestCollapsed
            ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>'
            : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';

        return `
            <div class="cp-contest-header">
                <div class="cp-contest-info">
                    <span class="cp-contest-collapse" data-action="toggle-contest-collapse" title="${this.contestCollapsed ? 'Expand' : 'Collapse'}">${collapseIcon}</span>
                    <svg class="icon-contest" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ffa726" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    <span class="cp-contest-name" title="Double-click to rename">${escHtml(meta.name || 'Contest')}</span>
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
            const filePath = this.problemFilePath(prob.id);
            const timeStr = this.SessionTimer.getDisplay(prob.id);
            const tooltip = `Click to open · Right-click for options\nCtrl+click to select · Shift+click for range`;

            html += `
                <div class="cp-problem-row-item ${isActive ? 'active' : ''} ${isSelected ? 'cp-chip-selected' : ''} cp-status-${prob.status || 'todo'}"
                     data-problem="${escHtml(prob.id)}" data-chip-idx="${idx}" data-path="${escHtml(filePath)}" title="${escHtml(tooltip)}">
                    <span class="cp-row-status">${icon}</span>
                    <span class="cp-row-id">${escHtml(prob.id)}</span>
                    <span class="cp-row-label">${escHtml(prob.label || '')}</span>
                    <span class="cp-row-badge cp-badge-${prob.status || 'todo'}" title="${escHtml(statusInfo.label)}">${escHtml(statusInfo.badge || statusInfo.label)}</span>
                    ${timeStr ? `<span class="cp-row-time">${escHtml(timeStr)}</span>` : ''}
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
                const done = this.countDoneUnder(item.path);
                return `
                    <div class="explorer-item folder ${isExpanded ? 'expanded' : ''} ${item.isBuild ? 'build-file' : ''}"
                         data-path="${escHtml(item.path)}"
                         style="padding-left: ${indent + 8}px">
                        <span class="explorer-item-arrow">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </span>
                        ${this.getFolderIcon(isExpanded)}
                        <span class="explorer-item-name">${escHtml(item.name)}</span>
                        ${done ? `<span class="explorer-folder-done" title="${done} marked Done">${this.ICONS.check}${done}</span>` : ''}
                    </div>
                    ${isExpanded && item.children ?
                        `<div class="explorer-children" style="--guide: ${indent + 14}px">${this.renderItems(item.children, depth + 1)}</div>`
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
                             data-path="${escHtml(item.path)}" data-problem-id="${escHtml(baseName)}"
                             ${hasNote ? `title="${note.replace(/"/g, '&quot;')}"` : ''}
                             style="padding-left: ${indent + 8}px">
                            ${hasChildren ? `
                                <span class="explorer-file-arrow" data-action="toggle-file">
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="9 18 15 12 9 6"/>
                                    </svg>
                                </span>
                            ` : '<span class="explorer-file-spacer"></span>'}
                            <span class="cp-status-icon" title="${escHtml(cpStatusInfo.label)}">${cpIcon}</span>
                            ${this.getFileIcon(item.name)}
                            <span class="explorer-item-name">${escHtml(item.name)}</span>
                            ${hasNote ? '<span class="explorer-note-icon" title="Click to edit">' + this.ICONS.note + '</span>' : ''}
                            ${timeStr ? `<span class="cp-time-display">${escHtml(timeStr)}</span>` : ''}
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
                                         data-path="${escHtml(item.path)}" data-problem-id="${escHtml(baseName)}"
                                         data-approach-id="${escHtml(appr.id)}"
                                         style="padding-left: ${indent + 32}px">
                                        <span class="cp-approach-icon">${apprIcon}</span>
                                        <span class="explorer-item-name">${escHtml(appr.name)}</span>
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
                                         data-path="${escHtml(comp.path)}" 
                                         style="padding-left: ${indent + 32}px">
                                        ${this.getFileIcon(comp.name)}
                                        <span class="explorer-item-name">${escHtml(comp.name)}</span>
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
                const approaches = this.fileApproaches[item.path];
                const hasApproaches = approaches && approaches.versions && approaches.versions.length > 0;
                const hasChildren = hasCompanions || hasApproaches;

                let childCount = 0;
                if (hasCompanions) childCount += item.companions.length;
                if (hasApproaches) childCount += approaches.versions.length;

                let html = `
                    <div class="explorer-item file ${status ? 'has-status status-' + status : ''} ${hasChildren ? 'has-children' : ''} ${isFileExpanded ? 'expanded' : ''} ${item.isBuild ? 'build-file' : ''} ${this.isActiveFile(item.path) ? 'active' : ''}"
                         data-path="${escHtml(item.path)}"
                         ${hasNote ? `title="${escHtml(note)}"` : ''}
                         style="padding-left: ${indent + 8}px">
                        ${hasChildren ? `
                            <span class="explorer-file-arrow" data-action="toggle-file">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="9 18 15 12 9 6"/>
                                </svg>
                            </span>
                        ` : '<span class="explorer-file-spacer"></span>'}
                        ${this.getFileIcon(item.name)}
                        <span class="explorer-item-name">${escHtml(item.name)}</span>
                        ${hasNote ? '<span class="explorer-note-icon" title="Click to edit" data-note="' + escHtml(note.replace(/\n/g, ' ')) + '">' + this.ICONS.note + '</span>' : ''}
                        ${hasChildren ? `<span class="child-count" title="${childCount} child item(s)">${childCount}</span>` : ''}
                        ${isCpp ? this.renderStatusBadge(item.path) : ''}
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
                                     data-path="${escHtml(item.path)}"
                                     data-approach-id="${escHtml(approach.id)}"
                                     style="padding-left: ${indent + 32}px">
                                    <svg class="explorer-icon approach-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#9c27b0" stroke-width="2">
                                        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                    </svg>
                                    <span class="explorer-item-name">${escHtml(approach.name)}</span>
                                    ${approachStatus ? `<span class="approach-status" style="color: ${approachStatus.color}" title="${escHtml(approachStatus.label)}">${this.ICONS[approachStatus.iconKey]}</span>` : ''}
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
                                     data-path="${escHtml(comp.path)}" 
                                     style="padding-left: ${indent + 32}px">
                                    ${this.getFileIcon(comp.name)}
                                    <span class="explorer-item-name">${escHtml(comp.name)}</span>
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
     * Render empty state: the collections section once there is one, then a single
     * welcome block (Open Folder first, New Collection as the secondary link).
     */
    renderEmptyState() {
        if (!this.elements.tree) return;
        this.updateHeader();

        const hasCollections = this.categories.some(c => c.type !== 'contest');
        const categoriesHtml = hasCollections ? this.renderCategories() : '';

        this.elements.tree.innerHTML = `
            ${categoriesHtml}
            <div class="explorer-empty">
                <svg class="ico explorer-empty-icon" width="44" height="44"><use href="#i-folder-open-duo"/></svg>
                <p class="explorer-empty-title">No folder opened</p>
                <p class="explorer-empty-hint">Open a folder to browse its files, or group problems into a collection.</p>
                <div class="explorer-empty-actions">
                    <button class="explorer-open-btn" id="btn-explorer-open-empty">Open Folder</button>
                    <button class="cat-new-btn-empty" id="btn-new-category-empty">
                        <svg class="ico" width="13" height="13"><use href="#i-plus"/></svg>
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
        this.elements.tree.querySelector('[data-action="toggle-build-files"]')?.addEventListener('click', () => {
            this.showBuildFiles = !this.showBuildFiles;
            this.saveState();
            this.refreshTree();
        });

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
                        this.loadApproachFromMeta(problemId, approachId, path);
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
                } else if (!item.classList.contains('companion') && !item.classList.contains('build-file')) {
                    // Handle file click (compiler output is binary, so it is never opened)
                    this.openFile(path);
                    // In contest mode, track timer for this problem
                    if (this.displayMode === 'contest' && item.dataset.problemId) {
                        this.SessionTimer.onFileOpen(item.dataset.problemId);
                    }
                }
            });

            item.addEventListener('dblclick', (e) => {
                const path = item.dataset.path;
                if (!item.classList.contains('folder') && !item.classList.contains('approach') && !item.classList.contains('build-file')) {
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

});
