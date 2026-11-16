'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TruePeakLimiterCore, dbToLinear, OVERSAMPLE } = require('./truePeakLimiterCore.js');

function processWhole(core, inputChannels) {
    const length = inputChannels[0]?.length || 0;
    const output = inputChannels.map(() => new Float32Array(length));
    core.process(inputChannels, output);
    return output;
}

function peak(buffer, start = 0) {
    let value = 0;
    for (let i = start; i < buffer.length; i++) value = Math.max(value, Math.abs(buffer[i]));
    return value;
}

test('4x band-limited reconstruction detects an inter-sample peak above the PCM sample peak', () => {
    const core = new TruePeakLimiterCore(48000, { enabled: false, lookaheadMs: 5 });
    const input = new Float32Array(4096);
    for (let i = 0; i < input.length; i++) input[i] = 0.9 * Math.sin(2 * Math.PI * 0.1 * i);
    let samplePeak = 0;
    for (const sample of input) samplePeak = Math.max(samplePeak, Math.abs(sample));
    processWhole(core, [input]);
    assert.equal(OVERSAMPLE, 4);
    assert.ok(core.lastTruePeak > samplePeak + 0.02, `expected reconstructed peak ${core.lastTruePeak} > sample peak ${samplePeak}`);
});

test('lookahead delays audio by its reported frame latency', () => {
    const core = new TruePeakLimiterCore(48000, { enabled: false, lookaheadMs: 1 });
    const input = new Float32Array(160);
    input[0] = 0.5;
    const [output] = processWhole(core, [input]);
    assert.equal(core.latencyFrames, 54);
    assert.equal(output[core.latencyFrames], 0.5);
    assert.equal(peak(output.slice(0, core.latencyFrames)), 0);
});

test('bypass preserves delayed input without gain reduction or safety clipping', () => {
    const core = new TruePeakLimiterCore(48000, { enabled: false, ceilingDb: -6, lookaheadMs: 1 });
    const input = new Float32Array(160).fill(1.4);
    const [output] = processWhole(core, [input]);
    assert.ok(Math.abs(output[core.latencyFrames] - 1.4) < 1e-6);
    assert.equal(core.lastGainReductionDb, 0);
    assert.equal(core.safetyClipCount, 0);
});

test('lookahead gain control prevents output samples from exceeding the configured ceiling', () => {
    const ceiling = dbToLinear(-1);
    const core = new TruePeakLimiterCore(48000, {
        enabled: true, ceilingDb: -1, lookaheadMs: 5, attackMs: 0.5, releaseMs: 80
    });
    const input = new Float32Array(4096).fill(1.5);
    const [output] = processWhole(core, [input]);
    assert.ok(peak(output, core.latencyFrames) <= ceiling + 1e-6);
    assert.ok(core.lastGainReductionDb > 0);
    assert.equal(core.safetyClipCount, 0, 'the safety clamp should not be the normal gain-control path');
});

test('limiter attenuates on inter-sample peaks even when every PCM sample is below ceiling', () => {
    const core = new TruePeakLimiterCore(48000, {
        enabled: true, ceilingDb: -1, lookaheadMs: 5, attackMs: 0.5, releaseMs: 80
    });
    const input = new Float32Array(4096);
    let samplePeak = 0;
    for (let i = 0; i < input.length; i++) {
        input[i] = 0.9 * Math.sin(2 * Math.PI * 0.1 * i);
        samplePeak = Math.max(samplePeak, Math.abs(input[i]));
    }
    const [output] = processWhole(core, [input]);
    assert.ok(samplePeak < dbToLinear(-1));
    assert.ok(core.lastTruePeak > dbToLinear(-1));
    assert.ok(core.lastGainReductionDb > 0);
    assert.ok(peak(output, core.latencyFrames) < samplePeak);
});

test('the oversampled output reconstruction remains below the configured true-peak ceiling', () => {
    const ceiling = dbToLinear(-1);
    const input = new Float32Array(8192);
    for (let i = 0; i < input.length; i++) input[i] = 1.3 * Math.sin(2 * Math.PI * 0.1 * i + 0.39);
    const limiter = new TruePeakLimiterCore(48000, { enabled: true, ceilingDb: -1, lookaheadMs: 5 });
    const [limited] = processWhole(limiter, [input]);
    const measurement = new TruePeakLimiterCore(48000, { enabled: false, lookaheadMs: 5 });
    processWhole(measurement, [limited]);
    assert.ok(measurement.lastTruePeak <= ceiling + 0.001,
        `output true peak ${measurement.lastTruePeak} exceeded ceiling ${ceiling}`);
    assert.equal(limiter.safetyClipCount, 0);
});

