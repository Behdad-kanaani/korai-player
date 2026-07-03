/**
 * app.js - KORAI Music Player Frontend Logic
 * FIXED: Shuffle play, timeline visualizer, and other bugs
 */

// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

let apiPort = null;
let currentTrackId = null;
let currentTrack = null;
let isPlaying = false;
let shuffleMode = false;
let repeatMode = false;
let audioElement = null;
let tracks = [];
let playlists = [];
let queue = [];
let queueIndex = -1;
let volume = 0.7;
let isMuted = false;
let previousVolume = 0.7;
let isFullscreenPlayerOpen = false;
let isQueueOpen = false;
let isMiniPlayerOpen = false;
let currentActiveSection = 'home';
let currentActivePlaylistId = null;
let currentLanguage = localStorage.getItem('user_lang') || 'en';
let currentSkin = localStorage.getItem('user_skin') || 'default';
if (currentSkin !== 'default' && currentSkin !== 'liquid-glass') {
    currentSkin = 'default';
}
let currentVinylRotation = 0;
let repeatOneMode = false;
let lastVinylUpdateTime = 0;
let importProgressElement = null;
let importProgressInterval = null;
let originalQueueBackup = [];
let vinylRotationInterval = null;
let vinylRotationRAFId = null;
let lastTimeUpdateTime = 0;
let lastAudioTimeUpdateTime = 0;
let lastPlaybackSaveTime = 0;
let shuffleHistory = [];
let shuffleSessionActive = false;
let remainingUnplayedTracks = [];
let preferredGenreMode = false;
let preferredGenreHistory = [];
let lastPlaySource = {
    type: 'library',
    sourceId: null,
    sourceTracks: null
};
let wasVocalSeparatorActive = false;
let reconnectAudioGraph = null; 
// Play request counter to avoid play() / load() race conditions
let playRequestCounter = 0;
// tokens for ipc listener cleanup
let stateUpdateTokenMini = null;
let stateUpdateTokenMain = null;

// Filtering & Sorting Library states
let librarySortKey = 'createdAt';
let librarySortOrder = 'desc';
let libraryGenreFilter = 'all';

// Web Audio API nodes
let audioCtx = null;
let audioSource = null;
let analyser = null;
let eqFilters = [];
const eqBands = [60, 230, 910, 4000, 14000];
let gainNode = null;

// Gapless and crossfade settings
let gaplessEnabled = true;
let crossfadeDuration = 0;

let sleepIntervalId = null;
let sleepTimeRemaining = 0;
let lastSleepUpdateTime = 0;

let pendingPlayRequest = null; // Prevent concurrent play requests
let audioRecoveryAttempts = 0;
const MAX_AUDIO_RECOVERY_ATTEMPTS = 3;


// Mini window detection
const urlParams = new URLSearchParams(window.location.search);
const isMiniWindowMode = urlParams.get('mode') === 'mini';


//
let currentActiveAlbumId = null;


let settingsSyncInitialized = false;


// Make variables available globally
window.audioCtx = audioCtx;
window.audioSource = audioSource;
window.analyser = analyser;
window.eqFilters = eqFilters;
window.gainNode = gainNode;
window.audioElement = audioElement;
window.currentTrackId = currentTrackId;
window.isPlaying = isPlaying;
window.setPlayState = setPlayState;
window.showNotification = showNotification;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function detectPerformanceMode() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isLowMemory = navigator.deviceMemory && navigator.deviceMemory < 4;
    const isSlowCPU = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    
    if (isMobile || isLowMemory || isSlowCPU) {
        document.body.classList.add('performance-mode');
        console.debug('⚡ Performance mode enabled for this device');
        return true;
    }
    return false;
}



async function initSettingsSync() {
    if (settingsSyncInitialized) return;
    
    // Wait for settingsSync to be ready
    if (!window.settingsSync || !window.settingsSync.initialized) {
        await new Promise(resolve => {
            const check = () => {
                if (window.settingsSync?.initialized) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }
    
    // Apply settings that affect playback
    const store = window.settingsStore;
    if (store) {
        // Apply volume
        const volume = store.getNumber('defaultVolume', 70) / 100;
        if (typeof setVolume === 'function') {
            setVolume(volume);
        }
        
        // Apply EQ
        const eq = store.getArray('eq', [0, 0, 0, 0, 0]);
        if (typeof updateEqualizerBand === 'function') {
            for (let i = 0; i < 5; i++) {
                updateEqualizerBand(i, eq[i] || 0);
            }
        }
    }
    
    settingsSyncInitialized = true;
    console.debug('✅ Settings sync initialized in app.js');
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initSettingsSync, 500);
});



// =========================
// Lightweight Performance Observability
// - Long Tasks via PerformanceObserver
// - Click / Key latency via RAF timing
// - Batched, non-blocking sender to local telemetry endpoint when available
// =========================

const __perfBuffer = [];
let __perfFlushTimer = null;

function __enqueuePerf(metric) {
    try {
        metric._ts = Date.now();
        __perfBuffer.push(metric);
        if (__perfBuffer.length >= 12) __flushPerfBuffer();
    } catch (e) {}
}

// =============================================================================
// SONG INFO MODAL FUNCTIONS
// =============================================================================

/**
 * Show song info modal with current track metadata
 */
window.showSongInfo = function() {
    if (!currentTrack) {
        showNotification('No track is currently playing', 'warning');
        return;
    }
    const modal = document.getElementById('songInfoModal');
    const contentDiv = document.getElementById('songInfoContent');
    if (!modal || !contentDiv) return;
    const coverUrl = currentTrack.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/cover?t=${currentTrack.updatedAt || currentTrack.id}` : null;
    let lyricsHtml = '';
    if (currentTrack.lyrics) {
        lyricsHtml = `<div class="song-info-lyrics"><strong>${t('lyrics') || 'Lyrics'}:</strong><br>${escapeHtml(currentTrack.lyrics).replace(/\n/g, '<br>')}</div>`;
    } else {
        lyricsHtml = `<div class="song-info-lyrics"><em>${t('noLyrics')}</em></div>`;
    }
    contentDiv.innerHTML = `
        <div class="song-info-cover">
            ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
        </div>
        <div class="song-info-details">
            <p><strong>${t('trackTitle') || 'Title'}:</strong> ${escapeHtml(currentTrack.title || '—')}</p>
            <p><strong>${t('artist') || 'Artist'}:</strong> ${escapeHtml(currentTrack.artist || '—')}</p>
            <p><strong>${t('album') || 'Album'}:</strong> ${escapeHtml(currentTrack.album || '—')}</p>
            <p><strong>${t('genre') || 'Genre'}:</strong> ${escapeHtml(currentTrack.genre || '—')}</p>
            <p><strong>BPM:</strong> ${currentTrack.bpm || '—'}</p>
            <p><strong>${t('energy') || 'Energy'}:</strong> ${currentTrack.energy ? Math.round(currentTrack.energy * 100) + '%' : '—'}</p>
            <p><strong>${t('duration') || 'Duration'}:</strong> ${formatTime(currentTrack.duration)}</p>
            <p><strong>${t('codec') || 'Codec'}:</strong> ${currentTrack.codec ? currentTrack.codec.toUpperCase() : '—'}</p>
            <p><strong>${t('bitrate') || 'Bitrate'}:</strong> ${currentTrack.bitrate ? Math.round(currentTrack.bitrate / 1000) + ' kbps' : '—'}</p>
            <p><strong>${t('sampleRate') || 'Sample Rate'}:</strong> ${currentTrack.sampleRate ? (currentTrack.sampleRate / 1000).toFixed(1) + ' kHz' : '—'}</p>
        </div>
        ${lyricsHtml}
    `;
    modal.style.display = 'flex';
};

/**
 * Close song info modal
 */
window.closeSongInfoModal = function() {
    const modal = document.getElementById('songInfoModal');
    if (modal) modal.style.display = 'none';
};

/**
 * Extract vocal (karaoke) from current track and add as new track
 */
window.extractVocalFromCurrentTrack = async function() {
    if (!currentTrack) {
        showNotification('No track is currently playing', 'warning');
        return;
    }

    // Check if extraction is already in progress (optional)
    if (window._vocalExtractionInProgress) {
        showNotification(t('extractionInProgress') || 'Extraction already in progress', 'info');
        return;
    }

    window._vocalExtractionInProgress = true;
    showNotification(t('preparingExtraction') || 'Preparing vocal extraction...', 'info');

    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/extract-vocal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'vocal' })
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.error || 'Extraction failed');
        }

        const data = await res.json();
        if (data.success && data.track) {
            showNotification(t('extractionComplete') || 'Extraction complete!', 'success');
            await loadTracks();    // refresh track list
            await loadPlaylists(); // in case playlists reference new track
            // Optionally play the new vocal track
            if (data.track && data.track.id) {
                setTimeout(() => playTrack(data.track.id), 500);
            }
        } else {
            throw new Error('Server returned failure');
        }
    } catch (err) {
        console.error('Vocal extraction error:', err);
        showNotification(t('extractionFailed') || 'Extraction failed: ' + err.message, 'error');
    } finally {
        window._vocalExtractionInProgress = false;
        closeSongInfoModal();
    }
};

function __flushPerfBuffer() {
    if (__perfBuffer.length === 0) return;
    const payload = __perfBuffer.splice(0, __perfBuffer.length);
    // Non-blocking send to local telemetry collector if server available
    (async () => {
        try {
            if (!apiPort) return; // not initialized yet
            await fetch(`http://127.0.0.1:${apiPort}/api/telemetry/perf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metrics: payload })
            });
        } catch (err) {
            // Server may not exist in dev; swallow errors and keep payload dropped
            console.debug('Perf telemetry not sent (endpoint unavailable)');
        }
    })();
}

// Periodic flush every 30s
function __startPerfFlushTimer() {
    if (__perfFlushTimer) return;
    __perfFlushTimer = setInterval(() => { __flushPerfBuffer(); }, 30000);
}

function __stopPerfFlushTimer() {
    if (!__perfFlushTimer) return;
    clearInterval(__perfFlushTimer); __perfFlushTimer = null;
}

// Long Task observer
try {
    const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            __enqueuePerf({ type: 'longtask', name: entry.name || 'longtask', duration: entry.duration, start: entry.startTime });
        }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
} catch (e) {
    // PerformanceObserver or longtask may not be supported in some runtimes
}

// Click latency and keypress latency (measured via RAF)
window.addEventListener('click', (ev) => {
    try {
        const start = performance.now();
        requestAnimationFrame(() => {
            const latency = performance.now() - start;
            const target = ev.target && ev.target.tagName ? ev.target.tagName : 'unknown';
            __enqueuePerf({ type: 'click-latency', latency, target });
        });
    } catch (e) {}
}, { passive: true });

window.addEventListener('keydown', (ev) => {
    try {
        const start = performance.now();
        requestAnimationFrame(() => {
            const latency = performance.now() - start;
            __enqueuePerf({ type: 'key-latency', latency, key: ev.key });
        });
    } catch (e) {}
}, { passive: true });

// Expose a simple API for debugging and manual flush
window.__koraiPerf = {
    enqueue: __enqueuePerf,
    flush: __flushPerfBuffer,
    startAutoFlush: __startPerfFlushTimer,
    stopAutoFlush: __stopPerfFlushTimer,
    bufferSize: () => __perfBuffer.length
};


function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Find a track in `tracks` array by matching file path (normalize slashes and case)
function findTrackByFilePath(filePath) {
    if (!filePath || !Array.isArray(tracks)) return null;
    const norm = normalizePath(filePath);
    for (const t of tracks) {
        if (!t) continue;
        const tp = normalizePath(t.filePath || '');
        if (!tp) continue;
        if (tp === norm) return t;
        // fallback: compare basenames
        const tpBase = tp.split('/').pop();
        const normBase = norm.split('/').pop();
        if (tpBase === normBase) return t;
    }
    return null;
}

// Normalize file paths for comparison
function normalizePath(p) {
    if (!p) return '';
    return String(p).replace(/\\/g, '/').trim().toLowerCase();
}

function t(key) {
    return translations[currentLanguage] && translations[currentLanguage][key] ? translations[currentLanguage][key] : key;
}

// Normalize genre label for grouping (remove urls, bracket tags, extra punctuation)
function normalizeGenreLabel(s) {
    if (!s) return '';
    let v = String(s).toLowerCase();
    // remove bracketed site tags like [ ... ]
    v = v.replace(/\[.*?\]/g, '');
    // remove urls
    v = v.replace(/https?:\/\/\S+/g, '');
    v = v.replace(/www\.[^\s]+/g, '');
    // remove common 'new address' noise
    v = v.replace(/new address\s*:\s*[^\s]+/g, '');
    // remove extra punctuation but keep letters, numbers, spaces, &, /, - and Persian/Arabic chars
    v = v.replace(/[^\w\s&\/-\u0600-\u06FF]/g, '');
    v = v.replace(/\s+/g, ' ').trim();
    return v;
}

// Heuristic to detect junk genres (URLs, site tags, overly long or noisy)
function isJunkGenre(norm) {
    if (!norm) return true;
    if (norm.length > 40) return true;
    if (/\b(www|http|https|\.com|\.ir|\.in|\.net)\b/.test(norm)) return true;
    if (/new address/.test(norm)) return true;
    // if genre contains many digits or is mostly non-letter characters
    const letters = norm.replace(/[^a-z\u0600-\u06FF]/g, '');
    if (letters.length < Math.max(2, Math.floor(norm.length / 2))) return true;
    return false;
}

// Clean display label: remove urls and site tags, trim and title-case small phrases
function cleanGenreDisplay(s) {
    if (!s) return '';
    let v = String(s);
    v = v.replace(/\[.*?\]/g, '');
    v = v.replace(/https?:\/\/\S+/g, '');
    v = v.replace(/www\.[^\s]+/g, '');
    v = v.replace(/new address\s*:\s*[^\s]+/gi, '');
    v = v.replace(/[^\w\s&\/-\u0600-\u06FF]/g, '');
    v = v.replace(/\s+/g, ' ').trim();
    // simple title case for latin scripts
    v = v.split(' ').map(w => (/[\u0600-\u06FF]/.test(w) ? w : (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))).join(' ');
    return v;
}

function getGenreTranslation(genreName) {
    if (!genreName) return '';
    const normalized = genreName.toLowerCase();
    if (normalized.includes('blues') || normalized.includes('jazz')) return t('genreBlues');
    if (normalized.includes('chill') || normalized.includes('lofi') || normalized.includes('lo-fi') || normalized.includes('chillhop') || normalized.includes('relaxing')) return t('genreChill');
    if (normalized.includes('classical') || normalized.includes('ambient') || normalized.includes('meditation')) return t('genreClassical');
    if (normalized.includes('acoustic') || normalized.includes('folk')) return t('genreAcoustic');
    if (normalized.includes('pop')) return t('genrePop');
    if (normalized.includes('dance') || normalized.includes('house')) return t('genreDance');
    if (normalized.includes('edm') || normalized.includes('trance')) return t('genreEDM');
    if (normalized.includes('drum') || normalized.includes('bass')) return t('genreDnB');
    if (normalized.includes('hip') || normalized.includes('r&b')) return t('genreHipHop');
    if (normalized.includes('rock') || normalized.includes('metal')) return t('genreMetal');
    if (normalized.includes('electronic') || normalized.includes('synthwave')) return t('genreElectronic');
    if (normalized.includes('latin') || normalized.includes('reggae') || normalized.includes('tropical')) return t('genreLatin');
    return genreName;
}

