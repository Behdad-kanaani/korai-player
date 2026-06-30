/**
 * updater.js - Automatic Code Update System (Optimized)
 * 
 * Fetches changed files from GitHub and applies updates without reinstallation
 * Uses raw GitHub URLs to avoid rate limits
 * Only checks for updates once per session or when user requests
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const GITHUB_OWNER = 'Behdad-kanaani';
const GITHUB_REPO = 'korai-player';
const PACKAGE_JSON_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/refs/heads/main/package.json`;
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

// File patterns to include in updates (only source code)
const INCLUDE_PATTERNS = [
    /\.(js|css|html|json)$/,
    /^src\//,
    /^main\.js$/,
    /^preload\.js$/,
    /^package\.json$/
];

// File patterns to exclude from updates
const EXCLUDE_PATTERNS = [
    /node_modules/,
    /\.log$/,
    /\.tmp$/,
    /screenshot\//,
    /README\.md$/,
    /LICENSE/
];

// ============================================================================
// STATE
// ============================================================================

let updateListeners = [];
let cachedUpdateInfo = null;
let isUpdating = false;
let updateProgress = {
    status: 'idle',
    progress: 0,
    totalFiles: 0,
    currentFile: '',
    message: ''
};

// Cache for version check to avoid repeated requests
let versionCache = {
    timestamp: 0,
    version: null,
    files: null,
    commitSha: null
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// ============================================================================
// VERSION MANAGEMENT
// ============================================================================

/**
 * Get current app version from local package.json
 */
function getCurrentVersion() {
    try {
        const appPath = app.getAppPath();
        const packagePath = path.join(appPath, 'package.json');
        if (fs.existsSync(packagePath)) {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            return pkg.version || '0.0.0';
        }
    } catch (err) {
        console.error('[updater] Failed to get current version:', err.message);
    }
    return '0.0.0';
}

/**
 * Get latest version from GitHub package.json (NO RATE LIMIT)
 * This uses raw.githubusercontent.com which has NO rate limit
 */
async function getLatestVersionFromGitHub() {
    try {
        const content = await downloadFileFromGitHub(PACKAGE_JSON_URL);
        const pkg = JSON.parse(content);
        return pkg.version || null;
    } catch (err) {
        console.error('[updater] Failed to get latest version from GitHub:', err.message);
        return null;
    }
}

/**
 * Compare two version strings (semver-like)
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    const maxLen = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLen; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

// ============================================================================
// GITHUB API FUNCTIONS (Optimized)
// ============================================================================

/**
 * Fetch JSON from GitHub API with rate limit handling
 */
function fetchGitHubJSON(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'KORAI-Player',
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 15000
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(new Error(`Failed to parse JSON: ${err.message}`));
                    }
                } else if (res.statusCode === 404) {
                    resolve(null);
                } else if (res.statusCode === 403) {
                    // Rate limit hit - check when it resets
                    const resetTime = res.headers['x-ratelimit-reset'];
                    const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : new Date(Date.now() + 60000);
                    reject(new Error(`GitHub API rate limit exceeded. Try again after ${resetDate.toLocaleTimeString()}`));
                } else {
                    reject(new Error(`GitHub API error: ${res.statusCode}`));
                }
            });
        }).on('error', (err) => {
            reject(new Error(`Network error: ${err.message}`));
        }).on('timeout', () => {
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Download a file from GitHub raw URL (NO RATE LIMIT)
 * Uses raw.githubusercontent.com which has no rate limit
 */
function downloadFileFromGitHub(rawUrl) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'KORAI-Player'
            },
            timeout: 30000
        };

        https.get(rawUrl, options, (res) => {
            if (res.statusCode === 200) {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
                res.on('error', reject);
            } else if (res.statusCode === 404) {
                reject(new Error(`File not found: ${rawUrl}`));
            } else {
                reject(new Error(`Download failed: ${res.statusCode}`));
            }
        }).on('error', reject).on('timeout', () => {
            reject(new Error('Download timeout'));
        });
    });
}

/**
 * Get the SHA of the last known commit (stored locally)
 */
function getLastKnownCommit() {
    try {
        const userDataPath = app.getPath('userData');
        const statePath = path.join(userDataPath, '.update-state.json');
        if (fs.existsSync(statePath)) {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            return state.lastCommitSha || null;
        }
    } catch (err) {
        console.warn('[updater] Could not read update state:', err.message);
    }
    return null;
}

/**
 * Save the last known commit SHA locally
 */
