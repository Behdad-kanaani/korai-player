/* Secure IPC bridge between the renderer and main process. */

const { contextBridge, ipcRenderer } = require('electron');

console.debug('Preload script starting...');

ipcRenderer.on('server-port', (event, port) => {
    console.debug('Preload received port:', port);
});

ipcRenderer.on('global-shortcut', (event, command) => {
    console.debug('Global shortcut received:', command);
    window.dispatchEvent(new CustomEvent('global-shortcut', { detail: command }));
});

const getServerPort = () => {
    return ipcRenderer.invoke('get-server-port');
};

const _stateUpdatedHandlers = new Map();
const _executeControlHandlers = new Map();

contextBridge.exposeInMainWorld('electronAPI', {

    // SYSTEM INFO
    getDataPath: () => ipcRenderer.invoke('get-data-path'),

    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // SERVER AND FILE OPERATIONS
    getServerPort: getServerPort,
    selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
    selectAudioFolder: () => ipcRenderer.invoke('select-audio-folder'),
    
    // FILE ASSOCIATION - receive files opened from system
    onFilesOpened: (callback) => {
        ipcRenderer.on('files-opened', (event, files) => callback(files));
    },
    
    onFolderScanResults: (callback) => {
        ipcRenderer.on('scan-results', (event, files) => callback(files));
    },
    
    // GLOBAL SHORTCUT HANDLER
    onGlobalShortcut: (callback) => {
        ipcRenderer.on('global-shortcut', (event, command) => callback(command));
    },
    
    // WINDOW CONTROLS
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    
    // MINI-PLAYER CONTROLS
    openMiniPlayer: (track, playing) => ipcRenderer.send('open-mini-player', track, playing),
    closeMiniPlayer: () => ipcRenderer.send('close-mini-player'),
    syncStateToMini: (data) => ipcRenderer.send('sync-state-to-mini', data),
    controlFromMini: (command) => ipcRenderer.send('control-from-mini', command),
    
    openFolder: (path) => ipcRenderer.send('open-folder', path),

    // TRAY MENU SYNC
    syncTrayState: (data) => ipcRenderer.send('tray-update-state', data),
    onTrayOpenMiniPlayer: (callback) => ipcRenderer.on('tray-open-mini-player', (event, track, playing) => callback(track, playing)),
    onTrayCinematicMode: (callback) => ipcRenderer.on('tray-cinematic-mode', () => callback()),
    onTrayChangeLanguage: (callback) => ipcRenderer.on('tray-change-language', (event, lang) => callback(lang)),
    onTrayTogglePlayback: (callback) => ipcRenderer.on('tray-toggle-playback', () => callback()),
    onTrayNextTrack: (callback) => ipcRenderer.on('tray-next-track', () => callback()),
    onTrayPreviousTrack: (callback) => ipcRenderer.on('tray-previous-track', () => callback()),
    trayLanguageChanged: (lang) => ipcRenderer.send('tray-language-changed', lang),
    
    // STATE SYNCHRONIZATION
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
    
    // EXTERNAL LINKS
    openExternalLink: (url) => ipcRenderer.send('open-external', url),

    // SCAN EVENTS
    onScanNoFilesFound: (callback) => {
        ipcRenderer.on('scan-no-files-found', (event, folderPath) => callback(folderPath));
    },
    
    onScanStarted: (callback) => {
        ipcRenderer.on('scan-started', (event, folderPath) => callback(folderPath));
    },

    onScanProgress: (callback) => {
        ipcRenderer.on('scan-progress', (event, currentDirectory) => callback(currentDirectory));
    },
    
    onScanComplete: (callback) => {
        ipcRenderer.on('scan-complete', (event, count) => callback(count));
    },

    // VERSION AND UPDATE MANAGEMENT
    onAppVersion: (callback) => ipcRenderer.on('app-version', (event, data) => callback(data)),
    
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    
    checkUpdateStatus: (options = {}) => ipcRenderer.invoke('check-update-status', options),
    
    applyUpdate: (updateInfo) => ipcRenderer.send('apply-update', updateInfo),

    installUpdate: () => ipcRenderer.send('install-update'),
    
    onUpdateProgress: (callback) => {
        ipcRenderer.on('update-progress', (event, progress) => callback(progress));
    },
    
    restartApp: () => ipcRenderer.send('restart-app'),
    
    getUpdateProgress: () => ipcRenderer.invoke('get-update-progress'),

    // TAG EDITOR
    
    onOpenTagEditor: (callback) => ipcRenderer.on('open-tag-editor', (event, trackId) => callback(trackId)),
    
    // PLAYLIST EXPORT/IMPORT
    
    exportPlaylist: (playlistId, format) => ipcRenderer.invoke('export-playlist', playlistId, format),
    importPlaylist: (filePath, format) => ipcRenderer.invoke('import-playlist', filePath, format),
    
    // LIBRARY EXPORT
    
    exportLibrary: () => ipcRenderer.invoke('export-library'),
    
    // CUE SHEET
    
    parseCueSheet: (cuePath) => ipcRenderer.invoke('parse-cue', cuePath),
    
    // PLAYBACK SETTINGS
    
    getPlaybackSettings: () => ipcRenderer.invoke('get-playback-settings'),
    setPlaybackSettings: (settings) => ipcRenderer.invoke('set-playback-settings', settings),
    
    // CROSSFADE
    
    setCrossfade: (duration) => ipcRenderer.send('set-crossfade', duration),
    onCrossfadeChanged: (callback) => ipcRenderer.on('crossfade-changed', (event, duration) => callback(duration)),
    
    // REAL BPM DETECTION
    
    detectRealBPM: (trackId) => ipcRenderer.invoke('detect-real-bpm', trackId),

    // PLAYLIST AUTO IMPORT
    
    importPlaylistAuto: (filePath) => ipcRenderer.invoke('import-playlist-auto', filePath),
    
    // OPEN DIALOG
    
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
});

