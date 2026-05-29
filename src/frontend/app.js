/**
 * app.js - KORAI Music Player Frontend Logic
 * 
 * Complete client-side application including:
 * - Audio playback with Web Audio API
 * - Real-time spectrum analyzer
 * - 5-band graphic equalizer
 * - Karaoke mode (vocal cancellation)
 * - Playback speed control with pitch preservation
 * - Sleep timer
 * - Queue management
 * - Fullscreen immersive player
 * - Mini-player mode
 * - Playlist management
 * - AI-powered recommendations
 * - Multi-language support (EN/FA)
 * - Theme system (Spotify Dark / Liquid Glass)
 */

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
let currentVinylRotation = 0;
let lastVinylUpdateTime = 0;
let importProgressElement = null;
let importProgressInterval = null;
let originalQueueBackup = [];
let vinylRotationInterval = null;
let shuffleHistory = [];  
let shuffleSessionActive = false;
let remainingUnplayedTracks = [];

// Web Audio API nodes
let audioCtx = null;
let audioSource = null;
let analyser = null;
let eqFilters = [];
const eqBands = [60, 230, 910, 4000, 14000];
let gainNode = null;

// Karaoke mode nodes
let karaokeMode = false;
let karaokeBypass = null;
let karaokeActiveGain = null;

// Sleep timer
let sleepIntervalId = null;
let sleepTimeRemaining = 0;

// Mini window detection
const urlParams = new URLSearchParams(window.location.search);
const isMiniWindowMode = urlParams.get('mode') === 'mini';

// HTML escape utility
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Vinyl rotation animation for fullscreen and mini-player
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

// Format time from seconds to MM:SS
function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Translation helper
function t(key) {
    return translations[currentLanguage] && translations[currentLanguage][key] ? translations[currentLanguage][key] : key;
}

// Genre translation
function getGenreTranslation(genreName) {
    if (!genreName) return '';
    const normalized = genreName.toLowerCase();
    if (normalized.includes('blues') || normalized.includes('jazz')) return t('genreBlues');
    if (normalized.includes('classical') || normalized.includes('ambient')) return t('genreClassical');
    if (normalized.includes('pop')) return t('genrePop');
    if (normalized.includes('dance') || normalized.includes('house')) return t('genreDance');
    if (normalized.includes('edm') || normalized.includes('trance')) return t('genreEDM');
    if (normalized.includes('drum') || normalized.includes('bass')) return t('genreDnB');
    if (normalized.includes('hip') || normalized.includes('r&b')) return t('genreHipHop');
    if (normalized.includes('rock') || normalized.includes('metal')) return t('genreMetal');
    if (normalized.includes('electronic')) return t('genreElectronic');
    return genreName;
}

/**
 * Initialize or reset shuffle session
 * Creates a shuffled queue where each track plays only once until all are played
 */
function initShuffleSession() {
    if (!shuffleMode) return;
    
    console.log('🔄 Initializing shuffle session...');
    
    // Get all available tracks (current queue or full library)
    let sourceTracks = [];
    if (queue.length > 0) {
        sourceTracks = [...queue];
    } else if (tracks.length > 0) {
        sourceTracks = [...tracks];
    }
    
    if (sourceTracks.length === 0) return;
    
    // Backup original queue if needed
    if (!shuffleSessionActive || originalQueueBackup.length === 0) {
        originalQueueBackup = [...queue];
    }
    
    // Create a shuffled copy of all tracks
    const shuffledTracks = [...sourceTracks];
    for (let i = shuffledTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
    }
    
    // Set the new shuffled queue
    queue = shuffledTracks;
    queueIndex = 0;
    shuffleHistory = [];
    remainingUnplayedTracks = [...queue.map(t => t.id)];
    shuffleSessionActive = true;
    
    // Find current track position if it exists in shuffled queue
    if (currentTrackId) {
        const newIndex = queue.findIndex(t => t.id === currentTrackId);
        if (newIndex !== -1) {
            queueIndex = newIndex;
            // Mark current track as played
            if (!shuffleHistory.includes(currentTrackId)) {
                shuffleHistory.push(currentTrackId);
                remainingUnplayedTracks = remainingUnplayedTracks.filter(id => id !== currentTrackId);
            }
        }
    }
    
    renderQueue();
    console.log(`✅ Shuffle session initialized with ${queue.length} tracks, ${remainingUnplayedTracks.length} unplayed`);
}

/**
 * Get next track in shuffle mode (ensures no repeats until all tracks played)
 */
function getNextShuffleTrack() {
    if (!shuffleMode) return null;
    
    // If we have remaining unplayed tracks, pick one randomly
    if (remainingUnplayedTracks.length > 0) {
        // Choose a random unplayed track
        const randomIndex = Math.floor(Math.random() * remainingUnplayedTracks.length);
        const nextTrackId = remainingUnplayedTracks[randomIndex];
        const nextTrackIndex = queue.findIndex(t => t.id === nextTrackId);
        
        if (nextTrackIndex !== -1) {
            return { trackId: nextTrackId, index: nextTrackIndex };
        }
    }
    
    // All tracks have been played in this shuffle session
    console.log('🔄 Shuffle session complete, reshuffling...');
    
    // Reshuffle all tracks (excluding current track to avoid immediate repeat)
    const currentId = currentTrackId;
    const otherTracks = queue.filter(t => t.id !== currentId);
    
    if (otherTracks.length === 0) return null;
    
    // Shuffle the remaining tracks
    for (let i = otherTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
    }
    
    // Rebuild queue with current track first, then shuffled others
    const currentTrackObj = queue.find(t => t.id === currentId);
    if (currentTrackObj) {
        queue = [currentTrackObj, ...otherTracks];
    } else {
        queue = otherTracks;
    }
    
    // Reset shuffle history (current track is played, others are unplayed)
    shuffleHistory = currentId ? [currentId] : [];
    remainingUnplayedTracks = queue.filter(t => t.id !== currentId).map(t => t.id);
    queueIndex = 0;
    
    renderQueue();
    
    // Return first unplayed track
    if (remainingUnplayedTracks.length > 0) {
        const nextTrackId = remainingUnplayedTracks[0];
        const nextTrackIndex = queue.findIndex(t => t.id === nextTrackId);
        return { trackId: nextTrackId, index: nextTrackIndex };
    }
    
    return null;
}

/**
 * Get previous track in shuffle mode
 */
function getPrevShuffleTrack() {
    if (!shuffleMode) return null;
    
    // In shuffle, previous track goes back in history
    if (shuffleHistory.length >= 2) {
        const prevTrackId = shuffleHistory[shuffleHistory.length - 2];
        const prevTrackIndex = queue.findIndex(t => t.id === prevTrackId);
        
        if (prevTrackIndex !== -1) {
            // Remove current from history (will be re-added when playing)
            shuffleHistory.pop();
            return { trackId: prevTrackId, index: prevTrackIndex };
        }
    }
    
    // No history, can't go back
    return null;
}

/**
 * Mark a track as played in shuffle history
 */
function markTrackAsPlayedInShuffle(trackId) {
    if (!shuffleMode) return;
    
    if (!shuffleHistory.includes(trackId)) {
        shuffleHistory.push(trackId);
        remainingUnplayedTracks = remainingUnplayedTracks.filter(id => id !== trackId);
        console.log(`📝 Shuffle history: ${shuffleHistory.length}/${queue.length} played, ${remainingUnplayedTracks.length} remaining`);
    }
}

/**
 * Reset shuffle session (called when shuffle mode is disabled)
 */
function resetShuffleSession() {
    if (originalQueueBackup.length > 0) {
        queue = [...originalQueueBackup];
        queueIndex = Math.max(0, queue.findIndex(t => t.id === currentTrackId));
        originalQueueBackup = [];
        renderQueue();
    }
    shuffleHistory = [];
    remainingUnplayedTracks = [];
    shuffleSessionActive = false;
    console.log('🔀 Shuffle session ended, restored original queue');
}

/**
 * Enhanced nextTrack function with proper shuffle support
 */
async function nextTrackEnhanced() {
    if (isMiniWindowMode) {
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('next');
        }
        return;
    }
    
    // Shuffle mode logic
    if (shuffleMode) {
        // Initialize shuffle session if not active
        if (!shuffleSessionActive && tracks.length > 0) {
            initShuffleSession();
        }
        
        const nextShuffle = getNextShuffleTrack();
        if (nextShuffle) {
            queueIndex = nextShuffle.index;
            await playTrack(nextShuffle.trackId);
            markTrackAsPlayedInShuffle(nextShuffle.trackId);
            return;
        } else if (tracks.length > 0) {
            // Fallback to random track
            const randomIndex = Math.floor(Math.random() * tracks.length);
            await playTrack(tracks[randomIndex].id);
            return;
        }
        return;
    }
    
    // Normal queue mode
    if (queue.length > 0 && queueIndex < queue.length - 1) {
        queueIndex++;
        await playTrack(queue[queueIndex].id);
    } else if (repeatMode && currentTrackId) {
        // Repeat single track
        await playTrack(currentTrackId);
    } else if (tracks.length > 0) {
        // Loop back to first track
        const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
        let nextIndex = currentIndex + 1;
        if (nextIndex >= tracks.length) nextIndex = 0;
        await playTrack(tracks[nextIndex].id);
    }
}

/**
 * Enhanced prevTrack function with proper shuffle support
 */
async function prevTrackEnhanced() {
    if (isMiniWindowMode) {
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('prev');
        }
        return;
    }
    
    // Shuffle mode logic
    if (shuffleMode && shuffleSessionActive) {
        const prevShuffle = getPrevShuffleTrack();
        if (prevShuffle) {
            queueIndex = prevShuffle.index;
            await playTrack(prevShuffle.trackId);
            return;
        }
    }
    
    // Normal queue mode
    if (queue.length > 0 && queueIndex > 0) {
        queueIndex--;
        await playTrack(queue[queueIndex].id);
    } else if (tracks.length > 0) {
        // Loop to last track
        const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) prevIndex = tracks.length - 1;
        await playTrack(tracks[prevIndex].id);
    }
}

// Override global functions
window.nextTrack = nextTrackEnhanced;
window.prevTrack = prevTrackEnhanced;

