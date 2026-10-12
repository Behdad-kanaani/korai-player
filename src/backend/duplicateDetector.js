'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { decodeAudioToMono } = require('./bpmDetector');

const DUPLICATE_SAMPLE_RATE = 4000;
const DUPLICATE_SAMPLE_SECONDS = 45;
const MAX_INDEPENDENT_AUDIO_PAIRS = 2000;
const MAX_INDEPENDENT_AUDIO_TRACKS = 512;
const ACOUSTIC_FRAME_SIZE = 2048;
const SPECTRAL_BANDS = [
    [80, 120, 160],
    [200, 270, 340],
    [400, 500, 630],
    [750, 950, 1200],
    [1400, 1700, 1950]
];
const ACOUSTIC_WINDOW = Float64Array.from({ length: ACOUSTIC_FRAME_SIZE }, (_, index) =>
    0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (ACOUSTIC_FRAME_SIZE - 1))
);

function normalizeLabel(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/\.(?:mp3|flac|wav|m4a|aac|ogg|opus|wma|aiff|ape)$/i, '')
        .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')
        .replace(/\s*\(?\b(?:copy|duplicate)\s*\d*\)?\s*$/i, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function isUsableTitle(value) {
    const normalized = normalizeLabel(value);
    return Boolean(normalized) && !new Set(['unknown', 'unknown title', 'untitled', 'track', 'audio', 'music']).has(normalized);
}

function durationsMatch(a, b) {
    const durationA = Number(a.duration);
    const durationB = Number(b.duration);
    if (!Number.isFinite(durationA) || !Number.isFinite(durationB) || durationA <= 0 || durationB <= 0) return false;
    return Math.abs(durationA - durationB) <= Math.max(2, Math.min(5, Math.max(durationA, durationB) * 0.01));
}

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

function getToneEnergy(frame, frequency, sampleRate) {
    const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
    let previous = 0;
    let previous2 = 0;
    for (let index = 0; index < frame.length; index++) {
        const current = frame[index] * ACOUSTIC_WINDOW[index] + coefficient * previous - previous2;
        previous2 = previous;
        previous = current;
    }
    return Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2);
}

function buildAcousticSignature(samples, sampleRate = DUPLICATE_SAMPLE_RATE) {
    if (!samples || samples.length < ACOUSTIC_FRAME_SIZE || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
    const frames = [];

    for (let start = 0; start + ACOUSTIC_FRAME_SIZE <= samples.length; start += ACOUSTIC_FRAME_SIZE) {
        const frame = samples.subarray(start, start + ACOUSTIC_FRAME_SIZE);
        const bands = SPECTRAL_BANDS.map(frequencies =>
            frequencies.reduce((total, frequency) => total + getToneEnergy(frame, frequency, sampleRate), 0)
        );
        const sum = bands.reduce((total, energy) => total + energy, 0);
        if (sum > 0) frames.push(bands.map(energy => energy / sum));
    }
    return frames.length >= 8 ? frames : null;
}

function compareAcousticSignatures(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || Math.min(a.length, b.length) < 8) return false;
    const frameCount = Math.min(a.length, b.length);
    let similaritySum = 0;
    let strongMatches = 0;

    for (let index = 0; index < frameCount; index++) {
        const frameA = a[Math.floor((index * a.length) / frameCount)];
        const frameB = b[Math.floor((index * b.length) / frameCount)];
        let dot = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;
        for (let band = 0; band < SPECTRAL_BANDS.length; band++) {
            dot += frameA[band] * frameB[band];
            magnitudeA += frameA[band] * frameA[band];
            magnitudeB += frameB[band] * frameB[band];
        }
        const denominator = Math.sqrt(magnitudeA * magnitudeB);
        const similarity = denominator > 0 ? dot / denominator : 0;
        similaritySum += similarity;
        if (similarity >= 0.94) strongMatches++;
    }

    return similaritySum / frameCount >= 0.975 && strongMatches / frameCount >= 0.85;
}

async function getTrackAcousticSignature(track) {
    const duration = Number(track.duration) || DUPLICATE_SAMPLE_SECONDS;
    const sampleSeconds = Math.min(DUPLICATE_SAMPLE_SECONDS, duration);
    const startSeconds = Math.max(0, duration / 2 - sampleSeconds / 2);
    const audio = await decodeAudioToMono(track.filePath, DUPLICATE_SAMPLE_RATE, sampleSeconds, startSeconds);
    return buildAcousticSignature(audio.samples, audio.sampleRate);
}

function makeDisjointSet(size) {
    const parent = Array.from({ length: size }, (_, index) => index);
    const find = value => {
        while (parent[value] !== value) {
            parent[value] = parent[parent[value]];
            value = parent[value];
        }
        return value;
    };
    const union = (a, b) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootB] = rootA;
    };
    return { find, union };
}

