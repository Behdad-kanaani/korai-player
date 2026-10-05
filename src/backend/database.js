// JSON-backed persistence for the local KORAI library.
// The module keeps the public API synchronous while debouncing durable writes.

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

let dbData = null;
let dbPath = null;
let coversDir = null;
let saveDebounceTimer = null;
let isSaving = false;
let saveQueued = false;

const defaultData = {
  tracks: [],
  playlists: [],
  play_history: [],
  likes: [],
  settings: { isFirstLaunch: true },
  nextIds: { track: 1, playlist: 1, history: 1, like: 1 }
};

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(defaultData));
}

function maxId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
}

function normalizeDatabase(data) {
  const source = data && typeof data === 'object' ? data : {};
  const normalized = {
    tracks: Array.isArray(source.tracks) ? source.tracks : [],
    playlists: Array.isArray(source.playlists) ? source.playlists : [],
    play_history: Array.isArray(source.play_history) ? source.play_history : [],
    likes: Array.isArray(source.likes) ? source.likes : [],
    settings: source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings)
      ? source.settings
      : { isFirstLaunch: true },
    nextIds: source.nextIds && typeof source.nextIds === 'object' ? source.nextIds : {}
  };

  normalized.playlists = normalized.playlists.map(playlist => ({
    id: Number(playlist?.id) || 0,
    name: String(playlist?.name || 'New Playlist'),
    tracks: Array.isArray(playlist?.tracks) ? playlist.tracks.map(Number).filter(Number.isInteger) : [],
    createdAt: Number(playlist?.createdAt) || Date.now()
  })).filter(p => p.id > 0);

  normalized.tracks = normalized.tracks.map(track => ({
    ...track,
    id: Number(track?.id) || 0,
    title: String(track?.title || 'Unknown Title'),
    artist: String(track?.artist || ''),
    filePath: typeof track?.filePath === 'string' ? track.filePath : '',
    duration: Number(track?.duration) || 0,
    bpm: Number(track?.bpm) || 120,
    energy: Number.isFinite(Number(track?.energy)) ? Number(track.energy) : 0.5,
    loudness: Number.isFinite(Number(track?.loudness)) ? Number(track.loudness) : -12,
    genre: String(track?.genre || ''),
    genreConfidence: Number.isFinite(Number(track?.genreConfidence)) ? Number(track.genreConfidence) : 0,
    album: String(track?.album || ''),
    year: Number(track?.year) || null,
    trackNumber: Number(track?.trackNumber) || null,
    composer: String(track?.composer || ''),
    lyrics: track?.lyrics ?? null,
    coverPath: track?.coverPath || null,
    coverFilename: track?.coverFilename || null,
    hasCover: Boolean(track?.hasCover || track?.coverPath),
    playCount: Number(track?.playCount) || 0,
    likeCount: Number(track?.likeCount) || 0,
    createdAt: Number(track?.createdAt) || Date.now(),
    updatedAt: Number(track?.updatedAt) || Number(track?.createdAt) || Date.now(),
    isLiked: Boolean(track?.isLiked),
    sampleRate: Number(track?.sampleRate) || 0,
    bitrate: Number(track?.bitrate) || 0,
    codec: String(track?.codec || ''),
    featureVector: Array.isArray(track?.featureVector) ? track.featureVector : (track?.featureVector ?? null),
    rawFeatures: track?.rawFeatures && typeof track.rawFeatures === 'object' ? track.rawFeatures : null
  })).filter(t => t.id > 0 && t.filePath);

  const trackIds = new Set(normalized.tracks.map(t => t.id));
  normalized.likes = normalized.likes
    .map(like => ({
      id: Number(like?.id) || 0,
      trackId: Number(like?.trackId),
      likedAt: Number(like?.likedAt) || Date.now()
    }))
    .filter(like => like.id > 0 && trackIds.has(like.trackId));
  const likedIds = new Set(normalized.likes.map(like => like.trackId));
  for (const track of normalized.tracks) track.isLiked = likedIds.has(track.id);

  normalized.play_history = normalized.play_history
    .map(entry => ({
      id: Number(entry?.id) || 0,
      trackId: Number(entry?.trackId),
      playedAt: Number(entry?.playedAt) || Date.now()
    }))
    .filter(entry => entry.id > 0 && trackIds.has(entry.trackId))
    .slice(-500);

  for (const playlist of normalized.playlists) {
    playlist.tracks = playlist.tracks.filter(trackId => trackIds.has(trackId));
  }

  normalized.nextIds = {
    track: Math.max(Number(normalized.nextIds.track) || 1, maxId(normalized.tracks) + 1),
    playlist: Math.max(Number(normalized.nextIds.playlist) || 1, maxId(normalized.playlists) + 1),
    history: Math.max(Number(normalized.nextIds.history) || 1, maxId(normalized.play_history) + 1),
    like: Math.max(Number(normalized.nextIds.like) || 1, maxId(normalized.likes) + 1)
  };

  return normalized;
}

