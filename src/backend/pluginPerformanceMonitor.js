/**
 * Plugin Performance Monitor & Dashboard
 * Tracks: CPU time, memory usage, hooks called, errors, execution stats
 */

class PluginPerformanceMonitor {
  constructor() {
    this.stats = new Map(); // pluginId -> stats object
    this.history = new Map(); // pluginId -> [{ timestamp, stat }]
    this.maxHistoryPoints = 1000;
    this.errorLog = []; // Global error log
  }

  /**
   * Record hook execution
   */
  recordHookExecution(pluginId, hookName, duration, success = true, error = null) {
    if (!this.stats.has(pluginId)) {
      this.initializeStats(pluginId);
    }

    const stat = this.stats.get(pluginId);
    stat.lastExecuted = Date.now();
    stat.hookExecutions[hookName] = (stat.hookExecutions[hookName] || 0) + 1;
    stat.totalExecutionTime += duration;
    stat.avgExecutionTime = stat.totalExecutionTime / stat.totalHooks;

    if (!success) {
      stat.errorCount++;
      this.recordError(pluginId, hookName, error);
    } else {
      stat.successCount++;
    }

    // Track performance history
    this.recordHistory(pluginId, {
      timestamp: Date.now(),
      hook: hookName,
      duration,
      success,
      memoryUsage: this.getMemoryUsage(),
      // placeholder for cpu/event-loop metrics if reported
      cpuUsage: 0,
      eventLoopLag: 0
    });

    // Track slowest hooks
    if (!stat.slowestHooks[hookName]) {
      stat.slowestHooks[hookName] = duration;
    } else {
      stat.slowestHooks[hookName] = Math.max(stat.slowestHooks[hookName], duration);
    }
  }

  /**
   * Record worker-reported stats (memory/cpu)
   */
  recordWorkerStats(pluginId, data) {
    if (!this.stats.has(pluginId)) this.initializeStats(pluginId);
    const stat = this.stats.get(pluginId);
    const entry = {
      timestamp: Date.now(),
      memory: data.memory || null,
      cpu: data.cpu || null
    };
    // store history alongside existing history structure
    this.recordHistory(pluginId, entry);
    // update peaks
    if (data.memory && data.memory.heapUsed) {
      stat.memoryPeak = Math.max(stat.memoryPeak || 0, Math.round(data.memory.heapUsed / 1024 / 1024 * 100) / 100);
    }
  }

  /**
   * Record error
   */
  recordError(pluginId, hookName, errorMessage) {
    this.errorLog.push({
      timestamp: Date.now(),
      pluginId,
      hookName,
      error: errorMessage,
      stack: new Error().stack
    });

    // Keep last 100 errors
    if (this.errorLog.length > 100) {
      this.errorLog.shift();
    }
  }

  /**
   * Record performance history
   */
  recordHistory(pluginId, data) {
    if (!this.history.has(pluginId)) {
      this.history.set(pluginId, []);
    }

    const hist = this.history.get(pluginId);
    hist.push(data);

    // Keep only recent history
    if (hist.length > this.maxHistoryPoints) {
      hist.shift();
    }
  }

  /**
   * Initialize stats for plugin
   */
  initializeStats(pluginId) {
    this.stats.set(pluginId, {
      pluginId,
      activatedAt: Date.now(),
      lastExecuted: null,
      totalHooks: 0,
      successCount: 0,
      errorCount: 0,
      totalExecutionTime: 0,
      avgExecutionTime: 0,
      hookExecutions: {},
      slowestHooks: {},
      memoryPeak: 0,
      cpuTime: 0
    });
  }

  /**
   * Get plugin statistics
   */
  getPluginStats(pluginId) {
    if (!this.stats.has(pluginId)) return null;

    const stat = this.stats.get(pluginId);
    const runtime = Date.now() - stat.activatedAt;

    return {
      ...stat,
      runtimeMs: runtime,
      successRate: stat.totalHooks > 0 ? (stat.successCount / stat.totalHooks * 100).toFixed(1) : 0,
      hooksPerSecond: (stat.totalHooks / (runtime / 1000)).toFixed(2)
    };
  }

