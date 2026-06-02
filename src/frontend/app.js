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
let shuffleHistory = [];  
let shuffleSessionActive = false;
let remainingUnplayedTracks = [];
let lastPlaySource = {
    type: 'library', // 'library', 'playlist', 'favorites', 'artists', 'file'
    sourceId: null,  // playlistId, artistName, etc.
    sourceTracks: null
};


// Filtering & Sorting Library states
let librarySortKey = 'createdAt'; // 'createdAt', 'title', 'artist', 'bpm', 'duration'
let librarySortOrder = 'desc';    // 'asc', 'desc'
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

// Performance mode detection
function detectPerformanceMode() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isLowMemory = navigator.deviceMemory && navigator.deviceMemory < 4;
    const isSlowCPU = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    
    if (isMobile || isLowMemory || isSlowCPU) {
        document.body.classList.add('performance-mode');
        console.log('⚡ Performance mode enabled for this device');
        return true;
    }
    return false;
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

/**
 * Set the current playing source and build queue accordingly
 */
function setPlaySource(sourceType, sourceId = null, sourceTracksArray = null) {
    lastPlaySource = {
        type: sourceType,
        sourceId: sourceId,
        sourceTracks: sourceTracksArray ? [...sourceTracksArray] : null
    };
    
    // Build queue based on source
    if (sourceType === 'library') {
        queue = [...tracks];
    } else if (sourceType === 'playlist' && sourceTracksArray) {
        queue = [...sourceTracksArray];
    } else if (sourceType === 'favorites' && sourceTracksArray) {
        queue = [...sourceTracksArray];
    } else if (sourceType === 'artists' && sourceTracksArray) {
        queue = [...sourceTracksArray];
    } else if (sourceType === 'file') {
        queue = [...tracks];
    } else {
        queue = [...tracks];
    }
    
    renderQueue();
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
 * Shuffles the queue, keeping currently playing track at index 0.
 * Backs up the original queue to allow proper restoration when shuffle is disabled.
 */
function initShuffleSession() {
    if (!shuffleMode) return;
    
    console.log('🔄 Initializing shuffle session...');
    
    // Backup original queue if we haven't already
    if (!shuffleSessionActive || originalQueueBackup.length === 0) {
        originalQueueBackup = queue.length > 0 ? [...queue] : [...tracks];
    }
    
    // Create new queue to be shuffled
    let baseTracks = queue.length > 0 ? [...queue] : [...tracks];
    if (baseTracks.length === 0) return;
    
    let shuffled = [...baseTracks];
    const playingTrack = currentTrackId ? shuffled.find(t => t.id === currentTrackId) : null;
    
    // Extract currently playing track to keep it at top
    if (playingTrack) {
        shuffled = shuffled.filter(t => t.id !== currentTrackId);
    }
    
    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Set queue
    if (playingTrack) {
        queue = [playingTrack, ...shuffled];
        queueIndex = 0;
    } else {
        queue = shuffled;
        queueIndex = 0;
    }
    
    shuffleHistory = currentTrackId ? [currentTrackId] : [];
    remainingUnplayedTracks = queue.filter(t => t.id !== currentTrackId).map(t => t.id);
    shuffleSessionActive = true;
    
    renderQueue();
    console.log(`✅ Shuffle queue generated with ${queue.length} tracks.`);
}

/**
 * End/Deactivate shuffle session
 * Restores original queue backup and finds index of current track.
 */
function resetShuffleSession() {
    if (originalQueueBackup.length > 0) {
        queue = [...originalQueueBackup];
        if (currentTrackId) {
            const originalIdx = queue.findIndex(t => t.id === currentTrackId);
            if (originalIdx !== -1) {
                queueIndex = originalIdx;
            }
        } else {
            queueIndex = 0;
        }
        originalQueueBackup = [];
    }
    shuffleHistory = [];
    remainingUnplayedTracks = [];
    shuffleSessionActive = false;
    renderQueue();
    console.log('🔀 Shuffle disabled. Restored original queue structure.');
}

/**
 * Enhanced nextTrack function with proper shuffle and fallback sequence
 */
async function nextTrackEnhanced() {
    if (isMiniWindowMode) {
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('next');
        }
        return;
    }
    
    if (queue.length === 0 && tracks.length > 0) {
        // Automatically build queue if empty
        queue = [...tracks];
        queueIndex = -1;
    }
    
    if (queue.length > 0) {
        if (repeatMode && currentTrackId) {
            await playTrack(currentTrackId);
        } else if (queueIndex < queue.length - 1) {
            queueIndex++;
            await playTrack(queue[queueIndex].id);
        } else {
            // Loop back to index 0
            queueIndex = 0;
            await playTrack(queue[0].id);
        }
    }
}

/**
 * Enhanced prevTrack function with proper shuffle and fallback sequence
 */