function showNotification(message, type = 'info') {
    if (isMiniWindowMode) return;
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const notif = document.createElement('div');
    notif.className = `notification notif-${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-triangle-exclamation';
    
    notif.innerHTML = `<i class="fas ${icon}"></i><div class="notif-content"><p style="margin: 0; font-size: 0.8rem;">${message}</p></div>`;
    
    document.body.appendChild(notif);
    setTimeout(() => { notif.classList.add('show'); }, 50);
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 400);
    }, 3000);
}

function showCustomDialog(title, message, onConfirm, showCancel = true) {
    if (isMiniWindowMode) return;
    const overlay = document.getElementById('dialogOverlay');
    const titleEl = document.getElementById('dialogTitle');
    const msgEl = document.getElementById('dialogMessage');
    const confirmBtn = document.getElementById('dialogConfirmBtn');
    const cancelBtn = document.getElementById('dialogCancelBtn');

    titleEl.innerText = title;
    msgEl.innerText = message;
    cancelBtn.style.display = showCancel ? 'block' : 'none';
    overlay.style.display = 'flex';

    const cleanUp = () => {
        overlay.style.display = 'none';
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    confirmBtn.onclick = () => { cleanUp(); if (onConfirm) onConfirm(); };
    cancelBtn.onclick = cleanUp;
}

function translatePage() {
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        const translatedText = t(key);
        if (translatedText && translatedText !== key) {
            const icon = el.querySelector('i');
            if (icon) {
                el.innerHTML = '';
                el.appendChild(icon);
                el.appendChild(document.createTextNode(' ' + translatedText));
            } else {
                el.innerText = translatedText;
            }
        }
    });

    document.querySelectorAll('[data-translate-placeholder]').forEach(el => {
        const key = el.getAttribute('data-translate-placeholder');
        el.placeholder = t(key);
    });

    document.querySelectorAll('[data-translate-title]').forEach(el => {
        const key = el.getAttribute('data-translate-title');
        el.title = t(key);
    });
}

// Player connection status helpers
window.updatePlayerConnectionUI = function(connected) {
    const el = document.getElementById('playerConnectionStatus');
    if (!el) return;
    if (connected) {
        el.textContent = currentLanguage === 'fa' ? 'متصل به پلیر' : 'Connected to player';
        el.classList.remove('disconnected');
        el.classList.add('connected');
    } else {
        el.textContent = currentLanguage === 'fa' ? 'به پلیر وصل نیست' : 'Player disconnected';
        el.classList.remove('connected');
        el.classList.add('disconnected');
    }
};

window.checkPlayerConnection = async function() {
    if (!apiPort) { window.updatePlayerConnectionUI(false); return; }
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, { method: 'GET', cache: 'no-cache' });
        if (res.ok) window.updatePlayerConnectionUI(true);
        else window.updatePlayerConnectionUI(false);
    } catch (err) {
        window.updatePlayerConnectionUI(false);
    }
};

// ===== Albums Functions =====

// Render albums grid view
function renderAlbums() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;

    if (tracks.length === 0) {
        mainSection.innerHTML = `<div class="empty-illustration-state"><i class="fa-solid fa-cubes"></i><h3>${t('emptyAlbumsState') || 'No Albums Found'}</h3><p>${t('emptyAlbumsDesc') || 'Add music to see your albums.'}</p></div>`;
        return;
    }

    // Group albums
    const albumsMap = new Map();
    tracks.forEach(track => {
        const albumName = track.album || 'Unknown Album';
        if (!albumsMap.has(albumName)) {
            albumsMap.set(albumName, { name: albumName, artist: track.artist, tracks: [], coverUrl: null });
        }
        const album = albumsMap.get(albumName);
        album.tracks.push(track);
        if (!album.coverUrl && track.hasCover) {
            album.coverUrl = `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover`;
        }
    });

    const albums = Array.from(albumsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    // Sliding window container with top/bottom controls
    mainSection.innerHTML = `
        <div class="spotify-row-title"><h3><i class="fa-solid fa-cubes"></i> ${t('albumsTitle') || 'Albums'} (${albums.length})</h3></div>
        <div id="loadPrevAlbumsContainer" style="text-align:center; margin-bottom:12px; display:none;"><button id="loadPrevAlbumsBtn">${currentLanguage === 'fa' ? 'آلبوم‌های قبلی...' : 'Load previous...'}</button></div>
        <div class="albums-grid" id="albumsGrid" style="min-height:200px;"></div>
        <div id="loadMoreAlbumsContainer" style="text-align:center; margin-top:18px;"><button id="loadMoreAlbumsBtn">${currentLanguage === 'fa' ? 'بارگذاری آلبوم‌های بیشتر...' : 'Load more albums...'}</button></div>
    `;

    const grid = document.getElementById('albumsGrid');
    const loadPrevContainer = document.getElementById('loadPrevAlbumsContainer');
    const loadPrevBtn = document.getElementById('loadPrevAlbumsBtn');
    const loadMoreContainer = document.getElementById('loadMoreAlbumsContainer');
    const loadMoreBtn = document.getElementById('loadMoreAlbumsBtn');

    const chunkSize = 24;
    const maxVisible = 48;

    let windowStart = 0;
    let windowEnd = Math.min(albums.length, chunkSize);

    function updateAlbumsDOM() {
        grid.innerHTML = '';
        const visibleChunk = albums.slice(windowStart, windowEnd);
        let html = '';
        visibleChunk.forEach(album => {
            const coverHtml = album.coverUrl ? `<img class="lazy-cover" data-src="${album.coverUrl}" alt="${escapeHtml(album.name)}" loading="lazy">` : '<i class="fa-solid fa-cubes"></i>';
            html += `
                <div class="album-card" data-album-name="${escapeHtml(album.name)}">
                    <div class="album-cover">${coverHtml}</div>
                    <div class="album-name truncate-text">${escapeHtml(album.name)}</div>
                    <div class="album-tracks-count">${album.tracks.length} ${t('tracksCount') || 'tracks'}</div>
                </div>
            `;
        });
        grid.innerHTML = html;

        // lazy images for visible cards
        try {
            const imgs = Array.from(grid.querySelectorAll('img.lazy-cover'));
            if ('IntersectionObserver' in window) {
                const obs = new IntersectionObserver((entries, observer) => {
                    entries.forEach(en => {
                        if (en.isIntersecting) {
                            const img = en.target;
                            if (img.dataset && img.dataset.src) img.src = img.dataset.src;
                            img.classList.remove('lazy-cover');
                            observer.unobserve(img);
                        }
                    });
                }, { rootMargin: '200px' });
                imgs.forEach(i => obs.observe(i));
            } else {
                imgs.forEach(i => { if (i.dataset && i.dataset.src) i.src = i.dataset.src; });
            }
        } catch (e) {}

        // show/hide prev button
        loadPrevContainer.style.display = windowStart > 0 ? 'block' : 'none';
        // show/hide load more button when there are more albums
        if (loadMoreContainer) {
            loadMoreContainer.style.display = windowEnd < albums.length ? 'block' : 'none';
        }
    }

    // Load more (forward)
    if (loadMoreBtn) {
        loadMoreBtn.onclick = () => {
            windowEnd = Math.min(albums.length, windowEnd + chunkSize);
            if (windowEnd - windowStart > maxVisible) {
                windowStart += chunkSize;
            }
            updateAlbumsDOM();
            grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
    }

    // Load previous (backward)
    if (loadPrevBtn) {
        loadPrevBtn.onclick = () => {
            windowStart = Math.max(0, windowStart - chunkSize);
            windowEnd = windowStart + maxVisible;
            if (windowEnd > albums.length) windowEnd = albums.length;
            updateAlbumsDOM();
            grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
    }

    // initial render
    updateAlbumsDOM();
}

// Show all tracks of a selected album
function showAlbumDetail(albumName) {
    const albumTracks = tracks.filter(track => (track.album || 'Unknown Album') === albumName);
    if (albumTracks.length === 0) return;

    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;

    let albumCover = null;
    for (const track of albumTracks) {
        if (track.hasCover) { albumCover = `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover`; break; }
    }

    const coverHtml = albumCover ? `<img src="${albumCover}" alt="${escapeHtml(albumName)}">` : '<i class="fa-solid fa-cubes"></i>';

    // Flat list structure instead of heavy tables
    let listHtml = '';
    albumTracks.forEach((track, index) => {
        const isActive = currentTrackId === track.id;
        const indexText = isActive && isPlaying ? '<i class="fa-solid fa-pause"></i>' : (index + 1);
        listHtml += `
            <li class="album-track-item ${isActive ? 'active' : ''}" data-track-id="${track.id}" data-track-index="${index}">
                <span class="track-index">${indexText}</span>
                <span class="track-title">${escapeHtml(track.title || 'Untitled')}</span>
                <span class="track-duration">${formatTime(track.duration)}</span>
            </li>`;
    });

    mainSection.innerHTML = `
        <div class="album-detail-view simple-album-view">
            <button class="back-to-albums-btn"><i class="fa-solid fa-arrow-right"></i> ${t('backToAlbums') || 'Back to Albums'}</button>
            <div class="album-header simple">
                <div class="album-header-cover">${coverHtml}</div>
                <div class="album-header-info">
                    <h2>${escapeHtml(albumName)}</h2>
                    <p>${albumTracks.length} ${t('tracksCount') || 'tracks'}</p>
                    <div><button class="play-album-btn"><i class="fa-solid fa-play"></i> ${t('playAlbum') || 'Play All'}</button></div>
                </div>
            </div>
            <div class="album-tracks-list"><ul class="album-track-list">${listHtml}</ul></div>
        </div>`;

    // Wire small action buttons programmatically and use delegation for list interactions
    const backBtn = mainSection.querySelector('.back-to-albums-btn');
    if (backBtn) backBtn.addEventListener('click', () => renderAlbums());
    const playAlbumBtn = mainSection.querySelector('.play-album-btn');
    if (playAlbumBtn) playAlbumBtn.addEventListener('click', () => playAlbum(albumName));

    // contextmenu delegation for list (kept local for accuracy)
    const listEl = mainSection.querySelector('.album-track-list');
    if (listEl) {
        listEl.addEventListener('contextmenu', (e) => {
            const li = e.target.closest && e.target.closest('li');
            if (!li) return;
            const id = parseInt(li.dataset.trackId);
            if (!id) return;
            e.preventDefault();
            showPlaylistContextMenu(id, e.clientX, e.clientY);
        });
    }
}


// Play entire album starting from first track
function playAlbum(albumName) {
    const albumTracks = tracks.filter(track => (track.album || 'Unknown Album') === albumName);
    if (albumTracks.length === 0) return;
    playTrack(albumTracks[0].id, 'album', albumName, albumTracks);
    showNotification(`${t('playingAlbum') || 'Playing'} ${albumName} (${albumTracks.length} ${t('tracks') || 'tracks'})`, 'success');
}

function updateBodyClasses() {
    const dirClass = currentLanguage === 'fa' ? 'rtl' : 'ltr';
    const skinClass = `theme-${currentSkin}`;
    const miniClass = isMiniWindowMode ? 'mini-window-active' : '';
    document.body.className = `${skinClass} ${dirClass} ${miniClass}`;
    // Apply direction to HTML elements
    document.documentElement.dir = currentLanguage === 'fa' ? 'rtl' : 'ltr';
    document.body.dir = currentLanguage === 'fa' ? 'rtl' : 'ltr';
}

function changeClientLanguage(targetLang) {
    currentLanguage = targetLang;
    localStorage.setItem('user_lang', targetLang);
    updateBodyClasses();
    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
        const span = langBtn.querySelector('span');
        if (span) span.innerText = targetLang === 'fa' ? 'EN' : 'FA';
    }
    translatePage();
    switchSection(currentActiveSection);
    renderQueue();
    if (typeof updateAITooltips === 'function') updateAITooltips();
}

function applyGlobalSkin(skinName) {
    if (skinName !== 'default' && skinName !== 'liquid-glass') skinName = 'default';
    currentSkin = skinName;
    localStorage.setItem('user_skin', skinName);
    updateBodyClasses();
}

// =============================================================================
// PLAYBACK CONTROL FUNCTIONS
// =============================================================================

function setPlayState(playing) {
    isPlaying = playing;
    
    window.isPlaying = playing;
    
    if (typeof syncWithMiniPlayerWidget === 'function') syncWithMiniPlayerWidget();
    if (typeof syncTrayPlaybackState === 'function') syncTrayPlaybackState();

    const mainBtn = document.getElementById('mainPlayBtn');
    if (mainBtn) mainBtn.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    
    const fsPlayBtn = document.getElementById('fsPlayBtn');
    if (fsPlayBtn) fsPlayBtn.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    
    const miniBtn = document.getElementById('miniPlayBtn');
    if (miniBtn) miniBtn.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    
    const mirrorBtnIcon = document.getElementById('fsMirrorPlayIcon');
    if (mirrorBtnIcon) mirrorBtnIcon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    
    const caseDisc = document.getElementById('fsAlbumArt');
    if (caseDisc) {
        if (playing) caseDisc.classList.add('playing');
        else caseDisc.classList.remove('playing');
    }
    
    const timelineBg = document.getElementById('progressBarK');
    if (timelineBg) {
        if (playing) timelineBg.classList.add('playing');
        else timelineBg.classList.remove('playing');
    }
    
    document.querySelectorAll('.track-row, .spotify-music-card').forEach(el => {
        const idAttr = parseInt(el.dataset.trackId);
        if (idAttr === currentTrackId) {
            const icon = el.querySelector('.hover-play-bubble i, .track-play-cell i');
            if (icon) icon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        }
    });
    
    if (playing) {
        if (lastVinylUpdateTime === 0) lastVinylUpdateTime = Date.now();
        if (!vinylRotationRAFId) {
            vinylRotationRAFId = requestAnimationFrame(() => updateVinylRotationRAF());
        }
        // Ensure timeline visualizer runs while playing
        try {
            startTimelineVisualizerLoop();
        } catch (e) { console.debug('startTimelineVisualizerLoop failed', e); }
    } else {
        if (vinylRotationRAFId) {
            cancelAnimationFrame(vinylRotationRAFId);
            vinylRotationRAFId = null;
        }
        // Pause visualizer when not playing
        try {
            if (visualizerIntervalId) { clearInterval(visualizerIntervalId); visualizerIntervalId = null; }
        } catch (e) { console.debug('Stopping visualizer failed', e); }
    }
}

function updateVinylRotation() {
    if (!isPlaying) return;
    
    const now = Date.now();
    if (lastVinylUpdateTime === 0) {
        lastVinylUpdateTime = now;
        return;
    }
    
    const delta = now - lastVinylUpdateTime;
    const rotationDelta = delta * 0.018;
    currentVinylRotation = (currentVinylRotation + rotationDelta) % 360;
    lastVinylUpdateTime = now;
    
    const vinylDisc = document.getElementById('fsAlbumArt');
    if (vinylDisc) {
        vinylDisc.style.transform = `rotate(${currentVinylRotation}deg)`;
    }
    
    const miniArtBox = document.querySelector('.mini-art-box');
    if (miniArtBox) {
        miniArtBox.style.transform = `rotate(${currentVinylRotation}deg)`;
    }
}

function updateVinylRotationRAF() {
    updateVinylRotation();
    if (isPlaying) {
        vinylRotationRAFId = requestAnimationFrame(() => updateVinylRotationRAF());
    }
}

function setVolume(v) {
    if (isMiniWindowMode) return;
    volume = parseFloat(v);
    if (audioElement) audioElement.volume = volume;
    const slider = document.getElementById('volumeSlider');
    if (slider) slider.value = volume;
    const icon = document.getElementById('volumeIcon');
    if (icon) {
        if (volume === 0 || isMuted) {
            icon.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        } else if (volume < 0.35) {
            icon.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
        } else {
            icon.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        }
    }
}

function toggleMute() {
    if (isMuted) {
        isMuted = false;
        setVolume(previousVolume);
    } else {
        previousVolume = volume;
        isMuted = true;
        setVolume(0);
    }
}

function toggleRepeat() {
    if (repeatOneMode) {
        repeatOneMode = false;
        repeatMode = false;
        showNotification('Repeat disabled', 'info');
    } else if (repeatMode) {
        repeatOneMode = true;
        repeatMode = true;
        showNotification('Repeat One (single track)', 'info');
    } else {
        repeatMode = true;
        repeatOneMode = false;
        showNotification('Repeat All (playlist)', 'info');
    }
    updateRepeatUI();
}

function updateRepeatUI() {
    const repeatBtn = document.getElementById('repeatBtnK');
    const fsRepeatBtn = document.getElementById('fsRepeatBtn');
    
    if (repeatBtn) {
        if (repeatOneMode) {
            repeatBtn.innerHTML = '<i class="fa-solid fa-repeat-1"></i>';
            repeatBtn.classList.add('active');
        } else if (repeatMode) {
            repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>';
            repeatBtn.classList.add('active');
        } else {
            repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>';
            repeatBtn.classList.remove('active');
        }
    }
    
    if (fsRepeatBtn) {
        if (repeatOneMode) {
            fsRepeatBtn.innerHTML = '<i class="fa-solid fa-repeat-1"></i>';
            fsRepeatBtn.classList.add('active');
        } else if (repeatMode) {
            fsRepeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>';
            fsRepeatBtn.classList.add('active');
        } else {
            fsRepeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>';
            fsRepeatBtn.classList.remove('active');
        }
    }
}

function seekTo(percent) {
    if (isMiniWindowMode) return;
    if (!audioElement || !audioElement.duration || isNaN(audioElement.duration)) return;
    
    percent = Math.min(100, Math.max(0, percent));
    const newTime = (percent / 100) * audioElement.duration;
    audioElement.currentTime = Math.min(audioElement.duration, Math.max(0, newTime));
    
    // Force visualizer update
    updateTimelineVisualizer();
}

function handleMirrorSeek(event) {
    const bar = document.getElementById('fsMirrorProgressContainer');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    let clickX = event.clientX - rect.left;
    clickX = Math.max(0, Math.min(rect.width, clickX));
    const percent = (clickX / rect.width) * 100;
    seekTo(percent);
}

window.seekFromMini = function(event) {
    const bar = event.currentTarget;
    const rect = bar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percent = (clickX / rect.width) * 100;
    if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
        window.electronAPI.controlFromMini(`seek:${percent}`);
    }
};

// =============================================================================
// FIXED SHUFFLE FUNCTIONS
// =============================================================================

function initShuffleSession() {
    if (!shuffleMode) return;
    
    console.debug('🔄 Initializing shuffle session...');
    
    // Get the current source tracks (library, playlist, favorites, etc.)
    let baseTracks = [];
    
    if (lastPlaySource.type === 'playlist' && lastPlaySource.sourceTracks) {
        baseTracks = [...lastPlaySource.sourceTracks];
    } else if (lastPlaySource.type === 'favorites' && lastPlaySource.sourceTracks) {
        baseTracks = [...lastPlaySource.sourceTracks];
    } else if (lastPlaySource.type === 'artists' && lastPlaySource.sourceTracks) {
        baseTracks = [...lastPlaySource.sourceTracks];
    } else {
        baseTracks = [...tracks];
    }
    
    if (baseTracks.length === 0) return;
    
    // Backup original queue if not already backed up
    if (!shuffleSessionActive || originalQueueBackup.length === 0) {
        originalQueueBackup = queue.length > 0 ? [...queue] : [...baseTracks];
    }
    
    // Create shuffled queue
    let shuffled = [...baseTracks];
    const currentTrackObj = currentTrackId ? shuffled.find(t => t.id === currentTrackId) : null;
    
    // Remove current track from shuffled list if present
    if (currentTrackObj) {
        shuffled = shuffled.filter(t => t.id !== currentTrackId);
    }
    
    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Build new queue with current track first
    if (currentTrackObj) {
        queue = [currentTrackObj, ...shuffled];
        queueIndex = 0;
    } else if (currentTrackId) {
        // Current track not in source? Keep it at beginning
        const fakeCurrent = { id: currentTrackId, title: currentTrack?.title || 'Unknown' };
        queue = [fakeCurrent, ...shuffled];
        queueIndex = 0;
    } else {
        queue = shuffled;
        queueIndex = 0;
    }
    
    shuffleHistory = [];
    remainingUnplayedTracks = queue.filter(t => t.id !== currentTrackId).map(t => t.id);
    shuffleSessionActive = true;
    
    renderQueue();
    console.debug(`✅ Shuffle queue generated with ${queue.length} tracks.`);
}

function resetShuffleSession() {
    if (originalQueueBackup.length > 0) {
        queue = [...originalQueueBackup];
        if (currentTrackId) {
            const originalIdx = queue.findIndex(t => t.id === currentTrackId);
            if (originalIdx !== -1) queueIndex = originalIdx;
            else queueIndex = 0;
        } else {
            queueIndex = 0;
        }
        originalQueueBackup = [];
    } else if (lastPlaySource.sourceTracks) {
        // Restore from original source
        queue = [...lastPlaySource.sourceTracks];
        queueIndex = queue.findIndex(t => t.id === currentTrackId);
        if (queueIndex === -1) queueIndex = 0;
    }
    shuffleHistory = [];
    remainingUnplayedTracks = [];
    shuffleSessionActive = false;
    renderQueue();
    console.debug('🔀 Shuffle disabled. Restored original queue.');
}

function toggleShuffleEnhanced() {
    if (preferredGenreMode) {
        preferredGenreMode = false;
        preferredGenreHistory = [];
        updatePreferredGenreUI();
    }

    shuffleMode = !shuffleMode;
    
    const shuffleBtn = document.getElementById('shuffleBtnK');
    if (shuffleBtn) shuffleBtn.classList.toggle('active', shuffleMode);
    
    const fsShuffleBtn = document.getElementById('fsShuffleBtn');
    if (fsShuffleBtn) fsShuffleBtn.classList.toggle('active', shuffleMode);
    
    if (shuffleMode) {
        initShuffleSession();
        showNotification(currentLanguage === 'fa' ? 'پخش تصادفی فعال شد' : 'Shuffle enabled', 'success');
    } else {
        resetShuffleSession();
        showNotification(currentLanguage === 'fa' ? 'پخش تصادفی غیرفعال شد' : 'Shuffle disabled', 'info');
    }
}

window.toggleShuffle = toggleShuffleEnhanced;
window.togglePreferredGenreMode = togglePreferredGenreMode;

function updatePreferredGenreUI() {
    const preferredGenreBtn = document.getElementById('preferredGenreBtn');
    if (preferredGenreBtn) preferredGenreBtn.classList.toggle('active', preferredGenreMode);
}

function getTopPreferredGenres(limit = 3) {
    const genreScores = {};
    tracks.forEach(track => {
        const genre = normalizeGenreLabel(track.genre || '');
        if (!genre) return;
        const score = (track.isLiked ? 6 : 0) + ((track.likeCount || 0) * 1.4) + ((track.playCount || 0) * 0.35);
        genreScores[genre] = (genreScores[genre] || 0) + score;
    });
    return Object.entries(genreScores)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([genre]) => genre);
}

function getNextPreferredGenreTrack() {
    if (!preferredGenreMode) return null;
    const sourceTracks = Array.isArray(lastPlaySource.sourceTracks) && lastPlaySource.sourceTracks.length ? lastPlaySource.sourceTracks : [...tracks];
    const currentGenre = normalizeGenreLabel(currentTrack?.genre || '');
    const topGenres = getTopPreferredGenres(4);
    let candidates = sourceTracks.filter(t => t.id !== currentTrackId && t.genre && topGenres.includes(normalizeGenreLabel(t.genre)));
    if (currentGenre && topGenres.includes(currentGenre)) {
        const sameGenre = candidates.filter(t => normalizeGenreLabel(t.genre) === currentGenre);
        if (sameGenre.length > 0) candidates = sameGenre;
    }
    if (candidates.length === 0) {
        candidates = sourceTracks.filter(t => t.id !== currentTrackId);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

function initPreferredGenreSession() {
    if (!preferredGenreMode) return;
    setPlaySource(lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
    preferredGenreHistory = [];
    if (currentTrackId) {
        const idx = queue.findIndex(t => t.id === currentTrackId);
        queueIndex = idx !== -1 ? idx : 0;
    } else {
        queueIndex = 0;
    }
    renderQueue();
}

function togglePreferredGenreMode() {
    preferredGenreMode = !preferredGenreMode;
    if (preferredGenreMode) {
        if (shuffleMode) {
            shuffleMode = false;
            resetShuffleSession();
        }
        preferredGenreHistory = [];
        initPreferredGenreSession();
        showNotification(currentLanguage === 'fa' ? 'حالت سبک محبوب فعال شد' : 'Preferred genre playback enabled', 'success');
    } else {
        preferredGenreHistory = [];
        showNotification(currentLanguage === 'fa' ? 'حالت سبک محبوب غیرفعال شد' : 'Preferred genre playback disabled', 'info');
    }
    updatePreferredGenreUI();
}

// Get next shuffle track
function getNextShuffleTrack() {
    if (!shuffleMode || !shuffleSessionActive) return null;
    
    const unplayed = queue.filter(t => t.id !== currentTrackId && !shuffleHistory.includes(t.id));
    
    if (unplayed.length === 0) {
        shuffleHistory = [];
        const remaining = queue.filter(t => t.id !== currentTrackId);
        if (remaining.length === 0) return null;
        const randomIndex = Math.floor(Math.random() * remaining.length);
        return remaining[randomIndex];
    }
    
    const randomIndex = Math.floor(Math.random() * unplayed.length);
    return unplayed[randomIndex];
}

// =============================================================================
// QUEUE MANAGEMENT
// =============================================================================

function setPlaySource(sourceType, sourceId = null, sourceTracksArray = null) {
    lastPlaySource = {
        type: sourceType,
        sourceId: sourceId,
        sourceTracks: sourceTracksArray ? [...sourceTracksArray] : null
    };
    
    if (sourceType === 'library') {
        queue = [...tracks];
    } else if (sourceType === 'playlist' && sourceTracksArray) {
        queue = [...sourceTracksArray];
    } else if (sourceType === 'favorites' && sourceTracksArray) {
        queue = [...sourceTracksArray];
    } else if (sourceType === 'artists' && sourceTracksArray) {
        queue = [...sourceTracksArray];
    } else {
        queue = [...tracks];
    }
    
    renderQueue();
}

function renderQueue() {
    const listEl = document.getElementById('queueList');
    if (!listEl) return;
    if (queue.length === 0) {
        listEl.innerHTML = `<p class="queue-empty">${currentLanguage === 'fa' ? 'صف پخش خالی است' : 'Play queue is empty'}</p>`;
        return;
    }
    let html = '';
    queue.forEach((track, idx) => {
        html += `<div class="queue-drawer-item ${idx === queueIndex ? 'active' : ''}" data-idx="${idx}" onclick="playFromQueue(${idx})">
            <span class="queue-index-no">${idx + 1}</span>
            <div class="queue-meta-data">
                <h5>${escapeHtml(track.title || 'Untitled')}</h5>
                <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
            </div>
            <button class="remove-from-queue-btn" onclick="event.stopPropagation(); removeFromQueue(${idx});">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>`;
    });
    listEl.innerHTML = html;
    // highlight recently focused item (gentle pulse)
    try {
        const recentEl = listEl.querySelector(`.queue-drawer-item[data-idx="${queueIndex}"]`);
        if (recentEl) {
            recentEl.classList.add('recent');
            setTimeout(() => recentEl.classList.remove('recent'), 900);
        }
    } catch (e) { /* ignore */ }
}

// ripple helper for hero buttons
function createRipple(e, el) {
    const rect = el.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 1.2;
    span.style.width = span.style.height = size + 'px';
    span.style.left = (e.clientX - rect.left - size / 2) + 'px';
    span.style.top = (e.clientY - rect.top - size / 2) + 'px';
    el.appendChild(span);
    setTimeout(() => { try { el.removeChild(span); } catch{} }, 650);
}

document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest && e.target.closest('.hero-btn');
    if (btn) createRipple(e, btn);
});

function playFromQueue(idx) {
    if (idx >= 0 && idx < queue.length) {
        queueIndex = idx;
        playTrack(queue[idx].id);
    }
}

let emergencyRecoveryInProgress = false;

async function emergencyAudioRecovery() {
    if (emergencyRecoveryInProgress) return;
    emergencyRecoveryInProgress = true;
    
    console.warn('🚨 Emergency audio recovery triggered');
    
    try {
        // Force stop all audio
        if (audioElement) {
            try {
                audioElement.pause();
                audioElement.src = '';
                audioElement.load();
            } catch (e) {}
        }
        
        // Close and recreate AudioContext
        if (window.audioCtx && window.audioCtx.state !== 'closed') {
            try {
                await window.audioCtx.close();
            } catch (e) {}
        }
        
        // Reset all references
        window.audioCtx = null;
        window.audioSource = null;
        window.gainNode = null;
        window.analyser = null;
        window.eqFilters = [];
        
        // Reset state
        setPlayState(false);
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Reinitialize audio
        initAudio();
        
        // If there was a current track, try to play it
        if (currentTrackId) {
            await new Promise(resolve => setTimeout(resolve, 200));
            await playTrack(currentTrackId);
        }
        
        showNotification('Audio system recovered', 'success');
        
    } catch (e) {
        console.error('Emergency recovery failed:', e);
        showNotification('Audio system error. Please restart the app.', 'error');
    } finally {
        emergencyRecoveryInProgress = false;
    }
}

// Listen for audio element errors that might require recovery
if (audioElement) {
    audioElement.addEventListener('error', (e) => {
        console.error('Audio element error:', e);
        if (audioElement.error) {
            const errorCode = audioElement.error.code;
            // MEDIA_ERR_DECODE (3) or MEDIA_ERR_SRC_NOT_SUPPORTED (4)
            if (errorCode === 3 || errorCode === 4) {
                console.warn('Media decode error, attempting recovery...');
                setTimeout(() => emergencyAudioRecovery(), 500);
            }
        }
    });
}

function removeFromQueue(idx) {
    queue.splice(idx, 1);
    if (idx < queueIndex) {
        queueIndex--;
    } else if (idx === queueIndex) {
        if (queue.length > 0) {
            queueIndex = Math.min(queueIndex, queue.length - 1);
            playTrack(queue[queueIndex].id);
        } else {
            queueIndex = -1;
            currentTrackId = null;
            currentTrack = null;
            if (audioElement) {
                audioElement.pause();
                setPlayState(false);
            }
        }
    }
    renderQueue();
}

function toggleQueue() {
    isQueueOpen = !isQueueOpen;
    const panel = document.getElementById('queuePanel');
    if (panel) panel.classList.toggle('open', isQueueOpen);
}

// =============================================================================
// FULLSCREEN & MINI PLAYER
// =============================================================================

function toggleFullscreen() {
    isFullscreenPlayerOpen = !isFullscreenPlayerOpen;
    const player = document.getElementById('fullscreenPlayer');
    const fsBg = document.getElementById('fsBgBlur');
    if (!player) return;

    if (isFullscreenPlayerOpen) {
        // Open: cancel any closing state and show
        player.classList.remove('closing');
        player.classList.add('open');
        if (fsBg) {
            fsBg.classList.remove('closing');
            fsBg.classList.add('show');
        }
    } else {
        // Close: play closing animation then remove open state
        player.classList.add('closing');
        if (fsBg) {
            fsBg.classList.remove('show');
            fsBg.classList.add('closing');
        }
        setTimeout(() => {
            player.classList.remove('open');
            player.classList.remove('closing');
            if (fsBg) fsBg.classList.remove('closing');
        }, 480);
    }
}

function toggleMiniPlayer() {
    if (window.electronAPI && typeof window.electronAPI.openMiniPlayer === 'function') {
        window.electronAPI.openMiniPlayer(currentTrack, isPlaying);
    } else {
        isMiniPlayerOpen = !isMiniPlayerOpen;
        const card = document.getElementById('miniplayerCard');
        const appContainer = document.getElementById('appContainer');
        
        if (isMiniPlayerOpen) {
            if (card) card.style.display = 'block';
            setTimeout(() => { if (card) card.classList.add('show'); }, 50);
            if (appContainer) appContainer.classList.add('mini-mode-active');
        } else {
            if (card) card.classList.remove('show');
            setTimeout(() => { if (card) card.style.display = 'none'; }, 360);
            if (appContainer) appContainer.classList.remove('mini-mode-active');
        }
    }
}

// =============================================================================
// FIXED NEXT & PREV TRACK FUNCTIONS
// =============================================================================

let isTransitioning = false; // Prevent rapid next/prev during transitions

async function nextTrackEnhanced() {
    if (isMiniWindowMode) {
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('next');
        }
        return;
    }
    
    // Prevent rapid successive calls
    if (isTransitioning) {
        console.debug('⏳ Transition in progress, ignoring next track request');
        return;
    }
    
    // Repeat One mode
    if (repeatOneMode && currentTrackId) {
        if (audioElement) {
            audioElement.currentTime = 0;
            if (!isPlaying) {
                try {
                    await audioElement.play();
                    setPlayState(true);
                } catch (e) {
                    console.debug('Error replaying track:', e);
                }
            }
        }
        return;
    }
    
    isTransitioning = true;
    
    try {
        // Preferred genre mode
        if (preferredGenreMode) {
            const nextTrackObj = getNextPreferredGenreTrack();
            if (nextTrackObj) {
                if (currentTrackId) preferredGenreHistory.push(currentTrackId);
                await playTrack(nextTrackObj.id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
                return;
            }
        }

        // Shuffle mode
        if (shuffleMode && shuffleSessionActive) {
            if (queue.length > 0) {
                if (queueIndex < queue.length - 1) {
                    queueIndex += 1;
                    await playTrack(queue[queueIndex].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
                    return;
                }
                if (repeatMode && !repeatOneMode) {
                    queueIndex = 0;
                    await playTrack(queue[queueIndex].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
                    return;
                }
            }
        }
        
        // Normal queue mode
        if (queue.length === 0 && tracks.length > 0) {
            queue = [...tracks];
            queueIndex = -1;
        }
        
        if (queue.length > 0) {
            if (queueIndex < queue.length - 1) {
                queueIndex++;
                await playTrack(queue[queueIndex].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
            } else if (repeatMode && !repeatOneMode) {
                queueIndex = 0;
                await playTrack(queue[0].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
            } else {
                setPlayState(false);
            }
        }
    } catch (err) {
        console.error('Error in nextTrackEnhanced:', err);
        showNotification('Error changing track', 'warning');
    } finally {
        // Small delay before allowing next transition
        setTimeout(() => {
            isTransitioning = false;
        }, 500);
    }
}

async function prevTrackEnhanced() {
    if (isMiniWindowMode) {
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('prev');
        }
        return;
    }
    
    // Prevent rapid successive calls
    if (isTransitioning) {
        console.debug('⏳ Transition in progress, ignoring previous track request');
        return;
    }
    
    // If current time > 3 seconds, just seek to start
    if (audioElement && audioElement.currentTime > 3) {
        audioElement.currentTime = 0;
        return;
    }
    
    isTransitioning = true;
    
    try {
        // Preferred genre mode
        if (preferredGenreMode && preferredGenreHistory.length > 0) {
            const prevTrackId = preferredGenreHistory.pop();
            if (prevTrackId) {
                await playTrack(prevTrackId, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
                return;
            }
        }

        // Shuffle mode
        if (shuffleMode && shuffleSessionActive) {
            if (queue.length > 0) {
                if (queueIndex > 0) {
                    queueIndex -= 1;
                    await playTrack(queue[queueIndex].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
                    return;
                }
                if (repeatMode) {
                    queueIndex = queue.length - 1;
                    await playTrack(queue[queueIndex].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
                    return;
                }
            }
        }
        
        // Normal queue mode
        if (queue.length === 0 && tracks.length > 0) {
            queue = [...tracks];
            queueIndex = 0;
        }
        
        if (queue.length > 0) {
            if (queueIndex > 0) {
                queueIndex--;
                await playTrack(queue[queueIndex].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
            } else if (repeatMode) {
                queueIndex = queue.length - 1;
                await playTrack(queue[queueIndex].id, lastPlaySource.type, lastPlaySource.sourceId, lastPlaySource.sourceTracks);
            }
        }
    } catch (err) {
        console.error('Error in prevTrackEnhanced:', err);
    } finally {
        setTimeout(() => {
            isTransitioning = false;
        }, 500);
    }
}

window.nextTrack = nextTrackEnhanced;
window.prevTrack = prevTrackEnhanced;

// =============================================================================
// GAEPLESS & CROSSFADE FUNCTIONS
// =============================================================================

function setGaplessMode(enabled) {
    gaplessEnabled = enabled;
    if (window.electronAPI && window.electronAPI.setPlaybackSettings) {
        window.electronAPI.setPlaybackSettings({ gapless: enabled, crossfade: crossfadeDuration });
    }
    showNotification(gaplessEnabled ? 'Gapless playback enabled' : 'Gapless playback disabled', 'info');
}

function setCrossfadeMode(duration) {
    crossfadeDuration = Math.min(12, Math.max(0, duration));
    if (window.electronAPI && window.electronAPI.setCrossfade) {
        window.electronAPI.setCrossfade(crossfadeDuration);
    }
    showNotification(`Crossfade set to ${crossfadeDuration} seconds`, 'success');
}

// =============================================================================
// AUDIO INITIALIZATION
// =============================================================================

function initAudio() {
    if (audioElement) return;
    
    audioElement = new Audio();
    audioElement.crossOrigin = "anonymous";
    audioElement.volume = volume;
    window.audioElement = audioElement;
    
    // Set up Web Audio graph once (EQ, analyser, etc.)
    // Attach listeners and set up audio graph
    setupAudioNodes();
}

function setupAudioNodes() {
    try {
        if (!audioElement) {
            console.debug('No audio element, cannot setup audio nodes');
            return false;
        }

        function attachAudioElementListeners(el) {
            if (!el) return;
            if (el._koraiListenersAttached) return;

            el.addEventListener('timeupdate', () => {
                const now = Date.now();
                if (now - lastAudioTimeUpdateTime < 60) return;
                lastAudioTimeUpdateTime = now;

                const current = el.currentTime;
                const total = el.duration || 0;
                const currentText = document.getElementById('currentTimeK');
                if (currentText) currentText.innerText = formatTime(current);

                const fill = document.getElementById('progressFillK');
                if (fill && total > 0) fill.style.width = `${(current / total) * 100}%`;

                const fsFill = document.getElementById('fsMirrorProgressFill');
                if (fsFill && total > 0) fsFill.style.width = `${(current / total) * 100}%`;

                if (sleepTimeRemaining > 0) {
                    const nowMs = Date.now();
                    if (nowMs - lastSleepUpdateTime >= 1000) {
                        lastSleepUpdateTime = nowMs;
                        sleepTimeRemaining--;
                        const display = document.getElementById('sleepTimerVal');
                        if (display) display.innerText = formatTime(sleepTimeRemaining);
                        if (sleepTimeRemaining <= 60 && sleepTimeRemaining > 0) {
                            const fadeVolume = (sleepTimeRemaining / 60) * volume;
                            if (el) el.volume = fadeVolume;
                        }
                        if (sleepTimeRemaining <= 0) cancelSleepTimer();
                    }
                }

                if (typeof syncWithMediaSessionPosition === 'function') syncWithMediaSessionPosition();
                if (typeof syncWithMiniPlayerWidget === 'function') syncWithMiniPlayerWidget();
                try {
                    const now = Date.now();
                    if (now - lastPlaybackSaveTime > 5000) {
                        lastPlaybackSaveTime = now;
                        savePlaybackState();
                    }
                } catch (e) { console.debug('Playback save failed', e); }
            });

            el.addEventListener('loadedmetadata', () => {
                const totalText = document.getElementById('durationK');
                if (totalText) totalText.innerText = formatTime(el.duration);
                const savedState = JSON.parse(localStorage.getItem('korai_playback_state') || '{}');
                if (savedState && savedState.trackId === currentTrackId && savedState.currentTime > 0) {
                    if (el.duration > savedState.currentTime) {
                        el.currentTime = savedState.currentTime;
                    }
                }
            });

            el.addEventListener('ended', () => {
                nextTrackEnhanced();
            });

            el.addEventListener('error', (e) => {
                console.error('Audio error:', e);
                showNotification('Audio file not found or access denied', 'error');
                setPlayState(false);
            });

            el._koraiListenersAttached = true;
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!window.audioCtx || window.audioCtx.state === 'closed') {
            window.audioCtx = new AudioContextClass();
        }

        if (window.audioSource) {
            try {
                window.audioSource.disconnect();
                window.audioSource = null;
            } catch (e) {
                console.debug('Error disconnecting audio source:', e);
            }
        }

        if (window.gainNode) {
            try {
                window.gainNode.disconnect();
                window.gainNode = null;
            } catch (e) {
                console.debug('Error disconnecting gain node:', e);
            }
        }

        if (window.analyser) {
            try {
                window.analyser.disconnect();
                window.analyser = null;
            } catch (e) {
                console.debug('Error disconnecting analyser:', e);
            }
        }

        if (window.eqFilters && window.eqFilters.length) {
            window.eqFilters.forEach(filter => {
                try {
                    if (filter) filter.disconnect();
                } catch (e) {}
            });
            window.eqFilters = [];
        }

        try { attachAudioElementListeners(audioElement); } catch (e) { console.debug('attachAudioElementListeners failed', e); }

        try {
            if (audioElement._koraiSourceNode) {
                try {
                    audioElement._koraiSourceNode.disconnect();
                } catch (e) {}
                audioElement._koraiSourceNode = null;
            }
            window.audioSource = window.audioCtx.createMediaElementSource(audioElement);
            audioElement._koraiSourceNode = window.audioSource;
        } catch (e) {
            console.warn('createMediaElementSource failed, attempting to recreate <audio> element:', e);
            try {
                const old = audioElement;
                const newEl = new Audio();
                newEl.crossOrigin = old.crossOrigin || 'anonymous';
                newEl.volume = old.volume || volume;
                newEl.muted = old.muted || false;
                if (old.src) {
                    newEl.src = old.src;
                }
                if (old.currentTime > 0) {
                    newEl.currentTime = old.currentTime;
                }
                window.audioElement = newEl;
                audioElement = window.audioElement;
                window.audioElement._koraiReplaced = true;
                attachAudioElementListeners(window.audioElement);
                try {
                    window.audioSource = window.audioCtx.createMediaElementSource(window.audioElement);
                    window.audioElement._koraiSourceNode = window.audioSource;
                } catch (e2) {
                    console.error('Recreate audio element and source failed:', e2);
                    return false;
                }
            } catch (e2) {
                console.error('Recreate audio element and source failed:', e2);
                return false;
            }
        }

        window.gainNode = window.audioCtx.createGain();
        window.analyser = window.audioCtx.createAnalyser();
        window.analyser.fftSize = 256;

        let currentNode = window.audioSource;
        window.eqFilters = eqBands.map((freq, idx) => {
            const filter = window.audioCtx.createBiquadFilter();
            if (idx === 0) filter.type = 'lowshelf';
            else if (idx === eqBands.length - 1) filter.type = 'highshelf';
            else filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.0;
            filter.gain.value = 0;

            currentNode.connect(filter);
            currentNode = filter;
            return filter;
        });

        currentNode.connect(window.analyser);
        window.analyser.connect(window.gainNode);
        window.gainNode.connect(window.audioCtx.destination);

        console.debug('✅ Audio nodes setup complete');
        return true;

    } catch (e) {
        console.warn("AudioContext setup failed:", e);
        return false;
    }
}

// =============================================================================
// FIXED TIMELINE VISUALIZER
// =============================================================================

let lastVisualizerUpdate = 0;
let visualizerFrameId = null;
let visualizerIntervalId = null;
let visualizerBars = [];

function initTimelineVisualizer() {
    const timelineBg = document.getElementById('progressBarK');
    if (!timelineBg) return;
    
    // Remove existing visualizer if any to prevent duplication
    let visualizerContainer = timelineBg.querySelector('.timeline-visualizer');
    if (visualizerContainer) {
        visualizerContainer.remove();
    }
    
    // Create new visualizer container
    visualizerContainer = document.createElement('div');
    visualizerContainer.className = 'timeline-visualizer';
    timelineBg.appendChild(visualizerContainer);
    
    // Calculate number of bars based on container width (1 bar per ~8px)
    let containerWidth = timelineBg.clientWidth;
    if (containerWidth === 0) {
        // Fallback if element is not visible yet
        containerWidth = window.innerWidth - 400;
    }
    const totalBars = Math.min(80, Math.max(30, Math.floor(containerWidth / 8)));
    
    // Create bars
    for (let i = 0; i < totalBars; i++) {
        const bar = document.createElement('div');
        bar.className = 'timeline-v-bar';
        bar.style.height = '2px';
        visualizerContainer.appendChild(bar);
    }
    
    // Update global reference
    visualizerBars = Array.from(visualizerContainer.querySelectorAll('.timeline-v-bar'));
    console.debug('Timeline visualizer initialized with', visualizerBars.length, 'bars');
}

function updateTimelineVisualizer() {
    // Make sure visualizer bars exist, if not re-initialize
    if (!visualizerBars || visualizerBars.length === 0) {
        initTimelineVisualizer();
        if (!visualizerBars || visualizerBars.length === 0) {
            console.debug('Visualizer bars still empty after init - skipping update');
            return;
        }
    }
    
    const now = Date.now();
    if (now - lastVisualizerUpdate < 60) return;
    lastVisualizerUpdate = now;
    
    // Get playback percentage safely
    let pct = 0;
    if (audioElement && audioElement.duration && audioElement.duration > 0 && !isNaN(audioElement.duration) && isFinite(audioElement.duration)) {
        pct = (audioElement.currentTime / audioElement.duration) * 100;
    } else {
        // If duration is not ready yet, just update idle animation
        for (let i = 0; i < visualizerBars.length; i++) {
            const bar = visualizerBars[i];
            if (bar) {
                let height = 3 + Math.sin(Date.now() * 0.005 + i * 0.2) * 2;
                height = Math.max(2, Math.min(28, height));
                bar.style.height = `${height}px`;
            }
        }
        return;
    }
    
    // Clamp percentage
    pct = Math.min(100, Math.max(0, pct));
    
    const totalBars = visualizerBars.length;
    const playedBarIndex = Math.floor((pct / 100) * totalBars);
    
    // Get frequency data for active visualization if playing and analyser exists
    let dataArray = null;
    if (window.analyser && isPlaying) {
        try {
            const bufferLength = window.analyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);
            window.analyser.getByteFrequencyData(dataArray);
        } catch (e) {
            // Silently fail - analyser might not be ready
        }
    }
    
    // Update each bar
    for (let i = 0; i < totalBars; i++) {
        const bar = visualizerBars[i];
        if (!bar) continue;
        
        let height = 3;
        
        if (dataArray && dataArray.length > 0 && isPlaying) {
            // Map bar index to frequency bin for dynamic visualization
            const binIndex = Math.min(dataArray.length - 1, Math.floor((i / totalBars) * dataArray.length * 0.65));
            const value = dataArray[binIndex] || 0;
            height = 3 + (value / 255) * 25;
        } else {
            // Idle animation when paused or no analyser data
            height = 3 + Math.sin(Date.now() * 0.005 + i * 0.2) * 2;
        }
        
        // Clamp height
        height = Math.max(2, Math.min(28, height));
        bar.style.height = `${height}px`;
        
        // Mark played portion
        if (i < playedBarIndex) {
            bar.classList.add('played');
        } else {
            bar.classList.remove('played');
        }
    }
    
    // Also update the progress fill bar for redundancy
    const fill = document.getElementById('progressFillK');
    if (fill && audioElement && audioElement.duration > 0) {
        fill.style.width = `${pct}%`;
    }
    
    const fsFill = document.getElementById('fsMirrorProgressFill');
    if (fsFill && audioElement && audioElement.duration > 0) {
        fsFill.style.width = `${pct}%`;
    }
}


function handleTimelineSeek(event) {
    if (!audioElement || !audioElement.duration || isNaN(audioElement.duration)) return;
    
    const timelineBg = document.getElementById('progressBarK');
    if (!timelineBg) return;
    
    const rect = timelineBg.getBoundingClientRect();
    let clickX = event.clientX - rect.left;
    
    // Clamp to bounds
    clickX = Math.max(0, Math.min(rect.width, clickX));
    const percent = (clickX / rect.width) * 100;
    const newTime = (percent / 100) * audioElement.duration;
    
    audioElement.currentTime = Math.min(audioElement.duration, Math.max(0, newTime));
}

function startTimelineVisualizerLoop() {
    // Clear any existing intervals
    if (visualizerIntervalId) {
        clearInterval(visualizerIntervalId);
        visualizerIntervalId = null;
    }
    if (visualizerFrameId) {
        cancelAnimationFrame(visualizerFrameId);
        visualizerFrameId = null;
    }
    
    // Initialize visualizer bars
    initTimelineVisualizer();
    
    // Use interval instead of RAF for better performance and stability
    visualizerIntervalId = setInterval(() => {
        // Always try to update, even if visualizerBars is empty
        if (!visualizerBars || visualizerBars.length === 0) {
            initTimelineVisualizer();
        }
        updateTimelineVisualizer();
    }, 60); // ~16 FPS, smooth enough
    console.debug('Timeline visualizer loop started (interval id)', visualizerIntervalId);
}

// Make sure to call init on window resize as well
window.addEventListener('resize', () => {
    if (currentActiveSection && visualizerIntervalId) {
        initTimelineVisualizer();
    }
});

// =============================================================================
// MEDIA SESSION INTEGRATION
// =============================================================================

function syncWithWindowsMediaSystem() {
    try {
        if ('mediaSession' in navigator && currentTrack) {
            let coverUrl = currentTrack.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/cover?t=${currentTrack.updatedAt || currentTrack.id}` : null;
            const artworkArray = coverUrl ? [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [];
            
            navigator.mediaSession.metadata = new MediaMetadata({
                title: currentTrack.title || 'Untitled',
                artist: currentTrack.artist || 'Unknown Artist',
                album: currentTrack.album || 'KORAI Library',
                artwork: artworkArray
            });
            navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        }
    } catch (error) {
        console.warn('MediaSession error:', error);
    }
}

