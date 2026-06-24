/**
 * server.js - KORAI Music Player Backend API with AI
 * Complete Express server with AI recommendation endpoints
 * 
 * FIXED: Deep recursive directory scanning with improved error handling
 * FIXED: System folder skipping to avoid EPERM errors
 * FIXED: Worker thread compatibility (no ES modules in workers)
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
const AudioSeparator = require('./audioSeparator');
const os = require('os');
const PluginManager = require('./pluginManager');
const PluginHost = require('./pluginHost');
const { setupPluginRoutes } = require('./pluginRoutes');
const PluginSettings = require('./pluginSettings');
const PluginPerformanceMonitor = require('./pluginPerformanceMonitor');

const app = express();
let serverUserDataPath = null;
let userHistory = {};

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// SYSTEM FOLDERS TO SKIP (avoid EPERM errors on Windows)
// =============================================================================

const SYSTEM_FOLDERS_TO_SKIP = new Set([
    '$recycle.bin', 'recycle.bin', 'system volume information', 'windows', 
    'programdata', 'program files', 'program files (x86)', 'boot', 
    'perflogs', 'recovery', 'msocache', 'config.msi', 'cache', 
    'temp', 'tmp', 'appdata', 'local settings', 'winnt',
    'windows defender', 'windows nt', 'microsoft shared', 
    'common files', 'reference assemblies', 'assembly',
    'package cache', 'installer', 'servicing', 'speech', 
    'fonts', 'infusedapps', 'system32', 'syswow64', 'winsxs'
]);

const SKIP_PATH_PATTERNS = [
    /[\\/]ProgramData[\\/]Microsoft[\\/]Windows[\\/]WER/i,
    /[\\/]ProgramData[\\/]Microsoft[\\/]Windows[\\/]WindowsApps/i,
    /[\\/]ProgramData[\\/]Microsoft[\\/]Windows Defender/i,
    /[\\/]System32[\\/]/i,
    /[\\/]SysWOW64[\\/]/i,
    /[\\/]Windows[\\/]System32/i,
    /[\\/]Windows[\\/]SysWOW64/i,
    /[\\/]Windows[\\/]winsxs/i,
    /[\\/]Windows[\\/]Boot/i,
    /[\\/]Windows[\\/]Fonts/i,
    /[\\/]Windows[\\/]Installer/i,
    /[\\/]Windows[\\/]servicing/i,
    /[\\/]Windows[\\/]SoftwareDistribution/i,
    /[\\/]Windows[\\/]CSC/i,
    /[\\/]Windows[\\/]Prefetch/i,
    /[\\/]Windows[\\/]ServiceProfiles/i,
    /[\\/]Config[\\/]SystemProfile/i,
    /[\\/]AppData[\\/]Local[\\/]Temp/i,
    /[\\/]AppData[\\/]Local[\\/]Microsoft[\\/]Windows[\\/]INetCache/i,
    /[\\/]AppData[\\/]Local[\\/]Microsoft[\\/]Windows[\\/]Caches/i,
    /[\\/]AppData[\\/]Local[\\/]Microsoft[\\/]Windows[\\/]Explorer/i,
];

/**
 * Check if a directory path should be skipped (system/protected folders)
 */
