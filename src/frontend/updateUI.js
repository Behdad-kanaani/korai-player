/**
 * Update notifications and progress UI.
 */

class UpdateUI {
    constructor() {
        this.container = null;
        this.notification = null;
        this.progressModal = null;
        this.isUpdating = false;
        this.updateInfo = null;
        this.statusCheckInterval = null;
        this.init();
    }

    init() {
        this.createNotification();
        this.createProgressModal();
        this.setupEventListeners();
        this.checkForUpdates();
        this.startPeriodicCheck();
    }

    createNotification() {
        const existing = document.getElementById('updateNotification');
        if (existing) existing.remove();

        const notif = document.createElement('div');
        notif.id = 'updateNotification';
        notif.className = 'update-notification';
        notif.setAttribute('role', 'status');
        notif.setAttribute('aria-live', 'polite');
        notif.style.display = 'none';
        notif.innerHTML = `
            <div class="update-inner">
                <div class="update-icon-shell"><i id="updateStatusIconInner" class="fa-solid fa-cloud-arrow-up"></i></div>
                <div>
                    <div class="update-kicker">KORAI SOFTWARE</div>
                    <div class="update-title" id="updateNoticeTitle">Update available</div>
                    <div class="update-message" id="updateNoticeMessage">A newer version of KORAI is ready.</div>
                    <div class="update-actions">
                        <button class="update-now-btn" id="updateNowBtn" type="button"><i class="fa-solid fa-download"></i> Update now</button>
                        <button class="update-dismiss-btn" id="dismissUpdateBtn" type="button">Later</button>
                        <span id="updateSpinnerSmall" aria-hidden="true" style="display:none"><i class="fa-solid fa-spinner fa-spin"></i></span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(notif);
        this.notification = notif;

        notif.querySelector('#updateNowBtn')?.addEventListener('click', () => this.startUpdate());
        notif.querySelector('#dismissUpdateBtn')?.addEventListener('click', () => this.dismissNotification());
    }

    createProgressModal() {
        const existing = document.getElementById('updateProgressModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'updateProgressModal';
        modal.className = 'update-progress-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="update-progress-card">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
                    <div><span class="update-kicker">KORAI UPDATE</span><h3 style="margin-top:4px;color:#eef4f1;font-size:15px">Updating KORAI</h3></div>
                    <div id="updateProgressSpinner" style="width:32px;height:32px;display:grid;place-items:center;border-radius:10px;background:rgba(32,217,104,.09);color:#20d968"><i class="fa-solid fa-rotate fa-spin"></i></div>
                </div>
                <p id="updateProgressStatusMessage" style="margin-bottom:14px;color:#79858a;font-size:9px">Preparing files...</p>
                <div style="height:6px;border-radius:999px;background:#242c31;overflow:hidden"><div id="updateProgressFill" style="width:0%;height:100%;border-radius:999px;background:linear-gradient(90deg,#20d968,#67ef9a);transition:width .25s ease"></div></div>
                <div style="display:flex;justify-content:space-between;margin-top:8px;color:#626e74;font-size:8px;font-variant-numeric:tabular-nums"><span id="updateProgressPercent">0%</span><span id="updateFileCount">0 / 0 files</span></div>
            </div>
        `;
        document.body.appendChild(modal);
        this.progressModal = modal;
    }

    setupEventListeners() {
        if (window.electronAPI?.onUpdateProgress) window.electronAPI.onUpdateProgress(progress => this.updateProgress(progress));
        if (window.electronAPI?.onUpdateStatus) window.electronAPI.onUpdateStatus(info => this.handleUpdateStatus(info));
        window.addEventListener('update-progress', event => this.updateProgress(event.detail || {}));
    }

    handleUpdateStatus(updateInfo) {
        if (!updateInfo) return;
        if (updateInfo.autoUpdateDisabled) {
            this.dismissNotification();
            return;
        }
        if (updateInfo.checking) return;
        if (updateInfo.isDownloaded) {
            this.showUpdateReady(updateInfo);
            return;
        }
        if (updateInfo.autoDownload && updateInfo.hasUpdate) {
            this.showUpdateDownloading(updateInfo);
            return;
        }
        if (updateInfo.hasUpdate) this.showUpdateAvailable(updateInfo);
        else if (updateInfo.updated) this.showUpdateApplied(updateInfo);
        else if (updateInfo.error) this.showUpdateError(updateInfo.error);
        else this.showUpToDate(updateInfo);
    }

