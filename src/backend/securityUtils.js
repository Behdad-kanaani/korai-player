const dns = require('dns');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const https = require('https');
const { Readable } = require('stream');

function getClientIp(req) {
  // The server is bound to loopback, so forwarding headers are not trusted.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter(maxRequests = 60, windowMs = 60_000) {
  const buckets = new Map();
  let cleanupAt = Date.now() + windowMs;

  return (req, res, next) => {
    const key = getClientIp(req);
    const now = Date.now();

    if (now >= cleanupAt) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
      cleanupAt = now + windowMs;
    }

    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    next();
  };
}

function isLocalAddress(address) {
  if (!address) return true;

  const normalized = String(address).trim().toLowerCase();
  const family = net.isIP(normalized);
  if (family === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (family === 6) {
    const halves = normalized.split('::');
    if (halves.length > 2) return true;
    const parseHalf = half => {
      if (!half) return [];
      const groups = half.split(':');
      if (groups.some(group => !/^[\da-f]{1,4}$/.test(group))) return null;
      return groups.map(group => Number.parseInt(group, 16));
    };
    const left = parseHalf(halves[0]);
    const right = parseHalf(halves[1] || '');
    if (!left || !right || (halves.length === 1 && left.length !== 8) || left.length + right.length > 8) return true;
    const groups = [...left, ...Array(8 - left.length - right.length).fill(0), ...right];

    if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
      const high = groups[6];
      const low = groups[7];
      return isLocalAddress([
        high >> 8, high & 0xff, low >> 8, low & 0xff
      ].join('.'));
    }

    const firstHextet = groups[0];
    const secondHextet = groups[1];
    return (
      normalized === '::' ||
      normalized === '::1' ||
      (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
      (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
      firstHextet >= 0xff00 ||
      firstHextet < 0x2000 ||
      firstHextet > 0x3fff ||
      (firstHextet === 0x2001 && secondHextet <= 0x01ff) ||
      (firstHextet === 0x2001 && secondHextet === 0x0db8) ||
      (firstHextet === 0x2002) ||
      (firstHextet === 0x3fff && (secondHextet & 0xfff0) === 0)
    );
  }

  return true;
}

async function resolveSafeUrl(inputUrl, options = {}) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new Error('URL is required');
  }

  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  const allowedProtocols = options.allowHttp === true ? ['http:', 'https:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error('Only HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL credentials are not allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed');
  }

  const allowedHosts = (options.allowHosts || []).map(host => String(host).toLowerCase().trim()).filter(Boolean);
  if (allowedHosts.length > 0) {
    const isAllowed = allowedHosts.includes(hostname);
    if (!isAllowed) throw new Error('Host not allowed');
  }

  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Unable to resolve hostname');
  }

  if (!addresses.length || addresses.some(entry => isLocalAddress(entry.address))) {
    throw new Error('Refusing to access local network address');
  }

  return { url: parsed, addresses };
}

async function assertSafeUrl(inputUrl, options = {}) {
  const resolved = await resolveSafeUrl(inputUrl, options);
  return resolved.url;
}

function createPinnedLookup(hostname, addresses) {
  const approvedHostname = String(hostname).toLowerCase();
  const approvedAddresses = addresses.map(({ address, family }) => ({ address, family }));
  if (approvedAddresses.length === 0) throw new Error('No validated IP addresses available');

  return (requestedHostname, options, callback) => {
    if (String(requestedHostname).toLowerCase() !== approvedHostname) {
      callback(new Error('DNS lookup hostname changed after URL validation'));
      return;
    }

    if (options && options.all) {
      callback(null, approvedAddresses);
      return;
    }

    const address = approvedAddresses[0];
    callback(null, address.address, address.family);
  };
}

async function fetchSafeUrl(inputUrl, options = {}) {
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : 5;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30_000;
  const requestHeaders = options.headers || {};
  let currentUrl = inputUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const { url, addresses } = await resolveSafeUrl(currentUrl, options);
    const response = await new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: 'GET',
        headers: requestHeaders,
        lookup: createPinnedLookup(url.hostname, addresses)
      }, resolve);

      request.setTimeout(timeoutMs, () => request.destroy(new Error('Request timeout')));
      request.once('error', reject);
      request.end();
    });

    const location = response.headers.location;
    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume();
      if (redirectCount === maxRedirects) throw new Error('Too many redirects');
      currentUrl = new URL(location, url).href;
      continue;
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) {
        value.forEach(item => headers.append(name, item));
      } else if (value != null) {
        headers.set(name, String(value));
      }
    }

    return {
      status: response.statusCode || 0,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      headers,
      body: Readable.toWeb(response)
    };
  }

  throw new Error('Too many redirects');
}

function isPathInside(baseDir, candidatePath) {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveSafePath(candidatePath, baseDir = null, options = {}) {
  if (!candidatePath || typeof candidatePath !== 'string') return null;

  const trimmedPath = candidatePath.trim();
  if (!trimmedPath || trimmedPath.includes('\0')) return null;

  const safeBase = path.resolve(baseDir || os.homedir());
  const absolutePath = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(safeBase, trimmedPath);

  const homeDir = path.resolve(os.homedir());
  const allowHome = options.allowHome !== false;
  const isUnderBase = isPathInside(safeBase, absolutePath);
  const isUnderHome = allowHome && isPathInside(homeDir, absolutePath);

  if (!isUnderBase && !isUnderHome) return null;

  try {
    const realBase = fs.existsSync(safeBase) ? fs.realpathSync.native(safeBase) : safeBase;
    const realPath = fs.existsSync(absolutePath) ? fs.realpathSync.native(absolutePath) : absolutePath;
    const realHome = fs.existsSync(homeDir) ? fs.realpathSync.native(homeDir) : homeDir;

    if (isPathInside(realBase, realPath) || (allowHome && isPathInside(realHome, realPath))) {
      return realPath;
    }
  } catch {
    return absolutePath;
  }

  return null;
}

/**
 * Resolve an already-existing local file selected/known by the app.
 * This is intentionally separate from resolveSafePath because a user's music
 * library may live on any mounted drive, not only inside %USERPROFILE%.
 */
function resolveExistingFile(candidatePath, options = {}) {
  if (!candidatePath || typeof candidatePath !== 'string') return null;

  const trimmed = candidatePath.trim();
  if (!trimmed || trimmed.includes('\0')) return null;

  const absolute = path.resolve(trimmed);
  try {
    const real = fs.realpathSync.native(absolute);
    const stat = fs.statSync(real);
    if (!stat.isFile()) return null;

    if (options.allowedExtensions && options.allowedExtensions.length > 0) {
      const ext = path.extname(real).toLowerCase();
      if (!options.allowedExtensions.includes(ext)) return null;
    }

    if (Array.isArray(options.blockedRoots)) {
      for (const root of options.blockedRoots) {
        if (root && isPathInside(root, real)) return null;
      }
    }

    return real;
  } catch {
    return null;
  }
}

function isSafeKey(key) {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
  if (/[^a-zA-Z0-9_-]/.test(key)) return false;
  return key.length <= 128;
}

function safeAssign(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  for (const key of Object.keys(source)) {
    if (!isSafeKey(key)) continue;
    try {
      target[key] = source[key];
    } catch {
      // Ignore individual malformed keys.
    }
  }
  return target;
}

module.exports = {
  createRateLimiter,
  getClientIp,
  isLocalAddress,
  isPathInside,
  assertSafeUrl,
  resolveSafeUrl,
  createPinnedLookup,
  fetchSafeUrl,
  resolveSafePath,
  resolveExistingFile,
  isSafeKey,
  safeAssign
};
