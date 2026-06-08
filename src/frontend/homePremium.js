// KORAI HOME - PREMIUM REDESIGN RENDER FUNCTION

function renderHomePremium() {
    const mainSection = document.getElementById('dynamicSectionContainer');
    if (!mainSection) return;

    const welcomeText = getDynamicWelcomeMessage ? getDynamicWelcomeMessage() : (getWelcomeMessage ? getWelcomeMessage() : 'Welcome');
    const currentTrackObj = window.currentTrack || null;
    const currentTrackId = (currentTrackObj && currentTrackObj.id) || window.currentTrackId || null;
    const currentCover = currentTrackObj && currentTrackObj.hasCover ? `http://127.0.0.1:${window.apiPort || 3000}/api/tracks/${currentTrackObj.id}/cover` : null;
    const isPlaying = !!window.isPlaying;

    // Statistics
    const totalTracks = (window.tracks || []).length;
    const totalLikes = (window.tracks || []).filter(t => t.isLiked).length;
    const totalDuration = (window.tracks || []).reduce((sum, t) => sum + (t.duration || 0), 0);
    const totalHours = Math.floor(totalDuration / 3600);

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

    if ((window.tracks || []).length === 0) {
        mainSection.innerHTML = getEmptyLibraryHTML ? getEmptyLibraryHTML() : '<div class="empty-state-premium">No tracks</div>';
        return;
    }

    const particles = generateParticleHTML();

    let html = `
        <div class="home-container-premium">
            <div class="hero-cinematic-v2" id="heroSection">
                <div class="hero-ambient-glow"></div>
                <div class="hero-particle-field" id="particleField">
                    ${particles}
                </div>
                <div class="hero-grid-layout">
                    <div class="hero-text-premium">
                        <div class="welcome-ecosystem">
                            <i class="fa-solid fa-waveform"></i>
                            <span>${getTimeBasedGreeting ? getTimeBasedGreeting() : 'MORNING SESSION'}</span>
                        </div>
                        <h1 class="hero-main-title">${escapeHtml ? escapeHtml(welcomeText) : welcomeText}</h1>
                        <p class="hero-subtitle-premium">${typeof t === 'function' ? (t('smartRecommendations') || 'Your personal audio universe. Discover, play, and immerse yourself in high-quality sound.') : 'Your personal audio universe.'}</p>
                        <div class="hero-cta-group">
                            <button class="hero-cta-primary ripple-effect" onclick="playTopSuggestions()">
                                <i class="fa-solid fa-play"></i>
                                <span>${typeof t === 'function' ? (t('playPause') || 'Play') : 'Play'}</span>
                            </button>
                            <button class="hero-cta-secondary" onclick="switchSection('library')">
                                <i class="fa-solid fa-music"></i>
                                <span>${typeof t === 'function' ? (t('navLibText') || 'My Library') : 'My Library'}</span>
                            </button>
                            <button class="hero-cta-secondary" onclick="handleAiRecommendationsEnhanced()">
                                <i class="fa-solid fa-brain"></i>
                                <span>AI Mix</span>
                            </button>
                        </div>
                    </div>
                    <div class="hero-art-premium">
                        <div class="now-playing-vinyl">
                            <div class="vinyl-outer-ring"></div>
                            <div class="vinyl-disc-core ${isPlaying ? 'playing' : ''}" id="homeVinylDisc">
                                ${currentCover ? `<img src="${currentCover}" alt="Now Playing" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-music fallback-icon\\'></i>'">` : '<i class="fa-solid fa-music fallback-icon"></i>'}
                            </div>
                            <div class="vinyl-center-label">
                                <i class="fa-solid fa-compact-disc"></i>
                            </div>
                            ${currentTrackObj ? '<div class="now-playing-tag">NOW PLAYING</div>' : ''}
                        </div>
                    </div>
                </div>
            </div>

            <div class="quick-stats-premium">
                <div class="stat-card-premium" onclick="switchSection('library')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-music"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${totalTracks.toLocaleString()}</div>
                        <div class="stat-label">${typeof t === 'function' ? (t('totalTracksLabel') || 'Total Tracks') : 'Total Tracks'}</div>
                    </div>
                </div>
                <div class="stat-card-premium" onclick="switchSection('favorites')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-heart"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${totalLikes.toLocaleString()}</div>
                        <div class="stat-label">${typeof t === 'function' ? (t('popularLabel') || 'Liked Tracks') : 'Liked Tracks'}</div>
                    </div>
                </div>
                <div class="stat-card-premium" onclick="switchSection('stats')">
                    <div class="stat-icon-premium"><i class="fa-solid fa-clock"></i></div>
                    <div class="stat-content-premium">
                        <div class="stat-number">${totalHours}</div>
                        <div class="stat-label">Hours of Music</div>
                    </div>
                </div>
            </div>

            <div class="mood-section">
                <div class="section-header-modern">
                    <div class="section-title-group">
                        <h3><i class="fa-solid fa-face-smile"></i> ${typeof t === 'function' ? (t('moodTitle') || 'Mood & Energy') : 'Mood & Energy'}</h3>
                        <span class="section-badge-premium">MOMENTUM</span>
                    </div>
                </div>
                <div class="mood-chips-scroll">
                    <div class="mood-chip-premium" onclick="filterByMood('energetic')"><i class="fa-solid fa-bolt"></i> <span>Energetic</span></div>
                    <div class="mood-chip-premium" onclick="filterByMood('chill')"><i class="fa-solid fa-cloud-moon"></i> <span>Chill</span></div>
                    <div class="mood-chip-premium" onclick="filterByMood('focus')"><i class="fa-solid fa-brain"></i> <span>Focus</span></div>
                    <div class="mood-chip-premium" onclick="filterByMood('workout')"><i class="fa-solid fa-dumbbell"></i> <span>Workout</span></div>
                    <div class="mood-chip-premium" onclick="filterByMood('sad')"><i class="fa-solid fa-face-frown"></i> <span>Melancholic</span></div>
                    <div class="mood-chip-premium" onclick="filterByMood('happy')"><i class="fa-solid fa-face-smile"></i> <span>Happy</span></div>
                    <div class="mood-chip-premium" onclick="filterByMood('romantic')"><i class="fa-solid fa-heart"></i> <span>Romantic</span></div>
                    <div class="mood-chip-premium" onclick="filterByMood('study')"><i class="fa-solid fa-book"></i> <span>Study</span></div>
                </div>
            </div>
    `;

    if (featuredTracks.length > 0) {
        html += `
            <div class="featured-section">
                <div class="section-header-modern">
                    <div class="section-title-group">
                        <h3><i class="fa-solid fa-chart-simple"></i> ${typeof t === 'function' ? (t('statsHero') || 'Most Played') : 'Most Played'}</h3>
                        <span class="section-badge-premium">🔥 TOP 8</span>
                    </div>
                    <span class="view-all-link-modern" onclick="switchSection('library')">${typeof t === 'function' ? (t('allGenres') || 'View All') : 'View All'} <i class="fa-solid fa-arrow-right"></i></span>
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
                        <span class="section-badge-premium">PERSONALIZED</span>
                    </div>
                    <span class="view-all-link-modern" onclick="handleAiRecommendationsEnhanced()">More <i class="fa-solid fa-arrow-right"></i></span>
                </div>
                <div class="ai-suggestion-grid" id="aiSuggestionsGrid">
        `;

        suggestions.forEach((track, idx) => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${window.apiPort || 3000}/api/tracks/${track.id}/cover` : null;
            const matchPercent = track.similarity || Math.floor(Math.random() * 30) + 65;
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
                        <span class="section-badge-premium">🆕 FRESH</span>
                    </div>
                </div>
                <div class="recent-list-premium" id="recentList">
        `;

        recentTracks.forEach(track => {
            const coverUrl = track.hasCover ? `http://127.0.0.1:${window.apiPort || 3000}/api/tracks/${track.id}/cover` : null;
            const addedDate = track.createdAt ? new Date(track.createdAt).toLocaleDateString() : 'Recently';
            html += getRecentItemHTML(track, coverUrl, addedDate);
        });

        html += `</div></div>`;
    }

    html += `</div>`;

    mainSection.innerHTML = html;

    animateHomeElements && animateHomeElements();
    updateHomeVinylAnimation && updateHomeVinylAnimation();
}