async function prevTrackEnhanced() {
    if (isMiniWindowMode) {
        if (window.electronAPI && typeof window.electronAPI.controlFromMini === 'function') {
            window.electronAPI.controlFromMini('prev');
        }
        return;
    }
    
    if (queue.length === 0 && tracks.length > 0) {
        queue = [...tracks];
        queueIndex = 0;
    }
    
    if (queue.length > 0) {
        if (queueIndex > 0) {
            queueIndex--;
            await playTrack(queue[queueIndex].id);
        } else {
            // Loop back to the end of queue
            queueIndex = queue.length - 1;
            await playTrack(queue[queueIndex].id);
        }
    }
}

// Override global actions
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
        initShuffleSession();
        showNotification(currentLanguage === 'fa' ? 'پخش تصادفی فعال شد (ترتیب صف تغییر یافت)' : 'Shuffle enabled (Queue randomized)', 'success');
    } else {
        resetShuffleSession();
        showNotification(currentLanguage === 'fa' ? 'پخش تصادفی غیرفعال شد (ترتیب اصلی بازنشانی شد)' : 'Shuffle disabled (Original order restored)', 'info');
    }
}

window.toggleShuffle = toggleShuffleEnhanced;

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
                <div class="form-group">
                    <label>Title</label>
                    <input type="text" id="tagTitle" placeholder="Track title">
                </div>
                
                <div class="form-group">
                    <label>Artist</label>
                    <input type="text" id="tagArtist" placeholder="Artist name">
                </div>
                
                <div class="form-group">
                    <label>Album</label>
                    <input type="text" id="tagAlbum" placeholder="Album name">
                </div>
                
                <div class="form-group-row">
                    <div class="form-group" style="flex: 1;">
                        <label>Genre</label>
                        <input type="text" id="tagGenre" placeholder="Genre">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>Year</label>
                        <input type="number" id="tagYear" placeholder="YYYY">
                    </div>
                    <div class="form-group" style="flex: 0.5;">
                        <label>Track #</label>
                        <input type="number" id="tagTrackNumber" placeholder="#">
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Composer</label>
                    <input type="text" id="tagComposer" placeholder="Composer">
                </div>
                
                <div class="form-group">
                    <label>Lyrics</label>
                    <textarea id="tagLyrics" rows="4" placeholder="Song lyrics..."></textarea>
                </div>
            </div>
            
            <div class="modal-buttons-footer">
                <button class="modal-btn cancel" onclick="closeTagEditor()">Cancel</button>
                <button class="modal-btn confirm" id="saveTagBtn" style="background: var(--accent-cyan); color: #000;">Save Changes</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('saveTagBtn').addEventListener('click', async () => {
        await saveTagChanges();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTagEditor();
    });
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
// ADVANCED SEARCH FUNCTIONS
// =============================================================================

function openAdvancedSearch() {
    const modal = document.getElementById('advancedSearchModal');
    if (!modal) createAdvancedSearchModal();
    
    const newModal = document.getElementById('advancedSearchModal');
    if (newModal) newModal.style.display = 'flex';
    
    const searchInput = document.getElementById('advSearchInput');
    if (searchInput) {
        searchInput.focus();
        searchInput.value = '';
    }
    
    const resultsContainer = document.getElementById('advSearchResults');
    if (resultsContainer) resultsContainer.innerHTML = '';
}

