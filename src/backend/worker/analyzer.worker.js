/**
 * analyzer.worker.js - Audio Analysis Web Worker
 * 
 * Runs in separate thread to prevent UI blocking
 * Handles BPM detection, energy calculation, and metadata extraction
 *
 * IMPROVED: Robust error handling, module fallbacks, safe defaults
 */

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// Safe imports with fallbacks
let mm = null;
let detectRealBPM = null;

try {
  mm = require('music-metadata');
} catch (e) {
  console.error('[worker] music-metadata not available:', e.message);
}

try {
  const bpmModule = require('../bpmDetector');
  detectRealBPM = bpmModule.detectRealBPM;
} catch (e) {
  console.error('[worker] bpmDetector not available:', e.message);
}

// Track analysis progress
let currentProgress = 0;

/**
 * Analyze a single audio file with full error recovery
 * Returns default metadata on failure, never throws
 */
async function analyzeFile(filePath) {
  // Default results (safe fallback)
  const results = {
    duration: 0,
    bpm: 120,
    energy: 0.5,
    loudness: -12,
    sampleRate: 0,
    bitrate: 0,
    codec: '',
    title: path.basename(filePath, path.extname(filePath)),
    artist: '',
    genre: 'Pop',
    genreConfidence: 0.6,
    year: null,
    trackNumber: null,
    album: '',
    coverImage: null,
    lyrics: null,
    composer: '',
    publisher: ''
  };

  try {
    if (!mm) {
      throw new Error('music-metadata module missing');
    }

    const metadata = await mm.parseFile(filePath, { duration: true, native: true });

    // Basic format info
    results.duration = metadata.format.duration || 0;
    results.sampleRate = metadata.format.sampleRate || 0;
    results.bitrate = metadata.format.bitrate || 0;
    results.codec = metadata.format.codec || 'unknown';

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

    // BPM detection (real or metadata fallback)
    let bpmDetected = false;
    if (detectRealBPM) {
      try {
        const realBpm = await detectRealBPM(filePath);
        if (realBpm && realBpm > 0) {
          results.bpm = realBpm;
          bpmDetected = true;
        }
      } catch (bpmErr) {
        console.warn(`[worker] Real BPM detection failed for ${filePath}:`, bpmErr.message);
      }
    }
    if (!bpmDetected && metadata.common.bpm) {
      results.bpm = metadata.common.bpm;
    }

    // Energy estimation (based on bitrate and duration)
    if (results.bitrate > 0) {
      results.energy = Math.min(0.95, Math.max(0.15, results.bitrate / 320000));
      if (results.duration && results.duration < 120) results.energy *= 1.15;
      if (results.duration && results.duration > 300) results.energy *= 0.85;
      results.energy = Math.min(0.95, Math.max(0.15, results.energy));
    }
    results.loudness = -23 + (results.energy * 16);

    // Genre detection (tag or BPM-based)
    let genreTag = null;
    if (metadata.common.genre) {
      genreTag = Array.isArray(metadata.common.genre)
        ? metadata.common.genre[0]
        : metadata.common.genre;
    }
    if (genreTag && genreTag !== '') {
      results.genre = genreTag;
      results.genreConfidence = 0.9;
    } else if (results.bpm) {
      if (results.bpm < 70) results.genre = 'Ambient / Classical';
      else if (results.bpm < 95) results.genre = 'Jazz / Blues';
      else if (results.bpm < 110) results.genre = 'Hip Hop / R&B';
      else if (results.bpm < 130) results.genre = 'Pop / Rock';
      else if (results.bpm < 160) results.genre = 'Electronic / Dance';
      else results.genre = 'Drum & Bass / Metal';
      results.genreConfidence = 0.7;
    }

    // Cover image (binary data)
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      results.coverImage = metadata.common.picture[0].data;
    }

    console.debug(`[worker] Analyzed: ${results.title} | ${results.bpm}BPM | ${Math.round(results.energy * 100)}% energy`);

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
          bpm: 120,
          energy: 0.5,
          genre: 'Unknown'
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

        currentProgress = ((fileIndex + 1) / totalFiles) * 100;
        parentPort.postMessage({
          type: 'progress',
          data: {
            percent: currentProgress,
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