/**
 * Enhanced toggleShuffle function
 */
function toggleShuffleEnhanced() {
    shuffleMode = !shuffleMode;
    
    const shuffleBtn = document.getElementById('shuffleBtnK');
    if (shuffleBtn) shuffleBtn.classList.toggle('active', shuffleMode);
    
    const fsShuffleBtn = document.getElementById('fsShuffleBtn');
    if (fsShuffleBtn) fsShuffleBtn.classList.toggle('active', shuffleMode);
    
    if (shuffleMode) {
        console.log('🔀 Shuffle mode enabled');
        if (queue.length === 0 && currentTrackId) {
            const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
            if (currentIndex !== -1) {
                queue = [...tracks.slice(currentIndex), ...tracks.slice(0, currentIndex)];
                queueIndex = 0;
            }
        }
        initShuffleSession();
        showNotification('Shuffle mode enabled - each track plays once', 'success');
    } else {
        console.log('🔀 Shuffle mode disabled');
        resetShuffleSession();
        showNotification('Shuffle mode disabled', 'info');
    }
}

window.toggleShuffle = toggleShuffleEnhanced;

// Override playTrack to mark tracks in shuffle mode
const originalPlayTrack = window.playTrack;
window.playTrack = async function(trackId) {
    const result = await originalPlayTrack(trackId);
    if (shuffleMode && currentTrackId === trackId) {
        markTrackAsPlayedInShuffle(trackId);
    }
    return result;
};

// Translate entire page UI
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

// Show notification toast
function showNotification(message, type = 'info') {
    if (isMiniWindowMode) return;
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const notif = document.createElement('div');
    notif.className = `notification notif-${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-triangle-exclamation';
    
    notif.innerHTML = `
        <i class="fas ${icon}"></i>
        <div class="notif-content">
            <p style="margin: 0; font-size: 0.8rem;">${message}</p>
        </div>
    `;
    
    document.body.appendChild(notif);
    setTimeout(() => { notif.classList.add('show'); }, 50);
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 400);
    }, 3000);
}

// Custom dialog modal
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

    confirmBtn.onclick = () => {
        cleanUp();
        if (onConfirm) onConfirm();
    };
    cancelBtn.onclick = cleanUp;
}

// Wait for API server connection
async function waitForAPI() {
    const maxAttempts = 15;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (window.electronAPI && typeof window.electronAPI.getServerPort === 'function') {
                const port = await window.electronAPI.getServerPort();
                if (port) {
                    apiPort = port;
                    console.log('✅ API connected on port:', apiPort);
                    return true;
                }
            }
        } catch (e) {
            console.error('API connection attempt failed:', e);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    apiPort = 3000;
    console.log('⚠️ Using fallback port 3000');
    return true;
}

// Load all tracks from server
async function loadTracks() {
    if (isMiniWindowMode) return;
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks`);
        if (!res.ok) throw new Error('Failed to fetch tracks');
        const serverTracks = await res.json();
        
        tracks = await Promise.all(serverTracks.map(async (track) => {
            try {
                const likeRes = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${track.id}/liked`);
                const likeData = await likeRes.json();
                return { ...track, isLiked: likeData.liked };
            } catch {
                return { ...track, isLiked: false };
            }
        }));
        
        const totalEl = document.getElementById('quickTotalTracks');
        const likesEl = document.getElementById('quickTotalLikes');
        if (totalEl) totalEl.innerText = tracks.length;
        if (likesEl) likesEl.innerText = tracks.filter(t => t.isLiked).length;
        
        console.log('✅ Loaded tracks:', tracks.length);
        
    } catch (err) {
        console.error('Error loading tracks:', err);
        showNotification('Failed to retrieve tracks library', 'error');
        tracks = [];
    }
}

// Load all playlists from server
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

// Render playlists in sidebar
function renderPlaylistsSidebar() {
    const container = document.getElementById('sidebarPlaylists');
    if (!container) return;
    
    if (playlists.length === 0) {
        container.innerHTML = `<div class="no-playlists-label">${currentLanguage === 'fa' ? 'لیستی ایجاد نشده است' : 'No playlists created'}</div>`;
        return;
    }
    
    let html = '';
    playlists.forEach(pl => {
        html += `
            <div class="sidebar-playlist-item ${currentActivePlaylistId === pl.id && currentActiveSection === 'playlist' ? 'active' : ''}" onclick="openPlaylist(${pl.id})">
                <i class="fa-solid fa-music"></i>
                <span class="playlist-name-text truncate-text">${escapeHtml(pl.name)}</span>
                <button class="playlist-delete-mini" onclick="event.stopPropagation(); deletePlaylist(${pl.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    });
    container.innerHTML = html;
}

// Show create playlist modal
function promptCreatePlaylist() {
    const modal = document.getElementById('createPlaylistModal');
    const input = document.getElementById('newPlaylistInputName');
    const confirmBtn = document.getElementById('confirmPlaylistCreateBtn');
    
    if (!modal || !input || !confirmBtn) return;
    
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
    
    confirmBtn.onclick = async () => {
        const name = input.value.trim();
        if (!name) {
            showNotification('Playlist name cannot be empty', 'warning');
            return;
        }
        
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                showNotification('Playlist created successfully', 'success');
                await loadPlaylists();
                closeCreatePlaylistModal();
            }
        } catch (e) {
            showNotification('Error creating playlist', 'error');
        }
    };
}

function closeCreatePlaylistModal() {
    const modal = document.getElementById('createPlaylistModal');
    if (modal) modal.style.display = 'none';
}

// Delete playlist
async function deletePlaylist(id) {
    const title = currentLanguage === 'fa' ? 'حذف پلی‌لیست' : 'Delete Playlist';
    const message = currentLanguage === 'fa' ? 'آیا از حذف این لیست پخش مطمئن هستید؟' : 'Are you sure you want to delete this playlist?';
    
    showCustomDialog(title, message, async () => {
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showNotification('Playlist deleted', 'info');
                await loadPlaylists();
                if (currentActiveSection === 'playlist' && currentActivePlaylistId === id) {
                    switchSection('home');
                }
            }
        } catch (e) {
            showNotification('Error deleting playlist', 'error');
        }
    });
}

// Open playlist view
function openPlaylist(id) {
    currentActiveSection = 'playlist';
    currentActivePlaylistId = id;
    renderPlaylistsSidebar();
    renderPlaylistView();
}

// Render playlist tracks
function renderPlaylistView() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    const playlist = playlists.find(p => p.id === currentActivePlaylistId);
    if (!playlist) {
        switchSection('home');
        return;
    }
    
    const plTracks = tracks.filter(t => playlist.tracks.includes(t.id));
    
    if (plTracks.length === 0) {
        mainSection.innerHTML = `
            <div class="empty-illustration-state">
                <i class="fa-solid fa-compact-disc"></i>
                <h3>${t('emptyPlaylistState')}</h3>
                <p>${t('emptyPlaylistTip')}</p>
            </div>
        `;
        return;
    }
    
    let tableRowsHtml = '';
    plTracks.forEach((track, index) => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        const isActive = currentTrackId === track.id;
        const indexText = isActive && isPlaying ? '<i class="fa-solid fa-pause"></i>' : index + 1;
        
        tableRowsHtml += `
            <tr class="track-row ${isActive ? 'active' : ''}" data-track-id="${track.id}" onclick="playTrackFromPlaylist(${playlist.id}, ${track.id})">
                <td class="track-play-cell">${indexText}</td>
                <td class="track-info-cell">
                    <div class="table-song-cover">
                        ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    </div>
                    <div class="table-song-meta">
                        <span class="table-song-title">${escapeHtml(track.title || 'Untitled')}</span>
                        <span class="table-song-artist">${escapeHtml(track.artist || 'Unknown Artist')}</span>
                    </div>
                </td>
                <td class="track-album-cell">${escapeHtml(track.album || '—')}</td>
                <td class="track-bpm-cell">${track.bpm || '120'}</td>
                <td class="track-time-cell">${formatTime(track.duration)}</td>
                <td class="track-actions-cell">
                    <button class="table-action-btn delete" onclick="event.stopPropagation(); removeTrackFromPlaylist(${playlist.id}, ${track.id})">
                        <i class="fa-solid fa-minus"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    mainSection.innerHTML = `
        <div class="spotify-row-title">
            <h3>${currentLanguage === 'fa' ? 'پلی‌لیست' : 'Playlist'}: ${escapeHtml(playlist.name)} (${plTracks.length})</h3>
        </div>
        <div class="library-table-wrapper">
            <table class="library-tracks-table">
                <thead>
                    <tr>
                        <th style="width: 50px;">#</th>
                        <th>${currentLanguage === 'fa' ? 'عنوان' : 'Title'}</th>
                        <th>${currentLanguage === 'fa' ? 'آلبوم' : 'Album'}</th>
                        <th style="width: 80px;">BPM</th>
                        <th style="width: 80px;"><i class="fa-regular fa-clock"></i></th>
                        <th style="width: 100px;">${currentLanguage === 'fa' ? 'حذف' : 'Remove'}</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>
        </div>
    `;
}

// =============================================================================
// IMPORT PROGRESS EFFECT FUNCTIONS
// =============================================================================
function showImportProgress(fileCount) {
    hideImportProgress();
    
    importProgressElement = document.createElement('div');
    importProgressElement.id = 'importProgressOverlay';
    importProgressElement.innerHTML = `
        <div class="import-progress-container">
            <div class="import-progress-card">
                <div class="import-spinner">
                    <i class="fa-solid fa-compact-disc fa-spin"></i>
                </div>
                <h3 class="import-title">Importing Audio Files</h3>
                <p class="import-subtitle">Analyzing ${fileCount} file(s)...</p>
                <div class="import-progress-bar-wrapper">
                    <div class="import-progress-bar-fill" id="importProgressFill" style="width: 0%;"></div>
                </div>
                <p class="import-percentage" id="importPercentage">0%</p>
                <div class="import-wave-bars">
                    <span></span><span></span><span></span><span></span><span></span>
                    <span></span><span></span><span></span><span></span><span></span>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(importProgressElement);
    
    setTimeout(() => {
        if (importProgressElement) {
            importProgressElement.classList.add('active');
        }
    }, 50);
    
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
    if (importProgressInterval) {
        clearInterval(importProgressInterval);
        importProgressInterval = null;
    }
    
    if (importProgressElement) {
        importProgressElement.classList.remove('active');
        importProgressElement.classList.add('fade-out');
        
        setTimeout(() => {
            if (importProgressElement && importProgressElement.parentNode) {
                importProgressElement.parentNode.removeChild(importProgressElement);
                importProgressElement = null;
            }
        }, 400);
    }
}

