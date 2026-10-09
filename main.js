/* Electron main process. */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, screen, powerMonitor, session, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const findFreePort = require('find-free-port');
const { scanAudioDirectory } = require('./src/backend/folderScanner');
const { autoUpdater } = require('electron-updater');
const { normalizeReleaseVersion, isNewerRelease, supportsNativeUpdater } = require('./src/backend/updatePolicy');

// UPDATE SYSTEM IMPORTS

const updater = require('./src/backend/updater');
const updateManager = require('./src/backend/updateManager');

// OPTIONAL OPTIMIZATIONS

let cleanupTempFiles, clearCacheOnUpdate, createStartupTimer, managePowerState;
try {
    ({ cleanupTempFiles, clearCacheOnUpdate, createStartupTimer, managePowerState } = require('@yawlabs/electron-optimize'));
} catch (e) {
    console.warn('@yawlabs/electron-optimize not installed');
}

// PERFORMANCE / RENDERING
// Electron enables hardware acceleration by default. Avoid forcing experimental
// Chromium flags here: they can hurt stability, battery life, or driver compatibility.

// AUTO-UPDATER

const { startUpdateChecker, onUpdateCheck, getCurrentVersion } = updater;
let packagedUpdaterConfigured = false;
let packagedUpdateCheckPromise = null;
let packagedUpdateDownloaded = false;
let packagedUpdateTimer = null;

function usesNativeAutoUpdater() {
    return supportsNativeUpdater({
        platform: process.platform,
        isPackaged: app.isPackaged,
        execPath: process.execPath,
        env: process.env
    });
}

function shouldAutomaticallyCheckUpdates() {
    try {
        const { getDb } = require('./src/backend/database');
        return getDb().getSettings().autoUpdate !== false;
    } catch {
        // Settings may not be initialized during early startup; keep the default enabled.
        return true;
    }
}

async function checkPublishedReleaseUpdate() {
    const currentVersion = app.getVersion() || getCurrentVersion();
    const release = await updater.fetchGitHubJSON('https://api.github.com/repos/Behdad-kanaani/korai-player/releases/latest');
    if (!release || typeof release.tag_name !== 'string') {
        throw new Error('No published stable GitHub release was found.');
    }

    const latestVersion = normalizeReleaseVersion(release.tag_name);
    if (!latestVersion) throw new Error(`Invalid version tag in the latest GitHub release: ${release.tag_name}`);

    return {
        hasUpdate: isNewerRelease(latestVersion, currentVersion),
        currentVersion,
        latestVersion,
        canUpdate: false,
        autoDownload: false,
        source: 'github-release',
        url: 'https://github.com/Behdad-kanaani/korai-player/releases/latest'
    };
}

function sendPackagedUpdateStatus(status) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', status);
    }
}

function setupPackagedAutoUpdater() {
    if (packagedUpdaterConfigured || !usesNativeAutoUpdater()) return;
    packagedUpdaterConfigured = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.logger = console;

    autoUpdater.on('checking-for-update', () => {
        sendPackagedUpdateStatus({ checking: true, currentVersion: getCurrentVersion() });
    });
    autoUpdater.on('update-available', (info) => {
        sendPackagedUpdateStatus({
            hasUpdate: true,
            autoDownload: true,
            canUpdate: true,
            currentVersion: getCurrentVersion(),
            latestVersion: info.version
        });
    });
    autoUpdater.on('update-not-available', (info) => {
        packagedUpdateDownloaded = false;
        sendPackagedUpdateStatus({
            hasUpdate: false,
            currentVersion: getCurrentVersion(),
            latestVersion: info.version
        });
    });
    autoUpdater.on('download-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-progress', {
                status: 'downloading',
                progress: progress.percent,
                transferred: progress.transferred,
                total: progress.total,
                bytesPerSecond: progress.bytesPerSecond
            });
        }
    });
    autoUpdater.on('update-downloaded', (info) => {
        packagedUpdateDownloaded = true;
        sendPackagedUpdateStatus({
            hasUpdate: true,
            isDownloaded: true,
            canUpdate: true,
            currentVersion: getCurrentVersion(),
            latestVersion: info.version
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-progress', {
                status: 'downloaded',
                progress: 100,
                transferred: 1,
                total: 1
            });
        }
    });
    autoUpdater.on('error', (error) => {
        console.error('[updater] Packaged auto-update failed:', error);
        sendPackagedUpdateStatus({ hasUpdate: false, error: error.message });
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-progress', {
                status: 'error',
                progress: 0,
                message: error.message
            });
        }
    });
}

