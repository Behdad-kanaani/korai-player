// pluginSettings - per-plugin configuration framework

class PluginSettings {
  constructor() {
    this.pluginSettings = {}; // pluginId -> { setting: value }
    this.pluginSchemas = {}; // pluginId -> schema definition
  }

  /**
   * Register plugin settings schema
   * schema: {
   *   name: 'Plugin Name',
   *   settings: [
   *     { key: 'theme', label: 'Theme', type: 'select', options: ['dark', 'light'], default: 'dark' },
   *     { key: 'volume', label: 'Notification Volume', type: 'range', min: 0, max: 100, default: 50 },
   *     { key: 'enabled', label: 'Enable Notifications', type: 'checkbox', default: true }
   *   ]
   * }
   */
  registerSchema(pluginId, schema) {
    if (!schema.name || !schema.settings) {
      throw new Error('Schema must have name and settings');
    }
    this.pluginSchemas[pluginId] = schema;
    if (!this.pluginSettings[pluginId]) {
      this.pluginSettings[pluginId] = {};
      // Set defaults
      const { isSafeKey } = require('./securityUtils');
      schema.settings.forEach(s => {
        if (s.default !== undefined && isSafeKey(s.key)) {
          this.pluginSettings[pluginId][s.key] = s.default;
        }
      });
    }
  }

  /**
   * Get all settings for a plugin
   */
  getPluginSettings(pluginId) {
    return this.pluginSettings[pluginId] || {};
  }

  /**
   * Update a setting
   */
  updateSetting(pluginId, key, value) {
    if (!this.pluginSettings[pluginId]) {
      this.pluginSettings[pluginId] = {};
    }
    // Validate against schema if exists
    const { isSafeKey } = require('./securityUtils');
    if (!isSafeKey(key)) throw new Error('Invalid setting key');
    if (this.pluginSchemas[pluginId]) {
      const setting = this.pluginSchemas[pluginId].settings.find(s => s.key === key);
      if (!setting) throw new Error(`Unknown setting: ${key}`);
      
      // Type validation
      if (setting.type === 'range') {
        value = Math.max(setting.min, Math.min(setting.max, Number(value)));
      } else if (setting.type === 'checkbox') {
        value = Boolean(value);
      }
    }
    this.pluginSettings[pluginId][key] = value;
    return value;
  }

  /**
   * Get schema for plugin UI rendering
   */
  getSchema(pluginId) {
    return this.pluginSchemas[pluginId] || null;
  }

  /**
   * Get all plugin schemas (for admin/settings page)
   */
  getAllSchemas() {
    return this.pluginSchemas;
  }

  /**
   * Export all settings (backup)
   */
  exportSettings() {
    return JSON.parse(JSON.stringify(this.pluginSettings));
  }

  /**
   * Import settings (restore)
   */
  importSettings(data) {
    const { isSafeKey } = require('./securityUtils');
    const out = {};
    if (!data || typeof data !== 'object') return;
    for (const pid of Object.keys(data)) {
      if (!isSafeKey(pid)) continue;
      const obj = data[pid];
      if (!obj || typeof obj !== 'object') continue;
      out[pid] = {};
      for (const k of Object.keys(obj)) {
        if (!isSafeKey(k)) continue;
        out[pid][k] = obj[k];
      }
    }
    this.pluginSettings = out;
  }
}

module.exports = PluginSettings;
