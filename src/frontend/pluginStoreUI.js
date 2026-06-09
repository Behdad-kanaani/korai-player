/**
 * Plugin Store UI - Browse and discover plugins from marketplace
 */

class PluginStoreUI {
  constructor(containerId = 'plugin-store') {
    this.container = document.getElementById(containerId) || document.createElement('div');
    if (!this.container.id) this.container.id = containerId;
    this.container.innerHTML = '';
    document.body.appendChild(this.container);
    this.renderDisabled();
  }

  renderDisabled() {
    this.container.innerHTML = `
      <div style="padding:40px; max-width:900px; margin:40px auto; font-family: system-ui, -apple-system, sans-serif; color:#fff;">
        <h2 style="font-size:24px; margin-bottom:8px;">Plugin Store Disabled</h2>
        <p style="color:#ccc; margin-bottom:16px;">The plugin marketplace is currently disabled. Use the <strong>Plugin Manager</strong> to manually install plugin ZIP bundles.</p>
        <div style="display:flex; gap:12px;">
          <button id="goToManager" style="padding:10px 14px; border-radius:8px; background:#00c4a7; color:#042; border:none; font-weight:700; cursor:pointer;">Open Plugin Manager</button>
          <button id="learnMore" style="padding:10px 14px; border-radius:8px; background:transparent; color:#fff; border:1px solid rgba(255,255,255,0.12); cursor:pointer;">How to install manually</button>
        </div>
        <div style="margin-top:18px; color:#aaa; font-size:13px;">
          Supported plugin bundles must include a <code>manifest.json</code> at the root and the plugin entry JS file. Upload .zip files via the Plugin Manager.
        </div>
      </div>
    `;

    document.getElementById('goToManager').addEventListener('click', () => {
      window.location.href = 'plugins.html';
    });
    document.getElementById('learnMore').addEventListener('click', () => {
      alert('To install manually: create a ZIP with manifest.json and plugin files, then use the Plugin Manager → Install.');
    });
  }

  attachEventListeners() {
    const searchInput = document.getElementById('storeSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.search(e.target.value);
      });
    }
  }

  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// Initialize on DOMContentLoaded
if (typeof module !== 'undefined') module.exports = PluginStoreUI;

// Auto-init when loaded in the browser on the store page
if (typeof window !== 'undefined' && document && document.getElementById && document.getElementById('plugin-store')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { window.pluginStoreUI = new PluginStoreUI('plugin-store'); });
  } else {
    window.pluginStoreUI = new PluginStoreUI('plugin-store');
  }
}
