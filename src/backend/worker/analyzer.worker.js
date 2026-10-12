// analyzer.worker - audio analysis worker (BPM, energy, metadata)

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// Safe imports with fallbacks - using require instead of import
let mm = null;
let analyzeBPM = null;
let decodeAudioToMono = null;
let measureAudioSignal = null;
let analyzeVoiceFile = null;
let extractReplayGain = null;
let detectMusicalKey = null;

try {
  mm = require('music-metadata');
} catch (e) {
  console.error('[worker] music-metadata not available:', e.message);
}

try {
  ({ extractReplayGain } = require('../../frontend/audioNormalization'));
} catch (e) {
  console.error('[worker] ReplayGain metadata helper not available:', e.message);
}

try {
  const bpmModule = require('../bpmDetector');
  analyzeBPM = bpmModule.analyzeBPM;
  decodeAudioToMono = bpmModule.decodeAudioToMono;
} catch (e) {
  console.error('[worker] bpmDetector not available:', e.message);
}

try {
  ({ measureAudioSignal } = require('../analyzer'));
} catch (e) {
  console.error('[worker] Audio signal analyzer not available:', e.message);
}

try {
  ({ analyzeVoiceFile } = require('../voiceAnalyzer'));
} catch (e) {
  console.error('[worker] Voice fingerprint analyzer not available:', e.message);
}

try {
  ({ detectMusicalKey } = require('../keyDetector'));
} catch (e) {
  console.error('[worker] Musical key detector not available:', e.message);
}

/**
 * Analyze a single audio file with full error recovery
 * Returns default metadata on failure, never throws
 */
async function analyzeFile(filePath) {
  // Default results (safe fallback)
  const results = {
    duration: 0,
    bpm: null,
    bpmConfidence: 0,
    bpmSource: 'unavailable',
    musicalKey: null,
    keyConfidence: 0,
    keySource: 'unavailable',
    energy: null,
    energySource: 'unavailable',
    rmsLevel: null,
    analysisVersion: null,
    loudness: null,
    sampleRate: 0,
    bitrate: 0,
    codec: '',
    title: path.basename(filePath, path.extname(filePath)),
    artist: '',
    genre: null,
    genreSource: 'unavailable',
    genreConfidence: 0,
    year: null,
    trackNumber: null,
    replayGainTrackDb: null,
    replayGainTrackPeak: null,
    replayGainAlbumDb: null,
    replayGainAlbumPeak: null,
    album: '',
    coverImage: null,
    lyrics: null,
    composer: '',
    publisher: '',
    voiceFingerprint: null
  };

  try {
    if (!mm) {
      throw new Error('music-metadata module missing');
    }

    const metadata = await mm.parseFile(filePath, { duration: true, native: true });
    if (extractReplayGain) Object.assign(results, extractReplayGain(metadata.common));

    // Basic format info
    results.duration = metadata.format.duration || 0;
    results.sampleRate = metadata.format.sampleRate || 0;
    results.bitrate = metadata.format.bitrate || 0;
    results.codec = metadata.format.codec || 'unknown';
    if (analyzeVoiceFile) {
      try {
        results.voiceFingerprint = await analyzeVoiceFile(filePath, results.duration);
      } catch (voiceErr) {
        console.warn(`[worker] Voice fingerprint unavailable for ${filePath}:`, voiceErr.message);
      }
    }

    // Common tags
    if (metadata.common.title) results.title = metadata.common.title;
    if (metadata.common.artist) {
      results.artist = Array.isArray(metadata.common.artist)
        ? metadata.common.artist[0]
        : metadata.common.artist;
    } else if (metadata.common.artists && metadata.common.artists.length) {
      results.artist = metadata.common.artists[0];
    }
    if (metadata.common.album) results.album = metadata.common.album;
    if (metadata.common.year) results.year = metadata.common.year;
    if (metadata.common.track && metadata.common.track.no) {
      results.trackNumber = metadata.common.track.no;
    }
    if (metadata.common.lyrics) results.lyrics = metadata.common.lyrics;
    if (metadata.common.composer) {
      results.composer = Array.isArray(metadata.common.composer)
        ? metadata.common.composer[0]
        : metadata.common.composer;
    }
    if (metadata.common.publisher) results.publisher = metadata.common.publisher;

    if (analyzeBPM) {
      try {
        const bpmResult = await analyzeBPM(filePath);
        results.bpm = bpmResult.bpm;
        results.bpmConfidence = bpmResult.confidence;
        results.bpmSource = bpmResult.source;
      } catch (bpmErr) {
        console.warn(`[worker] Real BPM detection failed for ${filePath}:`, bpmErr.message);
      }
    }

    if (decodeAudioToMono && measureAudioSignal) {
      try {
        const { samples, sampleRate } = await decodeAudioToMono(filePath, 11025, 30);
        const signal = measureAudioSignal(samples, sampleRate);
        if (signal) {
          results.energy = signal.rmsLevel;
          results.rmsLevel = signal.rmsLevel;
          results.energySource = 'waveform-rms';
          results.analysisVersion = 'waveform-v2';
          results.loudness = signal.loudnessDbfs;
          results.audioFeatures = signal;
        }
        if (detectMusicalKey) {
          try {
            const key = detectMusicalKey(samples, sampleRate);
            results.musicalKey = key.key;
            results.keyConfidence = key.confidence;
            results.keySource = key.source;
          } catch (keyError) {
            console.warn(`[worker] Musical key detection unavailable for ${path.basename(filePath)}:`, keyError.message);
          }
        }
      } catch (signalErr) {
        console.warn(`[worker] Signal feature analysis unavailable for ${filePath}:`, signalErr.message);
      }
    }

    // Genre is reported only when a tag provides explicit evidence.
    let genreTag = null;
    if (metadata.common.genre) {
      genreTag = Array.isArray(metadata.common.genre)
        ? metadata.common.genre[0]
        : metadata.common.genre;
    }
    if (genreTag && genreTag !== '') {
      results.genre = genreTag;
      results.genreSource = 'metadata';
      results.genreConfidence = 1;
    }

    // Cover image (binary data)
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      results.coverImage = metadata.common.picture[0].data;
    }

    const bpmLabel = Number.isFinite(results.bpm) ? `${results.bpm}BPM` : 'BPM unavailable';
    const energyLabel = Number.isFinite(results.energy)
      ? `${Math.round(results.energy * 100)}% measured energy`
      : 'energy unavailable';
    console.debug(`[worker] Analyzed: ${results.title} | ${bpmLabel} | ${energyLabel}`);

  } catch (error) {
    console.error(`[worker] Fatal analysis error for ${filePath}:`, error.message);
    // Keep default results (already set)
  }

  return results;
}

