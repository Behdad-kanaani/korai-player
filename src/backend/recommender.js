// Local recommendation engine based on listening history and track features.

const { cosineSimilarity } = require('./analyzer');

function stableUnit(seed) {
    const text = String(seed ?? '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 100000) / 100000;
}


// Relative influence of listening actions.
const BEHAVIOR_WEIGHTS = {
    // Positive signals
    like: 0.50,
    favorite: 0.60,
    play: 0.15,                      // Base play signal
    repeat: 0.35,
    replay_within_week: 0.40,        // Re-engagement signal
    playlist_add: 0.22,              // Intentional curation
    share: 0.45,
    
    // Negative signals
    skip: -0.40,
    skip_quick: -0.50,
    skip_start: -0.55,
    dislike: -0.60,                  // Explicit negative feedback
    
    // Duration-based engagement
    completion_90: 0.12,             // Played to 90%+
    completion_75: 0.08,             // Played to 75%
    completion_50: 0.04,             // Played to 50%
    
    // Context signals
    add_to_queue: 0.18,              // Manual queue addition
    search_and_play: 0.25,           // Deliberate search then play
    recommendation_accept: 0.30,     // Accepted our recommendation
};

// Reduce the influence of older listening activity.
const TEMPORAL_DECAY = {
    hours_1: 1.0,         // Last hour - full weight
    hours_3: 0.95,        // Last 3 hours
    hours_6: 0.90,        // Last 6 hours
    hours_12: 0.85,       // Last 12 hours
    day_1: 0.80,          // Today
    day_2_3: 0.75,        // Last 2-3 days
    day_7: 0.65,          // Last week
    day_14: 0.50,         // Last 2 weeks
    day_30: 0.35,         // Last month
    day_90: 0.15,         // Last 3 months
    older: 0.05           // 3+ months
};

// Context profiles used to tune recommendations.
const CONTEXT_PROFILES = {
    morning: {
        mood: 'energetic',
        valence: 0.75,
        arousal: 0.7,
        tempo_preference: 'high',
        min_energy: 0.5,
        max_energy: 1.0,
        weight: 1.0
    },
    early_morning: {
        mood: 'peaceful',
        valence: 0.4,
        arousal: 0.2,
        tempo_preference: 'low',
        min_energy: 0.1,
        max_energy: 0.4,
        weight: 0.9
    },
    afternoon: {
        mood: 'focused',
        valence: 0.65,
        arousal: 0.6,
        tempo_preference: 'medium',
        min_energy: 0.4,
        max_energy: 0.8,
        weight: 1.0
    },
    evening: {
        mood: 'relaxed',
        valence: 0.55,
        arousal: 0.4,
        tempo_preference: 'medium-low',
        min_energy: 0.2,
        max_energy: 0.7,
        weight: 1.0
    },
    night: {
        mood: 'introspective',
        valence: 0.35,
        arousal: 0.2,
        tempo_preference: 'low',
        min_energy: 0.1,
        max_energy: 0.5,
        weight: 0.95
    },
    late_night: {
        mood: 'melancholic',
        valence: 0.3,
        arousal: 0.15,
        tempo_preference: 'very_low',
        min_energy: 0.05,
        max_energy: 0.35,
        weight: 0.9
    },
    workout: {
        mood: 'intense',
        valence: 0.7,
        arousal: 0.85,
        tempo_preference: 'very_high',
        min_energy: 0.7,
        max_energy: 1.0,
        bpm_min: 120,
        weight: 1.2
    },
    study: {
        mood: 'focused',
        valence: 0.5,
        arousal: 0.45,
        tempo_preference: 'low',
        min_energy: 0.2,
        max_energy: 0.6,
        prefer_instrumental: true,
        weight: 1.0
    },
    party: {
        mood: 'euphoric',
        valence: 0.85,
        arousal: 0.90,
        tempo_preference: 'very_high',
        min_energy: 0.8,
        max_energy: 1.0,
        bpm_min: 110,
        weight: 1.3
    },
    driving: {
        mood: 'alert',
        valence: 0.6,
        arousal: 0.7,
        tempo_preference: 'high',
        min_energy: 0.6,
        max_energy: 0.95,
        bpm_min: 100,
        weight: 1.1
    }
};

/**
 * Apply a gradual time-based reduction to listening signals.
 */
function getTemporalDecay(lastInteractionTime) {
    if (!lastInteractionTime) return 0;
    
    const millisecondsSince = Date.now() - lastInteractionTime;
    const daysSince = millisecondsSince / (1000 * 60 * 60 * 24);
    
    // Exponential decay: e^(-0.05*days) gives smoother curve
    // This means decay happens gradually rather than in steps
    const exponentialDecay = Math.exp(-0.05 * daysSince);
    
    // Map to our temporal decay scale
    if (daysSince <= 1/24) return 1.0;           // Within 1 hour
    if (daysSince <= 3/24) return 0.95;          // Within 3 hours
    if (daysSince <= 6/24) return 0.90;          // Within 6 hours
    if (daysSince <= 12/24) return 0.85;         // Within 12 hours
    if (daysSince <= 1) return 0.80;             // Within 1 day
    if (daysSince <= 3) return 0.75;             // Within 3 days
    if (daysSince <= 7) return Math.max(0.65, exponentialDecay);   // Within 1 week
    if (daysSince <= 14) return Math.max(0.50, exponentialDecay);  // Within 2 weeks
    if (daysSince <= 30) return Math.max(0.35, exponentialDecay);  // Within 1 month
    if (daysSince <= 90) return Math.max(0.15, exponentialDecay);  // Within 3 months
    
    return Math.max(0.05, exponentialDecay);  // Older than 3 months
}

/**
 * Get current context profile based on time and detected user activity
 * Now with activity-based context (workout, study, party, etc.)
 */
function getCurrentContext(userActivityPattern = null) {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    // If user activity is explicitly detected, use that
    if (userActivityPattern) {
        const profile = CONTEXT_PROFILES[userActivityPattern];
        if (profile) return profile;
    }
    
    // Time-of-day heuristics
    if (hour >= 5 && hour < 7) return CONTEXT_PROFILES.early_morning;
    if (hour >= 7 && hour < 12) return CONTEXT_PROFILES.morning;
    if (hour >= 12 && hour < 18) return CONTEXT_PROFILES.afternoon;
    if (hour >= 18 && hour < 22) return CONTEXT_PROFILES.evening;
    if (hour >= 22 || hour < 5) return CONTEXT_PROFILES.late_night;
    
    return CONTEXT_PROFILES.afternoon; // Default fallback
}

/**
 * Calculate a track preference score from listening signals.
 * Implements concepts similar to matrix factorization and neural collaborative filtering
 */
function calculatePreferenceScore(trackId, userHistory, userProfile = {}) {
    if (!userHistory || !userHistory[trackId]) return 0;
    
    const history = userHistory[trackId];
    let score = 0;
    
    // Apply advanced behavior weights with temporal decay
    const temporalDecay = getTemporalDecay(history.lastPlayed);
    
    // Calculate engagement intensity (how much user interacted)
    const engagementIntensity = Math.min(1.0, (
        (history.likeCount || 0) * 0.3 +
        (history.playCount || 0) * 0.05 +
        (history.repeatCount || 0) * 0.2 +
        (history.playlistAddCount || 0) * 0.15
    ) / 2);
    
    // Weighted behavior scoring with intensity multiplier
    if (history.likeCount > 0) {
        score += BEHAVIOR_WEIGHTS.like * Math.min(3, history.likeCount) * temporalDecay;
    }
    
    if (history.playCount > 0) {
        const playScore = BEHAVIOR_WEIGHTS.play * Math.min(20, history.playCount) * 0.8 * temporalDecay;
        score += playScore * (1 + engagementIntensity * 0.5);
    }
    
    if (history.skipCount > 0) {
        score += BEHAVIOR_WEIGHTS.skip * Math.min(5, history.skipCount) * temporalDecay;
    }
    
    if (history.skipQuickCount > 0) {
        score += BEHAVIOR_WEIGHTS.skip_quick * history.skipQuickCount * temporalDecay;
    }
    
    if (history.repeatCount > 0) {
        const repeatBonus = BEHAVIOR_WEIGHTS.repeat * history.repeatCount * temporalDecay;
        score += repeatBonus * (1 + 0.3); // Repeat is very valuable signal
    }
    
    if (history.playlistAddCount > 0) {
        score += BEHAVIOR_WEIGHTS.playlist_add * Math.min(5, history.playlistAddCount) * temporalDecay;
    }
    
    if (history.completionCount > 0) {
        score += BEHAVIOR_WEIGHTS.completion_90 * Math.min(20, history.completionCount) * temporalDecay;
    }
    
    // Recency boost with improved curve (exponential boost for very recent plays)
    const daysSinceLastPlay = history.lastPlayed 
        ? (Date.now() - history.lastPlayed) / (1000 * 60 * 60 * 24) 
        : 30;
    
    // Exponential recency boost - tracks played very recently get significant boost
    const recencyBoost = Math.max(0, 1 - (daysSinceLastPlay / 45)) * 0.25;
    score += recencyBoost;
    
    // Consistency bonus - if user plays this track regularly
    if (history.playCount && history.firstPlayedAt && history.lastPlayed) {
        const daysBetweenFirstAndLast = (history.lastPlayed - history.firstPlayedAt) / (1000 * 60 * 60 * 24);
        const consistency = Math.min(1, history.playCount / (daysBetweenFirstAndLast + 1));
        score += consistency * 0.1 * temporalDecay;
    }
    
    // Apply user profile preferences (if available)
    if (userProfile && userProfile.preferredGenres && history.genre) {
        if (userProfile.preferredGenres.includes(history.genre)) {
            score += 0.15;
        }
    }
    
    // Normalize to reasonable range
    return Math.min(1.0, Math.max(-0.7, score));
}

/**
 * Calculate user similarity using behavioral vectors
 * For collaborative filtering - find similar users
 */
function calculateUserSimilarity(userHistoryA, userHistoryB, useVectorDistance = true) {
    if (!userHistoryA || !userHistoryB) return 0;
    
    const tracksA = Object.keys(userHistoryA);
    const tracksB = Object.keys(userHistoryB);
    
    // Find common tracks
    const commonTracks = tracksA.filter(t => tracksB.includes(t));
    
    if (commonTracks.length === 0) return 0;
    
    if (useVectorDistance) {
        // Create behavior vectors for common tracks
        const vectorA = commonTracks.map(t => calculatePreferenceScore(t, userHistoryA));
        const vectorB = commonTracks.map(t => calculatePreferenceScore(t, userHistoryB));
        
        return cosineSimilarity(vectorA, vectorB);
    } else {
        // Simple shared preference calculation
        let agreement = 0;
        for (const track of commonTracks) {
            const scoreA = calculatePreferenceScore(track, userHistoryA);
            const scoreB = calculatePreferenceScore(track, userHistoryB);
            
            // Higher agreement if scores have same sign and similar magnitude
            if ((scoreA > 0 && scoreB > 0) || (scoreA < 0 && scoreB < 0)) {
                agreement += 1 - Math.abs(scoreA - scoreB);
            } else {
                agreement -= 0.5;
            }
        }
        return Math.max(0, agreement / commonTracks.length);
    }
}

function normalizeTasteTag(value) {
    return String(value || '').trim().toLocaleLowerCase();
}

function getReliableGenre(track) {
    if (!track || track.genreSource !== 'metadata') return '';
    const genre = String(track.genre || '').trim();
    return /^(downloaded|imported|unknown|various)$/i.test(genre) ? '' : genre;
}

function getMeasuredEnergy(track) {
    const rmsLevel = track?.rmsLevel ?? track?.energy;
    return track?.energySource === 'waveform-rms' && Number.isFinite(rmsLevel)
        ? rmsLevel
        : null;
}

function getTrackListeningSignals(track, userHistory, settings = {}) {
    const history = userHistory?.[String(track.id)] || {};
    const playCount = Math.max(0, Number(history.playCount) || 0, Number(track.playCount) || 0);
    const likeCount = Math.max(0, Number(history.likeCount) || 0, track.isLiked ? 1 : 0);
    const repeatCount = Math.max(0, Number(history.repeatCount) || 0);
    const playlistAddCount = Math.max(0, Number(history.playlistAddCount) || 0);
    const skipCount = Math.max(0, Number(history.skipCount) || 0);
    const skipQuickCount = Math.max(0, Number(history.skipQuickCount) || 0);
    const completionCount = Math.max(0, Number(history.completionCount) || 0);
    const decayTimestamp = history.lastInteractionAt || history.lastPlayed;
    const decay = decayTimestamp ? getTemporalDecay(decayTimestamp) : 1;
    const weight = (key, fallback) => {
        const value = Number(settings[key]);
        return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
    };
    const positive = (
        Math.log1p(playCount) * weight('weightPlay', 0.12) * 2 +
        likeCount * weight('weightLike', 0.4) * 3 +
        Math.log1p(repeatCount) * weight('weightRepeat', 0.25) * 2 +
        Math.log1p(playlistAddCount) * weight('weightPlaylistAdd', 0.15) * 2 +
        Math.log1p(completionCount) * 0.35
    ) * decay;

    return {
        playCount,
        likeCount,
        repeatCount,
        playlistAddCount,
        completionCount,
        skipCount,
        skipQuickCount,
        positive,
        negative: (
            Math.log1p(skipCount) + Math.log1p(skipQuickCount) * 0.6
        ) * weight('weightSkip', 0.3) * 2
    };
}

/**
 * Summarize only observed listening behavior and explicit genre tags.
 */
function generateListenerProfile(allTracks, userHistory = {}, settings = {}) {
    const genres = new Map();
    const artists = new Map();
    let evidenceTracks = 0;
    let totalPlays = 0;
    let likedTracks = 0;

    for (const track of allTracks || []) {
        const signals = getTrackListeningSignals(track, userHistory, settings);
        totalPlays += signals.playCount;
        if (signals.likeCount > 0) likedTracks++;

        const weight = Math.max(0, signals.positive - signals.negative);
        if (weight <= 0) continue;
        evidenceTracks++;

        const genre = getReliableGenre(track);
        if (genre) {
            const key = normalizeTasteTag(genre);
            const current = genres.get(key) || { name: genre, score: 0, plays: 0, likes: 0 };
            current.score += weight;
            current.plays += signals.playCount;
            current.likes += signals.likeCount > 0 ? 1 : 0;
            genres.set(key, current);
        }

        const artist = String(track.artist || '').trim();
        if (artist) {
            const key = normalizeTasteTag(artist);
            const current = artists.get(key) || { name: artist, score: 0, plays: 0, likes: 0 };
            current.score += weight;
            current.plays += signals.playCount;
            current.likes += signals.likeCount > 0 ? 1 : 0;
            artists.set(key, current);
        }
    }

    const rank = entries => [...entries.values()]
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, 5)
        .map(({ name, score, plays, likes }) => ({ name, score, plays, likes }));

    return {
        evidenceTracks,
        totalPlays,
        likedTracks,
        dataStrength: evidenceTracks >= 10 ? 'established' : evidenceTracks >= 3 ? 'building' : 'early',
        topGenres: rank(genres),
        topArtists: rank(artists)
    };
}

