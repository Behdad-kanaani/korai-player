const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const semver = require('semver');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { isPathInside } = require('./securityUtils');

const MAX_ZIP_ENTRIES = 500;
const MAX_PLUGIN_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const PLUGIN_ID_RE = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/;

class PluginManager {
  constructor(opts = {}) {
    this.appRoot = opts.appRoot || path.resolve(__dirname, '..', '..');
    this.pluginsDir = opts.pluginsDir || path.join(this.appRoot, 'plugins');
    this.bundledPluginsDir = opts.bundledPluginsDir || path.join(this.appRoot, 'plugins');
    this.registryFile = path.join(this.pluginsDir, 'plugins.json');
    this.schemaPath = path.join(__dirname, 'manifest.schema.json');
    this.ensurePluginsDir();
    this.loadRegistry();
  }

  ensurePluginsDir() {
    fs.mkdirSync(this.pluginsDir, { recursive: true });
  }

  normalizeEntry(id, raw = {}) {
    const pluginPath = raw.path ? path.resolve(raw.path) : null;
    const safePath = pluginPath && (isPathInside(this.pluginsDir, pluginPath) || isPathInside(this.bundledPluginsDir, pluginPath)) ? pluginPath : null;
    return {
      id,
      name: String(raw.name || id),
      version: String(raw.version || '0.0.0'),
      entry: String(raw.entry || ''),
      enabled: Boolean(raw.enabled),
      path: safePath,
      permissions: Array.isArray(raw.permissions) ? [...new Set(raw.permissions.map(String))] : [],
      grantedPermissions: Array.isArray(raw.grantedPermissions) ? [...new Set(raw.grantedPermissions.map(String))] : [],
      builtin: Boolean(raw.builtin)
    };
  }

  loadRegistry() {
    let registry = {};
    try {
      const data = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) registry = data;
    } catch {}

    this.registry = {};
    for (const [id, raw] of Object.entries(registry)) {
      if (!PLUGIN_ID_RE.test(id)) continue;
      const normalized = this.normalizeEntry(id, raw);
      if (normalized.path && fs.existsSync(normalized.path)) this.registry[id] = normalized;
    }

