'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEbur128Output } = require('./intelligence');

test('parses full-track EBU R128 integrated loudness, maximum short-term and true peak', () => {
  const output = `
[Parsed_ebur128_0] t: 3.9 M: -18.0 S: -17.5 I: -19.2 LUFS LRA: 2.0 LU FTPK: -1.2 dBFS TPK: -1.0 dBFS
[Parsed_ebur128_0] t: 4.0 M: -17.0 S: -16.8 I: -19.1 LUFS LRA: 2.0 LU FTPK: -0.8 dBFS TPK: -0.7 dBFS
Summary:
Integrated loudness:
I: -19.1 LUFS
Loudness range:
LRA: 2.0 LU
True peak:
Peak: -0.7 dBFS
`;
  const result = parseEbur128Output(output);
  assert.equal(result.status, 'measured');
  assert.equal(result.integratedLufs, -19.1);
  assert.equal(result.shortTermMaxLufs, -16.8);
  assert.equal(result.loudnessRangeLu, 2);
  assert.equal(result.truePeakDbtp, -0.7);
  assert.equal(result.standard, 'EBU R128 / ITU-R BS.1770');
});

test('does not claim a measurement when Integrated LUFS or true peak is missing', () => {
  assert.equal(parseEbur128Output('I: -18.0 LUFS'), null);
  assert.equal(parseEbur128Output('Peak: -1.0 dBFS'), null);
  assert.equal(parseEbur128Output(''), null);
});

test('handles valid measurements when no short-term windows are emitted', () => {
  const result = parseEbur128Output('I: -20.0 LUFS\nLRA: 4.0 LU\nPeak: -2.0 dBFS');
  assert.equal(result.integratedLufs, -20);
  assert.equal(result.shortTermMaxLufs, null);
  assert.equal(result.loudnessRangeLu, 4);
  assert.equal(result.truePeakDbtp, -2);
});