function syncWithMediaSessionPosition() {
    if ('mediaSession' in navigator && audioElement && audioElement.duration) {
        try {
            navigator.mediaSession.setPositionState({
                duration: audioElement.duration,
                playbackRate: audioElement.playbackRate || 1,
                position: audioElement.currentTime
            });
        } catch (e) {}
    }
}

function syncWithMiniPlayerWidget() {
    if (!isMiniWindowMode && window.electronAPI && typeof window.electronAPI.syncStateToMini === 'function') {
        window.electronAPI.syncStateToMini({
            track: currentTrack,
            isPlaying: isPlaying,
            apiPort: apiPort,
            currentTime: audioElement ? audioElement.currentTime : 0,
            duration: audioElement ? audioElement.duration : 0,
            volume: volume,
            rotationAngle: currentVinylRotation
        });
    }
}

function syncTrayPlaybackState() {
    if (window.electronAPI && typeof window.electronAPI.syncTrayState === 'function') {
        window.electronAPI.syncTrayState({
            isPlaying: isPlaying,
            track: currentTrack
        });
    }
}

// =============================================================================
// DSP FUNCTIONS (EQ, TEMPO, PITCH)
// =============================================================================

function updateEqualizerBand(index, dbValue) {
    if (eqFilters[index]) {
        eqFilters[index].gain.value = parseFloat(dbValue);
        const display = document.getElementById(`eqVal${index}`);
        if (display) display.innerText = `${dbValue > 0 ? '+' : ''}${dbValue}dB`;
    }
}

function updatePlaybackSpeed(rate) {
    if (audioElement) {
        audioElement.playbackRate = parseFloat(rate);
        const display = document.getElementById('tempoVal');
        if (display) display.innerText = `${parseFloat(rate).toFixed(2)}x`;
    }
}

function togglePitchPreservation(preserve) {
    if (audioElement) {
        audioElement.preservesPitch = preserve;
    }
}

// =============================================================================
// SPECTRUM ANALYZER
// =============================================================================

let isSpectrumLoopActive = false;
let spectrumGradient = null;  // Cache gradient
let spectrumIntervalId = null;

function startLiveSpectrumAnalyzer() {
    if (isSpectrumLoopActive) return;
    const canvas = document.getElementById('telemetrySpectrumCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    isSpectrumLoopActive = true;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    // Reduce canvas resolution and throttle draw loop to ~20 FPS
    const scaleFactor = (window.devicePixelRatio || 1) * 0.5;
    function createGradient() {
        spectrumGradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        spectrumGradient.addColorStop(0, '#1db954');
        spectrumGradient.addColorStop(0.5, '#00e5ff');
        spectrumGradient.addColorStop(1, '#fc3c44');
    }

    function draw() {
        if (currentActiveSection !== 'stats' || !analyser) {
            isSpectrumLoopActive = false;
            if (spectrumIntervalId) { clearInterval(spectrumIntervalId); spectrumIntervalId = null; }
            // clean up canvas to avoid retained buffers and memory leaks
            try {
                if (canvas) {
                    const ctxCleanup = canvas.getContext('2d');
                    if (ctxCleanup) ctxCleanup.clearRect(0, 0, canvas.width, canvas.height);
                }
            } catch (e) {}
            return;
        }

        analyser.getByteFrequencyData(dataArray);

        // Lower resolution canvas backing for performance
        const w = Math.max(1, Math.floor(canvas.clientWidth * scaleFactor));
        const h = Math.max(1, Math.floor(canvas.clientHeight * scaleFactor));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            createGradient();
        }

        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.2;
        let x = 0;
        ctx.fillStyle = spectrumGradient;  // Reuse cached gradient

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i];
            ctx.fillRect(x, canvas.height - barHeight / 1.5, Math.max(1, barWidth - 1), barHeight / 1.5);
            x += barWidth;
            if (x > canvas.width) break;
        }
    }

    // Start a throttled interval (20 FPS)
    if (spectrumIntervalId) clearInterval(spectrumIntervalId);
    spectrumIntervalId = setInterval(draw, 50);
}

// =============================================================================
// SLEEP TIMER
// =============================================================================

function setSleepTimer(minutes) {
    sleepTimeRemaining = minutes * 60;
    lastSleepUpdateTime = Date.now();
    const display = document.getElementById('sleepTimerVal');
    const cancelBtn = document.getElementById('cancelSleepBtn');
    if (cancelBtn) cancelBtn.style.display = 'block';
    showNotification(`Sleep timer set to ${minutes} minutes.`, 'success');
}

function cancelSleepTimer() {
    sleepTimeRemaining = 0;
    const display = document.getElementById('sleepTimerVal');
    if (display) display.innerText = t('sleepOff');
    const cancelBtn = document.getElementById('cancelSleepBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

// =============================================================================
// TAG EDITOR (unchanged, keep as is)
// =============================================================================

function openTagEditor(trackId) {
    if (!currentTrack) return;
    
    const modal = document.getElementById('tagEditorModal');
    if (!modal) createTagEditorModal();
    
    const newModal = document.getElementById('tagEditorModal');
    if (!newModal) return;
    
    document.getElementById('tagTitle').value = currentTrack.title || '';
    document.getElementById('tagArtist').value = currentTrack.artist || '';
    document.getElementById('tagAlbum').value = currentTrack.album || '';
    document.getElementById('tagGenre').value = currentTrack.genre || '';
    document.getElementById('tagYear').value = currentTrack.year || '';
    document.getElementById('tagTrackNumber').value = currentTrack.trackNumber || '';
    document.getElementById('tagComposer').value = currentTrack.composer || '';
    document.getElementById('tagLyrics').value = currentTrack.lyrics || '';
    
    newModal.style.display = 'flex';
}

function createTagEditorModal() {
    const existing = document.getElementById('tagEditorModal');
    if (existing) return;
    
    const modal = document.createElement('div');
    modal.id = 'tagEditorModal';
    modal.className = 'custom-modal-overlay';
    modal.style.display = 'none';
    
    modal.innerHTML = `
        <div class="custom-modal-card" style="max-width: 500px; max-height: 80vh; overflow-y: auto;">
            <div class="modal-indicator-header">
                <i class="fa-solid fa-tag" style="color: var(--accent-cyan);"></i>
                <h4>Edit Track Metadata</h4>
                <button class="close-modal-btn" onclick="closeTagEditor()" style="margin-right: auto; background: none; border: none; color: var(--spotify-text-muted); cursor: pointer;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="tag-editor-form">
                <div class="form-group"><label>Title</label><input type="text" id="tagTitle" placeholder="Track title"></div>
                <div class="form-group"><label>Artist</label><input type="text" id="tagArtist" placeholder="Artist name"></div>
                <div class="form-group"><label>Album</label><input type="text" id="tagAlbum" placeholder="Album name"></div>
                <div class="form-group-row">
                    <div class="form-group" style="flex:1;"><label>Genre</label><input type="text" id="tagGenre" placeholder="Genre"></div>
                    <div class="form-group" style="flex:1;"><label>Year</label><input type="number" id="tagYear" placeholder="YYYY"></div>
                    <div class="form-group" style="flex:0.5;"><label>Track #</label><input type="number" id="tagTrackNumber" placeholder="#"></div>
                </div>
                <div class="form-group"><label>Composer</label><input type="text" id="tagComposer" placeholder="Composer"></div>
                <div class="form-group"><label>Lyrics</label><textarea id="tagLyrics" rows="4" placeholder="Song lyrics..."></textarea></div>
            </div>
            <div class="modal-buttons-footer">
                <button class="modal-btn cancel" onclick="closeTagEditor()">Cancel</button>
                <button class="modal-btn confirm" id="saveTagBtn" style="background: var(--accent-cyan); color: #000;">Save Changes</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.getElementById('saveTagBtn').addEventListener('click', async () => { await saveTagChanges(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeTagEditor(); });
}

function closeTagEditor() {
    const modal = document.getElementById('tagEditorModal');
    if (modal) modal.style.display = 'none';
}

async function saveTagChanges() {
    if (!currentTrack) return;
    
    const updatedData = {
        title: document.getElementById('tagTitle').value,
        artist: document.getElementById('tagArtist').value,
        album: document.getElementById('tagAlbum').value,
        genre: document.getElementById('tagGenre').value,
        year: parseInt(document.getElementById('tagYear').value) || null,
        trackNumber: parseInt(document.getElementById('tagTrackNumber').value) || null,
        composer: document.getElementById('tagComposer').value,
        lyrics: document.getElementById('tagLyrics').value
    };
    
    showNotification('Saving metadata...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });
        
        if (!res.ok) throw new Error();
        
        Object.assign(currentTrack, updatedData);
        const trackInList = tracks.find(t => t.id === currentTrack.id);
        if (trackInList) Object.assign(trackInList, updatedData);
        
        showNotification('Metadata saved successfully!', 'success');
        closeTagEditor();
        updatePlayerUI();
        if (currentActiveSection === 'library') renderLibrary();
        
    } catch (err) {
        console.error('Tag save error:', err);
        showNotification('Failed to save metadata', 'error');
    }
}

// =============================================================================
// CUE SHEET & EXPORT (unchanged)
// =============================================================================

function importCueSheet() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cue';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        showNotification('Parsing CUE sheet...', 'info');
        
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/cue/parse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cuePath: file.path })
            });
            
            if (!res.ok) throw new Error();
            const data = await res.json();
            
            if (data.tracks && data.tracks.length > 0) {
                showNotification(`Found ${data.tracks.length} tracks in CUE sheet`, 'success');
                const playlistName = file.name.replace('.cue', '');
                const newPlaylist = await fetch(`http://127.0.0.1:${apiPort}/api/playlists`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: `CUE: ${playlistName}` })
                });
                if (newPlaylist.ok) {
                    await loadPlaylists();
                    showNotification(`Created playlist from CUE sheet`, 'success');
                }
            } else {
                showNotification('No valid tracks found in CUE sheet', 'warning');
            }
        } catch (err) {
            console.error('CUE import error:', err);
            showNotification('Failed to parse CUE sheet', 'error');
        }
    };
    input.click();
}

async function exportLibraryToCSV() {
    showNotification('Exporting library...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/library/export`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        showNotification(`Library exported to: ${data.path || 'file'}`, 'success');
    } catch (err) {
        console.error('Export error:', err);
        showNotification('Export failed', 'error');
    }
}

// =============================================================================
// PLUGIN MANAGER
// =============================================================================

function openPluginsManager() {
    // Open plugins management page
    window.location.href = 'plugins.html';
}

function openPluginStore() {
    // Plugin store disabled — open plugin manager for manual installs
    window.location.href = 'plugins.html';
}

// =============================================================================
// DRAG & DROP (unchanged)
// =============================================================================