function initDatabase(userDataPath) {
  if (!userDataPath) throw new Error('userDataPath is required');

  dbPath = path.join(userDataPath, 'korai_data_v2.json');
  coversDir = path.join(userDataPath, 'covers');
  fs.mkdirSync(coversDir, { recursive: true });

  let parsed = null;
  if (fs.existsSync(dbPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (error) {
      const corruptPath = `${dbPath}.corrupt-${Date.now()}`;
      try { fs.renameSync(dbPath, corruptPath); } catch {}
      console.warn('[database] Corrupt database detected; starting from defaults:', error.message);
    }
  }

  dbData = normalizeDatabase(parsed || cloneDefaultData());
  if (!parsed) saveDatabaseSync();
  else if (JSON.stringify(parsed) !== JSON.stringify(dbData)) saveDatabase();
  return dbData;
}

async function saveDatabaseAsync() {
  if (!dbPath || !dbData) return;
  if (isSaving) {
    saveQueued = true;
    return;
  }

  isSaving = true;
  const tempPath = `${dbPath}.tmp`;
  try {
    const jsonContent = JSON.stringify(dbData, null, 2);
    await fsPromises.writeFile(tempPath, jsonContent, 'utf8');
    await fsPromises.rename(tempPath, dbPath);
  } catch (error) {
    console.error('[database] Atomic write failed:', error);
    try { await fsPromises.unlink(tempPath); } catch {}
  } finally {
    isSaving = false;
    if (saveQueued) {
      saveQueued = false;
      queueMicrotask(() => saveDatabaseAsync().catch(err => console.error('[database] queued save failed:', err)));
    }
  }
}

function saveDatabase() {
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveDatabaseAsync().catch(error => console.error('[database] save failed:', error));
  }, 100);
}

function saveDatabaseSync() {
  if (!dbPath || !dbData) return;
  const tempPath = `${dbPath}.tmp`;
  const payload = JSON.stringify(dbData, null, 2);
  try {
    fs.writeFileSync(tempPath, payload, 'utf8');
    fs.renameSync(tempPath, dbPath);
  } catch (error) {
    console.error('[database] Atomic sync write failed:', error);
    try { fs.writeFileSync(dbPath, payload, 'utf8'); } catch (fallbackError) {
      console.error('[database] Fallback sync write failed:', fallbackError);
    }
  }
}

function cloneTrack(track) {
  if (!track) return null;
  return {
    ...track,
    featureVector: Array.isArray(track.featureVector) ? [...track.featureVector] : track.featureVector,
    rawFeatures: track.rawFeatures && typeof track.rawFeatures === 'object' ? { ...track.rawFeatures } : track.rawFeatures
  };
}

