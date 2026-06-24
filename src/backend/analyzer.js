const fs = require('fs');
const mm = require('music-metadata');
const path = require('path');

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

async function extractFeatureVector(filePath) {
    const metadata = await mm.parseFile(filePath, { duration: true });
    const duration = metadata.format.duration || 180;
    const bitrate = metadata.format.bitrate || 128000;
    const sampleRate = metadata.format.sampleRate || 44100;
    let bpm = metadata.common.bpm || 120;
    let genre = metadata.common.genre ? (Array.isArray(metadata.common.genre) ? metadata.common.genre[0] : metadata.common.genre) : '';
    let energy = Math.min(0.95, Math.max(0.15, (bitrate / 320000) * (duration < 120 ? 1.15 : duration > 300 ? 0.85 : 1)));
    const features = {
        tempo_norm: Math.min(1, Math.max(0, (bpm - 60) / 160)),
        energy: energy,
        duration_norm: Math.min(1, duration / 600),
        bitrate_norm: Math.min(1, bitrate / 320000),
        spectral_centroid: Math.min(1, (bitrate / 320000) * 0.6 + 0.2),
        zero_crossing: Math.min(0.3, Math.max(0.02, (1 - energy) * 0.2 + 0.05)),
        low_freq_energy: Math.min(1, energy * 0.7 + 0.2),
        high_freq_energy: Math.min(1, (1 - energy) * 0.5 + 0.3)
    };
    const audioProfile = calculateAudioProfile(bpm, energy, duration, genre);
    return { features, bpm, genre, energy, duration, ...audioProfile };
}

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

function euclideanDistance(vecA, vecB) {
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
        sum += Math.pow(vecA[i] - vecB[i], 2);
    }
    return Math.sqrt(sum);
}

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

function calculateAudioProfile(bpm, energy, duration, genre) {
    const valence = Math.min(1, (bpm < 70 ? 0.3 + (energy * 0.3) : bpm < 100 ? 0.4 + (energy * 0.4) : bpm < 130 ? 0.55 + (energy * 0.35) : 0.65 + (Math.min(1, energy * 0.35))));
    const arousal = (energy * 0.6) + (Math.min(1, bpm / 200) * 0.4);
    const mood = valence > 0.6 && arousal > 0.6 ? 'Happy & Energetic' : valence > 0.6 && arousal <= 0.6 ? 'Happy & Relaxed' : valence <= 0.6 && arousal > 0.6 ? 'Moody & Intense' : 'Sad & Calm';
    const danceability = Math.min(1, ((1 - Math.abs((bpm - 115) / 100)) * 0.5) + (Math.min(1, energy * 1.3) * 0.5));
    let vocalPresence = 0.5;
    const vocalGenres = ['pop', 'hip hop', 'rap', 'r&b', 'soul', 'indie', 'folk', 'vocal'];
    if (vocalGenres.some(g => genre.toLowerCase().includes(g))) vocalPresence = 0.7 + (Math.random() * 0.2);
    else if (genre.toLowerCase().includes('instrumental')) vocalPresence = 0.1;
    else if (genre.toLowerCase().includes('electronic') || genre.toLowerCase().includes('edm')) vocalPresence = 0.3;
    const instrumentalness = 1 - vocalPresence;
    const acousticness = ['folk', 'acoustic', 'classical', 'jazz', 'ambient'].some(g => genre.toLowerCase().includes(g)) ? 0.75 + (Math.random() * 0.25) : genre.toLowerCase().includes('electronic') ? 0.05 : 0.35;
    let popularityPotential = 50;
    if (duration >= 180 && duration <= 300) popularityPotential += 15;
    else if (duration >= 120 && duration <= 360) popularityPotential += 8;
    if (energy >= 0.4 && energy <= 0.8) popularityPotential += 12;
    else if (energy > 0.8) popularityPotential += 8;
    popularityPotential += Math.round(danceability * 15);
    if (bpm >= 100 && bpm <= 130) popularityPotential += 8;
    else if (bpm >= 85 && bpm <= 150) popularityPotential += 4;
    popularityPotential = Math.min(100, popularityPotential);
    return { mood, valence, arousal, danceability, vocalPresence, instrumentalness, acousticness, popularityPotential, qualityScore: 75 };
}

