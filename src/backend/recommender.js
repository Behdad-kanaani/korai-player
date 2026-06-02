/**
 * recommender.js - AI recommendation that learns from user behavior
 * Tracks plays, likes, skips to personalize recommendations
 */

const { cosineSimilarity, euclideanDistance } = require('./analyzer');

// User behavior weights
const BEHAVIOR_WEIGHTS = {
    like: 0.35,      // Strong positive signal
    play: 0.15,      // Positive signal
    skip: -0.25,     // Strong negative signal
    repeat: 0.20,    // Very strong signal (user came back)
    playlist_add: 0.10
};

/**
 * Calculate user preference score for a track based on history
 */
function calculatePreferenceScore(trackId, userHistory) {
    if (!userHistory || !userHistory[trackId]) return 0;
    
    const history = userHistory[trackId];
    let score = 0;
    
    if (history.likeCount > 0) score += BEHAVIOR_WEIGHTS.like * Math.min(3, history.likeCount);
    if (history.playCount > 0) score += BEHAVIOR_WEIGHTS.play * Math.min(10, history.playCount) / 2;
    if (history.skipCount > 0) score += BEHAVIOR_WEIGHTS.skip * Math.min(5, history.skipCount);
    if (history.repeatCount > 0) score += BEHAVIOR_WEIGHTS.repeat * history.repeatCount;
    if (history.playlistAddCount > 0) score += BEHAVIOR_WEIGHTS.playlist_add * Math.min(5, history.playlistAddCount);
    
    // Recency boost (newer interactions matter more)
    const daysSinceLastPlay = history.lastPlayed ? (Date.now() - history.lastPlayed) / (1000 * 60 * 60 * 24) : 30;
    const recencyBoost = Math.max(0, 1 - (daysSinceLastPlay / 14)) * 0.15;
    
    return Math.min(0.95, Math.max(-0.5, score + recencyBoost));
}

/**
 * Get personalized AI recommendations
 */
function getPersonalizedRecommendations(allTracks, sourceTrack, userHistory, limit = 12) {
    if (!allTracks.length || !sourceTrack) return [];
    
    const otherTracks = allTracks.filter(t => t.id !== sourceTrack.id);
    
    const scored = otherTracks.map(track => {
        // Feature similarity (content-based filtering)
        let featureSimilarity = 0;
        if (sourceTrack.featureVector && track.featureVector) {
            featureSimilarity = cosineSimilarity(sourceTrack.featureVector, track.featureVector);
        } else {
            // Fallback to BPM + energy
            const bpmSim = 1 - Math.abs((sourceTrack.bpm - track.bpm) / 160);
            const energySim = 1 - Math.abs((sourceTrack.energy - track.energy));
            featureSimilarity = (bpmSim * 0.6 + energySim * 0.4);
        }
        
        // User preference score (collaborative filtering)
        const preferenceScore = calculatePreferenceScore(track.id, userHistory);
        
        // Hybrid score: 70% content, 30% collaborative
        let hybridScore = (featureSimilarity * 0.7) + (preferenceScore * 0.3);
        
        // Genre boost
        if (sourceTrack.genre === track.genre) {
            hybridScore = Math.min(0.95, hybridScore + 0.12);
        }
        
        return {
            ...track,
            similarityScore: Math.min(0.98, Math.max(0, hybridScore)),
            featureSimilarity,
            preferenceScore
        };
    });
    
    const valid = scored.filter(t => t.similarityScore > 0.15);
    const sorted = valid.sort((a, b) => b.similarityScore - a.similarityScore);
    
    return sorted.slice(0, limit).map(t => ({
        ...t,
        similarity: Math.round(t.similarityScore * 100),
        reason: getPersonalizedReason(t, t.preferenceScore)
    }));
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
 * Update user history with a new interaction
 */
function updateUserHistory(userHistory, trackId, action, userDataPath) {
    if (!userHistory[trackId]) {
        userHistory[trackId] = {
            playCount: 0,
            likeCount: 0,
            skipCount: 0,
            repeatCount: 0,
            playlistAddCount: 0,
            lastPlayed: null
        };
    }
    
    const history = userHistory[trackId];
    
    switch(action) {
        case 'play':
            history.playCount++;
            history.lastPlayed = Date.now();
            break;
        case 'like':
            history.likeCount++;
            break;
        case 'unlike':
            history.likeCount = Math.max(0, history.likeCount - 1);
            break;
        case 'skip':
            history.skipCount++;
            break;
        case 'repeat':
            history.repeatCount++;
            break;
        case 'playlist_add':
            history.playlistAddCount++;
            break;
    }
    
    // Save to disk
    const fs = require('fs');
    const path = require('path');
    const historyPath = path.join(userDataPath, 'user_history.json');
    fs.writeFileSync(historyPath, JSON.stringify(userHistory, null, 2));
    
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
 * Get "Discover" recommendations - tracks user hasn't heard much
 */
function getDiscoveryRecommendations(allTracks, userHistory, limit = 10) {
    const unheardTracks = allTracks.filter(t => {
        const history = userHistory[t.id];
        return !history || history.playCount === 0;
    });
    
    if (unheardTracks.length === 0) return [];
    
    // Shuffle and return
    for (let i = unheardTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unheardTracks[i], unheardTracks[j]] = [unheardTracks[j], unheardTracks[i]];
    }
    
    return unheardTracks.slice(0, limit).map(t => ({
        ...t,
        similarity: 0,
        reason: 'New discovery for you',
        similarityIcon: '✨'
    }));
}

module.exports = { 
    getPersonalizedRecommendations,
    updateUserHistory,
    loadUserHistory,
    getDiscoveryRecommendations,
    calculatePreferenceScore
};