function createAdvancedSearchModal() {
    const existing = document.getElementById('advancedSearchModal');
    if (existing) return;
    
    const modal = document.createElement('div');
    modal.id = 'advancedSearchModal';
    modal.className = 'custom-modal-overlay';
    modal.style.display = 'none';
    
    modal.innerHTML = `
        <div class="custom-modal-card" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <div class="modal-indicator-header">
                <i class="fa-solid fa-magnifying-glass" style="color: var(--accent-cyan);"></i>
                <h4>Advanced Search</h4>
                <button class="close-modal-btn" onclick="closeAdvancedSearch()" style="margin-right: auto; background: none; border: none; color: var(--spotify-text-muted); cursor: pointer;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            
            <div class="adv-search-info">
                <p style="font-size: 0.7rem; color: var(--spotify-text-muted); margin-bottom: 12px;">
                    <i class="fa-regular fa-lightbulb"></i> Examples: 
                    <code>bpm>120</code> <code>genre:rock</code> <code>energy>0.7</code> 
                    <code>year:2020-2024</code> <code>artist:behdad</code>
                </p>
            </div>
            
            <div class="form-group">
                <input type="text" id="advSearchInput" placeholder="Enter search query..." style="width: 100%; padding: 12px;">
            </div>
            
            <div class="modal-buttons-footer" style="margin-top: 12px;">
                <button class="modal-btn cancel" onclick="closeAdvancedSearch()">Cancel</button>
                <button class="modal-btn confirm" id="executeAdvSearchBtn" style="background: var(--accent-cyan); color: #000;">Search</button>
            </div>
            
            <div id="advSearchResults" style="margin-top: 20px;"></div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById('executeAdvSearchBtn').addEventListener('click', async () => {
        const query = document.getElementById('advSearchInput').value;
        if (!query.trim()) return;
        
        await executeAdvancedSearch(query);
    });
    
    document.getElementById('advSearchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('executeAdvSearchBtn').click();
        }
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAdvancedSearch();
    });
}

function closeAdvancedSearch() {
    const modal = document.getElementById('advancedSearchModal');
    if (modal) modal.style.display = 'none';
}

async function executeAdvancedSearch(query) {
    showNotification('Searching...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/search/advanced`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        const resultsContainer = document.getElementById('advSearchResults');
        if (!resultsContainer) return;
        
        if (data.results.length === 0) {
            resultsContainer.innerHTML = `<p class="no-results" style="text-align: center; color: var(--spotify-text-muted);">No results found for "${query}"</p>`;
            return;
        }
        
        let resultsHtml = `<h4 style="margin-bottom: 12px;">Found ${data.results.length} tracks</h4><div class="adv-search-results-list">`;
        
        data.results.forEach(track => {
            const coverUrl = track.coverUrl ? `http://127.0.0.1:${apiPort}${track.coverUrl}` : null;
            resultsHtml += `
                <div class="adv-search-result-item" onclick="playTrack(${track.id})">
                    <div class="adv-result-cover">
                        ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    </div>
                    <div class="adv-result-info">
                        <div class="adv-result-title">${escapeHtml(track.title || 'Untitled')}</div>
                        <div class="adv-result-artist">${escapeHtml(track.artist || 'Unknown Artist')}</div>
                        <div class="adv-result-meta">
                            <span><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span>
                            <span><i class="fa-solid fa-bolt"></i> ${Math.round((track.energy || 0.5) * 100)}%</span>
                            <span><i class="fa-regular fa-clock"></i> ${formatTime(track.duration)}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        
        resultsHtml += `</div>`;
        resultsContainer.innerHTML = resultsHtml;
        
        showNotification(`Found ${data.results.length} results`, 'success');
        
    } catch (err) {
        console.error('Search error:', err);
        showNotification('Search failed', 'error');
    }
}

// =============================================================================
// CUE SHEET FUNCTIONS
// =============================================================================

function importCueSheet() {
    if (!window.electronAPI || typeof window.electronAPI.selectAudioFiles !== 'function') {
        showNotification('Cannot select CUE file', 'error');
        return;
    }
    
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
                
                const playlistName = path.basename(file.path, '.cue');
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

// =============================================================================
// LIBRARY EXPORT FUNCTION
// =============================================================================

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
        
        showNotification(`Library exported to: ${path.basename(data.path)}`, 'success');
    } catch (err) {
        console.error('Export error:', err);
        showNotification('Export failed', 'error');
    }
}

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

// Show playlist context menu on right-click
// Show playlist context menu on right-click
function showPlaylistContextMenu(trackId, x, y) {
    if (isMiniWindowMode) return;
    const menu = document.getElementById('playlistContextMenu');
    const container = document.getElementById('contextPlaylistItems');
    if (!menu || !container) return;
    
    // Store the current track ID for edit action
    menu.setAttribute('data-current-track-id', trackId);
    
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
    
    // Add separator and Edit Tags option
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
    
    const closeMenu = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 50);
}

// New function to open tag editor from context menu
function openTagEditorFromContext(trackId) {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    currentTrack = track;
    currentTrackId = track.id;
    openTagEditor(trackId);
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
        if (repeatOneMode && currentTrackId) {
            audioElement.currentTime = 0;
            audioElement.play().catch(e => console.error(e));
        } else if (repeatMode) {
            nextTrack();
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

/**
 * FIXED: Play track by ID with correct queue behavior
 */
async function playTrack(trackId, sourceType = 'library', sourceId = null, sourceTracksArray = null) {
        if (!tracks || tracks.length === 0) {
            showNotification(t('emptyLibrary'), 'warning');
            console.warn('Cannot play - library is empty');
            return;
        }
    if (isMiniWindowMode) return;
    
    try {
        console.log('🎵 Playing track:', trackId, 'Source:', sourceType);
        
        currentTrackId = trackId;
        currentTrack = tracks.find(t => t.id === trackId);
        
        if (!currentTrack) {
            showNotification('Track not found', 'error');
            return;
        }
        
        // Set the play source and build queue
        if (sourceTracksArray) {
            setPlaySource(sourceType, sourceId, sourceTracksArray);
        } else {
            // Auto-detect source if not provided
            if (sourceType === 'playlist' && sourceId) {
                const playlist = playlists.find(p => p.id === sourceId);
                if (playlist) {
                    const plTracks = tracks.filter(t => playlist.tracks.includes(t.id));
                    setPlaySource('playlist', sourceId, plTracks);
                } else {
                    setPlaySource('library');
                }
            } else if (sourceType === 'favorites') {
                const favTracks = tracks.filter(t => t.isLiked);
                setPlaySource('favorites', null, favTracks);
            } else if (sourceType === 'artists' && sourceId) {
                const artistTracks = tracks.filter(t => (t.artist || 'Unknown Artist') === sourceId);
                setPlaySource('artists', sourceId, artistTracks);
            } else {
                setPlaySource('library');
            }
        }
        
        // Find the index of current track in queue
        queueIndex = queue.findIndex(t => t.id === trackId);
        if (queueIndex === -1) {
            // Fallback: add to front of queue
            queue.unshift(currentTrack);
            queueIndex = 0;
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
        
        // Track play statistics
        fetch(`http://127.0.0.1:${apiPort}/api/tracks/${trackId}/play`, { method: 'POST' }).catch(e => console.error(e));
        
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

function applyGlobalSkin(skinName) {
    if (skinName !== 'default' && skinName !== 'liquid-glass') {
        skinName = 'default';
    }
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
            sleepIntervalId = null;
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

// Render library with precise filtering, sorting UI and options
function renderLibrary(filteredTracks = null) {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    let listToRender = filteredTracks !== null ? filteredTracks : [...tracks];
    
    // Extract unique existing genres for custom dynamic genre filters
    const existingGenres = [...new Set(tracks.map(t => t.genre).filter(Boolean))];

    // Filter list if genre is selected
    if (libraryGenreFilter !== 'all') {
        listToRender = listToRender.filter(t => t.genre === libraryGenreFilter);
    }

    // Sort list according to key and order
    listToRender.sort((a, b) => {
        let valA = a[librarySortKey];
        let valB = b[librarySortKey];

        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';

        if (typeof valA === 'string') {
            return librarySortOrder === 'asc' 
                ? valA.localeCompare(valB, undefined, { sensitivity: 'base' })
                : valB.localeCompare(valA, undefined, { sensitivity: 'base' });
        } else {
            return librarySortOrder === 'asc' ? valA - valB : valB - valA;
        }
    });
    
    if (tracks.length === 0) {
        mainSection.innerHTML = `
            <div class="empty-illustration-state">
                <i class="fa-solid fa-compact-disc"></i>
                <h3>${t('emptyLibrary')}</h3>
                <p>${t('emptyLibraryDesc')}</p>
            </div>
        `;
        return;
    }

    // Create the Sort & Filter Controller bar HTML
    let genreFilterChipsHtml = `
        <button class="filter-chip ${libraryGenreFilter === 'all' ? 'active' : ''}" onclick="setLibraryGenreFilter('all')">
            ${t('allGenres')}
        </button>
    `;
    
    existingGenres.forEach(genre => {
        genreFilterChipsHtml += `
            <button class="filter-chip ${libraryGenreFilter === genre ? 'active' : ''}" onclick="setLibraryGenreFilter('${genre}')">
                ${getGenreTranslation(genre) || genre}
            </button>
        `;
    });

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

        <div class="genre-filter-wrapper-bar">
            ${genreFilterChipsHtml}
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

// Controller function hooks for live filters & sorting
window.setLibraryGenreFilter = function(genre) {
    libraryGenreFilter = genre;
    renderLibrary();
};

window.changeLibrarySorting = function(key) {
    librarySortKey = key;
    renderLibrary();
};

window.toggleLibrarySortOrder = function() {
    librarySortOrder = librarySortOrder === 'asc' ? 'desc' : 'asc';
    renderLibrary();
};

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

/**
 * Get correct welcome message based on actual hour
 */
function getWelcomeMessage() {
    const now = new Date();
    const hour = now.getHours();
    
    if (hour >= 5 && hour < 12) {
        return t('welcomeMorning');
    } else if (hour >= 12 && hour < 17) {
        return t('welcomeAfternoon');
    } else if (hour >= 17 && hour < 22) {
        return t('welcomeEvening');
    } else {
        return t('welcomeEvening');
    }
}

/**
 * Get top played tracks for shortcuts section
 */
function getTopPlayedTracks(limit = 6) {
    return [...tracks]
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, limit);
}

/**
 * Get daily suggestions based on:
 * - Recently added tracks (last 30 days)
 * - Mixed with high energy variety
 * - Tracks that haven't been played much
 */
function getDailySuggestions(limit = 8) {
    if (tracks.length === 0) return [];
    
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    // Recently added tracks
    const recentlyAdded = tracks.filter(t => (t.createdAt || 0) > oneMonthAgo);
    
    // Low play count tracks (discovery)
    const undiscovered = tracks.filter(t => (t.playCount || 0) < 3);
    
    // High energy tracks for variety
    const highEnergy = tracks.filter(t => (t.energy || 0.5) > 0.7);
    
    // Combine and deduplicate
    const combined = [...recentlyAdded, ...undiscovered, ...highEnergy];
    const unique = [];
    const seenIds = new Set();
    
    for (const track of combined) {
        if (!seenIds.has(track.id)) {
            seenIds.add(track.id);
            unique.push(track);
        }
    }
    
    // Shuffle slightly for variety
    for (let i = unique.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unique[i], unique[j]] = [unique[j], unique[i]];
    }
    
    return unique.slice(0, limit);
}


/**
 * FIXED: Render home dashboard with proper content
 */
function renderHomeDashboard() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    const welcomeText = getWelcomeMessage();
    const topTracks = getTopPlayedTracks(6);
    const suggestions = getDailySuggestions(8);
    
    if (tracks.length === 0) {
        mainSection.innerHTML = `
            <div class="empty-illustration-state">
                <i class="fa-solid fa-compact-disc"></i>
                <h3>${t('emptyLibrary')}</h3>
                <p>${t('emptyLibraryDesc')}</p>
            </div>
        `;
        return;
    }
    
    // Shortcuts - Top played tracks
    let shortcutsHtml = '';
    topTracks.forEach(track => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        shortcutsHtml += `
            <div class="shortcut-pill-card" onclick="playTrack(${track.id}, 'library')">
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
    
    // Daily suggestions
    let suggestionsHtml = '';
    suggestions.forEach(track => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        const isActive = currentTrackId === track.id;
        suggestionsHtml += `
            <div class="spotify-music-card ${isActive ? 'active' : ''}" data-track-id="${track.id}">
                <div class="card-image-box" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                    ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    <div class="hover-play-bubble">
                        <i class="fa-solid ${isActive && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                    </div>
                </div>
                <div class="card-details-info" onclick="playTrack(${track.id}, 'library')">
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
        <div class="home-welcome-section">
            <h2 class="section-welcome-title">${welcomeText}</h2>
            <div class="top-shortcuts-grid">
                ${shortcutsHtml || `<p class="no-tracks-info">${t('emptyLibraryDesc')}</p>`}
            </div>
        </div>
        
        <div class="spotify-row-title">
            <h3><i class="fa-solid fa-calendar-day"></i> ${t('dailySuggestions')}</h3>
            <span class="view-all-link" onclick="switchSection('library')">${currentLanguage === 'fa' ? 'مشاهده همه' : 'View All'}</span>
        </div>
        <div class="cards-responsive-grid">
            ${suggestionsHtml || `<p class="no-tracks-info">${t('emptyLibraryDesc')}</p>`}
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

// Enhanced AI recommendation handler with detailed analysis
async function handleAiRecommendationsEnhanced() {
    if (!currentTrackId) {
        showNotification('Play a track first', 'warning');
        return;
    }
    
    showNotification('AI analyzing your taste...', 'info');
    
    try {
        // Record this play for learning
        if (window.electronAPI) {
            fetch(`http://127.0.0.1:${apiPort}/api/ai/interaction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackId: currentTrackId, action: 'play' })
            }).catch(e => console.log);
        }
        
        // Get personalized recommendations
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/ai/recommend/personal/${currentTrackId}`);
        if (!res.ok) throw new Error();
        
        const data = await res.json();
        
        if (!data.recommendations || data.recommendations.length === 0) {
            showNotification('No AI recommendations yet. Listen to more music!', 'info');
            return;
        }
        
        renderRecommendationsUI(data);
        
    } catch (err) {
        console.error('AI error:', err);
        showNotification('AI recommendation failed', 'error');
    }
}

function renderRecommendationsUI(data) {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    let recsHtml = '';
    for (const track of data.recommendations) {
        const coverUrl = track.coverUrl ? `http://127.0.0.1:${apiPort}${track.coverUrl}` : null;
        
        recsHtml += `
            <div class="spotify-music-card" data-track-id="${track.id}" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                <div class="card-image-box">
                    ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    <div class="hover-play-bubble">
                        <i class="fa-solid fa-play"></i>
                    </div>
                </div>
                <div class="card-details-info">
                    <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                    <p>${escapeHtml(track.artist || 'Unknown')}</p>
                </div>
                <div class="card-additional-meta">
                    <span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span>
                    <span class="similarity-badge" style="color: var(--accent-cyan);">${track.similarity || '?'}% match</span>
                </div>
                <div class="recommend-reason">
                    <small><i class="fa-solid ${track.similarityIcon || 'fa-brain'}"></i> ${track.reason || 'AI recommended'}</small>
                </div>
            </div>
        `;
    }
    
    mainSection.innerHTML = `
        <div class="spotify-row-title">
            <h3><i class="fa-solid fa-brain" style="color: var(--accent-cyan);"></i> AI Recommendations · Based on your taste</h3>
            <button class="discover-btn" onclick="getDiscoveryRecommendations()" style="background: transparent; border: 1px solid var(--accent-cyan); border-radius: 20px; padding: 6px 16px; color: var(--accent-cyan); cursor: pointer;">
                <i class="fa-solid fa-compass"></i> Discover New
            </button>
        </div>
        <div class="cards-responsive-grid" id="recommendationsGrid">
            ${recsHtml}
        </div>
    `;
}

async function getDiscoveryRecommendations() {
    showNotification('Finding new music for you...', 'info');
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/ai/discover`);
        if (!res.ok) throw new Error();
        
        const data = await res.json();
        
        if (!data.recommendations || data.recommendations.length === 0) {
            showNotification('No new discoveries found', 'info');
            return;
        }
        
        const mainSection = document.getElementById('dynamicSectionContainer');
        if (!mainSection) return;
        
        let discHtml = '';
        for (const track of data.recommendations) {
            const coverUrl = track.coverUrl ? `http://127.0.0.1:${apiPort}${track.coverUrl}` : null;
            
            discHtml += `
                <div class="spotify-music-card" data-track-id="${track.id}" onclick="playTrack(${track.id})">
                    <div class="card-image-box">
                        ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                        <div class="hover-play-bubble">
                            <i class="fa-solid fa-play"></i>
                        </div>
                    </div>
                    <div class="card-details-info">
                        <h4>${escapeHtml(track.title || 'Untitled')}</h4>
                        <p>${escapeHtml(track.artist || 'Unknown')}</p>
                    </div>
                    <div class="card-additional-meta">
                        <span class="bpm-indicator"><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span>
                        <span class="genre-badge" style="color: var(--spotify-text-muted);">${track.genre || 'Various'}</span>
                    </div>
                    <div class="recommend-reason">
                        <small><i class="fa-solid fa-sparkles"></i> New discovery for you</small>
                    </div>
                </div>
            `;
        }
        
        mainSection.innerHTML = `
            <div class="spotify-row-title">
                <h3><i class="fa-solid fa-compass"></i> Discover New Music</h3>
                <span class="view-all-link" onclick="handleAiRecommendationsEnhanced()">← Back to AI Recs</span>
            </div>
            <div class="cards-responsive-grid">${discHtml}</div>
        `;
        
    } catch (err) {
        showNotification('Discovery failed', 'error');
    }
}
// Record when user likes a track for AI learning
async function toggleLikeWithAI() {
    if (!currentTrackId) return;
    const isCurrentlyLiked = currentTrack.isLiked;
    const method = isCurrentlyLiked ? 'DELETE' : 'POST';
    
    try {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${currentTrackId}/like`, { method });
        if (!res.ok) throw new Error();
        
        // Record interaction for AI
        const action = isCurrentlyLiked ? 'unlike' : 'like';
        fetch(`http://127.0.0.1:${apiPort}/api/ai/interaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId: currentTrackId, action })
        }).catch(e => console.log);
        
        const track = tracks.find(t => t.id === currentTrackId);
        if (track) track.isLiked = !isCurrentlyLiked;
        if (currentTrack) currentTrack.isLiked = !isCurrentlyLiked;
        
        updatePlayerUI();
        showNotification(isCurrentlyLiked ? 'Removed from favorites' : 'Added to favorites', 'success');
        
    } catch {
        showNotification('Connection failed', 'error');
    }
}

// Override the like button
window.toggleLike = toggleLikeWithAI;


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
    updateAITooltips();
}

