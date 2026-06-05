// additional.js - KORAI Player Extended Functions (Fully Fixed)
// Includes: Settings Modal, Plugin Management, Persistent Settings, Vocal Extraction placeholders
// FIX: Plugin list now refreshes correctly after installation

// ======================== GLOBAL VARIABLES ========================
let settingsModal = null;
let currentSettings = {};

const defaultSettings = {
    gaplessEnabled: true,
    crossfadeDuration: 0,
    librarySortKey: 'createdAt',
    librarySortOrder: 'desc',
    libraryGenreFilter: 'all',
    theme: 'default',
    language: 'en',
    showWaveform: true,
    autoScanOnStartup: false,
    scanFolders: [],
    anonymousAnalytics: true,
    defaultVolume: 70
};

// Helper to wait for API port (improved: waits for window.apiPort to be set)
function waitForApiPort(timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (window.apiPort && typeof window.apiPort === 'number') {
            resolve(window.apiPort);
            return;
        }
        const start = Date.now();
        const interval = setInterval(() => {
            if (window.apiPort && typeof window.apiPort === 'number') {
                clearInterval(interval);
                resolve(window.apiPort);
            } else if (Date.now() - start > timeout) {
                clearInterval(interval);
                reject(new Error('API port not available after timeout'));
            }
        }, 100);
    });
}

