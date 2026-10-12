function getCueSegment(track, mediaDuration) {
    const start = Number.isFinite(Number(track?.cueStartTime)) && track?.cueStartTime !== null
        ? Math.max(0, Number(track.cueStartTime))
        : 0;
    const declaredEnd = Number.isFinite(Number(track?.cueEndTime)) && track?.cueEndTime !== null
        ? Number(track.cueEndTime)
        : null;
    const end = declaredEnd !== null && declaredEnd > start
        ? Math.min(declaredEnd, Number.isFinite(mediaDuration) ? mediaDuration : declaredEnd)
        : mediaDuration;
    if (!Number.isFinite(end) || end <= start) {
        return { start: 0, end: mediaDuration, duration: mediaDuration, isCue: false };
    }
    return {
        start,
        end,
        duration: end - start,
        isCue: Boolean(track?.cueSheetPath)
    };
}

function toCueDisplayTime(mediaTime, segment) {
    return Math.max(0, Math.min(segment.duration, mediaTime - segment.start));
}

function toCueMediaTime(displayTime, segment) {
    return Math.max(segment.start, Math.min(segment.end, segment.start + displayTime));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getCueSegment, toCueDisplayTime, toCueMediaTime };
}