function setupDragAndDrop() {
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (isMiniWindowMode) return;
        const files = Array.from(e.dataTransfer.files);
        const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
        const filePaths = files.map(file => file.path || file.name).filter(p => {
            if (!p) return false;
            const ext = p.split('.').pop().toLowerCase();
            return audioExtensions.includes(ext);
        });
        if (filePaths.length === 0) return;
        showNotification(t('dragNotify'), 'info');
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePaths })
            });
            if (!res.ok) throw new Error();
            const result = await res.json();
            showNotification(`${result.imported} ${t('dragSuccess')}`, 'success');
            await loadTracks();
            try {
                if (result.imported > 0 && tracks.length > 0) {
                    // Prefer server-provided mapping when available
                    if (Array.isArray(result.importedTracks) && result.importedTracks.length > 0) {
                        // attempt to find by returned filePath or id in local tracks
                        let matched = null;
                        for (const it of result.importedTracks) {
                            const ft = tracks.find(tt => tt.id === it.id || (tt.filePath && it.filePath && normalizePath(tt.filePath) === normalizePath(it.filePath)));
                            if (ft) { matched = ft; break; }
                        }
                        if (matched) {
                            console.debug('Autoplay matched by server mapping (drag):', matched.id, matched.title);
                            tryAutoPlayTrack(matched.id).catch(e => console.debug('Autoplay failed', e));
                            return;
                        }
                    }
                    // Try to match by original file path(s)
                    let matched = null;
                    for (const fp of filePaths) {
                        const ft = findTrackByFilePath(fp);
                        if (ft) { matched = ft; break; }
                    }
                    if (matched) {
                        console.debug('Autoplay matched by file path:', matched.id, matched.title);
                        tryAutoPlayTrack(matched.id).catch(e => console.debug('Autoplay failed', e));
                    } else {
                        const newTracks = tracks.slice(-result.imported);
                        console.debug('Newly imported tracks (drag fallback):', newTracks.map(t=>({ id: t.id, title: t.title })));
                        const lastTrack = newTracks[newTracks.length - 1] || newTracks[0];
                        if (lastTrack) tryAutoPlayTrack(lastTrack.id).catch(e => console.debug('Autoplay failed', e));
                    }
                }
            } catch (e) { console.debug('Autoplay after drag import failed', e); }
            switchSection(currentActiveSection);
        } catch (err) { console.error('Drag Import error:', err); showNotification(t('dragError'), 'error'); }
    });
}

// =============================================================================
// API CONNECTION & DATA LOADING
// =============================================================================

async function waitForAPI() {
    const maxAttempts = 15;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (window.electronAPI && typeof window.electronAPI.getServerPort === 'function') {
                const port = await window.electronAPI.getServerPort();
                if (port) {
                    apiPort = port;
                    console.debug('✅ API connected on port:', apiPort);
                    return true;
                }
            }
        } catch (e) { console.error('API connection attempt failed:', e); }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    apiPort = 3000;
    console.debug('⚠️ Using fallback port 3000');
    return true;
}

async function loadTracks() {
    if (isMiniWindowMode) return;
    // 1) Pre-warmed start: render from local cache immediately, then sync in background
    try {
        const cachedTracks = localStorage.getItem('korai_tracks_cache');
        if (cachedTracks) {
            try {
                tracks = JSON.parse(cachedTracks);
                console.debug('🚀 Pre-warmed start: loaded tracks from local cache');
                const totalEl = document.getElementById('quickTotalTracks');
                const likesEl = document.getElementById('quickTotalLikes');
                if (totalEl) totalEl.innerText = tracks.length;
                if (likesEl) likesEl.innerText = tracks.filter(t => t.isLiked).length;

                if (currentActiveSection === 'home') renderHomeDashboard();
                else if (currentActiveSection === 'library') renderLibrary();
            } catch (e) {
                console.warn('Invalid startup cache format', e);
            }
        }
    } catch (e) {
        console.warn('Error reading startup cache', e);
    }

    // 2) Background sync without blocking UI
    try {
        const [tracksRes, likedRes] = await Promise.all([
            fetch(`http://127.0.0.1:${apiPort}/api/tracks`),
            fetch(`http://127.0.0.1:${apiPort}/api/tracks/liked-status`).catch(() => null)
        ]);

            if (tracksRes && tracksRes.ok) {
            const serverTracks = await tracksRes.json();
            let likedMap = {};
            if (likedRes && likedRes.ok) likedMap = await likedRes.json();

            // Normalize numeric string IDs to numbers to avoid mismatches later
            tracks = serverTracks.map(track => {
                const isLiked = !!(likedMap[track.id] || likedMap[String(track.id)]);
                let normalizedId = track.id;
                if (typeof track.id === 'string' && /^\d+$/.test(track.id)) {
                    normalizedId = Number(track.id);
                }
                return { ...track, id: normalizedId, isLiked };
            });
            console.debug('Loaded tracks from server:', tracks.length, 'sample last IDs:', tracks.slice(-5).map(t=>t.id));

            // 3) Update cache and UI smoothly
            try { localStorage.setItem('korai_tracks_cache', JSON.stringify(tracks)); } catch (_) {}

            const totalEl = document.getElementById('quickTotalTracks');
            const likesEl = document.getElementById('quickTotalLikes');
            if (totalEl) totalEl.innerText = tracks.length;
            if (likesEl) likesEl.innerText = tracks.filter(t => t.isLiked).length;

            if (currentActiveSection === 'home') renderHomeDashboard();
            else if (currentActiveSection === 'library') renderLibrary();

            console.debug('✅ Library synced with server');
        }
    } catch (err) {
        console.error('Error syncing tracks:', err);
    }
}

// Load enabled plugins' ui.css (if present) and inject into document
async function loadEnabledPluginCss() {
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/plugins`);
        if (!res.ok) return;
        const data = await res.json();
        const plugins = data.plugins || [];
        for (const p of plugins) {
            if (!p.enabled) continue;
            const head = document.head || document.getElementsByTagName('head')[0];
            // Avoid injecting twice
            if (head.querySelector(`link[data-plugin="${p.id}"]`) || head.querySelector(`script[data-plugin="${p.id}"]`)) continue;
            // Only attempt to fetch assets if server reported they exist to avoid 404s
            const hasCss = p.assets && p.assets.uiCss;
            const hasJs = p.assets && p.assets.uiJs;

            if (hasCss) {
                const cssUrl = `http://127.0.0.1:${apiPort}/api/plugin-asset/${encodeURIComponent(p.id)}/ui.css`;
                try {
                    const cssRes = await fetch(cssUrl, { cache: 'no-store' });
                    if (cssRes.ok) {
                        const cssText = await cssRes.text();
                        const style = document.createElement('style');
                        style.dataset.plugin = p.id;
                        style.textContent = cssText;
                        head.appendChild(style);
                    }
                } catch (e) { /* ignore */ }
            }

            if (hasJs) {
                const jsUrl = `http://127.0.0.1:${apiPort}/api/plugin-asset/${encodeURIComponent(p.id)}/ui.js`;
                try {
                    const jsRes = await fetch(jsUrl, { cache: 'no-store' });
                    if (jsRes.ok) {
                        const jsText = await jsRes.text();
                        const script = document.createElement('script');
                        script.dataset.plugin = p.id;
                        script.textContent = jsText;
                        head.appendChild(script);
                    }
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) {
        console.warn('loadEnabledPluginCss error', e);
    }
}

async function loadPlaylists() {
    if (isMiniWindowMode) return;
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists`);
        if (!res.ok) throw new Error();
        playlists = await res.json();
        renderPlaylistsSidebar();
    } catch (err) {
        console.error('Failed to load playlists', err);
    }
}

/**
 * Show import loading modal
 */
function showImportLoadingModal(totalFiles) {
    // Remove existing modal if any
    const existingModal = document.getElementById('importLoadingModal');
    if (existingModal) existingModal.remove();

    // Create modal container
    const modal = document.createElement('div');
    modal.id = 'importLoadingModal';
    modal.className = 'import-loading-modal';
    modal.innerHTML = `
        <div class="import-loading-content">
            <div class="import-loading-spinner">
                <i class="fa-solid fa-compact-disc fa-spin"></i>
            </div>
            <h3>Importing Audio Files</h3>
            <p id="importLoadingStatus">Scanning and analyzing ${totalFiles} file(s)...</p>
            <div class="import-loading-progress">
                <div class="import-loading-progress-fill" id="importLoadingProgressFill"></div>
            </div>
            <p class="import-loading-percentage" id="importLoadingPercentage">0%</p>
            <div class="import-loading-wave">
                <span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    // Trigger animation
    setTimeout(() => modal.classList.add('active'), 10);
}

/**
 * Update import loading progress
 */
function updateImportLoadingProgress(percent, message) {
    const fill = document.getElementById('importLoadingProgressFill');
    const percentEl = document.getElementById('importLoadingPercentage');
    const statusEl = document.getElementById('importLoadingStatus');

    if (fill) fill.style.width = `${Math.min(100, percent)}%`;
    if (percentEl) percentEl.innerText = `${Math.min(100, Math.floor(percent))}%`;
    if (statusEl && message) statusEl.innerText = message;
}

/**
 * Hide import loading modal
 */
function hideImportLoadingModal() {
    const modal = document.getElementById('importLoadingModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

// =============================================================================
// PLAYLIST RENDERING & MANAGEMENT
// =============================================================================

function renderPlaylistsSidebar() {
    const container = document.getElementById('sidebarPlaylists');
    if (!container) return;
    
    if (!playlists || playlists.length === 0) {
        container.innerHTML = `<div class="no-playlists-label">${currentLanguage === 'fa' ? 'لیستی ایجاد نشده است' : 'No playlists created'}</div>`;
        return;
    }
    
    let html = '';
    playlists.forEach(pl => {
        if (!pl || !pl.id) return;
        
        html += `<div class="sidebar-playlist-item ${currentActivePlaylistId === pl.id && currentActiveSection === 'playlist' ? 'active' : ''}" 
                       onclick="openPlaylist(${pl.id})">
                    <i class="fa-solid fa-music"></i>
                    <span class="playlist-name-text truncate-text">${escapeHtml(pl.name || 'Unnamed')}</span>
                    <button class="playlist-delete-mini" onclick="event.stopPropagation(); deletePlaylist(${pl.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>`;
    });
    container.innerHTML = html;
}

function promptCreatePlaylist() {
    const modal = document.getElementById('createPlaylistModal');
    const input = document.getElementById('newPlaylistInputName');
    const confirmBtn = document.getElementById('confirmPlaylistCreateBtn');
    
    if (!modal || !input || !confirmBtn) {
        console.error('Modal elements not found');
        return;
    }
    
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
    
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    newConfirmBtn.onclick = async () => {
        const name = input.value.trim();
        if (!name) { 
            showNotification(currentLanguage === 'fa' ? 'نام پلی‌لیست نمی‌تواند خالی باشد' : 'Playlist name cannot be empty', 'warning'); 
            return; 
        }
        
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            
            if (res.ok) {
                const data = await res.json();
                showNotification(currentLanguage === 'fa' ? 'پلی‌لیست با موفقیت ساخته شد' : 'Playlist created successfully', 'success');
                await loadPlaylists();
                closeCreatePlaylistModal();
                
                if (data && data.id) {
                    setTimeout(() => {
                        openPlaylist(data.id);
                    }, 300);
                }
            } else {
                const error = await res.json();
                showNotification(error.error || 'Error creating playlist', 'error');
            }
        } catch (e) { 
            console.error('Create playlist error:', e);
            showNotification(currentLanguage === 'fa' ? 'خطا در ارتباط با سرور' : 'Error connecting to server', 'error'); 
        }
    };
    
    input.onkeypress = (e) => {
        if (e.key === 'Enter') {
            newConfirmBtn.click();
        }
    };
}

function closeCreatePlaylistModal() {
    const modal = document.getElementById('createPlaylistModal');
    if (modal) modal.style.display = 'none';
}

async function deletePlaylist(id) {
    const title = currentLanguage === 'fa' ? 'حذف پلی‌لیست' : 'Delete Playlist';
    const message = currentLanguage === 'fa' ? 'آیا از حذف این لیست پخش مطمئن هستید؟' : 'Are you sure you want to delete this playlist?';
    
    showCustomDialog(title, message, async () => {
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showNotification('Playlist deleted', 'info');
                await loadPlaylists();
                if (currentActiveSection === 'playlist' && currentActivePlaylistId === id) switchSection('home');
            }
        } catch (e) { showNotification('Error deleting playlist', 'error'); }
    });
}

function openPlaylist(id) {
    currentActiveSection = 'playlist';
    currentActivePlaylistId = id;
    renderPlaylistsSidebar();
    renderPlaylistView();
}

function renderPlaylistView() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    const playlist = playlists.find(p => p.id === currentActivePlaylistId);
    if (!playlist) { switchSection('home'); return; }
    
    const plTracks = tracks.filter(t => playlist.tracks.includes(t.id));
    
    if (plTracks.length === 0) {
        mainSection.innerHTML = `<div class="empty-illustration-state"><i class="fa-solid fa-compact-disc"></i><h3>${t('emptyPlaylistState')}</h3><p>${t('emptyPlaylistTip')}</p></div>`;
        return;
    }
    
    let tableRowsHtml = '';
    plTracks.forEach((track, index) => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        const isActive = currentTrackId === track.id;
        const indexText = isActive && isPlaying ? '<i class="fa-solid fa-pause"></i>' : index + 1;
        
        tableRowsHtml += `<tr class="track-row ${isActive ? 'active' : ''}" data-track-id="${track.id}">
            <td class="track-play-cell">${indexText}</td>
            <td class="track-info-cell">
                <div class="table-song-cover">${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}</div>
                <div class="table-song-meta"><span class="table-song-title">${escapeHtml(track.title || 'Untitled')}</span><span class="table-song-artist">${escapeHtml(track.artist || 'Unknown Artist')}</span></div>
            </td>
            <td class="track-album-cell">${escapeHtml(track.album || '—')}</td>
            <td class="track-bpm-cell">${track.bpm || '120'}</td>
            <td class="track-time-cell">${formatTime(track.duration)}</td>
            <td class="track-actions-cell"><button class="table-action-btn delete" title="${currentLanguage === 'fa' ? 'حذف' : 'Remove'}"><i class="fa-solid fa-minus"></i></button></td>
        </tr>`;
    });
    
    mainSection.innerHTML = `<div class="spotify-row-title"><h3>${currentLanguage === 'fa' ? 'پلی‌لیست' : 'Playlist'}: ${escapeHtml(playlist.name)} (${plTracks.length})</h3></div>
        <div class="library-table-wrapper"><table class="library-tracks-table"><thead><tr><th style="width:50px;">#</th><th>${currentLanguage === 'fa' ? 'عنوان' : 'Title'}</th><th>${currentLanguage === 'fa' ? 'آلبوم' : 'Album'}</th><th style="width:80px;">BPM</th><th style="width:80px;"><i class="fa-regular fa-clock"></i></th><th style="width:100px;">${currentLanguage === 'fa' ? 'حذف' : 'Remove'}</th></tr></thead><tbody>${tableRowsHtml}</tbody></table></div>`;
}

async function removeTrackFromPlaylist(playlistId, trackId) {
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/${playlistId}/tracks/${trackId}`, { method: 'DELETE' });
        if (res.ok) {
            showNotification('Track removed from playlist', 'info');
            await loadPlaylists();
            if (currentActiveSection === 'playlist') openPlaylist(playlistId);
        }
    } catch (e) { showNotification('Error removing track from playlist', 'error'); }
}

function playTrackFromPlaylist(playlistId, trackId) {
    const playlist = playlists.find(p => p.id === playlistId);
    if (playlist) {
        const plTracks = tracks.filter(t => playlist.tracks.includes(t.id));
        playTrack(trackId, 'playlist', playlistId, plTracks);
    }
}

function playFromFavorites(trackId) {
    const favTracks = tracks.filter(t => t.isLiked);
    playTrack(trackId, 'favorites', null, favTracks);
}

function playArtist(artistName) {
    const artistTracks = tracks.filter(track => (track.artist || 'Unknown Artist') === artistName);
    if (artistTracks.length === 0) return;
    playTrack(artistTracks[0].id, 'artists', artistName, artistTracks);
    showNotification(`${t('playingArtist') || 'Playing'} ${artistName} (${artistTracks.length} ${t('tracks') || 'tracks'})`, 'success');
}

// =============================================================================
// CONTEXT MENU
// =============================================================================

function showPlaylistContextMenu(trackId, x, y) {
    if (isMiniWindowMode) return;
    const menu = document.getElementById('playlistContextMenu');
    const container = document.getElementById('contextPlaylistItems');
    if (!menu || !container) return;
    
    menu.setAttribute('data-current-track-id', trackId);
    
    if (playlists.length === 0) {
        container.innerHTML = `<div class="context-item empty">${currentLanguage === 'fa' ? 'پلی‌لیستی وجود ندارد' : 'No playlists available'}</div>`;
    } else {
        let html = '';
        playlists.forEach(pl => {
            html += `<div class="context-item" onclick="addTrackToPlaylist(${pl.id}, ${trackId})"><i class="fa-solid fa-list"></i><span>${escapeHtml(pl.name)}</span></div>`;
        });
        container.innerHTML = html;
    }
    
    const existingSeparator = document.querySelector('#playlistContextMenu .context-separator');
    const existingEditBtn = document.querySelector('#playlistContextMenu .context-edit-item');
    
    if (!existingSeparator && !existingEditBtn) {
        const separator = document.createElement('div');
        separator.className = 'context-separator';
        separator.style.height = '1px';
        separator.style.backgroundColor = 'var(--border-color)';
        separator.style.margin = '6px 0';
        
        const editItem = document.createElement('div');
        editItem.className = 'context-item context-edit-item';
        editItem.innerHTML = `<i class="fa-solid fa-pen"></i> <span>${currentLanguage === 'fa' ? 'ویرایش متادیتا' : 'Edit Tags'}</span>`;
        editItem.onclick = () => {
            menu.style.display = 'none';
            openTagEditorFromContext(parseInt(menu.getAttribute('data-current-track-id')));
        };
        
        menu.appendChild(separator);
        menu.appendChild(editItem);
    }
    
    menu.style.display = 'block';
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;
    
    // Use event delegation instead of adding/removing listeners
    const closeContextMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    };
    
    // Remove any existing listener first to prevent memory leaks
    document.removeEventListener('click', window._contextMenuCloseHandler);
    window._contextMenuCloseHandler = closeContextMenu;
    
    setTimeout(() => {
        document.addEventListener('click', closeContextMenu, { once: true });
    }, 50);
}

function openTagEditorFromContext(trackId) {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    currentTrack = track;
    currentTrackId = track.id;
    openTagEditor(trackId);
}

async function addTrackToPlaylist(playlistId, trackId) {
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/${playlistId}/tracks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                showNotification('Track added to playlist', 'success');
                await loadPlaylists();
            } else { showNotification('Track already in playlist', 'info'); }
        }
    } catch (e) { showNotification('Error adding to playlist', 'error'); }
}

// =============================================================================
// CORE PLAYBACK FUNCTION
// =============================================================================

async function playTrack(trackId, sourceType = 'library', sourceId = null, sourceTracksArray = null) {
    if (pendingPlayRequest) {
        try { await pendingPlayRequest; } catch (e) { }
    }
    const hasLibrary = Array.isArray(tracks) && tracks.length > 0;
    if (!hasLibrary && !currentTrack) {
        showNotification(t('emptyLibrary'), 'warning');
        return;
    }
    if (isMiniWindowMode) return;
    pendingPlayRequest = (async () => {
        try {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (currentTrackId === trackId && audioElement && audioElement.src) {
                try {
                    const savedState = JSON.parse(localStorage.getItem('korai_playback_state') || '{}');
                    if (savedState && savedState.trackId === trackId && savedState.currentTime > 0) {
                        if (audioElement.duration > savedState.currentTime) {
                            audioElement.currentTime = savedState.currentTime;
                        }
                    }
                    if (window.audioCtx && window.audioCtx.state === 'suspended') {
                        try { await window.audioCtx.resume(); } catch (e) { }
                    }
                    if (!audioElement._koraiSourceNode) {
                        setupAudioNodes();
                    }
                    await audioElement.play();
                    setPlayState(true);
                    return;
                } catch (playErr) {
                    if (playErr.name === 'NotSupportedError') {
                        showNotification('فرمت فایل پشتیبانی نمی‌شود یا فایل خراب است.', 'error');
                        return;
                    }
                }
            }
            currentTrackId = trackId;
            currentTrack = tracks.find(t => t.id == trackId) || null;
            if (!currentTrack && window.currentTrack && window.currentTrack.id === trackId) {
                currentTrack = window.currentTrack;
            }
            if (!currentTrack) {
                showNotification('Track not found', 'error');
                return;
            }
            window.currentTrackId = trackId;
            window.currentTrack = currentTrack;
            if (sourceTracksArray) {
                setPlaySource(sourceType, sourceId, sourceTracksArray);
            } else {
                if (sourceType === 'playlist' && sourceId) {
                    const playlist = playlists.find(p => p.id === sourceId);
                    if (playlist) {
                        const plTracks = tracks.filter(t => playlist.tracks.includes(t.id));
                        setPlaySource('playlist', sourceId, plTracks);
                    } else { setPlaySource('library'); }
                } else if (sourceType === 'favorites') {
                    const favTracks = tracks.filter(t => t.isLiked);
                    setPlaySource('favorites', null, favTracks);
                } else if (sourceType === 'artists' && sourceId) {
                    const artistTracks = tracks.filter(t => (t.artist || 'Unknown Artist') === sourceId);
                    setPlaySource('artists', sourceId, artistTracks);
                } else { setPlaySource('library'); }
            }
            if (!shuffleMode) {
                queueIndex = queue.findIndex(t => t.id == trackId);
                if (queueIndex === -1) { queue.unshift(currentTrack); queueIndex = 0; }
            } else {
                const existingIndex = queue.findIndex(t => t.id == trackId);
                if (existingIndex !== -1) queueIndex = existingIndex;
                else { queue.unshift(currentTrack); queueIndex = 0; }
            }
            initAudio();
            if (window.audioCtx && window.audioCtx.state === 'suspended') {
                try { await window.audioCtx.resume(); } catch (e) { }
            }
            const streamUrl = `http://127.0.0.1:${apiPort}/api/tracks/${trackId}/stream`;
            if (audioElement._koraiSourceNode) {
                try {
                    audioElement._koraiSourceNode.disconnect();
                } catch (e) {}
                audioElement._koraiSourceNode = null;
            }
            if (!audioElement.paused) {
                try { await audioElement.pause(); } catch (e) { }
            }
            const savedPosition = localStorage.getItem('korai_playback_state');
            let savedTime = 0;
            if (savedPosition) {
                try {
                    const parsed = JSON.parse(savedPosition);
                    if (parsed.trackId === trackId && parsed.currentTime > 0) {
                        savedTime = parsed.currentTime;
                    }
                } catch (e) {}
            }
            audioElement.src = '';
            audioElement.load();
            audioElement.src = streamUrl;
            audioElement.load();
            let loadError = null;
            try {
                await new Promise((resolve, reject) => {
                    let settled = false;
                    const timeoutId = setTimeout(() => {
                        if (!settled) {
                            settled = true;
                            resolve();
                        }
                    }, 5000);
                    const onCanPlay = () => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeoutId);
                        cleanup();
                        resolve();
                    };
                    const onError = (e) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeoutId);
                        loadError = e;
                        cleanup();
                        reject(new Error('Media load error: ' + (e.message || 'unknown')));
                    };
                    const cleanup = () => {
                        audioElement.removeEventListener('canplay', onCanPlay);
                        audioElement.removeEventListener('error', onError);
                    };
                    audioElement.addEventListener('canplay', onCanPlay);
                    audioElement.addEventListener('error', onError);
                });
            } catch (e) {
                console.warn('Media load warning:', e.message);
                if (e.message.includes('NotSupportedError') || e.message.includes('media load error')) {
                    showNotification('فرمت فایل پشتیبانی نمی‌شود.', 'error');
                    setPlayState(false);
                    return;
                }
            }
            if (savedTime > 0) {
                audioElement.addEventListener('loadedmetadata', function onMeta() {
                    if (audioElement.duration > savedTime) {
                        audioElement.currentTime = savedTime;
                    }
                    audioElement.removeEventListener('loadedmetadata', onMeta);
                });
            }
            let playSuccess = false;
            for (let attempt = 0; attempt < 3 && !playSuccess; attempt++) {
                try {
                    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                    if (!audioElement._koraiSourceNode) {
                        setupAudioNodes();
                    }
                    await audioElement.play();
                    playSuccess = true;
                    audioRecoveryAttempts = 0;
                } catch (e) {
                    console.warn(`Play attempt ${attempt + 1} failed:`, e.name, e.message);
                    if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') {
                        if (e.name === 'NotSupportedError') showNotification('فرمت فایل پشتیبانی نمی‌شود.', 'error');
                        break;
                    }
                }
            }
            if (!playSuccess) {
                if (audioRecoveryAttempts < MAX_AUDIO_RECOVERY_ATTEMPTS) {
                    audioRecoveryAttempts++;
                    await emergencyAudioRecovery();
                    await playTrack(trackId, sourceType, sourceId, sourceTracksArray);
                    return;
                } else {
                    throw new Error('Playback failed after retries');
                }
            }
            if (wasVocalSeparatorActive && typeof reconnectAudioGraph === 'function') {
                setTimeout(() => reconnectAudioGraph(true).catch(e => console.debug(e)), 100);
            }
            setPlayState(true);
            updatePlayerUI();
            syncWithWindowsMediaSystem();
            fetch(`http://127.0.0.1:${apiPort}/api/tracks/${trackId}/play`, { method: 'POST' }).catch(e => console.error(e));
            renderQueue();
        } catch (err) {
            console.error('Play error:', err);
            if (!err.message.includes('NotSupported')) {
                showNotification('Error playing audio: ' + (err.message || 'Unknown error'), 'error');
            }
            setPlayState(false);
            throw err;
        } finally {
            pendingPlayRequest = null;
        }
    })();
    await pendingPlayRequest;
}

