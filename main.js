// ################################################################################
// #                                                                              #
// #                           WRITTEN BY BEHDAD KANANI                            #
// ##                         github.com/Behdad-kanaani/korai-player               #
// #                                                                              #
// #   Description:                                                               #
// #       KORAI Music Player - Electron Main Process                             #
// #       Handles window creation, IPC communication, system tray,              #
// #       file dialogs, mini-player window management, and file associations.   #
// #                                                                              #
// ################################################################################

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const findFreePort = require('find-free-port');

// =============================================================================
// GLOBAL ERROR HANDLERS
// =============================================================================

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

// =============================================================================
// SINGLE INSTANCE LOCK
// =============================================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('Another instance is already running. Exiting...');
    app.quit();
    process.exit(0);
}

// =============================================================================
// GLOBAL REFERENCES
// =============================================================================
let mainWindow;
let miniPlayerWindow = null;
let httpServer;
let serverPort;
let tray = null;
let isQuitting = false;
let pendingFiles = [];
let lastTrackState = null;

const { startServer } = require('./src/backend/server');

let currentTrayState = {
    isPlaying: false,
    currentTrack: null
};

let currentLanguage = 'en';

// =============================================================================
// FILE ASSOCIATION HANDLING (FIXED)
// =============================================================================

async function processPendingFiles() {
    if (pendingFiles.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        const files = [...pendingFiles];
        pendingFiles = [];
        
        // Increased delay to ensure app is fully loaded and ready
        setTimeout(async () => {
            try {
                console.log('📁 Processing pending files:', files);
                // Send files to renderer - renderer will handle import and auto-play
                mainWindow.webContents.send('files-opened', files);
            } catch (err) {
                console.error('Error processing opened files:', err);
            }
        }, 1000);
    }
}

function handleFileOpen() {
    const files = process.argv.slice(1).filter(arg => {
        // Match audio files and exclude electron/exe paths and app executables
        return arg.match(/\.(mp3|wav|ogg|m4a|flac)$/i) && 
               !arg.includes('.exe') && 
               !arg.includes('electron') &&
               !arg.includes('KORAI') &&
               !arg.includes('korai') &&
               !arg.includes('Player') &&
               !arg.includes('player');
    });
    
    if (files.length > 0) {
        console.log('📁 Files opened via command line:', files);
        pendingFiles = files;
    }
}

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    console.log('📁 File opened on macOS:', filePath);
    pendingFiles.push(filePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
        processPendingFiles();
    }
});

app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('🔄 Second instance detected, focusing main window...');
    
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        
        const files = commandLine.slice(1).filter(arg => {
            return arg.match(/\.(mp3|wav|ogg|m4a|flac)$/i) && 
                   !arg.includes('.exe') && 
                   !arg.includes('electron') &&
                   !arg.includes('KORAI') &&
                   !arg.includes('korai') &&
                   !arg.includes('Player') &&
                   !arg.includes('player');
        });
        
        if (files.length > 0) {
            console.log('📁 Files from second instance:', files);
            pendingFiles = files;
            processPendingFiles();
        }
    }
});

// =============================================================================
// TRAY MENU FUNCTIONS
// =============================================================================

async function loadTrayLanguage() {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'korai_data_v2.json');
        if (fs.existsSync(settingsPath)) {
            const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (data.settings && data.settings.savedLanguage) {
                currentLanguage = data.settings.savedLanguage;
            }
        }
    } catch (err) {
        console.log('Could not load language setting:', err);
    }
}

async function saveTrayLanguage(lang) {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'korai_data_v2.json');
        if (fs.existsSync(settingsPath)) {
            const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (!data.settings) data.settings = {};
            data.settings.savedLanguage = lang;
            fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
        }
        currentLanguage = lang;
    } catch (err) {
        console.log('Could not save language setting:', err);
    }
}

function getTrayMenuText() {
    const isRTL = currentLanguage === 'fa';
    
    return {
        showApp: isRTL ? 'نمایش برنامه' : 'Show App',
        miniPlayer: isRTL ? 'مینی پلیر' : 'Mini Player',
        cinematicMode: isRTL ? 'حالت سینمایی' : 'Cinematic Mode',
        player: isRTL ? 'پلیر اصلی' : 'Main Player',
        nowPlaying: isRTL ? 'در حال پخش:' : 'Now Playing:',
        notPlaying: isRTL ? 'در حال پخش نیست' : 'Not Playing',
        play: isRTL ? 'پخش' : 'Play',
        pause: isRTL ? 'مکث' : 'Pause',
        next: isRTL ? 'بعدی' : 'Next',
        previous: isRTL ? 'قبلی' : 'Previous',
        quit: isRTL ? 'خروج از KORAI' : 'Quit KORAI',
        language: isRTL ? 'تغییر زبان' : 'Change Language',
        persian: isRTL ? 'فارسی' : 'Persian',
        english: isRTL ? 'انگلیسی' : 'English'
    };
}

