/**
 * updater.js - Automatic update checker
 * Checks GitHub releases and notifies user
 */

const https = require('https');
const { app, dialog, shell } = require('electron');
const semver = require('semver');
const path = require('path');
const fs = require('fs');

const GITHUB_REPO = 'Behdad-kanaani/korai-player';
let CURRENT_VERSION = null;

function getCurrentVersion() {
    if (CURRENT_VERSION) return CURRENT_VERSION;
    
    try {
        // Try to read from package.json in app root
        const packagePath = path.join(app.getAppPath(), 'package.json');
        if (fs.existsSync(packagePath)) {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            CURRENT_VERSION = pkg.version || '1.0.0';
        } else {
            CURRENT_VERSION = '1.3.0';
        }
    } catch (err) {
        console.log('Could not read package.json:', err.message);
        CURRENT_VERSION = '1.3.0';
    }
    
    return CURRENT_VERSION;
}

let updateCheckInterval = null;

function checkForUpdates(silent = false) {
    return new Promise((resolve, reject) => {
        const currentVersion = getCurrentVersion();
        console.log(`🔍 Checking for updates... Current version: ${currentVersion}`);
        
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/releases/latest`,
            method: 'GET',
            headers: {
                'User-Agent': 'KORAI-Player',
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    
                    if (!release.tag_name) {
                        console.log('No release found on GitHub');
                        resolve({ hasUpdate: false });
                        return;
                    }
                    
                    const latestVersion = release.tag_name.replace(/^v/, '');
                    console.log(`📡 Latest version on GitHub: ${latestVersion}`);
                    
                    const hasUpdate = semver.gt(latestVersion, currentVersion);
                    
                    if (hasUpdate) {
                        console.log(`✨ Update available: ${currentVersion} -> ${latestVersion}`);
                        
                        if (!silent) {
                            dialog.showMessageBox({
                                type: 'info',
                                title: 'Update Available',
                                message: `KORAI Player ${latestVersion} is available!`,
                                detail: `Current version: ${currentVersion}\nNew version: ${latestVersion}\n\n${(release.body || 'No release notes available.').slice(0, 500)}`,
                                buttons: ['Download Now', 'Remind Later'],
                                defaultId: 0,
                                cancelId: 1
                            }).then((result) => {
                                if (result.response === 0) {
                                    shell.openExternal(release.html_url);
                                }
                            });
                        }
                        resolve({ hasUpdate: true, version: latestVersion, url: release.html_url });
                    } else {
                        if (!silent) {
                            dialog.showMessageBox({
                                type: 'info',
                                title: 'No Updates',
                                message: `KORAI Player ${currentVersion} is up to date!`,
                                buttons: ['OK']
                            });
                        }
                        resolve({ hasUpdate: false });
                    }
                } catch (err) {
                    console.error('Error parsing release data:', err);
                    reject(err);
                }
            });
        });
        
        req.on('error', (err) => {
            console.error('Update check network error:', err.message);
            if (!silent) {
                dialog.showMessageBox({
                    type: 'warning',
                    title: 'Update Check Failed',
                    message: 'Could not check for updates.\nPlease check your internet connection.',
                    buttons: ['OK']
                });
            }
            reject(err);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

function startUpdateChecker(intervalHours = 24) {
    if (updateCheckInterval) clearInterval(updateCheckInterval);
    
    // Check on startup (silent - don't bother user)
    setTimeout(() => {
        checkForUpdates(true).catch(err => console.log('Startup update check failed:', err.message));
    }, 5000);
    
    // Periodic checks
    updateCheckInterval = setInterval(() => {
        checkForUpdates(true).catch(err => console.log('Periodic update check failed:', err.message));
    }, intervalHours * 60 * 60 * 1000);
    
    console.log(`✅ Update checker started (every ${intervalHours} hours)`);
}

function stopUpdateChecker() {
    if (updateCheckInterval) {
        clearInterval(updateCheckInterval);
        updateCheckInterval = null;
        console.log('🛑 Update checker stopped');
    }
}

// Manual check with UI feedback
function manualCheckForUpdates() {
    return checkForUpdates(false);
}

module.exports = { 
    checkForUpdates, 
    startUpdateChecker, 
    stopUpdateChecker,
    manualCheckForUpdates,
    getCurrentVersion
};