/**
 * Compare tracks using explicit genre tags and artist metadata only.
 */
function calculateContentSimilarity(sourceTrack, targetTrack) {
    if (!sourceTrack || !targetTrack) return 0;
    const sourceGenre = getReliableGenre(sourceTrack);
    const targetGenre = getReliableGenre(targetTrack);
    const sourceArtist = normalizeTasteTag(sourceTrack.artist);
    const targetArtist = normalizeTasteTag(targetTrack.artist);
    let score = 0;
    let weight = 0;

    if (sourceGenre && targetGenre) {
        score += (normalizeTasteTag(sourceGenre) === normalizeTasteTag(targetGenre)
            ? 1
            : areGenresSimilar(sourceGenre, targetGenre) ? 0.65 : 0) * 0.35;
        weight += 0.35;
    }
    if (sourceArtist && targetArtist) {
        score += (sourceArtist === targetArtist ? 1 : 0) * 0.15;
        weight += 0.15;
    }

    const sourceFeatures = sourceTrack.analysisVersion === 'waveform-v2' && Array.isArray(sourceTrack.featureVector)
        ? sourceTrack.featureVector
        : null;
    const targetFeatures = targetTrack.analysisVersion === 'waveform-v2' && Array.isArray(targetTrack.featureVector)
        ? targetTrack.featureVector
        : null;
    if (sourceFeatures && targetFeatures && sourceFeatures.length === targetFeatures.length) {
        let sharedDimensions = 0;
        let sourceMagnitude = 0;
        let targetMagnitude = 0;
        for (let index = 0; index < sourceFeatures.length; index++) {
            const sourceValue = sourceFeatures[index];
            const targetValue = targetFeatures[index];
            if (!Number.isFinite(sourceValue) || !Number.isFinite(targetValue)) continue;
            sharedDimensions++;
            sourceMagnitude += sourceValue * sourceValue;
            targetMagnitude += targetValue * targetValue;
        }
        if (sharedDimensions >= 2 && sourceMagnitude > 0 && targetMagnitude > 0) {
            score += cosineSimilarity(sourceFeatures, targetFeatures) * 0.5;
            weight += 0.5;
        }
    }
    return weight > 0 ? score / weight : 0;
}

