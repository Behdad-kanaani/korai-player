// CUE sheet parsing and generation.

const fs = require('fs');
const path = require('path');
const { resolveSafePath } = require('./securityUtils');

const MAX_CUE_FILE_BYTES = 10 * 1024 * 1024;

function parseCueSheet(cuePath) {
    const safeCuePath = resolveSafePath(cuePath, process.cwd());
    if (!safeCuePath || !fs.existsSync(safeCuePath)) {
        throw new Error('CUE file not found');
    }
    const cueBuffer = fs.readFileSync(safeCuePath);
    if (cueBuffer.length > MAX_CUE_FILE_BYTES) {
        throw new Error('CUE file exceeds the 10 MiB size limit');
    }
    let content;
    if (cueBuffer[0] === 0xFF && cueBuffer[1] === 0xFE) {
        content = cueBuffer.subarray(2).toString('utf16le');
    } else if (cueBuffer[0] === 0xFE && cueBuffer[1] === 0xFF) {
        const littleEndian = Buffer.from(cueBuffer.subarray(2));
        for (let index = 0; index + 1 < littleEndian.length; index += 2) {
            const byte = littleEndian[index];
            littleEndian[index] = littleEndian[index + 1];
            littleEndian[index + 1] = byte;
        }
        content = littleEndian.toString('utf16le');
    } else {
        content = cueBuffer.toString('utf-8').replace(/^\uFEFF/, '');
    }
    const lines = content.split(/\r?\n/);
    
    const result = {
        catalog: null,
        performers: new Set(),
        title: null,
        files: []
    };
    
    let currentFile = null;
    let currentTrack = null;
    const seenTrackNumbers = new Set();
    
    const unquote = value => value.replace(/^["']|["']$/g, '').replace(/\\(["'\\])/g, '$1');
    for (let line of lines) {
        line = line.trim();
        if (line === '') continue;
        const commandMatch = line.match(/^(\S+)(?:\s+(.*))?$/);
        if (!commandMatch) continue;
        const command = commandMatch[1].toUpperCase();
        const rawArgs = commandMatch[2] || '';
        const args = unquote(rawArgs);
        
        switch (command) {
            case 'REM':
                if (/^GENRE\s+/i.test(rawArgs)) {
                    result.genre = unquote(rawArgs.replace(/^GENRE\s+/i, ''));
                } else if (/^DATE\s+/i.test(rawArgs)) {
                    result.date = unquote(rawArgs.replace(/^DATE\s+/i, ''));
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
                const fileMatch = rawArgs.match(/^(?:"((?:[^"\\]|\\.)+)"|'((?:[^'\\]|\\.)+)'|(.+))\s+(\S+)\s*$/);
                if (fileMatch) {
                    const filename = unquote(fileMatch[1] || fileMatch[2] || fileMatch[3].trim());
                    currentFile = {
                        path: filename,
                        type: fileMatch[4].toUpperCase(),
                        performer: null,
                        title: null,
                        tracks: []
                    };
                } else {
                    throw new Error(`Invalid FILE directive: ${line}`);
                }
                currentTrack = null;
                break;
                
            case 'TRACK':
                const trackMatch = rawArgs.match(/^(\d{1,3})\s+(\S+)$/);
                if (!trackMatch || !currentFile || Number(trackMatch[1]) < 1) {
                    throw new Error(`Invalid TRACK directive: ${line}`);
                }
                if (seenTrackNumbers.has(Number(trackMatch[1]))) {
                    throw new Error(`Duplicate CUE track number: ${trackMatch[1]}`);
                }
                seenTrackNumbers.add(Number(trackMatch[1]));
                if (trackMatch && currentFile) {
                    currentTrack = {
                        number: parseInt(trackMatch[1]),
                        type: trackMatch[2].toUpperCase(),
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
                    const indexMatch = rawArgs.match(/^(\d{1,2})\s+(\d+):(\d{2}):(\d{2})$/);
                    if (indexMatch) {
                        const indexNum = parseInt(indexMatch[1]);
                        const minutes = parseInt(indexMatch[2]);
                        const seconds = parseInt(indexMatch[3]);
                        const frames = parseInt(indexMatch[4]);
                        if (seconds >= 60 || frames >= 75) {
                            throw new Error(`Invalid INDEX timestamp: ${line}`);
                        }
                        const timeInSeconds = minutes * 60 + seconds + (frames / 75);
                        const previous = currentTrack.indexes?.[indexNum];
                        if (previous !== undefined && previous !== timeInSeconds) {
                            throw new Error(`Conflicting INDEX ${indexNum} on track ${currentTrack.number}`);
                        }
                        if (!currentTrack.indexes) currentTrack.indexes = {};
                        currentTrack.indexes[indexNum] = timeInSeconds;
                        if (indexNum === 0) {
                            currentTrack.pregap = timeInSeconds;
                        } else if (indexNum === 1) {
                            currentTrack.start = timeInSeconds;
                        }
                    } else {
                        throw new Error(`Invalid INDEX directive: ${line}`);
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
    for (const file of result.files) {
        for (const track of file.tracks) {
            if (Number.isFinite(track.pregap) && Number.isFinite(track.start) && track.pregap > track.start) {
                throw new Error(`Track ${track.number} has INDEX 00 after INDEX 01`);
            }
        }
    }
    
    return result;
}

function getTracksFromCue(cuePath, audioBaseDir = null) {
    const cue = parseCueSheet(cuePath);
    const tracks = [];

    for (const file of cue.files) {
        let audioPath = file.path;
        if (/^file:\/\//i.test(audioPath)) {
            try {
                audioPath = require('url').fileURLToPath(audioPath);
            } catch {
                throw new Error(`Invalid audio file URL in CUE: ${file.path}`);
            }
        }
        const safePath = resolveSafePath(audioPath, audioBaseDir || path.dirname(cuePath));
        if (!safePath || !fs.existsSync(safePath)) {
            throw new Error(`Audio file not found or unsafe: ${audioPath}`);
        }

        const fileTracks = file.tracks.filter(track => track.type === 'AUDIO');
        for (let index = 0; index < fileTracks.length; index++) {
            const track = fileTracks[index];
            if (!Number.isFinite(track.start)) {
                throw new Error(`Track ${track.number} has no valid INDEX 01`);
            }
            const nextTrack = fileTracks.slice(index + 1).find(candidate => Number.isFinite(candidate.start));
            const endTime = nextTrack ? nextTrack.start : null;
            if (endTime !== null && endTime <= track.start) {
                throw new Error(`Track ${track.number} has a non-increasing INDEX 01`);
            }
            tracks.push({
                filePath: safePath,
                title: track.title || `${file.title || cue.title || 'Unknown'} - Track ${track.number}`,
                artist: track.performer || file.performer || Array.from(cue.performers)[0] || 'Unknown Artist',
                album: file.title || cue.title || 'Unknown Album',
                trackNumber: track.number,
                startTime: track.start || 0,
                endTime,
                flags: track.flags,
                cueIndex: track.number
            });
        }
    }
    if (!tracks.length) throw new Error('CUE sheet contains no playable AUDIO tracks');
    return tracks;
}

function generateCueSheet(playlist, tracks, outputPath) {
    const safeOutputPath = resolveSafePath(outputPath, process.cwd());
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
            
            // CUE indexes are written relative to the source file.
            const startTime = Number(track.cueStartTime ?? track.cuePosition) || 0;
            const totalFrames = Math.max(0, Math.round(startTime * 75));
            const startMinutes = Math.floor(totalFrames / (60 * 75));
            const startSeconds = Math.floor((totalFrames % (60 * 75)) / 75);
            const startFrames = totalFrames % 75;
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