// Remove track from playlist
async function removeTrackFromPlaylist(playlistId, trackId) {
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/${playlistId}/tracks/${trackId}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showNotification('Track removed from playlist', 'info');
            await loadPlaylists();
            if (currentActiveSection === 'playlist') {
                openPlaylist(playlistId);
            }
        }
    } catch (e) {
        showNotification('Error removing track from playlist', 'error');
    }
}

// Play track from playlist queue
function playTrackFromPlaylist(playlistId, trackId) {
    const playlist = playlists.find(p => p.id === playlistId);
    if (playlist) {
        queue = tracks.filter(t => playlist.tracks.includes(t.id));
        queueIndex = queue.findIndex(t => t.id === trackId);
        playTrack(trackId);
    }
}

// Show playlist context menu on right-click
function showPlaylistContextMenu(trackId, x, y) {
    if (isMiniWindowMode) return;
    const menu = document.getElementById('playlistContextMenu');
    const container = document.getElementById('contextPlaylistItems');
    if (!menu || !container) return;
    
    if (playlists.length === 0) {
        container.innerHTML = `<div class="context-item empty">${currentLanguage === 'fa' ? 'پلی‌لیستی وجود ندارد' : 'No playlists available'}</div>`;
    } else {
        let html = '';
        playlists.forEach(pl => {
            html += `
                <div class="context-item" onclick="addTrackToPlaylist(${pl.id}, ${trackId})">
                    <i class="fa-solid fa-list"></i>
                    <span>${escapeHtml(pl.name)}</span>
                </div>
            `;
        });
        container.innerHTML = html;
    }
    
    menu.style.display = 'block';
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;
    
    const closeMenu = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 50);
}

// Add track to playlist
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
            } else {
                showNotification('Track already in playlist', 'info');
            }
        }
    } catch (e) {
        showNotification('Error adding to playlist', 'error');
    }
}

// Initialize audio element and Web Audio API
function initAudio() {
    if (audioElement) return;
    
    audioElement = new Audio();
    audioElement.crossOrigin = "anonymous";
    audioElement.volume = volume;
    
    audioElement.addEventListener('timeupdate', () => {
        const current = audioElement.currentTime;
        const total = audioElement.duration || 0;
        
        const currentText = document.getElementById('currentTimeK');
        if (currentText) currentText.innerText = formatTime(current);
        
        const fill = document.getElementById('progressFillK');
        if (fill && total > 0) {
            const percent = (current / total) * 100;
            fill.style.width = `${percent}%`;
        }

        const fsFill = document.getElementById('fsMirrorProgressFill');
        if (fsFill && total > 0) {
            const percent = (current / total) * 100;
            fsFill.style.width = `${percent}%`;
        }

        syncWithMediaSessionPosition();
        syncWithMiniPlayerWidget();
    });
    
    audioElement.addEventListener('loadedmetadata', () => {
        const totalText = document.getElementById('durationK');
        if (totalText) totalText.innerText = formatTime(audioElement.duration);
    });
    
    audioElement.addEventListener('ended', () => {
        if (repeatMode) {
            audioElement.currentTime = 0;
            audioElement.play().catch(e => console.error(e));
        } else {
            nextTrack();
        }
    });

    audioElement.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        showNotification('Audio file not found or access denied', 'error');
        setPlayState(false);
    });
}

// Timeline visualizer with frequency bars
let lastVisualizerUpdate = 0;
function updateTimelineVisualizer() {
    const now = Date.now();
    if (now - lastVisualizerUpdate < 33) return;
    lastVisualizerUpdate = now;

    const timelineBg = document.getElementById('progressBarK');
    if (!timelineBg) return;
    
    const totalBars = 55;
    let visualizerContainer = timelineBg.querySelector('.timeline-visualizer');
    
    if (!visualizerContainer) {
        visualizerContainer = document.createElement('div');
        visualizerContainer.className = 'timeline-visualizer';
        for (let i = 0; i < totalBars; i++) {
            const bar = document.createElement('div');
            bar.className = 'timeline-v-bar';
            visualizerContainer.appendChild(bar);
        }
        timelineBg.appendChild(visualizerContainer);
    }
    
    const bars = visualizerContainer.querySelectorAll('.timeline-v-bar');
    
    let pct = 0;
    if (audioElement && audioElement.duration) {
        pct = (audioElement.currentTime / audioElement.duration) * 100;
    }

    let dataArray = null;
    if (analyser && isPlaying) {
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
    }
    
    bars.forEach((bar, idx) => {
        let height = 4;
        
        if (dataArray && isPlaying) {
            const targetIndex = Math.floor((idx / totalBars) * (dataArray.length * 0.65));
            const value = dataArray[targetIndex] || 0;
            height = 3 + (value / 255) * 25;
        } else {
            height = 4 + Math.sin(Date.now() * 0.0035 + idx * 0.2) * 3.5;
        }
        
        bar.style.height = `${height}px`;
        
        const barPercent = (idx / totalBars) * 100;
        if (barPercent <= pct) {
            bar.classList.add('played');
        } else {
            bar.classList.remove('played');
        }
    });
    
    if (isPlaying) {
        timelineBg.classList.add('playing');
    } else {
        timelineBg.classList.remove('playing');
    }
}

// Setup Web Audio API nodes
function setupAudioNodes() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx) {
            audioCtx = new AudioContextClass();
        }
        
        if (!audioSource && audioElement) {
            audioSource = audioCtx.createMediaElementSource(audioElement);
        }
        
        if (!karaokeBypass && audioSource) {
            karaokeBypass = audioCtx.createGain();
            karaokeActiveGain = audioCtx.createGain();
            
            audioSource.connect(karaokeBypass);
            audioSource.connect(karaokeActiveGain);
            
            const splitter = audioCtx.createChannelSplitter(2);
            const merger = audioCtx.createChannelMerger(2);
            const inverter = audioCtx.createGain();
            inverter.gain.value = -0.8;
            
            karaokeActiveGain.connect(splitter);
            splitter.connect(merger, 0, 0);
            splitter.connect(inverter, 1);
            inverter.connect(merger, 0, 1);
            
            const output = audioCtx.createGain();
            merger.connect(output);
            
            const junctionNode = audioCtx.createGain();
            karaokeBypass.connect(junctionNode);
            output.connect(junctionNode);
            
            let currentFilter = junctionNode;
            eqFilters = eqBands.map((freq, idx) => {
                const filter = audioCtx.createBiquadFilter();
                if (idx === 0) filter.type = 'lowshelf';
                else if (idx === eqBands.length - 1) filter.type = 'highshelf';
                else filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 1.0;
                filter.gain.value = 0;
                currentFilter.connect(filter);
                currentFilter = filter;
                return filter;
            });
            
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            currentFilter.connect(analyser);
            
            gainNode = audioCtx.createGain();
            analyser.connect(gainNode);
            gainNode.connect(audioCtx.destination);
        }
        
        updateKaraokeRouting();
        
    } catch (e) {
        console.warn("AudioContext setup failed:", e);
    }
}

function updateKaraokeRouting() {
    if (!karaokeBypass || !karaokeActiveGain) return;
    if (karaokeMode) {
        karaokeBypass.gain.value = 0.0;
        karaokeActiveGain.gain.value = 1.0;
        showNotification('🎤 Karaoke mode activated - Vocal reduction enabled', 'info');
    } else {
        karaokeBypass.gain.value = 1.0;
        karaokeActiveGain.gain.value = 0.0;
    }
}

// Live spectrum analyzer
let isSpectrumLoopActive = false;
function startLiveSpectrumAnalyzer() {
    if (isSpectrumLoopActive) return;
    const canvas = document.getElementById('telemetrySpectrumCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    isSpectrumLoopActive = true;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
        if (currentActiveSection !== 'stats' || !analyser) {
            isSpectrumLoopActive = false;
            return;
        }
        requestAnimationFrame(draw);
        
        analyser.getByteFrequencyData(dataArray);
        
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.2;
        let barHeight;
        let x = 0;
        
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#1db954');
        gradient.addColorStop(0.5, '#00e5ff');
        gradient.addColorStop(1, '#fc3c44');
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i];
            ctx.fillStyle = gradient;
            ctx.fillRect(x, canvas.height - barHeight / 1.5, barWidth - 1, barHeight / 1.5);
            x += barWidth;
        }
    }
    draw();
}

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

