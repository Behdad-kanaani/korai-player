// The catalog contains metadata only; plugins are loaded through the normal
// permission and worker checks.

const fs = require('fs');
const path = require('path');
const { assertSafeUrl } = require('./securityUtils');

const DEFAULT_REMOTE_REGISTRY = 'https://raw.githubusercontent.com/Behdad-kanaani/korai-player/main/plugins/registry.json';

class PluginStore {
  constructor(opts = {}) {
    this.appRoot = opts.appRoot || path.resolve(__dirname, '..', '..');
    this.registryPath = opts.registryPath || path.join(this.appRoot, 'plugins', 'registry.json');
    this.remoteRegistryUrl = opts.remoteRegistryUrl || DEFAULT_REMOTE_REGISTRY;
    this.remoteEnabled = opts.remoteEnabled !== false;
    this.cacheTtlMs = Number.isFinite(opts.cacheTtlMs) ? Math.max(0, opts.cacheTtlMs) : 5 * 60 * 1000;
    this.cache = { loadedAt: 0, plugins: [] };
  }

  readLocalRegistry() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.plugins) ? parsed.plugins : [];
    } catch {
      return [];
    }
  }

  normalizePlugin(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.version !== 'string') return null;
    if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/.test(raw.id)) return null;
    return {
      id: raw.id,
      name: raw.name.slice(0, 120),
      version: raw.version,
      author: typeof raw.author === 'string' ? raw.author.slice(0, 120) : 'Unknown author',
      description: typeof raw.description === 'string' ? raw.description.slice(0, 600) : '',
      tags: Array.isArray(raw.tags) ? raw.tags.filter(v => typeof v === 'string').slice(0, 12) : [],
      featured: Boolean(raw.featured),
      installable: Boolean(raw.installable),
      downloadUrl: typeof raw.downloadUrl === 'string' ? raw.downloadUrl : null,
      homepage: typeof raw.homepage === 'string' ? raw.homepage : null,
      source: raw.source === 'github' ? 'github' : 'catalog'
    };
  }

  async loadCatalog(force = false) {
    if (!force && Date.now() - this.cache.loadedAt < this.cacheTtlMs) return this.cache.plugins;

    let rawPlugins = this.readLocalRegistry();
    if (this.remoteEnabled) {
      try {
        const safeUrl = await assertSafeUrl(this.remoteRegistryUrl, {
          allowHosts: ['raw.githubusercontent.com']
        });
        const response = await fetch(safeUrl, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const remote = await response.json();
          const remotePlugins = Array.isArray(remote) ? remote : Array.isArray(remote?.plugins) ? remote.plugins : [];
          rawPlugins = remotePlugins.length ? remotePlugins : rawPlugins;
        }
      } catch (error) {
        // Keep using the local catalog when offline.
        console.warn('[pluginStore] Remote catalog unavailable:', error.message);
      }
    }

    const seen = new Set();
    const plugins = [];
    for (const raw of rawPlugins) {
      const plugin = this.normalizePlugin(raw);
      if (!plugin || seen.has(plugin.id)) continue;
      seen.add(plugin.id);
      plugins.push(plugin);
    }

    this.cache = { loadedAt: Date.now(), plugins };
    return plugins;
  }

  async getFeaturedPlugins() {
    const plugins = await this.loadCatalog();
    return plugins.filter(plugin => plugin.featured || plugin.installable);
  }

  async searchPlugins(query) {
    const q = String(query || '').trim().toLowerCase();
    const plugins = await this.loadCatalog();
    if (!q) return plugins.filter(plugin => plugin.featured || plugin.installable);
    return plugins.filter(plugin => [plugin.id, plugin.name, plugin.author, plugin.description, ...plugin.tags]
      .some(value => String(value || '').toLowerCase().includes(q)));
  }

  async getPluginDetails(id) {
    if (typeof id !== 'string') return null;
    const plugins = await this.loadCatalog();
    return plugins.find(plugin => plugin.id === id) || null;
  }

  async checkUpdates(installedPlugins) {
    const updates = [];
    for (const installed of Array.isArray(installedPlugins) ? installedPlugins : []) {
      const available = await this.getPluginDetails(installed.id);
      if (available && this.compareVersions(available.version, installed.version) > 0) {
        updates.push({
          id: installed.id,
          currentVersion: installed.version,
          newVersion: available.version,
          plugin: available
        });
      }
    }
    return updates;
  }

  compareVersions(v1, v2) {
    const a = String(v1 || '').split('.').map(part => Number.parseInt(part, 10) || 0);
    const b = String(v2 || '').split('.').map(part => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
    }
    return 0;
  }
}

module.exports = PluginStore;
