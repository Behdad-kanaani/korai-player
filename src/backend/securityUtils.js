const dns = require('dns');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { Readable } = require('stream');

function getClientIp(req) {
  // Use the direct peer address. Forwarding headers are untrusted because the
  // local desktop API does not run behind a trusted reverse proxy.
  const address = req?.socket?.remoteAddress || req?.connection?.remoteAddress || req?.ip || 'unknown';
  return String(address).toLowerCase().replace(/^::ffff:/, '');
}

function createRateLimiter(maxRequests = 60, windowMs = 60_000) {
  const requestBudget = Number.isFinite(maxRequests) ? Math.max(1, Math.floor(maxRequests)) : 60;
  const intervalMs = Number.isFinite(windowMs) ? Math.max(1000, Math.min(3_600_000, Math.floor(windowMs))) : 60_000;
  const buckets = new Map();
  const MAX_BUCKETS = 10_000;
  let cleanupAt = Date.now() + intervalMs;

  function cleanupExpired(now) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    cleanupAt = now + intervalMs;
  }

  return (req, res, next) => {
    const key = getClientIp(req);
    const now = Date.now();

    if (now >= cleanupAt || buckets.size >= MAX_BUCKETS) cleanupExpired(now);

    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
        res.set?.('Retry-After', String(Math.max(1, Math.ceil(intervalMs / 1000))));
        res.status(429).json({ error: 'Too many requests' });
        return;
      }
      buckets.set(key, { count: 1, resetAt: now + intervalMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > requestBudget) {
      res.set?.('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
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

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed');
  }
  // Handle IP literals directly. URL.hostname may include brackets for IPv6;
  // never send bracketed literals through DNS resolution.
  const literalFamily = net.isIP(hostname);
  if (literalFamily && isLocalAddress(hostname)) {
    throw new Error('Local or reserved IP addresses are not allowed');
  }

  const allowedHosts = (options.allowHosts || []).map(host => String(host).toLowerCase().trim()).filter(Boolean);
  if (allowedHosts.length > 0) {
    const isAllowed = allowedHosts.includes(hostname);
    if (!isAllowed) throw new Error('Host not allowed');
  }

  let addresses;
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Unable to resolve hostname');
  }

  if (!addresses.length || addresses.some(entry => isLocalAddress(entry.address))) {
    throw new Error('Refusing to access local network address');
  }

  return { url: parsed, addresses, hostname };
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
  const maxRedirects = Number.isInteger(options.maxRedirects)
    ? Math.max(0, Math.min(10, options.maxRedirects))
    : 5;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1000, Math.min(120_000, options.timeoutMs))
    : 30_000;
  const requestHeaders = options.headers || {};
  let currentUrl = inputUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const { url, addresses, hostname } = await resolveSafeUrl(currentUrl, options);
    const transport = url.protocol === 'https:' ? https : http;
    const response = await new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method: 'GET',
        headers: requestHeaders,
        lookup: createPinnedLookup(hostname, addresses),
        agent: false
      }, resolve);

      request.setTimeout(timeoutMs, () => request.destroy(new Error('Request idle timeout')));
      request.once('error', reject);
      request.end();
    });
    // Bound the response-body phase as well as connection establishment. The
    // timer remains active until the body is consumed or the stream closes.
    const responseDeadline = setTimeout(
      () => response.destroy(new Error('Response deadline exceeded')),
      timeoutMs
    );
    response.once('end', () => clearTimeout(responseDeadline));
    response.once('close', () => clearTimeout(responseDeadline));
    response.once('error', () => clearTimeout(responseDeadline));

    const location = response.headers.location;
    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume();
      if (redirectCount === maxRedirects) throw new Error('Too many redirects');
      // Every redirect is parsed, DNS-resolved, checked against the host policy,
      // and pinned independently on the next iteration.
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