function rebuildTrayMenu() {
    if (!tray) return;
    
    const text = getTrayMenuText();
    const isPlaying = currentTrayState.isPlaying;
    const hasTrack = currentTrayState.currentTrack && currentTrayState.currentTrack.title;
    
    const menuTemplate = [
        {
            label: text.showApp,
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: text.miniPlayer,
            click: () => {
                if (mainWindow && currentTrayState.currentTrack) {
                    mainWindow.webContents.send('tray-open-mini-player', currentTrayState.currentTrack, isPlaying);
                } else if (mainWindow) {
                    mainWindow.webContents.send('tray-open-mini-player', null, false);
                }
                if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
                    miniPlayerWindow.show();
                }
            }
        },
        {
            label: text.cinematicMode,
            click: () => {
                if (mainWindow) {
                    mainWindow.webContents.send('tray-cinematic-mode');
                }
            }
        },
        {
            label: text.player,
            click: () => {
                if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
                    miniPlayerWindow.close();
                    miniPlayerWindow = null;
                }
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' }
    ];
    
    if (hasTrack) {
        const trackTitle = currentTrayState.currentTrack.title || 'Untitled';
        const trackArtist = currentTrayState.currentTrack.artist || '';
        const nowPlayingText = trackArtist ? `${trackTitle} - ${trackArtist}` : trackTitle;
        
        menuTemplate.push({
            label: `${text.nowPlaying} ${nowPlayingText}`,
            enabled: false
        });
        
        menuTemplate.push({
            label: isPlaying ? text.pause : text.play,
            click: () => {
                if (mainWindow) {
                    mainWindow.webContents.send('tray-toggle-playback');
                }
            }
        });
        
        menuTemplate.push(
            {
                label: text.previous,
                click: () => {
                    if (mainWindow) {
                        mainWindow.webContents.send('tray-previous-track');
                    }
                }
            },
            {
                label: text.next,
                click: () => {
                    if (mainWindow) {
                        mainWindow.webContents.send('tray-next-track');
                    }
                }
            }
        );
        
        menuTemplate.push({ type: 'separator' });
    }
    
    const languageSubmenu = [
        {
            label: text.english,
            type: 'radio',
            checked: currentLanguage === 'en',
            click: () => {
                saveTrayLanguage('en');
                rebuildTrayMenu();
                if (mainWindow) {
                    mainWindow.webContents.send('tray-change-language', 'en');
                }
            }
        },
        {
            label: text.persian,
            type: 'radio',
            checked: currentLanguage === 'fa',
            click: () => {
                saveTrayLanguage('fa');
                rebuildTrayMenu();
                if (mainWindow) {
                    mainWindow.webContents.send('tray-change-language', 'fa');
                }
            }
        }
    ];
    
    menuTemplate.push({
        label: text.language,
        submenu: languageSubmenu
    });
    
    menuTemplate.push({ type: 'separator' });
    menuTemplate.push({
        label: text.quit,
        click: () => {
            isQuitting = true;
            app.quit();
        }
    });
    
    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    tray.setContextMenu(contextMenu);
}

function updateTrayPlaybackState(isPlaying, track) {
    currentTrayState.isPlaying = isPlaying;
    currentTrayState.currentTrack = track;
    rebuildTrayMenu();
    
    if (tray) {
        let tooltip = 'KORAI Music Player';
        if (track && track.title) {
            const status = isPlaying ? '▶' : '⏸';
            tooltip = `${status} ${track.title} - ${track.artist || 'KORAI'}`;
        }
        tray.setToolTip(tooltip);
    }
}

async function createSystemTray() {
    await loadTrayLanguage();
    
    const possiblePaths = [
        path.join(__dirname, 'korai.png'),
        path.join(__dirname, 'icon.png'),
        path.join(__dirname, 'src/frontend/assets/icons/icon.png'),
        path.join(__dirname, 'assets/icon.png')
    ];
    
    let iconPath = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            iconPath = p;
            console.log('✅ Tray icon found at:', p);
            break;
        }
    }
    
    let trayIcon = null;
    if (iconPath && fs.existsSync(iconPath)) {
        const img = nativeImage.createFromPath(iconPath);
        trayIcon = img.resize({ width: 16, height: 16 });
    } else {
        console.log('⚠️ No tray icon found, creating fallback');
        const size = 16;
        const svg = Buffer.from(`
            <svg width="${size}" height="${size}" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="7" fill="#1db954" stroke="#ffffff" stroke-width="1"/>
                <circle cx="8" cy="8" r="3" fill="#ffffff"/>
            </svg>
        `);
        trayIcon = nativeImage.createFromBuffer(svg);
    }
    
    try {
        tray = new Tray(trayIcon);
        rebuildTrayMenu();
        
        tray.setToolTip('KORAI Music Player');
        
        tray.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        });
        
        tray.on('right-click', () => {
            tray.popUpContextMenu();
        });
        
        tray.on('double-click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
        
    } catch (e) {
        console.log('⚠️ Could not initialize tray icon:', e.message);
    }
}

