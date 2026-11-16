const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { setupPluginRoutes } = require('./pluginRoutes');


function request(baseUrl, pathname, { method = 'GET', headers = {}, body } = {}) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(target, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.once('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('plugin marketplace installation route returns 429 after its endpoint-specific burst budget', async () => {
  const app = express();
  app.use(express.json());
  setupPluginRoutes(app, {}, null, {});

  await withServer(app, async baseUrl => {
    const statuses = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await request(baseUrl, '/api/plugins/store/install', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      });
      statuses.push(response.status);
      if (index === 3) {
        assert.ok(Number(response.headers['retry-after']) > 0, '429 response includes Retry-After');
      }
    }
    assert.deepEqual(statuses, [400, 400, 400, 429]);
  });
});

test('plugin UI asset route rejects symlinks that resolve outside the plugin root', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-plugin-asset-'));
  const pluginRoot = path.join(root, 'plugin');
  const outsideRoot = path.join(root, 'outside');
  fs.mkdirSync(pluginRoot);
  fs.mkdirSync(outsideRoot);
  fs.writeFileSync(path.join(outsideRoot, 'payload.js'), 'globalThis.compromised = true;');
  fs.writeFileSync(path.join(pluginRoot, 'ui.js'), 'globalThis.safe = true;');
  const app = express();
  const pluginManager = { appRoot: root, getPlugin: () => ({ id: 'vendor/plugin', path: pluginRoot }) };
  setupPluginRoutes(app, pluginManager, null, null);

  try {
    await withServer(app, async baseUrl => {
      const safeResponse = await request(baseUrl, '/api/plugin-asset/vendor%2Fplugin/ui.js');
      assert.equal(safeResponse.status, 200);
      assert.match(safeResponse.text, /globalThis\.safe/);

      fs.unlinkSync(path.join(pluginRoot, 'ui.js'));
      try {
        fs.symlinkSync(path.join(outsideRoot, 'payload.js'), path.join(pluginRoot, 'ui.js'));
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
          t.skip(`symlink creation is unavailable: ${error.code}`);
          return;
        }
        throw error;
      }
      const rejected = await request(baseUrl, '/api/plugin-asset/vendor%2Fplugin/ui.js');
      assert.equal(rejected.status, 400);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
