const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PluginManager = require('./pluginManager');

test('plugin registry excludes prototype-sensitive IDs and remains a null-prototype dictionary', () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-plugin-registry-'));
  const pluginsDir = path.join(appRoot, 'plugins');
  try {
    fs.mkdirSync(pluginsDir, { recursive: true });
    const validDir = path.join(pluginsDir, 'vendor_plugin@1.0.0');
    fs.mkdirSync(validDir);
    const registryJson = `{"__proto__":{"path":${JSON.stringify(validDir)},"name":"bad"},` +
      `"constructor":{"path":${JSON.stringify(validDir)},"name":"bad"},` +
      `"prototype":{"path":${JSON.stringify(validDir)},"name":"bad"},` +
      `"vendor/plugin":{"path":${JSON.stringify(validDir)},"name":"valid","version":"1.0.0","entry":"index.js"}}`;
    fs.writeFileSync(path.join(pluginsDir, 'plugins.json'), registryJson);

    const manager = new PluginManager({ appRoot, pluginsDir, bundledPluginsDir: path.join(appRoot, 'bundled') });
    assert.equal(Object.getPrototypeOf(manager.registry), null);
    assert.deepEqual(Object.keys(manager.registry), ['vendor/plugin']);
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      assert.equal(manager.getPlugin(id), null);
      assert.equal(manager.getEntry(id), null);
    }
    assert.equal(manager.getPlugin('vendor/plugin').name, 'valid');
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      assert.throws(() => manager.validateManifest({ id, name: 'bad', version: '1.0.0', entry: 'index.js' }), /unsafe/i);
    }
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test('plugin archive paths can be restricted to the upload root', () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-plugin-upload-root-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-plugin-upload-outside-'));
  try {
    const pluginsDir = path.join(appRoot, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const manager = new PluginManager({ appRoot, pluginsDir, bundledPluginsDir: path.join(appRoot, 'bundled') });
    const outsideZip = path.join(outsideRoot, 'untrusted.zip');
    fs.writeFileSync(outsideZip, 'not a zip');
    assert.throws(() => manager.installFromZip(outsideZip, { allowedRoots: [pluginsDir] }), /ZIP not found/i);
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});



test('plugin ZIP entry validation rejects traversal and symbolic-link entries', () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'korai-plugin-zip-entry-'));
  try {
    const pluginsDir = path.join(appRoot, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const manager = new PluginManager({ appRoot, pluginsDir, bundledPluginsDir: path.join(appRoot, 'bundled') });
    const destination = path.join(pluginsDir, 'vendor_plugin@1.0.0');
    const regularEntry = { entryName: 'nested/index.js', header: { size: 10, attr: 0 } };
    assert.doesNotThrow(() => manager.validateZipEntries({ getEntries: () => [regularEntry] }, destination));
    assert.throws(
      () => manager.validateZipEntries({ getEntries: () => [{ entryName: '../escape.js', header: { size: 10, attr: 0 } }] }, destination),
      /Unsafe ZIP entry|escapes destination/i
    );
    assert.throws(
      () => manager.validateZipEntries({ getEntries: () => [{ entryName: 'linked.js', header: { size: 10, attr: 0o120777 << 16 } }] }, destination),
      /Unsafe ZIP entry/i
    );
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});
