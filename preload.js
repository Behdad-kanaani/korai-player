/**
 * preload.js - KORAI Music Player
 * 
 * Exposes secure IPC bridges between renderer and main process.
 * Provides safe APIs for file dialogs, window controls, mini-player,
 * file association handling, tag editing, playlist export/import,
 * advanced search, CUE sheet support, and update management.
 */

const { contextBridge, ipcRenderer } = require('electron');

console.debug('🔌 Preload script starting...');

// Log server port when received
ipcRenderer.on('server-port', (event, port) => {
    console.debug('📡 Preload received port:', port);
});

// Forward global shortcuts
ipcRenderer.on('global-shortcut', (event, command) => {
    console.debug('🎹 Global shortcut received:', command);
    window.dispatchEvent(new CustomEvent('global-shortcut', { detail: command }));
});

// Get server port from main process
const getServerPort = () => {
    return ipcRenderer.invoke('get-server-port');
};

// Internal maps to allow removal of renderer listeners by token
const _stateUpdatedHandlers = new Map();
const _executeControlHandlers = new Map();

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // =========================================================================
    // SERVER AND FILE OPERATIONS
    // =========================================================================
    getServerPort: getServerPort,
    selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
    selectAudioFolder: () => ipcRenderer.invoke('select-audio-folder'),
    
    // =========================================================================
    // FILE ASSOCIATION - receive files opened from system
    // =========================================================================
    onFilesOpened: (callback) => {
        ipcRenderer.on('files-opened', (event, files) => callback(files));
    },
    // Receive folder scan results (array of file paths)
    onFolderScanResults: (callback) => {
        ipcRenderer.on('scan-results', (event, files) => callback(files));
    },
    
    // =========================================================================
    // GLOBAL SHORTCUT HANDLER
    // =========================================================================
    onGlobalShortcut: (callback) => {
        ipcRenderer.on('global-shortcut', (event, command) => callback(command));
    },
    
    // =========================================================================
    // WINDOW CONTROLS
    // =========================================================================
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    
    // =========================================================================
    // MINI-PLAYER CONTROLS
    // =========================================================================
    openMiniPlayer: (track, playing) => ipcRenderer.send('open-mini-player', track, playing),
    closeMiniPlayer: () => ipcRenderer.send('close-mini-player'),
    syncStateToMini: (data) => ipcRenderer.send('sync-state-to-mini', data),
    controlFromMini: (command) => ipcRenderer.send('control-from-mini', command),
    
    // =========================================================================
    // TRAY MENU SYNC
    // =========================================================================
    syncTrayState: (data) => ipcRenderer.send('tray-update-state', data),
    onTrayOpenMiniPlayer: (callback) => ipcRenderer.on('tray-open-mini-player', (event, track, playing) => callback(track, playing)),
    onTrayCinematicMode: (callback) => ipcRenderer.on('tray-cinematic-mode', () => callback()),
    onTrayChangeLanguage: (callback) => ipcRenderer.on('tray-change-language', (event, lang) => callback(lang)),
    onTrayTogglePlayback: (callback) => ipcRenderer.on('tray-toggle-playback', () => callback()),
    onTrayNextTrack: (callback) => ipcRenderer.on('tray-next-track', () => callback()),
    onTrayPreviousTrack: (callback) => ipcRenderer.on('tray-previous-track', () => callback()),
    trayLanguageChanged: (lang) => ipcRenderer.send('tray-language-changed', lang),
    
    // =========================================================================
    // STATE SYNCHRONIZATION
    // =========================================================================
    // Register for 'state-updated' and return a token that can be used to remove the listener.
    onStateUpdated: (callback) => {
        const token = Math.random().toString(36).slice(2);
        const wrapper = (event, data) => callback(data);
        _stateUpdatedHandlers.set(token, wrapper);
        ipcRenderer.on('state-updated', wrapper);
        return token;
    },
    removeStateUpdatedListener: (token) => {
        const wrapper = _stateUpdatedHandlers.get(token);
        if (wrapper) {
            ipcRenderer.removeListener('state-updated', wrapper);
            _stateUpdatedHandlers.delete(token);
        }
    },
    // Register for 'execute-control' (returns token) and allow removal
    onExecuteControl: (callback) => {
        const token = Math.random().toString(36).slice(2);
        const wrapper = (event, command) => callback(command);
        _executeControlHandlers.set(token, wrapper);
        ipcRenderer.on('execute-control', wrapper);
        return token;
    },
    removeExecuteControlListener: (token) => {
        const wrapper = _executeControlHandlers.get(token);
        if (wrapper) {
            ipcRenderer.removeListener('execute-control', wrapper);
            _executeControlHandlers.delete(token);
        }
    },
    
    // =========================================================================
    // EXTERNAL LINKS
    // =========================================================================
    openExternalLink: (url) => ipcRenderer.send('open-external', url),

    // =========================================================================
    // VERSION AND UPDATE MANAGEMENT
    // =========================================================================
    /**
     * Listen for initial app version from main process
     */
    onAppVersion: (callback) => ipcRenderer.on('app-version', (event, data) => callback(data)),
    
    onScanNoFilesFound: (callback) => {
        ipcRenderer.on('scan-no-files-found', (event, folderPath) => callback(folderPath));
    },
    /**
     * Listen for update status changes (update available or not)
     */
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    
    /**
     * Manually check for update status from renderer
     * Returns: { hasUpdate: boolean, currentVersion: string, latestVersion: string|null, url: string|null, error: string|null }
     */
    checkUpdateStatus: () => ipcRenderer.invoke('check-update-status'),

    // =========================================================================
    // TAG EDITOR
    // =========================================================================
    onOpenTagEditor: (callback) => ipcRenderer.on('open-tag-editor', (event, trackId) => callback(trackId)),
    
    // =========================================================================
    // ADVANCED SEARCH
    // =========================================================================
    advancedSearch: (query) => ipcRenderer.invoke('advanced-search', query),
    
    // =========================================================================
    // PLAYLIST EXPORT/IMPORT
    // =========================================================================
    exportPlaylist: (playlistId, format) => ipcRenderer.invoke('export-playlist', playlistId, format),
    importPlaylist: (filePath, format) => ipcRenderer.invoke('import-playlist', filePath, format),
    
    // =========================================================================
    // LIBRARY EXPORT
    // =========================================================================
    exportLibrary: () => ipcRenderer.invoke('export-library'),
    
    // =========================================================================
    // CUE SHEET
    // =========================================================================
    parseCueSheet: (cuePath) => ipcRenderer.invoke('parse-cue', cuePath),
    
    // =========================================================================
    // PLAYBACK SETTINGS
    // =========================================================================
    getPlaybackSettings: () => ipcRenderer.invoke('get-playback-settings'),
    setPlaybackSettings: (settings) => ipcRenderer.invoke('set-playback-settings', settings),
    
    // =========================================================================
    // CROSSFADE
    // =========================================================================
    setCrossfade: (duration) => ipcRenderer.send('set-crossfade', duration),
    onCrossfadeChanged: (callback) => ipcRenderer.on('crossfade-changed', (event, duration) => callback(duration)),
    
    // =========================================================================
    // REAL BPM DETECTION
    // =========================================================================
    detectRealBPM: (trackId) => ipcRenderer.invoke('detect-real-bpm', trackId),


    // =========================================================================
    // REAL BPM DETECTION
    // =========================================================================
    importPlaylistAuto: (filePath) => ipcRenderer.invoke('import-playlist-auto', filePath),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
});

