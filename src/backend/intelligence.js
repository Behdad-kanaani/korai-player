'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function safeNumber(value, fallback = null) {
  // Number(null) and Number('') are both 0. Treat absent form/database values
  // as missing instead of silently turning them into real measurements.
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeText(value) { return String(value || '').trim(); }
function getMood(track) {
  const energy = safeNumber(track.energy ?? track.rmsLevel, null);
  const bpm = safeNumber(track.bpm, null);
  const key = normalizeText(track.musicalKey).toLowerCase();
  const genre = normalizeText(track.genre).toLowerCase();
  const instrumental = /ambient|classical|soundtrack|new age|drone/.test(genre);
  const minor = key.endsWith('minor');
  if (energy !== null && energy < 0.12 && (instrumental || (bpm !== null && bpm < 95))) return 'ambient';
  if (energy !== null && energy < 0.22 && (bpm === null || bpm < 105)) return 'calm';
  if (energy !== null && energy > 0.48 && bpm !== null && bpm >= 118) return 'energetic';
  if (minor && energy !== null && energy < 0.38) return 'dark';
  if (energy !== null && energy >= 0.22 && energy < 0.48 && bpm !== null && bpm >= 80 && bpm <= 125) return 'focus';
  if (minor) return 'emotional';
  return 'focus';
}
const MOODS = {
  calm: { label: 'Calm', bpmMax: 105, energyMax: 0.25 },
  focus: { label: 'Focus', bpmMin: 75, bpmMax: 130, energyMin: 0.12, energyMax: 0.5 },
  energetic: { label: 'Energetic', bpmMin: 118, energyMin: 0.35 },
  dark: { label: 'Dark', minor: true, energyMax: 0.55 },
  emotional: { label: 'Emotional', minor: true },
  ambient: { label: 'Ambient', bpmMax: 100, energyMax: 0.18 }
};
function moodScore(track, mood) {
  const cfg = MOODS[mood];
  if (!cfg) return 0;
  const bpm = safeNumber(track.bpm);
  const energy = safeNumber(track.energy ?? track.rmsLevel);
  let score = 0;
  if (cfg.bpmMin && bpm !== null) score += bpm >= cfg.bpmMin ? 1 : -1;
  if (cfg.bpmMax && bpm !== null) score += bpm <= cfg.bpmMax ? 1 : -1;
  if (cfg.energyMin && energy !== null) score += energy >= cfg.energyMin ? 1 : -1;
  if (cfg.energyMax && energy !== null) score += energy <= cfg.energyMax ? 1 : -1;
  if (cfg.minor) score += normalizeText(track.musicalKey).toLowerCase().endsWith('minor') ? 1 : -0.25;
  if (mood === 'ambient' && /ambient|new age|drone|soundtrack/.test(normalizeText(track.genre).toLowerCase())) score += 1;
  return score;
}
function buildListeningOverview(tracks, history) {
  const trackById = new Map(tracks.map(t => [Number(t.id), t]));
  const artistCounts = new Map(), albumCounts = new Map(), genreCounts = new Map(), hours = Array(24).fill(0), weekdays = Array(7).fill(0);
  const playsByTrack = new Map();
  for (const item of history || []) {
    const track = trackById.get(Number(item.trackId));
    if (!track) continue;
    const date = new Date(Number(item.playedAt) || 0);
    if (!Number.isFinite(date.getTime())) continue;
    hours[date.getHours()]++;
    weekdays[date.getDay()]++;
    playsByTrack.set(track.id, (playsByTrack.get(track.id) || 0) + 1);
    if (track.artist) artistCounts.set(track.artist, (artistCounts.get(track.artist) || 0) + 1);
    if (track.album) albumCounts.set(track.album, (albumCounts.get(track.album) || 0) + 1);
    if (track.genre) genreCounts.set(track.genre, (genreCounts.get(track.genre) || 0) + 1);
  }
  const top = map => [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,count])=>({name,count}));
  const recentCutoff = Date.now() - 30 * 86400000;
  const previousCutoff = Date.now() - 60 * 86400000;
  const recentHistory = (history || []).filter(x => Number(x.playedAt) >= recentCutoff);
  const previousHistory = (history || []).filter(x => Number(x.playedAt) >= previousCutoff && Number(x.playedAt) < recentCutoff);
  const recent = recentHistory.length;
  const genrePeriod = entries => {
    const counts = new Map();
    for (const entry of entries) {
      const genre = normalizeText(trackById.get(Number(entry.trackId))?.genre);
      if (genre) counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([genre,plays])=>({genre,plays}));
  };
  const analyzed = tracks.filter(t => t.analysisVersion || t.bpm !== null || t.energy !== null).length;
  return {
    totalTracks: tracks.length, totalPlays: (history || []).length,
    playsLast30Days: recent, analyzedTracks: analyzed,
    tasteShift: { recentGenres: genrePeriod(recentHistory), previousGenres: genrePeriod(previousHistory) },
    topArtists: top(artistCounts), topAlbums: top(albumCounts), topGenres: top(genreCounts),
    hourlyActivity: hours.map((plays,hour)=>({hour,plays})),
    weekdayActivity: weekdays.map((plays,weekday)=>({weekday,plays})),
    mostPlayed: [...playsByTrack.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,plays])=>({track:trackById.get(id),plays})),
    moodDistribution: Object.keys(MOODS).map(mood=>({mood,count:tracks.filter(t=>moodScore(t,mood)>=1).length}))
  };
}
function buildBehaviorOverview(userHistory = {}) {
  const totals = {
    skips: 0,
    quickSkips: 0,
    completions: 0,
    repeats: 0,
    listeningTimeSeconds: 0,
    tracksWithSkips: 0,
    tracksWithCompletions: 0
  };
  for (const item of Object.values(userHistory || {})) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const skips = Math.max(0, safeNumber(item.skipCount, 0));
    const completions = Math.max(0, safeNumber(item.completionCount, 0));
    totals.skips += skips;
    totals.quickSkips += Math.max(0, safeNumber(item.skipQuickCount, 0));
    totals.completions += completions;
    totals.repeats += Math.max(0, safeNumber(item.repeatCount, 0));
    totals.listeningTimeSeconds += Math.max(0, safeNumber(item.totalListeningTime, 0));
    if (skips > 0) totals.tracksWithSkips++;
    if (completions > 0) totals.tracksWithCompletions++;
  }
  return totals;
}