function checkPackagedUpdate() {
    if (packagedUpdateCheckPromise) return packagedUpdateCheckPromise;
    packagedUpdateCheckPromise = autoUpdater.checkForUpdates()
        .then((result) => {
            if (!result) {
                return { hasUpdate: false, currentVersion: getCurrentVersion() };
            }
            return {
                hasUpdate: result.isUpdateAvailable,
                autoDownload: result.isUpdateAvailable,
                isDownloaded: packagedUpdateDownloaded,
                canUpdate: true,
                currentVersion: getCurrentVersion(),
                latestVersion: result.updateInfo.version
            };
        })
        .finally(() => {
            packagedUpdateCheckPromise = null;
        });
    return packagedUpdateCheckPromise;
}

function startPackagedUpdateChecks() {
    if (packagedUpdateTimer) return;
    if (shouldAutomaticallyCheckUpdates()) {
        void checkPackagedUpdate().catch((error) => {
            console.warn('[updater] Initial packaged update check failed:', error.message);
        });
    }
    packagedUpdateTimer = setInterval(() => {
        if (!shouldAutomaticallyCheckUpdates()) return;
        void checkPackagedUpdate().catch((error) => {
            console.warn('[updater] Periodic packaged update check failed:', error.message);
        });
    }, 24 * 60 * 60 * 1000);
}

// GLOBAL ERROR HANDLERS

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

// SINGLE INSTANCE LOCK

const KORAI_SCHEME = 'korai';
const KORAI_HOST = 'app';
const FRONTEND_ROOT = path.resolve(__dirname, 'src', 'frontend');

protocol.registerSchemesAsPrivileged([{
    scheme: KORAI_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

let koraiProtocolRegistered = false;

function getAssetContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ({
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject'
    }[ext] || 'application/octet-stream');
}

function isPathInside(baseDir, candidatePath) {
    const base = path.resolve(baseDir);
    const candidate = path.resolve(candidatePath);
    const relative = path.relative(base, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function registerKoraiProtocol() {
    if (koraiProtocolRegistered) return;
    protocol.handle(KORAI_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            if (url.hostname !== KORAI_HOST) return new Response('Not found', { status: 404 });

            let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            if (!relativePath) relativePath = 'index.html';
            const candidate = path.resolve(FRONTEND_ROOT, relativePath);
            if (!isPathInside(FRONTEND_ROOT, candidate)) {
                return new Response('Forbidden', { status: 403 });
            }
            const stat = await fs.promises.stat(candidate).catch(() => null);
            if (!stat || !stat.isFile()) return new Response('Not found', { status: 404 });
            if (stat.size > 25 * 1024 * 1024) return new Response('Asset too large', { status: 413 });

            const data = await fs.promises.readFile(candidate);
            return new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': getAssetContentType(candidate),
                    'Cache-Control': /^text\/(html|javascript|css)$/.test(getAssetContentType(candidate)) ? 'no-cache, no-store, must-revalidate' : 'private, max-age=86400',
                    'X-Content-Type-Options': 'nosniff',
                    'Referrer-Policy': 'no-referrer'
                }
            });
        } catch (error) {
            console.error('[protocol] asset error:', error);
            return new Response('Internal asset error', { status: 500 });
        }
    });
    koraiProtocolRegistered = true;
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.debug('Another instance is already running. Exiting...');
    app.quit();
    process.exit(0);
}

// GLOBAL REFERENCES

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
let windowCreationPromise = null;
let updateListenerRegistered = false;

function isTrustedRenderer(event) {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed?.()) return false;
    return sender === mainWindow?.webContents || sender === miniPlayerWindow?.webContents;
}

function registerIpcListener(channel, handler) {
    ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedRenderer(event)) {
            console.warn(`[security] Blocked IPC listener: ${channel}`);
            return;
        }
        try {
            return handler(event, ...args);
        } catch (error) {
            console.error(`[ipc:${channel}]`, error);
        }
    });
}

function registerIpcHandler(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
        if (!isTrustedRenderer(event)) throw new Error('Untrusted IPC sender');
        return handler(event, ...args);
    });
}

