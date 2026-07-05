// Backend server for the KORAI music player.

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
const { createRateLimiter, assertSafeUrl, resolveSafePath } = require('./securityUtils');

const app = express();
let serverUserDataPath = null;
let userHistory = {};

const { safeAssign } = require('./securityUtils');

app.use(cors({
    origin: (origin, cb) => {
        // allow no-origin (e.g. file:// in Electron) and localhost origins
        if (!origin) return cb(null, true);
        const allowed = [
            'http://localhost',
            'http://127.0.0.1',
            'https://localhost',
            'https://127.0.0.1'
        ];
        try {
            const url = new URL(origin);
            const base = `${url.protocol}//${url.hostname}`;
            if (allowed.includes(base)) return cb(null, true);
        } catch (e) {}
        cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', createRateLimiter(200, 60_000));

// =============================================================================
// MUSICDEL PROXY ENDPOINTS
// =============================================================================

/**
 * Proxy endpoint for MusicDel search and page fetching
 * POST /api/proxy/musicdel
 * 
 * Request body: { url: "https://musicdel.ir/..." }
 * Response: HTML content of the requested page
 */
app.post('/api/proxy/musicdel', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const targetUrl = await assertSafeUrl(url, {
            allowHosts: ['musicdel.ir', 'www.musicdel.ir', 'dl.musicdel.ir']
        });

        console.debug(`Proxy request to: ${targetUrl.toString()}`);

        const fetch = require('node-fetch');

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache'
            },
            timeout: 30000
        });

        if (!response.ok) {
            console.warn(`️ Proxy response not OK: ${response.status} for ${url}`);
            return res.status(response.status).json({ 
                error: `Server responded with status ${response.status}` 
            });
        }

        const html = await response.text();
        
        // Add cache control headers to prevent caching
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);

    } catch (error) {
        console.error(' Proxy error:', error.message);
        
        // Specific error handling
        let statusCode = 500;
        let errorMessage = 'Internal server error';
        
        if (error.code === 'ECONNREFUSED') {
            statusCode = 503;
            errorMessage = 'Could not connect to musicdel.ir. Please check your internet connection.';
        } else if (error.code === 'ENOTFOUND') {
            statusCode = 404;
            errorMessage = 'musicdel.ir could not be resolved. Please check your DNS settings.';
        } else if (error.message.includes('timeout')) {
            statusCode = 408;
            errorMessage = 'Request to musicdel.ir timed out. Please try again.';
        }
        
        res.status(statusCode).json({ error: errorMessage });
    }
});

/**
 * Proxy endpoint for direct MusicDel file download
 * GET /api/proxy/musicdel/download?url=...
 * 
 * Query param: url - Direct download URL from musicdel.ir
 * Response: Audio file with proper headers
 */
