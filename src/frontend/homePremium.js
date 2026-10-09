
function renderHomePremium() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;

    const tr = (key, fallback) => typeof t === 'function' ? (t(key) || fallback) : fallback;
    const welcomeText = typeof getDynamicWelcomeMessage === 'function' ? getDynamicWelcomeMessage() : (typeof getWelcomeMessage === 'function' ? getWelcomeMessage() : 'Welcome');
    const availableTracks = window.tracks || [];
    const currentTrackId = window.currentTrackId;
    const currentTrackObj = currentTrackId == null
        ? null
        : availableTracks.find(track => Number(track.id) === Number(currentTrackId)) || null;
    const currentCover = currentTrackObj && currentTrackObj.hasCover ? `http://127.0.0.1:${window.apiPort || 3000}/api/tracks/${currentTrackObj.id}/cover` : null;
    const isPlaying = !!window.isPlaying;

    // Statistics
    const totalTracks = (window.tracks || []).length;
    const totalLikes = (window.tracks || []).filter(t => t.isLiked).length;
    const totalDuration = (window.tracks || []).reduce((sum, t) => sum + (t.duration || 0), 0);
    const totalHours = totalDuration >= 3600 ? (totalDuration / 3600).toFixed(1) : '0';
    const uniqueArtists = new Set((window.tracks || []).map(t => (t.artist || '').trim()).filter(Boolean)).size;
    const uniqueAlbums = new Set((window.tracks || []).map(t => (t.album || '').trim()).filter(Boolean)).size;

    const featuredTracks = [...(window.tracks || [])]
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, 8);

    const recentTracks = [...(window.tracks || [])]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 6);

    // AI suggestions
    let suggestions = [];
    if (currentTrackId && (window.tracks || []).length > 0 && typeof getLocalRecommendations === 'function') {
        const sourceTrack = (window.tracks || []).find(t => t.id === currentTrackId);
        if (sourceTrack) suggestions = getLocalRecommendations(sourceTrack, window.tracks || [], 6);
    }
    if (!suggestions || suggestions.length === 0) {
        suggestions = typeof getFallbackSuggestions === 'function' ? getFallbackSuggestions(window.tracks || [], 6) : [];
    }

    // Keep the current track visible when the library is empty.
    if ((window.tracks || []).length === 0 && !currentTrackId) {
        mainSection.innerHTML = getEmptyLibraryHTML ? getEmptyLibraryHTML() : '<div class="empty-state-premium">No tracks</div>';
        return;
    }

    let html = `
        <div class="home-container-premium">
            <div class="hero-cinematic-v2" id="heroSection">
                <div class="hero-ambient-glow"></div>
                <div class="hero-grid-layout">
                    <div class="hero-text-premium">
                        <div class="welcome-ecosystem">
                            <i class="fa-solid fa-wave-square" aria-hidden="true"></i>
                            <span>${getTimeBasedGreeting ? getTimeBasedGreeting() : tr('morningSession', 'Morning session')}</span>
                        </div>
                        <h1 class="hero-main-title">${escapeHtml ? escapeHtml(welcomeText) : welcomeText}</h1>
                        <p class="hero-subtitle-premium">${typeof t === 'function' ? (t('smartRecommendations') || 'Your personal audio universe. Discover, play, and immerse yourself in high-quality sound.') : 'Your personal audio universe.'}</p>
                        <div id="playerConnectionStatus" class="player-connection-status">${typeof t === 'function' ? (t('playerConnectionChecking') || 'Checking player connection...') : 'Checking player connection...'}</div>
                        <div class="hero-cta-group">
                            <button class="hero-cta-primary ripple-effect" id="heroPrimaryBtnPremium" onclick="heroPrimaryAction()">
                                <i class="fa-solid fa-play"></i>
                                <span>${typeof t === 'function' ? (t('playPause') || 'Play') : 'Play'}</span>
                            </button>
                            <button class="hero-cta-secondary" onclick="switchSection('library')">
                                <i class="fa-solid fa-music"></i>
                                <span>${typeof t === 'function' ? (t('navLibText') || 'My Library') : 'My Library'}</span>
                            </button>
                            <button class="hero-cta-secondary" onclick="handleAiRecommendationsEnhanced()">
                                <i class="fa-solid fa-brain"></i>
                                <span>${tr('aiMix', 'AI Mix')}</span>
                            </button>
                        </div>
                    </div>
                    <div class="hero-art-premium">
                        <div class="hero-now-playing-card hero-now-playing-clean">
                                            <div class="hero-art-cover ${isPlaying ? 'playing' : ''} ${currentCover ? '' : 'image-failed'}" id="homeVinylDisc">
                                                ${currentCover ? `<img src="${currentCover}" alt="${typeof escapeHtml === 'function' ? escapeHtml(currentTrackObj?.title || tr('nowPlaying', 'Now playing')) : (currentTrackObj?.title || tr('nowPlaying', 'Now playing'))}" onerror="this.remove(); this.parentElement.classList.add('image-failed')">` : ''}<div class="fallback-icon hero-art-fallback"><i class="fa-solid fa-music"></i></div>
                                <div class="hero-art-status">${isPlaying ? `<span class="status-dot"></span> ${tr('playingArtist', 'Playing')}` : tr('readyToPlay', 'Ready')}</div>
                            </div>
                            <div class="hero-now-playing-meta">
                                <span class="hero-now-playing-eyebrow">${tr('nowPlaying', 'Now playing')}</span>
                                <strong>${typeof escapeHtml === 'function' ? escapeHtml(currentTrackObj?.title || tr('nothingPlaying', 'Nothing playing')) : (currentTrackObj?.title || tr('nothingPlaying', 'Nothing playing'))}</strong>
                                <span>${typeof escapeHtml === 'function' ? escapeHtml(currentTrackObj?.artist || tr('chooseTrack', 'Choose a track from your library')) : (currentTrackObj?.artist || tr('chooseTrack', 'Choose a track from your library'))}</span>
                            </div>
                        </div>
                    </div>
            </div>

            <section class="home-dashboard-section home-stats-section" aria-label="${tr('libraryOverview', 'Library overview')}">
                <div class="home-section-kicker"><span>${tr('libraryOverview', 'Library overview')}</span><span>${totalTracks.toLocaleString()} ${tr('tracksCount', 'tracks')}</span></div>
                <div class="quick-stats-premium home-overview-stats">
                <div class="stat-card-premium" role="button" tabindex="0" onclick="switchSection('library')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-music"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${totalTracks.toLocaleString()}</div>
                        <div class="stat-label">${typeof t === 'function' ? (t('totalTracksLabel') || 'Tracks') : 'Tracks'}</div>
                    </div>
                </div>
                <div class="stat-card-premium" role="button" tabindex="0" onclick="switchSection('favorites')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-heart"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${totalLikes.toLocaleString()}</div>
                        <div class="stat-label">${typeof t === 'function' ? (t('popularLabel') || 'Liked') : 'Liked'}</div>
                    </div>
                </div>
                <div class="stat-card-premium" role="button" tabindex="0" onclick="switchSection('artists')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-microphone-lines"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${uniqueArtists.toLocaleString()}</div>
                        <div class="stat-label">${tr('artistsTitle', 'Artists')}</div>
                    </div>
                </div>
                <div class="stat-card-premium" role="button" tabindex="0" onclick="switchSection('albums')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-compact-disc"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${uniqueAlbums.toLocaleString()}</div>
                        <div class="stat-label">${tr('albumsTitle', 'Albums')}</div>
                    </div>
                </div>
                <div class="stat-card-premium stat-card-time" role="button" tabindex="0" onclick="switchSection('stats')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-clock"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${totalHours}</div>
                        <div class="stat-label">${tr('hoursListened', 'Hours listened')}</div>
                    </div>
                </div>
                </div>
            </section>

            <section class="home-dashboard-section home-actions-section" aria-label="Quick actions">
                <div class="home-section-kicker"><span>${tr('quickAccess', 'Quick access')}</span><span>${tr('playDiscoverOrganize', 'Play • Discover • Organize')}</span></div>
                <div class="home-quick-actions" aria-label="${tr('quickAccess', 'Quick access')}">
                <button class="home-quick-action primary" type="button" onclick="heroPrimaryAction()">
                    <span class="home-action-icon"><i class="fa-solid fa-play"></i></span>
                    <span><strong>${tr('continueListening', 'Continue listening')}</strong><small>${tr('resumeCurrentTrack', 'Resume your current track')}</small></span>
                    <i class="fa-solid fa-arrow-right home-action-arrow"></i>
                </button>
                <button class="home-quick-action" type="button" onclick="playRandomHomeMix()">
                    <span class="home-action-icon"><i class="fa-solid fa-shuffle"></i></span>
                    <span><strong>${tr('shuffleMix', 'Shuffle mix')}</strong><small>${tr('freshLibraryMix', 'A fresh mix from your library')}</small></span>
                    <i class="fa-solid fa-arrow-right home-action-arrow"></i>
                </button>
                <button class="home-quick-action" type="button" onclick="switchSection('favorites')">
                    <span class="home-action-icon"><i class="fa-solid fa-heart"></i></span>
                    <span><strong>${tr('likedTracks', 'Favorites')}</strong><small>${totalLikes ? `${totalLikes.toLocaleString()} ${tr('savedTracks', 'saved tracks')}` : tr('likedTracks', 'Your liked tracks')}</small></span>
                    <i class="fa-solid fa-arrow-right home-action-arrow"></i>
                </button>
                <button class="home-quick-action" type="button" onclick="switchSection('albums')">
                    <span class="home-action-icon"><i class="fa-solid fa-layer-group"></i></span>
                    <span><strong>${tr('browseAlbums', 'Browse albums')}</strong><small>${uniqueAlbums.toLocaleString()} ${tr('albumsInLibrary', 'albums in your library')}</small></span>
                    <i class="fa-solid fa-arrow-right home-action-arrow"></i>
                </button>
                </div>
            </section>

            <div class="mood-section">
                <div class="section-header-modern">
                    <div class="section-title-group">
                        <h3><i class="fa-solid fa-face-smile"></i> ${typeof t === 'function' ? (t('moodTitle') || 'Mood & Energy') : 'Mood & Energy'}</h3>
                        <span class="section-badge-premium">${tr('moodBadge', 'Mood')}</span>
                    </div>
                </div>
                <div class="mood-chips-scroll">
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('energetic')"><i class="fa-solid fa-bolt"></i> <span>${tr('moodEnergetic', 'Energetic')}</span></button>
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('chill')"><i class="fa-solid fa-cloud-moon"></i> <span>${tr('moodChill', 'Chill')}</span></button>
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('focus')"><i class="fa-solid fa-brain"></i> <span>${tr('moodFocus', 'Focus')}</span></button>
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('workout')"><i class="fa-solid fa-dumbbell"></i> <span>${tr('moodWorkout', 'Workout')}</span></button>
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('sad')"><i class="fa-solid fa-face-frown"></i> <span>${tr('moodMelancholic', 'Melancholic')}</span></button>
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('happy')"><i class="fa-solid fa-face-smile"></i> <span>${tr('moodHappy', 'Happy')}</span></button>
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('romantic')"><i class="fa-solid fa-heart"></i> <span>${tr('moodRomantic', 'Romantic')}</span></button>
                    <button type="button" class="mood-chip-premium" onclick="filterByMood('study')"><i class="fa-solid fa-book"></i> <span>${tr('moodStudy', 'Study')}</span></button>
                </div>
            </div>
    `;

    if (featuredTracks.length > 0) {
        html += `
            <div class="featured-section">
                <div class="section-header-modern">
                    <div class="section-title-group">
                        <h3><i class="fa-solid fa-chart-simple"></i> ${typeof t === 'function' ? (t('statsHero') || 'Most Played') : 'Most Played'}</h3>
                        <span class="section-badge-premium">${tr('topEight', 'Top 8')}</span>
                    </div>
                    <span class="view-all-link-modern" onclick="switchSection('library')">${tr('homeViewAll', 'View all')} <i class="fa-solid fa-arrow-right"></i></span>
                </div>
                <div class="featured-grid-premium" id="featuredGrid">
        `;

        featuredTracks.forEach((track, idx) => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${window.apiPort || 3000}/api/tracks/${track.id}/cover` : null;
            html += getFeaturedCardHTML(track, coverUrl, idx);
        });

        html += `</div></div>`;
    }

    if (suggestions.length > 0) {
        html += `
            <div class="ai-recommend-section">
                <div class="section-header-modern">
                    <div class="section-title-group">
                        <h3><i class="fa-solid fa-sparkles"></i> ${typeof t === 'function' ? (t('aiRecommendTitle') || 'AI Recommendations') : 'AI Recommendations'}</h3>
                        <span class="section-badge-premium">${tr('personalized', 'Personalized')}</span>
                    </div>
                    <span class="view-all-link-modern" onclick="handleAiRecommendationsEnhanced()">${tr('more', 'More')} <i class="fa-solid fa-arrow-right"></i></span>
                </div>
                <div class="ai-suggestion-grid" id="aiSuggestionsGrid">
        `;

        suggestions.forEach((track, idx) => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${window.apiPort || 3000}/api/tracks/${track.id}/cover` : null;
            const rawSimilarity = Number(track.similarity);
            const matchPercent = Number.isFinite(rawSimilarity) && rawSimilarity >= 0 ? Math.min(100, Math.round(rawSimilarity)) : null;
            html += getAISuggestionCardHTML(track, coverUrl, matchPercent, idx);
        });

        html += `</div></div>`;
    }

    if (recentTracks.length > 0) {
        html += `
            <div class="recent-section">
                <div class="section-header-modern">
                    <div class="section-title-group">
                        <h3><i class="fa-solid fa-clock-rotate-left"></i> ${typeof t === 'function' ? (t('recentActivity') || 'Recently Added') : 'Recently Added'}</h3>
                        <span class="section-badge-premium">${tr('latest', 'Latest')}</span>
                    </div>
                </div>
                <div class="recent-list-premium" id="recentList">
        `;

        recentTracks.forEach(track => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${window.apiPort || 3000}/api/tracks/${track.id}/cover` : null;
            const addedDate = track.createdAt
                ? new Date(track.createdAt).toLocaleDateString(currentLanguage === 'fa' ? 'fa-IR' : 'en')
                : tr('recently', 'Recently');
            html += getRecentItemHTML(track, coverUrl, addedDate);
        });

        html += `</div></div>`;
    }

    html += `</div>`;

    mainSection.innerHTML = html;

    // Start/refresh player connection checks if available
    try { if (window._playerConnInterval) clearInterval(window._playerConnInterval); } catch(e){}
    if (typeof window.checkPlayerConnection === 'function') {
        window.checkPlayerConnection();
        window._playerConnInterval = setInterval(window.checkPlayerConnection, 10000);
    }
}

function getFeaturedCardHTML(track, coverUrl, index) {
    const playCount = track.playCount || 0;
    const coverVariant = Math.abs(Number(track.id) || index) % 5;
    const title = track.title || (typeof t === 'function' ? t('untitled') : 'Untitled');
    const safeTitle = typeof escapeHtml === 'function' ? escapeHtml(title) : title;
    const coverInitial = Array.from(String(title).trim())[0] || '♫';
    return `
        <div class="featured-card-premium" data-track-id="${track.id}" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
            <div class="featured-card-image ${coverUrl ? 'has-cover' : 'no-cover'}" data-cover-variant="${coverVariant}">
                <div class="featured-cover-placeholder" aria-hidden="true">
                    <span class="featured-cover-orbit"><i class="fa-solid fa-compact-disc"></i></span>
                    <span class="featured-cover-initial">${typeof escapeHtml === 'function' ? escapeHtml(coverInitial) : coverInitial}</span>
                    <span class="featured-cover-label">${safeTitle}</span>
                    <span class="featured-cover-equalizer"><i></i><i></i><i></i><i></i><i></i></span>
                </div>
                ${coverUrl ? `<img src="${coverUrl}" alt="${safeTitle}" loading="lazy" onerror="this.hidden=true; this.parentElement.classList.add('no-cover')">` : ''}
                <div class="card-play-overlay">
                    <div class="play-circle-btn"><i class="fa-solid fa-play"></i></div>
                </div>
            </div>
            <div class="featured-card-info">
                <h4 class="featured-card-title">${typeof escapeHtml === 'function' ? escapeHtml(track.title || t('untitled')) : (track.title || t('untitled'))}</h4>
                <p class="featured-card-artist">${typeof escapeHtml === 'function' ? escapeHtml(track.artist || t('unknownArtist')) : (track.artist || t('unknownArtist'))}</p>
                <div class="featured-card-meta">
                    <span><i class="fa-solid fa-heartbeat"></i> ${formatBpm(track)}</span>
                    <span><i class="fa-regular fa-clock"></i> ${formatTime ? formatTime(track.duration) : (track.duration || '--')}</span>
                    <span class="play-count-badge"><i class="fa-solid fa-play"></i> ${playCount.toLocaleString()}</span>
                </div>
            </div>
        </div>
    `;
}

function getAISuggestionCardHTML(track, coverUrl, matchPercent, index) {
    return `
        <div class="ai-suggestion-card" data-track-id="${track.id}" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
            <div class="ai-suggestion-cover">
                ${coverUrl ? `<img src="${coverUrl}" alt="${typeof escapeHtml === 'function' ? escapeHtml(track.title || 'Untitled') : (track.title || 'Untitled')}" loading="lazy">` : '<div class="fallback-icon"><i class="fa-solid fa-music"></i></div>'}
            </div>
            <h4 class="ai-suggestion-title">${typeof escapeHtml === 'function' ? escapeHtml(track.title || t('untitled')) : (track.title || t('untitled'))}</h4>
            <p class="ai-suggestion-artist">${typeof escapeHtml === 'function' ? escapeHtml(track.artist || t('unknownArtist')) : (track.artist || t('unknownArtist'))}</p>
            <div class="ai-match-badge">
                <i class="fa-solid fa-chart-line"></i>
                <span>${matchPercent === null ? tr('personalized', 'Personalized') : `${matchPercent}% ${tr('match', 'match')}`}</span>
            </div>
        </div>
    `;
}

function getRecentItemHTML(track, coverUrl, addedDate) {
    return `
        <div class="recent-item-premium" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
            <div class="recent-item-cover">
                ${coverUrl ? `<img src="${coverUrl}" alt="${typeof escapeHtml === 'function' ? escapeHtml(track.title || t('untitled')) : (track.title || t('untitled'))}">` : '<i class="fa-solid fa-music"></i>'}
            </div>
            <div class="recent-item-info">
                <h5 class="recent-item-title">${typeof escapeHtml === 'function' ? escapeHtml(track.title || t('untitled')) : (track.title || t('untitled'))}</h5>
                <p class="recent-item-artist">${typeof escapeHtml === 'function' ? escapeHtml(track.artist || t('unknownArtist')) : (track.artist || t('unknownArtist'))}</p>
            </div>
            <div class="recent-item-date">${addedDate}</div>
            <div class="recent-item-play"><i class="fa-solid fa-play"></i></div>
        </div>
    `;
}

function playRandomHomeMix() {
    try {
        const source = [...(window.tracks || [])];
        if (!source.length) {
            if (typeof showNotification === 'function') showNotification(currentLanguage === 'fa' ? 'کتابخانه هنوز آهنگی ندارد' : 'Your library is empty', 'info');
            return;
        }
        for (let i = source.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [source[i], source[j]] = [source[j], source[i]];
        }
        const mix = source.slice(0, Math.min(12, source.length));
        if (typeof playTrack === 'function') playTrack(mix[0].id, 'playlist', 'home-shuffle', mix);
        if (typeof showNotification === 'function') showNotification(currentLanguage === 'fa' ? 'میکس تصادفی شروع شد' : 'Shuffle mix started', 'success');
    } catch (error) {
        console.warn('playRandomHomeMix error', error);
    }
}
window.playRandomHomeMix = playRandomHomeMix;

function getEmptyLibraryHTML() {
    return `
        <div class="empty-state-premium">
            <i class="fa-solid fa-compact-disc"></i>
            <h3>${typeof t === 'function' ? (t('emptyLibrary') || 'Your Library is Empty') : 'Your Library is Empty'}</h3>
            <p>${typeof t === 'function' ? (t('emptyLibraryDesc') || 'Start by importing your favorite tracks to build your personal music collection.') : 'Start by importing your favorite tracks.'}</p>
            <button class="import-hero-btn" onclick="handleImport()">
                <i class="fa-solid fa-plus"></i>
                <span>${typeof t === 'function' ? (t('importFirstTrack') || 'Import your first track') : 'Import your first track'}</span>
            </button>
        </div>
    `;
}

function getDynamicWelcomeMessage() {
    const hour = new Date().getHours();
    const baseMessage = hour >= 5 && hour < 12 ? t('goodMorning')
        : hour >= 12 && hour < 17 ? t('goodAfternoon')
            : hour >= 17 && hour < 21 ? t('goodEvening') : t('goodNight');

    let userName = '';
    if (window.electronAPI && typeof window.electronAPI.getSystemUser === 'function') {
        userName = window.electronAPI.getSystemUser() || '';
    }

    if (userName) return `${baseMessage}, ${userName}`;
    return `${baseMessage}! ${t('readyToPlayQuestion')}`;
}

function getTimeBasedGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return t('morningSession');
    if (hour >= 12 && hour < 17) return t('afternoonBeats');
    if (hour >= 17 && hour < 21) return t('eveningVibes');
    return t('nightMode');
}

// Minimal animate helpers
function playTopSuggestions() {
    const suggestions = typeof getFallbackSuggestions === 'function' ? getFallbackSuggestions(window.tracks || [], 12) : [];
    if (!suggestions.length) {
        if (typeof showNotification === 'function') showNotification(typeof t === 'function' ? (t('emptyLibrary') || 'No tracks available') : 'No tracks available', 'warning');
        return;
    }
    const firstTrack = suggestions[0];
    if (typeof playTrack === 'function') playTrack(firstTrack.id, 'playlist', 'daily-mix', suggestions);
    if (typeof showNotification === 'function') showNotification(`${t('shuffleMix')} — ${t('playingArtist')}`, 'success');
}

// Expose as default renderer
window.renderHome = renderHomePremium;
