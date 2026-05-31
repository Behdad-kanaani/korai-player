/**
 * server.js - KORAI Music Player Backend API
 * 
 * Express server providing REST API endpoints for:
 * - Track management (CRUD operations)
 * - Playlist management
 * - Audio streaming with range support
 * - File import (local files, downloads)
 * - Recommendations and statistics
 * - Tag editing
 * - Playlist export/import
 * - Advanced search
 * - CUE sheet support
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { initDatabase, getDb } = require('./database');
const { analyzeAudioFile } = require('./analyzer');
const { getRecommendations, getDiverseRecommendations, getHybridRecommendations, createSimilarPlaylist, detectGenre, calculateSimilarityScore } = require('./recommender');
const { detectRealBPM } = require('./bpmDetector');
const { exportToM3U, exportToPLS, exportLibraryToCSV, exportPlaylistToCSV, importFromM3U, importFromPLS } = require('./playlistExporter');
const { getTracksFromCue, generateCueSheet } = require('./cueParser');
const { advancedSearchFilter } = require('../frontend/advancedSearch');

const app = express();
let serverUserDataPath = null;

// CORS and middleware setup
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Downloads a file from URL with redirect following support
 */
function downloadFile(fileUrl, destPath, redirectCount = 0) {
    if (redirectCount > 5) {
        return Promise.reject(new Error('Too many redirects'));
    }
    return new Promise((resolve, reject) => {
        const urlObj = new URL(fileUrl);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        client.get(fileUrl, (response) => {
            const statusCode = response.statusCode;
            
            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                const redirectUrl = new URL(response.headers.location, fileUrl).href;
                return downloadFile(redirectUrl, destPath, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
            }
            
            if (statusCode !== 200) {
                return reject(new Error(`Server responded with status code: ${statusCode}`));
            }
            
            const fileStream = fs.createWriteStream(destPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });
            fileStream.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Sets up all API routes
 */
function setupRoutes() {
    // Settings endpoints
    app.get('/api/settings', (req, res) => {
        try {
            const db = getDb();
            res.json(db.getSettings());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/settings', (req, res) => {
        try {
            const db = getDb();
            const updated = db.updateSettings(req.body);
            res.json(updated);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Track endpoints
    app.get('/api/tracks', (req, res) => {
        try {
            const db = getDb();
            const tracks = db.getAllTracks().map(track => ({
                ...track,
                filePath: undefined,
                coverPath: undefined,
                coverUrl: track.hasCover ? `/api/tracks/${track.id}/cover` : null
            }));
            res.json(tracks);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Cover image endpoint
    app.get('/api/tracks/:id/cover', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            if (!track || !track.hasCover || !track.coverPath || !fs.existsSync(track.coverPath)) {
                return res.status(404).json({ error: 'Cover not found' });
            }
            res.sendFile(track.coverPath);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Audio streaming with range support (seeking)
    app.get('/api/tracks/:id/stream', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            
            if (!track || !track.filePath || !fs.existsSync(track.filePath)) {
                return res.status(404).json({ error: 'File not found' });
            }
            
            const stat = fs.statSync(track.filePath);
            const fileSize = stat.size;
            const range = req.headers.range;
            
            const ext = path.extname(track.filePath).toLowerCase();
            let contentType = 'audio/mpeg';
            if (ext === '.wav') contentType = 'audio/wav';
            else if (ext === '.ogg') contentType = 'audio/ogg';
            else if (ext === '.m4a') contentType = 'audio/mp4';
            else if (ext === '.flac') contentType = 'audio/flac';
            
            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(track.filePath, { start, end });
                
                file.on('error', (streamErr) => {
                    console.error('Streaming error:', streamErr);
                    if (!res.headersSent) res.status(500).end();
                });
                
                const head = {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': contentType,
                };
                res.writeHead(206, head);
                file.pipe(res);
            } else {
                const head = {
                    'Content-Length': fileSize,
                    'Content-Type': contentType,
                    'Accept-Ranges': 'bytes',
                };
                res.writeHead(200, head);
                const file = fs.createReadStream(track.filePath);
                file.on('error', (streamErr) => {
                    console.error('Streaming error:', streamErr);
                    if (!res.headersSent) res.status(500).end();
                });
                file.pipe(res);
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Import local audio files
    app.post('/api/tracks/import', async (req, res) => {
        try {
            const { filePaths } = req.body;
            if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
                return res.status(400).json({ error: 'No file paths provided' });
            }
            
            const db = getDb();
            let imported = 0;
            
            for (const filePath of filePaths) {
                try {
                    if (!fs.existsSync(filePath)) continue;
                    
                    const analysis = await analyzeAudioFile(filePath);
                    const ext = path.extname(filePath);
                    
                    db.addTrack({
                        title: analysis.title || path.basename(filePath, ext),
                        artist: analysis.artist || '',
                        filePath: filePath,
                        duration: analysis.duration,
                        bpm: analysis.bpm,
                        energy: analysis.energy,
                        loudness: analysis.loudness,
                        genre: analysis.genre,
                        genreConfidence: analysis.genreConfidence,
                        album: analysis.album,
                        coverImage: analysis.coverImage,
                        lyrics: analysis.lyrics,
                        sampleRate: analysis.sampleRate,
                        bitrate: analysis.bitrate,
                        codec: analysis.codec,
                        composer: analysis.composer,
                        year: analysis.year,
                        trackNumber: analysis.trackNumber
                    }, false);
                    imported++;
                } catch (err) {
                    console.error(`Failed to analyze: ${filePath}`, err);
                }
            }
            
            db.save();
            res.json({ success: true, imported, total: filePaths.length });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Download track from URL
    app.post('/api/tracks/download', async (req, res) => {
        try {
            const { url } = req.body;
            if (!url) {
                return res.status(400).json({ error: 'URL is required' });
            }

            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return res.status(400).json({ error: 'Invalid URL protocol' });
            }
            
            const downloadsDir = path.join(serverUserDataPath, 'downloads');
            if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
            
            const tempFileName = `download_${Date.now()}.mp3`;
            const tempFilePath = path.join(downloadsDir, tempFileName);
            
            await downloadFile(url, tempFilePath);
            
            const analysis = await analyzeAudioFile(tempFilePath);
            
            const db = getDb();
            const newTrack = db.addTrack({
                title: analysis.title || path.basename(tempFileName, '.mp3'),
                artist: analysis.artist || '',
                filePath: tempFilePath,
                duration: analysis.duration,
                bpm: analysis.bpm,
                energy: analysis.energy,
                loudness: analysis.loudness,
                genre: analysis.genre,
                genreConfidence: analysis.genreConfidence,
                album: analysis.album,
                coverImage: analysis.coverImage,
                lyrics: analysis.lyrics,
                sampleRate: analysis.sampleRate,
                bitrate: analysis.bitrate,
                codec: analysis.codec
            });
            
            res.json({ success: true, track: newTrack });
        } catch (error) {
            console.error('Download error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Playlist endpoints
    app.get('/api/playlists', (req, res) => {
        try {
            const db = getDb();
            res.json(db.getPlaylists());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/playlists', (req, res) => {
        try {
            const db = getDb();
            const { name } = req.body;
            const newPl = db.createPlaylist(name);
            res.json(newPl);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/playlists/:id', (req, res) => {
        try {
            const db = getDb();
            const deleted = db.deletePlaylist(parseInt(req.params.id));
            res.json({ success: deleted });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/playlists/:id/tracks', (req, res) => {
        try {
            const db = getDb();
            const { trackId } = req.body;
            const added = db.addTrackToPlaylist(parseInt(req.params.id), parseInt(trackId));
            res.json({ success: added });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/playlists/:id/tracks/:trackId', (req, res) => {
        try {
            const db = getDb();
            const removed = db.removeTrackFromPlaylist(parseInt(req.params.id), parseInt(req.params.trackId));
            res.json({ success: removed });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Delete track
    app.delete('/api/tracks/:id', async (req, res) => {
        try {
            const db = getDb();
            const deleted = db.deleteTrack(parseInt(req.params.id));
            res.json({ success: deleted });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Track playback tracking
    app.post('/api/tracks/:id/play', (req, res) => {
        try {
            const db = getDb();
            db.addPlayHistory(parseInt(req.params.id));
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Like/Unlike endpoints
    app.post('/api/tracks/:id/like', (req, res) => {
        try {
            const db = getDb();
            const liked = db.likeTrack(parseInt(req.params.id));
            res.json({ success: true, isLiked: liked });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/api/tracks/:id/like', (req, res) => {
        try {
            const db = getDb();
            const unliked = db.unlikeTrack(parseInt(req.params.id));
            res.json({ success: true, isLiked: !unliked });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/tracks/:id/liked', (req, res) => {
        try {
            const db = getDb();
            const liked = db.isLiked(parseInt(req.params.id));
            res.json({ liked });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // AI Recommendation endpoints - Enhanced versions
    app.get('/api/recommend/:trackId', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.trackId));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const allTracks = db.getAllTracks();
            const recommendations = getRecommendations(allTracks, track, 10);
            
            const safeRecs = recommendations.map(r => ({
                id: r.id,
                title: r.title,
                artist: r.artist,
                duration: r.duration,
                bpm: r.bpm,
                energy: r.energy,
                similarity: r.similarity,
                reason: r.reason,
                similarityIcon: r.similarityIcon,
                detectedGenre: r.detectedGenre,
                genreIcon: r.genreIcon,
                genreColor: r.genreColor,
                hasCover: r.hasCover,
                coverUrl: r.hasCover ? `/api/tracks/${r.id}/cover` : null
            }));
            
            res.json({ recommendations: safeRecs });
        } catch (error) {
            console.error('Recommendation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Detailed recommendations with source analysis
    app.get('/api/recommend/:trackId/detailed', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.trackId));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const allTracks = db.getAllTracks();
            const recommendations = getRecommendations(allTracks, track, 12);
            
            const safeRecs = recommendations.map(r => ({
                id: r.id,
                title: r.title,
                artist: r.artist,
                duration: r.duration,
                bpm: r.bpm,
                energy: r.energy,
                similarity: r.similarity,
                reason: r.reason,
                similarityIcon: r.similarityIcon,
                detectedGenre: r.detectedGenre,
                genreIcon: r.genreIcon,
                genreColor: r.genreColor,
                hasCover: r.hasCover,
                coverUrl: r.hasCover ? `/api/tracks/${r.id}/cover` : null,
                similarityBreakdown: r.similarityBreakdown
            }));
            
            const sourceGenre = detectGenre(track);
            
            res.json({
                sourceTrack: {
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    genre: sourceGenre.name,
                    genreIcon: sourceGenre.icon,
                    bpm: track.bpm,
                    energy: track.energy
                },
                recommendations: safeRecs,
                recommendationCount: safeRecs.length
            });
        } catch (error) {
            console.error('Recommendation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Diverse recommendations endpoint
    app.get('/api/recommend/:trackId/diverse', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.trackId));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const allTracks = db.getAllTracks();
            const recommendations = getDiverseRecommendations(allTracks, track, 15);
            
            const safeRecs = recommendations.map(r => ({
                id: r.id,
                title: r.title,
                artist: r.artist,
                duration: r.duration,
                bpm: r.bpm,
                energy: r.energy,
                similarity: r.similarity,
                reason: r.reason,
                similarityIcon: r.similarityIcon,
                detectedGenre: r.detectedGenre,
                genreIcon: r.genreIcon,
                genreColor: r.genreColor,
                hasCover: r.hasCover,
                coverUrl: r.hasCover ? `/api/tracks/${r.id}/cover` : null
            }));
            
            res.json({ recommendations: safeRecs });
        } catch (error) {
            console.error('Diverse recommendation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Create similar playlist from track
    app.post('/api/playlists/similar', async (req, res) => {
        try {
            const db = getDb();
            const { trackId, customName } = req.body;
            
            if (!trackId) {
                return res.status(400).json({ error: 'Track ID required' });
            }
            
            const track = db.getTrackById(parseInt(trackId));
            if (!track) {
                return res.status(404).json({ error: 'Track not found' });
            }
            
            const allTracks = db.getAllTracks();
            const playlistData = createSimilarPlaylist(allTracks, track, customName);
            
            if (!playlistData || playlistData.tracks.length === 0) {
                return res.status(404).json({ error: 'No similar tracks found' });
            }
            
            const newPlaylist = db.createPlaylist(playlistData.name);
            
            for (const tid of playlistData.tracks) {
                db.addTrackToPlaylist(newPlaylist.id, tid);
            }
            
            res.json({
                success: true,
                playlist: newPlaylist,
                trackCount: playlistData.tracks.length,
                basedOnGenre: playlistData.genre,
                avgSimilarity: playlistData.avgSimilarity
            });
            
        } catch (error) {
            console.error('Create playlist error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Calculate similarity between two tracks
    app.get('/api/similarity/:trackId1/:trackId2', (req, res) => {
        try {
            const db = getDb();
            const track1 = db.getTrackById(parseInt(req.params.trackId1));
            const track2 = db.getTrackById(parseInt(req.params.trackId2));
            
            if (!track1 || !track2) {
                return res.status(404).json({ error: 'One or both tracks not found' });
            }
            
            const similarity = calculateSimilarityScore(track1, track2);
            const genre1 = detectGenre(track1);
            const genre2 = detectGenre(track2);
            
            res.json({
                track1: { id: track1.id, title: track1.title, artist: track1.artist, genre: genre1.name },
                track2: { id: track2.id, title: track2.title, artist: track2.artist, genre: genre2.name },
                similarityScore: similarity.score,
                breakdown: {
                    bpm: similarity.bpmScore,
                    energy: similarity.energyScore,
                    genre: similarity.genreScore,
                    popularity: similarity.popularityBonus
                },
                reason: similarity.reason
            });
        } catch (error) {
            console.error('Similarity calculation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Statistics endpoint
    app.get('/api/stats', (req, res) => {
        try {
            const db = getDb();
            res.json(db.getStats());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ===================== NEW ENDPOINTS =====================

    // Edit track tags (metadata)
    app.put('/api/tracks/:id/tags', async (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            
            if (!track) {
                return res.status(404).json({ error: 'Track not found' });
            }
            
            const { title, artist, album, genre, year, trackNumber, composer, lyrics } = req.body;
            
            if (title !== undefined) track.title = title;
            if (artist !== undefined) track.artist = artist;
            if (album !== undefined) track.album = album;
            if (genre !== undefined) track.genre = genre;
            if (year !== undefined) track.year = year;
            if (trackNumber !== undefined) track.trackNumber = trackNumber;
            if (composer !== undefined) track.composer = composer;
            if (lyrics !== undefined) track.lyrics = lyrics;
            
            // Update physical file tags
            const NodeID3 = require('node-id3');
            
            if (track.filePath && fs.existsSync(track.filePath) && track.filePath.toLowerCase().endsWith('.mp3')) {
                try {
                    const tags = {};
                    if (title) tags.title = title;
                    if (artist) tags.artist = artist;
                    if (album) tags.album = album;
                    if (genre) tags.genre = genre;
                    if (year) tags.year = year;
                    if (trackNumber) tags.trackNumber = trackNumber;
                    if (composer) tags.composer = composer;
                    if (lyrics) tags.unsynchronisedLyrics = lyrics;
                    
                    if (Object.keys(tags).length > 0) {
                        NodeID3.update(tags, track.filePath);
                    }
                } catch (tagErr) {
                    console.log('Could not update physical file tags:', tagErr.message);
                }
            }
            
            db.save();
            res.json({ success: true, track });
            
        } catch (error) {
            console.error('Tag update error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Export playlist endpoint
    app.post('/api/playlists/:id/export', async (req, res) => {
        try {
            const db = getDb();
            const playlist = db.getPlaylists().find(p => p.id === parseInt(req.params.id));
            
            if (!playlist) {
                return res.status(404).json({ error: 'Playlist not found' });
            }
            
            const { format, outputPath } = req.body;
            const allTracks = db.getAllTracks();
            
            let resultPath;
            switch (format) {
                case 'm3u':
                    resultPath = exportToM3U(playlist, allTracks, outputPath || `${playlist.name}.m3u`);
                    break;
                case 'm3u8':
                    resultPath = exportToM3U(playlist, allTracks, outputPath || `${playlist.name}.m3u8`, true);
                    break;
                case 'pls':
                    resultPath = exportToPLS(playlist, allTracks, outputPath || `${playlist.name}.pls`);
                    break;
                case 'csv':
                    resultPath = exportPlaylistToCSV(playlist, allTracks, outputPath || `${playlist.name}.csv`);
                    break;
                default:
                    return res.status(400).json({ error: 'Invalid format' });
            }
            
            res.json({ success: true, path: resultPath });
            
        } catch (error) {
            console.error('Export error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Import playlist endpoint
    app.post('/api/playlists/import', async (req, res) => {
        try {
            const db = getDb();
            const { filePath, format } = req.body;
            
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'File not found' });
            }
            
            let importedTracks;
            if (format === 'm3u' || format === 'm3u8') {
                importedTracks = await importFromM3U(filePath, path.dirname(filePath));
            } else if (format === 'pls') {
                importedTracks = importFromPLS(filePath);
            } else {
                return res.status(400).json({ error: 'Invalid format' });
            }
            
            const playlistName = path.basename(filePath, path.extname(filePath));
            const newPlaylist = db.createPlaylist(playlistName);
            
            let importedCount = 0;
            for (const imported of importedTracks) {
                let existing = db.getAllTracks().find(t => t.filePath === imported.filePath);
                
                if (!existing) {
                    const { analyzeAudioFile } = require('./analyzer');
                    const analysis = await analyzeAudioFile(imported.filePath);
                    
                    existing = db.addTrack({
                        title: imported.title || analysis.title,
                        artist: analysis.artist,
                        filePath: imported.filePath,
                        duration: analysis.duration,
                        bpm: analysis.bpm,
                        energy: analysis.energy,
                        genre: analysis.genre,
                        album: analysis.album,
                        coverImage: analysis.coverImage
                    }, false);
                }
                
                if (existing) {
                    db.addTrackToPlaylist(newPlaylist.id, existing.id);
                    importedCount++;
                }
            }
            
            db.save();
            res.json({ success: true, playlist: newPlaylist, importedCount });
            
        } catch (error) {
            console.error('Import error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Export library to CSV
    app.post('/api/library/export', async (req, res) => {
        try {
            const db = getDb();
            const tracks = db.getAllTracks();
            const outputPath = req.body.outputPath || `korai_library_${Date.now()}.csv`;
            
            const resultPath = exportLibraryToCSV(tracks, outputPath);
            res.json({ success: true, path: resultPath });
            
        } catch (error) {
            console.error('Library export error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Advanced search endpoint
    app.post('/api/search/advanced', (req, res) => {
        try {
            const db = getDb();
            const { query } = req.body;
            
            const tracks = db.getAllTracks();
            const results = advancedSearchFilter(tracks, query);
            
            res.json({
                query,
                count: results.length,
                results: results.map(t => ({
                    id: t.id,
                    title: t.title,
                    artist: t.artist,
                    album: t.album,
                    duration: t.duration,
                    bpm: t.bpm,
                    energy: t.energy,
                    genre: t.genre,
                    year: t.year,
                    playCount: t.playCount,
                    likeCount: t.likeCount,
                    coverUrl: t.hasCover ? `/api/tracks/${t.id}/cover` : null
                }))
            });
            
        } catch (error) {
            console.error('Search error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // CUE sheet parse endpoint
    app.post('/api/cue/parse', async (req, res) => {
        try {
            const { cuePath, audioBaseDir } = req.body;
            
            if (!fs.existsSync(cuePath)) {
                return res.status(404).json({ error: 'CUE file not found' });
            }
            
            const tracks = getTracksFromCue(cuePath, audioBaseDir);
            res.json({ success: true, tracks });
            
        } catch (error) {
            console.error('CUE parse error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // CUE sheet generate endpoint
    app.post('/api/cue/generate', async (req, res) => {
        try {
            const db = getDb();
            const { playlistId, outputPath } = req.body;
            const playlist = db.getPlaylists().find(p => p.id === playlistId);
            
            if (!playlist) {
                return res.status(404).json({ error: 'Playlist not found' });
            }
            
            const tracks = db.getAllTracks();
            const resultPath = generateCueSheet(playlist, tracks, outputPath || `${playlist.name}.cue`);
            res.json({ success: true, path: resultPath });
            
        } catch (error) {
            console.error('CUE generate error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Gapless playback settings
    let gaplessEnabled = true;
    let crossfadeDuration = 0;

    app.get('/api/playback/settings', (req, res) => {
        res.json({ gaplessEnabled, crossfadeDuration });
    });

    app.post('/api/playback/settings', (req, res) => {
        const { gapless, crossfade } = req.body;
        if (gapless !== undefined) gaplessEnabled = gapless;
        if (crossfade !== undefined) crossfadeDuration = Math.min(12, Math.max(0, crossfade));
        res.json({ gaplessEnabled, crossfadeDuration });
    });

    // Real BPM detection endpoint
    app.post('/api/tracks/:id/detect-bpm', async (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            
            if (!track || !track.filePath) {
                return res.status(404).json({ error: 'Track not found' });
            }
            
            const realBpm = await detectRealBPM(track.filePath);
            
            // Update track with real BPM
            track.bpm = realBpm;
            db.save();
            
            res.json({ success: true, bpm: realBpm });
            
        } catch (error) {
            console.error('BPM detection error:', error);
            res.status(500).json({ error: error.message });
        }
    });
}

/**
 * Starts the HTTP server on specified port
 */
async function startServer(port, userDataPath) {
    serverUserDataPath = userDataPath;
    initDatabase(userDataPath);
    setupRoutes();
    return new Promise((resolve) => {
        const server = app.listen(port, '127.0.0.1', () => {
            console.log(`🚀 Server on port http://127.0.0.1:${port}`);
            resolve(server);
        });
    });
}

module.exports = { startServer };