function saveLastKnownCommit(commitSha) {
    try {
        const userDataPath = app.getPath('userData');
        const statePath = path.join(userDataPath, '.update-state.json');
        const state = {
            lastCommitSha: commitSha,
            updatedAt: Date.now()
        };
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        return true;
    } catch (err) {
        console.error('[updater] Failed to save update state:', err.message);
        return false;
    }
}

// ============================================================================
// GET CHANGED FILES (Optimized - Only called when update is confirmed)
// ============================================================================

/**
 * Get list of changed files between current version and latest
 * Only called when user confirms the update
 */
async function getChangedFiles(latestVersion, latestSha) {
    try {
        const currentVersion = getCurrentVersion();
        const lastKnownCommit = getLastKnownCommit();
        
        // If we have a last known commit, use compare API
        if (lastKnownCommit && latestSha) {
            const compareUrl = `${GITHUB_API}/compare/${lastKnownCommit}...${latestSha}`;
            const compareResult = await fetchGitHubJSON(compareUrl);
            
            if (compareResult && compareResult.files) {
                return compareResult.files
                    .filter(f => f.status !== 'removed')
                    .map(f => f.filename)
                    .filter(file => {
                        const shouldInclude = INCLUDE_PATTERNS.some(pattern => pattern.test(file));
                        const shouldExclude = EXCLUDE_PATTERNS.some(pattern => pattern.test(file));
                        return shouldInclude && !shouldExclude;
                    });
            }
        }
        
        // Fallback: Get files from latest commit
        if (latestSha) {
            const commitDetail = await fetchGitHubJSON(`${GITHUB_API}/commits/${latestSha}`);
            if (commitDetail && commitDetail.files) {
                return commitDetail.files
                    .filter(f => f.status !== 'removed')
                    .map(f => f.filename)
                    .filter(file => {
                        const shouldInclude = INCLUDE_PATTERNS.some(pattern => pattern.test(file));
                        const shouldExclude = EXCLUDE_PATTERNS.some(pattern => pattern.test(file));
                        return shouldInclude && !shouldExclude;
                    });
            }
        }
        
        // If all else fails, return empty array
        return [];
        
    } catch (err) {
        console.error('[updater] Failed to get changed files:', err.message);
        // If rate limit, return empty and let user retry
        if (err.message.includes('rate limit')) {
            throw new Error('Cannot fetch changed files due to rate limit. Please try again later.');
        }
        return [];
    }
}

// ============================================================================
// MAIN UPDATE LOGIC (Optimized - Only checks version, no files unless needed)
// ============================================================================

/**
 * Check for available updates - FAST CHECK (just version comparison)
 * This does NOT fetch file lists, only checks if update exists
 */
