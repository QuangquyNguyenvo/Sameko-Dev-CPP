/**
 * File Explorer — categories (collections): data operations and rendering.
 * Part of the FileExplorer object; loaded after file-explorer.js (see index.html).
 */

Object.assign(FileExplorer, {
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

            // Rename folder on disk if it exists (in place: it may not be in the open folder)
            if (cat.folderPath && this.currentFolder) {
                const sanitizedNew = newName.trim().replace(/[<>:"/\\|?*]/g, '_');
                const parentDir = cat.folderPath.replace(/\\/g, '/').replace(/\/[^/]+\/?$/, '');
                const newFolderPath = `${parentDir}/${sanitizedNew}`.replace(/\\/g, '/');
                if (cat.folderPath !== newFolderPath) {
                    try {
                        if (window.electronAPI && window.electronAPI.moveFile) {
                            const moved = await window.electronAPI.moveFile(cat.folderPath, newFolderPath);
                            if (!moved || moved.success === false) throw new Error((moved && moved.error) || 'the folder could not be renamed');
                            // Open files inside it, and the active contest, follow the folder.
                            if (typeof onFolderRenamed === 'function') onFolderRenamed(cat.folderPath, newFolderPath);
                            const key = (p) => (typeof pathKey === 'function' ? pathKey(p) : String(p || '').replace(/\\/g, '/'));
                            if (this.contestFolder && key(this.contestFolder) === key(cat.folderPath)) this.contestFolder = newFolderPath;
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
                        // The folder kept its name, so the category does too.
                        cat.name = oldName;
                        console.warn('[FileExplorer] Could not rename collection folder:', err);
                        alert('Could not rename the folder: ' + (err.message || err));
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
     * Activate a contest category and auto-collapse all other contests
     */
    activateContestCategory(catId) {
        const cat = this.categories.find(c => c.id === catId);
        if (!cat || cat.type !== 'contest') return;

        this.activeContestId = cat.id;
        if (this.contestFolder !== cat.folderPath) {
            // The metadata belongs to its folder: never edit B with A's .sameko.
            this.leaveContest();
            this.contestFolder = cat.folderPath;
            const folder = cat.folderPath;
            if (folder) {
                this.loadContestMeta(folder).then((meta) => {
                    if (this.contestFolder !== folder || this.contestMeta) return;   // switched again meanwhile
                    this.contestMeta = meta;
                    if (meta) this.SessionTimer.loadFromMeta(meta);
                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }).catch(() => { });
            }
        }

        // Auto-expand this active contest, and collapse all other contest categories
        this.collapsedCategories.delete(cat.id);
        for (const otherCat of this.categories) {
            if (otherCat.type === 'contest' && otherCat.id !== cat.id) {
                this.collapsedCategories.add(otherCat.id);
            }
        }

        this.saveState();
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
        if (cat.excluded) cat.excluded = cat.excluded.filter(p => p !== filePath);

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
        const template = this.newFileTemplate(baseName);

        // A name that is taken opens that file: writing the template replaced
        // a finished solution.
        if (await this.fileExistsIn(folderPath, fileName)) {
            this.addFileToCategory(catId, filePath, baseName, 'todo');
            await this.refreshTree();
            this.openFile(filePath);
            return;
        }

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

            const key = (p) => (typeof pathKey === 'function' ? pathKey(p) : String(p || '').replace(/\\/g, '/'));
            const files = entries.filter(e => e.isFile && /\.(cpp|c|cc|cxx|h|hpp|py|java)$/i.test(e.name));
            const existingPaths = new Set(cat.items.map(i => key(i.filePath)));
            // Files moved to another collection or removed from this one stay out.
            const excluded = new Set((cat.excluded || []).map(key));

            let changed = false;
            for (const file of files) {
                const filePath = `${cat.folderPath}/${file.name}`.replace(/\\/g, '/');
                if (!existingPaths.has(key(filePath)) && !excluded.has(key(filePath))) {
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

            // Remove items whose files no longer exist on disk. Only files directly
            // in this folder were listed: a sibling folder that shares the prefix
            // (A vs AB) or a subfolder is not checked here, so its items stay.
            const diskPaths = new Set(files.map(f => key(`${cat.folderPath}/${f.name}`)));
            const folderKey = key(cat.folderPath).replace(/\/+$/, '');
            const before = cat.items.length;
            cat.items = cat.items.filter(item => {
                const normalPath = key(item.filePath);
                if (normalPath.slice(0, normalPath.lastIndexOf('/')) === folderKey) {
                    return diskPaths.has(normalPath);
                }
                return true; // keep external and nested files
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
        // Refresh must not add it back from the folder (a move to another
        // collection, or Remove from Collection).
        if (cat.folderPath) {
            cat.excluded = cat.excluded || [];
            if (!cat.excluded.includes(filePath)) cat.excluded.push(filePath);
        }
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
                const normalFolderPathA = a.folderPath ? a.folderPath.replace(/\\/g, '/') : '';
                const normalFolderPathB = b.folderPath ? b.folderPath.replace(/\\/g, '/') : '';
                const normalContestFolder = this.contestFolder ? this.contestFolder.replace(/\\/g, '/') : '';
                const isActiveA = this.activeContestId 
                    ? (this.activeContestId === a.id) 
                    : (normalFolderPathA && normalContestFolder === normalFolderPathA);
                const isActiveB = this.activeContestId 
                    ? (this.activeContestId === b.id) 
                    : (normalFolderPathB && normalContestFolder === normalFolderPathB);

                if (isActiveA && !isActiveB) return -1;
                if (!isActiveA && isActiveB) return 1;

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
                <svg class="icon-contest" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffa726" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>CONTEST
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
            const isCompleted = itemCount > 0 && cat.items.every(i => i.status === 'ac');

            // Determine if active
            const normalFolderPath = cat.folderPath ? cat.folderPath.replace(/\\/g, '/') : '';
            const normalContestFolder = this.contestFolder ? this.contestFolder.replace(/\\/g, '/') : '';
            const isActive = this.activeContestId 
                ? (this.activeContestId === cat.id) 
                : (normalFolderPath && normalContestFolder === normalFolderPath);

            const isSpecialContest = isActive && !isCompleted;
            const dateLabel = cat.createdAt ? this._formatRelativeDate(cat.createdAt) : '';

            // Render headers based on active / completed
            let iconHtml = '';
            if (isSpecialContest) {
                // Glowing lightning
                iconHtml = `<svg class="icon-contest glowing" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffa726" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
            } else {
                // Folder icon
                iconHtml = this.getFolderIcon(!isCollapsed);
            }

            html += `
                <div class="cat-group ${isSpecialContest ? 'active-contest-card' : ''} ${isCollapsed ? 'collapsed' : ''}" data-cat-id="${escHtml(cat.id)}"
                     style="--cat-color: ${cat.color || '#64b5f6'}">
                    <div class="cat-header" data-cat-id="${escHtml(cat.id)}">
                        <span class="cat-arrow">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </span>
                        ${iconHtml}
                        <span class="cat-name">${escHtml(cat.name)}</span>
                        ${isSpecialContest ? `<span class="active-badge" style="--cat-color: ${cat.color || '#64b5f6'}">ACTIVE</span>` : ''}
                        ${dateLabel && !isSpecialContest ? `<span class="cat-date">${escHtml(dateLabel)}</span>` : ''}
                        <span class="cat-count">${solvedCount}/${itemCount}</span>
                        ${!isActive ? `
                        <button class="cat-activate-btn" data-cat-id="${escHtml(cat.id)}" data-action="activate-contest-quick" title="Set as Active Contest">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        </button>
                        ` : ''}
                        <button class="cat-new-problem-btn" data-cat-id="${escHtml(cat.id)}" data-action="new-problem-quick" title="New Problem">
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

                // Problem items
                if (itemCount > 0) {
                    const sortedItems = [...cat.items].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
                    
                    if (isSpecialContest) {
                        // Render horizontal grid of squares
                        html += '<div class="cp-problems-grid">';
                        for (const item of sortedItems) {
                            const statusInfo = this.CP_STATUSES[item.status] || this.CP_STATUSES.todo;
                            const isActiveProblem = this.isActiveFile(item.filePath);
                            html += `
                                <div class="cat-list-item cp-problem-square ${isActiveProblem ? 'active' : ''} cp-status-${item.status || 'todo'}"
                                     data-cat-id="${escHtml(cat.id)}" data-file-path="${escHtml(item.filePath)}"
                                     draggable="true" title="${escHtml(item.fileName)} (${statusInfo.label})">
                                    ${escHtml(item.name)}
                                </div>
                            `;
                        }
                        html += '</div>';
                    } else {
                        // Render standard list
                        html += '<div class="cat-items-list">';
                        for (const item of sortedItems) {
                            const statusInfo = this.CP_STATUSES[item.status] || this.CP_STATUSES.todo;
                            const statusIcon = this.STATUS_ICONS[item.status] || this.STATUS_ICONS.todo;
                            const isActiveProblem = this.isActiveFile(item.filePath);
                            html += `
                                <div class="cat-list-item ${isActiveProblem ? 'active' : ''} cp-status-${item.status || 'todo'}"
                                     data-cat-id="${escHtml(cat.id)}" data-file-path="${escHtml(item.filePath)}"
                                     draggable="true" title="${escHtml(item.fileName)}">
                                    <span class="cat-list-item-status">${statusIcon}</span>
                                    <span class="cat-list-item-name">${escHtml(item.name)}</span>
                                    <span class="cat-list-item-badge cp-badge-${item.status || 'todo'}" title="${escHtml(statusInfo.label)}">${escHtml(statusInfo.badge || statusInfo.label)}</span>
                                </div>
                            `;
                        }
                        html += '</div>';
                    }
                } else {
                    html += `
                        <div class="cat-empty-drop" data-cat-id="${escHtml(cat.id)}">
                            <span>No problems yet</span>
                            <button class="cat-add-file-btn" data-cat-id="${escHtml(cat.id)}" data-action="new-problem-quick">+ New Problem</button>
                        </div>
                    `;
                }

                // Drop zone
                html += `<div class="cat-drop-zone" data-cat-id="${escHtml(cat.id)}">Drop here to add</div>`;
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
                <div class="cat-group ${isCollapsed ? 'collapsed' : ''}" data-cat-id="${escHtml(cat.id)}"
                     style="--cat-color: ${cat.color}">
                    <div class="cat-header" data-cat-id="${escHtml(cat.id)}">
                        <span class="cat-arrow">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="9 18 15 12 9 6"/>
                            </svg>
                        </span>
                        <span class="cat-kind-icon" title="Collection">${this.ICONS.collection}</span>
                        <span class="cat-name">${escHtml(cat.name)}</span>
                        <span class="cat-count">${solvedCount}/${itemCount}</span>
                        <button class="cat-new-problem-btn" data-cat-id="${escHtml(cat.id)}" data-action="new-problem-quick" title="New Problem">
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
                                 data-cat-id="${escHtml(cat.id)}" data-file-path="${escHtml(item.filePath)}" 
                                 draggable="true" title="${escHtml(item.fileName)}">
                                <span class="cat-list-item-status">${statusIcon}</span>
                                <span class="cat-list-item-name">${escHtml(item.name)}</span>
                                <span class="cat-list-item-badge cp-badge-${item.status || 'todo'}" title="${escHtml(statusInfo.label)}">${escHtml(statusInfo.badge || statusInfo.label)}</span>
                            </div>
                        `;
                    }
                    html += '</div>';
                } else {
                    html += `
                        <div class="cat-empty-drop" data-cat-id="${escHtml(cat.id)}">
                            <span>Drop files here or</span>
                            <button class="cat-add-file-btn" data-cat-id="${escHtml(cat.id)}" data-action="new-problem-quick">+ New Problem</button>
                        </div>
                    `;
                }

                // Drop zone (visible during drag)
                html += `<div class="cat-drop-zone" data-cat-id="${escHtml(cat.id)}">Drop here to add</div>`;
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

});