const { startServer } = require('./src/backend/server');

let currentTrayState = {
    isPlaying: false,
    currentTrack: null
};

let currentLanguage = 'en';

// FILE ASSOCIATION HANDLING

async function processPendingFiles() {
    if (pendingFiles.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        const files = [...pendingFiles];
        pendingFiles = [];
        
        setTimeout(async () => {
            try {
                console.debug('Processing pending files:', files);
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
        console.debug('Files opened via command line:', files);
        pendingFiles = files;
    }
}

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    console.debug('File opened on macOS:', filePath);
    pendingFiles.push(filePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
        processPendingFiles();
    }
});

app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.debug('Second instance detected, focusing main window...');
    
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        
        const files = commandLine.slice(1).filter(arg => {
            if (arg.startsWith('--')) return false;
            if (arg.includes('electron')) return false;
            if (arg.includes('KORAI')) return false;
            try {
                return arg.match(/\.(mp3|wav|ogg|m4a|flac)$/i) && fs.existsSync(arg);
            } catch (e) {
                return false;
            }
        });
        
        if (files.length > 0) {
            console.debug('Files from second instance:', files);
            pendingFiles = files;
            processPendingFiles();
        }
    }
});

// SINGLE WINDOW CREATION HELPER

async function ensureWindowCreation() {
    if (windowCreationPromise) {
        return windowCreationPromise;
    }

    windowCreationPromise = (async () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            return mainWindow;
        }

        await createWindow();
        return mainWindow;
    })().finally(() => {
        windowCreationPromise = null;
    });

    return windowCreationPromise;
}

// TRAY ICON PATH HELPER

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
            console.debug('Tray icon found at:', p);
            return p;
        }
    }
    
    console.warn('No tray icon found');
    return null;
}

// TRAY MENU FUNCTIONS

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
            tooltip = `${track.title} - ${track.artist || 'KORAI'}`;
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
        console.warn('No tray icon found, creating fallback');
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
        console.warn('Could not initialize tray icon:', e.message);
    }
}

// SERVER HEALTH CHECK

function startHealthCheck() {
    if (healthCheckInterval) return;
    healthCheckInterval = setInterval(async () => {
        if (!serverPort) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        try {
            const response = await fetch(`http://127.0.0.1:${serverPort}/api/health`, { signal: controller.signal });
            if (!response.ok) console.warn('Server health check failed');
        } catch (err) {
            console.warn('Server health check error:', err?.message || err);
        } finally {
            clearTimeout(timer);
        }
    }, 30000);
}

function stopHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}

// SEND UPDATE STATUS TO RENDERER