// =============================================================================
// MAIN WINDOW CREATION
// =============================================================================

async function createWindow() {
    try {
        console.log('🚀 Creating Electron window...');
        
        const [port] = await findFreePort(3000, 3100);
        serverPort = port;
        console.log(`✅ Port found: ${serverPort}`);

        const userDataPath = app.getPath('userData');
        httpServer = await startServer(serverPort, userDataPath);
        console.log('✅ HTTP Server started');

        ipcMain.handle('get-server-port', () => {
            return serverPort;
        });

        mainWindow = new BrowserWindow({
            width: 1300,
            height: 850,
            minWidth: 1000,
            minHeight: 700,
            frame: false,
            show: true,
            titleBarStyle: 'default',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                zoomFactor: 0.4
            }
        });

        const setZoom = () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.setZoomFactor(0.4);
                mainWindow.webContents.setZoomLevel(-1.32);
            }
        };
        
        setZoom();
        
        mainWindow.webContents.on('before-input-event', (event, input) => {
            const isZoomShortcut = (input.control || input.meta) && 
                (input.key === '+' || input.key === '-' || input.key === '0' || 
                 input.key === '=' || input.key === '_');
            
            if (isZoomShortcut) {
                event.preventDefault();
                setZoom();
                return;
            }
        });

        mainWindow.webContents.on('zoom-changed', (event, zoomDirection) => {
            event.preventDefault();
            setZoom();
        });

        const htmlPath = path.join(__dirname, 'src/frontend/index.html');
        mainWindow.loadFile(htmlPath);

        mainWindow.webContents.on('did-finish-load', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-port', serverPort);
                setZoom();
                
                // Process any pending files that arrived before window loaded
                if (pendingFiles.length > 0) {
                    setTimeout(() => processPendingFiles(), 500);
                }
            }
        });

        mainWindow.on('close', (event) => {
            if (!isQuitting) {
                event.preventDefault();
                mainWindow.hide();
            }
        });

        mainWindow.on('closed', () => {
            mainWindow = null;
        });

        createSystemTray();

    } catch (err) {
        console.error('❌ Fatal error in createWindow:', err);
        dialog.showErrorBox('KORAI Error', `Failed to start application:\n${err.message}`);
        app.quit();
    }
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

ipcMain.on('tray-update-state', (event, { isPlaying, track }) => {
    updateTrayPlaybackState(isPlaying, track);
});

ipcMain.on('tray-language-changed', (event, lang) => {
    saveTrayLanguage(lang);
    rebuildTrayMenu();
});

// =============================================================================
// MINI-PLAYER FUNCTIONS
// =============================================================================

ipcMain.on('open-mini-player', (event, currentTrack, isPlaying) => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.show();
        miniPlayerWindow.focus();
        return;
    }

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;

    miniPlayerWindow = new BrowserWindow({
        width: 380,
        height: 68,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        roundedCorners: true,
        hasShadow: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        }
    });

    miniPlayerWindow.setBackgroundColor('#00000000');
    
    if (process.platform === 'win32') {
        miniPlayerWindow.setVisibleOnAllWorkspaces(true);
    }

    const setMiniZoom = () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.webContents.setZoomFactor(0.4);
            miniPlayerWindow.webContents.setZoomLevel(-1.32);
        }
    };
    
    setMiniZoom();

    miniPlayerWindow.setPosition(Math.floor((width - 380) / 2), 20);

    const htmlPath = path.join(__dirname, 'src/frontend/index.html');
    miniPlayerWindow.loadURL(`file://${htmlPath}?mode=mini`);

    miniPlayerWindow.webContents.on('did-finish-load', () => {
        if (lastTrackState && miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.webContents.send('state-updated', lastTrackState);
        }
        setMiniZoom();
        
        miniPlayerWindow.webContents.insertCSS(`
            html, body {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                border-radius: 32px;
                background: #0f2b1d;
            }
            body { -webkit-app-region: drag; }
            button { -webkit-app-region: no-drag; }
            .miniplayer-floating-card {
                width: 100%;
                height: 100%;
                border-radius: 32px;
                overflow: hidden;
                background: linear-gradient(135deg, #0f2b1d 0%, #0a1c24 100%);
            }
        `);
    });

    miniPlayerWindow.on('closed', () => {
        miniPlayerWindow = null;
        lastTrackState = null;
    });

    miniPlayerWindow.on('blur', () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed() && !miniPlayerWindow.isFocused()) {
            miniPlayerWindow.webContents.executeJavaScript(`
                document.body.style.opacity = '0.95';
            `).catch(() => {});
        }
    });
    
    miniPlayerWindow.on('focus', () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.webContents.executeJavaScript(`
                document.body.style.opacity = '1';
            `).catch(() => {});
        }
    });

    if (mainWindow) {
        mainWindow.hide();
    }
});

