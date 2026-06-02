/**
 * updater.js - Automatic update checker
 * 
 * Checks for updates by comparing local package.json version with
 * the raw package.json from GitHub repository
 * No GitHub API dependency, just reads the raw file directly
 */

const https = require('https');
const { app, dialog, shell } = require('electron');
const semver = require('semver');
const path = require('path');
const fs = require('fs');

const GITHUB_PACKAGE_JSON_URL = 'https://raw.githubusercontent.com/Behdad-kanaani/korai-player/refs/heads/main/package.json';
let CURRENT_VERSION = null;
let latestVersionCache = null;
let updateCheckInterval = null;
let updateCheckListeners = [];

/**
 * Get current version from local package.json only
 * No hardcoded fallback - reads from actual app bundle
 */
function getCurrentVersion() {
    if (CURRENT_VERSION) return CURRENT_VERSION;
    
    try {
        let packagePath = null;
        
        // Try multiple possible locations for package.json
        try {
            const appPath = app.getAppPath();
            packagePath = path.join(appPath, 'package.json');
            
            if (!fs.existsSync(packagePath)) {
                // Alternative path for asar bundle
                packagePath = path.join(process.resourcesPath, 'app.asar', 'package.json');
            }
            if (!fs.existsSync(packagePath)) {
                packagePath = path.join(__dirname, '..', '..', 'package.json');
            }
            if (!fs.existsSync(packagePath)) {
                packagePath = path.join(process.cwd(), 'package.json');
            }
        } catch (err) {
            console.log('Error resolving package.json path:', err.message);
        }
        
        if (fs.existsSync(packagePath)) {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            CURRENT_VERSION = pkg.version || null;
            console.log(`📦 Current version from local package.json: ${CURRENT_VERSION}`);
        } else {
            console.error('❌ Could not find local package.json anywhere!');
            CURRENT_VERSION = null;
        }
    } catch (err) {
        console.error('Could not read package.json:', err.message);
        CURRENT_VERSION = null;
    }
    
    return CURRENT_VERSION;
}

/**
 * Fetch latest version by reading raw package.json from GitHub
 * This is simpler and more reliable than GitHub API
 */
async function fetchLatestVersion(silent = true) {
    const currentVersion = getCurrentVersion();
    
    if (!currentVersion) {
        console.error('❌ No current version available, cannot check for updates');
        return { hasUpdate: false, version: null, url: null, error: 'No version info' };
    }
    
    return new Promise((resolve) => {
        console.log(`🔍 Checking latest version from: ${GITHUB_PACKAGE_JSON_URL}`);
        
        const options = {
            method: 'GET',
            headers: {
                'User-Agent': 'KORAI-Player',
                'Accept': 'application/json'
            }
        };
        
        const req = https.request(GITHUB_PACKAGE_JSON_URL, options, (res) => {
            let data = '';
            
            res.on('data', chunk => data += chunk);
            
            res.on('end', () => {
                try {
                    const pkg = JSON.parse(data);
                    
                    if (!pkg.version) {
                        console.log('No version field found in remote package.json');
                        const result = { hasUpdate: false, version: null, url: null, currentVersion: currentVersion };
                        latestVersionCache = result;
                        updateCheckListeners.forEach(listener => listener(result));
                        resolve(result);
                        return;
                    }
                    
                    const latestVersion = pkg.version;
                    const hasUpdate = semver.valid(latestVersion) && semver.valid(currentVersion) 
                        ? semver.gt(latestVersion, currentVersion)
                        : false;
                    
                    // Construct download URL based on latest version
                    const downloadUrl = `https://github.com/Behdad-kanaani/korai-player/releases/tag/v${latestVersion}`;
                    
                    console.log(`📡 Latest version on GitHub: ${latestVersion}`);
                    console.log(`📊 Has update: ${hasUpdate} (current: ${currentVersion}, latest: ${latestVersion})`);
                    
                    const result = {
                        hasUpdate: hasUpdate,
                        version: latestVersion,
                        url: downloadUrl,
                        currentVersion: currentVersion
                    };
                    
                    latestVersionCache = result;
                    
                    // Notify all listeners
                    updateCheckListeners.forEach(listener => {
                        try {
                            listener(result);
                        } catch (err) {
                            console.error('Update listener error:', err);
                        }
                    });
                    
                    resolve(result);
                    
                } catch (err) {
                    console.error('Error parsing remote package.json:', err.message);
                    const result = { hasUpdate: false, version: null, url: null, error: err.message, currentVersion: currentVersion };
                    latestVersionCache = result;
                    updateCheckListeners.forEach(listener => listener(result));
                    resolve(result);
                }
            });
        });
        
        req.on('error', (err) => {
            console.error('Network error fetching remote package.json:', err.message);
            const result = { hasUpdate: false, version: null, url: null, error: err.message, currentVersion: currentVersion };
            latestVersionCache = result;
            updateCheckListeners.forEach(listener => listener(result));
            resolve(result);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            const result = { hasUpdate: false, version: null, url: null, error: 'Request timeout', currentVersion: currentVersion };
            latestVersionCache = result;
            updateCheckListeners.forEach(listener => listener(result));
            resolve(result);
        });
        
        req.end();
    });
}

