/**
 * database.js - KORAI Music Player Database Layer
 * 
 * Manages JSON-based persistent storage for:
 * - Tracks library with metadata
 * - Playlists
 * - Play history
 * - Likes/favorites
 * - Application settings
 * 
 * Uses atomic file writes to prevent corruption.
 * Implements write debouncing to prevent I/O blocking.
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

let dbData = null;
let dbPath = null;
let coversDir = null;
let saveDebounceTimer = null;
let isSaving = false;

// Default database structure
const defaultData = {
    tracks: [],
    playlists: [], 
    play_history: [],
    likes: [],
    settings: {
        isFirstLaunch: true
    },
    nextIds: {
        track: 1,
        playlist: 1,
        history: 1,
        like: 1
    }
};

/**
 * Initializes database connection and loads/sets up data
 */
function initDatabase(userDataPath) {
    dbPath = path.join(userDataPath, 'korai_data_v2.json');
    coversDir = path.join(userDataPath, 'covers');
    
    if (!fs.existsSync(coversDir)) {
        fs.mkdirSync(coversDir, { recursive: true });
    }
    
    if (fs.existsSync(dbPath)) {
        try {
            const content = fs.readFileSync(dbPath, 'utf8');
            dbData = JSON.parse(content);
            if (!dbData.playlists) dbData.playlists = [];
            if (!dbData.settings) dbData.settings = { isFirstLaunch: true };
            if (!dbData.nextIds.playlist) dbData.nextIds.playlist = 1;
        } catch (e) {
            dbData = JSON.parse(JSON.stringify(defaultData));
        }
    } else {
        dbData = JSON.parse(JSON.stringify(defaultData));
        saveDatabaseSync();
    }
    return dbData;
}

/**
 * Saves database using atomic write with debouncing
 * Multiple rapid saves are batched into one I/O operation
 */
async function saveDatabaseAsync() {
    if (!dbPath || !dbData) return;
    
    if (isSaving) {
        // Queue up another save attempt if one is already in progress
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => saveDatabaseAsync(), 50);
        return;
    }
    
    isSaving = true;
    const tempPath = dbPath + '.tmp';
    try {
        const jsonContent = JSON.stringify(dbData, null, 2);
        await fsPromises.writeFile(tempPath, jsonContent, 'utf8');
        await fsPromises.rename(tempPath, dbPath);
    } catch (e) {
        console.error(' Async atomic write failed:', e);
    } finally {
        isSaving = false;
    }
}

/**
 * Debounced save - queues saves to batch multiple rapid calls into one
 */
function saveDatabase() {
    clearTimeout(saveDebounceTimer);
    // Batch multiple saves within 100ms into one I/O operation
    saveDebounceTimer = setTimeout(() => {
        saveDatabaseAsync().catch(err => console.error('Save error:', err));
    }, 100);
}

/**
 * Force synchronous save (for initialization only)
 */
function saveDatabaseSync() {
    if (dbPath && dbData) {
        const tempPath = dbPath + '.tmp';
        try {
            fs.writeFileSync(tempPath, JSON.stringify(dbData, null, 2));
            fs.renameSync(tempPath, dbPath);
        } catch (e) {
            console.error(' Atomic write failed, attempting standard write:', e);
            try {
                fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));
            } catch (err) {
                console.error(' Standard write failed as well:', err);
            }
        }
    }
}

/**
 * Returns database API object with all CRUD operations
 */