app.get('/api/proxy/musicdel/download', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const targetUrl = await assertSafeUrl(url, {
            allowHosts: ['musicdel.ir', 'www.musicdel.ir', 'dl.musicdel.ir']
        });

        console.debug(`Proxy download from: ${targetUrl.toString()}`);

        const fetch = require('node-fetch');
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 60000
        });

        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }

        // Stream the file directly to client
        const buffer = await response.buffer();
        res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Content-Disposition', `attachment; filename="musicdel_${Date.now()}.mp3"`);
        res.send(buffer);

    } catch (error) {
        console.error(' Proxy download error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Search MusicDel using the official search-html.php API
 * POST /api/search/musicdel
 *
 * Request body: { query: "song name" }
 * Response: { results: [ { title, subtitle, thumbnail, url } ] }
 */
app.post('/api/search/musicdel', async (req, res) => {
    try {
        const { query } = req.body;

        if (!query || query.trim().length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }

        const MUSICDEL_SEARCH_API = 'https://musicdel.ir/wp-content/themes/musicdel2/api/search-html.php';
        const encodedQuery = encodeURIComponent(query.trim());

        console.debug(`Searching MusicDel for: ${encodedQuery}`);

        const fetch = require('node-fetch');
        const searchUrl = new URL(MUSICDEL_SEARCH_API);
        searchUrl.searchParams.set('q', query.trim());
        const safeSearchUrl = await assertSafeUrl(searchUrl.toString(), {
            allowHosts: ['musicdel.ir', 'www.musicdel.ir']
        });

        const response = await fetch(safeSearchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
            },
            timeout: 30000
        });

        if (!response.ok) {
            console.warn(`️ MusicDel search failed with status: ${response.status}`);
            return res.status(response.status).json({ error: `MusicDel search failed with status ${response.status}` });
        }

        const html = await response.text();

        // Extract result items using regex (since we want to avoid adding cheerio just for this)
        const results = [];
        const figureRegex = /<figure class="result">(.*?)<\/figure>/gs;
        let figureMatch;

        while ((figureMatch = figureRegex.exec(html)) !== null) {
            const figureHtml = figureMatch[1];
            const linkMatch = figureHtml.match(/<a href="([^"]+)"/);
            const titleMatch = figureHtml.match(/<figcaption>.*?<span>(.*?)<\/span>/);
            const artistMatch = figureHtml.match(/<figcaption>.*?<span>(.*?)<\/span>.*?<span>(.*?)<\/span>/s);
            const imgMatch = figureHtml.match(/<img[^>]+src="([^"]+)"/);

            let link = linkMatch ? linkMatch[1] : null;
            if (link && link.startsWith('/')) {
                link = 'https://musicdel.ir' + link;
            }

            let title = titleMatch ? titleMatch[1].trim() : 'Unknown Title';
            let artist = artistMatch ? artistMatch[2].trim() : 'Unknown Artist';

            let thumbnail = imgMatch ? imgMatch[1] : null;
            if (thumbnail && !thumbnail.startsWith('http')) {
                thumbnail = 'https://musicdel.ir' + thumbnail;
            }

            if (link) {
                results.push({
                    id: link,
                    url: link,
                    title: title,
                    subtitle: artist,
                    thumbnail: thumbnail || ''
                });
            }
        }

        console.debug(` MusicDel search found ${results.length} results`);

        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.json({ results });

    } catch (error) {
        console.error(' MusicDel search error:', error.message);
        res.status(500).json({ error: 'Failed to search MusicDel: ' + error.message });
    }
});

// =============================================================================
// END OF MUSICDEL PROXY ENDPOINTS
// =============================================================================

// ... (بقیه کدهای server.js - همه اندپوینت‌های موجود بدون تغییر می‌مانند)

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

function shouldSkipDirectory(dirPath) {
    const normalizedPath = dirPath.toLowerCase();
    const pathParts = normalizedPath.split(/[\\/]/);
    for (const part of pathParts) {
        if (SYSTEM_FOLDERS_TO_SKIP.has(part)) return true;
    }
    for (const pattern of SKIP_PATH_PATTERNS) {
        if (pattern.test(dirPath)) return true;
    }
    return false;
}

