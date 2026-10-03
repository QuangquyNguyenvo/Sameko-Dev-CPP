/**
 * Sameko Dev C++ IDE - renderer: Session checkpoint: save, restore prompt, reopening tabs.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// SESSION PERSISTENCE (Checkpoint for unsaved files)
// ============================================================================
const SESSION_STORAGE_KEY = 'ide-session-checkpoint';
const SESSION_SAVE_DEBOUNCE = 5000; // 5 seconds debounce
const SESSION_PERIODIC_INTERVAL = 30000; // 30 seconds periodic save
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const STARTUP_BEHAVIORS = Object.freeze({
    EMPTY: 'empty',
    REOPEN_SAVED: 'reopen-saved-tabs',
    RESTORE_PREVIOUS: 'restore-previous-session'
});

// NOTE: only 'JetBrains Mono' is bundled (src/assets/fonts.css). The others fall back to
// the generic monospace face when the user's OS doesn't ship them — very likely on Linux.
const BUILTIN_FONT_FAMILIES = new Set([
    "'JetBrains Mono', monospace",
    "'Fira Code', monospace",
    'Consolas, monospace',
    "'Cascadia Code', monospace"
]);
let sessionSaveTimer = null;
let sessionPeriodicTimer = null;
let sessionRestored = false;

function normalizeTabPath(filePath) {
    return filePath ? filePath.replace(/\\/g, '/') : null;
}

function createRestoredTabId() {
    return 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
}

function getStartupBehavior() {
    return App.settings?.startup?.behavior || DEFAULT_SETTINGS.startup.behavior;
}

/**
 * Read the session checkpoint. It lives in userData/state/session.json; a
 * checkpoint left in localStorage by an older version is picked up once.
 */
async function getStoredSession() {
    try {
        let session = null;
        if (window.electronAPI?.stateRead) session = await window.electronAPI.stateRead('session');
        if (!session) {
            const legacy = localStorage.getItem(SESSION_STORAGE_KEY);
            if (legacy) session = JSON.parse(legacy);
        }
        try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) { }

        if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) {
            clearSession();
            return null;
        }

        if (session.timestamp && (Date.now() - session.timestamp) > SESSION_MAX_AGE) {
            clearSession();
            return null;
        }

        return session;
    } catch (e) {
        console.error('[Session] Failed to parse stored session:', e);
        clearSession();
        return null;
    }
}

function buildSessionRestoreSummary(session) {
    const unsavedTabs = session.tabs.filter(t => t.modified || (!t.path && (t.content || '') !== (t.original || '')));
    const untitledCount = unsavedTabs.filter(t => !t.path).length;
    const modifiedCount = unsavedTabs.filter(t => t.path && t.modified).length;
    const parts = [];

    if (untitledCount > 0) parts.push(`${untitledCount} unsaved file${untitledCount > 1 ? 's' : ''}`);
    if (modifiedCount > 0) parts.push(`${modifiedCount} modified file${modifiedCount > 1 ? 's' : ''}`);

    return parts.length > 0
        ? `Your previous session contains ${parts.join(' and ')}. Restore now?`
        : 'Restore previous session?';
}

function restoredTestState(tabData) {
    const p = tabData && tabData.tests;
    return (p && Array.isArray(p.tests) && p.tests.length) ? { problem: p, index: 0, results: [] } : null;
}

