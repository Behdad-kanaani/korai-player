/**
 * analyzer.worker.js - Audio Analysis Web Worker
 * 
 * Runs in separate thread to prevent UI blocking
 * Handles BPM detection, energy calculation, and metadata extraction
 */

const { detectRealBPM } = require('../bpmDetector');

// Track analysis progress
let currentProgress = 0;

// Cross-environment messaging helpers: support Node worker_threads (parentPort)
let isNodeWorker = false;
let parent = null;
try {
    const wt = require('worker_threads');
    if (wt && wt.parentPort) {
        isNodeWorker = true;
        parent = wt.parentPort;
    }
} catch (e) {
    // not running under worker_threads
}

function postMessage(msg) {
    if (isNodeWorker && parent) parent.postMessage(msg);
    else if (typeof self !== 'undefined' && self.postMessage) self.postMessage(msg);
}

function addMessageListener(fn) {
    if (isNodeWorker && parent) parent.on('message', fn);
    else if (typeof self !== 'undefined' && self.addEventListener) self.addEventListener('message', (e) => fn(e.data));
}

/**
 * Analyze a single audio file
 */
async function analyzeFile(filePath) {
    const fs = require('fs');
    const mm = require('music-metadata');
    const path = require('path');
    
    const results = {
        duration: 0,
        bpm: 120,
        energy: 0.5,
        rms: null,
        loudness: -12,
        sampleRate: 0,
        bitrate: 0,
        codec: '',
        title: '',
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
        const metadata = await mm.parseFile(filePath, { duration: true, native: true });
        
        results.duration = metadata.format.duration || 0;
        results.sampleRate = metadata.format.sampleRate || 0;
        results.bitrate = metadata.format.bitrate || 0;
        results.codec = metadata.format.codec || 'unknown';
        
        // Extract title
        if (metadata.common.title) {
            results.title = metadata.common.title;
        }
        
        // Extract artist
        if (metadata.common.artist) {
            results.artist = Array.isArray(metadata.common.artist) 
                ? metadata.common.artist[0] 
                : metadata.common.artist;
        } else if (metadata.common.artists && metadata.common.artists.length > 0) {
            results.artist = metadata.common.artists[0];
        }
        
        // Extract genre
        let genreTag = null;
        if (metadata.common.genre) {
            genreTag = Array.isArray(metadata.common.genre) 
                ? metadata.common.genre[0] 
                : metadata.common.genre;
        }
        
        // Real BPM detection using waveform
        try {
            results.bpm = await detectRealBPM(filePath);
        } catch (bpmErr) {
            console.warn('Real BPM detection failed, using metadata fallback:', bpmErr.message);
            if (metadata.common.bpm) {
                results.bpm = metadata.common.bpm;
            }
        }
        
        // Calculate energy from bitrate and duration
        if (results.bitrate && results.bitrate > 0) {
            results.energy = Math.min(0.95, Math.max(0.15, results.bitrate / 320000));
            if (results.duration && results.duration < 120) results.energy *= 1.15;
            if (results.duration && results.duration > 300) results.energy *= 0.85;
        }
        
        // Estimate loudness
        results.loudness = -23 + (results.energy * 16);
        
        // Extract additional metadata
        if (metadata.common.year) results.year = metadata.common.year;
        if (metadata.common.track && metadata.common.track.no) results.trackNumber = metadata.common.track.no;
        if (metadata.common.album) results.album = metadata.common.album;
        if (metadata.common.composer) {
            results.composer = Array.isArray(metadata.common.composer) 
                ? metadata.common.composer[0] 
                : metadata.common.composer;
        }
        if (metadata.common.publisher) results.publisher = metadata.common.publisher;
        if (metadata.common.lyrics) results.lyrics = metadata.common.lyrics;
        
        // Extract cover art
        if (metadata.common.picture && metadata.common.picture.length > 0) {
            results.coverImage = metadata.common.picture[0].data;
        }
        
        // Fallback title from filename
        if (!results.title || results.title === '') {
            results.title = path.basename(filePath, path.extname(filePath));
        }
        
        // Genre detection based on BPM and energy
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
        
        console.debug(`📊 Worker analyzed: ${results.title} | ${results.bpm}BPM | ${Math.round(results.energy*100)}% energy`);
        
    } catch (error) {
        console.error('❌ Worker analysis error:', error.message);
    }
    
    return results;
}

// Listen for messages from main thread (compatible with node worker_threads or browser worker)
addMessageListener(async (event) => {
    const payload = event && event.data ? event.data : event;
    const { type, data } = payload;

    if (type === 'analyze') {
        const { filePath, fileIndex, totalFiles } = data;

        try {
            const result = await analyzeFile(filePath);

            postMessage({
                type: 'result',
                data: {
                    filePath,
                    fileIndex,
                    analysis: result
                }
            });

            // Update progress
            currentProgress = ((fileIndex + 1) / totalFiles) * 100;
            postMessage({
                type: 'progress',
                data: {
                    percent: currentProgress,
                    current: fileIndex + 1,
                    total: totalFiles,
                    file: filePath
                }
            });

        } catch (error) {
            postMessage({
                type: 'error',
                data: {
                    filePath,
                    error: error.message
                }
            });
        }
    }

    if (type === 'analyzeBatch') {
        const { filePaths } = data;
        const results = [];

        for (let i = 0; i < filePaths.length; i++) {
            try {
                const result = await analyzeFile(filePaths[i]);
                results.push({ filePath: filePaths[i], analysis: result });

                postMessage({
                    type: 'batchProgress',
                    data: {
                        percent: ((i + 1) / filePaths.length) * 100,
                        current: i + 1,
                        total: filePaths.length,
                        result: result
                    }
                });
            } catch (err) {
                postMessage({
                    type: 'batchError',
                    data: {
                        filePath: filePaths[i],
                        error: err.message
                    }
                });
            }
        }

        postMessage({
            type: 'batchComplete',
            data: results
        });
    }
});

console.debug('🔧 Analyzer Worker initialized');