/**
 * Diversity boosting - penalize overly similar tracks
 */
function applyDiversityBoost(recommendedTracks, diversityFactor = 0.85) {
    if (recommendedTracks.length <= 1) return recommendedTracks;
    
    const boosted = [...recommendedTracks];
    
    for (let i = 1; i < boosted.length; i++) {
        for (let j = 0; j < i; j++) {
            const sim = calculateContentSimilarity(boosted[i], boosted[j]);
            
            // Penalize very similar tracks (too repetitive)
            if (sim > 0.85) {
                boosted[i].similarityScore *= diversityFactor;
            }
        }
    }
    
    return boosted;
}

/**
 * Combine track similarity and listening history to rank recommendations.
 * Combines: content-based, collaborative, context-aware, and graph-based methods
 */
function getPersonalizedRecommendations(allTracks, sourceTrack, userHistory = {}, limit = 12, settings = {}) {
    if (!Array.isArray(allTracks) || allTracks.length === 0) return [];

    const profile = generateListenerProfile(allTracks, userHistory, settings);
    const genreScores = new Map(profile.topGenres.map(item => [
        normalizeTasteTag(item.name),
        item.score
    ]));
    const artistScores = new Map(profile.topArtists.map(item => [
        normalizeTasteTag(item.name),
        item.score
    ]));
    const maxGenreScore = Math.max(0, ...genreScores.values());
    const maxArtistScore = Math.max(0, ...artistScores.values());

    const scored = allTracks
        .filter(track => !sourceTrack || String(track.id) !== String(sourceTrack.id))
        .filter(track => sourceTrack || getTrackListeningSignals(track, userHistory, settings).playCount === 0)
        .map(track => {
            const signals = getTrackListeningSignals(track, userHistory, settings);
            const genre = getReliableGenre(track);
            const genrePreference = genreScores.get(normalizeTasteTag(genre));
            const artistPreference = artistScores.get(normalizeTasteTag(track.artist));
            const genreAffinity = genrePreference && maxGenreScore
                ? genrePreference / maxGenreScore
                : 0;
            const artistAffinity = artistPreference && maxArtistScore
                ? artistPreference / maxArtistScore
                : 0;
            const sourceSimilarity = sourceTrack ? calculateContentSimilarity(sourceTrack, track) : 0;

            let weightedScore = 0;
            let availableWeight = 0;
            if (genre) {
                weightedScore += genreAffinity * 0.55;
                availableWeight += 0.55;
            }
            if (track.artist) {
                weightedScore += artistAffinity * 0.30;
                availableWeight += 0.30;
            }
            if (sourceTrack) {
                weightedScore += sourceSimilarity * 0.15;
                availableWeight += 0.15;
            }

            const skipRate = signals.skipCount / Math.max(1, signals.playCount + signals.skipCount);
            const familiarityPenalty = Math.min(0.35, Math.log1p(signals.playCount) * 0.10);
            const negativeFeedbackPenalty = Math.min(0.7, skipRate * 0.7);
            const similarityScore = availableWeight > 0
                ? Math.max(0, (weightedScore / availableWeight) * (1 - familiarityPenalty) * (1 - negativeFeedbackPenalty))
                : 0;
            const reasons = [];

            if (genrePreference > 0) reasons.push('Matches a genre in your listening history');
            if (artistPreference > 0) reasons.push('An artist you have listened to');
            if (sourceTrack && sourceSimilarity >= 0.6) reasons.push('Shares reliable metadata with the current track');
            if (reasons.length === 0 && profile.evidenceTracks > 0) reasons.push('Ranked from your listening history');
            if (reasons.length === 0 && sourceSimilarity > 0) reasons.push('Matches the current track metadata');

            return {
                ...track,
                similarityScore,
                contentSimilarity: sourceSimilarity,
                genreAffinity,
                artistAffinity,
                skipRate,
                reason: reasons.slice(0, 2).join(' • ')
            };
        })
        .filter(track => track.similarityScore > 0);

    const configuredDiversity = Number(settings.diversityBoost);
    const diversityFactor = Number.isFinite(configuredDiversity)
        ? Math.min(1, Math.max(0.5, configuredDiversity))
        : 0.85;
    const diversified = applyAdvancedDiversityBoost(scored, diversityFactor);
    return diversified
        .slice(0, Math.max(0, Number(limit) || 0))
        .map(track => ({
            ...track,
            similarity: Math.round(track.similarityScore * 100),
            explainability: {
                topFactors: [
                    { name: 'Genre history', influence: Math.round(track.genreAffinity * 100) },
                    { name: 'Artist history', influence: Math.round(track.artistAffinity * 100) },
                    { name: 'Current track metadata', influence: Math.round(track.contentSimilarity * 100) }
                ].filter(factor => factor.influence > 0)
            }
        }));
}

