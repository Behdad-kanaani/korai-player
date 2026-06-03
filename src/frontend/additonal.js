/**
 * additional.js - KORAI Player Extended Functions
 * Vocal Separation using Mid-Side processing (FIXED)
 */

let isVocalSeparatorToggling = false;
let vocalSeparatorMode = false;
let vocalRemovalIntensity = 0.9;
let vocalSeparatorProcessor = null;

class VocalSeparatorProcessor {
    constructor(ctx) {
        this.ctx = ctx;
        this.splitter = null;
        this.merger = null;
        this.midGain = null;
        this.sideGain = null;
        this.inputGain = null;
        this.outputGain = null;
        this.bypassGain = null;
        this.isActive = false;
        this.isConnected = false;
        this.outputNode = null;
        this.highpassFilter = null;
    }

    initialize() {
        if (this.isConnected) return this.outputNode;

        try {
            this.splitter = this.ctx.createChannelSplitter(2);
            this.merger = this.ctx.createChannelMerger(2);

            this.midGain = this.ctx.createGain();
            this.sideGain = this.ctx.createGain();

            this.highpassFilter = this.ctx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = 100;
            this.highpassFilter.Q.value = 0.7;

            this.inputGain = this.ctx.createGain();
            this.outputGain = this.ctx.createGain();
            this.bypassGain = this.ctx.createGain();

            const midSumL = this.ctx.createGain();
            const midSumR = this.ctx.createGain();
            midSumL.gain.value = 0.5;
            midSumR.gain.value = 0.5;
            this.splitter.connect(midSumL, 0);
            this.splitter.connect(midSumR, 1);
            const midAdder = this.ctx.createGain();
            midSumL.connect(midAdder);
            midSumR.connect(midAdder);
            midAdder.gain.value = 1;
            midAdder.connect(this.midGain);

            const sidePos = this.ctx.createGain();
            const sideNeg = this.ctx.createGain();
            sidePos.gain.value = 0.5;
            sideNeg.gain.value = -0.5;
            this.splitter.connect(sidePos, 0);
            this.splitter.connect(sideNeg, 1);
            const sideAdder = this.ctx.createGain();
            sidePos.connect(sideAdder);
            sideNeg.connect(sideAdder);
            sideAdder.gain.value = 1;
            sideAdder.connect(this.sideGain);

            this.inputGain.connect(this.bypassGain);

            const leftSum = this.ctx.createGain();
            const rightSum = this.ctx.createGain();
            const invSide = this.ctx.createGain();
            invSide.gain.value = -1;

            this.midGain.connect(leftSum);
            this.sideGain.connect(leftSum);

            this.midGain.connect(rightSum);
            this.sideGain.connect(invSide);
            invSide.connect(rightSum);

            leftSum.connect(this.merger, 0, 0);
            rightSum.connect(this.merger, 0, 1);

            this.merger.connect(this.outputGain);
            this.highpassFilter.connect(this.outputGain);
            this.merger.connect(this.highpassFilter);

            this.isConnected = true;
            this.outputNode = this.outputGain;
            console.log('Vocal Separator Processor initialized (Mid-Side)');
            return this.outputNode;
        } catch (err) {
            console.error('Failed to initialize vocal separator processor:', err);
            return null;
        }
    }

    setIntensity(intensity) {
        const val = Math.min(1.0, Math.max(0.3, intensity));
        const midReduction = Math.max(0, 1.0 - val);
        if (this.midGain) {
            this.midGain.gain.value = midReduction;
        }
        if (this.sideGain) {
            this.sideGain.gain.value = 1 + (val * 0.3);
        }
        console.log(`Vocal removal intensity set to ${Math.round(val*100)}% (mid gain = ${midReduction})`);
    }

    // FIX: auto-initialize before returning output node
    getOutputNode() {
        if (!this.isConnected) {
            this.initialize();
        }
        return this.outputGain;
    }

    getBypassNode() { return this.bypassGain; }

    enable() {
        if (!this.isConnected) this.initialize();
        this.isActive = true;
        this.inputGain.gain.value = 1;
        this.outputGain.gain.value = 1;
        this.bypassGain.gain.value = 0;
        this.setIntensity(vocalRemovalIntensity);
        console.log('Vocal Separator Mode ENABLED (Mid-Side processing)');
    }