async function scanDirectoryRecursively(dirPath, audioExtensions, files, maxDepth = 100, currentDepth = 0, silent = true) {
    try {
        if (shouldSkipDirectory(dirPath)) return;
        await fs.promises.access(dirPath, fs.constants.R_OK);
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            try {
                if (entry.isDirectory()) {
                    if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
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

async function downloadFile(fileUrl, destPath, redirectCount = 0) {
    if (redirectCount > 5) {
        return Promise.reject(new Error('Too many redirects'));
    }
    const urlObj = await assertSafeUrl(fileUrl);
    return new Promise((resolve, reject) => {
        const client = urlObj.protocol === 'https:' ? https : http;
        const request = client.get(urlObj, (response) => {
            const statusCode = response.statusCode;
            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                const redirectUrl = new URL(response.headers.location, urlObj).href;
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

function setupRoutes() {
    const fileOperationLimiter = createRateLimiter(20, 60_000);

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


    // Reset all settings to defaults
    app.post('/api/settings/reset', (req, res) => {
        try {
            const db = getDb();
            const defaultSettings = {
                gaplessEnabled: true,
                crossfadeDuration: 0,
                repeatMode: 'off',
                shuffleDefault: false,
                resumeOnStart: false,
                defaultVolume: 70,
                audioOutput: 'stereo',
                theme: 'default',
                direction: 'ltr',
                fontSize: 'medium',
                showAlbumArt: true,
                scanPath: '',
                formats: ['mp3', 'wav', 'flac', 'ogg', 'm4a'],
                autoScan: false,
                maxScanDepth: 100,
                autoActivatePlugins: true,
                hotReload: false,
                hookTimeout: 5000,
                pluginMemory: 64,
                aiRecommendations: true,
                discoveryMode: true,
                weightLike: 0.40,
                weightPlay: 0.12,
                weightSkip: 0.30,
                weightRepeat: 0.25,
                weightPlaylistAdd: 0.15,
                diversityBoost: 0.85,
                stayInTray: true,
                trayNotification: true,
                autoUpdate: true,
                updateInterval: 24,
                performanceMode: false,
                debugLogs: false,
                eq: [0, 0, 0, 0, 0]
            };
            db.updateSettings(defaultSettings);
            res.json({ success: true, settings: defaultSettings });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Clear cache
    app.post('/api/settings/clear-cache', (req, res) => {
        try {
            const userDataPath = serverUserDataPath;
            if (!userDataPath) throw new Error('User data path not set');
            
            // Clear telemetry
            const telemetryDir = path.join(userDataPath, 'telemetry');
            if (fs.existsSync(telemetryDir)) {
                fs.rmSync(telemetryDir, { recursive: true, force: true });
                fs.mkdirSync(telemetryDir, { recursive: true });
            }
            
            // Clear temp files
            const tempDir = path.join(userDataPath, 'temp_extract');
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Clear downloads temp
            const downloadsDir = path.join(userDataPath, 'downloads');
            if (fs.existsSync(downloadsDir)) {
                fs.rmSync(downloadsDir, { recursive: true, force: true });
                fs.mkdirSync(downloadsDir, { recursive: true });
            }
            
            res.json({ success: true });
        } catch (error) {
            console.error('Clear cache error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: Date.now() });
    });

    app.post('/api/telemetry/perf', express.json(), (req, res) => {
        try {
            if (!serverUserDataPath) return res.status(500).json({ error: 'Server not initialized' });
            const payload = req.body && (req.body.metrics || req.body);
            if (!payload) return res.status(400).json({ error: 'No metrics provided' });
            const telemetryDir = path.join(serverUserDataPath, 'telemetry');
            if (!fs.existsSync(telemetryDir)) fs.mkdirSync(telemetryDir, { recursive: true });
            const outPath = path.join(telemetryDir, 'perf.jsonl');
            const writeEntries = Array.isArray(payload) ? payload : [payload];
            const lines = writeEntries.map(e => JSON.stringify(safeAssign({ receivedAt: Date.now() }, e))).join('\n') + '\n';
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

    app.get('/api/tracks', (req, res) => {
        try {
            const db = getDb();
            const tracks = db.getAllTracks()
                .filter(track => {
                    if (!track.filePath) return false;
                    try {
                        return fs.existsSync(track.filePath);
                    } catch (err) {
                        return false;
                    }
                })
                .map(track => ({
                    ...track,
                    filePath: undefined,
                    coverPath: undefined,
                    coverUrl: track.hasCover ? `/api/tracks/${track.id}/cover` : null,
                    isAvailable: true
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
            const safeCoverPath = track && track.coverPath
                ? resolveSafePath(track.coverPath, serverUserDataPath || os.homedir())
                : null;
            if (!track || !track.hasCover || !track.coverPath || !safeCoverPath || !fs.existsSync(safeCoverPath)) {
                return res.status(404).json({ error: 'Cover not found' });
            }
            res.sendFile(safeCoverPath);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/tracks/:id/stream', (req, res) => {
        try {
            const db = getDb();
            const trackId = parseInt(req.params.id);
            const track = db.getTrackById(trackId);

            // FIX: Check if track exists and has a valid filePath
            if (!track) {
                console.warn(`[stream] Track ${trackId} not found in database`);
                return res.status(404).json({ error: 'Track not found in database' });
            }

            if (!track.filePath || track.filePath.trim() === '') {
                console.warn(`[stream] Track ${trackId} has no file path`);
                return res.status(400).json({ error: 'Track has no file path' });
            }

            // FIX: Normalize path and check if file exists
            const normalizedPath = resolveSafePath(track.filePath, serverUserDataPath || os.homedir());
            if (!normalizedPath || !fs.existsSync(normalizedPath)) {
                console.warn(`[stream] File not found: ${track.filePath}`);
                return res.status(404).json({ error: 'Audio file not found on disk' });
            }

            const stat = fs.statSync(normalizedPath);
            const fileSize = stat.size;

            if (fileSize === 0) {
                console.warn(`[stream] File is empty: ${normalizedPath}`);
                return res.status(400).json({ error: 'Audio file is empty' });
            }

            const range = req.headers.range;
            const ext = path.extname(normalizedPath).toLowerCase();

            let contentType = 'audio/mpeg';
            if (ext === '.wav') contentType = 'audio/wav';
            else if (ext === '.ogg') contentType = 'audio/ogg';
            else if (ext === '.m4a') contentType = 'audio/mp4';
            else if (ext === '.flac') contentType = 'audio/flac';
            else if (ext === '.aac') contentType = 'audio/aac';
            else if (ext === '.wma') contentType = 'audio/x-ms-wma';

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;

                if (start >= fileSize || end >= fileSize) {
                    return res.status(416).json({ error: 'Requested range not satisfiable' });
                }

                const file = fs.createReadStream(normalizedPath, { start, end });
                file.on('error', (streamErr) => {
                    console.error('[stream] Read error:', streamErr.message);
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
                const file = fs.createReadStream(normalizedPath);
                file.on('error', (streamErr) => {
                    console.error('[stream] Read error:', streamErr.message);
                    if (!res.headersSent) res.status(500).end();
                });
                file.pipe(res);
            }
        } catch (error) {
            console.error('[stream] Error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/tracks/import', fileOperationLimiter, async (req, res) => {
        try {
            const { filePaths } = req.body;
            console.debug(' /api/tracks/import received', Array.isArray(filePaths) ? filePaths.length : typeof filePaths, 'items');
            if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
                return res.status(400).json({ error: 'No file paths provided' });
            }

            const normalizedPaths = Array.from(new Set(filePaths.map((rawPath) => {
                if (!rawPath || typeof rawPath !== 'string') return null;
                let fp = rawPath.trim();
                if (fp.startsWith('file://')) {
                    try {
                        fp = decodeURI(fp.replace(/^file:\/\//, ''));
                    } catch (err) {
                        fp = fp.replace(/^file:\/\//, '');
                    }
                }
                const safePath = resolveSafePath(fp, serverUserDataPath || os.homedir());
                return safePath || null;
            }).filter(Boolean)));

            const db = getDb();
            const existing = normalizedPaths.filter(fp => {
                try {
                    return fs.existsSync(fp);
                } catch (e) {
                    return false;
                }
            });
            console.debug(` import: ${existing.length}/${normalizedPaths.length} paths exist on disk`);
            if (existing.length === 0) {
                return res.json({ success: true, imported: 0, total: normalizedPaths.length, skipped: normalizedPaths.length });
            }
            const results = [];
            const CONCURRENCY = 3;
            async function processOne(filePath) {
                try {
                    console.debug(` Analyzing: ${path.basename(filePath)}`);
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
                    console.debug(` Imported: ${track.title}`);
                } catch (err) {
                    console.error(` Failed to import ${filePath}:`, err.message);
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

    app.post('/api/tracks/download', fileOperationLimiter, async (req, res) => {
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

    app.post('/api/tracks/import-from-url', fileOperationLimiter, async (req, res) => {
        try {
            const { url, title } = req.body;
            if (!url) return res.status(400).json({ error: 'URL is required' });
            
            // Validate URL protocol
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return res.status(400).json({ error: 'Invalid URL protocol' });
            }

            const downloadsDir = path.join(serverUserDataPath, 'downloads');
            if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
            
            const timestamp = Date.now();
            let downloadedFile = null;
            let finalPath = null;

            // --- Detect if this is a direct file link (non-YouTube) ---
            // Check for audio file extensions in URL
            const isDirectLink = /\.(mp3|wav|ogg|m4a|flac|aac|wma)(\?.*)?$/i.test(url) || 
                                /^(?!.*(youtube|youtu.be|vimeo|soundcloud|spotify)).*\.(mp3|wav|ogg|m4a|flac)/i.test(url);
            
            if (isDirectLink) {
                // Direct download - use simple HTTP GET
                const fileName = `import_${timestamp}.mp3`; // Default to mp3
                finalPath = path.join(downloadsDir, fileName);
                console.debug(` Downloading direct link: ${url}`);
                await downloadFileDirect(url, finalPath);
                downloadedFile = fileName;
            } else {
                // Try with youtube-dl-exec (for YouTube and similar services)
                console.debug(` Downloading with yt-dlp: ${url}`);
                const tempFileName = `import_${timestamp}.%(ext)s`;
                const tempFilePath = path.join(downloadsDir, tempFileName);
                
                try {
                    // await ytdl(url, {
                    //     extractAudio: true,
                    //     audioFormat: 'mp3',
                    //     audioQuality: 0,
                    //     output: tempFilePath,
                    //     noCheckCertificate: true,
                    //     preferFreeFormats: true,
                    //     timeout: 120,
                    //     addHeader: ['User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36']
                    // });
                    
                    // Find the downloaded file
                    const files = fs.readdirSync(downloadsDir);
                    downloadedFile = files.find(f => f.startsWith(`import_${timestamp}`));
                    if (downloadedFile) finalPath = path.join(downloadsDir, downloadedFile);
                } catch (ytError) {
                    console.error('yt-dlp error:', ytError.message);
                    // Fallback: try direct download (in case URL redirects to a direct file)
                    try {
                        const fileName = `import_${timestamp}.mp3`;
                        finalPath = path.join(downloadsDir, fileName);
                        await downloadFileDirect(url, finalPath);
                        downloadedFile = fileName;
                    } catch (fallbackErr) {
                        throw new Error(`Download failed: ${ytError.message || fallbackErr.message}`);
                    }
                }
            }

            // Verify file was downloaded
            if (!downloadedFile || !finalPath || !fs.existsSync(finalPath)) {
                throw new Error('Downloaded file not found');
            }

            const stats = fs.statSync(finalPath);
            if (stats.size === 0) {
                throw new Error('Downloaded file is empty');
            }

            console.debug(` File size: ${stats.size} bytes`);

            // Analyze the audio file
            let analysis;
            try {
                analysis = await analyzeAudioFile(finalPath);
            } catch (analysisErr) {
                console.warn('️ Audio analysis failed, using fallback metadata:', analysisErr.message);
                analysis = {
                    duration: 0,
                    bpm: 120,
                    energy: 0.5,
                    loudness: -12,
                    sampleRate: 44100,
                    bitrate: 0,
                    codec: path.extname(finalPath).replace('.', '') || 'mp3',
                    genre: 'Downloaded',
                    title: title || path.basename(finalPath, path.extname(finalPath)),
                    artist: null,
                    album: null,
                    featureVector: null,
                    rawFeatures: null,
                    coverImage: null
                };
            }

            if (title) analysis.title = title;

            // Add track to database
            const db = getDb();
            const newTrack = db.addTrack({
                title: analysis.title || path.basename(finalPath, path.extname(finalPath)),
                artist: analysis.artist || 'Unknown Artist',
                filePath: finalPath,
                duration: analysis.duration,
                bpm: analysis.bpm,
                energy: analysis.energy,
                loudness: analysis.loudness,
                genre: analysis.genre || 'Downloaded',
                album: analysis.album || '',
                coverImage: analysis.coverImage,
                featureVector: analysis.featureVector,
                sampleRate: analysis.sampleRate,
                bitrate: analysis.bitrate,
                codec: analysis.codec,
            });

            console.debug(` Imported track: ${newTrack.title} (ID: ${newTrack.id})`);

            res.json({ success: true, track: newTrack });

        } catch (error) {
            console.error('Import from URL error:', error);
            res.status(500).json({ error: error.message || 'Failed to import track from URL' });
        }
    });

    async function downloadFileDirect(fileUrl, destPath) {
        const urlObj = await assertSafeUrl(fileUrl);
        return new Promise((resolve, reject) => {
            const client = urlObj.protocol === 'https:' ? https : http;

            const request = client.get(urlObj, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    const redirectUrl = new URL(response.headers.location, urlObj).href;
                    return downloadFileDirect(redirectUrl, destPath).then(resolve).catch(reject);
                }

                if (response.statusCode !== 200) {
                    return reject(new Error(`Server responded with status: ${response.statusCode}`));
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

            request.setTimeout(30000, () => {
                request.destroy();
                reject(new Error('Download timeout'));
            });

            request.on('error', reject);
        });
    }

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

    app.delete('/api/tracks/:id', async (req, res) => {
        try {
            const db = getDb();
            const deleted = db.deleteTrack(parseInt(req.params.id));
            res.json({ success: deleted });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

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
            console.debug(` Extracting vocals from: ${track.filePath}`);
            await AudioSeparator.extractVocal(track.filePath, outputFilePath);
            let analysis;
            try {
                analysis = await analyzeAudioFile(outputFilePath);
            } catch (analysisErr) {
                console.warn('️ Audio analysis failed for extracted file, using fallback metadata:', analysisErr.message);
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
            console.debug(` Extracted vocal track added: ${newTrack.title} (ID: ${newTrack.id})`);
            res.json({ success: true, track: newTrack });
        } catch (error) {
            console.error('Vocal extraction error:', error);
            res.status(500).json({ error: error.message });
        }
    });

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
                similarityIcon: r.similarityIcon || '',
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

    app.get('/api/stats', (req, res) => {
        try {
            const db = getDb();
            res.json(db.getStats());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

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

    app.post('/api/playlists/:id/export', fileOperationLimiter, async (req, res) => {
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

    app.post('/api/playlists/import', fileOperationLimiter, async (req, res) => {
        try {
            const db = getDb();
            const { filePath, format } = req.body;
            const safeFilePath = resolveSafePath(filePath, serverUserDataPath || os.homedir());
            if (!safeFilePath || !fs.existsSync(safeFilePath)) return res.status(404).json({ error: 'File not found' });
            let importedTracks;
            if (format === 'm3u' || format === 'm3u8') {
                importedTracks = await importFromM3U(safeFilePath, path.dirname(safeFilePath));
            } else if (format === 'pls') {
                importedTracks = importFromPLS(safeFilePath, path.dirname(safeFilePath));
            } else {
                return res.status(400).json({ error: 'Invalid format' });
            }
            const playlistName = path.basename(safeFilePath, path.extname(safeFilePath));
            const newPlaylist = db.createPlaylist(playlistName);
            let importedCount = 0;
            for (const imported of importedTracks) {
                let existing = db.getAllTracks().find(t => t.filePath === imported.filePath);
                if (!existing) {
                    let analysis;
                    try {
                        analysis = await analyzeAudioFile(imported.filePath);
                    } catch (analysisErr) {
                        console.warn('️ Audio analysis failed for imported file, using fallback:', imported.filePath, analysisErr.message);
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

    app.post('/api/playlists/import-auto', fileOperationLimiter, async (req, res) => {
        try {
            const db = getDb();
            const { filePath } = req.body;
            const safeFilePath = resolveSafePath(filePath, serverUserDataPath || os.homedir());
            if (!safeFilePath || !fs.existsSync(safeFilePath)) return res.status(404).json({ error: 'File not found' });
            const ext = path.extname(safeFilePath).toLowerCase();
            let format = '';
            let importedTracks = [];
            switch (ext) {
                case '.m3u':
                    format = 'm3u';
                    importedTracks = await importFromM3U(safeFilePath, path.dirname(safeFilePath));
                    break;
                case '.m3u8':
                    format = 'm3u8';
                    importedTracks = await importFromM3U(safeFilePath, path.dirname(safeFilePath));
                    break;
                case '.pls':
                    format = 'pls';
                    importedTracks = importFromPLS(safeFilePath, path.dirname(safeFilePath));
                    break;
                case '.xspf':
                    format = 'xspf';
                    importedTracks = await importFromXSPF(safeFilePath, path.dirname(safeFilePath));
                    break;
                case '.asx':
                    format = 'asx';
                    importedTracks = await importFromASX(safeFilePath, path.dirname(safeFilePath));
                    break;
                case '.wpl':
                    format = 'wpl';
                    importedTracks = await importFromWPL(safeFilePath, path.dirname(safeFilePath));
                    break;
                case '.json':
                    format = 'json';
                    importedTracks = await importFromJSON(safeFilePath, path.dirname(safeFilePath));
                    break;
                default:
                    return res.status(400).json({ error: 'Unsupported playlist format' });
            }
            const playlistName = path.basename(safeFilePath, ext);
            const newPlaylist = db.createPlaylist(playlistName);
            let importedCount = 0;
            for (const imported of importedTracks) {
                let existing = db.getAllTracks().find(t => t.filePath === imported.filePath);
                if (!existing) {
                    let analysis;
                    try {
                        analysis = await analyzeAudioFile(imported.filePath);
                    } catch (analysisErr) {
                        console.warn('️ Audio analysis failed for imported file, using fallback:', imported.filePath, analysisErr.message);
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

    app.post('/api/library/export', fileOperationLimiter, async (req, res) => {
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

    app.post('/api/cue/parse', fileOperationLimiter, async (req, res) => {
        try {
            const { cuePath, audioBaseDir } = req.body;
            const safeCuePath = resolveSafePath(cuePath, serverUserDataPath || os.homedir());
            if (!safeCuePath || !fs.existsSync(safeCuePath)) return res.status(404).json({ error: 'CUE file not found' });
            const tracks = getTracksFromCue(safeCuePath, audioBaseDir);
            res.json({ success: true, tracks });
        } catch (error) {
            console.error('CUE parse error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/cue/generate', fileOperationLimiter, async (req, res) => {
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

async function startServer(port, userDataPath) {
    serverUserDataPath = userDataPath;
    initDatabase(userDataPath);
    userHistory = loadUserHistory(userDataPath);
    console.debug(` AI user history loaded: ${Object.keys(userHistory).length} tracks with interactions`);
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
    console.debug(` Plugin system initialized: ${pluginManager.listInstalled().length} plugins available`);
    (async () => {
        const criticalPlugins = ['korai/change-logs'];
        const installed = pluginManager.listInstalled();
        for (const p of installed) {
            if (p.enabled && criticalPlugins.includes(p.id)) {
                try {
                    await pluginHost.activatePlugin(p.id);
                    console.debug(` Auto-activated critical plugin: ${p.id}`);
                } catch (e) {
                    console.warn(`Could not auto-activate critical plugin ${p.id}:`, e.message || e);
                }
            }
        }
    })();
    const extractTempDir = path.join(userDataPath, 'temp_extract');
    AudioSeparator.setTempDirectory(extractTempDir);
    setupRoutes();
    const PluginStore = require('./pluginStore');
    const pluginStore = new PluginStore();
    setupPluginRoutes(app, pluginManager, pluginHost, pluginStore);

    // Fallback for API routes to return JSON instead of HTML 404 pages
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: 'API route not found' });
        }
        next();
    });

    // Global error handler to ensure JSON responses for unhandled server errors
    app.use((err, req, res, next) => {
        console.error('Unhandled server error:', err);
        if (res.headersSent) return next(err);
        if (req.path.startsWith('/api/')) {
            return res.status(500).json({ error: err.message || 'Internal server error' });
        }
        res.status(500).send('Internal server error');
    });

    return new Promise((resolve, reject) => {
        const server = app.listen(port, '127.0.0.1')
            .on('listening', () => {
                console.debug(` Server on port http://127.0.0.1:${port}`);
                console.debug(` AI recommendation engine active`);
                console.debug(` Plugin routes ready at /api/plugins`);
                resolve(server);
            })
            .on('error', (err) => {
                console.error('Server failed to start:', err.message || err);
                reject(err);
            });
    });
}

module.exports = { startServer };