// ======================== SETTINGS MANAGEMENT ========================
async function loadSettingsFromServer() {
    try {
        const port = await waitForApiPort();
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`);
        if (!res.ok) throw new Error('Failed to fetch settings');
        const serverSettings = await res.json();
        currentSettings = { ...defaultSettings, ...serverSettings };
        
        // IMPORTANT: Do NOT apply settings to global functions here.
        // Applying them (e.g., changeClientLanguage) would cause unwanted re-renders
        // such as reloading the home page when opening the settings modal.
        // The applied settings are already active from previous saves or initial app load.
        
        return currentSettings;
    } catch (err) {
        console.error('Failed to load settings:', err);
        currentSettings = { ...defaultSettings };
        return currentSettings;
    }
}

async function saveSettingsToServer(settings) {
    try {
        const port = await waitForApiPort();
        const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!res.ok) throw new Error('Save failed');
        
        // Apply changes to app state
        if (typeof window.setGaplessMode === 'function') window.setGaplessMode(settings.gaplessEnabled);
        if (typeof window.setCrossfadeMode === 'function') window.setCrossfadeMode(settings.crossfadeDuration);
        if (typeof window.changeClientLanguage === 'function') window.changeClientLanguage(settings.language);
        if (typeof window.applyGlobalSkin === 'function') window.applyGlobalSkin(settings.theme);
        if (typeof window.setLibrarySort === 'function') window.setLibrarySort(settings.librarySortKey, settings.librarySortOrder);
        if (typeof window.renderLibrary === 'function') window.renderLibrary();
        return true;
    } catch (err) {
        console.error('Save settings error:', err);
        return false;
    }
}

// ======================== SETTINGS MODAL UI ========================
function createSettingsModal() {
    if (document.getElementById('settingsModal')) return;
    
    const modalHtml = `
        <div id="settingsModal" class="settings-modal-overlay">
            <div class="settings-modal-container">
                <div class="settings-modal-header">
                    <h2><i class="fa-solid fa-gear"></i> <span data-translate="settingsTitle">Settings</span></h2>
                    <button class="settings-close-btn" id="settingsCloseBtn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="settings-modal-body">
                    <div class="settings-tabs">
                        <button class="settings-tab-btn active" data-tab="playback"><i class="fa-solid fa-headphones"></i> Playback</button>
                        <button class="settings-tab-btn" data-tab="library"><i class="fa-solid fa-music"></i> Library</button>
                        <button class="settings-tab-btn" data-tab="appearance"><i class="fa-solid fa-palette"></i> Appearance</button>
                        <button class="settings-tab-btn" data-tab="plugins"><i class="fa-solid fa-puzzle-piece"></i> Plugins</button>
                        <button class="settings-tab-btn" data-tab="about"><i class="fa-solid fa-circle-info"></i> About</button>
                    </div>
                    <div class="settings-content">
                        <div class="settings-tab-pane active-pane" id="tab-playback"></div>
                        <div class="settings-tab-pane" id="tab-library"></div>
                        <div class="settings-tab-pane" id="tab-appearance"></div>
                        <div class="settings-tab-pane" id="tab-plugins"></div>
                        <div class="settings-tab-pane" id="tab-about"></div>
                    </div>
                </div>
                <div class="settings-modal-footer">
                    <button class="settings-footer-btn cancel" id="settingsCancelBtn">Cancel</button>
                    <button class="settings-footer-btn save" id="settingsSaveBtn">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    settingsModal = document.getElementById('settingsModal');
    populateSettingsTabs();
    attachSettingsEvents();
}

function populateSettingsTabs() {
    // Playback tab
    document.getElementById('tab-playback').innerHTML = `
        <div class="settings-group">
            <div class="settings-group-title">Playback Engine</div>
            <div class="setting-row">
                <div class="setting-info"><div class="setting-label">Gapless Playback</div><div class="setting-desc">Seamless track transitions</div></div>
                <div class="setting-control"><label class="setting-toggle"><input type="checkbox" id="settingGapless"><span class="toggle-slider"></span></label></div>
            </div>
            <div class="setting-row">
                <div class="setting-info"><div class="setting-label">Crossfade Duration (seconds)</div></div>
                <div class="setting-control"><input type="range" id="settingCrossfade" class="setting-slider" min="0" max="12" step="0.5"><span id="crossfadeValue" class="setting-value">0s</span></div>
            </div>
            <div class="setting-row">
                <div class="setting-info"><div class="setting-label">Default Volume</div></div>
                <div class="setting-control"><input type="range" id="settingVolume" class="setting-slider" min="0" max="100" step="1"><span id="volumeValue" class="setting-value">70%</span></div>
            </div>
        </div>
    `;
    // Library tab
    document.getElementById('tab-library').innerHTML = `
        <div class="settings-group">
            <div class="settings-group-title">Sorting & Filters</div>
            <div class="setting-row">
                <div class="setting-info"><div class="setting-label">Sort By</div></div>
                <div class="setting-control"><select id="settingSortKey" class="setting-select"><option value="createdAt">Date Added</option><option value="title">Title</option><option value="artist">Artist</option><option value="bpm">BPM</option><option value="duration">Duration</option></select></div>
            </div>
            <div class="setting-row">
                <div class="setting-info"><div class="setting-label">Sort Order</div></div>
                <div class="setting-control"><select id="settingSortOrder" class="setting-select"><option value="desc">Descending</option><option value="asc">Ascending</option></select></div>
            </div>
        </div>
    `;
    // Appearance tab with fixed select styling
    document.getElementById('tab-appearance').innerHTML = `
        <div class="settings-group">
            <div class="settings-group-title">Theme & Language</div>
            <div class="setting-row">
                <div class="setting-info"><div class="setting-label">UI Theme</div></div>
                <div class="setting-control">
                    <select id="settingTheme" class="setting-select">
                        <option value="default">Default Dark</option>
                        <option value="liquid-glass">Liquid Glass</option>
                    </select>
                </div>
            </div>
            <div class="setting-row">
                <div class="setting-info"><div class="setting-label">Language</div></div>
                <div class="setting-control">
                    <select id="settingLanguage" class="setting-select">
                        <option value="en">English</option>
                        <option value="fa">فارسی</option>
                    </select>
                </div>
            </div>
        </div>
    `;
    // Plugins tab (will be populated dynamically)
    document.getElementById('tab-plugins').innerHTML = `<div id="pluginsListContainer" class="settings-group"><div class="settings-group-title">Installed Plugins</div><div id="pluginsList"></div></div>`;
    // About tab
    document.getElementById('tab-about').innerHTML = `
        <div style="text-align:center">
            <i class="fa-solid fa-compact-disc" style="font-size:4rem;color:var(--accent-cyan)"></i>
            <h2>KORAI Player</h2>
            <p>Version 1.3.0</p>
            <button id="githubLinkBtn" class="modal-btn confirm">GitHub Repository</button>
        </div>
    `;
}

function attachSettingsEvents() {
    if (!settingsModal) return;
    
    // Tab switching
    const tabBtns = settingsModal.querySelectorAll('.settings-tab-btn');
    const tabPanes = settingsModal.querySelectorAll('.settings-tab-pane');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabPanes.forEach(pane => pane.classList.remove('active-pane'));
            const activePane = document.getElementById(`tab-${tabId}`);
            if (activePane) activePane.classList.add('active-pane');
            
            // Refresh plugins list when switching to plugins tab
            if (tabId === 'plugins') {
                populatePluginsListUI();
            }
        });
    });
    
    // Close / Cancel buttons
    const closeBtn = settingsModal.querySelector('#settingsCloseBtn');
    const cancelBtn = settingsModal.querySelector('#settingsCancelBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeSettingsModal);
    settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettingsModal(); });
    
    // Save button
    const saveBtn = settingsModal.querySelector('#settingsSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveAllSettings);
    
    // Live value updates
    const crossfadeSlider = document.getElementById('settingCrossfade');
    if (crossfadeSlider) crossfadeSlider.addEventListener('input', (e) => {
        document.getElementById('crossfadeValue').innerText = parseFloat(e.target.value).toFixed(1) + 's';
    });
    const volumeSlider = document.getElementById('settingVolume');
    if (volumeSlider) volumeSlider.addEventListener('input', (e) => {
        document.getElementById('volumeValue').innerText = e.target.value + '%';
    });
    
    // GitHub link
    const githubBtn = document.getElementById('githubLinkBtn');
    if (githubBtn && window.electronAPI) {
        githubBtn.addEventListener('click', () => window.electronAPI.openExternalLink('https://github.com/Behdad-kanaani/korai-player'));
    }
}