function updateBodyClasses() {
    const dirClass = currentLanguage === 'fa' ? 'rtl' : 'ltr';
    const skinClass = `theme-${currentSkin}`;
    const miniClass = isMiniWindowMode ? 'mini-window-active' : '';
    document.body.className = `${skinClass} ${dirClass} ${miniClass}`;
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
    }
    
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
        shuffleBtn.addEventListener('click', toggleShuffleEnhanced);
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
        fsShuffleBtn.addEventListener('click', toggleShuffleEnhanced);
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

    // Tag editor listener from main process
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

    // Crossfade change listener
    if (window.electronAPI && window.electronAPI.onCrossfadeChanged) {
        window.electronAPI.onCrossfadeChanged((duration) => {
            crossfadeDuration = duration;
            console.log('Crossfade changed to:', duration);
        });
    }

    // Global shortcut listener
    if (window.electronAPI && window.electronAPI.onGlobalShortcut) {
        window.electronAPI.onGlobalShortcut((command) => {
            if (command === 'play-pause') togglePlay();
            if (command === 'next') nextTrack();
            if (command === 'prev') prevTrack();
        });
    }
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

        // Load playback settings (gapless, crossfade)
        try {
            const playbackRes = await fetch(`http://127.0.0.1:${apiPort}/api/playback/settings`);
            const playbackSettings = await playbackRes.json();
            gaplessEnabled = playbackSettings.gaplessEnabled !== false;
            crossfadeDuration = playbackSettings.crossfadeDuration || 0;
            console.log('✅ Playback settings loaded:', { gaplessEnabled, crossfadeDuration });
        } catch (err) {
            console.log('Could not load playback settings, using defaults');
        }

        setupEventListeners();
        setVolume(0.7);
        initAudio();
        
        changeClientLanguage(currentLanguage);
        updateBodyClasses();
        
        switchSection('home');
        detectPerformanceMode();

        setAIIconOnlyMode();
        updateAITooltips();
        initVersionStatus();

        // File association handler - opens files from system
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
                                await loadPlaylists();
                                
                                if (result.imported > 0 && tracks.length > 0) {
                                    const newTracks = tracks.slice(-result.imported);
                                    const lastTrack = newTracks[0];
                                    
                                    if (lastTrack) {
                                        console.log('🎵 Auto-playing imported track:', lastTrack.title);
                                        setTimeout(() => {
                                            playTrack(lastTrack.id, 'file');
                                        }, 300);
                                    }
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

        // Tag editor listener from main process
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

        // Crossfade change listener
        if (window.electronAPI && window.electronAPI.onCrossfadeChanged) {
            window.electronAPI.onCrossfadeChanged((duration) => {
                crossfadeDuration = duration;
                console.log('Crossfade changed to:', duration);
                const crossfadeVal = document.getElementById('crossfadeVal');
                if (crossfadeVal) crossfadeVal.innerText = `${duration}s`;
            });
        }

        // Global shortcut listener
        if (window.electronAPI && window.electronAPI.onGlobalShortcut) {
            window.electronAPI.onGlobalShortcut((command) => {
                if (command === 'play-pause') togglePlay();
                if (command === 'next') nextTrack();
                if (command === 'prev') prevTrack();
            });
        }

        // Splash screen and OOBE (First Launch)
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

        // Initialize gapless/crossfade UI elements
        const gaplessToggle = document.getElementById('gaplessToggle');
        if (gaplessToggle) {
            gaplessToggle.checked = gaplessEnabled;
            gaplessToggle.addEventListener('change', (e) => {
                setGaplessMode(e.target.checked);
            });
        }
        
        const crossfadeSlider = document.getElementById('crossfadeSlider');
        if (crossfadeSlider) {
            crossfadeSlider.value = crossfadeDuration;
            crossfadeSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                const crossfadeVal = document.getElementById('crossfadeVal');
                if (crossfadeVal) crossfadeVal.innerText = `${val}s`;
                setCrossfadeMode(val);
            });
        }
        
        // Export library button
        const exportLibraryBtn = document.getElementById('exportLibraryBtn');
        if (exportLibraryBtn) {
            exportLibraryBtn.addEventListener('click', exportLibraryToCSV);
        }
        
        // Import CUE button
        const importCueBtn = document.getElementById('importCueBtn');
        if (importCueBtn) {
            importCueBtn.addEventListener('click', importCueSheet);
        }
        
        // Advanced search button
        const advSearchBtn = document.getElementById('navAdvancedSearch');
        if (advSearchBtn) {
            advSearchBtn.addEventListener('click', openAdvancedSearch);
        }

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

