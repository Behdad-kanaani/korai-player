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

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, screen, powerMonitor, session } = require('electron');
const path = require('path');
const fs = require('fs');
const findFreePort = require('find-free-port');

// Optional: electron-optimize helpers (safe require)
let cleanupTempFiles, clearCacheOnUpdate, validateWindowBounds, createStartupTimer, managePowerState;
try {
    ({ cleanupTempFiles, clearCacheOnUpdate, validateWindowBounds, createStartupTimer, managePowerState } = require('@yawlabs/electron-optimize'));
} catch (e) {
    console.warn('⚠️ @yawlabs/electron-optimize not installed; run `npm install @yawlabs/electron-optimize` to enable additional optimizations');
}

// Performance: prefer GPU rasterization and relax GPU blocklist where safe
try {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    // Additional GPU / renderer flags to improve rendering performance where available
    app.commandLine.appendSwitch('enable-features', 'Vulkan,UseSkiaRenderer');
    app.commandLine.appendSwitch('enable-accelerated-video-decode');
    // Increase V8 memory cap for large libraries / analysis tasks
    app.commandLine.appendSwitch('max_old_space_size', '4096');
} catch (e) {
    // app may not be ready yet in some contexts; ignore if not available
}

// =============================================================================
// AUTO-UPDATER
// =============================================================================
const { startUpdateChecker, onUpdateCheck, getCurrentVersion, fetchLatestVersion } = require('./src/backend/updater');

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
    console.debug('Another instance is already running. Exiting...');
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
let healthCheckInterval = null;
let startupTimer = null;
let updatePollingTimer = null;
let powerCleanup = null;

const { startServer } = require('./src/backend/server');

let currentTrayState = {
    isPlaying: false,
    currentTrack: null
};

let currentLanguage = 'en';

// =============================================================================
// FILE ASSOCIATION HANDLING
// =============================================================================

async function processPendingFiles() {
    if (pendingFiles.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        const files = [...pendingFiles];
        pendingFiles = [];
        
        setTimeout(async () => {
            try {
                console.debug('📁 Processing pending files:', files);
                mainWindow.webContents.send('files-opened', files);
            } catch (err) {
                console.error('Error processing opened files:', err);
            }
        }, 1000);
    }
}

function handleFileOpen() {
    const files = process.argv.slice(1).filter(arg => {
        return arg.match(/\.(mp3|wav|ogg|m4a|flac)$/i) && 
               !arg.includes('.exe') && 
               !arg.includes('electron') &&
               !arg.includes('KORAI') &&
               !arg.includes('korai') &&
               !arg.includes('Player') &&
               !arg.includes('player');
    });
    
    if (files.length > 0) {
        console.debug('📁 Files opened via command line:', files);
        pendingFiles = files;
    }
}

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    console.debug('📁 File opened on macOS:', filePath);
    pendingFiles.push(filePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
        processPendingFiles();
    }
});

app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.debug('🔄 Second instance detected, focusing main window...');
    
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
            console.debug('📁 Files from second instance:', files);
            pendingFiles = files;
            processPendingFiles();
        }
    }
});

// =============================================================================
// TRAY ICON PATH HELPER
// =============================================================================

function getTrayIconPath() {
    const possiblePaths = [
        path.join(__dirname, 'korai.png'),
        path.join(__dirname, 'icon.png'),
        path.join(process.resourcesPath, 'korai.png'),
        path.join(process.resourcesPath, 'icon.png'),
        path.join(app.getAppPath(), 'korai.png'),
        path.join(app.getAppPath(), 'icon.png'),
        path.join(__dirname, 'src/frontend/assets/icons/icon.png'),
        path.join(app.getAppPath(), 'src/frontend/assets/icons/icon.png')
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            console.debug('✅ Tray icon found at:', p);
            return p;
        }
    }
    
    console.warn('⚠️ No tray icon found');
    return null;
}

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
        console.error('Could not load language setting:', err);
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
        console.error('Could not save language setting:', err);
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
    
    const iconPath = getTrayIconPath();
    
    let trayIcon = null;
    if (iconPath && fs.existsSync(iconPath)) {
        const img = nativeImage.createFromPath(iconPath);
        trayIcon = img.resize({ width: 16, height: 16 });
    } else {
    console.warn('⚠️ No tray icon found, creating fallback');
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
        console.warn('⚠️ Could not initialize tray icon:', e.message);
    }
}

