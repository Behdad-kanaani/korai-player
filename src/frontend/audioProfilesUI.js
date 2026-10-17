/* Sound Profiles panel inside the DSP drawer. */
(() => {
    'use strict';

    if (new URLSearchParams(window.location.search).get('mode') === 'mini') return;
    const lib = window.KoraiAudioEngine;
    const profilesLib = window.KoraiAudioProfiles;
    if (!lib || !profilesLib) return;

    const engine = lib.engine;
    const { PARAMS } = lib;

    // ------------------------------------------------------------------ strings
    const STR = {
        en: {
            kicker: 'SOUND PROFILES', title: 'Profiles & effects', bypass: 'Compare with original sound',
            modified: 'Modified', save: 'Save changes', saveAs: 'Save as new profile', revert: 'Undo changes',
            rename: 'Rename', duplicate: 'Duplicate', remove: 'Delete', removeConfirm: 'Click again to delete',
            exportOne: 'Export profile', importFile: 'Import profile', name: 'Profile name', create: 'Create',
            cancel: 'Cancel', output: 'Output device', systemDefault: 'System default', outputN: 'Output',
            autoSwitch: 'Switch profile automatically per device', useHere: 'Use this profile with this device',
            useHereDesc: 'Activates automatically whenever this output is selected',
            showNames: 'Show device names', namesDenied: 'Could not read device names',
            deviceFailed: 'Could not switch to that output device', deviceOk: 'Output device changed',
            level: 'Level', reduction: 'Reduction', curve: 'Tone response',
            tone: 'Tone', space: 'Space & stereo', reverb: 'Reverb', dynamics: 'Dynamics',
            preampDb: 'Preamp', lowCutHz: 'Low cut', bassDb: 'Bass', trebleDb: 'Treble', warmth: 'Analog warmth',
            width: 'Stereo width', crossfeed: 'Headphone crossfeed', balance: 'Balance',
            reverbMix: 'Reverb amount', reverbDecay: 'Room size', reverbDamping: 'Damping',
            compAmount: 'Compressor', mono: 'Mono output', limiter: 'Safety limiter',
            monoDesc: 'Sums both channels into one', limiterDesc: 'Prevents clipping when boosting',
            off: 'Off', saved: 'Profile saved', created: 'Profile created', deleted: 'Profile deleted',
            imported: 'Imported {n} profile(s)', importFailed: 'That file is not a valid KORAI profile',
            limitReached: 'Profile limit reached', autoApplied: 'Profile switched: {name}',
            center: 'C', left: 'L', right: 'R', eqNote: 'Equalizer bands are part of every profile.'
        },
        fa: {
            kicker: 'پروفایل‌های صدا', title: 'پروفایل و افکت‌ها', bypass: 'مقایسه با صدای اصلی',
            modified: 'ویرایش‌شده', save: 'ذخیره تغییرات', saveAs: 'ذخیره به‌عنوان پروفایل جدید', revert: 'لغو تغییرات',
            rename: 'تغییر نام', duplicate: 'کپی', remove: 'حذف', removeConfirm: 'برای حذف دوباره کلیک کنید',
            exportOne: 'خروجی گرفتن از پروفایل', importFile: 'وارد کردن پروفایل', name: 'نام پروفایل', create: 'ساخت',
            cancel: 'انصراف', output: 'دستگاه خروجی', systemDefault: 'پیش‌فرض سیستم', outputN: 'خروجی',
            autoSwitch: 'تعویض خودکار پروفایل بر اساس دستگاه', useHere: 'استفاده از این پروفایل برای این دستگاه',
            useHereDesc: 'با انتخاب این خروجی، خودکار فعال می‌شود',
            showNames: 'نمایش نام دستگاه‌ها', namesDenied: 'خواندن نام دستگاه‌ها ممکن نشد',
            deviceFailed: 'تغییر به این دستگاه خروجی ممکن نشد', deviceOk: 'دستگاه خروجی تغییر کرد',
            level: 'سطح', reduction: 'کاهش', curve: 'پاسخ فرکانسی',
            tone: 'تُن صدا', space: 'فضا و استریو', reverb: 'ریورب', dynamics: 'دینامیک',
            preampDb: 'پری‌امپ', lowCutHz: 'حذف فرکانس‌های پایین', bassDb: 'باس', trebleDb: 'ترِبل', warmth: 'گرمای آنالوگ',
            width: 'عرض استریو', crossfeed: 'کراس‌فید هدفون', balance: 'بالانس',
            reverbMix: 'میزان ریورب', reverbDecay: 'اندازه اتاق', reverbDamping: 'میرایی',
            compAmount: 'کمپرسور', mono: 'خروجی مونو', limiter: 'محافظ حداکثر صدا',
            monoDesc: 'ترکیب دو کانال در یک کانال', limiterDesc: 'جلوگیری از اعوجاج هنگام تقویت',
            off: 'خاموش', saved: 'پروفایل ذخیره شد', created: 'پروفایل ساخته شد', deleted: 'پروفایل حذف شد',
            imported: '{n} پروفایل وارد شد', importFailed: 'این فایل یک پروفایل معتبر KORAI نیست',
            limitReached: 'به سقف تعداد پروفایل‌ها رسیدید', autoApplied: 'پروفایل تغییر کرد: {name}',
            center: 'وسط', left: 'چپ', right: 'راست', eqNote: 'باندهای اکولایزر بخشی از هر پروفایل هستند.'
        }
    };
    const lang = () => String(document.documentElement.lang || localStorage.getItem('user_lang') || 'en').startsWith('fa') ? 'fa' : 'en';
    const L = (key, vars) => {
        let text = (STR[lang()] && STR[lang()][key]) || STR.en[key] || key;
        if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
        return text;
    };
    const profileName = profile => profile.builtin ? (profile.name[lang()] || profile.name.en) : profile.name;
    const notify = (message, type = 'info') => { try { window.showNotification?.(message, type); } catch (_) { /* optional */ } };

    // ------------------------------------------------------------------ DOM helper
    function h(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key === 'text') el.textContent = value;
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
            else el.setAttribute(key, value === true ? '' : String(value));
        }
        for (const child of children.flat()) {
            if (child === null || child === undefined || child === false) continue;
            el.append(child.nodeType ? child : document.createTextNode(String(child)));
        }
        return el;
    }
    const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });

    // ------------------------------------------------------------------ wiring
    const storage = {
        load: () => window.settingsStore?.get?.(profilesLib.STORE_KEY, null) ?? null,
        save: value => { window.settingsStore?.set?.(profilesLib.STORE_KEY, value); }
    };

    function applyEq(values, { persist }) {
        const next = lib.sanitizeSettings({ eq: values }).eq;
        next.forEach((value, index) => {
            const slider = document.getElementById(`eqSlider${index}`);
            if (slider) slider.value = String(value);
            if (typeof window.updateEqualizerBand === 'function') window.updateEqualizerBand(index, value);
        });
        if (persist) window.settingsStore?.set?.('eq', [...next]);
    }

    const manager = new profilesLib.ProfileManager({ engine, storage, applyEq });
    window.koraiSoundProfiles = manager;

    // ------------------------------------------------------------------ parameter UI
    const GROUPS = [
        { id: 'tone', icon: 'fa-sliders', params: ['preampDb', 'lowCutHz', 'bassDb', 'trebleDb', 'warmth'] },
        { id: 'space', icon: 'fa-expand', params: ['width', 'crossfeed', 'balance'], switches: ['mono'] },
        { id: 'reverb', icon: 'fa-landmark', params: ['reverbMix', 'reverbDecay', 'reverbDamping'] },
        { id: 'dynamics', icon: 'fa-bolt', params: ['compAmount'], switches: ['limiter'] }
    ];
    const SWITCH_ICONS = { mono: 'fa-circle-dot', limiter: 'fa-shield-halved' };

    function formatValue(key, value) {
        if (key === 'lowCutHz') return value <= 0 ? L('off') : `${Math.round(value)} Hz`;
        if (key === 'reverbDecay') return `${value.toFixed(1)} s`;
        if (key === 'balance') return Math.abs(value) < 0.025 ? L('center') : `${value < 0 ? L('left') : L('right')} ${Math.round(Math.abs(value) * 100)}`;
        if (PARAMS[key].unit === 'dB') return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
        if (PARAMS[key].unit === '%') return value <= 0 && key !== 'width' ? L('off') : `${Math.round(value * 100)}%`;
        return String(value);
    }

    function paintSlider(input) {
        const min = Number(input.min); const max = Number(input.max);
        const p = ((Number(input.value) - min) / (max - min)) * 100;
        const from = min < 0 ? Math.min(50, p) : 0;
        const to = min < 0 ? Math.max(50, p) : p;
        input.style.setProperty('--sp-from', `${from}%`);
        input.style.setProperty('--sp-to', `${to}%`);
    }

    // ------------------------------------------------------------------ state shared by renderers
    const ui = {
        root: null, chips: null, actions: {}, nameBar: null, nameInput: null, nameMode: null, pickedIcon: 'fa-sliders',
        sliders: new Map(), switches: new Map(), bypassBtn: null, modifiedBadge: null,
        meterLevel: null, meterReduction: null, meterLevelText: null, canvas: null,
        deviceSelect: null, deviceBind: null, autoSwitch: null, namesBtn: null,
        devices: [], deleteArmedUntil: 0, meterTimer: null, curveFrame: 0
    };

    const ICON_CHOICES = ['fa-sliders', 'fa-star', 'fa-heart', 'fa-fire', 'fa-music', 'fa-headphones', 'fa-car', 'fa-couch', 'fa-gamepad', 'fa-moon'];

    function buildSliderRow(key) {
        const def = PARAMS[key];
        const valueEl = h('strong', { text: formatValue(key, def.def) });
        const input = h('input', {
            type: 'range', class: 'dsp-slider-track sp-slider', min: def.min, max: def.max, step: def.step,
            value: def.def, 'aria-label': L(key)
        });
        input.addEventListener('input', () => {
            manager.setParam(key, Number(input.value));
            valueEl.textContent = formatValue(key, Number(input.value));
            paintSlider(input);
        });
        input.addEventListener('dblclick', () => {
            input.value = String(def.def);
            input.dispatchEvent(new Event('input'));
        });
        ui.sliders.set(key, { input, valueEl });
        return h('label', { class: 'sp-row' }, h('span', { class: 'sp-row-head' }, h('span', { text: L(key) }), valueEl), input);
    }

    function buildSwitchRow(key) {
        const input = h('input', { type: 'checkbox', id: `spSwitch_${key}` });
        input.addEventListener('change', () => manager.setParam(key, input.checked));
        ui.switches.set(key, input);
        return h('div', { class: 'dsp-toggle-row sp-switch-row' },
            h('div', { class: 'dsp-toggle-copy' }, icon(SWITCH_ICONS[key]), h('div', {}, h('strong', { text: L(key) }), h('span', { text: L(`${key}Desc`) }))),
            h('label', { class: 'switch', 'aria-label': L(key) }, input, h('span', { class: 'switch-slider' })));
    }

    function buildGroup(group, open) {
        const rows = [
            ...group.params.map(buildSliderRow),
            ...(group.switches || []).map(buildSwitchRow)
        ];
        return h('details', { class: 'sp-group', open: open ? true : null },
            h('summary', {}, icon(group.icon), h('span', { text: L(group.id) }), icon('fa-chevron-down sp-chevron')),
            h('div', { class: 'sp-group-body' }, rows));
    }

    function buildChips() {
        ui.chips.replaceChildren(...manager.all().map(profile => {
            const active = profile.id === manager.activeId;
            const chip = h('button', {
                type: 'button', class: `sp-chip${active ? ' is-active' : ''}${profile.builtin ? '' : ' is-custom'}`,
                'aria-pressed': active ? 'true' : 'false', title: profileName(profile)
            }, icon(profile.icon), h('span', { text: profileName(profile) }),
            active && manager.isDirty ? h('em', { class: 'sp-dot', title: L('modified') }) : null);
            chip.addEventListener('click', () => manager.activate(profile.id));
            return chip;
        }));
        const activeChip = ui.chips.querySelector('.is-active');
        if (activeChip?.scrollIntoView) activeChip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function updateDirtyDot() {
        const chip = ui.chips.querySelector('.is-active');
        if (!chip) return;
        const dot = chip.querySelector('.sp-dot');
        if (manager.isDirty && !dot) chip.append(h('em', { class: 'sp-dot', title: L('modified') }));
        else if (!manager.isDirty && dot) dot.remove();
    }

    function action(id, iconName, labelKey, handler) {
        const button = h('button', { type: 'button', class: 'sp-icon-btn', title: L(labelKey), 'aria-label': L(labelKey) }, icon(iconName));
        button.addEventListener('click', handler);
        ui.actions[id] = button;
        return button;
    }

    function openNameBar(mode) {
        ui.nameMode = mode;
        const active = manager.active;
        ui.nameInput.value = mode === 'rename' ? active.name : '';
        ui.pickedIcon = mode === 'rename' ? active.icon : 'fa-sliders';
        ui.nameBar.hidden = false;
        ui.nameBar.classList.toggle('is-rename', mode === 'rename');
        renderIconPicker();
        ui.nameInput.focus();
    }

    function closeNameBar() { ui.nameBar.hidden = true; ui.nameMode = null; }

    function renderIconPicker() {
        ui.iconPicker.replaceChildren(...ICON_CHOICES.map(name => {
            const button = h('button', { type: 'button', class: `sp-icon-choice${name === ui.pickedIcon ? ' is-picked' : ''}`, 'aria-label': name }, icon(name));
            button.addEventListener('click', () => { ui.pickedIcon = name; renderIconPicker(); });
            return button;
        }));
    }

    function submitNameBar() {
        const name = ui.nameInput.value;
        if (ui.nameMode === 'rename') {
            manager.rename(manager.activeId, name);
        } else {
            const created = manager.saveAsNew(name, ui.pickedIcon);
            if (!created) { notify(L('limitReached'), 'warning'); return; }
            notify(L('created'), 'success');
        }
        closeNameBar();
    }

    function downloadJson(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = h('a', { href: url, download: filename });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    }

    async function importFile(file) {
        if (!file) return;
        try {
            if (file.size > 256 * 1024) throw new Error('too large');
            const imported = manager.importProfiles(JSON.parse(await file.text()));
            if (imported.length) manager.activate(imported[0].id);
            notify(L('imported', { n: imported.length }), 'success');
        } catch (_) {
            notify(L('importFailed'), 'error');
        }
    }

    // ------------------------------------------------------------------ devices
    async function listOutputs() {
        try {
            const all = await navigator.mediaDevices.enumerateDevices();
            return all.filter(d => d.kind === 'audiooutput');
        } catch (_) { return []; }
    }

    function resolveCurrentDevice(outputs) {
        const chosen = manager.outputDeviceId;
        if (chosen && chosen !== 'default') return { id: chosen, device: outputs.find(d => d.deviceId === chosen) || null };
        const systemDefault = outputs.find(d => d.deviceId === 'default');
        const real = systemDefault && outputs.find(d => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.groupId && d.groupId === systemDefault.groupId);
        return real ? { id: real.deviceId, device: real } : { id: 'default', device: systemDefault || null };
    }

    function deviceLabel(device, index) {
        if (device && device.label) return device.label.replace(/^Default - /i, '');
        return `${L('outputN')} ${index + 1}`;
    }

    async function refreshDevices(triggerAutoSwitch) {
        ui.devices = (await listOutputs()).filter(d => d.deviceId !== 'communications');
        const real = ui.devices.filter(d => d.deviceId !== 'default');
        if (ui.deviceSelect) {
            const options = [h('option', { value: 'default', text: L('systemDefault') })];
            real.forEach((device, index) => options.push(h('option', { value: device.deviceId, text: deviceLabel(device, index) })));
            ui.deviceSelect.replaceChildren(...options);
            const wanted = manager.outputDeviceId;
            ui.deviceSelect.value = real.some(d => d.deviceId === wanted) ? wanted : 'default';
        }
        const hasLabels = real.some(d => d.label);
        if (ui.namesBtn) ui.namesBtn.hidden = hasLabels || real.length === 0;
        const current = resolveCurrentDevice(ui.devices);
        if (triggerAutoSwitch) manager.handleDeviceChanged(current.id);
        renderDeviceBind();
    }

    function renderDeviceBind() {
        if (!ui.deviceBind) return;
        const current = resolveCurrentDevice(ui.devices);
        const bound = manager.boundProfileFor(current.id);
        ui.deviceBind.checked = Boolean(bound) && bound === manager.activeId;
        ui.deviceBind.disabled = false;
        ui.autoSwitch.checked = manager.autoSwitch;
    }

    async function revealDeviceNames() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            await refreshDevices(false);
        } catch (_) { notify(L('namesDenied'), 'warning'); }
    }

    // ------------------------------------------------------------------ meter & curve
    function startMeter() {
        if (ui.meterTimer) return;
        ui.meterTimer = setInterval(() => {
            const { peakDb, reductionDb } = engine.readMeter();
            const level = Number.isFinite(peakDb) ? Math.max(0, Math.min(1, (peakDb + 60) / 60)) : 0;
            ui.meterLevel.style.transform = `scaleX(${level})`;
            ui.meterLevel.classList.toggle('is-hot', peakDb > -1);
            ui.meterLevelText.textContent = Number.isFinite(peakDb) ? `${peakDb.toFixed(0)} dB` : '−∞';
            ui.meterReduction.style.transform = `scaleX(${Math.min(1, reductionDb / 12)})`;
        }, 90);
    }

    function stopMeter() { clearInterval(ui.meterTimer); ui.meterTimer = null; }

    let offlineContext = null;
    function responseDb(settings, frequencies) {
        try {
            offlineContext = offlineContext || new OfflineAudioContext(1, 1, 48000);
        } catch (_) { return null; }
        const totals = new Float32Array(frequencies.length);
        const magnitude = new Float32Array(frequencies.length);
        const phase = new Float32Array(frequencies.length);
        for (const spec of [...lib.toneFilterSpecs(settings), ...lib.eqFilterSpecs(settings.eq)]) {
            const filter = offlineContext.createBiquadFilter();
            filter.type = spec.type;
            filter.frequency.value = spec.frequency;
            filter.Q.value = spec.Q;
            filter.gain.value = spec.gain;
            filter.getFrequencyResponse(frequencies, magnitude, phase);
            for (let i = 0; i < totals.length; i++) totals[i] += 20 * Math.log10(Math.max(1e-6, magnitude[i]));
        }
        return totals;
    }

    function drawCurve() {
        ui.curveFrame = 0;
        const canvas = ui.canvas;
        if (!canvas || !canvas.isConnected) return;
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.clientWidth || 300; const height = canvas.clientHeight || 64;
        if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
        const g = canvas.getContext('2d');
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        g.clearRect(0, 0, width, height);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--k-accent').trim() || '#28d96d';
        const points = 96;
        const frequencies = new Float32Array(points);
        for (let i = 0; i < points; i++) frequencies[i] = 20 * Math.pow(1000, i / (points - 1));
        const settings = engine.bypass ? lib.defaultSettings() : manager.live;
        const totals = responseDb(settings, frequencies);
        const range = 15; const mid = height / 2;
        g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
        for (const f of [100, 1000, 10000]) {
            const x = Math.log(f / 20) / Math.log(1000) * width;
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke();
        }
        g.beginPath(); g.moveTo(0, mid); g.lineTo(width, mid); g.stroke();
        if (!totals) return;
        const y = db => mid - Math.max(-range, Math.min(range, db)) / range * (mid - 4);
        g.beginPath();
        for (let i = 0; i < points; i++) {
            const x = (i / (points - 1)) * width;
            if (i === 0) g.moveTo(x, y(totals[i])); else g.lineTo(x, y(totals[i]));
        }
        g.strokeStyle = accent; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
        g.lineTo(width, mid); g.lineTo(0, mid); g.closePath();
        g.globalAlpha = 0.16; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
    }

    function scheduleCurve() {
        if (!ui.curveFrame) ui.curveFrame = requestAnimationFrame(drawCurve);
    }

    // ------------------------------------------------------------------ rendering
    function syncControls() {
        for (const [key, { input, valueEl }] of ui.sliders) {
            const value = manager.live[key];
            if (document.activeElement !== input) input.value = String(value);
            valueEl.textContent = formatValue(key, Number(value));
            paintSlider(input);
        }
        for (const [key, input] of ui.switches) input.checked = Boolean(manager.live[key]);
        const dirty = manager.isDirty;
        const isCustom = !manager.active.builtin;
        ui.modifiedBadge.hidden = !dirty;
        ui.actions.save.disabled = !(isCustom && dirty);
        ui.actions.revert.disabled = !dirty;
        ui.actions.rename.disabled = !isCustom;
        ui.actions.remove.disabled = !isCustom;
        ui.bypassBtn.classList.toggle('is-on', engine.bypass);
        ui.bypassBtn.setAttribute('aria-pressed', engine.bypass ? 'true' : 'false');
        ui.root.classList.toggle('is-bypassed', engine.bypass);
        renderDeviceBind();
        scheduleCurve();
    }

    function build() {
        const drawerContent = document.querySelector('#dspPanel .dsp-drawer-content');
        if (!drawerContent) return false;
        ui.sliders.clear(); ui.switches.clear(); ui.actions = {};

        ui.chips = h('div', { class: 'sp-chips', role: 'list' });
        ui.modifiedBadge = h('span', { class: 'sp-badge', text: L('modified'), hidden: true });
        ui.bypassBtn = h('button', { type: 'button', class: 'sp-bypass', title: L('bypass'), 'aria-label': L('bypass'), 'aria-pressed': 'false' }, icon('fa-ear-listen'));
        ui.bypassBtn.addEventListener('click', () => engine.setBypass(!engine.bypass));

        const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
        fileInput.addEventListener('change', () => { void importFile(fileInput.files[0]); fileInput.value = ''; });

        const toolbar = h('div', { class: 'sp-toolbar' },
            action('save', 'fa-floppy-disk', 'save', () => { if (manager.saveActive()) notify(L('saved'), 'success'); }),
            action('saveAs', 'fa-circle-plus', 'saveAs', () => openNameBar('new')),
            action('revert', 'fa-rotate-left', 'revert', () => manager.revert()),
            action('rename', 'fa-pen', 'rename', () => openNameBar('rename')),
            action('duplicate', 'fa-clone', 'duplicate', () => {
                const copy = manager.duplicate(manager.activeId);
                if (copy) manager.activate(copy.id); else notify(L('limitReached'), 'warning');
            }),
            action('remove', 'fa-trash', 'remove', () => {
                const button = ui.actions.remove;
                if (Date.now() < ui.deleteArmedUntil) {
                    ui.deleteArmedUntil = 0;
                    if (manager.remove(manager.activeId)) notify(L('deleted'), 'info');
                } else {
                    ui.deleteArmedUntil = Date.now() + 3000;
                    button.classList.add('is-armed');
                    button.title = L('removeConfirm');
                    setTimeout(() => { button.classList.remove('is-armed'); button.title = L('remove'); }, 3000);
                }
            }),
            h('span', { class: 'sp-toolbar-gap' }),
            action('export', 'fa-file-export', 'exportOne', () => {
                const data = manager.exportProfile(manager.activeId);
                if (data) downloadJson(data, `korai-${String(data.name).replace(/[^\w.-]+/g, '_').slice(0, 30) || 'profile'}.json`);
            }),
            action('import', 'fa-file-import', 'importFile', () => fileInput.click()),
            fileInput);

        ui.nameInput = h('input', { type: 'text', class: 'sp-name-input', maxlength: 40, placeholder: L('name'), 'aria-label': L('name') });
        ui.nameInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') submitNameBar();
            if (event.key === 'Escape') closeNameBar();
        });
        ui.iconPicker = h('div', { class: 'sp-icon-picker' });
        ui.nameBar = h('div', { class: 'sp-namebar', hidden: true },
            h('div', { class: 'sp-namebar-row' }, ui.nameInput,
                h('button', { type: 'button', class: 'sp-btn sp-btn-primary', text: L('create'), onclick: submitNameBar }),
                h('button', { type: 'button', class: 'sp-btn', text: L('cancel'), onclick: closeNameBar })),
            ui.iconPicker);

        ui.meterLevel = h('i', { class: 'sp-meter-fill' });
        ui.meterReduction = h('i', { class: 'sp-meter-fill is-reduction' });
        ui.meterLevelText = h('b', { text: '−∞' });
        const meters = h('div', { class: 'sp-meters' },
            h('div', { class: 'sp-meter' }, h('span', { text: L('level') }), h('div', { class: 'sp-meter-track' }, ui.meterLevel), ui.meterLevelText),
            h('div', { class: 'sp-meter' }, h('span', { text: L('reduction') }), h('div', { class: 'sp-meter-track' }, ui.meterReduction), h('b', { text: '' })));

        ui.canvas = h('canvas', { class: 'sp-curve', 'aria-label': L('curve'), role: 'img' });

        ui.deviceSelect = h('select', { class: 'sp-select', 'aria-label': L('output') });
        ui.deviceSelect.addEventListener('change', async () => {
            const ok = await manager.selectOutputDevice(ui.deviceSelect.value);
            notify(L(ok ? 'deviceOk' : 'deviceFailed'), ok ? 'success' : 'warning');
            await refreshDevices(false);
        });
        ui.namesBtn = h('button', { type: 'button', class: 'sp-btn', text: L('showNames'), hidden: true, onclick: () => void revealDeviceNames() });
        ui.deviceBind = h('input', { type: 'checkbox' });
        ui.deviceBind.addEventListener('change', () => {
            const current = resolveCurrentDevice(ui.devices);
            const label = current.device ? deviceLabel(current.device, 0) : L('systemDefault');
            manager.bindDevice(current.id, label, ui.deviceBind.checked ? manager.activeId : null);
        });
        ui.autoSwitch = h('input', { type: 'checkbox', checked: manager.autoSwitch ? true : null });
        ui.autoSwitch.addEventListener('change', () => manager.setAutoSwitch(ui.autoSwitch.checked));

        const switchRow = (input, titleKey, descKey, iconName) => h('div', { class: 'dsp-toggle-row sp-switch-row' },
            h('div', { class: 'dsp-toggle-copy' }, icon(iconName), h('div', {}, h('strong', { text: L(titleKey) }), descKey ? h('span', { text: L(descKey) }) : null)),
            h('label', { class: 'switch', 'aria-label': L(titleKey) }, input, h('span', { class: 'switch-slider' })));

        const devicePanel = h('div', { class: 'sp-device' },
            h('div', { class: 'sp-label', text: L('output') }),
            h('div', { class: 'sp-device-row' }, ui.deviceSelect, ui.namesBtn),
            switchRow(ui.deviceBind, 'useHere', 'useHereDesc', 'fa-plug'),
            switchRow(ui.autoSwitch, 'autoSwitch', null, 'fa-wand-magic-sparkles'));

        ui.root = h('section', { class: 'dsp-section dsp-section-profiles sp-section', id: 'soundProfilesSection' },
            h('div', { class: 'dsp-section-heading' },
                h('div', {}, h('span', { class: 'dsp-section-kicker', text: L('kicker') }), h('h4', {}, L('title'), ' ', ui.modifiedBadge)),
                ui.bypassBtn),
            ui.chips, toolbar, ui.nameBar,
            h('div', { class: 'sp-curve-wrap' }, ui.canvas, meters),
            ...GROUPS.map((group, index) => buildGroup(group, index === 0)),
            devicePanel,
            h('p', { class: 'sp-note', text: L('eqNote') }));

        document.getElementById('soundProfilesSection')?.remove();
        drawerContent.prepend(ui.root);
        buildChips();
        syncControls();
        void refreshDevices(false);
        return true;
    }

    // ------------------------------------------------------------------ startup
    function watchDrawer() {
        const panel = document.getElementById('dspPanel');
        if (!panel) return;
        const update = () => {
            if (panel.classList.contains('open')) { startMeter(); scheduleCurve(); } else stopMeter();
        };
        new MutationObserver(update).observe(panel, { attributes: true, attributeFilter: ['class'] });
        update();
    }

    function whenStoreReady(timeoutMs = 15000) {
        return new Promise(resolve => {
            const started = Date.now();
            const check = () => {
                if (window.settingsStore?.initialized || Date.now() - started > timeoutMs) resolve();
                else setTimeout(check, 100);
            };
            check();
        });
    }

    async function init() {
        await whenStoreReady();
        manager.load();
        if (manager.outputDeviceId !== 'default') void engine.setOutputDevice(manager.outputDeviceId);
        build();
        watchDrawer();

        manager.subscribe(reason => {
            if (reason === 'profiles' || reason === 'profile' || reason === 'auto-profile' || reason === 'load') buildChips();
            else if (reason === 'param' || reason === 'eq') updateDirtyDot();
            syncControls();
            if (reason === 'auto-profile') notify(L('autoApplied', { name: profileName(manager.active) }), 'info');
        });
        engine.onChange(reason => { if (reason === 'bypass') syncControls(); });

        // Keep profile state in sync with the stand-alone 5-band equalizer and the Mono setting.
        window.addEventListener('settings-changed', event => {
            const { key, value } = event.detail || {};
            if (key === 'eq' && Array.isArray(value)) manager.noteEqChange(value);
            if (key === 'audioOutput') manager.setParam('mono', value === 'mono');
            if (key === profilesLib.STORE_KEY) syncControls();
        });
        window.addEventListener('settings-loaded', () => { manager.load(); build(); });

        navigator.mediaDevices?.addEventListener?.('devicechange', () => void refreshDevices(true));
        await refreshDevices(true);

        let builtLang = lang();
        new MutationObserver(() => {
            if (lang() === builtLang) return;
            builtLang = lang();
            build();
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        window.addEventListener('resize', scheduleCurve);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void init());
    else void init();
})();
