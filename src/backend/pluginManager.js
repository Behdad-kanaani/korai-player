const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const semver = require('semver');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { isPathInside, resolveSafePath, resolveExistingFile, isSafeObjectKey } = require('./securityUtils');

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
    this.registry = Object.create(null);
    this.loadRegistry();
  }

  ensurePluginsDir() {
    fs.mkdirSync(this.pluginsDir, { recursive: true });
  }

  normalizeEntry(id, raw = {}) {
    const safePath = raw.path
      ? (resolveSafePath(raw.path, this.pluginsDir, { allowHome: false }) ||
         resolveSafePath(raw.path, this.bundledPluginsDir, { allowHome: false }))
      : null;
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

    this.registry = Object.create(null);
    for (const [id, raw] of Object.entries(registry)) {
      if (!isSafeObjectKey(id) || !PLUGIN_ID_RE.test(id)) continue;
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
    if (typeof manifest.id !== 'string' || !isSafeObjectKey(manifest.id) || !PLUGIN_ID_RE.test(manifest.id)) {
      throw new Error('manifest.id contains invalid or unsafe characters');
    }
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
      const parts = entryName.split('/').filter((part, index, all) => !(part === '' && index === all.length - 1));
      const mode = Number(entry.header?.attr) >>> 16;
      const isSymlink = (mode & 0o170000) === 0o120000;
      if (!entryName || entryName.includes('\0') || entryName.startsWith('/') ||
          /^[a-zA-Z]:/.test(entryName) || entryName.startsWith('//') ||
          parts.some(part => !part || part === '.' || part === '..') || isSymlink) {
        throw new Error(`Unsafe ZIP entry: ${entryName}`);
      }

      const target = resolveSafePath(entryName, destination, { allowHome: false });
      if (!target || !isPathInside(destination, target)) {
        throw new Error(`ZIP entry escapes destination: ${entryName}`);
      }

      const size = Number(entry.header?.size) || 0;
      totalSize += size;
      if (totalSize > MAX_PLUGIN_UNCOMPRESSED_BYTES) {
        throw new Error(`Plugin ZIP is too large (max ${MAX_PLUGIN_UNCOMPRESSED_BYTES} bytes uncompressed)`);
      }
    }
  }

  installFromZip(zipPath, options = {}) {
    const safeZipPath = resolveExistingFile(zipPath, { allowedRoots: options.allowedRoots });
    if (!safeZipPath) throw new Error('ZIP not found or is not a regular file');
    const zip = new AdmZip(safeZipPath);
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

    const extractedManifest = resolveSafePath(manifest.entry, dest, { allowHome: false });
    if (!extractedManifest || !isPathInside(dest, extractedManifest) ||
        !fs.existsSync(extractedManifest) || !fs.statSync(extractedManifest).isFile()) {
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

  getEntry(id) {
    if (typeof id !== 'string' || !isSafeObjectKey(id) || !PLUGIN_ID_RE.test(id)) return null;
    return Object.hasOwn(this.registry, id) ? this.registry[id] : null;
  }

  getPermissions(id) {
    const plugin = this.getEntry(id);
    if (!plugin) throw new Error('Plugin not found');
    return { required: [...plugin.permissions], granted: [...plugin.grantedPermissions] };
  }

  approvePermissions(id, permissions = []) {
    const plugin = this.getEntry(id);
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
    const plugin = this.getEntry(id);
    return plugin ? { ...plugin } : null;
  }

  getEnabledPlugins() {
    return Object.values(this.registry).filter(plugin => plugin.enabled).map(plugin => ({ ...plugin }));
  }

  enablePlugin(id) {
    const plugin = this.getEntry(id);
    if (!plugin) throw new Error('Plugin not found');
    const missing = plugin.permissions.filter(permission => !plugin.grantedPermissions.includes(permission));
    if (missing.length > 0) throw new Error(`missing_permissions:${missing.join(',')}`);
    if (!plugin.path || !fs.existsSync(plugin.path)) throw new Error('Plugin files are missing');
    plugin.enabled = true;
    this.saveRegistry();
  }

  disablePlugin(id) {
    const plugin = this.getEntry(id);
    if (!plugin) throw new Error('Plugin not found');
    plugin.enabled = false;
    this.saveRegistry();
  }

  getPluginPath(id) {
    const plugin = this.getEntry(id);
    return plugin?.path || null;
  }

  uninstallPlugin(id) {
    const plugin = this.getEntry(id);
    if (!plugin) throw new Error('Plugin not found');
    if (plugin.builtin) throw new Error('Built-in plugins cannot be uninstalled');
    if (plugin.path) {
      try {
        const canonicalPluginsRoot = fs.realpathSync.native(this.pluginsDir);
        const canonicalPluginPath = resolveSafePath(plugin.path, canonicalPluginsRoot, { allowHome: false });
        let canonicalBundledRoot = null;
        try { canonicalBundledRoot = fs.realpathSync.native(this.bundledPluginsDir); } catch {}
        const isBundled = canonicalBundledRoot && canonicalPluginPath &&
          isPathInside(canonicalBundledRoot, canonicalPluginPath);
        if (canonicalPluginPath && isPathInside(canonicalPluginsRoot, canonicalPluginPath) && !isBundled) {
          fs.rmSync(canonicalPluginPath, { recursive: true, force: true });
        }
      } catch {
        throw new Error('Plugin path is not safely contained in the install directory');
      }
    }
    delete this.registry[id];
    this.saveRegistry();
    return true;
  }
}

module.exports = PluginManager;
