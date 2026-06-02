/**
 * playlistExporter.js - M3U/PLS Playlist Export/Import
 * 
 * Supports:
 * - M3U (standard and extended)
 * - M3U8 (UTF-8 version)
 * - PLS (Winamp format)
 * - CSV export for analytics
 */

const fs = require('fs');
const path = require('path');

/**
 * Export playlist to M3U/M3U8 format
 */
function exportToM3U(playlist, tracks, outputPath, extended = true) {
    const isM3U8 = outputPath.toLowerCase().endsWith('.m3u8');
    let content = extended ? '#EXTM3U\n' : '';
    
    // Add UTF-8 BOM for M3U8
    if (isM3U8) {
        content = '\uFEFF' + content;
    }
    
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        
        if (extended && track.duration) {
            // Sanitize non-ASCII characters for M3U (not M3U8)
            let title = track.title || 'Unknown';
            let artist = track.artist || '';
            if (!isM3U8) {
                title = title.replace(/[^\x00-\x7F]/g, '');
                artist = artist.replace(/[^\x00-\x7F]/g, '');
            }
            content += `#EXTINF:${Math.round(track.duration)},${artist} - ${title}\n`;
        }
        
        content += track.filePath + '\n';
    }
    
    fs.writeFileSync(outputPath, content, 'utf-8');
    return outputPath;
}

/**
 * Export playlist to PLS format (Winamp)
 */
function exportToPLS(playlist, tracks, outputPath) {
    let content = '[playlist]\n';
    content += `NumberOfEntries=${playlist.tracks.length}\n`;
    content += `Version=2\n`;
    
    let index = 1;
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        
        content += `File${index}=${track.filePath}\n`;
        content += `Title${index}=${track.title || 'Unknown'}\n`;
        content += `Length${index}=${Math.round(track.duration || 0)}\n`;
        index++;
    }
    
    fs.writeFileSync(outputPath, content, 'utf-8');
    return outputPath;
}

/**
 * Import playlist from M3U/M3U8 file (supports UTF-8)
 */
async function importFromM3U(filePath, baseDir = null) {
    // Read with UTF-8 encoding
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Remove BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    
    const lines = content.split(/\r?\n/);
    
    const tracks = [];
    let currentTrack = null;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        
        if (trimmed.startsWith('#EXTINF:')) {
            // Parse extended info
            const match = trimmed.match(/#EXTINF:(\d+),(.*)/);
            if (match) {
                currentTrack = {
                    duration: parseInt(match[1]),
                    title: match[2].trim()
                };
            }
        } else if (!trimmed.startsWith('#')) {
            // This is a file path
            let filePathResolved = trimmed;
            if (baseDir && !path.isAbsolute(filePathResolved)) {
                filePathResolved = path.join(baseDir, filePathResolved);
            }
            
            if (fs.existsSync(filePathResolved)) {
                tracks.push({
                    filePath: filePathResolved,
                    title: currentTrack?.title || path.basename(filePathResolved, path.extname(filePathResolved)),
                    duration: currentTrack?.duration || 0
                });
            }
            currentTrack = null;
        }
    }
    
    return tracks;
}

/**
 * Import playlist from PLS file
 */
function importFromPLS(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    
    const tracks = [];
    const fileMap = new Map();
    const titleMap = new Map();
    const lengthMap = new Map();
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('Version')) continue;
        
        // Parse FileX=path
        const fileMatch = trimmed.match(/File(\d+)=(.*)/);
        if (fileMatch) {
            fileMap.set(parseInt(fileMatch[1]), fileMatch[2]);
        }
        
        // Parse TitleX=title
        const titleMatch = trimmed.match(/Title(\d+)=(.*)/);
        if (titleMatch) {
            titleMap.set(parseInt(titleMatch[1]), titleMatch[2]);
        }
        
        // Parse LengthX=length
        const lengthMatch = trimmed.match(/Length(\d+)=(\d+)/);
        if (lengthMatch) {
            lengthMap.set(parseInt(lengthMatch[1]), parseInt(lengthMatch[2]));
        }
    }
    
    // Build tracks array
    for (const [index, filePath] of fileMap) {
        if (fs.existsSync(filePath)) {
            tracks.push({
                filePath: filePath,
                title: titleMap.get(index) || path.basename(filePath, path.extname(filePath)),
                duration: lengthMap.get(index) || 0
            });
        }
    }
    
    return tracks;
}

/**
 * Export library statistics to CSV
 */
function exportLibraryToCSV(tracks, outputPath) {
    const headers = ['ID', 'Title', 'Artist', 'Album', 'Genre', 'Duration', 'BPM', 'Energy', 'Play Count', 'Like Count', 'File Path'];
    const rows = [headers];
    
    for (const track of tracks) {
        rows.push([
            track.id,
            `"${(track.title || '').replace(/"/g, '""')}"`,
            `"${(track.artist || '').replace(/"/g, '""')}"`,
            `"${(track.album || '').replace(/"/g, '""')}"`,
            `"${(track.genre || '').replace(/"/g, '""')}"`,
            track.duration || 0,
            track.bpm || 120,
            track.energy || 0.5,
            track.playCount || 0,
            track.likeCount || 0,
            `"${track.filePath || ''}"`
        ]);
    }
    
    const csvContent = rows.map(row => row.join(',')).join('\n');
    fs.writeFileSync(outputPath, csvContent, 'utf-8');
    return outputPath;
}

/**
 * Export single playlist to CSV (for analysis)
 */
function exportPlaylistToCSV(playlist, tracks, outputPath) {
    const headers = ['#', 'Title', 'Artist', 'Album', 'Duration', 'BPM', 'Energy'];
    const rows = [headers];
    
    let index = 1;
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        
        rows.push([
            index++,
            `"${(track.title || '').replace(/"/g, '""')}"`,
            `"${(track.artist || '').replace(/"/g, '""')}"`,
            `"${(track.album || '').replace(/"/g, '""')}"`,
            track.duration || 0,
            track.bpm || 120,
            track.energy || 0.5
        ]);
    }
    
    const csvContent = rows.map(row => row.join(',')).join('\n');
    fs.writeFileSync(outputPath, csvContent, 'utf-8');
    return outputPath;
}

module.exports = {
    exportToM3U,
    exportToPLS,
    importFromM3U,
    importFromPLS,
    exportLibraryToCSV,
    exportPlaylistToCSV
};