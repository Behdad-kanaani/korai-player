/**
 * pluginManagerUI.js - KORAI Plugin Manager UI (Bilingual)
 * Supports English & Persian with full sync
 */

class PluginManagerUI {
    constructor(containerId = 'plugin-manager') {
        this.container = document.getElementById(containerId) || document.getElementById('pluginContainer') || document.getElementById('mainContent');
        if (!this.container) {
            return;
        }
        this.plugins = [];
        this.searchQuery = '';
        this.filterStatus = 'all';
        this.installing = false;
        this.apiBase = '';
        this.loadError = null;
        this.currentLang = localStorage.getItem('user_lang') || 'en';
        this.init();
    }

    t(key) {
        const translations = {
            en: {
                totalPlugins: 'Total Plugins',
                activePlugins: 'Active',
                runningPlugins: 'Running',
                searchPlaceholder: 'Search plugins by name or ID...',
                all: 'All',
                enabled: 'Active',
                disabled: 'Inactive',
                install: 'Install Plugin',
                noPlugins: 'No plugins found',
                installHint: 'Install a plugin to extend KORAI\'s capabilities',
                enable: 'Enable',
                disable: 'Disable',
                uninstall: 'Uninstall',
                details: 'Details',
                descriptionMissing: 'No description provided.',
                version: 'v',
                running: 'Running',
                active: 'Active',
                inactive: 'Inactive',
                installSuccess: 'Plugin installed successfully!',
                installFailed: 'Installation failed',
                uninstallConfirm: 'Are you sure you want to uninstall this plugin? This action cannot be undone.',
                uninstallSuccess: 'Plugin uninstalled successfully',
                uninstallFailed: 'Uninstall failed',
                toggleSuccess: 'Plugin status changed',
                toggleFailed: 'Failed to change plugin status',
                permissionMissing: 'Missing permissions',
                loadingFailed: 'Failed to load plugins',
                devKit: 'Developer Kit',
                performance: 'Performance',
                exitToPlayer: 'Exit to Player',
                pluginStudio: 'Plugin Studio',
                pluginSubtitle: 'Extend KORAI with powerful modules and custom integrations'
            },
            fa: {
                totalPlugins: 'کل پلاگین‌ها',
                activePlugins: 'فعال',
                runningPlugins: 'در حال اجرا',
                searchPlaceholder: 'جستجوی پلاگین بر اساس نام یا شناسه...',
                all: 'همه',
                enabled: 'فعال',
                disabled: 'غیرفعال',
                install: 'نصب پلاگین',
                noPlugins: 'هیچ پلاگینی یافت نشد',
                installHint: 'برای افزایش قابلیت‌های KORAI یک پلاگین نصب کنید',
                enable: 'فعال کردن',
                disable: 'غیرفعال کردن',
                uninstall: 'حذف',
                details: 'جزئیات',
                descriptionMissing: 'توضیحی ارائه نشده است.',
                version: 'نسخه',
                running: 'در حال اجرا',
                active: 'فعال',
                inactive: 'غیرفعال',
                installSuccess: 'پلاگین با موفقیت نصب شد!',
                installFailed: 'خطا در نصب پلاگین',
                uninstallConfirm: 'آیا از حذف این پلاگین مطمئن هستید؟ این عمل قابل بازگشت نیست.',
                uninstallSuccess: 'پلاگین با موفقیت حذف شد',
                uninstallFailed: 'خطا در حذف پلاگین',
                toggleSuccess: 'وضعیت پلاگین تغییر کرد',
                toggleFailed: 'خطا در تغییر وضعیت پلاگین',
                permissionMissing: 'مجوزهای مورد نیاز موجود نیست',
                loadingFailed: 'خطا در بارگذاری پلاگین‌ها',
                devKit: 'کیت توسعه',
                performance: 'عملکرد',
                exitToPlayer: 'بازگشت به پلیر',
                pluginStudio: 'استودیوی پلاگین',
                pluginSubtitle: 'قابلیت‌های KORAI را با ماژول‌های قدرتمند گسترش دهید'
            }
        };
        return translations[this.currentLang]?.[key] || translations.en[key] || key;
    }

