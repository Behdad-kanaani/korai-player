const test = require('node:test');
const assert = require('node:assert/strict');
const PluginSettings = require('./pluginSettings');

test('plugin settings reject dangerous plugin and setting keys and use null-prototype records', () => {
  const settings = new PluginSettings();
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true},"korai/example":{"theme":"dark","__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true},"nested":{"prototype":{"polluted":true},"valid":7}}}');

  settings.importSettings(input);
  assert.equal(Object.getPrototypeOf(settings.pluginSettings), null);
  const pluginValues = settings.getPluginSettings('korai/example');
  assert.equal(Object.getPrototypeOf(pluginValues), null);
  assert.equal(pluginValues.theme, 'dark');
  assert.equal(Object.hasOwn(pluginValues, '__proto__'), false);
  assert.equal(Object.hasOwn(pluginValues, 'constructor'), false);
  assert.equal(Object.hasOwn(pluginValues, 'prototype'), false);
  assert.equal(Object.getPrototypeOf(pluginValues.nested), null);
  assert.equal(Object.hasOwn(pluginValues.nested, 'prototype'), false);
  assert.equal(Object.prototype.polluted, undefined);

  assert.throws(() => settings.updateSetting('korai/example', '__proto__', true), /Invalid setting key/);
  assert.throws(() => settings.updateSetting('constructor', 'theme', true), /Invalid plugin id/);
  assert.throws(() => settings.registerSchema('__proto__', { name: 'bad', settings: [] }), /Invalid plugin id/);
});

test('valid namespaced plugin settings and defaults remain supported', () => {
  const settings = new PluginSettings();
  settings.registerSchema('vendor/plugin', {
    name: 'Example',
    settings: [
      { key: 'theme', type: 'select', default: 'dark', options: ['dark', 'light'] },
      { key: 'volume', type: 'range', min: 0, max: 100, default: 50 },
      { key: '__proto__', default: 'ignored' },
      { key: 'constructor', default: 'ignored' },
      { key: 'prototype', default: 'ignored' }
    ]
  });

  assert.equal(settings.getPluginSettings('vendor/plugin').theme, 'dark');
  assert.equal(settings.updateSetting('vendor/plugin', 'volume', 120), 100);
  assert.deepEqual(settings.getSchema('vendor/plugin').settings.map(item => item.key), ['theme', 'volume']);
  assert.equal(Object.getPrototypeOf(settings.getAllSchemas()), null);
});
