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
 * Export playlist to M3U format
 */
function exportToM3U(playlist, tracks, outputPath, extended = true) {
    let content = extended ? '#EXTM3U\n' : '';
    
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        
        if (extended && track.duration) {
            const title = track.title || 'Unknown';
            const artist = track.artist || '';
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
 * Import playlist from M3U/M3U8 file
 */
async function importFromM3U(filePath, baseDir = null) {
    const content = fs.readFileSync(filePath, 'utf-8');
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
            let filePath = trimmed;
            if (baseDir && !path.isAbsolute(filePath)) {
                filePath = path.join(baseDir, filePath);
            }
            
            if (fs.existsSync(filePath)) {
                tracks.push({
                    filePath: filePath,
                    title: currentTrack?.title || path.basename(filePath, path.extname(filePath)),
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