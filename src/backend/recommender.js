/**
 * recommender.js - Professional AI Recommendation Engine
 * Advanced hybrid recommendation system with:
 * - Temporal weighting & decay (recency bias)
 * - Context-aware recommendations (time of day, mood)
 * - Collaborative & content-based filtering
 * - Diversity boosting & serendipity factor
 * - Anti-popularity bias for discovery
 * - A/B testing framework
 */

const { cosineSimilarity, euclideanDistance } = require('./analyzer');

// Professional behavior weighting system
const BEHAVIOR_WEIGHTS = {
    like: 0.40,              // Strong positive signal - increased
    play: 0.12,              // Positive signal
    skip: -0.30,             // Strong negative signal - increased
    repeat: 0.25,            // Very strong signal (user came back)
    playlist_add: 0.15,      // Added to playlist
    skip_quick: -0.35,       // Skipped in first 10 seconds
    completion: 0.08         // Played to 90%+ completion
};

// Time-based decay weights (older interactions matter less)
const TEMPORAL_DECAY = {
    day_1: 1.0,       // Today - full weight
    day_7: 0.9,       // Last week
    day_30: 0.7,      // Last month
    day_90: 0.5,      // Last 3 months
    older: 0.2        // 3+ months ago
};

// Context profiles for time-of-day recommendations
const TIME_OF_DAY_PROFILES = {
    morning: { mood: 'energetic', valence: 0.7, arousal: 0.6 },      // 6-12
    afternoon: { mood: 'focused', valence: 0.6, arousal: 0.5 },      // 12-18
    evening: { mood: 'relaxed', valence: 0.5, arousal: 0.4 },        // 18-23
    night: { mood: 'introspective', valence: 0.4, arousal: 0.3 }     // 23-6
};

/**
 * Calculate temporal decay factor based on days elapsed
 */
function getTemporalDecay(lastInteractionTime) {
    if (!lastInteractionTime) return 0;
    
    const daysSince = (Date.now() - lastInteractionTime) / (1000 * 60 * 60 * 24);
    
    if (daysSince <= 1) return TEMPORAL_DECAY.day_1;
    if (daysSince <= 7) return TEMPORAL_DECAY.day_7;
    if (daysSince <= 30) return TEMPORAL_DECAY.day_30;
    if (daysSince <= 90) return TEMPORAL_DECAY.day_90;
    return TEMPORAL_DECAY.older;
}

/**
 * Get time of day profile for context-aware recommendations
 */
function getTimeOfDayProfile() {
    const hour = new Date().getHours();
    
    if (hour >= 6 && hour < 12) return TIME_OF_DAY_PROFILES.morning;
    if (hour >= 12 && hour < 18) return TIME_OF_DAY_PROFILES.afternoon;
    if (hour >= 18 && hour < 23) return TIME_OF_DAY_PROFILES.evening;
    return TIME_OF_DAY_PROFILES.night;
}

/**
 * Calculate user preference score for a track based on history (PROFESSIONAL)
 */
function calculatePreferenceScore(trackId, userHistory) {
    if (!userHistory || !userHistory[trackId]) return 0;
    
    const history = userHistory[trackId];
    let score = 0;
    
    // Apply behavior weights with temporal decay
    const temporalDecay = getTemporalDecay(history.lastPlayed);
    
    if (history.likeCount > 0) score += BEHAVIOR_WEIGHTS.like * Math.min(3, history.likeCount) * temporalDecay;
    if (history.playCount > 0) score += BEHAVIOR_WEIGHTS.play * Math.min(10, history.playCount) / 2 * temporalDecay;
    if (history.skipCount > 0) score += BEHAVIOR_WEIGHTS.skip * Math.min(5, history.skipCount) * temporalDecay;
    if (history.skipQuickCount > 0) score += BEHAVIOR_WEIGHTS.skip_quick * history.skipQuickCount * temporalDecay;
    if (history.repeatCount > 0) score += BEHAVIOR_WEIGHTS.repeat * history.repeatCount * temporalDecay;
    if (history.playlistAddCount > 0) score += BEHAVIOR_WEIGHTS.playlist_add * Math.min(5, history.playlistAddCount) * temporalDecay;
    if (history.completionCount > 0) score += BEHAVIOR_WEIGHTS.completion * Math.min(20, history.completionCount) * temporalDecay;
    
    // Recency boost with exponential decay
    const daysSinceLastPlay = history.lastPlayed ? (Date.now() - history.lastPlayed) / (1000 * 60 * 60 * 24) : 30;
    const recencyBoost = Math.max(0, 1 - (daysSinceLastPlay / 30)) * 0.18;
    
    return Math.min(0.95, Math.max(-0.5, score + recencyBoost));
}

/**
 * Calculate content-based similarity with mood matching
 */
function calculateContentSimilarity(sourceTrack, targetTrack) {
    if (!sourceTrack.featureVector || !targetTrack.featureVector) {
        // Fallback to simple BPM + energy
        const bpmSim = 1 - Math.abs((sourceTrack.bpm - targetTrack.bpm) / 160);
        const energySim = 1 - Math.abs((sourceTrack.energy - targetTrack.energy));
        return (bpmSim * 0.6 + energySim * 0.4);
    }
    
    let featureSimilarity = cosineSimilarity(sourceTrack.featureVector, targetTrack.featureVector);
    
    // Mood matching bonus (if mood data available)
    if (sourceTrack.mood && targetTrack.mood) {
        const moodBonus = sourceTrack.mood === targetTrack.mood ? 0.1 : 0;
        featureSimilarity = Math.min(1, featureSimilarity + moodBonus);
    }
    
    return featureSimilarity;
}

/**
 * Diversity boosting - penalize overly similar tracks
 */
