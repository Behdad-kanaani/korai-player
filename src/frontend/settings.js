/**
 * settings.js - KORAI Settings Page Logic
 */

// ============================================================
// TRANSLATION HELPER
// ============================================================

function t(key) {
    try {
        if (typeof window !== 'undefined' && window.translations) {
            const lang = localStorage.getItem('user_lang') || 'en';
            if (window.translations[lang] && window.translations[lang][key]) {
                return window.translations[lang][key];
            }
            if (window.translations.en && window.translations.en[key]) {
                return window.translations.en[key];
            }
        }
    } catch (e) {
        console.warn('Translation error:', e);
    }
    return key;
}

function translatePage() {
    console.debug('Translating settings page...');
    
    if (!window.translations) {
        console.warn('window.translations not found! Make sure lang.js is loaded.');
        return;
    }
    
    const lang = localStorage.getItem('user_lang') || 'en';
    console.debug(`Current language: ${lang}`);
    
    // Translate elements with data-translate
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        const translated = t(key);
        if (translated && translated !== key) {
            // Preserve icons
            const icon = el.querySelector('i');
            if (icon && el.childNodes.length === 1) {
                el.innerHTML = '';
                el.appendChild(icon);
                el.appendChild(document.createTextNode(' ' + translated));
            } else if (el.childNodes.length === 0 || el.childNodes[0].nodeType === Node.TEXT_NODE) {
                el.textContent = translated;
            }
        }
    });

    // Translate placeholders
    document.querySelectorAll('[data-translate-placeholder]').forEach(el => {
        const key = el.getAttribute('data-translate-placeholder');
        el.placeholder = t(key);
    });

    // Translate titles
    document.querySelectorAll('[data-translate-title]').forEach(el => {
        const key = el.getAttribute('data-translate-title');
        el.title = t(key);
    });
    
    console.debug('Translation complete');
}

// ============================================================
// STATE
// ============================================================
let apiPort = null;
let settingsData = {};
let currentSection = 'playback';
let isInitialized = false;

// ============================================================
// API HELPERS
// ============================================================

async function resolveApiPort() {
    if (window.electronAPI && typeof window.electronAPI.getServerPort === 'function') {
        try {
            const port = await window.electronAPI.getServerPort();
            if (port) return port;
        } catch (e) {}
    }
    for (const p of [3000, 3001, 3002, 3003, 3004]) {
        try {
            const res = await fetch(`http://127.0.0.1:${p}/api/health`);
            if (res.ok) return p;
        } catch (e) {}
    }
    return 3000;
}

async function apiFetch(path, opts = {}) {
    const url = `http://127.0.0.1:${apiPort}${path.startsWith('/') ? path : '/' + path}`;
    return fetch(url, opts);
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) {
        const newContainer = document.createElement('div');
        newContainer.id = 'toastContainer';
        newContainer.className = 'toast-container';
        document.body.appendChild(newContainer);
        return showToast(message, type);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 3000);
}

// ============================================================
// SETTINGS LOAD / SAVE
// ============================================================

function getDefaultSettings() {
    return {
        gaplessEnabled: true,
        crossfadeDuration: 0,
        repeatMode: 'off',
        shuffleDefault: false,
        resumeOnStart: false,
        defaultVolume: 70,
        audioOutput: 'stereo',
        eq: [0, 0, 0, 0, 0],
        theme: 'default',
        direction: 'ltr',
        fontSize: 'medium',
        showAlbumArt: true,
        scanPath: '',
        formats: ['mp3', 'wav', 'flac', 'ogg', 'm4a'],
        autoScan: false,
        maxScanDepth: 100,
        autoActivatePlugins: true,
        hotReload: false,
        hookTimeout: 5000,
        pluginMemory: 64,
        aiRecommendations: true,
        discoveryMode: true,
        weightLike: 0.40,
        weightPlay: 0.12,
        weightSkip: 0.30,
        weightRepeat: 0.25,
        weightPlaylistAdd: 0.15,
        diversityBoost: 0.85,
        stayInTray: true,
        trayNotification: true,
        autoUpdate: true,
        updateInterval: 24,
        performanceMode: false,
        debugLogs: false,
        isFirstLaunch: true
    };
}

