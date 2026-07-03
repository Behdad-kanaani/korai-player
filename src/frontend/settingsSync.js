/**
 * settingsSync.js - Synchronize settings with all app components
 * 
 * Connects the global settings store to all UI components
 * and backend services
 */

class SettingsSync {
    constructor() {
        this.store = window.settingsStore;
        this.initialized = false;
    }

    /**
     * Initialize sync with all components
     */
    async init() {
        if (this.initialized) return;

        // Wait for store to be ready
        if (!this.store.initialized) {
            await new Promise(resolve => {
                const check = () => {
                    if (this.store.initialized) {
                        resolve();
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
        }

        // Apply all settings immediately
        this.applyAllSettings();

        // Subscribe to all changes
        this.store.subscribeAll((key, value, oldValue) => {
            this.handleSettingChange(key, value, oldValue);
        });

        this.initialized = true;
        console.debug('🔗 SettingsSync initialized');
    }

    /**
     * Apply all settings to the app
     */
    applyAllSettings() {
        const settings = this.store.getAll();

        // Theme
        this.applyTheme(settings.theme);

        // Direction
        this.applyDirection(settings.direction);

        // Font size
        this.applyFontSize(settings.fontSize);

        // Performance mode
        this.applyPerformanceMode(settings.performanceMode);

        // Debug logs
        this.applyDebugLogs(settings.debugLogs);

        // Show album art
        this.applyShowAlbumArt(settings.showAlbumArt);

        // Default volume
        this.applyDefaultVolume(settings.defaultVolume);

        // EQ
        this.applyEQ(settings.eq);

        // Playback settings
        this.applyPlaybackSettings(settings);

        // AI recommendations
        this.applyAIRecommendations(settings.aiRecommendations);

        // Stay in tray (store in localStorage for main process)
        this.applyStayInTray(settings.stayInTray);
    }

    /**
     * Handle individual setting changes
     */
    handleSettingChange(key, value, oldValue) {
        console.debug(`🔄 Setting changed: ${key} =`, value);

        // Dispatch events for specific components
        switch (key) {
            case 'theme':
                this.applyTheme(value);
                break;
            case 'direction':
                this.applyDirection(value);
                break;
            case 'fontSize':
                this.applyFontSize(value);
                break;
            case 'performanceMode':
                this.applyPerformanceMode(value);
                break;
            case 'debugLogs':
                this.applyDebugLogs(value);
                break;
            case 'showAlbumArt':
                this.applyShowAlbumArt(value);
                break;
            case 'defaultVolume':
                this.applyDefaultVolume(value);
                break;
            case 'eq':
                this.applyEQ(value);
                break;
            case 'gaplessEnabled':
            case 'crossfadeDuration':
                this.applyPlaybackSettings(this.store.getAll());
                break;
            case 'aiRecommendations':
                this.applyAIRecommendations(value);
                break;
            case 'stayInTray':
                this.applyStayInTray(value);
                break;
        }

        // Dispatch global event for any component to listen
        window.dispatchEvent(new CustomEvent('setting-applied', {
            detail: { key, value, oldValue }
        }));
    }

    // ---- Apply methods (public for manual calls) ----

    applyTheme(theme) {
        document.body.classList.remove('theme-default', 'theme-liquid-glass');
        document.body.classList.add('theme-' + theme);
        
        document.querySelectorAll('.theme-btn, .skin-btn').forEach(btn => {
            const target = btn.dataset.theme || btn.dataset.skin;
            if (target) {
                const targetTheme = target === 'apple' ? 'liquid-glass' : target;
                btn.classList.toggle('active', targetTheme === theme);
            }
        });
    }

    applyDirection(direction) {
        document.documentElement.dir = direction;
        document.body.dir = direction;
        document.body.classList.toggle('rtl', direction === 'rtl');
        document.body.classList.toggle('ltr', direction !== 'rtl');
    }

    applyFontSize(size) {
        document.documentElement.style.fontSize = 
            size === 'small' ? '13px' :
            size === 'large' ? '18px' :
            '15px';
    }

    applyPerformanceMode(enabled) {
        document.body.classList.toggle('performance-mode', enabled);
        window.dispatchEvent(new CustomEvent('performance-mode-changed', { detail: { enabled } }));
    }

    applyDebugLogs(enabled) {
        localStorage.setItem('korai_debug', enabled ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('debug-logs-changed', { detail: { enabled } }));
    }

    applyShowAlbumArt(show) {
        const coverFrame = document.getElementById('playerAlbumArt');
        if (coverFrame) {
            coverFrame.style.display = show ? 'flex' : 'none';
        }
        window.dispatchEvent(new CustomEvent('album-art-toggled', { detail: { show } }));
    }

    applyDefaultVolume(volume) {
        const vol = volume / 100;
        if (typeof window.setVolume === 'function') {
            window.setVolume(vol);
        }
        const slider = document.getElementById('volumeSlider');
        if (slider) slider.value = vol;
    }

    applyEQ(values) {
        if (Array.isArray(values) && values.length === 5) {
            for (let i = 0; i < 5; i++) {
                const slider = document.getElementById(`eqSlider${i}`);
                const valEl = document.getElementById(`eqVal${i}`);
                if (slider) {
                    slider.value = values[i];
                    if (valEl) valEl.textContent = values[i] + 'dB';
                }
                if (typeof window.updateEqualizerBand === 'function') {
                    window.updateEqualizerBand(i, values[i]);
                }
            }
        }
    }

    applyPlaybackSettings(settings) {
        if (window.electronAPI?.setPlaybackSettings) {
            window.electronAPI.setPlaybackSettings({
                gapless: settings.gaplessEnabled,
                crossfade: settings.crossfadeDuration
            });
        }

        const gaplessToggle = document.getElementById('gaplessToggle');
        if (gaplessToggle) gaplessToggle.checked = settings.gaplessEnabled;

        const crossfadeSlider = document.getElementById('crossfadeSlider');
        if (crossfadeSlider) crossfadeSlider.value = settings.crossfadeDuration;

        // Update repeat mode
        const repeatBtn = document.getElementById('repeatBtnK');
        if (repeatBtn) {
            const mode = settings.repeatMode || 'off';
            if (mode === 'off') {
                repeatBtn.classList.remove('active');
            } else {
                repeatBtn.classList.add('active');
            }
        }

        // Update shuffle mode
        const shuffleBtn = document.getElementById('shuffleBtnK');
        if (shuffleBtn) {
            shuffleBtn.classList.toggle('active', !!settings.shuffleDefault);
        }
    }

    applyAIRecommendations(enabled) {
        window.dispatchEvent(new CustomEvent('ai-recommendations-changed', { detail: { enabled } }));
    }

    applyStayInTray(enabled) {
        localStorage.setItem('korai_stay_in_tray', enabled ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('stay-in-tray-changed', { detail: { enabled } }));
    }
}

// ============================================================
// INIT
// ============================================================

const settingsSync = new SettingsSync();

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    settingsSync.init();
});

// Expose globally
window.settingsSync = settingsSync;

if (typeof module !== 'undefined') {
    module.exports = settingsSync;
}