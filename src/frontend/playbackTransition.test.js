const test = require('node:test');
const assert = require('node:assert/strict');
const { getCandidate, getFadeDuration, claimFadeStart } = require('./playbackTransition');

const queue = [
    { id: 1, duration: 180 },
    { id: 2, duration: 240 },
    { id: 3, duration: 120 }
];

test('transition selects the next queue item without repeat', () => {
    assert.deepEqual(getCandidate(queue, 0, 1), { track: queue[1], index: 1 });
    assert.equal(getCandidate(queue, 2, 3), null);
});

test('transition wraps to the first item only when repeat-all is enabled', () => {
    assert.equal(getCandidate(queue, 2, 3, { repeatMode: false }), null);
    assert.deepEqual(getCandidate(queue, 2, 3, { repeatMode: true }), { track: queue[0], index: 0 });
});

test('repeat-one transitions to the current track, not the following track', () => {
    assert.deepEqual(getCandidate(queue, 1, 2, { repeatMode: true, repeatOneMode: true }), { track: queue[1], index: 1 });
});

test('preferred-genre playback disables queue preloading', () => {
    assert.equal(getCandidate(queue, 0, 1, { preferredGenreMode: true }), null);
});

test('crossfade duration is bounded by request, remaining track time and half the next segment', () => {
    assert.equal(getFadeDuration(8, 6, 10), 5);
    assert.equal(getFadeDuration(8, 3, 10), 3);
    assert.equal(getFadeDuration(8, 20, 4), 2);
});

test('invalid or non-positive crossfade inputs disable the fade', () => {
    assert.equal(getFadeDuration(0, 10, 10), 0);
    assert.equal(getFadeDuration(5, 0, 10), 0);
    assert.equal(getFadeDuration(Number.NaN, 5, 10), 0);
});


test('only one timeupdate handler can claim a crossfade start', () => {
    const outgoing = {};
    const transition = { outgoing, stage: 'ready' };
    assert.equal(claimFadeStart(transition, outgoing), true);
    assert.equal(transition.stage, 'starting-fade');
    assert.equal(claimFadeStart(transition, outgoing), false);
});

test('crossfade start cannot be claimed for a stale outgoing element', () => {
    const transition = { outgoing: {}, stage: 'ready' };
    assert.equal(claimFadeStart(transition, {}), false);
    assert.equal(transition.stage, 'ready');
});
