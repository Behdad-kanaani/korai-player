'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initDatabase, getDb, flushDatabase } = require('./database');

test('database restores the last-known-good snapshot after primary JSON corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-db-recovery-'));
  const dbPath = path.join(dir, 'korai_data_v2.json');
  try {
    initDatabase(dir);
    const track = getDb().addTrack({ filePath: path.join(dir, 'audio.mp3'), title: 'Recoverable track' });
    flushDatabase();
    assert.ok(fs.existsSync(`${dbPath}.last-good`));

    fs.writeFileSync(dbPath, '{ invalid json', 'utf8');
    initDatabase(dir);

    const recovered = getDb().getTrackById(track.id);
    assert.equal(recovered.title, 'Recoverable track');
    assert.ok(fs.readdirSync(dir).some(name => name.startsWith('korai_data_v2.json.corrupt-')));
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(dbPath, 'utf8')));
    flushDatabase();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
