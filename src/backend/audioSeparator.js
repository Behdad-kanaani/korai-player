// src/backend/audioSeparator.js
const fs = require('fs');
const wav = require('wav');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

class AudioSeparator {
    static tempDir = null;

    // این متد را از server.js صدا بزنید تا پوشه موقت معتبر تنظیم شود
    static setTempDirectory(dir) {
        this.tempDir = dir;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    static async extractVocal(inputFile, outputFile, options = {}) {
        const { lowFreq = 120, highFreq = 3500, noiseGate = 0.15, sampleRate = 22050 } = options;
        console.log('🎚️ Processing vocal extraction...');
        
        // اعتبارسنجی فایل ورودی
        if (!fs.existsSync(inputFile)) {
            throw new Error(`Input file does not exist: ${inputFile}`);
        }
        const stats = fs.statSync(inputFile);
        if (stats.size === 0) {
            throw new Error(`Input file is empty: ${inputFile}`);
        }

        try {
            const audioData = await this.loadAudio(inputFile, sampleRate);
            if (audioData.numberOfChannels === 1) {
                console.log('⚠️ Mono file - vocal separation will be less effective');
                await this.saveAudio(audioData.samples, outputFile, sampleRate, 1);
                return;
            }
            const left = audioData.samples[0];
            const right = audioData.samples[1];
            const vocalRaw = left.map((l, i) => (l + right[i]) / 2);
            let vocalFiltered = this.bandpassFilter(vocalRaw, lowFreq, highFreq, sampleRate);
            const rms = this.calculateRMS(vocalFiltered);
            const threshold = rms * noiseGate;
            const vocalDenoised = vocalFiltered.map(v => Math.abs(v) > threshold ? v : v * 0.3);
            const vocalNormalized = this.normalize(vocalDenoised, 0.95);
            await this.saveAudio(vocalNormalized, outputFile, sampleRate, 1);
            console.log(`✅ Vocal extracted: ${outputFile}`);
        } catch (error) {
            console.error(`❌ Error in extractVocal: ${error.message}`);
            throw error;
        }
    }

    static async loadAudio(inputFile, targetRate) {
        return new Promise((resolve, reject) => {
            // استفاده از پوشه موقت اختصاصی (اگر تنظیم شده باشد)
            const tempDir = this.tempDir || path.join(require('os').tmpdir(), 'korai_extract');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            const tempWav = path.join(tempDir, `temp_${Date.now()}.wav`);
            
            console.log(`🎧 Converting: ${inputFile} → ${tempWav}`);
            
            ffmpeg(inputFile)
                .audioFrequency(targetRate)
                .audioChannels(2)
                .toFormat('wav')
                .on('error', (err) => {
                    console.error('FFmpeg error:', err.message);
                    reject(new Error(`FFmpeg conversion failed: ${err.message}`));
                })
                .on('end', () => {
                    // بررسی فایل خروجی
                    if (!fs.existsSync(tempWav)) {
                        return reject(new Error(`Temp WAV not created: ${tempWav}`));
                    }
                    const wavStats = fs.statSync(tempWav);
                    if (wavStats.size === 0) {
                        return reject(new Error('FFmpeg produced empty WAV file'));
                    }
                    
                    console.log(`✅ WAV created, size: ${wavStats.size} bytes`);
                    
                    // خواندن فایل WAV
                    const fileStream = fs.createReadStream(tempWav);
                    const reader = new wav.Reader();
                    const channels = [];
                    
                    reader.on('format', (format) => {
                        console.log(`WAV format: ${format.channels}ch, ${format.sampleRate}Hz, ${format.bitDepth}bit`);
                        for (let i = 0; i < format.channels; i++) channels.push([]);
                    });
                    
                    reader.on('data', (chunk) => {
                        const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
                        for (let i = 0; i < samples.length; i++) {
                            const channelIndex = i % channels.length;
                            const sampleValue = samples[i] / 32768.0;
                            channels[channelIndex].push(sampleValue);
                        }
                    });
                    
                    reader.on('end', () => {
                        // پاک کردن فایل موقت
                        fs.unlink(tempWav, (err) => {
                            if (err) console.warn('Could not delete temp file:', err);
                        });
                        
                        if (channels.length === 0 || channels[0].length === 0) {
                            return reject(new Error('No audio samples read from WAV'));
                        }
                        console.log(`📊 Loaded ${channels[0].length} samples per channel`);
                        resolve({
                            samples: channels,
                            numberOfChannels: channels.length,
                            sampleRate: targetRate
                        });
                    });
                    
                    reader.on('error', (err) => {
                        fs.unlink(tempWav, () => {});
                        reject(new Error(`WAV reader error: ${err.message}`));
                    });
                    
                    fileStream.pipe(reader);
                })
                .save(tempWav);
        });
    }

    static bandpassFilter(samples, lowFreq, highFreq, sampleRate) {
        const windowSize = Math.floor(sampleRate / lowFreq);
        const filtered = new Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            let sum = 0, count = 0;
            const start = Math.max(0, i - windowSize);
            const end = Math.min(samples.length - 1, i + windowSize);
            for (let j = start; j <= end; j++) {
                sum += samples[j];
                count++;
            }
            filtered[i] = sum / count;
        }
        return filtered;
    }

    static calculateRMS(samples) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }

    // اصلاح شده: بدون استفاده از spread operator برای آرایه‌های بزرگ
    static normalize(samples, maxAmplitude = 0.95) {
        if (!samples || samples.length === 0) return samples;
        let maxVal = 0;
        for (let i = 0; i < samples.length; i++) {
            const abs = Math.abs(samples[i]);
            if (abs > maxVal) maxVal = abs;
        }
        if (maxVal === 0) return samples;
        const scale = maxAmplitude / maxVal;
        for (let i = 0; i < samples.length; i++) {
            samples[i] = samples[i] * scale;
        }
        return samples;
    }

    static async saveAudio(samples, outputFile, sampleRate, channels) {
        return new Promise((resolve, reject) => {
            const writer = new wav.FileWriter(outputFile, { channels, sampleRate, bitDepth: 16 });
            const int16Data = [];
            const samplesArray = Array.isArray(samples[0]) ? samples : [samples];
            const totalSamples = samplesArray[0].length;
            for (let i = 0; i < totalSamples; i++) {
                for (let ch = 0; ch < channels; ch++) {
                    const sample = samplesArray[ch]?.[i] || 0;
                    const int16Sample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
                    int16Data.push(int16Sample);
                }
            }
            const buffer = Buffer.alloc(int16Data.length * 2);
            for (let i = 0; i < int16Data.length; i++) buffer.writeInt16LE(int16Data[i], i * 2);
            writer.write(buffer);
            writer.end();
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
}

module.exports = AudioSeparator;