/**
 * Register callback for update status changes
 */
function onUpdateCheck(callback) {
    if (typeof callback === 'function') {
        updateCheckListeners.push(callback);
        // Send cached result immediately if available
        if (latestVersionCache) {
            callback(latestVersionCache);
        }
    }
}

/**
 * Check for updates with optional user dialog
 * Shows dialog only if silent = false
 */
function checkForUpdates(silent = false) {
    return new Promise(async (resolve, reject) => {
        const currentVersion = getCurrentVersion();
        
        if (!currentVersion) {
            console.error('❌ No current version available');
            if (!silent) {
                dialog.showMessageBox({
                    type: 'error',
                    title: 'Version Error',
                    message: 'Could not determine current version.',
                    buttons: ['OK']
                });
            }
            resolve({ hasUpdate: false, error: 'No version info' });
            return;
        }
        
        try {
            const result = await fetchLatestVersion(silent);
            
            if (result.hasUpdate && result.version) {
                console.log(`✨ Update available: ${currentVersion} -> ${result.version}`);
                
                if (!silent) {
                    const dialogResult = await dialog.showMessageBox({
                        type: 'info',
                        title: 'Update Available',
                        message: `KORAI Player ${result.version} is available!`,
                        detail: `Current version: ${currentVersion}\nNew version: ${result.version}\n\nClick Download to get the latest version.`,
                        buttons: ['Download Now', 'Remind Later'],
                        defaultId: 0,
                        cancelId: 1
                    });
                    
                    if (dialogResult.response === 0 && result.url) {
                        shell.openExternal(result.url);
                    }
                }
                resolve(result);
            } else if (result.error) {
                console.log(`⚠️ Update check error: ${result.error}`);
                if (!silent) {
                    dialog.showMessageBox({
                        type: 'warning',
                        title: 'Update Check Failed',
                        message: `Could not check for updates.\n${result.error}`,
                        buttons: ['OK']
                    });
                }
                resolve(result);
            } else {
                console.log(`✅ No updates available. Current: ${currentVersion}`);
                if (!silent) {
                    dialog.showMessageBox({
                        type: 'info',
                        title: 'No Updates',
                        message: `KORAI Player ${currentVersion} is up to date!`,
                        buttons: ['OK']
                    });
                }
                resolve({ hasUpdate: false, currentVersion: currentVersion });
            }
        } catch (err) {
            console.error('Update check error:', err.message);
            if (!silent) {
                dialog.showMessageBox({
                    type: 'warning',
                    title: 'Update Check Failed',
                    message: 'Could not check for updates.\nPlease check your internet connection.',
                    buttons: ['OK']
                });
            }
            reject(err);
        }
    });
}

/**
 * Start periodic update checker
 */
function startUpdateChecker(intervalHours = 24) {
    if (updateCheckInterval) {
        clearInterval(updateCheckInterval);
    }
    
    // Check on startup (silent - no user dialog)
    setTimeout(() => {
        fetchLatestVersion(true).catch(err => {
            console.log('Startup update check failed:', err.message);
        });
    }, 5000);
    
    // Periodic checks
    updateCheckInterval = setInterval(() => {
        fetchLatestVersion(true).catch(err => {
            console.log('Periodic update check failed:', err.message);
        });
    }, intervalHours * 60 * 60 * 1000);
    
    console.log(`✅ Update checker started (every ${intervalHours} hours) - checking raw package.json from GitHub`);
}

/**
 * Stop periodic update checker
 */
function stopUpdateChecker() {
    if (updateCheckInterval) {
        clearInterval(updateCheckInterval);
        updateCheckInterval = null;
        console.log('🛑 Update checker stopped');
    }
}

/**
 * Manual check with UI feedback
 */
function manualCheckForUpdates() {
    return checkForUpdates(false);
}

/**
 * Get cached update status
 */
function getCachedUpdateStatus() {
    return latestVersionCache;
}

module.exports = { 
    checkForUpdates, 
    startUpdateChecker, 
    stopUpdateChecker,
    manualCheckForUpdates,
    getCurrentVersion,
    fetchLatestVersion,
    onUpdateCheck,
    getCachedUpdateStatus
};