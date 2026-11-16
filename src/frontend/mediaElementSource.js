(function exposeMediaElementSource(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiMediaElementSource = api;
})(typeof window !== 'undefined' ? window : globalThis, function createMediaElementSourceApi() {
    'use strict';

    /**
     * Reuses a MediaElementAudioSourceNode while its AudioContext is alive.
     * A media element already bound to a different context must be replaced;
     * disconnecting its old source does not make it eligible for rebinding.
     */
    function acquire(element, context, createSource, recreateElement) {
        if (!element || !context || typeof createSource !== 'function' || typeof recreateElement !== 'function') {
            throw new TypeError('Audio element, context, source factory and recreation factory are required');
        }

        const existingSource = element._koraiSourceNode || null;
        const ownerContext = element._koraiSourceContext || existingSource?.context || null;

        if (existingSource && ownerContext === context) {
            try { existingSource.disconnect(); } catch (_) { /* Reconnecting below is still safe. */ }
            return { element, source: existingSource, replaced: false };
        }

        let target = element;
        if (ownerContext && ownerContext !== context) {
            target = recreateElement(element);
        } else {
            try {
                const source = createSource(target, context);
                target._koraiSourceNode = source;
                target._koraiSourceContext = context;
                return { element: target, source, replaced: false };
            } catch (_) {
                target = recreateElement(element);
            }
        }

        if (!target || target === element) {
            throw new Error('Could not create a fresh media element for the new AudioContext');
        }

        const source = createSource(target, context);
        target._koraiSourceNode = source;
        target._koraiSourceContext = context;
        return { element: target, source, replaced: true };
    }

    return { acquire };
});
