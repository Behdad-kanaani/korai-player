/**
 * gaplessPlayer.js - Gapless Playback & Crossfade Engine
 * 
 * Uses Web Audio API with precise scheduling for seamless transitions
 * Supports crossfade between tracks (0-12 seconds)
 */

let audioContext = null;
let currentSource = null;
let nextSource = null;
let currentGain = null;
let nextGain = null;
let crossfadeDuration = 0;
let gaplessEnabled = true;
let nextTrackTimeout = null;

/**
 * Initialize gapless player
 */
async function initGaplessPlayer() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    currentGain = audioContext.createGain();
    currentGain.connect(audioContext.destination);
    
    // Load settings
    const settings = await window.electronAPI?.getPlaybackSettings?.();
    if (settings) {
        gaplessEnabled = settings.gaplessEnabled !== false;
        crossfadeDuration = settings.crossfadeDuration || 0;
    }
    
    return audioContext;
}

/**
 * Schedule next track for gapless playback
 */
function scheduleNextTrack(currentTrack, nextTrack, apiPort, currentTime) {
    if (!gaplessEnabled && crossfadeDuration === 0) {
        // Fallback to standard playback
        return false;
    }
    
    if (nextTrackTimeout) clearTimeout(nextTrackTimeout);
    
    // Calculate when to start next track
    const remainingTime = currentTrack.duration - currentTime;
    const scheduleOffset = Math.max(0, remainingTime - crossfadeDuration - 0.5);
    
    if (scheduleOffset <= 0 && crossfadeDuration > 0) {
        // Start crossfade immediately
        startCrossfade(currentTrack, nextTrack, apiPort, currentTime);
        return true;
    }
    
    nextTrackTimeout = setTimeout(() => {
        startCrossfade(currentTrack, nextTrack, apiPort, currentTime);
    }, scheduleOffset * 1000);
    
    return true;
}

/**
 * Start crossfade between current and next track using Web Audio API scheduling
 */
async function startCrossfade(currentTrack, nextTrack, apiPort, currentTime) {
    if (!audioContext || audioContext.state === 'closed') {
        await initGaplessPlayer();
    }
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    
    // Stop any existing next source
    if (nextSource) {
        try { nextSource.stop(); } catch(e) {}
    }
    
    // Create next source
    const streamUrl = `http://127.0.0.1:${apiPort}/api/tracks/${nextTrack.id}/stream`;
    const response = await fetch(streamUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    nextSource = audioContext.createBufferSource();
    nextSource.buffer = audioBuffer;
    
    nextGain = audioContext.createGain();
    nextGain.gain.value = 0;
    
    nextSource.connect(nextGain);
    nextGain.connect(audioContext.destination);
    
    // Start next track
    const startTime = audioContext.currentTime;
    nextSource.start(startTime);
    
    // Use Web Audio API's exponentialRampToValueAtTime for smooth, efficient crossfade
    // This offloads the fade to the audio thread, no main thread blocking
    const fadeDuration = Math.min(crossfadeDuration, 3); // Max 3 seconds for crossfade
    const rampStartTime = startTime;
    const rampEndTime = startTime + fadeDuration;
    
    // Fade out current track (avoid 0 for exponential, use small value)
    if (currentGain) {
        currentGain.gain.setValueAtTime(1, rampStartTime);
        currentGain.gain.exponentialRampToValueAtTime(0.01, rampEndTime);
    }
    
    // Fade in next track
    if (nextGain) {
        nextGain.gain.setValueAtTime(0.01, rampStartTime);
        nextGain.gain.exponentialRampToValueAtTime(1, rampEndTime);
    }
    
    // Stop current source after fade completes
    setTimeout(() => {
        if (currentSource) {
            try { currentSource.stop(); } catch(e) {}
        }
    }, fadeDuration * 1000 + 100);
    
    // Swap sources after crossfade
    setTimeout(() => {
        currentSource = nextSource;
        currentGain = nextGain;
        nextSource = null;
        nextGain = null;
    }, fadeDuration * 1000);
}

/**
 * Set crossfade duration
 */
function setCrossfade(duration) {
    crossfadeDuration = Math.min(12, Math.max(0, duration));
    window.electronAPI?.setCrossfade?.(crossfadeDuration);
}

/**
 * Enable/disable gapless playback
 */
function setGaplessEnabled(enabled) {
    gaplessEnabled = enabled;
    window.electronAPI?.setPlaybackSettings?.({ gapless: enabled });
}

/**
 * Clean up audio resources
 */
function destroyGaplessPlayer() {
    if (nextTrackTimeout) clearTimeout(nextTrackTimeout);
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
    }
    if (nextSource) {
        try { nextSource.stop(); } catch(e) {}
    }
    if (audioContext) {
        audioContext.close();
    }
    audioContext = null;
    currentSource = null;
    nextSource = null;
    currentGain = null;
    nextGain = null;
}

module.exports = {
    initGaplessPlayer,
    scheduleNextTrack,
    setCrossfade,
    setGaplessEnabled,
    destroyGaplessPlayer
};