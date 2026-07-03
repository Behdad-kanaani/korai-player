/**
 * updateUI.js - Update Notification UI
 * 
 * Displays update notification with progress bar
 * Handles user interaction for update initiation
 * Shows color-coded status: Green (available), Red (error), Yellow (checking)
 */

class UpdateUI {
    constructor() {
        this.container = null;
        this.notification = null;
        this.progressModal = null;
        this.isUpdating = false;
        this.updateInfo = null;
        this.progressCallback = null;
        this.statusCheckInterval = null;

        this.init();
    }

    /**
     * Initialize the UI components
     */
    init() {
        // Create notification element
        this.createNotification();
        // Create progress modal
        this.createProgressModal();
        // Listen for update progress events
        this.setupEventListeners();
        // Check for updates on load
        this.checkForUpdates();

        // Start periodic status check
        this.startPeriodicCheck();
    }

    /**
     * Create the update notification element with color-coded status
     */
    createNotification() {
        // Check if notification already exists
        if (document.getElementById('updateNotification')) {
            this.notification = document.getElementById('updateNotification');
            return;
        }

        const notif = document.createElement('div');
        notif.id = 'updateNotification';
        notif.className = 'update-notification';
        notif.style.cssText = `
            position: fixed;
            bottom: 120px;
            right: 24px;
            z-index: 10001;
            background: var(--spotify-dark, #101014);
            border-radius: 12px;
            padding: 16px 20px;
            min-width: 300px;
            max-width: 420px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.5);
            display: none;
            backdrop-filter: blur(12px);
            animation: slideInRight 0.4s ease;
            border-left: 4px solid #666;
            transition: border-color 0.3s ease;
        `;

        notif.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <div id="updateStatusIcon" style="
                    flex-shrink: 0; 
                    width: 36px; 
                    height: 36px; 
                    border-radius: 50%; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center;
                    background: rgba(255,255,255,0.05);
                    transition: all 0.3s ease;
                ">
                    <i id="updateStatusIconInner" class="fa-solid fa-cloud-arrow-up" style="color: #666; font-size: 1rem;"></i>
                </div>
                <div style="flex: 1;">
                    <div id="updateStatusTitle" style="font-weight: 700; font-size: 0.9rem; color: var(--spotify-text-active, #fff);">
                        Checking for updates...
                    </div>
                    <div id="updateMessage" style="font-size: 0.75rem; color: var(--spotify-text-muted, #9ba0a8); margin-top: 4px;">
                        Please wait...
                    </div>
                    <div id="updateActions" style="display: flex; gap: 10px; margin-top: 12px;">
                        <button id="updateNowBtn" style="
                            background: var(--accent-cyan, #1db954);
                            border: none;
                            padding: 6px 18px;
                            border-radius: 20px;
                            font-weight: 700;
                            font-size: 0.75rem;
                            color: #000;
                            cursor: pointer;
                            transition: all 0.2s ease;
                            display: none;
                        ">
                            <i class="fa-solid fa-download"></i> Update Now
                        </button>
                        <button id="dismissUpdateBtn" style="
                            background: transparent;
                            border: 1px solid rgba(255,255,255,0.1);
                            padding: 6px 14px;
                            border-radius: 20px;
                            font-weight: 600;
                            font-size: 0.75rem;
                            color: var(--spotify-text-muted);
                            cursor: pointer;
                            transition: all 0.2s ease;
                            display: none;
                        ">
                            Dismiss
                        </button>
                        <div id="updateSpinnerSmall" style="display: none; width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--accent-cyan, #1db954); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(notif);
        this.notification = notif;

        // Add event listeners
        document.getElementById('updateNowBtn').addEventListener('click', () => {
            this.startUpdate();
        });

        document.getElementById('dismissUpdateBtn').addEventListener('click', () => {
            this.dismissNotification();
        });

        // Add keyframe animation if not exists
        if (!document.getElementById('updateKeyframes')) {
            const style = document.createElement('style');
            style.id = 'updateKeyframes';
            style.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes slideInRight {
                    from { transform: translateX(120%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes pulseGreen {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(29, 185, 84, 0.4); }
                    50% { box-shadow: 0 0 0 8px rgba(29, 185, 84, 0); }
                }
                @keyframes pulseRed {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 42, 95, 0.4); }
                    50% { box-shadow: 0 0 0 8px rgba(255, 42, 95, 0); }
                }
                @keyframes pulseYellow {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4); }
                    50% { box-shadow: 0 0 0 8px rgba(255, 193, 7, 0); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Create the progress modal
     */
    createProgressModal() {
        // Check if modal already exists
        if (document.getElementById('updateProgressModal')) {
            this.progressModal = document.getElementById('updateProgressModal');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'updateProgressModal';
        modal.className = 'update-progress-modal';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 10050;
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(8px);
            display: none;
            align-items: center;
            justify-content: center;
        `;

        modal.innerHTML = `
            <div style="
                background: var(--spotify-dark, #101014);
                border: 1px solid var(--border-color, rgba(255,255,255,0.06));
                border-radius: 16px;
                padding: 32px 36px;
                max-width: 440px;
                width: 90%;
                box-shadow: 0 24px 60px rgba(0,0,0,0.6);
            ">
                <div style="text-align: center;">
                    <div id="updateSpinner" style="
                        width: 64px;
                        height: 64px;
                        margin: 0 auto 16px;
                        border: 3px solid rgba(0,255,213,0.1);
                        border-top-color: var(--accent-cyan);
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                    "></div>
                    
                    <h3 id="updateStatusTitle" style="
                        font-size: 1.1rem;
                        font-weight: 700;
                        color: var(--spotify-text-active, #fff);
                        margin-bottom: 6px;
                    ">Updating KORAI</h3>
                    
                    <p id="updateStatusMessage" style="
                        font-size: 0.85rem;
                        color: var(--spotify-text-muted, #9ba0a8);
                        margin-bottom: 16px;
                    ">Preparing files...</p>
                    
                    <div style="
                        width: 100%;
                        height: 4px;
                        background: rgba(255,255,255,0.06);
                        border-radius: 4px;
                        overflow: hidden;
                        margin-bottom: 8px;
                    ">
                        <div id="updateProgressFill" style="
                            width: 0%;
                            height: 100%;
                            background: linear-gradient(90deg, var(--accent-cyan), #00e5ff);
                            border-radius: 4px;
                            transition: width 0.3s ease;
                        "></div>
                    </div>
                    
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        font-size: 0.7rem;
                        color: var(--spotify-text-muted, #9ba0a8);
                    ">
                        <span id="updateProgressPercent">0%</span>
                        <span id="updateFileCount">0 / 0 files</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.progressModal = modal;
    }

    /**
     * Setup event listeners for update progress
     */
    setupEventListeners() {
        // Listen for progress updates from the main process
        if (window.electronAPI && window.electronAPI.onUpdateProgress) {
            window.electronAPI.onUpdateProgress((progress) => {
                this.updateProgress(progress);
            });
        }

        // Listen for update status from main process
        if (window.electronAPI && window.electronAPI.onUpdateStatus) {
            window.electronAPI.onUpdateStatus((updateInfo) => {
                this.handleUpdateStatus(updateInfo);
            });
        }

        // Custom event listener for progress from updater
        window.addEventListener('update-progress', (event) => {
            this.updateProgress(event.detail);
        });

        // Listen for app version
        if (window.electronAPI && window.electronAPI.onAppVersion) {
            window.electronAPI.onAppVersion((data) => {
                console.log('[UpdateUI] App version:', data);
            });
        }
    }

    /**
     * Handle update status from main process
     */
    handleUpdateStatus(updateInfo) {
        if (!updateInfo) return;

        if (updateInfo.hasUpdate) {
            this.showUpdateAvailable(updateInfo);
        } else if (updateInfo.updated) {
            this.showUpdateApplied(updateInfo);
        } else if (updateInfo.error) {
            this.showUpdateError(updateInfo.error);
        } else {
            this.showUpToDate(updateInfo);
        }
    }

    /**
     * Show "Update Available" - GREEN status
     */
    showUpdateAvailable(updateInfo) {
        this.updateInfo = updateInfo;
        const notif = this.notification;
        if (!notif) return;

        // Set border color to GREEN
        notif.style.borderLeftColor = '#1db954';
        notif.style.boxShadow = '0 12px 40px rgba(0,0,0,0.5), 0 0 20px rgba(29, 185, 84, 0.1)';

        // Update icon - GREEN
        const icon = document.getElementById('updateStatusIcon');
        const iconInner = document.getElementById('updateStatusIconInner');
        if (icon) {
            icon.style.background = 'rgba(29, 185, 84, 0.15)';
            icon.style.animation = 'pulseGreen 2s infinite';
        }
        if (iconInner) {
            iconInner.className = 'fa-solid fa-cloud-arrow-up';
            iconInner.style.color = '#1db954';
        }

        // Update title
        const title = document.getElementById('updateStatusTitle');
        if (title) {
            title.textContent = `📦 Update Available!`;
            title.style.color = '#1db954';
        }

        // Update message
        const message = document.getElementById('updateMessage');
        if (message) {
            if (updateInfo.totalFiles > 0) {
                const filesText = updateInfo.totalFiles === 1 ? 'file' : 'files';
                message.innerHTML = `
                    Version <strong>${updateInfo.latestVersion}</strong> is ready to install
                    <span style="display: block; font-size: 0.65rem; opacity: 0.7; margin-top: 2px;">
                        ${updateInfo.totalFiles} ${filesText} to update
                    </span>
                `;
            } else if (updateInfo.needsFullCheck) {
                message.innerHTML = `
                    Version <strong>${updateInfo.latestVersion}</strong> is ready to install
                    <span style="display: block; font-size: 0.65rem; opacity: 0.7; margin-top: 2px;">
                        Click Update Now to prepare the update files
                    </span>
                `;
            } else {
                message.innerHTML = `
                    Version <strong>${updateInfo.latestVersion}</strong> is ready to install
                `;
            }
        }

        // Show buttons
        const updateBtn = document.getElementById('updateNowBtn');
        const dismissBtn = document.getElementById('dismissUpdateBtn');
        const spinner = document.getElementById('updateSpinnerSmall');

        if (updateBtn) {
            updateBtn.style.display = 'inline-flex';
            updateBtn.innerHTML = `<i class="fa-solid fa-download"></i> Update Now`;
        }
        if (dismissBtn) {
            dismissBtn.style.display = 'inline-flex';
        }
        if (spinner) {
            spinner.style.display = 'none';
        }

        // Show notification
        notif.style.display = 'block';
    }

    /**
     * Show "Up to Date" - GREEN but different message
     */
    showUpToDate(updateInfo) {
        const notif = this.notification;
        if (!notif) return;

        // Set border color to GREEN (subtle)
        notif.style.borderLeftColor = '#1db954';

        // Update icon - GREEN
        const icon = document.getElementById('updateStatusIcon');
        const iconInner = document.getElementById('updateStatusIconInner');
        if (icon) {
            icon.style.background = 'rgba(29, 185, 84, 0.08)';
            icon.style.animation = 'none';
        }
        if (iconInner) {
            iconInner.className = 'fa-solid fa-check-circle';
            iconInner.style.color = '#1db954';
        }

        // Update title
        const title = document.getElementById('updateStatusTitle');
        if (title) {
            title.textContent = `✅ Up to Date`;
            title.style.color = '#1db954';
        }

        // Update message
        const message = document.getElementById('updateMessage');
        if (message) {
            message.textContent = `KORAI v${updateInfo.currentVersion || 'latest'} is the latest version`;
        }

        // Hide buttons
        const updateBtn = document.getElementById('updateNowBtn');
        const dismissBtn = document.getElementById('dismissUpdateBtn');
        if (updateBtn) updateBtn.style.display = 'none';
        if (dismissBtn) dismissBtn.style.display = 'none';

        // Show notification briefly then hide
        notif.style.display = 'block';
        setTimeout(() => {
            this.dismissNotification();
        }, 4000);
    }

    /**
     * Show "Checking for Updates" - YELLOW status
     */
    showCheckingForUpdates() {
        const notif = this.notification;
        if (!notif) return;

        // Set border color to YELLOW
        notif.style.borderLeftColor = '#ffc107';

        // Update icon - YELLOW
        const icon = document.getElementById('updateStatusIcon');
        const iconInner = document.getElementById('updateStatusIconInner');
        if (icon) {
            icon.style.background = 'rgba(255, 193, 7, 0.15)';
            icon.style.animation = 'pulseYellow 1.5s infinite';
        }
        if (iconInner) {
            iconInner.className = 'fa-solid fa-spinner fa-spin';
            iconInner.style.color = '#ffc107';
        }

        // Update title
        const title = document.getElementById('updateStatusTitle');
        if (title) {
            title.textContent = `🔄 Checking for updates...`;
            title.style.color = '#ffc107';
        }

        // Update message
        const message = document.getElementById('updateMessage');
        if (message) {
            message.textContent = 'Please wait...';
        }

        // Hide buttons, show spinner
        const updateBtn = document.getElementById('updateNowBtn');
        const dismissBtn = document.getElementById('dismissUpdateBtn');
        const spinner = document.getElementById('updateSpinnerSmall');

        if (updateBtn) updateBtn.style.display = 'none';
        if (dismissBtn) dismissBtn.style.display = 'none';
        if (spinner) spinner.style.display = 'block';

        notif.style.display = 'block';
    }

    /**
     * Show "Update Error" - RED status
     */
    showUpdateError(errorMessage) {
        const notif = this.notification;
        if (!notif) return;

        // Set border color to RED
        notif.style.borderLeftColor = '#ff2a5f';
        notif.style.boxShadow = '0 12px 40px rgba(0,0,0,0.5), 0 0 20px rgba(255, 42, 95, 0.1)';

        // Update icon - RED
        const icon = document.getElementById('updateStatusIcon');
        const iconInner = document.getElementById('updateStatusIconInner');
        if (icon) {
            icon.style.background = 'rgba(255, 42, 95, 0.15)';
            icon.style.animation = 'pulseRed 2s infinite';
        }
        if (iconInner) {
            iconInner.className = 'fa-solid fa-triangle-exclamation';
            iconInner.style.color = '#ff2a5f';
        }

        // Update title
        const title = document.getElementById('updateStatusTitle');
        if (title) {
            title.textContent = `❌ Update Failed`;
            title.style.color = '#ff2a5f';
        }

        // Update message
        const message = document.getElementById('updateMessage');
        if (message) {
            message.textContent = errorMessage || 'An error occurred while checking for updates';
        }

        // Show retry button
        const updateBtn = document.getElementById('updateNowBtn');
        const dismissBtn = document.getElementById('dismissUpdateBtn');

        if (updateBtn) {
            updateBtn.style.display = 'inline-flex';
            updateBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> Retry`;
            updateBtn.onclick = () => {
                this.checkForUpdates();
            };
        }
        if (dismissBtn) {
            dismissBtn.style.display = 'inline-flex';
        }

        notif.style.display = 'block';
    }

    /**
     * Show "Update Applied" - GREEN with special message
     */
    showUpdateApplied(updateInfo) {
        const notif = this.notification;
        if (!notif) return;

        // Set border color to GREEN
        notif.style.borderLeftColor = '#1db954';

        const icon = document.getElementById('updateStatusIcon');
        const iconInner = document.getElementById('updateStatusIconInner');
        if (icon) {
            icon.style.background = 'rgba(29, 185, 84, 0.15)';
            icon.style.animation = 'pulseGreen 2s infinite';
        }
        if (iconInner) {
            iconInner.className = 'fa-solid fa-check-circle';
            iconInner.style.color = '#1db954';
        }

        const title = document.getElementById('updateStatusTitle');
        if (title) {
            title.textContent = `✅ Update Applied!`;
            title.style.color = '#1db954';
        }

        const message = document.getElementById('updateMessage');
        if (message) {
            message.textContent = `KORAI v${updateInfo.latestVersion || 'latest'} is ready. Restarting...`;
        }

        const updateBtn = document.getElementById('updateNowBtn');
        const dismissBtn = document.getElementById('dismissUpdateBtn');
        if (updateBtn) updateBtn.style.display = 'none';
        if (dismissBtn) dismissBtn.style.display = 'none';

        notif.style.display = 'block';

        // Auto-hide after 3 seconds
        setTimeout(() => {
            this.dismissNotification();
        }, 3000);
    }

    /**
     * Check for updates on load
     */
    async checkForUpdates() {
        this.showCheckingForUpdates();

        try {
            if (window.electronAPI && window.electronAPI.checkUpdateStatus) {
                const result = await window.electronAPI.checkUpdateStatus();
                if (result) {
                    this.handleUpdateStatus(result);
                } else {
                    this.showUpdateError('No response from update server');
                }
            } else {
                this.showUpdateError('Update API not available');
            }
        } catch (err) {
            console.warn('[UpdateUI] Failed to check updates:', err);
            this.showUpdateError(err.message || 'Failed to check for updates');
        }
    }

    /**
     * Start periodic check for updates
     */
    startPeriodicCheck() {
        // Check every 30 minutes
        this.statusCheckInterval = setInterval(() => {
            if (!this.isUpdating) {
                this.checkForUpdates();
            }
        }, 30 * 60 * 1000);
    }

    /**
     * Show the update notification (generic)
     */
    showNotification(updateInfo) {
        if (updateInfo && updateInfo.hasUpdate) {
            this.showUpdateAvailable(updateInfo);
        } else {
            this.showUpToDate(updateInfo);
        }
    }

    /**
     * Dismiss the notification
     */
    dismissNotification() {
        if (this.notification) {
            this.notification.style.display = 'none';
        }
    }

    /**
     * Start the update process
     */
    async startUpdate() {
        if (this.isUpdating) return;
        if (!this.updateInfo) return;

        this.isUpdating = true;
        this.showProgressModal();

        try {
            // Request update from main process
            if (window.electronAPI && window.electronAPI.applyUpdate) {
                await window.electronAPI.applyUpdate(this.updateInfo);
            } else {
                throw new Error('Update API not available');
            }
        } catch (err) {
            console.error('[UpdateUI] Update failed:', err);
            this.showError(err.message);
        }
    }

    /**
     * Show the progress modal
     */
    showProgressModal() {
        if (!this.progressModal) return;
        this.progressModal.style.display = 'flex';

        // Reset progress
        const fill = document.getElementById('updateProgressFill');
        const percent = document.getElementById('updateProgressPercent');
        const fileCount = document.getElementById('updateFileCount');
        const message = document.getElementById('updateStatusMessage');

        if (fill) fill.style.width = '0%';
        if (percent) percent.textContent = '0%';
        if (fileCount) fileCount.textContent = '0 / 0 files';
        if (message) message.textContent = 'Starting update...';

        // Show spinner
        const spinner = document.getElementById('updateSpinner');
        if (spinner) {
            spinner.style.display = 'block';
        }

        // Hide notification
        this.dismissNotification();
    }

    /**
     * Update progress display
     */
    updateProgress(progress) {
        const fill = document.getElementById('updateProgressFill');
        const percent = document.getElementById('updateProgressPercent');
        const fileCount = document.getElementById('updateFileCount');
        const message = document.getElementById('updateStatusMessage');
        const title = document.getElementById('updateStatusTitle');

        if (fill && progress.progress !== undefined) {
            fill.style.width = Math.min(100, progress.progress) + '%';
        }

        if (percent && progress.progress !== undefined) {
            percent.textContent = Math.round(Math.min(100, progress.progress)) + '%';
        }

        if (fileCount && progress.totalFiles !== undefined) {
            const currentIndex = progress.fileIndex || 0;
            const total = progress.totalFiles || 0;
            fileCount.textContent = `${currentIndex} / ${total} files`;
        }

        if (message) {
            const statusMessages = {
                'starting': 'Initializing...',
                'backup': 'Backing up current files...',
                'downloading': 'Downloading updates...',
                'applying': 'Applying changes...',
                'cleaning': 'Cleaning up...',
                'complete': 'Update complete! Restarting...',
                'error': 'Update failed'
            };
            message.textContent = statusMessages[progress.status] || progress.message || 'Updating...';
        }

        if (title && progress.status === 'complete') {
            title.textContent = '✨ Update Complete!';
            const spinner = document.getElementById('updateSpinner');
            if (spinner) {
                spinner.style.display = 'none';
            }
        }

        if (progress.status === 'complete') {
            setTimeout(() => {
                this.hideProgressModal();
                if (window.electronAPI && window.electronAPI.restartApp) {
                    window.electronAPI.restartApp();
                }
            }, 2000);
        }
    }

    /**
     * Show error in progress modal
     */
    showError(message) {
        const title = document.getElementById('updateStatusTitle');
        const msg = document.getElementById('updateStatusMessage');

        if (title) title.textContent = '❌ Update Failed';
        if (msg) msg.textContent = message;

        const spinner = document.getElementById('updateSpinner');
        if (spinner) {
            spinner.style.display = 'none';
        }

        // Add retry button
        const container = this.progressModal?.querySelector('div > div');
        if (container && !document.getElementById('updateRetryBtn')) {
            const retryBtn = document.createElement('button');
            retryBtn.id = 'updateRetryBtn';
            retryBtn.textContent = 'Retry Update';
            retryBtn.style.cssText = `
                background: var(--accent-cyan, #1db954);
                border: none;
                padding: 8px 20px;
                border-radius: 20px;
                font-weight: 700;
                font-size: 0.8rem;
                color: #000;
                cursor: pointer;
                margin-top: 12px;
            `;
            retryBtn.addEventListener('click', () => {
                document.getElementById('updateRetryBtn')?.remove();
                this.startUpdate();
            });
            container.appendChild(retryBtn);
        }

        this.isUpdating = false;
    }

    /**
     * Hide the progress modal
     */
    hideProgressModal() {
        if (this.progressModal) {
            this.progressModal.style.display = 'none';
        }
    }

    /**
     * Clean up intervals
     */
    destroy() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Initialize on DOM ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.updateUI = new UpdateUI();
        });
    } else {
        window.updateUI = new UpdateUI();
    }
}

// Export for module usage
if (typeof module !== 'undefined') {
    module.exports = UpdateUI;
}