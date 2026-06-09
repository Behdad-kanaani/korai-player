const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

// optional: prefer chokidar for reliable file watching
let chokidar = null;
try { chokidar = require('chokidar'); } catch (e) {}

// optional plugin health monitor
let PluginHealthMonitor = null;
try { PluginHealthMonitor = require('./pluginHealthMonitor'); } catch (e) {}

/**
 * PluginHost: Sandbox & lifecycle manager for plugins
 * - Loads plugin in isolated worker thread
 * - Manages IPC communication (message passing)
 * - Enforces permission model
 * - Handles plugin errors & timeouts
 */
class PluginHost extends EventEmitter {
  constructor(pluginRegistry, opts = {}) {
    super();
    this.registry = pluginRegistry; // from PluginManager
    this.runningPlugins = new Map(); // id -> { worker, hooks, enabled }
    this.messageQueue = new Map(); // id -> []
    this.pendingRequests = new Map(); // id -> Map(msgId -> { permission, timer })
    this.timeout = opts.timeout || 5000; // activate/deactivate timeout
    this.opts = opts;
    // setup logger: prefer provided, then winston, then console
    if (opts && opts.logger) {
      this.logger = opts.logger;
    } else {
      let winston = null;
      try { winston = require('winston'); } catch (e) {}
      if (winston) {
        try {
          const logsDir = path.join(process.cwd(), 'logs');
          if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
          this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
            transports: [
              new winston.transports.File({ filename: path.join(logsDir, 'korai.log'), maxsize: 5 * 1024 * 1024 }),
              new winston.transports.Console({ format: winston.format.simple() })
            ]
          });
        } catch (e) {
          this.logger = console;
        }
      } else {
        this.logger = console;
      }
    }
    this.performanceMonitor = opts.performanceMonitor || null;
    this.pluginSettings = opts.pluginSettings || null;
    this.healthMonitor = opts.healthMonitor || (PluginHealthMonitor ? new PluginHealthMonitor() : null);
  }

  /**
   * Activate plugin: load & initialize in worker thread
   */
  async activatePlugin(id, context) {
    const entry = this.registry[id];
    if (!entry || !entry.enabled) throw new Error(`Plugin not found or not enabled: ${id}`);
    if (this.runningPlugins.has(id)) throw new Error(`Plugin already running: ${id}`);

    const pluginPath = path.join(entry.path, entry.entry);
    if (!fs.existsSync(pluginPath)) throw new Error(`Plugin entry not found: ${pluginPath}`);

    const worker = new Worker(path.join(__dirname, 'pluginWorker.js'), {
      resourceLimits: {
        maxOldGenerationSizeMb: (this.opts && this.opts.maxOldGenMb) || 64
      }
    });
    let resolved = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { worker.removeAllListeners(); } catch (e) {}
          worker.terminate();
          this.runningPlugins.delete(id);
          reject(new Error(`Plugin activate timeout: ${id}`));
        }
      }, this.timeout);

      worker.on('message', (msg) => {
        try {
          // handle runtime permission request from worker
          if (msg && msg.type === 'request-permission') {
            const perm = msg.permission;
            const msgId = msg.msgId;
            const entry = this.registry[id] || {};
            const granted = (entry.grantedPermissions || []).includes(perm);
            if (granted) {
              worker.postMessage({ type: 'request-permission-reply', msgId, decision: 'granted' });
            } else {
              // store pending
              if (!this.pendingRequests.has(id)) this.pendingRequests.set(id, new Map());
              const map = this.pendingRequests.get(id);
              // auto-deny after 30s
              const timer = setTimeout(() => {
                if (map.has(msgId)) {
                  worker.postMessage({ type: 'request-permission-reply', msgId, decision: 'denied' });
                  map.delete(msgId);
                }
              }, 30000);
              map.set(msgId, { permission: perm, timer });
              // emit event for UI to prompt user
              this.emit(`plugin:${id}:request-permission`, { id, msgId, permission: perm });
            }
            return;
          }
          if (msg.type === 'activate-ok') {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              const hooks = msg.hooks || {};
              const entryObj = { worker, hooks, enabled: true };
              // Setup hot-reload watcher if enabled (prefer chokidar)
              if (this.opts && this.opts.hotReload) {
                try {
                  const pluginDir = path.dirname(this.registry[id].path || '');
                  if (chokidar) {
                    const watcher = chokidar.watch(pluginDir, { ignoreInitial: true, depth: 5 });
                    watcher.on('all', (evt, file) => {
                      this.logger.log(`[Plugin] Detected change in ${id}: ${evt} ${file}`);
                      if (entryObj._reloadTimeout) clearTimeout(entryObj._reloadTimeout);
                      entryObj._reloadTimeout = setTimeout(async () => {
                        try {
                          await this.deactivatePlugin(id);
                          await this.activatePlugin(id);
                          this.logger.log(`[Plugin] Hot-reloaded: ${id}`);
                        } catch (e) {
                          this.logger.error(`[Plugin] Hot-reload failed for ${id}:`, e.message || e);
                        }
                      }, 300);
                    });
                    entryObj.watcher = watcher;
                  } else {
                    const watcher = fs.watch(pluginDir, { recursive: true }, (evt, filename) => {
                      this.logger.log(`[Plugin] Detected change in ${id}: ${evt} ${filename}`);
                      if (entryObj._reloadTimeout) clearTimeout(entryObj._reloadTimeout);
                      entryObj._reloadTimeout = setTimeout(async () => {
                        try {
                          await this.deactivatePlugin(id);
                          await this.activatePlugin(id);
                          this.logger.log(`[Plugin] Hot-reloaded: ${id}`);
                        } catch (e) {
                          this.logger.error(`[Plugin] Hot-reload failed for ${id}:`, e.message || e);
                        }
                      }, 300);
                    });
                    entryObj.watcher = watcher;
                  }
                } catch (e) {
                  this.logger.warn('hotReload watch failed', e.message || e);
                }
              }

              this.runningPlugins.set(id, entryObj);
              this.logger.log(`[Plugin] Activated: ${id}`);
              resolve({ id, hooks });
            }
          } else if (msg.type === 'activate-error') {
            clearTimeout(timeout);
              if (!resolved) {
                resolved = true;
                try { worker.removeAllListeners(); } catch (e) {}
                worker.terminate();
                this.runningPlugins.delete(id);
                reject(new Error(`Plugin activate failed: ${msg.error}`));
              }
          } else if (msg.type === 'log') {
            this.logger.log(`[${id}]`, msg.data);
          } else if (msg.type === 'perf') {
            if (this.performanceMonitor && msg.data) {
              try {
                this.performanceMonitor.recordHookExecution(id, msg.data.hook, msg.data.duration, msg.data.success, msg.data.error || null);
              } catch (e) {
                this.logger.warn('performance monitor error', e.message || e);
              }
            }
            // basic health checks: record hook errors
            try {
              if (this.healthMonitor && msg.data && msg.data.success === false) {
                if (this.healthMonitor.recordHookError) this.healthMonitor.recordHookError(id, msg.data.hook, msg.data.error || null);
                if (this.healthMonitor.shouldDisable && this.healthMonitor.shouldDisable(id)) {
                  this.logger.warn(`[Plugin] Health monitor disabled plugin ${id}`);
                  try { if (this.registry && this.registry[id]) this.registry[id].enabled = false; } catch (e) {}
                  try { const entryObj = this.runningPlugins.get(id); if (entryObj && entryObj.worker) { entryObj.worker.postMessage({ type: 'unload' }); entryObj.worker.terminate(); } } catch (e) {}
                }
              }
            } catch (e) {}
          } else if (msg.type === 'register-hook') {
            // allow plugin to register custom/dynamic hooks at runtime
            try {
              const entryObj = this.runningPlugins.get(id);
              if (entryObj && msg.hook && typeof msg.hook === 'string') {
                entryObj.hooks[msg.hook] = true;
              }
            } catch (e) {}
          } else if (msg.type === 'storage-get') {
            // Worker requested a stored value
            if (this.pluginSettings) {
              const settings = this.pluginSettings.getPluginSettings(id) || {};
              const val = settings[msg.key];
              worker.postMessage({ type: 'storage-get-reply', key: msg.key, value: val });
            } else {
              worker.postMessage({ type: 'storage-get-reply', key: msg.key, value: null });
            }
          } else if (msg.type === 'storage-set') {
            if (this.pluginSettings) {
              try {
                this.pluginSettings.updateSetting(id, msg.key, msg.value);
              } catch (e) {
                this.logger.warn('pluginSettings update failed', e.message || e);
              }
            }
          } else if (msg.type === 'stats') {
            try {
              if (this.performanceMonitor && msg.data) {
                if (this.performanceMonitor.recordWorkerStats) this.performanceMonitor.recordWorkerStats(id, msg.data);
              }
            } catch (e) {}
          } else if (msg.type === 'fs-read') {
            // allow plugin to read project files if permission granted
            const entry = this.registry[id] || {};
            const perms = entry.permissions || [];
            if (!perms.includes('project:read') && !perms.includes('project:rw')) {
              worker.postMessage({ type: 'fs-read-reply', path: msg.path, error: 'missing_permission' });
            } else {
              try {
                const base = this.opts && this.opts.appRoot ? this.opts.appRoot : path.resolve(__dirname, '..', '..');
                const full = path.resolve(base, msg.path);
                if (!full.startsWith(base)) throw new Error('access outside project not allowed');
                const data = fs.readFileSync(full, 'utf8');
                worker.postMessage({ type: 'fs-read-reply', path: msg.path, content: data });
              } catch (e) {
                worker.postMessage({ type: 'fs-read-reply', path: msg.path, error: e.message || String(e) });
              }
            }
          } else if (msg.type === 'fs-write') {
            // allow plugin to write project files if permission granted
            const entry = this.registry[id] || {};
            const perms = entry.permissions || [];
            if (!perms.includes('project:write') && !perms.includes('project:rw')) {
              worker.postMessage({ type: 'fs-write-reply', path: msg.path, error: 'missing_permission' });
            } else {
              try {
                const base = this.opts && this.opts.appRoot ? this.opts.appRoot : path.resolve(__dirname, '..', '..');
                const full = path.resolve(base, msg.path);
                if (!full.startsWith(base)) throw new Error('access outside project not allowed');
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, msg.content, 'utf8');
                worker.postMessage({ type: 'fs-write-reply', path: msg.path, success: true });
              } catch (e) {
                worker.postMessage({ type: 'fs-write-reply', path: msg.path, error: e.message || String(e) });
              }
            }
          } else if (msg.type === 'notify') {
            // forward notifications as events
            this.emit(`plugin:${id}:notify`, { message: msg.message, opts: msg.opts });
          } else if (msg.type === 'event') {
            this.emit(`plugin:${id}:${msg.event}`, msg.data);
          }
        } catch (e) {
          this.logger.warn('plugin host message handler error', e.message || e);
        }
      });

      worker.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          try { worker.removeAllListeners(); } catch (e) {}
          this.runningPlugins.delete(id);
          reject(err);
        }
      });

      worker.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          try { worker.removeAllListeners(); } catch (e) {}
          this.runningPlugins.delete(id);
          reject(new Error(`Plugin worker exited with code ${code}`));
        }
      });

      // Start plugin in worker
      worker.postMessage({
        type: 'load',
        id,
        pluginPath,
        context: {
          id,
          name: entry.name,
          version: entry.version,
          permissions: entry.permissions || []
        }
      });
    });
  }

  /**
   * Deactivate plugin: cleanup & terminate worker
   */
  async deactivatePlugin(id) {
    const plugin = this.runningPlugins.get(id);
    if (!plugin) throw new Error(`Plugin not running: ${id}`);

    return new Promise((resolve, reject) => {
      let responded = false;
      const timeout = setTimeout(() => {
        if (!responded) {
          responded = true;
          try { plugin.worker.removeAllListeners(); } catch (e) {}
          plugin.worker.terminate();
          this.runningPlugins.delete(id);
          // Remove any event listeners related to this plugin to avoid leaks
          try {
            const evNames = this.eventNames();
            for (const ev of evNames) {
              if (typeof ev === 'string' && ev.startsWith(`plugin:${id}:`)) {
                this.removeAllListeners(ev);
              }
            }
          } catch (e) {}
          resolve();
        }
      }, this.timeout);

      plugin.worker.once('message', (msg) => {
        if (msg.type === 'deactivate-ok') {
          clearTimeout(timeout);
          if (!responded) {
            responded = true;
            try {
              if (plugin.watcher) plugin.watcher.close();
            } catch (e) {}
            plugin.worker.terminate();
                this.runningPlugins.delete(id);
                // Cleanup plugin-related events
                try {
                  const evNames = this.eventNames();
                  for (const ev of evNames) {
                    if (typeof ev === 'string' && ev.startsWith(`plugin:${id}:`)) {
                      this.removeAllListeners(ev);
                    }
                  }
                } catch (e) {}
            this.logger.log(`[Plugin] Deactivated: ${id}`);
            resolve();
          }
        }
      });

      plugin.worker.postMessage({ type: 'unload' });
    });
  }

  /**
   * Call hook on plugin: e.g., onTrackPlay, onAudioAnalysis, etc.
   */
  async callHook(id, hookName, args) {
    const plugin = this.runningPlugins.get(id);
    if (!plugin) throw new Error(`Plugin not running: ${id}`);
    if (!(hookName in plugin.hooks)) return null; // hook not defined

    return new Promise((resolve, reject) => {
      const msgId = Math.random().toString(36);
      const timeout = setTimeout(() => {
        reject(new Error(`Hook call timeout: ${id}.${hookName}`));
      }, this.timeout);

      const handler = (msg) => {
        if (msg.type === 'hook-response' && msg.msgId === msgId) {
          clearTimeout(timeout);
          plugin.worker.removeListener('message', handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      };

      plugin.worker.on('message', handler);
      plugin.worker.postMessage({
        type: 'call-hook',
        msgId,
        hookName,
        args
      });
    });
  }

  /**
   * Get all running plugins
   */
  getRunning() {
    return Array.from(this.runningPlugins.entries()).map(([id, p]) => ({
      id,
      hooks: Object.keys(p.hooks)
    }));
  }
}

module.exports = PluginHost;