async function loadSettings() {
    try {
        if (window.settingsStore && window.settingsStore.initialized) {
            settingsData = window.settingsStore.getAll();
            applySettingsToUI(settingsData);
            showToast(t('settingsLoaded'), 'success');
            return;
        }

        const res = await apiFetch('/api/settings');
        if (!res.ok) throw new Error('Failed to load settings');
        settingsData = await res.json();
        applySettingsToUI(settingsData);
        showToast(t('settingsLoaded'), 'success');
    } catch (err) {
        console.error('Load settings error:', err);
        settingsData = getDefaultSettings();
        applySettingsToUI(settingsData);
        showToast(t('settingsDefaultLoading'), 'info');
    }
}

async function saveSettings() {
    try {
        const updates = {
            gaplessEnabled: document.getElementById('gaplessToggle')?.checked ?? true,
            crossfadeDuration: parseFloat(document.getElementById('crossfadeSlider')?.value ?? 0),
            repeatMode: document.getElementById('repeatModeSelect')?.value ?? 'off',
            shuffleDefault: document.getElementById('shuffleDefaultToggle')?.checked ?? false,
            resumeOnStart: document.getElementById('resumeOnStartToggle')?.checked ?? false,
            defaultVolume: parseInt(document.getElementById('defaultVolumeSlider')?.value ?? 70),
            audioOutput: document.getElementById('audioOutputSelect')?.value ?? 'stereo',
            theme: document.querySelector('.theme-btn.active')?.dataset.theme ?? 'default',
            direction: document.getElementById('directionSelect')?.value ?? 'ltr',
            fontSize: document.getElementById('fontSizeSelect')?.value ?? 'medium',
            showAlbumArt: document.getElementById('showAlbumArtToggle')?.checked ?? true,
            scanPath: settingsData.scanPath || '',
            formats: Array.from(document.querySelectorAll('.format-tag.active')).map(el => el.dataset.format),
            autoScan: document.getElementById('autoScanToggle')?.checked ?? false,
            maxScanDepth: parseInt(document.getElementById('maxScanDepthSlider')?.value ?? 100),
            autoActivatePlugins: document.getElementById('autoActivatePluginsToggle')?.checked ?? true,
            hotReload: document.getElementById('hotReloadToggle')?.checked ?? false,
            hookTimeout: parseInt(document.getElementById('hookTimeoutSlider')?.value ?? 5000),
            pluginMemory: parseInt(document.getElementById('pluginMemorySlider')?.value ?? 64),
            aiRecommendations: document.getElementById('aiRecommendationsToggle')?.checked ?? true,
            discoveryMode: document.getElementById('discoveryModeToggle')?.checked ?? true,
            weightLike: parseFloat(document.getElementById('weightLike')?.value ?? 0.40),
            weightPlay: parseFloat(document.getElementById('weightPlay')?.value ?? 0.12),
            weightSkip: parseFloat(document.getElementById('weightSkip')?.value ?? 0.30),
            weightRepeat: parseFloat(document.getElementById('weightRepeat')?.value ?? 0.25),
            weightPlaylistAdd: parseFloat(document.getElementById('weightPlaylistAdd')?.value ?? 0.15),
            diversityBoost: parseFloat(document.getElementById('diversityBoostSlider')?.value ?? 0.85),
            stayInTray: document.getElementById('stayInTrayToggle')?.checked ?? true,
            trayNotification: document.getElementById('trayNotificationToggle')?.checked ?? true,
            autoUpdate: document.getElementById('autoUpdateToggle')?.checked ?? true,
            updateInterval: parseInt(document.getElementById('updateIntervalSelect')?.value ?? 24),
            performanceMode: document.getElementById('performanceModeToggle')?.checked ?? false,
            debugLogs: document.getElementById('debugLogsToggle')?.checked ?? false,
            eq: [
                parseInt(document.getElementById('eqSlider0')?.value ?? 0),
                parseInt(document.getElementById('eqSlider1')?.value ?? 0),
                parseInt(document.getElementById('eqSlider2')?.value ?? 0),
                parseInt(document.getElementById('eqSlider3')?.value ?? 0),
                parseInt(document.getElementById('eqSlider4')?.value ?? 0)
            ]
        };

        if (window.settingsStore && window.settingsStore.initialized) {
            window.settingsStore.setMultiple(updates);
            await window.settingsStore.save();
        } else {
            const res = await apiFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) throw new Error('Failed to save settings');
            settingsData = updates;
        }

        showToast(t('settingsToastSuccess'), 'success');
        applySettingsToUI(updates);
        applyTheme(updates.theme);
        applyDirection(updates.direction);

        if (window.electronAPI && window.electronAPI.trayLanguageChanged) {
            const lang = updates.direction === 'rtl' ? 'fa' : 'en';
            window.electronAPI.trayLanguageChanged(lang);
        }

        if (updates.performanceMode) {
            document.body.classList.add('performance-mode');
        } else {
            document.body.classList.remove('performance-mode');
        }

        if (updates.debugLogs) {
            localStorage.setItem('korai_debug', 'true');
        } else {
            localStorage.removeItem('korai_debug');
        }

        syncEQToDSP(updates.eq);
        syncPlaybackSettings(updates);
        updateSaveStatus(t('settingsSaveStatus'), 'success');

    } catch (err) {
        console.error('Save settings error:', err);
        showToast(t('settingsToastError') + err.message, 'error');
        updateSaveStatus(t('settingsSaveFailed') + ': ' + err.message, 'error');
    }
}

