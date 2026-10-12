(function exposePlaybackTransition(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiPlaybackTransition = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPlaybackTransition() {
    function getCandidate(queue, queueIndex, currentTrackId, modes = {}) {
        if (!Array.isArray(queue) || queue.length === 0 || modes.preferredGenreMode) return null;
        if (modes.repeatOneMode) {
            const index = queue.findIndex(track => String(track?.id) === String(currentTrackId));
            return index < 0 ? null : { track: queue[index], index };
        }
        let index = Number.isInteger(queueIndex) ? queueIndex + 1 : 0;
        if (index >= queue.length) {
            if (!modes.repeatMode) return null;
            index = 0;
        }
        const track = queue[index];
        return track ? { track, index } : null;
    }

    function getFadeDuration(requestedDuration, remainingDuration, nextDuration) {
        const requested = Number(requestedDuration);
        const remaining = Number(remainingDuration);
        if (!Number.isFinite(requested) || !Number.isFinite(remaining) || requested <= 0 || remaining <= 0) return 0;
        const next = Number(nextDuration);
        const limits = [requested, remaining];
        if (Number.isFinite(next) && next > 0) limits.push(next / 2);
        return Math.min(...limits);
    }

    return { getCandidate, getFadeDuration };
});
