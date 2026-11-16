const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolvePlaylistImportPath, normalizePlaylistLocation, exportToXSPF } = require('./playlistExporter');

test('playlist imports reject traversal and canonical symlink escapes', () => {
  const playlistRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-playlist-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-playlist-outside-'));
  try {
    const allowedTrack = path.join(playlistRoot, 'allowed.mp3');
    const outsideTrack = path.join(outsideRoot, 'outside.mp3');
    fs.writeFileSync(allowedTrack, 'allowed');
    fs.writeFileSync(outsideTrack, 'outside');

    assert.equal(resolvePlaylistImportPath('allowed.mp3', playlistRoot), fs.realpathSync(allowedTrack));
    assert.equal(resolvePlaylistImportPath(path.relative(playlistRoot, outsideTrack), playlistRoot), null);
    assert.equal(resolvePlaylistImportPath(outsideTrack, playlistRoot), null);

    const link = path.join(playlistRoot, 'escape.mp3');
    try {
      fs.symlinkSync(outsideTrack, link, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return;
      throw error;
    }
    assert.equal(resolvePlaylistImportPath('escape.mp3', playlistRoot), null);
  } finally {
    fs.rmSync(playlistRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('playlist file URIs are decoded by URL rules and remote schemes are rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-playlist-uri-'));
  try {
    const track = path.join(root, 'track with space.mp3');
    fs.writeFileSync(track, 'audio');
    const fileUri = pathToFileURL(track).href;
    assert.equal(normalizePlaylistLocation(fileUri), track);
    assert.equal(resolvePlaylistImportPath(fileUri, root), fs.realpathSync(track));
    assert.equal(normalizePlaylistLocation('https://example.invalid/track.mp3'), null);
    assert.equal(normalizePlaylistLocation('file:///bad%2'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('XSPF export uses platform-correct encoded file URLs for track paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-xspf-export-'));
  try {
    const trackPath = path.join(root, 'track with spaces & symbols.mp3');
    const outputPath = path.join(root, 'playlist.xspf');
    fs.writeFileSync(trackPath, 'audio');
    exportToXSPF(
      { name: 'Test playlist', tracks: [1] },
      [{ id: 1, filePath: trackPath, title: 'Track', artist: 'Artist' }],
      outputPath,
      root
    );
    const xml = fs.readFileSync(outputPath, 'utf8');
    const expectedLocation = pathToFileURL(trackPath).href.replaceAll('&', '&amp;');
    assert.ok(xml.includes(`<location>${expectedLocation}</location>`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
