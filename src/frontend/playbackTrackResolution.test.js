const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTrack } = require('./playbackTrackResolution');

test('resolves track identifiers consistently when numeric and string forms differ', () => {
    const track = { id: 42, title: 'Track' };
    assert.equal(resolveTrack([track], '42'), track);
});

test('uses the current-track fallback only when its identifier matches', () => {
    const current = { id: 'existing', title: 'Current' };
    assert.equal(resolveTrack([], 'existing', current), current);
    assert.equal(resolveTrack([], 'missing', current), null);
});

test('rejects null identifiers and does not mutate the supplied library', () => {
    const library = [{ id: 1 }];
    assert.equal(resolveTrack(library, null), null);
    assert.equal(resolveTrack(library, undefined), null);
    assert.deepEqual(library, [{ id: 1 }]);
});
