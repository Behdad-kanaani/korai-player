(function exposePlaybackQueueState(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiPlaybackQueueState = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPlaybackQueueState() {
    function capture(queue, trackId, queueIndex, modes = {}) {
        return {
            queueTrackIds: Array.isArray(queue) ? queue.map(track => track?.id).filter(id => id != null) : [],
            queueIndex: Number.isInteger(queueIndex) ? queueIndex : -1,
            trackId,
            shuffleMode: modes.shuffleMode === true,
            originalQueueTrackIds: Array.isArray(modes.originalQueue)
                ? modes.originalQueue.map(track => track?.id).filter(id => id != null)
                : [],
            repeatMode: modes.repeatMode === true,
            repeatOneMode: modes.repeatOneMode === true
        };
    }

    function restore(state, tracks) {
        if (!Array.isArray(tracks) || !state || state.trackId == null) return null;
        const trackById = new Map(tracks.map(track => [String(track.id), track]));
        const currentTrack = trackById.get(String(state.trackId));
        if (!currentTrack) return null;

        const savedIds = Array.isArray(state.queueTrackIds) ? state.queueTrackIds : [];
        const queue = savedIds
            .filter(id => id != null)
            .map(id => trackById.get(String(id)))
            .filter(Boolean);
        const originalQueue = Array.isArray(state.originalQueueTrackIds)
            ? state.originalQueueTrackIds
                .filter(id => id != null)
                .map(id => trackById.get(String(id)))
                .filter(Boolean)
            : [];

        if (queue.length === 0) {
            return {
                queue: [...tracks],
                queueIndex: tracks.findIndex(track => String(track.id) === String(state.trackId)),
                originalQueue,
                shuffleMode: state.shuffleMode === true && originalQueue.length > 0,
                repeatMode: state.repeatMode === true,
                repeatOneMode: state.repeatOneMode === true && state.repeatMode === true
            };
        }

        let queueIndex = -1;
        const requestedIndex = Number.isInteger(state.queueIndex) ? state.queueIndex : -1;
        if (
            requestedIndex >= 0 &&
            requestedIndex < savedIds.length &&
            String(savedIds[requestedIndex]) === String(state.trackId)
        ) {
            queueIndex = savedIds
                .slice(0, requestedIndex + 1)
                .filter(id => id != null && trackById.has(String(id)))
                .length - 1;
        }
        if (queueIndex < 0 || String(queue[queueIndex]?.id) !== String(state.trackId)) {
            queueIndex = queue.findIndex(track => String(track.id) === String(state.trackId));
        }
        if (queueIndex < 0) {
            queue.push(currentTrack);
            queueIndex = queue.length - 1;
        }
        return {
            queue,
            queueIndex,
            originalQueue,
            shuffleMode: state.shuffleMode === true && originalQueue.length > 0,
            repeatMode: state.repeatMode === true,
            repeatOneMode: state.repeatOneMode === true && state.repeatMode === true
        };
    }

    return { capture, restore };
});
