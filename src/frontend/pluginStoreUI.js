/**
 * Plugin Store UI - Browse and discover plugins from marketplace
 */

class PluginStoreUI {
  constructor(containerId = 'plugin-store') {
    this.container = document.getElementById(containerId) || document.createElement('div');
    if (!this.container.id) this.container.id = containerId;
    if (!this.container.parentElement) document.body.appendChild(this.container);

    this.plugins = [];
    this.searchQuery = '';
    this.loading = false;
    this.installing = false;
    this.error = null;
    this.apiBase = window.location.origin;
    this.listenersBound = false;

    this.render();
    this.init();
  }

  async init() {
    this.apiBase = await this.resolveApiBase();
    await this.loadPlugins();
  }

  async resolveApiBase() {
    if (window.electronAPI && typeof window.electronAPI.getServerPort === 'function') {
      try {
        const port = await window.electronAPI.getServerPort();
        if (port) return `http://127.0.0.1:${port}`;
      } catch (_error) {
        // fallback to origin
      }
    }
    if (window.location.protocol.startsWith('http')) return window.location.origin;
    return 'http://127.0.0.1:3000';
  }

  getApiUrl(path) {
    if (!path.startsWith('/')) path = '/' + path;
    return `${this.apiBase}${path}`;
  }

  async loadPlugins(query = '') {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const endpoint = `/api/plugins/store${query ? '?q=' + encodeURIComponent(query) : ''}`;
      const res = await fetch(this.getApiUrl(endpoint));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.plugins = Array.isArray(data.plugins) ? data.plugins : [];
    } catch (err) {
      this.plugins = [];
      this.error = err.message || 'Failed to load plugin store';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async installPluginFromUrl(downloadUrl) {
    if (!downloadUrl) {
      this.showNotification('Invalid plugin URL', 'error');
      return;
    }

    this.installing = true;
    this.render();

    try {
      const res = await fetch(this.getApiUrl('/api/plugins/store/install'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: downloadUrl })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      this.showNotification('Plugin installed successfully', 'success');
      await this.loadPlugins(this.searchQuery);
    } catch (err) {
      this.showNotification(`Installation failed: ${err.message}`, 'error');
    } finally {
      this.installing = false;
      this.render();
    }
  }

  async installPluginFromFile(file) {
    if (!file) return;

    this.installing = true;
    this.render();

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(this.getApiUrl('/api/plugins/install'), {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      this.showNotification('Plugin installed successfully', 'success');
      await this.loadPlugins(this.searchQuery);
    } catch (err) {
      this.showNotification(`Installation failed: ${err.message}`, 'error');
    } finally {
      this.installing = false;
      this.render();
    }
  }

  attachEventListeners() {
    if (this.listenersBound) return;
    this.listenersBound = true;

    const container = this.container;
    if (!container) return;

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;

      if (button.id === 'storeRefreshBtn') {
        await this.loadPlugins(this.searchQuery);
        return;
      }

      if (button.id === 'openManagerBtn') {
        window.location.href = 'plugins.html';
        return;
      }

      if (button.id === 'uploadZipBtn') {
        this.openFilePicker();
        return;
      }

      if (button.dataset.installUrl) {
        await this.installPluginFromUrl(button.dataset.installUrl);
        return;
      }
    });

    const searchInput = container.querySelector('#storeSearchInput');
    if (searchInput) {
      let timer = null;
      searchInput.value = this.searchQuery;
      searchInput.addEventListener('input', (event) => {
        clearTimeout(timer);
        this.searchQuery = event.target.value;
        timer = setTimeout(() => this.loadPlugins(this.searchQuery), 250);
      });
    }
  }

  openFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) this.installPluginFromFile(file);
    });
    input.click();
  }

  showNotification(message, type = 'info') {
    const existing = document.querySelector('.plugin-store-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'plugin-store-notification';
    notification.textContent = message;
    notification.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;padding:14px 18px;border-radius:14px;background:rgba(16,18,26,0.96);color:#fff;box-shadow:0 18px 40px rgba(0,0,0,0.4);max-width:340px;line-height:1.5;';
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3800);
  }

  escapeHtml(text) {
    if (text === undefined || text === null) return '';
    return String(text).replace(/[&<>"']/g, (match) => {
      switch (match) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#039;';
        default: return match;
      }
    });
  }

  render() {
    const loadingHtml = this.loading ? '<div class="store-status">Loading marketplace...</div>' : '';
    const errorHtml = this.error ? `<div class="store-error">${this.escapeHtml(this.error)}</div>` : '';

    const pluginsHtml = this.plugins.map((plugin) => `
      <div class="store-card">
        <div class="store-card-top">
          <div>
            <div class="store-card-title">${this.escapeHtml(plugin.name || 'Untitled')}</div>
            <div class="store-card-meta">${this.escapeHtml(plugin.author || 'Unknown author')} · ${this.escapeHtml(plugin.version || '')}</div>
          </div>
          <button type="button" class="store-action-btn" data-install-url="${this.escapeHtml(plugin.downloadUrl || '')}" ${this.installing ? 'disabled' : ''}>Install</button>
        </div>
        <p class="store-card-desc">${this.escapeHtml(plugin.description || 'No description available.')}</p>
        <div class="store-tag-row">${(plugin.tags || []).map((tag) => `<span class="store-tag">${this.escapeHtml(tag)}</span>`).join('')}</div>
      </div>
    `).join('');

    const emptyHtml = !this.loading && !this.error && this.plugins.length === 0 ? '<div class="store-empty">No plugins found. Search or refresh.</div>' : '';

    this.container.innerHTML = `
      <div class="store-wrapper">
        <div class="store-header">
          <div>
            <h1>Plugin Store</h1>
            <p>Browse and install plugin bundles for KORAI.</p>
          </div>
          <div class="store-header-actions">
            <button id="openManagerBtn" class="store-secondary-btn">Open Plugin Manager</button>
            <button id="storeRefreshBtn" class="store-secondary-btn">Refresh</button>
          </div>
        </div>
        <div class="store-controls">
          <input id="storeSearchInput" type="search" placeholder="Search plugins..." value="${this.escapeHtml(this.searchQuery)}">
          <button id="uploadZipBtn" class="store-primary-btn">Upload ZIP</button>
        </div>
        ${loadingHtml}
        ${errorHtml}
        <div class="store-grid">${pluginsHtml}</div>
        ${emptyHtml}
      </div>
    `;

    this.injectStyles();
    this.attachEventListeners();
  }

  injectStyles() {
    if (document.getElementById('plugin-store-styles')) return;
    const style = document.createElement('style');
    style.id = 'plugin-store-styles';
    style.textContent = `
      .store-wrapper { max-width: 1180px; margin: 0 auto; padding: 28px; font-family: system-ui, -apple-system, sans-serif; color: #eef2ff; }
      .store-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 22px; }
      .store-header h1 { font-size: 32px; margin-bottom: 8px; color: #fff; }
      .store-header p { color: #b8c9e0; font-size: 14px; max-width: 720px; line-height: 1.6; }
      .store-header-actions { display: flex; gap: 10px; flex-wrap: wrap; }
      .store-controls { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
      .store-controls input { flex: 1; min-width: 240px; border: 1px solid rgba(255,255,255,0.11); border-radius: 16px; padding: 12px 14px; background: rgba(255,255,255,0.04); color: #eef2ff; font-size: 14px; }
      .store-controls input:focus { outline: none; border-color: rgba(0,255,213,0.45); box-shadow: 0 0 0 2px rgba(0,255,213,0.08); }
      .store-primary-btn, .store-secondary-btn, .store-action-btn { border: none; border-radius: 16px; padding: 12px 18px; cursor: pointer; font-weight: 700; transition: transform 0.18s ease, box-shadow 0.18s ease; }
      .store-primary-btn { background: #00c4a7; color: #061212; }
      .store-secondary-btn { background: rgba(255,255,255,0.08); color: #eef2ff; }
      .store-primary-btn:hover, .store-secondary-btn:hover, .store-action-btn:hover { transform: translateY(-1px); }
      .store-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
      .store-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 14px; min-height: 200px; }
      .store-card-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .store-card-title { font-size: 16px; font-weight: 800; color: #fff; }
      .store-card-meta { color: #9ab1ca; font-size: 12px; margin-top: 6px; }
      .store-card-desc { color: #c8d7ea; font-size: 13px; line-height: 1.5; min-height: 72px; }
      .store-tag-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: auto; }
      .store-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: rgba(0,255,213,0.12); color: #c6fff6; font-size: 11px; }
      .store-action-btn { background: #00c4a7; color: #061212; }
      .store-status, .store-error, .store-empty { padding: 14px 16px; border-radius: 16px; font-size: 14px; margin-bottom: 18px; }
      .store-status { background: rgba(255,255,255,0.05); color: #c8d7ea; }
      .store-error { background: rgba(255, 42, 95, 0.16); color: #ffbdcf; }
      .store-empty { text-align: center; color: #9aa5bf; background: rgba(255,255,255,0.04); }
      @media (max-width: 760px) { .store-header { flex-direction: column; } .store-controls { flex-direction: column; } }
    `;
    document.head.appendChild(style);
  }
}

if (typeof module !== 'undefined') module.exports = PluginStoreUI;

if (typeof window !== 'undefined' && document.getElementById && document.getElementById('plugin-store')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.pluginStoreUI = new PluginStoreUI('plugin-store');
    });
  } else {
    window.pluginStoreUI = new PluginStoreUI('plugin-store');
  }
}