function updateSaveStatus(message, type = 'info') {
    const statusEl = document.getElementById('saveStatus');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = 'save-status ' + type;
        setTimeout(() => {
            statusEl.className = 'save-status';
            statusEl.textContent = '';
        }, 3000);
    }
}

// ============================================================
// APPLY SETTINGS TO UI
// ============================================================

function applySettingsToUI(s) {
    if (!s) return;

    setCheckbox('gaplessToggle', s.gaplessEnabled);
    setSlider('crossfadeSlider', s.crossfadeDuration || 0);
    const crossfadeLabel = document.getElementById('crossfadeValueLabel');
    if (crossfadeLabel) crossfadeLabel.textContent = (s.crossfadeDuration || 0) + ' seconds';
    
    const repeatSelect = document.getElementById('repeatModeSelect');
    if (repeatSelect) repeatSelect.value = s.repeatMode || 'off';
    
    setCheckbox('shuffleDefaultToggle', s.shuffleDefault);
    setCheckbox('resumeOnStartToggle', s.resumeOnStart);

    setSlider('defaultVolumeSlider', s.defaultVolume || 70);
    const volumeLabel = document.getElementById('defaultVolumeLabel');
    if (volumeLabel) volumeLabel.textContent = (s.defaultVolume || 70) + '%';
    
    const audioOutput = document.getElementById('audioOutputSelect');
    if (audioOutput) audioOutput.value = s.audioOutput || 'stereo';

    const eq = s.eq || [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) {
        const slider = document.getElementById(`eqSlider${i}`);
        const valEl = document.getElementById(`eqVal${i}`);
        if (slider) {
            slider.value = eq[i] || 0;
            if (valEl) valEl.textContent = (eq[i] || 0) + 'dB';
        }
    }

    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === (s.theme || 'default'));
    });
    
    const directionSelect = document.getElementById('directionSelect');
    if (directionSelect) directionSelect.value = s.direction || 'ltr';
    
    const fontSizeSelect = document.getElementById('fontSizeSelect');
    if (fontSizeSelect) fontSizeSelect.value = s.fontSize || 'medium';
    
    setCheckbox('showAlbumArtToggle', s.showAlbumArt !== false);

    const scanPathDisplay = document.getElementById('defaultScanPathDisplay');
    if (scanPathDisplay) scanPathDisplay.textContent = s.scanPath || t('libraryScanPathNotSet');
    
    document.querySelectorAll('.format-tag').forEach(tag => {
        const fmt = tag.dataset.format;
        tag.classList.toggle('active', (s.formats || []).includes(fmt));
    });
    
    setCheckbox('autoScanToggle', s.autoScan);
    setSlider('maxScanDepthSlider', s.maxScanDepth || 100);
    const maxDepthLabel = document.getElementById('maxScanDepthLabel');
    if (maxDepthLabel) maxDepthLabel.textContent = s.maxScanDepth || 100;

    setCheckbox('autoActivatePluginsToggle', s.autoActivatePlugins !== false);
    setCheckbox('hotReloadToggle', s.hotReload);
    setSlider('hookTimeoutSlider', s.hookTimeout || 5000);
    const hookTimeoutLabel = document.getElementById('hookTimeoutLabel');
    if (hookTimeoutLabel) hookTimeoutLabel.textContent = (s.hookTimeout || 5000) + ' ms';
    
    setSlider('pluginMemorySlider', s.pluginMemory || 64);
    const pluginMemoryLabel = document.getElementById('pluginMemoryLabel');
    if (pluginMemoryLabel) pluginMemoryLabel.textContent = (s.pluginMemory || 64) + ' MB';

    setCheckbox('aiRecommendationsToggle', s.aiRecommendations !== false);
    setCheckbox('discoveryModeToggle', s.discoveryMode !== false);
    setSlider('weightLike', s.weightLike || 0.40);
    const weightLikeVal = document.getElementById('weightLikeVal');
    if (weightLikeVal) weightLikeVal.textContent = (s.weightLike || 0.40).toFixed(2);
    
    setSlider('weightPlay', s.weightPlay || 0.12);
    const weightPlayVal = document.getElementById('weightPlayVal');
    if (weightPlayVal) weightPlayVal.textContent = (s.weightPlay || 0.12).toFixed(2);
    
    setSlider('weightSkip', s.weightSkip || 0.30);
    const weightSkipVal = document.getElementById('weightSkipVal');
    if (weightSkipVal) weightSkipVal.textContent = (s.weightSkip || 0.30).toFixed(2);
    
    setSlider('weightRepeat', s.weightRepeat || 0.25);
    const weightRepeatVal = document.getElementById('weightRepeatVal');
    if (weightRepeatVal) weightRepeatVal.textContent = (s.weightRepeat || 0.25).toFixed(2);
    
    setSlider('weightPlaylistAdd', s.weightPlaylistAdd || 0.15);
    const weightPlaylistAddVal = document.getElementById('weightPlaylistAddVal');
    if (weightPlaylistAddVal) weightPlaylistAddVal.textContent = (s.weightPlaylistAdd || 0.15).toFixed(2);
    
    setSlider('diversityBoostSlider', s.diversityBoost || 0.85);
    const diversityLabel = document.getElementById('diversityBoostLabel');
    if (diversityLabel) diversityLabel.textContent = (s.diversityBoost || 0.85).toFixed(2);

    setCheckbox('stayInTrayToggle', s.stayInTray !== false);
    setCheckbox('trayNotificationToggle', s.trayNotification !== false);
    setCheckbox('autoUpdateToggle', s.autoUpdate !== false);
    
    const updateIntervalSelect = document.getElementById('updateIntervalSelect');
    if (updateIntervalSelect) updateIntervalSelect.value = s.updateInterval || 24;
    
    const updateIntervalLabel = document.getElementById('updateIntervalLabel');
    if (updateIntervalLabel) {
        const interval = s.updateInterval || 24;
        updateIntervalLabel.textContent = interval + (interval === 168 ? ' hours (weekly)' : ' hours');
    }
    
    const dataPathDisplay = document.getElementById('dataPathDisplay');
    if (dataPathDisplay) dataPathDisplay.textContent = s.dataPath || 'Loading...';

    setCheckbox('performanceModeToggle', s.performanceMode);
    setCheckbox('debugLogsToggle', s.debugLogs);
    
    const serverPortDisplay = document.getElementById('serverPortDisplay');
    if (serverPortDisplay) serverPortDisplay.textContent = apiPort || '3000';

    applyTheme(s.theme || 'default');
    applyDirection(s.direction || 'ltr');

    if (s.performanceMode) {
        document.body.classList.add('performance-mode');
    } else {
        document.body.classList.remove('performance-mode');
    }

    if (s.debugLogs) {
        localStorage.setItem('korai_debug', 'true');
    } else {
        localStorage.removeItem('korai_debug');
    }

    applyFontSize(s.fontSize || 'medium');
    applyShowAlbumArt(s.showAlbumArt !== false);
}