function generateParticleHTML() {
    let particles = '';
    for (let i = 0; i < 24; i++) {
        const left = Math.random() * 100;
        const delay = Math.random() * 10;
        const duration = 8 + Math.random() * 10;
        particles += `<div class="hero-particle" style="left: ${left}%; animation-delay: ${delay}s; animation-duration: ${duration}s;"></div>`;
    }
    return particles;
}

function getFeaturedCardHTML(track, coverUrl, index) {
    const playCount = track.playCount || 0;
    return `
        <div class="featured-card-premium" data-track-id="${track.id}" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
            <div class="featured-card-image">
                ${coverUrl ? `<img src="${coverUrl}" alt="${escapeHtml ? escapeHtml(track.title || 'Untitled') : (track.title || 'Untitled')}" loading="lazy">` : '<div class="fallback-icon"><i class="fa-solid fa-music"></i></div>'}
                <div class="card-play-overlay">
                    <div class="play-circle-btn"><i class="fa-solid fa-play"></i></div>
                </div>
            </div>
            <div class="featured-card-info">
                <h4 class="featured-card-title">${escapeHtml ? escapeHtml(track.title || 'Untitled') : (track.title || 'Untitled')}</h4>
                <p class="featured-card-artist">${escapeHtml ? escapeHtml(track.artist || 'Unknown Artist') : (track.artist || 'Unknown Artist')}</p>
                <div class="featured-card-meta">
                    <span><i class="fa-solid fa-heartbeat"></i> ${track.bpm || '120'}</span>
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
                ${coverUrl ? `<img src="${coverUrl}" alt="${escapeHtml ? escapeHtml(track.title || 'Untitled') : (track.title || 'Untitled')}" loading="lazy">` : '<div class="fallback-icon"><i class="fa-solid fa-music"></i></div>'}
            </div>
            <h4 class="ai-suggestion-title">${escapeHtml ? escapeHtml(track.title || 'Untitled') : (track.title || 'Untitled')}</h4>
            <p class="ai-suggestion-artist">${escapeHtml ? escapeHtml(track.artist || 'Unknown Artist') : (track.artist || 'Unknown Artist')}</p>
            <div class="ai-match-badge">
                <i class="fa-solid fa-chart-line"></i>
                <span>${matchPercent}% match</span>
            </div>
        </div>
    `;
}

