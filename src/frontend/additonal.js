// additional.js - KORAI Player Extended Functions (ULTIMATE FIX)

let isExtracting = false;

// ======================== INJECT MISSING CSS ========================
const settingsModalCSS = `
<style id="korai-settings-style">
.settings-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(12px);
    z-index: 10020;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.25s ease, visibility 0.25s ease;
}
.settings-modal-overlay.open {
    opacity: 1;
    visibility: visible;
}
.settings-modal-container {
    width: 90%;
    max-width: 900px;
    max-height: 85vh;
    background: linear-gradient(135deg, var(--spotify-dark) 0%, var(--spotify-grey) 100%);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transform: scale(0.95);
    transition: transform 0.3s cubic-bezier(0.34, 1.2, 0.64, 1);
    box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
}
.settings-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-color);
    background: rgba(0,0,0,0.2);
}
.settings-modal-body {
    display: flex;
    flex: 1;
    overflow: hidden;
}
.settings-tabs {
    width: 200px;
    background: rgba(0,0,0,0.2);
    padding: 20px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-right: 1px solid var(--border-color);
}
body.rtl .settings-tabs {
    border-right: none;
    border-left: 1px solid var(--border-color);
}
.settings-tab-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    background: transparent;
    border: none;
    color: var(--spotify-text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition-smooth);
    width: 100%;
    text-align: left;
}
.settings-tab-btn.active {
    background: linear-gradient(90deg, rgba(29,185,84,0.15) 0%, transparent 100%);
    color: var(--accent-cyan);
    border-left: 3px solid var(--accent-cyan);
}
.settings-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
}
.settings-tab-pane {
    display: none;
    animation: fadeInPane 0.3s ease;
}
.settings-tab-pane.active-pane {
    display: block;
}
@keyframes fadeInPane {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.setting-toggle {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 26px;
}
.setting-toggle input {
    opacity: 0;
    width: 0;
    height: 0;
}
.toggle-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: var(--spotify-light-grey);
    transition: 0.3s;
    border-radius: 34px;
    border: 1px solid var(--border-color);
}
.toggle-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
}
input:checked + .toggle-slider {
    background-color: var(--accent-cyan);
}
input:checked + .toggle-slider:before {
    transform: translateX(24px);
}
.setting-slider {
    width: 180px;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--accent-cyan) 0%, var(--spotify-light-grey) 100%);
    outline: none;
}
.setting-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent-cyan);
    cursor: pointer;
}
.setting-value {
    min-width: 50px;
    font-size: 0.8rem;
    font-family: monospace;
    color: var(--accent-cyan);
}
.settings-group-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--accent-cyan);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
}
.settings-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border-color);
    background: rgba(0,0,0,0.2);
}
.settings-footer-btn {
    padding: 8px 20px;
    border-radius: var(--radius-md);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition-smooth);
    border: none;
}
.settings-footer-btn.cancel {
    background: var(--spotify-grey);
    color: var(--spotify-text-active);
}
.settings-footer-btn.save {
    background: var(--accent-cyan);
    color: #000;
}
.danger-zone {
    margin-top: 32px;
    padding: 16px;
    background: rgba(244,63,94,0.1);
    border: 1px solid rgba(244,63,94,0.3);
    border-radius: var(--radius-md);
}
.danger-btn {
    background: rgba(244,63,94,0.15);
    border: 1px solid var(--accent-pink);
    border-radius: var(--radius-md);
    padding: 8px 16px;
    color: var(--accent-pink);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
}
.radio-group {
    display: flex;
    gap: 16px;
}
.radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 0.8rem;
}
</style>`;
if (!document.getElementById('korai-settings-style')) {
    document.head.insertAdjacentHTML('beforeend', settingsModalCSS);
}