function loadSettingsIntoUI(settings) {
    const gapless = document.getElementById('settingGapless');
    if (gapless) gapless.checked = settings.gaplessEnabled;
    const crossfade = document.getElementById('settingCrossfade');
    if (crossfade) crossfade.value = settings.crossfadeDuration;
    const volume = document.getElementById('settingVolume');
    if (volume) volume.value = settings.defaultVolume || 70;
    const sortKey = document.getElementById('settingSortKey');
    if (sortKey) sortKey.value = settings.librarySortKey || 'createdAt';
    const sortOrder = document.getElementById('settingSortOrder');
    if (sortOrder) sortOrder.value = settings.librarySortOrder || 'desc';
    const theme = document.getElementById('settingTheme');
    if (theme) theme.value = settings.theme || 'default';
    const language = document.getElementById('settingLanguage');
    if (language) language.value = settings.language || 'en';
    
    // Update displayed values
    if (crossfade && document.getElementById('crossfadeValue')) {
        document.getElementById('crossfadeValue').innerText = parseFloat(settings.crossfadeDuration).toFixed(1) + 's';
    }
    if (volume && document.getElementById('volumeValue')) {
        document.getElementById('volumeValue').innerText = (settings.defaultVolume || 70) + '%';
    }
}

function collectSettingsFromUI() {
    return {
        gaplessEnabled: document.getElementById('settingGapless')?.checked ?? true,
        crossfadeDuration: parseFloat(document.getElementById('settingCrossfade')?.value ?? 0),
        defaultVolume: parseInt(document.getElementById('settingVolume')?.value ?? 70),
        librarySortKey: document.getElementById('settingSortKey')?.value ?? 'createdAt',
        librarySortOrder: document.getElementById('settingSortOrder')?.value ?? 'desc',
        theme: document.getElementById('settingTheme')?.value ?? 'default',
        language: document.getElementById('settingLanguage')?.value ?? 'en',
        libraryGenreFilter: currentSettings.libraryGenreFilter || 'all',
        showWaveform: true,
        autoScanOnStartup: false,
        anonymousAnalytics: true
    };
}