console.debug('Preload script loaded');

// ---- Plugin UI Bridge ----
// Expose a minimal, secure API for renderer to create sandboxed plugin iframes
contextBridge.exposeInMainWorld('koraiPlugins', {
    /**
     * Create a sandboxed iframe for a plugin inside a container selector.
     * @param {string} pluginId - Plugin identifier
     * @param {string} containerSelector - CSS selector for the container element
     * @param {Object} options - { srcdoc?: string } - HTML string to load inside iframe (optional)
     * @returns {Object} { send: function, iframe: Element }
     */
    createPluginIframe: (pluginId, containerSelector, options = {}) => {
        const container = document.querySelector(containerSelector);
        if (!container) throw new Error('container not found: ' + containerSelector);
        
        // Remove existing iframe for this plugin if present
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
            // Blank isolated iframe
            iframe.srcdoc = '<!doctype html><meta charset="utf-8"><title>Plugin UI</title><div id="korai-root"></div>';
        }

        // Forward messages from iframe to renderer via window events
        const msgHandler = (ev) => {
            if (ev.source !== iframe.contentWindow) return;
            // Re-dispatch a CustomEvent for renderer code to handle
            window.dispatchEvent(new CustomEvent('korai-plugin-message', { 
                detail: { pluginId, message: ev.data } 
            }));
        };

        window.addEventListener('message', msgHandler);

        // Cleanup when iframe removed
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
                } catch (e) { 
                    console.warn('postMessage failed', e); 
                }
            },
            iframe
        };
    },
    
    /**
     * Send a message to all plugin iframes
     */
    broadcast: (msg) => {
        const iframes = document.querySelectorAll('iframe[data-plugin-id]');
        iframes.forEach(f => {
            try { 
                f.contentWindow.postMessage(msg, '*'); 
            } catch (e) {}
        });
    },
    
    /**
     * Listen for plugin messages (renderer can addEventListener on window for 'korai-plugin-message')
     */
    onPluginMessage: (callback) => {
        window.addEventListener('korai-plugin-message', (event) => {
            callback(event.detail);
        });
    }
});