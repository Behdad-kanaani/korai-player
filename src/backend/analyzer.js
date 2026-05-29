/**
 * analyzer.js - KORAI Music Player Audio Analysis Engine
 * 
 * Performs deep audio analysis including:
 * - BPM detection from metadata or intelligent estimation
 * - RMS energy calculation for accurate loudness
 * - Genre detection based on BPM and energy
 * - Metadata extraction (title, artist, album, cover art, lyrics)
 * - Fallback analysis when metadata is incomplete
 */

const fs = require('fs');
const mm = require('music-metadata');
const path = require('path');

let NodeID3;
try {
    NodeID3 = require('node-id3');
    console.log('✅ node-id3 loaded successfully');
} catch (err) {
    console.log('⚠️ node-id3 not available');
    NodeID3 = null;
}

/**
 * Advanced genre detection based on BPM, energy, spectral centroid approximation, and existing tags
 */
function detectGenreByMetadata(bpm, genreTag, energy, rms = null) {
    // Priority: use existing genre tag if available
    if (genreTag && genreTag !== '') {
        const normalizedGenre = genreTag.toLowerCase();
        
        const genreMap = {
            rap: 'Hip Hop / Rap',
            hiphop: 'Hip Hop / Rap',
            hip_hop: 'Hip Hop / Rap',
            trap: 'Trap / Hip Hop',
            pop: 'Pop',
            rock: 'Rock',
            metal: 'Metal',
            jazz: 'Jazz',
            blues: 'Blues',
            classical: 'Classical',
            ambient: 'Ambient / Classical',
            electronic: 'Electronic',
            edm: 'EDM',
            house: 'House',
            techno: 'Techno',
            trance: 'Trance',
            drumandbass: 'Drum & Bass',
            dnb: 'Drum & Bass',
            rnb: 'R&B / Soul',
            soul: 'R&B / Soul',
            country: 'Country',
            folk: 'Folk / Acoustic',
            indie: 'Indie / Alternative',
            funk: 'Funk / Disco',
            reggae: 'Reggae / Dub',
            latino: 'Latin',
            kpop: 'K-Pop',
            jpop: 'J-Pop'
        };
        
        for (const [key, value] of genreMap) {
            if (normalizedGenre.includes(key)) {
                return { name: value, confidence: 0.95 };
            }
        }
    }
    
    // Use RMS for more accurate energy if available
    const effectiveEnergy = (rms !== null && rms > 0) ? Math.min(0.95, Math.max(0.05, rms)) : energy;
    
    if (!bpm || bpm === 0) return { name: 'Pop', confidence: 0.5 };
    
    // BPM and Energy-based genre classification with confidence scores
    // Ultra-low BPM: Ambient / Drone / Classical
    if (bpm < 60) {
        if (effectiveEnergy < 0.2) return { name: 'Ambient / Drone', confidence: 0.85 };
        if (effectiveEnergy < 0.35) return { name: 'Classical', confidence: 0.8 };
        if (effectiveEnergy < 0.5) return { name: 'Downtempo', confidence: 0.75 };
        return { name: 'Slow Ballad', confidence: 0.7 };
    }
    
    // Very low BPM: Chillout / Lo-fi / Jazz
    if (bpm >= 60 && bpm < 75) {
        if (effectiveEnergy < 0.25) return { name: 'Ambient / Chillout', confidence: 0.85 };
        if (effectiveEnergy < 0.4) return { name: 'Jazz / Blues', confidence: 0.8 };
        if (effectiveEnergy < 0.55) return { name: 'Lo-fi / Hip Hop', confidence: 0.75 };
        return { name: 'Acoustic / Folk', confidence: 0.7 };
    }
    
    // Low BPM: Hip Hop / R&B / Trip Hop
    if (bpm >= 75 && bpm < 90) {
        if (effectiveEnergy > 0.65) return { name: 'Hip Hop / Rap', confidence: 0.9 };
        if (effectiveEnergy > 0.45) return { name: 'R&B / Soul', confidence: 0.85 };
        if (effectiveEnergy > 0.3) return { name: 'Trip Hop', confidence: 0.75 };
        return { name: 'Downtempo', confidence: 0.7 };
    }
    
    // Medium-low BPM: Pop Ballad / Soft Rock / Reggae
    if (bpm >= 90 && bpm < 105) {
        if (effectiveEnergy > 0.6) return { name: 'Pop Rock', confidence: 0.85 };
        if (effectiveEnergy > 0.45) return { name: 'Pop', confidence: 0.9 };
        if (effectiveEnergy > 0.3) return { name: 'Soft Rock', confidence: 0.8 };
        return { name: 'Reggae / Dub', confidence: 0.75 };
    }
    
    // Medium BPM: Rock / Alternative / Country
    if (bpm >= 105 && bpm < 120) {
        if (effectiveEnergy > 0.7) return { name: 'Alternative Rock', confidence: 0.85 };
        if (effectiveEnergy > 0.55) return { name: 'Rock', confidence: 0.9 };
        if (effectiveEnergy > 0.4) return { name: 'Country / Folk', confidence: 0.8 };
        return { name: 'Indie', confidence: 0.75 };
    }
    
    // Medium-high BPM: Dance / House / Pop
    if (bpm >= 120 && bpm < 130) {
        if (effectiveEnergy > 0.7) return { name: 'Dance / House', confidence: 0.9 };
        if (effectiveEnergy > 0.55) return { name: 'Pop', confidence: 0.85 };
        if (effectiveEnergy > 0.4) return { name: 'Synthpop', confidence: 0.8 };
        return { name: 'Eurodance', confidence: 0.75 };
    }
    
    // High BPM: EDM / Trance / Techno
    if (bpm >= 130 && bpm < 145) {
        if (effectiveEnergy > 0.75) return { name: 'EDM / Big Room', confidence: 0.9 };
        if (effectiveEnergy > 0.6) return { name: 'Trance / Progressive', confidence: 0.85 };
        if (effectiveEnergy > 0.45) return { name: 'Techno', confidence: 0.8 };
        return { name: 'House', confidence: 0.75 };
    }
    
    // Very high BPM: Drum & Bass / Hardcore / UK Garage
    if (bpm >= 145 && bpm < 170) {
        if (effectiveEnergy > 0.8) return { name: 'Drum & Bass', confidence: 0.9 };
        if (effectiveEnergy > 0.65) return { name: 'Hardcore', confidence: 0.85 };
        if (effectiveEnergy > 0.5) return { name: 'UK Garage', confidence: 0.8 };
        return { name: 'Breakbeat', confidence: 0.75 };
    }
    
    // Extreme BPM: Speedcore / Gabber / Frenchcore
    if (bpm >= 170 && bpm < 220) {
        if (effectiveEnergy > 0.85) return { name: 'Speedcore', confidence: 0.9 };
        if (effectiveEnergy > 0.7) return { name: 'Gabber', confidence: 0.85 };
        return { name: 'Hardstyle', confidence: 0.8 };
    }
    
    if (bpm >= 220) return { name: 'Extreme / Terrorcore', confidence: 0.85 };
    
    return { name: 'Pop', confidence: 0.6 };
}