function realpathWithMissingTail(candidatePath) {
  const absolute = path.resolve(candidatePath);
  const missing = [];
  let cursor = absolute;

  while (true) {
    let stat;
    try {
      // lstat is deliberate: existsSync follows links and reports false for a
      // dangling symlink, which could otherwise be followed by a later write.
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error && error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return null;
      const parent = path.dirname(cursor);
      if (parent === cursor) return null;
      missing.unshift(path.basename(cursor));
      cursor = parent;
      continue;
    }

    if (missing.length > 0 && !stat.isDirectory()) return null;
    // If lstat succeeded but realpath fails, this is commonly a dangling
    // symlink. Reject it instead of treating it as a new path component.
    try {
      const real = fs.realpathSync.native(cursor);
      return path.resolve(real, ...missing);
    } catch {
      return null;
    }
  }
}

function resolveSafePath(candidatePath, baseDir = null, options = {}) {
  if (typeof candidatePath !== 'string') return null;
  const trimmedPath = candidatePath.trim();
  if (!trimmedPath || trimmedPath.includes('\0')) return null;

  const rawBase = path.resolve(baseDir || os.homedir());
  const safeBase = realpathWithMissingTail(rawBase);
  const homeDir = path.resolve(os.homedir());
  const realHome = realpathWithMissingTail(homeDir);
  if (!safeBase || !realHome) return null;

  const absolutePath = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(rawBase, trimmedPath);
  const realCandidate = realpathWithMissingTail(absolutePath);
  if (!realCandidate) return null;

  const allowHome = options.allowHome !== false;
  const inBase = isPathInside(safeBase, realCandidate);
  const inHome = allowHome && isPathInside(realHome, realCandidate);
  if (!inBase && !inHome) return null;

  // Re-resolve the declared root and the candidate after canonicalization. A
  // symlink may be used only when its final target remains inside an allowed
  // root; dangling links and links escaping all roots are rejected.
  if (fs.existsSync(rawBase)) {
    try {
      const canonicalBase = fs.realpathSync.native(rawBase);
      if (!isPathInside(canonicalBase, realCandidate) &&
          !(allowHome && isPathInside(realHome, realCandidate))) return null;
    } catch {
      return null;
    }
  }
  return realCandidate;
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

  try {
    const real = fs.realpathSync.native(path.resolve(trimmed));
    const stat = fs.statSync(real);
    if (!stat.isFile()) return null;

    if (options.allowedExtensions && options.allowedExtensions.length > 0) {
      const allowed = new Set(options.allowedExtensions.map(value => String(value).toLowerCase()));
      const ext = path.extname(real).toLowerCase();
      if (!allowed.has(ext)) return null;
    }

    if (Array.isArray(options.allowedRoots) && options.allowedRoots.length > 0) {
      const insideAllowedRoot = options.allowedRoots.some(root => {
        if (!root || typeof root !== 'string') return false;
        try {
          const canonicalRoot = fs.realpathSync.native(path.resolve(root));
          return fs.statSync(canonicalRoot).isDirectory() && isPathInside(canonicalRoot, real);
        } catch {
          return false;
        }
      });
      if (!insideAllowedRoot) return null;
    }

    if (Array.isArray(options.blockedRoots)) {
      for (const root of options.blockedRoots) {
        if (!root) continue;
        try {
          const canonicalRoot = fs.realpathSync.native(path.resolve(root));
          if (isPathInside(canonicalRoot, real)) return null;
        } catch {
          // A missing blocked root cannot contain the already-resolved file.
        }
      }
    }

    return real;
  } catch {
    return null;
  }
}

function isSafeObjectKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 128 &&
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function isSafeKey(key) {
  if (!isSafeObjectKey(key)) return false;
  if (/[^a-zA-Z0-9_-]/.test(key)) return false;
  return true;
}

function safeAssign(target, source) {
  if (!target || typeof target !== 'object' || !source || typeof source !== 'object' || Array.isArray(source)) return target;
  for (const key of Object.keys(source)) {
    if (!isSafeKey(key)) continue;
    try {
      Object.defineProperty(target, key, {
        value: source[key],
        enumerable: true,
        configurable: true,
        writable: true
      });
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
  isSafeObjectKey,
  safeAssign
};
