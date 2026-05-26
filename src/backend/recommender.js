// recommender.js - تشخیص ژانر حرفه‌ای و پیشنهاددهنده هوشمند

function detectGenre(track) {
    const bpm = track.bpm || 120;
    const energy = track.energy || 0.5;
    const genreTag = track.genre || '';
    
    // اولویت با تگ ژانر موجود
    if (genreTag && genreTag !== '') {
        const normalized = genreTag.toLowerCase();
        
        const genreMap = [
            { keywords: ['rap', 'hiphop', 'hip hop', 'trap'], name: 'Hip Hop / Rap', icon: 'fa-microphone', color: '#ff6b6b', description: 'ضربی و ریتمیک' },
            { keywords: ['pop', 'indie', 'alternative'], name: 'Pop / Indie', icon: 'fa-headphones', color: '#1db954', description: 'پرطرفدار و شاد' },
            { keywords: ['rock', 'metal', 'punk', 'hardcore'], name: 'Rock / Metal', icon: 'fa-guitar', color: '#ff8800', description: 'سنگین و پرقدرت' },
            { keywords: ['jazz', 'blues', 'soul', 'rnb', 'r&b'], name: 'Jazz / Blues / R&B', icon: 'fa-saxophone', color: '#4a90e2', description: 'ملایم و احساسی' },
            { keywords: ['electronic', 'edm', 'house', 'techno', 'trance'], name: 'Electronic / EDM', icon: 'fa-bolt', color: '#e040fb', description: 'الکترونیک و پرانرژی' },
            { keywords: ['dance', 'disco', 'funk'], name: 'Dance / Funk', icon: 'fa-drum', color: '#f5a623', description: 'رقصی و شاد' },
            { keywords: ['classical', 'orchestra', 'ambient', 'cinematic'], name: 'Classical / Ambient', icon: 'fa-music', color: '#a0a0b0', description: 'ارکسترال و محیطی' },
            { keywords: ['country', 'folk', 'acoustic'], name: 'Country / Folk', icon: 'fa-guitar', color: '#d4a373', description: 'آکوستیک و صمیمی' }
        ];
        
        for (const genre of genreMap) {
            if (genre.keywords.some(kw => normalized.includes(kw))) {
                return genre;
            }
        }
    }
    
    // تشخیص بر اساس BPM و انرژی (دقت بالا)
    
    // Ambient / Classical
    if (bpm < 70 && energy < 0.35) {
        return { name: 'Ambient / Classical', icon: 'fa-music', color: '#a0a0b0', description: 'ارکسترال و محیطی' };
    }
    
    // Jazz / Blues
    if (bpm < 85 && energy < 0.5) {
        return { name: 'Jazz / Blues', icon: 'fa-saxophone', color: '#4a90e2', description: 'ملایم و روح‌نواز' };
    }
    
    // Hip Hop / Rap
    if (bpm >= 70 && bpm < 100 && energy >= 0.4 && energy < 0.75) {
        return { name: 'Hip Hop / Rap', icon: 'fa-microphone', color: '#ff6b6b', description: 'ضربی و ریتمیک' };
    }
    
    // R&B / Soul
    if (bpm >= 70 && bpm < 95 && energy < 0.6) {
        return { name: 'R&B / Soul', icon: 'fa-heart', color: '#e84393', description: 'احساسی و ملایم' };
    }
    
    // Pop
    if (bpm >= 95 && bpm < 120 && energy >= 0.5) {
        return { name: 'Pop', icon: 'fa-headphones', color: '#1db954', description: 'عامه‌پسند و شاد' };
    }
    
    // Rock / Alternative
    if (bpm >= 100 && bpm < 140 && energy >= 0.6) {
        return { name: 'Rock / Alternative', icon: 'fa-guitar', color: '#ff8800', description: 'پرقدرت و پرانرژی' };
    }
    
    // Dance / House
    if (bpm >= 115 && bpm < 128 && energy >= 0.55) {
        return { name: 'Dance / House', icon: 'fa-drum', color: '#f5a623', description: 'رقصی و شاد' };
    }
    
    // EDM / Trance
    if (bpm >= 128 && bpm < 142 && energy >= 0.6) {
        return { name: 'EDM / Trance', icon: 'fa-bolt', color: '#e040fb', description: 'الکترونیک و خلسه‌ای' };
    }
    
    // Drum & Bass
    if (bpm >= 150 && energy >= 0.7) {
        return { name: 'Drum & Bass', icon: 'fa-fire', color: '#ff4444', description: 'سریع و شدید' };
    }
    
    // Metal
    if (bpm >= 140 && bpm < 200 && energy >= 0.75) {
        return { name: 'Metal', icon: 'fa-skull', color: '#aa0000', description: 'خشن و پرقدرت' };
    }
    
    // Default
    return { name: 'Pop / Electronic', icon: 'fa-headphones', color: '#1db954', description: 'عامه‌پسند' };
}

