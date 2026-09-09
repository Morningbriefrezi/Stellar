// Flight audio, cut back to the two things Explore Mode is allowed to make
// a noise about: the hyperdrive, and something blowing up. The drive hum,
// the RCS puffs, the warning tones and the radio chatter are gone on
// purpose — the deck is silent unless you jump or you shoot. Synthesised in
// Web Audio, created lazily on the first call after a user gesture, and
// silent if the browser refuses.

export interface FlightAudio {
  /** Cannon shot. */
  laser: () => void;
  /** An explosion: a hull, a station, a world. */
  boom: () => void;
  /** Entering and leaving light speed. */
  whoosh: () => void;
  dispose: () => void;
}

/** Deliberately quiet — a shot is a tick, a jump is a swell. */
const MASTER_GAIN = 0.07;

export function makeFlightAudio(): FlightAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;

  const ready = (): AudioContext => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  };
  const safe = (fn: (c: AudioContext) => void) => {
    try {
      fn(ready());
    } catch {
      // No audio available (autoplay policy, missing API) — the flight stays silent.
    }
  };
  const tone = (c: AudioContext, type: OscillatorType, f0: number, f1: number, gain: number, dur: number) => {
    if (!master) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    osc.connect(g).connect(master);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };
  const burst = (c: AudioContext, filter: BiquadFilterType, f0: number, f1: number, gain: number, dur: number) => {
    if (!noise || !master) return;
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
    src.connect(flt).connect(g).connect(master);
    src.onended = () => {
      src.disconnect();
      flt.disconnect();
      g.disconnect();
    };
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };

  return {
    laser() {
      safe((c) => {
        tone(c, 'sawtooth', 640, 190, 0.5, 0.1);
        tone(c, 'square', 1280, 300, 0.12, 0.06);
      });
    },
    boom() {
      safe((c) => {
        burst(c, 'lowpass', 900, 60, 1.6, 1.8);
        tone(c, 'sine', 90, 28, 1.1, 1.4);
      });
    },
    whoosh() {
      safe((c) => {
        burst(c, 'lowpass', 200, 4200, 1.2, 1.2);
        tone(c, 'sine', 60, 900, 0.5, 0.9);
      });
    },
    dispose() {
      void ctx?.close();
      ctx = null;
      master = null;
      noise = null;
    },
  };
}