function getDb() {
    if (!dbData) throw new Error('Database not initialized');
    
    return {
        getAllTracks: () => {
            return [...dbData.tracks].sort((a, b) => b.createdAt - a.createdAt);
        },
        
        getTrackById: (id) => {
            return dbData.tracks.find(t => t.id === id);
        },
        
        addTrack: (track, autoSave = true) => {
            console.debug(' DB.addTrack called for', track.filePath);
            const existing = dbData.tracks.find(t => t.filePath === track.filePath);
            if (existing) {
                console.debug('ℹ️ DB.addTrack: already exists, returning existing track id', existing.id);
                return existing;
            }
            let coverPath = null;
            let coverFilename = null;
            const newId = dbData.nextIds.track++;
            if (track.coverImage && track.coverImage.length > 0) {
                coverFilename = `cover_${newId}_${Date.now()}.jpg`;
                coverPath = path.join(coversDir, coverFilename);
                const coverBuffer = Buffer.isBuffer(track.coverImage) 
                    ? track.coverImage 
                    : Buffer.from(track.coverImage);
                fsPromises.writeFile(coverPath, coverBuffer)
                    .catch(err => console.error('Failed to save cover:', err));
            }
            const newTrack = {
                id: newId,
                title: track.title || 'Unknown Title',
                artist: track.artist || '',
                filePath: track.filePath,
                duration: track.duration || 0,
                bpm: track.bpm || 120,
                energy: track.energy || 0.5,
                loudness: track.loudness || -12,
                genre: track.genre || '',
                album: track.album || '',
                lyrics: track.lyrics || null,
                coverPath: coverPath,
                coverFilename: coverFilename,
                hasCover: !!coverPath,
                playCount: 0,
                likeCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isLiked: false,
                sampleRate: track.sampleRate || 0,
                bitrate: track.bitrate || 0,
                codec: track.codec || ''
            };
            dbData.tracks.push(newTrack);
            console.debug(' DB.addTrack: new track added id=', newTrack.id, 'title=', newTrack.title);
            if (autoSave) {
                saveDatabase();
            }
            return newTrack;
        },

        save: () => {
            saveDatabase();
        },
        
        deleteTrack: (id) => {
            const index = dbData.tracks.findIndex(t => t.id === id);
            if (index !== -1) {
                const deleted = dbData.tracks[index];
                // Delete cover file if exists
                if (deleted.coverPath && fs.existsSync(deleted.coverPath)) {
                    try { fs.unlinkSync(deleted.coverPath); } catch(e){}
                }
                dbData.tracks.splice(index, 1);
                
                // Remove from all playlists
                dbData.playlists.forEach(pl => {
                    pl.tracks = pl.tracks.filter(tid => tid !== id);
                });
                
                dbData.play_history = dbData.play_history.filter(h => h.trackId !== id);
                dbData.likes = dbData.likes.filter(l => l.trackId !== id);
                saveDatabase();
                return true;
            }
            return false;
        },

        getPlaylists: () => {
            return dbData.playlists;
        },

        createPlaylist: (name) => {
            const newPlaylist = {
                id: dbData.nextIds.playlist++,
                name: name || 'New Playlist',
                tracks: [],
                createdAt: Date.now()
            };
            dbData.playlists.push(newPlaylist);
            saveDatabase();
            return newPlaylist;
        },

        deletePlaylist: (id) => {
            const index = dbData.playlists.findIndex(p => p.id === id);
            if (index !== -1) {
                dbData.playlists.splice(index, 1);
                saveDatabase();
                return true;
            }
            return false;
        },

        addTrackToPlaylist: (playlistId, trackId) => {
            const playlist = dbData.playlists.find(p => p.id === playlistId);
            if (playlist && !playlist.tracks.includes(trackId)) {
                playlist.tracks.push(trackId);
                saveDatabase();
                return true;
            }
            return false;
        },

        removeTrackFromPlaylist: (playlistId, trackId) => {
            const playlist = dbData.playlists.find(p => p.id === playlistId);
            if (playlist) {
                playlist.tracks = playlist.tracks.filter(id => id !== trackId);
                saveDatabase();
                return true;
            }
            return false;
        },
        
        addPlayHistory: (trackId) => {
            const history = {
                id: dbData.nextIds.history++,
                trackId: trackId,
                playedAt: Date.now()
            };
            dbData.play_history.push(history);
            const track = dbData.tracks.find(t => t.id === trackId);
            if (track) {
                track.playCount = (track.playCount || 0) + 1;
            }
            // Keep only last 500 history entries
            if (dbData.play_history.length > 500) {
                dbData.play_history = dbData.play_history.slice(-500);
            }
            saveDatabase();
            return history;
        },
        
        likeTrack: (trackId) => {
            const existing = dbData.likes.find(l => l.trackId === trackId);
            if (!existing) {
                const like = {
                    id: dbData.nextIds.like++,
                    trackId: trackId,
                    likedAt: Date.now()
                };
                dbData.likes.push(like);
                const track = dbData.tracks.find(t => t.id === trackId);
                if (track) {
                    track.likeCount = (track.likeCount || 0) + 1;
                    track.isLiked = true;
                }
                saveDatabase();
                return true;
            }
            return false;
        },
        
        unlikeTrack: (trackId) => {
            const index = dbData.likes.findIndex(l => l.trackId === trackId);
            if (index !== -1) {
                dbData.likes.splice(index, 1);
                const track = dbData.tracks.find(t => t.id === trackId);
                if (track && track.likeCount > 0) {
                    track.likeCount -= 1;
                    track.isLiked = false;
                }
                saveDatabase();
                return true;
            }
            return false;
        },
        
        isLiked: (trackId) => {
            return dbData.likes.some(l => l.trackId === trackId);
        },

        getSettings: () => {
            if (!dbData.settings) {
                dbData.settings = { isFirstLaunch: true };
            }
            return dbData.settings;
        },

        updateSettings: (newSettings) => {
            if (!dbData.settings) dbData.settings = {};
            dbData.settings = { ...dbData.settings, ...newSettings };
            saveDatabase();
            return dbData.settings;
        },
        
        getDbSettings: () => {
            return dbData.settings || { isFirstLaunch: true };
        },
        
        getStats: () => {
            const totalPlays = dbData.tracks.reduce((sum, t) => sum + (t.playCount || 0), 0);
            const mostPlayed = [...dbData.tracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0))[0];
            return {
                totalTracks: dbData.tracks.length,
                totalPlayCount: totalPlays,
                totalLikes: dbData.likes.length,
                mostPlayed: mostPlayed ? {
                    title: mostPlayed.title,
                    artist: mostPlayed.artist,
                    playCount: mostPlayed.playCount
                } : null
            };
        }
    };
}

module.exports = { initDatabase, getDb };