function compareTrackQuality(a, b) {
    const score = track =>
        (track.isLiked ? 1_000_000_000 : 0) +
        (Number(track.playCount) || 0) * 1_000_000 +
        (/^(flac|alac|wav|aiff|ape)$/i.test(path.extname(track.filePath || '').slice(1)) ? 100_000 : 0) +
        (Number(track.bitrate) || 0) +
        (track.hasCover ? 1 : 0);
    return score(b) - score(a) || a.id - b.id;
}

async function findDuplicateGroups(tracks, onProgress = () => {}, audioSignatureForTrack = getTrackAcousticSignature) {
    const validTracks = tracks.filter(track => track && Number.isInteger(Number(track.id)) && track.filePath);
    const hashes = new Map();
    const scanErrors = [];
    const scanWarnings = [];

    for (let index = 0; index < validTracks.length; index++) {
        const track = validTracks[index];
        try {
            hashes.set(index, await hashFile(track.filePath));
        } catch (error) {
            scanErrors.push({ trackId: track.id, message: 'Audio file could not be read' });
            console.warn(`[duplicates] Could not read audio for track ${track.id}: ${error.message}`);
        }
        onProgress(index + 1, validTracks.length, 'hash');
    }

    const sets = makeDisjointSet(validTracks.length);
    const evidence = new Map();
    const addEvidence = (a, b, reason) => {
        const left = Math.min(a, b);
        const right = Math.max(a, b);
        const key = `${left}:${right}`;
        const reasons = evidence.get(key) || new Set();
        reasons.add(reason);
        evidence.set(key, reasons);
        sets.union(left, right);
    };

    const exactHashGroups = new Map();
    for (const [index, hash] of hashes) {
        const indexes = exactHashGroups.get(hash) || [];
        indexes.push(index);
        exactHashGroups.set(hash, indexes);
    }
    for (const indexes of exactHashGroups.values()) {
        for (let index = 1; index < indexes.length; index++) {
            addEvidence(indexes[0], indexes[index], 'exact-file');
        }
    }

    const metadataGroups = new Map();
    for (const [index, track] of validTracks.entries()) {
        const title = normalizeLabel(track.title || path.basename(track.filePath));
        if (!isUsableTitle(title)) continue;
        const artist = normalizeLabel(track.artist);
        if (!title) continue;
        const key = artist ? `artist:${artist}|title:${title}` : `title:${title}`;
        const indexes = metadataGroups.get(key) || [];
        indexes.push(index);
        metadataGroups.set(key, indexes);
    }
    for (const indexes of metadataGroups.values()) {
        for (let left = 0; left < indexes.length; left++) {
            for (let right = left + 1; right < indexes.length; right++) {
                const a = indexes[left];
                const b = indexes[right];
                if (hashes.has(a) && hashes.has(b) && hashes.get(a) === hashes.get(b)) continue;
                if (!durationsMatch(validTracks[a], validTracks[b])) continue;
                addEvidence(a, b, normalizeLabel(validTracks[a].artist) ? 'metadata-match' : 'title-and-duration');
            }
        }
    }

    const independentAudioPairs = [];
    const durationSortedIndexes = validTracks
        .map((track, index) => ({ index, duration: Number(track.duration) }))
        .filter(item => Number.isFinite(item.duration) && item.duration > 0)
        .sort((a, b) => a.duration - b.duration);
    const independentTrackIndexes = new Set();
    let independentCandidatesTruncated = false;
    for (let left = 0; left < durationSortedIndexes.length && !independentCandidatesTruncated; left++) {
        const a = durationSortedIndexes[left];
        for (let right = left + 1; right < durationSortedIndexes.length; right++) {
            const b = durationSortedIndexes[right];
            if (b.duration - a.duration > 5) break;
            if (!durationsMatch(validTracks[a.index], validTracks[b.index])) continue;
            if (hashes.has(a.index) && hashes.has(b.index) && hashes.get(a.index) === hashes.get(b.index)) continue;

            const key = `${Math.min(a.index, b.index)}:${Math.max(a.index, b.index)}`;
            const existingEvidence = evidence.get(key);
            if (existingEvidence?.has('metadata-match') || existingEvidence?.has('title-and-duration')) continue;

            const newTracks = [a.index, b.index].filter(index => !independentTrackIndexes.has(index));
            if (
                independentAudioPairs.length >= MAX_INDEPENDENT_AUDIO_PAIRS ||
                independentTrackIndexes.size + newTracks.length > MAX_INDEPENDENT_AUDIO_TRACKS
            ) {
                independentCandidatesTruncated = true;
                break;
            }
            independentAudioPairs.push([a.index, b.index]);
            newTracks.forEach(index => independentTrackIndexes.add(index));
        }
    }
    if (independentCandidatesTruncated) {
        scanWarnings.push('Independent audio matching was limited to keep the scan responsive.');
    }

    const candidateIndexes = new Set();
    for (const [key, reasons] of evidence) {
        if (!reasons.has('metadata-match') && !reasons.has('title-and-duration')) continue;
        const [a, b] = key.split(':').map(Number);
        if (hashes.has(a) && hashes.has(b) && hashes.get(a) === hashes.get(b)) continue;
        candidateIndexes.add(a);
        candidateIndexes.add(b);
    }
    for (const index of independentTrackIndexes) candidateIndexes.add(index);
    const acousticSignatures = new Map();
    let acousticIndex = 0;
    for (const index of candidateIndexes) {
        try {
            acousticSignatures.set(index, await audioSignatureForTrack(validTracks[index]));
        } catch (error) {
            scanErrors.push({ trackId: validTracks[index].id, message: 'Audio content could not be analyzed' });
            console.warn(`[duplicates] Could not analyze audio for track ${validTracks[index].id}: ${error.message}`);
        }
        acousticIndex++;
        onProgress(acousticIndex, candidateIndexes.size, 'audio');
    }
    for (const [key, reasons] of evidence) {
        if (!reasons.has('metadata-match') && !reasons.has('title-and-duration')) continue;
        const [a, b] = key.split(':').map(Number);
        if ((!hashes.has(a) || !hashes.has(b) || hashes.get(a) !== hashes.get(b)) &&
            compareAcousticSignatures(acousticSignatures.get(a), acousticSignatures.get(b))) {
            addEvidence(a, b, 'audio-match');
        }
    }
    for (const [a, b] of independentAudioPairs) {
        if (compareAcousticSignatures(acousticSignatures.get(a), acousticSignatures.get(b))) {
            addEvidence(a, b, 'audio-match');
        }
    }

    const components = new Map();
    for (let index = 0; index < validTracks.length; index++) {
        const root = sets.find(index);
        const component = components.get(root) || [];
        component.push(index);
        components.set(root, component);
    }

    const groups = [];
    for (const componentIndexes of components.values()) {
        if (componentIndexes.length < 2) continue;
        const orderedIndexes = [...componentIndexes].sort((a, b) =>
            compareTrackQuality(validTracks[a], validTracks[b])
        );
        const cliques = [];
        for (const index of orderedIndexes) {
            let clique = cliques.find(candidate => candidate.every(memberIndex => {
                const key = `${Math.min(index, memberIndex)}:${Math.max(index, memberIndex)}`;
                return evidence.has(key);
            }));
            if (!clique) {
                clique = [];
                cliques.push(clique);
            }
            clique.push(index);
        }

        const coveredPairs = new Set();
        const addGroup = indexes => {
            const pairEvidence = [];
            let everyPairExact = true;
            let everyPairSameRecording = true;
            for (let left = 0; left < indexes.length; left++) {
                for (let right = left + 1; right < indexes.length; right++) {
                    const key = `${Math.min(indexes[left], indexes[right])}:${Math.max(indexes[left], indexes[right])}`;
                    coveredPairs.add(key);
                    const reasons = evidence.get(key) || new Set();
                    pairEvidence.push(reasons);
                    everyPairExact &&= reasons.has('exact-file');
                    everyPairSameRecording &&= reasons.has('exact-file') || reasons.has('audio-match');
                }
            }
            const sharedEvidence = new Set(pairEvidence[0]);
            for (const reasons of pairEvidence.slice(1)) {
                for (const reason of sharedEvidence) {
                    if (!reasons.has(reason)) sharedEvidence.delete(reason);
                }
            }
            const members = indexes.map(index => validTracks[index]).sort(compareTrackQuality);
            groups.push({
                type: everyPairExact ? 'exact' : everyPairSameRecording ? 'same-recording' : 'probable',
                evidence: [...sharedEvidence].sort(),
                mixedEvidence: sharedEvidence.size === 0,
                recommendedKeepTrackId: members[0].id,
                tracks: members
            });
        };
        for (const indexes of cliques) {
            if (indexes.length >= 2) addGroup(indexes);
        }
        for (let left = 0; left < orderedIndexes.length; left++) {
            for (let right = left + 1; right < orderedIndexes.length; right++) {
                const a = orderedIndexes[left];
                const b = orderedIndexes[right];
                const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
                if (evidence.has(key) && !coveredPairs.has(key)) addGroup([a, b]);
            }
        }
    }

    groups.sort((a, b) => {
        const aQuality = Math.max(...a.tracks.map(track => Number(track.playCount) || 0));
        const bQuality = Math.max(...b.tracks.map(track => Number(track.playCount) || 0));
        return Number(b.type === 'exact') - Number(a.type === 'exact') ||
            Number(b.type === 'same-recording') - Number(a.type === 'same-recording') ||
            bQuality - aQuality ||
            String(a.tracks[0].title).localeCompare(String(b.tracks[0].title));
    });

    return { groups, scanErrors, scanWarnings, scannedTracks: validTracks.length };
}

module.exports = {
    findDuplicateGroups,
    normalizeLabel,
    durationsMatch,
    buildAcousticSignature,
    compareAcousticSignatures
};