// =============================================================================
// SERVER HEALTH CHECK
// =============================================================================

function startHealthCheck() {
    healthCheckInterval = setInterval(async () => {
        try {
            const fetchModule = await import('node-fetch');
            const fetch = fetchModule.default;
            const response = await fetch(`http://127.0.0.1:${serverPort}/api/health`);
            if (!response.ok) {
                console.warn('⚠️ Server health check failed');
            }
        } catch (err) {
            console.error('❌ Server appears to be down!');
        }
    }, 30000);
}

function stopHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}

// =============================================================================
// SEND UPDATE STATUS TO RENDERER
// =============================================================================

async function sendUpdateStatusToRenderer() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    
    const currentVersion = getCurrentVersion();
    
    // Send current version first
    mainWindow.webContents.send('app-version', { 
        version: currentVersion || 'unknown',
        hasUpdate: false 
    });
    
    try {
        const updateInfo = await fetchLatestVersion(true);
        mainWindow.webContents.send('update-status', {
            hasUpdate: updateInfo.hasUpdate || false,
            currentVersion: currentVersion || 'unknown',
            latestVersion: updateInfo.version || null,
            url: updateInfo.url || null,
            error: updateInfo.error || null
        });
    } catch (err) {
        console.error('Failed to fetch update status:', err);
        mainWindow.webContents.send('update-status', {
            hasUpdate: false,
            currentVersion: currentVersion || 'unknown',
            latestVersion: null,
            error: err.message
        });
    }
}

async function seedBundledPlugins(appPath, userDataPath) {
    try {
        const src = path.join(appPath, 'plugins');
        const dest = path.join(userDataPath, 'plugins');
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(dest, { recursive: true });
        const dirs = fs.readdirSync(src, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const d of dirs) {
            const srcDir = path.join(src, d.name);
            const destDir = path.join(dest, d.name);
            if (!fs.existsSync(destDir)) {
                try {
                    fs.cpSync(srcDir, destDir, { recursive: true });
                } catch (e) {
                    // fallback: copy file-by-file
                    const files = fs.readdirSync(srcDir);
                    fs.mkdirSync(destDir, { recursive: true });
                    for (const f of files) {
                        const s = path.join(srcDir, f);
                        const t = path.join(destDir, f);
                        try { fs.copyFileSync(s, t); } catch (_) {}
                    }
                }
            }
        }
    } catch (e) {
        console.warn('seedBundledPlugins failed:', e && e.message);
    }
}

// =============================================================================
// MAIN WINDOW CREATION
// =============================================================================

async function createWindow() {
    try {
        console.debug('🚀 Creating Electron window...');
        if (startupTimer && typeof startupTimer.mark === 'function') startupTimer.mark('creating-window');
        
        const [port] = await findFreePort(3000, 3100);
        serverPort = port;
        console.debug(`✅ Port found: ${serverPort}`);

        const userDataPath = app.getPath('userData');
        await seedBundledPlugins(app.getAppPath(), userDataPath);
        httpServer = await startServer(serverPort, userDataPath);
        console.debug('✅ HTTP Server started');
        
        // Start health check after server is running
        startHealthCheck();

        ipcMain.handle('get-server-port', () => {
            return serverPort;
        });

        // Base window options
        const windowOptions = {
            width: 1300,
            height: 850,
            minWidth: 1000,
            minHeight: 700,
            frame: false,
            show: false,
            titleBarStyle: 'default',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                zoomFactor: 0.4,
                // Allow Electron to throttle when backgrounded to save resources
                backgroundThrottling: true,
                // Enable V8 bytecode caching for faster subsequent launches
                v8CacheOptions: 'code',
                // Minor renderer hints
                enableBlinkFeatures: 'OverlayScrollbars',
                enablePreferredSizeMode: true
            }
        };

        // Platform-specific visual improvements (safe defaults)
        if (process.platform === 'darwin') {
            windowOptions.transparent = true;
            windowOptions.vibrancy = 'under-window';
        } else if (process.platform === 'win32') {
            // Windows 11 background material (falls back harmlessly on older Windows)
            windowOptions.transparent = true;
            windowOptions.backgroundMaterial = 'mica';
        }

        mainWindow = new BrowserWindow(windowOptions);

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
                
                // Send version and update status to renderer
                sendUpdateStatusToRenderer();
                
                // Register for future update notifications
                onUpdateCheck((updateInfo) => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        const currentVersion = getCurrentVersion();
                        mainWindow.webContents.send('update-status', {
                            hasUpdate: updateInfo.hasUpdate || false,
                            currentVersion: currentVersion || 'unknown',
                            latestVersion: updateInfo.version || null,
                            url: updateInfo.url || null,
                            error: updateInfo.error || null
                        });
                    }
                });
                
                if (pendingFiles.length > 0) {
                    setTimeout(() => processPendingFiles(), 500);
                }
            }
        });

        // Show window only when ready to avoid multiple repaints
        mainWindow.once('ready-to-show', () => {
            try {
                if (startupTimer && typeof startupTimer.flush === 'function') startupTimer.flush();
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
            } catch(e){}
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
        
        // Start auto-updater (silent, non-blocking)
        try {
            startUpdateChecker(24);
        } catch (err) {
            console.warn('Updater not available:', err.message);
        }

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

ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
});

