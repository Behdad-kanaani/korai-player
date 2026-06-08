const PluginManager = require('../src/backend/pluginManager');
(async () => {
  try {
    const pm = new PluginManager({ appRoot: process.cwd() });
    console.log('Plugins dir:', pm.pluginsDir);
    console.log('Registry keys:', Object.keys(pm.registry));
    console.log(JSON.stringify(pm.registry, null, 2));
  } catch (e) {
    console.error('Error:', e && e.message);
    process.exit(1);
  }
})();
