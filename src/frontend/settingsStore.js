/**
 * settingsStore.js - Global Settings Store
 * 
 * Centralized settings management with event system
 * All settings are stored in a single source of truth
 * Components can subscribe to changes
 */

class SettingsStore {
    constructor() {
        this.settings = {};
        this.listeners = new Map();
        this.initialized = false;
        this.apiPort = null;
        this._saveTimeout = null;
        this._pendingSave = false;
    }

    /**
     * Initialize the store - load settings from server
     */
    async init(apiPort) {
        if (this.initialized) return;
        this.apiPort = apiPort;
        
        try {
            const res = await this._apiFetch('/api/settings');
            if (res.ok) {
                this.settings = await res.json();
                console.debug('Settings loaded:', Object.keys(this.settings).length, 'keys');
            } else {
                throw new Error('Failed to load settings');
            }
        } catch (err) {
            console.warn('⚠️ Failed to load settings, using defaults:', err.message);
            this.settings = this._getDefaults();
        }

        this.initialized = true;
        this._notifyAll();
    }

    /**
     * Get default settings
     */
    _getDefaults() {
        return {
            // Playback
            gaplessEnabled: true,
            crossfadeDuration: 0,
            repeatMode: 'off',
            shuffleDefault: false,
            resumeOnStart: false,

            // Audio
            defaultVolume: 70,
            audioOutput: 'stereo',
            eq: [0, 0, 0, 0, 0],

            // Appearance
            theme: 'default',
            direction: 'ltr',
            fontSize: 'medium',
            showAlbumArt: true,

            // Library
            scanPath: '',
            formats: ['mp3', 'wav', 'flac', 'ogg', 'm4a'],
            autoScan: false,
            maxScanDepth: 100,

            // Plugins
            autoActivatePlugins: true,
            hotReload: false,
            hookTimeout: 5000,
            pluginMemory: 64,

            // AI
            aiRecommendations: true,
            discoveryMode: true,
            weightLike: 0.40,
            weightPlay: 0.12,
            weightSkip: 0.30,
            weightRepeat: 0.25,
            weightPlaylistAdd: 0.15,
            diversityBoost: 0.85,

            // System & Tray
            stayInTray: true,
            trayNotification: true,
            autoUpdate: true,
            updateInterval: 24,

            // Advanced
            performanceMode: false,
            debugLogs: false,
            isFirstLaunch: true
        };
    }

    /**
     * API fetch helper
     */
    async _apiFetch(path, opts = {}) {
        const url = `http://127.0.0.1:${this.apiPort}${path.startsWith('/') ? path : '/' + path}`;
        return fetch(url, opts);
    }

    /**
     * Get a setting value
     */
    get(key, defaultValue = null) {
        return key in this.settings ? this.settings[key] : defaultValue;
    }

    /**
     * Get all settings
     */
    getAll() {
        return { ...this.settings };
    }

    /**
     * Set a single setting
     */
    set(key, value, autoSave = true) {
        const oldValue = this.settings[key];
        if (oldValue === value) return;

        this.settings[key] = value;
        this._notify(key, value, oldValue);
        this._applySetting(key, value, oldValue);

        if (autoSave) {
            this._scheduleSave();
        }
    }

    /**
     * Set multiple settings at once
     */
    setMultiple(updates, autoSave = true) {
        let changed = false;
        for (const [key, value] of Object.entries(updates)) {
            const oldValue = this.settings[key];
            if (oldValue !== value) {
                this.settings[key] = value;
                this._notify(key, value, oldValue);
                this._applySetting(key, value, oldValue);
                changed = true;
            }
        }

        if (changed && autoSave) {
            this._scheduleSave();
        }
    }

    /**
     * Apply a setting change immediately to the UI/DOM
     */
    _applySetting(key, value, oldValue) {
        switch (key) {
            case 'theme':
                this._applyTheme(value);
                break;
            case 'direction':
                this._applyDirection(value);
                break;
            case 'performanceMode':
                this._applyPerformanceMode(value);
                break;
            case 'debugLogs':
                this._applyDebugLogs(value);
                break;
            case 'fontSize':
                this._applyFontSize(value);
                break;
            case 'showAlbumArt':
                this._applyShowAlbumArt(value);
                break;
            case 'defaultVolume':
                this._applyDefaultVolume(value);
                break;
            case 'stayInTray':
                // This is handled in main process
                this._applyStayInTray(value);
                break;
            case 'eq':
                this._applyEQ(value);
                break;
            case 'gaplessEnabled':
            case 'crossfadeDuration':
                this._applyPlaybackSettings();
                break;
            case 'aiRecommendations':
                this._applyAIRecommendations(value);
                break;
        }
    }