console.debug('✅ Preload script loaded');

// ---- Plugin UI Bridge ----
// Expose a minimal, secure API for renderer to create sandboxed plugin iframes
contextBridge.exposeInMainWorld('koraiPlugins', {
    // Create a sandboxed iframe for a plugin inside a container selector.
    // pluginId: string identifier
    // containerSelector: CSS selector for the container element in renderer DOM
    // options: { srcdoc?: string } - HTML string to load inside iframe (optional)
    createPluginIframe: (pluginId, containerSelector, options = {}) => {
        const container = document.querySelector(containerSelector);
        if (!container) throw new Error('container not found: ' + containerSelector);
        // remove existing iframe for this plugin if present
        const existing = container.querySelector(`iframe[data-plugin-id="${pluginId}"]`);
        if (existing) existing.remove();

        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('data-plugin-id', pluginId);
        iframe.style.width = '100%';
        iframe.style.border = 'none';
        iframe.style.minHeight = '120px';

        if (options && options.srcdoc) {
            // Use srcdoc to avoid loading remote resources
            iframe.srcdoc = options.srcdoc;
        } else {
            // blank isolated iframe
            iframe.srcdoc = '<!doctype html><meta charset="utf-8"><title>Plugin UI</title><div id="korai-root"></div>';
        }

        // forward messages from iframe to renderer via window events
        const msgHandler = (ev) => {
            if (ev.source !== iframe.contentWindow) return;
            // re-dispatch a CustomEvent for renderer code to handle
            window.dispatchEvent(new CustomEvent('korai-plugin-message', { detail: { pluginId, message: ev.data } }));
        };

        window.addEventListener('message', msgHandler);

        // cleanup when iframe removed
        const observer = new MutationObserver((records) => {
            for (const r of records) {
                for (const n of r.removedNodes) {
                    if (n === iframe) {
                        window.removeEventListener('message', msgHandler);
                        observer.disconnect();
                    }
                }
            }
        });
        observer.observe(container, { childList: true });

        container.appendChild(iframe);

        return {
            send: (msg) => {
                try {
                    iframe.contentWindow.postMessage(msg, '*');
                } catch (e) { console.warn('postMessage failed', e); }
            },
            iframe
        };
    },
    // Send a message to all plugin iframes
    broadcast: (msg) => {
        const iframes = document.querySelectorAll('iframe[data-plugin-id]');
        iframes.forEach(f => {
            try { f.contentWindow.postMessage(msg, '*'); } catch (e) {}
        });
    },
    // Listen for plugin messages (renderer can addEventListener on window for 'korai-plugin-message')
});