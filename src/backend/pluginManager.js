const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

class PluginManager {
  constructor(opts = {}) {
    this.appRoot = opts.appRoot || path.resolve(__dirname, '..', '..');
    this.pluginsDir = opts.pluginsDir || path.join(this.appRoot, 'plugins');
    this.registryFile = path.join(this.pluginsDir, 'plugins.json');
    this.ensurePluginsDir();
    this.loadRegistry();
  }

  ensurePluginsDir() {
    fs.mkdirSync(this.pluginsDir, { recursive: true });
  }

  loadRegistry() {
    try {
      const data = fs.readFileSync(this.registryFile, 'utf8');
      this.registry = JSON.parse(data);
    } catch (e) {
      this.registry = {};
      this.saveRegistry();
    }

    // Auto-discover plugins placed directly in the plugins directory (useful for
    // bundling built-in plugins with the app or during development). If a
    // directory contains a manifest.json and it's not already in the registry,
    // load it and persist to registry. This allows dropping default plugins
    // into the project and having them shown (and marked builtin via manifest).
    try {
      const dirs = fs.readdirSync(this.pluginsDir, { withFileTypes: true }).filter(d => d.isDirectory());
      let added = false;
      for (const d of dirs) {
        const candidate = path.join(this.pluginsDir, d.name);
        const manifestPath = path.join(candidate, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          // do not override registry entries installed via installer
          if (!this.registry[manifest.id]) {
            // best-effort validation — ignore validation errors to avoid startup failure
            try { this.validateManifest(manifest); } catch (_) {}
            this.registry[manifest.id] = {
              id: manifest.id,
              name: manifest.name || manifest.id,
              version: manifest.version || '0.0.0',
              entry: manifest.entry || manifest.main || '',
              enabled: !!manifest.enabled,
              path: candidate,
              permissions: manifest.permissions || [],
              grantedPermissions: manifest.grantedPermissions || [],
              builtin: !!manifest.builtin
            };
            added = true;
          }
        } catch (e) {
          // skip invalid manifests
        }
      }
      if (added) this.saveRegistry();
    } catch (e) {
      // ignore discovery errors
    }
  }

  saveRegistry() {
    fs.writeFileSync(this.registryFile, JSON.stringify(this.registry, null, 2), 'utf8');
  }

  validateManifest(manifest) {
    const semver = require('semver');

    if (!manifest || typeof manifest !== 'object') throw new Error('manifest missing or invalid');
    if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) throw new Error('manifest missing required fields');

    // id must be a safe filesystem-friendly token (prevent path traversal)
    if (!/^[a-zA-Z0-9._-]+$/.test(manifest.id)) {
      throw new Error('manifest.id contains invalid characters');
    }

    // version must be semver
    if (!semver.valid(manifest.version)) throw new Error('manifest.version must be a valid semver string');

    // entry must be a relative path and not escape plugin root
    if (manifest.entry.indexOf('..') !== -1 || manifest.entry.startsWith('/') || manifest.entry.startsWith('\\')) {
      throw new Error('manifest.entry must be a relative path within the plugin package');
    }

    // Validate against JSON Schema using AJV (required)
    try {
      require.resolve('ajv');
    } catch (e) {
      throw new Error('AJV must be installed for manifest validation');
    }

    try {
      const Ajv = require('ajv');
      const addFormats = require('ajv-formats');
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const schema = require(path.join(__dirname, 'manifest.schema.json'));
      const valid = ajv.validate(schema, manifest);
      if (!valid) {
        throw new Error('manifest schema validation failed: ' + ajv.errorsText());
      }
    } catch (e) {
      throw e;
    }

    return true;
  }

  installFromZip(zipPath) {
    if (!fs.existsSync(zipPath)) throw new Error('zip not found: ' + zipPath);
    const zip = new AdmZip(zipPath);
    const manifestEntry = zip.getEntry('manifest.json') || zip.getEntry('/manifest.json');
    if (!manifestEntry) throw new Error('manifest.json not found in zip root');
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    this.validateManifest(manifest);
    const safeId = manifest.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(this.pluginsDir, `${safeId}@${manifest.version}`);
    if (fs.existsSync(dest)) throw new Error('plugin version already installed: ' + dest);
    zip.extractAllTo(dest, true);
    this.registry[safeId] = {
      id: safeId,
      name: manifest.name || safeId,
      version: manifest.version,
      entry: manifest.entry,
      // builtin plugins should be enabled by default unless manifest explicitly disables them
      enabled: !!manifest.enabled || !!manifest.builtin,
      path: dest,
      permissions: manifest.permissions || [],
      grantedPermissions: manifest.grantedPermissions || [],
      // builtin flag: if the manifest marks this as builtin (default plugins),
      // keep it in registry so the app can prevent removal.
      builtin: !!manifest.builtin
    };
    this.saveRegistry();
    return this.registry[safeId];
  }

  /**
   * Get permission status for plugin
   */
  getPermissions(id) {
    const p = this.registry[id];
    if (!p) throw new Error('plugin not found: ' + id);
    return {
      required: p.permissions || [],
      granted: p.grantedPermissions || []
    };
  }

  /**
   * Approve a set of permissions for plugin (only allowed ones)
   */
  approvePermissions(id, perms = []) {
    const p = this.registry[id];
    if (!p) throw new Error('plugin not found: ' + id);
    const allowed = new Set(p.permissions || []);
    const granted = new Set(p.grantedPermissions || []);
    for (const perm of perms) {
      if (allowed.has(perm)) granted.add(perm);
    }
    p.grantedPermissions = Array.from(granted);
    this.saveRegistry();
    return p.grantedPermissions;
  }

  listInstalled() {
    return Object.values(this.registry);
  }

  getPlugin(id) {
    return this.registry[id] || null;
  }

  getEnabledPlugins() {
    return Object.values(this.registry).filter(p => p.enabled);
  }

  enablePlugin(id) {
    const p = this.registry[id];
    if (!p) throw new Error('plugin not found: ' + id);
    // Ensure permissions have been granted
    const required = p.permissions || [];
    const granted = p.grantedPermissions || [];
    const missing = required.filter(r => !granted.includes(r));
    if (missing.length > 0) throw new Error('missing_permissions:' + missing.join(','));
    p.enabled = true;
    this.saveRegistry();
  }

  disablePlugin(id) {
    const p = this.registry[id];
    if (!p) throw new Error('plugin not found: ' + id);
    p.enabled = false;
    this.saveRegistry();
  }

  getPluginPath(id) {
    return this.registry[id] ? this.registry[id].path : null;
  }
}

module.exports = PluginManager;