function syncWithWindowsMediaSystem() {
    try {
        if ('mediaSession' in navigator && currentTrack) {
            let coverUrl = currentTrack.hasCover 
                ? `http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/cover` 
                : null;
            
            const artworkArray = [];
            if (coverUrl) {
                artworkArray.push({ src: coverUrl, sizes: '512x512', type: 'image/jpeg' });
            }
            
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

// Play a track by ID
async function playTrack(trackId) {
    if (isMiniWindowMode) return;
    try {
        console.log('🎵 Playing track:', trackId);
        currentTrackId = trackId;
        currentTrack = tracks.find(t => t.id === trackId);
        
        if (!currentTrack) {
            showNotification('Track not found', 'error');
            return;
        }
        
        initAudio();
        
        setupAudioNodes();
        if (audioCtx && audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        
        const streamUrl = `http://127.0.0.1:${apiPort}/api/tracks/${trackId}/stream`;
        audioElement.src = streamUrl;
        
        await audioElement.play();
        setPlayState(true);
        updatePlayerUI();
        syncWithWindowsMediaSystem();
        
        fetch(`http://127.0.0.1:${apiPort}/api/tracks/${trackId}/play`, { method: 'POST' }).catch(e => console.error(e));
        
        const inQueueIndex = queue.findIndex(t => t.id === trackId);
        if (inQueueIndex !== -1) {
            queueIndex = inQueueIndex;
        } else {
            queue = [currentTrack];
            queueIndex = 0;
        }
        renderQueue();
        
    } catch (err) {
        console.error('Play error:', err);
        showNotification('Error playing audio file: ' + err.message, 'error');
        setPlayState(false);
    }
}

function seekTo(percent) {
    if (isMiniWindowMode) return;
    if (!audioElement || !audioElement.duration) return;
    audioElement.currentTime = (percent / 100) * audioElement.duration;
}

function handleMirrorSeek(event) {
    const bar = document.getElementById('fsMirrorProgressContainer');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
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

function togglePlay() {
    if (isMiniWindowMode) {
        window.electronAPI.controlFromMini('play-pause');
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
    
    if (isPlaying) {
        audioElement.pause();
        setPlayState(false);
    } else {
        setupAudioNodes();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        audioElement.play()
            .then(() => {
                setPlayState(true);
            })
            .catch((err) => {
                console.error('Play failed:', err);
                showNotification('Playback failed: ' + err.message, 'warning');
            });
    }
    syncWithWindowsMediaSystem();
}

let visualizerFrameId = null;
function startTimelineVisualizerLoop() {
    if (visualizerFrameId) cancelAnimationFrame(visualizerFrameId);
    
    function loop() {
        if (isPlaying) {
            updateTimelineVisualizer();
        }
        visualizerFrameId = requestAnimationFrame(loop);
    }
    loop();
}

function syncTrayPlaybackState() {
    if (window.electronAPI && typeof window.electronAPI.syncTrayState === 'function') {
        window.electronAPI.syncTrayState({
            isPlaying: isPlaying,
            track: currentTrack
        });
    }
}

function setPlayState(playing) {
    isPlaying = playing;
    
    syncWithMiniPlayerWidget();
    syncTrayPlaybackState();

    const mainBtn = document.getElementById('mainPlayBtn');
    const mainIcon = document.getElementById('mainPlayIcon');
    if (mainBtn) {
        mainBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    }
    if (mainIcon) {
        mainIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }
    
    const fsPlayBtn = document.getElementById('fsPlayBtn');
    if (fsPlayBtn) {
        fsPlayBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    }
    const fsPlayIcon = document.getElementById('fsPlayIcon');
    if (fsPlayIcon) {
        fsPlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }

    const miniBtn = document.getElementById('miniPlayBtn');
    const miniIcon = document.getElementById('miniPlayIcon');
    if (miniBtn) {
        miniBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    }
    if (miniIcon) {
        miniIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }
    
    const mirrorBtnIcon = document.getElementById('fsMirrorPlayIcon');
    if (mirrorBtnIcon) {
        mirrorBtnIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }
    
    const caseDisc = document.getElementById('fsAlbumArt');
    if (caseDisc) {
        if (isPlaying) {
            caseDisc.classList.add('playing');
        } else {
            caseDisc.classList.remove('playing');
        }
    }
    
    const timelineBg = document.getElementById('progressBarK');
    if (timelineBg) {
        if (isPlaying) {
            timelineBg.classList.add('playing');
        } else {
            timelineBg.classList.remove('playing');
        }
    }
    
    document.querySelectorAll('.track-row, .spotify-music-card').forEach(el => {
        const idAttr = parseInt(el.dataset.trackId);
        if (idAttr === currentTrackId) {
            const icon = el.querySelector('.hover-play-bubble i, .track-play-cell i');
            if (icon) {
                icon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            }
        }
    });
    
    if (playing) {
        if (lastVinylUpdateTime === 0) {
            lastVinylUpdateTime = Date.now();
        }
        if (!vinylRotationInterval) {
            vinylRotationInterval = setInterval(() => updateVinylRotation(), 50);
        }
    } else {
        if (vinylRotationInterval) {
            clearInterval(vinylRotationInterval);
            vinylRotationInterval = null;
        }
    }
}

// Keep original functions for compatibility
function nextTrack() {
    if (isMiniWindowMode) {
        window.electronAPI.controlFromMini('next');
        return;
    }
    if (queue.length > 0 && queueIndex < queue.length - 1) {
        queueIndex++;
        playTrack(queue[queueIndex].id);
    } else if (shuffleMode && tracks.length > 0) {
        const randIndex = Math.floor(Math.random() * tracks.length);
        playTrack(tracks[randIndex].id);
    } else if (tracks.length > 0) {
        const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
        let nextIndex = currentIndex + 1;
        if (nextIndex >= tracks.length) nextIndex = 0;
        playTrack(tracks[nextIndex].id);
    }
}

function prevTrack() {
    if (isMiniWindowMode) {
        window.electronAPI.controlFromMini('prev');
        return;
    }
    if (queue.length > 0 && queueIndex > 0) {
        queueIndex--;
        playTrack(queue[queueIndex].id);
    } else if (tracks.length > 0) {
        const currentIndex = tracks.findIndex(t => t.id === currentTrackId);
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) prevIndex = tracks.length - 1;
        playTrack(tracks[prevIndex].id);
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
    
    if (artEl) {
        artEl.innerHTML = coverUrl 
            ? `<img src="${coverUrl}" alt="Cover">` 
            : '<i class="fa-solid fa-music fallback-icon"></i>';
    }
    
    const miniTitle = document.getElementById('miniTitle');
    const miniArtist = document.getElementById('miniArtist');
    const miniArt = document.getElementById('miniArt');
    
    if (miniTitle) miniTitle.innerText = currentTrack.title || 'Untitled';
    if (miniArtist) miniArtist.innerText = currentTrack.artist || 'Unknown Artist';
    if (miniArt) {
        miniArt.innerHTML = coverUrl 
            ? `<img src="${coverUrl}" alt="Cover">` 
            : '<i class="fa-solid fa-music"></i>';
    }
    
    const fsTitle = document.getElementById('fsTitle');
    const fsArtist = document.getElementById('fsArtist');
    const fsArt = document.getElementById('fsAlbumArt');
    const fsBpm = document.getElementById('fsBpmBadge');
    const fsEnergy = document.getElementById('fsEnergyBadge');
    const fsLyrics = document.getElementById('fsLyrics');
    const fsBgBlur = document.getElementById('fsBgBlur');
    
    if (fsTitle) fsTitle.innerText = currentTrack.title || 'Untitled';
    if (fsArtist) fsArtist.innerText = currentTrack.artist || 'Unknown Artist';
    
    if (fsArt) {
        fsArt.innerHTML = coverUrl 
            ? `<img src="${coverUrl}" alt="Cover">` 
            : '<i class="fa-solid fa-music fallback-icon" style="font-size:3rem;"></i>';
    }
    if (fsBgBlur && coverUrl) {
        fsBgBlur.style.backgroundImage = `url(${coverUrl})`;
    }
    
    if (fsBpm) fsBpm.innerHTML = `<i class="fa-solid fa-heartbeat"></i> ${currentTrack.bpm || '120'} BPM`;
    if (fsEnergy) fsEnergy.innerHTML = `<i class="fa-solid fa-bolt"></i> ${currentTrack.energy ? Math.round(currentTrack.energy * 100) : '50'}% Energy`;
    
    if (fsLyrics) {
        if (currentTrack.lyrics) {
            fsLyrics.innerHTML = `<div class="lyrics-text">${escapeHtml(currentTrack.lyrics).replace(/\n/g, '<br>')}</div>`;
        } else {
            fsLyrics.innerHTML = `<p class="no-lyrics">${t('noLyrics')}</p>`;
        }
    }
    
    const likeBtn = document.getElementById('likeBtnK');
    if (likeBtn) {
        likeBtn.innerHTML = currentTrack.isLiked 
            ? '<i class="fa-solid fa-heart" style="color: var(--accent-pink);"></i>' 
            : '<i class="fa-regular fa-heart"></i>';
    }

    const specsEl = document.getElementById('playerSpecs');
    if (specsEl) {
        const codec = (currentTrack.codec || 'MPEG').toUpperCase();
        const kbps = currentTrack.bitrate ? `${Math.round(currentTrack.bitrate / 1000)} kbps` : '320 kbps';
        const hz = currentTrack.sampleRate ? `${(currentTrack.sampleRate / 1000).toFixed(1)} kHz` : '44.1 kHz';
        specsEl.innerText = `${codec} • ${kbps} • ${hz}`;
    }
    
    document.querySelectorAll('.track-row, .spotify-music-card').forEach(el => {
        const idAttr = parseInt(el.dataset.trackId);
        if (idAttr === currentTrackId) {
            el.classList.add('active');
            const icon = el.querySelector('.hover-play-bubble i, .track-play-cell i');
            if (icon) {
                icon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            }
        } else {
            el.classList.remove('active');
        }
    });
    
    const miniArtBox = document.querySelector('.mini-art-box');
    if (miniArtBox) {
        if (isPlaying) {
            miniArtBox.classList.add('playing');
        } else {
            miniArtBox.classList.remove('playing');
        }
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

function switchSection(sectionName) {
    if (isMiniWindowMode) return;
    currentActiveSection = sectionName;
    currentActivePlaylistId = null;
    
    document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-playlist-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const navHome = document.getElementById('navHome');
    const navLibrary = document.getElementById('navLibrary');
    const navFavorites = document.getElementById('navFavorites');
    const navStats = document.getElementById('navStats');
    
    if (sectionName === 'home' && navHome) navHome.classList.add('active');
    if (sectionName === 'library' && navLibrary) navLibrary.classList.add('active');
    if (sectionName === 'favorites' && navFavorites) navFavorites.classList.add('active');
    if (sectionName === 'stats' && navStats) navStats.classList.add('active');
    
    if (sectionName === 'home') renderHomeDashboard();
    if (sectionName === 'library') renderLibrary();
    if (sectionName === 'favorites') renderFavorites();
    if (sectionName === 'stats') {
        renderStats().then(() => {
            if (audioCtx && analyser) {
                startLiveSpectrumAnalyzer();
            }
        });
    }
}

function renderHomeDashboard() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    const hour = new Date().getHours();
    let welcomeText = t('welcomeEvening');
    if (hour < 12) welcomeText = t('welcomeMorning');
    else if (hour < 18) welcomeText = t('welcomeAfternoon');
    
    let shortcutsHtml = '';
    const topTracks = tracks.slice(0, 6);
    
    topTracks.forEach(track => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        shortcutsHtml += `
            <div class="shortcut-pill-card" onclick="playTrack(${track.id})">
                <div class="shortcut-cover">
                    ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                </div>
                <div class="shortcut-title-info">
                    <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                    <div class="shortcut-play-btn">
                        <i class="fa-solid fa-play"></i>
                    </div>
                </div>
            </div>
        `;
    });

    let recentGridHtml = '';
    const recentTracks = tracks.slice(0, 4);
    recentTracks.forEach(track => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        const isActive = currentTrackId === track.id;
        recentGridHtml += `
            <div class="spotify-music-card ${isActive ? 'active' : ''}" data-track-id="${track.id}">
                <div class="card-image-box" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                    ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    <div class="hover-play-bubble">
                        <i class="fa-solid ${isActive && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                    </div>
                </div>
                <div class="card-details-info" onclick="playTrack(${track.id})">
                    <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                    <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
                </div>
                <div class="card-additional-meta">
                    <span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'} BPM</span>
                    <span>${formatTime(track.duration)}</span>
                </div>
            </div>
        `;
    });

    const noTracksFound = t('emptyLibraryDesc');

    mainSection.innerHTML = `
        <div class="home-welcome-section">
            <h2 class="section-welcome-title">${welcomeText}</h2>
            <div class="top-shortcuts-grid">
                ${shortcutsHtml || `<p class="no-tracks-info">${noTracksFound}</p>`}
            </div>
        </div>
        
        <div class="spotify-row-title">
            <h3>${t('dailySuggestions')}</h3>
            <span class="view-all-link" onclick="switchSection('library')">${currentLanguage === 'fa' ? 'مشاهده همه' : 'View All'}</span>
        </div>
        <div class="cards-responsive-grid">
            ${recentGridHtml || `<p class="no-tracks-info">${noTracksFound}</p>`}
        </div>
    `;
}

function renderLibrary(filteredTracks = null) {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    const listToRender = filteredTracks !== null ? filteredTracks : tracks;
    
    if (listToRender.length === 0) {
        mainSection.innerHTML = `
            <div class="empty-illustration-state">
                <i class="fa-solid fa-compact-disc"></i>
                <h3>${t('emptyLibrary')}</h3>
                <p>${t('emptyLibraryDesc')}</p>
            </div>
        `;
        return;
    }
    
    mainSection.innerHTML = `
        <div class="spotify-row-title">
            <h3>${t('libraryArchive')} (<span id="libCount">${listToRender.length}</span>)</h3>
            <span style="font-size: 0.75rem; color: var(--spotify-text-muted);">${t('rightClickTip')}</span>
        </div>
        <div class="library-table-wrapper">
            <table class="library-tracks-table">
                <thead>
                    <tr>
                        <th style="width: 50px;">#</th>
                        <th>${currentLanguage === 'fa' ? 'عنوان' : 'Title'}</th>
                        <th>${currentLanguage === 'fa' ? 'آلبوم' : 'Album'}</th>
                        <th style="width: 80px;">BPM</th>
                        <th style="width: 80px;"><i class="fa-regular fa-clock"></i></th>
                        <th style="width: 100px;">${currentLanguage === 'fa' ? 'عملیات' : 'Actions'}</th>
                    </tr>
                </thead>
                <tbody id="libraryTableBody"></tbody>
            </table>
            <div id="loadMoreContainer" style="text-align: center; margin-top: 16px; display: none;">
                <button id="loadMoreBtn" class="oobe-start-btn" style="padding: 8px 16px; font-size: 0.75rem;">${currentLanguage === 'fa' ? 'بارگذاری بیشتر...' : 'Load more...'}</button>
            </div>
        </div>
    `;
    
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
            
            rows += `
                <tr class="track-row ${isActive ? 'active' : ''}" data-track-id="${track.id}" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                    <td class="track-play-cell">${indexText}</td>
                    <td class="track-info-cell">
                        <div class="table-song-cover">
                            ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                        </div>
                        <div class="table-song-meta">
                            <span class="table-song-title">${escapeHtml(track.title || 'Untitled')}</span>
                            <span class="table-song-artist">${escapeHtml(track.artist || 'Unknown Artist')}</span>
                        </div>
                    </td>
                    <td class="track-album-cell">${escapeHtml(track.album || '—')}</td>
                    <td class="track-bpm-cell">${track.bpm || '120'}</td>
                    <td class="track-time-cell">${formatTime(track.duration)}</td>
                    <td class="track-actions-cell">
                        <button class="table-action-btn like" title="${currentLanguage === 'fa' ? 'افزودن به لیست' : 'Add to list'}" onclick="event.stopPropagation(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                            <i class="fa-solid fa-plus"></i>
                        </button>
                        <button class="table-action-btn delete" onclick="deleteTrack(${track.id}, event)">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        
        tbody.insertAdjacentHTML('beforeend', rows);
        currentIndex += chunkSize;
        
        if (currentIndex < listToRender.length) {
            loadMoreContainer.style.display = 'block';
        } else {
            loadMoreContainer.style.display = 'none';
        }
    }
    
    renderNextChunk();
    if (loadMoreBtn) {
        loadMoreBtn.onclick = () => renderNextChunk();
    }
}

function deleteTrack(trackId, event) {
    event.stopPropagation();
    const alertTitle = currentLanguage === 'fa' ? 'حذف قطعه از کتابخانه' : 'Delete track from library';
    const alertMsg = currentLanguage === 'fa' ? 'آیا مطمئن هستید؟ این عمل فایل اصلی شما روی کامپیوتر را پاک نخواهد کرد.' : 'Are you sure? This will not delete the actual file from your disk.';
    showCustomDialog(alertTitle, alertMsg, async () => {
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${trackId}`, { method: 'DELETE' });
            if (res.ok) {
                showNotification('Track removed', 'success');
                await loadTracks();
                await loadPlaylists();
                switchSection(currentActiveSection);
            }
        } catch {
            showNotification('Connection failed', 'error');
        }
    });
}

function renderFavorites() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    const likedTracks = tracks.filter(t => t.isLiked);
    
    if (likedTracks.length === 0) {
        mainSection.innerHTML = `
            <div class="empty-illustration-state">
                <i class="fa-solid fa-heart" style="color: var(--accent-pink);"></i>
                <h3>${t('emptyFavs')}</h3>
                <p>${t('emptyFavsDesc')}</p>
            </div>
        `;
        return;
    }
    
    let gridHtml = '';
    likedTracks.forEach(track => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        const isActive = currentTrackId === track.id;
        
        gridHtml += `
            <div class="spotify-music-card ${isActive ? 'active' : ''}" data-track-id="${track.id}">
                <div class="card-image-box" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                    ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    <div class="hover-play-bubble">
                        <i class="fa-solid ${isActive && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                    </div>
                </div>
                <div class="card-details-info" onclick="playTrack(${track.id})">
                    <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                    <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
                </div>
                <div class="card-additional-meta">
                    <span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'} BPM</span>
                    <span>${formatTime(track.duration)}</span>
                </div>
            </div>
        `;
    });
    
    mainSection.innerHTML = `
        <div class="spotify-row-title">
            <h3>${t('navFavText')} (${likedTracks.length})</h3>
        </div>
        <div class="cards-responsive-grid">
            ${gridHtml}
        </div>
    `;
}