/**
 * Add variety to the recommended tracks.
 */
function applyAdvancedDiversityBoost(recommendedTracks, diversityFactor = 0.82) {
    const remaining = [...recommendedTracks];
    const selected = [];
    const artistCounts = new Map();
    const genreCounts = new Map();

    while (remaining.length > 0) {
        let bestIndex = 0;
        let bestScore = -Infinity;
        for (let index = 0; index < remaining.length; index++) {
            const track = remaining[index];
            const artist = normalizeTasteTag(track.artist);
            const genre = normalizeTasteTag(getReliableGenre(track));
            const repetitionPenalty = Math.pow(diversityFactor, artistCounts.get(artist) || 0) *
                Math.pow(Math.max(diversityFactor, 0.97), genreCounts.get(genre) || 0);
            const score = track.similarityScore * repetitionPenalty;
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }

        const [chosen] = remaining.splice(bestIndex, 1);
        chosen.similarityScore = bestScore;
        selected.push(chosen);
        const artist = normalizeTasteTag(chosen.artist);
        const genre = normalizeTasteTag(getReliableGenre(chosen));
        if (artist) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
        if (genre) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }

    return selected;
}

/**
 * Generate intelligent explanation for why track was recommended
 */
function generateIntelligentReason(track, sourceTrack, context) {
    const reasons = [];
    
    if (track.contentSimilarity > 0.75) reasons.push('Similar sound & vibe');
    if (track.collaborativeScore > 0.6) reasons.push('In your favorite style');
    if (track.contextScore > 0.75) reasons.push('Perfect for this moment');
    if (track.genreScore > 0.8) reasons.push('Your favorite genre');
    if (track.discoveryScore > 0.85) reasons.push('Hidden gem discovery');
    if (!sourceTrack.artist || sourceTrack.artist !== track.artist) reasons.push('New artist');
    
    if (reasons.length === 0) reasons.push('AI picked for you');
    
    return reasons.slice(0, 2).join(' • ');
}

/**
 * Calculate advanced confidence score
 */
function calculateAdvancedConfidence(track) {
    const factors = [
        (track.similarityScore || 0) * 100,
        Math.min(100, Math.max(0, (track.collaborativeScore + 0.5) * 60)),
        (track.contextScore || 0.5) * 80,
        (track.contentSimilarity || 0) * 90
    ];
    
    const baseConfidence = factors.reduce((a, b) => a + b) / factors.length;
    return Math.round(Math.min(95, baseConfidence));
}

/**
 * Get top factors influencing the recommendation
 */
function getTopFactors(track) {
    const factors = [
        { name: 'Content Similarity', score: track.contentSimilarity, weight: 0.40 },
        { name: 'Your Preferences', score: track.collaborativeScore, weight: 0.30 },
        { name: 'Context Match', score: track.contextScore, weight: 0.15 },
        { name: 'Genre Affinity', score: track.genreScore, weight: 0.10 },
        { name: 'Discovery Factor', score: track.discoveryScore, weight: 0.05 }
    ];
    
    return factors
        .sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
        .slice(0, 3)
        .map(f => ({ name: f.name, influence: Math.round(f.score * 100) }));
}

/**
 * Generate detailed explanation
 */
function generateDetailedExplanation(track, sourceTrack, context) {
    const explanations = [];
    
    if (track.contentSimilarity > 0.7) {
        explanations.push(`Has similar acoustic fingerprint to "${sourceTrack.title || 'your track'}"`);
    }
    if (track.genreScore > 0.8) {
        explanations.push(`Both are ${track.genre || 'same genre'}`);
    }
    if (track.contextScore > 0.7) {
        explanations.push(`Perfect match for ${context.mood} mood right now`);
    }
    if (track.collaborativeScore > 0.5) {
        explanations.push('You tend to like this style of music');
    }
    if (track.artist && sourceTrack.artist && track.artist !== sourceTrack.artist) {
        explanations.push('Different artist - good for discovery');
    }
    
    return explanations.slice(0, 2).join('. ');
}

/**
 * Check if two genres are similar
 */