async function getLibraryHealth(tracks, options = {}) {
  const missing = [], incomplete = [], missingArtwork = [], unavailable = [], changedFiles = [], emptyFiles = [];
  const duplicateMetadata = new Map();
  const problematicTrackIds = new Set();
  const concurrency = Math.max(1, Math.min(64, Number(options.concurrency) || 24));
  let nextIndex = 0;

  async function inspectTrack(track) {
    const file = normalizeText(track.filePath);
    let stats = null;
    if (!file) {
      const issue = { id: track.id, title: track.title, path: file };
      unavailable.push(issue);
      missing.push(issue);
      problematicTrackIds.add(Number(track.id));
    } else {
      try {
        stats = await fs.promises.stat(file);
        if (!stats.isFile()) {
          unavailable.push({ id: track.id, title: track.title, path: file, reason: 'not-a-file' });
          problematicTrackIds.add(Number(track.id));
          stats = null;
        } else if (stats.size === 0) {
          emptyFiles.push({ id: track.id, title: track.title, path: file });
          problematicTrackIds.add(Number(track.id));
        }
      } catch (error) {
        const issue = { id: track.id, title: track.title, path: file, reason: error.code === 'ENOENT' ? 'missing' : 'unreadable' };
        unavailable.push(issue);
        missing.push(issue);
        problematicTrackIds.add(Number(track.id));
      }
    }

    if (stats) {
      const reasons = [];
      if (track.fileSize !== null && track.fileSize !== undefined && track.fileSize !== '' &&
          Number.isFinite(Number(track.fileSize)) && Number(track.fileSize) !== stats.size) reasons.push('size-changed');
      if (track.fileMtimeMs !== null && track.fileMtimeMs !== undefined && track.fileMtimeMs !== '' &&
          Number.isFinite(Number(track.fileMtimeMs)) && Math.abs(Number(track.fileMtimeMs) - stats.mtimeMs) > 2000) {
        reasons.push('modified-time-changed');
      }
      if (reasons.length) {
        changedFiles.push({ id: track.id, title: track.title, path: file, reasons, storedSize: track.fileSize ?? null, currentSize: stats.size });
        problematicTrackIds.add(Number(track.id));
      }
    }

    const missingFields = ['artist', 'album', 'genre'].filter(key => !normalizeText(track[key]));
    if (missingFields.length) {
      incomplete.push({ id: track.id, title: track.title, missing: missingFields });
      problematicTrackIds.add(Number(track.id));
    }

    let hasArtwork = Boolean(track.hasCover);
    if (track.coverPath) {
      try {
        const coverStat = await fs.promises.stat(track.coverPath);
        hasArtwork = coverStat.isFile() && coverStat.size > 0;
      } catch {
        hasArtwork = false;
      }
    }
    if (!hasArtwork) {
      missingArtwork.push({ id: track.id, title: track.title });
      problematicTrackIds.add(Number(track.id));
    }

    // Require both title and artist to avoid grouping unrelated tracks with blank tags.
    const title = normalizeText(track.title).toLowerCase();
    const artist = normalizeText(track.artist).toLowerCase();
    if (title && artist) {
      const key = `${title}|${artist}`;
      if (!duplicateMetadata.has(key)) duplicateMetadata.set(key, []);
      duplicateMetadata.get(key).push({ id: track.id, title: track.title, artist: track.artist, filePath: file });
    }
  }

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= tracks.length) return;
      await inspectTrack(tracks[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, () => worker()));
  const metadataDuplicates = [...duplicateMetadata.values()].filter(group => group.length > 1);
  const healthy = Math.max(0, tracks.length - problematicTrackIds.size);
  return {
    total: tracks.length,
    healthy,
    missingFiles: unavailable, incompleteMetadata: incomplete,
    missingArtwork, possibleDuplicates: metadataDuplicates,
    changedFiles, emptyFiles,
    summary: {
      missingFiles: unavailable.length, incompleteMetadata: incomplete.length,
      missingArtwork: missingArtwork.length, possibleDuplicateGroups: metadataDuplicates.length,
      changedFiles: changedFiles.length, emptyFiles: emptyFiles.length, healthy
    }
  };
}