function togglePlay() {
    if (isMiniWindowMode) {
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('play-pause');
        }
        return;
    }
    if (!currentTrackId && tracks.length > 0) {
        playTrack(tracks[0].id);
        return;
    }
    if (!audioElement) {
        if (currentTrackId) playTrack(currentTrackId);
        return;
    }
    async function doToggle() {
        try {
            if (isPlaying) {
                try {
                    await audioElement.pause();
                } catch (e) { }
                setPlayState(false);
                savePlaybackState();
            } else {
                if (window.audioCtx && window.audioCtx.state === 'suspended') {
                    try { await window.audioCtx.resume(); } catch (e) { }
                }
                if (!audioElement.src || audioElement.src === '') {
                    if (currentTrackId) {
                        const streamUrl = `http://127.0.0.1:${apiPort}/api/tracks/${currentTrackId}/stream`;
                        audioElement.src = streamUrl;
                        audioElement.load();
                        await new Promise((resolve) => {
                            const onCanPlay = () => {
                                audioElement.removeEventListener('canplay', onCanPlay);
                                resolve();
                            };
                            audioElement.addEventListener('canplay', onCanPlay);
                            setTimeout(resolve, 3000);
                        });
                    } else {
                        showNotification('No track selected', 'warning');
                        return;
                    }
                }
                if (typeof setupAudioNodes === 'function') {
                    if (!audioElement._koraiSourceNode || window.audioCtx.state === 'closed') {
                        setupAudioNodes();
                    }
                }
                const savedState = JSON.parse(localStorage.getItem('korai_playback_state') || '{}');
                if (savedState && savedState.trackId === currentTrackId && savedState.currentTime > 0) {
                    if (audioElement.duration > savedState.currentTime) {
                        if (Math.abs(audioElement.currentTime - savedState.currentTime) > 1) {
                            audioElement.currentTime = savedState.currentTime;
                        }
                    }
                }
                try {
                    await audioElement.play();
                    setPlayState(true);
                    audioRecoveryAttempts = 0;
                } catch (err) {
                    console.error('Play failed:', err);
                    if (err.name === 'NotAllowedError') {
                        showNotification('Playback requires user interaction first', 'warning');
                    } else if (err.name === 'NotSupportedError') {
                        showNotification('Audio format not supported', 'error');
                        setPlayState(false);
                    } else {
                        showNotification('Playback failed: ' + err.message, 'warning');
                    }
                    if (currentTrackId && err.name !== 'NotSupportedError') {
                        setTimeout(() => playTrack(currentTrackId), 500);
                    }
                }
            }
        } catch (e) {
            console.error('Toggle play error:', e);
        }
    }
    doToggle();
    if (typeof syncWithWindowsMediaSystem === 'function') syncWithWindowsMediaSystem();
}

// Attempt to autoplay a track with retries and audio init/resume safeguards
async function tryAutoPlayTrack(trackId, attempts = 5) {
    console.debug('tryAutoPlayTrack starting for', trackId, 'attempts', attempts);
    for (let i = 0; i < attempts; i++) {
        try {
            initAudio();
            if (window.audioCtx && window.audioCtx.state === 'suspended') {
                try { await window.audioCtx.resume(); } catch (e) { console.debug('AudioContext resume failed', e); }
            }

            console.debug('Autoplay attempt', i+1, 'for trackId', trackId);
            await playTrack(trackId, 'file');
            console.debug('Autoplay attempt succeeded for', trackId, 'currentTrackId:', currentTrackId);
            return true;
        } catch (e) {
            console.debug(`Autoplay attempt ${i + 1} failed for track ${trackId}:`, e && e.message);
            // small backoff
            await new Promise(r => setTimeout(r, 250 + i * 150));
            // try emergency recovery on later attempts
            if (i === 2) await emergencyAudioRecovery();
        }
    }
    return false;
}


// =============================================================================
// PLAYER UI UPDATE
// =============================================================================

function updatePlayerUI() {
    if (!currentTrack) return;
    syncWithMiniPlayerWidget();
    syncTrayPlaybackState();

    let coverUrl = currentTrack.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/cover` : null;
    
    const titleEl = document.getElementById('playerTitle');
    const artistEl = document.getElementById('playerArtist');
    const artEl = document.getElementById('playerAlbumArt');
    
    if (titleEl) titleEl.innerText = currentTrack.title || 'Untitled';
    if (artistEl) artistEl.innerText = currentTrack.artist || 'Unknown Artist';
    if (artEl) artEl.innerHTML = coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music fallback-icon"></i>';
    
    const miniTitle = document.getElementById('miniTitle');
    const miniArtist = document.getElementById('miniArtist');
    const miniArt = document.getElementById('miniArt');
    
    if (miniTitle) miniTitle.innerText = currentTrack.title || 'Untitled';
    if (miniArtist) miniArtist.innerText = currentTrack.artist || 'Unknown Artist';
    if (miniArt) miniArt.innerHTML = coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>';
    
    const fsTitle = document.getElementById('fsTitle');
    const fsArtist = document.getElementById('fsArtist');
    const fsArt = document.getElementById('fsAlbumArt');
    const fsBpm = document.getElementById('fsBpmBadge');
    const fsEnergy = document.getElementById('fsEnergyBadge');
    const fsLyrics = document.getElementById('fsLyrics');
    const fsBgBlur = document.getElementById('fsBgBlur');
    
    if (fsTitle) fsTitle.innerText = currentTrack.title || 'Untitled';
    if (fsArtist) fsArtist.innerText = currentTrack.artist || 'Unknown Artist';
    if (fsArt) fsArt.innerHTML = coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music fallback-icon" style="font-size:3rem;"></i>';
    if (fsBgBlur && coverUrl) fsBgBlur.style.backgroundImage = `url(${coverUrl})`;
    if (fsBpm) fsBpm.innerHTML = `<i class="fa-solid fa-heartbeat"></i> ${currentTrack.bpm || '120'} BPM`;
    if (fsEnergy) fsEnergy.innerHTML = `<i class="fa-solid fa-bolt"></i> ${currentTrack.energy ? Math.round(currentTrack.energy * 100) : '50'}% Energy`;
    
    if (fsLyrics) {
        if (currentTrack.lyrics) fsLyrics.innerHTML = `<div class="lyrics-text">${escapeHtml(currentTrack.lyrics).replace(/\n/g, '<br>')}</div>`;
        else fsLyrics.innerHTML = `<p class="no-lyrics">${t('noLyrics')}</p>`;
    }
    
    const likeBtn = document.getElementById('likeBtnK');
    if (likeBtn) likeBtn.innerHTML = currentTrack.isLiked ? '<i class="fa-solid fa-heart" style="color: var(--accent-pink);"></i>' : '<i class="fa-regular fa-heart"></i>';

    const specsEl = document.getElementById('playerSpecs');
    if (specsEl) {
        const codec = (currentTrack.codec || 'MPEG').toUpperCase();
        const kbps = currentTrack.bitrate ? `${Math.round(currentTrack.bitrate / 1000)} kbps` : '320 kbps';
        const hz = currentTrack.sampleRate ? `${(currentTrack.sampleRate / 1000).toFixed(1)} kHz` : '44.1 kHz';
        specsEl.innerText = `${codec} • ${kbps} • ${hz}`;
    }

    // --- Update hero / home now-playing visuals so hero stays in sync with playback bar ---
    try {
        const heroArt = document.querySelector('.now-playing-art');
        const heroCoverUrl = currentTrack && currentTrack.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/cover` : null;
        if (heroArt) {
            heroArt.innerHTML = heroCoverUrl ? `<img src="${heroCoverUrl}" alt="Now Playing">` : '<div class="fallback-icon"><i class="fa-solid fa-compact-disc"></i></div>';
        }

        const heroLabel = document.querySelector('.now-playing-label');
        if (heroLabel) {
            if (currentTrack) heroLabel.style.display = '';
            else heroLabel.style.display = 'none';
        }

        const heroPulse = document.querySelector('.now-playing-pulse');
        if (heroPulse) heroPulse.classList.toggle('playing', !!isPlaying);
    } catch (e) {
        // non-fatal
    }

    // Update hero primary button icon/text state
    try {
        const heroBtn = document.getElementById('heroPrimaryBtn') || document.querySelector('.hero-cta-primary');
        if (heroBtn) {
            const icon = heroBtn.querySelector('i');
            const textNode = heroBtn.querySelector('span');
            if (isPlaying) {
                if (icon) icon.className = 'fa-solid fa-pause';
                if (textNode) textNode.innerText = t('playPause') || 'Pause';
                else if (heroBtn.innerText && !textNode) heroBtn.innerHTML = '<i class="fa-solid fa-pause"></i> ' + (t('playPause') || 'Pause');
            } else {
                if (icon) icon.className = 'fa-solid fa-play';
                if (textNode) textNode.innerText = t('playPause') || 'Play';
                else if (heroBtn.innerText && !textNode) heroBtn.innerHTML = '<i class="fa-solid fa-play"></i> ' + (t('playPause') || 'Play');
            }
        }
    } catch (e) {}
    
    document.querySelectorAll('.track-row, .spotify-music-card').forEach(el => {
        const idAttr = parseInt(el.dataset.trackId);
        if (idAttr === currentTrackId) {
            el.classList.add('active');
            const icon = el.querySelector('.hover-play-bubble i, .track-play-cell i');
            if (icon) icon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        } else { el.classList.remove('active'); }
    });
    
    const miniArtBox = document.querySelector('.mini-art-box');
    if (miniArtBox) { if (isPlaying) miniArtBox.classList.add('playing'); else miniArtBox.classList.remove('playing'); }
}

// =============================================================================
// IMPORT PROGRESS UI
// =============================================================================

function showImportProgress(fileCount) {
    hideImportProgress();
    
    importProgressElement = document.createElement('div');
    importProgressElement.id = 'importProgressOverlay';
    importProgressElement.innerHTML = `<div class="import-progress-container"><div class="import-progress-card"><div class="import-spinner"><i class="fa-solid fa-compact-disc fa-spin"></i></div><h3 class="import-title">Importing Audio Files</h3><p class="import-subtitle">Analyzing ${fileCount} file(s)...</p><div class="import-progress-bar-wrapper"><div class="import-progress-bar-fill" id="importProgressFill" style="width:0%;"></div></div><p class="import-percentage" id="importPercentage">0%</p><div class="import-wave-bars"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div></div></div>`;
    
    document.body.appendChild(importProgressElement);
    setTimeout(() => { if (importProgressElement) importProgressElement.classList.add('active'); }, 50);
    
    let progress = 0;
    importProgressInterval = setInterval(() => {
        if (progress < 90) {
            progress += Math.random() * 8;
            if (progress > 90) progress = 90;
            updateImportProgress(progress, `Importing ${Math.floor(progress)}%...`);
        }
    }, 200);
}

function updateImportProgress(percent, message) {
    const fill = document.getElementById('importProgressFill');
    const percentText = document.getElementById('importPercentage');
    const subtitle = document.querySelector('.import-subtitle');
    if (fill) fill.style.width = `${Math.min(100, percent)}%`;
    if (percentText) percentText.innerText = `${Math.min(100, Math.floor(percent))}%`;
    if (subtitle && message) subtitle.innerText = message;
}

function hideImportProgress() {
    if (importProgressInterval) { clearInterval(importProgressInterval); importProgressInterval = null; }
    if (importProgressElement) {
        importProgressElement.classList.remove('active');
        importProgressElement.classList.add('fade-out');
        setTimeout(() => { if (importProgressElement && importProgressElement.parentNode) importProgressElement.parentNode.removeChild(importProgressElement); importProgressElement = null; }, 400);
    }
}

// =============================================================================
// DELETE TRACK
// =============================================================================