async function saveAllSettings() {
    const newSettings = collectSettingsFromUI();
    const success = await saveSettingsToServer(newSettings);
    if (success) {
        currentSettings = newSettings;
        showNotification('Settings saved successfully', 'success');
        closeSettingsModal();
        if (typeof window.renderLibrary === 'function') window.renderLibrary();
    } else {
        showNotification('Failed to save settings', 'error');
    }
}

// ======================== OPEN / CLOSE MODAL ========================
async function openSettingsModal() {
    if (!settingsModal) createSettingsModal();
    if (!settingsModal) {
        console.error('Failed to create settings modal');
        return;
    }
    
    settingsModal.classList.add('open');
    
    try {
        const settings = await loadSettingsFromServer();
        loadSettingsIntoUI(settings);
        
        // Check which tab is active and load content accordingly
        const activeTab = settingsModal.querySelector('.settings-tab-btn.active');
        if (activeTab && activeTab.dataset.tab === 'plugins') {
            await populatePluginsListUI();
        }
    } catch (err) {
        console.error('Error loading settings into modal:', err);
        loadSettingsIntoUI(defaultSettings);
    }
}

function closeSettingsModal() {
    if (settingsModal) settingsModal.classList.remove('open');
}

// ======================== PLUGINS UI (with install from ZIP) ========================
async function populatePluginsListUI() {
    const container = document.getElementById('pluginsList');
    if (!container) return;
    
    // Show a loading indicator
    container.innerHTML = `<div class="setting-row"><span>Loading plugins...</span></div>`;
    
    try {
        const port = await waitForApiPort();
        const res = await fetch(`http://127.0.0.1:${port}/api/plugins`);
        const plugins = await res.json();
        
        // Build install button bar with refresh button
        let html = `
            <div class="plugin-install-bar" style="margin-bottom: 20px; text-align: center; display: flex; gap: 10px; justify-content: center;">
                <button id="installPluginBtn" class="modal-btn confirm" style="background: var(--accent-cyan); color: #000;">
                    <i class="fa-solid fa-download"></i> Install Plugin (.zip)
                </button>
                <button id="refreshPluginsBtn" class="modal-btn" style="background: var(--spotify-grey);">
                    <i class="fa-solid fa-rotate-right"></i> Refresh
                </button>
            </div>
        `;
        
        if (!plugins.length) {
            html += `<div class="setting-row"><span style="color:var(--spotify-text-muted)">No plugins installed. Click the button above to install a plugin from a .zip file.</span></div>`;
            container.innerHTML = html;
            attachInstallButtonListener();
            attachRefreshButtonListener();
            return;
        }
        
        for (const p of plugins) {
            const iconUrl = p.iconPath ? `http://127.0.0.1:${port}${p.iconPath}` : null;
            html += `
                <div class="plugin-card" data-plugin-id="${p.id}">
                    <div class="plugin-icon">
                        ${iconUrl ? `<img src="${iconUrl}" alt="${p.name}">` : '<i class="fa-solid fa-puzzle-piece"></i>'}
                    </div>
                    <div class="plugin-info">
                        <div class="plugin-name">${escapeHtml(p.name)} <span class="plugin-version">v${p.version}</span></div>
                        <div class="plugin-desc">${escapeHtml(p.description || 'No description')}</div>
                        ${p.author ? `<div class="plugin-author" style="font-size:0.65rem; color:var(--spotify-text-muted);">by ${escapeHtml(p.author)}</div>` : ''}
                    </div>
                    <div class="plugin-actions">
                        <button class="plugin-toggle ${p.enabled ? 'active' : ''}" data-enabled="${p.enabled}" data-id="${p.id}">${p.enabled ? 'Disable' : 'Enable'}</button>
                        <button class="plugin-delete" data-id="${p.id}"><i class="fa-solid fa-trash"></i> Remove</button>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
        
        attachPluginActionListeners();
        attachInstallButtonListener();
        attachRefreshButtonListener();
        
    } catch (err) {
        console.error('Plugins load error:', err);
        container.innerHTML = `<div class="setting-row"><span class="error">Could not load plugins. Make sure the server is running.</span></div>`;
    }
}

function attachPluginActionListeners() {
    const container = document.getElementById('pluginsList');
    if (!container) return;
    
    // Toggle enable/disable
    container.querySelectorAll('.plugin-toggle').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pluginId = btn.dataset.id;
            const currentlyEnabled = btn.dataset.enabled === 'true';
            const newEnabled = !currentlyEnabled;
            try {
                const port = await waitForApiPort();
                const res = await fetch(`http://127.0.0.1:${port}/api/plugins/${pluginId}/enable`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: newEnabled })
                });
                if (res.ok) {
                    showNotification(`Plugin ${newEnabled ? 'enabled' : 'disabled'}`, 'success');
                    await populatePluginsListUI(); // refresh
                } else {
                    showNotification('Failed to change plugin state', 'error');
                }
            } catch (err) {
                showNotification('Error changing plugin state', 'error');
            }
        });
    });
    
    // Delete plugin
    container.querySelectorAll('.plugin-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pluginId = btn.dataset.id;
            if (confirm('Are you sure you want to uninstall this plugin? The folder will be deleted.')) {
                try {
                    const port = await waitForApiPort();
                    const res = await fetch(`http://127.0.0.1:${port}/api/plugins/${pluginId}`, { method: 'DELETE' });
                    if (res.ok) {
                        showNotification('Plugin uninstalled', 'success');
                        await populatePluginsListUI();
                    } else {
                        showNotification('Uninstall failed', 'error');
                    }
                } catch (err) {
                    showNotification('Error uninstalling plugin', 'error');
                }
            }
        });
    });
}