async function renderStats() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/stats`);
        if (!res.ok) throw new Error();
        const stats = await res.json();
        
        mainSection.innerHTML = `
            <div class="spotify-row-title">
                <h3>${t('statsTitle')}</h3>
            </div>
            
            <div class="live-stats-dashboard">
                <div class="live-stat-card border-cyan">
                    <i class="fa-solid fa-music"></i>
                    <h5>${t('totalTracksLabel')}</h5>
                    <h2>${stats.totalTracks || 0}</h2>
                </div>
                <div class="live-stat-card border-pink">
                    <i class="fa-solid fa-headphones"></i>
                    <h5>${t('totalPlaysLabel')}</h5>
                    <h2>${stats.totalPlayCount || 0}</h2>
                </div>
                <div class="live-stat-card border-green">
                    <i class="fa-solid fa-heart"></i>
                    <h5>${t('popularLabel')}</h5>
                    <h2>${stats.totalLikes || 0}</h2>
                </div>
            </div>
            
            ${stats.mostPlayed ? `
                <div class="most-played-highlight">
                    <i class="fa-solid fa-trophy"></i>
                    <div>
                        <span class="hero-label">${t('statsHero')}</span>
                        <h2 class="hero-title">${escapeHtml(stats.mostPlayed.title)}</h2>
                        <p class="hero-desc">${escapeHtml(stats.mostPlayed.artist || 'Unknown Artist')}</p>
                        <p class="hero-detail">${t('topTrackLabel')} (<strong>${stats.mostPlayed.playCount || 0}</strong> ${t('playedTimes')}).</p>
                    </div>
                </div>
            ` : ''}

            <h4 style="margin-top: 24px; margin-bottom: 12px; font-size: 0.9rem; color: var(--spotify-text-muted);"><i class="fa-solid fa-wave-square"></i> ${t('liveSpectrumLabel')}</h4>
            <canvas id="telemetrySpectrumCanvas" width="600" height="200" style="width: 100%; height: 200px; background-color: #0c0c0e; border-radius: var(--radius-lg); border: 1px solid var(--border-color);"></canvas>
        `;
    } catch {
        mainSection.innerHTML = `<p class="stats-error">${t('statsError')}</p>`;
    }
}

// Original AI recommendation handler (kept for compatibility but overridden)
async function handleAiRecommendations() {
    if (!currentTrackId) {
        showNotification('Play a track first.', 'warning');
        return;
    }
    
    showNotification('Analyzing acoustic profiles...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/recommend/${currentTrackId}/detailed`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        if (!data.recommendations || data.recommendations.length === 0) {
            showNotification('No similar tracks found.', 'info');
            return;
        }
        
        const mainSection = document.getElementById('dynamicSectionContainer');
        if (!mainSection) return;
        
        const translatedGenreName = getGenreTranslation(data.sourceTrack.genre);
        
        const sourceGenreHtml = `
            <div class="source-genre-badge" style="background: ${data.sourceTrack.genreIcon === 'fa-saxophone' ? '#4a90e2' : data.sourceTrack.genreIcon === 'fa-guitar' ? '#f5a623' : data.sourceTrack.genreIcon === 'fa-drum' ? '#1db954' : '#888'};">
                <i class="fa-solid ${data.sourceTrack.genreIcon || 'fa-music'}"></i>
                <span>${t('genreDetected')}: ${translatedGenreName || data.sourceTrack.genre}</span>
                <small>${data.sourceTrack.bpm} ${t('bpmBadge')} • ${Math.round((data.sourceTrack.energy || 0.5) * 100)}% ${t('energyBadge')}</small>
            </div>
        `;
        
        let gridHtml = '';
        for (const track of data.recommendations) {
            const coverUrl = track.coverUrl ? `http://127.0.0.1:${apiPort}${track.coverUrl}` : null;
            const isActive = currentTrackId === track.id;
            
            let translatedReason = track.reason;
            if (currentLanguage === 'fa') {
                if (track.reason.includes('BPM')) translatedReason = 'BPM بسیار نزدیک';
                else if (track.reason.includes('energy')) translatedReason = 'انرژی صوتی هم‌سو';
                else if (track.reason.includes('genre')) translatedReason = `${getGenreTranslation(track.detectedGenre)} (سبک یکسان)`;
                else translatedReason = 'توصیه الگوریتمی KORAI';
            }
            
            gridHtml += `
                <div class="spotify-music-card ${isActive ? 'active' : ''}" data-track-id="${track.id}">
                    <div class="card-image-box" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                        ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                        <div class="hover-play-bubble">
                            <i class="fa-solid ${isActive && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                        </div>
                    </div>
                    <div class="card-details-info" onclick="playTrack(${track.id})">
                        <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                        <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
                    </div>
                    <div class="card-additional-meta">
                        <span class="similarity-badge" style="background: ${track.genreColor || '#1db954'}20; color: ${track.genreColor || '#1db954'}">
                            <i class="fa-solid ${track.genreIcon || 'fa-chart-line'}"></i> ${track.similarity}% ${t('similarity')}
                        </span>
                        <span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'} BPM</span>
                    </div>
                    <div class="recommend-reason">
                        <small><i class="fa-solid fa-info-circle"></i> ${translatedReason || t('recommended')}</small>
                    </div>
                </div>
            `;
        }
        
        mainSection.innerHTML = `
            <div class="spotify-row-title">
                <h3><i class="fa-solid fa-wand-magic-sparkles" style="color: var(--accent-cyan);"></i> ${t('smartRecommendations')}</h3>
                <div style="display: flex; gap: 12px;">
                    <button class="create-similar-playlist-btn" onclick="createSimilarPlaylistFromCurrent()">
                        <i class="fa-solid fa-list-music"></i> ${t('similarPlaylist')}
                    </button>
                    <span class="view-all-link" onclick="switchSection('home')">${t('backToHome')}</span>
                </div>
            </div>
            ${sourceGenreHtml}
            <div class="cards-responsive-grid">
                ${gridHtml}
            </div>
        `;
        showNotification('Recommendations populated', 'success');
        
    } catch (err) {
        console.error('Recommendation error:', err);
        showNotification('Error calculating match states', 'error');
    }
}