/**
 * Process a batch of files and report progress
 */
async function analyzeBatch(filePaths) {
  const results = [];
  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    try {
      const analysis = await analyzeFile(filePath);
      results.push({ filePath, analysis });

      // Send progress update
      if (parentPort) {
        parentPort.postMessage({
          type: 'batchProgress',
          data: {
            percent: ((i + 1) / filePaths.length) * 100,
            current: i + 1,
            total: filePaths.length,
            result: analysis
          }
        });
      }
    } catch (err) {
      console.error(`[worker] Batch error on ${filePath}:`, err);
      if (parentPort) {
        parentPort.postMessage({
          type: 'batchError',
          data: { filePath, error: err.message }
        });
      }
      // Still push a minimal result to avoid breaking the batch
      results.push({
        filePath,
        analysis: {
          title: path.basename(filePath, path.extname(filePath)),
          duration: 0,
          bpm: null,
          bpmConfidence: 0,
          bpmSource: 'unavailable',
          energy: null,
          genre: null
        }
      });
    }
  }
  return results;
}

// ========== Worker Message Handling ==========
if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      const { type, data } = msg;

      if (type === 'analyze') {
        const { filePath, fileIndex, totalFiles } = data;
        const analysis = await analyzeFile(filePath);

        parentPort.postMessage({
          type: 'result',
          data: { filePath, fileIndex, analysis }
        });

        parentPort.postMessage({
          type: 'progress',
          data: {
            percent: ((fileIndex + 1) / totalFiles) * 100,
            current: fileIndex + 1,
            total: totalFiles,
            file: filePath
          }
        });
      }

      else if (type === 'analyzeBatch') {
        const { filePaths } = data;
        const results = await analyzeBatch(filePaths);

        parentPort.postMessage({
          type: 'batchComplete',
          data: results
        });
      }
    } catch (err) {
      console.error('[worker] Unhandled message error:', err);
      if (parentPort) {
        parentPort.postMessage({
          type: 'batchError',
          data: { error: err.message, stack: err.stack }
        });
      }
    }
  });

  console.debug('[worker] Analyzer Worker initialized and ready');
} else {
  console.warn('[worker] No parentPort – running outside worker_threads?');
}