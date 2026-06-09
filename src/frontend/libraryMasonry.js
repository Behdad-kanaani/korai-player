(function(){
    if (typeof window === 'undefined') return;

    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Single observers reused to avoid creating many instances
    const imageObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries, ob) => {
        entries.forEach(en => {
            if (en.isIntersecting) {
                const img = en.target;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                ob.unobserve(img);
            }
        });
    }, { rootMargin: '200px' }) : null;

    // Only observe canvases that are actually visible (to limit draw cost)
    const visibleCanvases = new Set();
    const canvasObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
        entries.forEach(en => {
            const c = en.target;
            if (en.isIntersecting) visibleCanvases.add(c); else visibleCanvases.delete(c);
        });
    }, { rootMargin: '100px' }) : null;

    function lazyLoadImages(container) {
        const imgs = container.querySelectorAll('img[data-src]');
        if (imageObserver) imgs.forEach(i => imageObserver.observe(i));
        else imgs.forEach(i => { i.src = i.dataset.src; i.removeAttribute('data-src'); });
    }

    function computeGridSpans(grid) {
        const rowHeight = parseInt(getComputedStyle(grid).getPropertyValue('grid-auto-rows')) || 12;
        const rowGap = parseInt(getComputedStyle(grid).getPropertyValue('grid-row-gap')) || 16;
        grid.querySelectorAll('.library-card').forEach(card => {
            const height = card.getBoundingClientRect().height;
            const rowSpan = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
            card.style.gridRowEnd = `span ${rowSpan}`;
        });
    }

    // Use event delegation to minimize listeners
    function attachCardInteractions(grid){
        if (!grid) return;
        if (grid._delegationAttached) return;
        grid.addEventListener('click', (e)=>{
            const card = e.target.closest('.library-card');
            if (!card) return;
            const id = parseInt(card.dataset.trackId);
            if (!id) return;
            // if the event came from action buttons, let them handle it
            if (e.target.closest('.card-actions')) return;
            playTrack(id);
        });
        grid.addEventListener('keydown', (e)=>{
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('.library-card');
            if (!card) return;
            e.preventDefault();
            const id = parseInt(card.dataset.trackId);
            if (id) playTrack(id);
        });
        grid._delegationAttached = true;
    }

    // Shared visualizer draws only for canvases that are visible
    let visualizerRAF = null;
    let visualizerInterval = null;
    function startSharedVisualizer(){
        if (prefersReduced) return;
        const analyser = window.analyser || null;
        if (!analyser) return;
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        // Throttle shared visualizer and reduce backing resolution
        const scaleFactor = (window.devicePixelRatio || 1) * 0.5;
        function draw(){
            analyser.getByteFrequencyData(dataArray);
            visibleCanvases.forEach(canvas => {
                if (!document.body.contains(canvas)) { visibleCanvases.delete(canvas); return; }
                const ctx = canvas._ctx || (canvas._ctx = canvas.getContext('2d'));
                const w = Math.max(1, Math.floor(canvas.clientWidth * scaleFactor));
                const h = Math.max(1, Math.floor(canvas.clientHeight * scaleFactor));
                if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
                ctx.clearRect(0,0,w,h);
                const barWidth = Math.max(1, (w / bufferLength) * 1.2);
                let x = 0;
                for (let i=0;i<bufferLength;i++){
                    const v = dataArray[i] / 255;
                    const barHeight = v * h;
                    const grd = ctx.createLinearGradient(0,0,0,h);
                    grd.addColorStop(0, 'rgba(0,255,213,0.95)');
                    grd.addColorStop(1, 'rgba(0,120,140,0.15)');
                    ctx.fillStyle = grd;
                    ctx.fillRect(x, h - barHeight, barWidth, barHeight);
                    x += Math.max(1, Math.floor(barWidth)) + 1;
                    if (x > w) break;
                }
            });
        }

        if (visualizerInterval) clearInterval(visualizerInterval);
        visualizerInterval = setInterval(draw, 50); // ~20 FPS
    }

    function stopSharedVisualizer(){ if (visualizerRAF) cancelAnimationFrame(visualizerRAF); visualizerRAF = null; if (visualizerInterval) { clearInterval(visualizerInterval); visualizerInterval = null; } }

    // Ensure resize handler and observers are only attached once
    if (!window._libraryMasonryInit) window._libraryMasonryInit = { inited: true };

    window.renderLibraryCards = function(){
        const container = document.getElementById('dynamicSectionContainer');
        if (!container || !window.tracks) return;
        let listToRender = [...window.tracks];
        if (window.libraryGenreFilter && window.libraryGenreFilter !== 'all') listToRender = listToRender.filter(t => t.genre === window.libraryGenreFilter);
        const key = window.librarySortKey || 'createdAt';
        const order = window.librarySortOrder || 'desc';
        listToRender.sort((a,b)=>{
            let va = a[key]||'', vb = b[key]||'';
            if (typeof va === 'string') return order === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return order === 'asc' ? (va - vb) : (vb - va);
        });

        const headerEl = container.querySelector('.library-header-panel');
        const headerHtml = headerEl ? headerEl.outerHTML : '';

        const ITEM_HEIGHT = 220; // px fixed item height for virtualization
        const BUFFER = 6; // number of items above/below viewport to render
        const total = listToRender.length;

        // build virtual viewport
        const viewport = document.createElement('div');
        viewport.className = 'library-virtual-viewport';
        const content = document.createElement('div');
        content.className = 'library-virtual-content';
        content.style.height = (total * ITEM_HEIGHT) + 'px';
        const layer = document.createElement('div');
        layer.className = 'library-virtual-layer';
        layer.style.position = 'relative';
        content.appendChild(layer);
        viewport.appendChild(content);

        // replace container content
        container.innerHTML = headerHtml;
        container.appendChild(viewport);

        // map of index -> dom node
        const rendered = new Map();

        function createCardAt(index){
            const track = listToRender[index];
            const card = document.createElement('div');
            card.className = 'library-card';
            card.tabIndex = 0;
            card.dataset.trackId = track.id;
            card.style.position = 'absolute';
            card.style.top = (index * ITEM_HEIGHT) + 'px';
            card.style.height = ITEM_HEIGHT + 'px';
            card.style.left = '0';
            card.style.right = '0';

            const coverUrl = track.hasCover ? `http://127.0.0.1:${window.apiPort}/api/tracks/${track.id}/cover` : null;
            const visual = document.createElement('div'); visual.className = 'card-visual';
            if (coverUrl){ const img = document.createElement('img'); img.setAttribute('data-src', coverUrl); img.alt = 'Cover'; visual.appendChild(img); if (imageObserver) imageObserver.observe(img); }
            else { const i = document.createElement('i'); i.className='fa-solid fa-music'; visual.appendChild(i); }
            const canvas = document.createElement('canvas'); canvas.className='card-visualizer'; canvas.setAttribute('aria-hidden','true'); visual.appendChild(canvas); if (canvasObserver) canvasObserver.observe(canvas);
            const play = document.createElement('div'); play.className='card-play'; play.setAttribute('role','button'); play.setAttribute('aria-label','Play'); play.innerHTML = '<i class="fa-solid fa-play"></i>';
            visual.appendChild(play);

            const body = document.createElement('div'); body.className='card-body'; const h4 = document.createElement('h4'); h4.className='card-title'; h4.textContent = track.title||'Untitled'; const p = document.createElement('p'); p.className='card-artist'; p.textContent = track.artist||'Unknown'; body.appendChild(h4); body.appendChild(p);
            const meta = document.createElement('div'); meta.className='card-meta'; meta.innerHTML = `<span>${track.bpm||'120'} BPM</span><span>${formatTime(track.duration)}</span>`;
            const actions = document.createElement('div'); actions.className='card-actions'; actions.innerHTML = `<button onclick="event.stopPropagation(); showPlaylistContextMenu(${track.id}, event.clientX, event.clientY)"><i class="fa-solid fa-plus"></i></button><button onclick="event.stopPropagation(); deleteTrack(${track.id}, event)"><i class="fa-solid fa-trash"></i></button>`;

            card.appendChild(visual); card.appendChild(body); card.appendChild(meta); card.appendChild(actions);
            return card;
        }

        function onScroll(){
            const scrollTop = viewport.scrollTop;
            const vh = viewport.clientHeight;
            const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
            const end = Math.min(total - 1, Math.ceil((scrollTop + vh) / ITEM_HEIGHT) + BUFFER);

            // remove items out of range
            for (const [idx, node] of rendered.entries()){
                if (idx < start || idx > end){ node.remove(); rendered.delete(idx); }
            }

            // add missing
            for (let i = start; i <= end; i++){
                if (!rendered.has(i)){
                    const n = createCardAt(i);
                    layer.appendChild(n);
                    rendered.set(i, n);
                }
            }
        }

        // initial render
        viewport.addEventListener('scroll', throttle(onScroll, 50));
        window.addEventListener('resize', throttle(onScroll, 120));
        // trigger initial
        requestAnimationFrame(onScroll);

        // attach delegated interactions to viewport
        attachCardInteractions(viewport);

        // start visualizer if analyser exists
        if (!window._libraryMasonryInit.visualizerAttached) {
            const tryStart = ()=>{ if (window.analyser) startSharedVisualizer(); };
            tryStart(); setTimeout(tryStart, 800);
            window.addEventListener('beforeunload', stopSharedVisualizer);
            window._libraryMasonryInit.visualizerAttached = true;
        }
    };

    // If analyser appears later, try to start visualizer
    setTimeout(()=>{ if (window.analyser) startSharedVisualizer(); }, 800);

})();
