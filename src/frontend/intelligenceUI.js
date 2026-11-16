/* KORAI Player 1.8 — local intelligence workspace */
(() => {
  let spectrumRaf=0;
  let spectrumActive=false;
  let lyricsLines=[];
  let lyricsTrackId=null;
  let activeLyricIndex=-1;
  const api = () => `http://127.0.0.1:${apiPort}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request = async (url, options={}) => {
    const response = await fetch(`${api()}${url}`, { headers: {'Content-Type':'application/json'}, ...options });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  };
  const card = (label,value,detail='') => `<article class="ki-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`;
  const trackRows = items => items.map(item => {
    const track=item.track || item;
    return `<div class="ki-track"><div class="ki-track-copy"><b>${esc(track.title)}</b><small>${esc(track.artist || 'Unknown artist')} · ${esc(track.album || 'Unknown album')}</small></div><span class="ki-track-reason">${esc(item.reason || '')}</span><button class="ki-play" data-play-track="${Number(track.id)}" title="Play"><i class="fa-solid fa-play"></i></button></div>`;
  }).join('') || '<p class="ki-muted">No matching tracks in the current library.</p>';

  function renderLyricsPreview(root) {
    const preview=root.querySelector('#ki-lrc-preview');
    if(!preview)return;
    activeLyricIndex=-1;
    preview.innerHTML=lyricsLines.map((line,index)=>`<div class="ki-lyric-line" data-lyric-index="${index}"><time>${Math.floor(line.time/60)}:${String(Math.floor(line.time%60)).padStart(2,'0')}.${String(Math.floor((line.time%1)*100)).padStart(2,'0')}</time><span>${esc(line.text)}</span></div>`).join('')||'<p class="ki-muted">No valid timestamped lines found.</p>';
  }

  function updateLyricsPlayback(root) {
    if(!lyricsLines.length || lyricsTrackId===null)return;
    const status=root.querySelector('#ki-lrc-status');
    const audio=window.audioElement;
    const playingTrackId=window.currentTrackId;
    if(!audio || String(playingTrackId)!==String(lyricsTrackId)) {
      if(status)status.textContent='Lyrics loaded. Play this selected track to synchronize the current line.';
      return;
    }
    let position=Number(audio.currentTime)||0;
    if(typeof getElementTimelinePosition==='function') {
      const timeline=getElementTimelinePosition(audio);
      if(Number.isFinite(timeline.current))position=timeline.current;
    }
    let low=0,high=lyricsLines.length-1,found=-1;
    while(low<=high) {
      const mid=(low+high)>>1;
      if(lyricsLines[mid].time<=position){found=mid;low=mid+1;} else high=mid-1;
    }
    if(found===activeLyricIndex)return;
    const preview=root.querySelector('#ki-lrc-preview');
    preview?.querySelector('.ki-lyric-line.active')?.classList.remove('active');
    activeLyricIndex=found;
    if(found>=0) {
      const active=preview?.querySelector(`[data-lyric-index="${found}"]`);
      active?.classList.add('active');
      active?.scrollIntoView({block:'nearest',behavior:'smooth'});
      if(status)status.textContent=`Synchronized · ${Math.floor(position/60)}:${String(Math.floor(position%60)).padStart(2,'0')}`;
    } else if(status) status.textContent='Waiting for the first lyric timestamp.';
  }

  function startIntelligenceSpectrum(root) {
    const canvas=root.querySelector('#ki-spectrum');
    if(!canvas)return;
    const context=canvas.getContext('2d');
    const data=new Uint8Array(128);
    spectrumActive=true;
    if(spectrumRaf)cancelAnimationFrame(spectrumRaf);
    window.stopIntelligenceSpectrum=()=>{
      spectrumActive=false;
      if(spectrumRaf)cancelAnimationFrame(spectrumRaf);
      spectrumRaf=0;
    };
    const draw=()=>{
      if(!spectrumActive)return;
      updateLyricsPlayback(root);
      if(typeof currentActiveSection!=='undefined' && currentActiveSection!=='intelligence'){
        spectrumActive=false;spectrumRaf=0;return;
      }
      const width=canvas.width,height=canvas.height;
      context.clearRect(0,0,width,height);
      if(typeof analyser!=='undefined' && analyser){
        analyser.getByteFrequencyData(data);
        const gap=3,barWidth=(width-gap*(data.length-1))/data.length;
        data.forEach((value,index)=>{
          const barHeight=Math.max(2,(value/255)*height);
          context.fillStyle=`hsl(${245-index*0.45} 75% ${48+(value/255)*12}%)`;
          context.fillRect(index*(barWidth+gap),height-barHeight,barWidth,barHeight);
        });
      } else {
        context.fillStyle='rgba(255,255,255,.42)';
        context.font='13px sans-serif';
        context.fillText('Start playback to activate the live spectrum',14,28);
      }
      spectrumRaf=requestAnimationFrame(draw);
    };
    spectrumRaf=requestAnimationFrame(draw);
  }

  function setupWorkspace(root) {
    const key='korai_workspace_v1';
    let state={hidden:[],orders:{}};
    try { state={...state,...JSON.parse(localStorage.getItem(key)||'{}')}; } catch {}
    const panels=[...root.querySelectorAll('.ki-panel[data-widget-id]')];
    const persist=()=>localStorage.setItem(key,JSON.stringify(state));
    const apply=()=>{
      panels.forEach(panel=>panel.hidden=state.hidden.includes(panel.dataset.widgetId));
      for(const [parentId,order] of Object.entries(state.orders||{})){
        const parent=parentId==='root'?root:root.querySelector(`[data-workspace-group="${parentId}"]`);
        if(!parent)continue;
        const byId=new Map([...parent.querySelectorAll(':scope > .ki-panel[data-widget-id]')].map(p=>[p.dataset.widgetId,p]));
        order.forEach(id=>{const panel=byId.get(id);if(panel)parent.appendChild(panel);});
      }
    };
    root.querySelectorAll('.ki-columns').forEach((el,index)=>el.dataset.workspaceGroup=`columns-${index}`);
    root.dataset.workspaceGroup='root';
    const rememberOrder=parent=>{
      const id=parent.dataset.workspaceGroup;
      state.orders[id]=[...parent.querySelectorAll(':scope > .ki-panel[data-widget-id]')].map(p=>p.dataset.widgetId);
      persist();
    };
    panels.forEach(panel=>{
      const controls=document.createElement('div');controls.className='ki-widget-controls';
      const make=(label,title,handler)=>{
        const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.addEventListener('click',handler);controls.appendChild(b);
      };
      make('↑','Move up',()=>{
        const prev=panel.previousElementSibling;
        if(prev?.classList.contains('ki-panel')){panel.parentElement.insertBefore(panel,prev);rememberOrder(panel.parentElement);}
      });
      make('↓','Move down',()=>{
        const next=panel.nextElementSibling;
        if(next?.classList.contains('ki-panel')){panel.parentElement.insertBefore(next,panel);rememberOrder(panel.parentElement);}
      });
      make('×','Hide widget',()=>{
        state.hidden=[...new Set([...state.hidden,panel.dataset.widgetId])];panel.hidden=true;persist();refreshRestoreList();
      });
      panel.prepend(controls);
    });
    const refreshRestoreList=()=>{
      const list=root.querySelector('#ki-hidden-widgets');
      if(!list)return;
      list.innerHTML='';
      panels.filter(p=>state.hidden.includes(p.dataset.widgetId)).forEach(panel=>{
        const b=document.createElement('button');b.type='button';b.className='ki-restore-widget';b.textContent=`Restore ${panel.querySelector('h2')?.textContent||panel.dataset.widgetId}`;
        b.onclick=()=>{state.hidden=state.hidden.filter(id=>id!==panel.dataset.widgetId);panel.hidden=false;persist();refreshRestoreList();};
        list.appendChild(b);
      });
    };
    const restore=document.createElement('div');restore.id='ki-hidden-widgets';restore.className='ki-hidden-widgets';
    root.querySelector('.ki-heading-actions')?.appendChild(restore);
    const toggle=root.querySelector('#ki-customize');
    toggle?.addEventListener('click',()=>{
      const enabled=root.classList.toggle('ki-customizing');
      toggle.classList.toggle('active',enabled);
      toggle.innerHTML=enabled?'<i class="fa-solid fa-check"></i> Finish layout':'<i class="fa-solid fa-grip"></i> Customize workspace';
    });
    apply();refreshRestoreList();
  }

  async function renderIntelligencePage() {
    const root=document.getElementById('dynamicSectionContainer');
    if(!root) return;
    root.innerHTML=`<section class="ki-page">
      <header class="ki-heading"><div><div class="ki-kicker">KORAI 1.8 · LOCAL-FIRST</div><h1>KORAI Intelligence</h1><p>Music discovery, listening patterns and collection diagnostics — processed on this device.</p></div><div class="ki-heading-actions"><button id="ki-customize" class="ki-button secondary"><i class="fa-solid fa-grip"></i> Customize workspace</button><button id="ki-refresh" class="ki-button"><i class="fa-solid fa-rotate"></i> Refresh</button></div></header>
      <div id="ki-summary" class="ki-stats-grid">${card('Library','—')}${card('Listening history','—')}${card('Analyzed tracks','—')}${card('Last 30 days','—')}</div>
      <div class="ki-columns">
        <section class="ki-panel" data-widget-id="discovery"><div class="ki-panel-head"><div><span class="ki-kicker">DISCOVERY ENGINE</span><h2>Discover something new</h2></div></div>
          <div class="ki-moods" id="ki-moods">${['calm','focus','energetic','dark','emotional','ambient'].map(m=>`<button class="ki-mood" data-mood="${m}">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}</div>
          <div id="ki-discovery" class="ki-track-list"><p class="ki-muted">Choose a mood to rank tracks using available BPM, energy, key and listening history.</p></div>
        </section>
        <section class="ki-panel" data-widget-id="health"><div class="ki-panel-head"><div><span class="ki-kicker">COLLECTION HEALTH</span><h2>Library audit</h2></div><button id="ki-health" class="ki-button secondary">Run audit</button></div><div id="ki-health-content" class="ki-health-grid"><p class="ki-muted">Checks missing files, incomplete metadata, artwork and possible duplicate metadata.</p></div></section>
      </div>
      <div class="ki-columns">
        <section class="ki-panel" data-widget-id="listening"><span class="ki-kicker">LISTENING INTELLIGENCE</span><h2>What you listen to</h2><div id="ki-listening"></div></section>
        <section class="ki-panel" data-widget-id="audio"><span class="ki-kicker">AUDIO LAB</span><h2>Track diagnostics</h2><p class="ki-muted">Live frequency spectrum plus codec, bitrate, sample rate, bit depth and ReplayGain diagnostics.</p><canvas id="ki-spectrum" width="720" height="130" class="ki-spectrum"></canvas><select id="ki-diagnostic-track" class="ki-select"><option value="">Select a track…</option></select><div id="ki-diagnostics" class="ki-diagnostic-grid"></div></section>
      </div>
      <section class="ki-panel" data-widget-id="playlist"><div class="ki-panel-head"><div><span class="ki-kicker">ADVANCED PLAYLIST STUDIO</span><h2>Build a filtered listening set</h2></div></div>
        <div class="ki-filter-grid">
          <label>Minimum BPM<input id="ki-min-bpm" type="number" min="1" max="300" placeholder="Any"></label>
          <label>Maximum BPM<input id="ki-max-bpm" type="number" min="1" max="300" placeholder="Any"></label>
          <label>Minimum energy<input id="ki-min-energy" type="number" min="0" max="1" step=".01" placeholder="0.00"></label>
          <label>Maximum energy<input id="ki-max-energy" type="number" min="0" max="1" step=".01" placeholder="1.00"></label>
          <label>Genre contains<input id="ki-genre" type="text" placeholder="Any genre"></label>
          <label>Max tracks per artist<input id="ki-artist-limit" type="number" min="0" max="50" value="2"></label>
          <label>Sort by<select id="ki-sort" class="ki-select"><option value="bpm">BPM</option><option value="key">Musical key</option><option value="energy">Energy</option></select></label>
          <label class="ki-checkbox"><input id="ki-unplayed" type="checkbox"> Not played in 30 days</label>
          <button id="ki-preview-playlist" class="ki-button">Preview playlist</button>
        </div><div id="ki-playlist-preview" class="ki-track-list"></div>
      </section>
      <section class="ki-panel" data-widget-id="lyrics"><span class="ki-kicker">LYRICS STUDIO</span><h2>Local LRC parser</h2><p class="ki-muted">Paste timestamped LRC lyrics to validate timing and preview synchronized lines. No lyrics are uploaded.</p><textarea id="ki-lrc-input" class="ki-lrc-input" placeholder="[00:12.50]First lyric line&#10;[00:16.20]Second lyric line"></textarea><div class="ki-inline-actions"><button id="ki-load-lyrics" class="ki-button secondary">Load selected track</button><button id="ki-parse-lrc" class="ki-button secondary">Parse LRC</button><button id="ki-save-lyrics" class="ki-button">Save to track metadata</button><span id="ki-lrc-status" class="ki-muted"></span></div><div id="ki-lrc-preview" class="ki-lrc-preview"></div></section>
    </section>`;
    setupWorkspace(root);
    startIntelligenceSpectrum(root);
    const bindPlay=container=>container?.querySelectorAll('[data-play-track]').forEach(button=>button.addEventListener('click',()=>playTrack(Number(button.dataset.playTrack))));
    try {
      const [overview, tracks]=await Promise.all([request('/api/intelligence/overview'),request('/api/tracks')]);
      root.querySelector('#ki-summary').innerHTML=[
        card('Library',overview.totalTracks,'Available tracks'),
        card('Listening history',overview.totalPlays,'Up to 50,000 recent play events retained'),
        card('Analyzed tracks',overview.analyzedTracks,'With audio features'),
        card('Last 30 days',overview.playsLast30Days,'Recorded plays'),
        card('Skipped',overview.behavior?.skips ?? 0,'Recorded skip events'),
        card('Completed',overview.behavior?.completions ?? 0,'Reached 90% playback')
      ].join('');
      const artists=(overview.topArtists||[]).slice(0,5).map(x=>`<div class="ki-ranking"><span>${esc(x.name)}</span><b>${x.count}</b></div>`).join('')||'<p class="ki-muted">Not enough listening history yet.</p>';
      const genres=(overview.topGenres||[]).slice(0,5).map(x=>`<div class="ki-ranking"><span>${esc(x.name)}</span><b>${x.count}</b></div>`).join('');
      const activeHours=(overview.hourlyActivity||[]).filter(x=>x.plays).sort((a,b)=>b.plays-a.plays).slice(0,3).map(x=>`${String(x.hour).padStart(2,'0')}:00 (${x.plays})`).join(' · ')||'Not enough data';
      root.querySelector('#ki-listening').innerHTML=`<h3>Top artists</h3>${artists}<h3>Top genres</h3>${genres||'<p class="ki-muted">Genre tags are not available.</p>'}<h3>Genre trend · last 30 days vs previous 30 days</h3><p class="ki-muted">Recent: ${esc((overview.tasteShift?.recentGenres||[]).map(x=>`${x.genre} (${x.plays})`).join(', ')||'No recent genre data')}</p><p class="ki-muted">Previous: ${esc((overview.tasteShift?.previousGenres||[]).map(x=>`${x.genre} (${x.plays})`).join(', ')||'No previous genre data')}</p><p class="ki-muted">Most active hours: ${esc(activeHours)}</p><h3>Playback behavior</h3><p class="ki-muted">${esc(overview.behavior?.skips ?? 0)} skips · ${esc(overview.behavior?.quickSkips ?? 0)} early skips · ${esc(overview.behavior?.completions ?? 0)} completions · ${esc(Math.round((overview.behavior?.listeningTimeSeconds ?? 0)/3600*10)/10)} hours of completed listening time</p>`;
      const select=root.querySelector('#ki-diagnostic-track');
      select.innerHTML+=[...tracks].sort((a,b)=>String(a.title).localeCompare(String(b.title))).map(t=>`<option value="${Number(t.id)}">${esc(t.title)} — ${esc(t.artist||'Unknown')}</option>`).join('');
      root.querySelector('#ki-refresh').onclick=()=>renderIntelligencePage();
      root.querySelectorAll('[data-mood]').forEach(btn=>btn.onclick=async()=>{
        root.querySelectorAll('[data-mood]').forEach(b=>b.classList.toggle('active',b===btn));
        const result=await request(`/api/intelligence/discover?mood=${encodeURIComponent(btn.dataset.mood)}&limit=15`);
        const list=root.querySelector('#ki-discovery'); list.innerHTML=trackRows(result.items); bindPlay(list);
      });
      root.querySelector('#ki-health').onclick=async()=>{
        const report=await request('/api/library/health');
        const counts=report.summary;
        root.querySelector('#ki-health-content').innerHTML=[
          card('Missing files',counts.missingFiles,'Unavailable paths'),
          card('Metadata gaps',counts.incompleteMetadata,'Tracks missing artist, album or genre'),
          card('Missing artwork',counts.missingArtwork,'Tracks without cover art'),
          card('Possible duplicates',counts.possibleDuplicateGroups,'Metadata matches; verify before deleting'),
          card('Changed files',counts.changedFiles || 0,'File differs from indexed size or timestamp'),
          card('Empty files',counts.emptyFiles || 0,'Zero-byte audio files')
        ].join('')+`<details class="ki-details"><summary>Review findings</summary>${[
          ['Missing files',report.missingFiles],['Changed files',report.changedFiles || []],['Empty files',report.emptyFiles || []],['Incomplete metadata',report.incompleteMetadata],['Missing artwork',report.missingArtwork],['Possible duplicate groups',report.possibleDuplicates]
        ].map(([name,items])=>`<h4>${name} (${items.length})</h4>${items.slice(0,30).map(x=>`<p>${esc(x.title||x[0]?.title)} ${x.artist?'— '+esc(x.artist):''}</p>`).join('')}`).join('')}</details>`;
      };
      select.onchange=async()=>{
        const id=select.value, target=root.querySelector('#ki-diagnostics'); target.innerHTML='';
        if(!id)return;
        const d=await request(`/api/tracks/${encodeURIComponent(id)}/diagnostics`);
        const fields=[['Codec',d.codec],['Container',d.container],['Bitrate',d.bitrate?`${Math.round(d.bitrate/1000)} kbps`:'Unknown'],['Sample rate',d.sampleRate?`${d.sampleRate} Hz`:'Unknown'],['Bit depth',d.bitsPerSample||'Unknown'],['Channels',d.channelLayout],['Duration',d.duration?`${Math.round(d.duration)} sec`:'Unknown'],['File size',`${(d.fileSize/1048576).toFixed(2)} MB`],['ReplayGain',d.replayGainTrackDb===null?'Not available':`${d.replayGainTrackDb} dB`],['Sample peak',d.pcm?.status==='measured'?`${d.pcm.peakDbfs.toFixed(2)} dBFS`:'Not measured'],['Clipped samples',d.pcm?.status==='measured'?`${d.pcm.clippedSamples}`:'Not measured'],['RMS',d.pcm?.status==='measured'?`${d.pcm.rmsDbfs.toFixed(2)} dBFS`:'Not measured'],['Crest factor',d.pcm?.status==='measured'&&d.pcm.crestFactorDb!==null?`${d.pcm.crestFactorDb.toFixed(2)} dB`:'Not measured'],['Integrated LUFS',d.loudnessMeasurement?.status==='measured'?`${d.loudnessMeasurement.integratedLufs.toFixed(1)} LUFS`:(d.loudnessMeasurement?.reason||'Not measured')],['Short-term max',d.loudnessMeasurement?.shortTermMaxLufs===null||d.loudnessMeasurement?.shortTermMaxLufs===undefined?'Not available':`${d.loudnessMeasurement.shortTermMaxLufs.toFixed(1)} LUFS`],['Loudness range',d.loudnessMeasurement?.loudnessRangeLu===null||d.loudnessMeasurement?.loudnessRangeLu===undefined?'Not available':`${d.loudnessMeasurement.loudnessRangeLu.toFixed(1)} LU`],['True Peak',d.loudnessMeasurement?.status==='measured'?`${d.loudnessMeasurement.truePeakDbtp.toFixed(2)} dBTP`:(d.truePeak||'Not measured')]];
        target.innerHTML=fields.map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');
      };
      root.querySelector('#ki-preview-playlist').onclick=async()=>{
        const val=id=>root.querySelector(`#${id}`).value;
        const criteria={minBpm:val('ki-min-bpm')||null,maxBpm:val('ki-max-bpm')||null,minEnergy:val('ki-min-energy')||null,maxEnergy:val('ki-max-energy')||null,genres:val('ki-genre').trim()?[val('ki-genre').trim()]:[],maxPerArtist:val('ki-artist-limit')||0,sortBy:val('ki-sort'),unplayed30Days:root.querySelector('#ki-unplayed').checked};
        const result=await request('/api/playlists/preview',{method:'POST',body:JSON.stringify(criteria)});
        const target=root.querySelector('#ki-playlist-preview');target.innerHTML=`<p class="ki-muted">${result.count} matching tracks</p>`+trackRows(result.tracks);bindPlay(target);
      };
      root.querySelector('#ki-load-lyrics').onclick=async()=>{
        const id=select.value;if(!id){root.querySelector('#ki-lrc-status').textContent='Select a track in Audio Lab first.';return;}
        const result=await request(`/api/tracks/${encodeURIComponent(id)}/lyrics`);
        root.querySelector('#ki-lrc-input').value=result.source||'';
        lyricsTrackId=Number(id);
        lyricsLines=await request('/api/lyrics/parse',{method:'POST',body:JSON.stringify({lyrics:result.source||''})}).then(parsed=>parsed.lines);
        renderLyricsPreview(root);
        root.querySelector('#ki-lrc-status').textContent=lyricsLines.length?`Loaded ${result.sourceKind} lyrics · ${lyricsLines.length} timed lines`:`No timestamped lines found in ${result.sourceKind} lyrics`;
      };
      root.querySelector('#ki-save-lyrics').onclick=async()=>{
        const id=select.value;if(!id){root.querySelector('#ki-lrc-status').textContent='Select a track in Audio Lab first.';return;}
        const source=root.querySelector('#ki-lrc-input').value;
        await request(`/api/tracks/${encodeURIComponent(id)}/tags`,{method:'PUT',body:JSON.stringify({lyrics:source})});
        lyricsTrackId=Number(id);
        lyricsLines=await request('/api/lyrics/parse',{method:'POST',body:JSON.stringify({lyrics:source})}).then(parsed=>parsed.lines);
        renderLyricsPreview(root);
        root.querySelector('#ki-lrc-status').textContent=`Saved embedded lyrics · ${lyricsLines.length} timed lines`;
      };
      root.querySelector('#ki-parse-lrc').onclick=async()=>{
        const result=await request('/api/lyrics/parse',{method:'POST',body:JSON.stringify({lyrics:root.querySelector('#ki-lrc-input').value})});
        lyricsLines=result.lines;
        lyricsTrackId=select.value?Number(select.value):null;
        renderLyricsPreview(root);
        root.querySelector('#ki-lrc-status').textContent=`${result.lines.length} timestamped lines`;
      };
    } catch(error) {
      root.querySelector('#ki-summary').innerHTML=`<p class="ki-error">${esc(error.message)}</p>`;
    }
  }
  window.renderIntelligencePage=renderIntelligencePage;
})();
