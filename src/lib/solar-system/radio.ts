// Ship's radio. Everything is synthesised in Web Audio: the squelch that
// opens and closes a channel, the carrier hiss underneath, and an alien
// voice built from a formant-shaped noise bed with a warbling FM tone over
// it — sibilant, tonal, nothing like a human, but plainly a voice.

export interface RadioHandle {
  /** Channel opens: a burst of static and the carrier hiss settles in. */
  open: () => void;
  /** A phrase of alien speech lasting `dur` seconds. */
  speak: (dur: number, seed: number) => void;
  /** Channel closes with a squelch tail. */
  close: () => void;
  dispose: () => void;
}

export function makeRadio(): RadioHandle {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let carrier: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  const ready = () => {
    if (!ctx) ctx = new AudioContext();
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
      // No audio (autoplay policy, missing API) — the transcript still shows.
    }
  };
  const burst = (c: AudioContext, t0: number, dur: number, gain: number, band: number) => {
    if (!noise) return;
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = band;
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };
  return {
    open() {
      safe((c) => {
        const t0 = c.currentTime;
        burst(c, t0, 0.12, 0.5, 2400);
        burst(c, t0 + 0.14, 0.06, 0.3, 4000);
        if (carrier) return;
        if (!noise) return;
        const src = c.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1800;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.3);
        src.connect(lp).connect(g).connect(c.destination);
        src.start(t0);
        carrier = { src, gain: g };
      });
    },
    speak(dur, seed) {
      safe((c) => {
        const t0 = c.currentTime;
        let s = seed >>> 0;
        const rnd = () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
        // Syllables: each a short FM warble over a formant hiss.
        let t = t0;
        while (t < t0 + dur) {
          const len = 0.08 + rnd() * 0.22;
          const f0 = 180 + rnd() * 520;
          const osc = c.createOscillator();
          osc.type = rnd() > 0.5 ? 'square' : 'sawtooth';
          osc.frequency.setValueAtTime(f0, t);
          osc.frequency.exponentialRampToValueAtTime(f0 * (0.6 + rnd() * 1.2), t + len);
          const vib = c.createOscillator();
          vib.frequency.value = 18 + rnd() * 30;
          const vibGain = c.createGain();
          vibGain.gain.value = f0 * 0.12;
          vib.connect(vibGain).connect(osc.frequency);
          const bp = c.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 600 + rnd() * 1800;
          bp.Q.value = 3;
          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0005, t + len);
          osc.connect(bp).connect(g).connect(c.destination);
          osc.onended = () => {
            osc.disconnect();
            vib.disconnect();
            vibGain.disconnect();
            bp.disconnect();
            g.disconnect();
          };
          osc.start(t);
          vib.start(t);
          osc.stop(t + len + 0.01);
          vib.stop(t + len + 0.01);
          if (rnd() > 0.6) burst(c, t, len * 0.8, 0.05, 3000 + rnd() * 3000);
          t += len + (rnd() > 0.75 ? 0.16 : 0.02);
        }
      });
    },
    close() {
      safe((c) => {
        const t0 = c.currentTime;
        burst(c, t0, 0.09, 0.4, 3000);
        if (carrier) {
          carrier.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
          const dead = carrier;
          carrier = null;
          dead.src.stop(t0 + 0.3);
        }
      });
    },
    dispose() {
      try {
        carrier?.src.stop();
      } catch {
        // Already stopped.
      }
      carrier = null;
      void ctx?.close();
      ctx = null;
      noise = null;
    },
  };
}
