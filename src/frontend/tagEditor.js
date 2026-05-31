/**
 * tagEditor.js - In-App Metadata Editor
 * 
 * Allows editing of audio file tags directly from the application
 * Supports: MP3 (ID3v2), FLAC, OGG, M4A, WAV
 */

let currentEditingTrack = null;

/**
 * Open tag editor modal for a track
 */
function openTagEditor(trackId, event) {
    if (event) event.stopPropagation();
    
    const track = window.tracks?.find(t => t.id === trackId);
    if (!track) return;
    
    currentEditingTrack = track;
    
    const modal = document.getElementById('tagEditorModal');
    if (!modal) createTagEditorModal();
    
    const newModal = document.getElementById('tagEditorModal');
    if (!newModal) return;
    
    // Populate form with current values
    document.getElementById('tagTitle').value = track.title || '';
    document.getElementById('tagArtist').value = track.artist || '';
    document.getElementById('tagAlbum').value = track.album || '';
    document.getElementById('tagGenre').value = track.genre || '';
    document.getElementById('tagYear').value = track.year || '';
    document.getElementById('tagTrackNumber').value = track.trackNumber || '';
    document.getElementById('tagComposer').value = track.composer || '';
    document.getElementById('tagLyrics').value = track.lyrics || '';
    
    newModal.style.display = 'flex';
}

/**
 * Create tag editor modal if it doesn't exist
 */
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
    
    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTagEditor();
    });
}

/**
 * Save tag changes to server
 */
async function saveTagChanges() {
    if (!currentEditingTrack) return;
    
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
        const res = await fetch(`http://127.0.0.1:${window.apiPort}/api/tracks/${currentEditingTrack.id}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });
        
        if (!res.ok) throw new Error();
        
        // Update local track data
        Object.assign(currentEditingTrack, updatedData);
        
        showNotification('Metadata saved successfully!', 'success');
        closeTagEditor();
        
        // Refresh UI
        if (window.currentTrackId === currentEditingTrack.id) {
            window.updatePlayerUI();
        }
        if (window.currentActiveSection === 'library') {
            window.renderLibrary();
        }
        
    } catch (err) {
        console.error('Tag save error:', err);
        showNotification('Failed to save metadata', 'error');
    }
}

/**
 * Close tag editor modal
 */
function closeTagEditor() {
    const modal = document.getElementById('tagEditorModal');
    if (modal) modal.style.display = 'none';
    currentEditingTrack = null;
}

// Add CSS for tag editor
const tagEditorStyles = `
<style>
.tag-editor-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 20px 0;
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-group-row {
    display: flex;
    gap: 12px;
}

.form-group label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--spotify-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.form-group input,
.form-group textarea {
    background: var(--spotify-grey);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 10px 14px;
    color: var(--spotify-text-active);
    font-size: 0.85rem;
    outline: none;
    transition: var(--transition-smooth);
}

.form-group input:focus,
.form-group textarea:focus {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 0 2px var(--accent-glow);
}

.form-group textarea {
    resize: vertical;
    font-family: inherit;
}

.close-modal-btn {
    background: none;
    border: none;
    color: var(--spotify-text-muted);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 4px;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.close-modal-btn:hover {
    background-color: var(--spotify-light-grey);
    color: var(--spotify-text-active);
}
</style>
`;

document.head.insertAdjacentHTML('beforeend', tagEditorStyles);

module.exports = { openTagEditor };