// Lightweight vocal extraction using a stereo center-channel heuristic.
// This is intentionally described as extraction, not AI stem separation: true
// source separation requires a trained separation model and substantially more RAM/CPU.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function getFfmpegPath() {
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer?.path && fs.existsSync(installer.path)) return installer.path;
  } catch {}
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

class AudioSeparator {
  static tempDir = null;

  static setTempDirectory(dir) {
    if (!dir) throw new Error('Temporary directory is required');
    this.tempDir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  static async extractVocal(inputFile, outputFile, options = {}) {
    const {
      lowFreq = 120,
      highFreq = 4500,
      sampleRate = 22050,
      normalize = 0.95
    } = options;

    if (!fs.existsSync(inputFile)) throw new Error('Input audio file does not exist');
    if (path.resolve(inputFile) === path.resolve(outputFile)) throw new Error('Output must differ from input');
    if (!Number.isFinite(lowFreq) || !Number.isFinite(highFreq) || lowFreq <= 0 || highFreq <= lowFreq) {
      throw new Error('Invalid vocal filter frequencies');
    }

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    const filters = [
      'pan=mono|c0=0.5*c0+0.5*c1',
      `highpass=f=${Math.round(lowFreq)}`,
      `lowpass=f=${Math.round(highFreq)}`,
      'acompressor=threshold=0.12:ratio=2:attack=20:release=180',
      `alimiter=limit=${Math.max(0.1, Math.min(0.99, normalize))}`
    ].join(',');

    await this.#runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', inputFile,
      '-vn', '-sn', '-dn',
      '-af', filters,
      '-ar', String(sampleRate),
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-y', outputFile
    ]);

    const stat = fs.statSync(outputFile);
    if (!stat.isFile() || stat.size < 1024) {
      throw new Error('FFmpeg produced an empty vocal extraction');
    }

    return outputFile;
  }

  static #runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(getFfmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const errors = [];
      child.stderr.on('data', chunk => {
        if (Buffer.concat(errors).length < 32 * 1024) errors.push(chunk);
      });
      child.on('error', err => reject(new Error(`FFmpeg could not start: ${err.message}`)));
      child.on('close', code => {
        if (code === 0) return resolve();
        const details = Buffer.concat(errors).toString('utf8').trim();
        reject(new Error(`FFmpeg vocal extraction failed${details ? `: ${details}` : ''}`));
      });
    });
  }
}

module.exports = AudioSeparator;