function getDb() {
  if (!dbData) throw new Error('Database not initialized');

  return {
    getAllTracks: () => [...dbData.tracks].sort((a, b) => b.createdAt - a.createdAt).map(cloneTrack),

    getTrackById: (id) => cloneTrack(dbData.tracks.find(track => track.id === Number(id))),

    // Internal mutable lookup used by server code that needs to update a track.
    getMutableTrackById: (id) => dbData.tracks.find(track => track.id === Number(id)) || null,

    addTrack: (track, autoSave = true) => {
      if (!track || typeof track !== 'object' || typeof track.filePath !== 'string' || !track.filePath) {
        throw new Error('A valid track with filePath is required');
      }

      const existing = dbData.tracks.find(t => t.filePath === track.filePath);
      if (existing) return cloneTrack(existing);

      const newId = dbData.nextIds.track++;
      let coverPath = null;
      let coverFilename = null;
      if (track.coverImage && track.coverImage.length > 0) {
        coverFilename = `cover_${newId}_${Date.now()}.jpg`;
        coverPath = path.join(coversDir, coverFilename);
        const coverBuffer = Buffer.isBuffer(track.coverImage) ? track.coverImage : Buffer.from(track.coverImage);
        try { fs.writeFileSync(coverPath, coverBuffer); } catch (error) {
          console.warn('[database] Failed to save cover:', error.message);
          coverPath = null;
          coverFilename = null;
        }
      }

      const now = Date.now();
      const newTrack = {
        id: newId,
        title: String(track.title || 'Unknown Title'),
        artist: String(track.artist || ''),
        filePath: track.filePath,
        duration: Number(track.duration) || 0,
        bpm: Number(track.bpm) || 120,
        energy: Number.isFinite(Number(track.energy)) ? Number(track.energy) : 0.5,
        loudness: Number.isFinite(Number(track.loudness)) ? Number(track.loudness) : -12,
        genre: String(track.genre || ''),
        genreConfidence: Number.isFinite(Number(track.genreConfidence)) ? Number(track.genreConfidence) : 0,
        album: String(track.album || ''),
        year: Number(track.year) || null,
        trackNumber: Number(track.trackNumber) || null,
        composer: String(track.composer || ''),
        lyrics: track.lyrics ?? null,
        coverPath,
        coverFilename,
        hasCover: Boolean(coverPath),
        playCount: 0,
        likeCount: 0,
        createdAt: now,
        updatedAt: now,
        isLiked: false,
        sampleRate: Number(track.sampleRate) || 0,
        bitrate: Number(track.bitrate) || 0,
        codec: String(track.codec || ''),
        featureVector: Array.isArray(track.featureVector) ? [...track.featureVector] : (track.featureVector ?? null),
        rawFeatures: track.rawFeatures && typeof track.rawFeatures === 'object' ? { ...track.rawFeatures } : null
      };

      dbData.tracks.push(newTrack);
      if (autoSave) saveDatabase();
      return cloneTrack(newTrack);
    },

    save: () => saveDatabase(),

    deleteTrack: (id) => {
      const numericId = Number(id);
      const index = dbData.tracks.findIndex(track => track.id === numericId);
      if (index === -1) return false;

      const deleted = dbData.tracks[index];
      if (deleted.coverPath && fs.existsSync(deleted.coverPath)) {
        try { fs.unlinkSync(deleted.coverPath); } catch {}
      }

      dbData.tracks.splice(index, 1);
      for (const playlist of dbData.playlists) {
        playlist.tracks = playlist.tracks.filter(trackId => trackId !== numericId);
      }
      dbData.play_history = dbData.play_history.filter(entry => entry.trackId !== numericId);
      dbData.likes = dbData.likes.filter(like => like.trackId !== numericId);
      saveDatabase();
      return true;
    },

    getPlaylists: () => dbData.playlists.map(playlist => ({ ...playlist, tracks: [...playlist.tracks] })),

    createPlaylist: (name) => {
      const newPlaylist = {
        id: dbData.nextIds.playlist++,
        name: String(name || 'New Playlist').trim().slice(0, 200) || 'New Playlist',
        tracks: [],
        createdAt: Date.now()
      };
      dbData.playlists.push(newPlaylist);
      saveDatabase();
      return { ...newPlaylist, tracks: [] };
    },

    deletePlaylist: (id) => {
      const index = dbData.playlists.findIndex(playlist => playlist.id === Number(id));
      if (index === -1) return false;
      dbData.playlists.splice(index, 1);
      saveDatabase();
      return true;
    },

    addTrackToPlaylist: (playlistId, trackId) => {
      const playlist = dbData.playlists.find(item => item.id === Number(playlistId));
      const numericTrackId = Number(trackId);
      if (!playlist || !dbData.tracks.some(track => track.id === numericTrackId)) return false;
      if (!playlist.tracks.includes(numericTrackId)) playlist.tracks.push(numericTrackId);
      saveDatabase();
      return true;
    },

    removeTrackFromPlaylist: (playlistId, trackId) => {
      const playlist = dbData.playlists.find(item => item.id === Number(playlistId));
      if (!playlist) return false;
      const numericTrackId = Number(trackId);
      playlist.tracks = playlist.tracks.filter(item => item !== numericTrackId);
      saveDatabase();
      return true;
    },

    addPlayHistory: (trackId) => {
      const numericTrackId = Number(trackId);
      const track = dbData.tracks.find(item => item.id === numericTrackId);
      if (!track) return null;

      const history = {
        id: dbData.nextIds.history++,
        trackId: numericTrackId,
        playedAt: Date.now()
      };
      dbData.play_history.push(history);
      track.playCount = (track.playCount || 0) + 1;
      track.updatedAt = Date.now();
      if (dbData.play_history.length > 500) dbData.play_history = dbData.play_history.slice(-500);
      saveDatabase();
      return { ...history };
    },

    likeTrack: (trackId) => {
      const numericTrackId = Number(trackId);
      const track = dbData.tracks.find(item => item.id === numericTrackId);
      if (!track || dbData.likes.some(like => like.trackId === numericTrackId)) return false;

      dbData.likes.push({ id: dbData.nextIds.like++, trackId: numericTrackId, likedAt: Date.now() });
      track.likeCount = (track.likeCount || 0) + 1;
      track.isLiked = true;
      track.updatedAt = Date.now();
      saveDatabase();
      return true;
    },

    unlikeTrack: (trackId) => {
      const numericTrackId = Number(trackId);
      const index = dbData.likes.findIndex(like => like.trackId === numericTrackId);
      if (index === -1) return false;

      dbData.likes.splice(index, 1);
      const track = dbData.tracks.find(item => item.id === numericTrackId);
      if (track) {
        track.likeCount = Math.max(0, (track.likeCount || 0) - 1);
        track.isLiked = false;
        track.updatedAt = Date.now();
      }
      saveDatabase();
      return true;
    },

    isLiked: (trackId) => dbData.likes.some(like => like.trackId === Number(trackId)),

    getSettings: () => {
      if (!dbData.settings) dbData.settings = { isFirstLaunch: true };
      return { ...dbData.settings };
    },

    updateSettings: (newSettings) => {
      if (!newSettings || typeof newSettings !== 'object' || Array.isArray(newSettings)) throw new Error('Settings must be an object');
      dbData.settings = { ...dbData.settings, ...newSettings };
      saveDatabase();
      return { ...dbData.settings };
    },

    getDbSettings: () => ({ ...(dbData.settings || { isFirstLaunch: true }) }),

    getStats: () => {
      const totalPlays = dbData.tracks.reduce((sum, track) => sum + (track.playCount || 0), 0);
      const mostPlayed = [...dbData.tracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0))[0];
      return {
        totalTracks: dbData.tracks.length,
        totalPlayCount: totalPlays,
        totalLikes: dbData.likes.length,
        mostPlayed: mostPlayed ? {
          title: mostPlayed.title,
          artist: mostPlayed.artist,
          playCount: mostPlayed.playCount
        } : null
      };
    }
  };
}

module.exports = { initDatabase, getDb };