function deleteTrack(trackId, event) {
    event.stopPropagation();
    showCustomDialog(currentLanguage === 'fa' ? 'حذف قطعه از کتابخانه' : 'Delete track from library', 
        currentLanguage === 'fa' ? 'آیا مطمئن هستید؟ این عمل فایل اصلی شما روی کامپیوتر را پاک نخواهد کرد.' : 'Are you sure? This will not delete the actual file from your disk.',
        async () => {
            try {
                const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${trackId}`, { method: 'DELETE' });
                if (res.ok) {
                    showNotification('Track removed', 'success');
                    await loadTracks();
                    await loadPlaylists();
                    switchSection(currentActiveSection);
                }
            } catch { showNotification('Connection failed', 'error'); }
        });
}

// =============================================================================
// LIBRARY RENDERING (WITH PAGINATION)
// =============================================================================

function renderLibrary(filteredTracks = null) {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    let listToRender = filteredTracks !== null ? filteredTracks : [...tracks];
    // Build sanitized genre list: group variants, remove junk (urls, site tags), and sort by frequency
    const genreGroups = {};
    tracks.forEach(t => {
        const raw = (t.genre || '').toString().trim();
        if (!raw) return;
        const norm = normalizeGenreLabel(raw);
        if (!genreGroups[norm]) genreGroups[norm] = { norm, rawSet: new Set(), count: 0 };
        genreGroups[norm].rawSet.add(raw);
        genreGroups[norm].count++;
    });
    const allGenreEntries = Object.values(genreGroups);
    // Filter out junk and very long or URL-like genres
    const filteredGenreEntries = allGenreEntries.filter(g => !isJunkGenre(g.norm));
    // Sort by frequency desc, then by name
    filteredGenreEntries.sort((a, b) => b.count - a.count || a.norm.localeCompare(b.norm));
    // Limit to a reasonable number to avoid UI spam
    const MAX_GENRES = 60;
    const existingGenres = filteredGenreEntries.slice(0, MAX_GENRES).map(g => {
        // pick a representative raw value (most common)
        const repr = Array.from(g.rawSet)[0];
        return { raw: repr, norm: g.norm, count: g.count };
    });

    if (libraryGenreFilter !== 'all') listToRender = listToRender.filter(t => t.genre === libraryGenreFilter);

    listToRender.sort((a, b) => {
        let valA = a[librarySortKey], valB = b[librarySortKey];
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';
        if (typeof valA === 'string') {
            return librarySortOrder === 'asc' ? valA.localeCompare(valB, undefined, { sensitivity: 'base' }) : valB.localeCompare(valA, undefined, { sensitivity: 'base' });
        } else { return librarySortOrder === 'asc' ? valA - valB : valB - valA; }
    });
    
    if (tracks.length === 0) {
        mainSection.innerHTML = `<div class="empty-illustration-state"><i class="fa-solid fa-compact-disc"></i><h3>${t('emptyLibrary')}</h3><p>${t('emptyLibraryDesc')}</p></div>`;
        return;
    }

    // ========== Build collapsible genre filter HTML ==========
    let genreFilterHtml = `
        <div class="genre-filter-collapsible" id="genreFilterCollapsible">
            <div class="genre-filter-header" id="genreFilterHeader">
                <div class="genre-filter-title">
                    <i class="fa-solid fa-filter"></i>
                    <span>${t('filterByGenre') || 'Filter by Genre'}</span>
                    <span class="genre-filter-count" id="genreFilterCount">${existingGenres.length}</span>
                </div>
                <button class="genre-filter-toggle" id="genreFilterToggleBtn">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="genre-filter-body" id="genreFilterBody">
                <div class="genre-filter-wrapper-bar" id="genreFilterWrapperBar">
                    <button class="filter-chip ${libraryGenreFilter === 'all' ? 'active' : ''}" onclick="setLibraryGenreFilter('all')">${t('allGenres')}</button>
    `;
    
    // Add genre chips (limit to reasonable number, wrap in scrollable container)
    existingGenres.forEach(g => {
        const genre = g.raw;
        const displayGenre = getGenreTranslation(g.norm) || cleanGenreDisplay(genre) || g.norm;
        const escapedGenre = genre.replace(/'/g, "\\'");
        const isActive = libraryGenreFilter === genre || libraryGenreFilter === g.norm;
        genreFilterHtml += `<button class="filter-chip ${isActive ? 'active' : ''}" onclick="setLibraryGenreFilter('${escapedGenre}')">${escapeHtml(displayGenre)}</button>`;
    });
    
    genreFilterHtml += `
                </div>
            </div>
        </div>
    `;

    mainSection.innerHTML = `
        <div class="spotify-row-title library-header-panel">
            <div class="title-meta-box">
                <h3>${t('libraryArchive')} (<span id="libCount">${listToRender.length}</span>)</h3>
                <span class="right-click-tip-lbl">${t('rightClickTip')}</span>
            </div>
            <div class="library-filter-controls">
                <div class="sort-action-group">
                    <label class="sort-select-lbl">${t('sortByLabel')}</label>
                    <select id="libSortSelect" class="sort-dropdown-custom" onchange="changeLibrarySorting(this.value)">
                        <option value="createdAt" ${librarySortKey === 'createdAt' ? 'selected' : ''}>${t('sortDateAdded')}</option>
                        <option value="title" ${librarySortKey === 'title' ? 'selected' : ''}>${t('sortTitle')}</option>
                        <option value="artist" ${librarySortKey === 'artist' ? 'selected' : ''}>${t('sortArtist')}</option>
                        <option value="bpm" ${librarySortKey === 'bpm' ? 'selected' : ''}>${t('sortBpm')}</option>
                        <option value="duration" ${librarySortKey === 'duration' ? 'selected' : ''}>${t('sortDuration')}</option>
                    </select>
                    <button class="sort-dir-toggle-btn" onclick="toggleLibrarySortOrder()" title="Toggle Order">
                        <i class="fa-solid ${librarySortOrder === 'asc' ? 'fa-arrow-up-wide-short' : 'fa-arrow-down-wide-short'}"></i>
                    </button>
                </div>
            </div>
        </div>
        ${genreFilterHtml}
        <div class="library-table-wrapper">
            <table class="library-tracks-table">
                <thead>
                    <tr>
                        <th style="width:50px;">#</th>
                        <th>${currentLanguage === 'fa' ? 'عنوان' : 'Title'}</th>
                        <th>${currentLanguage === 'fa' ? 'آلبوم' : 'Album'}</th>
                        <th style="width:80px;">BPM</th>
                        <th style="width:80px;"><i class="fa-regular fa-clock"></i></th>
                        <th style="width:100px;">${currentLanguage === 'fa' ? 'عملیات' : 'Actions'}</th>
                    </tr>
                </thead>
                <tbody id="libraryTableBody"></tbody>
            </table>
            <div id="loadMoreContainer" style="text-align:center; margin-top:16px; display:none;">
                <button id="loadMoreBtn" class="oobe-start-btn" style="padding:8px 16px; font-size:0.75rem;">${currentLanguage === 'fa' ? 'بارگذاری بیشتر...' : 'Load more...'}</button>
            </div>
        </div>
    `;
    
    // ========== Setup collapsible event listener ==========
    const toggleBtn = document.getElementById('genreFilterToggleBtn');
    const filterBody = document.getElementById('genreFilterBody');
    const filterHeader = document.getElementById('genreFilterHeader');
    
    if (toggleBtn && filterBody) {
        // Check localStorage for saved state
        const isCollapsed = localStorage.getItem('korai_genre_filter_collapsed') === 'true';
        if (isCollapsed) {
            filterBody.classList.add('collapsed');
            toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        }
        
        const toggleCollapse = (e) => {
            e.stopPropagation();
            filterBody.classList.toggle('collapsed');
            const nowCollapsed = filterBody.classList.contains('collapsed');
            localStorage.setItem('korai_genre_filter_collapsed', nowCollapsed);
            toggleBtn.innerHTML = nowCollapsed ? '<i class="fa-solid fa-chevron-right"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
        };
        
        toggleBtn.addEventListener('click', toggleCollapse);
        if (filterHeader) {
            filterHeader.addEventListener('click', (e) => {
                // Don't trigger when clicking directly on toggle button
                if (e.target === toggleBtn || toggleBtn.contains(e.target)) return;
                toggleCollapse(e);
            });
        }
    }
    
    // ========== Render table with pagination ==========
    const tbody = document.getElementById('libraryTableBody');
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    let currentIndex = 0;
    const chunkSize = 100;
    
    function renderNextChunk() {
        const chunk = listToRender.slice(currentIndex, currentIndex + chunkSize);
        let rows = '';
        chunk.forEach((track, idx) => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
            const isActive = currentTrackId === track.id;
            const indexText = isActive && isPlaying ? '<i class="fa-solid fa-pause"></i>' : (currentIndex + idx + 1);
            rows += `<tr class="track-row ${isActive ? 'active' : ''}" data-track-id="${track.id}">
                <td class="track-play-cell">${indexText}</td>
                <td class="track-info-cell">
                    <div class="table-song-cover">${coverUrl ? `<img src="${coverUrl}" alt="Cover" loading="lazy">` : '<i class="fa-solid fa-music"></i>'}</div>
                    <div class="table-song-meta">
                        <span class="table-song-title">${escapeHtml(track.title || 'Untitled')}</span>
                        <span class="table-song-artist">${escapeHtml(track.artist || 'Unknown Artist')}</span>
                    </div>
                </td>
                <td class="track-album-cell">${escapeHtml(track.album || '—')}</td>
                <td class="track-bpm-cell">${track.bpm || '120'}</td>
                <td class="track-time-cell">${formatTime(track.duration)}</td>
                <td class="track-actions-cell">
                    <button class="table-action-btn like" title="${currentLanguage === 'fa' ? 'افزودن به لیست' : 'Add to list'}"><i class="fa-solid fa-plus"></i></button>
                    <button class="table-action-btn delete" title="${currentLanguage === 'fa' ? 'حذف' : 'Delete'}"><i class="fa-solid fa-trash"></i></button>
                </td>
            </table>`;
        });
        tbody.insertAdjacentHTML('beforeend', rows);
        currentIndex += chunkSize;
        if (currentIndex < listToRender.length) loadMoreContainer.style.display = 'block';
        else loadMoreContainer.style.display = 'none';
    }
    
    renderNextChunk();
    if (loadMoreBtn) loadMoreBtn.onclick = () => renderNextChunk();
}

window.setLibraryGenreFilter = function(genre) { libraryGenreFilter = genre; renderLibrary(); };
window.changeLibrarySorting = function(key) { librarySortKey = key; renderLibrary(); };
window.toggleLibrarySortOrder = function() { librarySortOrder = librarySortOrder === 'asc' ? 'desc' : 'asc'; renderLibrary(); };

// =============================================================================
// FAVORITES RENDERING
// =============================================================================

function renderFavorites() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    const likedTracks = tracks.filter(t => t.isLiked);
    if (likedTracks.length === 0) {
        mainSection.innerHTML = `<div class="empty-illustration-state"><i class="fa-solid fa-heart" style="color: var(--accent-pink);"></i><h3>${t('emptyFavs')}</h3><p>${t('emptyFavsDesc')}</p></div>`;
        return;
    }

    // Prepare sections similar to Home dashboard but scoped to favorites
    const totalLikes = likedTracks.length;
    const totalPlays = likedTracks.reduce((s, tr) => s + (tr.playCount || 0), 0);

    // Top liked by playCount
    const topLiked = [...likedTracks].sort((a,b)=>(b.playCount||0)-(a.playCount||0)).slice(0,8);
    const recentLiked = [...likedTracks].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,6);

    let featuredHtml = '';
    topLiked.forEach(track=>{
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        featuredHtml += `<div class="featured-card" data-track-id="${track.id}">
            <div class="featured-art">${coverUrl?`<img src="${coverUrl}" alt="Cover" loading="lazy">`:`<i class="fa-solid fa-music"></i>`}</div>
            <div class="featured-meta"><h4>${escapeHtml(track.title||'Untitled')}</nobr></h4><p>${escapeHtml(track.artist||'Unknown')}</p></div>
            <div class="featured-play" onclick="playTrack(${track.id})"><i class="fa-solid fa-play"></i></div>
        </div>`;
    });

    let recentHtml = '';
    recentLiked.forEach(track=>{
        recentHtml += `<div class="recent-track-item" data-track-id="${track.id}" onclick="playTrack(${track.id})">
            <div class="recent-cover">${track.hasCover?`<img src="http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover" alt="Cover" loading="lazy">`:'<i class="fa-solid fa-music"></i>'}</div>
            <div class="recent-info"><strong>${escapeHtml(track.title||'Untitled')}</strong><span>${escapeHtml(track.artist||'Unknown')}</span></div>
            <div class="recent-meta">${formatTime(track.duration)}</div>
        </div>`;
    });

    mainSection.innerHTML = `
        <div class="hero-compact">
            <div class="hero-left"><h2>${t('navFavText')}</h2><p>${totalLikes} ${t('tracks')} • ${totalPlays} ${t('plays')}</p></div>
            <div class="hero-actions"><button class="hero-primary-btn" onclick="playTracksFromList('favorites')"><i class="fa-solid fa-play"></i> ${t('playAll')}</button></div>
        </div>

        <div class="quick-stats-row">
            <div class="stat-card"><h3>${totalLikes}</h3><p>${t('likedTracks')}</p></div>
            <div class="stat-card"><h3>${totalPlays}</h3><p>${t('totalPlays')}</p></div>
        </div>

        <div class="spotify-row-title"><h3>${t('topLiked')}</h3></div>
        <div class="featured-grid">${featuredHtml}</div>

        <div class="spotify-row-title"><h3>${t('recentlyAdded')}</h3></div>
        <div class="recent-list">${recentHtml}</div>
    `;
}

// =============================================================================
// HOME DASHBOARD
// =============================================================================

function getWelcomeMessage() {
    const now = new Date();
    const hour = now.getHours();
    
    // Get user's name from system or use default
    let userName = '';
    if (window.electronAPI && typeof window.electronAPI.getSystemUser === 'function') {
        userName = window.electronAPI.getSystemUser() || '';
    }
    
    const greeting = userName ? `${userName}, ` : '';
    
    // Morning 5:00 - 11:59
    if (hour >= 5 && hour < 12) {
        if (hour < 8) return t('welcomeEarlyMorning');
        if (hour < 10) return t('welcomeMorningPeak');
        return t('welcomeLateMorning');
    }
    // Afternoon 12:00 - 16:59
    else if (hour >= 12 && hour < 17) {
        if (hour < 14) return t('welcomeNoon');
        return t('welcomeAfternoon');
    }
    // Evening 17:00 - 20:59
    else if (hour >= 17 && hour < 21) {
        if (hour < 19) return t('welcomeEarlyEvening');
        return t('welcomeEvening');
    }
    // Night 21:00 - 4:59
    else {
        if (hour < 23) return t('welcomeLateNight');
        if (hour < 2) return t('welcomeMidnight');
        return t('welcomeDeepNight');
    }
}

function getTopPlayedTracks(limit = 6) {
    return [...tracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, limit);
}

function getDailySuggestions(limit = 8) {
    if (tracks.length === 0) return [];
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentlyAdded = tracks.filter(t => (t.createdAt || 0) > oneMonthAgo);
    const undiscovered = tracks.filter(t => (t.playCount || 0) < 3);
    const highEnergy = tracks.filter(t => (t.energy || 0.5) > 0.7);
    const combined = [...recentlyAdded, ...undiscovered, ...highEnergy];
    const unique = [];
    const seenIds = new Set();
    for (const track of combined) { if (!seenIds.has(track.id)) { seenIds.add(track.id); unique.push(track); } }
    for (let i = unique.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [unique[i], unique[j]] = [unique[j], unique[i]]; }
    return unique.slice(0, limit);
}

/**
 * Render empty home dashboard with premium design
 */
function renderEmptyHomeDashboard() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    mainSection.innerHTML = `
        <div class="empty-home-state">
            <div class="empty-home-illustration">
                <div class="empty-home-disc">
                    <i class="fa-solid fa-compact-disc"></i>
                </div>
            </div>
            <h2 class="empty-home-title">Your Musical Journey Starts Here</h2>
            <p class="empty-home-subtitle">
                Import your favorite tracks to build your personal music library.<br>
                KORAI will analyze and organize them for you.
            </p>
            <div class="empty-home-features">
                <div class="empty-home-feature" onclick="switchSection('stats')">
                    <div class="feature-icon-wrapper"><i class="fa-solid fa-chart-line"></i></div>
                    <span>AI Analysis</span>
                </div>
                <div class="empty-home-feature" onclick="switchSection('library')">
                    <div class="feature-icon-wrapper"><i class="fa-solid fa-waveform"></i></div>
                    <span>Smart Playlists</span>
                </div>
                <div class="empty-home-feature" onclick="document.getElementById('songInfoBtn')?.click()">
                    <div class="feature-icon-wrapper"><i class="fa-solid fa-microphone"></i></div>
                    <span>Vocal Separator</span>
                </div>
                <div class="empty-home-feature" onclick="document.getElementById('dspToggleBtn')?.click()">
                    <div class="feature-icon-wrapper"><i class="fa-solid fa-equalizer"></i></div>
                    <span>Studio EQ</span>
                </div>
            </div>
            <button class="empty-home-btn" onclick="handleImport()">
                <i class="fa-solid fa-plus"></i>
                <span>Import Your First Track</span>
            </button>
        </div>
    `;
}

function renderHomeDashboard() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    const welcomeText = getWelcomeMessage();

    // Now playing
    const nowPlayingTrack = currentTrack || null;
    const nowPlayingCover = nowPlayingTrack && nowPlayingTrack.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${nowPlayingTrack.id}/cover` : null;

    // Featured / top played
    const topTracks = [...tracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 8);

    // Recently added
    const recentTracks = [...tracks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

    // Suggestions (high energy, low plays)
    const suggestions = tracks.filter(t => (t.energy || 0.5) > 0.6 && (t.playCount || 0) < 5).sort(() => Math.random() - 0.5).slice(0, 6);

    // Quick stats
    const totalTracks = tracks.length;
    const totalLikes = tracks.filter(t => t.isLiked).length;
    const totalPlays = tracks.reduce((sum, t) => sum + (t.playCount || 0), 0);

    // If no tracks are loaded and there is no current track, show empty library.
    // If a track is currently playing (e.g., external state), still render the home hero so now-playing info is visible.
    if (tracks.length === 0 && !currentTrack) {
        renderEmptyHomeDashboard();
        return;
    }

    // Build markup
    let html = `
        <div class="home-container-next">
            <div class="hero-cinematic">
                <div class="hero-gradient-bg"></div>
                <div class="hero-content">
                    <div class="hero-text-section">
                        <div class="welcome-badge">
                            <i class="fa-solid fa-waveform"></i>
                            <span>${new Date().getHours() < 12 ? 'MORNING SESSION' : (new Date().getHours() < 18 ? 'AFTERNOON BEATS' : 'EVENING VIBES')}</span>
                        </div>
                        <h1 class="hero-title">${escapeHtml(welcomeText)}</h1>
                        <p class="hero-subtitle">${t('smartRecommendations') || 'Personalized station based on your recent listening'}</p>
                        <div id="playerConnectionStatus" class="player-connection-status">${currentLanguage === 'fa' ? 'در حال بررسی اتصال...' : 'Checking player...'}</div>
                        <div class="hero-actions">
                            <button id="heroPrimaryBtn" class="hero-primary-btn" onclick="heroPrimaryAction()">
                                <i class="fa-solid fa-play"></i> ${t('playPause') || 'Play'}
                            </button>
                            <button class="hero-secondary-btn" onclick="switchSection('library')">
                                <i class="fa-solid fa-music"></i> ${t('navLibText') || 'My Library'}
                            </button>
                            <button class="hero-secondary-btn" onclick="handleAiRecommendationsEnhanced()">
                                <i class="fa-solid fa-brain"></i> AI Mix
                            </button>
                        </div>
                    </div>
                    <div class="hero-art-section">
                        <div class="now-playing-pulse">
                            <div class="pulse-ring"></div>
                            <div class="pulse-ring"></div>
                            <div class="pulse-ring"></div>
                            <div class="now-playing-art">
                                ${nowPlayingCover ? `<img src="${nowPlayingCover}" alt="Now Playing">` : '<div class="fallback-icon"><i class="fa-solid fa-compact-disc"></i></div>'}
                            </div>
                            ${nowPlayingTrack ? `<div class="now-playing-label">NOW PLAYING</div>` : ''}
                        </div>
                    </div>
                </div>
            </div>

            <div class="quick-stats-row">
                <div class="quick-stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-music"></i></div>
                    <div class="stat-info">
                        <h4>${totalTracks}</h4>
                        <p>${t('totalTracksLabel') || 'Total Tracks'}</p>
                    </div>
                </div>
                <div class="quick-stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-heart"></i></div>
                    <div class="stat-info">
                        <h4>${totalLikes}</h4>
                        <p>${t('popularLabel') || 'Liked Tracks'}</p>
                    </div>
                </div>
                <div class="quick-stat-card">
                    <div class="stat-icon"><i class="fa-solid fa-headphones"></i></div>
                    <div class="stat-info">
                        <h4>${totalPlays.toLocaleString()}</h4>
                        <p>${t('totalPlaysLabel') || 'Total Plays'}</p>
                    </div>
                </div>
            </div>

            <div class="mood-chips-row">
                <div class="mood-chips-scroll">
                    <div class="mood-chip" onclick="filterByMood('energetic')"><i class="fa-solid fa-bolt"></i> Energetic</div>
                    <div class="mood-chip" onclick="filterByMood('chill')"><i class="fa-solid fa-cloud-moon"></i> Chill</div>
                    <div class="mood-chip" onclick="filterByMood('focus')"><i class="fa-solid fa-brain"></i> Focus</div>
                    <div class="mood-chip" onclick="filterByMood('workout')"><i class="fa-solid fa-dumbbell"></i> Workout</div>
                    <div class="mood-chip" onclick="filterByMood('sad')"><i class="fa-solid fa-face-frown"></i> Melancholic</div>
                    <div class="mood-chip" onclick="filterByMood('happy')"><i class="fa-solid fa-face-smile"></i> Happy</div>
                    <div class="mood-chip" onclick="filterByMood('romantic')"><i class="fa-solid fa-heart"></i> Romantic</div>
                    <div class="mood-chip" onclick="filterByMood('study')"><i class="fa-solid fa-book"></i> Study</div>
                </div>
            </div>
    `;

    // Featured
    if (topTracks.length > 0) {
        html += `
            <div class="section-header-premium">
                <div class="section-title-group">
                    <h3><i class="fa-solid fa-chart-simple"></i> ${t('statsHero') || 'Most Played'}</h3>
                    <span class="section-badge">🔥 HOT</span>
                </div>
                <span class="view-all-link-premium" onclick="switchSection('library')">
                    ${t('allGenres') || 'View All'} <i class="fa-solid fa-arrow-right"></i>
                </span>
            </div>
            <div class="featured-grid" id="featuredGrid">
        `;

        topTracks.forEach(track => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
            html += `
                <div class="featured-card" data-track-id="${track.id}" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                    <div class="featured-card-glow"></div>
                    <div class="featured-card-image">
                        ${coverUrl ? `<img src="${coverUrl}" alt="${escapeHtml(track.title)}">` : '<div class="fallback-icon"><i class="fa-solid fa-music"></i></div>'}
                        <div class="play-overlay">
                            <div class="play-button-circle"><i class="fa-solid fa-play"></i></div>
                        </div>
                    </div>
                    <div class="featured-card-info">
                        <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                        <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
                        <div class="featured-card-meta">
                            <span class="bpm"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span>
                            <span><i class="fa-regular fa-clock"></i> ${formatTime(track.duration)}</span>
                            <span><i class="fa-solid fa-play"></i> ${(track.playCount || 0).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
    }

    // Suggestions
    if (suggestions.length > 0) {
        html += `
            <div class="section-header-premium">
                <div class="section-title-group">
                    <h3><i class="fa-solid fa-sparkles"></i> ${t('dailySuggestions') || 'Daily Discoveries'}</h3>
                    <span class="section-badge">✨ FRESH</span>
                </div>
                <span class="view-all-link-premium" onclick="handleAiRecommendationsEnhanced()">
                    More <i class="fa-solid fa-arrow-right"></i>
                </span>
            </div>
            <div class="featured-grid" id="suggestionsGrid">
        `;

        suggestions.forEach(track => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
            html += `
                <div class="featured-card" data-track-id="${track.id}" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                    <div class="featured-card-glow"></div>
                    <div class="featured-card-image">
                        ${coverUrl ? `<img src="${coverUrl}" alt="${escapeHtml(track.title)}">` : '<div class="fallback-icon"><i class="fa-solid fa-music"></i></div>'}
                        <div class="play-overlay">
                            <div class="play-button-circle"><i class="fa-solid fa-play"></i></div>
                        </div>
                    </div>
                    <div class="featured-card-info">
                        <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                        <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
                        <div class="featured-card-meta">
                            <span class="bpm"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span>
                            <span><i class="fa-regular fa-clock"></i> ${formatTime(track.duration)}</span>
                            ${track.energy ? `<span><i class="fa-solid fa-bolt"></i> ${Math.round(track.energy * 100)}%</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
    }

    // Recent
    if (recentTracks.length > 0) {
        html += `
            <div class="recent-activity-section">
                <div class="section-header-premium">
                    <div class="section-title-group">
                        <h3><i class="fa-solid fa-clock-rotate-left"></i> ${t('recentActivity') || 'Recently Added'}</h3>
                        <span class="section-badge">🆕 NEW</span>
                    </div>
                </div>
                <div class="recent-track-list" id="recentList">
        `;

        recentTracks.forEach(track => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
            const addedDate = track.createdAt ? new Date(track.createdAt).toLocaleDateString() : 'Recently';
            html += `
                <div class="recent-track-item" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                    <div class="recent-track-cover">
                        ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    </div>
                    <div class="recent-track-info">
                        <h5>${escapeHtml(track.title || 'Untitled')}</h5>
                        <p>${escapeHtml(track.artist || 'Unknown Artist')} • ${escapeHtml(track.album || 'Single')}</p>
                    </div>
                    <div class="recent-track-time">
                        ${addedDate}
                    </div>
                    <div class="recent-track-play">
                        <i class="fa-solid fa-play"></i>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    html += `</div>`;

    mainSection.innerHTML = html;

    // Start/refresh player connection checks (avoid duplicate intervals)
    try { if (window._playerConnInterval) clearInterval(window._playerConnInterval); } catch (e) {}
    if (typeof window.checkPlayerConnection === 'function') {
        window.checkPlayerConnection();
        window._playerConnInterval = setInterval(window.checkPlayerConnection, 10000);
    }

    // Staggered entrance for featured cards
    const cards = document.querySelectorAll('.featured-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => {
            card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 50);
    });
}

// Mood filter helper (available globally below)
function filterByMood(mood) {
    let filteredTracks = [];
    switch(mood) {
        case 'energetic':
            filteredTracks = tracks.filter(t => (t.bpm || 120) > 130 && (t.energy || 0.5) > 0.6);
            break;
        case 'chill':
            filteredTracks = tracks.filter(t => (t.bpm || 120) < 100);
            break;
        case 'focus':
            filteredTracks = tracks.filter(t => (t.bpm || 120) >= 100 && (t.bpm || 120) <= 130);
            break;
        case 'workout':
            filteredTracks = tracks.filter(t => (t.bpm || 120) > 140);
            break;
        case 'sad':
            filteredTracks = tracks.filter(t => (t.energy || 0.5) < 0.4);
            break;
        case 'happy':
            filteredTracks = tracks.filter(t => (t.energy || 0.5) > 0.7);
            break;
        default:
            filteredTracks = tracks;
    }

    if (filteredTracks.length > 0) {
        renderLibrary(filteredTracks);
        switchSection('library');
        showNotification(`${mood.charAt(0).toUpperCase() + mood.slice(1)} mode activated - ${filteredTracks.length} tracks`, 'success');
    } else {
        showNotification(`No tracks found for ${mood} mood`, 'info');
    }
}
// Expose filterByMood globally
window.filterByMood = filterByMood;

function scrollCarousel(trackId, dir = 1) {
    const el = document.getElementById(trackId);
    if (!el) return;
    const card = el.querySelector('.carousel-card');
    const step = card ? card.offsetWidth + 16 : 240;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
}

// Quick helper to start playing the daily suggestions station
function playTopSuggestions() {
    const list = getDailySuggestions(12);
    if (!list || list.length === 0) { showNotification(currentLanguage === 'fa' ? 'هیچ پیشنهادی موجود نیست' : 'No suggestions available', 'info'); return; }
    // Play the first track and enqueue the rest
    const first = list[0];
    try {
        // Set play source as a playlist so setPlaySource will use the provided tracks
        playTrack(first.id, 'playlist', 'home-suggestions', list);
        // Ensure queue reflects the suggestions
        lastPlaySource = { type: 'playlist', sourceId: 'home-suggestions', sourceTracks: [...list] };
        queue = [...list];
        queueIndex = 0;
        renderQueue();
        showNotification(currentLanguage === 'fa' ? 'در حال پخش پیشنهادها' : 'Playing suggestions', 'success');
    } catch (e) { console.warn('playTopSuggestions failed', e); showNotification('Playback failed', 'error'); }
}

// Unified hero primary action: toggle play if a track exists, otherwise start suggestions
function heroPrimaryAction() {
    try {
        if (currentTrackId) {
            togglePlay();
            return;
        }

        // If there's no current track but desktop main process can control playback,
        // prefer signaling the main process to toggle playback (prevents empty-library warning)
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('play-pause');
            return;
        }

        // Fallback: start suggestions if available
        playTopSuggestions();
    } catch (e) {
        console.warn('heroPrimaryAction error', e);
        playTopSuggestions();
    }
}

// =============================================================================
// STATS RENDERING
// =============================================================================

async function renderStats() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/stats`);
        if (!res.ok) throw new Error();
        const stats = await res.json();
        mainSection.innerHTML = `<div class="spotify-row-title"><h3>${t('statsTitle')}</h3></div><div class="live-stats-dashboard"><div class="live-stat-card border-cyan"><i class="fa-solid fa-music"></i><h5>${t('totalTracksLabel')}</h5><h2>${stats.totalTracks || 0}</h2></div><div class="live-stat-card border-pink"><i class="fa-solid fa-headphones"></i><h5>${t('totalPlaysLabel')}</h5><h2>${stats.totalPlayCount || 0}</h2></div><div class="live-stat-card border-green"><i class="fa-solid fa-heart"></i><h5>${t('popularLabel')}</h5><h2>${stats.totalLikes || 0}</h2></div></div>${stats.mostPlayed ? `<div class="most-played-highlight"><i class="fa-solid fa-trophy"></i><div><span class="hero-label">${t('statsHero')}</span><h2 class="hero-title">${escapeHtml(stats.mostPlayed.title)}</h2><p class="hero-desc">${escapeHtml(stats.mostPlayed.artist || 'Unknown Artist')}</p><p class="hero-detail">${t('topTrackLabel')} (<strong>${stats.mostPlayed.playCount || 0}</strong> ${t('playedTimes')}).</p></div></div>` : ''}<h4 style="margin-top:24px; margin-bottom:12px; font-size:0.9rem; color:var(--spotify-text-muted);"><i class="fa-solid fa-wave-square"></i> ${t('liveSpectrumLabel')}</h4><canvas id="telemetrySpectrumCanvas" width="600" height="200" style="width:100%; height:200px; background-color:#0c0c0e; border-radius:var(--radius-lg); border:1px solid var(--border-color);"></canvas>`;
    } catch { mainSection.innerHTML = `<p class="stats-error">${t('statsError')}</p>`; }
}

// =============================================================================
// ARTISTS SECTION
// =============================================================================

function renderArtists() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    if (tracks.length === 0) {
        mainSection.innerHTML = `<div class="empty-illustration-state"><i class="fa-solid fa-microphone"></i><h3>${t('emptyArtistsState') || 'No Artists Found'}</h3><p>${t('emptyArtistsDesc') || 'Add some music tracks to see your artists.'}</p></div>`;
        return;
    }
    const artistsMap = new Map();
    tracks.forEach(track => {
        const artistName = track.artist || 'Unknown Artist';
        if (!artistsMap.has(artistName)) artistsMap.set(artistName, { name: artistName, tracks: [], coverImage: null, hasCover: false, coverUrl: null });
        artistsMap.get(artistName).tracks.push(track);
        const artistData = artistsMap.get(artistName);
        if (!artistData.coverImage && track.coverImage && track.coverImage.length > 0) { artistData.coverImage = track.coverImage; artistData.hasCover = track.hasCover; artistData.coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null; }
    });
    const artists = Array.from(artistsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    let artistsHtml = '';
    artists.forEach(artist => {
        const coverHtml = artist.coverUrl ? `<img src="${artist.coverUrl}" alt="${escapeHtml(artist.name)}" loading="lazy">` : '<i class="fa-solid fa-microphone-alt"></i>';
        artistsHtml += `<div class="artist-card" data-artist-name="${escapeHtml(artist.name)}"><div class="artist-avatar">${coverHtml}</div><div class="artist-name truncate-text">${escapeHtml(artist.name)}</div><div class="artist-tracks-count">${artist.tracks.length} ${t('tracksCount') || 'tracks'}</div></div>`;
    });
    mainSection.innerHTML = `<div class="spotify-row-title"><h3><i class="fa-solid fa-microphone"></i> ${t('artistsTitle') || 'Artists'} (${artists.length})</h3></div><div class="artists-grid" id="artistsGrid">${artistsHtml}</div>`;
}

function showArtistDetail(artistName) {
    const artistTracks = tracks.filter(track => (track.artist || 'Unknown Artist') === artistName);
    if (artistTracks.length === 0) return;
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    let artistCover = null;
    for (const track of artistTracks) { if (track.hasCover && track.coverImage) { artistCover = `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover`; break; } }
    const coverHtml = artistCover ? `<img src="${artistCover}" alt="${escapeHtml(artistName)}">` : '<i class="fa-solid fa-microphone-alt"></i>';
    // Simplified artist detail: compact header + plain list to reduce DOM complexity
    let listHtml = '';
    artistTracks.forEach((track, index) => {
        const isActive = currentTrackId === track.id;
        const indexText = isActive && isPlaying ? '<i class="fa-solid fa-pause"></i>' : (index + 1);
        listHtml += `
            <li class="artist-track-item ${isActive ? 'active' : ''}" data-track-id="${track.id}">
                <span class="track-index">${indexText}</span>
                <span class="track-title">${escapeHtml(track.title || 'Untitled')}</span>
                <span class="track-duration">${formatTime(track.duration)}</span>
            </li>`;
    });

    mainSection.innerHTML = `
        <div class="artist-detail-view simple-artist-view">
            <button class="back-to-artists-btn"><i class="fa-solid fa-arrow-right"></i> ${t('backToArtists') || 'Back to Artists'}</button>
            <div class="artist-header simple">
                <div class="artist-header-avatar">${coverHtml}</div>
                <div class="artist-header-info">
                    <h2>${escapeHtml(artistName)}</h2>
                    <p>${artistTracks.length} ${t('tracksCount') || 'tracks'}</p>
                    <div>
                        <button class="play-artist-btn"><i class="fa-solid fa-play"></i> ${t('playArtist') || 'Play All'}</button>
                    </div>
                </div>
            </div>
            <div class="artist-tracks-list">
                <ul class="artist-track-list">
                    ${listHtml}
                </ul>
            </div>
        </div>`;

    // Wire small action buttons programmatically and use delegation for list interactions
    const backBtn = mainSection.querySelector('.back-to-artists-btn');
    if (backBtn) backBtn.addEventListener('click', () => renderArtists());
    const playArtistBtn = mainSection.querySelector('.play-artist-btn');
    if (playArtistBtn) playArtistBtn.addEventListener('click', () => playArtist(artistName));

    const listEl = mainSection.querySelector('.artist-track-list');
    if (listEl) {
        listEl.addEventListener('contextmenu', (e) => {
            const li = e.target.closest && e.target.closest('li');
            if (!li) return;
            const id = parseInt(li.dataset.trackId);
            if (!id) return;
            e.preventDefault();
            showPlaylistContextMenu(id, e.clientX, e.clientY);
        });
    }
}

// =============================================================================
// AI RECOMMENDATIONS (unchanged)
// =============================================================================

async function handleAiRecommendationsEnhanced() {
    if (!currentTrackId) { showNotification('Play a track first', 'warning'); return; }
    showNotification('AI analyzing your taste...', 'info');
    try {
        fetch(`http://127.0.0.1:${apiPort}/api/ai/interaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: currentTrackId, action: 'play' }) }).catch(e => console.error(e));
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/ai/recommend/personal/${currentTrackId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!data.recommendations || data.recommendations.length === 0) { showNotification('No AI recommendations yet. Listen to more music!', 'info'); return; }
        renderRecommendationsUI(data);
    } catch (err) { console.error('AI error:', err); showNotification('AI recommendation failed', 'error'); }
}

function renderRecommendationsUI(data) {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    let recsHtml = '';
    for (const track of data.recommendations) {
        const coverUrl = track.coverUrl ? `http://127.0.0.1:${apiPort}${track.coverUrl}` : null;
        recsHtml += `<div class="spotify-music-card" data-track-id="${track.id}" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
            <div class="card-image-box">${coverUrl ? `<img src="${coverUrl}" alt="Cover" loading="lazy">` : '<i class="fa-solid fa-music"></i>'}<div class="hover-play-bubble"><i class="fa-solid fa-play"></i></div></div>
            <div class="card-details-info"><h4>${escapeHtml(track.title || 'Untitled')}</h4><p>${escapeHtml(track.artist || 'Unknown')}</p></div>
            <div class="card-additional-meta"><span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span><span class="similarity-badge" style="color: var(--accent-cyan);">${track.similarity || '?'}% match</span></div>
            <div class="recommend-reason"><small><i class="fa-solid ${track.similarityIcon || 'fa-brain'}"></i> ${track.reason || 'AI recommended'}</small></div>
        </div>`;
    }
    mainSection.innerHTML = `<div class="spotify-row-title"><h3><i class="fa-solid fa-brain" style="color: var(--accent-cyan);"></i> AI Recommendations · Based on your taste</h3><button class="discover-btn" onclick="getDiscoveryRecommendations()" style="background:transparent; border:1px solid var(--accent-cyan); border-radius:20px; padding:6px 16px; color:var(--accent-cyan); cursor:pointer;"><i class="fa-solid fa-compass"></i> Discover New</button></div><div class="cards-responsive-grid" id="recommendationsGrid">${recsHtml}</div>`;
}

async function getDiscoveryRecommendations() {
    showNotification('Finding new music for you...', 'info');
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/ai/discover`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!data.recommendations || data.recommendations.length === 0) { showNotification('No new discoveries found', 'info'); return; }
        const mainSection = document.getElementById('dynamicSectionContainer');
        if (!mainSection) return;
        let discHtml = '';
        for (const track of data.recommendations) {
            const coverUrl = track.coverUrl ? `http://127.0.0.1:${apiPort}${track.coverUrl}` : null;
            discHtml += `<div class="spotify-music-card" data-track-id="${track.id}" onclick="playTrack(${track.id})"><div class="card-image-box">${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}<div class="hover-play-bubble"><i class="fa-solid fa-play"></i></div></div><div class="card-details-info"><h4>${escapeHtml(track.title || 'Untitled')}</h4><p>${escapeHtml(track.artist || 'Unknown')}</p></div><div class="card-additional-meta"><span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span><span class="genre-badge" style="color: var(--spotify-text-muted);">${track.genre || 'Various'}</span></div><div class="recommend-reason"><small><i class="fa-solid fa-sparkles"></i> New discovery for you</small></div></div>`;
        }
        mainSection.innerHTML = `<div class="spotify-row-title"><h3><i class="fa-solid fa-compass"></i> Discover New Music</h3><span class="view-all-link" onclick="handleAiRecommendationsEnhanced()">← Back to AI Recs</span></div><div class="cards-responsive-grid">${discHtml}</div>`;
    } catch (err) { showNotification('Discovery failed', 'error'); }
}

