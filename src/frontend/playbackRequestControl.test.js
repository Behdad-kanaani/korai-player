const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestGate, waitForMediaReady } = require('./playbackRequestControl');

class FakeMediaElement {
    constructor(readyState = 0) {
        this.readyState = readyState;
        this.error = null;
        this.listeners = new Map();
    }
    addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) {
        this.listeners.get(type)?.delete(callback);
    }
    dispatch(type) {
        for (const callback of [...(this.listeners.get(type) || [])]) callback({ type, target: this });
    }
    listenerCount(type) {
        return this.listeners.get(type)?.size || 0;
    }
}

test('request gate invalidates old playback requests and cancels active work', () => {
    const gate = createRequestGate();
    const first = gate.begin();
    let cancelled = false;
    gate.onCancel(first, () => { cancelled = true; });

    const second = gate.begin();
    assert.equal(cancelled, true);
    assert.equal(gate.isCurrent(first), false);
    assert.equal(gate.isCurrent(second), true);
});

test('request gate invalidation cancels pending media work', () => {
    const gate = createRequestGate();
    const request = gate.begin();
    let cancelled = false;
    gate.onCancel(request, () => { cancelled = true; });
    gate.invalidate();
    assert.equal(cancelled, true);
    assert.equal(gate.isCurrent(request), false);
});

test('media readiness resolves on canplay and removes listeners', async () => {
    const media = new FakeMediaElement();
    const wait = waitForMediaReady(media, { timeoutMs: 100 });
    media.dispatch('canplay');
    assert.equal(await wait.promise, media);
    assert.equal(media.listenerCount('canplay'), 0);
    assert.equal(media.listenerCount('error'), 0);
});

test('already-ready media resolves immediately without leaking listeners', async () => {
    const media = new FakeMediaElement(3);
    const wait = waitForMediaReady(media, { timeoutMs: 100 });
    assert.equal(await wait.promise, media);
    assert.equal(media.listenerCount('canplay'), 0);
    assert.equal(media.listenerCount('error'), 0);
});

test('media readiness rejects on media error and cleans up', async () => {
    const media = new FakeMediaElement();
    media.error = { code: 4 };
    const wait = waitForMediaReady(media, { timeoutMs: 100 });
    media.dispatch('error');
    await assert.rejects(wait.promise, /media error 4/);
    assert.equal(media.listenerCount('canplay'), 0);
    assert.equal(media.listenerCount('error'), 0);
});

test('media readiness timeout rejects instead of reporting success', async () => {
    const media = new FakeMediaElement();
    const wait = waitForMediaReady(media, { timeoutMs: 10 });
    await assert.rejects(wait.promise, /Timed out waiting for media readiness/);
    assert.equal(media.listenerCount('canplay'), 0);
    assert.equal(media.listenerCount('error'), 0);
});

test('media readiness cancellation rejects and cleans up', async () => {
    const media = new FakeMediaElement();
    const wait = waitForMediaReady(media, { timeoutMs: 100 });
    wait.cancel();
    await assert.rejects(wait.promise, error => error.name === 'AbortError');
    assert.equal(media.listenerCount('canplay'), 0);
    assert.equal(media.listenerCount('error'), 0);
});


test('a newer selection cancels the previous media readiness wait', async () => {
    const gate = createRequestGate();
    const media = new FakeMediaElement();
    const firstRequest = gate.begin();
    const wait = waitForMediaReady(media, { timeoutMs: 100 });
    gate.onCancel(firstRequest, wait.cancel);

    const secondRequest = gate.begin();
    await assert.rejects(wait.promise, error => error.name === 'AbortError');
    assert.equal(gate.isCurrent(firstRequest), false);
    assert.equal(gate.isCurrent(secondRequest), true);
    assert.equal(media.listenerCount('canplay'), 0);
    assert.equal(media.listenerCount('error'), 0);
});


test('forceWait ignores a stale readyState until the new source emits canplay', async () => {
    const media = new FakeMediaElement(4);
    const wait = waitForMediaReady(media, { timeoutMs: 100, forceWait: true });
    let settled = false;
    wait.promise.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    media.dispatch('canplay');
    assert.equal(await wait.promise, media);
});