// Handler for renderer to check update status on demand
ipcMain.handle('check-update-status', async () => {
    const currentVersion = getCurrentVersion();
    const updateInfo = await fetchLatestVersion(true);
    return {
        hasUpdate: updateInfo.hasUpdate || false,
        currentVersion: currentVersion || 'unknown',
        latestVersion: updateInfo.version || null,
        url: updateInfo.url || null,
        error: updateInfo.error || null
    };
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
        transparent: false,
        backgroundColor: '#0a0a0a',
        roundedCorners: true,
        // Use no native shadow so the rounded inner card shadow is visible
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: true,
            v8CacheOptions: 'code'
        }
    });

    miniPlayerWindow.setBackgroundColor('#0a0a0a');
    
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
                background: #0a0a0a !important;
            }
            body { -webkit-app-region: drag; }
            button { -webkit-app-region: no-drag; }
            /* Remove green decorative elements and use a neutral dark background for mini window */
            .hero-ambient-glow, .hero-particle, .hero-particle-field { display: none !important; }
            .miniplayer-floating-card {
                width: 100%;
                height: 100%;
                border-radius: 32px;
                overflow: hidden;
                background: rgba(6,8,10,0.88) !important;
                background-image: none !important;
                box-shadow: 0 10px 30px rgba(0,0,0,0.6), 0 2px 10px rgba(0,0,0,0.35) inset;
                border: 1px solid rgba(255,255,255,0.04);
            }
            /* Ensure any accent glow inside the mini window is muted */
            .cover-glow-effect, .mini-timeline-progress, .mini-timeline-fill { box-shadow: none !important; background: rgba(255,255,255,0.04) !important; }
        `);
    });

    miniPlayerWindow.once('ready-to-show', ()=>{
        try{ if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.show(); }catch(e){}
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
        
        for (const file of list) {
            const fullPath = path.join(dir, file);
            let stat;
            try {
                stat = await fs.promises.stat(fullPath);
            } catch (err) {
                console.warn(`Cannot access: ${fullPath}`, err.message);
                continue; // Skip unreadable files
            }
            
            if (stat.isDirectory()) {
                await scanDirAsync(fullPath, audioExtensions, files);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (audioExtensions.includes(ext)) {
                    files.push(fullPath);
                    console.debug(`Found audio file: ${fullPath}`);
                }
            }
        }
    } catch (err) {
        console.error(`Error scanning directory ${dir}:`, err.message);
        // Don't re-throw - continue with files found so far
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
    
    console.debug(`Scanning folder: ${folderPath}`);
    
    await scanDirAsync(folderPath, audioExtensions, files);
    
    console.debug(`Found ${files.length} audio files in ${folderPath}`);
    
    // Show warning if no files found
    if (files.length === 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-no-files-found', folderPath);
    }
    
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

// =============================================================================
// TAG EDITOR HANDLER
// =============================================================================

ipcMain.on('open-tag-editor', (event, trackId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-tag-editor', trackId);
    }
});

// =============================================================================
// ADVANCED SEARCH HANDLER
// =============================================================================

ipcMain.handle('advanced-search', async (event, query) => {
    try {
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
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

// =============================================================================
// PLAYLIST EXPORT/IMPORT HANDLERS
// =============================================================================

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
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
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
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
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

// =============================================================================
// LIBRARY EXPORT HANDLER
// =============================================================================

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
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
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

// =============================================================================
// CUE SHEET HANDLER
// =============================================================================

ipcMain.handle('parse-cue', async (event, cuePath) => {
    try {
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
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

// =============================================================================
// PLAYBACK SETTINGS HANDLERS
// =============================================================================

ipcMain.handle('get-playback-settings', async () => {
    try {
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/playback/settings`);
        return await response.json();
    } catch (err) {
        return { gaplessEnabled: true, crossfadeDuration: 0 };
    }
});