function detectGenreIntelligent(bpm, energy, bitrate, vocalPresence = 0.5) {
    let genre = 'Pop';
    let confidence = 0.70;
    const score = {
        Ambient: 0, Classical: 0, Jazz: 0, Blues: 0, LoFi: 0,
        HipHop: 0, RAndB: 0, Reggae: 0, Rock: 0, Metal: 0,
        Pop: 0, Indie: 0, EDM: 0, House: 0, Techno: 0,
        DrumAndBass: 0, Synthwave: 0, Latin: 0
    };
    if (bpm < 70) { score.Ambient += 0.3; score.Classical += 0.25; score.Jazz += 0.2; if (energy < 0.3) { score.Ambient += 0.4; score.LoFi += 0.3; } else { score.Jazz += 0.3; score.Blues += 0.3; } }
    else if (bpm < 100) { if (energy > 0.6) { score.HipHop += 0.5; score.RAndB += 0.3; } else { score.RAndB += 0.4; score.Reggae += 0.3; score.Jazz += 0.2; } }
    else if (bpm < 130) { if (energy > 0.7) { score.Rock += 0.4; score.Indie += 0.2; } else { score.Pop += 0.5; score.Indie += 0.2; } }
    else if (bpm < 155) { if (energy > 0.7) { score.EDM += 0.3; score.House += 0.3; score.Techno += 0.2; } else { score.EDM += 0.4; score.Synthwave += 0.2; } }
    else { if (energy > 0.75) { score.DrumAndBass += 0.5; score.Metal += 0.2; } else { score.Metal += 0.4; score.Rock += 0.3; } }
    if (vocalPresence > 0.65) { score.Pop += 0.2; score.HipHop += 0.15; score.RAndB += 0.15; }
    else if (vocalPresence < 0.2) { score.EDM += 0.2; score.Techno += 0.2; score.Ambient += 0.2; score.Classical += 0.2; }
    if (bitrate > 200000) { score.Rock += 0.1; score.Metal += 0.1; score.Classical += 0.1; }
    let maxScore = 0;
    for (const [key, val] of Object.entries(score)) {
        if (val > maxScore) { maxScore = val; genre = key; }
    }
    confidence = Math.min(0.92, 0.55 + (maxScore * 0.6));
    const genreMap = { Ambient: 'Ambient / Classical', Classical: 'Ambient / Classical', Jazz: 'Jazz / Blues', Blues: 'Jazz / Blues', LoFi: 'Downtempo / Lo-fi', HipHop: 'Hip Hop / Rap', RAndB: 'R&B / Soul', Reggae: 'Reggae / Dub', Rock: 'Rock / Alternative', Metal: 'Metal / Punk', Pop: 'Pop', Indie: 'Indie / Alternative', EDM: 'EDM / House', House: 'EDM / House', Techno: 'Trance / Techno', DrumAndBass: 'Drum & Bass / Hardcore', Synthwave: 'Electronic / Synthwave', Latin: 'Latin / Tropical' };
    return { genre: genreMap[genre] || 'Pop', confidence };
}

async function analyzeAudioFile(filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const metadata = await mm.parseFile(filePath, { duration: true });
    const duration = metadata.format.duration || 0;
    const bitrate = metadata.format.bitrate || 128000;
    const sampleRate = metadata.format.sampleRate || 44100;
    const codec = metadata.format.codec || 'unknown';
    let bpm = metadata.common.bpm || 120;
    let genreTag = metadata.common.genre ? (Array.isArray(metadata.common.genre) ? metadata.common.genre[0] : metadata.common.genre) : '';
    let energy = Math.min(0.95, Math.max(0.15, (bitrate / 320000) * (duration < 120 ? 1.15 : duration > 300 ? 0.85 : 1)));
    let title = metadata.common.title || path.basename(filePath, path.extname(filePath));
    let artist = metadata.common.artist || metadata.common.artists?.[0] || '';
    let album = metadata.common.album || '';
    let vocalPresence = 0.5;
    if (genreTag) {
        const vocalGenres = ['pop', 'hip hop', 'rap', 'r&b', 'soul', 'indie', 'folk', 'vocal'];
        if (vocalGenres.some(g => genreTag.toLowerCase().includes(g))) vocalPresence = 0.7 + (Math.random() * 0.2);
        else if (genreTag.toLowerCase().includes('instrumental')) vocalPresence = 0.1;
        else if (genreTag.toLowerCase().includes('electronic') || genreTag.toLowerCase().includes('edm')) vocalPresence = 0.3;
    }
    const genreResult = detectGenreIntelligent(bpm, energy, bitrate, vocalPresence);
    const finalGenre = (genreTag && genreTag !== '') ? genreTag : genreResult.genre;
    const confidence = (genreTag && genreTag !== '') ? 0.92 : genreResult.confidence;
    const rawFeatures = {
        tempo_norm: Math.min(1, Math.max(0, (bpm - 60) / 160)),
        energy: energy,
        duration_norm: Math.min(1, duration / 600),
        bitrate_norm: Math.min(1, bitrate / 320000),
        spectral_centroid: Math.min(1, (bitrate / 320000) * 0.6 + 0.2),
        zero_crossing: Math.min(0.3, Math.max(0.02, (1 - energy) * 0.2 + 0.05)),
        low_freq_energy: Math.min(1, energy * 0.7 + 0.2),
        high_freq_energy: Math.min(1, (1 - energy) * 0.5 + 0.3)
    };
    const featureVector = normalizeFeatures(rawFeatures);
    let coverImage = null;
    if (metadata.common.picture && metadata.common.picture.length > 0) {
        coverImage = metadata.common.picture[0].data;
    }
    console.debug(`✅ Analyzed: ${title} | ${bpm}BPM | ${Math.round(energy*100)}% | ${finalGenre}`);
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

module.exports = { 
    analyzeAudioFile,
    cosineSimilarity,
    euclideanDistance,
    normalizeFeatures,
    calculateAudioProfile,
    detectGenreIntelligent
};