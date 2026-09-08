// Flight audio. Everything is synthesised in Web Audio for now — a drive
// loop that follows the throttle, RCS puffs, weapon and shield sounds, the
// drive charge and the jump — but every sound goes through a named channel
// with its own gain, so recorded assets can replace the synthesis one
// channel at a time (`setSample`) without touching the flight model. The
// context is created lazily on the first call after a user gesture and
// stays silent if the browser refuses.

export type AudioChannel =
  | 'engine' | 'boost' | 'rcs' | 'ambience' | 'warning'
  | 'weapon' | 'shield' | 'jumpCharge' | 'hyperspace';

export interface FlightAudio {
  /** Continuous drive state: throttle 0..1, boost, speed as a fraction of the ceiling. */
  setEngine: (throttle: number, boost: boolean, speedFrac: number) => void;
  /** Reaction-control jets: 0..1 how much is firing this frame. */
  setRcs: (intensity: number) => void;
  laser: () => void;
  shieldHit: () => void;
  shieldDown: () => void;
  hullHit: () => void;
  boom: () => void;
  warn: (kind: 'caution' | 'danger' | 'lock' | 'discovery') => void;
  charge: (seconds: number) => void;
  whoosh: () => void;
  /** Drop in a recorded clip for a channel; one-shots play it, loops use it as the bed. */
  setSample: (channel: AudioChannel, buffer: AudioBuffer) => void;
  dispose: () => void;
}

const CHANNEL_GAIN: Record<AudioChannel, number> = {
  engine: 0.16, boost: 0.14, rcs: 0.12, ambience: 0.05, warning: 0.16,
  weapon: 0.12, shield: 0.18, jumpCharge: 0.14, hyperspace: 0.32,
};

