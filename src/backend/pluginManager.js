// src/backend/pluginManager.js
const fs = require('fs');
const path = require('path');

class PluginManager {
    constructor(pluginsDir) {
        this.pluginsDir = pluginsDir;
        this.plugins = new Map();
        this.hooks = {
            'track:beforePlay': [],
            'track:afterPlay': [],
            'recommendations:modify': [],
            'ui:inject': []
        };
    }

    async loadPlugins() {
        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
            return;
        }
        const items = fs.readdirSync(this.pluginsDir);
        for (const item of items) {
            const pluginPath = path.join(this.pluginsDir, item);
            if (fs.statSync(pluginPath).isDirectory()) {
                const manifestPath = path.join(pluginPath, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    try {
                        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                        const pluginModule = require(path.join(pluginPath, 'index.js'));
                        const instance = new pluginModule(this);
                        this.plugins.set(manifest.id, { manifest, instance });
                        console.log(`✅ Plugin loaded: ${manifest.name} v${manifest.version}`);
                    } catch (err) {
                        console.error(`❌ Failed to load plugin ${item}:`, err.message);
                    }
                }
            }
        }
    }

    registerHook(hookName, callback, pluginId) {
        if (this.hooks[hookName]) {
            this.hooks[hookName].push({ callback, pluginId });
        }
    }

    async runHook(hookName, payload) {
        if (!this.hooks[hookName]) return payload;
        let result = payload;
        for (const hook of this.hooks[hookName]) {
            try {
                result = await hook.callback(result) || result;
            } catch (err) {
                console.error(`Plugin ${hook.pluginId} hook error:`, err);
            }
        }
        return result;
    }

    getPluginsList() {
        return Array.from(this.plugins.values()).map(p => ({
            id: p.manifest.id,
            name: p.manifest.name,
            version: p.manifest.version,
            description: p.manifest.description
        }));
    }
}

module.exports = PluginManager;