'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsRight, Pause, Rocket, Shield, X, Zap, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  attachDesktopControls,
  clearFlightInput,
  zoomFlightCamera,
  MARKER_MAX,
  type FlightAlert,
  type FlightSession,
  type ShipKind,
  type SpeedMode,
} from '@/lib/solar-system/player-ship';

interface PlayerShipProps {
  session: FlightSession;
  /** Fires when Explore Mode is entered (countdown starts) or left. */
  onActiveChange: (active: boolean) => void;
}

type Phase = 'idle' | 'countdown' | 'flying';

const STICK_RADIUS = 62;
/** Auto-cruise throttle on touch: a phone has no spare thumb for a throttle,
 *  so the ship always makes way and the controls are steer, boost, brake. */
const CRUISE = 0.85;
const BRAKE = -0.7;
const MODES: SpeedMode[] = ['cruise', 'fast', 'jump'];
const SHIPS: ShipKind[] = ['xfoil', 'interceptor'];
const SOLAR_IDS = new Set(['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
const MARKER_SLOTS = Array.from({ length: MARKER_MAX }, (_, i) => i);

interface Stick {
  id: number;
  /** Where the thumb landed — the stick centres itself there. */
  ox: number;
  oy: number;
  x: number;
  y: number;
}

function fmtKm(km: number): string {
  if (km >= 1e9) return `${(km / 1e9).toFixed(2)} B`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)} M`;
  return Math.round(km).toLocaleString('en-US');
}

/** The console reads like an instrument: two decimals at walking pace, whole
 *  numbers once the figure is long enough that decimals are noise. */
function fmtSpeed(kmS: number): string {
  if (kmS >= 1000) return Math.round(kmS).toLocaleString('en-US');
  if (kmS >= 10) return kmS.toFixed(1);
  return kmS.toFixed(2);
}

/**
 * Explore Mode chrome: the hangar (ship choice + Explore), launch countdown,
 * the flight deck — a heading block at the top, target brackets out on the
 * glass, and one console along the bottom carrying the compass, the
 * odometer, the speed dial and the shield / energy / boost bars — plus the
 * touch controls. The deck is painted imperatively from `session.telemetry`
 * each frame; React only renders on phase changes, never inside the loop.
 */
export function PlayerShip({ session, onActiveChange }: PlayerShipProps) {
  const t = useTranslations('solarSystem.flight');
  const tb = useTranslations('solarSystem.bodies');
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(3);
  const [touch, setTouch] = useState(false);
  const [shipKind, setShipKind] = useState<ShipKind>(session.shipKind);
  /** On a phone the hangar starts as a single key and opens on demand, so
   *  the panel never sits on top of the sky while you are just looking. */
  const [hangarOpen, setHangarOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLCanvasElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const gaugeRef = useRef<HTMLCanvasElement>(null);
  const placeRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLSpanElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  const odoRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<HTMLSpanElement>(null);
  const foilsRef = useRef<HTMLSpanElement>(null);
  const killsRef = useRef<HTMLSpanElement>(null);
  const pilotRef = useRef<HTMLDivElement>(null);
  const commsRef = useRef<HTMLDivElement>(null);
  const commsHeadRef = useRef<HTMLSpanElement>(null);
  const commsLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const markerTextRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const ejectRef = useRef<HTMLButtonElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pctRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const flashRef = useRef<HTMLDivElement>(null);
  const whiteRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const jumpBarRef = useRef<HTMLDivElement>(null);
  const crashRef = useRef<HTMLDivElement>(null);
  const respawnRef = useRef<HTMLSpanElement>(null);
  const modeBtnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const detachRef = useRef<(() => void) | null>(null);
  const timersRef = useRef<number[]>([]);
  const brakeRef = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  useEffect(() => {
    setTouch(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  // The open hangar covers the drag hint; fade the hint out rather than
  // leaving a sliver of it behind the panel.
  useEffect(() => {
    if (!hangarOpen) return;
    document.body.dataset.solarHangar = '1';
    return () => {
      delete document.body.dataset.solarHangar;
    };
  }, [hangarOpen]);

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  };

  const exit = useCallback(() => {
    if (phaseRef.current === 'idle') return;
    clearTimers();
    detachRef.current?.();
    detachRef.current = null;
    brakeRef.current = false;
    session.active = false;
    clearFlightInput(session.input);
    setPhase('idle');
    onActiveChange(false);
  }, [session, onActiveChange]);
  const exitRef = useRef(exit);
  exitRef.current = exit;

  const enter = () => {
    if (phaseRef.current !== 'idle') return;
    session.shipKind = shipKind;
    setPhase('countdown');
    setCount(3);
    onActiveChange(true);
    // Attach inside the click so the pointer-lock request counts as a gesture.
    if (!touch && rootRef.current) {
      detachRef.current = attachDesktopControls(session, rootRef.current, () => exitRef.current());
    }
    const at = (ms: number, fn: () => void) => timersRef.current.push(window.setTimeout(fn, ms));
    at(1000, () => setCount(2));
    at(2000, () => setCount(1));
    at(3000, () => setCount(0));
    at(3700, () => {
      session.telemetry.kills = 0;
      session.telemetry.odometerKm = 0;
      session.active = true;
      setPhase('flying');
    });
  };

  // Unmount: tear down without touching React state.
  useEffect(
    () => () => {
      clearTimers();
      detachRef.current?.();
      detachRef.current = null;
      session.active = false;
      clearFlightInput(session.input);
    },
    [session],
  );

  // ── Touch steering. One stick, anywhere in the left half of the screen:
  // left/right yaws, up/down pitches. The right half is reserved for the
  // action buttons so a thumb never has to share space with the stick. ──
  const stickRef = useRef<Stick>({ id: -1, ox: 0, oy: 0, x: 0, y: 0 });
  useEffect(() => {
    const pad = padRef.current;
    if (phase !== 'flying' || !touch || !pad) return;
    const stick = stickRef.current;
    const input = session.input;
    const apply = () => {
      input.yaw = stick.x;
      input.pitch = -stick.y;
    };
    const onStart = (e: TouchEvent) => {
      const rect = pad.getBoundingClientRect();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const tch = e.changedTouches[i];
        if (stick.id >= 0) continue;
        stick.id = tch.identifier;
        stick.ox = tch.clientX - rect.left;
        stick.oy = tch.clientY - rect.top;
        stick.x = stick.y = 0;
      }
      apply();
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      const rect = pad.getBoundingClientRect();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const tch = e.changedTouches[i];
        if (tch.identifier !== stick.id) continue;
        let dx = (tch.clientX - rect.left - stick.ox) / STICK_RADIUS;
        let dy = (tch.clientY - rect.top - stick.oy) / STICK_RADIUS;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        stick.x = dx;
        stick.y = dy;
        apply();
      }
      e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier !== stick.id) continue;
        stick.id = -1;
        stick.x = stick.y = 0;
        apply();
      }
    };
    pad.addEventListener('touchstart', onStart, { passive: false });
    pad.addEventListener('touchmove', onMove, { passive: false });
    pad.addEventListener('touchend', onEnd);
    pad.addEventListener('touchcancel', onEnd);
    return () => {
      pad.removeEventListener('touchstart', onStart);
      pad.removeEventListener('touchmove', onMove);
      pad.removeEventListener('touchend', onEnd);
      pad.removeEventListener('touchcancel', onEnd);
      stick.id = -1;
      stick.x = stick.y = 0;
    };
  }, [phase, touch, session]);

  // ── Deck paint loop — DOM writes + three small canvases, no React state. ──
  useEffect(() => {
    if (phase !== 'flying') return;
    const tel = session.telemetry;
    const input = session.input;
    const radar = radarRef.current;
    const gauge = gaugeRef.current;
    const pad = padRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The console scales with the viewport, so the canvases take their
    // backing store from the box they actually occupy.
    let radarPx = 0;
    let gaugePx = 0;
    const sizeCanvases = () => {
      if (radar) {
        radarPx = radar.clientWidth;
        radar.width = radar.height = Math.max(1, Math.round(radarPx * dpr));
      }
      if (gauge) {
        gaugePx = gauge.clientWidth;
        gauge.width = gauge.height = Math.max(1, Math.round(gaugePx * dpr));
      }
      if (pad) {
        pad.width = Math.max(1, pad.clientWidth * dpr);
        pad.height = Math.max(1, pad.clientHeight * dpr);
      }
    };
    sizeCanvases();
    window.addEventListener('resize', sizeCanvases);

    const bodyName = (id: string) => {
      if (SOLAR_IDS.has(id)) return tb(`${id}.name`);
      return t.has(`bodies.${id}`) ? t(`bodies.${id}`) : id.toUpperCase();
    };
    const systemName = (id: string) => t(`systems.${id}`);
    const alertText = (a: FlightAlert): string => {
      if (a === 'jump' || a === 'charging') return t(`alerts.${a}`, { target: systemName(lastTarget) });
      if (a === 'arrived') return t('alerts.arrived', { system: systemName(lastSystem) });
      return t(`alerts.${a}`);
    };
    const setText = (el: HTMLElement | null, text: string) => {
      if (el && el.textContent !== text) el.textContent = text;
    };

    let raf = 0;
    let lastKills = -1;
    let lastSpeed = '';
    let lastOdo = '';
    let lastPlace = '';
    let lastMode: SpeedMode | '' = '';
    let lastFoils: boolean | null = null;
    let lastAlt = -1;
    let lastSystem = '';
    let lastTarget = '';
    let lastAlert: FlightAlert | null = null;
    let lastCrashed: boolean | null = null;
    let lastRespawn = -1;
    let lastPilotKey = '';
    let lastComms = '';
    let lastMarkerCount = -1;
    const lastBar = [-1, -1, -1];
    let shownFrac = 0;
    let commsText: string[] = [];

    const paint = () => {
      raf = requestAnimationFrame(paint);

      // Touch flight holds a cruise throttle so steering is the only stick.
      if (touch) input.thrust = brakeRef.current ? BRAKE : CRUISE;

      const jumping = tel.jumpPhase === 'travel';
      const kmS = jumping ? 299792 : tel.speedKmS;
      const speedText = fmtSpeed(kmS);
      if (speedText !== lastSpeed) {
        lastSpeed = speedText;
        setText(speedRef.current, speedText);
        setText(velRef.current, `${speedText} ${t('kmS')}`);
      }
      const odoText = fmtKm(tel.odometerKm);
      if (odoText !== lastOdo) {
        lastOdo = odoText;
        setText(odoRef.current, odoText);
      }
      // The heading block names where you are: a body if one is close
      // enough to be orbiting, the star system otherwise.
      const place = tel.nearId ? t('orbitOf', { body: bodyName(tel.nearId) }) : systemName(tel.systemName);
      if (place !== lastPlace) {
        lastPlace = place;
        setText(placeRef.current, place);
      }
      const alt = tel.nearId ? Math.round(tel.nearAltKm / 10) : -1;
      if (alt !== lastAlt) {
        lastAlt = alt;
        setText(altRef.current, alt < 0 ? '—' : `${fmtKm(alt * 10)} km`);
      }
      const modeKey = tel.pilot === 'eva' ? 'eva' : tel.mode;
      if (modeKey !== lastMode) {
        lastMode = modeKey as SpeedMode;
        setText(modeRef.current, t(`modes.${modeKey}`));
        modeBtnRefs.current.forEach((btn, i) => {
          if (btn) btn.dataset.active = MODES[i] === tel.mode && tel.pilot === 'ship' ? 'true' : 'false';
        });
      }
      if (tel.foilsOpen !== lastFoils) {
        lastFoils = tel.foilsOpen;
        if (foilsRef.current) foilsRef.current.dataset.on = tel.foilsOpen ? 'true' : 'false';
      }
      const sys = tel.systemName;
      if (sys !== lastSystem) lastSystem = sys;
      if (tel.targetName !== lastTarget) lastTarget = tel.targetName;
      if (rootRef.current && rootRef.current.dataset.view !== tel.view) rootRef.current.dataset.view = tel.view;
      const pilotKey = tel.pilot === 'eva' ? (tel.canBoard ? 'board' : 'eva') : 'ship';
      if (pilotKey !== lastPilotKey) {
        lastPilotKey = pilotKey;
        if (pilotRef.current) {
          pilotRef.current.hidden = pilotKey === 'ship';
          setText(pilotRef.current, pilotKey === 'board' ? t(touch ? 'evaBoardTouch' : 'evaBoard') : t('evaOut'));
        }
        setText(ejectRef.current, t(pilotKey === 'ship' ? 'eject' : 'board'));
      }
      if (tel.alert !== lastAlert) {
        lastAlert = tel.alert;
        const el = alertRef.current;
        if (el) {
          el.hidden = !tel.alert;
          el.dataset.kind = tel.alert;
          if (tel.alert) setText(el.firstElementChild as HTMLElement | null, alertText(tel.alert));
        }
      }
      if (jumpBarRef.current) {
        jumpBarRef.current.style.width = tel.jumpPhase === 'none' ? '0%' : `${Math.round(tel.jumpT * 100)}%`;
      }
      // Incoming transmission: the header names the caller, each line is
      // typed out as the voice speaks it.
      if (tel.commsFrom !== lastComms) {
        lastComms = tel.commsFrom;
        const box = commsRef.current;
        if (box) {
          box.hidden = !tel.commsFrom;
          if (tel.commsFrom) {
            setText(commsHeadRef.current, t('commsHeader', { from: bodyName(tel.commsFrom) }));
            commsText = [1, 2, 3, 4].map((n) => (t.has(`comms.${tel.commsFrom}.l${n}`) ? t(`comms.${tel.commsFrom}.l${n}`) : ''));
          }
        }
      }
      if (tel.commsFrom) {
        commsLineRefs.current.forEach((el, i) => {
          const full = commsText[i] ?? '';
          const n = i + 1;
          const shown = n < tel.commsLine ? full : n === tel.commsLine ? full.slice(0, Math.round(full.length * tel.commsProgress)) : '';
          setText(el, shown);
          if (el) el.dataset.live = n === tel.commsLine ? 'true' : 'false';
        });
      }

      // ── Target brackets: the canvas hands over screen positions, the
      // deck just parks a bracket on each one. ──
      if (tel.markerCount !== lastMarkerCount) lastMarkerCount = tel.markerCount;
      for (let i = 0; i < MARKER_MAX; i++) {
        const el = markerRefs.current[i];
        if (!el) continue;
        if (i >= tel.markerCount) {
          if (!el.hidden) el.hidden = true;
          continue;
        }
        if (el.hidden) el.hidden = false;
        el.style.transform = `translate3d(${Math.round(tel.markers[i * 2])}px, ${Math.round(tel.markers[i * 2 + 1])}px, 0)`;
        setText(markerTextRefs.current[i], bodyName(tel.markerIds[i] ?? ''));
      }

      // ── Shield, energy, boost. ──
      const levels = [tel.hp / tel.maxHp, tel.energy, tel.boostCharge];
      for (let i = 0; i < 3; i++) {
        const pct = Math.max(0, Math.min(100, Math.round(levels[i] * 100)));
        if (pct === lastBar[i]) continue;
        lastBar[i] = pct;
        const fill = barRefs.current[i];
        if (fill) {
          fill.style.width = `${pct}%`;
          fill.dataset.low = pct <= 25 ? 'true' : 'false';
        }
        setText(pctRefs.current[i], `${pct}%`);
      }
      if (tel.kills !== lastKills) {
        lastKills = tel.kills;
        setText(killsRef.current, String(tel.kills));
      }
      if (flashRef.current) flashRef.current.style.opacity = String(tel.hitFlash * 0.4);
      if (whiteRef.current) whiteRef.current.style.opacity = String(tel.jumpFlash);
      if (heatRef.current) heatRef.current.style.opacity = String(tel.heat * 0.85);
      if (tel.crashed !== lastCrashed) {
        lastCrashed = tel.crashed;
        if (crashRef.current) crashRef.current.hidden = !tel.crashed;
      }
      const respawn = tel.crashed ? Math.ceil(tel.respawnIn) : -1;
      if (respawn !== lastRespawn) {
        lastRespawn = respawn;
        if (respawn >= 0) setText(respawnRef.current, t('respawn', { n: respawn }));
      }

      // ── Speed dial: a ring open at the bottom, filled to the regime's
      // ceiling, with a bright index at twelve o'clock. ──
      if (gauge && gaugePx > 0) {
        const ctx = gauge.getContext('2d');
        if (ctx) {
          const s = gaugePx * dpr;
          const cx = s / 2;
          const r = s / 2 - 5 * dpr;
          // Open at the bottom: from 8 o'clock clockwise round to 4 o'clock.
          const a0 = Math.PI * 0.72;
          const a1 = Math.PI * 2.28;
          const frac = tel.maxKmS > 0 ? Math.min(1, kmS / tel.maxKmS) : 0;
          shownFrac += (frac - shownFrac) * 0.18;
          ctx.clearRect(0, 0, s, s);
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(120, 174, 232, 0.22)';
          ctx.lineWidth = 5 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cx, r, a0, a1);
          ctx.stroke();
          ctx.strokeStyle = shownFrac > 0.92 ? '#ff6a5a' : '#3fa9ff';
          ctx.lineWidth = 5 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cx, r, a0, a0 + (a1 - a0) * Math.max(0.004, shownFrac));
          ctx.stroke();
          // Index mark at the top.
          ctx.strokeStyle = 'rgba(240, 248, 255, 0.95)';
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.moveTo(cx, cx - r - 3 * dpr);
          ctx.lineTo(cx, cx - r + 5 * dpr);
          ctx.stroke();
          // Fine ticks inside the open bottom of the ring.
          ctx.strokeStyle = 'rgba(150, 196, 244, 0.45)';
          ctx.lineWidth = dpr;
          const ir = r - 7 * dpr;
          for (let i = 0; i <= 8; i++) {
            const a = Math.PI * 0.62 + (Math.PI * 1.76 * i) / 8;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * ir, cx + Math.sin(a) * ir);
            ctx.lineTo(cx + Math.cos(a) * (ir - 3 * dpr), cx + Math.sin(a) * (ir - 3 * dpr));
            ctx.stroke();
          }
        }
      }

      // ── Compass: range rings, the ship's own heading arrow, contacts. ──
      if (radar && radarPx > 0) {
        const ctx = radar.getContext('2d');
        if (ctx) {
          const s = radarPx * dpr;
          const cx = s / 2;
          ctx.clearRect(0, 0, s, s);
          ctx.fillStyle = 'rgba(6, 14, 28, 0.66)';
          ctx.beginPath();
          ctx.arc(cx, cx, cx - dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(120, 174, 232, 0.4)';
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.arc(cx, cx, cx - dpr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(120, 174, 232, 0.22)';
          for (const k of [0.42, 0.71]) {
            ctx.beginPath();
            ctx.arc(cx, cx, (cx - dpr) * k, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = '#4fb3ff';
          ctx.beginPath();
          ctx.moveTo(cx, cx - 7 * dpr);
          ctx.lineTo(cx + 5 * dpr, cx + 6 * dpr);
          ctx.lineTo(cx, cx + 3 * dpr);
          ctx.lineTo(cx - 5 * dpr, cx + 6 * dpr);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ff5a5a';
          const reach = cx - 5 * dpr;
          for (let i = 0; i < tel.radarCount; i++) {
            const x = cx + tel.radar[i * 2] * reach;
            const y = cx - tel.radar[i * 2 + 1] * reach;
            ctx.beginPath();
            ctx.arc(x, y, 2.2 * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (pad) {
        const ctx = pad.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, pad.width, pad.height);
          const st = stickRef.current;
          const r = STICK_RADIUS * dpr;
          // Idle, the stick shows a home ring in the left thumb zone so it is
          // obvious where to reach; on contact it re-centres under the thumb.
          const active = st.id >= 0;
          const ox = active ? st.ox * dpr : pad.width * 0.26;
          const oy = active ? st.oy * dpr : pad.height - r - 20 * dpr;
          ctx.strokeStyle = active ? 'rgba(79, 179, 255, 0.5)' : 'rgba(180, 212, 246, 0.2)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(ox, oy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = active ? 'rgba(79, 179, 255, 0.5)' : 'rgba(180, 212, 246, 0.14)';
          ctx.beginPath();
          ctx.arc(ox + st.x * r, oy + st.y * r, r * 0.36, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizeCanvases);
      input.thrust = 0;
    };
  }, [phase, session, touch, t, tb]);

  const hold = (key: 'fire' | 'boost') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      session.input[key] = true;
    },
    onPointerUp: () => {
      session.input[key] = false;
    },
    onPointerCancel: () => {
      session.input[key] = false;
    },
    onPointerLeave: () => {
      session.input[key] = false;
    },
  });
  const oneShot = (key: 'eject' | 'viewToggle') => () => {
    session.input[key] = true;
  };
  const holdBrake = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      brakeRef.current = true;
    },
    onPointerUp: () => {
      brakeRef.current = false;
    },
    onPointerCancel: () => {
      brakeRef.current = false;
    },
    onPointerLeave: () => {
      brakeRef.current = false;
    },
  };

  const STATS = [
    { key: 'shield', icon: <Shield size={12} strokeWidth={2.2} aria-hidden /> },
    { key: 'energy', icon: <Zap size={12} strokeWidth={2.2} aria-hidden /> },
    { key: 'boost', icon: <ChevronsRight size={12} strokeWidth={2.4} aria-hidden /> },
  ] as const;

  return (
    <div ref={rootRef} className="flight-hud" data-phase={phase}>
      {phase === 'idle' && touch && !hangarOpen && (
        <button
          type="button"
          className="flight-hud__hangar-key"
          onClick={() => setHangarOpen(true)}
          aria-expanded={false}
          aria-label={t('hangar')}
        >
          <Rocket size={17} strokeWidth={2.2} aria-hidden />
        </button>
      )}

      {phase === 'idle' && (!touch || hangarOpen) && (
        <div className="flight-hud__hangar" role="group" aria-label={t('hangar')}>
          <div className="flight-hud__hangar-head">
            <span className="flight-hud__panel-label">{t('hangar')}</span>
            {touch && (
              <button
                type="button"
                className="flight-hud__hangar-close"
                onClick={() => setHangarOpen(false)}
                aria-label={t('exit')}
              >
                <X size={14} strokeWidth={2.4} aria-hidden />
              </button>
            )}
          </div>
          <div className="flight-hud__ships">
            {SHIPS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="flight-hud__ship"
                data-active={kind === shipKind ? 'true' : 'false'}
                onClick={() => setShipKind(kind)}
              >
                <span className="flight-hud__led" aria-hidden />
                {t(`ships.${kind}`)}
              </button>
            ))}
          </div>
          <button type="button" className="flight-hud__explore" onClick={enter}>
            <Rocket size={15} strokeWidth={2.2} aria-hidden />
            <span>{t('explore')}</span>
          </button>
        </div>
      )}

      {phase === 'countdown' && (
        <div className="flight-hud__countdown" role="status" aria-live="assertive">
          <span key={count} className="flight-hud__count">
            {count > 0 ? count : t('launch')}
          </span>
        </div>
      )}

      {phase !== 'idle' && (
        <button
          type="button"
          className="flight-hud__exit"
          onClick={exit}
          aria-label={t('exit')}
        >
          {phase === 'flying' ? <Pause size={18} strokeWidth={2.2} aria-hidden /> : <X size={18} strokeWidth={2.2} aria-hidden />}
        </button>
      )}

      {phase === 'flying' && (
        <>
          <div ref={heatRef} className="flight-hud__heat" aria-hidden />
          <div ref={flashRef} className="flight-hud__flash" aria-hidden />
          <div ref={whiteRef} className="flight-hud__white" aria-hidden />

          {/* Heading block, top left: where you are, how high, how fast. */}
          <div className="flight-hud__head">
            <span ref={placeRef} className="flight-hud__place">{t('systems.sol')}</span>
            <span className="flight-hud__headrow">
              <span className="flight-hud__headkey">{t('altShort')}</span>
              <span ref={altRef} className="flight-hud__headval">—</span>
            </span>
            <span className="flight-hud__headrow">
              <span className="flight-hud__headkey">{t('velShort')}</span>
              <span ref={velRef} className="flight-hud__headval">0.00 {t('kmS')}</span>
            </span>
            <span className="flight-hud__headrow flight-hud__headrow--minor">
              <span ref={foilsRef} className="flight-hud__foils" data-on="false">
                <span className="flight-hud__led" aria-hidden />
                {t('foils')}
              </span>
              <span className="flight-hud__headkey">{t('kills')}</span>
              <span ref={killsRef} className="flight-hud__headval">0</span>
            </span>
            <div ref={pilotRef} className="flight-hud__pilot" hidden />
          </div>

          {/* Target brackets, parked on projected screen positions. */}
          {MARKER_SLOTS.map((i) => (
            <div
              key={i}
              ref={(el) => {
                markerRefs.current[i] = el;
              }}
              className="flight-hud__marker"
              aria-hidden
              hidden
            >
              <span className="flight-hud__marker-box" />
              <span
                ref={(el) => {
                  markerTextRefs.current[i] = el;
                }}
                className="flight-hud__marker-name"
              />
            </div>
          ))}

          <div className="flight-hud__modes" role="group" aria-label={t('speedMode')}>
            {MODES.map((m, i) => (
              <button
                key={m}
                ref={(el) => {
                  modeBtnRefs.current[i] = el;
                }}
                type="button"
                className={`flight-hud__mode flight-hud__mode--${m}`}
                data-active={m === 'cruise' ? 'true' : 'false'}
                onClick={() => {
                  session.input.modeRequest = m;
                }}
              >
                <span className="flight-hud__led" aria-hidden />
                {t(`modes.${m}`)}
              </button>
            ))}
            <span ref={modeRef} className="flight-hud__mode-live" aria-live="polite">{t('modes.cruise')}</span>
          </div>

          <div ref={alertRef} className="flight-hud__alert" role="status" aria-live="polite" hidden>
            <span />
            <div ref={jumpBarRef} className="flight-hud__jumpbar" aria-hidden />
          </div>

          {/* The console: compass, odometer, speed dial, three bars. */}
          <div className="flight-hud__console">
            <canvas ref={radarRef} className="flight-hud__compass" aria-hidden />
            <div className="flight-hud__panel">
              <div className="flight-hud__odo">
                <span className="flight-hud__cap">{t('odometer')}</span>
                <span className="flight-hud__odo-read">
                  <span ref={odoRef} className="flight-hud__odo-value">0</span>
                  <span className="flight-hud__unit">km</span>
                </span>
              </div>
              <div className="flight-hud__dial">
                <canvas ref={gaugeRef} aria-hidden />
                <span className="flight-hud__dial-read">
                  <span className="flight-hud__cap">{t('speed')}</span>
                  <span ref={speedRef} className="flight-hud__dial-value">0.00</span>
                  <span className="flight-hud__unit">{t('kmS')}</span>
                </span>
              </div>
              <div className="flight-hud__stats">
                {STATS.map((stat, i) => (
                  <div key={stat.key} className="flight-hud__stat">
                    <span className="flight-hud__stat-icon">{stat.icon}</span>
                    <span className="flight-hud__stat-name">{t(stat.key)}</span>
                    <span className="flight-hud__stat-track">
                      <span
                        ref={(el) => {
                          barRefs.current[i] = el;
                        }}
                        className="flight-hud__stat-fill"
                        data-low="false"
                      />
                    </span>
                    <span
                      ref={(el) => {
                        pctRefs.current[i] = el;
                      }}
                      className="flight-hud__stat-pct"
                    >
                      100%
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flight-hud__cam" role="group" aria-label={t('camera')}>
              <button
                type="button"
                className="flight-hud__cam-btn"
                onClick={() => zoomFlightCamera(session.input, -1)}
                aria-label={t('camIn')}
              >
                <ZoomIn size={13} strokeWidth={2.2} aria-hidden />
              </button>
              <button
                type="button"
                className="flight-hud__cam-btn"
                onClick={() => zoomFlightCamera(session.input, 1)}
                aria-label={t('camOut')}
              >
                <ZoomOut size={13} strokeWidth={2.2} aria-hidden />
              </button>
            </div>
          </div>

          {!touch && <div className="flight-hud__hint">{t('hint')}</div>}

          <div ref={commsRef} className="flight-hud__comms" role="log" aria-live="polite" hidden>
            <span ref={commsHeadRef} className="flight-hud__comms-head" />
            {[0, 1, 2, 3].map((i) => (
              <p
                key={i}
                ref={(el) => {
                  commsLineRefs.current[i] = el;
                }}
                className="flight-hud__comms-line"
              />
            ))}
          </div>

          <div ref={crashRef} className="flight-hud__crash" role="alert" hidden>
            <span className="flight-hud__crash-title">{t('hullLost')}</span>
            <span ref={respawnRef} className="flight-hud__crash-sub" />
          </div>

          {touch && (
            <>
              <canvas ref={padRef} className="flight-hud__pad" aria-hidden />
              <button ref={ejectRef} type="button" className="flight-hud__eject" onClick={oneShot('eject')}>
                {t('eject')}
              </button>
              <button type="button" className="flight-hud__view" onClick={oneShot('viewToggle')}>
                {t('view')}
              </button>
              <button type="button" className="flight-hud__brake" {...holdBrake}>
                {t('brake')}
              </button>
              <button type="button" className="flight-hud__boost" {...hold('boost')}>
                {t('boost')}
              </button>
              <button
                type="button"
                className="flight-hud__fire"
                {...hold('fire')}
                aria-label={t('fire')}
              >
                <span className="flight-hud__fire-dot" aria-hidden />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
