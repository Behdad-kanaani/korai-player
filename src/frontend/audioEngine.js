/*
 * KORAI audio engine: a shared "master effects bus" that sits between every
 * per-track chain (source -> EQ -> analyser -> gain) and the audio output.
 *
 * Because the bus is shared, gapless playback / crossfades never have to
 * rebuild or re-route effects: every track simply connects into the same input.
 *
 * Signal path:
 *   input -> preamp -> low-cut -> bass shelf -> treble shelf -> warmth
 *         -> stereo width (mid/side) -> crossfeed -> reverb -> compressor
 *         -> balance -> limiter -> output (-> destination)
 */
(function exposeKoraiAudioEngine(root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiAudioEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function createKoraiAudioEngine(root) {
    'use strict';

    const EQ_BANDS = [60, 230, 910, 4000, 14000];
    const EQ_RANGE = 12;

    // Single source of truth for every continuous parameter (UI + validation).
    const PARAMS = {
        preampDb:      { min: -12, max: 12,  step: 0.5,  def: 0,   unit: 'dB' },
        lowCutHz:      { min: 0,   max: 200, step: 5,    def: 0,   unit: 'Hz' },
        bassDb:        { min: -12, max: 12,  step: 0.5,  def: 0,   unit: 'dB' },
        trebleDb:      { min: -12, max: 12,  step: 0.5,  def: 0,   unit: 'dB' },
        warmth:        { min: 0,   max: 1,   step: 0.05, def: 0,   unit: '%' },
        width:         { min: 0,   max: 2,   step: 0.05, def: 1,   unit: '%' },
        crossfeed:     { min: 0,   max: 1,   step: 0.05, def: 0,   unit: '%' },
        reverbMix:     { min: 0,   max: 1,   step: 0.05, def: 0,   unit: '%' },
        reverbDecay:   { min: 0.3, max: 6,   step: 0.1,  def: 1.6, unit: 's' },
        reverbDamping: { min: 0,   max: 1,   step: 0.05, def: 0.5, unit: '%' },
        compAmount:    { min: 0,   max: 1,   step: 0.05, def: 0,   unit: '%' },
        limiterCeilingDb: { min: -6, max: -0.1, step: 0.1, def: -1, unit: 'dB' },
        limiterAttackMs:  { min: 0.05, max: 0.5, step: 0.05, def: 0.5, unit: 'ms' },
        limiterReleaseMs: { min: 10, max: 500, step: 5, def: 80, unit: 'ms' },
        balance:       { min: -1,  max: 1,   step: 0.05, def: 0,   unit: 'bal' }
    };
    const BOOLEANS = { mono: false, limiter: true };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function defaultSettings() {
        const settings = { eq: new Array(EQ_BANDS.length).fill(0) };
        for (const [key, def] of Object.entries(PARAMS)) settings[key] = def.def;
        Object.assign(settings, BOOLEANS);
        return settings;
    }

    // Accepts anything (imported JSON, old saves) and returns a complete, in-range settings object.
    function sanitizeSettings(input) {
        const source = input && typeof input === 'object' ? input : {};
        const result = defaultSettings();
        for (const [key, def] of Object.entries(PARAMS)) {
            const raw = source[key];
            const number = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
            result[key] = Number.isFinite(number) ? clamp(number, def.min, def.max) : def.def;
        }
        for (const [key, def] of Object.entries(BOOLEANS)) {
            result[key] = typeof source[key] === 'boolean' ? source[key] : def;
        }
        if (Array.isArray(source.eq)) {
            result.eq = EQ_BANDS.map((_, index) => {
                const raw = source.eq[index];
                const number = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
                return Number.isFinite(number) ? clamp(number, -EQ_RANGE, EQ_RANGE) : 0;
            });
        }
        return result;
    }

    function settingsEqual(a, b) {
        const left = sanitizeSettings(a);
        const right = sanitizeSettings(b);
        for (const key of Object.keys(PARAMS)) {
            if (Math.abs(left[key] - right[key]) > 1e-6) return false;
        }
        for (const key of Object.keys(BOOLEANS)) {
            if (left[key] !== right[key]) return false;
        }
        return left.eq.every((value, index) => Math.abs(value - right.eq[index]) < 1e-6);
    }

    // Filter definitions shared by the real audio nodes and the response-curve preview.
    function toneFilterSpecs(settings) {
        const s = sanitizeSettings(settings);
        return [
            { role: 'lowCut', type: 'highpass', frequency: s.lowCutHz > 0 ? s.lowCutHz : 5, Q: 0.707, gain: 0 },
            { role: 'bass', type: 'lowshelf', frequency: 100, Q: 0.707, gain: s.bassDb },
            { role: 'treble', type: 'highshelf', frequency: 9000, Q: 0.707, gain: s.trebleDb }
        ];
    }

    function eqFilterSpecs(eq) {
        return EQ_BANDS.map((frequency, index) => ({
            role: `eq${index}`,
            type: index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking',
            frequency,
            Q: 1,
            gain: Number(eq?.[index]) || 0
        }));
    }

    // Exponentially decaying, progressively darker stereo noise = a synthetic room.
    function makeImpulseData(sampleRate, decaySeconds, damping, random = Math.random) {
        const rate = Math.max(8000, Number(sampleRate) || 44100);
        const decay = clamp(Number(decaySeconds) || PARAMS.reverbDecay.def, PARAMS.reverbDecay.min, PARAMS.reverbDecay.max);
        const damp = clamp(Number(damping) || 0, 0, 1);
        const length = Math.max(64, Math.floor(rate * decay));
        const fadeIn = Math.min(length, Math.floor(rate * 0.002));
        const channels = [new Float32Array(length), new Float32Array(length)];
        for (const data of channels) {
            let lowPassed = 0;
            for (let i = 0; i < length; i++) {
                const t = i / length;
                const envelope = Math.exp(-6.9 * t); // ~ -60 dB at the end of the tail
                const coefficient = 1 - damp * 0.92 * Math.min(1, t * 2);
                lowPassed += coefficient * ((random() * 2 - 1) - lowPassed);
                data[i] = lowPassed * envelope * (i < fadeIn ? i / fadeIn : 1);
            }
        }
        return channels;
    }

    function classifyDevice(label) {
        const text = String(label || '').toLowerCase();
        if (!text) return 'unknown';
        if (/bluetooth|airpods|buds|wh-1000|wf-1000|\bbt\b/.test(text)) return 'bluetooth';
        if (/headphone|headset|earphone|earbud|هدفون|هدست/.test(text)) return 'headphones';
        if (/hdmi|displayport|\btv\b|nvidia high definition/.test(text)) return 'hdmi';
        if (/usb|\bdac\b|interface/.test(text)) return 'usb';
        if (/speaker|monitor|lautsprecher|بلندگو|realtek/.test(text)) return 'speakers';
        return 'unknown';
    }

    const dbToGain = db => Math.pow(10, db / 20);

    class AudioEngine {
        constructor() {
            this.ctx = null;
            this.nodes = null;
            this.settings = defaultSettings();
            this.bypass = false;
            this.sinkId = 'default';
            this.listeners = new Set();
            this._reverbActive = false;
            this._irKey = '';
            this._irTimer = null;
            this._sinkRequestId = 0;
            this._sinkChange = Promise.resolve(false);
            this._limiterInitPromise = Promise.resolve(null);
            this.limiterStatus = { state: 'idle', mode: 'peak-reduction-fallback', reason: 'Audio graph has not been created.', latencyMs: 0, oversampling: 0, enabled: true, gainReductionDb: 0, truePeakDbtp: null, safetyClipCount: 0 };
        }

        get supported() {
            return typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
        }

        onChange(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
        }

        _emit(reason) {
            for (const callback of this.listeners) {
                try { callback(reason); } catch (error) { console.debug('Audio engine listener failed', error); }
            }
        }

        // Returns the node every track chain must connect to (instead of ctx.destination).
        getInput(ctx) {
            if (!this.nodes || this.ctx !== ctx) this._build(ctx);
            return this.nodes.input;
        }

        _build(ctx) {
            this._teardown();
            const n = {};
            const gain = (value = 1) => { const node = ctx.createGain(); node.gain.value = value; return node; };
            const biquad = (type) => { const node = ctx.createBiquadFilter(); node.type = type; return node; };

            n.input = gain();
            // Force stereo so mono files are up-mixed before the mid/side matrix.
            n.input.channelCount = 2;
            n.input.channelCountMode = 'explicit';
            n.input.channelInterpretation = 'speakers';
            n.preamp = gain();
            n.lowCut = biquad('highpass');
            n.bass = biquad('lowshelf');
            n.treble = biquad('highshelf');

            // Warmth: parallel soft-clip saturation.
            n.warmDry = gain();
            n.warmDrive = gain(2.2);
            n.shaper = ctx.createWaveShaper();
            const curve = new Float32Array(1024);
            for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 4 - 2);
            n.shaper.curve = curve;
            try { n.shaper.oversample = '4x'; } catch (_) { /* optional */ }
            n.warmWet = gain(0);
            n.warmSum = gain();

            // Stereo width via mid/side matrix.
            n.msSplit = ctx.createChannelSplitter(2);
            n.mid = gain(); n.side = gain(); n.sideWidth = gain(1); n.sideInverted = gain(-1);
            n.msL = gain(); n.msR = gain();
            n.msMerge = ctx.createChannelMerger(2);
            n.lToMid = gain(0.5); n.rToMid = gain(0.5); n.lToSide = gain(0.5); n.rToSide = gain(-0.5);

            // Headphone crossfeed: delayed, low-passed bleed into the opposite ear.
            n.cfSplit = ctx.createChannelSplitter(2);
            n.cfMerge = ctx.createChannelMerger(2);
            n.cfDirectL = gain(); n.cfDirectR = gain();
            n.cfLpL = biquad('lowpass'); n.cfLpR = biquad('lowpass');
            n.cfLpL.frequency.value = 700; n.cfLpR.frequency.value = 700;
            n.cfDelayL = ctx.createDelay(0.01); n.cfDelayR = ctx.createDelay(0.01);
            n.cfDelayL.delayTime.value = 0.00035; n.cfDelayR.delayTime.value = 0.00035;
            n.cfAmountL = gain(0); n.cfAmountR = gain(0);

            // Reverb: dry/wet around a generated impulse response.
            n.rvIn = gain(); n.rvDry = gain(); n.rvPre = ctx.createDelay(0.1);
            n.rvPre.delayTime.value = 0.018;
            n.convolver = ctx.createConvolver();
            n.rvWet = gain(0); n.rvOut = gain();

            n.compressor = ctx.createDynamicsCompressor();
            n.makeup = gain();
            n.panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
            n.limiter = ctx.createDynamicsCompressor(); // Native peak-reduction fallback only.
            n.limiterFallbackGain = gain(1);
            n.output = gain();
            n.meter = ctx.createAnalyser();
            n.meter.fftSize = 1024;

            n.input.connect(n.preamp);
            n.preamp.connect(n.lowCut);
            n.lowCut.connect(n.bass);
            n.bass.connect(n.treble);

            n.treble.connect(n.warmDry);
            n.treble.connect(n.warmDrive);
            n.warmDrive.connect(n.shaper);
            n.shaper.connect(n.warmWet);
            n.warmDry.connect(n.warmSum);
            n.warmWet.connect(n.warmSum);

            n.warmSum.connect(n.msSplit);
            n.msSplit.connect(n.lToMid, 0); n.msSplit.connect(n.rToMid, 1);
            n.msSplit.connect(n.lToSide, 0); n.msSplit.connect(n.rToSide, 1);
            n.lToMid.connect(n.mid); n.rToMid.connect(n.mid);
            n.lToSide.connect(n.side); n.rToSide.connect(n.side);
            n.side.connect(n.sideWidth);
            n.sideWidth.connect(n.sideInverted);
            n.mid.connect(n.msL); n.sideWidth.connect(n.msL);
            n.mid.connect(n.msR); n.sideInverted.connect(n.msR);
            n.msL.connect(n.msMerge, 0, 0);
            n.msR.connect(n.msMerge, 0, 1);

            n.msMerge.connect(n.cfSplit);
            n.cfSplit.connect(n.cfDirectL, 0); n.cfSplit.connect(n.cfDirectR, 1);
            n.cfSplit.connect(n.cfLpL, 0); n.cfSplit.connect(n.cfLpR, 1);
            n.cfLpL.connect(n.cfDelayL); n.cfLpR.connect(n.cfDelayR);
            n.cfDelayL.connect(n.cfAmountL); n.cfDelayR.connect(n.cfAmountR);
            n.cfDirectL.connect(n.cfMerge, 0, 0); n.cfDirectR.connect(n.cfMerge, 0, 1);
            n.cfAmountL.connect(n.cfMerge, 0, 1); // left bleeds into right
            n.cfAmountR.connect(n.cfMerge, 0, 0); // right bleeds into left

            n.cfMerge.connect(n.rvIn);
            n.rvIn.connect(n.rvDry);
            n.rvDry.connect(n.rvOut);
            n.convolver.connect(n.rvWet);
            n.rvWet.connect(n.rvOut);

            n.rvOut.connect(n.compressor);
            n.compressor.connect(n.makeup);
            let tail = n.makeup;
            if (n.panner) { tail.connect(n.panner); tail = n.panner; }
            n.limiterInput = tail;
            tail.connect(n.limiter);
            n.limiter.connect(n.limiterFallbackGain);
            n.limiterFallbackGain.connect(n.output);
            n.output.connect(n.meter);
            n.output.connect(ctx.destination);

            this.ctx = ctx;
            this.nodes = n;
            this._reverbActive = false;
            this._irKey = '';
            this.limiterStatus = { state: 'loading', mode: 'peak-reduction-fallback', reason: null, latencyMs: 0, oversampling: 0, enabled: this.settings.limiter, gainReductionDb: 0, truePeakDbtp: null, safetyClipCount: 0 };
            this._applyAll(true);
            this._limiterInitPromise = this._initializeTruePeakLimiter(ctx, n);
            if (this.sinkId && this.sinkId !== 'default') void this.setOutputDevice(this.sinkId);
        }

        _teardown() {
            clearTimeout(this._irTimer);
            if (!this.nodes) return;
            for (const node of Object.values(this.nodes)) {
                try { node && node.disconnect(); } catch (_) { /* already disconnected */ }
            }
            try { this.nodes.limiterWorklet?.port?.close?.(); } catch (_) { /* worklet already closed */ }
            this.nodes = null;
        }

        getEffectiveSettings() {
            if (!this.bypass) return this.settings;
            const flat = defaultSettings();
            // Keep the output safety stage and its tuning active while profile DSP is bypassed.
            for (const key of ['limiter', 'limiterCeilingDb', 'limiterAttackMs', 'limiterReleaseMs']) flat[key] = this.settings[key];
            return flat;
        }

        setSettings(settings, reason = 'settings') {
            this.settings = sanitizeSettings(settings);
            this._applyAll(false);
            this._emit(reason);
        }

        setParam(key, value) {
            if (key === 'eq') return false;
            const next = { ...this.settings };
            if (key in PARAMS) {
                if (value === null || value === undefined || value === '') return false;
                const number = Number(value);
                if (!Number.isFinite(number)) return false;
                next[key] = clamp(number, PARAMS[key].min, PARAMS[key].max);
            } else if (key in BOOLEANS) {
                if (typeof value !== 'boolean') return false;
                next[key] = value;
            } else {
                return false;
            }
            this.settings = next;
            this._applyAll(false);
            this._emit('param');
            return true;
        }

        setBypass(value) {
            if (typeof value !== 'boolean') return false;
            this.bypass = value;
            this._applyAll(false);
            this._emit('bypass');
            return true;
        }

        _applyAll(immediate) {
            const n = this.nodes;
            if (!n || !this.ctx) return;
            const s = sanitizeSettings(this.getEffectiveSettings());
            const now = this.ctx.currentTime;
            const set = (param, value) => {
                if (!param) return;
                if (immediate) param.setValueAtTime(value, now);
                else param.setTargetAtTime(value, now, 0.03);
            };

            set(n.preamp.gain, dbToGain(s.preampDb));
            for (const spec of toneFilterSpecs(s)) {
                const node = n[spec.role];
                set(node.frequency, spec.frequency);
                set(node.gain, spec.gain);
                node.Q.value = spec.Q;
            }

            set(n.warmDry.gain, 1 - 0.35 * s.warmth);
            set(n.warmWet.gain, 0.8 * s.warmth);

            const width = s.mono ? 0 : s.width;
            set(n.sideWidth.gain, width);

            set(n.cfDirectL.gain, 1 - s.crossfeed * 0.3);
            set(n.cfDirectR.gain, 1 - s.crossfeed * 0.3);
            set(n.cfAmountL.gain, s.crossfeed * 0.55);
            set(n.cfAmountR.gain, s.crossfeed * 0.55);

            const mix = s.reverbMix;
            set(n.rvDry.gain, Math.cos(mix * Math.PI / 2));
            set(n.rvWet.gain, Math.sin(mix * Math.PI / 2) * 1.2);
            this._updateReverb(s);

            const a = s.compAmount;
            // Smooth every live dynamics change to avoid zipper noise/clicks.
            set(n.compressor.threshold, a > 0 ? -12 - 30 * a : 0);
            set(n.compressor.ratio, 1 + 11 * a);
            set(n.compressor.knee, a > 0 ? 18 : 0);
            set(n.compressor.attack, 0.008);
            set(n.compressor.release, 0.22);
            set(n.makeup.gain, dbToGain(a * 9));

            if (n.panner) set(n.panner.pan, s.balance);

            // DynamicsCompressorNode provides peak reduction, not a standards-compliant
            // true-peak/brick-wall limiter. Keep its controls smoothed and label it honestly.
            set(n.limiter.threshold, s.limiter ? -2 : 0);
            set(n.limiter.ratio, s.limiter ? 20 : 1);
            set(n.limiter.knee, 0);
            set(n.limiter.attack, 0.001);
            set(n.limiter.release, 0.08);
            this._postLimiterSettings(s);
        }

        _workletUrl() {
            try {
                if (root.document?.baseURI) return new URL('truePeakLimiter.worklet.js', root.document.baseURI).href;
            } catch (_) { /* use relative path in tests or non-DOM hosts */ }
            return 'truePeakLimiter.worklet.js';
        }

        _setLimiterFallback(reason, error) {
            this.limiterStatus = {
                ...this.limiterStatus,
                state: 'unavailable',
                mode: 'peak-reduction-fallback',
                reason: String(error?.message || reason || 'AudioWorklet is unavailable.'),
                latencyMs: 0,
                oversampling: 0,
                gainReductionDb: 0,
                truePeakDbtp: null,
                safetyClipCount: 0,
                enabled: this.settings.limiter === true
            };
            this._emit('limiter-fallback');
            return this.limiterStatus;
        }

        async _initializeTruePeakLimiter(ctx, nodes) {
            const WorkletNode = root.AudioWorkletNode || (typeof AudioWorkletNode !== 'undefined' ? AudioWorkletNode : null);
            if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function' || !WorkletNode) {
                return this._setLimiterFallback('AudioWorklet is not supported in this runtime.');
            }
            try {
                await ctx.audioWorklet.addModule(this._workletUrl());
                if (this.ctx !== ctx || this.nodes !== nodes) return this.getLimiterStatus();
                const worklet = new WorkletNode(ctx, 'korai-true-peak-limiter', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2],
                    channelCount: 2,
                    channelCountMode: 'explicit',
                    processorOptions: {
                        ceilingDb: this.settings.limiterCeilingDb,
                        lookaheadMs: 5,
                        attackMs: this.settings.limiterAttackMs,
                        releaseMs: this.settings.limiterReleaseMs,
                        enabled: this.settings.limiter
                    }
                });
                nodes.limiterWorklet = worklet;
                worklet.port.onmessage = event => this._handleLimiterMessage(ctx, nodes, event.data || {});
                worklet.onprocessorerror = event => this._restorePeakReductionFallback(ctx, nodes,
                    new Error(event?.message || 'AudioWorklet processor stopped unexpectedly.'));

                // Rewire before playback begins (playTrack waits for this promise). This avoids
                // parallel dry/wet branches and the comb filtering a crossfade would create.
                nodes.limiterInput.disconnect();
                nodes.limiterFallbackGain.gain.setValueAtTime(0, ctx.currentTime);
                nodes.limiterInput.connect(worklet);
                worklet.connect(nodes.output);
                this.limiterStatus = {
                    state: 'ready', mode: 'true-peak', reason: null,
                    sampleRate: ctx.sampleRate,
                    latencyMs: (Math.ceil(ctx.sampleRate * 0.005) + 6) / ctx.sampleRate * 1000,
                    oversampling: 4, enabled: this.settings.limiter === true,
                    gainReductionDb: 0, truePeakDbtp: null, safetyClipCount: 0
                };
                this._postLimiterSettings(this.getEffectiveSettings());
                this._emit('limiter-ready');
                return this.getLimiterStatus();
            } catch (error) {
                if (this.ctx !== ctx || this.nodes !== nodes) return this.getLimiterStatus();
                if (nodes.limiterWorklet) {
                    this._restorePeakReductionFallback(ctx, nodes, error);
                    return this.getLimiterStatus();
                }
                return this._setLimiterFallback('True Peak Limiter initialization failed.', error);
            }
        }

        _handleLimiterMessage(ctx, nodes, message) {
            if (this.ctx !== ctx || this.nodes !== nodes || nodes.limiterWorklet == null) return;
            if (message.type === 'error') {
                this._restorePeakReductionFallback(ctx, nodes, new Error(message.message || 'True Peak Limiter processor error.'));
                return;
            }
            if (message.type === 'meter' || message.type === 'ready' || message.type === 'configured') {
                this.limiterStatus = {
                    ...this.limiterStatus,
                    sampleRate: Number(message.sampleRate) || ctx.sampleRate,
                    latencyMs: Number.isFinite(message.latencyMs) ? message.latencyMs : this.limiterStatus.latencyMs,
                    oversampling: Number(message.oversampling) || 4,
                    enabled: typeof message.enabled === 'boolean' ? message.enabled : this.limiterStatus.enabled,
                    gainReductionDb: Number.isFinite(message.gainReductionDb) ? message.gainReductionDb : 0,
                    truePeakDbtp: Number.isFinite(message.truePeakDbtp) ? message.truePeakDbtp : null,
                    safetyClipCount: Number.isFinite(message.safetyClipCount) ? message.safetyClipCount : 0
                };
            }
        }

        _restorePeakReductionFallback(ctx, nodes, error) {
            if (this.ctx !== ctx || this.nodes !== nodes || !nodes.limiterWorklet) return false;
            try { nodes.limiterWorklet.disconnect(); } catch (_) { /* processor may already be disconnected */ }
            try { nodes.limiterInput.disconnect(); } catch (_) { /* best effort */ }
            try {
                nodes.limiterInput.connect(nodes.limiter);
                nodes.limiterFallbackGain.gain.cancelScheduledValues(ctx.currentTime);
                nodes.limiterFallbackGain.gain.setValueAtTime(0, ctx.currentTime);
                nodes.limiterFallbackGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
            } catch (reconnectError) {
                console.error('Could not restore native peak-reduction fallback:', reconnectError);
            }
            try { nodes.limiterWorklet.port.close(); } catch (_) { /* already closed */ }
            nodes.limiterWorklet = null;
            this._setLimiterFallback('True Peak Limiter processor failed; native peak reduction was restored.', error);
            return true;
        }

        _postLimiterSettings(settings) {
            this.limiterStatus.enabled = settings.limiter === true;
            const worklet = this.nodes?.limiterWorklet;
            if (!worklet?.port) return false;
            try {
                worklet.port.postMessage({
                    type: 'configure',
                    settings: {
                        enabled: settings.limiter === true,
                        ceilingDb: settings.limiterCeilingDb,
                        attackMs: settings.limiterAttackMs,
                        releaseMs: settings.limiterReleaseMs
                    }
                });
                return true;
            } catch (error) {
                console.warn('Could not update True Peak Limiter settings:', error);
                return false;
            }
        }

        waitForLimiterReady() {
            return Promise.resolve(this._limiterInitPromise).catch(() => this.getLimiterStatus()).then(() => this.getLimiterStatus());
        }

        getLimiterStatus() {
            return { ...this.limiterStatus };
        }

        resetLimiter() {
            const worklet = this.nodes?.limiterWorklet;
            if (!worklet?.port) return false;
            try { worklet.port.postMessage({ type: 'reset' }); return true; }
            catch (_) { return false; }
        }

        _updateReverb(s) {
            const n = this.nodes;
            const wanted = s.reverbMix > 0.001;
            if (wanted) {
                const key = `${s.reverbDecay.toFixed(2)}|${s.reverbDamping.toFixed(2)}|${this.ctx.sampleRate}`;
                if (key !== this._irKey) {
                    clearTimeout(this._irTimer);
                    const build = () => {
                        if (!this.nodes || this.nodes !== n) return;
                        try {
                            const [left, right] = makeImpulseData(this.ctx.sampleRate, s.reverbDecay, s.reverbDamping);
                            const buffer = this.ctx.createBuffer(2, left.length, this.ctx.sampleRate);
                            buffer.copyToChannel(left, 0);
                            buffer.copyToChannel(right, 1);
                            n.convolver.buffer = buffer;
                            this._irKey = key;
                        } catch (error) {
                            console.warn('Could not build reverb impulse response:', error);
                        }
                    };
                    if (!this._irKey) build(); else this._irTimer = setTimeout(build, 140);
                }
            }
            // Only feed the convolver while it is audible so an idle reverb costs no CPU.
            if (wanted && !this._reverbActive) {
                n.rvIn.connect(n.rvPre);
                n.rvPre.connect(n.convolver);
                this._reverbActive = true;
            } else if (!wanted && this._reverbActive) {
                try { n.rvIn.disconnect(n.rvPre); n.rvPre.disconnect(n.convolver); } catch (_) { /* ignore */ }
                this._reverbActive = false;
            }
        }

        async setOutputDevice(deviceId) {
            const id = deviceId || 'default';
            const requestId = ++this._sinkRequestId;
            const context = this.ctx;

            // Before the first AudioContext exists, remember the user's choice; _build()
            // applies it as soon as a context becomes available.
            if (!context) {
                this.sinkId = id;
                return true;
            }
            if (typeof context.setSinkId !== 'function') {
                return id === this.sinkId;
            }

            // Serialize native sink changes. A slow earlier request must never finish
            // after a newer selection and silently leave the output on the wrong device.
            const apply = async () => {
                if (requestId !== this._sinkRequestId || context !== this.ctx) return false;
                try {
                    await context.setSinkId(id === 'default' ? '' : id);
                    if (requestId !== this._sinkRequestId || context !== this.ctx) return false;
                    this.sinkId = id;
                    this._emit('device');
                    return true;
                } catch (error) {
                    console.warn('Could not switch output device:', error);
                    return false;
                }
            };
            const operation = this._sinkChange.then(apply, apply);
            this._sinkChange = operation.catch(() => false);
            return operation;
        }

        // Peak level (dBFS) and total gain reduction (dB, positive) for the live meter.
        readMeter() {
            const n = this.nodes;
            if (!n) return { peakDb: -Infinity, reductionDb: 0 };
            const buffer = new Float32Array(n.meter.fftSize);
            n.meter.getFloatTimeDomainData(buffer);
            let peak = 0;
            for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
            const limiterReduction = this.limiterStatus.state === 'ready'
                ? Math.max(0, Number(this.limiterStatus.gainReductionDb) || 0)
                : Math.abs(Math.min(0, n.limiter.reduction || 0));
            const reduction = limiterReduction + Math.abs(Math.min(0, n.compressor.reduction || 0));
            return { peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity, reductionDb: reduction };
        }
    }

    return {
        EQ_BANDS, EQ_RANGE, PARAMS, BOOLEANS,
        clamp, defaultSettings, sanitizeSettings, settingsEqual,
        toneFilterSpecs, eqFilterSpecs, makeImpulseData, classifyDevice,
        AudioEngine,
        engine: new AudioEngine()
    };
});
