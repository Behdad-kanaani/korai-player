/**
 * preload.js - KORAI Music Player
 * 
 * Exposes secure IPC bridges between renderer and main process.
 * Provides safe APIs for file dialogs, window controls, mini-player,
 * file association handling, tag editing, playlist export/import,
 * advanced search, CUE sheet support, and update management.
 */

const { contextBridge, ipcRenderer } = require('electron');

console.log('🔌 Preload script starting...');

// Log server port when received
ipcRenderer.on('server-port', (event, port) => {
    console.log('📡 Preload received port:', port);
});

// Forward global shortcuts
ipcRenderer.on('global-shortcut', (event, command) => {
    console.log('🎹 Global shortcut received:', command);
    window.dispatchEvent(new CustomEvent('global-shortcut', { detail: command }));
});

// Get server port from main process
const getServerPort = () => {
    return ipcRenderer.invoke('get-server-port');
};

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
    onStateUpdated: (callback) => ipcRenderer.on('state-updated', (event, data) => callback(data)),
    onExecuteControl: (callback) => ipcRenderer.on('execute-control', (event, command) => callback(command)),
    
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

console.log('✅ Preload script loaded');