function getRecommendations(allTracks, sourceTrack, limit = 10) {
    if (!allTracks || allTracks.length === 0) return [];
    
    const otherTracks = allTracks.filter(t => t.id !== sourceTrack.id);
    if (otherTracks.length === 0) return [];
    
    const sourceGenre = detectGenre(sourceTrack);
    
    const scored = otherTracks.map(track => {
        const trackGenre = detectGenre(track);
        
        // محاسبه فاصله چندبعدی
        const bpmDiff = Math.abs((track.bpm || 120) - (sourceTrack.bpm || 120));
        const energyDiff = Math.abs((track.energy || 0.5) - (sourceTrack.energy || 0.5));
        
        // امتیاز ژانر (وزن بالا)
        let genreBonus = 0;
        let reason = '';
        let similarityIcon = '🎵';
        
        if (trackGenre.name === sourceGenre.name) {
            genreBonus = 40;
            reason = `${trackGenre.name} (سبک یکسان)`;
            similarityIcon = '🎯';
        } else if (bpmDiff < 10) {
            genreBonus = 25;
            reason = 'BPM بسیار نزدیک';
            similarityIcon = '⚡';
        } else if (energyDiff < 0.1) {
            genreBonus = 20;
            reason = 'انرژی صوتی مشابه';
            similarityIcon = '🔊';
        } else if (bpmDiff < 20) {
            genreBonus = 15;
            reason = 'ریتم نزدیک';
            similarityIcon = '🎧';
        } else {
            reason = 'توصیه هوشمند';
            similarityIcon = '🤖';
        }
        
        // امتیاز BPM (هرچه نزدیک‌تر بهتر)
        let bpmScore = 0;
        if (bpmDiff === 0) bpmScore = 30;
        else if (bpmDiff < 5) bpmScore = 25;
        else if (bpmDiff < 10) bpmScore = 20;
        else if (bpmDiff < 15) bpmScore = 15;
        else if (bpmDiff < 25) bpmScore = 10;
        else if (bpmDiff < 35) bpmScore = 5;
        
        // امتیاز انرژی
        let energyScore = 0;
        if (energyDiff === 0) energyScore = 20;
        else if (energyDiff < 0.05) energyScore = 18;
        else if (energyDiff < 0.1) energyScore = 15;
        else if (energyDiff < 0.15) energyScore = 12;
        else if (energyDiff < 0.25) energyScore = 8;
        else if (energyDiff < 0.4) energyScore = 4;
        
        // امتیاز محبوبیت (کم权重)
        const popularityBoost = Math.min(10, ((track.playCount || 0) * 0.1 + (track.likeCount || 0) * 1.5));
        
        // امتیاز نهایی
        let similarity = Math.min(98, genreBonus + bpmScore + energyScore + popularityBoost);
        
        if (similarity < 15) return null;
        
        return {
            ...track,
            similarity: Math.round(similarity),
            reason: reason,
            similarityIcon: similarityIcon,
            detectedGenre: trackGenre.name,
            genreIcon: trackGenre.icon,
            genreColor: trackGenre.color,
            genreDescription: trackGenre.description
        };
    });
    
    const validScores = scored.filter(s => s !== null);
    const sorted = validScores.sort((a, b) => b.similarity - a.similarity);
    
    return sorted.slice(0, Math.max(limit, Math.min(limit, sorted.length)));
}

function createSimilarPlaylist(allTracks, sourceTrack, playlistName = null) {
    const recommendations = getRecommendations(allTracks, sourceTrack, 25);
    
    if (!recommendations || recommendations.length === 0) return null;
    
    const genre = detectGenre(sourceTrack);
    const trackTitle = sourceTrack.title || 'Track';
    const artistName = sourceTrack.artist || 'Unknown';
    
    const nameOptions = [
        `🎵 Similar to: ${trackTitle}`,
        `${genre.name} Vibes — Inspired by ${artistName}`,
        `🎧 ${genre.name} Radio · ${artistName}`,
        `✨ ${genre.name} Essentials — Like ${artistName}`
    ];
    
    const defaultName = playlistName || nameOptions[Math.floor(Math.random() * nameOptions.length)];
    
    return {
        name: defaultName,
        tracks: recommendations.map(t => t.id),
        basedOnTrack: sourceTrack.id,
        basedOnTrackTitle: trackTitle,
        genre: genre.name,
        genreIcon: genre.icon,
        genreColor: genre.color,
        createdAt: Date.now(),
        trackCount: recommendations.length
    };
}

module.exports = { 
    getRecommendations, 
    createSimilarPlaylist, 
    detectGenre
};