    // Discover bundled/builtin plugins. Invalid manifests are ignored without
    // making the entire application fail to start.
    let changed = false;
    for (const sourceDir of [...new Set([this.pluginsDir, this.bundledPluginsDir])]) {
      try {
        const dirs = fs.readdirSync(sourceDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
        for (const dir of dirs) {
          const candidate = path.join(sourceDir, dir.name);
          if (!isPathInside(sourceDir, candidate)) continue;
          const manifestPath = path.join(candidate, 'manifest.json');
          if (!fs.existsSync(manifestPath)) continue;
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            this.validateManifest(manifest);
            if (!this.registry[manifest.id]) {
              this.registry[manifest.id] = this.normalizeEntry(manifest.id, {
                ...manifest,
                path: candidate,
                enabled: Boolean(manifest.enabled || manifest.builtin)
              });
              changed = true;
            }
          } catch (error) {
            console.warn(`[plugins] Ignoring invalid manifest in ${candidate}: ${error.message}`);
          }
        }
      } catch (error) {
        console.warn(`[plugins] Plugin discovery failed in ${sourceDir}:`, error.message);
      }
    }
    if (changed) this.saveRegistry();
  }

  saveRegistry() {
    const tempPath = `${this.registryFile}.tmp`;
    fs.mkdirSync(this.pluginsDir, { recursive: true });
    try {
      fs.writeFileSync(tempPath, JSON.stringify(this.registry, null, 2), 'utf8');
      fs.renameSync(tempPath, this.registryFile);
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw error;
    }
  }

  validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest missing or invalid');
    }
    if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
      throw new Error('manifest missing required fields');
    }
    if (!PLUGIN_ID_RE.test(manifest.id)) throw new Error('manifest.id contains invalid characters');
    if (!semver.valid(manifest.version)) throw new Error('manifest.version must be a valid semver string');

    const normalizedEntry = manifest.entry.replace(/\\/g, '/');
    const parts = normalizedEntry.split('/');
    if (normalizedEntry.startsWith('/') || parts.some(part => part === '..' || part === '')) {
      throw new Error('manifest.entry must be a safe relative path');
    }

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const schema = JSON.parse(fs.readFileSync(this.schemaPath, 'utf8'));
    if (!ajv.validate(schema, manifest)) {
      throw new Error(`manifest schema validation failed: ${ajv.errorsText()}`);
    }

    return true;
  }

  validateZipEntries(zip, destination) {
    const entries = zip.getEntries();
    if (entries.length === 0) throw new Error('Plugin ZIP is empty');
    if (entries.length > MAX_ZIP_ENTRIES) throw new Error(`Plugin ZIP contains too many files (max ${MAX_ZIP_ENTRIES})`);

    let totalSize = 0;
    for (const entry of entries) {
      const entryName = String(entry.entryName || '').replace(/\\/g, '/');
      const parts = entryName.split('/');
      if (entryName.startsWith('/') || parts.some(part => part === '..')) {
        throw new Error(`Unsafe ZIP entry: ${entryName}`);
      }

      const target = path.resolve(destination, entryName);
      if (!isPathInside(destination, target)) throw new Error(`ZIP entry escapes destination: ${entryName}`);

      const size = Number(entry.header?.size) || 0;
      totalSize += size;
      if (totalSize > MAX_PLUGIN_UNCOMPRESSED_BYTES) {
        throw new Error(`Plugin ZIP is too large (max ${MAX_PLUGIN_UNCOMPRESSED_BYTES} bytes uncompressed)`);
      }
    }
  }

  installFromZip(zipPath) {
    if (!zipPath || !fs.existsSync(zipPath)) throw new Error('ZIP not found');
    const zip = new AdmZip(zipPath);
    const manifestEntry = zip.getEntry('manifest.json') || zip.getEntry('/manifest.json');
    if (!manifestEntry) throw new Error('manifest.json not found in ZIP root');

    let manifest;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    } catch (error) {
      throw new Error(`Invalid manifest.json: ${error.message}`);
    }
    this.validateManifest(manifest);

    const safeId = manifest.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const dest = path.join(this.pluginsDir, `${safeId}@${manifest.version}`);
    if (!isPathInside(this.pluginsDir, dest)) throw new Error('Invalid plugin destination');
    if (fs.existsSync(dest)) throw new Error('Plugin version already installed');

    this.validateZipEntries(zip, dest);
    fs.mkdirSync(dest, { recursive: true });
    try {
      zip.extractAllTo(dest, true);
    } catch (error) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error(`Plugin extraction failed: ${error.message}`);
    }

    const extractedManifest = path.resolve(dest, manifest.entry);
    if (!isPathInside(dest, extractedManifest) || !fs.existsSync(extractedManifest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error('Plugin entry file is missing or escapes plugin directory');
    }

    const entry = this.normalizeEntry(manifest.id, {
      ...manifest,
      path: dest,
      enabled: Boolean(manifest.enabled || manifest.builtin)
    });
    this.registry[manifest.id] = entry;
    this.saveRegistry();
    return { ...entry };
  }

  getPermissions(id) {
    const plugin = this.registry[id];
    if (!plugin) throw new Error('Plugin not found');
    return { required: [...plugin.permissions], granted: [...plugin.grantedPermissions] };
  }

  approvePermissions(id, permissions = []) {
    const plugin = this.registry[id];
    if (!plugin) throw new Error('Plugin not found');
    if (!Array.isArray(permissions)) throw new Error('Permissions must be an array');
    const allowed = new Set(plugin.permissions);
    const granted = new Set(plugin.grantedPermissions);
    for (const permission of permissions) if (allowed.has(permission)) granted.add(permission);
    plugin.grantedPermissions = [...granted];
    this.saveRegistry();
    return [...plugin.grantedPermissions];
  }

  listInstalled() {
    return Object.values(this.registry).map(plugin => ({ ...plugin }));
  }

  getPlugin(id) {
    const plugin = this.registry[id];
    return plugin ? { ...plugin } : null;
  }

  getEnabledPlugins() {
    return Object.values(this.registry).filter(plugin => plugin.enabled).map(plugin => ({ ...plugin }));
  }

  enablePlugin(id) {
    const plugin = this.registry[id];
    if (!plugin) throw new Error('Plugin not found');
    const missing = plugin.permissions.filter(permission => !plugin.grantedPermissions.includes(permission));
    if (missing.length > 0) throw new Error(`missing_permissions:${missing.join(',')}`);
    if (!plugin.path || !fs.existsSync(plugin.path)) throw new Error('Plugin files are missing');
    plugin.enabled = true;
    this.saveRegistry();
  }

  disablePlugin(id) {
    const plugin = this.registry[id];
    if (!plugin) throw new Error('Plugin not found');
    plugin.enabled = false;
    this.saveRegistry();
  }

  getPluginPath(id) {
    const plugin = this.registry[id];
    return plugin?.path || null;
  }

  uninstallPlugin(id) {
    const plugin = this.registry[id];
    if (!plugin) throw new Error('Plugin not found');
    if (plugin.builtin) throw new Error('Built-in plugins cannot be uninstalled');
    if (plugin.path && isPathInside(this.pluginsDir, plugin.path) && !isPathInside(this.bundledPluginsDir, plugin.path)) {
      fs.rmSync(plugin.path, { recursive: true, force: true });
    }
    delete this.registry[id];
    this.saveRegistry();
    return true;
  }
}

module.exports = PluginManager;
