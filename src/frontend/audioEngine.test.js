'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const audio = require('./audioEngine.js');

function fakeParam(value = 0) {
    return {
        value,
        targets: [],
        setValueAtTime(next, time) { this.value = next; this.targets.push({ type: 'set', value: next, time }); },
        setTargetAtTime(next, time, constant) { this.value = next; this.targets.push({ type: 'target', value: next, time, constant }); },
        cancelScheduledValues() {}
    };
}

function fakeNode() {
    return {
        gain: fakeParam(1), frequency: fakeParam(350), Q: fakeParam(1), pan: fakeParam(0),
        threshold: fakeParam(0), ratio: fakeParam(1), knee: fakeParam(0),
        attack: fakeParam(0.003), release: fakeParam(0.25), delayTime: fakeParam(0),
        reduction: 0, connections: [],
        connect(target) { this.connections.push(target); return target || this; },
        disconnect(target) { this.connections = target ? this.connections.filter(node => node !== target) : []; },
        getFloatTimeDomainData(buffer) { buffer.fill(0); }
    };
}

function fakeContext(options = {}) {
    return {
        currentTime: 4,
        sampleRate: 48000,
        audioWorklet: options.audioWorklet,
        destination: fakeNode(),
        createGain: fakeNode,
        createBiquadFilter: fakeNode,
        createWaveShaper: () => ({ ...fakeNode(), curve: null, oversample: 'none' }),
        createChannelSplitter: fakeNode,
        createChannelMerger: fakeNode,
        createDelay: fakeNode,
        createConvolver: () => ({ ...fakeNode(), buffer: null }),
        createDynamicsCompressor: fakeNode,
        createStereoPanner: fakeNode,
        createAnalyser: () => ({ ...fakeNode(), fftSize: 0 }),
        createBuffer: (channels, length) => ({
            copyToChannel() {}, numberOfChannels: channels, length
        })
    };
}

test('null and empty persisted DSP values fall back to defaults, not numeric zero', () => {
    const settings = audio.sanitizeSettings({
        preampDb: null, reverbDecay: null, width: '', eq: [null, '', 3, undefined, 0]
    });
    assert.equal(settings.preampDb, audio.PARAMS.preampDb.def);
    assert.equal(settings.reverbDecay, audio.PARAMS.reverbDecay.def);
    assert.equal(settings.width, audio.PARAMS.width.def);
    assert.deepEqual(settings.eq, [0, 0, 3, 0, 0]);
});

test('boolean DSP controls reject string values instead of treating "false" as true', () => {
    const engine = new audio.AudioEngine();
    assert.equal(engine.setParam('limiter', 'false'), false);
    assert.equal(engine.settings.limiter, true);
    assert.equal(engine.setParam('mono', false), true);
    assert.equal(engine.settings.mono, false);
});

test('failed output-device switch does not persist the requested device', async () => {
    const engine = new audio.AudioEngine();
    engine.ctx = { setSinkId: async () => { throw new Error('device unavailable'); } };
    engine.sinkId = 'default';
    assert.equal(await engine.setOutputDevice('missing-device'), false);
    assert.equal(engine.sinkId, 'default');
});

test('rapid output-device changes are serialized and newest selection wins', async () => {
    const engine = new audio.AudioEngine();
    let releaseFirst;
    let applied = null;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    engine.ctx = {
        setSinkId: async id => {
            if (id === 'device-a') await firstGate;
            applied = id;
        }
    };
    const first = engine.setOutputDevice('device-a');
    await Promise.resolve();
    const second = engine.setOutputDevice('device-b');
    releaseFirst();
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.equal(applied, 'device-b');
    assert.equal(engine.sinkId, 'device-b');
});

test('dynamics controls use smoothed AudioParam automation', () => {
    const engine = new audio.AudioEngine();
    const context = fakeContext();
    engine.getInput(context);
    engine.setSettings({ ...audio.defaultSettings(), compAmount: 0.5, limiter: true });
    assert.ok(engine.nodes.compressor.threshold.targets.some(item => item.type === 'target' && item.value < 0));
    assert.ok(engine.nodes.limiter.threshold.targets.some(item => item.type === 'target' && item.value === -2));
});