async function sendUpdateStatusToRenderer() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const currentVersion = getCurrentVersion();
    mainWindow.webContents.send('app-version', { version: currentVersion || 'unknown', hasUpdate: false });

    if (!shouldAutomaticallyCheckUpdates()) {
        mainWindow.webContents.send('update-status', { hasUpdate: false, currentVersion, autoUpdateDisabled: true });
        return;
    }

    if (usesNativeAutoUpdater()) {
        try {
            const updateInfo = await checkPackagedUpdate();
            sendPackagedUpdateStatus(updateInfo);
        } catch (err) {
            sendPackagedUpdateStatus({ hasUpdate: false, currentVersion, error: err.message });
        }
        return;
    }

    if (app.isPackaged) {
        try {
            const updateInfo = await checkPublishedReleaseUpdate();
            mainWindow.webContents.send('update-status', updateInfo);
        } catch (err) {
            mainWindow.webContents.send('update-status', { hasUpdate: false, currentVersion, error: err.message, canUpdate: false });
        }
        return;
    }

    try {
        const updateInfo = await updater.fetchLatestVersion(true);
        mainWindow.webContents.send('update-status', {
            hasUpdate: updateInfo.hasUpdate || false,
            currentVersion: currentVersion || 'unknown',
            latestVersion: updateInfo.latestVersion || null,
            canUpdate: updateInfo.canUpdate !== false,
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

// MAIN WINDOW CREATION

async function initializeHttpServer(userDataPath) {
    if (httpServer && httpServer.listening) return httpServer;
    const maxAttempts = 5;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const [port] = await findFreePort(3000, 3100, '127.0.0.1');
        serverPort = port;
        console.debug(`Port candidate selected: ${serverPort} (attempt ${attempt}/${maxAttempts})`);

        try {
            httpServer = await startServer(serverPort, userDataPath);
            return;
        } catch (err) {
            lastError = err;
            console.warn(`Failed to bind server to 127.0.0.1:${serverPort}:`, err.code || err.message || err);
            if (attempt === maxAttempts || !['EADDRINUSE', 'EACCES', 'EAGAIN'].includes(err.code)) {
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    throw lastError || new Error('Unable to start HTTP server');
}

async function createWindow() {
    try {
        console.debug('Creating Electron window...');
        if (startupTimer && typeof startupTimer.mark === 'function') startupTimer.mark('creating-window');
        
        const userDataPath = app.getPath('userData');
        await seedBundledPlugins(app.getAppPath(), userDataPath);
        await initializeHttpServer(userDataPath);
        console.debug('HTTP Server started');
        
        // Start health check after server is running
        startHealthCheck();


        // Base window options
        const windowOptions = {
            width: 1360,
            height: 860,
            minWidth: 1080,
            minHeight: 680,
            center: true,
            frame: false,
            show: false,
            backgroundColor: '#090b0e',
            titleBarStyle: 'default',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                preload: path.join(__dirname, 'preload.js'),
                backgroundThrottling: true,
                v8CacheOptions: 'code',
                enablePreferredSizeMode: true
            }
        };

        mainWindow = new BrowserWindow(windowOptions);

        mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            openExternalSafely(url);
            return { action: 'deny' };
        });
        mainWindow.webContents.on('will-navigate', (event, url) => {
            if (!isTrustedAppUrl(url)) event.preventDefault();
        });

        mainWindow.webContents.on('before-input-event', (event, input) => {
            const isZoomShortcut = (input.control || input.meta) && 
                (input.key === '+' || input.key === '-' || input.key === '0' || 
                 input.key === '=' || input.key === '_');
            
            if (isZoomShortcut) {
                event.preventDefault();
                return;
            }
        });


        mainWindow.loadURL(`korai://${KORAI_HOST}/index.html`);

        mainWindow.once('ready-to-show', () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
        });

        mainWindow.webContents.on('did-finish-load', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-port', serverPort);
                sendUpdateStatusToRenderer();
                
                if (!updateListenerRegistered) {
                    onUpdateCheck((updateInfo) => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('update-status', {
                                hasUpdate: Boolean(updateInfo?.hasUpdate),
                                currentVersion: getCurrentVersion() || 'unknown',
                                latestVersion: updateInfo?.latestVersion || null,
                                url: updateInfo?.url || null,
                                canUpdate: updateInfo?.canUpdate !== false,
                                needsFullCheck: Boolean(updateInfo?.needsFullCheck),
                                error: updateInfo?.error || null
                            });
                        }
                    });
                    updateListenerRegistered = true;
                }

                if (pendingFiles.length > 0) {
                    setTimeout(() => processPendingFiles(), 500);
                }
            }
        });

        mainWindow.once('ready-to-show', () => {
            try {
                if (startupTimer && typeof startupTimer.flush === 'function') startupTimer.flush();
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
            } catch(e){}
        });

        mainWindow.on('close', (event) => {
            if (!isQuitting) {
                let stayInTray = true;
                
                try {
                    const userDataPath = app.getPath('userData');
                    const settingsPath = path.join(userDataPath, 'korai_data_v2.json');
                    
                    if (fs.existsSync(settingsPath)) {
                        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                        stayInTray = data.settings?.stayInTray !== false;
                    }
                } catch (err) {
                    stayInTray = true;
                }
                
                if (stayInTray) {
                    event.preventDefault();
                    mainWindow.hide();
                }
            }
        });

        mainWindow.on('closed', () => {
            mainWindow = null;
        });

        createSystemTray();
        
        if (usesNativeAutoUpdater()) {
            startPackagedUpdateChecks();
        } else if (!app.isPackaged && shouldAutomaticallyCheckUpdates()) {
            startUpdateChecker(24).catch((err) => {
                console.warn('Updater not available:', err && err.message ? err.message : err);
            });
        }

    } catch (err) {
        console.error('Fatal error in createWindow:', err);
        dialog.showErrorBox('KORAI Error', `Failed to start application:\n${err.message}`);
        app.quit();
    }
}

