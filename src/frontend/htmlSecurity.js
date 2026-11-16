(function attachKoraiHtmlSecurity(root) {
    function escapeHtml(value) {
        if (value === null || value === undefined || value === '') return '';
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return String(value).replace(/[&<>"']/g, character => entities[character]);
    }

    function genreFilterButtonHtml(genre, displayGenre, active) {
        return `<button class="filter-chip${active ? ' active' : ''}" data-genre-filter="${escapeHtml(genre)}">${escapeHtml(displayGenre)}</button>`;
    }

    const api = Object.freeze({ escapeHtml, genreFilterButtonHtml });
    if (root) root.KoraiHtmlSecurity = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
