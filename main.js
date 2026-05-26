// ################################################################################
// #                                                                              #
// #                           WRITTEN BY BEHDAD KANANI                            #
// ##                         github.com/Behdad-kanaani/korai-player               #
// #                                                                              #
// #   Description:                                                               #
// #       KORAI Music Player - Electron Main Process                             #
// #       Handles window creation, IPC communication, system tray,              #
// #       file dialogs, and mini-player window management.                      #
// #                                                                              #
// #   Features:                                                                 #
// #       - Custom frameless window with title bar controls                     #
// #       - HTTP server integration for API endpoints                           #
// #       - Mini-player window with always-on-top behavior                      #
// #       - System tray with show/quit options                                  #
// #       - Recursive folder scanning for audio files                           #
// #       - IPC bridge between renderer and main process                        #
// #                                                                              #
// ################################################################################

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const findFreePort = require('find-free-port');

// Global references to prevent garbage collection
let mainWindow;
let miniPlayerWindow = null;
let httpServer;
let serverPort;
let tray = null;
let isQuitting = false;

// Import the backend HTTP server
const { startServer } = require('./src/backend/server');

/**
 * Creates the main application window
 * Sets up frameless window with custom title bar
 * Initializes HTTP server on available port
 */
async function createWindow() {
    try {
        console.log('🚀 Creating Electron window...');
        
        // Find an available port between 3000-3100
        const [port] = await findFreePort(3000, 3100);
        serverPort = port;
        console.log(`✅ Port found: ${serverPort}`);

        // Start the HTTP server with user data path
        const userDataPath = app.getPath('userData');
        httpServer = await startServer(serverPort, userDataPath);
        console.log('✅ HTTP Server started');

        // Expose port to renderer process
        ipcMain.handle('get-server-port', () => {
            return serverPort;
        });

        // Create the main browser window
        mainWindow = new BrowserWindow({
            width: 1300,
            height: 850,
            minWidth: 1000,
            minHeight: 700,
            frame: false,           // Custom frameless window
            show: true,
            titleBarStyle: 'default',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                zoomFactor: 0.4
            }
        });

        // Prevent zooming with Ctrl+/- shortcuts
        const setZoom = () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.setZoomFactor(0.4);
                mainWindow.webContents.setZoomLevel(-1.32);
            }
        };
        
        setZoom();
        
        // Block browser zoom shortcuts
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

        // Prevent zoom events
        mainWindow.webContents.on('zoom-changed', (event, zoomDirection) => {
            event.preventDefault();
            setZoom();
        });

        // Load the HTML file
        const htmlPath = path.join(__dirname, 'src/frontend/index.html');
        mainWindow.loadFile(htmlPath);

        // Send server port to renderer after load
        mainWindow.webContents.on('did-finish-load', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('server-port', serverPort);
                setZoom();
            }
        });

        // Handle window close - hide to tray instead of quit
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

/**
 * Opens the mini-player window
 * Creates a compact, always-on-top window for minimal playback control
 */
ipcMain.on('open-mini-player', (event, currentTrack, isPlaying) => {
    if (miniPlayerWindow) {
        miniPlayerWindow.show();
        return;
    }

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;

    // Create mini-player window (compact size, transparent)
    miniPlayerWindow = new BrowserWindow({
        width: 380,
        height: 68,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            zoomFactor: 0.4
        }
    });

    const setMiniZoom = () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.webContents.setZoomFactor(0.4);
            miniPlayerWindow.webContents.setZoomLevel(-1.32);
        }
    };
    
    setMiniZoom();

    // Position at top center of screen
    miniPlayerWindow.setPosition(Math.floor((width - 380) / 2), 20);

    // Load with mini mode query parameter
    const htmlPath = path.join(__dirname, 'src/frontend/index.html');
    miniPlayerWindow.loadURL(`file://${htmlPath}?mode=mini`);

    // Send current track state to mini-player
    miniPlayerWindow.webContents.on('did-finish-load', () => {
        if (lastTrackState && miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.webContents.send('state-updated', lastTrackState);
        }
        setMiniZoom();
    });

    miniPlayerWindow.on('closed', () => {
        miniPlayerWindow = null;
    });

    // Hide main window when mini-player opens
    if (mainWindow) {
        mainWindow.hide();
    }
});

// Close mini-player and show main window
ipcMain.on('close-mini-player', () => {
    if (miniPlayerWindow) {
        miniPlayerWindow.close();
        miniPlayerWindow = null;
    }
    if (mainWindow) {
        mainWindow.show();
    }
});

// Store last track state for sync
let lastTrackState = null;

// Sync playback state to mini-player
ipcMain.on('sync-state-to-mini', (event, data) => {
    lastTrackState = data;
    if (miniPlayerWindow && !miniWindow.isDestroyed()) {
        miniPlayerWindow.webContents.send('state-updated', data);
    }
});

// Forward control commands from mini-player to main window
ipcMain.on('control-from-mini', (event, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('execute-control', command);
    }
});

/**
 * Creates system tray icon with context menu
 * Allows showing app or quitting from tray
 */
function createSystemTray() {
    const possiblePaths = [
        path.join(__dirname, 'src/frontend/assets/icons/tray_icon.png'),
        path.join(__dirname, 'icon.png'),
        path.join(__dirname, 'korai.png')
    ];
    
    let iconPath = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            iconPath = p;
            break;
        }
    }
    
    if (!iconPath) {
        console.log('⚠️ No tray icon found. Tray not created.');
        return;
    }
    
    try {
        tray = new Tray(iconPath);
        const contextMenu = Menu.buildFromTemplate([
            { 
                label: 'Show App', 
                click: () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                } 
            },
            { type: 'separator' },
            { 
                label: 'Quit', 
                click: () => {
                    isQuitting = true;
                    app.quit();
                } 
            }
        ]);

        tray.setToolTip('KORAI Premium Player');
        tray.setContextMenu(contextMenu);

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

// App lifecycle handlers
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

/**
 * File dialog handler for selecting audio files
 * Returns array of file paths for MP3, WAV, OGG, M4A, FLAC
 */
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

/**
 * Recursive directory scanner for audio files
 * Non-blocking async implementation
 */
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

/**
 * Folder selection dialog handler
 * Recursively scans selected folder for all audio files
 */
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

// Window control handlers
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

// Open external links in default browser
ipcMain.on('open-external', (event, url) => {
    const { shell } = require('electron');
    shell.openExternal(url);
});