'use strict';

const FFT_SIZE = 4096;
const FFT_HALF_SIZE = FFT_SIZE / 2;
const FFT_WINDOW = Float64Array.from({ length: FFT_SIZE }, (_, index) =>
  0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1))
);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_PROFILES = [
  { mode: 'major', values: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88] },
  { mode: 'minor', values: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] }
];

function fft(real, imaginary) {
  let reversed = 0;
  for (let index = 1; index < FFT_SIZE; index++) {
    let bit = FFT_SIZE >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }

  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const halfSize = size >> 1;
    const angle = -2 * Math.PI / size;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < FFT_SIZE; start += size) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < halfSize; offset++) {
        const even = start + offset;
        const odd = even + halfSize;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextTwiddleReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}

function pearsonCorrelation(left, right) {
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquareSum = 0;
  let rightSquareSum = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] - meanLeft;
    const b = right[index] - meanRight;
    numerator += a * b;
    leftSquareSum += a * a;
    rightSquareSum += b * b;
  }
  const denominator = Math.sqrt(leftSquareSum * rightSquareSum);
  return denominator > 0 ? numerator / denominator : 0;
}

function detectMusicalKey(samples, sampleRate) {
  if (!samples || samples.length < FFT_SIZE * 2 || !Number.isFinite(sampleRate) || sampleRate < 4000) {
    return { key: null, tonic: null, mode: null, confidence: 0, source: 'unavailable' };
  }
  let totalSquareSum = 0;
  for (let index = 0; index < samples.length; index++) totalSquareSum += samples[index] * samples[index];
  const rms = Math.sqrt(totalSquareSum / samples.length);
  if (!Number.isFinite(rms) || rms < 0.002) {
    return { key: null, tonic: null, mode: null, confidence: 0, source: 'unavailable' };
  }

  const availableFrames = Math.floor((samples.length - FFT_SIZE) / (FFT_SIZE / 2)) + 1;
  const frameStride = Math.max(1, Math.ceil(availableFrames / 96));
  const chroma = new Float64Array(12);
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  let validFrames = 0;
  let spectralFlatnessSum = 0;

  for (let frame = 0; frame < availableFrames; frame += frameStride) {
    const start = frame * (FFT_SIZE / 2);
    let frameSquareSum = 0;
    for (let index = 0; index < FFT_SIZE; index++) {
      const sample = Number(samples[start + index]) || 0;
      frameSquareSum += sample * sample;
      real[index] = sample * FFT_WINDOW[index];
      imaginary[index] = 0;
    }
    if (Math.sqrt(frameSquareSum / FFT_SIZE) < 0.001) continue;
    fft(real, imaginary);

    const frameChroma = new Float64Array(12);
    let frameEnergy = 0;
    let frameMagnitudeEnergy = 0;
    let frameLogMagnitudeSum = 0;
    let spectralBinCount = 0;
    const highestBin = Math.min(FFT_HALF_SIZE, Math.floor(5000 * FFT_SIZE / sampleRate));
    for (let bin = Math.max(1, Math.floor(45 * FFT_SIZE / sampleRate)); bin <= highestBin; bin++) {
      const frequency = bin * sampleRate / FFT_SIZE;
      const magnitudePower = real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
      const power = magnitudePower / frequency;
      frameMagnitudeEnergy += magnitudePower;
      frameLogMagnitudeSum += Math.log(Math.max(magnitudePower, Number.MIN_VALUE));
      spectralBinCount++;
      if (!Number.isFinite(power) || power <= 0) continue;
      const midiNote = 69 + 12 * Math.log2(frequency / 440);
      const lowerNote = Math.floor(midiNote);
      const fraction = midiNote - lowerNote;
      frameChroma[((lowerNote % 12) + 12) % 12] += power * (1 - fraction);
      frameChroma[((lowerNote + 1) % 12 + 12) % 12] += power * fraction;
      frameEnergy += power;
    }
    if (frameEnergy <= 0) continue;
    const arithmeticMagnitudeMean = spectralBinCount > 0
      ? frameMagnitudeEnergy / spectralBinCount
      : 0;
    const geometricMagnitudeMean = spectralBinCount > 0
      ? Math.exp(frameLogMagnitudeSum / spectralBinCount)
      : 0;
    spectralFlatnessSum += arithmeticMagnitudeMean > 0
      ? Math.min(1, geometricMagnitudeMean / arithmeticMagnitudeMean)
      : 1;
    for (let pitch = 0; pitch < 12; pitch++) chroma[pitch] += frameChroma[pitch] / frameEnergy;
    validFrames++;
  }

  const chromaTotal = chroma.reduce((sum, value) => sum + value, 0);
  const averageSpectralFlatness = spectralFlatnessSum / Math.max(1, validFrames);
  if (validFrames < 3 || chromaTotal <= 0) {
    return { key: null, tonic: null, mode: null, confidence: 0, source: 'unavailable' };
  }
  if (averageSpectralFlatness > 0.45) {
    return { key: null, tonic: null, mode: null, confidence: 0, source: 'waveform-chroma-v1' };
  }
  const normalizedChroma = Array.from(chroma, value => value / chromaTotal);
  const candidates = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const profile of KEY_PROFILES) {
      const rotated = profile.values.map((_, interval) => profile.values[(interval - tonic + 12) % 12]);
      candidates.push({
        tonic,
        mode: profile.mode,
        score: pearsonCorrelation(normalizedChroma, rotated)
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.tonic - right.tonic);
  const best = candidates[0];
  const margin = best.score - candidates[1].score;
  if (!best || best.score < 0.12 || margin < 0.012) {
    return { key: null, tonic: null, mode: null, confidence: 0, source: 'waveform-chroma-v1' };
  }
  const scoreConfidence = Math.max(0, Math.min(1, (best.score - 0.12) / 0.55));
  const marginConfidence = Math.max(0, Math.min(1, margin / 0.12));
  const confidence = Math.round(scoreConfidence * marginConfidence * 100) / 100;
  return {
    key: `${NOTE_NAMES[best.tonic]} ${best.mode}`,
    tonic: NOTE_NAMES[best.tonic],
    mode: best.mode,
    confidence,
    source: 'waveform-chroma-v1'
  };
}

module.exports = { detectMusicalKey };
