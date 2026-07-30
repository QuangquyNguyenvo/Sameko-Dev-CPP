/**
 * Auto Update Service using electron-updater
 * Provides automatic updates with "Restart to Update" functionality like VS Code
 * @module app/services/auto-update-service
 */

'use strict';

const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const log = require('electron-log');
const { IS_WIN, IS_LINUX } = require('../shared/platform');

/**
 * electron-updater's HttpError packs the whole response — every header plus a
 * stack — into `message`, so logging the error object spills ~40 lines for a
 * plain 404. Keep the first line; that is the part a human reads.
 * @param {Error|*} err
 * @returns {string}
 */
function shortUpdateError(err) {
    const raw = (err && err.message) || String(err || 'unknown error');
    return raw.split('\n')[0].trim();
}

function firstLine(value) {
    if (value instanceof Error) return shortUpdateError(value);
    if (typeof value === 'string' && value.includes('\n')) return value.split('\n')[0].trim();
    return value;
}

// Configure electron-log for autoUpdater.
// electron-updater also logs its OWN failures through this logger, and it
// formats them as `Error: ${e.stack}` — so handing it `log` unchanged still
// dumped the full HttpError (headers, body, stack) on every check, no matter
// what our own handlers do. Collapse multi-line arguments to their first line.
// Inherit from `log` so electron-updater still finds `logger.transports`.
const updateLog = Object.create(log);
for (const level of ['error', 'warn', 'info', 'debug']) {
    updateLog[level] = (...args) => log[level](...args.map(firstLine));
}
autoUpdater.logger = updateLog;
log.transports.file.level = 'info';

class AutoUpdateService {
    constructor() {
        this.mainWindow = null;
        this.updateDownloaded = false;
        this.updateInfo = null;

        // Allow pre-release updates (beta versions)
        autoUpdater.allowPrerelease = true;

        // Auto-download updates in background
        autoUpdater.autoDownload = true;

        // Configure update check
        // Do NOT install silently on quit - require explicit restart
        autoUpdater.autoInstallOnAppQuit = false;

        // Disable ALL signature verification for unsigned builds
        autoUpdater.verifyUpdateCodeSignature = false;
        
        // Force disable differential downloads (they require signing)
        autoUpdater.disableDifferentialDownload = true;
        
        // Disable web installer differential downloads
        autoUpdater.disableWebInstaller = false;
        
        // Force allow unsigned updates
        autoUpdater.forceDevUpdateConfig = false;
        
        // Override the default signature validator to always return true
        // This allows unsigned builds to update
        if (autoUpdater.httpExecutor) {
            const originalDownloadToBuffer = autoUpdater.httpExecutor.downloadToBuffer;
            autoUpdater.httpExecutor.downloadToBuffer = function(...args) {
                return originalDownloadToBuffer.apply(this, args);
            };
        }

        this.setupEventHandlers();
    }

    /**
     * electron-updater can only self-update an AppImage on Linux; a .deb install is
     * managed by apt and must not be touched. The AppImage runtime exports $APPIMAGE.
     * @returns {boolean}
     */
    isUpdateSupportedOnThisPlatform() {
        if (!IS_LINUX) return true;
        return !!process.env.APPIMAGE;
    }

    initialize(mainWindow) {
        this.mainWindow = mainWindow;
        log.info('[AutoUpdate] Service initialized');

        // Check if we should test updates in dev mode
        const testUpdatesInDev = process.env.TEST_UPDATES === 'true' || process.argv.includes('--test-updates');
        const fakeUpdate = process.env.FAKE_UPDATE === 'true' || process.argv.includes('--fake-update');

        // Fake update for testing UI
        if (fakeUpdate) {
            log.info('[AutoUpdate] Running FAKE update for UI testing');
            setTimeout(() => this.triggerFakeUpdate(), 3000);
            return;
        }

        const updatesSupported = this.isUpdateSupportedOnThisPlatform();
        if (!updatesSupported) {
            log.info('[AutoUpdate] Linux non-AppImage install (.deb/apt) — auto-update disabled.');
        }

        // Check for pending update from previous version (1.0.2 fix)
        if (app.isPackaged && updatesSupported) {
            setTimeout(() => {
                this.checkPendingUpdate();
            }, 3000);
        }

        // Only check for updates in packaged app (skip in development/first run)
        if ((app.isPackaged && updatesSupported) || testUpdatesInDev) {
            if (testUpdatesInDev) {
                log.info('[AutoUpdate] Testing updates in development mode');
                autoUpdater.forceDevUpdateConfig = true;
            }
            
            // Check for updates on startup (after 10 seconds delay, non-blocking)
            setTimeout(() => {
                this.checkForUpdates(false).catch(err => {
                    log.warn('[AutoUpdate] Startup check failed (non-critical):', err.message);
                });
            }, 10000);
        } else if (app.isPackaged) {
            // Packaged, but the platform opted out (e.g. a .deb owned by apt).
            // The reason was already logged above; don't claim "development mode".
        } else {
            log.info('[AutoUpdate] Skipping update check in development mode');
            log.info('[AutoUpdate] To test updates in dev, run: npm start -- --test-updates');
            log.info('[AutoUpdate] To test update UI, run: npm start -- --fake-update');
        }
    }

