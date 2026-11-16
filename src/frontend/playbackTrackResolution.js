(function exposePlaybackTrackResolution(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiPlaybackTrackResolution = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPlaybackTrackResolution() {
    'use strict';

    function resolveTrack(trackList, requestedId, currentTrackFallback = null) {
        if (requestedId === null || requestedId === undefined) return null;
        const requestedKey = String(requestedId);
        if (Array.isArray(trackList)) {
            const match = trackList.find(track => track && String(track.id) === requestedKey);
            if (match) return match;
        }
        if (currentTrackFallback && String(currentTrackFallback.id) === requestedKey) {
            return currentTrackFallback;
        }
        return null;
    }

    return { resolveTrack };
});