ipcMain.handle('set-playback-settings', async (event, settings) => {
    try {
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
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

// =============================================================================
// REAL BPM DETECTION HANDLER
// =============================================================================

ipcMain.handle('detect-real-bpm', async (event, trackId) => {
    try {
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
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
// GLOBAL SHORTCUT HANDLER
// =============================================================================

ipcMain.on('register-global-shortcut', (event, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('global-shortcut', command);
    }
});


ipcMain.handle('import-playlist-auto', async (event, filePath) => {
    try {
        const fetchModule = await import('node-fetch');
        const fetch = fetchModule.default;
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/playlists/import-auto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath })
        });
        return await response.json();
    } catch (err) {
        console.error('Auto import error:', err);
        return null;
    }
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
});

// =============================================================================
// APP LIFECYCLE
// =============================================================================

handleFileOpen();

app.whenReady().then(async () => {
    try {
        // Startup telemetry
        if (createStartupTimer) {
            try { startupTimer = createStartupTimer(); startupTimer.mark && startupTimer.mark('main-process-init'); } catch(e){}
        }

        // Power state management (safe guard if function available)
        if (managePowerState) {
            try {
                powerCleanup = managePowerState(powerMonitor, {
                    resumeDelayMs: 4000,
                    onSuspend() {
                        console.debug('🔄 System suspend detected - pausing timers');
                        if (updatePollingTimer) {
                            clearInterval(updatePollingTimer);
                            updatePollingTimer = null;
                        }
                    },
                    onResume() {
                        console.debug('⚡ System resume detected - restarting timers after network stabilizes');
                        if (!updatePollingTimer) {
                            updatePollingTimer = setInterval(() => {
                                // user-specific periodic checks could be placed here
                            }, 60000);
                        }
                    }
                });
            } catch (e) { console.warn('managePowerState failed:', e && e.message); }
        }

        // Cleanup Chromium temp files (if helper present)
        if (cleanupTempFiles) {
            try {
                const userDataPath = app.getPath('userData');
                const removedCount = cleanupTempFiles(userDataPath, {
                    subdirs: ['Network', 'Session Storage'],
                    extensions: ['.tmp']
                });
                if (removedCount > 0) console.debug(`🧹 Removed ${removedCount} stale temp files`);
            } catch (e) { console.warn('cleanupTempFiles failed:', e && e.message); }
        }

        // Smart cache clearing on version change
        if (clearCacheOnUpdate) {
            try {
                const cacheResult = await clearCacheOnUpdate(
                    app.getPath('userData'),
                    app.getVersion(),
                    session && session.defaultSession,
                    { clearCacheStorage: true, clearHttpCache: true, versionFilename: '.last-version' }
                );
                if (cacheResult && cacheResult.versionChanged) {
                    console.debug(`📈 Version changed ${cacheResult.previousVersion} -> ${cacheResult.currentVersion}, cleared browser cache.`);
                }
            } catch (e) {
                console.warn('clearCacheOnUpdate failed:', e && e.message);
            }
        }
    } catch (err) {
        console.warn('Startup optimizations failed:', err && err.message);
    }

    createWindow();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    stopHealthCheck();
    try { if (powerCleanup) powerCleanup(); } catch (e) {}
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        stopHealthCheck();
        if (httpServer) {
            httpServer.close(() => {
                console.debug('🛑 Server closed');
            });
        }
        app.quit();
    }
});