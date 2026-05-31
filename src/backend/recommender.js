/**
 * recommender.js - KORAI Music Player Advanced Recommendation Engine
 * 
 * Professional music recommendation system using:
 * - Multi-dimensional similarity scoring (BPM, Energy, Genre, Loudness)
 * - Collaborative filtering via play history
 * - Content-based filtering with weighted metrics
 * - Smart playlist generation
 * - Discovery bonus for less-played tracks
 */

/**
 * Advanced genre detection with confidence scoring
 */
function detectGenre(track) {
    const bpm = track.bpm || 120;
    const energy = track.energy || 0.5;
    const genreTag = track.genre || '';
    
    // Priority: use existing genre tag if available and confident
    if (genreTag && genreTag !== '') {
        const normalized = genreTag.toLowerCase();
        
        const genreMap = [
            { keywords: ['rap', 'hiphop', 'hip hop', 'trap', 'grime'], name: 'Hip Hop / Rap', icon: 'fa-microphone', color: '#ff6b6b', description: 'ضربی و ریتمیک', bpmRange: [70, 100], energyRange: [0.4, 0.8] },
            { keywords: ['pop', 'indie', 'alternative', 'dream pop'], name: 'Pop / Indie', icon: 'fa-headphones', color: '#1db954', description: 'پرطرفدار و شاد', bpmRange: [90, 130], energyRange: [0.5, 0.85] },
            { keywords: ['rock', 'metal', 'punk', 'hardcore', 'grunge'], name: 'Rock / Metal', icon: 'fa-guitar', color: '#ff8800', description: 'سنگین و پرقدرت', bpmRange: [100, 180], energyRange: [0.6, 0.95] },
            { keywords: ['jazz', 'blues', 'soul', 'rnb', 'r&b', 'funk'], name: 'Jazz / Blues / R&B', icon: 'fa-saxophone', color: '#4a90e2', description: 'ملایم و احساسی', bpmRange: [60, 110], energyRange: [0.2, 0.6] },
            { keywords: ['electronic', 'edm', 'house', 'techno', 'trance', 'dubstep'], name: 'Electronic / EDM', icon: 'fa-bolt', color: '#e040fb', description: 'الکترونیک و پرانرژی', bpmRange: [120, 150], energyRange: [0.55, 0.95] },
            { keywords: ['dance', 'disco', 'funk', 'nu-disco'], name: 'Dance / Disco', icon: 'fa-drum', color: '#f5a623', description: 'رقصی و شاد', bpmRange: [110, 130], energyRange: [0.6, 0.9] },
            { keywords: ['classical', 'orchestra', 'ambient', 'cinematic', 'soundtrack'], name: 'Classical / Ambient', icon: 'fa-music', color: '#a0a0b0', description: 'ارکسترال و محیطی', bpmRange: [40, 90], energyRange: [0.1, 0.4] },
            { keywords: ['country', 'folk', 'acoustic', 'bluegrass'], name: 'Country / Folk', icon: 'fa-guitar', color: '#d4a373', description: 'آکوستیک و صمیمی', bpmRange: [70, 120], energyRange: [0.3, 0.65] },
            { keywords: ['latin', 'reggaeton', 'salsa', 'bachata'], name: 'Latin / Reggaeton', icon: 'fa-music', color: '#ff6b35', description: 'ریتمیک و پرانرژی', bpmRange: [80, 110], energyRange: [0.5, 0.85] },
            { keywords: ['k-pop', 'j-pop', 'c-pop'], name: 'K-Pop / J-Pop', icon: 'fa-star', color: '#ff69b4', description: 'پاپ کرهای و ژاپنی', bpmRange: [90, 140], energyRange: [0.55, 0.9] }
        ];
        
        for (const genre of genreMap) {
            if (genre.keywords.some(kw => normalized.includes(kw))) {
                return genre;
            }
        }
    }
    
    // Enhanced BPM + Energy based detection with fuzzy logic
    if (bpm < 70 && energy < 0.35) {
        return { name: 'Ambient / Classical', icon: 'fa-music', color: '#a0a0b0', description: 'ارکسترال و محیطی' };
    }
    
    if (bpm < 95) {
        if (energy < 0.4) return { name: 'Jazz / Blues', icon: 'fa-saxophone', color: '#4a90e2', description: 'ملایم و روح‌نواز' };
        if (energy < 0.65) return { name: 'R&B / Soul', icon: 'fa-heart', color: '#e84393', description: 'احساسی و ملایم' };
    }
    
    if (bpm >= 70 && bpm < 100) {
        if (energy >= 0.45 && energy < 0.75) {
            return { name: 'Hip Hop / Rap', icon: 'fa-microphone', color: '#ff6b6b', description: 'ضربی و ریتمیک' };
        }
    }
    
    if (bpm >= 95 && bpm < 125) {
        if (energy >= 0.5) return { name: 'Pop', icon: 'fa-headphones', color: '#1db954', description: 'عامه‌پسند و شاد' };
        if (energy >= 0.35) return { name: 'Soft Pop', icon: 'fa-headphones', color: '#1db954', description: 'ملایم و دلنشین' };
    }
    
    if (bpm >= 100 && bpm < 150) {
        if (energy >= 0.65) return { name: 'Rock / Alternative', icon: 'fa-guitar', color: '#ff8800', description: 'پرقدرت و پرانرژی' };
        if (energy >= 0.5) return { name: 'Soft Rock', icon: 'fa-guitar', color: '#ffaa44', description: 'راک ملایم' };
    }
    
    if (bpm >= 115 && bpm < 132) {
        if (energy >= 0.55) return { name: 'Dance / House', icon: 'fa-drum', color: '#f5a623', description: 'رقصی و شاد' };
    }
    
    if (bpm >= 128 && bpm < 150) {
        if (energy >= 0.6) return { name: 'EDM / Trance', icon: 'fa-bolt', color: '#e040fb', description: 'الکترونیک و خلسه‌ای' };
    }
    
    if (bpm >= 155 && bpm < 185) {
        if (energy >= 0.7) return { name: 'Drum & Bass', icon: 'fa-fire', color: '#ff4444', description: 'سریع و شدید' };
    }
    
    if (bpm >= 140 && bpm < 210) {
        if (energy >= 0.75) return { name: 'Metal / Hardcore', icon: 'fa-skull', color: '#aa0000', description: 'خشن و پرقدرت' };
    }
    
    if (bpm >= 80 && bpm < 120 && energy >= 0.3 && energy < 0.65) {
        return { name: 'Country / Folk', icon: 'fa-guitar', color: '#d4a373', description: 'آکوستیک و صمیمی' };
    }
    
    if (energy > 0.7) return { name: 'High Energy', icon: 'fa-bolt', color: '#ff6b6b', description: 'پرانرژی و پویا' };
    if (energy > 0.4) return { name: 'Mid Energy', icon: 'fa-chart-line', color: '#f5a623', description: 'متوسط و متعادل' };
    return { name: 'Low Energy', icon: 'fa-feather', color: '#a0a0b0', description: 'ملایم و آرام' };
}