function areGenresSimilar(genre1, genre2) {
    const g1 = genre1.toLowerCase();
    const g2 = genre2.toLowerCase();
    
    const genreGroups = [
        ['electronic', 'edm', 'house', 'trance', 'techno', 'dance'],
        ['hip hop', 'rap', 'urban', 'r&b'],
        ['rock', 'metal', 'alternative', 'indie'],
        ['jazz', 'blues', 'acoustic'],
        ['pop', 'vocal', 'indie pop'],
        ['ambient', 'chill', 'lofi', 'lo-fi', 'relaxing'],
        ['classical', 'orchestral', 'instrumental']
    ];
    
    return genreGroups.some(group => {
        const hasG1 = group.some(g => g1.includes(g));
        const hasG2 = group.some(g => g2.includes(g));
        return hasG1 && hasG2;
    });
}

/**
 * Generate advanced personalized reason
 */
function getAdvancedPersonalizedReason(track, sourceTrack) {
    if (track.preferenceScore > 0.4) return ' Based on your favorites';
    if (track.contentSimilarity > 0.75) return ' Similar sound & vibe';
    if (track.genreBonus > 0.1) return ' Same genre as you like';
    if (track.preferenceScore > 0.2) return ' You\'ve enjoyed similar tracks';
    return ' AI discovery pick';
}

/**
 * Calculate recommendation confidence (0-100)
 */
function calculateRecommendationConfidence(track) {
    const factors = [
        track.similarityScore * 100,
        Math.max(0, (track.preferenceScore + 0.5) * 50),
        (track.contentSimilarity * 0.8 + 0.2) * 100
    ];
    
    return Math.round(factors.reduce((a, b) => a + b) / factors.length);
}

/**
 * Generate personalized reason string
 */
function getPersonalizedReason(track, prefScore) {
    if (prefScore > 0.3) return 'Based on your listening history';
    if (track.genre && track.featureSimilarity > 0.7) return 'Same genre & style';
    if (track.featureSimilarity > 0.6) return 'Similar musical fingerprint';
    return 'AI recommendation';
}

/**
 * Update user history with interaction tracking (PROFESSIONAL)
 */
function updateUserHistory(userHistory, trackId, action, userDataPath) {
    const numericTrackId = Number(trackId);
    const normalizedAction = typeof action === 'string' ? { type: action } : action;
    const supportedActions = new Set(['play', 'like', 'unlike', 'skip', 'repeat', 'playlist_add', 'completion']);
    if (!Number.isInteger(numericTrackId) || numericTrackId <= 0) {
        throw new TypeError('A valid track ID is required to record listening history');
    }
    if (!normalizedAction || typeof normalizedAction !== 'object' || !supportedActions.has(normalizedAction.type)) {
        throw new TypeError('A supported listening action is required');
    }

    const historyKey = String(numericTrackId);
    if (!userHistory[historyKey]) {
        userHistory[historyKey] = {
            playCount: 0,
            likeCount: 0,
            skipCount: 0,
            skipQuickCount: 0,         // Skipped in first 10 seconds
            repeatCount: 0,
            playlistAddCount: 0,
            completionCount: 0,        // Played to 90%+
            firstPlayedAt: null,
            lastPlayed: null,
            totalListeningTime: 0,    // In seconds
            interactions: []           // Full interaction history for analytics
        };
    }
    
    const history = userHistory[historyKey];
    const now = Date.now();
    history.lastInteractionAt = now;
    
    switch(normalizedAction.type) {
        case 'play':
            history.playCount++;
            history.lastPlayed = now;
            if (!history.firstPlayedAt) history.firstPlayedAt = now;
            break;
            
        case 'like':
            history.likeCount++;
            break;
            
        case 'unlike':
            history.likeCount = Math.max(0, history.likeCount - 1);
            break;
            
        case 'skip':
            history.skipCount++;
            if (Number(normalizedAction.atSeconds) < 10) {
                history.skipQuickCount = (history.skipQuickCount || 0) + 1;
            }
            break;
            
        case 'repeat':
            history.repeatCount++;
            break;
            
        case 'playlist_add':
            history.playlistAddCount++;
            break;
            
        case 'completion':
            history.completionCount = (history.completionCount || 0) + 1;
            if (Number.isFinite(Number(normalizedAction.duration)) && Number(normalizedAction.duration) > 0) {
                history.totalListeningTime += Number(normalizedAction.duration);
            }
            break;
    }
    
    // Store interaction in history (filter keys to avoid prototype pollution)
    try {
        const { isSafeKey } = require('./securityUtils');
        if (history.interactions && history.interactions.length < 100) {
            const safeEntry = {};
            if (isSafeKey('type')) safeEntry.type = normalizedAction.type;
            if (isSafeKey('timestamp')) safeEntry.timestamp = now;
            if (isSafeKey('duration') && normalizedAction.duration !== undefined) safeEntry.duration = normalizedAction.duration;
            if (isSafeKey('atSeconds') && normalizedAction.atSeconds !== undefined) safeEntry.atSeconds = normalizedAction.atSeconds;
            history.interactions.push(safeEntry);
        }
    } catch (e) {
        console.error('Failed to sanitize a listening interaction:', e);
        if (history.interactions && history.interactions.length < 100) {
            history.interactions.push({ type: normalizedAction.type, timestamp: now });
        }
    }
    
    // Async save to disk (non-blocking)
    if (userDataPath) {
        const fs = require('fs');
        const path = require('path');
        const historyPath = path.join(userDataPath, 'user_history.json');
        fs.promises.writeFile(historyPath, JSON.stringify(userHistory, null, 2))
            .catch(e => console.error('Failed to save user history:', e));
    }
    
    return history;
}

/**
 * Load user history from disk
 */
function loadUserHistory(userDataPath) {
    const fs = require('fs');
    const path = require('path');
    const historyPath = path.join(userDataPath, 'user_history.json');
    
    if (fs.existsSync(historyPath)) {
        try {
            return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        } catch(e) {
            return {};
        }
    }
    return {};
}

/**
 * Get context-aware recommendations (time of day, mood)
 */