    // ---- Apply methods ----

    _applyTheme(theme) {
        document.body.classList.remove('theme-default', 'theme-liquid-glass');
        document.body.classList.add('theme-' + theme);
        
        // Update theme buttons if they exist
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        // Update skin selector in sidebar if exists
        document.querySelectorAll('.skin-btn').forEach(btn => {
            const skinValue = btn.dataset.skin;
            let targetSkin = skinValue;
            if (skinValue === 'apple') targetSkin = 'liquid-glass';
            btn.classList.toggle('active', targetSkin === theme);
        });
    }

    _applyDirection(direction) {
        document.documentElement.dir = direction;
        document.body.dir = direction;
        document.body.classList.toggle('rtl', direction === 'rtl');
        document.body.classList.toggle('ltr', direction !== 'rtl');
    }

    _applyPerformanceMode(enabled) {
        if (enabled) {
            document.body.classList.add('performance-mode');
        } else {
            document.body.classList.remove('performance-mode');
        }
        // Dispatch event for components
        window.dispatchEvent(new CustomEvent('performance-mode-changed', { detail: { enabled } }));
    }

    _applyDebugLogs(enabled) {
        if (enabled) {
            localStorage.setItem('korai_debug', 'true');
        } else {
            localStorage.removeItem('korai_debug');
        }
        // Dispatch event
        window.dispatchEvent(new CustomEvent('debug-logs-changed', { detail: { enabled } }));
    }

    _applyFontSize(size) {
        document.documentElement.style.fontSize = 
            size === 'small' ? '13px' :
            size === 'large' ? '18px' :
            '15px';
    }

    _applyShowAlbumArt(show) {
        const coverFrame = document.getElementById('playerAlbumArt');
        if (coverFrame) {
            coverFrame.style.display = show ? 'flex' : 'none';
        }
        // Dispatch event
        window.dispatchEvent(new CustomEvent('album-art-toggled', { detail: { show } }));
    }

    _applyDefaultVolume(volume) {
        if (typeof window.setVolume === 'function') {
            const vol = volume / 100;
            window.setVolume(vol);
        }
    }

    _applyStayInTray(enabled) {
        // Store in localStorage for main process to read
        localStorage.setItem('korai_stay_in_tray', enabled ? 'true' : 'false');
        // Dispatch event
        window.dispatchEvent(new CustomEvent('stay-in-tray-changed', { detail: { enabled } }));
    }

    _applyEQ(values) {
        if (Array.isArray(values) && values.length === 5) {
            // Update DSP panel if it exists
            for (let i = 0; i < 5; i++) {
                const slider = document.getElementById(`eqSlider${i}`);
                const valEl = document.getElementById(`eqVal${i}`);
                if (slider) {
                    slider.value = values[i];
                    if (valEl) valEl.textContent = values[i] + 'dB';
                }
                // Update actual EQ if function exists
                if (typeof window.updateEqualizerBand === 'function') {
                    window.updateEqualizerBand(i, values[i]);
                }
            }
        }
    }

    _applyPlaybackSettings() {
        // Sync with main process
        if (window.electronAPI && window.electronAPI.setPlaybackSettings) {
            window.electronAPI.setPlaybackSettings({
                gapless: this.settings.gaplessEnabled,
                crossfade: this.settings.crossfadeDuration
            });
        }

        // Update UI
        const gaplessToggle = document.getElementById('gaplessToggle');
        if (gaplessToggle) gaplessToggle.checked = this.settings.gaplessEnabled;

        const crossfadeSlider = document.getElementById('crossfadeSlider');
        if (crossfadeSlider) crossfadeSlider.value = this.settings.crossfadeDuration;
    }

