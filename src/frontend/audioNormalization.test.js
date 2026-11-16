'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractReplayGain, getLinearGain, readGainDb, readPeak } = require('./audioNormalization');

test('missing and empty ReplayGain metadata stays null instead of becoming zero', () => {
  assert.equal(readGainDb(null), null);
  assert.equal(readGainDb(undefined), null);
  assert.equal(readGainDb(''), null);
  assert.equal(readGainDb('   '), null);
  assert.equal(readPeak(null), null);
  assert.equal(readPeak(''), null);
  assert.deepEqual(extractReplayGain({}), {
    replayGainTrackDb: null,
    replayGainTrackPeak: null,
    replayGainAlbumDb: null,
    replayGainAlbumPeak: null
  });
});

test('album mode falls back to track gain and peak when album tags are absent', () => {
  const gain = getLinearGain({
    replayGainAlbumDb: null,
    replayGainAlbumPeak: null,
    replayGainTrackDb: 6,
    replayGainTrackPeak: 0.8
  }, { replayGainMode: 'album', replayGainPreventClipping: true });
  assert.ok(Math.abs(gain - 1.25) < 1e-9);
});

test('album mode uses album tags when present', () => {
  const gain = getLinearGain({
    replayGainAlbumDb: -6,
    replayGainAlbumPeak: 0.5,
    replayGainTrackDb: 9,
    replayGainTrackPeak: 0.9
  }, { replayGainMode: 'album', replayGainPreventClipping: false });
  assert.ok(Math.abs(gain - Math.pow(10, -6 / 20)) < 1e-9);
});

test('track mode with no usable tags leaves the source level unchanged', () => {
  assert.equal(getLinearGain({ replayGainTrackDb: null }, { replayGainMode: 'track' }), 1);
});

test('peak protection limits positive gain using the matching peak metadata', () => {
  const gain = getLinearGain({ replayGainTrackDb: 12, replayGainTrackPeak: 0.5 }, {
    replayGainMode: 'track', replayGainPreventClipping: true
  });
  assert.equal(gain, 2);
});