test('NaN and Infinity input samples are converted to finite silence', () => {
    const core = new TruePeakLimiterCore(48000, { enabled: true });
    const input = new Float32Array([0.25, NaN, Infinity, -Infinity, -0.25, 0.5]);
    const [output] = processWhole(core, [input]);
    assert.ok([...output].every(Number.isFinite));
});

test('arbitrary AudioWorklet render-quantum boundaries produce the same output as one block', () => {
    const input = new Float32Array(3072);
    for (let i = 0; i < input.length; i++) input[i] = 1.2 * Math.sin(i * 0.173);
    const wholeCore = new TruePeakLimiterCore(48000, { enabled: true });
    const [whole] = processWhole(wholeCore, [input]);

    const chunkedCore = new TruePeakLimiterCore(48000, { enabled: true });
    const chunked = new Float32Array(input.length);
    const sizes = [1, 7, 128, 3, 257, 64, 511];
    let offset = 0;
    let sizeIndex = 0;
    while (offset < input.length) {
        const count = Math.min(sizes[sizeIndex++ % sizes.length], input.length - offset);
        const inputChunk = input.slice(offset, offset + count);
        const outputChunk = new Float32Array(count);
        chunkedCore.process([inputChunk], [outputChunk]);
        chunked.set(outputChunk, offset);
        offset += count;
    }
    for (let i = 0; i < whole.length; i++) assert.ok(Math.abs(whole[i] - chunked[i]) < 1e-7, `frame ${i} differs`);
});

test('stereo gain is linked so a transient in one channel preserves the stereo image', () => {
    const core = new TruePeakLimiterCore(48000, { enabled: true, lookaheadMs: 2 });
    const left = new Float32Array(1024).fill(1.4);
    const right = new Float32Array(1024).fill(0.25);
    const output = [new Float32Array(1024), new Float32Array(1024)];
    core.process([left, right], output);
    const index = core.latencyFrames + 20;
    const ratio = output[1][index] / output[0][index];
    assert.ok(Math.abs(ratio - (0.25 / 1.4)) < 1e-5);
});

test('attack and release are configurable within safe bounds', () => {
    const core = new TruePeakLimiterCore(48000, { attackMs: 0.2, releaseMs: 120 });
    const status = core.configure({ attackMs: 0.35, releaseMs: 240, ceilingDb: -2.5 });
    assert.equal(status.attackMs, 0.35);
    assert.equal(status.releaseMs, 240);
    assert.equal(status.ceilingDb, -2.5);
    assert.equal(core.configure({ attackMs: 50, releaseMs: 0 }).attackMs, 0.5);
    assert.equal(core.getStatus().releaseMs, 10);
});

test('sample-rate changes recalculate latency and clear stale buffered audio', () => {
    const core = new TruePeakLimiterCore(44100, { lookaheadMs: 5, enabled: false });
    const before = core.latencyFrames;
    const input = new Float32Array(600).fill(0.7);
    processWhole(core, [input]);
    assert.equal(core.setSampleRate(96000), true);
    assert.ok(core.latencyFrames > before);
    assert.equal(core.sampleRate, 96000);
    assert.equal(core.frameIndex, 0);
    const [afterChange] = processWhole(core, [new Float32Array(core.latencyFrames + 4)]);
    assert.equal(peak(afterChange), 0);
    assert.equal(core.setSampleRate(96000), false);
    assert.throws(() => core.setSampleRate(NaN), /Sample rate/);
});

test('reset flushes lookahead state for stop, seek and ordinary track replacement', () => {
    const core = new TruePeakLimiterCore(48000, { enabled: false });
    processWhole(core, [new Float32Array(512).fill(0.8)]);
    core.reset();
    const [output] = processWhole(core, [new Float32Array(core.latencyFrames + 8)]);
    assert.equal(peak(output), 0);
    assert.equal(core.gain, 1);
    assert.equal(core.safetyClipCount, 0);
});
