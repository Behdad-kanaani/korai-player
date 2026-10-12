'use strict';

const STRING_FIELDS = new Set(['title', 'artist', 'album', 'genre', 'composer', 'musicalKey']);
const NUMERIC_FIELDS = new Set(['year', 'bpm', 'energy', 'playCount', 'likeCount', 'duration', 'createdAt']);
const SORT_FIELDS = new Set([...STRING_FIELDS, ...NUMERIC_FIELDS]);
const STRING_OPERATORS = new Set(['equals', 'contains', 'notContains']);
const NUMERIC_OPERATORS = new Set(['equals', 'greaterThan', 'lessThan', 'between']);

function normalizeSmartCriteria(criteria) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
    throw new Error('Smart playlist criteria must be an object.');
  }
  if (!Array.isArray(criteria.rules) || criteria.rules.length < 1 || criteria.rules.length > 10) {
    throw new Error('Smart playlists must contain between 1 and 10 rules.');
  }

  const match = criteria.match === 'any' ? 'any' : criteria.match === 'all' ? 'all' : null;
  if (!match) throw new Error('Smart playlist match mode must be "all" or "any".');

  const rules = criteria.rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`Smart playlist rule ${index + 1} is invalid.`);
    }
    const { field, operator } = rule;
    if (STRING_FIELDS.has(field)) {
      if (!STRING_OPERATORS.has(operator) || typeof rule.value !== 'string' ||
          !rule.value.trim() || rule.value.length > 200) {
        throw new Error(`Smart playlist rule ${index + 1} has an invalid text condition.`);
      }
      return { field, operator, value: rule.value.trim() };
    }
    if (NUMERIC_FIELDS.has(field)) {
      if (!NUMERIC_OPERATORS.has(operator)) {
        throw new Error(`Smart playlist rule ${index + 1} has an invalid numeric operator.`);
      }
      const value = Number(rule.value);
      if (!Number.isFinite(value)) {
        throw new Error(`Smart playlist rule ${index + 1} must use a finite number.`);
      }
      if (operator === 'between') {
        const upperValue = Number(rule.upperValue);
        if (!Number.isFinite(upperValue) || upperValue < value) {
          throw new Error(`Smart playlist rule ${index + 1} has an invalid range.`);
        }
        return { field, operator, value, upperValue };
      }
      return { field, operator, value };
    }
    if (field === 'isLiked') {
      if (operator !== 'equals' || typeof rule.value !== 'boolean') {
        throw new Error(`Smart playlist rule ${index + 1} must compare liked status to true or false.`);
      }
      return { field, operator, value: rule.value };
    }
    throw new Error(`Smart playlist rule ${index + 1} uses an unsupported field.`);
  });

  const limit = criteria.limit === null || criteria.limit === undefined || criteria.limit === 0
    ? null
    : Number(criteria.limit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5000)) {
    throw new Error('Smart playlist limit must be between 1 and 5000, or omitted.');
  }
  const sortBy = criteria.sortBy || 'createdAt';
  if (!SORT_FIELDS.has(sortBy) && sortBy !== 'isLiked') {
    throw new Error('Smart playlist sort field is unsupported.');
  }
  const sortOrder = criteria.sortOrder === 'asc' ? 'asc' : criteria.sortOrder === 'desc' ? 'desc' : null;
  if (!sortOrder) throw new Error('Smart playlist sort order must be "asc" or "desc".');
  return { match, rules, limit, sortBy, sortOrder };
}

function matchesRule(track, rule) {
  if (STRING_FIELDS.has(rule.field)) {
    const actual = String(track[rule.field] || '').toLowerCase();
    const expected = rule.value.toLowerCase();
    if (rule.operator === 'equals') return actual === expected;
    if (rule.operator === 'contains') return actual.includes(expected);
    return !actual.includes(expected);
  }
  if (rule.field === 'isLiked') return Boolean(track.isLiked) === rule.value;

  const rawValue = track[rule.field];
  if (rawValue === null || rawValue === undefined || rawValue === '') return false;
  const actual = Number(rawValue);
  if (!Number.isFinite(actual)) return false;
  switch (rule.operator) {
    case 'equals': return actual === rule.value;
    case 'greaterThan': return actual > rule.value;
    case 'lessThan': return actual < rule.value;
    case 'between': return actual >= rule.value && actual <= rule.upperValue;
    default: return false;
  }
}

function resolveSmartPlaylistTracks(tracks, criteria) {
  const normalized = normalizeSmartCriteria(criteria);
  const matched = tracks.filter(track => normalized.match === 'all'
    ? normalized.rules.every(rule => matchesRule(track, rule))
    : normalized.rules.some(rule => matchesRule(track, rule)));
  const direction = normalized.sortOrder === 'asc' ? 1 : -1;
  matched.sort((left, right) => {
    const a = left[normalized.sortBy];
    const b = right[normalized.sortBy];
    if (typeof a === 'string' || typeof b === 'string') {
      return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' }) * direction ||
        left.id - right.id;
    }
    const numericA = Number.isFinite(Number(a)) ? Number(a) : 0;
    const numericB = Number.isFinite(Number(b)) ? Number(b) : 0;
    return (numericA - numericB) * direction || left.id - right.id;
  });
  return normalized.limit === null ? matched : matched.slice(0, normalized.limit);
}

module.exports = { normalizeSmartCriteria, resolveSmartPlaylistTracks };