function getContextAwareRecommendations(allTracks, userHistory, limit = 10) {
    const timeProfile = getTimeOfDayProfile();
    
    // Filter tracks by context
    const contextualTracks = allTracks.filter(track => {
        // Match mood with time of day
        const trackMood = track.mood || 'Neutral';
        const matchesMood = matchMoodToContext(trackMood, timeProfile.mood);
        
        // Filter by arousal level
        const arousalMatch = Math.abs((track.arousal || 0.5) - timeProfile.arousal) < 0.3;
        
        // Recent plays get boosted if user hasn't heard them yet
        const userHistory_this = userHistory[track.id];
        const isUnheardOrOld = !userHistory_this || userHistory_this.playCount < 2;
        
        return matchesMood && arousalMatch && isUnheardOrOld;
    });
    
    if (contextualTracks.length === 0) return getDiscoveryRecommendations(allTracks, userHistory, limit);
    
    // Score by preference and shuffle for variety
    const scored = contextualTracks.map(track => ({
        ...track,
        score: calculatePreferenceScore(track.id, userHistory) + (stableUnit(`${track.id}:${timeProfile.mood}:context`) * 0.2)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, limit).map(t => ({
        ...t,
        reason: ` ${getTimeOfDayLabel()} vibes`,
        similarity: Math.round(t.score * 100)
    }));
}

/**
 * Match track mood to time of day
 */
function matchMoodToContext(trackMood, contextMood) {
    const moodMap = {
        'energetic': ['morning', 'afternoon'],
        'focused': ['afternoon'],
        'relaxed': ['evening'],
        'introspective': ['night', 'evening']
    };
    
    const trackMoodLower = trackMood.toLowerCase();
    const allMoods = Object.keys(moodMap);
    
    for (const mood of allMoods) {
        if (trackMoodLower.includes(mood)) {
            return moodMap[mood].includes(contextMood);
        }
    }
    
    return true; // Default match
}

/**
 * Get time of day label
 */
function getTimeOfDayLabel() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 18) return 'Afternoon';
    if (hour >= 18 && hour < 23) return 'Evening';
    return 'Night';
}

/**
 * Get "Discover" recommendations - tracks user hasn't heard much (ENHANCED)
 */
function getDiscoveryRecommendations(allTracks, userHistory, limit = 10, settings = {}) {
    const profile = generateListenerProfile(allTracks, userHistory, settings);
    const genres = new Map(profile.topGenres.map((item, index) => [normalizeTasteTag(item.name), 1 / (index + 1)]));
    const artists = new Map(profile.topArtists.map((item, index) => [normalizeTasteTag(item.name), 1 / (index + 1)]));
    const unheardTracks = allTracks.filter(track => getTrackListeningSignals(track, userHistory, settings).playCount === 0);

    return unheardTracks
        .map(track => {
            const genreAffinity = genres.get(normalizeTasteTag(getReliableGenre(track))) || 0;
            const artistAffinity = artists.get(normalizeTasteTag(track.artist)) || 0;
            const variety = stableUnit(`${track.id}:discovery`);
            return {
                ...track,
                similarity: Math.round((genreAffinity * 0.65 + artistAffinity * 0.25 + variety * 0.1) * 100),
                reason: genreAffinity > 0
                    ? 'Unplayed track in a genre you listen to'
                    : artistAffinity > 0
                        ? 'Unplayed track by an artist you listen to'
                        : 'Not played yet in your library'
            };
        })
        .sort((a, b) => b.similarity - a.similarity || String(a.title || '').localeCompare(String(b.title || '')))
        .slice(0, Math.max(0, Number(limit) || 0));
}

/**
 * Generate intelligent playlists with coherent musical flow (NEW - ADVANCED)
 * Creates playlists that flow well musically while maintaining variety
 */
function generateSmartPlaylist(allTracks, options = {}) {
    const {
        seed = null,                    // Start with specific track
        mood = null,                   // Target mood
        duration = 3600,               // Target duration in seconds
        maxTracks = 50,
        energyProgression = 'moderate', // 'low', 'moderate', 'high', 'wave'
        includeDiscovery = true,
        userHistory = {},
        explicitFlow = false           // If true, create interesting arc
    } = options;
    
    const playlist = [];
    let currentDuration = 0;
    
    // Start with seed track if provided
    if (seed && allTracks.some(t => t.id === seed.id)) {
        playlist.push(seed);
        currentDuration += seed.duration || 240;
    }
    
    // Define energy progression curve
    let progressionWeights = [];
    if (energyProgression === 'low') {
        progressionWeights = Array(maxTracks).fill(0).map((_, i) => 0.3 + stableUnit(`progress:${i}:low`) * 0.3);
    } else if (energyProgression === 'high') {
        progressionWeights = Array(maxTracks).fill(0).map((_, i) => 0.6 + stableUnit(`progress:${i}:high`) * 0.4);
    } else if (energyProgression === 'wave') {
        // Wave pattern: up-down-up-down
        progressionWeights = Array(maxTracks).fill(0).map((_, i) => {
            const phase = (i % 8) / 8;
            return 0.4 + Math.sin(phase * Math.PI * 2) * 0.35;
        });
    } else {
        // Moderate: start moderate, slight increase
        progressionWeights = Array(maxTracks).fill(0).map((_, i) => {
            return 0.45 + (i / maxTracks) * 0.15 + (stableUnit(`progress:${i}:moderate`) * 0.15);
        });
    }
    
    // Smart track selection for coherent flow
    const candidateTracks = allTracks.filter(t => !playlist.some(p => p.id === t.id));
    
    for (let i = 0; i < maxTracks && currentDuration < duration && candidateTracks.length > 0; i++) {
        const targetEnergy = progressionWeights[i];
        
        // Score candidates by flow compatibility
        const scored = candidateTracks.map(track => {
            // Energy compatibility (most important for flow)
            const measuredEnergy = getMeasuredEnergy(track);
            const hasMeasuredEnergy = measuredEnergy !== null;
            const energyScore = hasMeasuredEnergy
                ? Math.max(0, 1 - Math.abs(measuredEnergy - targetEnergy) * 2)
                : null;
            
            // Genre continuity with previous track
            let genreScore = 0.5;
            const trackGenre = getReliableGenre(track);
            const previousGenre = playlist.length > 0 ? getReliableGenre(playlist[playlist.length - 1]) : '';
            if (trackGenre && previousGenre) {
                if (normalizeTasteTag(trackGenre) === normalizeTasteTag(previousGenre)) {
                    genreScore = 0.9;
                } else if (areGenresSimilar(trackGenre, previousGenre)) {
                    genreScore = 0.7;
                } else {
                    genreScore = 0.3;
                }
            }
            
            // Mood matching (if specified)
            let moodScore = 0.5;
            if (mood && track.mood) {
                moodScore = track.mood.includes(mood) ? 0.95 : 0.5;
            }
            
            // Prevent too many same artists
            const sameArtistPenalty = playlist.filter(p => p.artist === track.artist).length > 1 ? 0.6 : 1.0;
            
            // User preference (if available)
            const preferenceScore = 0.5 + calculatePreferenceScore(track.id, userHistory) * 0.3;
            
            // Discovery boost if enabled
            const discoveryBoost = includeDiscovery && (!userHistory[track.id] || userHistory[track.id].playCount === 0) 
                ? 1.2 
                : 1.0;
            
            // Composite score
            const weightedParts = [
                ...(energyScore === null ? [] : [{ score: energyScore, weight: 0.40 }]),
                { score: genreScore, weight: 0.25 },
                { score: moodScore, weight: 0.15 },
                { score: preferenceScore, weight: 0.15 },
                { score: stableUnit(`${track.id}:${i}:flow`), weight: 0.05 }
            ];
            const flowScore = weightedParts.reduce((total, part) => total + part.score * part.weight, 0) /
                weightedParts.reduce((total, part) => total + part.weight, 0) *
                sameArtistPenalty * discoveryBoost;
            
            return { ...track, flowScore };
        });
        
        // Select best flowing track
        scored.sort((a, b) => b.flowScore - a.flowScore);
        const selected = scored[0];
        
        playlist.push(selected);
        currentDuration += selected.duration || 240;
        
        // Remove selected track from candidates
        const idx = candidateTracks.findIndex(t => t.id === selected.id);
        if (idx >= 0) candidateTracks.splice(idx, 1);
    }
    
    const measuredEnergies = playlist
        .map(getMeasuredEnergy)
        .filter(value => value !== null);
    return {
        tracks: playlist,
        totalDuration: currentDuration,
        avgEnergy: measuredEnergies.length
            ? measuredEnergies.reduce((sum, value) => sum + value, 0) / measuredEnergies.length
            : null,
        energyProgression,
        genres: [...new Set(playlist.map(getReliableGenre).filter(Boolean))],
        quality: calculatePlaylistQuality(playlist)
    };
}

