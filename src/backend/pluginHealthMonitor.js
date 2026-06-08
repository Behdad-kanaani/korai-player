class PluginHealthMonitor {
  constructor(opts = {}) {
    this.errorWindowMs = opts.errorWindowMs || 60 * 1000; // 60s
    this.errorThreshold = opts.errorThreshold || 3; // errors in window
    this.errors = new Map(); // pluginId -> [timestamps]
    this.activationFailures = new Map();
  }

  _now() { return Date.now(); }

  recordHookError(pluginId, hookName, error) {
    if (!this.errors.has(pluginId)) this.errors.set(pluginId, []);
    const arr = this.errors.get(pluginId);
    arr.push(this._now());
    // trim
    const cutoff = this._now() - this.errorWindowMs;
    while (arr.length && arr[0] < cutoff) arr.shift();
  }

  recordActivationFailure(pluginId, reason) {
    const count = (this.activationFailures.get(pluginId) || 0) + 1;
    this.activationFailures.set(pluginId, count);
  }

  shouldDisable(pluginId) {
    const arr = this.errors.get(pluginId) || [];
    if (arr.length >= this.errorThreshold) return true;
    const actFails = this.activationFailures.get(pluginId) || 0;
    if (actFails >= 2) return true;
    return false;
  }
}

module.exports = PluginHealthMonitor;