function setCheckbox(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
}

function setSlider(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

// ============================================================
// APPLY FUNCTIONS
// ============================================================

function applyTheme(theme) {
    document.body.classList.remove('theme-default', 'theme-liquid-glass');
    document.body.classList.add('theme-' + theme);
    
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    document.querySelectorAll('.skin-btn').forEach(btn => {
        const skinValue = btn.dataset.skin;
        let targetSkin = skinValue;
        if (skinValue === 'apple') targetSkin = 'liquid-glass';
        btn.classList.toggle('active', targetSkin === theme);
    });
}

function applyDirection(direction) {
    document.documentElement.dir = direction;
    document.body.dir = direction;
    document.body.classList.toggle('rtl', direction === 'rtl');
    document.body.classList.toggle('ltr', direction !== 'rtl');

    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
        const span = langBtn.querySelector('span');
        if (span) span.textContent = direction === 'rtl' ? 'EN' : 'FA';
    }
    
    // Re-translate after direction change
    setTimeout(translatePage, 50);
}

function applyFontSize(size) {
    document.documentElement.style.fontSize = 
        size === 'small' ? '13px' :
        size === 'large' ? '18px' :
        '15px';
}

function applyShowAlbumArt(show) {
    const coverFrame = document.getElementById('playerAlbumArt');
    if (coverFrame) {
        coverFrame.style.display = show ? 'flex' : 'none';
    }
}