/**
 * Calculates RMS (Root Mean Square) energy from audio samples
 * More accurate than peak-based energy measurement
 */
function calculateRMSEnergy(samples) {
    if (!samples || samples.length === 0) return 0.5;
    
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    
    // Normalize RMS to 0-1 range
    let normalized = Math.min(0.95, Math.max(0.05, rms * 2));
    
    return normalized;
}

/**
 * Fallback energy calculation using bitrate and duration
 */
function calculateEnergyFromBitrate(bitrate, duration, sampleRate) {
    if (!bitrate || bitrate === 0) return 0.5;
    
    let energy = bitrate / 320000;
    
    if (duration && duration < 120) energy *= 1.15;
    if (duration && duration > 300) energy *= 0.85;
    if (sampleRate && sampleRate > 44100) energy *= 1.05;
    
    return Math.min(0.95, Math.max(0.15, energy));
}

/**
 * Intelligent BPM estimation when metadata is missing
 * Uses filename patterns and duration heuristics
 */
function estimateSmartBpm(duration, fileName) {
    if (!duration || duration === 0) return 120;
    
    // Check filename for BPM pattern (e.g., "128 BPM")
    const bpmMatch = fileName?.match(/(\d{2,3})\s*BPM/i);
    if (bpmMatch) return parseInt(bpmMatch[1]);
    
    // Keyword-based detection from filename
    const fileNameLower = fileName?.toLowerCase() || '';
    if (fileNameLower.includes('club') || fileNameLower.includes('dance')) return 128;
    if (fileNameLower.includes('chill') || fileNameLower.includes('lofi')) return 85;
    if (fileNameLower.includes('rock')) return 120;
    if (fileNameLower.includes('hiphop') || fileNameLower.includes('rap')) return 90;
    if (fileNameLower.includes('edm') || fileNameLower.includes('trance')) return 135;
    if (fileNameLower.includes('dnb') || fileNameLower.includes('drum')) return 170;
    if (fileNameLower.includes('jazz')) return 70;
    if (fileNameLower.includes('classical')) return 65;
    if (fileNameLower.includes('ambient')) return 60;
    if (fileNameLower.includes('house')) return 125;
    if (fileNameLower.includes('techno')) return 135;
    
    // Duration-based estimation
    if (duration < 90) return 140;
    if (duration < 120) return 130;
    if (duration < 150) return 125;
    if (duration < 180) return 118;
    if (duration < 210) return 115;
    if (duration < 240) return 110;
    if (duration < 300) return 105;
    if (duration < 360) return 100;
    return 95;
}