// IPC / EXTERNAL-URL SECURITY

function isTrustedAppUrl(input) {
    try {
        const url = new URL(input);
        return url.protocol === `${KORAI_SCHEME}:` && url.hostname === KORAI_HOST && isPathInside(FRONTEND_ROOT, path.resolve(FRONTEND_ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, '')));
    } catch {
        return false;
    }
}

function openExternalSafely(input) {
    try {
        const url = new URL(String(input));
        if (url.protocol !== 'https:') throw new Error('Only HTTPS external URLs are allowed');
        if (url.username || url.password) throw new Error('External URL credentials are not allowed');
        return shell.openExternal(url.toString());
    } catch (error) {
        console.warn('[security] Refused external URL:', error.message);
        return Promise.resolve(false);
    }
}

// Register once; createWindow() can be called again on macOS.
registerIpcHandler('get-server-port', () => serverPort);

// IPC HANDLERS

registerIpcListener('tray-update-state', (event, { isPlaying, track }) => {
    updateTrayPlaybackState(isPlaying, track);
});

registerIpcListener('tray-language-changed', (event, lang) => {
    saveTrayLanguage(lang);
    rebuildTrayMenu();
});

registerIpcListener('open-external', (event, url) => {
    void openExternalSafely(url);
});

registerIpcHandler('check-update-status', async (_event, options = {}) => {
    try {
        if (options.manual !== true && !shouldAutomaticallyCheckUpdates()) {
            return { hasUpdate: false, currentVersion: app.getVersion() || getCurrentVersion(), autoUpdateDisabled: true };
        }
        if (usesNativeAutoUpdater()) return await checkPackagedUpdate();
        if (app.isPackaged) return await checkPublishedReleaseUpdate();
        const result = await updateManager.checkAndPrepareUpdate();
        return result;
    } catch (err) {
        console.error('[main] Update check error:', err);
        return { hasUpdate: false, error: err.message };
    }
});

registerIpcListener('install-update', (event) => {
    if (!usesNativeAutoUpdater() || !packagedUpdateDownloaded) {
        event.sender.send('update-progress', {
            status: 'error',
            progress: 0,
            message: 'The update has not finished downloading.'
        });
        return;
    }
    autoUpdater.quitAndInstall(false, true);
});

registerIpcListener('apply-update', async (event, updateInfo) => {
    if (app.isPackaged) {
        event.sender.send('update-progress', {
            status: 'error',
            progress: 0,
            message: 'Packaged applications must be updated through the official release installer.'
        });
        return;
    }

    console.log('[main] Starting update application...');
    
    try {
        // Send initial progress
        event.sender.send('update-progress', {
            status: 'starting',
            progress: 0,
            message: 'Starting update...'
        });

        // Perform the update
        const result = await updateManager.performFullUpdate(updateInfo, (progress) => {
            // Forward progress to renderer
            event.sender.send('update-progress', progress);
        });

        if (result.success) {
            console.log('[main] Update completed successfully');
            
            // Send completion
            event.sender.send('update-progress', {
                status: 'complete',
                progress: 100,
                message: 'Update complete! Restarting...'
            });

            // Restart after a brief delay
            setTimeout(() => {
                app.relaunch();
                app.exit(0);
            }, 1500);
        } else {
            throw new Error('Update failed');
        }

    } catch (err) {
        console.error('[main] Update error:', err);
        event.sender.send('update-progress', {
            status: 'error',
            progress: 0,
            message: `Update failed: ${err.message}`
        });
    }
});

registerIpcHandler('get-update-progress', () => {
    return updater.getUpdateProgress();
});

registerIpcListener('restart-app', () => {
    app.relaunch();
    app.exit(0);
});

// MINI-PLAYER FUNCTIONS