// ============================================================
// SYNC WITH DSP & PLAYBACK
// ============================================================

function syncEQToDSP(eq) {
    if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({
            type: 'sync-eq',
            values: eq
        }, '*');
    }
    
    if (typeof window.updateEqualizerBand === 'function') {
        for (let i = 0; i < 5; i++) {
            window.updateEqualizerBand(i, eq[i] || 0);
        }
    }
}

function syncPlaybackSettings(settings) {
    if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({
            type: 'sync-playback',
            settings: {
                gapless: settings.gaplessEnabled,
                crossfade: settings.crossfadeDuration
            }
        }, '*');
    }

    if (window.electronAPI && window.electronAPI.setPlaybackSettings) {
        window.electronAPI.setPlaybackSettings({
            gapless: settings.gaplessEnabled,
            crossfade: settings.crossfadeDuration
        });
    }
}

// ============================================================
// NAVIGATION
// ============================================================

function switchSection(sectionId) {
    currentSection = sectionId;

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === sectionId);
    });

    document.querySelectorAll('.settings-section').forEach(section => {
        section.classList.toggle('active', section.id === 'section-' + sectionId);
    });

    const content = document.querySelector('.settings-content');
    if (content) content.scrollTop = 0;
}

// ============================================================
// EQ PRESETS
// ============================================================

const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    rock: [4, 3, 1, 0, 3],
    pop: [3, 2, 1, 1, 2],
    classical: [2, 1, 0, 0, 2],
    bass: [6, 4, 1, 0, -1],
    treble: [-1, -1, 1, 3, 5],
    jazz: [2, 1, 0, 1, 2],
    electronic: [3, 2, 0, 1, 4]
};

function applyEQPreset(presetName) {
    const values = EQ_PRESETS[presetName];
    if (!values) return;

    for (let i = 0; i < 5; i++) {
        const slider = document.getElementById(`eqSlider${i}`);
        const valEl = document.getElementById(`eqVal${i}`);
        if (slider) {
            slider.value = values[i];
            if (valEl) valEl.textContent = values[i] + 'dB';
        }
    }

    document.querySelectorAll('.eq-preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === presetName);
    });

    syncEQToDSP(values);
}

// ============================================================
// DATA DIRECTORY
// ============================================================

async function getDataPath() {
    try {
        if (window.electronAPI && window.electronAPI.getDataPath) {
            return await window.electronAPI.getDataPath();
        }
        return 'User Data';
    } catch (e) {
        return 'User Data';
    }
}

function openDataDirectory() {
    const pathDisplay = document.getElementById('dataPathDisplay');
    if (!pathDisplay) return;
    
    const dataPath = pathDisplay.textContent;
    if (!dataPath || dataPath === 'Loading...' || dataPath === 'User Data') {
        showToast('Data directory path is not available', 'error');
        return;
    }

    // استفاده از electronAPI برای باز کردن پوشه
    if (window.electronAPI && window.electronAPI.openFolder) {
        window.electronAPI.openFolder(dataPath);
    } else if (window.electronAPI && window.electronAPI.openExternalLink) {
        // fallback
        let formattedPath = dataPath;
        if (process.platform === 'win32') {
            formattedPath = 'file:///' + dataPath.replace(/\\/g, '/');
        } else {
            formattedPath = 'file://' + dataPath;
        }
        window.electronAPI.openExternalLink(formattedPath);
    } else {
        showToast('Cannot open directory', 'error');
    }
}


// ============================================================
// CLEAR CACHE
// ============================================================

async function clearCache() {
    if (!confirm(t('systemClearCache') + '?\n' + t('settingsResetConfirm2'))) return;

    try {
        const res = await apiFetch('/api/settings/clear-cache', { method: 'POST' });
        if (res.ok) {
            showToast(t('systemClearCache') + ' cleared successfully!', 'success');
        } else {
            throw new Error('Failed to clear cache');
        }
    } catch (err) {
        showToast(t('systemClearCache') + ' failed: ' + err.message, 'error');
    }
}

