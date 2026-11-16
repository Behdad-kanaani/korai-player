'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, getMood, moodScore, buildListeningOverview, buildBehaviorOverview, getLibraryHealth, discoverTracks, filterPlaylist } = require('./intelligence');

test('LRC parser supports multiple timestamps and sorts chronologically', () => {
  assert.deepEqual(parseLrc('[00:12.50][00:14.00]Hello\n[01:02.2]World'), [
    { time: 12.5, text: 'Hello' }, { time: 14, text: 'Hello' }, { time: 62.2, text: 'World' }
  ]);
});
test('mood classifier uses available audio features without inventing them', () => {
  assert.equal(getMood({ bpm: 80, energy: 0.08, genre: 'Ambient' }), 'ambient');
  assert.equal(moodScore({ bpm: 130, energy: 0.6 }, 'energetic') > 0, true);
});
test('listening overview aggregates history by artist and hour', () => {
  const tracks=[{id:1,title:'A',artist:'Artist',album:'Album',genre:'Rock'}];
  const history=[{trackId:1,playedAt:new Date(2025,0,1,13).getTime()}];
  const report=buildListeningOverview(tracks,history);
  assert.equal(report.totalPlays,1);
  assert.equal(report.topArtists[0].name,'Artist');
  assert.equal(report.hourlyActivity[13].plays,1);
});
test('listening behavior summary aggregates real skip and completion counters', () => {
  const summary = buildBehaviorOverview({
    1: { skipCount: 3, skipQuickCount: 2, completionCount: 4, repeatCount: 1, totalListeningTime: 7200 },
    2: { skipCount: 1, skipQuickCount: 1, completionCount: 0, totalListeningTime: 0 },
    invalid: null
  });
  assert.equal(summary.skips, 4);
  assert.equal(summary.quickSkips, 3);
  assert.equal(summary.completions, 4);
  assert.equal(summary.repeats, 1);
  assert.equal(summary.listeningTimeSeconds, 7200);
  assert.equal(summary.tracksWithSkips, 2);
  assert.equal(summary.tracksWithCompletions, 1);
});

test('library health reports missing metadata and artwork', async () => {
  const report=await getLibraryHealth([{id:1,title:'No tags',artist:'',album:'',genre:'',filePath:'/definitely/missing',hasCover:false}]);
  assert.equal(report.summary.missingFiles,1);
  assert.equal(report.summary.incompleteMetadata,1);
  assert.equal(report.summary.missingArtwork,1);
});
test('discovery ranks unheard tracks and playlist filters respect numeric constraints', () => {
  const tracks=[{id:1,title:'Fast',bpm:128,energy:.7,artist:'A'},{id:2,title:'Slow',bpm:80,energy:.2,artist:'B'}];
  assert.equal(discoverTracks(tracks,[])[0].track.id,1);
  assert.deepEqual(filterPlaylist(tracks,{minBpm:100,maxBpm:140}).map(t=>t.id),[1]);
});

test('ReplayGain normalization limits gain to prevent clipping', () => {
  const { getLinearGain } = require('../frontend/audioNormalization');
  const gain = getLinearGain({ replayGainTrackDb: 8, replayGainTrackPeak: 0.8 }, {
    replayGainMode: 'track', replayGainPreventClipping: true
  });
  assert.ok(gain <= 1.25 + 1e-9);
});

test('database exposes a read-only play-history snapshot for intelligence reports', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { initDatabase, getDb, flushDatabase } = require('./database');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-intelligence-'));
  try {
    initDatabase(dir);
    const db = getDb();
    const track = db.addTrack({ filePath: path.join(dir, 'track.mp3'), title: 'Test track' });
    db.addPlayHistory(track.id);
    const history = db.getPlayHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].trackId, track.id);
    flushDatabase();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('library health detects files changed after indexing and counts healthy tracks without double-subtracting issues', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-health-'));
  const file = path.join(dir, 'track.mp3');
  try {
    fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
    const stat = fs.statSync(file);
    const report = await getLibraryHealth([{
      id: 1, title: 'Track', artist: '', album: '', genre: '', filePath: file,
      fileSize: stat.size - 1, fileMtimeMs: stat.mtimeMs, hasCover: false
    }]);
    assert.equal(report.summary.changedFiles, 1);
    assert.equal(report.summary.incompleteMetadata, 1);
    assert.equal(report.summary.missingArtwork, 1);
    assert.equal(report.healthy, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('playlist genre filter matches a contained genre phrase as its UI label promises', () => {
  const tracks = [
    { id: 1, genre: 'Alternative Rock' },
    { id: 2, genre: 'Jazz' }
  ];
  assert.deepEqual(filterPlaylist(tracks, { genres: ['rock'] }).map(track => track.id), [1]);
});


test('empty playlist controls do not become zero-valued upper bounds', () => {
  const tracks = [
    { id: 1, title: 'Normal track', bpm: 120, energy: 0.5, artist: 'A' },
    { id: 2, title: 'Low energy track', bpm: 80, energy: 0.1, artist: 'B' }
  ];
  const result = filterPlaylist(tracks, {
    minBpm: null, maxBpm: null, minEnergy: null, maxEnergy: null,
    genres: [], maxPerArtist: 2, sortBy: 'bpm', unplayed30Days: false
  });
  assert.deepEqual(result.map(track => track.id), [2, 1]);
});

test('missing audio measurements are not interpreted as zero during mood scoring', () => {
  assert.equal(moodScore({ bpm: null, energy: null, musicalKey: null }, 'ambient'), 0);
  assert.equal(moodScore({ bpm: null, energy: null, musicalKey: null }, 'calm'), 0);
});
