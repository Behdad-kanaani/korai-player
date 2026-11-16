/*
 * KORAI True Peak Limiter DSP core.
 * 4x windowed-sinc reconstruction, linked-channel lookahead gain control.
 * Kept free of browser APIs so the exact processing path can be unit-tested in Node.
 */
(function exposeKoraiTruePeakLimiterCore(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiTruePeakLimiterCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function createKoraiTruePeakLimiterCore() {
    'use strict';

    const OVERSAMPLE = 4;
    const FIR_LEFT = 5;
    const FIR_RIGHT = 6;
    const FIR_FUTURE = FIR_RIGHT;
    const PHASES = [0.25, 0.5, 0.75];
    const DEFAULTS = Object.freeze({
        ceilingDb: -1,
        lookaheadMs: 5,
        attackMs: 0.5,
        releaseMs: 80,
        enabled: true
    });

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const dbToLinear = db => Math.pow(10, db / 20);
    const linearToDb = value => value > 0 ? 20 * Math.log10(value) : -Infinity;
    const sinc = value => Math.abs(value) < 1e-12 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);

    function makeInterpolationKernels() {
        return PHASES.map(phase => {
            const coefficients = new Float64Array(FIR_LEFT + FIR_RIGHT + 1);
            let sum = 0;
            for (let tap = 0; tap < coefficients.length; tap++) {
                const offset = tap - FIR_LEFT;
                const distance = phase - offset;
                const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * tap) / (coefficients.length - 1)) +
                    0.08 * Math.cos((4 * Math.PI * tap) / (coefficients.length - 1));
                const coefficient = sinc(distance) * window;
                coefficients[tap] = coefficient;
                sum += coefficient;
            }
            if (Math.abs(sum) > 1e-12) {
                for (let tap = 0; tap < coefficients.length; tap++) coefficients[tap] /= sum;
            }
            return coefficients;
        });
    }

    const INTERPOLATION_KERNELS = makeInterpolationKernels();

    class TruePeakLimiterCore {
        constructor(sampleRate = 48000, options = {}) {
            this.sampleRate = this._sanitizeSampleRate(sampleRate);
            this.options = this._sanitizeOptions(options);
            this.channels = 0;
            this.frameIndex = 0;
            this.gain = 1;
            this.lastTruePeak = 0;
            this.lastGainReductionDb = 0;
            this.safetyClipCount = 0;
            this._allocate(2);
        }

        _sanitizeSampleRate(value) {
            const rate = Number(value);
            if (!Number.isFinite(rate) || rate < 8000 || rate > 384000) {
                throw new RangeError('Sample rate must be between 8000 and 384000 Hz.');
            }
            return rate;
        }

        _sanitizeOptions(options = {}) {
            const source = options && typeof options === 'object' ? options : {};
            const ceilingDb = clamp(finite(source.ceilingDb, DEFAULTS.ceilingDb), -12, -0.1);
            const lookaheadMs = clamp(finite(source.lookaheadMs, DEFAULTS.lookaheadMs), 1, 20);
            const attackMs = clamp(finite(source.attackMs, DEFAULTS.attackMs), 0.05, 0.5);
            const releaseMs = clamp(finite(source.releaseMs, DEFAULTS.releaseMs), 10, 1000);
            return {
                ceilingDb,
                lookaheadMs,
                attackMs,
                releaseMs,
                enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULTS.enabled
            };
        }

        _allocate(channelCount) {
            this.channels = Math.max(1, Math.min(8, Math.floor(channelCount) || 1));
            this.lookaheadFrames = Math.max(1, Math.ceil(this.sampleRate * this.options.lookaheadMs / 1000));
            this.latencyFrames = this.lookaheadFrames + FIR_FUTURE;
            this.latencyMs = (this.latencyFrames / this.sampleRate) * 1000;
            this.ringSize = this.latencyFrames + FIR_LEFT + FIR_RIGHT + 8;
            this.sampleRings = Array.from({ length: this.channels }, () => new Float32Array(this.ringSize));
            this.peakDequeCapacity = this.lookaheadFrames + 32;
            this.peakDequeIndices = new Float64Array(this.peakDequeCapacity);
            this.peakDequeValues = new Float32Array(this.peakDequeCapacity);
            this.peakDequeHead = 0;
            this.peakDequeTail = 0;
            this.frameIndex = 0;
            this.gain = 1;
            this.lastTruePeak = 0;
            this.lastGainReductionDb = 0;
            this.safetyClipCount = 0;
        }

        configure(options = {}) {
            const next = this._sanitizeOptions({ ...this.options, ...options });
            const lookaheadChanged = next.lookaheadMs !== this.options.lookaheadMs;
            this.options = next;
            if (lookaheadChanged) this._allocate(this.channels || 2);
            return this.getStatus();
        }

        setSampleRate(sampleRate) {
            const next = this._sanitizeSampleRate(sampleRate);
            if (next === this.sampleRate) return false;
            this.sampleRate = next;
            this._allocate(this.channels || 2);
            return true;
        }

        reset() {
            for (const ring of this.sampleRings) ring.fill(0);
            this.peakDequeHead = 0;
            this.peakDequeTail = 0;
            this.frameIndex = 0;
            this.gain = 1;
            this.lastTruePeak = 0;
            this.lastGainReductionDb = 0;
            this.safetyClipCount = 0;
        }

        getStatus() {
            return {
                sampleRate: this.sampleRate,
                channels: this.channels,
                oversampling: OVERSAMPLE,
                lookaheadMs: this.options.lookaheadMs,
                latencyFrames: this.latencyFrames,
                latencyMs: this.latencyMs,
                ceilingDb: this.options.ceilingDb,
                attackMs: this.options.attackMs,
                releaseMs: this.options.releaseMs,
                enabled: this.options.enabled,
                truePeakDbtp: linearToDb(this.lastTruePeak),
                gainReductionDb: this.lastGainReductionDb,
                safetyClipCount: this.safetyClipCount
            };
        }

        _readSample(channel, absoluteFrame) {
            if (absoluteFrame < 0) return 0;
            const ring = this.sampleRings[channel];
            return ring[((absoluteFrame % this.ringSize) + this.ringSize) % this.ringSize];
        }

        _estimateIntervalPeak(intervalStart) {
            let peak = 0;
            for (let channel = 0; channel < this.channels; channel++) {
                const sampleA = this._readSample(channel, intervalStart);
                const sampleB = this._readSample(channel, intervalStart + 1);
                peak = Math.max(peak, Math.abs(sampleA), Math.abs(sampleB));
                for (const kernel of INTERPOLATION_KERNELS) {
                    let reconstructed = 0;
                    for (let tap = 0; tap < kernel.length; tap++) {
                        const absoluteFrame = intervalStart + tap - FIR_LEFT;
                        reconstructed += this._readSample(channel, absoluteFrame) * kernel[tap];
                    }
                    if (Number.isFinite(reconstructed)) peak = Math.max(peak, Math.abs(reconstructed));
                }
            }
            return Number.isFinite(peak) ? peak : 0;
        }

        _pushPeak(index, value) {
            const capacity = this.peakDequeCapacity;
            while (this.peakDequeTail !== this.peakDequeHead) {
                const previous = (this.peakDequeTail - 1 + capacity) % capacity;
                if (this.peakDequeValues[previous] > value) break;
                this.peakDequeTail = previous;
            }
            this.peakDequeIndices[this.peakDequeTail] = index;
            this.peakDequeValues[this.peakDequeTail] = value;
            this.peakDequeTail = (this.peakDequeTail + 1) % capacity;
        }

        _expirePeaks(minimumIndex) {
            while (this.peakDequeHead !== this.peakDequeTail &&
                this.peakDequeIndices[this.peakDequeHead] < minimumIndex) {
                this.peakDequeHead = (this.peakDequeHead + 1) % this.peakDequeCapacity;
            }
        }

        process(inputChannels, outputChannels) {
            const outputs = Array.isArray(outputChannels) ? outputChannels : [];
            if (!outputs.length) return;
            const input = Array.isArray(inputChannels) ? inputChannels : [];
            const frames = outputs[0]?.length || 0;
            if (!frames) return;
            const channelCount = Math.max(1, Math.min(8, outputs.length));
            if (channelCount !== this.channels) this._allocate(channelCount);
            const ceiling = dbToLinear(this.options.ceilingDb);
            const attackCoefficient = Math.exp(-1 / Math.max(1, this.sampleRate * this.options.attackMs / 1000));
            const releaseCoefficient = Math.exp(-1 / Math.max(1, this.sampleRate * this.options.releaseMs / 1000));

            for (let frame = 0; frame < frames; frame++) {
                const writeSlot = this.frameIndex % this.ringSize;
                for (let channel = 0; channel < this.channels; channel++) {
                    const source = input[channel];
                    const raw = source && frame < source.length ? source[frame] : 0;
                    this.sampleRings[channel][writeSlot] = Number.isFinite(raw) ? raw : 0;
                }

                const intervalIndex = this.frameIndex - FIR_FUTURE;
                if (intervalIndex >= 0) {
                    const intervalPeak = this._estimateIntervalPeak(intervalIndex);
                    this._pushPeak(intervalIndex, intervalPeak);
                }

                const outputFrame = this.frameIndex - this.latencyFrames;
                this._expirePeaks(outputFrame - 1);
                const detectedPeak = this.peakDequeHead === this.peakDequeTail
                    ? 0
                    : this.peakDequeValues[this.peakDequeHead];
                this.lastTruePeak = detectedPeak;

                let targetGain = 1;
                const workingCeiling = ceiling * 0.99; // reserve margin for Float32 output and gain modulation
                if (this.options.enabled && detectedPeak > workingCeiling && detectedPeak > 0) {
                    targetGain = workingCeiling / detectedPeak;
                }
                if (!this.options.enabled) {
                    this.gain = 1;
                } else {
                    const coefficient = targetGain < this.gain ? attackCoefficient : releaseCoefficient;
                    this.gain = targetGain + coefficient * (this.gain - targetGain);
                    this.gain = clamp(Number.isFinite(this.gain) ? this.gain : 1, 0, 1);
                }
                this.lastGainReductionDb = this.options.enabled ? Math.max(0, -linearToDb(this.gain)) : 0;

                for (let channel = 0; channel < this.channels; channel++) {
                    const output = outputs[channel];
                    if (!output || frame >= output.length) continue;
                    let sample = outputFrame >= 0 ? this._readSample(channel, outputFrame) : 0;
                    sample *= this.options.enabled ? this.gain : 1;
                    if (!Number.isFinite(sample)) sample = 0;
                    if (this.options.enabled && Math.abs(sample) > ceiling) {
                        sample = Math.sign(sample) * ceiling;
                        this.safetyClipCount++;
                    }
                    output[frame] = sample;
                }
                this.frameIndex++;
            }
        }
    }

    return {
        OVERSAMPLE,
        FIR_LEFT,
        FIR_RIGHT,
        DEFAULTS,
        dbToLinear,
        linearToDb,
        TruePeakLimiterCore
    };
});
