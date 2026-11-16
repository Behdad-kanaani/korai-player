const test = require('node:test');
const assert = require('node:assert/strict');
const PluginHost = require('./pluginHost');

test('plugin host rejects prototype-sensitive IDs before registry access or worker creation', async () => {
  const registry = JSON.parse('{"__proto__":{"enabled":true,"path":"/tmp","entry":"index.js"},"constructor":{"enabled":true},"prototype":{"enabled":true}}');
  const host = new PluginHost(registry, { logger: { log() {}, warn() {}, error() {} } });
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    await assert.rejects(host.activatePlugin(id), /Invalid plugin id/);
  }
});

test('plugin host does not activate inherited registry properties', async () => {
  const registry = Object.create({ inherited: { enabled: true, path: process.cwd(), entry: 'main.js' } });
  const host = new PluginHost(registry, { logger: { log() {}, warn() {}, error() {} } });
  await assert.rejects(host.activatePlugin('inherited'), /Plugin not found or not enabled/);
});
