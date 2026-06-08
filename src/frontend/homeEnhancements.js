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

    document.addEventListener('DOMContentLoaded', ()=>{
        try{
            staggerReveal();
            initMoodChips();
            initPlayOverlays();
            initTilt();
        }catch(err){
            console.warn('homeEnhancements init failed', err);
        }
    });
})();