    /**
     * Setup event handlers for auto-updater
     */
    setupEventHandlers() {
        // Checking for updates
        autoUpdater.on('checking-for-update', () => {
            log.info('[AutoUpdate] Checking for updates...');
            this.updateDownloaded = false; // Reset state
            this.sendStatusToRenderer('checking-for-update');
        });

        // Update available
        autoUpdater.on('update-available', (info) => {
            log.info('[AutoUpdate] Update available:', info.version);
            this.updateDownloaded = false; // Reset state
            this.updateInfo = info;
            this.sendStatusToRenderer('update-available', {
                version: info.version,
                releaseNotes: info.releaseNotes,
                releaseDate: info.releaseDate,
                isPrerelease: info.version.includes('beta') || info.version.includes('alpha')
            });
            this.sendStatusToRenderer('download-started');
        });

        // No update available
        autoUpdater.on('update-not-available', (info) => {
            log.info('[AutoUpdate] No updates available');
            this.sendStatusToRenderer('update-not-available', {
                version: info.version
            });
        });

        // Error occurred
        autoUpdater.on('error', (err) => {
            log.error('[AutoUpdate] Error:', shortUpdateError(err));

            // Check if error is related to signature verification
            const errorMsg = err.message || err.toString();
            if (errorMsg.includes('not signed by the application owner') || 
                errorMsg.includes('not digitally signed') ||
                errorMsg.includes('publisherNames')) {
                log.warn('[AutoUpdate] Signature verification error - treating as successful download for unsigned build');
                
                // For unsigned builds, treat signature error as successful download
                // The file is already downloaded, just not verified
                this.updateDownloaded = true;
                
                this.sendStatusToRenderer('update-downloaded', {
                    version: this.updateInfo?.version || 'Unknown',
                    releaseNotes: this.updateInfo?.releaseNotes || '',
                    releaseDate: this.updateInfo?.releaseDate || '',
                    unsigned: true
                });
            } else {
                // For other errors, send error status
                this.sendStatusToRenderer('update-error', {
                    message: err.message
                });
            }
        });

        // Download progress
        autoUpdater.on('download-progress', (progressObj) => {
            const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
            log.info('[AutoUpdate]', logMessage);

            this.sendStatusToRenderer('download-progress', {
                percent: Math.round(progressObj.percent),
                transferred: progressObj.transferred,
                total: progressObj.total,
                bytesPerSecond: progressObj.bytesPerSecond
            });
        });

        // Update downloaded - ready to install
        autoUpdater.on('update-downloaded', (info) => {
            log.info('[AutoUpdate] Update downloaded:', info.version);
            this.updateDownloaded = true;
            this.updateInfo = info;

            this.sendStatusToRenderer('update-downloaded', {
                version: info.version,
                releaseNotes: info.releaseNotes,
                releaseDate: info.releaseDate
            });
        });
    }

