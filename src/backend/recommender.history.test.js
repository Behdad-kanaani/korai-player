'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { persistUserHistory, flushUserHistoryWrites } = require('./userHistoryStore');

test('concurrent listening interactions are serialized and persisted atomically', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-user-history-'));
  try {
    const history = { 42: { playCount: 0, skipCount: 0, skipQuickCount: 0, interactions: [] } };
    for (let index = 0; index < 25; index += 1) {
      history['42'].playCount += 1;
      history['42'].interactions.push({ type: 'play', timestamp: index });
      void persistUserHistory(history, dir);
      if (index % 5 === 0) {
        history['42'].skipCount += 1;
        history['42'].skipQuickCount += 1;
        history['42'].interactions.push({ type: 'skip', timestamp: index });
        void persistUserHistory(history, dir);
      }
    }

    await flushUserHistoryWrites(dir);
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'user_history.json'), 'utf8'));
    assert.equal(persisted['42'].playCount, 25);
    assert.equal(persisted['42'].skipCount, 5);
    assert.equal(persisted['42'].skipQuickCount, 5);
    assert.equal(persisted['42'].interactions.length, 30);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