    _applyAIRecommendations(enabled) {
        // Dispatch event for AI components
        window.dispatchEvent(new CustomEvent('ai-recommendations-changed', { detail: { enabled } }));
    }

    // ---- Notification system ----

    /**
     * Subscribe to changes for a specific key or all keys
     */
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key).push(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index !== -1) callbacks.splice(index, 1);
            }
        };
    }

    /**
     * Subscribe to all changes
     */
    subscribeAll(callback) {
        return this.subscribe('*', callback);
    }

    /**
     * Notify listeners of a change
     */
    _notify(key, value, oldValue) {
        // Notify specific key listeners
        const callbacks = this.listeners.get(key) || [];
        for (const cb of callbacks) {
            try { cb(value, oldValue); } catch (e) {}
        }

        // Notify all listeners
        const allCallbacks = this.listeners.get('*') || [];
        for (const cb of allCallbacks) {
            try { cb(key, value, oldValue); } catch (e) {}
        }

        // Dispatch DOM event
        window.dispatchEvent(new CustomEvent('settings-changed', {
            detail: { key, value, oldValue, settings: { ...this.settings } }
        }));
    }

    _notifyAll() {
        const allCallbacks = this.listeners.get('*') || [];
        for (const cb of allCallbacks) {
            try { cb('*', this.settings, null); } catch (e) {}
        }
        window.dispatchEvent(new CustomEvent('settings-loaded', {
            detail: { settings: { ...this.settings } }
        }));
    }

    // ---- Save to server ----

    _scheduleSave() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }
        this._saveTimeout = setTimeout(() => {
            this._saveToServer();
        }, 500);
    }

    async _saveToServer() {
        if (this._pendingSave) return;
        this._pendingSave = true;

        try {
            const res = await this._apiFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.settings)
            });

            if (!res.ok) {
                throw new Error('Failed to save settings');
            }

            console.debug('Settings saved to server');
            this._pendingSave = false;
        } catch (err) {
            console.error('❌ Failed to save settings:', err.message);
            this._pendingSave = false;
            // Retry after 2 seconds
            setTimeout(() => {
                if (this._pendingSave === false) {
                    this._scheduleSave();
                }
            }, 2000);
        }
    }

    /**
     * Force immediate save
     */
    async save() {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }
        await this._saveToServer();
    }

    /**
     * Reset all settings to defaults
     */
    async reset() {
        try {
            const res = await this._apiFetch('/api/settings/reset', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                this.settings = data.settings || this._getDefaults();
                this._notifyAll();
                return true;
            }
            throw new Error('Reset failed');
        } catch (err) {
            console.error('Reset error:', err);
            return false;
        }
    }

    /**
     * Get a setting with type safety
     */
    getBoolean(key, defaultValue = false) {
        return !!this.get(key, defaultValue);
    }

    getNumber(key, defaultValue = 0) {
        const val = this.get(key, defaultValue);
        return typeof val === 'number' ? val : defaultValue;
    }

    getString(key, defaultValue = '') {
        const val = this.get(key, defaultValue);
        return typeof val === 'string' ? val : defaultValue;
    }

    getArray(key, defaultValue = []) {
        const val = this.get(key, defaultValue);
        return Array.isArray(val) ? val : defaultValue;
    }

    /**
     * Check if a setting exists
     */
    has(key) {
        return key in this.settings;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const settingsStore = new SettingsStore();

// Expose globally
window.settingsStore = settingsStore;

// ============================================================
// AUTO-INIT ON DOM READY
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Wait for API port to be available
    let apiPort = null;
    if (window.electronAPI && typeof window.electronAPI.getServerPort === 'function') {
        try {
            apiPort = await window.electronAPI.getServerPort();
        } catch (e) {}
    }
    if (!apiPort) {
        // Try common ports
        for (const p of [3000, 3001, 3002, 3003, 3004]) {
            try {
                const res = await fetch(`http://127.0.0.1:${p}/api/health`);
                if (res.ok) {
                    apiPort = p;
                    break;
                }
            } catch (e) {}
        }
    }
    if (!apiPort) apiPort = 3000;

    await settingsStore.init(apiPort);
    console.debug('SettingsStore initialized');
});

// ============================================================
// EXPORT
// ============================================================

if (typeof module !== 'undefined') {
    module.exports = settingsStore;
}