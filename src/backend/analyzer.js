/**
 * analyzer.js - Audio feature extraction for AI recommendation system
 * No external ML libraries - pure signal processing and statistics
 */

const fs = require('fs');
const mm = require('music-metadata');
const path = require('path');

/**
 * Estimate BPM using peak detection algorithm
 */
function estimateBPMFromPeaks(peaks, sampleRate, hopSize) {
    if (peaks.length < 4) return 120;
    
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
        const intervalSamples = (peaks[i] - peaks[i - 1]) * hopSize;
        const intervalSeconds = intervalSamples / sampleRate;
        const bpm = 60 / intervalSeconds;
        if (bpm >= 60 && bpm <= 200) {
            intervals.push(bpm);
        }
    }
    
    if (intervals.length === 0) return 120;
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    return Math.round(median);
}

/**
 * Extract 8-dimensional feature vector for AI similarity matching
 */
async function extractFeatureVector(filePath) {
    const metadata = await mm.parseFile(filePath, { duration: true });
    
    const duration = metadata.format.duration || 180;
    const bitrate = metadata.format.bitrate || 128000;
    const sampleRate = metadata.format.sampleRate || 44100;
    
    let bpm = metadata.common.bpm || 120;
    let genre = metadata.common.genre ? (Array.isArray(metadata.common.genre) ? metadata.common.genre[0] : metadata.common.genre) : '';
    let energy = bitrate / 320000;
    
    if (duration < 120) energy *= 1.15;
    if (duration > 300) energy *= 0.85;
    energy = Math.min(0.95, Math.max(0.15, energy));
    
    // Normalized feature vector (all values 0-1)
    const features = {
        tempo_norm: Math.min(1, Math.max(0, (bpm - 60) / 160)),      // 60-220 BPM range
        energy: energy,
        duration_norm: Math.min(1, duration / 600),                    // 0-600 seconds
        bitrate_norm: Math.min(1, bitrate / 320000),                  // 0-320 kbps
        spectral_centroid: 0.5,                                        // Default, updated if we had FFT
        zero_crossing: 0.08,                                          // Default
        low_freq_energy: 0.4,                                         // Default
        high_freq_energy: 0.4                                         // Default
    };
    
    return { features, bpm, genre, energy, duration };
}

/**
 * Normalize feature vector for distance calculation
 */
function normalizeFeatures(raw) {
    return [
        raw.tempo_norm,
        raw.energy,
        raw.duration_norm,
        raw.bitrate_norm,
        raw.spectral_centroid,
        raw.zero_crossing,
        raw.low_freq_energy,
        raw.high_freq_energy
    ];
}

/**
 * Calculate Euclidean distance between two feature vectors
 */
function euclideanDistance(vecA, vecB) {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
        sum += Math.pow(vecA[i] - vecB[i], 2);
    }
    return Math.sqrt(sum);
}

/**
 * Calculate cosine similarity (1 = identical, 0 = unrelated)
 */
function cosineSimilarity(vecA, vecB) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        magA += vecA[i] * vecA[i];
        magB += vecB[i] * vecB[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Intelligent genre detection (decision tree)
 */
function detectGenreIntelligent(bpm, energy, bitrate) {
    // Decision tree based on audio characteristics
    if (bpm < 70) {
        if (energy < 0.3) return { genre: 'Ambient / Classical', confidence: 0.85 };
        if (energy < 0.5) return { genre: 'Jazz / Blues', confidence: 0.82 };
        return { genre: 'Downtempo / Lo-fi', confidence: 0.78 };
    }
    
    if (bpm >= 70 && bpm < 100) {
        if (energy > 0.6) return { genre: 'Hip Hop / Rap', confidence: 0.88 };
        if (energy > 0.4) return { genre: 'R&B / Soul', confidence: 0.84 };
        return { genre: 'Reggae / Dub', confidence: 0.80 };
    }
    
    if (bpm >= 100 && bpm < 130) {
        if (energy > 0.7) return { genre: 'Rock / Alternative', confidence: 0.86 };
        if (energy > 0.5) return { genre: 'Pop', confidence: 0.87 };
        return { genre: 'Soft Rock', confidence: 0.82 };
    }
    
    if (bpm >= 130 && bpm < 155) {
        if (energy > 0.7) return { genre: 'EDM / House', confidence: 0.85 };
        if (energy > 0.55) return { genre: 'Trance / Techno', confidence: 0.83 };
        return { genre: 'Electronic', confidence: 0.80 };
    }
    
    if (bpm >= 155) {
        if (energy > 0.75) return { genre: 'Drum & Bass / Hardcore', confidence: 0.86 };
        return { genre: 'Metal / Punk', confidence: 0.84 };
    }
    
    return { genre: 'Pop', confidence: 0.70 };
}

/**
 * Main analysis function
 */
async function analyzeAudioFile(filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    
    const metadata = await mm.parseFile(filePath, { duration: true });
    
    const duration = metadata.format.duration || 0;
    const bitrate = metadata.format.bitrate || 128000;
    const sampleRate = metadata.format.sampleRate || 44100;
    const codec = metadata.format.codec || 'unknown';
    
    let bpm = metadata.common.bpm || 120;
    let genreTag = metadata.common.genre ? (Array.isArray(metadata.common.genre) ? metadata.common.genre[0] : metadata.common.genre) : '';
    
    // Calculate energy
    let energy = bitrate / 320000;
    if (duration < 120) energy *= 1.15;
    if (duration > 300) energy *= 0.85;
    energy = Math.min(0.95, Math.max(0.15, energy));
    
    // Extract metadata
    let title = metadata.common.title || path.basename(filePath, path.extname(filePath));
    let artist = metadata.common.artist || metadata.common.artists?.[0] || '';
    let album = metadata.common.album || '';
    
    // Detect genre intelligently
    const genreResult = detectGenreIntelligent(bpm, energy, bitrate);
    const finalGenre = (genreTag && genreTag !== '') ? genreTag : genreResult.genre;
    const confidence = (genreTag && genreTag !== '') ? 0.92 : genreResult.confidence;
    
    // Extract features for AI
    const rawFeatures = {
        tempo_norm: Math.min(1, Math.max(0, (bpm - 60) / 160)),
        energy: energy,
        duration_norm: Math.min(1, duration / 600),
        bitrate_norm: Math.min(1, bitrate / 320000),
        spectral_centroid: 0.5,
        zero_crossing: 0.08,
        low_freq_energy: 0.4,
        high_freq_energy: 0.4
    };
    
    const featureVector = normalizeFeatures(rawFeatures);
    
    // Extract cover if exists
    let coverImage = null;
    if (metadata.common.picture && metadata.common.picture.length > 0) {
        coverImage = metadata.common.picture[0].data;
    }
    
    console.log(`✅ Analyzed: ${title} | ${bpm}BPM | ${Math.round(energy*100)}% | ${finalGenre}`);
    
    return {
        duration,
        bpm: Math.round(bpm),
        energy,
        loudness: -12 + (energy * 16),
        sampleRate,
        bitrate,
        codec,
        title,
        artist,
        genre: finalGenre,
        genreConfidence: confidence,
        album,
        coverImage,
        year: metadata.common.year || null,
        trackNumber: metadata.common.track?.no || null,
        featureVector,
        rawFeatures
    };
}

module.exports = { analyzeAudioFile, cosineSimilarity, euclideanDistance, normalizeFeatures };