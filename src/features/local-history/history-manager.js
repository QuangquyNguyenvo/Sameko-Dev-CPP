/**
 * Local History Module
 * 
 * Provides automatic backup of files before saving to prevent accidental data loss.
 * Features:
 * - Async backup creation (non-blocking)
 * - Hash-based change detection (only saves when content changes)
 * - Configurable limits (max versions, max age, max file size)
 * - UI for viewing and restoring history
 * 
 * @author Sameko IDE Team
 */

const LocalHistory = {
    // Settings with defaults
    settings: {
        enabled: true,
        maxVersions: 20,
        maxAgeDays: 7,
        maxFileSizeKB: 1024 // 1MB
    },

    // Cache of file hashes to avoid redundant backups
    hashCache: new Map(),

    // Debounce untitled checkpoint creation
    untitledTimers: new Map(),

    /**
     * Initialize Local History module
     */
    init() {
        this.loadSettings();
        console.log('[LocalHistory] Initialized', this.settings.enabled ? '✓ Enabled' : '✗ Disabled');
    },

    /**
     * Load settings from App.settings
     */
    loadSettings() {
        if (typeof App !== 'undefined' && App.settings && App.settings.localHistory) {
            this.settings = { ...this.settings, ...App.settings.localHistory };
        }
    },

    /**
     * Save current settings to App.settings
     */
    saveSettings() {
        if (typeof App !== 'undefined') {
            App.settings.localHistory = { ...this.settings };
        }
    },

    /**
     * Simple hash function for content comparison
     * @param {string} str - Content to hash
     * @returns {string} - Hash string
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(16);
    },

    /**
     * Check if content has changed since last backup
     * @param {string} filePath - Path to file
     * @param {string} content - Current content
     * @returns {boolean} - True if content changed
     */
    hasContentChanged(filePath, content) {
        const currentHash = this.simpleHash(content);
        const cachedHash = this.hashCache.get(filePath);

        if (cachedHash === currentHash) {
            return false;
        }

        this.hashCache.set(filePath, currentHash);
        return true;
    },

    /**
     * Create a backup before saving (async, non-blocking)
     * @param {string} filePath - Path to file being saved
     * @param {string} content - Current file content
     * @returns {Promise<object>} - Result of backup operation
     */
    async createBackup(filePath, content) {
        // Check if enabled
        if (!this.settings.enabled) {
            return { success: false, reason: 'disabled' };
        }

        // Check file size
        const sizeKB = new Blob([content]).size / 1024;
        if (sizeKB > this.settings.maxFileSizeKB) {
            return { success: false, reason: 'file_too_large' };
        }

        // Check if content actually changed
        if (!this.hasContentChanged(filePath, content)) {
            return { success: false, reason: 'no_changes' };
        }

        // Call main process to create backup
        try {
            const result = await window.electronAPI.createHistoryBackup({
                filePath,
                content,
                maxVersions: this.settings.maxVersions,
                maxAgeDays: this.settings.maxAgeDays
            });

            return result;
        } catch (error) {
            console.error('[LocalHistory] Backup error:', error);
            return { success: false, reason: 'error', error: error.message };
        }
    },

    /**
     * Get history entries for a file
     * @param {string} filePath - Path to file
     * @returns {Promise<Array>} - List of history entries
     */
    async getHistory(filePath) {
        if (!filePath) return [];

        try {
            const result = await window.electronAPI.getFileHistory(filePath);
            return result.success && result.entries ? result.entries : [];
        } catch (error) {
            console.error('[LocalHistory] Get history failed:', error);
            return [];
        }
    },

    /**
     * Get content of a specific history entry
     * @param {string} backupPath - Path to backup file
     * @returns {Promise<string|null>} - Content or null if failed
     */
    async getHistoryContent(backupPath) {
        try {
            const result = await window.electronAPI.getHistoryContent(backupPath);
            return result.success ? result.content : null;
        } catch (error) {
            console.error('[LocalHistory] Get content failed:', error);
            return null;
        }
    },

    /**
     * Restore a file from history
     * @param {string} filePath - Original file path
     * @param {string} backupPath - Path to backup to restore
     * @returns {Promise<object>} - Result
     */
    async restoreFromHistory(filePath, backupPath) {
        try {
            const content = await this.getHistoryContent(backupPath);
            if (content === null) {
                return { success: false, error: 'Could not read backup' };
            }

            // Update hash cache with restored content
            this.hashCache.set(filePath, this.simpleHash(content));

            return { success: true, content };
        } catch (error) {
            console.error('[LocalHistory] Restore failed:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Delete all history for a file
     * @param {string} filePath - Path to file
     * @returns {Promise<object>} - Result
     */
    async clearHistory(filePath) {
        try {
            const result = await window.electronAPI.clearFileHistory(filePath);
            return result;
        } catch (error) {
            console.error('[LocalHistory] Clear history failed:', error);
            return { success: false, error: error.message };
        }
    },

    getUntitledStorageKey(tabOrKey) {
        const key = typeof tabOrKey === 'string' ? tabOrKey : tabOrKey?.untitledHistoryKey;
        return key ? `untitled-history:${key}` : null;
    },

    ensureUntitledKey(tab) {
        if (!tab) return null;
        if (!tab.untitledHistoryKey) {
            tab.untitledHistoryKey = 'untitled_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }
        return tab.untitledHistoryKey;
    },

    getUntitledHistory(tabOrKey) {
        const storageKey = this.getUntitledStorageKey(tabOrKey);
        if (!storageKey) return [];

        try {
            const raw = localStorage.getItem(storageKey);
            const entries = raw ? JSON.parse(raw) : [];
            return Array.isArray(entries) ? entries : [];
        } catch (error) {
            console.error('[LocalHistory] Failed to read untitled history:', error);
            return [];
        }
    },

    saveUntitledHistory(tabOrKey, entries) {
        const storageKey = this.getUntitledStorageKey(tabOrKey);
        if (!storageKey) return;

        try {
            localStorage.setItem(storageKey, JSON.stringify(entries));
        } catch (error) {
            console.error('[LocalHistory] Failed to save untitled history:', error);
        }
    },

    async createUntitledBackup(tab, content) {
        if (!this.settings.enabled || !tab || tab.path) {
            return { success: false, reason: 'not_untitled' };
        }

        const untitledKey = this.ensureUntitledKey(tab);
        const hashKey = `untitled:${untitledKey}`;
        const sizeKB = new Blob([content]).size / 1024;
        if (sizeKB > this.settings.maxFileSizeKB) {
            return { success: false, reason: 'file_too_large' };
        }

        const currentHash = this.simpleHash(content);
        if (this.hashCache.get(hashKey) === currentHash) {
            return { success: false, reason: 'no_changes' };
        }
        this.hashCache.set(hashKey, currentHash);

        const entries = this.getUntitledHistory(untitledKey);
        entries.unshift({
            id: 'backup_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            content,
            timestamp: Date.now(),
            formattedTime: new Date().toLocaleString(),
            size: `${Math.max(1, Math.round(sizeKB))} KB`
        });

        this.saveUntitledHistory(untitledKey, entries.slice(0, this.settings.maxVersions));
        return { success: true };
    },

    scheduleUntitledBackup(tab, content) {
        if (!tab || tab.path || !this.settings.enabled) return;

        const untitledKey = this.ensureUntitledKey(tab);
        const existing = this.untitledTimers.get(untitledKey);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.createUntitledBackup(tab, content).catch(error => {
                console.error('[LocalHistory] Untitled backup error:', error);
            });
            this.untitledTimers.delete(untitledKey);
        }, 12000);

        this.untitledTimers.set(untitledKey, timer);
    },

    clearUntitledHistory(tabOrKey) {
        const storageKey = this.getUntitledStorageKey(tabOrKey);
        if (!storageKey) return { success: false, error: 'Missing key' };

        try {
            const untitledKey = typeof tabOrKey === 'string' ? tabOrKey : tabOrKey?.untitledHistoryKey;
            if (untitledKey) {
                const timer = this.untitledTimers.get(untitledKey);
                if (timer) {
                    clearTimeout(timer);
                    this.untitledTimers.delete(untitledKey);
                }
                this.hashCache.delete(`untitled:${untitledKey}`);
            }
            localStorage.removeItem(storageKey);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    renderHistoryModal({ titleText, entries, mode, filePath = '', untitledKey = '', tabId = '', emptyTitle, emptyHint }) {
        const modal = document.getElementById('local-history-modal');
        const overlay = document.getElementById('local-history-overlay');
        const list = document.getElementById('local-history-list');
        const title = document.getElementById('local-history-title');

        if (!modal || !overlay || !list || !title) {
            console.error('[LocalHistory] Modal elements not found');
            return;
        }

        title.textContent = titleText;
        modal.dataset.mode = mode;
        modal.dataset.filePath = filePath || '';
        modal.dataset.untitledKey = untitledKey || '';
        modal.dataset.tabId = tabId || '';

        if (entries.length === 0) {
            list.innerHTML = `
                <div class="history-empty">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <p>${emptyTitle}</p>
                    <span>${emptyHint}</span>
                </div>
            `;
        } else {
            list.innerHTML = entries.map((entry) => `
                <div class="history-entry" data-backup-path="${entry.path || ''}" data-backup-id="${entry.id || ''}">
                    <div class="history-entry-info">
                        <span class="history-entry-time">${entry.formattedTime}</span>
                        <span class="history-entry-size">${entry.size}</span>
                    </div>
                    <div class="history-entry-actions">
                        <button class="btn-history-view" data-action="view" title="View content">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-history-restore" data-action="restore" title="Restore this version">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                <path d="M3 3v5h5"></path>
                            </svg>
                            Restore
                        </button>
                    </div>
                </div>
            `).join('');

            list.querySelectorAll('.btn-history-view').forEach(btn => {
                btn.onclick = (e) => this.handleViewClick(e);
            });
            list.querySelectorAll('.btn-history-restore').forEach(btn => {
                btn.onclick = (e) => this.handleRestoreClick(e);
            });
        }

        overlay.classList.add('active');
        modal.classList.add('active');
    },

    /**
     * Show the Local History modal for a file
     * @param {string} filePath - Path to file
     */
    async showHistoryModal(filePath) {
        if (!filePath) {
            this.showNotification('No file selected', 'warning');
            return;
        }

        const entries = await this.getHistory(filePath);
        const fileName = filePath.split(/[\\/]/).pop();
        this.renderHistoryModal({
            titleText: `Checkpoints: ${fileName}`,
            entries,
            mode: 'file',
            filePath,
            emptyTitle: 'No history available for this file',
            emptyHint: 'History is created when you save changes'
        });
    },

    async showUntitledHistoryModal(tab) {
        if (!tab) {
            this.showNotification('No file selected', 'warning');
            return;
        }

        const untitledKey = this.ensureUntitledKey(tab);
        const entries = this.getUntitledHistory(untitledKey);
        this.renderHistoryModal({
            titleText: `Untitled Checkpoints: ${tab.name || 'untitled.cpp'}`,
            entries,
            mode: 'untitled',
            untitledKey,
            tabId: tab.id,
            emptyTitle: 'No checkpoints for this untitled tab',
            emptyHint: 'A snapshot is saved automatically while you type'
        });
    },

    /**
     * Hide the Local History modal
     */
    hideHistoryModal() {
        const modal = document.getElementById('local-history-modal');
        const overlay = document.getElementById('local-history-overlay');

        if (modal) modal.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
    },

    /**
     * Handle view button click
     */
    async handleViewClick(e) {
        const modal = document.getElementById('local-history-modal');
        const mode = modal?.dataset.mode || 'file';
        const entry = e.target.closest('.history-entry');
        let content = null;

        if (mode === 'untitled') {
            const untitledKey = modal?.dataset.untitledKey;
            const backupId = entry.dataset.backupId;
            const history = this.getUntitledHistory(untitledKey);
            content = history.find(item => item.id === backupId)?.content ?? null;
        } else {
            const backupPath = entry.dataset.backupPath;
            content = await this.getHistoryContent(backupPath);
        }

        if (content !== null) {
            this.showContentPreview(content);
        } else {
            this.showNotification('Could not load backup content', 'error');
        }
    },

    /**
     * Handle restore button click
     */
    async handleRestoreClick(e) {
        const modal = document.getElementById('local-history-modal');
        const mode = modal?.dataset.mode || 'file';
        const entry = e.target.closest('.history-entry');
        let result;

        if (mode === 'untitled') {
            const untitledKey = modal.dataset.untitledKey;
            const backupId = entry.dataset.backupId;
            const history = this.getUntitledHistory(untitledKey);
            const restored = history.find(item => item.id === backupId);
            if (!restored) {
                this.showNotification('Could not find checkpoint content', 'error');
                return;
            }
            result = { success: true, content: restored.content };
        } else {
            const filePath = modal.dataset.filePath;
            const backupPath = entry.dataset.backupPath;
            result = await this.restoreFromHistory(filePath, backupPath);
        }

        if (result.success) {
            // Update the editor with restored content
            if (typeof App !== 'undefined' && App.editor) {
                const activeTabId = modal?.dataset.tabId || (App.activeEditor === 2 && App.splitTabId ? App.splitTabId : App.activeTabId);
                const targetTab = App.tabs.find(t => t.id === activeTabId) || App.tabs.find(t => t.id === App.activeTabId);
                if (targetTab) {
                    targetTab.content = result.content;
                    targetTab.modified = true;
                }
                const targetEditor = App.activeEditor === 2 && App.editor2 && App.splitTabId === activeTabId ? App.editor2 : App.editor;
                targetEditor.setValue(result.content);
                if (typeof App.renderTabs === 'function') {
                    App.renderTabs();
                }
                this.showNotification('File restored successfully!', 'success');
                this.hideHistoryModal();
            }
        } else {
            this.showNotification('Restore failed: ' + result.error, 'error');
        }
    },

    /**
     * Show content preview using Monaco Editor (readonly)
     */
    showContentPreview(content) {
        let previewModal = document.getElementById('history-preview-modal');

        if (!previewModal) {
            previewModal = document.createElement('div');
            previewModal.id = 'history-preview-modal';
            previewModal.className = 'history-preview-modal';
            previewModal.innerHTML = `
                <div class="history-preview-container">
                    <div class="history-preview-header">
                        <h3>Preview (Read-only)</h3>
                        <button class="btn-close-preview">&times;</button>
                    </div>
                    <div id="history-preview-editor" style="flex:1;min-height:300px;"></div>
                </div>
            `;
            document.body.appendChild(previewModal);

            previewModal.querySelector('.btn-close-preview').onclick = () => {
                previewModal.classList.remove('active');
            };

            // Click outside to close
            previewModal.onclick = (e) => {
                if (e.target === previewModal) {
                    previewModal.classList.remove('active');
                }
            };
        }

        // Create or update Monaco Editor for preview
        const editorContainer = document.getElementById('history-preview-editor');

        // Check if Monaco is available
        if (typeof monaco !== 'undefined') {
            // Clear previous editor if any
            editorContainer.innerHTML = '';

            // Get theme from main editor or ThemeManager
            let editorTheme = 'vs-dark';
            if (typeof ThemeManager !== 'undefined' && ThemeManager.getCurrentTheme) {
                const current = ThemeManager.getCurrentTheme();
                editorTheme = current?.monaco || 'vs-dark';
            } else if (App.editor) {
                editorTheme = App.editor.getModel()?._languageId ? monaco.editor.getModel()?.getOptions()?.theme : 'vs-dark';
            }

            // Create readonly Monaco editor
            const previewEditor = monaco.editor.create(editorContainer, {
                value: content,
                language: 'cpp',
                theme: editorTheme,
                readOnly: true,
                fontSize: App.settings?.editor?.fontSize || 14,
                fontFamily: App.settings?.editor?.fontFamily || 'JetBrains Mono, Consolas, monospace',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: 'on',
                folding: true,
                wordWrap: 'off',
                renderLineHighlight: 'none',
                cursorStyle: 'line',
                domReadOnly: true
            });

            // Store reference for cleanup
            previewModal._editor = previewEditor;
        } else {
            // Fallback to pre tag if Monaco not available - use theme colors
            const bg = getComputedStyle(document.documentElement).getPropertyValue('--editor-bg').trim() || '#1a2530';
            const fg = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e0f0ff';
            editorContainer.innerHTML = `<pre style="margin:0;padding:16px;overflow:auto;height:100%;background:${bg};color:${fg};font-family:'JetBrains Mono',Consolas,monospace;font-size:13px;white-space:pre-wrap;border-radius:12px;">${this.escapeHtml(content)}</pre>`;
        }

        previewModal.classList.add('active');
    },

    /**
     * Escape HTML for fallback display
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Use existing notification system if available
        if (typeof log === 'function') {
            log(message, type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
        } else {
            console.log(`[LocalHistory] ${type}: ${message}`);
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    LocalHistory.init();

    // Close modal when clicking overlay
    const overlay = document.getElementById('local-history-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                LocalHistory.hideHistoryModal();
            }
        });
    }

    // Close button handler
    const closeBtn = document.getElementById('local-history-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => LocalHistory.hideHistoryModal());
    }

    // Clear history button
    const clearBtn = document.getElementById('local-history-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            const modal = document.getElementById('local-history-modal');
            const mode = modal?.dataset.mode || 'file';
            const filePath = modal?.dataset.filePath;
            const untitledKey = modal?.dataset.untitledKey;

            if (confirm('Are you sure you want to delete all history for this file?')) {
                const result = mode === 'untitled'
                    ? LocalHistory.clearUntitledHistory(untitledKey)
                    : await LocalHistory.clearHistory(filePath);

                if (result.success) {
                    LocalHistory.showNotification('History cleared', 'success');
                    if (mode === 'untitled') {
                        const tabId = modal?.dataset.tabId;
                        const tab = App?.tabs?.find(t => t.id === tabId);
                        if (tab) {
                            LocalHistory.showUntitledHistoryModal(tab);
                        } else {
                            LocalHistory.hideHistoryModal();
                        }
                    } else {
                        LocalHistory.showHistoryModal(filePath);
                    }
                }
            }
        });
    }
});

// Export for use in other modules
window.LocalHistory = LocalHistory;