// ======================== SONG INFO (unchanged) ========================
function showSongInfo() {
    if (!currentTrack) {
        showNotification(t('noTrackPlaying'), 'warning');
        return;
    }
    const modal = document.getElementById('songInfoModal');
    if (!modal) return;
    const contentDiv = document.getElementById('songInfoContent');
    const coverUrl = currentTrack.hasCover ? `http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/cover` : null;
    const lang = currentLanguage;
    contentDiv.innerHTML = `
        <div style="display: flex; gap: 20px; margin-bottom: 20px;">
            <div style="width: 80px; height: 80px; border-radius: var(--radius-md); overflow: hidden; background: var(--spotify-grey); display: flex; align-items: center; justify-content: center;">
                ${coverUrl ? `<img src="${coverUrl}" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fa-solid fa-music" style="font-size:2rem;"></i>'}
            </div>
            <div style="flex:1;">
                <h3 style="font-size:1.1rem;">${escapeHtml(currentTrack.title || 'Untitled')}</h3>
                <p style="color:var(--spotify-text-muted);">${escapeHtml(currentTrack.artist || 'Unknown Artist')}</p>
                <p style="font-size:0.7rem;"><i class="fa-regular fa-clock"></i> ${formatTime(currentTrack.duration)}</p>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
            <div><span style="color:var(--accent-cyan);">BPM:</span> ${currentTrack.bpm || '—'}</div>
            <div><span style="color:var(--accent-cyan);">Energy:</span> ${currentTrack.energy ? Math.round(currentTrack.energy*100)+'%' : '—'}</div>
            <div><span style="color:var(--accent-cyan);">Genre:</span> ${escapeHtml(currentTrack.genre || '—')}</div>
            <div><span style="color:var(--accent-cyan);">Album:</span> ${escapeHtml(currentTrack.album || '—')}</div>
            <div><span style="color:var(--accent-cyan);">Bitrate:</span> ${currentTrack.bitrate ? (currentTrack.bitrate/1000).toFixed(0)+' kbps' : '—'}</div>
            <div><span style="color:var(--accent-cyan);">Sample Rate:</span> ${currentTrack.sampleRate ? (currentTrack.sampleRate/1000).toFixed(1)+' kHz' : '—'}</div>
        </div>
        <hr style="border-color:var(--border-color); margin: 10px 0;">
        <p style="font-size:0.75rem; color:var(--spotify-text-muted);"><i class="fa-solid fa-info-circle"></i> ${lang === 'fa' ? 'استخراج صدای خواننده به صورت یک آهنگ جدید (پردازش Mid-Side)' : 'Extract vocal as a new track (AI-based mid-side processing)'}</p>
    `;
    modal.style.display = 'flex';
}
function closeSongInfoModal() {
    const modal = document.getElementById('songInfoModal');
    if (modal) modal.style.display = 'none';
}
async function extractVocalFromCurrentTrack() {
    if (!currentTrack) { showNotification(t('noTrackPlaying'), 'warning'); return; }
    if (isExtracting) { showNotification(t('extractionInProgress'), 'info'); return; }
    isExtracting = true;
    showImportProgress(1);
    updateImportProgress(10, t('preparingExtraction'));
    try {
        updateImportProgress(30, t('extractingVocal'));
        const response = await fetch(`http://127.0.0.1:${apiPort}/api/tracks/${currentTrack.id}/extract-vocal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'vocal' })
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Extraction failed');
        const data = await response.json();
        updateImportProgress(90, t('addingToLibrary'));
        await loadTracks();
        await loadPlaylists();
        const newTrack = data.track;
        if (newTrack) {
            updateImportProgress(100, t('extractionComplete'));
            setTimeout(async () => {
                hideImportProgress();
                closeSongInfoModal();
                await playTrack(newTrack.id);
                showNotification(`${t('vocalTrackAdded')}: ${newTrack.title}`, 'success');
            }, 500);
        } else {
            hideImportProgress();
            showNotification(t('extractionNoTrack'), 'warning');
        }
    } catch (err) {
        console.error(err);
        hideImportProgress();
        showNotification(`${t('extractionFailed')}: ${err.message}`, 'error');
    } finally {
        isExtracting = false;
    }
}
window.showSongInfo = showSongInfo;
window.closeSongInfoModal = closeSongInfoModal;
window.extractVocalFromCurrentTrack = extractVocalFromCurrentTrack;

// ======================== SETTINGS MODAL ========================
let settingsModal = null;
const defaultSettings = {
    gaplessEnabled: true, crossfadeDuration: 0,
    librarySortKey: 'createdAt', librarySortOrder: 'desc', libraryGenreFilter: 'all',
    theme: 'default', language: 'en', showWaveform: true,
    autoScanOnStartup: false, scanFolders: [], anonymousAnalytics: true
};
let currentSettings = { ...defaultSettings };

