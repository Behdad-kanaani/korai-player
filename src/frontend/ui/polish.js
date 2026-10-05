/* KORAI 1.6 renderer polish: accessibility, keyboard navigation and responsive state. */
(() => {
    'use strict';

    const closeQueue = () => {
        const panel = document.getElementById('queuePanel');
        if (panel?.classList.contains('open') && typeof window.toggleQueue === 'function') {
            window.toggleQueue();
        } else if (panel) {
            panel.classList.remove('open');
        }
    };

    const closeDsp = () => {
        const panel = document.getElementById('dspPanel');
        if (panel?.classList.contains('open')) panel.classList.remove('open');
        if (typeof window !== 'undefined') window.isDspOpen = false;
    };

    const closeContext = () => {
        if (typeof window.hidePlaylistContextMenu === 'function') window.hidePlaylistContextMenu();
    };

    const setAccessibleName = (id, label) => {
        const el = document.getElementById(id);
        if (!el || el.getAttribute('aria-label')) return;
        el.setAttribute('aria-label', label);
    };

    const init = () => {
        [
            ['queueBtn', 'Open play queue'],
            ['miniplayerToggleBtn', 'Open mini player'],
            ['dspToggleBtn', 'Open audio controls'],
            ['langToggleBtn', 'Switch language'],
            ['winMinimizeBtn', 'Minimize window'],
            ['winMaximizeBtn', 'Maximize window'],
            ['winCloseBtn', 'Close window']
        ].forEach(([id, label]) => setAccessibleName(id, label));

        const dynamicInteractiveSelector = '.featured-card-premium, .ai-suggestion-card, .recent-item-premium, .stat-card-premium, .mood-chip-premium, .view-all-link-modern';
        const enhanceDynamicInteractive = (root) => {
            if (!root?.querySelectorAll) return;
            root.querySelectorAll(dynamicInteractiveSelector).forEach((el) => {
                if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
                if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
                if (!el.hasAttribute('aria-label')) {
                    const label = el.textContent?.replace(/\s+/g, ' ').trim();
                    if (label) el.setAttribute('aria-label', label.slice(0, 160));
                }
            });
        };

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const target = event.target?.closest?.(dynamicInteractiveSelector);
            if (!target) return;
            event.preventDefault();
            target.click();
        });

        const dynamicContainer = document.getElementById('dynamicSectionContainer');
        enhanceDynamicInteractive(dynamicContainer || document);
        if (dynamicContainer && 'MutationObserver' in window) {
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) enhanceDynamicInteractive(node);
                    }
                }
            });
            observer.observe(dynamicContainer, { childList: true, subtree: true });
        }

        document.querySelectorAll('.nav-item:not(button), .upload-music-trigger').forEach((el) => {
            if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
            el.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                el.click();
            });
        });

        document.addEventListener('keydown', (event) => {
            const key = String(event.key || '').toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === 'k') {
                event.preventDefault();
                const search = document.getElementById('searchInput');
                search?.focus();
                search?.select();
                return;
            }
            if (key === 'escape') { closeQueue(); closeDsp(); closeContext(); }
        });

        const root = document.getElementById('appContainer');
        if (root && 'ResizeObserver' in window) {
            const observer = new ResizeObserver(([entry]) => {
                const width = entry?.contentRect?.width || 0;
                root.dataset.layout = width < 980 ? 'compact' : width < 1180 ? 'comfortable' : 'wide';
            });
            observer.observe(root);
        }

        const title = document.getElementById('titleBarTrackTitle');
        if (title && 'MutationObserver' in window) {
            const observer = new MutationObserver(() => {
                const value = title.textContent?.trim();
                document.title = value ? `${value} — KORAI Player` : 'KORAI Music Player';
            });
            observer.observe(title, { childList: true, characterData: true, subtree: true });
        }

        document.querySelectorAll('[data-tooltip]').forEach((el) => {
            el.addEventListener('focus', () => el.classList.add('tooltip-focus'));
            el.addEventListener('blur', () => el.classList.remove('tooltip-focus'));
        });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