// Refresh button listener - reloads plugins from server
function attachRefreshButtonListener() {
    const refreshBtn = document.getElementById('refreshPluginsBtn');
    if (!refreshBtn) return;
    
    // Remove existing listener to avoid duplicates
    const newRefreshBtn = refreshBtn.cloneNode(true);
    refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
    
    newRefreshBtn.addEventListener('click', async () => {
        showNotification('Refreshing plugins...', 'info');
        try {
            // Optional: Call reload endpoint if available
            const port = await waitForApiPort();
            try {
                await fetch(`http://127.0.0.1:${port}/api/plugins/reload`, { method: 'POST' });
            } catch (reloadErr) {
                // If reload endpoint doesn't exist, just refresh the UI
                console.log('Reload endpoint not available, using cached data');
            }
            await populatePluginsListUI();
            showNotification('Plugins refreshed', 'success');
        } catch (err) {
            console.error('Refresh error:', err);
            showNotification('Failed to refresh plugins', 'error');
        }
    });
}

function attachInstallButtonListener() {
    const installBtn = document.getElementById('installPluginBtn');
    if (!installBtn) return;
    
    // Remove existing listener to avoid duplicates
    const newInstallBtn = installBtn.cloneNode(true);
    installBtn.parentNode.replaceChild(newInstallBtn, installBtn);
    
    newInstallBtn.addEventListener('click', async () => {
        // Create hidden file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            showNotification('Installing plugin...', 'info');
            const formData = new FormData();
            formData.append('plugin', file);
            
            try {
                const port = await waitForApiPort();
                const res = await fetch(`http://127.0.0.1:${port}/api/plugins/install`, {
                    method: 'POST',
                    body: formData
                });
                
                if (res.ok) {
                    const data = await res.json();
                    showNotification(`Plugin installed successfully: ${data.pluginName || file.name}`, 'success');
                    
                    // CRITICAL FIX: Refresh the plugins list after successful installation
                    await populatePluginsListUI();
                    
                    // Also refresh UI injections if any
                    if (typeof window.loadPluginUIInjections === 'function') {
                        await window.loadPluginUIInjections();
                    }
                } else {
                    const err = await res.json();
                    showNotification(`Installation failed: ${err.error || 'Unknown error'}`, 'error');
                }
            } catch (err) {
                console.error('Plugin install error:', err);
                showNotification('Error installing plugin', 'error');
            }
        };
        input.click();
    });
}

