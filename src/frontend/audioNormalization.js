(function exposeAudioNormalization(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiAudioNormalization = api;
})(typeof window !== 'undefined' ? window : globalThis, function createAudioNormalization() {
    function finiteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function readGainDb(value) {
        let gainDb;
        if (value && typeof value === 'object') {
            gainDb = finiteNumber(value.dB);
        } else if (typeof value === 'string') {
            const match = value.trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+))(?:\s*dB)?$/i);
            gainDb = match ? finiteNumber(match[1]) : null;
        } else {
            gainDb = finiteNumber(value);
        }
        return gainDb !== null && gainDb >= -60 && gainDb <= 60 ? gainDb : null;
    }

    function readPeak(value) {
        const peak = value && typeof value === 'object'
            ? finiteNumber(value.ratio)
            : finiteNumber(value);
        return peak !== null && peak > 0 && peak <= 16 ? peak : null;
    }

    function extractReplayGain(common = {}) {
        return {
            replayGainTrackDb: readGainDb(common.replaygain_track_gain),
            replayGainTrackPeak: readPeak(common.replaygain_track_peak),
            replayGainAlbumDb: readGainDb(common.replaygain_album_gain),
            replayGainAlbumPeak: readPeak(common.replaygain_album_peak)
        };
    }

    function getLinearGain(track, settings = {}) {
        if (!track || !['track', 'album'].includes(settings.replayGainMode)) return 1;
        let gainDb;
        let peak;
        if (settings.replayGainMode === 'album') {
            gainDb = readGainDb(track.replayGainAlbumDb);
            peak = readPeak(track.replayGainAlbumPeak);
        }
        if (gainDb === null || gainDb === undefined) {
            gainDb = readGainDb(track.replayGainTrackDb);
            peak = readPeak(track.replayGainTrackPeak);
        }
        if (gainDb === null || gainDb === undefined) return 1;

        const preampDb = Math.max(-24, Math.min(24, finiteNumber(settings.replayGainPreampDb) ?? 0));
        let linearGain = Math.pow(10, (gainDb + preampDb) / 20);
        if (settings.replayGainPreventClipping === true && peak > 0) {
            linearGain = Math.min(linearGain, 1 / peak);
        }
        return Number.isFinite(linearGain) ? Math.max(0, Math.min(4, linearGain)) : 1;
    }

    return { extractReplayGain, getLinearGain, readGainDb, readPeak };
});
