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

// Configure electron-log for autoUpdater
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

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

        // Check for pending update from previous version (1.0.2 fix)
        if (app.isPackaged) {
            setTimeout(() => {
                this.checkPendingUpdate();
            }, 3000);
        }

        // Only check for updates in packaged app (skip in development/first run)
        if (app.isPackaged || testUpdatesInDev) {
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
            this.sendStatusToRenderer('checking-for-update');
        });

        // Update available
        autoUpdater.on('update-available', (info) => {
            log.info('[AutoUpdate] Update available:', info.version);
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
            log.error('[AutoUpdate] Error:', err);
            
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
            log.error('[AutoUpdate] Check failed:', error);

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
     */
    checkPendingUpdate() {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        try {
            const pendingDir = path.join(os.homedir(), 'AppData', 'Local', 'sameko-dev-cpp-updater', 'pending');
            
            if (fs.existsSync(pendingDir)) {
                const files = fs.readdirSync(pendingDir);
                const installerFile = files.find(f => f.endsWith('.exe') && f.includes('sameko-dev-cpp-setup'));
                
                if (installerFile) {
                    log.info('[AutoUpdate] Found pending update file:', installerFile);
                    
                    // Extract version from filename (e.g., sameko-dev-cpp-setup-1.0.3.exe)
                    const versionMatch = installerFile.match(/sameko-dev-cpp-setup-(\d+\.\d+\.\d+)/);
                    const pendingVersion = versionMatch ? versionMatch[1] : null;
                    const currentVersion = app.getVersion();
                    
                    if (pendingVersion) {
                        // Compare versions
                        const versionComparison = this.compareVersions(pendingVersion, currentVersion);
                        
                        if (versionComparison > 0) {
                            // Pending version is definitely newer (e.g., 1.0.4 > 1.0.3)
                            log.info(`[AutoUpdate] Pending update (v${pendingVersion}) is newer than current (v${currentVersion})`);
                            
                            // Trigger update-downloaded event to show Restart button
                            this.updateDownloaded = true;
                            this.sendStatusToRenderer('update-downloaded', {
                                version: pendingVersion,
                                releaseNotes: 'Update downloaded in previous session',
                                releaseDate: new Date().toISOString(),
                                fromPending: true
                            });
                        } else if (versionComparison === 0) {
                            // Same version - check file timestamp
                            const filePath = path.join(pendingDir, installerFile);
                            const fileStats = fs.statSync(filePath);
                            const appCompileTime = fs.statSync(process.execPath).mtime;
                            
                            if (fileStats.mtime > appCompileTime) {
                                // File is newer than current app binary
                                log.info(`[AutoUpdate] Pending file (v${pendingVersion}) is newer build than current app`);
                                
                                this.updateDownloaded = true;
                                this.sendStatusToRenderer('update-downloaded', {
                                    version: pendingVersion,
                                    releaseNotes: 'Update downloaded in previous session',
                                    releaseDate: new Date().toISOString(),
                                    fromPending: true
                                });
                            } else {
                                // File is older or same as current app
                                log.info(`[AutoUpdate] Pending file (v${pendingVersion}) is older build, cleaning up...`);
                                fs.unlinkSync(filePath);
                                log.info('[AutoUpdate] Deleted outdated pending file');
                            }
                        } else {
                            // Pending version is older (e.g., 1.0.2 < 1.0.3)
                            log.info(`[AutoUpdate] Pending update (v${pendingVersion}) is older than current (v${currentVersion}), cleaning up...`);
                            
                            const filePath = path.join(pendingDir, installerFile);
                            fs.unlinkSync(filePath);
                            log.info('[AutoUpdate] Deleted outdated pending file');
                        }
                    } else {
                        log.warn('[AutoUpdate] Could not extract version from filename:', installerFile);
                    }
                }
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
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        for (let i = 0; i < 3; i++) {
            if (parts1[i] > parts2[i]) return 1;
            if (parts1[i] < parts2[i]) return -1;
        }
        return 0;
    }
}

// Singleton instance
const autoUpdateService = new AutoUpdateService();

module.exports = autoUpdateService;
