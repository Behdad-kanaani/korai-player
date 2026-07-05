// audioEffectsFramework - plugin audio effects registration and chain

class AudioEffectsFramework {
  constructor() {
    this.effects = new Map(); // pluginId -> [{ type, params }]
    this.effectChain = []; // Ordered chain of effects to apply
    this.audioContext = null;
    this.analyser = null;
  }

  /**
   * Register effect that a plugin can use
   */
  registerEffect(pluginId, effectType, params = {}) {
    const supportedEffects = [
      'volume', 'gain', 'eq', 'reverb', 'chorus', 
      'delay', 'compression', 'distortion', 'flanger', 'tremolo'
    ];

    if (!supportedEffects.includes(effectType)) {
      throw new Error(`Unsupported effect type: ${effectType}`);
    }

    if (!this.effects.has(pluginId)) {
      this.effects.set(pluginId, []);
    }

    this.effects.get(pluginId).push({
      type: effectType,
      params: this.validateParams(effectType, params),
      enabled: true,
      id: Math.random().toString(36)
    });

    return { success: true, effectId: this.effects.get(pluginId)[this.effects.get(pluginId).length - 1].id };
  }

  /**
   * Validate effect parameters
   */
  validateParams(effectType, params) {
    const defaults = {
      volume: { level: 1.0 }, // 0.0 - 1.0
      gain: { db: 0 }, // -40 - +40 dB
      eq: { freq: 1000, gain: 0, q: 1 }, // EQ band
      reverb: { time: 1.5, dry: 0.8, wet: 0.2 }, // 0.5 - 5 seconds
      chorus: { rate: 1.5, depth: 0.002, feedback: 0.3 },
      delay: { time: 0.5, feedback: 0.3, wet: 0.5 }, // 0.1 - 5 seconds
      compression: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 },
      distortion: { amount: 50 }, // 0 - 100
      flanger: { rate: 0.5, depth: 0.001, feedback: 0.5 },
      tremolo: { rate: 4, depth: 0.5 } // Hz, 0-1
    };

    return { ...defaults[effectType], ...params };
  }

  /**
   * Update effect parameters in real-time
   */
  updateEffect(pluginId, effectId, params) {
    const effects = this.effects.get(pluginId);
    if (!effects) throw new Error(`Plugin not found: ${pluginId}`);

    const effect = effects.find(e => e.id === effectId);
    if (!effect) throw new Error(`Effect not found: ${effectId}`);

    effect.params = { ...effect.params, ...params };
    return { success: true };
  }

  /**
   * Enable/disable effect
   */
  toggleEffect(pluginId, effectId, enabled) {
    const effects = this.effects.get(pluginId);
    if (!effects) throw new Error(`Plugin not found: ${pluginId}`);

    const effect = effects.find(e => e.id === effectId);
    if (!effect) throw new Error(`Effect not found: ${effectId}`);

    effect.enabled = Boolean(enabled);
    return { success: true };
  }

  /**
   * Remove effect
   */
  removeEffect(pluginId, effectId) {
    const effects = this.effects.get(pluginId);
    if (!effects) throw new Error(`Plugin not found: ${pluginId}`);

    const idx = effects.findIndex(e => e.id === effectId);
    if (idx === -1) throw new Error(`Effect not found: ${effectId}`);

    effects.splice(idx, 1);
    return { success: true };
  }

  /**
   * Get all effects for plugin
   */
  getPluginEffects(pluginId) {
    return this.effects.get(pluginId) || [];
  }

  /**
   * Get effect chain (all enabled effects in order)
   */
  getEffectChain() {
    const chain = [];
    for (const [pluginId, effects] of this.effects) {
      effects
        .filter(e => e.enabled)
        .forEach(e => {
          chain.push({ pluginId, ...e });
        });
    }
    return chain;
  }

  /**
   * Simulate audio processing with effects
   * (In real app, this would use Web Audio API or native audio processing)
   */
  async processAudio(audioBuffer, sampleRate = 44100) {
    const chain = this.getEffectChain();
    if (chain.length === 0) return audioBuffer;

    let processed = audioBuffer;
    for (const effect of chain) {
      processed = this.applyEffect(processed, effect, sampleRate);
    }
    return processed;
  }

  /**
   * Apply single effect (simplified)
   */
  applyEffect(audioBuffer, effect, sampleRate) {
    const { type, params } = effect;

    switch (type) {
      case 'volume':
        return this.applyVolume(audioBuffer, params.level);
      case 'gain':
        return this.applyGain(audioBuffer, params.db);
      case 'eq':
        return this.applyEQ(audioBuffer, params);
      case 'distortion':
        return this.applyDistortion(audioBuffer, params.amount);
      case 'tremolo':
        return this.applyTremolo(audioBuffer, params, sampleRate);
      default:
        return audioBuffer; // Placeholder
    }
  }

  applyVolume(buffer, level) {
    const data = buffer;
    for (let i = 0; i < data.length; i++) {
      data[i] *= level;
    }
    return data;
  }

  applyGain(buffer, db) {
    const level = Math.pow(10, db / 20);
    return this.applyVolume(buffer, level);
  }

  applyEQ(buffer, params) {
    // Simplified EQ (in real app, use biquad filters)
    const { gain } = params;
    return this.applyGain(buffer, gain);
  }

  applyDistortion(buffer, amount) {
    const data = buffer;
    const drive = amount / 100;
    for (let i = 0; i < data.length; i++) {
      const x = data[i] * (1 + drive * 50);
      data[i] = x > 1 ? 1 : x < -1 ? -1 : x; // Hard clip
    }
    return data;
  }

  applyTremolo(buffer, params, sampleRate) {
    const data = buffer;
    const { rate, depth } = params;
    const period = sampleRate / rate;

    for (let i = 0; i < data.length; i++) {
      const phase = (i % period) / period;
      const lfo = Math.sin(phase * Math.PI * 2);
      const modulation = 1 - (depth * (1 - lfo) / 2);
      data[i] *= modulation;
    }
    return data;
  }

  /**
   * Get available effect types
   */
  getAvailableEffects() {
    return [
      { type: 'volume', name: 'Volume', category: 'basic' },
      { type: 'gain', name: 'Gain', category: 'basic' },
      { type: 'eq', name: 'Equalizer', category: 'tone' },
      { type: 'reverb', name: 'Reverb', category: 'space' },
      { type: 'chorus', name: 'Chorus', category: 'modulation' },
      { type: 'delay', name: 'Delay', category: 'time' },
      { type: 'compression', name: 'Compressor', category: 'dynamics' },
      { type: 'distortion', name: 'Distortion', category: 'tone' },
      { type: 'flanger', name: 'Flanger', category: 'modulation' },
      { type: 'tremolo', name: 'Tremolo', category: 'modulation' }
    ];
  }
}

module.exports = AudioEffectsFramework;