function createSettingsModal() {
    if (document.getElementById('settingsModal')) return;
    const modalHtml = `
        <div id="settingsModal" class="settings-modal-overlay">
            <div class="settings-modal-container">
                <div class="settings-modal-header">
                    <h2><i class="fa-solid fa-gear"></i> <span data-translate="settingsTitle">Settings</span></h2>
                    <button class="settings-close-btn" id="settingsCloseBtn"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="settings-modal-body">
                    <div class="settings-tabs">
                        <button class="settings-tab-btn active" data-tab="playback"><i class="fa-solid fa-headphones"></i> Playback</button>
                        <button class="settings-tab-btn" data-tab="library"><i class="fa-solid fa-music"></i> Library</button>
                        <button class="settings-tab-btn" data-tab="appearance"><i class="fa-solid fa-palette"></i> Appearance</button>
                        <button class="settings-tab-btn" data-tab="advanced"><i class="fa-solid fa-microchip"></i> Advanced</button>
                        <button class="settings-tab-btn" data-tab="about"><i class="fa-solid fa-circle-info"></i> About</button>
                    </div>
                    <div class="settings-content">
                        <div class="settings-tab-pane active-pane" id="tab-playback"><!-- filled by JS --></div>
                        <div class="settings-tab-pane" id="tab-library"><!-- filled by JS --></div>
                        <div class="settings-tab-pane" id="tab-appearance"><!-- filled by JS --></div>
                        <div class="settings-tab-pane" id="tab-advanced"><!-- filled by JS --></div>
                        <div class="settings-tab-pane" id="tab-about"><!-- filled by JS --></div>
                    </div>
                </div>
                <div class="settings-modal-footer">
                    <button class="settings-footer-btn cancel" id="settingsCancelBtn">Cancel</button>
                    <button class="settings-footer-btn save" id="settingsSaveBtn">Save Changes</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;
    // Populate tabs with minimal content (can be expanded)
    document.getElementById('tab-playback').innerHTML = `
        <div class="settings-group"><div class="settings-group-title">Playback Engine</div>
        <div class="setting-row"><div class="setting-info"><div class="setting-label">Gapless Playback</div></div><div class="setting-control"><label class="setting-toggle"><input type="checkbox" id="settingGapless"><span class="toggle-slider"></span></label></div></div>
        <div class="setting-row"><div class="setting-info"><div class="setting-label">Crossfade Duration</div></div><div class="setting-control"><input type="range" id="settingCrossfade" class="setting-slider" min="0" max="12" step="0.5" value="0"><span id="crossfadeValue" class="setting-value">0s</span></div></div>
        <div class="setting-row"><div class="setting-info"><div class="setting-label">Default Volume</div></div><div class="setting-control"><input type="range" id="settingVolume" class="setting-slider" min="0" max="100" step="1" value="70"><span id="volumeValue" class="setting-value">70%</span></div></div>
        </div>`;
    document.getElementById('tab-library').innerHTML = `<div class="settings-group"><div class="settings-group-title">Sorting</div><div class="setting-row"><div class="setting-info"><div class="setting-label">Sort By</div></div><div class="setting-control"><select id="settingSortKey"><option value="createdAt">Date Added</option><option value="title">Title</option></select></div></div></div>`;
    document.getElementById('tab-appearance').innerHTML = `<div class="settings-group"><div class="settings-group-title">Theme</div><div class="setting-row"><div class="radio-group"><label class="radio-label"><input type="radio" name="themeRadio" value="default"> Default</label><label class="radio-label"><input type="radio" name="themeRadio" value="liquid-glass"> Liquid Glass</label></div></div><div class="setting-row"><div class="radio-group"><label class="radio-label"><input type="radio" name="langRadio" value="en"> English</label><label class="radio-label"><input type="radio" name="langRadio" value="fa"> فارسی</label></div></div></div>`;
    document.getElementById('tab-advanced').innerHTML = `<div class="danger-zone"><button id="resetSettingsBtn" class="danger-btn">Reset All Settings</button></div>`;
    document.getElementById('tab-about').innerHTML = `<div style="text-align:center"><i class="fa-solid fa-compact-disc" style="font-size:4rem;color:var(--accent-cyan)"></i><h2>KORAI Player</h2><p>Version 1.3.0</p><button id="githubLinkBtn">GitHub</button></div>`;
    initSettingsEventListeners();
}

function initSettingsEventListeners() {
    if (!settingsModal) return;
    const tabBtns = settingsModal.querySelectorAll('.settings-tab-btn');
    const tabPanes = settingsModal.querySelectorAll('.settings-tab-pane');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabPanes.forEach(pane => pane.classList.remove('active-pane'));
            const activePane = document.getElementById(`tab-${tabId}`);
            if (activePane) activePane.classList.add('active-pane');
        });
    });
    const closeBtn = settingsModal.querySelector('#settingsCloseBtn');
    const cancelBtn = settingsModal.querySelector('#settingsCancelBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeSettingsModal);
    settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettingsModal(); });
    const saveBtn = settingsModal.querySelector('#settingsSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveSettings);
    // sliders
    const crossfadeSlider = document.getElementById('settingCrossfade');
    if (crossfadeSlider) crossfadeSlider.addEventListener('input', (e) => document.getElementById('crossfadeValue').textContent = parseFloat(e.target.value).toFixed(1)+'s');
    const volumeSlider = document.getElementById('settingVolume');
    if (volumeSlider) volumeSlider.addEventListener('input', (e) => document.getElementById('volumeValue').textContent = e.target.value+'%');
    const resetBtn = document.getElementById('resetSettingsBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => { if(confirm('Reset all settings?')) loadSettingsIntoUI(defaultSettings); });
    const githubBtn = document.getElementById('githubLinkBtn');
    if (githubBtn && window.electronAPI) githubBtn.addEventListener('click', () => window.electronAPI.openExternalLink('https://github.com/Behdad-kanaani/korai-player'));
}

function loadSettingsIntoUI(settings) {
    const gapless = document.getElementById('settingGapless');
    if (gapless) gapless.checked = settings.gaplessEnabled;
    const crossfade = document.getElementById('settingCrossfade');
    if (crossfade) crossfade.value = settings.crossfadeDuration;
    const volume = document.getElementById('settingVolume');
    if (volume) volume.value = settings.defaultVolume || 70;
    const sortKey = document.getElementById('settingSortKey');
    if (sortKey) sortKey.value = settings.librarySortKey;
    const themeRadios = document.querySelectorAll('input[name="themeRadio"]');
    themeRadios.forEach(r => { if(r.value === (settings.theme || 'default')) r.checked = true; });
    const langRadios = document.querySelectorAll('input[name="langRadio"]');
    langRadios.forEach(r => { if(r.value === (settings.language || 'en')) r.checked = true; });
}

function collectSettingsFromUI() {
    const settings = { ...currentSettings };
    const gapless = document.getElementById('settingGapless');
    if (gapless) settings.gaplessEnabled = gapless.checked;
    const crossfade = document.getElementById('settingCrossfade');
    if (crossfade) settings.crossfadeDuration = parseFloat(crossfade.value);
    const volume = document.getElementById('settingVolume');
    if (volume) settings.defaultVolume = parseInt(volume.value);
    const sortKey = document.getElementById('settingSortKey');
    if (sortKey) settings.librarySortKey = sortKey.value;
    const themeRadio = document.querySelector('input[name="themeRadio"]:checked');
    if (themeRadio) settings.theme = themeRadio.value;
    const langRadio = document.querySelector('input[name="langRadio"]:checked');
    if (langRadio) settings.language = langRadio.value;
    return settings;
}

function applySettings(settings) {
    if (settings.theme && typeof applyGlobalSkin === 'function') applyGlobalSkin(settings.theme);
    if (settings.language && typeof changeClientLanguage === 'function') changeClientLanguage(settings.language);
    if (typeof window.setGaplessMode === 'function') window.setGaplessMode(settings.gaplessEnabled);
    if (typeof window.setCrossfadeMode === 'function') window.setCrossfadeMode(settings.crossfadeDuration);
}

async function saveSettingsToServer(settings) {
    try {
        if (window.apiPort) {
            await fetch(`http://127.0.0.1:${window.apiPort}/api/settings`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings)
            });
        }
    } catch(e) { console.error(e); }
}

