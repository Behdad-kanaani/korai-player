const fs = require('fs');
const mm = require('music-metadata');
const path = require('path');
const { extractReplayGain } = require('../frontend/audioNormalization');
const { analyzeBPM } = require('./bpmDetector');
const { analyzeVoiceFile } = require('./voiceAnalyzer');
const { detectMusicalKey } = require('./keyDetector');

const FEATURE_FRAME_SIZE = 1024;
const FEATURE_HOP_SIZE = 512;
const FEATURE_SAMPLE_RATE = 11025;
const FEATURE_ANALYSIS_SECONDS = 30;
const FEATURE_FREQUENCIES = Array.from({ length: 68 }, (_, index) => 40 + index * 80);
const FEATURE_COEFFICIENTS = Float64Array.from(FEATURE_FREQUENCIES, frequency =>
    2 * Math.cos((2 * Math.PI * frequency) / FEATURE_SAMPLE_RATE)
);
const FEATURE_WINDOW = Float64Array.from({ length: FEATURE_FRAME_SIZE }, (_, index) =>
    0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FEATURE_FRAME_SIZE - 1))
);

function getGoertzelPower(frame, coefficient) {
    let previous = 0;
    let previous2 = 0;
    for (let index = 0; index < frame.length; index++) {
        const current = frame[index] * FEATURE_WINDOW[index] + coefficient * previous - previous2;
        previous2 = previous;
        previous = current;
    }
    return Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2);
}

