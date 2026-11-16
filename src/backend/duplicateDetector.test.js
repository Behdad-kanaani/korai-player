'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findDuplicateGroups } = require('./duplicateDetector');

test('duplicate detector distinguishes byte-identical files as exact duplicates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-duplicates-'));
  const first = path.join(dir, 'first.mp3');
  const second = path.join(dir, 'second.mp3');
  const bytes = Buffer.from('same audio bytes for exact hash verification');
  try {
    fs.writeFileSync(first, bytes);
    fs.writeFileSync(second, bytes);
    const result = await findDuplicateGroups([
      { id: 1, title: 'Track', artist: 'Artist', duration: 180, filePath: first },
      { id: 2, title: 'Track copy', artist: 'Artist', duration: 180, filePath: second }
    ], () => {});
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].type, 'exact');
    assert.deepEqual(result.groups[0].tracks.map(track => track.id).sort(), [1, 2]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('matching metadata alone is not enough to label different audio as a duplicate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-duplicates-'));
  const first = path.join(dir, 'first.mp3');
  const second = path.join(dir, 'second.mp3');
  try {
    fs.writeFileSync(first, Buffer.from('audio bytes one'));
    fs.writeFileSync(second, Buffer.from('audio bytes two'));
    const result = await findDuplicateGroups([
      { id: 1, title: 'Same title', artist: 'Same artist', duration: 180, filePath: first },
      { id: 2, title: 'Same title', artist: 'Same artist', duration: 180, filePath: second }
    ], () => {}, async () => null);
    assert.equal(result.groups.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('acoustic confirmation upgrades a metadata candidate to a same-recording duplicate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-duplicates-'));
  const first = path.join(dir, 'first.mp3');
  const second = path.join(dir, 'second.mp3');
  const signature = Array.from({ length: 10 }, () => [1, 0, 0, 0, 0]);
  try {
    fs.writeFileSync(first, Buffer.from('different encoded bytes one'));
    fs.writeFileSync(second, Buffer.from('different encoded bytes two'));
    const result = await findDuplicateGroups([
      { id: 1, title: 'Same title', artist: 'Same artist', duration: 180, filePath: first },
      { id: 2, title: 'Same title', artist: 'Same artist', duration: 180, filePath: second }
    ], () => {}, async () => signature);
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].type, 'same-recording');
    assert.ok(result.groups[0].evidence.includes('audio-match'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
