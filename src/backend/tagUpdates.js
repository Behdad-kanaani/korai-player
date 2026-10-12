'use strict';

const TEXT_LIMITS = {
  title: 500,
  artist: 500,
  album: 500,
  genre: 200,
  composer: 500,
  lyrics: 100_000
};
const ALLOWED_FIELDS = new Set([...Object.keys(TEXT_LIMITS), 'year', 'trackNumber']);

function normalizeTagUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('Tag updates must be an object.');
  }
  const fields = Object.keys(updates);
  if (!fields.length) throw new Error('At least one tag field must be selected.');
  for (const field of fields) {
    if (!ALLOWED_FIELDS.has(field)) throw new Error(`Unsupported tag field: ${field}`);
  }

  const normalized = {};
  for (const field of fields) {
    const value = updates[field];
    if (Object.prototype.hasOwnProperty.call(TEXT_LIMITS, field)) {
      if (typeof value !== 'string' || value.length > TEXT_LIMITS[field]) {
        throw new Error(`${field} must be text no longer than ${TEXT_LIMITS[field]} characters.`);
      }
      normalized[field] = value.trim();
      continue;
    }
    if (value === null || value === '') {
      normalized[field] = null;
      continue;
    }
    const number = Number(value);
    const minimum = field === 'year' ? 1000 : 1;
    const maximum = field === 'year' ? 9999 : 99999;
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(`${field} must be an integer between ${minimum} and ${maximum}, or empty.`);
    }
    normalized[field] = number;
  }
  return normalized;
}

function normalizeTrackIds(trackIds) {
  if (!Array.isArray(trackIds) || trackIds.length < 1 || trackIds.length > 500) {
    throw new Error('Select between 1 and 500 tracks for a batch tag update.');
  }
  const normalized = trackIds.map(Number);
  if (normalized.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(normalized).size !== normalized.length) {
    throw new Error('Track IDs must be unique positive integers.');
  }
  return normalized;
}

module.exports = { normalizeTagUpdates, normalizeTrackIds };
