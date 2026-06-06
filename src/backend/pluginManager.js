const fs = require('fs');
const path = require('path');

class PluginManager {
    constructor(pluginsDir, settingsDb = null) {
        this.pluginsDir = pluginsDir;
        this.plugins = new Map();
        this.hooks = new Map();
        this.eventBus = new Map();
        this.settingsDb = settingsDb;
        this.pluginContexts = new Map();
    }

    ensureDirectoryExists(dirPath) {
        if (!fs.existsSync(dirPath)) {
            try {
                fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
                console.log(`Created directory: ${dirPath}`);
                return true;
            } catch (err) {
                console.error(`Failed to create directory ${dirPath}:`, err.message);
                return false;
            }
        }
        return true;
    }

    async loadPlugins() {
        if (!this.ensureDirectoryExists(this.pluginsDir)) {
            console.error('Cannot load plugins: plugins directory unavailable');
            return;
        }
        
        const items = fs.readdirSync(this.pluginsDir);
        
        for (const item of items) {
            const pluginPath = path.join(this.pluginsDir, item);
            
            if (!fs.statSync(pluginPath).isDirectory()) continue;
            
            const manifestPath = path.join(pluginPath, 'manifest.json');
            const indexPath = path.join(pluginPath, 'index.js');
            
            if (!fs.existsSync(manifestPath)) {
                console.warn(`Plugin ${item} missing manifest.json, skipping`);
                continue;
            }
            if (!fs.existsSync(indexPath)) {
                console.warn(`Plugin ${item} missing index.js, skipping`);
                continue;
            }
            
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                
                if (!manifest.id || !manifest.name || !manifest.version) {
                    console.warn(`Plugin ${item} manifest missing required fields (id/name/version), skipping`);
                    continue;
                }
                
                let iconPath = null;
                const possibleIcons = ['icon.png', 'icon.jpg', 'icon.svg', 'logo.png'];
                for (const iconFile of possibleIcons) {
                    const fullIcon = path.join(pluginPath, iconFile);
                    if (fs.existsSync(fullIcon)) {
                        iconPath = fullIcon;
                        break;
                    }
                }
                manifest.iconPath = iconPath;
                
                let pluginModule;
                try {
                    delete require.cache[require.resolve(indexPath)];
                    pluginModule = require(indexPath);
                } catch (requireErr) {
                    console.error(`Failed to require plugin ${item}:`, requireErr.message);
                    continue;
                }
                
                const pluginContext = this.createPluginContext(manifest.id);
                
                let instance;
                try {
                    instance = new pluginModule(pluginContext, this);
                } catch (instantiateErr) {
                    console.error(`Failed to instantiate plugin ${item}:`, instantiateErr.message);
                    continue;
                }
                
                const enabled = await this.isPluginEnabled(manifest.id, true);
                
                this.plugins.set(manifest.id, { manifest, instance, enabled, path: pluginPath });
                this.pluginContexts.set(manifest.id, pluginContext);
                console.log(`Plugin loaded: ${manifest.name} v${manifest.version} [${enabled ? 'enabled' : 'disabled'}]`);
                
                if (enabled && instance && typeof instance.registerHooks === 'function') {
                    this._registerAllHooks(manifest.id, instance);
                }
            } catch (err) {
                console.error(`Failed to load plugin ${item}:`, err.message);
            }
        }
        