export function makeFlightAudio(): FlightAudio {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  const buses = new Map<AudioChannel, GainNode>();
  const samples = new Map<AudioChannel, AudioBuffer>();
  let engine: {
    low: OscillatorNode; mid: OscillatorNode; hiss: AudioBufferSourceNode;
    lp: BiquadFilterNode; gain: GainNode; hissGain: GainNode; boostGain: GainNode; boostOsc: OscillatorNode;
  } | null = null;
  let rcsNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let lastWarn = 0;

  const ready = (): AudioContext => {
    if (!ctx) {
      ctx = new AudioContext();
      for (const ch of Object.keys(CHANNEL_GAIN) as AudioChannel[]) {
        const g = ctx.createGain();
        g.gain.value = CHANNEL_GAIN[ch];
        g.connect(ctx.destination);
        buses.set(ch, g);
      }
    }
    if (ctx.state === 'suspended') void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  };
  const bus = (ch: AudioChannel) => buses.get(ch)!;
  const safe = (fn: (c: AudioContext) => void) => {
    try {
      fn(ready());
    } catch {
      // No audio available (autoplay policy, missing API) — the flight stays silent.
    }
  };
  const tone = (c: AudioContext, ch: AudioChannel, type: OscillatorType, f0: number, f1: number, gain: number, dur: number, delay = 0) => {
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    osc.connect(g).connect(bus(ch));
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };
  const burst = (c: AudioContext, ch: AudioChannel, filter: BiquadFilterType, f0: number, f1: number, gain: number, dur: number) => {
    if (!noise) return;
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    const flt = c.createBiquadFilter();
    flt.type = filter;
    flt.frequency.setValueAtTime(f0, t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    src.connect(flt).connect(g).connect(bus(ch));
    src.onended = () => {
      src.disconnect();
      flt.disconnect();
      g.disconnect();
    };
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };
  const playSample = (c: AudioContext, ch: AudioChannel, gain: number): boolean => {
    const buf = samples.get(ch);
    if (!buf) return false;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus(ch));
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start();
    return true;
  };
  const ensureEngine = (c: AudioContext) => {
    if (engine || !noise) return;
    const low = c.createOscillator();
    low.type = 'sawtooth';
    low.frequency.value = 46;
    const mid = c.createOscillator();
    mid.type = 'sine';
    mid.frequency.value = 92;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const gain = c.createGain();
    gain.gain.value = 0;
    low.connect(lp);
    mid.connect(lp);
    lp.connect(gain).connect(bus('engine'));
    const hiss = c.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.5;
    const hissGain = c.createGain();
    hissGain.gain.value = 0;
    hiss.connect(bp).connect(hissGain).connect(bus('engine'));
    const boostOsc = c.createOscillator();
    boostOsc.type = 'triangle';
    boostOsc.frequency.value = 138;
    const boostGain = c.createGain();
    boostGain.gain.value = 0;
    boostOsc.connect(boostGain).connect(bus('boost'));
    low.start();
    mid.start();
    hiss.start();
    boostOsc.start();
    engine = { low, mid, hiss, lp, gain, hissGain, boostGain, boostOsc };
  };
  const ensureRcs = (c: AudioContext) => {
    if (rcsNode || !noise) return;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(hp).connect(gain).connect(bus('rcs'));
    src.start();
    rcsNode = { src, gain };
  };

  return {
    setEngine(throttle, boost, speedFrac) {
      safe((c) => {
        ensureEngine(c);
        if (!engine) return;
        const t = c.currentTime;
        const idle = 0.12;
        const level = idle + 0.88 * Math.min(1, throttle);
        engine.gain.gain.setTargetAtTime(level, t, 0.12);
        engine.lp.frequency.setTargetAtTime(160 + 520 * throttle + 260 * speedFrac, t, 0.15);
        engine.low.frequency.setTargetAtTime(42 + 26 * throttle + 12 * speedFrac, t, 0.2);
        engine.mid.frequency.setTargetAtTime(84 + 52 * throttle + 24 * speedFrac, t, 0.2);
        engine.hissGain.gain.setTargetAtTime(0.25 * throttle + 0.35 * speedFrac, t, 0.15);
        engine.boostGain.gain.setTargetAtTime(boost ? 1 : 0, t, boost ? 0.08 : 0.3);
      });
    },
    setRcs(intensity) {
      safe((c) => {
        ensureRcs(c);
        if (rcsNode) rcsNode.gain.gain.setTargetAtTime(Math.min(1, intensity), c.currentTime, 0.04);
      });
    },
    laser() {
      safe((c) => {
        if (playSample(c, 'weapon', 1)) return;
        tone(c, 'weapon', 'sawtooth', 640, 190, 0.5, 0.1);
        tone(c, 'weapon', 'square', 1280, 300, 0.12, 0.06);
      });
    },
    shieldHit() {
      safe((c) => {
        if (playSample(c, 'shield', 1)) return;
        tone(c, 'shield', 'sine', 720, 240, 0.5, 0.22);
        burst(c, 'shield', 'bandpass', 3200, 800, 0.4, 0.14);
      });
    },
    shieldDown() {
      safe((c) => {
        tone(c, 'shield', 'sine', 520, 60, 0.7, 0.7);
        tone(c, 'warning', 'square', 440, 220, 0.3, 0.35, 0.1);
        burst(c, 'shield', 'lowpass', 1800, 200, 0.5, 0.5);
      });
    },
    hullHit() {
      safe((c) => {
        burst(c, 'shield', 'lowpass', 900, 120, 0.8, 0.3);
        tone(c, 'shield', 'triangle', 140, 50, 0.5, 0.25);
      });
    },
    boom() {
      safe((c) => {
        burst(c, 'hyperspace', 'lowpass', 900, 60, 0.9, 1.8);
        tone(c, 'hyperspace', 'sine', 90, 28, 0.6, 1.4);
      });
    },
    warn(kind) {
      safe((c) => {
        // Warnings are rate-limited: a stuck caution must not become a siren.
        if (c.currentTime - lastWarn < 0.6) return;
        lastWarn = c.currentTime;
        if (kind === 'danger') {
          tone(c, 'warning', 'square', 880, 880, 0.5, 0.09);
          tone(c, 'warning', 'square', 660, 660, 0.5, 0.09, 0.14);
        } else if (kind === 'lock') {
          tone(c, 'warning', 'sine', 1200, 1200, 0.35, 0.05);
          tone(c, 'warning', 'sine', 1200, 1200, 0.35, 0.05, 0.09);
        } else if (kind === 'discovery') {
          tone(c, 'warning', 'sine', 660, 660, 0.3, 0.12);
          tone(c, 'warning', 'sine', 990, 990, 0.3, 0.2, 0.14);
        } else {
          tone(c, 'warning', 'triangle', 520, 520, 0.35, 0.12);
        }
      });
    },
    charge(seconds) {
      safe((c) => {
        tone(c, 'jumpCharge', 'sine', 110, 880, 0.6, seconds);
        tone(c, 'jumpCharge', 'sawtooth', 55, 440, 0.18, seconds);
      });
    },
    whoosh() {
      safe((c) => {
        if (playSample(c, 'hyperspace', 1)) return;
        burst(c, 'hyperspace', 'lowpass', 200, 4200, 0.7, 1.2);
        tone(c, 'hyperspace', 'sine', 60, 900, 0.3, 0.9);
      });
    },
    setSample(channel, buffer) {
      samples.set(channel, buffer);
    },
    dispose() {
      try {
        engine?.low.stop();
        engine?.mid.stop();
        engine?.hiss.stop();
        engine?.boostOsc.stop();
        rcsNode?.src.stop();
      } catch {
        // Already stopped.
      }
      engine = null;
      rcsNode = null;
      void ctx?.close();
      ctx = null;
      noise = null;
      buses.clear();
    },
  };
}