async function reopenSessionTabs(session, { includeUnsaved }) {
    const restoredIds = new Map();

    for (const tabData of session.tabs) {
        const normalizedPath = normalizeTabPath(tabData.path);

        if (normalizedPath) {
            const existing = App.tabs.find(t => normalizeTabPath(t.path) === normalizedPath);
            if (existing) {
                restoredIds.set(tabData.id, existing.id);
                continue;
            }

            try {
                let diskContent = '';
                if (window.electronAPI?.readFile) {
                    diskContent = await window.electronAPI.readFile(tabData.path);
                }

                const isModified = includeUnsaved && tabData.modified && tabData.content != null;
                const restoredTab = {
                    id: createRestoredTabId(),
                    name: tabData.name,
                    path: tabData.path,
                    untitledHistoryKey: tabData.untitledHistoryKey || null,
                    content: isModified ? tabData.content : diskContent,
                    original: diskContent,
                    modified: isModified,
                    testState: restoredTestState(tabData),
                };

                App.tabs.push(restoredTab);
                restoredIds.set(tabData.id, restoredTab.id);
                startFileWatch(tabData.path);
            } catch (_) {
                if (!includeUnsaved || tabData.content == null) continue;

                const fallbackTab = {
                    id: createRestoredTabId(),
                    name: tabData.name,
                    path: null,
                    untitledHistoryKey: tabData.untitledHistoryKey || createUntitledHistoryKey(),
                    content: tabData.content,
                    original: '',
                    modified: true,
                };

                App.tabs.push(fallbackTab);
                restoredIds.set(tabData.id, fallbackTab.id);
            }
            continue;
        }

        const hasRecoverableUntitledContent = tabData.modified || ((tabData.content || '') !== (tabData.original || ''));
        if (!includeUnsaved || !hasRecoverableUntitledContent) continue;

        const restoredTab = {
            id: createRestoredTabId(),
            name: tabData.name,
            path: null,
            untitledHistoryKey: tabData.untitledHistoryKey || createUntitledHistoryKey(),
            content: tabData.content || '',
            original: tabData.original || '',
            modified: tabData.modified ?? true,
            testState: restoredTestState(tabData),
        };

        App.tabs.push(restoredTab);
        restoredIds.set(tabData.id, restoredTab.id);
    }

    const preferredActiveId = restoredIds.get(session.activeTabId) || App.tabs[0]?.id || null;
    if (preferredActiveId) {
        setActive(preferredActiveId);
    }

    updateUI();
    return restoredIds.size;
}

/**
 * Save recoverable tabs to userData/state/session.json.
 * @param {boolean} [sync] - block until written (used while the window closes)
 * This keeps saved files and real unsaved work, but ignores untouched generated untitled tabs.
 */
function saveSession(sync = false) {
    try {
        if (App.tabs.length === 0) {
            clearSession();
            return;
        }

        // Sync current editor content to active tab
        if (App.activeTabId && App.editor && App.ready) {
            const activeTab = App.tabs.find(t => t.id === App.activeTabId);
            if (activeTab) activeTab.content = App.editor.getValue();
        }
        if (App.splitTabId && App.editor2 && App.ready) {
            const splitTab = App.tabs.find(t => t.id === App.splitTabId);
            if (splitTab) splitTab.content = App.editor2.getValue();
        }

        // Test cases are edited in place; make sure the active tab carries them.
        saveTestStateToTab(App.tabs.find(t => t.id === App.activeTabId));

        const tabsForSession = App.tabs.filter(t => t.path || t.modified || ((t.content || '') !== (t.original || '')));
        if (tabsForSession.length === 0) {
            clearSession();
            return;
        }

        const session = {
            tabs: tabsForSession.map(t => ({
                id: t.id,
                name: t.name,
                path: t.path || null,
                untitledHistoryKey: t.untitledHistoryKey || null,
                // Always save content for unsaved/modified tabs; for saved unmodified tabs, skip content (re-read from disk)
                content: (!t.path || t.modified) ? (t.content || '') : null,
                // A file on disk is re-read on restore, so its baseline text is
                // not stored (it doubled the checkpoint for every open file).
                original: t.path ? '' : (t.original || ''),
                modified: t.modified || false,
                tests: (t.testState && t.testState.problem && Array.isArray(t.testState.problem.tests) && t.testState.problem.tests.length)
                    ? t.testState.problem
                    : null,
            })),
            activeTabId: App.activeTabId,
            splitTabId: App.splitTabId,
            isSplit: App.isSplit,
            timestamp: Date.now(),
        };

        if (sync && window.electronAPI?.stateWriteSync) {
            window.electronAPI.stateWriteSync('session', session);
        } else if (window.electronAPI?.stateWrite) {
            window.electronAPI.stateWrite('session', session).catch(() => { });
        }
    } catch (e) {
        console.warn('[Session] Failed to save session checkpoint:', e);
    }
}