    setState(state, icon, title, message, buttons = true) {
        const notif = this.notification;
        if (!notif) return;
        notif.dataset.state = state;
        const iconEl = notif.querySelector('#updateStatusIconInner');
        const titleEl = notif.querySelector('#updateNoticeTitle');
        const messageEl = notif.querySelector('#updateNoticeMessage');
        const updateBtn = notif.querySelector('#updateNowBtn');
        const dismissBtn = notif.querySelector('#dismissUpdateBtn');
        const spinner = notif.querySelector('#updateSpinnerSmall');
        if (iconEl) iconEl.className = `fa-solid ${icon}`;
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.innerHTML = message;
        if (updateBtn) updateBtn.style.display = buttons ? 'inline-flex' : 'none';
        if (dismissBtn) dismissBtn.style.display = buttons ? 'inline-flex' : 'none';
        if (spinner) spinner.style.display = state === 'checking' ? 'inline-block' : 'none';
        notif.style.display = 'block';
    }

    showUpdateAvailable(info) {
        this.updateInfo = info;
        this.setState('available', 'fa-cloud-arrow-up', 'A newer KORAI is ready', `Version <strong>${String(info.latestVersion || 'latest')}</strong> is available.`, true);
        const button = this.notification?.querySelector('#updateNowBtn');
        if (button) {
            button.innerHTML = info.canUpdate === false ? '<i class="fa-solid fa-arrow-up-right-from-square"></i> Open release' : '<i class="fa-solid fa-download"></i> Update now';
            button.onclick = () => {
                if (info.canUpdate === false) this.openRelease();
                else this.startUpdate();
            };
        }
    }

    showUpdateDownloading(info) {
        this.updateInfo = info;
        this.isUpdating = true;
        this.setState('downloading', 'fa-download', 'Downloading update', `Downloading KORAI <strong>v${String(info.latestVersion || 'latest')}</strong>.`, false);
        this.showProgressModal();
    }

    showUpdateReady(info) {
        this.updateInfo = info;
        this.isUpdating = false;
        this.setState('ready', 'fa-circle-check', 'Update ready', `KORAI <strong>v${String(info.latestVersion || 'latest')}</strong> is downloaded. Restart to install it.`, true);
        const button = this.notification?.querySelector('#updateNowBtn');
        if (button) {
            button.innerHTML = '<i class="fa-solid fa-rotate"></i> Restart to install';
            button.onclick = () => window.electronAPI?.installUpdate?.();
        }
        const dismiss = this.notification?.querySelector('#dismissUpdateBtn');
        if (dismiss) dismiss.textContent = 'Later';
        if (this.progressModal) this.progressModal.style.display = 'none';
    }

    showUpToDate(info) {
        this.setState('ready', 'fa-check', 'You are up to date', `KORAI <strong>v${String(info?.currentVersion || 'latest')}</strong> is already current.`, false);
        window.clearTimeout(this._hideTimer);
        this._hideTimer = window.setTimeout(() => this.dismissNotification(), 3400);
    }

    showCheckingForUpdates() {
        this.setState('checking', 'fa-spinner fa-spin', 'Checking for updates', 'Looking for a newer release…', false);
    }

    showUpdateError(message) {
        this.setState('error', 'fa-triangle-exclamation', 'Could not check for updates', String(message || 'Please try again later.'), true);
        const button = this.notification?.querySelector('#updateNowBtn');
        if (button) {
            button.innerHTML = '<i class="fa-solid fa-rotate"></i> Retry';
            button.onclick = () => this.checkForUpdates(true);
        }
    }

    showUpdateApplied(info) {
        this.setState('ready', 'fa-check', 'Update prepared', `KORAI <strong>v${String(info?.latestVersion || 'latest')}</strong> is ready. Restarting…`, false);
        window.setTimeout(() => this.dismissNotification(), 3000);
    }

    async checkForUpdates(manual = false) {
        this.showCheckingForUpdates();
        try {
            if (!window.electronAPI?.checkUpdateStatus) throw new Error('Update API not available');
            const result = await window.electronAPI.checkUpdateStatus({ manual: Boolean(manual) });
            if (!result) throw new Error('No response from update service');
            if (result.autoUpdateDisabled) { this.dismissNotification(); return; }
            this.handleUpdateStatus(result);
        } catch (error) {
            console.warn('[UpdateUI] Failed to check updates:', error);
            this.showUpdateError(error.message);
        }
    }