    disable() {
        this.isActive = false;
        this.inputGain.gain.value = 0;
        this.outputGain.gain.value = 0;
        this.bypassGain.gain.value = 1;
        console.log('Vocal Separator Mode DISABLED');
    }

    destroy() {
        try {
            this.inputGain?.disconnect();
            this.outputGain?.disconnect();
            this.bypassGain?.disconnect();
            this.splitter?.disconnect();
            this.merger?.disconnect();
            this.midGain?.disconnect();
            this.sideGain?.disconnect();
            this.highpassFilter?.disconnect();
        } catch(e) {}
        this.isConnected = false;
        this.isActive = false;
    }
}

/**
 * Ensures the MediaElementSourceNode exists (created once).
 */
function ensureAudioSource() {
    if (!window.audioElement) return false;
    if (!window.audioCtx) {
        window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!window.audioSource) {
        try {
            window.audioSource = window.audioCtx.createMediaElementSource(window.audioElement);
            console.log('✅ MediaElementSourceNode created (once)');
        } catch (err) {
            console.error('Failed to create MediaElementSourceNode:', err);
            return false;
        }
    }
    return true;
}

/**
 * Rebuild the audio graph without recreating the source node.
 */
async function reconnectAudioGraph(enableVocalSeparator) {
    if (!window.audioElement || !window.audioCtx) {
        console.error('Cannot reconnect: missing audio element or context');
        return false;
    }

    if (!ensureAudioSource()) {
        console.error('Could not create or reuse audio source');
        return false;
    }

    try {
        const wasPlaying = !window.audioElement.paused;
        const currentTime = window.audioElement.currentTime;
        const currentVolume = window.audioElement.volume;
        const currentRate = window.audioElement.playbackRate;

        if (wasPlaying) {
            window.audioElement.pause();
        }

        // Disconnect everything from the source (but keep the source itself)
        try { window.audioSource.disconnect(); } catch(e) {}

        if (window.vocalSeparatorProcessor && window.vocalSeparatorProcessor.outputNode) {
            try { window.vocalSeparatorProcessor.outputNode.disconnect(); } catch(e) {}
        }
        if (window.eqFilters && window.eqFilters.length) {
            try { window.eqFilters[0].disconnect(); } catch(e) {}
        }
        if (window.analyser) {
            try { window.analyser.disconnect(); } catch(e) {}
        }
        if (window.gainNode) {
            try { window.gainNode.disconnect(); } catch(e) {}
        }

        let currentNode = window.audioSource;

        if (enableVocalSeparator && window.vocalSeparatorProcessor) {
            const processorOutput = window.vocalSeparatorProcessor.getOutputNode(); // auto-initializes
            if (processorOutput) {
                currentNode.connect(processorOutput);
                currentNode = processorOutput;
                window.vocalSeparatorProcessor.enable();
            } else {
                console.warn('Vocal separator processor not ready');
            }
        } else if (window.vocalSeparatorProcessor) {
            window.vocalSeparatorProcessor.disable();
        }

        if (window.eqFilters && window.eqFilters.length > 0) {
            currentNode.connect(window.eqFilters[0]);
            currentNode = window.eqFilters[window.eqFilters.length - 1];
        }

        if (window.analyser) {
            currentNode.connect(window.analyser);
            if (window.gainNode) {
                window.analyser.connect(window.gainNode);
                window.gainNode.connect(window.audioCtx.destination);
            } else {
                window.analyser.connect(window.audioCtx.destination);
            }
        } else if (window.gainNode) {
            currentNode.connect(window.gainNode);
            window.gainNode.connect(window.audioCtx.destination);
        } else {
            currentNode.connect(window.audioCtx.destination);
        }

        window.audioElement.volume = currentVolume;
        window.audioElement.playbackRate = currentRate;
        window.audioElement.currentTime = currentTime;

        if (wasPlaying) {
            if (window.audioCtx.state === 'suspended') await window.audioCtx.resume();
            await window.audioElement.play();
            if (window.setPlayState) window.setPlayState(true);
        }

        console.log(`Audio graph rebuilt (vocal separator: ${enableVocalSeparator})`);
        return true;
    } catch (err) {
        console.error('Failed to rebuild audio graph:', err);
        return false;
    }
}

