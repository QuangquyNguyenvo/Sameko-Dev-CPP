/**
 * File Explorer — status and notes, context menus, input dialogs, rename/delete/open, file icons.
 * Part of the FileExplorer object; loaded after file-explorer.js (see index.html).
 */

Object.assign(FileExplorer, {
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
                <div class="context-item ${isActive ? 'active' : ''}" data-action="status" data-status="${escHtml(key)}">
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
                        <div class="context-item" data-action="add-to-cat" data-cat-id="${escHtml(c.id)}">
                            <span class="cat-color-dot-mini" style="background: ${c.color}"></span>
                            ${escHtml(c.name)}
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
                    template = this.newFileTemplate(baseName, fileName.trim());
                }

                this.createFileFromTemplate(filePath, template);
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
                    <h3>Note for ${escHtml(fileName)}</h3>
                    <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                </div>
                <div class="note-dialog-body">
                    <textarea 
                        class="note-dialog-input" 
                        placeholder="Enter your note here..."
                        rows="6"
                    >${escHtml(currentNote)}</textarea>
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
    /**
     * Content for a new C/C++ file: the template from Settings > Template (the same one
     * Ctrl+N uses; the C template for a .c file), or a starter solution when none is set.
     */
    newFileTemplate(baseName, fileName = '') {
        const isC = /\.c$/i.test(fileName);
        const tpl = (typeof App !== 'undefined') ? App.settings?.template : null;
        const custom = isC ? (tpl?.cCode ?? DEFAULT_SETTINGS.template.cCode) : tpl?.code;
        if (custom && custom.trim()) return custom.endsWith('\n') ? custom : custom + '\n';
        if (isC) return '';
        return `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n\n    // TODO: solve ${baseName}\n\n    return 0;\n}\n`;
    },

    showInputDialog(title, defaultValue, callback) {
        const overlay = document.createElement('div');
        overlay.className = 'note-dialog-overlay';

        overlay.innerHTML = `
            <div class="note-dialog input-dialog">
                <div class="note-dialog-header">
                    <h3>${escHtml(title)}</h3>
                    <button class="note-dialog-close" title="Close">${this.ICONS.close}</button>
                </div>
                <div class="note-dialog-body">
                    <input 
                        type="text" 
                        class="input-dialog-field" 
                        value="${escHtml(defaultValue || '')}"
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
                // An open tab of the file follows it (it would otherwise save to the old name).
                if (typeof onFileRenamed === 'function') onFileRenamed(oldPath, newPath);
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
     * A file was renamed on disk: its status, note, approaches, pin, recent entry and category
     * item move to the new path, so nothing is lost (called from onFileRenamed in tabs.js).
     */
    movePathState(oldPath, newPath) {
        const norm = (p) => String(p).replace(/\\/g, '/');
        const same = (p) => pathKey(p) === pathKey(oldPath);  // pathKey: core.js
        const to = norm(newPath);
        for (const map of [this.fileStatuses, this.fileNotes, this.fileApproaches]) {
            for (const k of Object.keys(map || {})) {
                if (same(k) && k !== to) { map[to] = map[k]; delete map[k]; }
            }
        }
        this.pinnedItems = this.pinnedItems.map(p => same(p) ? to : p);
        this.recentFiles = this.recentFiles.map(p => same(p) ? to : p);
        this.expandedFiles = new Set([...this.expandedFiles].map(p => same(p) ? to : p));
        const oldBase = norm(oldPath).split('/').pop();
        const newBase = to.split('/').pop();
        for (const cat of this.categories || []) {
            for (const item of cat.items || []) {
                if (!same(item.filePath)) continue;
                // A display name taken from the file name follows it; a custom one is kept.
                if (item.name === oldBase.replace(/\.[^.]+$/, '')) item.name = newBase.replace(/\.[^.]+$/, '');
                item.filePath = to;
                item.fileName = newBase;
            }
        }
        // A contest problem's recorded source name follows a rename inside the contest folder.
        if (this.contestMeta && this.contestFolder && Array.isArray(this.contestMeta.problems)) {
            const folderKey = pathKey(this.contestFolder).replace(/\/+$/, '');
            const parentKey = (p) => pathKey(p).replace(/\/[^/]*$/, '');
            let metaChanged = false;
            for (const prob of this.contestMeta.problems) {
                if (!same(this.problemFilePath(prob.id))) continue;
                if (parentKey(to) !== folderKey || prob.fileName === newBase) continue;
                prob.fileName = newBase;
                metaChanged = true;
            }
            if (metaChanged) {
                Promise.resolve(this.saveContestMeta(this.contestFolder, this.contestMeta)).catch(() => {});
                this.renderTree();
            }
        }
        this.saveState();
    },

    /**
     * A folder was renamed or moved on disk: the state of every file inside it
     * moves too, including files with no open tab (their approaches and pins
     * were left under the old path).
     */
    moveFolderState(oldDir, newDir) {
        const prefix = pathKey(oldDir).replace(/\/+$/, '') + '/';
        const target = String(newDir).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
        const paths = new Set([
            ...Object.keys(this.fileStatuses || {}), ...Object.keys(this.fileNotes || {}),
            ...Object.keys(this.fileApproaches || {}), ...(this.pinnedItems || []),
            ...(this.recentFiles || []), ...this.expandedFiles,
            ...(this.categories || []).flatMap(c => (c.items || []).map(i => i.filePath)),
        ]);
        for (const p of paths) {
            if (typeof p !== 'string' || !pathKey(p).startsWith(prefix)) continue;
            this.movePathState(p, target + p.replace(/\\/g, '/').slice(prefix.length));
        }
        for (const cat of this.categories || []) {
            if (Array.isArray(cat.excluded)) {
                cat.excluded = cat.excluded.map(p => pathKey(p).startsWith(prefix)
                    ? target + p.replace(/\\/g, '/').slice(prefix.length) : p);
            }
        }
        this.saveState();
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
     * Delete an ordinary folder and everything in it (Delete key on a folder).
     * The opened root and the contest folder have their own commands.
     */
    async confirmDeleteFolder(folderPath) {
        const key = pathKey(folderPath).replace(/\/+$/, '');
        const protectedRoots = [this.currentFolder, this.contestFolder].filter(Boolean)
            .map(p => pathKey(p).replace(/\/+$/, ''));
        if (protectedRoots.includes(key)) return;
        const name = folderPath.split(/[/\\]/).pop();
        if (!confirm(`Delete folder "${name}" and ALL its contents? This cannot be undone.`)) return;
        if (!window.electronAPI || !window.electronAPI.deleteFolder) return;
        try {
            await window.electronAPI.deleteFolder(folderPath);
        } catch (err) {
            alert('Failed to delete folder: ' + String(err && err.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
            return;
        }
        this.expandedFolders.delete(folderPath);
        if (this.selectedFilePath === folderPath) this.selectedFilePath = null;
        this.refreshTree();
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
                // Never clear an existing test file without asking.
                const slash = Math.max(newPath.lastIndexOf('/'), newPath.lastIndexOf('\\'));
                const dir = slash >= 0 ? newPath.slice(0, slash) : '';
                const fileName = newPath.slice(slash + 1);
                if (dir && window.electronAPI.readDirectory) {
                    const entries = await window.electronAPI.readDirectory(dir);
                    const exists = Array.isArray(entries) && entries.some(entry =>
                        entry && !entry.isDirectory && String(entry.name).toLowerCase() === fileName.toLowerCase());
                    if (exists && !confirm(`"${fileName}" already exists. Replace it with an empty file?`)) {
                        return;
                    }
                }

                await window.electronAPI.saveFile({ path: newPath, content: '' });
                this.refreshTree();
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
     * Open explorer lazily after first file open when user left it open in previous session.
     */
    handleFileOpened(filePath) {
        if (!this.startupAutoRevealHandled) {
            this.startupAutoRevealHandled = true;
            if (this.wasOpenBeforeStartup && !this.isOpen) {
                this.open();
            }
        }

        // Every tab switch, not just the first: the tree follows the file being edited.
        if (filePath) {
            this.highlightFile(filePath);
        }
    },

    /**
     * Open a file in the editor
     */
    openFile(filePath, permanent = true) {

        this.handleFileOpened(filePath);

        // Add to recent files
        this.addToRecent(filePath);

        // Check if file belongs to any contest category and auto-activate it
        if (this.categories && this.categories.length > 0) {
            const normalizedPath = filePath.replace(/\\/g, '/');
            const matchingCat = this.categories.find(c => 
                c.type === 'contest' && 
                c.folderPath && 
                normalizedPath.startsWith(c.folderPath.replace(/\\/g, '/') + '/')
            );
            if (matchingCat) {
                if (this.activeContestId !== matchingCat.id) {
                    this.activateContestCategory(matchingCat.id);
                }
            }
        }

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

        // Open file via app's existing function (resolves once its tab exists)
        return window.openFromPath?.(filePath);
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
            return `<svg class="explorer-icon" style="color: ${config.color}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
            </svg>`;
        } else if (config.icon === 'braces') {
            return `<svg class="explorer-icon" style="color: ${config.color}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H7a2 2 0 00-2 2v5a2 2 0 01-2 2 2 2 0 012 2v5c0 1.1.9 2 2 2h1"/>
                <path d="M16 21h1a2 2 0 002-2v-5c0-1.1.9-2 2-2a2 2 0 01-2-2V5a2 2 0 00-2-2h-1"/>
            </svg>`;
        }

        return `<svg class="explorer-icon file-icon" style="color: ${config.color}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
        </svg>`;
    },

    /**
     * Highlight the currently open file in the tree
     */
    highlightFile(filePath) {
        if (!this.elements.tree) return;

        const target = String(filePath).replace(/\\/g, '/');
        const items = this.elements.tree.querySelectorAll('.explorer-item.file');
        items.forEach(item => {
            item.classList.toggle('active', (item.dataset.path || '').replace(/\\/g, '/') === target);
        });
    },

});