// ======================== UTILITIES ========================
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function showNotification(message, type = 'info') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    const notif = document.createElement('div');
    notif.className = `notification notif-${type}`;
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-triangle-exclamation';
    notif.innerHTML = `<i class="fas ${icon}"></i><div class="notif-content"><p style="margin: 0; font-size: 0.8rem;">${message}</p></div>`;
    document.body.appendChild(notif);
    setTimeout(() => notif.classList.add('show'), 50);
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 400);
    }, 3000);
}

// ======================== VOCAL EXTRACTION STUBS ========================
window.showSongInfo = window.showSongInfo || function() { showNotification('Song info not yet available', 'info'); };
window.extractVocalFromCurrentTrack = window.extractVocalFromCurrentTrack || function() { showNotification('Vocal extraction not ready', 'info'); };
window.closeSongInfoModal = window.closeSongInfoModal || function() {};

// ======================== INITIALIZATION ========================
function attachSettingsButtonHandler() {
    const settingsBtn = document.getElementById('settingsBtn');
    if (!settingsBtn) return;
    const newBtn = settingsBtn.cloneNode(true);
    settingsBtn.parentNode.replaceChild(newBtn, settingsBtn);
    newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openSettingsModal();
    });
}

// Inject additional CSS for .setting-select and plugin cards if not already present
function injectSettingSelectStyles() {
    if (document.getElementById('setting-select-styles')) return;
    const style = document.createElement('style');
    style.id = 'setting-select-styles';
    style.textContent = `
        .setting-select {
            background-color: var(--spotify-grey);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 8px 12px;
            color: var(--spotify-text-active);
            font-size: 0.8rem;
            cursor: pointer;
            outline: none;
            transition: var(--transition-smooth);
        }
        .setting-select option {
            background-color: var(--spotify-dark);
            color: var(--spotify-text-active);
        }
        .setting-select:hover {
            border-color: var(--accent-cyan);
        }
        .plugin-install-bar {
            margin-bottom: 20px;
            text-align: center;
        }
        .plugin-card {
            background: var(--spotify-grey);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: 16px;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 16px;
            transition: all 0.2s;
        }
        .plugin-card:hover {
            background: var(--spotify-light-grey);
            border-color: var(--accent-cyan);
        }
        .plugin-icon {
            width: 48px;
            height: 48px;
            border-radius: var(--radius-md);
            background: var(--bg-black);
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            flex-shrink: 0;
        }
        .plugin-icon img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .plugin-icon i {
            font-size: 1.6rem;
            color: var(--accent-cyan);
        }
        .plugin-info {
            flex: 1;
        }
        .plugin-name {
            font-weight: 700;
            font-size: 0.9rem;
        }
        .plugin-version {
            font-size: 0.65rem;
            color: var(--accent-cyan);
            margin-left: 8px;
        }
        .plugin-desc {
            font-size: 0.7rem;
            color: var(--spotify-text-muted);
            margin-top: 4px;
        }
        .plugin-actions {
            display: flex;
            gap: 8px;
        }
        .plugin-toggle {
            background: var(--spotify-light-grey);
            border: 1px solid var(--border-color);
            border-radius: 30px;
            padding: 6px 12px;
            font-size: 0.7rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .plugin-toggle.active {
            background: var(--accent-cyan);
            color: #000;
        }
        .plugin-toggle.disabled {
            opacity: 0.5;
        }
        .plugin-delete {
            background: rgba(244,63,94,0.15);
            border: 1px solid var(--accent-pink);
            border-radius: 30px;
            padding: 6px 12px;
            font-size: 0.7rem;
            cursor: pointer;
            color: var(--accent-pink);
        }
        .plugin-delete:hover {
            background: var(--accent-pink);
            color: #000;
        }
    `;
    document.head.appendChild(style);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    injectSettingSelectStyles();
    attachSettingsButtonHandler();
    createSettingsModal(); // pre-create modal but hidden
    if (settingsModal) settingsModal.classList.remove('open');
});

// Export global functions
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.openUnifiedSettings = openSettingsModal;
window.closeUnifiedSettings = closeSettingsModal;
window.populatePluginsListUI = populatePluginsListUI; // Export for external refresh