  /**
   * Get all plugin statistics
   */
  getAllStats() {
    const stats = [];
    for (const pluginId of this.stats.keys()) {
      stats.push(this.getPluginStats(pluginId));
    }
    return stats.sort((a, b) => b.totalHooks - a.totalHooks);
  }

  /**
   * Get performance history for plugin
   */
  getHistory(pluginId, limit = 100) {
    const hist = this.history.get(pluginId) || [];
    return hist.slice(-limit);
  }

  /**
   * Get errors for plugin
   */
  getErrors(pluginId, limit = 20) {
    return this.errorLog
      .filter(e => e.pluginId === pluginId)
      .slice(-limit);
  }

  /**
   * Get all errors
   */
  getAllErrors(limit = 50) {
    return this.errorLog.slice(-limit);
  }

  /**
   * Get slowest hooks
   */
  getSlowestHooks(limit = 10) {
    const hooks = [];
    for (const [pluginId, stat] of this.stats) {
      for (const [hookName, maxDuration] of Object.entries(stat.slowestHooks)) {
        hooks.push({
          pluginId,
          hook: hookName,
          maxDuration
        });
      }
    }
    return hooks
      .sort((a, b) => b.maxDuration - a.maxDuration)
      .slice(0, limit);
  }

  /**
   * Get most-called hooks
   */
  getMostCalledHooks(limit = 10) {
    const hooks = [];
    for (const [pluginId, stat] of this.stats) {
      for (const [hookName, count] of Object.entries(stat.hookExecutions)) {
        hooks.push({
          pluginId,
          hook: hookName,
          callCount: count
        });
      }
    }
    return hooks
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, limit);
  }

  /**
   * Get performance summary
   */
  getSummary() {
    let totalHooks = 0;
    let totalErrors = 0;
    let totalTime = 0;
    let mostActive = null;
    let maxHooks = 0;

    for (const stat of this.stats.values()) {
      totalHooks += stat.totalHooks;
      totalErrors += stat.errorCount;
      totalTime += stat.totalExecutionTime;

      if (stat.totalHooks > maxHooks) {
        maxHooks = stat.totalHooks;
        mostActive = stat.pluginId;
      }
    }

    return {
      pluginCount: this.stats.size,
      totalHooksCalled: totalHooks,
      totalErrors,
      avgTimePerHook: totalHooks > 0 ? (totalTime / totalHooks).toFixed(2) : 0,
      errorRate: totalHooks > 0 ? (totalErrors / totalHooks * 100).toFixed(2) : 0,
      mostActivePlugin: mostActive,
      errorLogSize: this.errorLog.length
    };
  }

  /**
   * Reset statistics for plugin
   */
  resetStats(pluginId) {
    this.stats.delete(pluginId);
    this.history.delete(pluginId);
  }

  /**
   * Get approximate memory usage (simplified)
   */
  getMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const mem = process.memoryUsage();
      return {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100, // MB
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
        external: Math.round(mem.external / 1024 / 1024 * 100) / 100
      };
    }
    return { heapUsed: 0, heapTotal: 0, external: 0 };
  }

  /**
   * Export stats as JSON
   */
  exportStats() {
    return {
      timestamp: Date.now(),
      summary: this.getSummary(),
      pluginStats: this.getAllStats(),
      slowestHooks: this.getSlowestHooks(),
      mostCalledHooks: this.getMostCalledHooks(),
      errorLog: this.errorLog
    };
  }

  /**
   * Clear old data
   */
  cleanup() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Clear old error logs
    this.errorLog = this.errorLog.filter(e => e.timestamp > oneHourAgo);

    // Trim history
    for (const [pluginId, hist] of this.history) {
      this.history.set(
        pluginId,
        hist.filter(h => h.timestamp > oneHourAgo)
      );
    }
  }
}

module.exports = PluginPerformanceMonitor;