registerIpcListener('open-mini-player', (event, currentTrack, isPlaying) => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.show();
        miniPlayerWindow.focus();
        return;
    }

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;

    miniPlayerWindow = new BrowserWindow({
        width: 460,
        height: 92,
        frame: false,
        transparent: false,
        backgroundColor: '#0a0a0a',
        roundedCorners: true,
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: true,
            v8CacheOptions: 'code'
        }
    });

    miniPlayerWindow.webContents.setWindowOpenHandler(({ url }) => {
        openExternalSafely(url);
        return { action: 'deny' };
    });
    miniPlayerWindow.webContents.on('will-navigate', (event, url) => {
        if (!isTrustedAppUrl(url)) event.preventDefault();
    });

    miniPlayerWindow.setBackgroundColor('#0a0a0a');
    
    if (process.platform === 'win32') {
        miniPlayerWindow.setVisibleOnAllWorkspaces(true);
    }

    miniPlayerWindow.setPosition(Math.floor((width - 460) / 2), 18);

    miniPlayerWindow.loadURL(`korai://${KORAI_HOST}/index.html?mode=mini`);

    miniPlayerWindow.webContents.on('did-finish-load', () => {
        if (lastTrackState && miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.webContents.send('state-updated', lastTrackState);
        }
        miniPlayerWindow.webContents.insertCSS(`
            html, body {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
                border-radius: 18px;
                background: #0a0a0a !important;
            }
            body { -webkit-app-region: drag; }
            button { -webkit-app-region: no-drag; }
            .hero-ambient-glow, .hero-particle, .hero-particle-field { display: none !important; }
            .miniplayer-floating-card {
                position: fixed !important;
                inset: 0 !important;
                width: 100% !important;
                max-width: none !important;
                height: 100% !important;
                border-radius: 0 !important;
                overflow: hidden;
                background: #0d1114 !important;
                background-image: none !important;
                box-shadow: none !important;
                border: 0 !important;
            }
            .cover-glow-effect, .mini-timeline-progress { box-shadow: none !important; }
            .mini-timeline-fill { background: #20d968 !important; }
            .miniplayer-glass-content { box-sizing: border-box; height: calc(100% - 3px); padding: 10px 14px !important; gap: 12px !important; }
            .mini-art-box { width: 52px !important; height: 52px !important; flex: 0 0 52px !important; border-radius: 11px !important; }
            .mini-track-info { min-width: 0; }
            .mini-track-info h5 { font-size: 12px !important; }
            .mini-track-info p { font-size: 9px !important; }
            .mini-controls { margin-left: auto; gap: 4px !important; }
            .mini-timeline-bar { height: 3px !important; background: #252d31 !important; }
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

registerIpcListener('close-mini-player', () => {
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

registerIpcListener('sync-state-to-mini', (event, data) => {
    lastTrackState = data;
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
        miniPlayerWindow.webContents.send('state-updated', data);
    }
    updateTrayPlaybackState(data.isPlaying, data.track);
});

registerIpcListener('control-from-mini', (event, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('execute-control', command);
    }
});

// FILE DIALOG HANDLERS

registerIpcHandler('select-audio-files', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma'] }
        ]
    });
    return result.filePaths;
});

registerIpcHandler('select-audio-folder', async (event) => {
    if (!mainWindow) return [];

    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'],
            title: 'Select a folder to scan for audio files',
            buttonLabel: 'Scan Folder'
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) return [];

        const folderPath = result.filePaths[0];
        console.debug(`[scan] Starting recursive scan of folder: ${folderPath}`);

        const files = await scanAudioDirectory(folderPath, {
            onWarning: (message, error) => console.warn(message, error && error.message ? error.message : ''),
            onProgress: (currentDirectory) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('scan-progress', currentDirectory);
                }
            }
        });

        console.debug(`[scan] Found ${files.length} audio files in ${folderPath} (including nested subfolders)`);

        if (files.length === 0 && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scan-no-files-found', folderPath);
        }

        return files;
    } catch (error) {
        console.error('[scan] Folder selection error:', error);
        throw new Error(`Could not scan the selected music folder: ${error.message}`, { cause: error });
    }
});

// WINDOW CONTROL HANDLERS

registerIpcListener('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
});

registerIpcListener('maximize-window', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

registerIpcListener('close-window', () => {
    if (mainWindow) mainWindow.close();
});

// TAG EDITOR HANDLER

registerIpcListener('open-tag-editor', (event, trackId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-tag-editor', trackId);
    }
});

// ADVANCED SEARCH HANDLER

registerIpcHandler('advanced-search', async (event, query) => {
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

// PLAYLIST EXPORT/IMPORT HANDLERS

registerIpcHandler('export-playlist', async (event, playlistId, format) => {
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

registerIpcHandler('import-playlist', async (event, filePath, format) => {
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

// LIBRARY EXPORT HANDLER

registerIpcHandler('export-library', async () => {
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

// CUE SHEET HANDLER

registerIpcHandler('parse-cue', async (event, cuePath) => {
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

// PLAYBACK SETTINGS HANDLERS

registerIpcHandler('get-playback-settings', async () => {
    try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/api/playback/settings`);
        return await response.json();
    } catch (err) {
        return { gaplessEnabled: true, crossfadeDuration: 0 };
    }
});

