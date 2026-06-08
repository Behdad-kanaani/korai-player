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

          .store-header {
            margin-bottom: 40px;
          }

          .store-title {
            font-size: 36px;
            font-weight: bold;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 15px;
          }

          .store-subtitle {
            color: #999;
            font-size: 16px;
            margin-bottom: 25px;
          }

          .store-search {
            display: flex;
            gap: 10px;
            margin-bottom: 30px;
          }

          .search-input {
            flex: 1;
            padding: 12px 16px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(102, 126, 234, 0.3);
            border-radius: 8px;
            color: #eee;
            font-size: 14px;
          }

          .search-input::placeholder {
            color: #666;
          }

          .search-input:focus {
            outline: none;
            border-color: #667eea;
            background: rgba(102, 126, 234, 0.1);
          }

          .plugin-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
          }

          .plugin-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(102, 126, 234, 0.2);
            border-radius: 12px;
            padding: 20px;
            transition: all 0.3s;
            display: flex;
            flex-direction: column;
            cursor: pointer;
          }

          .plugin-card:hover {
            border-color: #667eea;
            background: rgba(102, 126, 234, 0.1);
            transform: translateY(-4px);
            box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
          }

          .plugin-icon {
            font-size: 48px;
            margin-bottom: 12px;
            text-align: center;
          }

          .plugin-name {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 8px;
            color: #fff;
          }

          .plugin-author {
            font-size: 12px;
            color: #888;
            margin-bottom: 10px;
          }

          .plugin-description {
            font-size: 13px;
            color: #aaa;
            margin-bottom: 12px;
            flex-grow: 1;
            line-height: 1.4;
          }

          .plugin-stats {
            display: flex;
            gap: 15px;
            margin-bottom: 12px;
            font-size: 12px;
            color: #888;
          }

          .plugin-rating {
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .stars {
            color: #ffc107;
          }

          .plugin-downloads {
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .plugin-tags {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
            flex-wrap: wrap;
          }

          .tag {
            background: rgba(102, 126, 234, 0.2);
            color: #667eea;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: bold;
          }

          .install-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 10px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
            transition: transform 0.2s;
          }

          .install-btn:hover {
            transform: scale(1.05);
          }

          .empty-state {
            grid-column: 1/-1;
            text-align: center;
            padding: 60px 20px;
            color: #666;
          }

          .empty-state-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }

          .empty-state h3 {
            font-size: 24px;
            color: #888;
            margin-bottom: 10px;
          }

          .featured-badge {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: bold;
            margin-bottom: 8px;
          }
        </style>

        <div class="store-header">
          <div class="store-title">🎵 Plugin Store</div>
          <div class="store-subtitle">Discover and install amazing plugins to extend KORAI</div>
        </div>

        <div class="store-search">
          <input type="text" 
                 class="search-input" 
                 placeholder="Search plugins... (try: visualizer, equalizer, ai)" 
                 id="storeSearchInput">
        </div>

        <div class="plugin-grid">
          ${filtered.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">🔍</div>
              <h3>No plugins found</h3>
              <p>Try searching for something else</p>
            </div>
          ` : filtered.map(p => `
            <div class="plugin-card">
              ${p.featured ? '<div class="featured-badge">⭐ Featured</div>' : ''}
              <div class="plugin-icon">${p.screenshot || '📦'}</div>
              <div class="plugin-name">${this.escapeHtml(p.name)}</div>
              <div class="plugin-author">by ${this.escapeHtml(p.author)}</div>
              <div class="plugin-description">${this.escapeHtml(p.description)}</div>
              
              <div class="plugin-stats">
                <div class="plugin-rating">
                  <span class="stars">${'⭐'.repeat(Math.round(p.rating))}</span>
                  <span>${p.rating}</span>
                </div>
                <div class="plugin-downloads">
                  <span>📥</span>
                  <span>${p.downloads.toLocaleString()}</span>
                </div>
              </div>

              <div class="plugin-tags">
                ${p.tags.map(t => `<span class="tag">${t}</span>`).join('')}
              </div>

              <button class="install-btn" onclick="pluginStoreUI.installPlugin('${p.id}')">
                ⬇️ Install
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.attachEventListeners();
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
