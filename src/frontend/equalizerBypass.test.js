'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { apply } = require('./equalizerBypass.js');

function filter(value) {
    return { gain: {
        value,
        calls: [],
        cancelScheduledValues(time) { this.calls.push(['cancel', time]); },
        setTargetAtTime(next, time, ramp) { this.calls.push(['target', next, time, ramp]); this.value = next; }
    } };
}

test('bypass flattens EQ on both active and preloaded track graphs', () => {
    const active = [filter(4), filter(-2)];
    const queued = [filter(4), filter(-2)];
    assert.equal(apply([active, queued], true, [4, -2], { currentTime: 10 }), 4);
    for (const node of [...active, ...queued]) assert.equal(node.gain.value, 0);
});

test('leaving bypass restores the latest EQ slider values', () => {
    const filters = [filter(0), filter(0), filter(0)];
    assert.equal(apply([filters], false, [6, -3, 1.5], { currentTime: 2 }), 3);
    assert.deepEqual(filters.map(node => node.gain.value), [6, -3, 1.5]);
});

test('duplicate filter references are only automated once', () => {
    const shared = filter(3);
    assert.equal(apply([[shared], [shared]], true, [3], { currentTime: 0 }), 1);
    assert.equal(shared.gain.calls.filter(call => call[0] === 'target').length, 1);
});
