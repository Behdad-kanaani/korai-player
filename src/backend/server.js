/**
 * server.js - KORAI Music Player Backend API with AI & Enhanced Plugin System
 * 
 * Complete Express server with AI recommendation endpoints, plugin management,
 * and comprehensive hook system for unlimited plugin capabilities.
 * 
 * FIXES APPLIED:
 * - Added adm-zip dependency for plugin installation
 * - Fixed plugin installation endpoint with proper error handling
 * - Added serverUserDataPath validation
 * - Added directory creation with permission handling
 * - Integrated plugin hooks across all major operations
 * - Added event bus support for inter-plugin communication
 * - Added plugin API route registration
 * - Preserved ALL existing functionality
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { initDatabase, getDb } = require('./database');
const { analyzeAudioFile, cosineSimilarity } = require('./analyzer');
const { 
    getPersonalizedRecommendations, 
    updateUserHistory, 
    loadUserHistory, 
    getDiscoveryRecommendations 
} = require('./recommender');
const { detectRealBPM } = require('./bpmDetector');
const { exportToM3U, exportToPLS, exportLibraryToCSV, exportPlaylistToCSV, 
        importFromM3U, importFromPLS, importFromXSPF, importFromASX, 
        importFromWPL, importFromJSON } = require('./playlistExporter');
const { getTracksFromCue, generateCueSheet } = require('./cueParser');
const { advancedSearchFilter } = require('../frontend/advancedSearch');
const AudioSeparator = require('./audioSeparator');
const os = require('os');

const app = express();
let serverUserDataPath = null;
let userHistory = {};

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Download a file from URL with redirect handling
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
 * Ensure a directory exists, create it if necessary
 */
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        try {
            fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
            console.log(`📁 Created directory: ${dirPath}`);
            return true;
        } catch (err) {
            console.error(`❌ Failed to create directory ${dirPath}:`, err.message);
            return false;
        }
    }
    return true;
}

/**
 * Run plugin hook with payload (async)
 */
async function runPluginHook(hookName, payload) {
    if (global.pluginManager) {
        return await global.pluginManager.runHook(hookName, payload);
    }
    return payload;
}

/**
 * Run plugin hook with cancel capability
 */
async function runPluginHookWithCancel(hookName, payload) {
    if (global.pluginManager) {
        return await global.pluginManager.runHookWithCancel(hookName, payload);
    }
    return { cancelled: false, payload };
}

/**
 * Emit event to plugins
 */
async function emitPluginEvent(eventName, payload, sourcePluginId = null) {
    if (global.pluginManager) {
        await global.pluginManager.emitEvent(eventName, payload, sourcePluginId);
    }
}

// =============================================================================
// ROUTE SETUP
// =============================================================================