function measureAudioSignal(samples, sampleRate) {
    if (!samples || samples.length < FEATURE_FRAME_SIZE || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

    const frequencies = FEATURE_FREQUENCIES.filter(frequency => frequency < sampleRate / 2);
    if (frequencies.length === 0) return null;
    const coefficients = sampleRate === FEATURE_SAMPLE_RATE
        ? FEATURE_COEFFICIENTS
        : Float64Array.from(frequencies, frequency => 2 * Math.cos((2 * Math.PI * frequency) / sampleRate));
    const frames = [];
    let squareSum = 0;
    let crossingCount = 0;
    let frameRmsSum = 0;
    let frameRmsSquareSum = 0;
    let frameCount = 0;

    for (let index = 0; index < samples.length; index++) {
        const value = samples[index];
        squareSum += value * value;
        if (index > 0 && ((value >= 0) !== (samples[index - 1] >= 0))) crossingCount++;
    }

    for (let start = 0; start + FEATURE_FRAME_SIZE <= samples.length; start += FEATURE_HOP_SIZE) {
        const frame = samples.subarray(start, start + FEATURE_FRAME_SIZE);
        let frameSquareSum = 0;
        for (let index = 0; index < frame.length; index++) {
            const value = frame[index];
            frameSquareSum += value * value;
        }
        const frameRms = Math.sqrt(frameSquareSum / frame.length);
        frameRmsSum += frameRms;
        frameRmsSquareSum += frameRms * frameRms;
        frameCount++;

        const spectrum = Array.from(coefficients, coefficient => getGoertzelPower(frame, coefficient));
        const spectralEnergy = spectrum.reduce((sum, value) => sum + value, 0);
        frames.push(spectralEnergy > 0
            ? spectrum.map(value => value / spectralEnergy)
            : spectrum);
    }

    const rms = Math.sqrt(squareSum / samples.length);
    const meanFrameRms = frameRmsSum / Math.max(1, frameCount);
    const frameRmsVariance = Math.max(0, frameRmsSquareSum / Math.max(1, frameCount) - meanFrameRms ** 2);
    const loudnessDbfs = rms > 0 ? 20 * Math.log10(rms) : -96;
    const meanSpectrum = new Float64Array(frequencies.length);
    for (const frame of frames) {
        for (let bin = 0; bin < frame.length; bin++) meanSpectrum[bin] += frame[bin] / Math.max(1, frames.length);
    }
    const spectralTotal = meanSpectrum.reduce((sum, value) => sum + value, 0);
    const centroidHz = spectralTotal > 0
        ? meanSpectrum.reduce((sum, value, index) => sum + value * frequencies[index], 0) / spectralTotal
        : 0;
    const spreadHz = spectralTotal > 0
        ? Math.sqrt(meanSpectrum.reduce((sum, value, index) =>
            sum + value * ((frequencies[index] - centroidHz) ** 2), 0) / spectralTotal)
        : 0;
    const bandShare = (minHz, maxHz) => {
        if (!spectralTotal) return 0;
        return frequencies.reduce((sum, frequency, index) =>
            sum + (frequency >= minHz && frequency < maxHz ? meanSpectrum[index] : 0), 0) / spectralTotal;
    };

    let spectralFlux = 0;
    for (let index = 1; index < frames.length; index++) {
        for (let bin = 0; bin < frames[index].length; bin++) {
            spectralFlux += Math.max(0, frames[index][bin] - frames[index - 1][bin]);
        }
    }
    spectralFlux /= Math.max(1, frames.length - 1);

    return {
        rmsLevel: rms,
        loudnessDbfs,
        zeroCrossing: crossingCount / Math.max(1, samples.length - 1),
        spectralCentroid: centroidHz / (sampleRate / 2),
        spectralSpread: spreadHz / (sampleRate / 2),
        lowFreqEnergy: bandShare(0, 250),
        lowMidEnergy: bandShare(250, 500),
        midFreqEnergy: bandShare(500, 1700),
        highMidEnergy: bandShare(1700, 3100),
        highFreqEnergy: bandShare(3100, sampleRate / 2 + 1),
        brightness: bandShare(2300, sampleRate / 2 + 1),
        warmth: bandShare(0, 500),
        spectralFlux,
        energyVariance: Math.min(1, Math.sqrt(frameRmsVariance) / Math.max(meanFrameRms, 1e-6))
    };
}

async function extractFeatureVector(filePath) {
    const analysis = await analyzeAudioFile(filePath);
    return {
        features: analysis.rawFeatures,
        bpm: analysis.bpm,
        genre: analysis.genre,
        energy: analysis.energy,
        analysisVersion: analysis.analysisVersion,
        duration: analysis.duration,
        featureVector: analysis.featureVector,
        ...calculateAdvancedAudioProfile(analysis.bpm, analysis.energy, analysis.duration, analysis.genre, analysis.rawFeatures)
    };
}

function calculateAdvancedAudioProfile(bpm, energy, duration, genre, features = {}) {
    return {
        measuredFeatures: {
            rmsLevel: Number.isFinite(energy) ? energy : null,
            loudnessDbfs: Number.isFinite(features.loudnessDbfs) ? features.loudnessDbfs : null,
            spectralCentroid: Number.isFinite(features.spectral_centroid) ? features.spectral_centroid : null,
            spectralSpread: Number.isFinite(features.spectral_spread) ? features.spectral_spread : null,
            zeroCrossingRate: Number.isFinite(features.zero_crossing) ? features.zero_crossing : null,
            spectralFlux: Number.isFinite(features.spectral_flux) ? features.spectral_flux : null,
            bpm: Number.isFinite(bpm) ? bpm : null,
            duration: Number.isFinite(duration) ? duration : null
        }
    };
}

/* Normalize track features for similarity comparisons. */
function normalizeFeatures(raw) {
    return [
        raw.tempo_norm,
        raw.rms_level,
        raw.duration_norm,
        raw.spectral_centroid,
        raw.zero_crossing,
        raw.low_freq_energy,
        raw.low_mid_energy,
        raw.mid_freq_energy,
        raw.high_mid_energy,
        raw.high_freq_energy,
        raw.brightness,
        raw.warmth,
        raw.spectral_flux,
        raw.energy_variance
    ].map(value => Number.isFinite(value) ? value : null);
}

/**
 * Calculate euclidean distance between two vectors
 */
function euclideanDistance(vecA, vecB) {
    let sum = 0;
    let dimensions = 0;
    for (let i = 0; i < Math.min(vecA.length, vecB.length); i++) {
        if (!Number.isFinite(vecA[i]) || !Number.isFinite(vecB[i])) continue;
        sum += Math.pow(vecA[i] - vecB[i], 2);
        dimensions++;
    }
    return dimensions > 0 ? Math.sqrt(sum * (Math.min(vecA.length, vecB.length) / dimensions)) : Number.POSITIVE_INFINITY;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
    
    let dot = 0, magA = 0, magB = 0;
    let dimensions = 0;
    const len = Math.min(vecA.length, vecB.length);
    
    for (let i = 0; i < len; i++) {
        if (!Number.isFinite(vecA[i]) || !Number.isFinite(vecB[i])) continue;
        const a = vecA[i];
        const b = vecB[i];
        dot += a * b;
        magA += a * a;
        magB += b * b;
        dimensions++;
    }
    
    if (magA === 0 || magB === 0 || dimensions < 2) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/* Estimate a genre and confidence from track features. */
async function analyzeAudioFile(filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const metadata = await mm.parseFile(filePath, { duration: true, native: true });
    const duration = metadata.format.duration || 0;
    const bitrate = metadata.format.bitrate || 0;
    const sampleRate = metadata.format.sampleRate || 0;
    const codec = metadata.format.codec || 'unknown';

    const bpmResult = await analyzeBPM(filePath);
    const bpm = bpmResult.bpm;
    const genreTag = metadata.common.genre
        ? (Array.isArray(metadata.common.genre) ? metadata.common.genre[0] : metadata.common.genre)
        : '';

    const title = metadata.common.title || path.basename(filePath, path.extname(filePath));
    const artist = metadata.common.artist || metadata.common.artists?.[0] || '';
    const album = metadata.common.album || '';

    let voiceFingerprint = null;
    try {
        voiceFingerprint = await analyzeVoiceFile(filePath, duration);
    } catch (error) {
        console.warn(`[audio-analysis] Voice fingerprint unavailable for ${path.basename(filePath)}: ${error.message}`);
    }

    let signalFeatures = null;
    let keyAnalysis = { key: null, confidence: 0, source: 'unavailable' };
    try {
        const { decodeAudioToMono } = require('./bpmDetector');
        const { samples, sampleRate: analysisSampleRate } = await decodeAudioToMono(
            filePath,
            FEATURE_SAMPLE_RATE,
            FEATURE_ANALYSIS_SECONDS,
            duration > FEATURE_ANALYSIS_SECONDS ? (duration - FEATURE_ANALYSIS_SECONDS) / 2 : 0
        );
        signalFeatures = measureAudioSignal(samples, analysisSampleRate);
        keyAnalysis = detectMusicalKey(samples, analysisSampleRate);
    } catch (error) {
        console.warn(`[audio-analysis] Signal features unavailable for ${path.basename(filePath)}: ${error.message}`);
    }

    const rmsLevel = signalFeatures?.rmsLevel ?? null;
    const rawFeatures = {
        tempo_norm: Number.isFinite(bpm) ? Math.min(1, Math.max(0, (bpm - 60) / 160)) : null,
        rms_level: rmsLevel,
        energy_variance: signalFeatures?.energyVariance ?? null,
        duration_norm: duration > 0 ? Math.min(1, duration / 600) : null,
        loudnessDbfs: signalFeatures?.loudnessDbfs ?? null,
        spectral_centroid: signalFeatures?.spectralCentroid ?? null,
        spectral_spread: signalFeatures?.spectralSpread ?? null,
        zero_crossing: signalFeatures?.zeroCrossing ?? null,
        low_freq_energy: signalFeatures?.lowFreqEnergy ?? null,
        low_mid_energy: signalFeatures?.lowMidEnergy ?? null,
        mid_freq_energy: signalFeatures?.midFreqEnergy ?? null,
        high_mid_energy: signalFeatures?.highMidEnergy ?? null,
        high_freq_energy: signalFeatures?.highFreqEnergy ?? null,
        brightness: signalFeatures?.brightness ?? null,
        warmth: signalFeatures?.warmth ?? null,
        spectral_flux: signalFeatures?.spectralFlux ?? null
    };
    const featureVector = normalizeFeatures(rawFeatures);
    const finalGenre = genreTag || null;
    const genreConfidence = genreTag ? 1 : 0;
    const audioProfile = calculateAdvancedAudioProfile(bpm, rmsLevel, duration, finalGenre, rawFeatures);

    let coverImage = null;
    if (metadata.common.picture && metadata.common.picture.length > 0) {
        coverImage = metadata.common.picture[0].data;
    }

    return {
        title,
        artist,
        album,
        genre: finalGenre,
        genreSource: genreTag ? 'metadata' : 'unavailable',
        genreConfidence,
        year: metadata.common.year || null,
        trackNumber: metadata.common.track?.no || null,
        ...extractReplayGain(metadata.common),
        duration,
        analysisVersion: 'waveform-v2',
        bpm: Number.isFinite(bpm) ? Math.round(bpm) : null,
        bpmConfidence: bpmResult.confidence,
        bpmSource: bpmResult.source,
        energy: rmsLevel,
        rmsLevel,
        energySource: signalFeatures ? 'waveform-rms' : 'unavailable',
        musicalKey: keyAnalysis.key,
        keyConfidence: keyAnalysis.confidence,
        keySource: keyAnalysis.source,
        loudness: rawFeatures.loudnessDbfs,
        sampleRate,
        bitrate,
        codec,
        voiceFingerprint,
        ...audioProfile,
        featureVector,
        rawFeatures,
        coverImage,
        alternativeGenres: []
    };
}

module.exports = { 
    analyzeAudioFile,
    extractFeatureVector,
    calculateAdvancedAudioProfile,
    cosineSimilarity,
    euclideanDistance,
    normalizeFeatures,
    measureAudioSignal
};