// Enhanced AI recommendation handler with detailed analysis
async function handleAiRecommendationsEnhanced() {
    if (!currentTrackId) {
        showNotification('Play a track first to get recommendations', 'warning');
        return;
    }
    
    showNotification('Analyzing acoustic fingerprints...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/recommend/${currentTrackId}/detailed`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        if (!data.recommendations || data.recommendations.length === 0) {
            showNotification('No similar tracks found in your library', 'info');
            return;
        }
        
        const mainSection = document.getElementById('dynamicSectionContainer');
        if (!mainSection) return;
        
        const sourceGenreName = getGenreTranslation(data.sourceTrack.genre);
        
        const sourceInfoHtml = `
            <div class="recommendation-source-card">
                <div class="source-track-badge">
                    <i class="fa-solid ${data.sourceTrack.genreIcon || 'fa-music'}"></i>
                    <span>Based on:</span>
                </div>
                <div class="source-track-details">
                    <h3>${escapeHtml(data.sourceTrack.title || 'Untitled')}</h3>
                    <p>${escapeHtml(data.sourceTrack.artist || 'Unknown Artist')}</p>
                    <div class="source-metrics">
                        <span class="metric-badge"><i class="fa-solid fa-heartbeat"></i> ${data.sourceTrack.bpm || '120'} BPM</span>
                        <span class="metric-badge"><i class="fa-solid fa-bolt"></i> ${Math.round((data.sourceTrack.energy || 0.5) * 100)}% Energy</span>
                        <span class="metric-badge genre"><i class="fa-solid ${data.sourceTrack.genreIcon || 'fa-tag'}"></i> ${sourceGenreName || data.sourceTrack.genre}</span>
                    </div>
                </div>
                <div class="recommendation-stats">
                    <span><i class="fa-solid fa-list"></i> ${data.recommendations.length} tracks found</span>
                </div>
            </div>
        `;
        
        let recommendationsHtml = '';
        for (const track of data.recommendations) {
            const coverUrl = track.coverUrl ? `http://127.0.0.1:${apiPort}${track.coverUrl}` : null;
            const isActive = currentTrackId === track.id;
            
            let translatedReason = track.reason;
            if (currentLanguage === 'fa') {
                if (track.reason && track.reason.includes('BPM')) translatedReason = 'BPM بسیار نزدیک';
                else if (track.reason && track.reason.includes('energy')) translatedReason = 'انرژی صوتی هم‌سو';
                else if (track.reason && track.reason.includes('سبک')) translatedReason = track.reason;
                else translatedReason = track.reason || 'توصیه هوشمند KORAI';
            }
            
            const similarityPercent = track.similarity || 0;
            const similarityBarWidth = similarityPercent;
            
            recommendationsHtml += `
                <div class="spotify-music-card recommendation-card ${isActive ? 'active' : ''}" data-track-id="${track.id}" style="border-left: 3px solid ${track.genreColor || '#1db954'}">
                    <div class="card-image-box" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                        ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                        <div class="hover-play-bubble">
                            <i class="fa-solid ${isActive && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                        </div>
                    </div>
                    <div class="card-details-info" onclick="playTrack(${track.id})">
                        <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                        <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
                    </div>
                    <div class="similarity-indicator">
                        <div class="similarity-bar-bg">
                            <div class="similarity-bar-fill" style="width: ${similarityBarWidth}%; background: ${track.genreColor || '#1db954'}"></div>
                        </div>
                        <span class="similarity-percent">${similarityPercent}% Match</span>
                    </div>
                    <div class="card-additional-meta">
                        <span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'} BPM</span>
                        <span class="genre-tag" style="background: ${track.genreColor || '#1db954'}20; color: ${track.genreColor || '#1db954'}">
                            <i class="fa-solid ${track.genreIcon || 'fa-tag'}"></i> ${getGenreTranslation(track.detectedGenre) || track.detectedGenre}
                        </span>
                    </div>
                    <div class="recommend-reason">
                        <small><i class="fa-solid ${track.similarityIcon || 'fa-chart-line'}"></i> ${translatedReason}</small>
                    </div>
                </div>
            `;
        }
        
        mainSection.innerHTML = `
            <div class="recommendations-header">
                <div class="spotify-row-title">
                    <h3><i class="fa-solid fa-brain" style="color: var(--accent-cyan);"></i> AI-Powered Recommendations</h3>
                    <div class="header-actions">
                        <button class="create-similar-playlist-btn" onclick="createSimilarPlaylistFromCurrent()">
                            <i class="fa-solid fa-list-music"></i> Create Similar Playlist
                        </button>
                        <button class="refresh-recommendations-btn" onclick="handleAiRecommendationsEnhanced()">
                            <i class="fa-solid fa-rotate-right"></i>
                        </button>
                        <span class="view-all-link" onclick="switchSection('home')">Back to Home</span>
                    </div>
                </div>
                ${sourceInfoHtml}
            </div>
            <div class="recommendations-grid">
                <div class="cards-responsive-grid">
                    ${recommendationsHtml}
                </div>
            </div>
        `;
        
        showNotification(`Found ${data.recommendations.length} similar tracks`, 'success');
        
    } catch (err) {
        console.error('Recommendation error:', err);
        showNotification('Error generating recommendations', 'error');
    }
}

// Override the recommendation handler
window.handleAiRecommendations = handleAiRecommendationsEnhanced;

async function createSimilarPlaylistFromCurrent() {
    if (!currentTrackId) {
        showNotification('Play a track first.', 'warning');
        return;
    }
    
    showNotification('Creating similar playlist...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/playlists/similar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId: currentTrackId })
        });
        
        if (!res.ok) throw new Error();
        const result = await res.json();
        
        if (result.success) {
            showNotification(`Playlist "${result.playlist.name}" created with ${result.trackCount} tracks`, 'success');
            await loadPlaylists();
            
            setTimeout(() => {
                openPlaylist(result.playlist.id);
            }, 500);
        } else {
            showNotification('No similar tracks found', 'warning');
        }
    } catch (err) {
        console.error('Create playlist error:', err);
        showNotification('Error creating playlist', 'error');
    }
}

async function toggleLike() {
    if (!currentTrackId) return;
    const isCurrentlyLiked = currentTrack.isLiked;
    const method = isCurrentlyLiked ? 'DELETE' : 'POST';
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${currentTrackId}/like`, { method });
        if (!res.ok) throw new Error();
        const track = tracks.find(t => t.id === currentTrackId);
        if (track) {
            track.isLiked = !isCurrentlyLiked;
            if (currentTrack) currentTrack.isLiked = !isCurrentlyLiked;
        }
        updatePlayerUI();
        const likesEl = document.getElementById('quickTotalLikes');
        if (likesEl) likesEl.innerText = tracks.filter(t => t.isLiked).length;
        showNotification(isCurrentlyLiked ? 'Removed from favorites' : 'Added to favorites', 'success');
        if (currentActiveSection === 'favorites') renderFavorites();
    } catch {
        showNotification('Connection failed', 'error');
    }
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
        html += `
            <div class="queue-drawer-item ${idx === queueIndex ? 'active' : ''}" onclick="playFromQueue(${idx})">
                <span class="queue-index-no">${idx + 1}</span>
                <div class="queue-meta-data">
                    <h5>${escapeHtml(track.title || 'Untitled')}</h5>
                    <p>${escapeHtml(track.artist || 'Unknown Artist')}</p>
                </div>
                <button class="remove-from-queue-btn" onclick="event.stopPropagation(); removeFromQueue(${idx});">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    });
    listEl.innerHTML = html;
}