async function checkForUpdates() {
    try {
        const currentVersion = getCurrentVersion();
        console.log(`[updater] Current version: ${currentVersion}`);

        // Check cache first
        const now = Date.now();
        if (versionCache.timestamp && (now - versionCache.timestamp) < CACHE_DURATION) {
            console.log('[updater] Using cached version check');
            const result = {
                hasUpdate: versionCache.version !== currentVersion,
                currentVersion: currentVersion,
                latestVersion: versionCache.version,
                changedFiles: [], // Don't return files on quick check
                totalFiles: 0,
                url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${versionCache.version}`,
                error: null,
                versionChanged: versionCache.version !== currentVersion,
                needsFullCheck: versionCache.version !== currentVersion
            };
            cachedUpdateInfo = result;
            notifyListeners(result);
            return result;
        }

        // Get latest version from GitHub (NO RATE LIMIT)
        const latestVersion = await getLatestVersionFromGitHub();
        if (!latestVersion) {
            throw new Error('Could not fetch latest version from GitHub');
        }
        console.log(`[updater] Latest version on GitHub: ${latestVersion}`);

        // Update cache
        versionCache.timestamp = now;
        versionCache.version = latestVersion;

        // Compare versions
        const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
        console.log(`[updater] Has update: ${hasUpdate}`);

        const result = {
            hasUpdate: hasUpdate,
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            changedFiles: [], // Empty on quick check
            totalFiles: 0,
            url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${latestVersion}`,
            error: null,
            versionChanged: hasUpdate,
            needsFullCheck: hasUpdate // If update exists, we need to fetch files later
        };

        cachedUpdateInfo = result;
        notifyListeners(result);
        return result;

    } catch (err) {
        console.error('[updater] Update check failed:', err.message);
        const result = {
            hasUpdate: false,
            error: err.message,
            currentVersion: getCurrentVersion(),
            needsFullCheck: false
        };
        cachedUpdateInfo = result;
        notifyListeners(result);
        return result;
    }
}

/**
 * Perform full update check - gets file list
 * This should only be called when user confirms the update
 */
async function performFullUpdateCheck() {
    try {
        const currentVersion = getCurrentVersion();
        const latestVersion = versionCache.version || await getLatestVersionFromGitHub();
        
        if (!latestVersion) {
            throw new Error('Could not get latest version');
        }
        
        // Get the latest commit SHA (only once)
        let latestSha = versionCache.commitSha;
        if (!latestSha) {
            const latestCommit = await fetchGitHubJSON(`${GITHUB_API}/commits/main`);
            if (latestCommit && latestCommit.sha) {
                latestSha = latestCommit.sha;
                versionCache.commitSha = latestSha;
            }
        }
        
        // Get changed files
        const changedFiles = await getChangedFiles(latestVersion, latestSha);
        
        const result = {
            hasUpdate: true,
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            latestSha: latestSha,
            changedFiles: changedFiles,
            totalFiles: changedFiles.length,
            url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${latestVersion}`,
            error: null,
            versionChanged: true,
            needsFullCheck: false
        };
        
        cachedUpdateInfo = result;
        notifyListeners(result);
        return result;
        
    } catch (err) {
        console.error('[updater] Full update check failed:', err.message);
        throw err;
    }
}

/**
 * Fetch latest version info (wrapper)
 */
async function fetchLatestVersion(silent = true) {
    return await checkForUpdates();
}

// ============================================================================
// APPLY UPDATE
// ============================================================================

/**
 * Apply the update by downloading and replacing changed files
 */
async function applyUpdate(updateInfo, progressCallback) {
    if (isUpdating) {
        throw new Error('Update already in progress');
    }

    // Ensure we have the file list
    if (!updateInfo.changedFiles || updateInfo.changedFiles.length === 0) {
        // Perform full check to get file list
        console.log('[updater] No file list provided, performing full update check...');
        const fullInfo = await performFullUpdateCheck();
        updateInfo.changedFiles = fullInfo.changedFiles;
        updateInfo.latestSha = fullInfo.latestSha;
        updateInfo.totalFiles = fullInfo.totalFiles;
    }

    isUpdating = true;
    updateProgress.status = 'starting';
    updateProgress.message = 'Initializing update...';
    notifyProgress();

    try {
        const appPath = app.getAppPath();
        const userDataPath = app.getPath('userData');
        const backupDir = path.join(userDataPath, '.update-backup');

        // Create backup directory
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const filesToUpdate = updateInfo.changedFiles || [];
        const totalFiles = filesToUpdate.length;

        if (totalFiles === 0) {
            throw new Error('No files to update');
        }

        // Step 1: Backup existing files
        updateProgress.status = 'backup';
        updateProgress.message = 'Backing up current files...';
        notifyProgress();

        for (let i = 0; i < filesToUpdate.length; i++) {
            const file = filesToUpdate[i];
            const localPath = path.join(appPath, file);
            const backupPath = path.join(backupDir, path.basename(file) + '.backup');

            if (fs.existsSync(localPath)) {
                try {
                    fs.copyFileSync(localPath, backupPath);
                } catch (err) {
                    console.warn(`[updater] Could not backup ${file}:`, err.message);
                }
            }

            const progress = ((i + 1) / totalFiles) * 30;
            updateProgress.progress = progress;
            updateProgress.currentFile = file;
            updateProgress.message = `Backing up: ${file}`;
            notifyProgress();

            if (progressCallback) {
                progressCallback(updateProgress);
            }
        }

        // Step 2: Download and replace files
        updateProgress.status = 'downloading';
        updateProgress.message = 'Downloading updates...';
        notifyProgress();

        const downloadedFiles = [];
        for (let i = 0; i < filesToUpdate.length; i++) {
            const file = filesToUpdate[i];
            const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${file}`;
            const localPath = path.join(appPath, file);

            try {
                // Download the file content
                const content = await downloadFileFromGitHub(rawUrl);

                // Ensure directory exists
                const dir = path.dirname(localPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                // Write the new file
                fs.writeFileSync(localPath, content, 'utf8');
                downloadedFiles.push(file);

                console.log(`[updater] Updated: ${file}`);

            } catch (err) {
                console.error(`[updater] Failed to update ${file}:`, err.message);
                // Continue with other files
            }

            const progress = 30 + ((i + 1) / totalFiles) * 60;
            updateProgress.progress = progress;
            updateProgress.currentFile = file;
            updateProgress.message = `Updating: ${file}`;
            notifyProgress();

            if (progressCallback) {
                progressCallback(updateProgress);
            }
        }

        // Step 3: Save the new commit SHA
        if (updateInfo.latestSha) {
            saveLastKnownCommit(updateInfo.latestSha);
        }

        // Step 4: Update package.json version
        try {
            const packagePath = path.join(appPath, 'package.json');
            if (fs.existsSync(packagePath)) {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                pkg.version = updateInfo.latestVersion;
                fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
                console.log(`[updater] Updated package.json version to ${updateInfo.latestVersion}`);
            }
        } catch (err) {
            console.warn('[updater] Could not update package.json:', err.message);
        }

        // Step 5: Cleanup backup
        updateProgress.status = 'cleaning';
        updateProgress.message = 'Cleaning up...';
        updateProgress.progress = 95;
        notifyProgress();

        try {
            fs.rmSync(backupDir, { recursive: true, force: true });
        } catch (err) {
            console.warn('[updater] Could not cleanup backup:', err.message);
        }

        // Step 6: Mark as updated
        updateProgress.status = 'complete';
        updateProgress.progress = 100;
        updateProgress.message = 'Update complete! Restarting...';
        notifyProgress();

        if (progressCallback) {
            progressCallback(updateProgress);
        }

        // Store that we need to restart
        try {
            const restartFlag = path.join(userDataPath, '.restart-required');
            fs.writeFileSync(restartFlag, JSON.stringify({
                timestamp: Date.now(),
                version: updateInfo.latestVersion || getCurrentVersion(),
                updatedFiles: downloadedFiles
            }));
        } catch (err) {
            console.warn('[updater] Could not create restart flag:', err.message);
        }

        isUpdating = false;
        return { success: true, updatedFiles: downloadedFiles };

    } catch (err) {
        console.error('[updater] Update failed:', err);
        updateProgress.status = 'error';
        updateProgress.message = `Update failed: ${err.message}`;
        notifyProgress();

        if (progressCallback) {
            progressCallback(updateProgress);
        }

        isUpdating = false;
        throw err;
    }
}

/**
 * Rollback to previous version if update fails
 */
function rollbackUpdate(backupDir, appPath) {
    try {
        if (!fs.existsSync(backupDir)) return false;

        const files = fs.readdirSync(backupDir);
        let restored = 0;

        for (const file of files) {
            if (file.endsWith('.backup')) {
                const originalName = file.replace('.backup', '');
                const backupPath = path.join(backupDir, file);
                const targetPath = path.join(appPath, originalName);

                if (fs.existsSync(backupPath)) {
                    fs.copyFileSync(backupPath, targetPath);
                    restored++;
                }
            }
        }

        console.log(`[updater] Rollback completed: ${restored} files restored`);
        return true;

    } catch (err) {
        console.error('[updater] Rollback failed:', err.message);
        return false;
    }
}

/**
 * Calculate file checksum for validation
 */
function calculateChecksum(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Get current update progress
 */
function getUpdateProgress() {
    return { ...updateProgress };
}

/**
 * Check if update is in progress
 */
function isUpdateInProgress() {
    return isUpdating;
}

// ============================================================================
// LISTENER & EVENT SYSTEM
// ============================================================================

/**
 * Register a listener for update events
 */
function onUpdateCheck(callback) {
    if (typeof callback === 'function') {
        updateListeners.push(callback);
        if (cachedUpdateInfo) {
            callback(cachedUpdateInfo);
        }
    }
}

/**
 * Notify all registered listeners
 */
function notifyListeners(data) {
    updateListeners.forEach(cb => {
        try { cb(data); } catch (err) { console.error('[updater] Listener error:', err); }
    });
}

/**
 * Notify progress listeners
 */
function notifyProgress() {
    const event = new CustomEvent('update-progress', { detail: updateProgress });
    if (typeof window !== 'undefined') {
        window.dispatchEvent(event);
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    checkForUpdates,
    applyUpdate,
    rollbackUpdate,
    onUpdateCheck,
    getUpdateProgress,
    isUpdateInProgress,
    getCurrentVersion,
    getLastKnownCommit,
    saveLastKnownCommit,
    fetchGitHubJSON,
    downloadFileFromGitHub,
    calculateChecksum,
    fetchLatestVersion,
    getLatestVersionFromGitHub,
    compareVersions,
    performFullUpdateCheck,
    getChangedFiles
};