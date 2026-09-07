'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Rocket, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  attachDesktopControls,
  clearFlightInput,
  zoomFlightCamera,
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
const RADAR_PX = 92;
const GAUGE_PX = 150;
/** Auto-cruise throttle on touch: a phone has no spare thumb for a throttle,
 *  so the ship always makes way and the controls are steer, boost, brake. */
const CRUISE = 0.85;
const BRAKE = -0.7;
const MODES: SpeedMode[] = ['cruise', 'fast', 'jump'];
const SHIPS: ShipKind[] = ['xfoil', 'interceptor'];
const SOLAR_IDS = new Set(['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);

interface Stick {
  id: number;
  /** Where the thumb landed — the stick centres itself there. */
  ox: number;
  oy: number;
  x: number;
  y: number;
}

function fmtKm(km: number): string {
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)} M`;
  return Math.round(km).toLocaleString('en-US');
}

/**
 * Explore Mode chrome: the hangar (ship choice + Explore), launch countdown,
 * the flight deck (speed gauge, regime selector, hull, radar, alerts, crash
 * and jump overlays) and the touch controls. The deck is painted
 * imperatively from `session.telemetry` each frame — React only renders on
 * phase changes, never inside the animation loop.
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
  const speedRef = useRef<HTMLSpanElement>(null);
  const cRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<HTMLSpanElement>(null);
  const nearRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLSpanElement>(null);
  const systemRef = useRef<HTMLSpanElement>(null);
  const foilsRef = useRef<HTMLSpanElement>(null);
  const killsRef = useRef<HTMLSpanElement>(null);
  const pilotRef = useRef<HTMLDivElement>(null);
  const commsRef = useRef<HTMLDivElement>(null);
  const commsHeadRef = useRef<HTMLSpanElement>(null);
  const commsLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const ejectRef = useRef<HTMLButtonElement>(null);
  const hpFillRef = useRef<HTMLDivElement>(null);
  const hpTextRef = useRef<HTMLSpanElement>(null);
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
    if (radar) {
      radar.width = RADAR_PX * dpr;
      radar.height = RADAR_PX * dpr;
    }
    if (gauge) {
      gauge.width = GAUGE_PX * dpr;
      gauge.height = GAUGE_PX * dpr;
    }
    const sizePad = () => {
      if (!pad) return;
      pad.width = pad.clientWidth * dpr;
      pad.height = pad.clientHeight * dpr;
    };
    sizePad();
    window.addEventListener('resize', sizePad);

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
    let lastHp = -1;
    let lastKills = -1;
    let lastSpeed = -1;
    let lastC = -1;
    let lastMode: SpeedMode | '' = '';
    let lastFoils: boolean | null = null;
    let lastNear = '';
    let lastAlt = -1;
    let lastSystem = '';
    let lastTarget = '';
    let lastAlert: FlightAlert | null = null;
    let lastCrashed: boolean | null = null;
    let lastRespawn = -1;
    let lastPilotKey = '';
    let lastComms = '';
    let shownFrac = 0;
    let commsText: string[] = [];
    const paint = () => {
      raf = requestAnimationFrame(paint);

      // Touch flight holds a cruise throttle so steering is the only stick.
      if (touch) input.thrust = brakeRef.current ? BRAKE : CRUISE;

      const jumping = tel.jumpPhase === 'travel';
      const speed = jumping ? -2 : Math.round(tel.speedKmS);
      if (speed !== lastSpeed) {
        lastSpeed = speed;
        setText(speedRef.current, jumping ? '299,792' : speed.toLocaleString('en-US'));
      }
      const c = Math.round(tel.speedC * 1000);
      if (c !== lastC) {
        lastC = c;
        setText(cRef.current, `${(c / 1000).toFixed(3)} c`);
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
      if (tel.nearId !== lastNear) {
        lastNear = tel.nearId;
        setText(nearRef.current, tel.nearId ? bodyName(tel.nearId) : '—');
      }
      const alt = tel.nearId ? Math.round(tel.nearAltKm / 10) : -1;
      if (alt !== lastAlt) {
        lastAlt = alt;
        setText(altRef.current, alt < 0 ? '—' : `${fmtKm(alt * 10)} km`);
      }
      const sys = tel.systemName;
      if (sys !== lastSystem) {
        lastSystem = sys;
        setText(systemRef.current, systemName(sys));
      }
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
          if (!el) return;
          const full = commsText[i] ?? '';
          const n = i + 1;
          const shown = n < tel.commsLine ? full : n === tel.commsLine ? full.slice(0, Math.round(full.length * tel.commsProgress)) : '';
          setText(el, shown);
          el.dataset.live = n === tel.commsLine ? 'true' : 'false';
        });
      }

      const hp = Math.round(tel.hp);
      if (hp !== lastHp) {
        lastHp = hp;
        const k = tel.hp / tel.maxHp;
        if (hpFillRef.current) {
          hpFillRef.current.style.width = `${Math.max(0, k * 100)}%`;
          hpFillRef.current.style.background =
            k > 0.5 ? '#5eead4' : k > 0.25 ? '#ffb347' : '#ff5a5a';
        }
        setText(hpTextRef.current, String(hp));
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

      // ── Speed gauge: a 270° arc filled to the regime's ceiling, ticks
      // every tenth, colour warming as the needle climbs. ──
      if (gauge) {
        const ctx = gauge.getContext('2d');
        if (ctx) {
          const s = GAUGE_PX * dpr;
          const cx = s / 2;
          const r = s / 2 - 8 * dpr;
          const a0 = Math.PI * 0.75;
          const a1 = Math.PI * 2.25;
          const frac = tel.maxKmS > 0 ? Math.min(1, tel.speedKmS / tel.maxKmS) : 0;
          shownFrac += (frac - shownFrac) * 0.18;
          ctx.clearRect(0, 0, s, s);
          ctx.fillStyle = 'rgba(6, 9, 14, 0.72)';
          ctx.beginPath();
          ctx.arc(cx, cx, s / 2 - 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineCap = 'butt';
          ctx.strokeStyle = 'rgba(248, 244, 236, 0.14)';
          ctx.lineWidth = 6 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cx, r, a0, a1);
          ctx.stroke();
          const hue = shownFrac < 0.5 ? '#5eead4' : shownFrac < 0.85 ? '#ffb347' : '#ff5a5a';
          ctx.strokeStyle = hue;
          ctx.beginPath();
          ctx.arc(cx, cx, r, a0, a0 + (a1 - a0) * shownFrac);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(248, 244, 236, 0.5)';
          ctx.lineWidth = dpr;
          for (let i = 0; i <= 10; i++) {
            const a = a0 + (a1 - a0) * (i / 10);
            const len = (i % 5 === 0 ? 8 : 4) * dpr;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (r - 6 * dpr), cx + Math.sin(a) * (r - 6 * dpr));
            ctx.lineTo(cx + Math.cos(a) * (r - 6 * dpr - len), cx + Math.sin(a) * (r - 6 * dpr - len));
            ctx.stroke();
          }
          const na = a0 + (a1 - a0) * shownFrac;
          ctx.fillStyle = hue;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(na) * r, cx + Math.sin(na) * r, 4 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (radar) {
        const ctx = radar.getContext('2d');
        if (ctx) {
          const s = RADAR_PX * dpr;
          const cx = s / 2;
          ctx.clearRect(0, 0, s, s);
          ctx.fillStyle = 'rgba(6, 9, 14, 0.7)';
          ctx.beginPath();
          ctx.arc(cx, cx, cx - 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(248, 244, 236, 0.18)';
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.arc(cx, cx, cx - 1, 0, Math.PI * 2);
          ctx.moveTo(cx, 2);
          ctx.lineTo(cx, s - 2);
          ctx.moveTo(2, cx);
          ctx.lineTo(s - 2, cx);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cx, cx * 0.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#5eead4';
          ctx.beginPath();
          ctx.moveTo(cx, cx - 5 * dpr);
          ctx.lineTo(cx + 3.5 * dpr, cx + 4 * dpr);
          ctx.lineTo(cx - 3.5 * dpr, cx + 4 * dpr);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#ff5a5a';
          const reach = cx - 6 * dpr;
          for (let i = 0; i < tel.radarCount; i++) {
            const x = cx + tel.radar[i * 2] * reach;
            const y = cx - tel.radar[i * 2 + 1] * reach;
            ctx.beginPath();
            ctx.arc(x, y, 2.5 * dpr, 0, Math.PI * 2);
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
          const oy = active ? st.oy * dpr : pad.height - r - 26 * dpr;
          ctx.strokeStyle = active ? 'rgba(94, 234, 212, 0.5)' : 'rgba(248, 244, 236, 0.22)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(ox, oy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = active ? 'rgba(94, 234, 212, 0.55)' : 'rgba(248, 244, 236, 0.16)';
          ctx.beginPath();
          ctx.arc(ox + st.x * r, oy + st.y * r, r * 0.36, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizePad);
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
          className="solar-system__fab flight-hud__exit"
          onClick={exit}
          aria-label={t('exit')}
        >
          <X size={20} strokeWidth={2.2} aria-hidden />
        </button>
      )}

      {phase === 'flying' && (
        <>
          <div ref={heatRef} className="flight-hud__heat" aria-hidden />
          <div ref={flashRef} className="flight-hud__flash" aria-hidden />
          <div ref={whiteRef} className="flight-hud__white" aria-hidden />

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
          </div>

          <div ref={alertRef} className="flight-hud__alert" role="status" aria-live="polite" hidden>
            <span />
            <div ref={jumpBarRef} className="flight-hud__jumpbar" aria-hidden />
          </div>

          <div className="flight-hud__deck" aria-live="off">
            <div className="flight-hud__gauge">
              <canvas ref={gaugeRef} style={{ width: GAUGE_PX, height: GAUGE_PX }} aria-hidden />
              <div className="flight-hud__gauge-read">
                <span ref={speedRef} className="flight-hud__gauge-speed">0</span>
                <span className="flight-hud__gauge-unit">{t('kmS')}</span>
                <span ref={cRef} className="flight-hud__gauge-c">0.000 c</span>
              </div>
            </div>
            <div className="flight-hud__readout">
              <span className="flight-hud__label">{t('modeLabel')}</span>
              <span ref={modeRef} className="flight-hud__value">{t('modes.cruise')}</span>
              <span className="flight-hud__label">{t('near')}</span>
              <span ref={nearRef} className="flight-hud__value">—</span>
              <span className="flight-hud__label">{t('alt')}</span>
              <span ref={altRef} className="flight-hud__value">—</span>
              <span className="flight-hud__label">{t('system')}</span>
              <span ref={systemRef} className="flight-hud__value">{t('systems.sol')}</span>
            </div>
            <div className="flight-hud__status">
              <span ref={foilsRef} className="flight-hud__stat" data-on="false">
                <span className="flight-hud__led" aria-hidden />
                {t('foils')}
              </span>
              <span className="flight-hud__stat">
                {t('kills')} <span ref={killsRef}>0</span>
              </span>
            </div>
            <div className="flight-hud__cam" role="group" aria-label={t('camera')}>
              <button
                type="button"
                className="flight-hud__cam-btn"
                onClick={() => zoomFlightCamera(session.input, -1)}
                aria-label={t('camIn')}
              >
                <ZoomIn size={14} strokeWidth={2.2} aria-hidden />
              </button>
              <span className="flight-hud__cam-label">{t('camera')}</span>
              <button
                type="button"
                className="flight-hud__cam-btn"
                onClick={() => zoomFlightCamera(session.input, 1)}
                aria-label={t('camOut')}
              >
                <ZoomOut size={14} strokeWidth={2.2} aria-hidden />
              </button>
            </div>
            <div ref={pilotRef} className="flight-hud__pilot" hidden />
          </div>
          <canvas
            ref={radarRef}
            className="flight-hud__radar"
            style={{ width: RADAR_PX, height: RADAR_PX }}
            aria-hidden
          />
          <div className="flight-hud__hull">
            <div className="flight-hud__hull-row">
              <span className="flight-hud__label">{t('hull')}</span>
              <span ref={hpTextRef} className="flight-hud__value">100</span>
            </div>
            <div className="flight-hud__hp">
              <div ref={hpFillRef} className="flight-hud__hp-fill" />
            </div>
            {!touch && <div className="flight-hud__hint">{t('hint')}</div>}
          </div>

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
