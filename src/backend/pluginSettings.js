// pluginSettings - per-plugin configuration framework

const { isSafeKey, isSafeObjectKey } = require('./securityUtils');

function createRecord() {
  return Object.create(null);
}

function cloneSafeValue(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 20) throw new Error('Setting value is too deeply nested');
  if (Array.isArray(value)) return value.slice(0, 10_000).map(item => cloneSafeValue(item, depth + 1));

  const output = createRecord();
  for (const key of Object.keys(value).slice(0, 10_000)) {
    if (!isSafeObjectKey(key)) continue;
    output[key] = cloneSafeValue(value[key], depth + 1);
  }
  return output;
}

class PluginSettings {
  constructor() {
    this.pluginSettings = createRecord(); // pluginId -> null-prototype setting record
    this.pluginSchemas = createRecord(); // pluginId -> schema definition
  }

  /**
   * Register a plugin settings schema.
   * Invalid setting keys are excluded so a plugin cannot introduce
   * prototype-sensitive names into the settings dictionaries.
   */
  registerSchema(pluginId, schema) {
    if (!isSafeObjectKey(pluginId)) throw new Error('Invalid plugin id');
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) ||
        !schema.name || !Array.isArray(schema.settings)) {
      throw new Error('Schema must have name and settings');
    }

    const safeSchema = {
      ...schema,
      settings: schema.settings.filter(setting =>
        setting && typeof setting === 'object' && isSafeKey(setting.key)
      )
    };
    this.pluginSchemas[pluginId] = safeSchema;

    if (!Object.hasOwn(this.pluginSettings, pluginId)) {
      const settings = createRecord();
      for (const setting of safeSchema.settings) {
        if (setting.default !== undefined) settings[setting.key] = cloneSafeValue(setting.default);
      }
      this.pluginSettings[pluginId] = settings;
    }
  }

  /** Get all settings for a plugin. */
  getPluginSettings(pluginId) {
    if (!isSafeObjectKey(pluginId) || !Object.hasOwn(this.pluginSettings, pluginId)) return createRecord();
    return this.pluginSettings[pluginId];
  }

  /** Update a setting. */
  updateSetting(pluginId, key, value) {
    if (!isSafeObjectKey(pluginId)) throw new Error('Invalid plugin id');
    if (!isSafeKey(key)) throw new Error('Invalid setting key');
    if (!Object.hasOwn(this.pluginSettings, pluginId)) this.pluginSettings[pluginId] = createRecord();

    if (Object.hasOwn(this.pluginSchemas, pluginId)) {
      const setting = this.pluginSchemas[pluginId].settings.find(item => item.key === key);
      if (!setting) throw new Error(`Unknown setting: ${key}`);

      if (setting.type === 'range') {
        const numericValue = Number(value);
        value = Number.isFinite(numericValue)
          ? Math.max(setting.min, Math.min(setting.max, numericValue))
          : setting.min;
      } else if (setting.type === 'checkbox') {
        value = Boolean(value);
      }
    }

    this.pluginSettings[pluginId][key] = cloneSafeValue(value);
    return this.pluginSettings[pluginId][key];
  }

  /** Get schema for plugin UI rendering. */
  getSchema(pluginId) {
    if (!isSafeObjectKey(pluginId) || !Object.hasOwn(this.pluginSchemas, pluginId)) return null;
    return this.pluginSchemas[pluginId];
  }

  /** Get all plugin schemas (for admin/settings page). */
  getAllSchemas() {
    return this.pluginSchemas;
  }

  /** Export all settings (backup). */
  exportSettings() {
    return JSON.parse(JSON.stringify(this.pluginSettings));
  }

  /** Import settings (restore), dropping dangerous object keys recursively. */
  importSettings(data) {
    const out = createRecord();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      this.pluginSettings = out;
      return;
    }

    for (const pluginId of Object.keys(data)) {
      if (!isSafeObjectKey(pluginId)) continue;
      const settings = data[pluginId];
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue;
      const safeSettings = createRecord();
      for (const key of Object.keys(settings)) {
        if (!isSafeKey(key)) continue;
        safeSettings[key] = cloneSafeValue(settings[key]);
      }
      out[pluginId] = safeSettings;
    }
    this.pluginSettings = out;
  }
}

module.exports = PluginSettings;