/**
 * Calculate playlist quality score
 */
function calculatePlaylistQuality(playlist) {
    if (playlist.length < 2) return 0;

    let score = 0;
    let availableWeight = 0;
    const genres = [...new Set(playlist.map(getReliableGenre).filter(Boolean))];
    const artists = [...new Set(playlist.map(track => normalizeTasteTag(track.artist)).filter(Boolean))];
    if (genres.length > 0) {
        score += (genres.length / playlist.length) * 25;
        availableWeight += 25;
    }
    if (artists.length > 0) {
        score += (artists.length / playlist.length) * 25;
        availableWeight += 25;
    }

    const energies = playlist.map(getMeasuredEnergy).filter(value => value !== null);
    if (energies.length > 1) {
        const avgEnergy = energies.reduce((sum, value) => sum + value, 0) / energies.length;
        const energyVariance = energies.reduce((sum, value) => sum + (value - avgEnergy) ** 2, 0) / energies.length;
        score += Math.min(25, energyVariance * 50);
        availableWeight += 25;
    }

    return availableWeight > 0 ? Math.round((score / availableWeight) * 100) : null;
}

/**
 * AI-powered search with mood, energy, and vibe matching (NEW - ADVANCED)
 */
function intelligentSearch(searchQuery, allTracks, userHistory = {}) {
    const query = searchQuery.toLowerCase().trim();
    const results = [];
    
    // Parse search query for special commands
    const moodMatch = query.match(/mood:(\w+)|vibe:(\w+)|energy:(\w+)/);
    const tempoMatch = query.match(/tempo:(\w+)|bpm:(\d+)-(\d+)/);
    const genreMatch = query.match(/genre:(\w+)|style:(\w+)/);
    
    let targetMood = null, targetEnergy = null, targetTempo = null, targetGenre = null;
    
    if (moodMatch) {
        targetMood = moodMatch[1] || moodMatch[2] || null;
    }
    if (tempoMatch) {
        targetTempo = tempoMatch[1] || `${tempoMatch[2]}-${tempoMatch[3]}` || null;
    }
    if (genreMatch) {
        targetGenre = genreMatch[1] || genreMatch[2] || null;
    }
    
    // Search and score tracks
    for (const track of allTracks) {
        let score = 0;
        
        // 1. Text matching (title, artist, album)
        const title = (track.title || '').toLowerCase();
        const artist = (track.artist || '').toLowerCase();
        const album = (track.album || '').toLowerCase();
        
        if (title.includes(query)) score += 40;
        if (artist.includes(query)) score += 35;
        if (album.includes(query)) score += 15;
        
        // 2. Mood matching
        if (targetMood) {
            const trackMood = (track.mood || '').toLowerCase();
            if (trackMood.includes(targetMood)) {
                score += 30;
            }
        }
        
        // 3. Energy matching
        if (targetEnergy) {
            const energyMap = { 'low': 0.3, 'medium': 0.5, 'high': 0.8 };
            const targetE = energyMap[targetEnergy];
            const measuredEnergy = getMeasuredEnergy(track);
            if (targetE && measuredEnergy !== null && Math.abs(measuredEnergy - targetE) < 0.2) {
                score += 25;
            }
        }
        
        // 4. Genre matching
        if (targetGenre) {
            const genre = getReliableGenre(track);
            if (genre && genre.toLowerCase().includes(targetGenre)) {
                score += 20;
            }
        }
        
        // 5. User preference boost
        const prefScore = calculatePreferenceScore(track.id, userHistory);
        if (prefScore > 0.3) score += 10;
        
        if (score > 0) {
            results.push({
                ...track,
                searchScore: score,
                matchType: score > 40 ? 'exact' : score > 20 ? 'strong' : 'contextual'
            });
        }
    }
    
    // Sort by relevance
    results.sort((a, b) => b.searchScore - a.searchScore);
    
    return results.slice(0, 50).map(t => ({
        ...t,
        similarity: Math.round(Math.min(100, t.searchScore)),
        matchReason: t.matchType === 'exact' 
            ? 'Direct match' 
            : t.matchType === 'strong'
            ? 'Strong match'
            : 'Contextual match'
    }));
}

/**
 * Learn user behavior patterns for better personalization (NEW - ADVANCED)
 */
