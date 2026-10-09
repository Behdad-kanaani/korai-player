'use strict';

const fs = require('fs');
const { resolveExistingFile } = require('./securityUtils');
const { AUDIO_EXTENSIONS } = require('./folderScanner');

function isTrackAvailable(track) {
    if (!track || typeof track.filePath !== 'string' || track.filePath.trim() === '') return false;

    const resolvedPath = resolveExistingFile(track.filePath, { allowedExtensions: [...AUDIO_EXTENSIONS] });
    if (!resolvedPath) return false;

    try {
        const stats = fs.statSync(resolvedPath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

function filterAvailableTracks(tracks) {
    return Array.isArray(tracks) ? tracks.filter(isTrackAvailable) : [];
}

module.exports = { AUDIO_EXTENSIONS, isTrackAvailable, filterAvailableTracks };
