/**
 * Sameko Dev C++ IDE - renderer: About tab, update status handling, portable detection, compiler check at startup.
 *
 * One of the files that used to be the single renderer/app.js. They are plain
 * <script> files sharing one global scope and are loaded by index.html in a
 * fixed order (see CODEBASE.md); nothing here may run at load time that needs
 * a function from a later file.
 */

// ============================================================================
// ABOUT & UPDATE CHECK
// ============================================================================
async function initAbout() {
    if (!window.electronAPI) return;

    try {
        const version = await window.electronAPI.getCurrentVersion();
        const verEl = document.getElementById('about-version');
        if (verEl) verEl.textContent = version;

        // Populate system versions
        const sysVersions = window.electronAPI.getSystemVersions();
        if (sysVersions) {
            const elElectron = document.getElementById('about-electron');
            const elChrome = document.getElementById('about-chrome');
            const elNode = document.getElementById('about-node');

            if (elElectron) elElectron.textContent = sysVersions.electron || 'Unknown';
            if (elChrome) elChrome.textContent = sysVersions.chrome || 'Unknown';
            if (elNode) elNode.textContent = sysVersions.node || 'Unknown';
        }

    } catch (e) {
        console.error('[About] Init failed', e);
    }

    const checkBtn = document.getElementById('btn-check-update');
    // Remove old listeners to avoid duplicates if re-init
    if (checkBtn) {
        const newBtn = checkBtn.cloneNode(true);
        checkBtn.parentNode.replaceChild(newBtn, checkBtn);
        newBtn.onclick = () => checkForUpdates();
    }

    const githubBtn = document.getElementById('btn-github');
    if (githubBtn) {
        githubBtn.onclick = () => {
            window.electronAPI.openReleasePage('https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP');
        };
    }

    // Wire up Update Overlay buttons
    const overlay = document.getElementById('update-overlay');
    const closeBtn = document.getElementById('update-close');
    const laterBtn = document.getElementById('update-later');
    const downloadBtn = document.getElementById('update-download');
    const restartBtn = document.getElementById('update-restart');

    if (overlay) {
        const close = () => { overlay.style.display = 'none'; };
        if (closeBtn) closeBtn.onclick = close;
        if (laterBtn) laterBtn.onclick = close;
        if (downloadBtn) downloadBtn.onclick = () => downloadUpdate();
        if (restartBtn) restartBtn.onclick = () => restartToUpdate();
    }

    // Listen for update status from main process
    if (window.electronAPI?.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((data) => {
            handleUpdateStatus(data);
        });
    } else {
        console.warn('[Update] onUpdateStatus not available');
    }
}

// Update state
let updateDownloaded = false;
let isPortableVersion = false;
let pendingUpdateVersion = null;

// Detect portable version (non-blocking)
function detectPortableVersion() {
    if (!window.electronAPI?.getAppInfo) return;

    window.electronAPI.getAppInfo()
        .then(info => {
            isPortableVersion = info?.isPortable || false;
        })
        .catch(() => { });
}

// Minimal toast: surface the message in the terminal and the status bar.
function showToast(message, type = 'info') {
    log(message, type);
    setStatus(message, type === 'info' ? 'ready' : type);
}

// Validate compiler status on startup
function validateCompilerOnStartup() {
    if (!window.electronAPI?.getCompilerStatus) return;

    window.electronAPI.getCompilerStatus().then(status => {
        if (status.fallback) {
            showToast('Bundled compiler not found. Using system g++ from PATH.', 'warning');
        } else if (status.found === false && status.error) {
            showToast(`C++ compiler (g++) not found (${status.error}). Reinstall the app or install MinGW.`, 'error');
        }
    }).catch(err => {
        console.error('[Compiler] Validation check failed:', err);
    });
}


