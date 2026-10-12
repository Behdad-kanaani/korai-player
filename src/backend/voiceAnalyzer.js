'use strict';

const { decodeAudioToMono } = require('./bpmDetector');

const SAMPLE_RATE = 11025;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const MIN_PITCH = 75;
const MAX_PITCH = 360;
const FORMANT_FREQUENCIES = [
    [220, 300], [400, 500], [600, 730], [850, 1000],
    [1200, 1400], [1650, 1850], [2200, 2450], [2950, 3300]
];

function getFramePitch(frame, sampleRate) {
    let mean = 0;
    for (const sample of frame) mean += sample;
    mean /= frame.length;

    let frameEnergy = 0;
    for (const sample of frame) {
        const centered = sample - mean;
        frameEnergy += centered * centered;
    }
    if (frameEnergy / frame.length < 1e-5) return null;

    const minLag = Math.floor(sampleRate / MAX_PITCH);
    const maxLag = Math.ceil(sampleRate / MIN_PITCH);
    let bestLag = 0;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let correlation = 0;
        let energyA = 0;
        let energyB = 0;
        for (let index = 0; index < frame.length - lag; index++) {
            const a = frame[index] - mean;
            const b = frame[index + lag] - mean;
            correlation += a * b;
            energyA += a * a;
            energyB += b * b;
        }
        const denominator = Math.sqrt(energyA * energyB);
        const normalizedCorrelation = denominator > 0 ? correlation / denominator : 0;
        if (normalizedCorrelation > bestCorrelation) {
            bestCorrelation = normalizedCorrelation;
            bestLag = lag;
        }
    }

    if (bestCorrelation < 0.55 || bestLag === 0) return null;
    return { pitch: sampleRate / bestLag, harmonicity: bestCorrelation };
}

function getBandEnergy(windowed, sampleRate, frequencies) {
    let energy = 0;
    for (const frequency of frequencies) {
        const omega = (2 * Math.PI * frequency) / sampleRate;
        const coefficient = 2 * Math.cos(omega);
        let previous = 0;
        let previous2 = 0;
        for (const sample of windowed) {
            const current = sample + coefficient * previous - previous2;
            previous2 = previous;
            previous = current;
        }
        energy += Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2);
    }

    return Math.log1p(energy / frequencies.length);
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let index = 0; index < a.length; index++) {
        dot += a[index] * b[index];
        magnitudeA += a[index] * a[index];
        magnitudeB += b[index] * b[index];
    }
    const denominator = Math.sqrt(magnitudeA * magnitudeB);
    return denominator > 0 ? Math.max(0, Math.min(1, dot / denominator)) : 0;
}

function compareVoiceFingerprints(a, b) {
    const isCompatible = fingerprint => fingerprint?.algorithm === 'korai-voiceprint-v1' &&
        Array.isArray(fingerprint.spectralEnvelope) &&
        Number.isFinite(fingerprint.pitchMedian) &&
        Number.isFinite(fingerprint.pitchIqr) &&
        Number.isFinite(fingerprint.confidence) &&
        fingerprint.spectralEnvelope.every(Number.isFinite);
    if (!isCompatible(a) || !isCompatible(b)) return null;
    if (a.spectralEnvelope.length !== FORMANT_FREQUENCIES.length ||
        b.spectralEnvelope.length !== FORMANT_FREQUENCIES.length ||
        a.spectralEnvelope.length !== b.spectralEnvelope.length) return null;
    const spectralSimilarity = cosineSimilarity(a.spectralEnvelope, b.spectralEnvelope);
    const pitchSpread = Math.max(a.pitchIqr, b.pitchIqr, 1);
    const pitchSimilarity = Math.max(0, 1 - Math.abs(a.pitchMedian - b.pitchMedian) / pitchSpread);
    const quality = Math.min(Math.max(0, Math.min(1, a.confidence)), Math.max(0, Math.min(1, b.confidence)));
    return Math.round((spectralSimilarity * 0.88 + pitchSimilarity * 0.12) * quality * 100);
}

function buildVoiceFingerprint(samples, sampleRate = SAMPLE_RATE) {
    if (!samples || samples.length < FRAME_SIZE || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

    const voicedPitches = [];
    const bandTotals = new Float64Array(FORMANT_FREQUENCIES.length);
    let totalFrames = 0;
    let harmonicityTotal = 0;
    let voicedFrames = 0;

    for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
        const frame = samples.subarray(start, start + FRAME_SIZE);
        const voice = getFramePitch(frame, sampleRate);
        totalFrames++;
        if (!voice) continue;

        voicedFrames++;
        voicedPitches.push(voice.pitch);
        harmonicityTotal += voice.harmonicity;
        const windowed = new Float64Array(frame.length);
        for (let index = 0; index < frame.length; index++) {
            const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frame.length - 1));
            windowed[index] = frame[index] * window;
        }
        for (let band = 0; band < FORMANT_FREQUENCIES.length; band++) {
            bandTotals[band] += getBandEnergy(windowed, sampleRate, FORMANT_FREQUENCIES[band]);
        }
    }

    if (voicedFrames < 8) return null;
    voicedPitches.sort((a, b) => a - b);
    const percentile = value => voicedPitches[Math.min(voicedPitches.length - 1, Math.floor((voicedPitches.length - 1) * value))];
    const pitchMedian = percentile(0.5);
    const pitchIqr = Math.max(1, percentile(0.75) - percentile(0.25));
    const envelope = Array.from(bandTotals, energy => energy / voicedFrames);
    const envelopeMean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
    const centeredEnvelope = envelope.map(value => value - envelopeMean);
    const envelopeNorm = Math.sqrt(centeredEnvelope.reduce((sum, value) => sum + value * value, 0));
    const spectralEnvelope = envelopeNorm > 0
        ? centeredEnvelope.map(value => value / envelopeNorm)
        : centeredEnvelope;
    const voicedRatio = voicedFrames / Math.max(1, totalFrames);
    const confidence = Math.min(1, (voicedFrames / 30) * 0.55 + voicedRatio * 0.45);

    return {
        algorithm: 'korai-voiceprint-v1',
        spectralEnvelope,
        pitchMedian: Math.round(pitchMedian),
        pitchIqr: Math.round(pitchIqr),
        voicedRatio: Math.round(voicedRatio * 1000) / 1000,
        harmonicity: Math.round((harmonicityTotal / voicedFrames) * 1000) / 1000,
        voicedFrames,
        confidence: Math.round(confidence * 1000) / 1000
    };
}

async function analyzeVoiceFile(filePath, durationSeconds = 0) {
    const sampleDuration = Math.min(14, Number(durationSeconds) || 14);
    if (sampleDuration < 3) return null;
    const startSeconds = Math.max(0, (Number(durationSeconds) || sampleDuration) * 0.25 - sampleDuration / 2);
    const { samples, sampleRate } = await decodeAudioToMono(filePath, SAMPLE_RATE, sampleDuration, startSeconds);
    return buildVoiceFingerprint(samples, sampleRate);
}

module.exports = {
    analyzeVoiceFile,
    buildVoiceFingerprint,
    compareVoiceFingerprints,
    getFramePitch
};
