'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CoreApi = require('./truePeakLimiterCore.js');

function loadProcessor() {
    let RegisteredProcessor = null;
    class FakeAudioWorkletProcessor {
        constructor() {
            const messages = [];
            this.port = {
                messages,
                onmessage: null,
                postMessage(message) { messages.push(message); },
                close() {}
            };
        }
    }
    const sandbox = {
        AudioWorkletProcessor: FakeAudioWorkletProcessor,
        KoraiTruePeakLimiterCore: CoreApi,
        sampleRate: 48000,
        registerProcessor(name, processor) { RegisteredProcessor = { name, processor }; }
    };
    sandbox.globalThis = sandbox;
    const source = fs.readFileSync(path.join(__dirname, 'truePeakLimiter.worklet.js'), 'utf8')
        .replace(/^import\s+['"]\.\/truePeakLimiterCore\.js['"];\s*/m, '');
    vm.runInNewContext(source, sandbox, { filename: 'truePeakLimiter.worklet.js' });
    return RegisteredProcessor;
}

test('AudioWorklet registers the KORAI processor and reports ready status', () => {
    const registered = loadProcessor();
    assert.equal(registered.name, 'korai-true-peak-limiter');
    const processor = new registered.processor({ processorOptions: { lookaheadMs: 2 } });
    assert.equal(processor.port.messages[0].type, 'ready');
    assert.equal(processor.port.messages[0].oversampling, 4);
});

test('AudioWorklet accepts live configuration and reset commands', () => {
    const Processor = loadProcessor().processor;
    const processor = new Processor({ processorOptions: {} });
    processor.port.onmessage({ data: { type: 'configure', settings: { ceilingDb: -2, releaseMs: 120 } } });
    assert.equal(processor.port.messages.at(-1).type, 'configured');
    assert.equal(processor.port.messages.at(-1).ceilingDb, -2);
    processor.port.onmessage({ data: { type: 'reset' } });
    assert.equal(processor.port.messages.at(-1).type, 'reset');
    processor.port.onmessage({ data: { type: 'sample-rate', sampleRate: 96000 } });
    assert.equal(processor.port.messages.at(-1).type, 'sample-rate');
    assert.equal(processor.port.messages.at(-1).sampleRate, 96000);
});

test('AudioWorklet processes empty-input render quanta without throwing and keeps output finite', () => {
    const Processor = loadProcessor().processor;
    const processor = new Processor({ processorOptions: {} });
    const output = [new Float32Array(128), new Float32Array(128)];
    assert.equal(processor.process([], [output]), true);
    assert.ok(output.every(channel => [...channel].every(Number.isFinite)));
});