        console.log(`Plugin loading complete. Total plugins: ${this.plugins.size}`);
    }

    createPluginContext(pluginId) {
        return {
            pluginId: pluginId,
            appVersion: '1.3.0',
            log: (...args) => console.log(`[Plugin ${pluginId}]`, ...args),
            warn: (...args) => console.warn(`[Plugin ${pluginId}]`, ...args),
            error: (...args) => console.error(`[Plugin ${pluginId}]`, ...args),
            storage: {
                get: (key) => this.getPluginStorage(pluginId, key),
                set: (key, value) => this.setPluginStorage(pluginId, key, value),
                delete: (key) => this.deletePluginStorage(pluginId, key),
                clear: () => this.clearPluginStorage(pluginId),
                getAll: () => this.getAllPluginStorage(pluginId)
            },
            emit: (eventName, payload) => this.emitEvent(eventName, payload, pluginId),
            registerHook: (hookName, callback, priority = 0) => {
                this.registerHook(hookName, callback, pluginId, priority);
            },
            unregisterAllHooks: () => this.unregisterAllPluginHooks(pluginId),
            injectCSS: (css) => {
                this.runHook('ui:injectCSS', { pluginId, css });
            },
            injectHTML: (selector, html, position = 'beforeend') => {
                this.runHook('ui:injectHTML', { pluginId, selector, html, position });
            },
            registerAPI: (route, handler, method = 'GET') => {
                this.runHook('api:registerRoute', { pluginId, route, handler, method });
            }
        };
    }

    async getPluginStorage(pluginId, key) {
        if (!this.settingsDb) return null;
        try {
            const settings = this.settingsDb.getSettings();
            const pluginStorage = settings.pluginStorage || {};
            const pluginData = pluginStorage[pluginId] || {};
            return key ? pluginData[key] : pluginData;
        } catch (err) {
            console.error(`Failed to get plugin storage for ${pluginId}:`, err);
            return null;
        }
    }

    async setPluginStorage(pluginId, key, value) {
        if (!this.settingsDb) return false;
        try {
            const settings = this.settingsDb.getSettings();
            if (!settings.pluginStorage) settings.pluginStorage = {};
            if (!settings.pluginStorage[pluginId]) settings.pluginStorage[pluginId] = {};
            settings.pluginStorage[pluginId][key] = value;
            this.settingsDb.updateSettings({ pluginStorage: settings.pluginStorage });
            return true;
        } catch (err) {
            console.error(`Failed to set plugin storage for ${pluginId}:`, err);
            return false;
        }
    }

    async deletePluginStorage(pluginId, key) {
        if (!this.settingsDb) return false;
        try {
            const settings = this.settingsDb.getSettings();
            if (settings.pluginStorage && settings.pluginStorage[pluginId]) {
                delete settings.pluginStorage[pluginId][key];
                this.settingsDb.updateSettings({ pluginStorage: settings.pluginStorage });
            }
            return true;
        } catch (err) {
            console.error(`Failed to delete plugin storage for ${pluginId}:`, err);
            return false;
        }
    }

    async clearPluginStorage(pluginId) {
        if (!this.settingsDb) return false;
        try {
            const settings = this.settingsDb.getSettings();
            if (settings.pluginStorage) {
                delete settings.pluginStorage[pluginId];
                this.settingsDb.updateSettings({ pluginStorage: settings.pluginStorage });
            }
            return true;
        } catch (err) {
            console.error(`Failed to clear plugin storage for ${pluginId}:`, err);
            return false;
        }
    }

    async getAllPluginStorage(pluginId) {
        return this.getPluginStorage(pluginId, null);
    }

    async isPluginEnabled(pluginId, defaultValue = true) {
        if (!this.settingsDb) return defaultValue;
        try {
            const settings = this.settingsDb.getSettings();
            const pluginSettings = settings.plugins || {};
            return pluginSettings[pluginId]?.enabled ?? defaultValue;
        } catch (err) {
            console.error(`Failed to read plugin enabled state for ${pluginId}:`, err.message);
            return defaultValue;
        }
    }

    async setPluginEnabled(pluginId, enabled) {
        if (!this.settingsDb) return false;
        
        try {
            const settings = this.settingsDb.getSettings();
            if (!settings.plugins) settings.plugins = {};
            if (!settings.plugins[pluginId]) settings.plugins[pluginId] = {};
            settings.plugins[pluginId].enabled = enabled;
            this.settingsDb.updateSettings({ plugins: settings.plugins });
            
            const plugin = this.plugins.get(pluginId);
            if (plugin) {
                plugin.enabled = enabled;
                if (enabled) {
                    this._registerAllHooks(pluginId, plugin.instance);
                } else {
                    this.unregisterAllPluginHooks(pluginId);
                }
            }
            return true;
        } catch (err) {
            console.error(`Failed to set plugin ${pluginId} enabled state:`, err.message);
            return false;
        }
    }

    registerHook(hookName, callback, pluginId, priority = 0) {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }
        const hooksList = this.hooks.get(hookName);
        hooksList.push({ pluginId, callback, priority });
        hooksList.sort((a, b) => b.priority - a.priority);
        console.log(`Hook registered: ${hookName} for plugin ${pluginId} (priority: ${priority})`);
    }

    unregisterAllPluginHooks(pluginId) {
        let removedCount = 0;
        for (const [hookName, hooksList] of this.hooks.entries()) {
            const beforeCount = hooksList.length;
            const filtered = hooksList.filter(h => h.pluginId !== pluginId);
            if (filtered.length !== beforeCount) {
                this.hooks.set(hookName, filtered);
                removedCount += beforeCount - filtered.length;
            }
        }
        if (removedCount > 0) {
            console.log(`Unregistered ${removedCount} hooks for plugin: ${pluginId}`);
        }
    }

    _registerAllHooks(pluginId, instance) {
        console.log(`Registering hooks for plugin ${pluginId}...`);
        
        if (instance && typeof instance.registerHooks === 'function') {
            try {
                instance.registerHooks(this);
                console.log(`Hooks registered for plugin: ${pluginId}`);
            } catch (err) {
                console.error(`Plugin ${pluginId} registerHooks error:`, err.message);
            }
        } else {
            console.warn(`Plugin ${pluginId} has no registerHooks method`);
            if (instance) {
                console.log(`Plugin instance methods:`, Object.getOwnPropertyNames(Object.getPrototypeOf(instance)));
            }
        }
    }

    async runHook(hookName, payload) {
        const hooksList = this.hooks.get(hookName);
        if (!hooksList || hooksList.length === 0) return payload;
        
        let result = payload;
        
        for (const hook of hooksList) {
            const plugin = this.plugins.get(hook.pluginId);
            if (plugin && plugin.enabled) {
                try {
                    const hookResult = await hook.callback(result);
                    if (hookResult !== undefined) {
                        result = hookResult;
                    }
                } catch (err) {
                    console.error(`Plugin ${hook.pluginId} hook error (${hookName}):`, err.message);
                }
            }
        }
        
        return result;
    }

    runHookSync(hookName, payload) {
        const hooksList = this.hooks.get(hookName);
        if (!hooksList || hooksList.length === 0) return payload;
        
        let result = payload;
        
        for (const hook of hooksList) {
            const plugin = this.plugins.get(hook.pluginId);
            if (plugin && plugin.enabled) {
                try {
                    const hookResult = hook.callback(result);
                    if (hookResult !== undefined) {
                        result = hookResult;
                    }
                } catch (err) {
                    console.error(`Plugin ${hook.pluginId} sync hook error (${hookName}):`, err.message);
                }
            }
        }
        
        return result;
    }

    async runHookWithCancel(hookName, payload) {
        const hooksList = this.hooks.get(hookName);
        if (!hooksList || hooksList.length === 0) return { cancelled: false, payload };
        
        let result = payload;
        
        for (const hook of hooksList) {
            const plugin = this.plugins.get(hook.pluginId);
            if (plugin && plugin.enabled) {
                try {
                    const hookResult = await hook.callback(result);
                    if (hookResult && hookResult.cancel === true) {
                        return { cancelled: true, payload: hookResult.payload || result };
                    }
                    if (hookResult !== undefined) {
                        result = hookResult;
                    }
                } catch (err) {
                    console.error(`Plugin ${hook.pluginId} hook error (${hookName}):`, err.message);
                }
            }
        }
        
        return { cancelled: false, payload: result };
    }

    async emitEvent(eventName, payload, sourcePluginId = null) {
        const listeners = this.eventBus.get(eventName);
        if (!listeners || listeners.length === 0) return;
        
        for (const listener of listeners) {
            if (sourcePluginId && listener.pluginId === sourcePluginId) continue;
            const plugin = this.plugins.get(listener.pluginId);
            if (plugin && plugin.enabled) {
                try {
                    await listener.callback(payload, { eventName, sourcePluginId });
                } catch (err) {
                    console.error(`Plugin ${listener.pluginId} event error (${eventName}):`, err.message);
                }
            }
        }
    }

    on(eventName, callback, pluginId) {
        if (!this.eventBus.has(eventName)) {
            this.eventBus.set(eventName, []);
        }
        this.eventBus.get(eventName).push({ pluginId, callback });
        console.log(`Event listener registered: ${eventName} for plugin ${pluginId}`);
    }

    off(eventName, pluginId) {
        const listeners = this.eventBus.get(eventName);
        if (listeners) {
            const filtered = listeners.filter(l => l.pluginId !== pluginId);
            this.eventBus.set(eventName, filtered);
        }
    }

    removeAllEventListeners(pluginId) {
        for (const [eventName, listeners] of this.eventBus.entries()) {
            const filtered = listeners.filter(l => l.pluginId !== pluginId);
            if (filtered.length !== listeners.length) {
                this.eventBus.set(eventName, filtered);
            }
        }
    }

    async uninstallPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;
        
        this.unregisterAllPluginHooks(pluginId);
        this.removeAllEventListeners(pluginId);
        await this.clearPluginStorage(pluginId);
        
        try {
            fs.rmSync(plugin.path, { recursive: true, force: true });
            console.log(`Plugin uninstalled: ${pluginId}`);
        } catch (err) {
            console.error(`Failed to delete plugin folder: ${plugin.path}`, err);
            return false;
        }
        
        this.plugins.delete(pluginId);
        this.pluginContexts.delete(pluginId);
        return true;
    }

    getPluginsList() {
        return Array.from(this.plugins.values()).map(p => ({
            id: p.manifest.id,
            name: p.manifest.name,
            version: p.manifest.version,
            description: p.manifest.description || '',
            author: p.manifest.author || '',
            enabled: p.enabled,
            iconPath: p.manifest.iconPath ? `/api/plugins/icon/${p.manifest.id}` : null
        }));
    }

    async reloadPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;
        
        this.unregisterAllPluginHooks(pluginId);
        this.removeAllEventListeners(pluginId);
        
        const indexPath = path.join(plugin.path, 'index.js');
        delete require.cache[require.resolve(indexPath)];
        
        const manifestPath = path.join(plugin.path, 'manifest.json');
        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (err) {
            console.error(`Failed to reload manifest for ${pluginId}:`, err);
            return false;
        }
        
        let pluginModule;
        try {
            pluginModule = require(indexPath);
        } catch (err) {
            console.error(`Failed to reload module for ${pluginId}:`, err);
            return false;
        }
        
        const pluginContext = this.createPluginContext(pluginId);
        let instance;
        try {
            instance = new pluginModule(pluginContext, this);
        } catch (err) {
            console.error(`Failed to re-instantiate plugin ${pluginId}:`, err);
            return false;
        }
        
        plugin.manifest = manifest;
        plugin.instance = instance;
        this.pluginContexts.set(pluginId, pluginContext);
        
        if (plugin.enabled && instance && typeof instance.registerHooks === 'function') {
            this._registerAllHooks(pluginId, instance);
        }
        
        console.log(`Plugin reloaded: ${manifest.name} v${manifest.version}`);
        return true;
    }

    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
}

module.exports = PluginManager;