function shouldSkipDirectory(dirPath) {
    const normalizedPath = dirPath.toLowerCase();
    const pathParts = normalizedPath.split(/[\\/]/);
    
    for (const part of pathParts) {
        if (SYSTEM_FOLDERS_TO_SKIP.has(part)) {
            return true;
        }
    }
    
    for (const pattern of SKIP_PATH_PATTERNS) {
        if (pattern.test(dirPath)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Improved recursive directory scanner with system folder skipping
 * Scans all user directories recursively for audio files
 */
async function scanDirectoryRecursively(dirPath, audioExtensions, files, maxDepth = 100, currentDepth = 0, silent = true) {
    try {
        if (shouldSkipDirectory(dirPath)) {
            return;
        }
        
        await fs.promises.access(dirPath, fs.constants.R_OK);
        
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            try {
                if (entry.isDirectory()) {
                    if (entry.name.startsWith('.') || entry.name.startsWith('$')) {
                        continue;
                    }
                    
                    if (currentDepth < maxDepth) {
                        await scanDirectoryRecursively(fullPath, audioExtensions, files, maxDepth, currentDepth + 1, silent);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (audioExtensions.includes(ext)) {
                        files.push(fullPath);
                        if (!silent) console.debug(`[scan] Found audio file: ${fullPath}`);
                    }
                }
            } catch (entryErr) {
                if (!silent && entryErr.code !== 'EPERM' && entryErr.code !== 'EACCES') {
                    console.warn(`[scan] Cannot access: ${fullPath}`, entryErr.message);
                }
            }
        }
    } catch (err) {
        if (!silent && err.code !== 'EPERM' && err.code !== 'EACCES') {
            console.error(`[scan] Error scanning directory ${dirPath}:`, err.message);
        }
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Download file from URL with redirect handling
 */
function downloadFile(fileUrl, destPath, redirectCount = 0) {
    if (redirectCount > 5) {
        return Promise.reject(new Error('Too many redirects'));
    }
    return new Promise((resolve, reject) => {
        const urlObj = new URL(fileUrl);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const request = client.get(fileUrl, (response) => {
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
        });
        
        request.on('error', (err) => {
            reject(err);
        });
        
        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// =============================================================================
// ROUTES SETUP
// =============================================================================

function setupRoutes() {
    // ========== Settings ==========
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

    // ========== Health Check ==========
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: Date.now() });
    });

    // ========== Telemetry ==========
    app.post('/api/telemetry/perf', express.json(), (req, res) => {
        try {
            if (!serverUserDataPath) return res.status(500).json({ error: 'Server not initialized' });
            const payload = req.body && (req.body.metrics || req.body);
            if (!payload) return res.status(400).json({ error: 'No metrics provided' });

            const telemetryDir = path.join(serverUserDataPath, 'telemetry');
            if (!fs.existsSync(telemetryDir)) fs.mkdirSync(telemetryDir, { recursive: true });
            const outPath = path.join(telemetryDir, 'perf.jsonl');

            const writeEntries = Array.isArray(payload) ? payload : [payload];
            const lines = writeEntries.map(e => JSON.stringify(Object.assign({ receivedAt: Date.now() }, e))).join('\n') + '\n';
            fs.appendFile(outPath, lines, (err) => {
                if (err) {
                    console.error('Failed to write telemetry:', err);
                    return res.status(500).json({ error: 'Failed to persist telemetry' });
                }
                res.json({ success: true });
            });
        } catch (error) {
            console.error('Telemetry endpoint error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== Tracks ==========
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

    app.get('/api/tracks/liked-status', (req, res) => {
        try {
            const db = getDb();
            const likedMap = {};
            const all = db.getAllTracks();
            all.forEach(t => {
                if (t.isLiked) likedMap[t.id] = true;
            });
            res.json(likedMap);
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

    // ========== Import Tracks ==========
    app.post('/api/tracks/import', async (req, res) => {
        try {
            const { filePaths } = req.body;
            console.debug('📥 /api/tracks/import received', Array.isArray(filePaths) ? filePaths.length : typeof filePaths, 'items');

            if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
                return res.status(400).json({ error: 'No file paths provided' });
            }

            const db = getDb();
            const existing = filePaths.filter(fp => {
                try {
                    return fs.existsSync(fp);
                } catch (e) {
                    return false;
                }
            });
            console.debug(`📂 import: ${existing.length}/${filePaths.length} paths exist on disk`);

            if (existing.length === 0) {
                return res.json({ success: true, imported: 0, total: filePaths.length });
            }

            const results = [];
            const CONCURRENCY = 3;

            async function processOne(filePath) {
                try {
                    console.debug(`🔍 Analyzing: ${path.basename(filePath)}`);
                    const analysis = await analyzeAudioFile(filePath);
                    const track = db.addTrack({
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
                    results.push(track);
                    console.debug(`✅ Imported: ${track.title}`);
                } catch (err) {
                    console.error(`❌ Failed to import ${filePath}:`, err.message);
                }
            }

            async function run() {
                const workers = [];
                for (let i = 0; i < existing.length; i++) {
                    const task = processOne(existing[i]);
                    workers.push(task);
                    if (workers.length >= CONCURRENCY || i === existing.length - 1) {
                        await Promise.all(workers);
                        workers.length = 0;
                    }
                }
                db.save();
                // Return the imported track objects (id, filePath, title) so clients can authoritativey autoplay
                const importedTracks = results.map(r => ({ id: r.id, filePath: r.filePath, title: r.title }));
                res.json({ success: true, imported: results.length, total: filePaths.length, importedTracks });
            }

            run().catch(err => {
                console.error('Import processing error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: err.message });
                }
            });

        } catch (error) {
            console.error('Import endpoint error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // ========== Download Track from URL ==========
    app.post('/api/tracks/download', async (req, res) => {
        try {
            const { url } = req.body;
            if (!url) return res.status(400).json({ error: 'URL is required' });
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return res.status(400).json({ error: 'Invalid URL protocol' });
            }
            
            const downloadsDir = path.join(serverUserDataPath, 'downloads');
            if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
            
            const tempFileName = `download_${Date.now()}.mp3`;
            const tempFilePath = path.join(downloadsDir, tempFileName);
            
            await downloadFile(url, tempFilePath);

            const { Worker } = require('worker_threads');
            const workerPath = path.join(__dirname, 'worker', 'analyzer.worker.js');
            const worker = new Worker(workerPath);

            const analysisResult = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Worker timeout')), 60000);
                worker.on('message', (msg) => {
                    if (msg && msg.type === 'result' && msg.data && msg.data.analysis) {
                        clearTimeout(timeout);
                        resolve(msg.data.analysis);
                    } else if (msg && msg.type === 'error') {
                        clearTimeout(timeout);
                        reject(new Error(msg.data && msg.data.error ? msg.data.error : 'Worker error'));
                    }
                });
                worker.on('error', (err) => { clearTimeout(timeout); reject(err); });
                worker.postMessage({ type: 'analyze', data: { filePath: tempFilePath, fileIndex: 0, totalFiles: 1 } });
            }).finally(() => { try { worker.terminate(); } catch {} });

            const db = getDb();
            const newTrack = db.addTrack({
                title: analysisResult.title || path.basename(tempFileName, '.mp3'),
                artist: analysisResult.artist || '',
                filePath: tempFilePath,
                duration: analysisResult.duration,
                bpm: analysisResult.bpm,
                energy: analysisResult.energy,
                loudness: analysisResult.loudness,
                genre: analysisResult.genre,
                album: analysisResult.album,
                coverImage: analysisResult.coverImage,
                featureVector: analysisResult.featureVector
            });

            res.json({ success: true, track: newTrack });
        } catch (error) {
            console.error('Download error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== Playlists ==========
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

    // ========== Delete Track ==========
    app.delete('/api/tracks/:id', async (req, res) => {
        try {
            const db = getDb();
            const deleted = db.deleteTrack(parseInt(req.params.id));
            res.json({ success: deleted });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ========== Play History ==========
    app.post('/api/tracks/:id/play', (req, res) => {
        try {
            const db = getDb();
            db.addPlayHistory(parseInt(req.params.id));
            if (serverUserDataPath) {
                updateUserHistory(userHistory, parseInt(req.params.id), 'play', serverUserDataPath);
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ========== Like/Unlike ==========
    app.post('/api/tracks/:id/like', (req, res) => {
        try {
            const db = getDb();
            const liked = db.likeTrack(parseInt(req.params.id));
            if (serverUserDataPath && liked) {
                updateUserHistory(userHistory, parseInt(req.params.id), 'like', serverUserDataPath);
            }
            res.json({ success: true, isLiked: liked });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete('/api/tracks/:id/like', (req, res) => {
        try {
            const db = getDb();
            const unliked = db.unlikeTrack(parseInt(req.params.id));
            if (serverUserDataPath && unliked) {
                updateUserHistory(userHistory, parseInt(req.params.id), 'unlike', serverUserDataPath);
            }
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

    // ========== Vocal Extraction ==========
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

            console.debug(`🎤 Extracting vocals from: ${track.filePath}`);
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

            console.debug(`✅ Extracted vocal track added: ${newTrack.title} (ID: ${newTrack.id})`);
            res.json({ success: true, track: newTrack });
        } catch (error) {
            console.error('Vocal extraction error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== AI Endpoints ==========
    app.get('/api/ai/history', (req, res) => {
        try {
            res.json(userHistory);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/ai/interaction', (req, res) => {
        try {
            const { trackId, action } = req.body;
            const updated = updateUserHistory(userHistory, trackId, action, serverUserDataPath);
            res.json({ success: true, history: updated });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/ai/recommend/personal/:trackId', (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.trackId));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const allTracks = db.getAllTracks();
            const recommendations = getPersonalizedRecommendations(allTracks, track, userHistory, 12);
            
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

    // ========== Create Similar Playlist ==========
    app.post('/api/playlists/similar', (req, res) => {
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

    // ========== Stats ==========
    app.get('/api/stats', (req, res) => {
        try {
            const db = getDb();
            res.json(db.getStats());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ========== Tag Editor ==========
    app.put('/api/tracks/:id/tags', async (req, res) => {
        try {
            const db = getDb();
            const track = db.getTrackById(parseInt(req.params.id));
            if (!track) return res.status(404).json({ error: 'Track not found' });
            
            const { title, artist, album, genre, year, trackNumber, composer, lyrics } = req.body;
            
            if (title !== undefined) track.title = title;
            if (artist !== undefined) track.artist = artist;
            if (album !== undefined) track.album = album;
            if (genre !== undefined) track.genre = genre;
            if (year !== undefined) track.year = year;
            if (trackNumber !== undefined) track.trackNumber = trackNumber;
            if (composer !== undefined) track.composer = composer;
            if (lyrics !== undefined) track.lyrics = lyrics;
            
            db.save();
            res.json({ success: true, track });
        } catch (error) {
            console.error('Tag update error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ========== Playlist Export ==========
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

    // ========== Playlist Import ==========
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
                    let analysis;
                    try {
                        analysis = await analyzeAudioFile(imported.filePath);
                    } catch (analysisErr) {
                        console.warn('⚠️ Audio analysis failed for imported file, using fallback:', imported.filePath, analysisErr.message);
                        analysis = {
                            duration: 0,
                            bpm: 120,
                            energy: 0.5,
                            loudness: -12,
                            sampleRate: 44100,
                            bitrate: 0,
                            codec: path.extname(imported.filePath).replace('.', '') || 'unknown',
                            genre: imported.genre || 'Imported',
                            title: imported.title || path.basename(imported.filePath),
                            artist: null,
                            album: null,
                            featureVector: null,
                            rawFeatures: null,
                            coverImage: null
                        };
                    }
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

    // ========== Auto-detect Playlist Import ==========
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
                    let analysis;
                    try {
                        analysis = await analyzeAudioFile(imported.filePath);
                    } catch (analysisErr) {
                        console.warn('⚠️ Audio analysis failed for imported file, using fallback:', imported.filePath, analysisErr.message);
                        analysis = {
                            duration: 0,
                            bpm: 120,
                            energy: 0.5,
                            loudness: -12,
                            sampleRate: 44100,
                            bitrate: 0,
                            codec: path.extname(imported.filePath).replace('.', '') || 'unknown',
                            genre: imported.genre || 'Imported',
                            title: imported.title || path.basename(imported.filePath),
                            artist: null,
                            album: null,
                            featureVector: null,
                            rawFeatures: null,
                            coverImage: null
                        };
                    }
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

    // ========== Library Export ==========
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

    // ========== CUE Sheet ==========
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

    // ========== Playback Settings ==========
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

    // ========== BPM Detection ==========
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
}

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function startServer(port, userDataPath) {
    serverUserDataPath = userDataPath;
    initDatabase(userDataPath);
    
    userHistory = loadUserHistory(userDataPath);
    console.debug(`🧠 AI user history loaded: ${Object.keys(userHistory).length} tracks with interactions`);
    
    // Initialize Plugin System
    const pluginManager = new PluginManager({
        appRoot: path.resolve(__dirname, '../..'),
        pluginsDir: path.join(userDataPath, 'plugins')
    });
    const pluginSettings = new PluginSettings();
    const pluginPerf = new PluginPerformanceMonitor();

    const pluginHost = new PluginHost(pluginManager.registry, {
        timeout: 5000,
        logger: console,
        pluginSettings,
        performanceMonitor: pluginPerf,
        hotReload: false
    });
    console.debug(`🔌 Plugin system initialized: ${pluginManager.listInstalled().length} plugins available`);

    // Auto-activate critical plugins on startup
    (async () => {
        const criticalPlugins = ['korai/change-logs'];
        const installed = pluginManager.listInstalled();
        for (const p of installed) {
            if (p.enabled && criticalPlugins.includes(p.id)) {
                try {
                    await pluginHost.activatePlugin(p.id);
                    console.debug(`🔁 Auto-activated critical plugin: ${p.id}`);
                } catch (e) {
                    console.warn(`Could not auto-activate critical plugin ${p.id}:`, e.message || e);
                }
            }
        }
    })();
    
    // Set temp directory for audio processing
    const extractTempDir = path.join(userDataPath, 'temp_extract');
    AudioSeparator.setTempDirectory(extractTempDir);
    
    setupRoutes();
    setupPluginRoutes(app, pluginManager, pluginHost);
    
    return new Promise((resolve) => {
        const server = app.listen(port, '127.0.0.1', () => {
            console.debug(`🚀 Server on port http://127.0.0.1:${port}`);
            console.debug(`🤖 AI recommendation engine active`);
            console.debug(`🔌 Plugin routes ready at /api/plugins`);
            resolve(server);
        });
    });
}

module.exports = { startServer };