registerIpcHandler('set-playback-settings', async (event, settings) => {
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

registerIpcListener('set-crossfade', (event, duration) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('crossfade-changed', duration);
    }
});

// REAL BPM DETECTION HANDLER

registerIpcHandler('detect-real-bpm', async (event, trackId) => {
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

// GLOBAL SHORTCUT HANDLER

registerIpcListener('register-global-shortcut', (event, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('global-shortcut', command);
    }
});

registerIpcHandler('import-playlist-auto', async (event, filePath) => {
    try {
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

registerIpcHandler('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
});

registerIpcHandler('get-data-path', () => {
    return app.getPath('userData');
});

registerIpcHandler('get-app-version', () => {
    return app.getVersion();
});

registerIpcListener('open-folder', (event, folderPath) => {
    if (!folderPath || typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) return;
    try {
        const stat = fs.statSync(folderPath);
        if (stat.isDirectory()) {
            void shell.openPath(folderPath);
        } else if (stat.isFile()) {
            shell.showItemInFolder(folderPath);
        }
    } catch (error) {
        console.warn('[open-folder] Unable to open path:', error.message);
    }
});

// APP LIFECYCLE

handleFileOpen();

app.whenReady().then(async () => {
    registerKoraiProtocol();
    setupPackagedAutoUpdater();
    try {
        if (createStartupTimer) {
            try { startupTimer = createStartupTimer(); startupTimer.mark && startupTimer.mark('main-process-init'); } catch(e){}
        }

        if (managePowerState) {
            try {
                powerCleanup = managePowerState(powerMonitor, {
                    resumeDelayMs: 4000,
                    onSuspend() {
                        console.debug('System suspend detected - pausing timers');
                        if (updatePollingTimer) {
                            clearInterval(updatePollingTimer);
                            updatePollingTimer = null;
                        }
                    },
                    onResume() {
                        console.debug('System resume detected - restarting timers after network stabilizes');
                    }
                });
            } catch (e) { console.warn('managePowerState failed:', e && e.message); }
        }

        if (cleanupTempFiles) {
            try {
                const userDataPath = app.getPath('userData');
                const removedCount = cleanupTempFiles(userDataPath, {
                    subdirs: ['Network', 'Session Storage'],
                    extensions: ['.tmp']
                });
                if (removedCount > 0) console.debug(`Removed ${removedCount} stale temp files`);
            } catch (e) { console.warn('cleanupTempFiles failed:', e && e.message); }
        }

        if (clearCacheOnUpdate) {
            try {
                const cacheResult = await clearCacheOnUpdate(
                    app.getPath('userData'),
                    app.getVersion(),
                    session && session.defaultSession,
                    { clearCacheStorage: true, clearHttpCache: true, versionFilename: '.last-version' }
                );
                if (cacheResult && cacheResult.versionChanged) {
                    console.debug(`Version changed ${cacheResult.previousVersion} -> ${cacheResult.currentVersion}, cleared browser cache.`);
                }
            } catch (e) {
                console.warn('clearCacheOnUpdate failed:', e && e.message);
            }
        }
    } catch (err) {
        console.warn('Startup optimizations failed:', err && err.message);
    }

    await ensureWindowCreation();

    // Check if restart is required after update
    const restartInfo = updateManager.isRestartRequired();
    if (restartInfo) {
        console.log('[main] Pending restart detected:', restartInfo);
        updateManager.clearRestartFlag();
        
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-status', {
                    hasUpdate: false,
                    currentVersion: updater.getCurrentVersion(),
                    message: 'Update applied successfully',
                    updated: true
                });
            }
        }, 3000);
    }

});

app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        await ensureWindowCreation();
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
                console.debug('Server closed');
            });
        }
        app.quit();
    }
});