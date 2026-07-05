// playlistExporter - playlist import/export utilities (M3U, PLS, XSPF, ASX, WPL, JSON)

const fs = require('fs');
const path = require('path');

function escapeXml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function resolvePlaylistImportPath(rawPath, baseDir = null) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') return null;
    const normalizedPath = rawPath.trim();
    const base = baseDir ? path.resolve(baseDir) : process.cwd();
    const resolvedPath = path.isAbsolute(normalizedPath)
        ? path.resolve(normalizedPath)
        : path.resolve(base, normalizedPath);
    const relativePath = path.relative(base, resolvedPath);
    const isSafe = relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
    return isSafe ? resolvedPath : null;
}

function exportToM3U(playlist, tracks, outputPath, extended = true) {
    const isM3U8 = outputPath.toLowerCase().endsWith('.m3u8');
    let content = extended ? '#EXTM3U\n' : '';
    if (isM3U8) content = '\uFEFF' + content;

    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        if (extended && track.duration) {
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

async function importFromM3U(filePath, baseDir = null) {
    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const lines = content.split(/\r?\n/);
    const tracks = [];
    let currentTrack = null;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        if (trimmed.startsWith('#EXTINF:')) {
            const match = trimmed.match(/#EXTINF:(\d+),(.*)/);
            if (match) {
                currentTrack = { duration: parseInt(match[1]), title: match[2].trim() };
            }
        } else if (!trimmed.startsWith('#')) {
            const filePathResolved = resolvePlaylistImportPath(trimmed, baseDir || path.dirname(filePath));
            if (filePathResolved && fs.existsSync(filePathResolved)) {
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

// ===================== PLS (Winamp) =====================
function exportToPLS(playlist, tracks, outputPath) {
    let content = '[playlist]\n';
    content += `NumberOfEntries=${playlist.tracks.length}\nVersion=2\n`;
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

function importFromPLS(filePath, baseDir = null) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const fileMap = new Map();
    const titleMap = new Map();
    const lengthMap = new Map();
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('Version')) continue;
        const fileMatch = trimmed.match(/File(\d+)=(.*)/);
        if (fileMatch) fileMap.set(parseInt(fileMatch[1]), fileMatch[2]);
        const titleMatch = trimmed.match(/Title(\d+)=(.*)/);
        if (titleMatch) titleMap.set(parseInt(titleMatch[1]), titleMatch[2]);
        const lengthMatch = trimmed.match(/Length(\d+)=(\d+)/);
        if (lengthMatch) lengthMap.set(parseInt(lengthMatch[1]), parseInt(lengthMatch[2]));
    }
    const tracks = [];
    for (const [index, filePath] of fileMap) {
        const safePath = resolvePlaylistImportPath(filePath, baseDir || path.dirname(filePath));
        if (safePath && fs.existsSync(safePath)) {
            tracks.push({
                filePath: safePath,
                title: titleMap.get(index) || path.basename(filePath, path.extname(filePath)),
                duration: lengthMap.get(index) || 0
            });
        }
    }
    return tracks;
}

// ===================== XSPF =====================
function exportToXSPF(playlist, tracks, outputPath) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>${escapeXml(playlist.name)}</title>\n  <trackList>`;
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        xml += `
    <track>
      <location>file://${encodeURI(track.filePath)}</location>
      <title>${escapeXml(track.title || 'Untitled')}</title>
      <creator>${escapeXml(track.artist || 'Unknown')}</creator>
      <album>${escapeXml(track.album || '')}</album>
      <duration>${Math.round((track.duration || 0) * 1000)}</duration>
    </track>`;
    }
    xml += `\n  </trackList>\n</playlist>`;
    fs.writeFileSync(outputPath, xml, 'utf-8');
    return outputPath;
}

async function importFromXSPF(filePath, baseDir = null) {
    const xml2js = require('xml2js');
    const content = fs.readFileSync(filePath, 'utf-8');
    const parser = new xml2js.Parser();
    return new Promise((resolve, reject) => {
        parser.parseString(content, (err, result) => {
            if (err) return reject(err);
            const trackList = result?.playlist?.trackList?.[0]?.track || [];
            const tracks = trackList.map(track => {
                let location = track.location?.[0] || '';
                if (location.startsWith('file://')) location = decodeURI(location.slice(7));
                const safePath = resolvePlaylistImportPath(location, baseDir || path.dirname(filePath));
                if (!safePath) return null;
                return {
                    filePath: safePath,
                    title: track.title?.[0] || path.basename(location, path.extname(location)),
                    duration: (track.duration?.[0] || 0) / 1000
                };
            }).filter(t => fs.existsSync(t.filePath));
            resolve(tracks);
        });
    });
}

// ===================== ASX =====================
function exportToASX(playlist, tracks, outputPath) {
    let xml = `<ASX version="3.0">\n  <TITLE>${escapeXml(playlist.name)}</TITLE>`;
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        xml += `
  <ENTRY>
    <TITLE>${escapeXml(track.title || 'Untitled')}</TITLE>
    <AUTHOR>${escapeXml(track.artist || 'Unknown')}</AUTHOR>
    <REF HREF="${encodeURI(track.filePath)}"/>
  </ENTRY>`;
    }
    xml += `\n</ASX>`;
    fs.writeFileSync(outputPath, xml, 'utf-8');
    return outputPath;
}

async function importFromASX(filePath, baseDir = null) {
    const xml2js = require('xml2js');
    const content = fs.readFileSync(filePath, 'utf-8');
    return new Promise((resolve, reject) => {
        const parser = new xml2js.Parser();
        parser.parseString(content, (err, result) => {
            if (err) return reject(err);
            const entries = result?.ASX?.ENTRY || [];
            const tracks = entries.map(entry => {
                let ref = entry?.REF?.[0]?.$?.HREF || '';
                const safePath = resolvePlaylistImportPath(ref, baseDir || path.dirname(filePath));
                if (!safePath) return null;
                return {
                    filePath: safePath,
                    title: entry?.TITLE?.[0] || path.basename(ref, path.extname(ref)),
                    duration: 0
                };
            }).filter(t => fs.existsSync(t.filePath));
            resolve(tracks);
        });
    });
}

// ===================== WPL =====================
function exportToWPL(playlist, tracks, outputPath) {
    let xml = `<?wpl version="1.0"?>\n<smil>\n  <head>\n    <title>${escapeXml(playlist.name)}</title>\n  </head>\n  <body>\n    <seq>`;
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        xml += `\n      <media src="${encodeURI(track.filePath)}"/>`;
    }
    xml += `\n    </seq>\n  </body>\n</smil>`;
    fs.writeFileSync(outputPath, xml, 'utf-8');
    return outputPath;
}

async function importFromWPL(filePath, baseDir = null) {
    const xml2js = require('xml2js');
    const content = fs.readFileSync(filePath, 'utf-8');
    return new Promise((resolve, reject) => {
        const parser = new xml2js.Parser();
        parser.parseString(content, (err, result) => {
            if (err) return reject(err);
            const medias = result?.smil?.body?.[0]?.seq?.[0]?.media || [];
            const tracks = medias.map(media => {
                let src = media?.$?.src || '';
                const safePath = resolvePlaylistImportPath(src, baseDir || path.dirname(filePath));
                if (!safePath) return null;
                return {
                    filePath: safePath,
                    title: path.basename(src, path.extname(src)),
                    duration: 0
                };
            }).filter(t => fs.existsSync(t.filePath));
            resolve(tracks);
        });
    });
}

// ===================== JSON (JSPF) =====================
function exportToJSON(playlist, tracks, outputPath) {
    const playlistObj = {
        playlist: {
            title: playlist.name,
            date: new Date().toISOString(),
            track: []
        }
    };
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        playlistObj.playlist.track.push({
            location: `file://${encodeURI(track.filePath)}`,
            title: track.title || 'Untitled',
            creator: track.artist || 'Unknown',
            album: track.album || '',
            duration: Math.round((track.duration || 0) * 1000)
        });
    }
    fs.writeFileSync(outputPath, JSON.stringify(playlistObj, null, 2), 'utf-8');
    return outputPath;
}

async function importFromJSON(filePath, baseDir = null) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const tracks = (data.playlist?.track || []).map(t => {
        let location = t.location || '';
        if (location.startsWith('file://')) location = decodeURI(location.slice(7));
        const safePath = resolvePlaylistImportPath(location, baseDir || path.dirname(filePath));
        if (!safePath) return null;
        return {
            filePath: safePath,
            title: t.title || path.basename(location, path.extname(location)),
            duration: (t.duration || 0) / 1000
        };
    }).filter(t => fs.existsSync(t.filePath));
    return tracks;
}

// ===================== CSV Exports (unchanged) =====================
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
    exportPlaylistToCSV,
    exportToXSPF,
    importFromXSPF,
    exportToASX,
    importFromASX,
    exportToWPL,
    importFromWPL,
    exportToJSON,
    importFromJSON
};