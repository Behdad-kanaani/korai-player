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

    function shuffle(tracks, currentTrackId, random = Math.random, currentTrack = null) {
        const remaining = Array.isArray(tracks) ? [...tracks] : [];
        const currentIndex = currentTrackId == null
            ? -1
            : remaining.findIndex(track => String(track?.id) === String(currentTrackId));
        const activeTrack = currentIndex >= 0
            ? remaining.splice(currentIndex, 1)[0]
            : currentTrack && currentTrackId != null && String(currentTrack.id) === String(currentTrackId)
                ? currentTrack
                : null;

        for (let index = remaining.length - 1; index > 0; index -= 1) {
            const sample = Number(random());
            const boundedSample = Number.isFinite(sample) ? Math.min(1 - Number.EPSILON, Math.max(0, sample)) : 0;
            const target = Math.floor(boundedSample * (index + 1));
            [remaining[index], remaining[target]] = [remaining[target], remaining[index]];
        }

        return {
            queue: activeTrack ? [activeTrack, ...remaining] : remaining,
            queueIndex: activeTrack ? 0 : -1
        };
    }

    function getNextIndex(length, index, repeat = false) {
        if (!Number.isInteger(length) || length <= 0) return -1;
        if (!Number.isInteger(index) || index < 0) return 0;
        if (index >= length - 1) return repeat ? 0 : -1;
        return index + 1;
    }

    function getPreviousIndex(length, index, repeat = false) {
        if (!Number.isInteger(length) || length <= 0) return -1;
        if (!Number.isInteger(index) || index <= 0) return repeat ? length - 1 : -1;
        if (index >= length) return length - 1;
        return index - 1;
    }

    function move(tracks, fromIndex, toIndex, activeIndex) {
        if (!Array.isArray(tracks) || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
            fromIndex < 0 || fromIndex >= tracks.length || toIndex < 0 || toIndex >= tracks.length) {
            return { queue: Array.isArray(tracks) ? [...tracks] : [], queueIndex: activeIndex };
        }

        const queue = [...tracks];
        const activeTrack = Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < queue.length
            ? queue[activeIndex]
            : null;
        const [movedTrack] = queue.splice(fromIndex, 1);
        queue.splice(toIndex, 0, movedTrack);

        return {
            queue,
            queueIndex: activeTrack ? queue.indexOf(activeTrack) : -1
        };
    }

    function moveBefore(tracks, movedTrackId, targetTrackId) {
        if (!Array.isArray(tracks)) return [];
        const queue = [...tracks];
        const fromIndex = queue.findIndex(track => String(track?.id) === String(movedTrackId));
        if (fromIndex < 0 || movedTrackId == null || targetTrackId == null ||
            String(movedTrackId) === String(targetTrackId)) return queue;

        const [movedTrack] = queue.splice(fromIndex, 1);
        const targetIndex = queue.findIndex(track => String(track?.id) === String(targetTrackId));
        if (targetIndex < 0) {
            queue.splice(fromIndex, 0, movedTrack);
            return queue;
        }
        queue.splice(targetIndex, 0, movedTrack);
        return queue;
    }

    return { capture, restore, shuffle, getNextIndex, getPreviousIndex, move, moveBefore };
});