function setupRoutes() {
    // ========== SETTINGS ROUTES ==========
    app.get('/api/settings', async (req, res) => {
        try {
            const db = getDb();
            let settings = db.getSettings();
            // Run hook
            settings = await runPluginHook('settings:beforeLoad', settings);
            res.json(settings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/settings', async (req, res) => {
        try {
            let settings = req.body;
            // Run hook before save
            settings = await runPluginHook('settings:beforeSave', settings);
            const db = getDb();
            const updated = db.updateSettings(settings);
            // Emit event
            await emitPluginEvent('settings:changed', updated);
            res.json(updated);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/settings/export', (req, res) => {
        try {
            const db = getDb();
            const exportData = {
                version: 1,
                exportedAt: Date.now(),
                settings: db.getSettings(),
                eqPresets: req.app.locals.eqPresets || {},
                playlists: db.getPlaylists(),
                likedTracks: db.getAllTracks().filter(t => t.isLiked).map(t => t.id)
            };
            res.json(exportData);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/settings/import', (req, res) => {
        try {
            const { settings, eqPresets, playlists, likedTracks } = req.body;
            const db = getDb();
            if (settings) db.updateSettings(settings);
            if (eqPresets) req.app.locals.eqPresets = eqPresets;
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ========== HEALTH CHECK ==========
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: Date.now() });
    });

    // ========== TRACKS ROUTES ==========
    app.get('/api/tracks', async (req, res) => {
        try {
            const db = getDb();
            let tracks = db.getAllTracks().map(track => ({
                ...track,
                filePath: undefined,
                coverPath: undefined,
                coverUrl: track.hasCover ? `/api/tracks/${track.id}/cover` : null
            }));
            // Run hook
            tracks = await runPluginHook('library:getTracks', tracks);
            res.json(tracks);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

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

    app.get('/api/tracks/:id/stream', async (req, res) => {
        try {
            const db = getDb();
            let track = db.getTrackById(parseInt(req.params.id));
            if (!track || !track.filePath || !fs.existsSync(track.filePath)) {
                return res.status(404).json({ error: 'File not found' });
            }
            
            // Run hook before stream
            const hookResult = await runPluginHookWithCancel('playback:beforeStream', { track, request: req.headers });
            if (hookResult.cancelled) {
                return res.status(403).json({ error: 'Stream blocked by plugin' });
            }
            track = hookResult.payload.track || track;
            
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

    app.post('/api/tracks/import', async (req, res) => {
        try {
            let { filePaths } = req.body;
            if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
                return res.status(400).json({ error: 'No file paths provided' });
            }
            
            // Run hook before import
            const hookResult = await runPluginHookWithCancel('library:beforeImport', { filePaths });
            if (hookResult.cancelled) {
                return res.status(403).json({ error: 'Import blocked by plugin' });
            }
            filePaths = hookResult.payload.filePaths;
            
            const db = getDb();
            let imported = 0;
            const importedTracks = [];
            
            for (const filePath of filePaths) {
                try {
                    if (!fs.existsSync(filePath)) continue;
                    
                    const analysis = await analyzeAudioFile(filePath);
                    
                    // Allow plugin to modify analysis
                    let modifiedAnalysis = await runPluginHook('library:beforeAddTrack', { analysis, filePath });
                    if (modifiedAnalysis && modifiedAnalysis.analysis) {
                        analysis = modifiedAnalysis.analysis;
                    }
                    
                    const newTrack = db.addTrack({
                        title: analysis.title || path.basename(filePath, path.extname(filePath)),
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
                        featureVector: analysis.featureVector,
                        rawFeatures: analysis.rawFeatures
                    }, false);
                    imported++;
                    importedTracks.push(newTrack);
                } catch (err) {
                    console.error(`Failed to analyze: ${filePath}`, err);
                }
            }
            
            db.save();
            
            // Emit event after import
            await emitPluginEvent('library:afterImport', { imported, total: filePaths.length, tracks: importedTracks });
            
            res.json({ success: true, imported, total: filePaths.length });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/tracks/download', async (req, res) => {
        try {
            let { url } = req.body;
            if (!url) return res.status(400).json({ error: 'URL is required' });
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return res.status(400).json({ error: 'Invalid URL protocol' });
            }
            
            // Run hook before download
            const hookResult = await runPluginHookWithCancel('http:downloadStart', { url });
            if (hookResult.cancelled) {
                return res.status(403).json({ error: 'Download blocked by plugin' });
            }
            url = hookResult.payload.url;
            
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
                featureVector: analysis.featureVector
            });
            
            res.json({ success: true, track: newTrack });
        } catch (error) {
            console.error('Download error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== PLAYLIST ROUTES ==========
    app.get('/api/playlists', (req, res) => {
        try {
            const db = getDb();
            res.json(db.getPlaylists());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/playlists', async (req, res) => {
        try {
            let { name } = req.body;
            // Hook before create
            const hookResult = await runPluginHookWithCancel('playlist:beforeCreate', { name });
            if (hookResult.cancelled) {
                return res.status(403).json({ error: 'Playlist creation blocked by plugin' });
            }
            name = hookResult.payload.name;
            
            const db = getDb();
            const newPl = db.createPlaylist(name);
            await emitPluginEvent('playlist:afterCreate', { playlist: newPl });
            res.json(newPl);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/playlists/:id', async (req, res) => {
        try {
            const db = getDb();
            const playlist = db.getPlaylists().find(p => p.id === parseInt(req.params.id));
            if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
            
            const hookResult = await runPluginHookWithCancel('playlist:beforeDelete', { playlist });
            if (hookResult.cancelled) {
                return res.status(403).json({ error: 'Playlist deletion blocked by plugin' });
            }
            
            const deleted = db.deletePlaylist(parseInt(req.params.id));
            if (deleted) {
                await emitPluginEvent('playlist:afterDelete', { playlistId: parseInt(req.params.id) });
            }
            res.json({ success: deleted });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/playlists/:id/tracks', async (req, res) => {
        try {
            const db = getDb();
            const playlistId = parseInt(req.params.id);
            const { trackId } = req.body;
            const playlist = db.getPlaylists().find(p => p.id === playlistId);
            const track = db.getTrackById(trackId);
            
            const hookResult = await runPluginHookWithCancel('playlist:addTrack', { playlist, track });
            if (hookResult.cancelled) {
                return res.status(403).json({ error: 'Add track blocked by plugin' });
            }
            
            const added = db.addTrackToPlaylist(playlistId, parseInt(trackId));
            if (added) {
                await emitPluginEvent('playlist:trackAdded', { playlistId, trackId });
            }
            res.json({ success: added });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/api/playlists/:id/tracks/:trackId', async (req, res) => {
        try {
            const db = getDb();
            const playlistId = parseInt(req.params.id);
            const trackId = parseInt(req.params.trackId);
            
            const removed = db.removeTrackFromPlaylist(playlistId, trackId);
            if (removed) {
                await emitPluginEvent('playlist:trackRemoved', { playlistId, trackId });
            }
            res.json({ success: removed });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ========== TRACK MANAGEMENT ==========
    app.delete('/api/tracks/:id', async (req, res) => {
        try {
            const db = getDb();
            const trackId = parseInt(req.params.id);
            const track = db.getTrackById(trackId);
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const hookResult = await runPluginHookWithCancel('library:beforeDelete', { track });
            if (hookResult.cancelled) {
                return res.status(403).json({ error: 'Track deletion blocked by plugin' });
            }
            
            const deleted = db.deleteTrack(trackId);
            if (deleted) {
                await emitPluginEvent('library:afterDelete', { trackId, track });
            }
            res.json({ success: deleted });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/tracks/:id/play', async (req, res) => {
        try {
            const db = getDb();
            const trackId = parseInt(req.params.id);
            db.addPlayHistory(trackId);
            if (serverUserDataPath) {
                updateUserHistory(userHistory, trackId, 'play', serverUserDataPath);
            }
            await emitPluginEvent('playback:trackPlayed', { trackId });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/tracks/:id/like', async (req, res) => {
        try {
            const db = getDb();
            const trackId = parseInt(req.params.id);
            const liked = db.likeTrack(trackId);
            if (serverUserDataPath && liked) {
                updateUserHistory(userHistory, trackId, 'like', serverUserDataPath);
            }
            await emitPluginEvent('library:trackLiked', { trackId, liked: true });
            res.json({ success: true, isLiked: liked });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/api/tracks/:id/like', async (req, res) => {
        try {
            const db = getDb();
            const trackId = parseInt(req.params.id);
            const unliked = db.unlikeTrack(trackId);
            if (serverUserDataPath && unliked) {
                updateUserHistory(userHistory, trackId, 'unlike', serverUserDataPath);
            }
            await emitPluginEvent('library:trackUnliked', { trackId });
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

    // ========== VOCAL EXTRACTION ==========
    app.post('/api/tracks/:id/extract-vocal', async (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            if (!track || !track.filePath) {
                return res.status(404).json({ error: 'Track not found or file missing' });
            }

            if (!fs.existsSync(track.filePath)) {
                return res.status(404).json({ error: 'Audio file does not exist on disk' });
            }

            const { mode = 'vocal' } = req.body;
            if (mode !== 'vocal') {
                return res.status(400).json({ error: 'Only "vocal" mode is supported' });
            }

            const extractedDir = path.join(serverUserDataPath, 'extracted_vocals');
            if (!fs.existsSync(extractedDir)) fs.mkdirSync(extractedDir, { recursive: true });

            const ext = path.extname(track.filePath);
            const baseName = path.basename(track.filePath, ext);
            const outputFileName = `${baseName}_vocals_${Date.now()}.wav`;
            const outputFilePath = path.join(extractedDir, outputFileName);

            console.log(`🎤 Extracting vocals from: ${track.filePath}`);
            await AudioSeparator.extractVocal(track.filePath, outputFilePath);

            let analysis;
            try {
                analysis = await analyzeAudioFile(outputFilePath);
            } catch (analysisErr) {
                console.warn('⚠️ Audio analysis failed for extracted file, using fallback metadata:', analysisErr.message);
                analysis = {
                    duration: 0,
                    bpm: 120,
                    energy: 0.5,
                    loudness: -12,
                    sampleRate: 22050,
                    bitrate: 0,
                    codec: 'wav',
                    genre: track.genre || 'Extracted Vocal',
                    title: `${track.title} (Vocals)`,
                    artist: track.artist,
                    album: track.album,
                    featureVector: null,
                    rawFeatures: null,
                    coverImage: null
                };
            }

            let coverImage = null;
            if (track.coverPath && fs.existsSync(track.coverPath)) {
                try {
                    coverImage = fs.readFileSync(track.coverPath);
                } catch (err) {
                    console.warn('Could not read cover image:', err.message);
                }
            }

            const newTrack = db.addTrack({
                title: `${track.title} (Vocals)`,
                artist: track.artist,
                filePath: outputFilePath,
                duration: analysis.duration,
                bpm: analysis.bpm,
                energy: analysis.energy,
                loudness: analysis.loudness,
                genre: analysis.genre,
                album: track.album,
                coverImage: coverImage,
                lyrics: track.lyrics,
                sampleRate: analysis.sampleRate,
                bitrate: analysis.bitrate,
                codec: analysis.codec,
                featureVector: analysis.featureVector,
                rawFeatures: analysis.rawFeatures
            });

            console.log(`✅ Extracted vocal track added: ${newTrack.title} (ID: ${newTrack.id})`);
            res.json({ success: true, track: newTrack });
        } catch (error) {
            console.error('Vocal extraction error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== AI & RECOMMENDATION ROUTES ==========
    app.get('/api/ai/history', (req, res) => {
        try {
            res.json(userHistory);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/ai/interaction', async (req, res) => {
        try {
            const { trackId, action } = req.body;
            const updated = updateUserHistory(userHistory, trackId, action, serverUserDataPath);
            await emitPluginEvent('recommendations:train', { trackId, action, userHistory: updated });
            res.json({ success: true, history: updated });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/ai/recommend/personal/:trackId', async (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.trackId));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const allTracks = db.getAllTracks();
            let recommendations = getPersonalizedRecommendations(allTracks, track, userHistory, 12);
            
            // Run plugin hook
            let modified = await runPluginHook('recommendations:modify', {
                sourceTrack: track,
                recommendations: recommendations
            });
            if (modified && modified.recommendations) {
                recommendations = modified.recommendations;
            }
            
            const safeRecs = recommendations.map(r => ({
                id: r.id,
                title: r.title,
                artist: r.artist,
                duration: r.duration,
                bpm: r.bpm,
                energy: r.energy,
                similarity: r.similarity,
                reason: r.reason,
                similarityIcon: r.similarityIcon || '🎵',
                genre: r.genre,
                hasCover: r.hasCover,
                coverUrl: r.hasCover ? `/api/tracks/${r.id}/cover` : null
            }));
            
            res.json({ 
                recommendations: safeRecs, 
                sourceTrack: { id: track.id, title: track.title, artist: track.artist } 
            });
        } catch (error) {
            console.error('AI recommendation error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/ai/discover', (req, res) => {
        try {
            const db = getDb();
            const allTracks = db.getAllTracks();
            const discoveries = getDiscoveryRecommendations(allTracks, userHistory, 15);
            
            const safeDisc = discoveries.map(d => ({
                id: d.id,
                title: d.title,
                artist: d.artist,
                duration: d.duration,
                bpm: d.bpm,
                genre: d.genre,
                hasCover: d.hasCover,
                coverUrl: d.hasCover ? `/api/tracks/${d.id}/cover` : null
            }));
            
            res.json({ recommendations: safeDisc });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/recommend/:trackId', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.trackId));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const allTracks = db.getAllTracks();
            const recommendations = getPersonalizedRecommendations(allTracks, track, userHistory, 10);
            
            const safeRecs = recommendations.map(r => ({
                id: r.id,
                title: r.title,
                artist: r.artist,
                duration: r.duration,
                bpm: r.bpm,
                energy: r.energy,
                similarity: r.similarity,
                reason: r.reason,
                hasCover: r.hasCover,
                coverUrl: r.hasCover ? `/api/tracks/${r.id}/cover` : null
            }));
            
            res.json({ recommendations: safeRecs });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/playlists/similar', async (req, res) => {
        try {
            const db = getDb();
            const { trackId } = req.body;
            
            const sourceTrack = db.getTrackById(parseInt(trackId));
            if (!sourceTrack) {
                return res.status(404).json({ error: 'Track not found' });
            }
            
            const allTracks = db.getAllTracks();
            const otherTracks = allTracks.filter(t => t.id !== sourceTrack.id);
            
            if (otherTracks.length === 0) {
                return res.json({ success: false, message: 'No other tracks in library' });
            }
            
            const scored = otherTracks.map(track => {
                let similarity = 0;
                if (sourceTrack.featureVector && track.featureVector) {
                    similarity = cosineSimilarity(sourceTrack.featureVector, track.featureVector);
                } else {
                    const bpmSim = 1 - Math.abs((sourceTrack.bpm - track.bpm) / 160);
                    const energySim = 1 - Math.abs((sourceTrack.energy - track.energy));
                    similarity = (bpmSim * 0.6) + (energySim * 0.4);
                }
                if (sourceTrack.genre && track.genre && sourceTrack.genre === track.genre && similarity > 0) {
                    similarity = Math.min(0.95, similarity + 0.12);
                }
                return { track, similarity };
            });
            
            const similarTracks = scored
                .filter(item => item.similarity > 0.2)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, 30)
                .map(item => item.track);
            
            if (similarTracks.length === 0) {
                return res.json({ success: false, message: 'No similar tracks found' });
            }
            
            const shortTitle = sourceTrack.title ? sourceTrack.title.substring(0, 30) : 'Track';
            const playlistName = `Similar to ${shortTitle}`;
            const newPlaylist = db.createPlaylist(playlistName);
            
            for (const track of similarTracks) {
                db.addTrackToPlaylist(newPlaylist.id, track.id);
            }
            
            res.json({
                success: true,
                playlist: newPlaylist,
                trackCount: similarTracks.length
            });
        } catch (error) {
            console.error('Create similar playlist error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== STATISTICS ==========
    app.get('/api/stats', (req, res) => {
        try {
            const db = getDb();
            res.json(db.getStats());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ========== TAG EDITING ==========
    app.put('/api/tracks/:id/tags', async (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            let updatedFields = { ...req.body };
            // Run hook
            updatedFields = await runPluginHook('library:trackMetadataUpdate', { trackId: track.id, track, updates: updatedFields });
            if (updatedFields && updatedFields.updates) {
                updatedFields = updatedFields.updates;
            }
            
            const { title, artist, album, genre, year, trackNumber, composer, lyrics } = updatedFields;
            
            if (title !== undefined) track.title = title;
            if (artist !== undefined) track.artist = artist;
            if (album !== undefined) track.album = album;
            if (genre !== undefined) track.genre = genre;
            if (year !== undefined) track.year = year;
            if (trackNumber !== undefined) track.trackNumber = trackNumber;
            if (composer !== undefined) track.composer = composer;
            if (lyrics !== undefined) track.lyrics = lyrics;
            
            db.save();
            await emitPluginEvent('library:trackUpdated', { trackId: track.id, changes: updatedFields });
            res.json({ success: true, track });
        } catch (error) {
            console.error('Tag update error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== PLAYLIST EXPORT/IMPORT ==========
    app.post('/api/playlists/:id/export', async (req, res) => {
        try {
            const db = getDb();
            const playlist = db.getPlaylists().find(p => p.id === parseInt(req.params.id));
            if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
            
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

    app.post('/api/playlists/import', async (req, res) => {
        try {
            const db = getDb();
            const { filePath, format } = req.body;
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
            
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
                        coverImage: analysis.coverImage,
                        featureVector: analysis.featureVector
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

    // Auto-detect and import any playlist format
    app.post('/api/playlists/import-auto', async (req, res) => {
        try {
            const db = getDb();
            const { filePath } = req.body;
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
            
            const ext = path.extname(filePath).toLowerCase();
            let format = '';
            let importedTracks = [];
            
            switch (ext) {
                case '.m3u':
                    format = 'm3u';
                    importedTracks = await importFromM3U(filePath, path.dirname(filePath));
                    break;
                case '.m3u8':
                    format = 'm3u8';
                    importedTracks = await importFromM3U(filePath, path.dirname(filePath));
                    break;
                case '.pls':
                    format = 'pls';
                    importedTracks = importFromPLS(filePath);
                    break;
                case '.xspf':
                    format = 'xspf';
                    importedTracks = await importFromXSPF(filePath, path.dirname(filePath));
                    break;
                case '.asx':
                    format = 'asx';
                    importedTracks = await importFromASX(filePath, path.dirname(filePath));
                    break;
                case '.wpl':
                    format = 'wpl';
                    importedTracks = await importFromWPL(filePath, path.dirname(filePath));
                    break;
                case '.json':
                    format = 'json';
                    importedTracks = await importFromJSON(filePath, path.dirname(filePath));
                    break;
                default:
                    return res.status(400).json({ error: 'Unsupported playlist format' });
            }
            
            const playlistName = path.basename(filePath, ext);
            const newPlaylist = db.createPlaylist(playlistName);
            let importedCount = 0;
            
            for (const imported of importedTracks) {
                let existing = db.getAllTracks().find(t => t.filePath === imported.filePath);
                if (!existing) {
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
                        coverImage: analysis.coverImage,
                        featureVector: analysis.featureVector
                    }, false);
                }
                if (existing) {
                    db.addTrackToPlaylist(newPlaylist.id, existing.id);
                    importedCount++;
                }
            }
            db.save();
            res.json({ success: true, playlist: newPlaylist, importedCount, format });
        } catch (error) {
            console.error('Auto import error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== LIBRARY EXPORT ==========
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

    // ========== ADVANCED SEARCH ==========
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

    // ========== CUE SHEET ROUTES ==========
    app.post('/api/cue/parse', async (req, res) => {
        try {
            const { cuePath, audioBaseDir } = req.body;
            if (!fs.existsSync(cuePath)) return res.status(404).json({ error: 'CUE file not found' });
            
            const tracks = getTracksFromCue(cuePath, audioBaseDir);
            res.json({ success: true, tracks });
        } catch (error) {
            console.error('CUE parse error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/cue/generate', async (req, res) => {
        try {
            const db = getDb();
            const { playlistId, outputPath } = req.body;
            const playlist = db.getPlaylists().find(p => p.id === playlistId);
            if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
            
            const tracks = db.getAllTracks();
            const resultPath = generateCueSheet(playlist, tracks, outputPath || `${playlist.name}.cue`);
            res.json({ success: true, path: resultPath });
        } catch (error) {
            console.error('CUE generate error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== PLAYBACK SETTINGS ==========
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

    // ========== BPM DETECTION ==========
    app.post('/api/tracks/:id/detect-bpm', async (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            if (!track || !track.filePath) return res.status(404).json({ error: 'Track not found' });
            
            const realBpm = await detectRealBPM(track.filePath);
            track.bpm = realBpm;
            db.save();
            res.json({ success: true, bpm: realBpm });
        } catch (error) {
            console.error('BPM detection error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== PLUGIN ROUTES ==========
    app.get('/api/plugins', (req, res) => {
        if (global.pluginManager) {
            res.json(global.pluginManager.getPluginsList());
        } else {
            res.json([]);
        }
    });

    app.post('/api/plugins/:id/enable', async (req, res) => {
        if (!global.pluginManager) return res.status(500).json({ error: 'Plugin manager not ready' });
        const { enabled } = req.body;
        const success = await global.pluginManager.setPluginEnabled(req.params.id, enabled === true);
        res.json({ success });
    });

    app.post('/api/plugins/:id/reload', async (req, res) => {
        if (!global.pluginManager) return res.status(500).json({ error: 'Plugin manager not ready' });
        const success = await global.pluginManager.reloadPlugin(req.params.id);
        res.json({ success });
    });

    app.delete('/api/plugins/:id', async (req, res) => {
        if (!global.pluginManager) return res.status(500).json({ error: 'Plugin manager not ready' });
        const success = await global.pluginManager.uninstallPlugin(req.params.id);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Failed to uninstall plugin' });
        }
    });

    // Serve plugin icon
    app.get('/api/plugins/icon/:id', (req, res) => {
        if (!global.pluginManager) return res.status(404).end();
        const plugin = global.pluginManager.getPlugin(req.params.id);
        if (plugin && plugin.manifest.iconPath && fs.existsSync(plugin.manifest.iconPath)) {
            res.sendFile(plugin.manifest.iconPath);
        } else {
            res.status(404).end();
        }
    });

    // Plugin hook endpoints (for renderer to call)
    app.post('/api/plugins/hook/:hookName', async (req, res) => {
        try {
            const { hookName } = req.params;
            const payload = req.body;
            if (!global.pluginManager) {
                return res.status(500).json({ error: 'Plugin manager not ready' });
            }
            const result = await global.pluginManager.runHook(hookName, payload);
            res.json({ success: true, data: result });
        } catch (err) {
            console.error(`Hook error (${req.params.hookName}):`, err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/plugins/ui-injections', async (req, res) => {
        try {
            if (!global.pluginManager) {
                return res.json({ injections: [] });
            }
            const result = await global.pluginManager.runHook('ui:inject', {});
            const injections = Array.isArray(result) ? result : (result ? [result] : []);
            res.json({ injections });
        } catch (err) {
            console.error('UI injection error:', err);
            res.json({ injections: [] });
        }
    });

    // ========== DYNAMIC PLUGIN API ROUTES ==========
    // Store plugin routes in a Map for hot-reloading
    const pluginRoutes = new Map();

    // Endpoint for plugins to register their own routes (called via pluginContext)
    app.post('/api/plugins/register-route', async (req, res) => {
        try {
            const { pluginId, route, method = 'GET', handlerCode } = req.body;
            if (!global.pluginManager) {
                return res.status(500).json({ error: 'Plugin manager not ready' });
            }
            const plugin = global.pluginManager.getPlugin(pluginId);
            if (!plugin || !plugin.enabled) {
                return res.status(403).json({ error: 'Plugin not enabled' });
            }
            
            // Store route info
            const routeKey = `${method}:${route}`;
            pluginRoutes.set(routeKey, { pluginId, method, route, handlerCode });
            
            // Register dynamic route if not already registered
            const existingRoute = app._router.stack.find(layer => 
                layer.route && layer.route.path === route && layer.route.methods[method.toLowerCase()]
            );
            if (!existingRoute) {
                app[method.toLowerCase()](route, async (req, res) => {
                    const routeInfo = pluginRoutes.get(`${method}:${route}`);
                    if (!routeInfo) return res.status(404).end();
                    const plugin = global.pluginManager.getPlugin(routeInfo.pluginId);
                    if (!plugin || !plugin.enabled) return res.status(403).json({ error: 'Plugin disabled' });
                    try {
                        // Execute handler safely
                        const handler = new Function('req', 'res', routeInfo.handlerCode);
                        await handler(req, res);
                    } catch (err) {
                        console.error(`Plugin route error:`, err);
                        res.status(500).json({ error: err.message });
                    }
                });
            }
            
            res.json({ success: true });
        } catch (err) {
            console.error('Route registration error:', err);
            res.status(500).json({ error: err.message });
        }
    });
}

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function startServer(port, userDataPath) {
    serverUserDataPath = userDataPath;
    initDatabase(userDataPath);
    
    userHistory = loadUserHistory(userDataPath);
    console.log(`🧠 AI user history loaded: ${Object.keys(userHistory).length} tracks with interactions`);
    
    // ========== PLUGIN MANAGER INITIALIZATION ==========
    const PluginManager = require('./pluginManager');
    const pluginsDir = path.join(userDataPath, 'plugins');
    global.pluginManager = new PluginManager(pluginsDir, getDb());
    await global.pluginManager.loadPlugins();
    // ===================================================
    
    // Set temporary directory for audio processing
    const extractTempDir = path.join(userDataPath, 'temp_extract');
    AudioSeparator.setTempDirectory(extractTempDir);
    
    // ======================== PLUGIN INSTALLATION ENDPOINT ========================
    const multer = require('multer');
    const AdmZip = require('adm-zip');
    
    const pluginUploadDir = path.join(serverUserDataPath, 'temp_plugins');
    
    // Ensure upload directory exists with proper error handling
    if (!ensureDirectoryExists(pluginUploadDir)) {
        console.error('❌ Failed to create plugin upload directory');
    }
    
    const upload = multer({ dest: pluginUploadDir });
    
    /**
     * POST /api/plugins/install
     * Install a plugin from a ZIP file upload
     */
    app.post('/api/plugins/install', upload.single('plugin'), async (req, res) => {
        try {
            // Validate server user data path
            if (!serverUserDataPath) {
                console.error('❌ serverUserDataPath not set');
                return res.status(500).json({ error: 'Server user data path not initialized' });
            }
            
            // Validate file was uploaded
            const file = req.file;
            if (!file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            
            // Validate file extension
            if (!file.originalname.toLowerCase().endsWith('.zip')) {
                try { fs.unlinkSync(file.path); } catch (e) {}
                return res.status(400).json({ error: 'Only .zip files are allowed' });
            }
            
            // Ensure plugins base directory exists
            const pluginsBaseDir = path.join(serverUserDataPath, 'plugins');
            if (!ensureDirectoryExists(pluginsBaseDir)) {
                throw new Error('Failed to create plugins directory');
            }
            
            // Prepare extraction path
            const folderName = path.basename(file.originalname, '.zip');
            const extractPath = path.join(pluginsBaseDir, folderName);
            
            // Remove old plugin folder if exists
            if (fs.existsSync(extractPath)) {
                try {
                    fs.rmSync(extractPath, { recursive: true, force: true });
                    console.log(`🗑️ Removed existing plugin folder: ${folderName}`);
                } catch (rmErr) {
                    console.warn(`⚠️ Could not remove existing plugin folder: ${rmErr.message}`);
                }
            }
            
            // Extract ZIP file
            const zip = new AdmZip(file.path);
            const entries = zip.getEntries();
            
            if (!entries || entries.length === 0) {
                throw new Error('ZIP file is empty or corrupted');
            }
            
            zip.extractAllTo(extractPath, true);
            console.log(`📦 Extracted plugin to: ${extractPath}`);
            
            // Clean up uploaded file
            try { fs.unlinkSync(file.path); } catch (e) {}
            
            // Flatten nested folder structure (if ZIP contains a single top-level folder)
            const extractedItems = fs.readdirSync(extractPath);
            if (extractedItems.length === 1) {
                const onlyItem = path.join(extractPath, extractedItems[0]);
                if (fs.statSync(onlyItem).isDirectory()) {
                    const nestedItems = fs.readdirSync(onlyItem);
                    for (const item of nestedItems) {
                        const sourcePath = path.join(onlyItem, item);
                        const destPath = path.join(extractPath, item);
                        fs.renameSync(sourcePath, destPath);
                    }
                    fs.rmdirSync(onlyItem);
                    console.log(`📁 Flattened nested folder for plugin: ${folderName}`);
                }
            }
            
            // Validate plugin has required files
            const manifestPath = path.join(extractPath, 'manifest.json');
            const indexPath = path.join(extractPath, 'index.js');
            
            if (!fs.existsSync(manifestPath)) {
                throw new Error('Plugin missing manifest.json file');
            }
            if (!fs.existsSync(indexPath)) {
                throw new Error('Plugin missing index.js file');
            }
            
            // Validate manifest JSON format
            let manifest;
            try {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (!manifest.id || !manifest.name || !manifest.version) {
                    throw new Error('Manifest missing required fields: id, name, version');
                }
            } catch (parseErr) {
                throw new Error(`Invalid manifest.json: ${parseErr.message}`);
            }
            
            // Reload plugins to include the newly installed one
            if (global.pluginManager) {
                await global.pluginManager.loadPlugins();
                console.log(`✅ Plugin reloaded: ${manifest.name} v${manifest.version}`);
            } else {
                console.warn('⚠️ Plugin manager not available, plugin installed but not loaded');
            }
            
            console.log(`✅ Plugin installed successfully: ${folderName}`);
            res.json({ 
                success: true, 
                pluginPath: extractPath, 
                pluginName: folderName,
                manifest: manifest
            });
            
        } catch (err) {
            console.error('❌ Plugin installation error:', err);
            
            // Clean up uploaded file if it exists
            if (req.file && fs.existsSync(req.file.path)) {
                try { fs.unlinkSync(req.file.path); } catch (e) {}
            }
            
            res.status(500).json({ error: err.message });
        }
    });
    
    /**
     * GET /api/plugins/install-from-url
     * Install a plugin from a ZIP file URL
     */
    app.get('/api/plugins/install-from-url', async (req, res) => {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL parameter required' });
        
        try {
            // Validate server user data path
            if (!serverUserDataPath) {
                return res.status(500).json({ error: 'Server user data path not initialized' });
            }
            
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(url);
            
            if (!response.ok) {
                return res.status(400).json({ error: `Download failed: ${response.statusText}` });
            }
            
            // Ensure temp directory exists
            const pluginUploadDir = path.join(serverUserDataPath, 'temp_plugins');
            ensureDirectoryExists(pluginUploadDir);
            
            const tempZipPath = path.join(pluginUploadDir, `plugin_${Date.now()}.zip`);
            const fileStream = fs.createWriteStream(tempZipPath);
            
            await new Promise((resolve, reject) => {
                response.body.pipe(fileStream);
                response.body.on('error', reject);
                fileStream.on('finish', resolve);
            });
            
            // Ensure plugins base directory exists
            const pluginsBaseDir = path.join(serverUserDataPath, 'plugins');
            ensureDirectoryExists(pluginsBaseDir);
            
            const folderName = path.basename(url).split('?')[0].replace(/\.zip$/i, '') || 'plugin';
            const extractPath = path.join(pluginsBaseDir, folderName);
            
            // Remove old folder if exists
            if (fs.existsSync(extractPath)) {
                try { fs.rmSync(extractPath, { recursive: true, force: true }); } catch (e) {}
            }
            
            // Extract ZIP
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(tempZipPath);
            zip.extractAllTo(extractPath, true);
            
            // Clean up
            try { fs.unlinkSync(tempZipPath); } catch (e) {}
            
            // Flatten nested folder structure
            const extractedItems = fs.readdirSync(extractPath);
            if (extractedItems.length === 1) {
                const onlyItem = path.join(extractPath, extractedItems[0]);
                if (fs.statSync(onlyItem).isDirectory()) {
                    const nestedItems = fs.readdirSync(onlyItem);
                    for (const item of nestedItems) {
                        fs.renameSync(path.join(onlyItem, item), path.join(extractPath, item));
                    }
                    fs.rmdirSync(onlyItem);
                }
            }
            
            // Reload plugins
            if (global.pluginManager) {
                await global.pluginManager.loadPlugins();
            }
            
            console.log(`✅ Plugin installed from URL: ${folderName}`);
            res.json({ success: true, pluginPath: extractPath, pluginName: folderName });
            
        } catch (err) {
            console.error('URL plugin install error:', err);
            res.status(500).json({ error: err.message });
        }
    });
    // ============================================================================
    
    setupRoutes();
    
    return new Promise((resolve) => {
        const server = app.listen(port, '127.0.0.1', () => {
            console.log(`🚀 Server on port http://127.0.0.1:${port}`);
            console.log(`🤖 AI recommendation engine active`);
            console.log(`🔌 Plugin system active with full hook support`);
            resolve(server);
        });
    });
}

module.exports = { startServer };