// ============================================================
// CHECK UPDATES
// ============================================================

async function checkForUpdates() {
    showToast(t('systemCheckUpdates') + '...', 'info');
    try {
        if (window.electronAPI && window.electronAPI.checkUpdateStatus) {
            const status = await window.electronAPI.checkUpdateStatus();
            if (status && status.hasUpdate) {
                showToast(`${t('updateAvailable')}: v${status.latestVersion}`, 'success');
                const versionDisplay = document.getElementById('currentVersionDisplay');
                if (versionDisplay) {
                    versionDisplay.innerHTML = `v${status.currentVersion} → <strong style="color: #1db954;">v${status.latestVersion}</strong>`;
                }
            } else if (status && status.currentVersion) {
                showToast(`✅ ${t('noUpdates')} (v${status.currentVersion})`, 'success');
            } else {
                showToast(`✅ ${t('noUpdates')}`, 'success');
            }
        } else {
            showToast(t('systemCheckUpdates') + ' not available', 'error');
        }
    } catch (err) {
        showToast(t('systemCheckUpdates') + ' failed: ' + err.message, 'error');
    }
}

// ============================================================
// RESET ALL SETTINGS
// ============================================================

async function resetAllSettings() {
    if (!confirm(t('settingsResetConfirm'))) return;
    if (!confirm(t('settingsResetConfirm2'))) return;

    try {
        if (window.settingsStore && window.settingsStore.initialized) {
            const success = await window.settingsStore.reset();
            if (success) {
                showToast(t('settingsResetSuccess'), 'success');
                await loadSettings();
            } else {
                throw new Error('Reset failed');
            }
            return;
        }

        const res = await apiFetch('/api/settings/reset', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            settingsData = data.settings || getDefaultSettings();
            applySettingsToUI(settingsData);
            showToast(t('settingsResetSuccess'), 'success');
        } else {
            throw new Error('Failed to reset settings');
        }
    } catch (err) {
        showToast(t('settingsResetFailed') + ': ' + err.message, 'error');
    }
}

// ============================================================
// FORMAT TAGS TOGGLE
// ============================================================

function toggleFormatTag(element) {
    element.classList.toggle('active');
}

// ============================================================
// SELECT SCAN PATH
// ============================================================

