const { parentPort } = require('worker_threads');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const Module = require('module');

/**
 * PluginWorker: Runs inside worker thread, executes plugin code inside a Node VM
 * with a restricted require to limit access to built-in modules.
 */
class PluginWorker {
  constructor() {
    this.plugin = null;
    this.context = null;
    this.hooks = {};
    this.pluginDir = null;
  }

  async load(id, pluginPath, ctxData) {
    try {
      // Read plugin source
      const code = fs.readFileSync(pluginPath, 'utf8');
      const pluginDir = path.dirname(pluginPath);
      this.pluginDir = pluginDir;

      // Prepare a restricted require that only allows local files and a small whitelist
      const allowedBuiltins = new Set(['path', 'os']);

      const createRequire = (baseDir) => {
        // Prefer Node's Module.createRequire so package names resolve from plugin dir
        let requireFromPlugin = null;
        try {
          const anchor = path.join(baseDir, 'package.json');
          requireFromPlugin = Module.createRequire(fs.existsSync(anchor) ? anchor : baseDir + path.sep);
        } catch (e) {
          requireFromPlugin = require;
        }

        return (req) => {
          // Relative/local requires
          if (req.startsWith('.') || req.startsWith('/')) {
            const resolved = path.resolve(baseDir, req);
            if (!resolved.startsWith(baseDir)) throw new Error('require outside plugin directory not allowed');
            delete require.cache[resolved];
            return require(resolved);
          }

          // Try to resolve from plugin's node_modules first
          try {
            const resolved = requireFromPlugin.resolve(req);
            // don't allow resolving to system root
            if (resolved && resolved.indexOf(baseDir) === 0) {
              delete require.cache[resolved];
              return requireFromPlugin(req);
            }
          } catch (e) {
            // ignore
          }

          // Allow a small whitelist of built-ins
          if (allowedBuiltins.has(req)) return require(req);

          throw new Error('module not allowed in plugin sandbox: ' + req);
        };
      };

      // Wrap code like CommonJS module
      const wrapper = `(function(exports, require, module, __filename, __dirname){\n${code}\n})`;
      const script = new vm.Script(wrapper, { filename: pluginPath });
      const sandbox = {
        console: console,
        setTimeout,
        clearTimeout,
        Buffer
      };

      // Explicitly remove dangerous globals that can be abused to escape the VM
      sandbox.Function = undefined;
      sandbox.eval = undefined;
      sandbox.Proxy = undefined;
      sandbox.Reflect = undefined;
      sandbox.WebAssembly = undefined;
      sandbox.global = undefined;
      sandbox.process = undefined;
      sandbox.require = undefined;

      const context = vm.createContext(sandbox);
      const fn = script.runInContext(context, { timeout: 1000, displayErrors: true });

      const module = { exports: {} };
      const localRequire = createRequire(pluginDir);
      // expose a safe module.require to common code that may call it
      module.require = localRequire;
      fn(module.exports, localRequire, module, pluginPath, pluginDir);

      const PluginClass = module.exports;

      this.context = {
        id: ctxData.id,
        name: ctxData.name,
        version: ctxData.version,
        permissions: ctxData.permissions,
        api: this.createAPI(ctxData.id)
      };

      // Instantiate or use exported object
      if (typeof PluginClass === 'function') {
        this.plugin = new PluginClass(this.context);
      } else if (typeof PluginClass === 'object' && PluginClass.activate) {
        this.plugin = PluginClass;
      } else {
        throw new Error('Plugin must export class or object with activate method');
      }

      // Call activate lifecycle hook with a safe timeout
      if (typeof this.plugin.activate === 'function') {
        await Promise.race([
          this.plugin.activate(this.context),
          new Promise((_, rej) => setTimeout(() => rej(new Error('activate timeout')), 4000))
        ]);
      }

      // Start periodic worker stats reporting to host (memory + cpu)
      this._statsInterval = setInterval(() => {
        try {
          const mem = process.memoryUsage();
          const cpu = process.cpuUsage();
          parentPort.postMessage({ type: 'stats', data: { memory: mem, cpu: cpu } });
        } catch (e) {}
      }, 5000);

      // Collect hooks
      for (const method of ['onLoad', 'onUnload', 'onTrackPlay', 'onTrackPause', 'onAudioProcess', 'onBpmDetect']) {
        if (typeof this.plugin[method] === 'function') {
          this.hooks[method] = true;
        }
      }

      parentPort.postMessage({ type: 'activate-ok', hooks: this.hooks });
    } catch (error) {
      parentPort.postMessage({ type: 'activate-error', error: error.message || String(error) });
    }
  }