function playFromQueue(idx) {
    if (idx >= 0 && idx < queue.length) {
        queueIndex = idx;
        playTrack(queue[idx].id);
    }
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

function toggleFullscreen() {
    isFullscreenPlayerOpen = !isFullscreenPlayerOpen;
    const player = document.getElementById('fullscreenPlayer');
    if (player) {
        player.classList.toggle('open', isFullscreenPlayerOpen);
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
            setTimeout(() => {
                if (card) card.classList.add('show');
            }, 50);
            if (appContainer) appContainer.classList.add('mini-mode-active');
        } else {
            if (card) card.classList.remove('show');
            setTimeout(() => {
                if (card) card.style.display = 'none';
            }, 400);
            if (appContainer) appContainer.classList.remove('mini-mode-active');
        }
    }
}

async function handleImport() {
    if (!window.electronAPI || typeof window.electronAPI.selectAudioFiles !== 'function') {
        showNotification('Electron API not available', 'error');
        return;
    }
    
    try {
        const filePaths = await window.electronAPI.selectAudioFiles();
        if (!filePaths || filePaths.length === 0) return;
        
        showNotification(`Scanning and analyzing ${filePaths.length} files...`, 'info');
        
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths })
        });
        
        if (!res.ok) throw new Error();
        const result = await res.json();
        
        showNotification(`Successfully added ${result.imported} local tracks.`, 'success');
        await loadTracks();
        switchSection(currentActiveSection);
        
    } catch (err) {
        console.error('Import error:', err);
        showNotification('Load and analysis phase crashed', 'error');
    }
}

async function handleFolderImport() {
    if (!window.electronAPI || typeof window.electronAPI.selectAudioFolder !== 'function') {
        showNotification('Electron API not available', 'error');
        return;
    }
    try {
        const filePaths = await window.electronAPI.selectAudioFolder();
        if (!filePaths || filePaths.length === 0) return;
        
        showNotification(`Scanning and analyzing directory files...`, 'info');
        
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths })
        });
        
        if (!res.ok) throw new Error();
        const result = await res.json();
        
        showNotification(`Successfully loaded ${result.imported} tracks.`, 'success');
        await loadTracks();
        switchSection(currentActiveSection);
    } catch (err) {
        console.error('Folder import error:', err);
        showNotification('Folder scan interrupted', 'error');
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
        if (!url) {
            showNotification('Please provide a valid URL', 'warning');
            return;
        }
        
        closeDownloadUrlModal();
        showNotification('Configuring cloud request...', 'info');
        
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (res.ok) {
                showNotification('Audio downloaded successfully', 'success');
                await loadTracks();
                switchSection(currentActiveSection);
            } else {
                showNotification('Request failed', 'error');
            }
        } catch (e) {
            showNotification('Cloud capture aborted', 'error');
        }
    };
}

function closeDownloadUrlModal() {
    const modal = document.getElementById('downloadUrlModal');
    if (modal) modal.style.display = 'none';
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
}

function updateBodyClasses() {
    const dirClass = currentLanguage === 'fa' ? 'rtl' : 'ltr';
    const miniClass = isMiniWindowMode ? 'mini-window-active' : '';
    document.body.className = `theme-${currentSkin} ${dirClass} ${miniClass}`;
}

function applyGlobalSkin(skinName) {
    currentSkin = skinName;
    localStorage.setItem('user_skin', skinName);
    updateBodyClasses();
}

function setSleepTimer(minutes) {
    cancelSleepTimer();
    sleepTimeRemaining = minutes * 60;
    const display = document.getElementById('sleepTimerVal');
    const cancelBtn = document.getElementById('cancelSleepBtn');
    if (cancelBtn) cancelBtn.style.display = 'block';
    
    showNotification(`Sleep timer set to ${minutes} minutes.`, 'success');

    sleepIntervalId = setInterval(() => {
        sleepTimeRemaining--;
        if (display) display.innerText = formatTime(sleepTimeRemaining);

        if (sleepTimeRemaining <= 60 && sleepTimeRemaining > 0) {
            const fadeVolume = (sleepTimeRemaining / 60) * volume;
            if (audioElement) audioElement.volume = fadeVolume;
        }

        if (sleepTimeRemaining <= 0) {
            clearInterval(sleepIntervalId);
            if (audioElement) {
                audioElement.pause();
                setPlayState(false);
                audioElement.volume = volume;
            }
            cancelSleepTimer();
            showNotification('Playback paused by sleep timer.', 'info');
        }
    }, 1000);
}

function cancelSleepTimer() {
    if (sleepIntervalId) {
        clearInterval(sleepIntervalId);
        sleepIntervalId = null;
    }
    sleepTimeRemaining = 0;
    const display = document.getElementById('sleepTimerVal');
    if (display) display.innerText = t('sleepOff');
    const cancelBtn = document.getElementById('cancelSleepBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (audioElement) audioElement.volume = volume;
}

function setupDragAndDrop() {
    const container = document.getElementById('appContainer');
    if (!container) return;
    
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (isMiniWindowMode) return;
        
        const files = Array.from(e.dataTransfer.files);
        const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
        
        const filePaths = files
            .map(file => file.path || file.name)
            .filter(p => {
                if (!p) return false;
                const ext = p.split('.').pop().toLowerCase();
                return audioExtensions.includes(ext);
            });
            
        if (filePaths.length === 0) return;
        
        showNotification(t('dragNotify'), 'info');
        
        try {
            const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePaths })
            });
            
            if (!res.ok) throw new Error();
            const result = await res.json();
            
            showNotification(`${result.imported} ${t('dragSuccess')}`, 'success');
            await loadTracks();
            switchSection(currentActiveSection);
        } catch (err) {
            console.error('Drag Import error:', err);
            showNotification(t('dragError'), 'error');
        }
    });
}