test('live numeric parameter updates reject null and empty values instead of forcing zero', () => {
    const engine = new audio.AudioEngine();
    engine.settings.preampDb = 6;
    assert.equal(engine.setParam('preampDb', null), false);
    assert.equal(engine.setParam('preampDb', ''), false);
    assert.equal(engine.settings.preampDb, 6);
});

test('EQ bypass accepts only explicit boolean values', () => {
    const engine = new audio.AudioEngine();
    assert.equal(engine.setBypass('false'), false);
    assert.equal(engine.bypass, false);
    assert.equal(engine.setBypass(true), true);
    assert.equal(engine.bypass, true);
});


class FakeAudioWorkletNode {
    constructor(context, name, options) {
        this.context = context;
        this.name = name;
        this.options = options;
        this.connections = [];
        this.port = {
            messages: [],
            onmessage: null,
            postMessage(message) { this.messages.push(message); },
            close() {}
        };
    }
    connect(target) { this.connections.push(target); return target; }
    disconnect(target) { this.connections = target ? this.connections.filter(node => node !== target) : []; }
}

test('worklet URL resolves beside the frontend document on the privileged KORAI scheme', () => {
    const previous = global.document;
    global.document = { baseURI: 'korai://app/index.html?mode=mini' };
    try {
        const engine = new audio.AudioEngine();
        assert.equal(engine._workletUrl(), 'korai://app/truePeakLimiter.worklet.js');
    } finally {
        if (previous === undefined) delete global.document;
        else global.document = previous;
    }
});

test('AudioWorklet limiter replaces the native fallback before playback and reports latency', async () => {
    const previous = global.AudioWorkletNode;
    global.AudioWorkletNode = FakeAudioWorkletNode;
    try {
        let moduleUrl = null;
        const context = fakeContext({ audioWorklet: { addModule: async url => { moduleUrl = url; } } });
        const engine = new audio.AudioEngine();
        const input = engine.getInput(context);
        const status = await engine.waitForLimiterReady();
        assert.equal(status.state, 'ready');
        assert.equal(status.mode, 'true-peak');
        assert.equal(status.oversampling, 4);
        assert.ok(status.latencyMs >= 5);
        assert.equal(moduleUrl, 'truePeakLimiter.worklet.js');
        assert.equal(input, engine.nodes.input);
        assert.equal(engine.nodes.limiterInput.connections[0], engine.nodes.limiterWorklet);
        assert.equal(engine.nodes.limiterWorklet.connections[0], engine.nodes.output);
        assert.equal(engine.nodes.limiterFallbackGain.gain.value, 0);
        assert.ok(engine.nodes.limiter.connections.includes(engine.nodes.limiterFallbackGain));
    } finally {
        if (previous === undefined) delete global.AudioWorkletNode;
        else global.AudioWorkletNode = previous;
    }
});

test('AudioWorklet absence keeps the native peak-reduction fallback and reports unavailable', async () => {
    const previous = global.AudioWorkletNode;
    delete global.AudioWorkletNode;
    try {
        const context = fakeContext();
        const engine = new audio.AudioEngine();
        engine.getInput(context);
        const status = await engine.waitForLimiterReady();
        assert.equal(status.state, 'unavailable');
        assert.equal(status.mode, 'peak-reduction-fallback');
        assert.match(status.reason, /not supported/i);
        assert.ok(engine.nodes.limiterInput.connections.includes(engine.nodes.limiter));
        assert.ok(engine.nodes.limiter.connections.includes(engine.nodes.limiterFallbackGain));
        assert.ok(engine.nodes.limiterFallbackGain.connections.includes(engine.nodes.output));
    } finally {
        if (previous !== undefined) global.AudioWorkletNode = previous;
    }
});

test('AudioWorklet API without AudioWorkletNode constructor is reported as unsupported', async () => {
    const previous = global.AudioWorkletNode;
    delete global.AudioWorkletNode;
    try {
        const context = fakeContext({ audioWorklet: { addModule: async () => {} } });
        const engine = new audio.AudioEngine();
        engine.getInput(context);
        const status = await engine.waitForLimiterReady();
        assert.equal(status.state, 'unavailable');
        assert.match(status.reason, /not supported/i);
        assert.ok(engine.nodes.limiterInput.connections.includes(engine.nodes.limiter));
    } finally {
        if (previous !== undefined) global.AudioWorkletNode = previous;
    }
});