async function toggleVocalSeparator() {
    if (isVocalSeparatorToggling) {
        console.log('Vocal separator toggle already in progress');
        return;
    }

    if (!window.currentTrackId || !window.audioElement) {
        if (window.showNotification) {
            window.showNotification('Please play a track first to enable vocal separator', 'warning');
        }
        const vocalSeparatorToggle = document.getElementById('vocalSeparatorToggle');
        if (vocalSeparatorToggle) vocalSeparatorToggle.checked = false;
        return;
    }

    isVocalSeparatorToggling = true;

    try {
        if (!window.audioCtx || window.audioCtx.state === 'closed') {
            window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (!ensureAudioSource()) {
            throw new Error('Could not create audio source');
        }

        if (!vocalSeparatorProcessor) {
            vocalSeparatorProcessor = new VocalSeparatorProcessor(window.audioCtx);
            vocalSeparatorProcessor.setIntensity(vocalRemovalIntensity);
            window.vocalSeparatorProcessor = vocalSeparatorProcessor;
        }

        const newState = !vocalSeparatorMode;
        const success = await reconnectAudioGraph(newState);

        if (success) {
            vocalSeparatorMode = newState;
            if (window.showNotification) {
                if (vocalSeparatorMode) {
                    window.showNotification('Vocal Separator activated (intelligent vocal removal)', 'success');
                } else {
                    window.showNotification('Vocal Separator deactivated', 'info');
                }
            }
        } else {
            throw new Error('Failed to switch vocal separator mode');
        }

        updateVocalSeparatorUI();
    } catch (err) {
        console.error('Vocal separator toggle error:', err);
        if (window.showNotification) {
            window.showNotification('Error activating vocal separator: ' + err.message, 'error');
        }
        if (vocalSeparatorMode) {
            await reconnectAudioGraph(false);
            vocalSeparatorMode = false;
        }
        const vocalSeparatorToggle = document.getElementById('vocalSeparatorToggle');
        if (vocalSeparatorToggle) vocalSeparatorToggle.checked = false;
    } finally {
        isVocalSeparatorToggling = false;
    }
}

function updateVocalSeparatorUI() {
    const toggle = document.getElementById('vocalSeparatorToggle');
    if (toggle) toggle.checked = vocalSeparatorMode || false;

    const intensitySlider = document.getElementById('vocalRemovalIntensitySlider');
    if (intensitySlider) {
        intensitySlider.value = vocalRemovalIntensity || 0.9;
        const intensityVal = document.getElementById('vocalRemovalIntensityVal');
        if (intensityVal) intensityVal.innerText = `${Math.round((vocalRemovalIntensity || 0.9) * 100)}%`;
    }

    const advancedControls = document.getElementById('vocalSeparatorAdvancedControls');
    if (advancedControls) {
        advancedControls.style.display = vocalSeparatorMode ? 'block' : 'none';
    }
}

function setVocalRemovalIntensity(value) {
    vocalRemovalIntensity = parseFloat(value);
    if (vocalSeparatorProcessor) {
        vocalSeparatorProcessor.setIntensity(vocalRemovalIntensity);
    }
    const intensityVal = document.getElementById('vocalRemovalIntensityVal');
    if (intensityVal) intensityVal.innerText = `${Math.round(vocalRemovalIntensity * 100)}%`;
}

function setVocalDetectionSensitivity(value) {
    const sensitivityVal = document.getElementById('vocalDetectionSensitivityVal');
    if (sensitivityVal) sensitivityVal.innerText = parseFloat(value).toFixed(2);
}

function cleanupVocalSeparator() {
    if (vocalSeparatorProcessor) {
        try { vocalSeparatorProcessor.destroy(); } catch(e) {}
        vocalSeparatorProcessor = null;
    }
    vocalSeparatorMode = false;
    isVocalSeparatorToggling = false;
}

window.vocalSeparatorMode = vocalSeparatorMode;
window.vocalRemovalIntensity = vocalRemovalIntensity;
window.toggleVocalSeparator = toggleVocalSeparator;
window.setVocalRemovalIntensity = setVocalRemovalIntensity;
window.setVocalDetectionSensitivity = setVocalDetectionSensitivity;
window.cleanupVocalSeparator = cleanupVocalSeparator;