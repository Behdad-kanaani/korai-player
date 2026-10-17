// JSON-backed persistence for the local KORAI library.
// The module keeps the public API synchronous while debouncing durable writes.

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { normalizeSmartCriteria, resolveSmartPlaylistTracks } = require('./smartPlaylist');

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
const MUSICAL_KEY_PATTERN = /^(?:C|C#|D|D#|E|F|F#|G|G#|A|A#|B) (?:major|minor)$/;

function cloneDefaultData() {
  return JSON.parse(JSON.stringify(defaultData));
}

function maxId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item?.id) || 0), 0);
}

function normalizeReplayGainDb(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= -60 && number <= 60 ? number : null;
}

function normalizeReplayGainPeak(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 16 ? number : null;
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

  normalized.playlists = normalized.playlists.map(playlist => {
    let smartCriteria = null;
    if (playlist?.smartCriteria) {
      try { smartCriteria = normalizeSmartCriteria(playlist.smartCriteria); } catch {}
    }
    return {
      id: Number(playlist?.id) || 0,
      name: String(playlist?.name || 'New Playlist'),
      tracks: Array.isArray(playlist?.tracks) ? playlist.tracks.map(Number).filter(Number.isInteger) : [],
      createdAt: Number(playlist?.createdAt) || Date.now(),
      cueSheetPath: typeof playlist?.cueSheetPath === 'string' ? playlist.cueSheetPath : null,
      smartCriteria
    };
  }).filter(p => p.id > 0);

  normalized.tracks = normalized.tracks.map(track => ({
    ...track,
    id: Number(track?.id) || 0,
    title: String(track?.title || 'Unknown Title'),
    artist: String(track?.artist || ''),
    filePath: typeof track?.filePath === 'string' ? track.filePath : '',
    fileSize: track?.fileSize !== null && track?.fileSize !== undefined && track?.fileSize !== '' &&
      Number.isSafeInteger(Number(track.fileSize)) && Number(track.fileSize) >= 0
      ? Number(track.fileSize) : null,
    fileMtimeMs: track?.fileMtimeMs !== null && track?.fileMtimeMs !== undefined && track?.fileMtimeMs !== '' &&
      Number.isFinite(Number(track.fileMtimeMs)) && Number(track.fileMtimeMs) > 0
      ? Number(track.fileMtimeMs) : null,
    duration: Number(track?.duration) || 0,
    bpm: ['metadata', 'waveform'].includes(track?.bpmSource) &&
      track?.bpm !== null && track?.bpm !== undefined && Number.isFinite(Number(track.bpm))
      ? Number(track.bpm)
      : null,
    bpmConfidence: ['metadata', 'waveform'].includes(track?.bpmSource) &&
      track?.bpmConfidence !== null && track?.bpmConfidence !== undefined &&
      Number.isFinite(Number(track?.bpmConfidence))
      ? Math.min(1, Math.max(0, Number(track.bpmConfidence)))
      : null,
    bpmSource: ['metadata', 'waveform'].includes(track?.bpmSource) ? track.bpmSource : 'unavailable',
    musicalKey: track?.keySource === 'waveform-chroma-v1' &&
      typeof track?.musicalKey === 'string' && MUSICAL_KEY_PATTERN.test(track.musicalKey)
      ? track.musicalKey : null,
    keyConfidence: track?.keySource === 'waveform-chroma-v1' &&
      Number.isFinite(Number(track?.keyConfidence))
      ? Math.min(1, Math.max(0, Number(track.keyConfidence)))
      : 0,
    keySource: track?.keySource === 'waveform-chroma-v1' ? 'waveform-chroma-v1' : 'unavailable',
    energy: track?.energySource === 'waveform-rms' &&
      (track?.rmsLevel ?? track?.energy) !== null && (track?.rmsLevel ?? track?.energy) !== undefined &&
      Number.isFinite(Number(track.rmsLevel ?? track.energy))
      ? Number(track.rmsLevel ?? track.energy)
      : null,
    rmsLevel: track?.energySource === 'waveform-rms' &&
      (track?.rmsLevel ?? track?.energy) !== null && (track?.rmsLevel ?? track?.energy) !== undefined &&
      Number.isFinite(Number(track.rmsLevel ?? track.energy))
      ? Number(track.rmsLevel ?? track.energy)
      : null,
    loudness: track?.energySource === 'waveform-rms' &&
      track?.loudness !== null && track?.loudness !== undefined && Number.isFinite(Number(track.loudness))
      ? Number(track.loudness)
      : null,
    energySource: track?.energySource === 'waveform-rms' ? 'waveform-rms' : 'unavailable',
    genre: track?.genreSource === 'metadata' ? String(track?.genre || '') : '',
    genreSource: track?.genreSource === 'metadata'
      ? 'metadata'
      : track?.genreSource === 'unavailable' ? 'unavailable' : '',
    genreConfidence: track?.genreSource === 'metadata' &&
      Number.isFinite(Number(track?.genreConfidence))
      ? Math.min(1, Math.max(0, Number(track.genreConfidence)))
      : 0,
    album: String(track?.album || ''),
    year: Number(track?.year) || null,
    trackNumber: Number(track?.trackNumber) || null,
    cueSheetPath: typeof track?.cueSheetPath === 'string' ? track.cueSheetPath : null,
    cueTrackNumber: Number(track?.cueTrackNumber) > 0 ? Number(track.cueTrackNumber) : null,
    cueStartTime: track?.cueStartTime !== null && track?.cueStartTime !== undefined &&
      track?.cueStartTime !== '' && Number.isFinite(Number(track.cueStartTime)) && Number(track.cueStartTime) >= 0
      ? Number(track.cueStartTime) : null,
    cueEndTime: track?.cueEndTime !== null && track?.cueEndTime !== undefined &&
      track?.cueEndTime !== '' && Number.isFinite(Number(track.cueEndTime)) && Number(track.cueEndTime) > 0
      ? Number(track.cueEndTime) : null,
    replayGainTrackDb: normalizeReplayGainDb(track?.replayGainTrackDb),
    replayGainTrackPeak: normalizeReplayGainPeak(track?.replayGainTrackPeak),
    replayGainAlbumDb: normalizeReplayGainDb(track?.replayGainAlbumDb),
    replayGainAlbumPeak: normalizeReplayGainPeak(track?.replayGainAlbumPeak),
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
    analysisVersion: track?.analysisVersion === 'waveform-v2' ? 'waveform-v2' : null,
    featureVector: track?.analysisVersion === 'waveform-v2' && Array.isArray(track?.featureVector)
      ? track.featureVector
      : null,
    rawFeatures: track?.analysisVersion === 'waveform-v2' && track?.rawFeatures && typeof track.rawFeatures === 'object'
      ? track.rawFeatures
      : null,
    voiceFingerprint: track?.voiceFingerprint && typeof track.voiceFingerprint === 'object' ? track.voiceFingerprint : null
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
    rawFeatures: track.rawFeatures && typeof track.rawFeatures === 'object' ? { ...track.rawFeatures } : track.rawFeatures,
    voiceFingerprint: track.voiceFingerprint && typeof track.voiceFingerprint === 'object'
      ? { ...track.voiceFingerprint, spectralEnvelope: Array.isArray(track.voiceFingerprint.spectralEnvelope) ? [...track.voiceFingerprint.spectralEnvelope] : [] }
      : null
  };
}

const BACKUP_FORMAT = 'korai-library-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_COVER_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_TOTAL_BYTES = 256 * 1024 * 1024;

function createDatabaseBackup() {
  const backupData = JSON.parse(JSON.stringify(dbData));
  const coverAssets = {};
  let totalCoverBytes = 0;
  for (const track of backupData.tracks) {
    const filename = typeof track.coverFilename === 'string' ? path.basename(track.coverFilename) : '';
    const coverPath = filename ? path.join(coversDir, filename) : null;
    if (!coverPath || !fs.existsSync(coverPath)) {
      track.coverPath = null;
      track.coverFilename = null;
      track.hasCover = false;
      continue;
    }
    const cover = fs.readFileSync(coverPath);
    if (cover.length > MAX_BACKUP_COVER_BYTES) {
      throw new Error(`Cover for "${track.title}" exceeds the backup size limit.`);
    }
    totalCoverBytes += cover.length;
    if (totalCoverBytes > MAX_BACKUP_TOTAL_BYTES) {
      throw new Error('Artwork exceeds the maximum backup size.');
    }
    coverAssets[String(track.id)] = cover.toString('base64');
    track.coverPath = null;
  }
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    database: backupData,
    coverAssets
  };
  if (Buffer.byteLength(JSON.stringify(backup), 'utf8') > MAX_BACKUP_TOTAL_BYTES) {
    throw new Error('Library backup exceeds the 256 MiB size limit.');
  }
  return backup;
}

function restoreDatabaseBackup(backup) {
  if (isSaving || saveQueued) {
    throw new Error('The library database is busy saving; retry the restore shortly.');
  }
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) ||
      backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION ||
      !backup.database || typeof backup.database !== 'object' || Array.isArray(backup.database)) {
    throw new Error('This file is not a supported KORAI library backup.');
  }
  if (!Array.isArray(backup.database.tracks) || backup.database.tracks.length > 200_000 ||
      !Array.isArray(backup.database.playlists) ||
      (backup.coverAssets !== undefined &&
       (!backup.coverAssets || typeof backup.coverAssets !== 'object' || Array.isArray(backup.coverAssets)))) {
    throw new Error('The backup data structure is invalid or exceeds supported limits.');
  }
  for (const playlist of backup.database.playlists) {
    if (playlist?.smartCriteria) normalizeSmartCriteria(playlist.smartCriteria);
  }

  const rawTracks = backup.database.tracks;
  const trackIds = new Set();
  for (const track of rawTracks) {
    const id = Number(track?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || trackIds.has(id) ||
        typeof track?.filePath !== 'string' || !track.filePath.trim()) {
      throw new Error('The backup contains an invalid or duplicate track record.');
    }
    trackIds.add(id);
  }
  const restoredData = normalizeDatabase(backup.database);
  if (restoredData.tracks.length !== rawTracks.length) {
    throw new Error('The backup contains track records that cannot be restored safely.');
  }

  const createdCoverPaths = [];
  const oldCoverPaths = dbData.tracks
    .map(track => track.coverPath)
    .filter(coverPath => typeof coverPath === 'string' && path.dirname(path.resolve(coverPath)) === path.resolve(coversDir));
  const timestamp = Date.now();
  let totalCoverBytes = 0;
  try {
    for (const track of restoredData.tracks) {
      track.coverPath = null;
      track.coverFilename = null;
      track.hasCover = false;
      const encoded = backup.coverAssets && backup.coverAssets[String(track.id)];
      if (encoded === undefined) continue;
      if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_BACKUP_COVER_BYTES * 4 / 3) + 4) {
        throw new Error(`Artwork for track ${track.id} is invalid or too large.`);
      }
      const cover = Buffer.from(encoded, 'base64');
      if (!cover.length || cover.toString('base64') !== encoded ||
          cover.length > MAX_BACKUP_COVER_BYTES ||
          !(cover.subarray(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF])) ||
            cover.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) ||
            cover.subarray(0, 4).toString('ascii') === 'RIFF' && cover.subarray(8, 12).toString('ascii') === 'WEBP')) {
        throw new Error(`Artwork for track ${track.id} is not a supported image.`);
      }
      totalCoverBytes += cover.length;
      if (totalCoverBytes > MAX_BACKUP_TOTAL_BYTES) throw new Error('Artwork exceeds the backup size limit.');
      const imageExtension = cover.subarray(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]))
        ? 'jpg'
        : cover.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
          ? 'png'
          : 'webp';
      const filename = `cover_${track.id}_restore_${timestamp}.${imageExtension}`;
      const coverPath = path.join(coversDir, filename);
      fs.writeFileSync(coverPath, cover, { flag: 'wx' });
      createdCoverPaths.push(coverPath);
      track.coverFilename = filename;
      track.coverPath = coverPath;
      track.hasCover = true;
    }

    const serialized = JSON.stringify(restoredData, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BACKUP_TOTAL_BYTES) {
      throw new Error('Restored library exceeds the 256 MiB size limit.');
    }
    const tempPath = `${dbPath}.restore-${timestamp}.tmp`;
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    try {
      fs.renameSync(tempPath, dbPath);
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw error;
    }
    dbData = restoredData;
    clearTimeout(saveDebounceTimer);
    for (const coverPath of oldCoverPaths) {
      if (!createdCoverPaths.includes(coverPath)) {
        try { fs.unlinkSync(coverPath); } catch (error) {
          console.warn('[database] Could not remove replaced artwork:', error.message);
        }
      }
    }
    return {
      tracks: restoredData.tracks.length,
      playlists: restoredData.playlists.length
    };
  } catch (error) {
    for (const coverPath of createdCoverPaths) {
      try { fs.unlinkSync(coverPath); } catch {}
    }
    throw error;
  }
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

      const existing = dbData.tracks.find(t => track.cueSheetPath
        ? t.cueSheetPath === track.cueSheetPath && t.cueTrackNumber === Number(track.cueTrackNumber)
        : t.filePath === track.filePath && !t.cueSheetPath);
      if (existing) {
        if (track.cueSheetPath) {
          existing.filePath = track.filePath;
          existing.title = String(track.title || existing.title);
          existing.artist = String(track.artist || existing.artist || '');
          existing.album = String(track.album || existing.album || '');
          existing.duration = Number(track.duration) > 0 ? Number(track.duration) : existing.duration;
          existing.trackNumber = Number(track.trackNumber) > 0 ? Number(track.trackNumber) : existing.trackNumber;
          existing.cueStartTime = track.cueStartTime !== null && track.cueStartTime !== undefined &&
            Number.isFinite(Number(track.cueStartTime)) && Number(track.cueStartTime) >= 0
            ? Number(track.cueStartTime) : existing.cueStartTime;
          existing.cueEndTime = track.cueEndTime !== null && track.cueEndTime !== undefined &&
            Number.isFinite(Number(track.cueEndTime)) && Number(track.cueEndTime) > 0
            ? Number(track.cueEndTime) : existing.cueEndTime;
          existing.updatedAt = Date.now();
          if (autoSave) saveDatabase();
        }
        return cloneTrack(existing);
      }

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
        fileSize: track.fileSize !== null && track.fileSize !== undefined && track.fileSize !== '' &&
          Number.isSafeInteger(Number(track.fileSize)) && Number(track.fileSize) >= 0
          ? Number(track.fileSize) : null,
        fileMtimeMs: track.fileMtimeMs !== null && track.fileMtimeMs !== undefined && track.fileMtimeMs !== '' &&
          Number.isFinite(Number(track.fileMtimeMs)) && Number(track.fileMtimeMs) > 0
          ? Number(track.fileMtimeMs) : null,
        duration: Number(track.duration) || 0,
        bpm: ['metadata', 'waveform'].includes(track.bpmSource) &&
          track.bpm !== null && track.bpm !== undefined && Number.isFinite(Number(track.bpm))
          ? Number(track.bpm)
          : null,
        bpmConfidence: ['metadata', 'waveform'].includes(track.bpmSource) &&
          track.bpmConfidence !== null && track.bpmConfidence !== undefined &&
          Number.isFinite(Number(track.bpmConfidence))
          ? Math.min(1, Math.max(0, Number(track.bpmConfidence)))
          : null,
        bpmSource: ['metadata', 'waveform'].includes(track.bpmSource) ? track.bpmSource : 'unavailable',
        musicalKey: track.keySource === 'waveform-chroma-v1' &&
          typeof track.musicalKey === 'string' && MUSICAL_KEY_PATTERN.test(track.musicalKey)
          ? track.musicalKey : null,
        keyConfidence: track.keySource === 'waveform-chroma-v1' &&
          Number.isFinite(Number(track.keyConfidence))
          ? Math.min(1, Math.max(0, Number(track.keyConfidence)))
          : 0,
        keySource: track.keySource === 'waveform-chroma-v1' ? 'waveform-chroma-v1' : 'unavailable',
        energy: track.energySource === 'waveform-rms' &&
          (track.rmsLevel ?? track.energy) !== null && (track.rmsLevel ?? track.energy) !== undefined &&
          Number.isFinite(Number(track.rmsLevel ?? track.energy))
          ? Number(track.rmsLevel ?? track.energy)
          : null,
        rmsLevel: track.energySource === 'waveform-rms' &&
          (track.rmsLevel ?? track.energy) !== null && (track.rmsLevel ?? track.energy) !== undefined &&
          Number.isFinite(Number(track.rmsLevel ?? track.energy))
          ? Number(track.rmsLevel ?? track.energy)
          : null,
        loudness: track.energySource === 'waveform-rms' &&
          track.loudness !== null && track.loudness !== undefined && Number.isFinite(Number(track.loudness))
          ? Number(track.loudness)
          : null,
        energySource: track.energySource === 'waveform-rms' ? 'waveform-rms' : 'unavailable',
        genre: track.genreSource === 'metadata' ? String(track.genre || '') : '',
        genreSource: track.genreSource === 'metadata'
          ? 'metadata'
          : track.genreSource === 'unavailable' ? 'unavailable' : '',
        genreConfidence: track.genreSource === 'metadata' &&
          Number.isFinite(Number(track.genreConfidence))
          ? Math.min(1, Math.max(0, Number(track.genreConfidence)))
          : 0,
        album: String(track.album || ''),
        year: Number(track.year) || null,
        trackNumber: Number(track.trackNumber) || null,
        cueSheetPath: typeof track.cueSheetPath === 'string' ? track.cueSheetPath : null,
        cueTrackNumber: Number(track.cueTrackNumber) > 0 ? Number(track.cueTrackNumber) : null,
        cueStartTime: track.cueStartTime !== null && track.cueStartTime !== undefined &&
          track.cueStartTime !== '' && Number.isFinite(Number(track.cueStartTime)) && Number(track.cueStartTime) >= 0
          ? Number(track.cueStartTime) : null,
        cueEndTime: track.cueEndTime !== null && track.cueEndTime !== undefined &&
          track.cueEndTime !== '' && Number.isFinite(Number(track.cueEndTime)) && Number(track.cueEndTime) > 0
          ? Number(track.cueEndTime) : null,
        replayGainTrackDb: normalizeReplayGainDb(track.replayGainTrackDb),
        replayGainTrackPeak: normalizeReplayGainPeak(track.replayGainTrackPeak),
        replayGainAlbumDb: normalizeReplayGainDb(track.replayGainAlbumDb),
        replayGainAlbumPeak: normalizeReplayGainPeak(track.replayGainAlbumPeak),
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
        analysisVersion: track.analysisVersion === 'waveform-v2' ? 'waveform-v2' : null,
        featureVector: track.analysisVersion === 'waveform-v2' && Array.isArray(track.featureVector)
          ? [...track.featureVector]
          : null,
        rawFeatures: track.analysisVersion === 'waveform-v2' && track.rawFeatures && typeof track.rawFeatures === 'object'
          ? { ...track.rawFeatures }
          : null,
        voiceFingerprint: track.voiceFingerprint && typeof track.voiceFingerprint === 'object'
          ? { ...track.voiceFingerprint, spectralEnvelope: Array.isArray(track.voiceFingerprint.spectralEnvelope) ? [...track.voiceFingerprint.spectralEnvelope] : [] }
          : null
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

    getPlaylists: () => dbData.playlists.map(playlist => ({
      ...playlist,
      tracks: playlist.smartCriteria
        ? resolveSmartPlaylistTracks(dbData.tracks, playlist.smartCriteria).map(track => track.id)
        : [...playlist.tracks]
    })),

    createPlaylist: (name, metadata = {}) => {
      const newPlaylist = {
        id: dbData.nextIds.playlist++,
        name: String(name || 'New Playlist').trim().slice(0, 200) || 'New Playlist',
        tracks: [],
        createdAt: Date.now(),
        cueSheetPath: typeof metadata?.cueSheetPath === 'string' ? metadata.cueSheetPath : null,
        smartCriteria: null
      };
      dbData.playlists.push(newPlaylist);
      saveDatabase();
      return { ...newPlaylist, tracks: [] };
    },

    createSmartPlaylist: (name, criteria) => {
      const smartCriteria = normalizeSmartCriteria(criteria);
      const playlistName = String(name || '').trim().slice(0, 200);
      if (!playlistName) throw new Error('Playlist name cannot be empty.');
      const newPlaylist = {
        id: dbData.nextIds.playlist++,
        name: playlistName,
        tracks: [],
        createdAt: Date.now(),
        cueSheetPath: null,
        smartCriteria
      };
      dbData.playlists.push(newPlaylist);
      saveDatabase();
      return {
        ...newPlaylist,
        tracks: resolveSmartPlaylistTracks(dbData.tracks, smartCriteria).map(track => track.id)
      };
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
      if (!playlist || playlist.smartCriteria || !dbData.tracks.some(track => track.id === numericTrackId)) return false;
      if (!playlist.tracks.includes(numericTrackId)) playlist.tracks.push(numericTrackId);
      saveDatabase();
      return true;
    },

    removeTrackFromPlaylist: (playlistId, trackId) => {
      const playlist = dbData.playlists.find(item => item.id === Number(playlistId));
      if (!playlist || playlist.smartCriteria) return false;
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

    createBackup: () => createDatabaseBackup(),

    restoreBackup: (backup) => restoreDatabaseBackup(backup),

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

function flushDatabase() {
  // Persist any debounced write before the process exits.
  if (!dbPath || !dbData) return;
  clearTimeout(saveDebounceTimer);
  saveDatabaseSync();
}

module.exports = { initDatabase, getDb, flushDatabase };