test('AudioWorklet module load failure falls back without leaving a disconnected output', async () => {
    const previous = global.AudioWorkletNode;
    global.AudioWorkletNode = FakeAudioWorkletNode;
    try {
        const context = fakeContext({ audioWorklet: { addModule: async () => { throw new Error('module blocked'); } } });
        const engine = new audio.AudioEngine();
        engine.getInput(context);
        const status = await engine.waitForLimiterReady();
        assert.equal(status.state, 'unavailable');
        assert.match(status.reason, /module blocked/);
        assert.ok(engine.nodes.limiterInput.connections.includes(engine.nodes.limiter));
        assert.ok(engine.nodes.limiter.connections.includes(engine.nodes.limiterFallbackGain));
        assert.ok(engine.nodes.limiterFallbackGain.connections.includes(engine.nodes.output));
    } finally {
        if (previous === undefined) delete global.AudioWorkletNode;
        else global.AudioWorkletNode = previous;
    }
});

test('processor failure restores the connected native fallback', async () => {
    const previous = global.AudioWorkletNode;
    global.AudioWorkletNode = FakeAudioWorkletNode;
    try {
        const context = fakeContext({ audioWorklet: { addModule: async () => {} } });
        const engine = new audio.AudioEngine();
        engine.getInput(context);
        await engine.waitForLimiterReady();
        const failedWorklet = engine.nodes.limiterWorklet;
        failedWorklet.onprocessorerror({ message: 'processor crashed' });
        assert.equal(engine.getLimiterStatus().state, 'unavailable');
        assert.equal(engine.nodes.limiterWorklet, null);
        assert.ok(engine.nodes.limiterInput.connections.includes(engine.nodes.limiter));
        assert.ok(engine.nodes.limiter.connections.includes(engine.nodes.limiterFallbackGain));
        assert.ok(engine.nodes.limiterFallbackGain.connections.includes(engine.nodes.output));
    } finally {
        if (previous === undefined) delete global.AudioWorkletNode;
        else global.AudioWorkletNode = previous;
    }
});

test('active and preloaded track gains share one master limiter across crossfade', async () => {
    const previous = global.AudioWorkletNode;
    global.AudioWorkletNode = FakeAudioWorkletNode;
    try {
        const context = fakeContext({ audioWorklet: { addModule: async () => {} } });
        const engine = new audio.AudioEngine();
        const masterA = engine.getInput(context);
        const masterB = engine.getInput(context);
        const outgoingGain = context.createGain();
        const incomingGain = context.createGain();
        outgoingGain.connect(masterA);
        incomingGain.connect(masterB);
        await engine.waitForLimiterReady();
        assert.equal(masterA, masterB);
        assert.equal(engine.nodes.limiterWorklet.name, 'korai-true-peak-limiter');
        assert.equal(outgoingGain.connections[0], engine.nodes.input);
        assert.equal(incomingGain.connections[0], engine.nodes.input);
    } finally {
        if (previous === undefined) delete global.AudioWorkletNode;
        else global.AudioWorkletNode = previous;
    }
});

test('limiter parameters persist through profile bypass and reset is sent for seek/track replacement', async () => {
    const previous = global.AudioWorkletNode;
    global.AudioWorkletNode = FakeAudioWorkletNode;
    try {
        const context = fakeContext({ audioWorklet: { addModule: async () => {} } });
        const engine = new audio.AudioEngine();
        engine.getInput(context);
        await engine.waitForLimiterReady();
        engine.setParam('limiterCeilingDb', -2.2);
        engine.setParam('limiterAttackMs', 0.25);
        engine.setParam('limiterReleaseMs', 150);
        engine.setBypass(true);
        const configure = engine.nodes.limiterWorklet.port.messages.filter(message => message.type === 'configure').at(-1);
        assert.equal(configure.settings.enabled, true);
        assert.equal(configure.settings.ceilingDb, -2.2);
        assert.equal(configure.settings.attackMs, 0.25);
        assert.equal(configure.settings.releaseMs, 150);
        assert.equal(engine.resetLimiter(), true);
        assert.equal(engine.nodes.limiterWorklet.port.messages.at(-1).type, 'reset');
    } finally {
        if (previous === undefined) delete global.AudioWorkletNode;
        else global.AudioWorkletNode = previous;
    }
});
