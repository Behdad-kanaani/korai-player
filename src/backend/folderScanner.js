'use strict';

const fs = require('fs');
const path = require('path');

// Keep this list aligned with the formats accepted by /api/tracks/import.
const AUDIO_EXTENSIONS = new Set([
    '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.wma'
]);

/**
 * Scan a user-selected music directory recursively.
 *
 * This intentionally does not constrain paths to the app's data directory or
 * user profile: removable drives (including USB drives), other mounted drives,
 * and UNC shares are valid music-library locations. Readdir/stat errors in a
 * child directory are logged and skipped; an invalid/unreadable root is fatal.
 * Symbolic links are not followed to avoid cycles and scanning outside the
 * selected tree unexpectedly.
 */
async function scanAudioDirectory(rootPath, options = {}) {
    if (typeof rootPath !== 'string' || rootPath.trim() === '' || rootPath.includes('\0')) {
        throw new TypeError('Choose a valid folder to scan.');
    }

    const root = path.resolve(rootPath.trim());
    const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth >= 0
        ? options.maxDepth
        : 256;
    const onWarning = typeof options.onWarning === 'function'
        ? options.onWarning
        : (message, error) => console.warn(message, error && error.message ? error.message : error || '');

    let rootStats;
    try {
        rootStats = await fs.promises.stat(root);
    } catch (error) {
        throw new Error(`Cannot access the selected music folder "${root}": ${error.message}`, { cause: error });
    }
    if (!rootStats.isDirectory()) {
        throw new Error(`The selected path is not a folder: "${root}"`);
    }

    const files = [];
    const stack = [{ directory: root, depth: 0 }];
    const visitedDirectories = new Set();
    const windowsPaths = process.platform === 'win32';
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

    while (stack.length > 0) {
        const current = stack.pop();
        // Windows paths are case-insensitive. The visited guard is defensive
        // against unusual filesystem aliases while never following symlinks.
        const identity = windowsPaths ? current.directory.toLowerCase() : current.directory;
        if (visitedDirectories.has(identity)) continue;
        visitedDirectories.add(identity);

        onProgress(current.directory);

        let entries;
        try {
            // Do not preflight with fs.access(): access checks can be misleading
            // on removable/network filesystems; readdir is the authoritative test.
            entries = await fs.promises.readdir(current.directory, { withFileTypes: true });
        } catch (error) {
            if (current.depth === 0) {
                throw new Error(`Cannot read the selected music folder "${current.directory}": ${error.message}`, { cause: error });
            }
            onWarning(`[scan] Skipping unreadable subfolder: ${current.directory}`, error);
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current.directory, entry.name);

            try {
                if (entry.isSymbolicLink()) continue;

                if (entry.isDirectory()) {
                    if (current.depth < maxDepth) {
                        stack.push({ directory: fullPath, depth: current.depth + 1 });
                    } else {
                        onWarning(`[scan] Maximum folder depth reached; skipping: ${fullPath}`);
                    }
                    continue;
                }

                let isFile = entry.isFile();
                // Some filesystem providers can return Dirents with unknown
                // types. Fall back to stat for those entries rather than silently
                // omitting audio files on external media.
                if (!isFile && !entry.isBlockDevice() && !entry.isCharacterDevice() &&
                    !entry.isFIFO() && !entry.isSocket()) {
                    try {
                        const stats = await fs.promises.stat(fullPath);
                        if (stats.isDirectory()) {
                            if (current.depth < maxDepth) {
                                stack.push({ directory: fullPath, depth: current.depth + 1 });
                            }
                            continue;
                        }
                        isFile = stats.isFile();
                    } catch (error) {
                        onWarning(`[scan] Cannot inspect: ${fullPath}`, error);
                    }
                }

                if (isFile && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                    files.push(fullPath);
                }
            } catch (error) {
                onWarning(`[scan] Skipping inaccessible entry: ${fullPath}`, error);
            }
        }
    }

    files.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    return files;
}

module.exports = { AUDIO_EXTENSIONS, scanAudioDirectory };