async function selectScanPath() {
    if (window.electronAPI && window.electronAPI.selectAudioFolder) {
        try {
            const paths = await window.electronAPI.selectAudioFolder();
            if (paths && paths.length > 0) {
                settingsData.scanPath = paths[0];
                const display = document.getElementById('defaultScanPathDisplay');
                if (display) display.textContent = paths[0];
                showToast(t('libraryScanPath') + ' updated', 'success');
            }
        } catch (err) {
            showToast(t('libraryScanPath') + ' failed: ' + err.message, 'error');
        }
    } else {
        showToast(t('librarySelectFolder') + ' not available', 'error');
    }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            switchSection(btn.dataset.section);
        });
    });

    const backBtn = document.getElementById('backToPlayerBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = 'index.html';
            }
        });
    }

    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveSettings);
    }

    const crossfadeSlider = document.getElementById('crossfadeSlider');
    if (crossfadeSlider) {
        crossfadeSlider.addEventListener('input', (e) => {
            const label = document.getElementById('crossfadeValueLabel');
            if (label) label.textContent = parseFloat(e.target.value) + ' seconds';
        });
    }

    const volumeSlider = document.getElementById('defaultVolumeSlider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const label = document.getElementById('defaultVolumeLabel');
            if (label) label.textContent = e.target.value + '%';
        });
    }

    const maxDepthSlider = document.getElementById('maxScanDepthSlider');
    if (maxDepthSlider) {
        maxDepthSlider.addEventListener('input', (e) => {
            const label = document.getElementById('maxScanDepthLabel');
            if (label) label.textContent = e.target.value;
        });
    }

    const hookTimeoutSlider = document.getElementById('hookTimeoutSlider');
    if (hookTimeoutSlider) {
        hookTimeoutSlider.addEventListener('input', (e) => {
            const label = document.getElementById('hookTimeoutLabel');
            if (label) label.textContent = e.target.value + ' ms';
        });
    }

    const pluginMemorySlider = document.getElementById('pluginMemorySlider');
    if (pluginMemorySlider) {
        pluginMemorySlider.addEventListener('input', (e) => {
            const label = document.getElementById('pluginMemoryLabel');
            if (label) label.textContent = e.target.value + ' MB';
        });
    }

    const diversitySlider = document.getElementById('diversityBoostSlider');
    if (diversitySlider) {
        diversitySlider.addEventListener('input', (e) => {
            const label = document.getElementById('diversityBoostLabel');
            if (label) label.textContent = parseFloat(e.target.value).toFixed(2);
        });
    }

    const updateIntervalSelect = document.getElementById('updateIntervalSelect');
    if (updateIntervalSelect) {
        updateIntervalSelect.addEventListener('change', (e) => {
            const label = document.getElementById('updateIntervalLabel');
            if (label) {
                const val = parseInt(e.target.value);
                label.textContent = val + (val === 168 ? ' hours (weekly)' : ' hours');
            }
        });
    }

    ['weightLike', 'weightPlay', 'weightSkip', 'weightRepeat', 'weightPlaylistAdd'].forEach(id => {
        const slider = document.getElementById(id);
        if (slider) {
            slider.addEventListener('input', (e) => {
                const valEl = document.getElementById(id + 'Val');
                if (valEl) valEl.textContent = parseFloat(e.target.value).toFixed(2);
            });
        }
    });

    for (let i = 0; i < 5; i++) {
        const slider = document.getElementById(`eqSlider${i}`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                const valEl = document.getElementById(`eqVal${i}`);
                if (valEl) valEl.textContent = e.target.value + 'dB';
                document.querySelectorAll('.eq-preset-btn').forEach(btn => btn.classList.remove('active'));
                syncEQToDSP([
                    parseInt(document.getElementById('eqSlider0')?.value ?? 0),
                    parseInt(document.getElementById('eqSlider1')?.value ?? 0),
                    parseInt(document.getElementById('eqSlider2')?.value ?? 0),
                    parseInt(document.getElementById('eqSlider3')?.value ?? 0),
                    parseInt(document.getElementById('eqSlider4')?.value ?? 0)
                ]);
            });
        }
    }

    document.querySelectorAll('.eq-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            applyEQPreset(btn.dataset.preset);
        });
    });

    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyTheme(btn.dataset.theme);
        });
    });

    document.querySelectorAll('.format-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            tag.classList.toggle('active');
        });
    });

    const selectPathBtn = document.getElementById('selectScanPathBtn');
    if (selectPathBtn) {
        selectPathBtn.addEventListener('click', selectScanPath);
    }

    const openDataBtn = document.getElementById('openDataDirBtn');
    if (openDataBtn) {
        openDataBtn.addEventListener('click', openDataDirectory);
    }

    const clearCacheBtn = document.getElementById('clearCacheBtn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', clearCache);
    }

    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', checkForUpdates);
    }

    const resetBtn = document.getElementById('resetAllBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetAllSettings);
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveSettings();
        }
        if (e.key === 'Escape') {
            const backBtn = document.getElementById('backToPlayerBtn');
            if (backBtn) backBtn.click();
        }
    });

    if (window.settingsStore) {
        window.settingsStore.subscribeAll((key, value) => {
            updateUIElement(key, value);
        });
    }

    window.addEventListener('settings-loaded', (e) => {
        if (e.detail && e.detail.settings) {
            applySettingsToUI(e.detail.settings);
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'user_lang') {
            console.debug('Language changed via storage:', e.newValue);
            translatePage();
            // Update direction
            const direction = e.newValue === 'fa' ? 'rtl' : 'ltr';
            document.documentElement.dir = direction;
            document.body.dir = direction;
            document.body.classList.toggle('rtl', direction === 'rtl');
            document.body.classList.toggle('ltr', direction !== 'rtl');
        }
    });

    // Listen for custom language change event
    window.addEventListener('language-changed', (e) => {
        console.debug('Language changed via event:', e.detail?.lang);
        setTimeout(translatePage, 100);
    });
}

// ============================================================
// UPDATE SINGLE UI ELEMENT
// ============================================================

