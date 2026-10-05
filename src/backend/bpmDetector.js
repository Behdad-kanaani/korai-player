/**
 * KORAI BPM detector.
 *
 * The previous implementation generated synthetic/mock audio, which made the
 * reported BPM unrelated to the actual recording. This version decodes a real
 * mono PCM preview through the bundled/system FFmpeg binary and estimates tempo
 * from a compact onset envelope. The analysis is bounded to keep CPU/RAM usage
 * predictable on long recordings.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TARGET_SAMPLE_RATE = 11025;
const MAX_ANALYSIS_SECONDS = 120;
const MIN_BPM = 60;
const MAX_BPM = 200;

function getFfmpegPath() {
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer?.path && fs.existsSync(installer.path)) return installer.path;
  } catch {}
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function decodeAudioToMono(filePath, sampleRate = TARGET_SAMPLE_RATE, maxSeconds = MAX_ANALYSIS_SECONDS) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return reject(new Error('Audio file does not exist'));
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return reject(new Error('Audio file is empty or invalid'));

    const ffmpegPath = getFfmpegPath();
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', filePath,
      '-t', String(maxSeconds),
      '-vn', '-sn', '-dn',
      '-ac', '1',
      '-ar', String(sampleRate),
      '-f', 's16le',
      'pipe:1'
    ];

    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const stderr = [];

    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => {
      if (stderr.reduce((n, x) => n + x.length, 0) < 32 * 1024) stderr.push(chunk);
    });

    child.on('error', err => reject(new Error(`FFmpeg could not start: ${err.message}`)));
    child.on('close', code => {
      if (code !== 0) {
        const details = Buffer.concat(stderr).toString('utf8').trim();
        return reject(new Error(`FFmpeg decoding failed${details ? `: ${details}` : ''}`));
      }

      const pcm = Buffer.concat(chunks);
      if (pcm.length < 4096) return reject(new Error('Decoded audio is too short for BPM analysis'));

      const sampleCount = Math.floor(pcm.length / 2);
      const samples = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        samples[i] = pcm.readInt16LE(i * 2) / 32768;
      }

      resolve({ samples, sampleRate });
    });
  });
}

function buildOnsetEnvelope(samples, sampleRate, frameSize = 1024, hopSize = 256) {
  const frameCount = Math.max(0, Math.floor((samples.length - frameSize) / hopSize) + 1);
  const rms = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopSize;
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const value = samples[start + i];
      sum += value * value;
    }
    rms[frame] = Math.sqrt(sum / frameSize);
  }

  // First-order positive difference + light moving-average smoothing.
  const onset = new Float32Array(frameCount);
  let mean = 0;
  for (let i = 0; i < frameCount; i++) mean += rms[i];
  mean /= Math.max(1, frameCount);
  const floor = mean * 0.25;

  for (let i = 1; i < frameCount; i++) {
    const diff = rms[i] - rms[i - 1] - floor * 0.05;
    onset[i] = diff > 0 ? diff : 0;
  }

  // Normalize without allocating another large array.
  let peak = 0;
  for (const v of onset) peak = Math.max(peak, v);
  if (peak > 0) {
    for (let i = 0; i < onset.length; i++) onset[i] /= peak;
  }

  return { envelope: onset, envelopeRate: sampleRate / hopSize };
}

function correlationAtLag(envelope, lag) {
  const n = envelope.length - lag;
  if (n < 8) return 0;
  let sum = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < n; i++) {
    const a = envelope[i];
    const b = envelope[i + lag];
    sum += a * b;
    energyA += a * a;
    energyB += b * b;
  }
  const denom = Math.sqrt(energyA * energyB);
  return denom > 0 ? sum / denom : 0;
}

function estimateBpmFromEnvelope(envelope, envelopeRate) {
  if (!envelope || envelope.length < 32 || envelopeRate <= 0) return { bpm: 120, confidence: 0 };

  const minLag = Math.floor(envelopeRate * 60 / MAX_BPM);
  const maxLag = Math.ceil(envelopeRate * 60 / MIN_BPM);
  let best = { lag: 0, score: -Infinity };
  const candidates = [];

  for (let lag = Math.max(1, minLag); lag <= Math.min(maxLag, envelope.length - 2); lag++) {
    const score = correlationAtLag(envelope, lag);
    candidates.push({ lag, score });
    if (score > best.score) best = { lag, score };
  }

  if (!best.lag || best.score <= 0) return { bpm: 120, confidence: 0 };

  // Account for half/double-time ambiguity. Prefer the candidate closest to the
  // strongest correlation while keeping the range musically useful.
  const rawBpm = (60 * envelopeRate) / best.lag;
  const halfLag = Math.max(1, Math.round(best.lag / 2));
  const doubleTimeScore = correlationAtLag(envelope, halfLag);
  let selected = rawBpm;

  // A common failure mode of simple autocorrelation is choosing the interval
  // spanning every second beat (half the true BPM). When the half-lag remains
  // strongly periodic, prefer the musically plausible double-time candidate.
  const doubleTimeBpm = rawBpm * 2;
  if (doubleTimeBpm >= MIN_BPM && doubleTimeBpm <= MAX_BPM && doubleTimeScore >= best.score * 0.55) {
    selected = doubleTimeBpm;
  }

  if (selected < 75 || selected > 150) {
    const alternatives = [rawBpm / 2, rawBpm, rawBpm * 2].filter(b => b >= MIN_BPM && b <= MAX_BPM);
    selected = alternatives
      .map(bpm => ({ bpm, score: correlationAtLag(envelope, Math.max(1, Math.round(60 * envelopeRate / bpm))) }))
      .sort((a, b) => b.score - a.score)[0]?.bpm || selected;
  }

  return {
    bpm: Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, selected))),
    confidence: best.score
  };
}

function detectBPMFromSamples(samples, sampleRate) {
  const { envelope, envelopeRate } = buildOnsetEnvelope(samples, sampleRate);
  return estimateBpmFromEnvelope(envelope, envelopeRate);
}

async function detectRealBPM(filePath) {
  console.debug(`[BPM] Detecting tempo: ${path.basename(filePath)}`);

  // Metadata remains the fastest/highest-signal path when tags are explicitly set.
  try {
    const mm = require('music-metadata');
    const metadata = await mm.parseFile(filePath, { skipCovers: true });
    const taggedBpm = Number(metadata.common?.bpm);
    if (Number.isFinite(taggedBpm) && taggedBpm >= MIN_BPM && taggedBpm <= 240) {
      return Math.round(taggedBpm);
    }
  } catch {
    // Continue with decoded waveform analysis.
  }

  const { samples, sampleRate } = await decodeAudioToMono(filePath);
  const result = detectBPMFromSamples(samples, sampleRate);
  console.debug(`[BPM] result=${result.bpm} confidence=${result.confidence.toFixed(3)}`);
  return result.bpm;
}

module.exports = {
  detectRealBPM,
  decodeAudioToMono,
  buildOnsetEnvelope,
  detectBPMFromSamples,
  estimateBpmFromEnvelope
};