/**
 * ENHANCED: Calculate similarity score between two tracks using weighted multi-dimensional metrics
 * Includes: BPM, Energy, Loudness, Genre, Discovery bonus, Popularity bonus
 */
function calculateSimilarityScore(sourceTrack, targetTrack) {
    // Extract values with defaults
    const sourceBpm = sourceTrack.bpm || 120;
    const targetBpm = targetTrack.bpm || 120;
    const sourceEnergy = sourceTrack.energy || 0.5;
    const targetEnergy = targetTrack.energy || 0.5;
    const sourceLoudness = sourceTrack.loudness || -12;
    const targetLoudness = targetTrack.loudness || -12;
    
    // BPM difference score (inverse exponential - close BPM gets high score)
    const bpmDiff = Math.abs(sourceBpm - targetBpm);
    let bpmScore = 0;
    if (bpmDiff === 0) bpmScore = 30;
    else if (bpmDiff <= 3) bpmScore = 28;
    else if (bpmDiff <= 5) bpmScore = 25;
    else if (bpmDiff <= 8) bpmScore = 22;
    else if (bpmDiff <= 12) bpmScore = 18;
    else if (bpmDiff <= 18) bpmScore = 14;
    else if (bpmDiff <= 25) bpmScore = 10;
    else if (bpmDiff <= 35) bpmScore = 6;
    else if (bpmDiff <= 50) bpmScore = 3;
    else bpmScore = 0;
    
    // Energy difference score
    const energyDiff = Math.abs(sourceEnergy - targetEnergy);
    let energyScore = 0;
    if (energyDiff === 0) energyScore = 20;
    else if (energyDiff <= 0.03) energyScore = 18;
    else if (energyDiff <= 0.06) energyScore = 16;
    else if (energyDiff <= 0.1) energyScore = 14;
    else if (energyDiff <= 0.15) energyScore = 11;
    else if (energyDiff <= 0.22) energyScore = 8;
    else if (energyDiff <= 0.3) energyScore = 5;
    else energyScore = 0;
    
    // Loudness difference score (normalized)
    const loudnessDiff = Math.abs(sourceLoudness - targetLoudness);
    let loudnessScore = 0;
    if (loudnessDiff <= 2) loudnessScore = 10;
    else if (loudnessDiff <= 5) loudnessScore = 7;
    else if (loudnessDiff <= 10) loudnessScore = 4;
    else loudnessScore = 0;
    
    // Genre similarity score
    const sourceGenre = detectGenre(sourceTrack);
    const targetGenre = detectGenre(targetTrack);
    let genreScore = 0;
    let similarityReason = '';
    let similarityIcon = '🎵';
    
    if (sourceGenre.name === targetGenre.name) {
        genreScore = 35;
        similarityReason = 'Same genre';
        similarityIcon = '🎯';
    } else {
        // Cross-genre similarity based on genre families
        const genreFamily = {
            'Hip Hop / Rap': ['Hip Hop / Rap', 'R&B / Soul', 'Pop'],
            'R&B / Soul': ['R&B / Soul', 'Hip Hop / Rap', 'Pop'],
            'Pop / Indie': ['Pop / Indie', 'Pop', 'Rock / Alternative'],
            'Rock / Alternative': ['Rock / Alternative', 'Pop / Indie', 'Metal / Hardcore'],
            'Electronic / EDM': ['Electronic / EDM', 'Dance / House', 'EDM / Trance'],
            'Dance / House': ['Dance / House', 'Electronic / EDM', 'Pop'],
            'Jazz / Blues / R&B': ['Jazz / Blues / R&B', 'R&B / Soul', 'Classical / Ambient'],
            'Classical / Ambient': ['Classical / Ambient', 'Jazz / Blues / R&B', 'Ambient'],
            'Metal / Hardcore': ['Metal / Hardcore', 'Rock / Alternative', 'Drum & Bass'],
            'Drum & Bass': ['Drum & Bass', 'Electronic / EDM', 'Metal / Hardcore']
        };
        
        const sourceFamily = genreFamily[sourceGenre.name] || [sourceGenre.name];
        if (sourceFamily.includes(targetGenre.name)) {
            genreScore = 22;
            similarityReason = 'Related genre';
            similarityIcon = '🎧';
        } else if (bpmDiff < 10) {
            genreScore = 18;
            similarityReason = 'Close tempo';
            similarityIcon = '⚡';
        } else if (energyDiff < 0.08) {
            genreScore = 15;
            similarityReason = 'Similar energy';
            similarityIcon = '🔊';
        } else {
            similarityReason = 'Smart recommendation';
            similarityIcon = '🤖';
        }
    }
    
    // Discovery bonus - prefer tracks that haven't been played much
    const playCount = targetTrack.playCount || 0;
    let discoveryBonus = 0;
    if (playCount === 0) discoveryBonus = 8;
    else if (playCount < 3) discoveryBonus = 5;
    else if (playCount < 10) discoveryBonus = 2;
    else discoveryBonus = 0;
    
    // Popularity bonus (capped)
    const likeCount = targetTrack.likeCount || 0;
    let popularityBonus = Math.min(5, (playCount * 0.03) + (likeCount * 0.5));
    
    // Total similarity score (max 100)
    let totalSimilarity = Math.min(98, Math.floor(
        bpmScore + energyScore + loudnessScore + genreScore + discoveryBonus + popularityBonus
    ));
    
    return {
        score: totalSimilarity,
        reason: similarityReason,
        icon: similarityIcon,
        bpmScore,
        energyScore,
        loudnessScore,
        genreScore,
        discoveryBonus,
        popularityBonus
    };
}