function discoverTracks(tracks, history, options = {}) {
  const mood = MOODS[options.mood] ? options.mood : null;
  const played = new Map();
  for (const item of history || []) played.set(Number(item.trackId),(played.get(Number(item.trackId))||0)+1);
  const recentIds = new Set((history||[]).filter(x=>Number(x.playedAt)>Date.now()-30*86400000).map(x=>Number(x.trackId)));
  const scored = tracks.map(track=>{
    let score = 0;
    if (track.isLiked) score += 2;
    score += Math.min(2,(played.get(track.id)||0)*0.15);
    if (mood) score += moodScore(track,mood)*1.5;
    if (!recentIds.has(track.id)) score += 1.5;
    else score -= 2.5;
    if ((played.get(track.id)||0)===0) score += 1;
    if (track.analysisVersion) score += 0.25;
    return {track,score,reason: !played.has(track.id) ? 'Not played yet' : !recentIds.has(track.id) ? 'Not played in 30 days' : 'Matches listening profile'};
  }).sort((a,b)=>b.score-a.score);
  const diverse=[];const artistCounts=new Map();
  for(const item of scored){
    const artist=normalizeText(item.track.artist)||'Unknown';
    const count=artistCounts.get(artist)||0;
    if(count>=2)continue;
    diverse.push(item);artistCounts.set(artist,count+1);
    if(diverse.length>=Math.min(100,Math.max(1,Number(options.limit)||20)))break;
  }
  return diverse;
}
function filterPlaylist(tracks, criteria = {}) {
  const minBpm = safeNumber(criteria.minBpm), maxBpm = safeNumber(criteria.maxBpm);
  const minEnergy = safeNumber(criteria.minEnergy), maxEnergy = safeNumber(criteria.maxEnergy);
  const genres = Array.isArray(criteria.genres) ? criteria.genres.map(x=>String(x).toLowerCase()) : [];
  const artistLimit = Math.max(0,Number(criteria.maxPerArtist)||0);
  const sorted = tracks.filter(t=>{
    const bpm=safeNumber(t.bpm), energy=safeNumber(t.energy ?? t.rmsLevel);
    if (minBpm!==null && (bpm===null || bpm<minBpm)) return false;
    if (maxBpm!==null && (bpm===null || bpm>maxBpm)) return false;
    if (minEnergy!==null && (energy===null || energy<minEnergy)) return false;
    if (maxEnergy!==null && (energy===null || energy>maxEnergy)) return false;
    if (genres.length && !genres.some(genre => normalizeText(t.genre).toLowerCase().includes(genre))) return false;
    if (criteria.unplayed30Days && Number(t.lastPlayedAt||0)>Date.now()-30*86400000) return false;
    return true;
  }).sort((a,b)=>{
    if (criteria.sortBy === 'key') return normalizeText(a.musicalKey).localeCompare(normalizeText(b.musicalKey));
    if (criteria.sortBy === 'energy') return safeNumber(a.energy ?? a.rmsLevel,0)-safeNumber(b.energy ?? b.rmsLevel,0);
    return safeNumber(a.bpm,0)-safeNumber(b.bpm,0);
  });
  if (!artistLimit) return sorted;
  const counts=new Map();
  return sorted.filter(t=>{const k=normalizeText(t.artist)||'Unknown';const n=counts.get(k)||0;if(n>=artistLimit)return false;counts.set(k,n+1);return true;});
}
function parseLrc(source) {
  const lines=String(source||'').split(/\r?\n/), result=[];
  for (const line of lines) {
    const matches=[...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text=line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g,'').trim();
    for (const match of matches) {
      const fraction=Number(`0.${String(match[3]||'0').padEnd(2,'0')}`);
      result.push({time:Number(match[1])*60+Number(match[2])+fraction,text});
    }
  }
  return result.sort((a,b)=>a.time-b.time);
}