/**
 * Schedule a debounced session save (called on every content change)
 */
function scheduleSessionSave() {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
        saveSession();
    }, SESSION_SAVE_DEBOUNCE);
}

/**
 * Start periodic session saves
 */
function startSessionPeriodicSave() {
    if (sessionPeriodicTimer) clearInterval(sessionPeriodicTimer);
    sessionPeriodicTimer = setInterval(() => {
        saveSession();
    }, SESSION_PERIODIC_INTERVAL);
}

/**
 * Clear saved session (called after successful restore or when user explicitly closes all tabs)
 */
function clearSession() {
    try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) { }
    window.electronAPI?.stateDelete?.('session')?.catch?.(() => { });
}

function showSessionRestoreNotification(summary) {
    return new Promise((resolve) => {
        const existing = document.getElementById('session-restore-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.id = 'session-restore-notification';
        notification.className = 'session-restore-notification';
        notification.innerHTML = `
            <div class="session-restore-content">
                <div class="session-restore-icon">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                        <path d="M3 3v5h5"></path>
                    </svg>
                </div>
                <div class="session-restore-text">
                    <div class="session-restore-title">Restore previous session</div>
                    <div class="session-restore-desc">${summary}</div>
                </div>
                <div class="session-restore-actions">
                    <button class="session-restore-btn secondary" data-action="dismiss">Dismiss</button>
                    <button class="session-restore-btn primary" data-action="restore">Restore</button>
                </div>
            </div>
        `;

        const cleanup = (result) => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 180);
            resolve(result);
        };

        notification.querySelector('[data-action="dismiss"]').onclick = () => cleanup(false);
        notification.querySelector('[data-action="restore"]').onclick = () => cleanup(true);

        document.body.appendChild(notification);
        requestAnimationFrame(() => notification.classList.add('show'));
    });
}

/**
 * Restore session from localStorage on app startup.
 * Recovers all open tabs including unsaved files with their content.
 */
async function restoreSession() {
    if (sessionRestored) return;
    sessionRestored = true;

    const behavior = getStartupBehavior();
    const session = await getStoredSession();

    if (!session) return;

    if (behavior === STARTUP_BEHAVIORS.EMPTY) {
        clearSession();
        return;
    }

    try {
        if (behavior === STARTUP_BEHAVIORS.REOPEN_SAVED) {
            const reopenedCount = await reopenSessionTabs(session, { includeUnsaved: false });
            clearSession();
            if (reopenedCount > 0) {
                log(`Reopened ${reopenedCount} file(s) from previous session ✓`, 'success');
            }
            return;
        }

        const unsavedTabs = session.tabs.filter(t => t.modified || (!t.path && (t.content || '') !== (t.original || '')));
        if (unsavedTabs.length > 0) {
            const confirmed = await showSessionRestoreNotification(buildSessionRestoreSummary(session));

            if (!confirmed) {
                clearSession();
                return;
            }
        }

        const restoredCount = await reopenSessionTabs(session, { includeUnsaved: true });
        if (restoredCount > 0) {
            log('Previous session restored ✓', 'success');
        }

        clearSession();
    } catch (e) {
        console.error('[Session] Failed to restore session:', e);
        clearSession();
    }
}

/**
 * Initialize session persistence system
 */
function initSessionPersistence() {
    // Start periodic saves
    startSessionPeriodicSave();

    // Save session before window unloads
    window.addEventListener('beforeunload', () => {
        saveSession(true);
    });

    // Restore previous session if any (delayed to ensure Monaco is ready)
    setTimeout(() => restoreSession(), 300);
}