async function createSimilarPlaylistFromCurrent() {
    if (!currentTrackId) { 
        showNotification(currentLanguage === 'fa' ? 'ابتدا یک آهنگ پخش کنید' : 'Play a track first.', 'warning'); 
        return; 
    }
    
    showNotification(currentLanguage === 'fa' ? 'در حال ساخت پلی‌لیست مشابه...' : 'Creating similar playlist...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/similar`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ trackId: currentTrackId }) 
        });
        
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Request failed');
        }
        
        const result = await res.json();
        
        if (result.success && result.playlist) {
            showNotification(`Playlist "${result.playlist.name}" created with ${result.trackCount} tracks`, 'success');
            await loadPlaylists();
            setTimeout(() => { 
                openPlaylist(result.playlist.id); 
            }, 500);
        } else if (result.message) {
            showNotification(result.message, 'warning');
        } else {
            showNotification('No similar tracks found', 'warning');
        }
    } catch (err) { 
        console.error('Create playlist error:', err); 
        showNotification(currentLanguage === 'fa' ? 'خطا در ساخت پلی‌لیست' : 'Error creating playlist', 'error'); 
    }
}

async function toggleLikeWithAI() {
    if (!currentTrackId) return;
    // 1) Optimistic UI update
    const wasLiked = currentTrack && currentTrack.isLiked;
    const newLiked = !wasLiked;
    try {
        const trackInList = tracks.find(t => t.id === currentTrackId);
        if (trackInList) trackInList.isLiked = newLiked;
        if (currentTrack) currentTrack.isLiked = newLiked;
        updatePlayerUI();

        const method = wasLiked ? 'DELETE' : 'POST';
        // 2) Fire network request in background
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${currentTrackId}/like`, { method });
        if (!res.ok) throw new Error('Like request failed');

        // Fire-and-forget AI interaction
        fetch(`http://127.0.0.1:${apiPort}/api/ai/interaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId: currentTrackId, action: wasLiked ? 'unlike' : 'like' })
        }).catch(() => {});

        showNotification(newLiked ? 'Added to favorites' : 'Removed from favorites', 'success');
    } catch (err) {
        // 3) Rollback on failure
        const trackInList = tracks.find(t => t.id === currentTrackId);
        if (trackInList) trackInList.isLiked = wasLiked;
        if (currentTrack) currentTrack.isLiked = wasLiked;
        updatePlayerUI();
        showNotification('Failed to update favorites', 'error');
    }
}

window.toggleLike = toggleLikeWithAI;
window.handleAiRecommendations = handleAiRecommendationsEnhanced;

// =============================================================================
// IMPORT HANDLERS
// =============================================================================

async function handleImport() {
    if (!window.electronAPI || typeof window.electronAPI.selectAudioFiles !== 'function') {
        showNotification('Electron API not available', 'error');
        return;
    }

    try {
        const filePaths = await window.electronAPI.selectAudioFiles();
        if (!filePaths || filePaths.length === 0) return;

        // Show loading modal
        showImportLoadingModal(filePaths.length);
        let progressInterval = null;
        let lastProgress = 0;

        // Simulate progress animation (will be updated by actual server response)
        progressInterval = setInterval(() => {
            if (lastProgress < 90) {
                lastProgress += Math.random() * 8;
                if (lastProgress > 90) lastProgress = 90;
                updateImportLoadingProgress(lastProgress, `Importing ${Math.floor(lastProgress)}%...`);
            }
        }, 300);

        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths })
        });

        // Clear interval
        if (progressInterval) clearInterval(progressInterval);

        if (!res.ok) throw new Error();

        const result = await res.json();

        // Update to 100% and show completion
        updateImportLoadingProgress(100, `Imported ${result.imported} track(s)!`);

        // Delay hiding modal slightly to show completion
                setTimeout(async () => {
            hideImportLoadingModal();
            showNotification(`Successfully added ${result.imported} tracks.`, 'success');
                await loadTracks();
                try {
                        if (result.imported > 0 && tracks.length > 0) {
                            // Prefer server-provided mapping when available
                            if (Array.isArray(result.importedTracks) && result.importedTracks.length > 0) {
                                let matched = null;
                                for (const it of result.importedTracks) {
                                    const ft = tracks.find(tt => tt.id === it.id || (tt.filePath && it.filePath && normalizePath(tt.filePath) === normalizePath(it.filePath)));
                                    if (ft) { matched = ft; break; }
                                }
                                if (matched) {
                                    console.debug('Autoplay matched by server mapping (select):', matched.id, matched.title);
                                    tryAutoPlayTrack(matched.id).catch(e => console.debug('Autoplay failed', e));
                                } else {
                                    // Try to match by original file path(s)
                                    let matched2 = null;
                                    for (const fp of filePaths) {
                                        const ft = findTrackByFilePath(fp);
                                        if (ft) { matched2 = ft; break; }
                                    }
                                    if (matched2) {
                                        console.debug('Autoplay matched by file path (select):', matched2.id, matched2.title);
                                        tryAutoPlayTrack(matched2.id).catch(e => console.debug('Autoplay failed', e));
                                    } else {
                                        const newTracks = tracks.slice(-result.imported);
                                        console.debug('Newly imported tracks (select fallback):', newTracks.map(t=>({ id: t.id, title: t.title })));
                                        const lastTrack = newTracks[newTracks.length - 1] || newTracks[0];
                                        if (lastTrack) tryAutoPlayTrack(lastTrack.id).catch(e => console.debug('Autoplay failed', e));
                                    }
                                }
                            } else {
                                let matched = null;
                                for (const fp of filePaths) {
                                    const ft = findTrackByFilePath(fp);
                                    if (ft) { matched = ft; break; }
                                }
                                if (matched) {
                                    console.debug('Autoplay matched by file path (select):', matched.id, matched.title);
                                    tryAutoPlayTrack(matched.id).catch(e => console.debug('Autoplay failed', e));
                                } else {
                                    const newTracks = tracks.slice(-result.imported);
                                    console.debug('Newly imported tracks (select fallback):', newTracks.map(t=>({ id: t.id, title: t.title })));
                                    const lastTrack = newTracks[newTracks.length - 1] || newTracks[0];
                                    if (lastTrack) tryAutoPlayTrack(lastTrack.id).catch(e => console.debug('Autoplay failed', e));
                                }
                            }
                        }
                } catch (e) { console.debug('Autoplay after import failed', e); }
                switchSection(currentActiveSection);
        }, 500);

    } catch (err) {
        console.error('Import error:', err);
        hideImportLoadingModal();
        showNotification('Import failed: ' + err.message, 'error');
    }
}

async function handleFolderImport() {
    if (!window.electronAPI || typeof window.electronAPI.selectAudioFolder !== 'function') {
        showNotification('Electron API not available', 'error');
        return;
    }

    try {
        showNotification('Scanning folder...', 'info');

        const filePaths = await window.electronAPI.selectAudioFolder();

        if (!filePaths || filePaths.length === 0) {
            showNotification('No audio files found in selected folder. Supported formats: MP3, WAV, OGG, M4A, FLAC', 'warning');
            return;
        }

        // Show loading modal
        showImportLoadingModal(filePaths.length);
        let progressInterval = null;
        let lastProgress = 0;

        progressInterval = setInterval(() => {
            if (lastProgress < 90) {
                lastProgress += Math.random() * 8;
                if (lastProgress > 90) lastProgress = 90;
                updateImportLoadingProgress(lastProgress, `Importing ${Math.floor(lastProgress)}%...`);
            }
        }, 300);

        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths })
        });

        if (progressInterval) clearInterval(progressInterval);

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || 'Import failed');
        }

        const result = await res.json();

        updateImportLoadingProgress(100, `Imported ${result.imported} track(s)!`);

        setTimeout(async () => {
            hideImportLoadingModal();
            showNotification(`Successfully imported ${result.imported} tracks.`, 'success');
            await loadTracks();
            try {
                if (result.imported > 0 && tracks.length > 0) {
                    // Prefer server-provided mapping when available
                    if (Array.isArray(result.importedTracks) && result.importedTracks.length > 0) {
                        let matched = null;
                        for (const it of result.importedTracks) {
                            const ft = tracks.find(tt => tt.id === it.id || (tt.filePath && it.filePath && normalizePath(tt.filePath) === normalizePath(it.filePath)));
                            if (ft) { matched = ft; break; }
                        }
                        if (matched) {
                            console.debug('Autoplay matched by server mapping (folder):', matched.id, matched.title);
                            tryAutoPlayTrack(matched.id).catch(e => console.debug('Autoplay failed', e));
                        } else {
                            const newTracks = tracks.slice(-result.imported);
                            const lastTrack = newTracks[newTracks.length - 1] || newTracks[0];
                            if (lastTrack) tryAutoPlayTrack(lastTrack.id).catch(e => console.debug('Autoplay failed', e));
                        }
                    } else {
                        let matched = null;
                        for (const fp of filePaths) {
                            const ft = findTrackByFilePath(fp);
                            if (ft) { matched = ft; break; }
                        }
                        if (matched) {
                            console.debug('Autoplay matched by file path (folder):', matched.id, matched.title);
                            tryAutoPlayTrack(matched.id).catch(e => console.debug('Autoplay failed', e));
                        } else {
                            const newTracks = tracks.slice(-result.imported);
                            const lastTrack = newTracks[newTracks.length - 1] || newTracks[0];
                            if (lastTrack) tryAutoPlayTrack(lastTrack.id).catch(e => console.debug('Autoplay failed', e));
                        }
                    }
                }
            } catch (e) { console.debug('Autoplay after folder import failed', e); }
            switchSection(currentActiveSection);
        }, 500);

    } catch (err) {
        console.error('Folder import error:', err);
        hideImportLoadingModal();
        showNotification(`Import failed: ${err.message}`, 'error');
    }
}


function promptDownloadFromUrl() {
    const modal = document.getElementById('downloadUrlModal');
    const input = document.getElementById('downloadUrlInput');
    const confirmBtn = document.getElementById('confirmDownloadBtn');
    if (!modal || !input || !confirmBtn) return;
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
    confirmBtn.onclick = async () => {
        const url = input.value.trim();
        if (!url) { showNotification('Please provide a valid URL', 'warning'); return; }
        closeDownloadUrlModal();
        showNotification('Configuring cloud request...', 'info');
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            if (res.ok) { showNotification('Audio downloaded successfully', 'success'); await loadTracks(); switchSection(currentActiveSection); }
            else { showNotification('Request failed', 'error'); }
        } catch (e) { showNotification('Cloud capture aborted', 'error'); }
    };
}

function closeDownloadUrlModal() { const modal = document.getElementById('downloadUrlModal'); if (modal) modal.style.display = 'none'; }

// =============================================================================
// SECTION SWITCHING
// =============================================================================

window.switchSection = function(sectionName) {
    if (isMiniWindowMode) return;

    const heroEl = document.querySelector('.hero-cinematic, .hero-cinematic-v2');

    const doSwitch = () => {
        currentActiveSection = sectionName;
        currentActivePlaylistId = null;
        document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-playlist-item').forEach(item => item.classList.remove('active'));
        const navHome = document.getElementById('navHome'); const navLibrary = document.getElementById('navLibrary'); const navArtists = document.getElementById('navArtists'); const navFavorites = document.getElementById('navFavorites'); const navStats = document.getElementById('navStats');
        if (sectionName === 'home' && navHome) navHome.classList.add('active');
        if (sectionName === 'library' && navLibrary) navLibrary.classList.add('active');
        if (sectionName === 'artists' && navArtists) navArtists.classList.add('active');
        if (sectionName === 'albums') renderAlbums();
        if (sectionName === 'favorites' && navFavorites) navFavorites.classList.add('active');
        if (sectionName === 'stats' && navStats) navStats.classList.add('active');
        if (sectionName === 'home') renderHomeDashboard();
        if (sectionName === 'library') renderLibrary();
        if (sectionName === 'artists') renderArtists();
        if (sectionName === 'favorites') renderFavorites();
        if (sectionName === 'stats') { renderStats().then(() => { if (audioCtx && analyser) startLiveSpectrumAnalyzer(); }); }
    };

    // If we're switching away from home and the cinematic hero exists, play a close animation first
    if (sectionName !== 'home' && heroEl) {
        try {
            heroEl.classList.add('closing');
            const fsBg = document.getElementById('fsBgBlur');
            if (fsBg) {
                fsBg.classList.remove('show');
                fsBg.classList.add('closing');
            }
            setTimeout(() => {
                // remove hero from DOM or let render replace it
                if (fsBg) fsBg.classList.remove('closing');
                doSwitch();
                // apply enter animation to new section after switch
                setTimeout(() => applySectionAnimations(sectionName), 30);
            }, 420);
        } catch (e) {
            doSwitch();
            setTimeout(() => applySectionAnimations(sectionName), 30);
        }
    } else {
        doSwitch();
        setTimeout(() => applySectionAnimations(sectionName), 30);
    }
};

// Helper: apply entrance animations and stagger to section content
function applySectionAnimations(sectionName) {
    try {
        // animate nav active glow
        const activeNav = document.querySelector('.sidebar-nav .nav-item.active');
        if (activeNav) {
            activeNav.classList.remove('nav-item-activate');
            void activeNav.offsetWidth;
            activeNav.classList.add('nav-item-activate');
        }

        // main content container
        const container = document.getElementById('dynamicSectionContainer');
        if (!container) return;

        // add enter animation to container
        container.classList.remove('section-exit');
        container.classList.add('section-enter');

        // stagger child items (cards, list rows, grid items)
        const items = container.querySelectorAll('.grid-item, .list-row, .content-card, .song-row, .playlist-item');
        items.forEach((it, idx) => {
            it.classList.remove('content-item-appear');
            it.style.animationDelay = (idx * 40) + 'ms';
            void it.offsetWidth;
            it.classList.add('content-item-appear');
        });

        // gently fade out any loading placeholder
        const loading = container.querySelector('.loading-state-placeholder');
        if (loading) {
            loading.classList.add('section-exit');
            setTimeout(() => { if (loading && loading.parentNode) loading.parentNode.removeChild(loading); }, 500);
        }
    } catch (e) {
        console.warn('applySectionAnimations failed', e);
    }
}

// Ripple effect on nav clicks
document.addEventListener('click', (ev) => {
    const nav = ev.target.closest('.nav-item');
    if (!nav) return;
    const rect = nav.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple-effect';
    ripple.style.left = (ev.clientX - rect.left) + 'px';
    ripple.style.top = (ev.clientY - rect.top) + 'px';
    nav.style.position = nav.style.position || 'relative';
    nav.appendChild(ripple);
    setTimeout(() => { ripple.remove(); }, 650);
});

// =============================================================================
// EVENT LISTENERS SETUP
// =============================================================================

/**
 * Set up all event listeners for the application
 */