    async init() {
        this.apiBase = await this.resolveApiBase();
        await this.loadPlugins();
        this.syncLanguage();
        this.injectStyles();
        this.render();
        this.attachEventListeners();
        window.addEventListener('storage', (e) => {
            if (e.key === 'user_lang') {
                this.currentLang = e.newValue || 'en';
                this.syncLanguage();
                this.render();
            }
        });
    }

    syncLanguage() {
        document.documentElement.dir = this.currentLang === 'fa' ? 'rtl' : 'ltr';
        document.body.dir = this.currentLang === 'fa' ? 'rtl' : 'ltr';
        document.body.classList.toggle('rtl', this.currentLang === 'fa');
        document.body.classList.toggle('ltr', this.currentLang !== 'fa');
    }

    async resolveApiBase() {
        if (window.electronAPI && typeof window.electronAPI.getServerPort === 'function') {
            try {
                const port = await window.electronAPI.getServerPort();
                if (port) return `http://localhost:${port}`;
            } catch (e) {
                console.warn('Plugin manager failed to get server port from Electron API:', e);
            }
        }
        if (location.protocol.startsWith('http')) return location.origin;
        for (let p = 3000; p <= 3100; p++) {
            try {
                const res = await fetch(`http://127.0.0.1:${p}/api/plugins`, { method: 'GET' });
                if (res.ok) return `http://127.0.0.1:${p}`;
            } catch (e) {}
        }
        return 'http://localhost:3000';
    }

