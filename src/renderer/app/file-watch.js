/**
 * Sameko Dev C++ IDE - renderer: External file changes and the reload prompt.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// FILE WATCHER - Detect external changes
// ============================================================================
let pendingReloadNotifications = new Set(); // Track which files have pending notifications


function startFileWatch(filePath) {
    if (!filePath || !window.electronAPI?.watchFile) return;
    window.electronAPI.watchFile(filePath);
}


function stopFileWatch(filePath) {
    if (!filePath || !window.electronAPI?.unwatchFile) return;
    window.electronAPI.unwatchFile(filePath);
}

// Handle external file change notification
function handleExternalFileChange(filePath) {

    if (pendingReloadNotifications.has(filePath)) return;


    const tab = App.tabs.find(t => t.path === filePath);
    if (!tab) return;

    pendingReloadNotifications.add(filePath);


    showReloadNotification(tab);
}

// Show reload notification popup (similar to Dev-C++)
function showReloadNotification(tab) {

    const existingNotif = document.querySelector(`.reload-notification[data-path="${CSS.escape(tab.path)}"]`);
    if (existingNotif) existingNotif.remove();

    const notification = document.createElement('div');
    notification.className = 'reload-notification';
    notification.dataset.path = tab.path;

    notification.innerHTML = `
                <div class="reload-notification-content">
                    <div class="reload-notification-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
                    <div class="reload-notification-text">
                        <div class="reload-notification-title">File changed</div>
                        <div class="reload-notification-file">${escapeHtml(tab.name)}</div>
                        <div class="reload-notification-desc">File has been changed externally. Do you want to reload?</div>
                    </div>
                    <div class="reload-notification-actions">
                        <button class="reload-btn reload-btn-yes" title="Reload from disk">Reload</button>
                        <button class="reload-btn reload-btn-no" title="Keep current">Ignore</button>
                    </div>
                </div>
                `;


    notification.querySelector('.reload-btn-yes').onclick = async () => {
        const result = await window.electronAPI?.reloadFile?.(tab.path);
        if (result?.success) {
            const pos1 = (tab.id === App.activeTabId && App.editor) ? App.editor.getPosition() : null;
            const pos2 = (tab.id === App.splitTabId && App.editor2) ? App.editor2.getPosition() : null;

            tab.original = result.content;
            setTabText(tab, result.content);
            tab.modified = false;

            if (pos1) App.editor.setPosition(pos1);
            if (pos2) App.editor2.setPosition(pos2);

            renderTabs();
            log(`Reloaded: ${tab.name}`, 'system');
        }
        pendingReloadNotifications.delete(tab.path);
        notification.remove();
    };


    notification.querySelector('.reload-btn-no').onclick = () => {
        pendingReloadNotifications.delete(tab.path);
        notification.remove();
        log(`Kept local version: ${tab.name}`, 'system');
    };

    document.body.appendChild(notification);


    setTimeout(() => {
        if (document.body.contains(notification)) {
            pendingReloadNotifications.delete(tab.path);
            notification.remove();
        }
    }, 30000);
}

// Initialize file watcher listener
if (window.electronAPI?.onFileChangedExternal) {
    window.electronAPI.onFileChangedExternal(data => {
        handleExternalFileChange(data.path);
    });
}
