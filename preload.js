/**
 * preload.js - KORAI Music Player
 * 
 * Exposes secure IPC bridges between renderer and main process.
 * Provides safe APIs for file dialogs, window controls, mini-player,
 * file association handling, tag editing, playlist export/import,
 * advanced search, and CUE sheet support.
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
    // Server and file operations
    getServerPort: getServerPort,
    selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
    selectAudioFolder: () => ipcRenderer.invoke('select-audio-folder'),
    
    // File association - receive files opened from system
    onFilesOpened: (callback) => {
        ipcRenderer.on('files-opened', (event, files) => callback(files));
    },
    
    // Global shortcut handler
    onGlobalShortcut: (callback) => {
        ipcRenderer.on('global-shortcut', (event, command) => callback(command));
    },
    
    // Window controls
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    
    // Mini-player controls
    openMiniPlayer: (track, playing) => ipcRenderer.send('open-mini-player', track, playing),
    closeMiniPlayer: () => ipcRenderer.send('close-mini-player'),
    syncStateToMini: (data) => ipcRenderer.send('sync-state-to-mini', data),
    controlFromMini: (command) => ipcRenderer.send('control-from-mini', command),
    
    // Tray menu sync
    syncTrayState: (data) => ipcRenderer.send('tray-update-state', data),
    onTrayOpenMiniPlayer: (callback) => ipcRenderer.on('tray-open-mini-player', (event, track, playing) => callback(track, playing)),
    onTrayCinematicMode: (callback) => ipcRenderer.on('tray-cinematic-mode', () => callback()),
    onTrayChangeLanguage: (callback) => ipcRenderer.on('tray-change-language', (event, lang) => callback(lang)),
    onTrayTogglePlayback: (callback) => ipcRenderer.on('tray-toggle-playback', () => callback()),
    onTrayNextTrack: (callback) => ipcRenderer.on('tray-next-track', () => callback()),
    onTrayPreviousTrack: (callback) => ipcRenderer.on('tray-previous-track', () => callback()),
    trayLanguageChanged: (lang) => ipcRenderer.send('tray-language-changed', lang),
    
    // State synchronization
    onStateUpdated: (callback) => ipcRenderer.on('state-updated', (event, data) => callback(data)),
    onExecuteControl: (callback) => ipcRenderer.on('execute-control', (event, command) => callback(command)),
    
    // External links
    openExternalLink: (url) => ipcRenderer.send('open-external', url),

    // ===================== NEW APIs =====================
    
    // Tag editor
    onOpenTagEditor: (callback) => ipcRenderer.on('open-tag-editor', (event, trackId) => callback(trackId)),
    
    // Advanced search
    advancedSearch: (query) => ipcRenderer.invoke('advanced-search', query),
    
    // Playlist export/import    exportPlaylist: (playlistId, format) => ipcRenderer.invoke('export-playlist', playlistId, format),
    importPlaylist: (filePath, format) => ipcRenderer.invoke('import-playlist', filePath, format),
    
    // Library export
    exportLibrary: () => ipcRenderer.invoke('export-library'),
    
    // CUE sheet
    parseCueSheet: (cuePath) => ipcRenderer.invoke('parse-cue', cuePath),
    
    // Playback settings
    getPlaybackSettings: () => ipcRenderer.invoke('get-playback-settings'),
    setPlaybackSettings: (settings) => ipcRenderer.invoke('set-playback-settings', settings),
    
    // Crossfade
    setCrossfade: (duration) => ipcRenderer.send('set-crossfade', duration),
    onCrossfadeChanged: (callback) => ipcRenderer.on('crossfade-changed', (event, duration) => callback(duration)),
    
    // Real BPM detection
    detectRealBPM: (trackId) => ipcRenderer.invoke('detect-real-bpm', trackId)
});

console.log('✅ Preload script loaded');