function setupEventListeners() {
    // =========================================================================
    // WINDOW CONTROLS
    // =========================================================================
    const winMinBtn = document.getElementById('winMinimizeBtn');
    const winMaxBtn = document.getElementById('winMaximizeBtn');
    const winCloseBtn = document.getElementById('winCloseBtn');
    
    if (winMinBtn) winMinBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    if (winMaxBtn) winMaxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    if (winCloseBtn) winCloseBtn.addEventListener('click', () => window.electronAPI.closeWindow());

    // =========================================================================
    // LANGUAGE & SKIN
    // =========================================================================
    const langToggleBtn = document.getElementById('langToggleBtn');
    if (langToggleBtn) {
        langToggleBtn.addEventListener('click', () => {
            const newLang = currentLanguage === 'fa' ? 'en' : 'fa';
            changeClientLanguage(newLang);
        });
    }

    const skinBtns = document.querySelectorAll('.skin-btn');
    if (skinBtns.length) {
        skinBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const skinValue = btn.dataset.skin;
                let newSkin = skinValue;
                if (skinValue === 'apple') newSkin = 'liquid-glass';
                if (skinValue !== 'default' && skinValue !== 'liquid-glass') newSkin = 'default';
                skinBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                applyGlobalSkin(newSkin);
            });
        });
        
        const activeSkinBtn = document.querySelector(`.skin-btn[data-skin="${currentSkin}"]`);
        if (activeSkinBtn) {
            skinBtns.forEach(b => b.classList.remove('active'));
            activeSkinBtn.classList.add('active');
        }
    }


    // Listen for settings changes
    window.addEventListener('settings-changed', (e) => {
        const { key, value } = e.detail;
        
        // Apply settings that affect playback in real-time
        switch (key) {
            case 'defaultVolume':
                if (typeof setVolume === 'function') {
                    setVolume(value / 100);
                }
                break;
            case 'eq':
                if (typeof updateEqualizerBand === 'function') {
                    for (let i = 0; i < 5; i++) {
                        updateEqualizerBand(i, value[i] || 0);
                    }
                }
                break;
            case 'gaplessEnabled':
            case 'crossfadeDuration':
                // Will be applied by settingsSync
                break;
        }
    });

    // Listen for stay-in-tray changes from main process
    window.addEventListener('stay-in-tray-changed', (e) => {
        console.debug('🟢 Stay in tray changed:', e.detail.enabled);
    });
    // =========================================================================
    // AI / PLAYLIST ACTIONS
    // =========================================================================
    const createSimilarBtn = document.getElementById('createSimilarPlaylistBtn');
    if (createSimilarBtn) createSimilarBtn.addEventListener('click', createSimilarPlaylistFromCurrent);

    // =========================================================================
    // SEARCH INPUT
    // =========================================================================
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase().trim();
            if (val === '') {
                switchSection(currentActiveSection);
                return;
            }
            const filtered = tracks.filter(t =>
                (t.title && t.title.toLowerCase().includes(val)) ||
                (t.artist && t.artist.toLowerCase().includes(val)) ||
                (t.album && t.album.toLowerCase().includes(val))
            );
            renderLibrary(filtered);
        });
    }

    // =========================================================================
    // KEYBOARD SHORTCUTS
    // =========================================================================
    window.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in input fields
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const sInput = document.getElementById('searchInput');
                if (sInput) sInput.focus();
            }
            return;
        }
        
        switch (e.key) {
            case ' ':
            case 'Spacebar':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (e.ctrlKey) {
                    nextTrackEnhanced();
                } else if (audioElement) {
                    audioElement.currentTime = Math.min(audioElement.duration || 0, audioElement.currentTime + 10);
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (e.ctrlKey) {
                    prevTrackEnhanced();
                } else if (audioElement) {
                    audioElement.currentTime = Math.max(0, audioElement.currentTime - 10);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                setVolume(Math.min(1.0, volume + 0.05));
                break;
            case 'ArrowDown':
                e.preventDefault();
                setVolume(Math.max(0.0, volume - 0.05));
                break;
            case 'm':
            case 'M':
                toggleMute();
                break;
            case 'n':
            case 'N':
                nextTrackEnhanced();
                break;
            case 'b':
            case 'B':
            case 'p':
            case 'P':
                prevTrackEnhanced();
                break;
            case 's':
            case 'S':
                if (audioElement) {
                    audioElement.pause();
                    audioElement.currentTime = 0;
                    setPlayState(false);
                }
                break;
            case 'f':
            case 'F':
                toggleFullscreen();
                break;
            case 'Escape':
                if (isFullscreenPlayerOpen) toggleFullscreen();
                break;
        }
    });

    // =========================================================================
    // TIMELINE SCRUB & SEEK (FIXED)
    // =========================================================================
    const progressBar = document.getElementById('progressBarK');
    const scrubTooltip = document.getElementById('scrubTooltip');
    
    if (progressBar && scrubTooltip) {
        // Update tooltip position on mousemove
        progressBar.addEventListener('mousemove', (e) => {
            if (!audioElement || !audioElement.duration || isNaN(audioElement.duration)) return;
            
            const rect = progressBar.getBoundingClientRect();
            let posX = e.clientX - rect.left;
            posX = Math.max(0, Math.min(rect.width, posX));
            const percent = posX / rect.width;
            const calculatedTime = percent * audioElement.duration;
            
            scrubTooltip.innerText = formatTime(calculatedTime);
            scrubTooltip.style.left = `${posX}px`;
            scrubTooltip.style.display = 'block';
        });
        
        // Hide tooltip on mouse leave
        progressBar.addEventListener('mouseleave', () => {
            scrubTooltip.style.display = 'none';
        });
        
        // Handle click for seeking
        progressBar.addEventListener('click', (e) => {
            e.stopPropagation();
            handleTimelineSeek(e);
        });
    }
    
    // Fullscreen mirror timeline seek
    const fsMirrorProgress = document.getElementById('fsMirrorProgressContainer');
    if (fsMirrorProgress) fsMirrorProgress.addEventListener('click', handleMirrorSeek);

    // =========================================================================
    // PLAYBACK CONTROLS
    // =========================================================================
    const mainPlayBtn = document.getElementById('mainPlayBtn');
    if (mainPlayBtn) mainPlayBtn.addEventListener('click', togglePlay);
    
    const miniPlayBtn = document.getElementById('miniPlayBtn');
    if (miniPlayBtn) miniPlayBtn.addEventListener('click', togglePlay);
    
    const nextBtn = document.getElementById('nextBtnK');
    if (nextBtn) nextBtn.addEventListener('click', nextTrackEnhanced);
    
    const prevBtn = document.getElementById('prevBtnK');
    if (prevBtn) prevBtn.addEventListener('click', prevTrackEnhanced);
    
    const shuffleBtn = document.getElementById('shuffleBtnK');
    if (shuffleBtn) shuffleBtn.addEventListener('click', toggleShuffleEnhanced);

    const preferredGenreBtn = document.getElementById('preferredGenreBtn');
    if (preferredGenreBtn) preferredGenreBtn.addEventListener('click', togglePreferredGenreMode);
    
    const repeatBtn = document.getElementById('repeatBtnK');
    if (repeatBtn) {
        repeatBtn.addEventListener('click', () => {
            if (repeatOneMode) {
                repeatOneMode = false;
                repeatMode = false;
                showNotification('Repeat disabled', 'info');
            } else if (repeatMode) {
                repeatOneMode = true;
                repeatMode = true;
                showNotification('Repeat One (single track)', 'info');
            } else {
                repeatMode = true;
                repeatOneMode = false;
                showNotification('Repeat All (playlist)', 'info');
            }
            updateRepeatUI();
        });
    }
    
    const fsPlayBtn = document.getElementById('fsPlayBtn');
    if (fsPlayBtn) fsPlayBtn.addEventListener('click', togglePlay);
    
    const fsNextBtn = document.getElementById('fsNextBtn');
    if (fsNextBtn) fsNextBtn.addEventListener('click', nextTrackEnhanced);
    
    const fsPrevBtn = document.getElementById('fsPrevBtn');
    if (fsPrevBtn) fsPrevBtn.addEventListener('click', prevTrackEnhanced);
    
    const fsShuffleBtn = document.getElementById('fsShuffleBtn');
    if (fsShuffleBtn) fsShuffleBtn.addEventListener('click', toggleShuffleEnhanced);

    const fsPreferredGenreBtn = document.getElementById('fsPreferredGenreBtn');
    if (fsPreferredGenreBtn) fsPreferredGenreBtn.addEventListener('click', togglePreferredGenreMode);
    
    const fsRepeatBtn = document.getElementById('fsRepeatBtn');
    if (fsRepeatBtn) {
        fsRepeatBtn.addEventListener('click', () => {
            if (repeatOneMode) {
                repeatOneMode = false;
                repeatMode = false;
                showNotification('Repeat disabled', 'info');
            } else if (repeatMode) {
                repeatOneMode = true;
                repeatMode = true;
                showNotification('Repeat One (single track)', 'info');
            } else {
                repeatMode = true;
                repeatOneMode = false;
                showNotification('Repeat All (playlist)', 'info');
            }
            updateRepeatUI();
        });
    }
    
    const likeBtn = document.getElementById('likeBtnK');
    if (likeBtn) likeBtn.addEventListener('click', toggleLikeWithAI);
    
    const queueBtn = document.getElementById('queueBtn');
    if (queueBtn) queueBtn.addEventListener('click', toggleQueue);
    
    const closeQueueBtn = document.getElementById('closeQueueBtn');
    if (closeQueueBtn) closeQueueBtn.addEventListener('click', toggleQueue);
    
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
    
    const fsCloseBtn = document.getElementById('fsCloseBtn');
    if (fsCloseBtn) fsCloseBtn.addEventListener('click', toggleFullscreen);
    
    const aiRecommendBtn = document.getElementById('aiRecommendBtn');
    if (aiRecommendBtn) aiRecommendBtn.addEventListener('click', handleAiRecommendationsEnhanced);
    
    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) uploadArea.addEventListener('click', handleImport);
    
    const uploadFolderArea = document.getElementById('uploadFolderArea');
    if (uploadFolderArea) uploadFolderArea.addEventListener('click', handleFolderImport);
    
    const miniplayerToggleBtn = document.getElementById('miniplayerToggleBtn');
    if (miniplayerToggleBtn) miniplayerToggleBtn.addEventListener('click', toggleMiniPlayer);
    
    const exitMiniBtn = document.getElementById('exitMiniBtn');
    if (exitMiniBtn) {
        exitMiniBtn.addEventListener('click', () => {
            if (isMiniWindowMode) window.electronAPI.closeMiniPlayer();
            else toggleMiniPlayer();
        });
    }
    
    const miniNextBtn = document.getElementById('miniNextBtn');
    if (miniNextBtn) {
        miniNextBtn.addEventListener('click', () => {
            if (isMiniWindowMode) window.electronAPI.controlFromMini('next');
            else nextTrackEnhanced();
        });
    }
    
    const miniPrevBtn = document.getElementById('miniPrevBtn');
    if (miniPrevBtn) {
        miniPrevBtn.addEventListener('click', () => {
            if (isMiniWindowMode) window.electronAPI.controlFromMini('prev');
            else prevTrackEnhanced();
        });
    }
    
    const volSlider = document.getElementById('volumeSlider');
    if (volSlider) volSlider.addEventListener('input', (e) => { setVolume(e.target.value); });
    
    const volIcon = document.getElementById('volumeIcon');
    if (volIcon) volIcon.addEventListener('click', toggleMute);

    // =========================================================================
    // DSP PANEL (EQ, TEMPO, PITCH)
    // =========================================================================
    const dspToggleBtn = document.getElementById('dspToggleBtn');
    const closeDspBtn = document.getElementById('closeDspBtn');
    const dspPanel = document.getElementById('dspPanel');
    
    if (dspToggleBtn && dspPanel) {
        dspToggleBtn.addEventListener('click', () => { dspPanel.classList.toggle('open'); });
    }
    if (closeDspBtn && dspPanel) {
        closeDspBtn.addEventListener('click', () => { dspPanel.classList.remove('open'); });
    }
    
    // EQ Sliders
    for (let i = 0; i < 5; i++) {
        const slider = document.getElementById(`eqSlider${i}`);
        if (slider) {
            slider.addEventListener('input', (e) => { updateEqualizerBand(i, e.target.value); });
        }
    }
    
    const tempoSlider = document.getElementById('tempoSlider');
    if (tempoSlider) tempoSlider.addEventListener('input', (e) => { updatePlaybackSpeed(e.target.value); });
    
    const pitchToggle = document.getElementById('pitchToggle');
    if (pitchToggle) pitchToggle.addEventListener('change', (e) => { togglePitchPreservation(e.target.checked); });

    // =========================================================================
    // SONG INFO MODAL
    // =========================================================================
    const songInfoBtn = document.getElementById('songInfoBtn');
    if (songInfoBtn) songInfoBtn.addEventListener('click', (e) => {
        if (typeof window.showSongInfo === 'function') window.showSongInfo(e);
        else console.warn('showSongInfo not available');
    });
    
    const extractVocalBtn = document.getElementById('extractVocalBtn');
    if (extractVocalBtn) extractVocalBtn.addEventListener('click', (e) => {
        if (typeof window.extractVocalFromCurrentTrack === 'function') window.extractVocalFromCurrentTrack(e);
        else console.warn('extractVocalFromCurrentTrack not available');
    });

    // =========================================================================
    // IMPORT PLAYLIST BUTTON
    // =========================================================================
    const importPlaylistBtn = document.getElementById('importPlaylistBtn');
    if (importPlaylistBtn) {
        importPlaylistBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.m3u,.m3u8,.pls,.xspf,.asx,.wpl,.json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                showNotification('Importing playlist...', 'info');
                try {
                    const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/import-auto`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: file.path })
                    });
                    const data = await res.json();
                    if (data.success) {
                        showNotification(`Playlist "${data.playlist.name}" imported with ${data.importedCount} tracks`, 'success');
                        await loadPlaylists();
                        setTimeout(() => openPlaylist(data.playlist.id), 500);
                    } else {
                        showNotification('Import failed: ' + (data.error || 'Unknown'), 'error');
                    }
                } catch (err) {
                    console.error('Import error:', err);
                    showNotification('Import error', 'error');
                }
            };
            input.click();
        });
    }

    // =========================================================================
    // GLOBAL EVENT DELEGATION FOR DYNAMIC CONTENT
    // =========================================================================
    const dynamicContainer = document.getElementById('dynamicSectionContainer');
    if (dynamicContainer) {
        // Click delegation
        dynamicContainer.addEventListener('click', (e) => {
            const target = e.target;
            
            // Album card click
            const albumCard = target.closest('.album-card');
            if (albumCard && !target.closest('.card-actions')) {
                const albumName = albumCard.dataset.albumName;
                if (albumName) showAlbumDetail(albumName);
                return;
            }
            
            // Artist card click
            const artistCard = target.closest('.artist-card');
            if (artistCard && !target.closest('.card-actions')) {
                const artistName = artistCard.dataset.artistName;
                if (artistName) showArtistDetail(artistName);
                return;
            }
            
            // Track row or album/artist list item
            const trackRow = target.closest('.track-row, .album-track-item, .artist-track-item');
            if (trackRow) {
                const trackId = parseInt(trackRow.dataset.trackId);
                
                // Delete button
                const deleteBtn = target.closest('.table-action-btn.delete');
                if (deleteBtn) {
                    e.stopPropagation();
                    if (currentActiveSection === 'playlist' && currentActivePlaylistId) {
                        removeTrackFromPlaylist(currentActivePlaylistId, trackId);
                    } else {
                        deleteTrack(trackId, e);
                    }
                    return;
                }
                
                // Add to playlist button
                const addBtn = target.closest('.table-action-btn.like');
                if (addBtn) {
                    e.stopPropagation();
                    showPlaylistContextMenu(trackId, e.clientX, e.clientY);
                    return;
                }
                
                // Normal click => play
                if (trackId && !isNaN(trackId)) {
                    if (currentActiveSection === 'playlist' && currentActivePlaylistId) {
                        playTrackFromPlaylist(currentActivePlaylistId, trackId);
                    } else {
                        playTrack(trackId);
                    }
                }
                return;
            }
            
            // Music cards on home/recommendations
            const musicCard = target.closest('.featured-card, .spotify-music-card, .recent-item-premium, .recent-track-item');
            if (musicCard) {
                const tId = parseInt(musicCard.dataset.trackId);
                if (tId && !target.closest('.card-actions')) {
                    playTrack(tId);
                }
                return;
            }
        });
        
        // Context menu delegation
        dynamicContainer.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('.track-row, .album-track-item, .artist-track-item, .featured-card, .spotify-music-card');
            if (row) {
                const trackId = parseInt(row.dataset.trackId);
                if (trackId && !isNaN(trackId)) {
                    e.preventDefault();
                    showPlaylistContextMenu(trackId, e.clientX, e.clientY);
                }
            }
        });
    }

    // =========================================================================
    // DRAG & DROP
    // =========================================================================
    setupDragAndDrop();

    // =========================================================================
    // MINI-WINDOW IPC LISTENERS
    // =========================================================================
    if (isMiniWindowMode && window.electronAPI) {
        stateUpdateTokenMini = window.electronAPI.onStateUpdated((state) => {
            currentTrack = state.track;
            isPlaying = state.isPlaying;
            apiPort = state.apiPort;
            window.isPlaying = isPlaying;
            
            const miniTitle = document.getElementById('miniTitle');
            const miniArtist = document.getElementById('miniArtist');
            const miniArt = document.getElementById('miniArt');
            const mPlayIcon = document.getElementById('miniPlayIcon');
            const mTimelineFill = document.getElementById('miniTimelineFill');
            
            if (currentTrack) {
                if (miniTitle) miniTitle.innerText = currentTrack.title || 'Untitled';
                if (miniArtist) miniArtist.innerText = currentTrack.artist || 'Unknown Artist';
                if (miniArt) {
                    let coverUrl = currentTrack.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/cover` : null;
                    miniArt.innerHTML = coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>';
                }
            }
            if (mPlayIcon) mPlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            if (mTimelineFill && state.duration > 0) {
                const pct = (state.currentTime / state.duration) * 100;
                mTimelineFill.style.width = `${pct}%`;
            }
        });
    }

    // =========================================================================
    // MAIN WINDOW STATE UPDATE LISTENER
    // =========================================================================
    if (!isMiniWindowMode && window.electronAPI) {
        stateUpdateTokenMain = window.electronAPI.onStateUpdated((state) => {
            try {
                currentTrack = state.track || null;
                currentTrackId = currentTrack ? currentTrack.id : null;
                window.currentTrack = currentTrack;
                window.currentTrackId = currentTrackId;
                isPlaying = !!state.isPlaying;
                apiPort = state.apiPort || apiPort;
                window.isPlaying = isPlaying;
                
                if (typeof updatePlayerUI === 'function') updatePlayerUI();
                if (typeof setPlayState === 'function') setPlayState(isPlaying);
                
                if (currentActiveSection === 'home') {
                    try {
                        if (typeof renderHomeDashboard === 'function') renderHomeDashboard();
                    } catch (e) { console.warn('Failed to re-render home after state update', e); }
                }
                
                try {
                    if (typeof window.updatePlayerConnectionUI === 'function') window.updatePlayerConnectionUI(true);
                } catch (e) {}
            } catch (err) {
                console.error('State update handling error:', err);
            }
        });
    }

    // =========================================================================
    // CLEANUP IPC LISTENERS ON UNLOAD
    // =========================================================================
    window.addEventListener('beforeunload', () => {
        try {
            if (stateUpdateTokenMini && window.electronAPI && window.electronAPI.removeStateUpdatedListener) {
                window.electronAPI.removeStateUpdatedListener(stateUpdateTokenMini);
            }
        } catch (e) {}
        try {
            if (stateUpdateTokenMain && window.electronAPI && window.electronAPI.removeStateUpdatedListener) {
                window.electronAPI.removeStateUpdatedListener(stateUpdateTokenMain);
            }
        } catch (e) {}
        
        // Clean up intervals
        if (visualizerIntervalId) {
            clearInterval(visualizerIntervalId);
            visualizerIntervalId = null;
        }
        if (spectrumIntervalId) {
            clearInterval(spectrumIntervalId);
            spectrumIntervalId = null;
        }
    });

    // =========================================================================
    // EXECUTE CONTROL FROM MINI-PLAYER
    // =========================================================================
    if (!isMiniWindowMode && window.electronAPI) {
        window.electronAPI.onExecuteControl((command) => {
            if (command === 'play-pause') togglePlay();
            if (command === 'next') nextTrackEnhanced();
            if (command === 'prev') prevTrackEnhanced();
            if (command.startsWith('seek:')) {
                const percent = parseFloat(command.split(':')[1]);
                seekTo(percent);
            }
        });
    }

    // =========================================================================
    // TAG EDITOR FROM MAIN PROCESS
    // =========================================================================
    if (window.electronAPI && window.electronAPI.onOpenTagEditor) {
        window.electronAPI.onOpenTagEditor((trackId) => {
            const track = tracks.find(t => t.id === trackId);
            if (track) {
                currentTrack = track;
                currentTrackId = track.id;
                openTagEditor(trackId);
            }
        });
    }

    // =========================================================================
    // CROSSFADE CHANGED LISTENER
    // =========================================================================
    if (window.electronAPI && window.electronAPI.onCrossfadeChanged) {
        window.electronAPI.onCrossfadeChanged((duration) => {
            crossfadeDuration = duration;
            console.debug('Crossfade changed to:', duration);
        });
    }

    // =========================================================================
    // GLOBAL SHORTCUT LISTENER
    // =========================================================================
    if (window.electronAPI && window.electronAPI.onGlobalShortcut) {
        window.electronAPI.onGlobalShortcut((command) => {
            if (command === 'play-pause') togglePlay();
            if (command === 'next') nextTrackEnhanced();
            if (command === 'prev') prevTrackEnhanced();
        });
    }

    // =========================================================================
    // TIMELINE VISUALIZER INIT
    // =========================================================================
    initTimelineVisualizer();
    startTimelineVisualizerLoop();
    
    // Re-initialize visualizer on window resize
    window.addEventListener('resize', () => {
        if (visualizerIntervalId) {
            initTimelineVisualizer();
        }
    });
}

// =============================================================================
// MEDIA SESSION HANDLERS
// =============================================================================

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrackEnhanced());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrackEnhanced());
}

// Version status and update badge
async function initVersionStatus() {
    const versionBadge = document.getElementById('versionStatus');
    if (!versionBadge) return;

    // Listen for update status from main process
    if (window.electronAPI && window.electronAPI.onUpdateStatus) {
        window.electronAPI.onUpdateStatus((updateInfo) => {
            if (!versionBadge) return;
            if (updateInfo.hasUpdate && updateInfo.latestVersion) {
                versionBadge.textContent = `v${updateInfo.currentVersion} → v${updateInfo.latestVersion}`;
                versionBadge.classList.add('update-available');
                versionBadge.title = `Update available: ${updateInfo.latestVersion}. Click to download.`;
                versionBadge.style.cursor = 'pointer';
                versionBadge.onclick = () => {
                    if (updateInfo.url) window.electronAPI.openExternalLink(updateInfo.url);
                    else showNotification('Download URL not available', 'warning');
                };
            } else if (updateInfo.currentVersion && updateInfo.currentVersion !== 'unknown') {
                versionBadge.textContent = `v${updateInfo.currentVersion}`;
                versionBadge.classList.remove('update-available');
                versionBadge.onclick = null;
            } else {
                versionBadge.textContent = 'v1.5.0'; // fallback
            }
        });
    }

    // Also request current update status manually
    if (window.electronAPI && window.electronAPI.checkUpdateStatus) {
        try {
            const status = await window.electronAPI.checkUpdateStatus();
            if (status && versionBadge) {
                if (status.hasUpdate && status.latestVersion) {
                    versionBadge.textContent = `v${status.currentVersion} → v${status.latestVersion}`;
                    versionBadge.classList.add('update-available');
                    versionBadge.title = `Update available: ${status.latestVersion}. Click to download.`;
                    versionBadge.style.cursor = 'pointer';
                    versionBadge.onclick = () => {
                        if (status.url) window.electronAPI.openExternalLink(status.url);
                        else showNotification('Download URL not available', 'warning');
                    };
                } else if (status.currentVersion && status.currentVersion !== 'unknown') {
                    versionBadge.textContent = `v${status.currentVersion}`;
                    versionBadge.classList.remove('update-available');
                }
            }
        } catch (err) {
            console.error('Failed to get update status:', err);
        }
    }
}

// =============================================================================
// DOM CONTENT LOADED INITIALIZATION
// =============================================================================

// Pause heavy animations and visualizers when window is blurred, resume on focus
function setupWindowFocusOptimization() {
    window.addEventListener('blur', () => {
        console.debug('💤 Window blurred — pausing heavy visual work');
        const vinyl = document.getElementById('homeVinylDisc') || document.getElementById('fsAlbumArt');
        if (vinyl) vinyl.classList.remove('playing');

        if (visualizerIntervalId) { clearInterval(visualizerIntervalId); visualizerIntervalId = null; }

        // Spectrum analyzer
        isSpectrumLoopActive = false;
        if (spectrumIntervalId) { clearInterval(spectrumIntervalId); spectrumIntervalId = null; }
    });

    window.addEventListener('focus', () => {
        console.debug('☀️ Window focused — resuming visual work where appropriate');
        const vinyl = document.getElementById('homeVinylDisc') || document.getElementById('fsAlbumArt');
        if (vinyl && isPlaying) vinyl.classList.add('playing');

        if (isPlaying) {
            startTimelineVisualizerLoop();
            if (currentActiveSection === 'stats' && audioCtx && analyser) {
                startLiveSpectrumAnalyzer();
            }
        }
    });
}

// Persist playback position and track so we can resume after restart
function savePlaybackState() {
    try {
        if (!currentTrackId || !audioElement) return;
        const state = {
            trackId: currentTrackId,
            currentTime: Math.floor(audioElement.currentTime || 0),
            isPlaying: !!isPlaying,
            queueIndex: typeof queueIndex === 'number' ? queueIndex : -1,
            ts: Date.now()
        };
        localStorage.setItem('korai_playback_state', JSON.stringify(state));
    } catch (e) { console.debug('savePlaybackState failed', e); }
}

async function restorePlaybackState() {
    try {
        const raw = localStorage.getItem('korai_playback_state');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state || !state.trackId) return;

        // If library not loaded or track not present, skip
        const found = tracks.find(t => t.id === state.trackId);
        if (!found) return;

        // Play the track (playTrack will set src and attempt play)
        await playTrack(state.trackId);

        // Seek to saved position (try immediately, otherwise wait for metadata)
        const seekTo = Math.max(0, Number(state.currentTime) || 0);
        try {
            if (audioElement && audioElement.duration && !isNaN(audioElement.duration)) {
                audioElement.currentTime = Math.min(audioElement.duration, seekTo);
            } else if (audioElement) {
                const onMeta = function() {
                    try { audioElement.currentTime = Math.min(audioElement.duration, seekTo); } catch (e) {}
                    audioElement.removeEventListener('loadedmetadata', onMeta);
                };
                audioElement.addEventListener('loadedmetadata', onMeta);
            }
        } catch (e) { console.debug('seek restore failed', e); }

        // Restore play/pause: default to paused on start unless user opted-in
        try {
            const resumeOptIn = localStorage.getItem('korai_resume_on_start') === '1';
            if (state.isPlaying && resumeOptIn) {
                try { await audioElement.play(); setPlayState(true); } catch (e) { /* ignore */ }
            } else {
                try { await audioElement.pause(); setPlayState(false); } catch (e) { /* ignore */ }
            }
        } catch (e) { console.debug('restore play/pause failed', e); }

        // Restore queue index if present
        if (typeof state.queueIndex === 'number' && state.queueIndex >= 0) {
            queueIndex = state.queueIndex;
            renderQueue();
        }
    } catch (e) { console.debug('restorePlaybackState failed', e); }
}

// Save final state when window closes
window.addEventListener('beforeunload', () => {
    try { savePlaybackState(); } catch (e) {}
});

window.addEventListener('DOMContentLoaded', async () => {
    try {
        console.debug('🚀 DOM loaded, initializing KORAI Player...');
        const splash = document.getElementById('koraiSplashScreen');
        const splashProgress = document.getElementById('splashProgressFill');
        const appContainer = document.getElementById('appContainer');
        const playbackBar = document.getElementById('playbackBar');
        if (splashProgress) splashProgress.style.width = '20%';
        await waitForAPI();
        if (splashProgress) splashProgress.style.width = '45%';
        if (isMiniWindowMode) { setupEventListeners(); updateBodyClasses(); document.body.classList.add('mini-window-active'); const mCard = document.getElementById('miniplayerCard'); if (mCard) { mCard.style.display = 'block'; mCard.classList.add('show'); } if (splash) splash.style.display = 'none'; console.debug('Floating mini player widget initialized'); return; }
        await loadTracks();
        if (splashProgress) splashProgress.style.width = '75%';
        await loadPlaylists();
        await loadEnabledPluginCss();
        if (splashProgress) splashProgress.style.width = '100%';
        try { const playbackRes = await fetch(`http://127.0.0.1:${apiPort}/api/playback/settings`); const playbackSettings = await playbackRes.json(); gaplessEnabled = playbackSettings.gaplessEnabled !== false; crossfadeDuration = playbackSettings.crossfadeDuration || 0; console.debug('✅ Playback settings loaded:', { gaplessEnabled, crossfadeDuration }); } catch (err) { console.warn('Could not load playback settings, using defaults'); }
        setupEventListeners();
        setVolume(0.7);
        initAudio();
        await restorePlaybackState();
        changeClientLanguage(currentLanguage);
        updateBodyClasses();
        switchSection('home');
        detectPerformanceMode();
        if (typeof setAIIconOnlyMode === 'function') setAIIconOnlyMode();
        if (typeof updateAITooltips === 'function') updateAITooltips();
        initVersionStatus();
        if (window.electronAPI && window.electronAPI.onScanNoFilesFound) {
            window.electronAPI.onScanNoFilesFound((folderPath) => {
                showNotification(`No audio files found in: ${folderPath}\nSupported: MP3, WAV, OGG, M4A, FLAC`, 'warning');
            });
        }

        // Performance: pause heavy animations/visualizers when unfocused
        try { setupWindowFocusOptimization(); } catch (e) {}

        if (window.electronAPI && window.electronAPI.onFilesOpened) {
            window.electronAPI.onFilesOpened(async (files) => {
                if (!files || files.length === 0) return;
                showImportProgress(files.length);
                try {
                    const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePaths: files })
                    });

                    if (!res.ok) {
                        hideImportProgress();
                        const error = await res.json().catch(() => ({}));
                        showNotification(`Import failed: ${error.error || 'Unknown error'}`, 'error');
                        return;
                    }

                    const result = await res.json();
                    updateImportProgress(100, `Imported ${result.imported} track(s)!`);

                    // Small delay to show completion state
                    setTimeout(async () => {
                        hideImportProgress();
                        showNotification(`Successfully imported ${result.imported} track(s)`, 'success');
                        await loadTracks();
                        await loadPlaylists();

                        if (result.imported > 0 && tracks.length > 0) {
                            // Prefer server-provided mapping when available
                            if (Array.isArray(result.importedTracks) && result.importedTracks.length > 0) {
                                let matched = null;
                                for (const it of result.importedTracks) {
                                    const ft = tracks.find(tt => tt.id === it.id || (tt.filePath && it.filePath && normalizePath(tt.filePath) === normalizePath(it.filePath)));
                                    if (ft) { matched = ft; break; }
                                }
                                if (matched) {
                                    await tryAutoPlayTrack(matched.id).catch(e => console.debug('Autoplay failed', e));
                                    return;
                                }
                            }
                            const newTracks = tracks.slice(-result.imported);
                            const lastTrack = newTracks[newTracks.length - 1] || newTracks[0];
                            if (lastTrack) {
                                await tryAutoPlayTrack(lastTrack.id).catch(e => console.debug('Autoplay failed', e));
                            }
                        }

                        switchSection(currentActiveSection);
                    }, 500);
                } catch (err) {
                    console.error('File association import error:', err);
                    hideImportProgress();
                    showNotification('Error importing files opened from system', 'error');
                }
            });
        }

        setTimeout(async () => {
            if (splash) {
                splash.classList.add('fade-out');
                setTimeout(async () => {
                    splash.style.display = 'none';
                    try { const settingsRes = await fetch(`http://127.0.0.1:${apiPort}/api/settings`); const settings = await settingsRes.json(); const isFirstLaunch = settings.isFirstLaunch; const welcomeScreen = document.getElementById('welcomeScreen'); const closeOobeBtn = document.getElementById('closeOobeBtn'); if (isFirstLaunch && welcomeScreen) { welcomeScreen.style.display = 'flex'; if (appContainer) appContainer.style.opacity = '0.15'; if (playbackBar) playbackBar.style.opacity = '0.15'; closeOobeBtn.addEventListener('click', async () => { welcomeScreen.classList.add('fade-out'); try { await fetch(`http://127.0.0.1:${apiPort}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isFirstLaunch: false }) }); } catch (err) { console.error('Error saving settings:', err); } setTimeout(() => { welcomeScreen.style.display = 'none'; if (appContainer) appContainer.style.opacity = '1'; if (playbackBar) playbackBar.style.opacity = '1'; }, 800); }); } else { if (appContainer) appContainer.style.opacity = '1'; if (playbackBar) playbackBar.style.opacity = '1'; } } catch (err) { console.error('Settings fetch error:', err); if (appContainer) appContainer.style.opacity = '1'; if (playbackBar) playbackBar.style.opacity = '1'; } }, 600);
            }
        }, 1200);

        const gaplessToggle = document.getElementById('gaplessToggle');
        if (gaplessToggle) { gaplessToggle.checked = gaplessEnabled; gaplessToggle.addEventListener('change', (e) => { setGaplessMode(e.target.checked); }); }
        
        const crossfadeSlider = document.getElementById('crossfadeSlider');
        if (crossfadeSlider) { crossfadeSlider.value = crossfadeDuration; crossfadeSlider.addEventListener('input', (e) => { const val = parseFloat(e.target.value); const crossfadeVal = document.getElementById('crossfadeVal'); if (crossfadeVal) crossfadeVal.innerText = `${val}s`; setCrossfadeMode(val); }); }
        
        const exportLibraryBtn = document.getElementById('exportLibraryBtn');
        if (exportLibraryBtn) exportLibraryBtn.addEventListener('click', exportLibraryToCSV);
        
        const importCueBtn = document.getElementById('importCueBtn');
        if (importCueBtn) importCueBtn.addEventListener('click', importCueSheet);

        console.debug('✅ KORAI Player initialized');
    } catch (err) { console.error('Init error:', err); showNotification('Initialization failed', 'error'); }
});

if (window.electronAPI) {
    window.electronAPI.onTrayOpenMiniPlayer((track, playing) => { toggleMiniPlayer(); });
    window.electronAPI.onTrayCinematicMode(() => { toggleFullscreen(); });
    window.electronAPI.onTrayChangeLanguage((lang) => { if (lang !== currentLanguage) changeClientLanguage(lang); });
    window.electronAPI.onTrayTogglePlayback(() => { togglePlay(); });
    window.electronAPI.onTrayNextTrack(() => { nextTrackEnhanced(); });
    window.electronAPI.onTrayPreviousTrack(() => { prevTrackEnhanced(); });
}

setTimeout(() => { syncTrayPlaybackState(); }, 1000);

setInterval(() => {
    if (window.electronAPI && window.electronAPI.checkUpdateStatus) {
        window.electronAPI.checkUpdateStatus().then(result => {
            if (result && result.hasUpdate) {
                console.log('[App] Update available:', result.latestVersion);
            }
        }).catch(err => console.warn('[App] Update check failed:', err));
    }
}, 60 * 60 * 1000);