function updateUIElement(key, value) {
    switch (key) {
        case 'theme':
            applyTheme(value);
            document.querySelectorAll('.theme-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.theme === value);
            });
            break;
        case 'direction':
            applyDirection(value);
            const dirSelect = document.getElementById('directionSelect');
            if (dirSelect) dirSelect.value = value;
            break;
        case 'fontSize':
            applyFontSize(value);
            const fontSizeSelect = document.getElementById('fontSizeSelect');
            if (fontSizeSelect) fontSizeSelect.value = value;
            break;
        case 'showAlbumArt':
            applyShowAlbumArt(value);
            const albumArtToggle = document.getElementById('showAlbumArtToggle');
            if (albumArtToggle) albumArtToggle.checked = value;
            break;
        case 'defaultVolume':
            setSlider('defaultVolumeSlider', value);
            const volLabel = document.getElementById('defaultVolumeLabel');
            if (volLabel) volLabel.textContent = value + '%';
            break;
        case 'eq':
            if (Array.isArray(value)) {
                for (let i = 0; i < 5; i++) {
                    const slider = document.getElementById(`eqSlider${i}`);
                    const valEl = document.getElementById(`eqVal${i}`);
                    if (slider) {
                        slider.value = value[i] || 0;
                        if (valEl) valEl.textContent = (value[i] || 0) + 'dB';
                    }
                }
            }
            break;
        case 'stayInTray':
            const trayToggle = document.getElementById('stayInTrayToggle');
            if (trayToggle) trayToggle.checked = value;
            break;
        case 'performanceMode':
            document.body.classList.toggle('performance-mode', value);
            const perfToggle = document.getElementById('performanceModeToggle');
            if (perfToggle) perfToggle.checked = value;
            break;
        case 'debugLogs':
            const debugToggle = document.getElementById('debugLogsToggle');
            if (debugToggle) debugToggle.checked = value;
            break;
        case 'gaplessEnabled':
            const gaplessToggle = document.getElementById('gaplessToggle');
            if (gaplessToggle) gaplessToggle.checked = value;
            break;
        case 'crossfadeDuration':
            setSlider('crossfadeSlider', value);
            const crossLabel = document.getElementById('crossfadeValueLabel');
            if (crossLabel) crossLabel.textContent = value + ' seconds';
            break;
        case 'aiRecommendations':
            const aiToggle = document.getElementById('aiRecommendationsToggle');
            if (aiToggle) aiToggle.checked = value;
            break;
    }
}

// ============================================================
// INIT
// ============================================================

async function init() {
    if (isInitialized) return;

    console.debug('Initializing settings page...');

    const dataPathDisplay = document.getElementById('dataPathDisplay');
    if (dataPathDisplay) dataPathDisplay.textContent = 'Loading...';

    // Translate page immediately
    translatePage();

    apiPort = await resolveApiPort();
    console.debug('Settings page using API port:', apiPort);

    try {
        const path = await getDataPath();
        const display = document.getElementById('dataPathDisplay');
        if (display) display.textContent = path || 'User Data';
    } catch (e) {
        const display = document.getElementById('dataPathDisplay');
        if (display) display.textContent = 'User Data';
    }

    const portDisplay = document.getElementById('serverPortDisplay');
    if (portDisplay) portDisplay.textContent = apiPort || '3000';

    await loadSettings();

    const versionEl = document.getElementById('currentVersionDisplay');
    const versionBadge = document.getElementById('settingsVersion');
    try {
        if (window.electronAPI && window.electronAPI.getAppVersion) {
            const v = await window.electronAPI.getAppVersion();
            if (v) {
                if (versionEl) versionEl.textContent = 'v' + v;
                if (versionBadge) versionBadge.textContent = 'v' + v;
            }
        }
    } catch (e) {}

    setupEventListeners();
    switchSection('playback');

    // Re-translate after DOM is fully rendered
    setTimeout(() => {
        translatePage();
        console.debug('Re-translation after DOM render');
    }, 200);

    isInitialized = true;
    console.debug('Settings page initialized');
}

// ============================================================
// START
// ============================================================

document.addEventListener('DOMContentLoaded', init);

// Also try to translate after window load for safety
window.addEventListener('load', () => {
    setTimeout(translatePage, 300);
});

// ============================================================
// EXPOSE FOR DEBUGGING
// ============================================================

window.__settings = {
    loadSettings,
    saveSettings,
    applySettingsToUI,
    switchSection,
    applyEQPreset,
    resetAllSettings,
    clearCache,
    checkForUpdates,
    settingsData: () => settingsData,
    getDefaultSettings,
    t: t,
    translatePage: translatePage
};

console.debug('Settings page loaded. Use window.__settings for debugging.');