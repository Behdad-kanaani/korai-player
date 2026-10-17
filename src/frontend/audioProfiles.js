/*
 * KORAI sound profiles: built-in presets, user profiles, import/export and
 * automatic switching when the output device changes.
 * Pure logic lives here; the DOM lives in audioProfilesUI.js.
 */
(function exposeKoraiAudioProfiles(root, factory) {
    const lib = (root && root.KoraiAudioEngine) || (typeof require === 'function' ? require('./audioEngine.js') : null);
    const api = factory(lib);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KoraiAudioProfiles = api;
})(typeof window !== 'undefined' ? window : globalThis, function createKoraiAudioProfiles(lib) {
    'use strict';

    const { sanitizeSettings, settingsEqual } = lib;
    const STORE_KEY = 'audioProfiles';
    const EXPORT_FORMAT = 'korai-audio-profile';
    const MAX_CUSTOM_PROFILES = 50;
    const MAX_NAME_LENGTH = 40;
    const DEFAULT_ID = 'flat';

    const BUILTIN_PROFILES = [
        { id: 'flat', icon: 'fa-wave-square', name: { en: 'Reference', fa: 'مرجع (خنثی)' }, settings: {} },
        { id: 'bass', icon: 'fa-drum', name: { en: 'Bass Boost', fa: 'تقویت باس' },
          settings: { eq: [4, 2, 0, 0, 1], bassDb: 3, preampDb: -3, warmth: 0.15 } },
        { id: 'headphones', icon: 'fa-headphones', name: { en: 'Headphone Comfort', fa: 'راحتی هدفون' },
          settings: { crossfeed: 0.45, trebleDb: -1, preampDb: -1, eq: [1, 0, 0, -1, 0] } },
        { id: 'speakers', icon: 'fa-volume-high', name: { en: 'Room Speakers', fa: 'اسپیکر اتاق' },
          settings: { lowCutHz: 35, width: 1.25, bassDb: 2, eq: [0, 0, 0, 1, 1] } },
        { id: 'night', icon: 'fa-moon', name: { en: 'Night Mode', fa: 'حالت شب' },
          settings: { compAmount: 0.75, bassDb: -3, trebleDb: -1, lowCutHz: 40, preampDb: 1 } },
        { id: 'vocal', icon: 'fa-microphone-lines', name: { en: 'Vocal Clarity', fa: 'وضوح صدای خواننده' },
          settings: { eq: [-2, 0, 2, 3, 1], trebleDb: 1.5, lowCutHz: 70, compAmount: 0.25 } },
        { id: 'hall', icon: 'fa-landmark', name: { en: 'Concert Hall', fa: 'سالن کنسرت' },
          settings: { reverbMix: 0.28, reverbDecay: 2.8, reverbDamping: 0.45, width: 1.1, compAmount: 0.1, preampDb: -1 } },
        { id: 'vinyl', icon: 'fa-record-vinyl', name: { en: 'Vinyl Warmth', fa: 'گرمای وینیل' },
          settings: { warmth: 0.55, trebleDb: -2.5, bassDb: 2, width: 0.85, eq: [1, 1, 0, -1, -2] } },
        { id: 'wide', icon: 'fa-expand', name: { en: 'Ultra Wide', fa: 'استریوی فوق‌عریض' },
          settings: { width: 1.7, reverbMix: 0.08, reverbDecay: 0.8, trebleDb: 1, preampDb: -2 } },
        { id: 'punch', icon: 'fa-bolt', name: { en: 'Loud & Punchy', fa: 'پرقدرت و پرانرژی' },
          settings: { compAmount: 0.55, preampDb: 2, bassDb: 2, trebleDb: 2, warmth: 0.1 } },
        { id: 'mono', icon: 'fa-circle-dot', name: { en: 'Mono Focus', fa: 'تک‌کاناله (مونو)' },
          settings: { mono: true, lowCutHz: 80, compAmount: 0.5, eq: [-3, 0, 2, 2, -1] } }
    ].map(profile => ({ ...profile, builtin: true, settings: sanitizeSettings(profile.settings) }));

    function cleanName(value, fallback = 'Profile') {
        const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
        return (text || fallback).slice(0, MAX_NAME_LENGTH);
    }

    function cleanIcon(value) {
        return /^fa-[a-z0-9-]{2,40}$/.test(String(value || '')) ? String(value) : 'fa-sliders';
    }

    function newId() {
        return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    }

    function normalizeState(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const custom = (Array.isArray(source.custom) ? source.custom : [])
            .slice(0, MAX_CUSTOM_PROFILES)
            .filter(p => p && typeof p === 'object')
            .map(p => ({
                id: /^u_[a-z0-9]+$/.test(String(p.id)) ? String(p.id) : newId(),
                name: cleanName(p.name),
                icon: cleanIcon(p.icon),
                builtin: false,
                settings: sanitizeSettings(p.settings)
            }));
        const deviceMap = {};
        if (source.deviceMap && typeof source.deviceMap === 'object') {
            for (const [deviceId, entry] of Object.entries(source.deviceMap).slice(0, 100)) {
                if (!entry || typeof entry !== 'object' || typeof entry.profileId !== 'string') continue;
                deviceMap[String(deviceId).slice(0, 200)] = {
                    profileId: entry.profileId,
                    label: cleanName(entry.label, '')
                };
            }
        }
        return {
            version: 1,
            activeId: typeof source.activeId === 'string' ? source.activeId : DEFAULT_ID,
            custom,
            live: source.live ? sanitizeSettings(source.live) : null,
            deviceMap,
            autoSwitch: source.autoSwitch !== false,
            outputDeviceId: typeof source.outputDeviceId === 'string' ? source.outputDeviceId : 'default'
        };
    }

    class ProfileManager {
        constructor({ engine, storage, applyEq }) {
            this.engine = engine;
            this.storage = storage || { load: () => null, save: () => {} };
            this.applyEq = typeof applyEq === 'function' ? applyEq : () => {};
            this.state = normalizeState(null);
            this.listeners = new Set();
            this._saveTimer = null;
            this._currentDeviceId = 'default';
            if (!this.get(this.state.activeId)) this.state.activeId = DEFAULT_ID;
            this.live = this.get(this.state.activeId).settings;
        }

        // ---- lifecycle -----------------------------------------------------------
        load() {
            this.state = normalizeState(this.storage.load());
            if (!this.get(this.state.activeId)) this.state.activeId = DEFAULT_ID;
            this.live = sanitizeSettings(this.state.live || this.get(this.state.activeId).settings);
            this.engine.setSettings(this.live, 'load');
            this.applyEq(this.live.eq, { persist: false });
            this._emit('load');
        }

        subscribe(callback) {
            this.listeners.add(callback);
            return () => this.listeners.delete(callback);
        }

        _emit(reason) {
            for (const callback of this.listeners) {
                try { callback(reason); } catch (error) { console.debug('Profile listener failed', error); }
            }
        }

        _persist(immediate = false) {
            const write = () => {
                this._saveTimer = null;
                this.state.live = sanitizeSettings(this.live);
                try { this.storage.save(JSON.parse(JSON.stringify(this.state))); } catch (error) {
                    console.warn('Could not save audio profiles:', error);
                }
            };
            clearTimeout(this._saveTimer);
            if (immediate) write(); else this._saveTimer = setTimeout(write, 400);
        }

        // ---- queries -------------------------------------------------------------
        all() { return [...BUILTIN_PROFILES, ...this.state.custom]; }
        get(id) { return this.all().find(profile => profile.id === id) || null; }
        get activeId() { return this.state.activeId; }
        get active() { return this.get(this.state.activeId) || BUILTIN_PROFILES[0]; }
        get isDirty() { return !settingsEqual(this.live, this.active.settings); }
        get autoSwitch() { return this.state.autoSwitch; }
        get outputDeviceId() { return this.state.outputDeviceId; }
        get deviceMap() { return { ...this.state.deviceMap }; }

        // ---- activation / editing --------------------------------------------------
        activate(id, { auto = false } = {}) {
            const profile = this.get(id);
            if (!profile) return false;
            this.state.activeId = profile.id;
            this.live = sanitizeSettings(profile.settings);
            this.engine.setSettings(this.live, auto ? 'auto-profile' : 'profile');
            this.applyEq(this.live.eq, { persist: true });
            this._persist(true);
            this._emit(auto ? 'auto-profile' : 'profile');
            return true;
        }

        setParam(key, value) {
            if (!this.engine.setParam(key, value)) return false;
            this.live = sanitizeSettings({ ...this.live, [key]: this.engine.settings[key] });
            this._persist();
            this._emit('param');
            return true;
        }

        // Called when the existing 5-band equalizer changes (slider or settings sync).
        noteEqChange(values) {
            const next = sanitizeSettings({ ...this.live, eq: values });
            if (settingsEqual(next, this.live)) return;
            this.live = next;
            this.engine.settings = sanitizeSettings({ ...this.engine.settings, eq: next.eq });
            this._persist();
            this._emit('eq');
        }

        // ---- user profiles ---------------------------------------------------------
        saveAsNew(name, icon) {
            if (this.state.custom.length >= MAX_CUSTOM_PROFILES) return null;
            const profile = {
                id: newId(),
                name: cleanName(name, 'My profile'),
                icon: cleanIcon(icon),
                builtin: false,
                settings: sanitizeSettings(this.live)
            };
            this.state.custom.push(profile);
            this.state.activeId = profile.id;
            this._persist(true);
            this._emit('profiles');
            return profile;
        }

        saveActive() {
            const profile = this.state.custom.find(p => p.id === this.state.activeId);
            if (!profile) return false; // built-ins are read-only: use saveAsNew
            profile.settings = sanitizeSettings(this.live);
            this._persist(true);
            this._emit('profiles');
            return true;
        }

        revert() {
            return this.activate(this.state.activeId);
        }

        rename(id, name) {
            const profile = this.state.custom.find(p => p.id === id);
            if (!profile) return false;
            profile.name = cleanName(name, profile.name);
            this._persist(true);
            this._emit('profiles');
            return true;
        }

        duplicate(id) {
            const source = this.get(id);
            if (!source || this.state.custom.length >= MAX_CUSTOM_PROFILES) return null;
            const copy = {
                id: newId(),
                name: cleanName(`${source.builtin ? source.name.en : source.name} copy`),
                icon: source.icon,
                builtin: false,
                settings: sanitizeSettings(source.settings)
            };
            this.state.custom.push(copy);
            this._persist(true);
            this._emit('profiles');
            return copy;
        }

        remove(id) {
            const index = this.state.custom.findIndex(p => p.id === id);
            if (index < 0) return false;
            this.state.custom.splice(index, 1);
            for (const [deviceId, entry] of Object.entries(this.state.deviceMap)) {
                if (entry.profileId === id) delete this.state.deviceMap[deviceId];
            }
            if (this.state.activeId === id) this.activate(DEFAULT_ID);
            else { this._persist(true); this._emit('profiles'); }
            return true;
        }

        // ---- sharing ---------------------------------------------------------------
        exportProfile(id) {
            const profile = this.get(id);
            if (!profile) return null;
            return {
                format: EXPORT_FORMAT,
                version: 1,
                name: profile.builtin ? profile.name.en : profile.name,
                icon: profile.icon,
                settings: sanitizeSettings(id === this.state.activeId ? this.live : profile.settings)
            };
        }

        exportAllCustom() {
            return {
                format: `${EXPORT_FORMAT}-pack`,
                version: 1,
                profiles: this.state.custom.map(p => ({ name: p.name, icon: p.icon, settings: p.settings }))
            };
        }

        importProfiles(data) {
            let entries = [];
            if (data && data.format === EXPORT_FORMAT) entries = [data];
            else if (data && data.format === `${EXPORT_FORMAT}-pack` && Array.isArray(data.profiles)) entries = data.profiles;
            else throw new Error('Not a KORAI audio profile file');
            const imported = [];
            for (const entry of entries) {
                if (this.state.custom.length >= MAX_CUSTOM_PROFILES) break;
                if (!entry || typeof entry !== 'object') continue;
                const profile = {
                    id: newId(),
                    name: cleanName(entry.name, 'Imported profile'),
                    icon: cleanIcon(entry.icon),
                    builtin: false,
                    settings: sanitizeSettings(entry.settings)
                };
                this.state.custom.push(profile);
                imported.push(profile);
            }
            if (imported.length) { this._persist(true); this._emit('profiles'); }
            return imported;
        }

        // ---- output devices --------------------------------------------------------
        setAutoSwitch(enabled) {
            this.state.autoSwitch = Boolean(enabled);
            this._persist(true);
            this._emit('device-settings');
        }

        bindDevice(deviceId, label, profileId) {
            if (!deviceId) return false;
            if (!profileId) delete this.state.deviceMap[deviceId];
            else if (this.get(profileId)) this.state.deviceMap[deviceId] = { profileId, label: cleanName(label, '') };
            else return false;
            this._persist(true);
            this._emit('device-settings');
            return true;
        }

        boundProfileFor(deviceId) {
            const entry = this.state.deviceMap[deviceId];
            return entry && this.get(entry.profileId) ? entry.profileId : null;
        }

        async selectOutputDevice(deviceId) {
            const id = deviceId || 'default';
            const ok = await this.engine.setOutputDevice(id);
            if (ok) {
                this.state.outputDeviceId = id;
                this._persist(true);
                this.handleDeviceChanged(id);
                this._emit('device-settings');
            }
            return ok;
        }

        // Called whenever the effective output device is (re)detected.
        handleDeviceChanged(deviceId) {
            this._currentDeviceId = deviceId || 'default';
            if (!this.state.autoSwitch) return false;
            const bound = this.boundProfileFor(this._currentDeviceId);
            if (bound && bound !== this.state.activeId) return this.activate(bound, { auto: true });
            return false;
        }

        get currentDeviceId() { return this._currentDeviceId; }
    }

    return {
        STORE_KEY, EXPORT_FORMAT, MAX_CUSTOM_PROFILES, DEFAULT_ID, BUILTIN_PROFILES,
        cleanName, cleanIcon, normalizeState, ProfileManager
    };
});
