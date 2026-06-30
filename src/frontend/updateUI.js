/**
 * updateUI.js - Update Notification UI
 * 
 * Displays update notification with progress bar
 * Handles user interaction for update initiation
 */

class UpdateUI {
    constructor() {
        this.container = null;
        this.notification = null;
        this.progressModal = null;
        this.isUpdating = false;
        this.updateInfo = null;
        this.progressCallback = null;

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
    }

    /**
     * Create the update notification element
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
            border: 1px solid var(--accent-cyan, #1db954);
            border-radius: 12px;
            padding: 16px 20px;
            min-width: 300px;
            max-width: 420px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.5);
            display: none;
            backdrop-filter: blur(12px);
            animation: slideInRight 0.4s ease;
        `;

        notif.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <div style="flex-shrink: 0; width: 36px; height: 36px; background: rgba(0,255,213,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-cloud-arrow-up" style="color: var(--accent-cyan);"></i>
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 700; font-size: 0.9rem; color: var(--spotify-text-active, #fff);">
                        Update Available
                    </div>
                    <div id="updateMessage" style="font-size: 0.75rem; color: var(--spotify-text-muted, #9ba0a8); margin-top: 4px;">
                        Version <span id="updateVersion">1.4.5</span> is ready
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 12px;">
                        <button id="updateNowBtn" class="update-now-btn" style="
                            background: var(--accent-cyan, #1db954);
                            border: none;
                            padding: 6px 18px;
                            border-radius: 20px;
                            font-weight: 700;
                            font-size: 0.75rem;
                            color: #000;
                            cursor: pointer;
                            transition: all 0.2s ease;
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
                        ">
                            Dismiss
                        </button>
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

        // Add keyframe animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            @keyframes slideInRight {
                from { transform: translateX(120%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);

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
                if (updateInfo.hasUpdate) {
                    this.showNotification(updateInfo);
                }
            });
        }

        // Custom event listener for progress from updater
        window.addEventListener('update-progress', (event) => {
            this.updateProgress(event.detail);
        });
    }

    /**
     * Check for updates on load
     */
    async checkForUpdates() {
        try {
            if (window.electronAPI && window.electronAPI.checkUpdateStatus) {
                const result = await window.electronAPI.checkUpdateStatus();
                if (result && result.hasUpdate) {
                    this.showNotification(result);
                }
            }
        } catch (err) {
            console.warn('[UpdateUI] Failed to check updates:', err);
        }
    }

    /**
     * Show the update notification
     */
    showNotification(updateInfo) {
        if (!this.notification) return;

        this.updateInfo = updateInfo;

        // Update version text
        const versionEl = document.getElementById('updateVersion');
        if (versionEl && updateInfo.latestVersion) {
            versionEl.textContent = updateInfo.latestVersion;
        }

        // Update file count
        const messageEl = document.getElementById('updateMessage');
        if (messageEl && updateInfo.totalFiles) {
            const filesText = updateInfo.totalFiles === 1 ? 'file' : 'files';
            messageEl.innerHTML = `
                Version <span id="updateVersion">${updateInfo.latestVersion || 'latest'}</span> is ready
                <span style="display: block; font-size: 0.65rem; opacity: 0.7; margin-top: 2px;">
                    ${updateInfo.totalFiles} ${filesText} to update
                </span>
            `;
        }

        this.notification.style.display = 'block';
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

        // Hide spinner when complete
        const spinner = document.getElementById('updateSpinner');
        if (spinner) {
            spinner.style.display = 'block';
        }
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
            const current = progress.currentFile ? 1 : 0;
            const total = progress.totalFiles || 0;
            fileCount.textContent = `${current} / ${total} files`;
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
            // Auto-close after a moment
            setTimeout(() => {
                this.hideProgressModal();
                // Restart the app
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