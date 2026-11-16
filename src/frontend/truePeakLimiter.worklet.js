import './truePeakLimiterCore.js';

const CoreApi = globalThis.KoraiTruePeakLimiterCore;

class KoraiTruePeakLimiterProcessor extends AudioWorkletProcessor {
    constructor(options = {}) {
        super();
        if (!CoreApi?.TruePeakLimiterCore) throw new Error('KORAI True Peak Limiter DSP core failed to load.');
        this.core = new CoreApi.TruePeakLimiterCore(sampleRate, options.processorOptions || {});
        this._reportFrames = 0;
        this._reportInterval = Math.max(1, Math.floor(sampleRate / 10));
        this.port.onmessage = event => this._handleMessage(event.data || {});
        this.port.postMessage({ type: 'ready', ...this.core.getStatus() });
    }

    _handleMessage(message) {
        try {
            if (message.type === 'configure') {
                this.core.configure(message.settings || {});
                this.port.postMessage({ type: 'configured', ...this.core.getStatus() });
            } else if (message.type === 'reset') {
                this.core.reset();
                this.port.postMessage({ type: 'reset', ...this.core.getStatus() });
            } else if (message.type === 'sample-rate') {
                this.core.setSampleRate(message.sampleRate);
                this.port.postMessage({ type: 'sample-rate', ...this.core.getStatus() });
            }
        } catch (error) {
            this.port.postMessage({ type: 'error', message: error?.message || 'Limiter configuration failed.' });
        }
    }

    process(inputs, outputs) {
        const input = inputs[0] || [];
        const output = outputs[0] || [];
        this.core.process(input, output);
        this._reportFrames += output[0]?.length || 0;
        if (this._reportFrames >= this._reportInterval) {
            this._reportFrames %= this._reportInterval;
            this.port.postMessage({ type: 'meter', ...this.core.getStatus() });
        }
        return true;
    }
}

registerProcessor('korai-true-peak-limiter', KoraiTruePeakLimiterProcessor);