    injectStyles() {
        if (document.getElementById('pmui-styles')) return;
        const css = `
            .plugin-manager-wrapper { font-family: inherit; color: #e6e6e9; }
            .pm-header { margin-bottom: 12px; }
            .pm-header h1 { font-size: 20px; font-weight:700; margin:0; color: #e6fdf7; }
            .pm-header p { margin:2px 0 0; color: #9aa0a6; font-size:13px }
            .pm-stats { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
            .pm-stat { background: rgba(20,20,26,0.55); border-radius:10px; padding:8px 12px; min-width:90px; }
            .pm-stat .label { font-size:11px; color:#9aa0a6; }
            .pm-stat .value { font-size:18px; font-weight:700; color:#00c19a; }
            .pm-controls { display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
            .pm-search { position:relative; flex:1; max-width:360px; }
            .pm-search input { width:100%; padding:8px 10px 8px 36px; background:rgba(20,20,26,0.55); border:1px solid rgba(255,255,255,0.03); border-radius:22px; color:#e6e6e9; font-size:13px }
            .pm-search .fa-search { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:#8f969b; font-size:14px }
            .filter-chip { padding:6px 14px; border-radius:20px; background:rgba(20,20,26,0.6); color:#9aa0a6; border:none; cursor:pointer; font-weight:600; }
            .filter-chip.active { background:#00c19a; color:#00110a; }
            .primary-btn { background:#00c19a; border:none; padding:10px 18px; border-radius:28px; font-weight:700; color:#00110a; cursor:pointer; }
            .plugin-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:12px; }
            .plugin-card { background:rgba(18,18,22,0.55); border:1px solid rgba(255,255,255,0.02); border-radius:10px; padding:10px; transition:transform .12s ease; }
            .plugin-card:hover { transform:translateY(-2px); }
            .plugin-card .card-head { display:flex; gap:10px; align-items:flex-start; margin-bottom:8px; }
            .plugin-card .icon { width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#0fb07f20,#00ffd520); font-size:16px; }
            .plugin-card .title { font-size:14px; font-weight:700; color:#e6fdf7; }
            .plugin-card .meta { font-size:10px; color:#9aa0a6; margin-top:3px; }
            .plugin-tags { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
            .plugin-desc { font-size:12px; color:#a8afb6; margin-bottom:8px; max-height:3.6em; overflow:hidden; }
            .plugin-actions { display:flex; gap:8px; flex-wrap:wrap; }
            .action-btn { padding:6px 10px; border-radius:16px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid rgba(255,255,255,0.02); background:transparent; color:#c7ced3; }
            .action-btn.primary { background:rgba(0,193,154,0.12); border-color:rgba(0,193,154,0.18); color:#00c19a; }
            .action-btn.danger { background:rgba(255,42,95,0.08); border-color:rgba(255,42,95,0.18); color:#ff738f; }
            .pm-empty { text-align:center; padding:60px 20px; color:#9aa0a6; }
            @keyframes slideIn { from { transform:translateY(8px); opacity:0 } to { transform:translateY(0); opacity:1 } }
            @keyframes pulseGlow { 0% { box-shadow:0 0 0 rgba(0,255,213,0.08);} 50% { box-shadow:0 0 14px rgba(0,255,213,0.06);} 100% { box-shadow:0 0 0 rgba(0,255,213,0.08);} }

            /* Modal / Performance Dashboard */
            .modal-overlay { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.52); z-index:10020; padding:18px; }
            .modal-container { background: linear-gradient(180deg, rgba(18,18,22,0.92), rgba(12,12,16,0.96)); border-radius:12px; padding:14px; width:100%; max-width:700px; max-height:80vh; overflow-y:auto; box-shadow:0 12px 40px rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.03); }
            .modal-header { font-size:16px; font-weight:700; color:#e6fdf7; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.02); margin-bottom:10px; }
            .modal-body { font-size:13px; color:#c7ced3; line-height:1.4; }
            .modal-footer { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
            .modal-container h4 { margin:12px 0 8px; color:#e6fdf7; font-size:14px }
            .modal-stats-row { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
            .modal-stat { background:rgba(255,255,255,0.02); padding:8px 10px; border-radius:8px; color:#c7ced3; font-size:13px; }
            .modal-table { width:100%; border-collapse:collapse; margin-top:6px; }
            .modal-table thead th { text-align:left; padding:8px 6px; color:#9aa0a6; font-weight:700; border-bottom:1px solid rgba(255,255,255,0.03); font-size:12px }
            .modal-table tbody td { padding:8px 6px; color:#c7ced3; border-bottom:1px solid rgba(255,255,255,0.02); font-size:13px }
            .modal-table tbody tr:hover td { background: rgba(255,255,255,0.01); }
            .modal-container .action-btn { margin-left:6px; }
            .modal-container .action-btn#closePerfModal { padding:6px 12px; border-radius:10px; }
            @media (max-width:520px) {
                .modal-container { padding:12px; }
                .modal-header { font-size:15px }
                .modal-table thead th, .modal-table tbody td { font-size:12px }
                .modal-stats-row { gap:8px }
            }
        `;
        const style = document.createElement('style');
        style.id = 'pmui-styles';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
    apiFetch(path, opts = {}) {
        const url = path.startsWith('http') ? path : `${this.apiBase}${path.startsWith('/') ? path : '/' + path}`;
        return fetch(url, opts);
    }

    async loadPlugins() {
        this.loadError = null;
        try {
            const res = await this.apiFetch('/api/plugins');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.plugins = data.plugins || [];
        } catch (err) {
            console.error('Failed to load plugins:', err);
            this.plugins = [];
            this.loadError = err.message;
        }
    }

    getFilteredPlugins() {
        return this.plugins.filter(p => {
            const matchesSearch = p.name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                                 p.id.toLowerCase().includes(this.searchQuery.toLowerCase());
            const matchesFilter = this.filterStatus === 'all' ||
                                 (this.filterStatus === 'enabled' && p.enabled) ||
                                 (this.filterStatus === 'disabled' && !p.enabled);
            return matchesSearch && matchesFilter;
        });
    }

    async togglePlugin(id, enable) {
        const endpoint = enable ? `/api/plugins/${id}/disable` : `/api/plugins/${id}/enable`;
        try {
            const res = await this.apiFetch(endpoint, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                if (err.error === 'missing_permissions') {
                    this.showNotification(this.t('permissionMissing') + ': ' + (err.missing || []).join(', '), 'error');
                } else {
                    throw new Error(err.error || this.t('toggleFailed'));
                }
                return;
            }
            this.showNotification(this.t('toggleSuccess'), 'success');
            await this.loadPlugins();
            this.render();
        } catch (err) {
            this.showNotification(`${this.t('toggleFailed')}: ${err.message}`, 'error');
        }
    }

    async uninstallPlugin(id) {
        if (!confirm(this.t('uninstallConfirm'))) return;
        try {
            const res = await this.apiFetch(`/api/plugins/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Uninstall failed');
            this.showNotification(this.t('uninstallSuccess'), 'success');
            await this.loadPlugins();
            this.render();
        } catch (err) {
            this.showNotification(`${this.t('uninstallFailed')}: ${err.message}`, 'error');
        }
    }

    async installPlugin(file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            this.showNotification('Installing...', 'info');
            const res = await this.apiFetch('/api/plugins/install', { method: 'POST', body: formData });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Installation failed');
            }
            this.showNotification(this.t('installSuccess'), 'success');
            await this.loadPlugins();
            this.render();
        } catch (err) {
            this.showNotification(`${this.t('installFailed')}: ${err.message}`, 'error');
        }
    }

    triggerFileUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = (e) => {
            if (e.target.files && e.target.files[0]) {
                this.installPlugin(e.target.files[0]);
            }
        };
        input.click();
    }

    showNotification(message, type = 'info') {
        const existing = document.querySelector('.plugin-notification');
        if (existing) existing.remove();
        const notif = document.createElement('div');
        notif.className = `plugin-notification plugin-notification-${type}`;
        notif.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; background: #1a1a24; 
            border-left: 4px solid ${type === 'success' ? '#1db954' : type === 'error' ? '#ff2a5f' : '#00ffd5'};
            padding: 12px 20px; border-radius: 12px; z-index: 10000;
            animation: slideIn 0.3s; box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        `;
        notif.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><i class="fa-solid ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i><span>${message}</span></div>`;
        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 3000);
    }

    render() {
        const filtered = this.getFilteredPlugins();
        const stats = {
            total: this.plugins.length,
            active: this.plugins.filter(p => p.enabled).length,
            running: this.plugins.filter(p => p.running).length
        };

        // Ensure styles are present
        this.injectStyles();

        this.container.innerHTML = `
            <div class="plugin-manager-wrapper">
                <div class="pm-header">
                    <h1>${this.t('pluginStudio')}</h1>
                    <p>${this.t('pluginSubtitle')}</p>
                </div>

                <div class="pm-stats">
                    <div class="pm-stat"><div class="label">${this.t('totalPlugins')}</div><div class="value">${stats.total}</div></div>
                    <div class="pm-stat"><div class="label">${this.t('activePlugins')}</div><div class="value">${stats.active}</div></div>
                    <div class="pm-stat"><div class="label">${this.t('runningPlugins')}</div><div class="value">${stats.running}</div></div>
                </div>

                <div class="pm-controls">
                    <div class="pm-search">
                        <i class="fa-solid fa-search"></i>
                        <input type="text" id="pluginSearchInput" placeholder="${this.t('searchPlaceholder')}">
                    </div>
                    <div>
                        <button class="filter-chip ${this.filterStatus === 'all' ? 'active' : ''}" data-filter="all">${this.t('all')}</button>
                        <button class="filter-chip ${this.filterStatus === 'enabled' ? 'active' : ''}" data-filter="enabled">${this.t('enabled')}</button>
                        <button class="filter-chip ${this.filterStatus === 'disabled' ? 'active' : ''}" data-filter="disabled">${this.t('disabled')}</button>
                    </div>
                    <button id="installPluginTrigger" class="primary-btn"><i class="fa-solid fa-cloud-arrow-up"></i>&nbsp; ${this.t('install')}</button>
                </div>

                <div id="pluginGridContainer" class="plugin-grid">
                    ${filtered.length === 0 ? `
                        <div class="pm-empty"><i class="fa-solid fa-puzzle-piece" style="font-size:48px; opacity:0.3; display:block; margin-bottom:10px;"></i><h3>${this.t('noPlugins')}</h3><p>${this.t('installHint')}</p></div>
                    ` : filtered.map(p => `
                        <div class="plugin-card">
                            <div class="card-head">
                                <div class="icon"><i class="fa-solid fa-plug"></i></div>
                                <div style="flex:1;">
                                    <div class="title">${this.escapeHtml(p.name)}</div>
                                    <div class="meta">${this.t('version')} ${p.version} &nbsp; <span style="opacity:0.6;">${this.escapeHtml(p.id)}</span></div>
                                </div>
                            </div>
                            <div class="plugin-tags">
                                <span style="padding:4px 10px; border-radius:16px; font-size:11px; font-weight:600; background:${p.enabled ? 'rgba(29,185,84,0.12)' : 'rgba(255,255,255,0.02)'}; color:${p.enabled ? '#1db954' : '#9aa0a6'}; border:1px solid ${p.enabled ? 'rgba(29,185,84,0.18)' : 'rgba(255,255,255,0.02)'};">${p.enabled ? this.t('active') : this.t('inactive')}</span>
                                ${p.running ? `<span style="padding:4px 10px; border-radius:16px; font-size:11px; font-weight:600; background:rgba(0,255,213,0.06); color:#00ffd5;"><i class="fa-solid fa-bolt" style="margin-right:4px;"></i>${this.t('running')}</span>` : ''}
                                ${p.builtin ? `<span title="Built-in plugin" style="padding:4px 10px; border-radius:16px; font-size:11px; font-weight:700; background:linear-gradient(90deg,#ffd966,#ffb84d); color:#2b1500; border:1px solid rgba(0,0,0,0.08);"><i class="fa-solid fa-star" style="margin-right:4px;"></i>${this.currentLang === 'fa' ? 'پیشفرض' : 'Built-in'}</span>` : ''}
                            </div>
                            <div class="plugin-desc">${this.escapeHtml(p.description || this.t('descriptionMissing'))}</div>
                            <div class="plugin-actions">
                                <button class="action-btn primary plugin-toggle-btn" data-id="${p.id}" data-enabled="${p.enabled}"><i class="fa-solid ${p.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>&nbsp; ${p.enabled ? this.t('disable') : this.t('enable')}</button>
                                <button class="action-btn plugin-details-btn" data-id="${p.id}"><i class="fa-solid fa-info-circle"></i>&nbsp; ${this.t('details')}</button>
                                <button class="action-btn danger plugin-uninstall-btn" data-id="${p.id}" data-builtin="${p.builtin ? '1' : '0'}" ${p.builtin ? 'disabled title="Cannot uninstall builtin plugin"' : ''}><i class="fa-solid fa-trash"></i>&nbsp; ${this.t('uninstall')}</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    attachEventListeners() {
        // Use event delegation to avoid reattaching handlers on every render
        const container = this.container;
        const searchInput = document.getElementById('pluginSearchInput');
        if (searchInput) {
            searchInput.value = this.searchQuery;
            searchInput.removeAttribute('data-listener');
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value;
                this.render();
            });
        }

        if (container && !container._pmuiDelegated) {
            container.addEventListener('click', async (e) => {
                const btn = e.target.closest && e.target.closest('button');
                if (!btn) return;
                if (btn.classList.contains('filter-chip')) {
                    this.filterStatus = btn.dataset.filter;
                    this.render();
                    return;
                }
                if (btn.id === 'installPluginTrigger') {
                    this.triggerFileUpload();
                    return;
                }
                if (btn.classList.contains('plugin-toggle-btn')) {
                    const id = btn.dataset.id;
                    const enabled = btn.dataset.enabled === 'true';
                    await this.togglePlugin(id, enabled);
                    return;
                }
                if (btn.classList.contains('plugin-uninstall-btn')) {
                    const id = btn.dataset.id;
                    const isBuiltin = btn.dataset.builtin === '1' || btn.dataset.builtin === 'true';
                    if (isBuiltin) {
                        this.showNotification(this.currentLang === 'fa' ? 'این پلاگین پیشفرض است و نمی‌توان آن را حذف کرد' : 'This plugin is built-in and cannot be uninstalled', 'error');
                        return;
                    }
                    await this.uninstallPlugin(id);
                    return;
                }
                if (btn.classList.contains('plugin-details-btn')) {
                    const id = btn.dataset.id;
                    const plugin = this.plugins.find(p => p.id === id);
                    if (plugin) {
                        alert(`Name: ${plugin.name}\nID: ${plugin.id}\nVersion: ${plugin.version}\nPath: ${plugin.path || 'N/A'}`);
                    }
                    return;
                }
            });
            container._pmuiDelegated = true;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/[&<>]/g, m => {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
}

const initTarget = document.getElementById('plugin-manager') || document.getElementById('pluginContainer');
if (initTarget) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.pluginUI = new PluginManagerUI('plugin-manager');
        });
    } else {
        window.pluginUI = new PluginManagerUI('plugin-manager');
    }
}
