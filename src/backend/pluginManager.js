/**
 * pluginManager.js - KORAI Player Plugin Management System
 * 
 * Manages loading, enabling/disabling, and hook registration for all plugins.
 * 
 * FIXES APPLIED:
 * - Added graceful error handling for plugin loading failures
 * - Prevents crashes when plugin manifest or index.js is malformed
 * - Preserves all existing functionality and hooks
 * - Added ensureDirectoryExists helper
 * - Added validation for manifest required fields
 * - Added proper error logging without breaking app
 */

const fs = require('fs');
const path = require('path');

class PluginManager {
    constructor(pluginsDir, settingsDb = null) {
        this.pluginsDir = pluginsDir;
        this.plugins = new Map();      // id -> { manifest, instance, enabled }
        this.hooks = {
            'track:beforePlay': [],
            'track:afterPlay': [],
            'recommendations:modify': [],
            'ui:inject': []
        };
        this.settingsDb = settingsDb;   // reference to db for storing enabled state
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
                
                // Instantiate plugin
                let instance;
                try {
                    instance = new pluginModule(this);
                } catch (instantiateErr) {
                    console.error(`❌ Failed to instantiate plugin ${item}:`, instantiateErr.message);
                    continue;
                }
                
                // Read enabled state from settings (default true)
                const enabled = await this.isPluginEnabled(manifest.id, true);
                
                this.plugins.set(manifest.id, { manifest, instance, enabled, path: pluginPath });
                console.log(`✅ Plugin loaded: ${manifest.name} v${manifest.version} [${enabled ? 'enabled' : 'disabled'}]`);
                
                if (enabled && instance && typeof instance.registerHooks === 'function') {
                    this._registerHooks(manifest.id, instance);
                }
            } catch (err) {
                console.error(`❌ Failed to load plugin ${item}:`, err.message);
            }
        }
        
        console.log(`📊 Plugin loading complete. Total plugins: ${this.plugins.size}`);
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
                    this._registerHooks(pluginId, plugin.instance);
                } else {
                    this._unregisterHooks(pluginId);
                }
            }
            return true;
        } catch (err) {
            console.error(`Failed to set plugin ${pluginId} enabled state:`, err.message);
            return false;
        }
    }

    /**
     * Register all hooks from a plugin instance
     */
    _registerHooks(pluginId, instance) {
        // Re-register hooks if the plugin instance has registerHooks method
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
     * Unregister all hooks belonging to a plugin
     */
    _unregisterHooks(pluginId) {
        // Remove all hooks registered by this plugin
        let removedCount = 0;
        for (const hookName in this.hooks) {
            const beforeCount = this.hooks[hookName].length;
            this.hooks[hookName] = this.hooks[hookName].filter(h => h.pluginId !== pluginId);
            removedCount += beforeCount - this.hooks[hookName].length;
        }
        if (removedCount > 0) {
            console.log(`🔌 Unregistered ${removedCount} hooks for plugin: ${pluginId}`);
        }
    }

    /**
     * Uninstall a plugin by deleting its directory
     */
    async uninstallPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;
        
        // Remove hooks first
        this._unregisterHooks(pluginId);
        
        // Delete plugin directory
        try {
            fs.rmSync(plugin.path, { recursive: true, force: true });
            console.log(`✅ Plugin uninstalled: ${pluginId}`);
        } catch (err) {
            console.error(`Failed to delete plugin folder: ${plugin.path}`, err);
            return false;
        }
        
        this.plugins.delete(pluginId);
        return true;
    }

    /**
     * Register a hook callback
     */
    registerHook(hookName, callback, pluginId) {
        if (this.hooks[hookName]) {
            this.hooks[hookName].push({ callback, pluginId });
            console.log(`🔌 Hook registered: ${hookName} for plugin ${pluginId}`);
        } else {
            console.warn(`⚠️ Unknown hook name: ${hookName} for plugin ${pluginId}`);
        }
    }

    /**
     * Execute all hooks of a specific type
     */
    async runHook(hookName, payload) {
        if (!this.hooks[hookName]) return payload;
        
        let result = payload;
        
        for (const hook of this.hooks[hookName]) {
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
}

module.exports = PluginManager;