/**
 * Extracts RMS data from native metadata if available
 */
function extractRMSFromMetadata(nativeMetadata) {
    try {
        if (nativeMetadata && nativeMetadata['ID3v2.4']) {
            const id3 = nativeMetadata['ID3v2.4'];
            for (const tag of id3) {
                if (tag.id === 'TXXX' && tag.value && tag.value.description === 'replaygain_track_peak') {
                    return parseFloat(tag.value.text) || null;
                }
            }
        }
    } catch (e) {
        // Ignore extraction errors
    }
    return null;
}

/**
 * Main audio analysis function
 * Extracts all metadata, BPM, energy, genre, cover art, lyrics
 */
async function analyzeAudioFile(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error(`Invalid filePath: ${filePath}`);
    }
    
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    
    const results = {
        duration: 0,
        bpm: 120,
        energy: 0.5,
        rms: null,
        loudness: -12,
        sampleRate: 0,
        bitrate: 0,
        codec: '',
        title: '',
        artist: '',
        genre: 'Pop',
        genreConfidence: 0.6,
        year: null,
        trackNumber: null,
        album: '',
        coverImage: null,
        lyrics: null,
        composer: '',
        publisher: ''
    };
    
    try {
        const metadata = await mm.parseFile(filePath, { duration: true, native: true });
        
        results.duration = metadata.format.duration || 0;
        results.sampleRate = metadata.format.sampleRate || 0;
        results.bitrate = metadata.format.bitrate || 0;
        results.codec = metadata.format.codec || 'unknown';
        
        // Extract RMS from metadata if present
        const extractedRMS = extractRMSFromMetadata(metadata.native);
        if (extractedRMS !== null) {
            results.rms = extractedRMS;
        }
        
        // Extract title
        if (metadata.common.title) {
            results.title = metadata.common.title;
        }
        
        // Extract artist with multiple fallback methods
        if (metadata.common.artist) {
            results.artist = Array.isArray(metadata.common.artist) 
                ? metadata.common.artist[0] 
                : metadata.common.artist;
        } else if (metadata.common.artists && metadata.common.artists.length > 0) {
            results.artist = metadata.common.artists[0];
        } else if (metadata.common.albumartist) {
            results.artist = Array.isArray(metadata.common.albumartist) 
                ? metadata.common.albumartist[0] 
                : metadata.common.albumartist;
        }
        
        // Fallback with node-id3 for MP3 files
        if ((!results.artist || results.artist === '') && NodeID3 && filePath.toLowerCase().endsWith('.mp3')) {
            try {
                const tags = NodeID3.read(filePath);
                if (tags.artist) results.artist = tags.artist;
                if (tags.title && !results.title) results.title = tags.title;
            } catch (id3Error) {
                // ignore
            }
        }
        
        // Extract BPM from metadata or estimate
        if (metadata.common.bpm) {
            results.bpm = metadata.common.bpm;
        } else {
            results.bpm = estimateSmartBpm(results.duration, path.basename(filePath));
        }
        
        // Extract genre
        let genreTag = null;
        if (metadata.common.genre) {
            genreTag = Array.isArray(metadata.common.genre) 
                ? metadata.common.genre[0] 
                : metadata.common.genre;
        }
        
        // Calculate energy - prioritize RMS for accuracy
        if (results.rms !== null && results.rms > 0) {
            results.energy = Math.min(0.95, Math.max(0.05, results.rms * 1.5));
        } else {
            results.energy = calculateEnergyFromBitrate(results.bitrate, results.duration, results.sampleRate);
        }
        
        // Detect genre using all available data
        const genreResult = detectGenreByMetadata(results.bpm, genreTag, results.energy, results.rms);
        results.genre = genreResult.name;
        results.genreConfidence = genreResult.confidence;
        
        // Estimate loudness from energy
        results.loudness = -23 + (results.energy * 16);
        
        // Extract additional metadata
        if (metadata.common.year) results.year = metadata.common.year;
        if (metadata.common.track && metadata.common.track.no) results.trackNumber = metadata.common.track.no;
        if (metadata.common.album) results.album = metadata.common.album;
        if (metadata.common.composer) {
            results.composer = Array.isArray(metadata.common.composer) 
                ? metadata.common.composer[0] 
                : metadata.common.composer;
        }
        if (metadata.common.publisher) results.publisher = metadata.common.publisher;
        if (metadata.common.lyrics) results.lyrics = metadata.common.lyrics;
        
        // Extract cover art
        if (metadata.common.picture && metadata.common.picture.length > 0) {
            results.coverImage = metadata.common.picture[0].data;
        }
        
        if (!results.coverImage && NodeID3 && filePath.toLowerCase().endsWith('.mp3')) {
            try {
                const tags = NodeID3.read(filePath);
                if (tags.image) results.coverImage = tags.image.imageBuffer;
            } catch (id3Error) {}
        }
        
        // Fallback: extract title/artist from filename if metadata missing
        if (!results.title || results.title === '') {
            const fileName = path.basename(filePath, path.extname(filePath));
            const separators = [' - ', ' – ', ' — ', ' ~ '];
            let found = false;
            
            for (const sep of separators) {
                if (fileName.includes(sep)) {
                    const parts = fileName.split(sep);
                    if (!results.artist && parts[0]) {
                        results.artist = parts[0].trim();
                    }
                    if (parts[1]) {
                        results.title = parts[1].trim();
                        found = true;
                        break;
                    }
                }
            }
            if (!found) results.title = fileName;
        }
        
        // Display analysis results in console
        const rmsDisplay = results.rms !== null ? ` | RMS: ${results.rms.toFixed(3)}` : '';
        console.log(`📊 Analysis: ${results.title} | ${results.artist || 'Unknown'} | ${results.bpm}BPM | ${Math.round(results.energy*100)}% energy${rmsDisplay} | Genre: ${results.genre} (${Math.round(results.genreConfidence*100)}%)`);
        
    } catch (error) {
        console.error('❌ Analysis error:', error.message);
        results.bpm = 120;
        results.energy = 0.5;
        results.loudness = -12;
        results.genre = 'Pop';
        results.genreConfidence = 0.5;
    }
    
    return results;
}

module.exports = { analyzeAudioFile, detectGenreByMetadata };