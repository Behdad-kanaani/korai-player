'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase, getDb, flushDatabase } = require('./database');

test('listening history retains substantially more than 500 recent events and cumulative play count', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-db-history-'));
  try {
    initDatabase(dir);
    const track = getDb().addTrack({ filePath: path.join(dir, 'history-test.mp3'), title: 'History test' });

    for (let index = 0; index < 750; index += 1) {
      getDb().addPlayHistory(track.id);
    }

    const history = getDb().getPlayHistory();
    assert.equal(history.length, 750);
    assert.equal(history[0].id, 1);
    assert.equal(history.at(-1).id, 750);
    assert.equal(getDb().getTrackById(track.id).playCount, 750);

    await new Promise(resolve => setTimeout(resolve, 180));
    flushDatabase();
    initDatabase(dir);
    assert.equal(getDb().getPlayHistory().length, 750);
    assert.equal(getDb().getTrackById(track.id).playCount, 750);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('database migration keeps the newest 50,000 events from an oversized history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-db-history-migrate-'));
  try {
    const history = Array.from({ length: 50001 }, (_, index) => ({
      id: index + 1,
      trackId: 1,
      playedAt: index + 1
    }));
    fs.writeFileSync(path.join(dir, 'korai_data_v2.json'), JSON.stringify({
      tracks: [{ id: 1, filePath: path.join(dir, 'track.mp3'), title: 'History migration', playCount: 50001 }],
      playlists: [], play_history: history, likes: [], settings: {},
      nextIds: { track: 2, playlist: 1, history: 50002, like: 1 }
    }));

    initDatabase(dir);
    const retained = getDb().getPlayHistory();
    assert.equal(retained.length, 50000);
    assert.equal(retained[0].id, 2);
    assert.equal(retained.at(-1).id, 50001);
    flushDatabase();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