// =============================================================================
// ARTISTS SECTION - FEATURE
// =============================================================================

/**
 * Renders the artists view, grouping tracks by artist
 */
function renderArtists() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    if (tracks.length === 0) {
        mainSection.innerHTML = `
            <div class="empty-illustration-state">
                <i class="fa-solid fa-microphone"></i>
                <h3>${t('emptyArtistsState') || 'No Artists Found'}</h3>
                <p>${t('emptyArtistsDesc') || 'Add some music tracks to see your artists.'}</p>
            </div>
        `;
        return;
    }
    
    // Group tracks by artist
    const artistsMap = new Map();
    
    tracks.forEach(track => {
        const artistName = track.artist || 'Unknown Artist';
        if (!artistsMap.has(artistName)) {
            artistsMap.set(artistName, {
                name: artistName,
                tracks: [],
                coverImage: track.coverImage || null,
                hasCover: track.hasCover || false,
                coverUrl: track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null
            });
        }
        artistsMap.get(artistName).tracks.push(track);
        
        // Use first track's cover as artist cover if available
        const artistData = artistsMap.get(artistName);
        if (!artistData.coverImage && track.coverImage && track.coverImage.length > 0) {
            artistData.coverImage = track.coverImage;
            artistData.hasCover = track.hasCover;
            artistData.coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        }
    });
    
    const artists = Array.from(artistsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    
    let artistsHtml = '';
    artists.forEach(artist => {
        const trackCount = artist.tracks.length;
        const coverHtml = artist.coverUrl 
            ? `<img src="${artist.coverUrl}" alt="${escapeHtml(artist.name)}">` 
            : `<i class="fa-solid fa-microphone-alt"></i>`;
        
        artistsHtml += `
            <div class="artist-card" onclick="showArtistDetail('${escapeHtml(artist.name)}')">
                <div class="artist-avatar">
                    ${coverHtml}
                </div>
                <div class="artist-name truncate-text">${escapeHtml(artist.name)}</div>
                <div class="artist-tracks-count">${trackCount} ${t('tracksCount') || 'tracks'}</div>
            </div>
        `;
    });
    
    mainSection.innerHTML = `
        <div class="spotify-row-title">
            <h3><i class="fa-solid fa-microphone"></i> ${t('artistsTitle') || 'Artists'} (${artists.length})</h3>
        </div>
        <div class="artists-grid" id="artistsGrid">
            ${artistsHtml}
        </div>
    `;
}

