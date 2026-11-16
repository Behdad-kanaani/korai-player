const test = require('node:test');
const assert = require('node:assert/strict');
const { rangeFromHeader } = require('./byteRange');

const SIZE = 1000;

test('parses explicit and open-ended byte ranges', () => {
    assert.deepEqual(rangeFromHeader('bytes=10-19', SIZE), { start: 10, end: 19 });
    assert.deepEqual(rangeFromHeader('bytes=900-', SIZE), { start: 900, end: 999 });
});

test('parses suffix ranges and clamps them to the file size', () => {
    assert.deepEqual(rangeFromHeader('bytes=-100', SIZE), { start: 900, end: 999 });
    assert.deepEqual(rangeFromHeader('bytes=-2000', SIZE), { start: 0, end: 999 });
});

test('clamps an explicit end that exceeds the file size', () => {
    assert.deepEqual(rangeFromHeader('bytes=900-2000', SIZE), { start: 900, end: 999 });
});

test('ignores unsupported range units', () => {
    assert.equal(rangeFromHeader('items=0-10', SIZE), null);
});

test('rejects malformed, unsafe and multi-range requests', () => {
    for (const header of [
        'bytes=', 'bytes=-', 'bytes=abc-10', 'bytes=10-abc', 'bytes=10-9',
        'bytes=1000-1001', 'bytes=-0', 'bytes=1-2,4-5', 'bytes=1x-2'
    ]) {
        assert.throws(() => rangeFromHeader(header, SIZE), undefined, header);
    }
});

test('rejects invalid file sizes when parsing a byte range', () => {
    assert.throws(() => rangeFromHeader('bytes=0-1', 0), /File size/);
    assert.throws(() => rangeFromHeader('bytes=0-1', Number.MAX_SAFE_INTEGER + 1), /File size/);
});
