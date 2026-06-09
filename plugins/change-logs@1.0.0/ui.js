// Change Logs plugin UI — shows a modal on first run per app version
(function(){
  const CHANGELOG_HTML = `
  <h3 style="margin:0 0 6px 0;">KORAI Player v1.4.0 - Summary</h3>
  <div style="font-size:13px; color:var(--muted-color,#cbd5e1);">
  <strong>What's New</strong>
  <ul>
    <li>Plugins - Install third-party plugins</li>
    <li>Audio effects - Echo, reverb, bass boost, etc.</li>
    <li>New home page - Stats cards & smart recommendations</li>
    <li>Better library - Smooth scrolling & masonry layout</li>
  </ul>
  <strong>Improvements</strong>
  <ul>
    <li>Faster - Quicker image & album loading</li>
    <li>Fullscreen player - Cinema-like experience with vinyl animation</li>
    <li>Miniplayer - Small transparent window for background playback</li>
  </ul>
  <strong>Fixes</strong>
  <ul>
    <li>Miniplayer display issues</li>
    <li>Better colors for Liquid Glass theme</li>
    <li>Minor playback bugs</li>
  </ul>
  </div>
  `;

  function getAppVersion(){
    if (window.electronAPI && typeof window.electronAPI.checkUpdateStatus === 'function'){
      return window.electronAPI.checkUpdateStatus().catch(()=>null).then(s=> (s && s.currentVersion) ? s.currentVersion : null);
    }
    const el = document.getElementById('versionStatus');
    if (el) return Promise.resolve(el.textContent.replace(/^v/,'').trim() || null);
    return Promise.resolve('unknown');
  }

  async function shouldShow() {
    const version = (await getAppVersion()) || 'unknown';
    const key = `korai.changeLogs.seen:${version}`;
    const seen = localStorage.getItem(key);
    return { show: !seen, key, version };
  }

  function createCard(version, key){
    const card = document.createElement('div');
    card.className = 'korai-change-card';
    card.innerHTML = `
      <div class="korai-change-card-inner">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div style="font-weight:900">Changelog — v${version}</div>
          <div style="margin-left:12px;flex:1;color:#9fb1d6">A quick summary of what's new in this version</div>
        </div>
        <div class="korai-change-content">${CHANGELOG_HTML}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="korai-change-dismiss">Dismiss</button>
        </div>
      </div>
    `;
    const btn = card.querySelector('.korai-change-dismiss');
    btn.addEventListener('click', ()=>{
      try{ localStorage.setItem(key, '1'); }catch(e){}
      card.remove();
    });
    return card;
  }

  function insertIntoPluginsPage(card){
    const container = document.getElementById('pluginContainer');
    if (!container) return false;
    // insert at top of container
    container.parentNode.insertBefore(card, container);
    return true;
  }

  async function tryShowInline(){
    try{
      const info = await shouldShow();
      if (!info.show) return;
      const version = info.version || 'unknown';
      const key = info.key;

      const card = createCard(version, key);

      if (insertIntoPluginsPage(card)){
        console.info('change-logs: inserted changelog card into plugins page for', version);
        return;
      }

      // if plugin container not present yet, observe for a short time
      const observer = new MutationObserver((mutations, obs)=>{
        if (document.getElementById('pluginContainer')){
          if (insertIntoPluginsPage(card)){
            console.info('change-logs: inserted changelog card after observing DOM');
            obs.disconnect();
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // stop observing after 5s
      setTimeout(()=>observer.disconnect(), 5000);
    }catch(e){ console.warn('change-logs inline error', e); }
  }

  // Minimal styles if ui.css not present
  (function injectFallback(){
    if (document.getElementById('korai-change-card-styles')) return;
    const s = document.createElement('style'); s.id = 'korai-change-card-styles';
    s.textContent = `
      .korai-change-card{margin:12px 0;padding:12px;border-radius:12px;background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));border:1px solid rgba(255,255,255,0.04)}
      .korai-change-card .korai-change-content{margin-top:8px;color:#cbd5e1}
      .korai-change-dismiss{background:#00c4a7;color:#042;border:0;padding:8px 12px;border-radius:8px;font-weight:800;cursor:pointer}
    `;
    document.head.appendChild(s);
  })();

  // Run after load to attempt inline insertion
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryShowInline); else setTimeout(tryShowInline, 200);

})();