function getRecentItemHTML(track, coverUrl, addedDate) {
    return `
        <div class="recent-item-premium" onclick="playTrack(${track.id}, 'library')" oncontextmenu="event.preventDefault(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)">
            <div class="recent-item-cover">
                ${coverUrl ? `<img src="${coverUrl}" alt="${escapeHtml ? escapeHtml(track.title || 'Untitled') : (track.title || 'Untitled')}">` : '<i class="fa-solid fa-music"></i>'}
            </div>
            <div class="recent-item-info">
                <h5 class="recent-item-title">${escapeHtml ? escapeHtml(track.title || 'Untitled') : (track.title || 'Untitled')}</h5>
                <p class="recent-item-artist">${escapeHtml ? escapeHtml(track.artist || 'Unknown Artist') : (track.artist || 'Unknown Artist')}</p>
            </div>
            <div class="recent-item-date">${addedDate}</div>
            <div class="recent-item-play"><i class="fa-solid fa-play"></i></div>
        </div>
    `;
}

function getEmptyLibraryHTML() {
    return `
        <div class="empty-state-premium">
            <i class="fa-solid fa-compact-disc"></i>
            <h3>${typeof t === 'function' ? (t('emptyLibrary') || 'Your Library is Empty') : 'Your Library is Empty'}</h3>
            <p>${typeof t === 'function' ? (t('emptyLibraryDesc') || 'Start by importing your favorite tracks to build your personal music collection.') : 'Start by importing your favorite tracks.'}</p>
            <button class="import-hero-btn" onclick="handleImport()">
                <i class="fa-solid fa-plus"></i>
                <span>Import Your First Track</span>
            </button>
        </div>
    `;
}

function getDynamicWelcomeMessage() {
    const hour = new Date().getHours();
    let baseMessage = '';
    if (hour >= 5 && hour < 12) baseMessage = 'Good Morning';
    else if (hour >= 12 && hour < 17) baseMessage = 'Good Afternoon';
    else if (hour >= 17 && hour < 21) baseMessage = 'Good Evening';
    else baseMessage = 'Good Night';

    let userName = '';
    if (window.electronAPI && typeof window.electronAPI.getSystemUser === 'function') {
        userName = window.electronAPI.getSystemUser() || '';
    }

    if (userName) return `${baseMessage}, ${userName}`;
    return `${baseMessage}! Ready to play?`;
}

function getTimeBasedGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'MORNING SESSION';
    if (hour >= 12 && hour < 17) return 'AFTERNOON BEATS';
    if (hour >= 17 && hour < 21) return 'EVENING VIBES';
    return 'NIGHT MODE';
}

// Minimal animate helpers
function animateHomeElements() {
    const cards = document.querySelectorAll('.featured-card-premium, .ai-suggestion-card, .recent-item-premium, .stat-card-premium');
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

function updateHomeVinylAnimation() {
    const vinylDisc = document.getElementById('homeVinylDisc');
    if (!vinylDisc) return;
    if (window.isPlaying) vinylDisc.classList.add('playing');
    else vinylDisc.classList.remove('playing');
}

function playTopSuggestions() {
    const suggestions = typeof getFallbackSuggestions === 'function' ? getFallbackSuggestions(window.tracks || [], 12) : [];
    if (!suggestions.length) {
        if (typeof showNotification === 'function') showNotification(typeof t === 'function' ? (t('emptyLibrary') || 'No tracks available') : 'No tracks available', 'warning');
        return;
    }
    const firstTrack = suggestions[0];
    if (typeof playTrack === 'function') playTrack(firstTrack.id, 'playlist', 'daily-mix', suggestions);
    if (typeof showNotification === 'function') showNotification('Playing Daily Mix', 'success');
}

// Expose as default renderer
window.renderHome = renderHomePremium;