function handleUpdateStatus(data) {
    // Add null/undefined checks for data safety
    if (!data) {
        console.error('[Update] Received null or undefined update status data');
        return;
    }

    const { status, data: updateData = {}, currentVersion } = data;


    const overlay = document.getElementById('update-overlay');
    const title = document.getElementById('update-title');
    const progress = document.getElementById('update-progress');
    const progressFill = document.getElementById('update-progress-fill');
    const progressText = document.getElementById('update-progress-text');
    const downloadBtn = document.getElementById('update-download');
    const restartBtn = document.getElementById('update-restart');
    const laterBtn = document.getElementById('update-later');
    const headerRestartBtn = document.getElementById('btn-restart-update');

    switch (status) {
        case 'checking-for-update':
            updateDownloaded = false;
            if (headerRestartBtn && !isPortableVersion) {
                headerRestartBtn.style.display = 'none';
            }
            break;

        case 'update-available':
            updateDownloaded = false;
            pendingUpdateVersion = updateData?.version;

            // Update version info
            const upCur = document.getElementById('update-current');
            const upNew = document.getElementById('update-new');
            if (upCur) upCur.textContent = 'v' + currentVersion;
            if (upNew && updateData?.version) upNew.textContent = 'v' + updateData.version;

            // Update title
            if (title) {
                title.textContent = updateData?.isPrerelease ?
                    'Pre-release Update Available' :
                    'Update Available';
            }

            if (isPortableVersion) {
                // Portable: Show header button that links to download page
                if (headerRestartBtn) {
                    headerRestartBtn.style.display = 'flex';
                    headerRestartBtn.querySelector('span').textContent = 'Download v' + updateData?.version;
                }
                // Don't show overlay for portable - just header notification
                if (overlay) overlay.style.display = 'none';
            } else {
                // Installer: Auto-download handled by electron-updater (autoDownload = true)
                // Don't show overlay - silent download
                if (overlay) overlay.style.display = 'none';
                
                // Hide header restart button during check/download
                if (headerRestartBtn) {
                    headerRestartBtn.style.display = 'none';
                }
            }

            if (progress) progress.style.display = 'none';
            break;

        case 'update-not-available':
            // Don't show popup when no update is available
            break;

        case 'download-started':
            updateDownloaded = false;

            if (title) title.textContent = 'Downloading Update...';
            if (downloadBtn) downloadBtn.disabled = true;
            if (progress) {
                progress.style.display = 'block';
                progressFill.style.width = '0%';
                progressText.textContent = 'Downloading: 0%';
            }

            // Show header progress bar
            const headerProgressStart = document.getElementById('header-update-progress');
            if (headerProgressStart) {
                headerProgressStart.style.display = 'flex';
                const fillStart = document.getElementById('header-progress-fill');
                const textStart = document.getElementById('header-progress-text');
                if (fillStart) fillStart.style.width = '0%';
                if (textStart) textStart.textContent = '0%';
            }

            // Hide header restart button during download
            if (headerRestartBtn && !isPortableVersion) {
                headerRestartBtn.style.display = 'none';
            }
            break;

        case 'download-progress':
            // Skip progress updates if update is already downloaded
            if (updateDownloaded) {
                break;
            }

            const percent = updateData?.percent || 0;

            // Update overlay progress
            if (progressFill) progressFill.style.width = percent + '%';
            if (progressText) progressText.textContent = `Downloading: ${percent}%`;

            // Update header progress bar
            const headerProgress = document.getElementById('header-update-progress');
            if (headerProgress) {
                headerProgress.style.display = 'flex';
                const headerFill = document.getElementById('header-progress-fill');
                const headerText = document.getElementById('header-progress-text');
                if (headerFill) headerFill.style.width = percent + '%';
                if (headerText) headerText.textContent = percent + '%';
            }

            // Hide header restart button during download
            if (headerRestartBtn && !isPortableVersion) {
                headerRestartBtn.style.display = 'none';
            }

            // At 100%, keep waiting for a real update-downloaded event.
            // This avoids showing "Restart to Update" too early while updater is still finalizing.
            if (percent >= 100 && !updateDownloaded) {
                if (progressText) progressText.textContent = 'Verifying update package...';

                const headerTextVerifying = document.getElementById('header-progress-text');
                if (headerTextVerifying) headerTextVerifying.textContent = 'Verifying...';
            }
            break;

        case 'update-downloaded':
            updateDownloaded = true;

            // Hide overlay and progress
            if (overlay) overlay.style.display = 'none';
            if (progress) progress.style.display = 'none';

            // Hide header progress bar
            const headerProgressDone = document.getElementById('header-update-progress');
            if (headerProgressDone) headerProgressDone.style.display = 'none';

            // Show "Restart to Update" button in header with badge
            if (headerRestartBtn) {
                headerRestartBtn.style.display = 'flex';
                headerRestartBtn.querySelector('span').textContent = 'Restart to Update';
            }
            break;

        case 'update-error':
            console.error('[Update] Error:', updateData?.message || 'Unknown error');
            // Silent fail - don't show popup error messages
            updateDownloaded = false;
            if (headerRestartBtn && !isPortableVersion) {
                headerRestartBtn.style.display = 'none';
            }
            break;
    }
}

async function checkForUpdates() {
    if (!window.electronAPI) return;

    try {
        await window.electronAPI.checkForUpdates();
    } catch (error) {
        console.error('[Update] Check failed:', error);
    }
}

async function downloadUpdate() {
    if (!window.electronAPI) return;

    try {
        await window.electronAPI.downloadUpdate();
    } catch (error) {
        console.error('[Update] Download failed:', error);
    }
}

function restartToUpdate() {
    if (!window.electronAPI || !updateDownloaded) return;

    window.electronAPI.quitAndInstall();
}
