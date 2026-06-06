/**
 * pluginManager.js - KORAI Player Plugin Management System (Enhanced)
 * 
 * Manages loading, enabling/disabling, and hook registration for all plugins.
 * Now supports unlimited hooks across all application layers:
 * - Playback (beforePlay, afterPlay, onPause, onSeek, etc.)
 * - Library (beforeImport, afterImport, trackMetadataUpdate, etc.)
 * - UI (inject, addSidebarItem, addContextMenuItem, addPlaybackButton, etc.)
 * - Queue/Playlist (beforeAdd, afterRemove, playlistCreate, etc.)
 * - AI/Recommendations (modify, train, customSource, etc.)
 * - Settings/Storage (beforeSave, afterLoad, databaseQuery, etc.)
 * - Server/API (beforeRequest, registerRoute, etc.)
 * - Window/Tray (beforeClose, focus, trayMenuBuild, etc.)
 * - Shortcuts/Commands (registerShortcut, executeCommand)
 * 
 * Features:
 * - Dynamic hook registration (any string allowed)
 * - Async and sync hook execution
 * - Payload modification by reference
 * - Event bus for inter-plugin communication
 * - Full backward compatibility with existing hooks
 */

const fs = require('fs');
const path = require('path');

class PluginManager {
    constructor(pluginsDir, settingsDb = null) {
        this.pluginsDir = pluginsDir;
        this.plugins = new Map();      // id -> { manifest, instance, enabled, path }
        this.hooks = new Map();        // hookName -> [{ pluginId, callback, priority }]
        this.eventBus = new Map();     // eventName -> [{ pluginId, callback }]
        this.settingsDb = settingsDb;  // reference to db for storing enabled state
        this.pluginContexts = new Map(); // pluginId -> context object
    }

    /**
     * Ensure a directory exists, create it if necessary
     */
    ensureDirectoryExists(dirPath) {
        if (!fs.existsSync(dirPath)) {
            try {
                fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
                console.log(`📁 Created directory: ${dirPath}`);
                return true;
            } catch (err) {
                console.error(`❌ Failed to create directory ${dirPath}:`, err.message);
                return false;
            }
        }
        return true;
    }

    /**
     * Load all plugins from the plugins directory
     * Gracefully handles errors without crashing the application
     */
    async loadPlugins() {
        // Ensure plugins directory exists
        if (!this.ensureDirectoryExists(this.pluginsDir)) {
            console.error('❌ Cannot load plugins: plugins directory unavailable');
            return;
        }
        
        const items = fs.readdirSync(this.pluginsDir);
        
        for (const item of items) {
            const pluginPath = path.join(this.pluginsDir, item);
            
            // Skip files, only process directories
            if (!fs.statSync(pluginPath).isDirectory()) continue;
            
            const manifestPath = path.join(pluginPath, 'manifest.json');
            const indexPath = path.join(pluginPath, 'index.js');
            
            // Validate required files exist
            if (!fs.existsSync(manifestPath)) {
                console.warn(`⚠️ Plugin ${item} missing manifest.json, skipping`);
                continue;
            }
            if (!fs.existsSync(indexPath)) {
                console.warn(`⚠️ Plugin ${item} missing index.js, skipping`);
                continue;
            }
            
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                
                // Validate manifest has required fields
                if (!manifest.id || !manifest.name || !manifest.version) {
                    console.warn(`⚠️ Plugin ${item} manifest missing required fields (id/name/version), skipping`);
                    continue;
                }
                
                // Load optional icon (png/jpg/svg)
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
                
                // Load plugin module with error handling
                let pluginModule;
                try {
                    // Clear require cache to allow reloading updated plugins
                    delete require.cache[require.resolve(indexPath)];
                    pluginModule = require(indexPath);
                } catch (requireErr) {
                    console.error(`❌ Failed to require plugin ${item}:`, requireErr.message);
                    continue;
                }
                
                // Create plugin context (sandboxed access)
                const pluginContext = this.createPluginContext(manifest.id);
                
                // Instantiate plugin
                let instance;
                try {
                    instance = new pluginModule(pluginContext, this);
                } catch (instantiateErr) {
                    console.error(`❌ Failed to instantiate plugin ${item}:`, instantiateErr.message);
                    continue;
                }
                
                // Read enabled state from settings (default true)
                const enabled = await this.isPluginEnabled(manifest.id, true);
                
                this.plugins.set(manifest.id, { manifest, instance, enabled, path: pluginPath });
                this.pluginContexts.set(manifest.id, pluginContext);
                console.log(`✅ Plugin loaded: ${manifest.name} v${manifest.version} [${enabled ? 'enabled' : 'disabled'}]`);
                
                if (enabled && instance && typeof instance.registerHooks === 'function') {
                    this._registerAllHooks(manifest.id, instance);
                }
            } catch (err) {
                console.error(`❌ Failed to load plugin ${item}:`, err.message);
            }
        }
        
