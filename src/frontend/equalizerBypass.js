(function exposeEqualizerBypass(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiEqualizerBypass = api;
})(typeof window !== 'undefined' ? window : globalThis, function createEqualizerBypass() {
    'use strict';

    function apply(filterGroups, bypassed, values, context, rampSeconds = 0.025) {
        const now = Number.isFinite(context?.currentTime) ? context.currentTime : 0;
        const seen = new Set();
        let updated = 0;
        for (const group of filterGroups || []) {
            for (let index = 0; index < (group || []).length; index++) {
                const filter = group[index];
                if (!filter || seen.has(filter) || !filter.gain) continue;
                seen.add(filter);
                const raw = Array.isArray(values) ? values[index] : 0;
                const target = bypassed ? 0 : (Number.isFinite(Number(raw)) ? Number(raw) : 0);
                try {
                    if (typeof filter.gain.cancelScheduledValues === 'function') {
                        filter.gain.cancelScheduledValues(now);
                    }
                    if (typeof filter.gain.setTargetAtTime === 'function') {
                        filter.gain.setTargetAtTime(target, now, rampSeconds);
                    } else {
                        filter.gain.value = target;
                    }
                    updated++;
                } catch (_) {
                    // A filter may already have been disconnected during a track swap.
                }
            }
        }
        return updated;
    }

    return { apply };
});