function setupEventListeners() {
    const winMinBtn = document.getElementById('winMinimizeBtn');
    const winMaxBtn = document.getElementById('winMaximizeBtn');
    const winCloseBtn = document.getElementById('winCloseBtn');

    if (winMinBtn) winMinBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    if (winMaxBtn) winMaxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    if (winCloseBtn) winCloseBtn.addEventListener('click', () => window.electronAPI.closeWindow());

    const langToggleBtn = document.getElementById('langToggleBtn');
    if (langToggleBtn) {
        langToggleBtn.addEventListener('click', () => {
            const newLang = currentLanguage === 'fa' ? 'en' : 'fa';
            changeClientLanguage(newLang);
        });
    }

    const skinBtns = document.querySelectorAll('.skin-btn');
    skinBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            skinBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyGlobalSkin(btn.dataset.skin);
        });
    });
    
    const createSimilarBtn = document.getElementById('createSimilarPlaylistBtn');
    if (createSimilarBtn) {
        createSimilarBtn.addEventListener('click', createSimilarPlaylistFromCurrent);
    }
    
    const activeSkinBtn = document.querySelector(`.skin-btn[data-skin="${currentSkin}"]`);
    if (activeSkinBtn) {
        skinBtns.forEach(b => b.classList.remove('active'));
        activeSkinBtn.classList.add('active');
    }

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
    
    window.addEventListener('keydown', (e) => {
        if (document.activeElement && (
            document.activeElement.tagName === 'INPUT' || 
            document.activeElement.tagName === 'TEXTAREA' ||
            document.activeElement.isContentEditable
        )) {
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
                    nextTrack();
                } else if (audioElement) {
                    audioElement.currentTime = Math.min(audioElement.duration || 0, audioElement.currentTime + 10);
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (e.ctrlKey) {
                    prevTrack();
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
                nextTrack();
                break;
            case 'b':
            case 'B':
            case 'p':
            case 'P':
                prevTrack();
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
                if (isFullscreenPlayerOpen) {
                    toggleFullscreen();
                }
                break;
        }
    });

    const progressBar = document.getElementById('progressBarK');
    const scrubTooltip = document.getElementById('scrubTooltip');
    if (progressBar && scrubTooltip) {
        progressBar.addEventListener('mousemove', (e) => {
            if (!audioElement || !audioElement.duration) return;
            const rect = progressBar.getBoundingClientRect();
            const posX = e.clientX - rect.left;
            const percent = posX / rect.width;
            const calculatedTime = percent * audioElement.duration;
            
            scrubTooltip.innerText = formatTime(calculatedTime);
            scrubTooltip.style.left = `${posX}px`;
        });
        
        progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percent = (clickX / rect.width) * 100;
            seekTo(percent);
        });
    }

    const fsMirrorProgress = document.getElementById('fsMirrorProgressContainer');
    if (fsMirrorProgress) {
        fsMirrorProgress.addEventListener('click', handleMirrorSeek);
    }

    const mainPlayBtn = document.getElementById('mainPlayBtn');
    if (mainPlayBtn) mainPlayBtn.addEventListener('click', togglePlay);

    const miniPlayBtn = document.getElementById('miniPlayBtn');
    if (miniPlayBtn) miniPlayBtn.addEventListener('click', togglePlay);
    
    const nextBtn = document.getElementById('nextBtnK');
    if (nextBtn) nextBtn.addEventListener('click', nextTrack);
    
    const prevBtn = document.getElementById('prevBtnK');
    if (prevBtn) prevBtn.addEventListener('click', prevTrack);
    
    const shuffleBtn = document.getElementById('shuffleBtnK');
    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', () => {
            shuffleMode = !shuffleMode;
            shuffleBtn.classList.toggle('active', shuffleMode);
        });
    }
    
    const repeatBtn = document.getElementById('repeatBtnK');
    if (repeatBtn) {
        repeatBtn.addEventListener('click', () => {
            repeatMode = !repeatMode;
            repeatBtn.classList.toggle('active', repeatMode);
        });
    }

    const fsPlayBtn = document.getElementById('fsPlayBtn');
    if (fsPlayBtn) fsPlayBtn.addEventListener('click', togglePlay);

    const fsNextBtn = document.getElementById('fsNextBtn');
    if (fsNextBtn) fsNextBtn.addEventListener('click', nextTrack);

    const fsPrevBtn = document.getElementById('fsPrevBtn');
    if (fsPrevBtn) fsPrevBtn.addEventListener('click', prevTrack);

    const fsShuffleBtn = document.getElementById('fsShuffleBtn');
    if (fsShuffleBtn) {
        fsShuffleBtn.addEventListener('click', () => {
            shuffleMode = !shuffleMode;
            fsShuffleBtn.classList.toggle('active', shuffleMode);
            const baseShuffle = document.getElementById('shuffleBtnK');
            if (baseShuffle) baseShuffle.classList.toggle('active', shuffleMode);
        });
    }

    const fsRepeatBtn = document.getElementById('fsRepeatBtn');
    if (fsRepeatBtn) {
        fsRepeatBtn.addEventListener('click', () => {
            repeatMode = !repeatMode;
            fsRepeatBtn.classList.toggle('active', repeatMode);
            const baseRepeat = document.getElementById('repeatBtnK');
            if (baseRepeat) baseRepeat.classList.toggle('active', repeatMode);
        });
    }
    
    const likeBtn = document.getElementById('likeBtnK');
    if (likeBtn) likeBtn.addEventListener('click', toggleLike);
    
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
            if (isMiniWindowMode) {
                window.electronAPI.closeMiniPlayer();
            } else {
                toggleMiniPlayer();
            }
        });
    }

    const miniNextBtn = document.getElementById('miniNextBtn');
    if (miniNextBtn) {
        miniNextBtn.addEventListener('click', () => {
            if (isMiniWindowMode) window.electronAPI.controlFromMini('next');
            else nextTrack();
        });
    }

    const miniPrevBtn = document.getElementById('miniPrevBtn');
    if (miniPrevBtn) {
        miniPrevBtn.addEventListener('click', () => {
            if (isMiniWindowMode) window.electronAPI.controlFromMini('prev');
            else prevTrack();
        });
    }
    
    const volSlider = document.getElementById('volumeSlider');
    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            setVolume(e.target.value);
        });
    }
    
    const volIcon = document.getElementById('volumeIcon');
    if (volIcon) {
        volIcon.addEventListener('click', toggleMute);
    }

    const dspToggleBtn = document.getElementById('dspToggleBtn');
    const closeDspBtn = document.getElementById('closeDspBtn');
    const dspPanel = document.getElementById('dspPanel');
    
    if (dspToggleBtn && dspPanel) {
        dspToggleBtn.addEventListener('click', () => {
            dspPanel.classList.toggle('open');
        });
    }
    if (closeDspBtn && dspPanel) {
        closeDspBtn.addEventListener('click', () => {
            dspPanel.classList.remove('open');
        });
    }
    
    for (let i = 0; i < 5; i++) {
        const slider = document.getElementById(`eqSlider${i}`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                updateEqualizerBand(i, e.target.value);
            });
        }
    }
    
    const tempoSlider = document.getElementById('tempoSlider');
    if (tempoSlider) {
        tempoSlider.addEventListener('input', (e) => {
            updatePlaybackSpeed(e.target.value);
        });
    }
    
    const pitchToggle = document.getElementById('pitchToggle');
    if (pitchToggle) {
        pitchToggle.addEventListener('change', (e) => {
            togglePitchPreservation(e.target.checked);
        });
    }

    const karaokeToggle = document.getElementById('karaokeToggle');
    if (karaokeToggle) {
        karaokeToggle.addEventListener('change', (e) => {
            karaokeMode = e.target.checked;
            if (audioElement && currentTrackId) {
                setupAudioNodes();
                updateKaraokeRouting();
            }
        });
    }

    setupDragAndDrop();

    if (isMiniWindowMode && window.electronAPI) {
        window.electronAPI.onStateUpdated((state) => {
            currentTrack = state.track;
            isPlaying = state.isPlaying;
            apiPort = state.apiPort;

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
                    miniArt.innerHTML = coverUrl 
                        ? `<img src="${coverUrl}" alt="Cover">` 
                        : '<i class="fa-solid fa-music"></i>';
                }
            }
            if (mPlayIcon) {
                mPlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            }
            if (mTimelineFill && state.duration > 0) {
                const pct = (state.currentTime / state.duration) * 100;
                mTimelineFill.style.width = `${pct}%`;
            }
        });
    }

    if (!isMiniWindowMode && window.electronAPI) {
        window.electronAPI.onExecuteControl((command) => {
            if (command === 'play-pause') togglePlay();
            if (command === 'next') nextTrack();
            if (command === 'prev') prevTrack();
            if (command.startsWith('seek:')) {
                const percent = parseFloat(command.split(':')[1]);
                seekTo(percent);
            }
        });
    }
    
    startTimelineVisualizerLoop();
}

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
}

window.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🚀 DOM loaded, initializing KORAI Player...');
        
        const splash = document.getElementById('koraiSplashScreen');
        const splashProgress = document.getElementById('splashProgressFill');
        const appContainer = document.getElementById('appContainer');
        const playbackBar = document.getElementById('playbackBar');

        if (splashProgress) splashProgress.style.width = '20%';
        
        await waitForAPI();
        if (splashProgress) splashProgress.style.width = '45%';

        if (isMiniWindowMode) {
            setupEventListeners();
            updateBodyClasses();
            document.body.classList.add('mini-window-active');
            const mCard = document.getElementById('miniplayerCard');
            if (mCard) {
                mCard.style.display = 'block';
                mCard.classList.add('show');
            }
            if (splash) splash.style.display = 'none';
            console.log('Floating mini player widget initialized');
            return;
        }

        await loadTracks();
        if (splashProgress) splashProgress.style.width = '75%';
        await loadPlaylists();
        if (splashProgress) splashProgress.style.width = '100%';

        setupEventListeners();
        setVolume(0.7);
        initAudio();
        
        changeClientLanguage(currentLanguage);
        updateBodyClasses();
        
        switchSection('home');

        if (window.electronAPI && window.electronAPI.onFilesOpened) {
            window.electronAPI.onFilesOpened(async (files) => {
                console.log('📁 Files opened from system:', files);
                
                if (files && files.length > 0) {
                    showImportProgress(files.length);
                    
                    try {
                        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/import`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filePaths: files })
                        });
                        
                        if (res.ok) {
                            const result = await res.json();
                            updateImportProgress(100, `Imported ${result.imported} track(s)!`);
                            
                            setTimeout(async () => {
                                hideImportProgress();
                                showNotification(`Successfully imported ${result.imported} track(s)`, 'success');
                                await loadTracks();
                                
                                if (result.imported > 0 && tracks.length > 0) {
                                    const lastTrack = tracks[tracks.length - 1];
                                    console.log('🎵 Auto-playing last imported track:', lastTrack.title);
                                    setTimeout(() => {
                                        playTrack(lastTrack.id);
                                    }, 300);
                                }
                                
                                switchSection(currentActiveSection);
                            }, 500);
                            
                        } else {
                            hideImportProgress();
                            const error = await res.json();
                            showNotification(`Import failed: ${error.error || 'Unknown error'}`, 'error');
                        }
                    } catch (err) {
                        console.error('File association import error:', err);
                        hideImportProgress();
                        showNotification('Error importing files opened from system', 'error');
                    }
                }
            });
        }

        setTimeout(async () => {
            if (splash) {
                splash.classList.add('fade-out');
                setTimeout(async () => {
                    splash.style.display = 'none';

                    try {
                        const settingsRes = await fetch(`http://127.0.0.1:${apiPort}/api/settings`);
                        const settings = await settingsRes.json();
                        const isFirstLaunch = settings.isFirstLaunch;
                        
                        const welcomeScreen = document.getElementById('welcomeScreen');
                        const closeOobeBtn = document.getElementById('closeOobeBtn');

                        if (isFirstLaunch && welcomeScreen) {
                            welcomeScreen.style.display = 'flex';
                            if (appContainer) appContainer.style.opacity = '0.15';
                            if (playbackBar) playbackBar.style.opacity = '0.15';

                            closeOobeBtn.addEventListener('click', async () => {
                                welcomeScreen.classList.add('fade-out');
                                
                                try {
                                    await fetch(`http://127.0.0.1:${apiPort}/api/settings`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ isFirstLaunch: false })
                                    });
                                } catch (err) {
                                    console.error('Error saving settings:', err);
                                }

                                setTimeout(() => {
                                    welcomeScreen.style.display = 'none';
                                    if (appContainer) appContainer.style.opacity = '1';
                                    if (playbackBar) playbackBar.style.opacity = '1';
                                }, 800);
                            });
                        } else {
                            if (appContainer) appContainer.style.opacity = '1';
                            if (playbackBar) playbackBar.style.opacity = '1';
                        }
                    } catch (err) {
                        console.error('Settings fetch error:', err);
                        if (appContainer) appContainer.style.opacity = '1';
                        if (playbackBar) playbackBar.style.opacity = '1';
                    }
                }, 600);
            }
        }, 1200);

        console.log('✅ KORAI Player initialized');
        
    } catch (err) {
        console.error('Init error:', err);
        showNotification('Initialization failed', 'error');
    }
});

if (window.electronAPI) {
    window.electronAPI.onTrayOpenMiniPlayer((track, playing) => {
        toggleMiniPlayer();
    });
    
    window.electronAPI.onTrayCinematicMode(() => {
        toggleFullscreen();
    });
    
    window.electronAPI.onTrayChangeLanguage((lang) => {
        if (lang !== currentLanguage) {
            changeClientLanguage(lang);
        }
    });
    
    window.electronAPI.onTrayTogglePlayback(() => {
        togglePlay();
    });
    
    window.electronAPI.onTrayNextTrack(() => {
        nextTrack();
    });
    
    window.electronAPI.onTrayPreviousTrack(() => {
        prevTrack();
    });
}

setTimeout(() => {
    syncTrayPlaybackState();
}, 1000);