/**
 * Get recommendations with advanced multi-dimensional scoring
 */
function getRecommendations(allTracks, sourceTrack, limit = 12) {
    if (!allTracks || allTracks.length === 0) return [];
    
    // Filter out the source track itself
    const otherTracks = allTracks.filter(t => t.id !== sourceTrack.id);
    if (otherTracks.length === 0) return [];
    
    // Calculate similarity scores for all tracks
    const scoredTracks = otherTracks.map(track => {
        const similarity = calculateSimilarityScore(sourceTrack, track);
        
        // Only include tracks with minimum similarity score
        if (similarity.score < 12) return null;
        
        const trackGenre = detectGenre(track);
        
        return {
            ...track,
            similarity: similarity.score,
            reason: similarity.reason,
            similarityIcon: similarity.icon,
            detectedGenre: trackGenre.name,
            genreIcon: trackGenre.icon,
            genreColor: trackGenre.color,
            genreDescription: trackGenre.description,
            similarityBreakdown: {
                bpm: similarity.bpmScore,
                energy: similarity.energyScore,
                loudness: similarity.loudnessScore,
                genre: similarity.genreScore,
                discovery: similarity.discoveryBonus,
                popularity: similarity.popularityBonus
            }
        };
    });
    
    // Filter out nulls and sort by similarity score (highest first)
    const validScores = scoredTracks.filter(s => s !== null);
    const sorted = validScores.sort((a, b) => b.similarity - a.similarity);
    
    // Return top N recommendations
    return sorted.slice(0, Math.max(limit, Math.min(limit, sorted.length)));
}