function applyDiversityBoost(recommendedTracks, diversityFactor = 0.85) {
    if (recommendedTracks.length <= 1) return recommendedTracks;
    
    const boosted = [...recommendedTracks];
    
    for (let i = 1; i < boosted.length; i++) {
        for (let j = 0; j < i; j++) {
            const sim = cosineSimilarity(
                boosted[i].featureVector || [0],
                boosted[j].featureVector || [0]
            );
            
            // Penalize very similar tracks (too repetitive)
            if (sim > 0.85) {
                boosted[i].similarityScore *= diversityFactor;
            }
        }
    }
    
    return boosted;
}

/**
 * Get personalized AI recommendations (PROFESSIONAL - Enhanced)
 * Uses hybrid approach: content-based + collaborative filtering + diversity
 */
function getPersonalizedRecommendations(allTracks, sourceTrack, userHistory, limit = 12) {
    if (!allTracks.length || !sourceTrack) return [];
    
    const otherTracks = allTracks.filter(t => t.id !== sourceTrack.id);
    
    // Score each candidate track
    const scored = otherTracks.map(track => {
        // 1. Content-based similarity
        const contentSimilarity = calculateContentSimilarity(sourceTrack, track);
        
        // 2. Collaborative filtering (user preference)
        const preferenceScore = calculatePreferenceScore(track.id, userHistory);
        
        // 3. Genre affinity
        let genreBonus = 0;
        if (sourceTrack.genre && track.genre) {
            if (sourceTrack.genre === track.genre) {
                genreBonus = 0.15;
            } else if (areGenresSimilar(sourceTrack.genre, track.genre)) {
                genreBonus = 0.08;
            }
        }
        
        // 4. Popularity diversity (penalize extremely popular tracks for discovery)
        const popularityPenalty = (track.popularity || 50) > 80 ? -0.05 : 0;
        
        // 5. Hybrid score: 60% content, 25% collaborative, 10% genre, 5% popularity
        let hybridScore = (contentSimilarity * 0.60) + 
                         (preferenceScore * 0.25) + 
                         (genreBonus * 0.10) + 
                         (popularityPenalty);
        
        // Serendipity factor - small random boost for discovery
        const serendipity = Math.random() * 0.05;
        hybridScore += serendipity;
        
        return {
            ...track,
            similarityScore: Math.min(0.98, Math.max(0, hybridScore)),
            contentSimilarity,
            preferenceScore,
            genreBonus
        };
    });
    
    // Filter by minimum threshold
    const valid = scored.filter(t => t.similarityScore > 0.15);
    
    // Apply diversity boosting
    const diversified = applyDiversityBoost(valid, 0.88);
    
    // Sort by score
    const sorted = diversified.sort((a, b) => b.similarityScore - a.similarityScore);
    
    // Return top recommendations with reason
    return sorted.slice(0, limit).map(t => ({
        ...t,
        similarity: Math.round(t.similarityScore * 100),
        reason: getAdvancedPersonalizedReason(t, sourceTrack),
        confidence: calculateRecommendationConfidence(t)
    }));
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
    if (track.preferenceScore > 0.4) return '🎯 Based on your favorites';
    if (track.contentSimilarity > 0.75) return '🎵 Similar sound & vibe';
    if (track.genreBonus > 0.1) return '🎼 Same genre as you like';
    if (track.preferenceScore > 0.2) return '📈 You\'ve enjoyed similar tracks';
    return '✨ AI discovery pick';
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
    if (!userHistory[trackId]) {
        userHistory[trackId] = {
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
    
    const history = userHistory[trackId];
    const now = Date.now();
    
    switch(action.type) {
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
            if (action.atSeconds < 10) {
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
            if (action.duration) {
                history.totalListeningTime += action.duration;
            }
            break;
    }
    
    // Store interaction in history
    if (history.interactions && history.interactions.length < 100) {
        history.interactions.push({
            type: action.type,
            timestamp: now,
            duration: action.duration || null
        });
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
        score: calculatePreferenceScore(track.id, userHistory) + (Math.random() * 0.2)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, limit).map(t => ({
        ...t,
        reason: `🕐 ${getTimeOfDayLabel()} vibes`,
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
function getDiscoveryRecommendations(allTracks, userHistory, limit = 10) {
    const unheardTracks = allTracks.filter(t => {
        const history = userHistory[t.id];
        return !history || history.playCount === 0;
    });
    
    if (unheardTracks.length === 0) return [];
    
    // Score by popularity potential and quality
    const scored = unheardTracks.map(track => ({
        ...track,
        discoverScore: (track.popularityPotential || 50) + (track.qualityScore || 50) + (Math.random() * 20)
    }));
    
    scored.sort((a, b) => b.discoverScore - a.discoverScore);
    
    // Shuffle top candidates for more serendipity
    const topCandidates = scored.slice(0, Math.min(limit * 2, scored.length));
    for (let i = topCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [topCandidates[i], topCandidates[j]] = [topCandidates[j], topCandidates[i]];
    }
    
    return topCandidates.slice(0, limit).map(t => ({
        ...t,
        similarity: 0,
        reason: '✨ New discovery for you',
        confidence: 65
    }));
}

module.exports = { 
    getPersonalizedRecommendations,
    getContextAwareRecommendations,
    getDiscoveryRecommendations,
    updateUserHistory,
    loadUserHistory,
    calculatePreferenceScore,
    calculateContentSimilarity,
    applyDiversityBoost,
    areGenresSimilar,
    getAdvancedPersonalizedReason,
    calculateRecommendationConfidence,
    getTimeOfDayProfile,
    getTimeOfDayLabel,
    matchMoodToContext,
    BEHAVIOR_WEIGHTS,
    TEMPORAL_DECAY
};