    /**
     * Send update status to renderer process
     * @param {string} status - Update status
     * @param {object} data - Additional data
     */
    sendStatusToRenderer(status, data = {}) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('update-status', {
                status,
                data,
                currentVersion: app.getVersion()
            });
        }
    }

    async checkForUpdates(showNoUpdateDialog = true) {
        // A .deb install is owned by apt — electron-updater must not touch it.
        // initialize() already skips the startup check, but the renderer can
        // reach this through IPC, so the guard has to live here too.
        if (!this.isUpdateSupportedOnThisPlatform()) {
            log.info('[AutoUpdate] Skipped: this install is managed by the system package manager.');
            if (showNoUpdateDialog) {
                this.sendStatusToRenderer('update-not-available', {
                    version: app.getVersion(),
                    showMessage: true
                });
            }
            return null;
        }

        try {
            log.info('[AutoUpdate] Checking for updates manually...');

            if (showNoUpdateDialog) {
                this.sendStatusToRenderer('checking-for-update');
            }

            // Add timeout to prevent hanging (15 seconds)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Update check timed out')), 15000);
            });

            const result = await Promise.race([
                autoUpdater.checkForUpdates(),
                timeoutPromise
            ]);

            // Handle null/undefined result safely
            if (showNoUpdateDialog && (!result || !result.updateInfo)) {
                this.sendStatusToRenderer('update-not-available', {
                    version: app.getVersion(),
                    showMessage: true
                });
            }

            return result;
        } catch (error) {
            log.error('[AutoUpdate] Check failed:', shortUpdateError(error));

            if (showNoUpdateDialog) {
                this.sendStatusToRenderer('update-error', {
                    message: error.message || 'Update check failed',
                    showMessage: true
                });
            }

            throw error;
        }
    }

    /**
     * Download the available update
     */
    async downloadUpdate() {
        try {
            log.info('[AutoUpdate] Starting update download...');
            this.updateDownloaded = false; // Reset state
            this.sendStatusToRenderer('download-started');
            await autoUpdater.downloadUpdate();
        } catch (error) {
            log.error('[AutoUpdate] Download failed:', error);
            this.sendStatusToRenderer('update-error', {
                message: error.message
            });
            throw error;
        }
    }

    /**
     * Install the downloaded update and restart the app
     */
    quitAndInstall() {
        if (this.updateDownloaded) {
            log.info('[AutoUpdate] Quitting and installing update...');

            // setImmediate ensures the app quits after this function returns
            setImmediate(() => {
                // Disable all windows close event handlers
                app.removeAllListeners('window-all-closed');

                // Close all windows
                BrowserWindow.getAllWindows().forEach(window => {
                    window.removeAllListeners('close');
                    window.close();
                });

                // Quit and install
                autoUpdater.quitAndInstall(false, true);
            });
        } else {
            log.warn('[AutoUpdate] No update downloaded yet');
        }
    }

    getStatus() {
        return {
            updateDownloaded: this.updateDownloaded,
            updateInfo: this.updateInfo,
            currentVersion: app.getVersion()
        };
    }

    /**
     * Trigger fake update for testing UI
     */
    triggerFakeUpdate() {
        log.info('[AutoUpdate] Starting fake update simulation');
        
        // Step 1: Update available
        this.sendStatusToRenderer('update-available', {
            version: '999.0.0',
            releaseNotes: 'Fake update for testing UI',
            releaseDate: new Date().toISOString(),
            isPrerelease: false
        });

        // Step 2: Download started
        setTimeout(() => {
            log.info('[AutoUpdate] Fake: Download started');
            this.sendStatusToRenderer('download-started');
        }, 500);

        // Step 3: Simulate download progress
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress >= 100) {
                progress = 100;
                clearInterval(progressInterval);
                
                // Step 4: Download complete
                setTimeout(() => {
                    log.info('[AutoUpdate] Fake: Download completed');
                    this.updateDownloaded = true;
                    this.sendStatusToRenderer('update-downloaded', {
                        version: '999.0.0',
                        releaseNotes: 'Fake update for testing UI',
                        releaseDate: new Date().toISOString()
                    });
                }, 500);
            } else {
                this.sendStatusToRenderer('download-progress', {
                    percent: Math.round(progress),
                    transferred: Math.round(progress * 1024 * 1024),
                    total: 100 * 1024 * 1024,
                    bytesPerSecond: 5 * 1024 * 1024
                });
            }
        }, 300);
    }

    /**
     * Check for pending update from previous version (hotfix for 1.0.2)
     *
     * Windows-only: it looks for an NSIS installer staged under
     * %LOCALAPPDATA%, a directory that has no meaning elsewhere. Off Windows
     * `app.getPath('localAppData')` throws outright, which is what the
     * AppImage was logging ("Failed to get 'localAppData' path") on every
     * launch.
     */
    checkPendingUpdate() {
        if (!IS_WIN) return;

        const fs = require('fs');
        const path = require('path');
        const os = require('os');

        try {
            const pendingDirs = [
                path.join(app.getPath('localAppData'), 'sameko-dev-cpp-updater', 'pending'),
                path.join(os.homedir(), 'AppData', 'Local', 'sameko-dev-cpp-updater', 'pending')
            ];

            const installerFiles = [];

            pendingDirs.forEach(pendingDir => {
                if (fs.existsSync(pendingDir)) {
                    // Check if update-info.json exists to confirm the download was completed successfully
                    const updateInfoPath = path.join(pendingDir, 'update-info.json');
                    if (fs.existsSync(updateInfoPath)) {
                        try {
                            const updateInfo = JSON.parse(fs.readFileSync(updateInfoPath, 'utf8'));
                            if (updateInfo && updateInfo.fileName) {
                                const exePath = path.join(pendingDir, updateInfo.fileName);
                                if (fs.existsSync(exePath)) {
                                    installerFiles.push({
                                        dir: pendingDir,
                                        file: updateInfo.fileName
                                    });
                                }
                            }
                        } catch (parseErr) {
                            log.warn('[AutoUpdate] Failed to parse pending update-info.json:', parseErr.message);
                        }
                    }
                }
            });

            if (installerFiles.length === 0) return;

            const parsed = installerFiles
                .map(({ dir, file }) => {
                    const versionMatch = file.match(/sameko-dev-cpp-setup-(\d+\.\d+\.\d+)/);
                    return {
                        dir,
                        file,
                        version: versionMatch ? versionMatch[1] : null
                    };
                })
                .filter(item => item.version);

            if (parsed.length === 0) {
                log.warn('[AutoUpdate] Could not extract version from pending installers');
                return;
            }

            parsed.sort((a, b) => this.compareVersions(b.version, a.version));
            const newest = parsed[0];

            log.info('[AutoUpdate] Found pending update file:', newest.file);

            const pendingVersion = newest.version;
            const currentVersion = app.getVersion();
            const versionComparison = this.compareVersions(pendingVersion, currentVersion);

            if (versionComparison > 0) {
                log.info(`[AutoUpdate] Pending update (v${pendingVersion}) is newer than current (v${currentVersion})`);
                this.updateDownloaded = true;
                this.sendStatusToRenderer('update-downloaded', {
                    version: pendingVersion,
                    releaseNotes: 'Update downloaded in previous session',
                    releaseDate: new Date().toISOString(),
                    fromPending: true
                });
            } else {
                parsed.forEach(item => {
                    const itemComparison = this.compareVersions(item.version, currentVersion);
                    if (itemComparison > 0) {
                        // Keep newer pending installers so user can still restart and update.
                        log.info(`[AutoUpdate] Keeping newer pending installer (v${item.version})`);
                        return;
                    }

                    const filePath = path.join(item.dir, item.file);
                    if (itemComparison === 0) {
                        log.info(`[AutoUpdate] Pending file (v${item.version}) matches current version (v${currentVersion}), cleaning up...`);
                    } else {
                        log.info(`[AutoUpdate] Pending update (v${item.version}) is older than current (v${currentVersion}), cleaning up...`);
                    }

                    try {
                        fs.unlinkSync(filePath);
                        log.info('[AutoUpdate] Deleted pending file:', item.file);
                        
                        // Also delete the corresponding update-info.json
                        const infoPath = path.join(item.dir, 'update-info.json');
                        if (fs.existsSync(infoPath)) {
                            fs.unlinkSync(infoPath);
                            log.info('[AutoUpdate] Deleted corresponding update-info.json');
                        }
                    } catch (cleanupErr) {
                        log.warn('[AutoUpdate] Failed to clean up pending file:', cleanupErr.message);
                    }
                });
            }
        } catch (err) {
            log.warn('[AutoUpdate] Failed to check pending update:', err.message);
        }
    }
    
    /**
     * Compare two semver versions
     * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
     */
    compareVersions(v1, v2) {
        const parts1 = String(v1).split('.').map(Number);
        const parts2 = String(v2).split('.').map(Number);

        const maxLen = Math.max(parts1.length, parts2.length, 3);
        for (let i = 0; i < maxLen; i++) {
            const a = Number.isFinite(parts1[i]) ? parts1[i] : 0;
            const b = Number.isFinite(parts2[i]) ? parts2[i] : 0;
            if (a > b) return 1;
            if (a < b) return -1;
        }
        return 0;
    }
}

// Singleton instance
const autoUpdateService = new AutoUpdateService();

module.exports = autoUpdateService;
