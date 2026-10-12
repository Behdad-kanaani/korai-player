'use strict';

const path = require('path');

function normalizeLibraryPath(filePath, platform = process.platform) {
    const resolved = path.resolve(filePath);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function planAudioImport(filePaths, tracks, getFileStats = filePath => require('fs').statSync(filePath)) {
    const tracksByPath = new Map();
    for (const track of tracks) {
        if (!track || !track.filePath || track.cueSheetPath) continue;
        tracksByPath.set(normalizeLibraryPath(track.filePath), track);
    }

    const seen = new Set();
    const unchanged = [];
    const toAnalyze = [];
    for (const filePath of filePaths) {
        const normalizedPath = normalizeLibraryPath(filePath);
        if (seen.has(normalizedPath)) continue;
        seen.add(normalizedPath);

        const stats = getFileStats(filePath);
        if (!stats.isFile()) continue;
        const existingTrack = tracksByPath.get(normalizedPath);
        if (existingTrack &&
            Number.isFinite(existingTrack.fileSize) &&
            Number.isFinite(existingTrack.fileMtimeMs) &&
            Number(existingTrack.fileSize) === stats.size &&
            Number(existingTrack.fileMtimeMs) === stats.mtimeMs) {
            unchanged.push(filePath);
            continue;
        }
        toAnalyze.push({
            filePath,
            existingTrackId: existingTrack ? existingTrack.id : null,
            fileSize: stats.size,
            fileMtimeMs: stats.mtimeMs
        });
    }

    return { unchanged, toAnalyze };
}

module.exports = { normalizeLibraryPath, planAudioImport };
