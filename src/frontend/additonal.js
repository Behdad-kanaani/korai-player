// additional.js - KORAI Player Extended Functions
// Song Info modal and vocal extraction (backend)

let isExtracting = false;

// Display track metadata and vocal extraction button
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
    if (!currentTrack) {
        showNotification(t('noTrackPlaying'), 'warning');
        return;
    }
    if (isExtracting) {
        showNotification(t('extractionInProgress'), 'info');
        return;
    }

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

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Extraction failed');
        }

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
        console.error('Extraction error:', err);
        hideImportProgress();
        showNotification(`${t('extractionFailed')}: ${err.message}`, 'error');
    } finally {
        isExtracting = false;
    }
}

// Make functions globally available
window.showSongInfo = showSongInfo;
window.closeSongInfoModal = closeSongInfoModal;
window.extractVocalFromCurrentTrack = extractVocalFromCurrentTrack;