/**
 * Shows detailed view for a specific artist with all their tracks
 */
function showArtistDetail(artistName) {
    const artistTracks = tracks.filter(track => (track.artist || 'Unknown Artist') === artistName);
    if (artistTracks.length === 0) return;
    
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;
    
    let artistCover = null;
    for (const track of artistTracks) {
        if (track.hasCover && track.coverImage) {
            artistCover = `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover`;
            break;
        }
    }
    
    const coverHtml = artistCover 
        ? `<img src="${artistCover}" alt="${escapeHtml(artistName)}">` 
        : `<i class="fa-solid fa-microphone-alt"></i>`;
    
    let tracksTableHtml = '';
    artistTracks.forEach((track, index) => {
        const coverUrl = track.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${track.id}/cover` : null;
        const isActive = currentTrackId === track.id;
        const indexText = isActive && isPlaying ? '<i class="fa-solid fa-pause"></i>' : index + 1;
        
        tracksTableHtml += `
            <tr class="track-row ${isActive ? 'active' : ''}" data-track-id="${track.id}" onclick="playTrack(${track.id})" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                <td class="track-play-cell">${indexText}</td>
                <td class="track-info-cell">
                    <div class="table-song-cover">
                        ${coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<i class="fa-solid fa-music"></i>'}
                    </div>
                    <div class="table-song-meta">
                        <span class="table-song-title">${escapeHtml(track.title || 'Untitled')}</span>
                    </div>
                </td>
                <td class="track-album-cell">${escapeHtml(track.album || '—')}</td>
                <td class="track-bpm-cell">${track.bpm || '120'}</td>
                <td class="track-time-cell">${formatTime(track.duration)}</td>
                <td class="track-actions-cell">
                    <button class="table-action-btn like" onclick="event.stopPropagation(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    mainSection.innerHTML = `
        <div class="artist-detail-view">
            <button class="back-to-artists-btn" onclick="renderArtists()">
                <i class="fa-solid fa-arrow-right"></i> ${t('backToArtists') || 'Back to Artists'}
            </button>
            <div class="artist-header">
                <div class="artist-header-avatar">
                    ${coverHtml}
                </div>
                <div class="artist-header-info">
                    <h2>${escapeHtml(artistName)}</h2>
                    <p>${artistTracks.length} ${t('tracksCount') || 'tracks'}</p>
                    <button class="play-artist-btn" onclick="playArtist('${escapeHtml(artistName)}')">
                        <i class="fa-solid fa-play"></i> ${t('playArtist') || 'Play All'}
                    </button>
                </div>
            </div>
            <div class="library-table-wrapper">
                <table class="library-tracks-table">
                    <thead>
                        <tr>
                            <th style="width: 50px;">#</th>
                            <th>${t('trackTitle') || 'Title'}</th>
                            <th>${t('albumTitle') || 'Album'}</th>
                            <th style="width: 80px;">BPM</th>
                            <th style="width: 80px;"><i class="fa-regular fa-clock"></i></th>
                            <th style="width: 100px;">${t('actions') || 'Actions'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tracksTableHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Plays all tracks of an artist
 */
function playArtist(artistName) {
    const artistTracks = tracks.filter(track => (track.artist || 'Unknown Artist') === artistName);
    if (artistTracks.length === 0) return;
    
    queue = [...artistTracks];
    queueIndex = 0;
    playTrack(queue[0].id);
    renderQueue();
    showNotification(`${t('playingArtist') || 'Playing'} ${artistName} (${artistTracks.length} ${t('tracks') || 'tracks'})`, 'success');
}

// Update switchSection function to include artists
window.switchSection = function(sectionName) {
    if (isMiniWindowMode) return;
    currentActiveSection = sectionName;
    currentActivePlaylistId = null;
    
    document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-playlist-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const navHome = document.getElementById('navHome');
    const navLibrary = document.getElementById('navLibrary');
    const navArtists = document.getElementById('navArtists');
    const navFavorites = document.getElementById('navFavorites');
    const navStats = document.getElementById('navStats');
    
    if (sectionName === 'home' && navHome) navHome.classList.add('active');
    if (sectionName === 'library' && navLibrary) navLibrary.classList.add('active');
    if (sectionName === 'artists' && navArtists) navArtists.classList.add('active');
    if (sectionName === 'favorites' && navFavorites) navFavorites.classList.add('active');
    if (sectionName === 'stats' && navStats) navStats.classList.add('active');
    
    if (sectionName === 'home') renderHomeDashboard();
    if (sectionName === 'library') renderLibrary();
    if (sectionName === 'artists') renderArtists();
    if (sectionName === 'favorites') renderFavorites();
    if (sectionName === 'stats') {
        renderStats().then(() => {
            if (audioCtx && analyser) {
                startLiveSpectrumAnalyzer();
            }
        });
    }
};