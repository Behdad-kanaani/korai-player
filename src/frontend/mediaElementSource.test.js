const test = require('node:test');
const assert = require('node:assert/strict');
const { acquire } = require('./mediaElementSource');

function fakeSource(context) {
    return {
        context,
        disconnectCalls: 0,
        disconnect() { this.disconnectCalls += 1; }
    };
}

test('reuses and disconnects the existing source in the same AudioContext', () => {
    const context = {};
    const element = { _koraiSourceNode: fakeSource(context), _koraiSourceContext: context };
    let created = 0;
    const result = acquire(element, context, () => { created += 1; return fakeSource(context); }, () => ({}) );
    assert.equal(result.element, element);
    assert.equal(result.source, element._koraiSourceNode);
    assert.equal(result.replaced, false);
    assert.equal(result.source.disconnectCalls, 1);
    assert.equal(created, 0);
});

test('creates and records a source for a media element not previously connected', () => {
    const context = {};
    const element = {};
    const result = acquire(element, context, (_element, ctx) => fakeSource(ctx), () => ({}) );
    assert.equal(result.element, element);
    assert.equal(result.source.context, context);
    assert.equal(element._koraiSourceNode, result.source);
    assert.equal(element._koraiSourceContext, context);
    assert.equal(result.replaced, false);
});

test('replaces a media element when its source belongs to a different context', () => {
    const oldContext = {};
    const newContext = {};
    const oldElement = { _koraiSourceNode: fakeSource(oldContext), _koraiSourceContext: oldContext };
    const newElement = {};
    let factoryCalls = 0;
    const result = acquire(
        oldElement,
        newContext,
        (_element, ctx) => { factoryCalls += 1; return fakeSource(ctx); },
        element => { assert.equal(element, oldElement); return newElement; }
    );
    assert.equal(result.element, newElement);
    assert.equal(result.replaced, true);
    assert.equal(result.source.context, newContext);
    assert.equal(factoryCalls, 1);
});

test('recreates the media element if the browser rejects a second source creation', () => {
    const context = {};
    const oldElement = {};
    const newElement = {};
    const result = acquire(
        oldElement,
        context,
        element => {
            if (element === oldElement) throw new DOMException('already connected', 'InvalidStateError');
            return fakeSource(context);
        },
        () => newElement
    );
    assert.equal(result.element, newElement);
    assert.equal(result.replaced, true);
    assert.equal(result.source.context, context);
});

test('does not silently accept a failed replacement source creation', () => {
    const context = {};
    assert.throws(() => acquire({}, context, () => { throw new Error('source failed'); }, () => ({})), /source failed/);
});