function parseEbur128Output(output) {
  const text = String(output || '');
  const integratedMatches = [...text.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS\b/g)];
  const shortTermMatches = [...text.matchAll(/\bS:\s*(-?\d+(?:\.\d+)?)(?=\s|$)/g)];
  const truePeakMatches = [...text.matchAll(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS\b/g)];
  const lraMatches = [...text.matchAll(/\bLRA:\s*(\d+(?:\.\d+)?)\s*LU\b/g)];
  const lastNumber = matches => matches.length ? Number(matches[matches.length - 1][1]) : null;
  const integratedLufs = lastNumber(integratedMatches);
  const truePeakDbtp = lastNumber(truePeakMatches);
  const shortTerms = shortTermMatches.map(match => Number(match[1])).filter(Number.isFinite);
  const lraLu = lastNumber(lraMatches);
  if (integratedLufs === null || truePeakDbtp === null) return null;
  return {
    status: 'measured', standard: 'EBU R128 / ITU-R BS.1770',
    integratedLufs, shortTermMaxLufs: shortTerms.length ? Math.max(...shortTerms) : null,
    loudnessRangeLu: lraLu, truePeakDbtp,
    scope: 'Full decoded audio stream',
    note: 'Measured by FFmpeg ebur128 with true-peak oversampling; short-term value is the maximum reported 3-second window.'
  };
}