        console.log(`📊 Plugin loading complete. Total plugins: ${this.plugins.size}`);
    }

    /**
     * Create a safe context object for plugin to interact with the app
     * This gives plugins controlled access to app functionalities
     */
    createPluginContext(pluginId) {
        return {
            pluginId: pluginId,
            // App info
            appVersion: require('../../package.json').version,
            // Logging
            log: (...args) => console.log(`[Plugin ${pluginId}]`, ...args),
            warn: (...args) => console.warn(`[Plugin ${pluginId}]`, ...args),
            error: (...args) => console.error(`[Plugin ${pluginId}]`, ...args),
            // Storage (isolated per plugin)
            storage: {
                get: (key) => this.getPluginStorage(pluginId, key),
                set: (key, value) => this.setPluginStorage(pluginId, key, value),
                delete: (key) => this.deletePluginStorage(pluginId, key),
                clear: () => this.clearPluginStorage(pluginId),
                getAll: () => this.getAllPluginStorage(pluginId)
            },
            // Event bus (emit events to other plugins)
            emit: (eventName, payload) => this.emitEvent(eventName, payload, pluginId),
            // Register hooks (simplified)
            registerHook: (hookName, callback, priority = 0) => {
                this.registerHook(hookName, callback, pluginId, priority);
            },
            // Unregister all hooks of this plugin
            unregisterAllHooks: () => this.unregisterAllPluginHooks(pluginId),
            // UI injection helpers (will be forwarded to main app via hooks)
            injectCSS: (css) => {
                this.runHook('ui:injectCSS', { pluginId, css });
            },
            injectHTML: (selector, html, position = 'beforeend') => {
                this.runHook('ui:injectHTML', { pluginId, selector, html, position });
            },
            // API registration
            registerAPI: (route, handler, method = 'GET') => {
                this.runHook('api:registerRoute', { pluginId, route, handler, method });
            }
        };
    }

    /**
     * Plugin storage methods (using settingsDb)
     */
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

    /**
     * Check if a plugin is enabled in settings
     */
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

    /**
     * Enable or disable a plugin
     */
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

    /**
     * Register a hook (any string allowed)
     * @param {string} hookName - Name of the hook (e.g., 'playback:beforePlay')
     * @param {Function} callback - Async or sync function that receives payload and returns modified payload
     * @param {string} pluginId - ID of the plugin registering the hook
     * @param {number} priority - Higher priority runs first (default 0)
     */
    registerHook(hookName, callback, pluginId, priority = 0) {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }
        const hooksList = this.hooks.get(hookName);
        hooksList.push({ pluginId, callback, priority });
        // Sort by priority (higher first)
        hooksList.sort((a, b) => b.priority - a.priority);
        console.log(`🔌 Hook registered: ${hookName} for plugin ${pluginId} (priority: ${priority})`);
    }

    /**
     * Unregister all hooks belonging to a plugin
     */
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
            console.log(`🔌 Unregistered ${removedCount} hooks for plugin: ${pluginId}`);
        }
    }

    /**
     * Register all hooks from a plugin instance (backward compatible)
     */
    _registerAllHooks(pluginId, instance) {
        if (instance && typeof instance.registerHooks === 'function') {
            try {
                instance.registerHooks(this);
                console.log(`🔌 Hooks registered for plugin: ${pluginId}`);
            } catch (err) {
                console.error(`Plugin ${pluginId} registerHooks error:`, err.message);
            }
        }
    }

    /**
     * Run a hook (async) - allows payload modification
     * @param {string} hookName - Name of the hook
     * @param {any} payload - Data to pass through hooks
     * @returns {Promise<any>} - Modified payload after all hooks
     */
    async runHook(hookName, payload) {
        const hooksList = this.hooks.get(hookName);
        if (!hooksList || hooksList.length === 0) return payload;
        
        let result = payload;
        
        for (const hook of hooksList) {
            // Only run hooks from enabled plugins
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

    /**
     * Run a hook synchronously - for non-async operations
     */
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

    /**
     * Run hook with early termination (if any hook returns { cancel: true })
     */
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

    /**
     * Event Bus: Emit an event to all plugins listening
     */
    async emitEvent(eventName, payload, sourcePluginId = null) {
        const listeners = this.eventBus.get(eventName);
        if (!listeners || listeners.length === 0) return;
        
        for (const listener of listeners) {
            // Don't send event back to source plugin if specified
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

    /**
     * Register an event listener
     */
    on(eventName, callback, pluginId) {
        if (!this.eventBus.has(eventName)) {
            this.eventBus.set(eventName, []);
        }
        this.eventBus.get(eventName).push({ pluginId, callback });
        console.log(`📡 Event listener registered: ${eventName} for plugin ${pluginId}`);
    }

    /**
     * Remove event listener
     */
    off(eventName, pluginId) {
        const listeners = this.eventBus.get(eventName);
        if (listeners) {
            const filtered = listeners.filter(l => l.pluginId !== pluginId);
            this.eventBus.set(eventName, filtered);
        }
    }

    /**
     * Remove all event listeners for a plugin
     */
    removeAllEventListeners(pluginId) {
        for (const [eventName, listeners] of this.eventBus.entries()) {
            const filtered = listeners.filter(l => l.pluginId !== pluginId);
            if (filtered.length !== listeners.length) {
                this.eventBus.set(eventName, filtered);
            }
        }
    }

    /**
     * Uninstall a plugin by deleting its directory
     */
    async uninstallPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;
        
        // Remove all hooks
        this.unregisterAllPluginHooks(pluginId);
        // Remove all event listeners
        this.removeAllEventListeners(pluginId);
        // Clear plugin storage
        await this.clearPluginStorage(pluginId);
        
        // Delete plugin directory
        try {
            fs.rmSync(plugin.path, { recursive: true, force: true });
            console.log(`✅ Plugin uninstalled: ${pluginId}`);
        } catch (err) {
            console.error(`Failed to delete plugin folder: ${plugin.path}`, err);
            return false;
        }
        
        this.plugins.delete(pluginId);
        this.pluginContexts.delete(pluginId);
        return true;
    }

    /**
     * Get list of all plugins for UI display
     */
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

    /**
     * Reload a specific plugin (useful for development)
     */
    async reloadPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;
        
        // Unload
        this.unregisterAllPluginHooks(pluginId);
        this.removeAllEventListeners(pluginId);
        
        // Clear require cache
        const indexPath = path.join(plugin.path, 'index.js');
        delete require.cache[require.resolve(indexPath)];
        
        // Reload manifest
        const manifestPath = path.join(plugin.path, 'manifest.json');
        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (err) {
            console.error(`Failed to reload manifest for ${pluginId}:`, err);
            return false;
        }
        
        // Reload module
        let pluginModule;
        try {
            pluginModule = require(indexPath);
        } catch (err) {
            console.error(`Failed to reload module for ${pluginId}:`, err);
            return false;
        }
        
        // Re-instantiate
        const pluginContext = this.createPluginContext(pluginId);
        let instance;
        try {
            instance = new pluginModule(pluginContext, this);
        } catch (err) {
            console.error(`Failed to re-instantiate plugin ${pluginId}:`, err);
            return false;
        }
        
        // Update
        plugin.manifest = manifest;
        plugin.instance = instance;
        this.pluginContexts.set(pluginId, pluginContext);
        
        if (plugin.enabled && instance && typeof instance.registerHooks === 'function') {
            this._registerAllHooks(pluginId, instance);
        }
        
        console.log(`🔄 Plugin reloaded: ${manifest.name} v${manifest.version}`);
        return true;
    }

    /**
     * Get plugin instance by ID
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
}

module.exports = PluginManager;