async function saveSettings() {
    const newSettings = collectSettingsFromUI();
    currentSettings = newSettings;
    applySettings(newSettings);
    await saveSettingsToServer(newSettings);
    showNotification('Settings saved', 'success');
    closeSettingsModal();
}

function loadCurrentSettings() {
    const temp = { ...defaultSettings };
    if (typeof window.librarySortKey !== 'undefined') temp.librarySortKey = window.librarySortKey;
    if (typeof window.currentLanguage !== 'undefined') temp.language = window.currentLanguage;
    if (typeof window.currentSkin !== 'undefined') temp.theme = window.currentSkin;
    if (typeof window.gaplessEnabled !== 'undefined') temp.gaplessEnabled = window.gaplessEnabled;
    if (typeof window.crossfadeDuration !== 'undefined') temp.crossfadeDuration = window.crossfadeDuration;
    currentSettings = { ...currentSettings, ...temp };
    loadSettingsIntoUI(currentSettings);
}

function openSettingsModal() {
    if (!settingsModal) createSettingsModal();
    if (!settingsModal) return;
    loadCurrentSettings();
    settingsModal.classList.add('open');
}
function closeSettingsModal() {
    if (settingsModal) settingsModal.classList.remove('open');
}

// ======================== FORCE FIX THE SETTINGS BUTTON ========================
function fixSettingsButton() {
    const btn = document.getElementById('settingsBtn');
    if (!btn) {
        console.warn('Settings button not found yet, will retry');
        return false;
    }
    // Remove all existing listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Settings button clicked - opening modal');
        openSettingsModal();
    });
    console.log('✅ Settings button fixed');
    return true;
}

// Run fix when DOM ready and also after a short delay to catch late modifications
document.addEventListener('DOMContentLoaded', () => {
    fixSettingsButton();
    // Also observe if button gets replaced later
    const observer = new MutationObserver(() => {
        if (fixSettingsButton()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Create modal
    createSettingsModal();
});
// Also try immediately if DOM already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => fixSettingsButton());
} else {
    setTimeout(fixSettingsButton, 100);
}

// Export for global use
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.openUnifiedSettings = openSettingsModal;
window.closeUnifiedSettings = closeSettingsModal;