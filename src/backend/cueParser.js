// cueParser - simple CUE sheet parser

const fs = require('fs');
const path = require('path');
const { resolveSafePath } = require('./securityUtils');

/**
 * Parse a CUE sheet file
 */
function parseCueSheet(cuePath) {
    const safeCuePath = resolveSafePath(cuePath, path.dirname(cuePath) || process.cwd());
    if (!safeCuePath || !fs.existsSync(safeCuePath)) {
        throw new Error('CUE file not found');
    }
    const content = fs.readFileSync(safeCuePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    
    const result = {
        catalog: null,
        performers: new Set(),
        title: null,
        files: []
    };
    
    let currentFile = null;
    let currentTrack = null;
    
    for (let line of lines) {
        line = line.trim();
        if (line === '') continue;
        
        const parts = line.split(' ');
        const command = parts[0].toUpperCase();
        const args = parts.slice(1).join(' ').replace(/^["']|["']$/g, '');
        
        switch (command) {
            case 'REM':
                // Comment - can be ignored or parsed for metadata
                if (args.startsWith('GENRE')) {
                    result.genre = args.replace('GENRE ', '');
                } else if (args.startsWith('DATE')) {
                    result.date = args.replace('DATE ', '');
                }
                break;
                
            case 'CATALOG':
                result.catalog = args;
                break;
                
            case 'PERFORMER':
                if (currentFile) {
                    if (currentTrack) {
                        currentTrack.performer = args;
                    } else {
                        currentFile.performer = args;
                    }
                }
                result.performers.add(args);
                break;
                
            case 'TITLE':
                if (currentFile) {
                    if (currentTrack) {
                        currentTrack.title = args;
                    } else {
                        currentFile.title = args;
                        if (!result.title) result.title = args;
                    }
                } else {
                    result.title = args;
                }
                break;
                
            case 'FILE':
                if (currentFile && currentFile.tracks) {
                    result.files.push(currentFile);
                }
                
                // Parse FILE line: FILE "filename.wav" WAVE
                const fileMatch = line.match(/FILE\s+["'](.+?)["']\s+(\w+)/);
                if (fileMatch) {
                    currentFile = {
                        path: fileMatch[1],
                        type: fileMatch[2],
                        performer: null,
                        title: null,
                        tracks: []
                    };
                }
                currentTrack = null;
                break;
                
            case 'TRACK':
                const trackMatch = line.match(/TRACK\s+(\d+)\s+(\w+)/);
                if (trackMatch && currentFile) {
                    currentTrack = {
                        number: parseInt(trackMatch[1]),
                        type: trackMatch[2],
                        title: null,
                        performer: null,
                        index: null,
                        flags: []
                    };
                    currentFile.tracks.push(currentTrack);
                }
                break;
                
            case 'INDEX':
                if (currentTrack) {
                    const indexMatch = line.match(/INDEX\s+(\d+)\s+(\d+):(\d+):(\d+)/);
                    if (indexMatch) {
                        const indexNum = parseInt(indexMatch[1]);
                        const minutes = parseInt(indexMatch[2]);
                        const seconds = parseInt(indexMatch[3]);
                        const frames = parseInt(indexMatch[4]);
                        const timeInSeconds = minutes * 60 + seconds + (frames / 75);
                        
                        if (indexNum === 0) {
                            currentTrack.pregap = timeInSeconds;
                        } else if (indexNum === 1) {
                            currentTrack.start = timeInSeconds;
                        }
                    }
                }
                break;
                
            case 'FLAGS':
                if (currentTrack) {
                    currentTrack.flags = args.split(' ');
                }
                break;
        }
    }
    
    // Push the last file
    if (currentFile && currentFile.tracks) {
        result.files.push(currentFile);
    }
    
    return result;
}

/**
 * Get all tracks from CUE sheet with resolved paths
 */
function getTracksFromCue(cuePath, audioBaseDir = null) {
    const cue = parseCueSheet(cuePath);
    const tracks = [];
    
    for (const file of cue.files) {
        let audioPath = file.path;
        if (audioPath.startsWith('file://')) audioPath = decodeURI(audioPath.slice(7));
        const safePath = resolveSafePath(audioPath, audioBaseDir || path.dirname(cuePath));
        if (!safePath || !fs.existsSync(safePath)) {
            console.warn(`Audio file not found or unsafe: ${audioPath}`);
            continue;
        }
        
        for (const track of file.tracks) {
            tracks.push({
                filePath: safePath,
                title: track.title || `${file.title || cue.title || 'Unknown'} - Track ${track.number}`,
                artist: track.performer || file.performer || Array.from(cue.performers)[0] || 'Unknown Artist',
                album: file.title || cue.title || 'Unknown Album',
                trackNumber: track.number,
                startTime: track.start || 0,
                endTime: track.nextTrackStart || null,
                flags: track.flags,
                cueIndex: track.number
            });
        }
        
        // Calculate end times for tracks
        for (let i = 0; i < tracks.length; i++) {
            if (i < tracks.length - 1 && tracks[i].filePath === tracks[i + 1].filePath) {
                tracks[i].endTime = tracks[i + 1].startTime;
            }
        }
    }
    
    return tracks;
}

/**
 * Generate a CUE sheet from a playlist
 */
function generateCueSheet(playlist, tracks, outputPath) {
    const safeOutputPath = resolveSafePath(outputPath, path.dirname(outputPath) || process.cwd());
    if (!safeOutputPath) {
        throw new Error('Invalid output path');
    }
    let content = `REM GENRE "${playlist.genre || 'Various'}"\n`;
    content += `REM DATE "${new Date().getFullYear()}"\n`;
    content += `TITLE "${playlist.name || 'Playlist'}"\n`;
    content += `PERFORMER "${playlist.author || 'KORAI Player'}"\n\n`;
    
    // Group tracks by file (for multi-track single files)
    const fileGroups = new Map();
    
    for (const trackId of playlist.tracks) {
        const track = tracks.find(t => t.id === trackId);
        if (!track) continue;
        
        if (!fileGroups.has(track.filePath)) {
            fileGroups.set(track.filePath, []);
        }
        fileGroups.get(track.filePath).push(track);
    }
    
    let globalTrackNum = 1;
    
    for (const [filePath, fileTracks] of fileGroups) {
        const ext = path.extname(filePath).toUpperCase().substring(1);
        const fileName = path.basename(filePath);
        
        content += `FILE "${fileName}" ${ext}\n`;
        
        for (const track of fileTracks) {
            content += `  TRACK ${globalTrackNum++} AUDIO\n`;
            content += `    TITLE "${track.title || 'Unknown'}"\n`;
            content += `    PERFORMER "${track.artist || 'Unknown Artist'}"\n`;
            
            // Calculate index position (simplified - assumes tracks are sequential)
            const startMinutes = Math.floor((track.cuePosition || 0) / 60);
            const startSeconds = Math.floor((track.cuePosition || 0) % 60);
            const startFrames = Math.floor(((track.cuePosition || 0) % 1) * 75);
            content += `    INDEX 01 ${startMinutes.toString().padStart(2, '0')}:${startSeconds.toString().padStart(2, '0')}:${startFrames.toString().padStart(2, '0')}\n`;
        }
        
        content += '\n';
    }
    
    fs.writeFileSync(safeOutputPath, content, 'utf-8');
    return safeOutputPath;
}

module.exports = {
    parseCueSheet,
    getTracksFromCue,
    generateCueSheet
};