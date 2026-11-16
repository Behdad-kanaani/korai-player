const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns');
const { createPinnedLookup } = require('./securityUtils');
const {
  createRateLimiter,
  isLocalAddress,
  isPathInside,
  assertSafeUrl,
  resolveSafePath,
  resolveExistingFile,
  safeAssign
} = require('./securityUtils');

test('blocks private, loopback, link-local, documentation and reserved IPv4/IPv6 ranges', () => {
  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1',
    '169.254.169.254', '172.16.0.1', '192.168.1.1',
    '192.0.2.1', '198.18.0.1', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1',
    'ff02::1', '2001:db8::1', '2002::1', '::ffff:127.0.0.1'
  ]) {
    assert.equal(isLocalAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isLocalAddress(address), false, address);
  }
});

test('rejects localhost and private IP literal URLs before any network request', async () => {
  for (const url of [
    'http://localhost/',
    'https://service.localhost/',
    'http://127.0.0.1/',
    'https://[::1]/',
    'http://169.254.169.254/latest/meta-data/'
  ]) {
    await assert.rejects(assertSafeUrl(url, { allowHttp: true }), /Local|reserved|not allowed/i, url);
  }
  await assert.rejects(assertSafeUrl('file:///etc/passwd'), /HTTPS/);
});

test('rejects DNS answers that resolve a public-looking hostname to a private address', async () => {
  const originalLookup = dns.promises.lookup;
  dns.promises.lookup = async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '10.0.0.8', family: 4 }
  ];
  try {
    await assert.rejects(
      assertSafeUrl('https://attacker-controlled.example/'),
      /local network address/i
    );
  } finally {
    dns.promises.lookup = originalLookup;
  }
});

test('pinned DNS lookup refuses hostname substitution and returns only validated addresses', async () => {
  const lookup = createPinnedLookup('media.example', [
    { address: '8.8.8.8', family: 4 }
  ]);
  await new Promise(resolve => {
    lookup('other.example', {}, error => {
      assert.match(error.message, /hostname changed/i);
      resolve();
    });
  });
  await new Promise(resolve => {
    lookup('media.example', { all: true }, (error, addresses) => {
      assert.ifError(error);
      assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
      resolve();
    });
  });
});

test('resolveSafePath rejects traversal and symlink escapes, including missing leaf paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-safe-path-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-outside-'));
  try {
    fs.mkdirSync(path.join(root, 'inside'));
    fs.writeFileSync(path.join(root, 'inside', 'ok.txt'), 'ok');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const link = path.join(root, 'escape');
    try { fs.symlinkSync(outside, link, 'dir'); } catch { return; }

    assert.equal(resolveSafePath('../korai-outside/secret.txt', root, { allowHome: false }), null);
    assert.equal(resolveSafePath(path.join(link, 'secret.txt'), root, { allowHome: false }), null);
    assert.equal(resolveSafePath(path.join(root, 'inside', 'new.txt'), root, { allowHome: false }),
      path.join(root, 'inside', 'new.txt'));
    assert.equal(isPathInside(root, path.join(root, 'inside', 'ok.txt')), true);
    assert.equal(isPathInside(root, outside), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveExistingFile canonicalizes files and enforces extension allowlists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-existing-file-'));
  try {
    const audio = path.join(root, 'track.mp3');
    const secret = path.join(root, 'secret.txt');
    fs.writeFileSync(audio, 'audio');
    fs.writeFileSync(secret, 'secret');
    assert.equal(resolveExistingFile(audio, { allowedExtensions: ['.mp3'] }), fs.realpathSync(audio));
    assert.equal(resolveExistingFile(secret, { allowedExtensions: ['.mp3'] }), null);
    assert.equal(resolveExistingFile(path.join(root, 'missing.mp3')), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rate limiter returns 429 after the configured request budget', () => {
  const limiter = createRateLimiter(2, 60_000);
  let nextCount = 0;
  let statusCode = 0;
  let payload = null;
  const req = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; }
  };
  limiter(req, res, () => { nextCount += 1; });
  limiter(req, res, () => { nextCount += 1; });
  limiter(req, res, () => { nextCount += 1; });
  assert.equal(nextCount, 2);
  assert.equal(statusCode, 429);
  assert.deepEqual(payload, { error: 'Too many requests' });
});

test('resolveSafePath rejects dangling symlinks and symlinks escaping the selected root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-path-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-path-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.mp3'), 'secret');
    const escapeLink = path.join(root, 'escape');
    const danglingLink = path.join(root, 'dangling');
    try {
      fs.symlinkSync(outside, escapeLink, 'dir');
      fs.symlinkSync(path.join(outside, 'not-created-yet'), danglingLink, 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return;
      throw error;
    }

    assert.equal(resolveSafePath(path.join(escapeLink, 'secret.mp3'), root, { allowHome: false }), null);
    assert.equal(resolveSafePath(danglingLink, root, { allowHome: false }), null);
    assert.equal(resolveSafePath(path.join(danglingLink, 'new.mp3'), root, { allowHome: false }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('resolveExistingFile optionally requires canonical containment in an allowed root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-allowed-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-disallowed-root-'));
  try {
    const insideFile = path.join(root, 'inside.mp3');
    const outsideFile = path.join(outside, 'outside.mp3');
    fs.writeFileSync(insideFile, 'inside');
    fs.writeFileSync(outsideFile, 'outside');

    assert.equal(resolveExistingFile(insideFile, { allowedRoots: [root], allowedExtensions: ['.mp3'] }), fs.realpathSync(insideFile));
    assert.equal(resolveExistingFile(outsideFile, { allowedRoots: [root], allowedExtensions: ['.mp3'] }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('rate limiter keys by direct peer IP, isolates clients, expires buckets, and sets Retry-After', () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const limiter = createRateLimiter(1, 2_000);
    const request = ip => ({
      ip: '203.0.113.200', // untrusted forwarded/derived value must not override the socket peer
      socket: { remoteAddress: ip }
    });
    const call = req => {
      const outcome = { next: 0, status: 0, retryAfter: null, body: null };
      const response = {
        set(name, value) { if (name === 'Retry-After') outcome.retryAfter = value; return this; },
        status(code) { outcome.status = code; return this; },
        json(body) { outcome.body = body; return this; }
      };
      limiter(req, response, () => { outcome.next += 1; });
      return outcome;
    };

    assert.equal(call(request('127.0.0.1')).next, 1);
    const limited = call(request('127.0.0.1'));
    assert.equal(limited.status, 429);
    assert.equal(limited.retryAfter, '2');
    assert.deepEqual(limited.body, { error: 'Too many requests' });
    assert.equal(call(request('127.0.0.2')).next, 1);

    now += 2_001;
    assert.equal(call(request('127.0.0.1')).next, 1);
  } finally {
    Date.now = originalNow;
  }
});


test('safeAssign ignores prototype-sensitive keys on ordinary destination objects', () => {
  const destination = {};
  const source = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"valid":7}');
  safeAssign(destination, source);
  assert.deepEqual(destination, { valid: 7 });
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(destination, '__proto__'), false);
  assert.equal(Object.hasOwn(destination, 'constructor'), false);
  assert.equal(Object.hasOwn(destination, 'prototype'), false);
});