function analyzeUserBehaviorPatterns(userHistory, allTracks, windowDays = 30) {
    const cutoffTime = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
    
    // Extract recent behavior
    const recentBehavior = Object.entries(userHistory).reduce((acc, [trackId, history]) => {
        if (history.lastPlayed && history.lastPlayed > cutoffTime) {
            acc.push({ trackId, ...history });
        }
        return acc;
    }, []);
    
    // Analyze patterns
    const patterns = {
        topGenres: {},
        topArtists: {},
        preferredEnergy: [],
        preferredMood: [],
        listeningTimes: {},
        playbackPatterns: {
            avgPlayCount: 0,
            avgSkipRate: 0,
            completionRate: 0,
            favoriteRate: 0
        },
        discoveryRate: 0,
        consistencyScore: 0
    };
    
    let validTracks = 0;
    
    for (const item of recentBehavior) {
        const track = allTracks.find(t => t.id === item.trackId);
        if (!track) continue;
        
        validTracks++;
        
        // Genre analysis
        const genre = getReliableGenre(track);
        if (genre) {
            patterns.topGenres[genre] = (patterns.topGenres[genre] || 0) + item.playCount;
        }
        
        // Artist analysis
        if (track.artist) {
            patterns.topArtists[track.artist] = (patterns.topArtists[track.artist] || 0) + item.playCount;
        }
        
        // Collect energy and mood
        const measuredEnergy = getMeasuredEnergy(track);
        if (measuredEnergy !== null) patterns.preferredEnergy.push(measuredEnergy);
        if (track.mood) patterns.preferredMood.push(track.mood);
    }
    
    if (validTracks > 0) {
        // Calculate averages
        patterns.playbackPatterns.avgPlayCount = recentBehavior.reduce((a, b) => a + (b.playCount || 0), 0) / validTracks;
        patterns.playbackPatterns.avgSkipRate = recentBehavior.reduce((a, b) => a + (b.skipCount || 0), 0) / validTracks;
        patterns.playbackPatterns.completionRate = recentBehavior.reduce((a, b) => a + (b.completionCount || 0), 0) / validTracks;
        patterns.playbackPatterns.favoriteRate = recentBehavior.reduce((a, b) => a + (b.likeCount || 0), 0) / validTracks;
        
        // Calculate average energy preference
        if (patterns.preferredEnergy.length > 0) {
            const avgEnergy = patterns.preferredEnergy.reduce((a, b) => a + b, 0) / patterns.preferredEnergy.length;
            patterns.avgPreferredEnergy = Math.round(avgEnergy * 100) / 100;
        } else {
            patterns.avgPreferredEnergy = null;
        }
        
        // Determine discovery rate
        const discoveredTracks = recentBehavior.filter(b => !b.firstPlayedAt || (b.lastPlayed - b.firstPlayedAt < 24 * 60 * 60 * 1000));
        patterns.discoveryRate = discoveredTracks.length / validTracks;
        
        // Calculate consistency
        patterns.consistencyScore = (patterns.playbackPatterns.avgPlayCount * patterns.playbackPatterns.completionRate);
    }
    
    return patterns;
}

/**
 * Get personalized recommendations based on behavior patterns (NEW)
 */
function getPatternBasedRecommendations(behaviorPatterns, allTracks, limit = 10) {
    const recommendations = [];
    
    // Determine preferred characteristics from patterns
    const topGenres = Object.entries(behaviorPatterns.topGenres)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(e => e[0]);
    
    const targetEnergy = behaviorPatterns.avgPreferredEnergy;
    
    // Filter and score tracks
    const scored = allTracks.map(track => {
        let score = 0;
        
        const genre = getReliableGenre(track);
        if (topGenres.includes(genre)) {
            score += 0.4;
        } else if (genre && topGenres.some(g => areGenresSimilar(g, genre))) {
            score += 0.2;
        }
        
        const measuredEnergy = getMeasuredEnergy(track);
        if (Number.isFinite(targetEnergy) && measuredEnergy !== null) {
            const energyDiff = Math.abs(measuredEnergy - targetEnergy);
            score += Math.max(0, 1 - energyDiff * 2) * 0.3;
        }
        
        return { ...track, patternScore: score };
    });
    
    scored.sort((a, b) => b.patternScore - a.patternScore);
    
    return scored.slice(0, limit).map(t => ({
        ...t,
        similarity: Math.round(t.patternScore * 100),
        reason: 'Based on your listening patterns'
    }));
}

// Helper functions that were in the old code
/**
 * Get time of day profile for context-aware recommendations
 */
function getTimeOfDayProfile() {
    return getCurrentContext();
}

/**
 * Match track mood to time of day
 */
function matchMoodToContext(trackMood, contextMood) {
    const moodMap = {
        'energetic': ['morning', 'afternoon', 'party'],
        'focused': ['afternoon', 'study'],
        'relaxed': ['evening'],
        'introspective': ['night', 'evening'],
        'intense': ['workout', 'party']
    };
    
    const trackMoodLower = trackMood.toLowerCase();
    const allMoods = Object.keys(moodMap);
    
    for (const mood of allMoods) {
        if (trackMoodLower.includes(mood)) {
            return moodMap[mood].includes(contextMood);
        }
    }
    
    return true;
}

/**
 * Get time of day label
 */
function getTimeOfDayLabel() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 18) return 'Afternoon';
    if (hour >= 18 && hour < 22) return 'Evening';
    return 'Night';
}

/**
 * Check if two genres are similar
 */
function areGenresSimilar(genre1, genre2) {
    const g1 = genre1.toLowerCase();
    const g2 = genre2.toLowerCase();
    
    const genreGroups = [
        ['electronic', 'edm', 'house', 'trance', 'techno', 'dance', 'dubstep', 'drum&bass'],
        ['hip hop', 'rap', 'urban', 'r&b', 'hip-hop'],
        ['rock', 'metal', 'alternative', 'indie', 'punk', 'progressive'],
        ['jazz', 'blues', 'funk', 'soul'],
        ['pop', 'vocal', 'indie pop', 'synth-pop'],
        ['ambient', 'chill', 'lofi', 'lo-fi', 'relaxing', 'downtempo'],
        ['classical', 'orchestral', 'instrumental', 'piano'],
        ['folk', 'acoustic', 'singer-songwriter'],
        ['country', 'americana'],
        ['reggae', 'dub', 'dancehall']
    ];
    
    return genreGroups.some(group => {
        const hasG1 = group.some(g => g1.includes(g) || g.includes(g1));
        const hasG2 = group.some(g => g2.includes(g) || g.includes(g2));
        return hasG1 && hasG2;
    });
}

module.exports = { 
    // Main recommendation functions
    getPersonalizedRecommendations,
    getContextAwareRecommendations,
    getDiscoveryRecommendations,
    
    // Playlist generation
    generateSmartPlaylist,
    calculatePlaylistQuality,
    
    // Search
    intelligentSearch,
    
    // Listening patterns
    analyzeUserBehaviorPatterns,
    getPatternBasedRecommendations,
    generateListenerProfile,
    
    // User history management
    updateUserHistory,
    loadUserHistory,
    
    // Core scoring functions
    calculatePreferenceScore,
    calculateContentSimilarity,
    calculateUserSimilarity,
    
    // Diversity and boosting
    applyDiversityBoost,
    applyAdvancedDiversityBoost,
    
    // Genre and mood
    areGenresSimilar,
    matchMoodToContext,
    
    // Confidence and explanations
    calculateRecommendationConfidence,
    calculateAdvancedConfidence,
    generateIntelligentReason,
    generateDetailedExplanation,
    getTopFactors,
    
    // Context and time
    getCurrentContext,
    getTimeOfDayProfile,
    getTimeOfDayLabel,
    getTemporalDecay,
    
    // Constants
    BEHAVIOR_WEIGHTS,
    TEMPORAL_DECAY,
    CONTEXT_PROFILES
};