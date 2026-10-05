const { parentPort } = require('worker_threads');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const MAX_STORAGE_KEY_LENGTH = 128;
const MAX_FS_PATH_LENGTH = 512;
const MAX_FS_PAYLOAD = 2 * 1024 * 1024;
const ALLOWED_BUILTINS = new Set(['path', 'os', 'util']);

function isPathInside(baseDir, candidatePath) {
  const relative = path.relative(path.resolve(baseDir), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validKey(value, maxLength = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !value.includes('\0');
}

/**
 * Plugins run in worker_threads and receive a narrow permission-gated API.
 *
 * NOTE: node:vm is deliberately treated as defense-in-depth only; Node's own
 * documentation does not consider vm a security boundary for hostile code.
 * Plugins should therefore be considered trusted application extensions.
 */
class PluginWorker {
  constructor() {
    this.plugin = null;
    this.context = null;
    this.hooks = {};
    this.pluginDir = null;
    this.statsInterval = null;
  }

  async load(id, pluginPath, ctxData) {
    try {
      if (!path.isAbsolute(pluginPath) || !fs.existsSync(pluginPath)) throw new Error('Plugin entry does not exist');
      const code = fs.readFileSync(pluginPath, 'utf8');
      const pluginDir = path.dirname(pluginPath);
      this.pluginDir = pluginDir;

      const createRequire = (baseDir) => {
        const anchor = path.join(baseDir, 'package.json');
        const requireFromPlugin = Module.createRequire(fs.existsSync(anchor) ? anchor : `${baseDir}${path.sep}`);

        return (request) => {
          if (typeof request !== 'string' || !request) throw new Error('Invalid require request');

          if (request.startsWith('.') || request.startsWith('/')) {
            const resolved = path.resolve(baseDir, request);
            if (!isPathInside(baseDir, resolved)) throw new Error('require outside plugin directory not allowed');
            return require(resolved);
          }

          if (ALLOWED_BUILTINS.has(request)) return require(request);

          try {
            const resolved = requireFromPlugin.resolve(request);
            if (resolved && isPathInside(baseDir, resolved)) return requireFromPlugin(request);
          } catch {
            // Fall through to the explicit denial below.
          }

          throw new Error(`module not allowed for plugin: ${request}`);
        };
      };

      const wrapper = `(function(exports, require, module, __filename, __dirname){\n${code}\n})`;
      const script = new vm.Script(wrapper, { filename: pluginPath, displayErrors: true });
      const sandbox = {
        console: {
          log: (...args) => parentPort.postMessage({ type: 'log', data: args }),
          info: (...args) => parentPort.postMessage({ type: 'log', data: args }),
          warn: (...args) => parentPort.postMessage({ type: 'log', data: args }),
          error: (...args) => parentPort.postMessage({ type: 'log', data: args })
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Buffer
      };

      // Block common dynamic-code escape primitives inside the VM context.
      sandbox.Function = undefined;
      sandbox.eval = undefined;
      sandbox.global = undefined;
      sandbox.process = undefined;
      sandbox.require = undefined;

      const context = vm.createContext(sandbox, {
        name: `korai-plugin:${id}`,
        codeGeneration: { strings: false, wasm: false }
      });
      const fn = script.runInContext(context, { timeout: 1000, displayErrors: true });
      const module = { exports: {} };
      const localRequire = createRequire(pluginDir);
      module.require = localRequire;
      fn(module.exports, localRequire, module, pluginPath, pluginDir);

      const PluginExport = module.exports;
      this.context = {
        id: ctxData.id,
        name: ctxData.name,
        version: ctxData.version,
        permissions: Array.isArray(ctxData.permissions) ? [...ctxData.permissions] : [],
        api: this.createAPI(ctxData.id)
      };

      if (typeof PluginExport === 'function') {
        this.plugin = new PluginExport(this.context);
      } else if (PluginExport && typeof PluginExport === 'object' && typeof PluginExport.activate === 'function') {
        this.plugin = PluginExport;
      } else {
        throw new Error('Plugin must export a class or object with activate()');
      }

      if (typeof this.plugin.activate === 'function') {
        await Promise.race([
          this.plugin.activate(this.context),
          new Promise((_, reject) => setTimeout(() => reject(new Error('activate timeout')), 4000))
        ]);
      }

      this.statsInterval = setInterval(() => {
        try {
          parentPort.postMessage({
            type: 'stats',
            data: { memory: process.memoryUsage(), cpu: process.cpuUsage() }
          });
        } catch {}
      }, 5000);

      const candidateHooks = ['onLoad', 'onUnload', 'onTrackPlay', 'onTrackPause', 'onAudioProcess', 'onBpmDetect'];
      this.hooks = {};
      for (const hook of candidateHooks) {
        if (typeof this.plugin[hook] === 'function') this.hooks[hook] = true;
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
          new Promise((_, reject) => setTimeout(() => reject(new Error('deactivate timeout')), 4000))
        ]);
      }
      parentPort.postMessage({ type: 'deactivate-ok' });
    } catch (error) {
      parentPort.postMessage({ type: 'deactivate-error', error: error.message || String(error) });
    } finally {
      if (this.statsInterval) clearInterval(this.statsInterval);
      this.statsInterval = null;
      this.plugin = null;
      this.context = null;
      this.hooks = {};
    }
  }

  async callHook(msgId, hookName, args) {
    const started = Date.now();
    try {
      if (!validKey(hookName, 64) || !this.plugin || typeof this.plugin[hookName] !== 'function') {
        parentPort.postMessage({ type: 'hook-response', msgId, result: null });
        return;
      }

      const result = await Promise.race([
        this.plugin[hookName](...args),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hook timeout')), 4000))
      ]);
      const duration = Date.now() - started;
      parentPort.postMessage({ type: 'hook-response', msgId, result });
      parentPort.postMessage({ type: 'perf', data: { hook: hookName, duration, success: true } });
    } catch (error) {
      const duration = Date.now() - started;
      const message = error.message || String(error);
      parentPort.postMessage({ type: 'hook-response', msgId, error: message });
      parentPort.postMessage({ type: 'perf', data: { hook: hookName, duration, success: false, error: message } });
    }
  }

  createAPI(pluginId) {
    return {
      log: (message) => parentPort.postMessage({ type: 'log', data: message }),
      emit: (eventName, data) => {
        if (validKey(eventName, 64)) parentPort.postMessage({ type: 'event', event: eventName, data });
      },
      registerHook: (name) => {
        if (/^[a-zA-Z0-9_-]{1,64}$/.test(name)) parentPort.postMessage({ type: 'register-hook', hook: name });
      },
      requestPermission: (permission) => new Promise(resolve => {
        if (!validKey(permission, 64)) return resolve(false);
        const msgId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const handler = (message) => {
          if (message?.type === 'request-permission-reply' && message.msgId === msgId) {
            parentPort.removeListener('message', handler);
            resolve(message.decision === 'granted');
          }
        };
        parentPort.on('message', handler);
        parentPort.postMessage({ type: 'request-permission', permission, msgId });
        setTimeout(() => {
          parentPort.removeListener('message', handler);
          resolve(false);
        }, 30000);
      }),
      storage: {
        get: (key) => new Promise(resolve => {
          if (!validKey(key, MAX_STORAGE_KEY_LENGTH)) return resolve(null);
          const msgId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const handler = message => {
            if (message?.type === 'storage-get-reply' && message.msgId === msgId) {
              parentPort.removeListener('message', handler);
              resolve(message.value);
            }
          };
          parentPort.on('message', handler);
          parentPort.postMessage({ type: 'storage-get', key, msgId });
          setTimeout(() => { parentPort.removeListener('message', handler); resolve(null); }, 3000);
        }),
        set: (key, value) => {
          if (!validKey(key, MAX_STORAGE_KEY_LENGTH)) return;
          parentPort.postMessage({ type: 'storage-set', key, value });
        }
      },
      fs: {
        read: (requestedPath) => new Promise(resolve => {
          if (!validKey(requestedPath, MAX_FS_PATH_LENGTH)) return resolve({ error: 'invalid_path' });
          const msgId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const handler = message => {
            if (message?.type === 'fs-read-reply' && message.msgId === msgId) {
              parentPort.removeListener('message', handler);
              resolve(message.error ? { error: message.error } : { content: message.content });
            }
          };
          parentPort.on('message', handler);
          parentPort.postMessage({ type: 'fs-read', path: requestedPath, msgId });
          setTimeout(() => { parentPort.removeListener('message', handler); resolve({ error: 'timeout' }); }, 5000);
        }),
        write: (requestedPath, content) => new Promise(resolve => {
          if (!validKey(requestedPath, MAX_FS_PATH_LENGTH) || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FS_PAYLOAD) {
            return resolve({ error: 'invalid_payload' });
          }
          const msgId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const handler = message => {
            if (message?.type === 'fs-write-reply' && message.msgId === msgId) {
              parentPort.removeListener('message', handler);
              resolve(message.error ? { error: message.error } : { success: true });
            }
          };
          parentPort.on('message', handler);
          parentPort.postMessage({ type: 'fs-write', path: requestedPath, content, msgId });
          setTimeout(() => { parentPort.removeListener('message', handler); resolve({ error: 'timeout' }); }, 5000);
        })
      },
      notify: (message, opts) => parentPort.postMessage({ type: 'notify', message, opts: opts || {} })
    };
  }
}

const worker = new PluginWorker();

parentPort.on('message', async msg => {
  try {
    if (msg?.type === 'load') await worker.load(msg.id, msg.pluginPath, msg.context || {});
    else if (msg?.type === 'unload') await worker.unload();
    else if (msg?.type === 'call-hook') await worker.callHook(msg.msgId, msg.hookName, Array.isArray(msg.args) ? msg.args : []);
  } catch (error) {
    parentPort.postMessage({ type: 'worker-error', error: error.message || String(error) });
  }
});