    startPeriodicCheck() {
        clearInterval(this.statusCheckInterval);
        this.statusCheckInterval = setInterval(() => {
            if (!this.isUpdating) this.checkForUpdates();
        }, 30 * 60 * 1000);
    }

    showNotification(updateInfo) {
        this.handleUpdateStatus(updateInfo || {});
    }

    dismissNotification() {
        if (this.notification) this.notification.style.display = 'none';
    }

    openRelease() {
        if (this.updateInfo?.url && window.electronAPI?.openExternalLink) window.electronAPI.openExternalLink(this.updateInfo.url);
    }

    async startUpdate() {
        if (this.isUpdating || !this.updateInfo) return;
        if (this.updateInfo.isDownloaded) {
            window.electronAPI?.installUpdate?.();
            return;
        }
        if (this.updateInfo.autoDownload) {
            this.showUpdateDownloading(this.updateInfo);
            return;
        }
        if (this.updateInfo.canUpdate === false) {
            this.openRelease();
            return;
        }
        this.isUpdating = true;
        this.showProgressModal();
        try {
            if (!window.electronAPI?.applyUpdate) throw new Error('Update API not available');
            await window.electronAPI.applyUpdate(this.updateInfo);
        } catch (error) {
            console.error('[UpdateUI] Update failed:', error);
            this.showError(error.message);
        }
    }

    showProgressModal() {
        if (!this.progressModal) return;
        this.progressModal.style.display = 'flex';
        const fill = this.progressModal.querySelector('#updateProgressFill');
        const percent = this.progressModal.querySelector('#updateProgressPercent');
        const fileCount = this.progressModal.querySelector('#updateFileCount');
        const message = this.progressModal.querySelector('#updateProgressStatusMessage');
        if (fill) fill.style.width = '0%';
        if (percent) percent.textContent = '0%';
        if (fileCount) fileCount.textContent = '0 / 0 files';
        if (message) message.textContent = 'Starting update…';
        this.dismissNotification();
    }

    updateProgress(progress = {}) {
        const modal = this.progressModal;
        if (!modal) return;
        const value = Number.isFinite(Number(progress.progress)) ? Math.max(0, Math.min(100, Number(progress.progress))) : 0;
        const fill = modal.querySelector('#updateProgressFill');
        const percent = modal.querySelector('#updateProgressPercent');
        const fileCount = modal.querySelector('#updateFileCount');
        const message = modal.querySelector('#updateProgressStatusMessage');
        if (fill) fill.style.width = `${value}%`;
        if (percent) percent.textContent = `${Math.round(value)}%`;
        if (fileCount && progress.totalFiles !== undefined) fileCount.textContent = `${progress.fileIndex || 0} / ${progress.totalFiles || 0} files`;
        if (fileCount && progress.status === 'downloading' && progress.total) {
            const toMegabytes = bytes => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
            fileCount.textContent = `${toMegabytes(progress.transferred || 0)} / ${toMegabytes(progress.total)}`;
        }
        const labels = { starting: 'Initializing…', backup: 'Backing up current files…', downloading: 'Downloading update files…', applying: 'Applying changes…', cleaning: 'Cleaning up…', complete: 'Update complete. Restarting…', downloaded: 'Download complete. Restart to install.', error: 'Update failed.' };
        if (message && progress.status) message.textContent = labels[progress.status] || String(progress.message || progress.status);
        if (progress.status === 'complete') {
            this.isUpdating = false;
            window.setTimeout(() => { if (this.progressModal) this.progressModal.style.display = 'none'; }, 1200);
        }
        if (progress.status === 'downloaded') {
            if (this.progressModal) this.progressModal.style.display = 'none';
            if (this.updateInfo) this.showUpdateReady({ ...this.updateInfo, isDownloaded: true });
        }
        if (progress.status === 'error') this.showError(progress.message);
    }

    showError(message) {
        this.isUpdating = false;
        if (this.progressModal) this.progressModal.style.display = 'none';
        this.showUpdateError(message || 'Update failed');
    }
}

window.UpdateUI = UpdateUI;
if (typeof module !== 'undefined' && module.exports) module.exports = UpdateUI;
