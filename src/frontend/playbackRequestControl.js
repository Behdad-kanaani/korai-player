(function exposePlaybackRequestControl(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiPlaybackRequestControl = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPlaybackRequestControl() {
    'use strict';

    function createAbortError(message = 'Playback request was superseded') {
        const error = new Error(message);
        error.name = 'AbortError';
        return error;
    }

    function createRequestGate() {
        let generation = 0;
        let activeCancellation = null;

        function cancelActive(reason) {
            const active = activeCancellation;
            activeCancellation = null;
            if (active) {
                try { active.cancel(reason); } catch (_) { /* cancellation must not break a new request */ }
            }
        }

        return {
            begin() {
                generation += 1;
                cancelActive(createAbortError());
                return generation;
            },
            isCurrent(requestId) {
                return Number.isInteger(requestId) && requestId === generation;
            },
            onCancel(requestId, cancel) {
                if (typeof cancel !== 'function') return () => {};
                if (requestId !== generation) {
                    cancel(createAbortError());
                    return () => {};
                }
                const entry = { requestId, cancel };
                activeCancellation = entry;
                return () => {
                    if (activeCancellation === entry) activeCancellation = null;
                };
            },
            invalidate() {
                generation += 1;
                cancelActive(createAbortError('Playback state was invalidated'));
                return generation;
            },
            get currentRequestId() {
                return generation;
            }
        };
    }

    function waitForMediaReady(mediaElement, options = {}) {
        if (!mediaElement || typeof mediaElement.addEventListener !== 'function') {
            throw new TypeError('A media element is required');
        }
        const requestedTimeout = Number(options.timeoutMs);
        const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
            ? requestedTimeout
            : 8000;

        let settled = false;
        let timeoutId = null;
        let resolvePromise;
        let rejectPromise;

        const cleanup = () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            mediaElement.removeEventListener('canplay', onCanPlay);
            mediaElement.removeEventListener('error', onError);
        };

        const settle = (handler, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            handler(value);
        };

        const onCanPlay = () => settle(resolvePromise, mediaElement);
        const onError = () => {
            const code = mediaElement.error?.code;
            settle(rejectPromise, new Error(code
                ? `Media resource failed to load (media error ${code})`
                : 'Media resource failed to load'));
        };

        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
            mediaElement.addEventListener('canplay', onCanPlay, { once: true });
            mediaElement.addEventListener('error', onError, { once: true });

            // HAVE_FUTURE_DATA is 3. Checking after listeners are attached prevents
            // missing a fast cache hit between assigning src and registering events.
            if (options.forceWait !== true && Number(mediaElement.readyState) >= 3) {
                settle(resolve, mediaElement);
                return;
            }

            timeoutId = setTimeout(() => {
                settle(reject, new Error(`Timed out waiting for media readiness after ${timeoutMs} ms`));
            }, timeoutMs);
        });

        return {
            promise,
            cancel(reason = createAbortError()) {
                settle(rejectPromise, reason instanceof Error ? reason : createAbortError());
            }
        };
    }

    return { createAbortError, createRequestGate, waitForMediaReady };
});