  async unload() {
    try {
      if (this.plugin && typeof this.plugin.deactivate === 'function') {
        await Promise.race([
          this.plugin.deactivate(this.context),
          new Promise((_, rej) => setTimeout(() => rej(new Error('deactivate timeout')), 4000))
        ]);
      }
      if (this._statsInterval) {
        clearInterval(this._statsInterval);
        this._statsInterval = null;
      }
      this.plugin = null;
      this.context = null;
      this.hooks = {};
      parentPort.postMessage({ type: 'deactivate-ok' });
    } catch (error) {
      parentPort.postMessage({ type: 'deactivate-error', error: error.message || String(error) });
    }
  }

  async callHook(msgId, hookName, args) {
    const started = Date.now();
    try {
      if (!this.plugin || typeof this.plugin[hookName] !== 'function') {
        parentPort.postMessage({ type: 'hook-response', msgId, result: null });
        // emit perf with zero duration
        parentPort.postMessage({ type: 'perf', data: { hook: hookName, duration: 0, success: true } });
        return;
      }

      const result = await Promise.race([
        this.plugin[hookName](...args),
        new Promise((_, rej) => setTimeout(() => rej(new Error('hook timeout')), 4000))
      ]);

      const duration = Date.now() - started;
      parentPort.postMessage({ type: 'hook-response', msgId, result });
      parentPort.postMessage({ type: 'perf', data: { hook: hookName, duration, success: true } });
    } catch (error) {
      const duration = Date.now() - started;
      parentPort.postMessage({ type: 'hook-response', msgId, error: error.message || String(error) });
      parentPort.postMessage({ type: 'perf', data: { hook: hookName, duration, success: false, error: error.message || String(error) } });
    }
  }

  createAPI(pluginId) {
    return {
      log: (msg) => {
        parentPort.postMessage({ type: 'log', data: msg });
      },
      emit: (eventName, data) => {
        parentPort.postMessage({ type: 'event', event: eventName, data });
      },
          registerHook: (name) => {
            if (typeof name === 'string' && name) parentPort.postMessage({ type: 'register-hook', hook: name });
          },
          requestPermission: (permission) => {
            return new Promise((resolve) => {
              const msgId = Math.random().toString(36).slice(2);
              const handler = (msg) => {
                if (msg && msg.type === 'request-permission-reply' && msg.msgId === msgId) {
                  parentPort.removeListener('message', handler);
                  resolve(msg.decision === 'granted');
                }
              };
              parentPort.on('message', handler);
              parentPort.postMessage({ type: 'request-permission', permission, msgId });
              // fallback timeout
              setTimeout(() => { parentPort.removeListener('message', handler); resolve(false); }, 30000);
            });
          },
      storage: {
        // Simple storage API proxy - main thread should implement persistence
        get: (key) => {
          return new Promise((resolve) => {
            const handler = (msg) => {
              if (msg.type === 'storage-get-reply' && msg.key === key) {
                parentPort.removeListener('message', handler);
                resolve(msg.value);
              }
            };
            parentPort.on('message', handler);
            parentPort.postMessage({ type: 'storage-get', key });
            // fallback timeout
            setTimeout(() => { parentPort.removeListener('message', handler); resolve(null); }, 3000);
          });
        },
        set: (key, value) => {
          parentPort.postMessage({ type: 'storage-set', key, value });
        }
      },
      fs: {
        read: (p) => {
          return new Promise((resolve) => {
            const handler = (msg) => {
              if (msg.type === 'fs-read-reply' && msg.path === p) {
                parentPort.removeListener('message', handler);
                if (msg.error) resolve({ error: msg.error }); else resolve({ content: msg.content });
              }
            };
            parentPort.on('message', handler);
            parentPort.postMessage({ type: 'fs-read', path: p });
            setTimeout(() => { parentPort.removeListener('message', handler); resolve({ error: 'timeout' }); }, 5000);
          });
        },
        write: (p, content) => {
          return new Promise((resolve) => {
            const handler = (msg) => {
              if (msg.type === 'fs-write-reply' && msg.path === p) {
                parentPort.removeListener('message', handler);
                if (msg.error) resolve({ error: msg.error }); else resolve({ success: true });
              }
            };
            parentPort.on('message', handler);
            parentPort.postMessage({ type: 'fs-write', path: p, content });
            setTimeout(() => { parentPort.removeListener('message', handler); resolve({ error: 'timeout' }); }, 5000);
          });
        }
      },
      notify: (message, opts) => {
        parentPort.postMessage({ type: 'notify', message, opts: opts || {} });
      }
    };
  }
}

const worker = new PluginWorker();

parentPort.on('message', async (msg) => {
  if (msg.type === 'load') {
    await worker.load(msg.id, msg.pluginPath, msg.context);
  } else if (msg.type === 'unload') {
    await worker.unload();
  } else if (msg.type === 'call-hook') {
    await worker.callHook(msg.msgId, msg.hookName, msg.args || []);
  }
});
