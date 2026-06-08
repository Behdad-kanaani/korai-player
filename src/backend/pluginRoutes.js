const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

/**
 * Setup plugin API endpoints for managing plugins via HTTP
 * - GET  /api/plugins         - List all plugins
 * - POST /api/plugins/install - Install plugin from ZIP
 * - POST /api/plugins/:id/enable  - Enable plugin
 * - POST /api/plugins/:id/disable - Disable plugin
 * - DELETE /api/plugins/:id   - Uninstall plugin
 */
function setupPluginRoutes(app, pluginManager, pluginHost) {
  const router = express.Router();

  // Temporary upload dir
  const uploadDir = path.join(os.tmpdir(), 'korai-plugin-uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
      if (!file.originalname.endsWith('.zip')) {
        return cb(new Error('Only ZIP files allowed'));
      }
      cb(null, true);
    }
  });

  // List all plugins
  router.get('/', (req, res) => {
    try {
      // Ensure registry is up-to-date with filesystem (discover new built-in plugins)
      try { if (typeof pluginManager.loadRegistry === 'function') pluginManager.loadRegistry(); } catch (e) { /* ignore */ }
      const plugins = pluginManager.listInstalled();
      const running = pluginHost ? pluginHost.getRunning() : [];
      const running_ids = new Set(running.map(p => p.id));

      const result = plugins.map(p => ({
        ...p,
        running: running_ids.has(p.id)
      }));

      // Development/packaging fallback: also include plugins placed in the project's
      // workspace `plugins/` directory (useful when running from source). Do not
      // overwrite existing entries from the registry; just include any extras.
      try {
        const workspacePlugins = path.join(pluginManager.appRoot, 'plugins');
        if (fs.existsSync(workspacePlugins)) {
          const dirs = fs.readdirSync(workspacePlugins, { withFileTypes: true }).filter(d => d.isDirectory());
          for (const d of dirs) {
            const candidate = path.join(workspacePlugins, d.name);
            const manifestPath = path.join(candidate, 'manifest.json');
            if (!fs.existsSync(manifestPath)) continue;
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              // Skip if registry already has it
              if (result.find(r => r.id === manifest.id)) continue;
              result.push({
                id: manifest.id,
                name: manifest.name || manifest.id,
                version: manifest.version || '0.0.0',
                entry: manifest.entry || '',
                enabled: !!manifest.enabled || !!manifest.builtin,
                path: candidate,
                permissions: manifest.permissions || [],
                grantedPermissions: manifest.grantedPermissions || [],
                builtin: !!manifest.builtin,
                running: running_ids.has(manifest.id)
              });
            } catch (e) {
              // ignore invalid manifests
            }
          }
        }
      } catch (e) {
        // ignore workspace discovery errors
      }

      res.json({ plugins: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Install from ZIP
  router.post('/install', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const zipPath = req.file.path;
      const plugin = pluginManager.installFromZip(zipPath);

      // Cleanup temp file
      fs.unlink(zipPath, () => {});

      res.json({
        message: 'Plugin installed successfully',
        plugin
      });
    } catch (err) {
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, () => {});
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Preview plugin manifest from ZIP without installing
  router.post('/preview', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const zipPath = req.file.path;
    try {
      const zip = new AdmZip(zipPath);
      const manifestEntry = zip.getEntry('manifest.json') || zip.getEntry('/manifest.json');
      if (!manifestEntry) throw new Error('manifest.json not found in zip root');

      const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));

      // Validate manifest using PluginManager's validation
      try {
        pluginManager.validateManifest(manifest);
      } catch (vErr) {
        return res.status(400).json({ error: 'Manifest validation failed', details: vErr.message });
      }

      const allowedPermissions = new Set(['filesystem', 'network', 'audio', 'preferences', 'notifications', 'clipboard', 'project:read', 'project:write', 'project:rw']);
      const requested = manifest.permissions || [];
      const denied = requested.filter(p => !allowedPermissions.has(p));

      res.json({ manifest, deniedPermissions: denied, canInstall: denied.length === 0 });
    } catch (err) {
      res.status(400).json({ error: err.message });
    } finally {
      // cleanup temp upload
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
    }
  });

  // Enable plugin
  router.post('/:id/enable', async (req, res) => {
    try {
      // Check permissions first
      const perms = pluginManager.getPermissions(req.params.id);
      const missing = (perms.required || []).filter(p => !(perms.granted || []).includes(p));
      if (missing.length > 0) {
        return res.status(400).json({ error: 'missing_permissions', missing });
      }
      pluginManager.enablePlugin(req.params.id);
      // attempt to activate plugin in host and wait for result
      if (pluginHost) {
        try {
          await pluginHost.activatePlugin(req.params.id);
          return res.json({ message: 'Plugin enabled and activated' });
        } catch (e) {
          try { pluginManager.disablePlugin(req.params.id); } catch (_) {}
          return res.status(500).json({ error: 'activation_failed', details: e.message || String(e) });
        }
      }

      res.json({ message: 'Plugin enabled' });
    } catch (err) {
      if (String(err.message || '').startsWith('missing_permissions:')) {
        const list = String(err.message).replace('missing_permissions:', '').split(',').filter(Boolean);
        return res.status(400).json({ error: 'missing_permissions', missing: list });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Disable plugin
  router.post('/:id/disable', async (req, res) => {
    try {
      const entryCheck = pluginManager.registry[req.params.id];
      if (entryCheck && entryCheck.builtin) {
        return res.status(403).json({ error: 'builtin_plugin', message: 'This plugin is builtin and cannot be disabled' });
      }
      if (pluginHost) {
        await pluginHost.deactivatePlugin(req.params.id);
      }
      pluginManager.disablePlugin(req.params.id);
      res.json({ message: 'Plugin disabled' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get plugin permission status
  router.get('/:id/permissions', (req, res) => {
    try {
      const perms = pluginManager.getPermissions(req.params.id);
      res.json(perms);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // List pending runtime permission requests for a plugin
  router.get('/:id/requests', (req, res) => {
    try {
      if (!pluginHost) return res.status(500).json({ error: 'Plugin host not available' });
      const map = pluginHost.pendingRequests && pluginHost.pendingRequests.get(req.params.id);
      if (!map) return res.json({ requests: [] });
      const list = [];
      for (const [msgId, info] of map.entries()) {
        list.push({ msgId, permission: info.permission });
      }
      res.json({ requests: list });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Approve or deny a pending runtime permission request
  router.post('/:id/requests/:msgId', express.json(), (req, res) => {
    try {
      if (!pluginHost) return res.status(500).json({ error: 'Plugin host not available' });
      const id = req.params.id;
      const msgId = req.params.msgId;
      const decision = req.body && req.body.decision === 'grant' ? 'grant' : 'deny';
      const map = pluginHost.pendingRequests && pluginHost.pendingRequests.get(id);
      if (!map || !map.has(msgId)) return res.status(404).json({ error: 'request_not_found' });
      const info = map.get(msgId);
      clearTimeout(info.timer);
      map.delete(msgId);
      // send reply to worker
      const running = pluginHost.runningPlugins.get(id);
      if (running && running.worker) {
        running.worker.postMessage({ type: 'request-permission-reply', msgId, decision: decision === 'grant' ? 'granted' : 'denied' });
      }
      // persist granted permission if granted
      if (decision === 'grant') {
        try {
          pluginManager.approvePermissions(id, [info.permission]);
        } catch (e) {}
      }
      res.json({ ok: true, decision });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Performance endpoints
  router.get('/performance', (req, res) => {
    try {
      const perf = pluginHost && pluginHost.performanceMonitor;
      if (!perf) return res.status(404).json({ error: 'Performance monitor not available' });
      res.json(perf.exportStats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id/performance', (req, res) => {
    try {
      const perf = pluginHost && pluginHost.performanceMonitor;
      if (!perf) return res.status(404).json({ error: 'Performance monitor not available' });
      const stats = perf.getPluginStats(req.params.id);
      const history = perf.getHistory(req.params.id, 200);
      const errors = perf.getErrors(req.params.id, 50);
      res.json({ stats, history, errors });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Call a hook on all running plugins that implement it (admin/testing)
  router.post('/hook/:hookName', async (req, res) => {
    try {
      // Only allow calls from localhost for safety
      const ip = (req.ip || '').toString();
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || ip.includes('::ffff:127.0.0.1');
      if (!isLocal) return res.status(403).json({ error: 'forbidden' });
      if (!pluginHost) return res.status(500).json({ error: 'Plugin host not available' });
      const hookName = req.params.hookName;
      const running = pluginHost.getRunning();
      const targets = running.filter(p => Array.isArray(p.hooks) ? p.hooks.includes(hookName) : (p.hooks && p.hooks[hookName]));
      const args = Array.isArray(req.body.args) ? req.body.args : [];

      const calls = targets.map(t => {
        return pluginHost.callHook(t.id, hookName, args).then(result => ({ id: t.id, result })).catch(err => ({ id: t.id, error: err.message || String(err) }));
      });

      const results = await Promise.all(calls);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Call a hook on a single plugin by id
  router.post('/:id/hook/:hookName', async (req, res) => {
    try {
      // Only allow calls from localhost for safety
      const ip = (req.ip || '').toString();
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || ip.includes('::ffff:127.0.0.1');
      if (!isLocal) return res.status(403).json({ error: 'forbidden' });
      if (!pluginHost) return res.status(500).json({ error: 'Plugin host not available' });
      const hookName = req.params.hookName;
      const id = req.params.id;
      const args = Array.isArray(req.body.args) ? req.body.args : [];

      // ensure plugin is running
      const running = pluginHost.getRunning();
      const found = running.find(p => p.id === id);
      if (!found) return res.status(404).json({ error: 'Plugin not running' });

      try {
        const result = await pluginHost.callHook(id, hookName, args);
        res.json({ id, result });
      } catch (err) {
        res.status(500).json({ id, error: err.message || String(err) });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Approve requested permissions for plugin
  router.post('/:id/approve', express.json(), (req, res) => {
    try {
      const list = req.body && Array.isArray(req.body.permissions) ? req.body.permissions : [];
      const granted = pluginManager.approvePermissions(req.params.id, list);
      res.json({ granted });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Uninstall plugin
  router.delete('/:id', async (req, res) => {
    try {
      const entry = pluginManager.registry[req.params.id];
      if (!entry) throw new Error('Plugin not found');

      // Prevent uninstalling builtin/default plugins
      if (entry.builtin) {
        return res.status(403).json({ error: 'builtin_plugin', message: 'This plugin is builtin and cannot be uninstalled' });
      }

      if (pluginHost) {
        await pluginHost.deactivatePlugin(req.params.id);
      }

      // Delete plugin dir
      if (entry.path && fs.existsSync(entry.path)) {
        fs.rmSync(entry.path, { recursive: true, force: true });
      }

      delete pluginManager.registry[req.params.id];
      pluginManager.saveRegistry();

      res.json({ message: 'Plugin uninstalled' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.use('/api/plugins', router);

  // Serve plugin assets (safe, prevents path traversal)
  app.get('/api/plugin-asset/:id/:file', (req, res) => {
    try {
      const id = req.params.id;
      const file = req.params.file;
      // basic validation
      if (!id || !file) return res.status(400).send('bad request');
      if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('invalid file');
      let entry = pluginManager.registry[id];
      let target = null;

      if (entry && entry.path) {
        target = path.join(entry.path, file);
      } else {
        // Development fallback: check workspace plugins directory for a matching id@version folder
        try {
          const workspacePlugins = path.join(pluginManager.appRoot, 'plugins');
          if (fs.existsSync(workspacePlugins)) {
            const dirs = fs.readdirSync(workspacePlugins, { withFileTypes: true }).filter(d => d.isDirectory());
            const match = dirs.find(d => d.name.startsWith(id + '@'));
            if (match) {
              const candidate = path.join(workspacePlugins, match.name);
              if (fs.existsSync(candidate)) {
                target = path.join(candidate, file);
                // also set a fake entry so startsWith check later works
                entry = entry || { path: candidate };
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }
      if (!entry || !entry.path) return res.status(404).send('plugin not found');
      if (!target) target = path.join(entry.path, file);
      if (!target.startsWith(entry.path)) return res.status(400).send('access denied');
      if (!fs.existsSync(target)) return res.status(404).send('not found');
      res.sendFile(target);
    } catch (e) {
      res.status(500).send('error');
    }
  });
}

module.exports = { setupPluginRoutes };