/**
 * Get diverse recommendations (mix of high similarity and different sub-genres)
 */
function getDiverseRecommendations(allTracks, sourceTrack, limit = 15) {
    if (!allTracks || allTracks.length === 0) return [];
    
    const otherTracks = allTracks.filter(t => t.id !== sourceTrack.id);
    if (otherTracks.length === 0) return [];
    
    const sourceGenre = detectGenre(sourceTrack);
    const scoredTracks = otherTracks.map(track => {
        const similarity = calculateSimilarityScore(sourceTrack, track);
        if (similarity.score < 10) return null;
        
        const trackGenre = detectGenre(track);
        
        // Add diversity bonus for tracks from different but related genres
        let diversityBonus = 0;
        if (trackGenre.name !== sourceGenre.name) {
            diversityBonus = 5;
        }
        
        return {
            ...track,
            similarity: Math.min(98, similarity.score + diversityBonus),
            reason: similarity.reason,
            similarityIcon: similarity.icon,
            detectedGenre: trackGenre.name,
            genreIcon: trackGenre.icon,
            genreColor: trackGenre.color,
            genreDescription: trackGenre.description,
            isDifferentGenre: trackGenre.name !== sourceGenre.name
        };
    });
    
    const validScores = scoredTracks.filter(s => s !== null);
    
    // Sort to prioritize high similarity but also include some diversity
    const sorted = validScores.sort((a, b) => {
        if (a.isDifferentGenre === b.isDifferentGenre) {
            return b.similarity - a.similarity;
        }
        return a.isDifferentGenre ? 1 : -1;
    });
    
    return sorted.slice(0, Math.max(limit, Math.min(limit, sorted.length)));
}

