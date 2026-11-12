/**
 * File Explorer — categories (collections): listeners, drag and drop, menus, create/save dialogs.
 * Part of the FileExplorer object; loaded after file-explorer.js (see index.html).
 */

Object.assign(FileExplorer, {
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
                } else if (section === 'recent') {
                    this.recentSectionCollapsed = !this.recentSectionCollapsed;
                } else if (section === 'files') {
                    this.filesSectionCollapsed = !this.filesSectionCollapsed;
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

            // Double click to select/activate contest
            header.addEventListener('dblclick', (e) => {
                if (e.target.closest('[data-action]')) return;
                const catId = header.dataset.catId;
                const cat = this.categories.find(c => c.id === catId);

                if (cat && cat.type === 'contest') {
                    if (this.activeContestId !== cat.id) {
                        this.activateContestCategory(cat.id);
                        this.renderTree ? this.renderTree() : this.renderEmptyState();
                    }
                }
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

        // Quick activate contest button
        this.elements.tree.querySelectorAll('[data-action="activate-contest-quick"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const catId = btn.dataset.catId;
                this.activateContestCategory(catId);
                this.renderTree ? this.renderTree() : this.renderEmptyState();
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
                        if (typeof log === 'function') log('Collection does not exist. Create a new one.', 'warning');
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
                        this.promptSaveUntitledToCategory(catId, tab);
                    }
                    return;
                }

                // Handle external file drop (from OS)
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    for (const file of e.dataTransfer.files) {
                        // A bare name (no path) cannot be opened later, so such a file is skipped.
                        const path = window.electronAPI?.getPathForFile?.(file) || '';
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
            <span>${escHtml(name ? name.textContent : 'File')}</span>
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
                   data-color="${escHtml(color)}" style="background: ${color}"></span>`
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
            ${cat.type === 'contest' && this.activeContestId !== cat.id ? `
            <div class="context-item" data-action="activate-contest">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                Set as Active Contest
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

        const activateContestBtn = menu.querySelector('[data-action="activate-contest"]');
        if (activateContestBtn) {
            activateContestBtn.onclick = () => {
                menu.remove();
                this.activateContestCategory(cat.id);
                this.renderTree ? this.renderTree() : this.renderEmptyState();
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
                <div class="context-item ${isActive ? 'active' : ''}" data-action="set-status" data-status="${escHtml(key)}">
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
                `<div class="context-item" data-action="move-to" data-target-cat="${escHtml(c.id)}">
                    <span class="cat-color-dot-mini" style="background: ${c.color}"></span>
                    ${escHtml(c.name)}
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
                        <h3>Add to "${escHtml(cat.name)}"</h3>
                        <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                    </div>
                    <div class="note-dialog-body">
                        <p style="font-size:12px;margin-bottom:12px;color:var(--text-secondary)">Add the currently open file, or browse for a file.</p>
                        <div class="cat-add-option" data-action="add-current" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:2px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:8px;transition:border-color 0.15s;">
                            ${this.getFileIcon(fileName)}
                            <div>
                                <div style="font-weight:600;font-size:13px">${escHtml(fileName)}</div>
                                <div style="font-size:10px;opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:250px">${escHtml(currentPath)}</div>
                            </div>
                        </div>
                        <div class="cat-add-option" data-action="browse" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:2px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color 0.15s;">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                            <span style="font-weight:600;font-size:13px">Browse for File...</span>
                        </div>
                        <div style="margin-top:12px">
                            <label style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Display Name</label>
                            <input type="text" class="input-dialog-field" id="cat-add-name" value="${escHtml(name)}" placeholder="Problem name..." />
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
                template = this.newFileTemplate(baseName, fileName.trim());
            }

            this.createFileFromTemplate(filePath, template);
        });
    },

    /** True when `dir` holds a file named `fileName` (case-insensitive, so it errs on "exists"). */
    async fileExistsIn(dir, fileName) {
        try {
            const entries = await window.electronAPI.readDirectory(dir);
            const wanted = String(fileName).toLowerCase();
            return Array.isArray(entries) && entries.some(e => e && !e.isDirectory
                && String(e.name || '').toLowerCase() === wanted);
        } catch (_) {
            return false; // folder not there yet
        }
    },

    /**
     * New File: write the template, but never over an existing file (saveFile
     * replaces whatever is there). A name that is taken opens that file instead.
     */
    async createFileFromTemplate(filePath, template) {
        if (!window.electronAPI || !window.electronAPI.saveFile) return;
        const slash = filePath.lastIndexOf('/');
        const dir = filePath.slice(0, slash);
        const fileName = filePath.slice(slash + 1);
        try {
            if (await this.fileExistsIn(dir, fileName)) {
                if (typeof showToast === 'function') showToast(`"${fileName}" already exists: opened it instead.`, 'warning');
                this.openFile(filePath);
                return;
            }
            const result = await window.electronAPI.saveFile({ path: filePath, content: template });
            if (result && result.success === false) throw new Error(result.error || 'could not write the file');
            await this.refreshTree();
            this.openFile(filePath);
        } catch (err) {
            console.error('[FileExplorer] Failed to create file:', err);
            alert('Failed to create file: ' + (err?.message || err));
        }
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
            this._saveUntitledViaSaveAs(catId, tab);
            return;
        }

        const defaultName = tab.name || 'solution.cpp';
        this.showInputDialog(`Save to "${cat.name}"`, defaultName, async (fileName) => {
            if (!fileName || !fileName.trim()) return;
            fileName = fileName.trim();
            if (!/\.[^.]+$/.test(fileName)) fileName += '.cpp';

            const filePath = `${folderPath}/${fileName}`.replace(/\\/g, '/');
            const content = tab.model && !tab.model.isDisposed() ? tab.model.getValue() : (tab.content || '');

            // saveFile replaces whatever is there: ask before overwriting a file.
            try {
                const entries = await window.electronAPI.readDirectory(folderPath);
                const taken = Array.isArray(entries) && entries.some(e => e && !e.isDirectory
                    && String(e.name || '').toLowerCase() === fileName.toLowerCase());
                if (taken && !confirm(`"${fileName}" already exists in "${cat.name}".\n\nReplace it?`)) return;
            } catch (_) { /* folder not there yet */ }

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
                        if (typeof closeClangdDocument === 'function') closeClangdDocument(tab.path || tab.id);
                        tab.path = filePath;
                        tab.name = fileName;
                        // Another tab with the old text of this file would write it back on its next save.
                        if (typeof releaseOtherTabsOfPath === 'function') await releaseOtherTabsOfPath(tab, filePath);
                        if (typeof startFileWatch === 'function') startFileWatch(filePath);
                        if (typeof markTabSaved === 'function') markTabSaved(tab, content);
                        else { tab.original = content; tab.modified = false; window.App?.renderTabs?.(); }
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
        const content = tab.model && !tab.model.isDisposed() ? tab.model.getValue() : (tab.content || '');
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
                    if (typeof closeClangdDocument === 'function') closeClangdDocument(tab.path || tab.id);
                    tab.path = savedPath;
                    tab.name = fileName;
                    // Another tab with the old text of this file would write it back on its next save.
                    if (typeof releaseOtherTabsOfPath === 'function') await releaseOtherTabsOfPath(tab, savedPath);
                    if (typeof startFileWatch === 'function') startFileWatch(savedPath);
                    if (typeof markTabSaved === 'function') markTabSaved(tab, content);
                    else { tab.original = content; tab.modified = false; window.App?.renderTabs?.(); }
                    if (window.App && window.App.updateTitle) window.App.updateTitle();

                    this.renderTree ? this.renderTree() : this.renderEmptyState();
                }
            }
        } catch (err) {
            console.error('[FileExplorer] Save As dialog failed:', err);
        }
    },

});
