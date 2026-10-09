// updateManager - coordinates update download/apply workflow

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const updater = require('./updater');

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUIRED_FILES = ['main.js', 'package.json'];

// ============================================================================
// STATE
// ============================================================================

let isProcessing = false;
let currentOperation = null;

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Validate that all critical files exist before applying update
 */
function validateUpdateFiles(files, appPath) {
    if (!Array.isArray(files)) return { missing: [], invalid: [] };

    const missing = [];
    const invalid = [];
    for (const file of files) {
        try {
            const relative = updater.validateUpdatePath(file);
            const fullPath = path.join(appPath, relative);
            if (!fs.existsSync(path.dirname(fullPath))) {
                // New directories are valid; no write probe here because probes
                // themselves mutate the app directory and are unsafe in ASAR.
                continue;
            }
            try {
                const stat = fs.statSync(path.dirname(fullPath));
                if (!stat.isDirectory()) invalid.push({ file, error: 'Parent path is not a directory' });
            } catch (err) {
                invalid.push({ file, error: err.message });
            }
        } catch (err) {
            invalid.push({ file, error: err.message });
        }
    }
    return { missing, invalid };
}

/**
 * Perform a full update with progress tracking
 */
async function performFullUpdate(updateInfo, progressCallback) {
    if (isProcessing) {
        throw new Error('Another update operation is already in progress');
    }

    if (!updateInfo) {
        throw new Error('Update info is required');
    }

    if (!updater.canApplySourceUpdate()) {
        throw new Error('Automatic source updates are disabled for packaged installs. Use the official release installer.');
    }

    if (!Array.isArray(updateInfo.changedFiles) || updateInfo.changedFiles.length === 0) {
        const fullInfo = await updater.performFullUpdateCheck();
        Object.assign(updateInfo, fullInfo);
    }

    if (!Array.isArray(updateInfo.changedFiles) || updateInfo.changedFiles.length === 0) {
        throw new Error('No files to update');
    }

    isProcessing = true;
    currentOperation = 'update';

    try {
        // Step 1: Validate environment
        const appPath = app.getAppPath();
        const validation = validateUpdateFiles(updateInfo.changedFiles, appPath);

        if (validation.missing.length > 0) {
            throw new Error(`Missing required files: ${validation.missing.join(', ')}`);
        }

        if (validation.invalid.length > 0) {
            console.warn('[updateManager] Some files may not be writable:', validation.invalid);
        }

        // Step 2: Apply the update
        const result = await updater.applyUpdate(updateInfo, progressCallback);

        if (!result.success) {
            throw new Error('Update application failed');
        }

        // Step 3: Verify critical files
        const criticalFiles = REQUIRED_FILES.map(f => path.join(appPath, f));
        const missingCritical = criticalFiles.filter(f => !fs.existsSync(f));

        if (missingCritical.length > 0) {
            console.error('[updateManager] Critical files missing after update:', missingCritical);
            // Attempt rollback
            await rollbackAfterFailedUpdate();
            throw new Error('Critical files missing after update - rollback performed');
        }

        // Step 4: Update package.json version if changed
        if (updateInfo.latestVersion) {
            try {
                const packagePath = path.join(appPath, 'package.json');
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                pkg.version = updateInfo.latestVersion;
                fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
            } catch (err) {
                console.warn('[updateManager] Could not update version in package.json:', err.message);
            }
        }

        // Step 5: Create restart flag
        const userDataPath = app.getPath('userData');
        const restartFlag = path.join(userDataPath, '.restart-required');
        fs.writeFileSync(restartFlag, JSON.stringify({
            timestamp: Date.now(),
            version: updateInfo.latestVersion || updater.getCurrentVersion(),
            filesUpdated: result.updatedFiles || []
        }));

        isProcessing = false;
        return {
            success: true,
            updatedFiles: result.updatedFiles || [],
            version: updateInfo.latestVersion,
            restartRequired: true
        };

    } catch (err) {
        console.error('[updateManager] Update failed:', err);
        isProcessing = false;
        throw err;
    }
}

/**
 * Rollback after failed update attempt
 */
async function rollbackAfterFailedUpdate() {
    try {
        const userDataPath = app.getPath('userData');
        const backupDir = path.join(userDataPath, '.update-backup');
        const appPath = app.getAppPath();

        const rollbackResult = updater.rollbackUpdate(backupDir, appPath);
        return rollbackResult;

    } catch (err) {
        console.error('[updateManager] Rollback failed:', err);
        return false;
    }
}

/**
 * Check if restart is required after update
 */
function isRestartRequired() {
    try {
        const userDataPath = app.getPath('userData');
        const restartFlag = path.join(userDataPath, '.restart-required');
        if (fs.existsSync(restartFlag)) {
            const data = JSON.parse(fs.readFileSync(restartFlag, 'utf8'));
            // Check if flag is recent (less than 1 hour old)
            if (Date.now() - data.timestamp < 60 * 60 * 1000) {
                return data;
            }
            // Remove old flag
            fs.unlinkSync(restartFlag);
        }
    } catch (err) {
        console.warn('[updateManager] Could not check restart flag:', err.message);
    }
    return null;
}

/**
 * Clear restart flag after successful restart
 */
function clearRestartFlag() {
    try {
        const userDataPath = app.getPath('userData');
        const restartFlag = path.join(userDataPath, '.restart-required');
        if (fs.existsSync(restartFlag)) {
            fs.unlinkSync(restartFlag);
            return true;
        }
    } catch (err) {
        console.warn('[updateManager] Could not clear restart flag:', err.message);
    }
    return false;
}

/**
 * Check if update is needed based on version
 */
async function checkAndPrepareUpdate() {
    try {
        const updateInfo = await updater.checkForUpdates();

        if (!updateInfo) {
            return {
                hasUpdate: false,
                message: 'No update information available',
                currentVersion: updater.getCurrentVersion()
            };
        }

        if (!updateInfo.hasUpdate) {
            return {
                hasUpdate: false,
                message: 'No updates available',
                currentVersion: updateInfo.currentVersion || updater.getCurrentVersion()
            };
        }

        const changedFiles = Array.isArray(updateInfo.changedFiles) ? updateInfo.changedFiles : [];
        const appPath = app.getAppPath();
        const validation = validateUpdateFiles(changedFiles, appPath);
        const canUpdate = updater.canApplySourceUpdate() && validation.invalid.length === 0;

        return {
            hasUpdate: true,
            currentVersion: updateInfo.currentVersion || updater.getCurrentVersion(),
            latestVersion: updateInfo.latestVersion || null,
            totalFiles: changedFiles.length,
            changedFiles,
            files: changedFiles,
            canUpdate,
            validationErrors: validation,
            isVersionChange: updateInfo.versionChanged || false,
            latestSha: updateInfo.latestSha || null,
            needsFullCheck: updateInfo.needsFullCheck || false,
            url: updateInfo.url || `https://github.com/Behdad-kanaani/korai-player/releases/tag/v${updateInfo.latestVersion || ''}`
        };

    } catch (err) {
        console.error('[updateManager] Update check failed:', err);
        return {
            hasUpdate: false,
            error: err.message,
            currentVersion: updater.getCurrentVersion()
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    performFullUpdate,
    rollbackAfterFailedUpdate,
    isRestartRequired,
    clearRestartFlag,
    checkAndPrepareUpdate,
    validateUpdateFiles
};