/**
 * Create a smart playlist based on source track
 */
function createSimilarPlaylist(allTracks, sourceTrack, playlistName = null) {
    const recommendations = getRecommendations(allTracks, sourceTrack, 30);
    
    if (!recommendations || recommendations.length === 0) return null;
    
    const genre = detectGenre(sourceTrack);
    const trackTitle = sourceTrack.title || 'Track';
    const artistName = sourceTrack.artist || 'Unknown';
    
    // Generate creative playlist names based on genre and artist
    const nameOptions = [
        `🎵 ${trackTitle} & Similar Vibes`,
        `${genre.name} Essentials — Inspired by ${artistName}`,
        `🎧 ${genre.name} Radio · ${artistName}`,
        `✨ ${genre.name} Flow — Like ${artistName}`,
        `🌀 Harmonic Journey: ${trackTitle}`,
        `🌟 Discover: ${genre.name} Gems`
    ];
    
    const defaultName = playlistName || nameOptions[Math.floor(Math.random() * nameOptions.length)];
    
    // Calculate average similarity for metadata
    const avgSimilarity = recommendations.reduce((sum, t) => sum + t.similarity, 0) / recommendations.length;
    
    return {
        name: defaultName,
        tracks: recommendations.map(t => t.id),
        basedOnTrack: sourceTrack.id,
        basedOnTrackTitle: trackTitle,
        basedOnArtist: artistName,
        genre: genre.name,
        genreIcon: genre.icon,
        genreColor: genre.color,
        createdAt: Date.now(),
        trackCount: recommendations.length,
        avgSimilarity: Math.round(avgSimilarity)
    };
}

/**
 * Get recommendations based on multiple seed tracks (for mix generation)
 */
function getHybridRecommendations(allTracks, seedTracks, limit = 15) {
    if (!allTracks || allTracks.length === 0 || !seedTracks || seedTracks.length === 0) return [];
    
    // Collect all track IDs to exclude
    const excludeIds = new Set(seedTracks.map(t => t.id));
    
    // Calculate aggregated scores from all seed tracks
    const candidateScores = new Map();
    
    for (const track of allTracks) {
        if (excludeIds.has(track.id)) continue;
        
        let totalScore = 0;
        let bestReason = '';
        let bestIcon = '🎵';
        
        for (const seed of seedTracks) {
            const similarity = calculateSimilarityScore(seed, track);
            totalScore += similarity.score;
            if (similarity.score > 0 && !bestReason) {
                bestReason = similarity.reason;
                bestIcon = similarity.icon;
            }
        }
        
        const avgScore = totalScore / seedTracks.length;
        if (avgScore >= 15) {
            candidateScores.set(track.id, {
                track,
                score: Math.min(98, Math.floor(avgScore)),
                reason: bestReason,
                icon: bestIcon
            });
        }
    }
    
    const results = Array.from(candidateScores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    
    return results.map(r => {
        const genre = detectGenre(r.track);
        return {
            ...r.track,
            similarity: r.score,
            reason: r.reason,
            similarityIcon: r.icon,
            detectedGenre: genre.name,
            genreIcon: genre.icon,
            genreColor: genre.color,
            genreDescription: genre.description
        };
    });
}

module.exports = { 
    getRecommendations,
    getDiverseRecommendations,
    getHybridRecommendations,
    createSimilarPlaylist,
    detectGenre,
    calculateSimilarityScore
};