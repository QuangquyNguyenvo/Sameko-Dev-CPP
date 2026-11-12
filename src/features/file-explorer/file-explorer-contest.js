/**
 * File Explorer — contest mode: listeners, context menus, add/delete problem, New Contest wizard.
 * Part of the FileExplorer object; loaded after file-explorer.js (see index.html).
 */

Object.assign(FileExplorer, {
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
        const chips = this.elements.tree.querySelectorAll('.cp-problem-row-item');
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
                <div class="context-item ${isActive ? 'active' : ''}" data-action="cp-status" data-status="${escHtml(key)}">
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
                        <div class="context-item" data-action="add-to-cat" data-cat-id="${escHtml(c.id)}">
                            <span class="cat-color-dot-mini" style="background: ${c.color}"></span>
                            ${escHtml(c.name)}
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
                if (name) this.saveApproachToMeta(problemId, name, filePath);
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
     * Show contest-mode context menu for approach items 
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
                <div class="context-item ${isCurrentStatus ? 'active' : ''}" data-action="appr-status" data-status="${escHtml(key)}">
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
                menu.remove();
                this.loadApproachFromMeta(problemId, approachId, filePath);
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
                    // The folder may already be one of our contests: add to it
                    // instead of listing it twice.
                    const key = (p) => (typeof pathKey === 'function' ? pathKey(p) : String(p || '').replace(/\\/g, '/'));
                    let newCat = this.categories.find(c => c.type === 'contest' && c.folderPath && key(c.folderPath) === key(result.contestDir));
                    if (!newCat) {
                        // Add as a contest sub-category (separate from collections)
                        const color = this.CATEGORY_COLORS[this.categories.length % this.CATEGORY_COLORS.length];
                        const catId = 'cat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
                        newCat = {
                            id: catId,
                            name: name,
                            color: color,
                            type: 'contest',
                            folderPath: result.contestDir,
                            items: [],
                            createdAt: new Date().toISOString(),
                        };
                        this.categories.push(newCat);
                    }

                    // Add the created problem files to the category
                    for (const pid of problemIds) {
                        const filePath = `${result.contestDir}/${pid}.cpp`.replace(/\\/g, '/');
                        if (newCat.items.some(i => key(i.filePath) === key(filePath))) continue;
                        newCat.items.push({
                            filePath,
                            name: pid,
                            fileName: `${pid}.cpp`,
                            status: 'todo',
                            addedAt: Date.now(),
                        });
                    }

                    if (result.existed) this.reportExistingContest(name, result.added);
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
                        const template = this.newFileTemplate(pid);
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
            const selected = [...this.elements.tree.querySelectorAll('.explorer-item.selected')]
                .find(el => el.dataset.path === this.selectedFilePath);
            if (selected && selected.classList.contains('folder')) this.confirmDeleteFolder(this.selectedFilePath);
            else this.confirmDelete(this.selectedFilePath);

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

        const key = (p) => (typeof pathKey === 'function' ? pathKey(p) : String(p || '').replace(/\\/g, '/'));
        if (key(srcPath) === key(destPath)) return;
        const api = window.electronAPI;
        if (!api || !api.copyFile || !api.moveFile) return;

        try {
            const transfer = (overwrite) => (mode === 'cut'
                ? api.moveFile(srcPath, destPath, overwrite)
                : api.copyFile(srcPath, destPath, overwrite));
            let result = await transfer(false);
            if (result && result.exists) {
                // Its tab would keep showing the text that was just replaced.
                if (this.findOpenTab(destPath)) {
                    alert(`"${fileName}" already exists here and is open in a tab. Close that tab first to replace it.`);
                    return;
                }
                if (!confirm(`"${fileName}" already exists in this folder.\n\nReplace it with the file being ${mode === 'cut' ? 'moved' : 'copied'}?`)) return;
                result = await transfer(true);
            }
            if (!result || result.success === false) throw new Error((result && result.error) || 'unknown error');

            if (mode === 'cut') {
                this.clipboardFile = null;
                this.selectedFilePath = destPath;
                // An open tab of the moved file (or of files in a moved folder)
                // now saves to the new place instead of recreating the old one.
                if (typeof onFileRenamed === 'function') onFileRenamed(srcPath, destPath);
                if (typeof onFolderRenamed === 'function') onFolderRenamed(srcPath, destPath);
            }
            await this.refreshTree();
        } catch (err) {
            console.error('[FileExplorer] Paste failed:', err);
            alert('Paste failed: ' + (err.message || err));
        }
    },

    /**
     * Delete a single problem from the contest (.cpp file + remove from .sameko)
     */
    async deleteProblemFromContest(problemId) {
        if (!this.contestMeta) return;
        const prob = this.getProblemMeta(problemId);
        const label = prob?.label ? ` "${prob.label}"` : '';
        if (!confirm(`Delete problem ${problemId}${label} and its .cpp file?`)) return;

        // Remove the source file; a file that could not be deleted keeps its data.
        if (!await this.deleteProblemFile(problemId)) return;
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

        const deleted = [];
        for (const problemId of ids) {
            if (await this.deleteProblemFile(problemId)) deleted.push(problemId);
        }
        this.contestMeta.problems = this.contestMeta.problems.filter(p => !deleted.includes(p.id));
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

            let parentDir = this.currentFolder;
            if (this.displayMode === 'contest' || this.contestFolder) {
                const activeContestPath = this.contestFolder || this.currentFolder;
                if (activeContestPath) {
                    parentDir = activeContestPath.replace(/[/\\][^/\\]+$/, '');
                }
            }

            if (window.electronAPI && window.electronAPI.createContest) {
                const result = await window.electronAPI.createContest({
                    parentDir,
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
                    if (result.existed) this.reportExistingContest(name, result.added);
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

    /** A contest with that name was already there: say what happened to it. */
    reportExistingContest(name, added) {
        const extra = added && added.length ? `; added ${added.join(', ')}` : '; no new problems were needed';
        const msg = `Contest "${name}" already existed: its statuses, times and approaches were kept${extra}.`;
        if (typeof showToast === 'function') showToast(msg, 'info');
        else alert(msg);
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

});
