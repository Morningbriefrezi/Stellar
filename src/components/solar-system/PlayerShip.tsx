'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Eye, Pause, Rocket, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { attachDesktopControls, clearFlightInput, zoomFlightCamera } from '@/lib/solar-system/flight-input';
import {
  MARKER_MAX,
  type FlightAlert,
  type FlightSession,
  type ShipKind,
  type SpeedMode,
} from '@/lib/solar-system/player-ship';
import type { TargetCandidate } from '@/lib/solar-system/flight-targeting';

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
const SHIPS: ShipKind[] = ['kestrel', 'lance'];
const SOLAR_IDS = new Set(['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
const MARKER_SLOTS = Array.from({ length: MARKER_MAX }, (_, i) => i);
const BARS = ['shield', 'hull', 'energy', 'boost', 'heat'] as const;
/** Which warnings are red. Everything else is amber or, for the drive, ice. */
const DANGER: ReadonlySet<FlightAlert> = new Set(['proximity', 'entry', 'solar', 'hostile', 'shielddown', 'hullcritical']);
const DRIVE_ALERTS: ReadonlySet<FlightAlert> = new Set(['charging', 'jump', 'jumpready', 'arrived']);
/** Atmospheric haze colour per world, for the in-air wash. */
const HAZE: Record<string, string> = {
  earth: '120, 170, 255', venus: '255, 214, 150', mars: '255, 150, 90', jupiter: '230, 200, 160',
  saturn: '235, 215, 170', uranus: '160, 230, 236', neptune: '110, 150, 255', titan: '240, 180, 90',
  sun: '255, 170, 60', alphaCenA: '255, 170, 60', alphaCenB: '255, 150, 70', proxima: '255, 110, 60',
  centauriPrime: '120, 180, 255', proximaB: '255, 140, 100',
};

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

function fmtKm(km: number): string {
  if (km >= 1e9) return `${(km / 1e9).toFixed(2)} B`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)} M`;
  if (km >= 1e4) return `${Math.round(km / 1000).toLocaleString('en-US')} K`;
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
 * and the flight deck — one coherent glass: a reticle and velocity vector in
 * the centre, the locked target's marker, a location block top left, the
 * drive column top right, the radar bottom left, the speed block bottom
 * centre, the systems bars bottom right, and warnings that arrive under the
 * reticle. Painted imperatively from `session.telemetry` each frame; React
 * only renders on phase changes and the target list.
 */
export function PlayerShip({ session, onActiveChange }: PlayerShipProps) {
  const t = useTranslations('solarSystem.flight');
  const tb = useTranslations('solarSystem.bodies');
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(3);
  const [touch, setTouch] = useState(false);
  const [shipKind, setShipKind] = useState<ShipKind>(session.shipKind);
  const [hangarOpen, setHangarOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [navItems, setNavItems] = useState<TargetCandidate[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLCanvasElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const placeRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLSpanElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const speedCRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<HTMLSpanElement>(null);
  const throttleRef = useRef<HTMLSpanElement>(null);
  const driveRef = useRef<HTMLSpanElement>(null);
  const assistRef = useRef<HTMLButtonElement>(null);
  const pilotRef = useRef<HTMLDivElement>(null);
  const commsRef = useRef<HTMLDivElement>(null);
  const commsHeadRef = useRef<HTMLSpanElement>(null);
  const commsLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const markerTextRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const navRef = useRef<HTMLDivElement>(null);
  const navNameRef = useRef<HTMLSpanElement>(null);
  const navDistRef = useRef<HTMLSpanElement>(null);
  const navBtnRef = useRef<HTMLSpanElement>(null);
  const vvRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const ejectRef = useRef<HTMLButtonElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barValRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const logRef = useRef<HTMLSpanElement>(null);
  const contactsRef = useRef<HTMLSpanElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const whiteRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLDivElement>(null);
  const hazeRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const jumpBarRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLDivElement>(null);
  const discTitleRef = useRef<HTMLSpanElement>(null);
  const discFactRef = useRef<HTMLSpanElement>(null);
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
    setNavOpen(false);
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

  // The target list is the one piece of deck chrome React renders: it opens
  // on demand with whatever the sensors hold at that moment.
  const openNav = useCallback(() => {
    setNavItems(session.telemetry.navList.slice());
    setNavOpen(true);
  }, [session]);
  useEffect(() => {
    if (phase !== 'flying' || touch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyN' || e.repeat) return;
      e.preventDefault();
      if (navOpen) setNavOpen(false);
      else openNav();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, touch, navOpen, openNav]);

  // ── Touch steering: one stick anywhere in the left half of the screen. ──
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
        // A soft curve: fine near the centre, full authority at the rim.
        stick.x = Math.sign(dx) * Math.pow(Math.abs(dx), 1.4);
        stick.y = Math.sign(dy) * Math.pow(Math.abs(dy), 1.4);
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

  // ── Deck paint loop — DOM writes + two small canvases, no React state. ──
  useEffect(() => {
    if (phase !== 'flying') return;
    const tel = session.telemetry;
    const input = session.input;
    const root = rootRef.current;
    const radar = radarRef.current;
    const pad = padRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let radarPx = 0;
    let vw = window.innerWidth;
    let vh = window.innerHeight;
    const sizeCanvases = () => {
      if (root) {
        vw = root.clientWidth;
        vh = root.clientHeight;
      }
      if (radar) {
        radarPx = radar.clientWidth;
        radar.width = radar.height = Math.max(1, Math.round(radarPx * dpr));
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
    const navName = (id: string) => {
      if (id === 'jump') return t('navJump', { system: systemName(lastTarget) });
      if (id === 'contact') return t('navContact');
      return bodyName(id);
    };
    const alertText = (a: FlightAlert): string => {
      if (a === 'jump' || a === 'charging') return t(`alerts.${a}`, { target: systemName(lastTarget) });
      if (a === 'arrived') return t('alerts.arrived', { system: systemName(lastSystem) });
      return t(`alerts.${a}`);
    };
    const setText = (el: HTMLElement | null, text: string) => {
      if (el && el.textContent !== text) el.textContent = text;
    };

    let raf = 0;
    let lastSpeed = '';
    let lastSpeedC = '';
    let lastPlace = '';
    let lastMode = '';
    let lastAlt = -1;
    let lastSystem = '';
    let lastTarget = '';
    let lastAlert: FlightAlert | null = null;
    let lastCrashed: boolean | null = null;
    let lastRespawn = -1;
    let lastPilotKey = '';
    let lastComms = '';
    let lastNav = '';
    let lastNavDist = '';
    let lastRegion = '';
    let lastDisc = '';
    let lastDrive = '';
    let lastAssist: boolean | null = null;
    let lastLog = '';
    let lastContacts = -1;
    let lastThrottle = -1;
    let lastHaze = '';
    const lastBar = [-1, -1, -1, -1, -1];
    let commsText: string[] = [];
    let shownFrac = 0;

    const paint = () => {
      raf = requestAnimationFrame(paint);
      if (touch) input.thrust = brakeRef.current ? BRAKE : CRUISE;

      const jumping = tel.jumpPhase === 'travel';
      const kmS = jumping ? 299792 : tel.speedKmS;
      const speedText = fmtSpeed(kmS);
      if (speedText !== lastSpeed) {
        lastSpeed = speedText;
        setText(speedRef.current, speedText);
        setText(velRef.current, `${speedText} ${t('kmS')}`);
      }
      const cText = tel.speedC >= 0.001 ? `${tel.speedC.toFixed(3)} c` : '';
      if (cText !== lastSpeedC) {
        lastSpeedC = cText;
        setText(speedCRef.current, cText);
      }
      const thr = Math.round(Math.max(0, tel.throttle) * 100);
      if (thr !== lastThrottle) {
        lastThrottle = thr;
        if (throttleRef.current) throttleRef.current.style.transform = `scaleX(${thr / 100})`;
      }
      shownFrac += (Math.min(1, tel.speedFrac) - shownFrac) * 0.15;
      if (reticleRef.current) reticleRef.current.style.setProperty('--speed', shownFrac.toFixed(3));

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
        lastMode = modeKey;
        setText(modeRef.current, t(`modes.${modeKey}`));
        modeBtnRefs.current.forEach((btn, i) => {
          if (btn) btn.dataset.active = MODES[i] === tel.mode && tel.pilot === 'ship' ? 'true' : 'false';
        });
      }
      const drive = tel.jumpPhase !== 'none' ? 'driveCharging' : tel.driveReady ? 'driveReady' : 'driveLocked';
      if (drive !== lastDrive) {
        lastDrive = drive;
        setText(driveRef.current, t(drive));
        if (driveRef.current) driveRef.current.dataset.state = drive;
      }
      if (tel.assist !== lastAssist) {
        lastAssist = tel.assist;
        if (assistRef.current) {
          assistRef.current.dataset.on = tel.assist ? 'true' : 'false';
          setText(assistRef.current, t(tel.assist ? 'assistOn' : 'assistOff'));
        }
      }
      if (tel.systemName !== lastSystem) lastSystem = tel.systemName;
      if (tel.targetName !== lastTarget) lastTarget = tel.targetName;
      if (root && root.dataset.view !== tel.view) root.dataset.view = tel.view;
      const pilotKey = tel.pilot === 'eva' ? (tel.canBoard ? 'board' : 'eva') : 'ship';
      if (pilotKey !== lastPilotKey) {
        lastPilotKey = pilotKey;
        if (pilotRef.current) {
          pilotRef.current.hidden = pilotKey === 'ship';
          setText(pilotRef.current, pilotKey === 'board' ? t(touch ? 'evaBoardTouch' : 'evaBoard') : t('evaOut'));
        }
        setText(ejectRef.current, t(pilotKey === 'ship' ? 'eject' : 'board'));
      }

      // ── Warnings: one line under the reticle, red only for danger. ──
      if (tel.alert !== lastAlert) {
        lastAlert = tel.alert;
        const el = alertRef.current;
        if (el) {
          el.hidden = !tel.alert;
          el.dataset.tone = DANGER.has(tel.alert) ? 'danger' : DRIVE_ALERTS.has(tel.alert) ? 'drive' : 'caution';
          if (tel.alert) setText(el.firstElementChild as HTMLElement | null, alertText(tel.alert));
        }
      }
      if (jumpBarRef.current) {
        jumpBarRef.current.style.transform = `scaleX(${tel.jumpPhase === 'none' ? 0 : tel.jumpT.toFixed(3)})`;
      }

      // ── Region banner: a body has come within sensor reach. ──
      if (tel.region !== lastRegion) {
        lastRegion = tel.region;
        const el = regionRef.current;
        if (el) {
          el.hidden = !tel.region;
          if (tel.region) setText(el, t('region', { body: bodyName(tel.region) }));
        }
      }

      // ── Discovery toast. ──
      if (tel.discovery !== lastDisc) {
        lastDisc = tel.discovery;
        const el = discRef.current;
        if (el) {
          el.hidden = !tel.discovery;
          if (tel.discovery) {
            setText(discTitleRef.current, t(`discoveries.${tel.discovery}.title`));
            setText(discFactRef.current, t(`discoveries.${tel.discovery}.fact`));
          }
        }
      }
      const log = `${tel.discoveryCount}/${tel.discoveryTotal}`;
      if (log !== lastLog) {
        lastLog = log;
        setText(logRef.current, log);
      }

      // ── Comms. ──
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

      // ── Body brackets: scaled and faded by apparent size. ──
      for (let i = 0; i < MARKER_MAX; i++) {
        const el = markerRefs.current[i];
        if (!el) continue;
        if (i >= tel.markerCount || tel.view === 'cockpit') {
          if (!el.hidden) el.hidden = true;
          continue;
        }
        if (el.hidden) el.hidden = false;
        const k = tel.markers[i * 3 + 2];
        el.style.transform = `translate3d(${Math.round(tel.markers[i * 3])}px, ${Math.round(tel.markers[i * 3 + 1])}px, 0)`;
        el.style.opacity = (0.45 + 0.55 * Math.min(1, k * 3)).toFixed(2);
        el.style.setProperty('--k', (0.8 + 1.2 * Math.min(1, k)).toFixed(2));
        setText(markerTextRefs.current[i], bodyName(tel.markerIds[i] ?? ''));
      }

      // ── Locked target: a diamond on the glass, or an arrow on the edge. ──
      const navEl = navRef.current;
      if (navEl) {
        if (!tel.navId) {
          if (!navEl.hidden) navEl.hidden = true;
        } else {
          if (navEl.hidden) navEl.hidden = false;
          const x = (tel.nav.x * 0.5 + 0.5) * vw;
          const y = (-tel.nav.y * 0.5 + 0.5) * vh;
          navEl.dataset.on = tel.nav.on ? 'true' : 'false';
          navEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
          navEl.style.setProperty('--angle', `${(-tel.nav.angle).toFixed(3)}rad`);
          const dist = `${fmtKm(tel.navKm)} km`;
          if (dist !== lastNavDist) {
            lastNavDist = dist;
            setText(navDistRef.current, dist);
          }
        }
      }
      if (tel.navId !== lastNav) {
        lastNav = tel.navId;
        const name = tel.navId ? navName(tel.navId) : t('targetNone');
        setText(navNameRef.current, name);
        setText(navBtnRef.current, name);
      }

      // ── Velocity vector. ──
      const vvEl = vvRef.current;
      if (vvEl) {
        const show = tel.vv.on === 1 && tel.speedFrac > 0.03 && tel.view === 'chase';
        if (vvEl.hidden === show) vvEl.hidden = !show;
        if (show) {
          vvEl.style.transform = `translate3d(${Math.round((tel.vv.x * 0.5 + 0.5) * vw)}px, ${Math.round((-tel.vv.y * 0.5 + 0.5) * vh)}px, 0)`;
        }
      }

      // ── Systems. ──
      const levels = [tel.shield / tel.maxShield, tel.hp / tel.maxHp, tel.energy, tel.boostCharge, tel.heat];
      for (let i = 0; i < BARS.length; i++) {
        const pct = Math.max(0, Math.min(100, Math.round(levels[i] * 100)));
        if (pct === lastBar[i]) continue;
        lastBar[i] = pct;
        const fill = barRefs.current[i];
        if (fill) {
          fill.style.transform = `scaleX(${pct / 100})`;
          fill.dataset.low = i === 4 ? (pct >= 60 ? 'true' : 'false') : pct <= 25 ? 'true' : 'false';
        }
        setText(barValRefs.current[i], String(pct));
      }
      if (tel.radarCount !== lastContacts) {
        lastContacts = tel.radarCount;
        setText(contactsRef.current, tel.radarCount ? t('contacts', { n: tel.radarCount }) : t('noContacts'));
        if (contactsRef.current) contactsRef.current.dataset.hostile = tel.contact === 'hostile' ? 'true' : 'false';
      }

      // ── Full-screen washes. ──
      if (flashRef.current) flashRef.current.style.opacity = String(tel.hitFlash * 0.4);
      if (whiteRef.current) whiteRef.current.style.opacity = String(tel.jumpFlash);
      if (heatRef.current) heatRef.current.style.opacity = String(tel.heat * 0.85);
      if (glareRef.current) glareRef.current.style.opacity = String(tel.sunGlare * 0.55);
      const hazeKey = tel.atmo > 0.01 ? tel.nearId : '';
      if (hazeKey !== lastHaze) {
        lastHaze = hazeKey;
        if (hazeRef.current) hazeRef.current.style.setProperty('--haze', HAZE[hazeKey] ?? '200, 200, 200');
      }
      if (hazeRef.current) hazeRef.current.style.opacity = String(tel.atmo * 0.5);
      if (tel.crashed !== lastCrashed) {
        lastCrashed = tel.crashed;
        if (crashRef.current) crashRef.current.hidden = !tel.crashed;
      }
      const respawn = tel.crashed ? Math.ceil(tel.respawnIn) : -1;
      if (respawn !== lastRespawn) {
        lastRespawn = respawn;
        if (respawn >= 0) setText(respawnRef.current, t('respawn', { n: respawn }));
      }

      // ── Radar: range rings, heading, the locked target, contacts. ──
      if (radar && radarPx > 0) {
        const ctx = radar.getContext('2d');
        if (ctx) {
          const s = radarPx * dpr;
          const cx = s / 2;
          const reach = cx - 4 * dpr;
          ctx.clearRect(0, 0, s, s);
          ctx.fillStyle = 'rgba(6, 12, 24, 0.5)';
          ctx.beginPath();
          ctx.arc(cx, cx, reach, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(160, 196, 240, 0.28)';
          ctx.lineWidth = dpr;
          ctx.beginPath();
          ctx.arc(cx, cx, reach, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(160, 196, 240, 0.14)';
          for (const k of [0.33, 0.66]) {
            ctx.beginPath();
            ctx.arc(cx, cx, reach * k, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(cx, cx - reach);
          ctx.lineTo(cx, cx + reach);
          ctx.moveTo(cx - reach, cx);
          ctx.lineTo(cx + reach, cx);
          ctx.stroke();
          ctx.fillStyle = '#eaf3ff';
          ctx.beginPath();
          ctx.moveTo(cx, cx - 5 * dpr);
          ctx.lineTo(cx + 3.5 * dpr, cx + 4 * dpr);
          ctx.lineTo(cx, cx + 2 * dpr);
          ctx.lineTo(cx - 3.5 * dpr, cx + 4 * dpr);
          ctx.closePath();
          ctx.fill();
          if (tel.navId) {
            const nx = cx + tel.navRadarX * (reach - 5 * dpr);
            const ny = cx - tel.navRadarY * (reach - 5 * dpr);
            ctx.strokeStyle = '#ffb347';
            ctx.lineWidth = 1.5 * dpr;
            ctx.beginPath();
            ctx.moveTo(nx, ny - 4 * dpr);
            ctx.lineTo(nx + 4 * dpr, ny);
            ctx.lineTo(nx, ny + 4 * dpr);
            ctx.lineTo(nx - 4 * dpr, ny);
            ctx.closePath();
            ctx.stroke();
          }
          ctx.fillStyle = tel.contact === 'hostile' ? '#ff5a5a' : '#8fd4ff';
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
          const active = st.id >= 0;
          const ox = active ? st.ox * dpr : pad.width * 0.28;
          const oy = active ? st.oy * dpr : pad.height - r - 24 * dpr;
          ctx.strokeStyle = active ? 'rgba(255, 179, 71, 0.55)' : 'rgba(180, 212, 246, 0.2)';
          ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath();
          ctx.arc(ox, oy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = active ? 'rgba(255, 179, 71, 0.5)' : 'rgba(180, 212, 246, 0.14)';
          ctx.beginPath();
          ctx.arc(ox + st.x * r, oy + st.y * r, r * 0.34, 0, Math.PI * 2);
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

  const hold = (key: 'fire' | 'boost' | 'align') => ({
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
  const oneShot = (key: 'eject' | 'viewToggle' | 'assistToggle') => () => {
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

  const navLabel = (c: TargetCandidate) => {
    if (c.id === 'jump') return t('navJump', { system: t(`systems.${session.telemetry.targetName}`) });
    if (c.id === 'contact') return t('navContact');
    if (SOLAR_IDS.has(c.id)) return tb(`${c.id}.name`);
    return t.has(`bodies.${c.id}`) ? t(`bodies.${c.id}`) : c.id.toUpperCase();
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
                <span className="flight-hud__ship-name">{t(`ships.${kind}`)}</span>
                <span className="flight-hud__ship-role">{t(`shipRoles.${kind}`)}</span>
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
          <span className="flight-hud__count-sub">{t(`ships.${shipKind}`)} · {t('launchSub')}</span>
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
          <div ref={hazeRef} className="flight-hud__haze" aria-hidden />
          <div ref={heatRef} className="flight-hud__heat" aria-hidden />
          <div ref={glareRef} className="flight-hud__glare" aria-hidden />
          <div ref={flashRef} className="flight-hud__flash" aria-hidden />
          <div ref={whiteRef} className="flight-hud__white" aria-hidden />

          {/* Centre: reticle, velocity vector, the warning line. */}
          <div ref={reticleRef} className="flight-hud__reticle" aria-hidden>
            <span className="flight-hud__reticle-ring" />
            <span className="flight-hud__reticle-tick flight-hud__reticle-tick--l" />
            <span className="flight-hud__reticle-tick flight-hud__reticle-tick--r" />
            <span className="flight-hud__reticle-tick flight-hud__reticle-tick--t" />
            <span className="flight-hud__reticle-dot" />
          </div>
          <div ref={vvRef} className="flight-hud__vv" aria-hidden hidden />
          <div ref={alertRef} className="flight-hud__alert" role="status" aria-live="polite" hidden>
            <span />
            <div ref={jumpBarRef} className="flight-hud__jumpbar" aria-hidden />
          </div>

          {/* Locked target marker. */}
          <div ref={navRef} className="flight-hud__nav" aria-hidden hidden>
            <span className="flight-hud__nav-diamond" />
            <span className="flight-hud__nav-arrow" />
            <span className="flight-hud__nav-label">
              <span ref={navNameRef} className="flight-hud__nav-name" />
              <span ref={navDistRef} className="flight-hud__nav-dist" />
            </span>
          </div>

          {/* Location block, top left. */}
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
            <div ref={pilotRef} className="flight-hud__pilot" hidden />
          </div>
          <div ref={regionRef} className="flight-hud__region" role="status" hidden />

          {/* Body brackets. */}
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

          {/* Drive column, top right: regimes, drive state, assist, view, target. */}
          <div className="flight-hud__drive" role="group" aria-label={t('speedMode')}>
            <div className="flight-hud__modes">
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
                  {t(`modes.${m}`)}
                </button>
              ))}
            </div>
            <span ref={driveRef} className="flight-hud__drive-state" data-state="driveReady">{t('driveReady')}</span>
            <span ref={modeRef} className="flight-hud__mode-live" aria-live="polite">{t('modes.cruise')}</span>
            <div className="flight-hud__drive-keys">
              <button ref={assistRef} type="button" className="flight-hud__key" data-on="true" onClick={oneShot('assistToggle')}>
                {t('assistOn')}
              </button>
              <button type="button" className="flight-hud__key flight-hud__key--icon" onClick={oneShot('viewToggle')} aria-label={t('view')}>
                <Eye size={13} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="flight-hud__key flight-hud__key--target"
                onClick={() => (navOpen ? setNavOpen(false) : openNav())}
                aria-expanded={navOpen}
              >
                <Crosshair size={12} strokeWidth={2} aria-hidden />
                <span ref={navBtnRef}>{t('targetNone')}</span>
              </button>
            </div>
          </div>

          {navOpen && (
            <div className="flight-hud__navlist" role="listbox" aria-label={t('targets')}>
              <div className="flight-hud__navlist-head">
                <span>{t('targets')}</span>
                <button type="button" className="flight-hud__hangar-close" onClick={() => setNavOpen(false)} aria-label={t('exit')}>
                  <X size={13} strokeWidth={2.4} aria-hidden />
                </button>
              </div>
              <div className="flight-hud__navlist-body">
                {navItems.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={session.telemetry.navId === c.id}
                    className="flight-hud__navitem"
                    data-kind={c.kind}
                    onClick={() => {
                      session.input.targetRequest = c.id;
                      setNavOpen(false);
                    }}
                  >
                    <span className="flight-hud__navitem-kind">{t(`navKinds.${c.kind}`)}</span>
                    <span className="flight-hud__navitem-name">{navLabel(c)}</span>
                  </button>
                ))}
                {session.telemetry.navId && (
                  <button
                    type="button"
                    className="flight-hud__navitem flight-hud__navitem--clear"
                    onClick={() => {
                      session.input.targetClear = true;
                      setNavOpen(false);
                    }}
                  >
                    <span className="flight-hud__navitem-name">{t('targetClear')}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Discovery toast. */}
          <div ref={discRef} className="flight-hud__discovery" role="status" aria-live="polite" hidden>
            <span className="flight-hud__discovery-cap">{t('discovery')}</span>
            <span ref={discTitleRef} className="flight-hud__discovery-title" />
            <span ref={discFactRef} className="flight-hud__discovery-fact" />
          </div>

          {/* Bottom: radar, speed block, systems. */}
          <div className="flight-hud__console">
            <div className="flight-hud__radar">
              <canvas ref={radarRef} className="flight-hud__radar-disc" aria-hidden />
              <span ref={contactsRef} className="flight-hud__radar-cap" data-hostile="false">{t('noContacts')}</span>
            </div>
            <div className="flight-hud__speed">
              <span className="flight-hud__speed-value">
                <span ref={speedRef}>0.00</span>
                <span className="flight-hud__unit">{t('kmS')}</span>
              </span>
              <span className="flight-hud__speed-row">
                <span ref={speedCRef} className="flight-hud__speed-c" />
                <span className="flight-hud__throttle" aria-hidden>
                  <span ref={throttleRef} className="flight-hud__throttle-fill" />
                </span>
              </span>
            </div>
            <div className="flight-hud__systems">
              {BARS.map((key, i) => (
                <div key={key} className="flight-hud__sys" data-key={key}>
                  <span className="flight-hud__sys-name">{t(key)}</span>
                  <span className="flight-hud__sys-track">
                    <span
                      ref={(el) => {
                        barRefs.current[i] = el;
                      }}
                      className="flight-hud__sys-fill"
                      data-low="false"
                    />
                  </span>
                  <span
                    ref={(el) => {
                      barValRefs.current[i] = el;
                    }}
                    className="flight-hud__sys-val"
                  >
                    100
                  </span>
                </div>
              ))}
              <div className="flight-hud__sys flight-hud__sys--log">
                <span className="flight-hud__sys-name">{t('log')}</span>
                <span ref={logRef} className="flight-hud__sys-val">0/0</span>
              </div>
            </div>
            <div className="flight-hud__cam" role="group" aria-label={t('camera')}>
              <button type="button" className="flight-hud__cam-btn" onClick={() => zoomFlightCamera(session.input, -1)} aria-label={t('camIn')}>
                <ZoomIn size={13} strokeWidth={2} aria-hidden />
              </button>
              <button type="button" className="flight-hud__cam-btn" onClick={() => zoomFlightCamera(session.input, 1)} aria-label={t('camOut')}>
                <ZoomOut size={13} strokeWidth={2} aria-hidden />
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
              <div className="flight-hud__touch-row">
                <button ref={ejectRef} type="button" className="flight-hud__tkey" onClick={oneShot('eject')}>
                  {t('eject')}
                </button>
                <button type="button" className="flight-hud__tkey" onClick={() => { session.input.targetStep = 1; }}>
                  {t('target')}
                </button>
                <button type="button" className="flight-hud__tkey" {...hold('align')}>
                  {t('align')}
                </button>
              </div>
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
