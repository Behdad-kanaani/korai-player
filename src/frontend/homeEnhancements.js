// Home page micro-interactions: tilt, stagger reveal, mood chip toggles
(function(){
    if (typeof window === 'undefined') return;

    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function applyTilt(card, evt){
        const rect = card.getBoundingClientRect();
        const cx = rect.left + rect.width/2;
        const cy = rect.top + rect.height/2;
        const dx = (evt.clientX - cx) / rect.width; // -0.5 .. 0.5
        const dy = (evt.clientY - cy) / rect.height;
        // scale to small degrees
        const tx = Math.max(Math.min(dy * -10, 10), -10);
        const ty = Math.max(Math.min(dx * 10, 10), -10);
        card.style.setProperty('--tx', tx);
        card.style.setProperty('--ty', ty);
    }

    function resetTilt(card){
        card.style.setProperty('--tx', 0);
        card.style.setProperty('--ty', 0);
    }

    function initTilt(){
        if (prefersReduced) return;
        const cards = Array.from(document.querySelectorAll('.featured-card'));
        cards.forEach(card => {
            let raf = null;
            const pointerMove = (e) => {
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(()=> applyTilt(card, e));
            };
            card.addEventListener('pointermove', pointerMove);
            card.addEventListener('pointerleave', ()=> resetTilt(card));
            card.addEventListener('pointerdown', ()=> card.classList.add('pressed'));
            card.addEventListener('pointerup', ()=> card.classList.remove('pressed'));
            // make cards keyboard focusable for accessibility
            if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex','0');
        });
    }

    function staggerReveal(){
        const grid = document.querySelectorAll('.featured-card');
        grid.forEach((el, i) => {
            el.classList.add('fade-up');
            el.style.setProperty('--delay', `${i * 80}ms`);
        });

        const recent = document.querySelectorAll('.recent-track-item');
        recent.forEach((el, i) => {
            el.classList.add('fade-up');
            el.style.setProperty('--delay', `${i * 60}ms`);
        });
    }

    function initMoodChips(){
        const chips = document.querySelectorAll('.mood-chip');
        chips.forEach(ch => {
            ch.setAttribute('role', 'button');
            ch.setAttribute('tabindex', '0');
            ch.addEventListener('click', ()=> ch.classList.toggle('active'));
            ch.addEventListener('keydown', (e)=> { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ch.classList.toggle('active'); }});
        });
    }

    function initPlayOverlays(){
        // make play overlay button actionable by keyboard
        document.querySelectorAll('.featured-card').forEach(card => {
            card.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }});
        });
    }

    /* Ensure common card elements get a unified class for styling */
    function applyMusicCardClass(){
        try{
            const selectors = ['.library-card', '.album-card', '.featured-card', '.spotify-music-card', '.ai-suggestion-card', '.recent-item-premium', '.library-minimal .library-card'];
            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => el.classList.add('music-card'));
            });
        }catch(e){ /* silent */ }
    }

    document.addEventListener('DOMContentLoaded', ()=>{
        try{
            staggerReveal();
            initMoodChips();
            initPlayOverlays();
            applyMusicCardClass();
            initTilt();
            observeLibrarySection();
            // remove any previously injected toggles (user requested removal)
            document.querySelectorAll('.library-view-toggle').forEach(el => el.remove());
        }catch(err){
            console.warn('homeEnhancements init failed', err);
        }
    });

    /* ------------------------------------------------------------------
       Library enhancements: inject toggle and render dreamy cards
       ------------------------------------------------------------------ */
    function createLibraryToggle(headerPanel){
        // intentionally left empty — toggle removed per user request
        return;
    }

    // Delegate to the optimized renderer when available
    function renderLibraryCards(){
        if (typeof window.renderLibraryCards === 'function') return window.renderLibraryCards();
        // fallback: minimal rendering to avoid breaking
        const container = document.getElementById('dynamicSectionContainer');
        if (!container || !window.tracks) return;
        container.innerHTML = '<div class="library-cards-grid">' + (window.tracks.slice(0,20).map(t=>`<div class="library-card">${escapeHtml(t.title||'Untitled')}</div>`).join('') ) + '</div>';
    }

    function observeLibrarySection(){
        const root = document.getElementById('dynamicSectionContainer');
        if (!root) return;
        const mo = new MutationObserver((mutations)=>{
            for (const m of mutations) {
                if (m.type === 'childList' && m.addedNodes.length) {
                    // check for library header panel
                    const header = root.querySelector('.library-header-panel');
                    if (header) createLibraryToggle(header);
                    // apply dreamy class to wrapper
                    const wrapper = root.querySelector('.library-table-wrapper');
                    if (wrapper) wrapper.classList.add('library-dreamy');
                    // ensure newly added cards get unified styling
                    applyMusicCardClass();
                    // if albums or artists or featured-grid added, kick off micro-interactions
                    if (root.querySelector('.featured-card') || root.querySelector('.featured-grid') || root.querySelector('.album-detail-view') || root.querySelector('.artist-detail-view')){
                        try{ staggerReveal(); if (!prefersReduced) initTilt(); }catch(e){}
                    }
                }
            }
        });
        mo.observe(root, { childList: true, subtree: true });
    }
})();
