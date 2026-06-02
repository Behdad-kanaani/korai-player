/**
 * Update tooltip text for AI panel buttons based on current language
 */
function updateAITooltips() {
    const aiRecommendBtn = document.getElementById('aiRecommendBtn');
    const createSimilarBtn = document.getElementById('createSimilarPlaylistBtn');
    const exportLibraryBtn = document.getElementById('exportLibraryBtn');
    const importCueBtn = document.getElementById('importCueBtn');
    
    // Set tooltip for Analyze button
    if (aiRecommendBtn) {
        aiRecommendBtn.setAttribute('data-tooltip', 
            currentLanguage === 'fa' ? 'آنالیز الگوی فرکانس' : 'Analyze Waveform');
    }
    
    // Set tooltip for Create Similar Playlist button
    if (createSimilarBtn) {
        createSimilarBtn.setAttribute('data-tooltip', 
            currentLanguage === 'fa' ? 'ساخت پلی‌لیست مشابه' : 'Create Similar Playlist');
    }
    
    // Set tooltip for Export Library button
    if (exportLibraryBtn) {
        exportLibraryBtn.setAttribute('data-tooltip', 
            currentLanguage === 'fa' ? 'خروجی کتابخانه' : 'Export Library');
    }
    
    // Set tooltip for Import CUE Sheet button
    if (importCueBtn) {
        importCueBtn.setAttribute('data-tooltip', 
            currentLanguage === 'fa' ? 'وارد کردن CUE Sheet' : 'Import CUE Sheet');
    }
}

/**
 * Convert AI panel to icon-only mode (hide text, show only icons)
 */
function setAIIconOnlyMode() {
    const aiPanel = document.querySelector('.ai-recommendation-panel');
    if (!aiPanel) return;
    
    // Hide header text
    const aiHeader = aiPanel.querySelector('.ai-header-small');
    if (aiHeader) {
        const span = aiHeader.querySelector('span');
        if (span) span.style.display = 'none';
    }
    
    // Hide description text
    const aiDesc = aiPanel.querySelector('.ai-desc');
    if (aiDesc) aiDesc.style.display = 'none';
    
    // Hide button text and center icons
    const btns = aiPanel.querySelectorAll('.ai-action-btn');
    btns.forEach(btn => {
        const span = btn.querySelector('span');
        if (span) span.style.display = 'none';
        btn.style.justifyContent = 'center';
        btn.style.gap = '0';
    });
}

/**
 * Initialize version status display in title bar
 * Shows current version or "Update Available" if newer version exists
 * Version is read from package.json via main process
 */
function initVersionStatus() {
    const versionEl = document.getElementById('versionStatus');
    if (!versionEl) return;
    
    // Set checking state initially
    versionEl.textContent = '---';
    versionEl.classList.add('checking');
    
    // Check if electronAPI is available
    if (!window.electronAPI) {
        console.warn('Electron API not available, cannot check version');
        versionEl.textContent = 'v?.?.?';
        versionEl.classList.remove('checking');
        return;
    }
    
    // Listen for initial app version from main process
    if (window.electronAPI.onAppVersion) {
        window.electronAPI.onAppVersion((data) => {
            if (data && data.version && data.version !== 'unknown') {
                versionEl.textContent = `v${data.version}`;
                versionEl.classList.remove('checking');
            } else if (data && data.version === 'unknown') {
                versionEl.textContent = 'v?.?.?';
                versionEl.classList.remove('checking');
            }
        });
    }
    
    // Listen for update status changes
    if (window.electronAPI.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((data) => {
            console.log('Update status received:', data);
            
            if (data.hasUpdate && data.latestVersion) {
                // Update available - show "Update vX.X.X" with click handler
                versionEl.textContent = `Update To v${data.latestVersion}`;
                versionEl.classList.add('update-available');
                versionEl.classList.remove('checking');
                versionEl.title = `Click to download KORAI Player ${data.latestVersion}`;
                
                // Make it clickable to open download URL
                versionEl.onclick = () => {
                    if (data.url && window.electronAPI.openExternalLink) {
                        window.electronAPI.openExternalLink(data.url);
                    }
                };
            } else if (!data.hasUpdate && data.currentVersion && data.currentVersion !== 'unknown') {
                // No update - show current version
                versionEl.textContent = `v${data.currentVersion}`;
                versionEl.classList.remove('update-available');
                versionEl.classList.remove('checking');
                versionEl.onclick = null;
                versionEl.title = '';
            } else if (data.error) {
                // Error case - show current version if available, otherwise fallback
                if (data.currentVersion && data.currentVersion !== 'unknown') {
                    versionEl.textContent = `v${data.currentVersion}`;
                } else {
                    versionEl.textContent = 'v?.?.?';
                }
                versionEl.classList.remove('update-available');
                versionEl.classList.remove('checking');
                versionEl.title = 'Could not check for updates';
            }
        });
    }
    
    // Optional: Manually trigger a check on demand (e.g., after some time)
    if (window.electronAPI.checkUpdateStatus) {
        // Also check manually as fallback (in case events were missed)
        setTimeout(() => {
            window.electronAPI.checkUpdateStatus().then(status => {
                if (status && status.hasUpdate && status.latestVersion) {
                    versionEl.textContent = `Update To v${status.latestVersion}`;
                    versionEl.classList.add('update-available');
                    versionEl.classList.remove('checking');
                    versionEl.title = `Click to download KORAI Player ${status.latestVersion}`;
                    versionEl.onclick = () => {
                        if (status.url && window.electronAPI.openExternalLink) {
                            window.electronAPI.openExternalLink(status.url);
                        }
                    };
                } else if (status && status.currentVersion && status.currentVersion !== 'unknown' && !status.hasUpdate) {
                    versionEl.textContent = `v${status.currentVersion}`;
                    versionEl.classList.remove('update-available');
                    versionEl.classList.remove('checking');
                }
            }).catch(err => {
                console.log('Manual update check failed:', err);
            });
        }, 3000);
    }
}