async function measureStandardLoudness(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Audio file is unavailable.');
  let ffmpegPath;
  try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
  catch { return { status: 'unavailable', reason: 'FFmpeg decoder is not installed.' }; }
  const timeoutMs = Math.max(15000, Math.min(180000, Number(options.timeoutMs) || 120000));
  return new Promise(resolve => {
    let settled = false;
    let stderr = '';
    const finish = result => { if (settled) return; settled = true; clearTimeout(timeout); resolve(result); };
    const child = spawn(ffmpegPath, [
      '-hide_banner', '-nostats', '-loglevel', 'info', '-i', filePath,
      '-map', '0:a:0', '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ status: 'unavailable', reason: `Full-track loudness analysis timed out after ${Math.round(timeoutMs / 1000)} seconds.` });
    }, timeoutMs);
    child.stderr.on('data', chunk => {
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString();
    });
    child.on('error', error => finish({ status: 'unavailable', reason: error.message }));
    child.on('close', code => {
      if (code !== 0) return finish({ status: 'unavailable', reason: stderr.trim().slice(-1200) || 'FFmpeg loudness analysis failed.' });
      const result = parseEbur128Output(stderr);
      finish(result || { status: 'unavailable', reason: 'FFmpeg completed but did not return Integrated LUFS and True Peak measurements.' });
    });
  });
}

async function measurePcmDiagnostics(filePath, seconds = 30) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Audio file is unavailable.');
  let ffmpegPath;
  try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
  catch { return { status: 'unavailable', reason: 'FFmpeg decoder is not installed.' }; }
  return new Promise(resolve => {
    const child = spawn(ffmpegPath, [
      '-hide_banner','-loglevel','error','-i',filePath,'-t',String(Math.max(5,Math.min(60,seconds))),
      '-vn','-ac','1','-ar','11025','-f','f32le','pipe:1'
    ], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    const chunks=[]; let bytes=0; let stderr='';
    const timeoutMs = Math.max(30000, Math.min(90000, Math.ceil(Number(seconds) || 30) * 1500));
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({status:'unavailable',reason:`Audio analysis timed out after ${Math.round(timeoutMs / 1000)} seconds.`});
    }, timeoutMs);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes<=3*1024*1024)chunks.push(chunk);});
    child.stderr.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk.toString();});
    child.on('error',error=>{clearTimeout(timeout);resolve({status:'unavailable',reason:error.message});});
    child.on('close',code=>{
      clearTimeout(timeout);
      if(code!==0 || !chunks.length) return resolve({status:'unavailable',reason:stderr.trim()||'Audio decoding failed.'});
      const buffer=Buffer.concat(chunks);
      const usable=buffer.length-(buffer.length%4);
      let peak=0,squareSum=0,clipped=0,count=0;
      for(let offset=0;offset<usable;offset+=4){
        const sample=buffer.readFloatLE(offset);
        if(!Number.isFinite(sample)) continue;
        const magnitude=Math.abs(sample);
        if(magnitude>peak)peak=magnitude;
        if(magnitude>=0.999)clipped++;
        squareSum+=sample*sample;count++;
      }
      if(!count)return resolve({status:'unavailable',reason:'No decoded PCM samples were produced.'});
      const rms=Math.sqrt(squareSum/count);
      resolve({
        status:'measured',sampleCount:count,sampledSeconds:count/11025,
        samplePeak:peak,peakDbfs:peak>0?20*Math.log10(peak):-96,
        rms, rmsDbfs:rms>0?20*Math.log10(rms):-96,
        clippedSamples:clipped,clippingDetected:clipped>0,
        crestFactorDb:peak>0&&rms>0?20*Math.log10(peak/rms):null,
        note:'Sample-peak analysis of a decoded excerpt; not an oversampled true-peak or EBU R128 LUFS measurement.'
      });
    });
  });
}

module.exports={measurePcmDiagnostics,measureStandardLoudness,parseEbur128Output,MOODS,getMood,moodScore,buildListeningOverview,buildBehaviorOverview,getLibraryHealth,discoverTracks,filterPlaylist,parseLrc};
