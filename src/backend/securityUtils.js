const dns = require('dns');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function createRateLimiter(maxRequests = 60, windowMs = 60_000) {
  const buckets = new Map();

  return (req, res, next) => {
    const key = getClientIp(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
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
  if (address === '::1') return true;
  if (address === '127.0.0.1') return true;
  if (address.startsWith('127.')) return true;
  if (address.startsWith('10.')) return true;
  if (address.startsWith('169.254.')) return true;
  if (address.startsWith('192.168.')) return true;
  if (address.startsWith('172.16.')) return true;
  if (address.startsWith('172.17.')) return true;
  if (address.startsWith('172.18.')) return true;
  if (address.startsWith('172.19.')) return true;
  if (address.startsWith('172.2')) return true;
  if (address.startsWith('172.3')) return true;
  if (address.startsWith('fc')) return true;
  if (address.startsWith('fd')) return true;
  if (address.startsWith('fe80:')) return true;
  return false;
}

async function assertSafeUrl(inputUrl, options = {}) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new Error('URL is required');
  }

  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid URL protocol');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL credentials are not allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed');
  }

  const allowedHosts = (options.allowHosts || []).map(host => host.toLowerCase());
  if (allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
    if (!isAllowed) {
      throw new Error('Host not allowed');
    }
  }

  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new Error('Unable to resolve hostname');
  }

  for (const entry of addresses) {
    if (isLocalAddress(entry.address)) {
      throw new Error('Refusing to access local network address');
    }
  }

  return parsed;
}

function resolveSafePath(candidatePath, baseDir = null) {
  if (!candidatePath || typeof candidatePath !== 'string') {
    return null;
  }

  const trimmedPath = candidatePath.trim();
  if (!trimmedPath || trimmedPath.includes('\0')) {
    return null;
  }

  const safeBase = path.resolve(baseDir || os.homedir());
  const absolutePath = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(safeBase, trimmedPath);

  const relative = path.relative(safeBase, absolutePath);
  const isUnderBase = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  if (!isUnderBase) {
    return null;
  }

  try {
    const realBase = fs.existsSync(safeBase) ? fs.realpathSync.native(safeBase) : safeBase;
    const realPath = fs.existsSync(absolutePath) ? fs.realpathSync.native(absolutePath) : absolutePath;
    const realRelative = path.relative(realBase, realPath);
    const isSafeRealPath = realRelative === '' || (!realRelative.startsWith('..') && !path.isAbsolute(realRelative));
    if (isSafeRealPath) {
      return realPath;
    }
  } catch {
    return absolutePath;
  }

  return null;
}

function isSafeKey(key) {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
  if (/[\s\0]/.test(key)) return false;
  // disallow characters that could be used to access prototypes or nested properties
  if (/[\[\]\.]/.test(key)) return false;
  // reasonable length limit
  if (key.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

function safeAssign(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const k of Object.keys(source)) {
    if (!isSafeKey(k)) continue;
    try { target[k] = source[k]; } catch (e) { /* ignore */ }
  }
  return target;
}

module.exports = {
  createRateLimiter,
  getClientIp,
  assertSafeUrl,
  resolveSafePath
};
