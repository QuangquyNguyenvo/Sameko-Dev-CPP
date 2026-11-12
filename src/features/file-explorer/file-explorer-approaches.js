/**
 * File Explorer — approach versioning, pinned and recent items.
 * Part of the FileExplorer object; loaded after file-explorer.js (see index.html).
 */

Object.assign(FileExplorer, {
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
        // The file must be open: its tab holds the text being saved.
        if (!this.findOpenTab(filePath)) {
            alert('Please open the file first before saving as approach.\n\nFile: ' + filePath.split(/[/\\]/).pop());
            return;
        }

        this.showInputDialog('Save as New Approach', 'My Approach', async (name) => {
            if (!name || !name.trim()) return;

            // The file's own text, whichever pane shows it.
            const content = (await this.readCurrentFileText(filePath)) || '';

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
        const tab = this.findOpenTab(filePath);
        if (!tab) {
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

        // Replace the file's text as one edit - this can be undone with Ctrl+Z
        this.replaceTabText(tab, approach.content || '');

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
                <div class="context-item ${isActive ? 'active' : ''}" data-action="approach-status" data-status="${escHtml(key)}">
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

});
