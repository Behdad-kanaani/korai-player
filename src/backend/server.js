/**
 * server.js - KORAI Music Player Backend API
 * 
 * Express server providing REST API endpoints for:
 * - Track management (CRUD operations)
 * - Playlist management
 * - Audio streaming with range support
 * - File import (local files, downloads)
 * - Recommendations and statistics
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
const { getRecommendations, createSimilarPlaylist, detectGenre } = require('./recommender');

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
            
            // Follow redirects
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
            
            // Determine content type based on file extension
            const ext = path.extname(track.filePath).toLowerCase();
            let contentType = 'audio/mpeg';
            if (ext === '.wav') contentType = 'audio/wav';
            else if (ext === '.ogg') contentType = 'audio/ogg';
            else if (ext === '.m4a') contentType = 'audio/mp4';
            else if (ext === '.flac') contentType = 'audio/flac';
            
            // Handle range requests for seeking
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
                // Full file request
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
                        album: analysis.album,
                        coverImage: analysis.coverImage,
                        lyrics: analysis.lyrics,
                        sampleRate: analysis.sampleRate,
                        bitrate: analysis.bitrate,
                        codec: analysis.codec
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

    // AI Recommendation endpoints
    app.get('/api/recommend/:trackId/detailed', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.trackId));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const allTracks = db.getAllTracks();
            const recommendations = getRecommendations(allTracks, track, 8);
            
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
                recommendations: safeRecs
            });
        } catch (error) {
            console.error('Recommendation error:', error);
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
                basedOnGenre: playlistData.genre
            });
            
        } catch (error) {
            console.error('Create playlist error:', error);
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