ipcMain.on('close-mini-player', () => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        lastTrackState = null;
        miniPlayerWindow.close();
        miniPlayerWindow = null;
    }
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
});

ipcMain.on('sync-state-to-mini', (event, data) => {
    lastTrackState = data;
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.webContents.send('state-updated', data);
    }
    updateTrayPlaybackState(data.isPlaying, data.track);
});

ipcMain.on('control-from-mini', (event, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('execute-control', command);
    }
});

// =============================================================================
// FILE DIALOG HANDLERS
// =============================================================================

ipcMain.handle('select-audio-files', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }
        ]
    });
    return result.filePaths;
});

async function scanDirAsync(dir, audioExtensions, files) {
    try {
        const list = await fs.promises.readdir(dir);
        await Promise.all(list.map(async (file) => {
            const fullPath = path.join(dir, file);
            const stat = await fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
                await scanDirAsync(fullPath, audioExtensions, files);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (audioExtensions.includes(ext)) {
                    files.push(fullPath);
                }
            }
        }));
    } catch (err) {
        console.error('Error scanning directory asynchronously:', err);
    }
}

ipcMain.handle('select-audio-folder', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    
    const folderPath = result.filePaths[0];
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
    const files = [];
    
    await scanDirAsync(folderPath, audioExtensions, files);
    return files;
});

// =============================================================================
// WINDOW CONTROL HANDLERS
// =============================================================================

ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('close-window', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.on('open-external', (event, url) => {
    const { shell } = require('electron');
    shell.openExternal(url);
});

// ===================== IPC HANDLERS FOR NEW FEATURES =====================

ipcMain.on('open-tag-editor', (event, trackId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-tag-editor', trackId);
    }
});

ipcMain.handle('advanced-search', async (event, query) => {
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/search/advanced`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        return await response.json();
    } catch (err) {
        console.error('Search error:', err);
        return { results: [] };
    }
});

ipcMain.handle('export-playlist', async (event, playlistId, format) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Playlist',
        defaultPath: `playlist.${format}`,
        filters: [
            { name: format.toUpperCase(), extensions: [format] }
        ]
    });
    
    if (result.canceled || !result.filePath) return null;
    
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/playlists/${playlistId}/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format, outputPath: result.filePath })
        });
        return await response.json();
    } catch (err) {
        console.error('Export error:', err);
        return null;
    }
});

ipcMain.handle('import-playlist', async (event, filePath, format) => {
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/playlists/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath, format })
        });
        return await response.json();
    } catch (err) {
        console.error('Import error:', err);
        return null;
    }
});

ipcMain.handle('export-library', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Library',
        defaultPath: `korai_library_${Date.now()}.csv`,
        filters: [
            { name: 'CSV', extensions: ['csv'] }
        ]
    });
    
    if (result.canceled || !result.filePath) return null;
    
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/library/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outputPath: result.filePath })
        });
        return await response.json();
    } catch (err) {
        console.error('Library export error:', err);
        return null;
    }
});

ipcMain.handle('parse-cue', async (event, cuePath) => {
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/cue/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cuePath })
        });
        return await response.json();
    } catch (err) {
        console.error('CUE parse error:', err);
        return null;
    }
});

ipcMain.handle('get-playback-settings', async () => {
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/playback/settings`);
        return await response.json();
    } catch (err) {
        return { gaplessEnabled: true, crossfadeDuration: 0 };
    }
});

ipcMain.handle('set-playback-settings', async (event, settings) => {
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/playback/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        return await response.json();
    } catch (err) {
        console.error('Settings error:', err);
        return null;
    }
});

ipcMain.on('set-crossfade', (event, duration) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('crossfade-changed', duration);
    }
});

ipcMain.handle('detect-real-bpm', async (event, trackId) => {
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/tracks/${trackId}/detect-bpm`, {
            method: 'POST'
        });
        return await response.json();
    } catch (err) {
        console.error('BPM detection error:', err);
        return { success: false, bpm: 120 };
    }
});

// =============================================================================
// APP LIFECYCLE
// =============================================================================

handleFileOpen();

app.whenReady().then(() => {
    createWindow();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (httpServer) {
            httpServer.close(() => {
                console.log('🛑 Server closed');
            });
        }
        app.quit();
    }
});