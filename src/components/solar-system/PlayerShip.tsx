'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsUp, Crosshair, HelpCircle, Pause, Play, Rocket, Shield, X, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { attachDesktopControls, clearFlightInput } from '@/lib/solar-system/flight-input';
import { type FlightSession, type ShipKind } from '@/lib/solar-system/player-ship';

interface PlayerShipProps {
  session: FlightSession;
  onActiveChange: (active: boolean) => void;
}
interface Stick { id: number; ox: number; oy: number; x: number; y: number }
const STICK_RADIUS = 62;
const SHIPS: ShipKind[] = ['kestrel', 'xfoil'];
const BARS = ['shield', 'energy', 'boost'] as const;
const KEY_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'] as const;
const TOUCH_ROWS = ['t1', 't2', 't3', 't4', 't5'] as const;
const HELP_SEEN = 'stellar_explore_help';
const ICONS = [Shield, Zap, ChevronsUp];
const SOLAR_IDS = new Set(['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']);
const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e4 ? `${Math.round(n / 1000)} K` : n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2);

export function PlayerShip({ session, onActiveChange }: PlayerShipProps) {
  const t = useTranslations('solarSystem.flight');
  const tb = useTranslations('solarSystem.bodies');
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [touch, setTouch] = useState(false);
  const [shipKind, setShipKind] = useState<ShipKind>(session.shipKind);
  const [help, setHelp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLCanvasElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const placeRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLSpanElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const modeRef = useRef<HTMLSpanElement>(null);
  const odoRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const markerNameRef = useRef<HTMLSpanElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barValRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const detachRef = useRef<(() => void) | null>(null);
  const pauseRef = useRef<() => void>(() => {});
  const brakeRef = useRef(false);
  const zoomRef = useRef(1);

  useEffect(() => setTouch(window.matchMedia('(pointer: coarse)').matches), []);
  const pause = useCallback(() => {
    if (!session.active || session.paused) return;
    zoomRef.current = session.input.camZoom;
    session.paused = true;
    detachRef.current?.();
    detachRef.current = null;
    clearFlightInput(session.input);
    brakeRef.current = false;
    setPaused(true);
  }, [session]);
  pauseRef.current = pause;
  const attach = () => {
    if (!touch && rootRef.current) detachRef.current = attachDesktopControls(session, rootRef.current, () => pauseRef.current());
  };
  const enter = () => {
    session.shipKind = shipKind;
    session.active = true;
    session.paused = false;
    session.telemetry.kills = 0;
    session.telemetry.odometerKm = 0;
    setActive(true);
    setPaused(false);
    onActiveChange(true);
    // First flight opens the control card; after that it is on the key.
    try {
      if (!localStorage.getItem(HELP_SEEN)) {
        setHelp(true);
        localStorage.setItem(HELP_SEEN, '1');
      }
    } catch {
      // Private mode — just fly.
    }
    attach();
  };
  const resume = () => {
    session.paused = false;
    session.input.camZoom = zoomRef.current;
    setPaused(false);
    attach();
  };
  const exit = () => {
    detachRef.current?.();
    detachRef.current = null;
    session.active = session.paused = false;
    clearFlightInput(session.input);
    setActive(false);
    setPaused(false);
    setHelp(false);
    onActiveChange(false);
  };
  useEffect(() => {
    const hidden = () => { if (document.hidden) pause(); };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', hidden);
      detachRef.current?.();
      session.active = session.paused = false;
      clearFlightInput(session.input);
    };
  }, [pause, session]);

  // ── Touch steering: one stick anywhere in the left half of the screen. ──
  const stickRef = useRef<Stick>({ id: -1, ox: 0, oy: 0, x: 0, y: 0 });
  useEffect(() => {
    const pad = padRef.current;
    if (!active || paused || !touch || !pad) return;
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
  }, [active, paused, touch, session]);


  useEffect(() => {
    if (!active) return;
    const tel = session.telemetry;
    const input = session.input;
    const root = rootRef.current;
    const radar = radarRef.current;
    const pad = padRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let radarPx = 0;
    let vw = 0;
    let vh = 0;
    const resize = () => {
      vw = root?.clientWidth ?? window.innerWidth;
      vh = root?.clientHeight ?? window.innerHeight;
      if (radar) {
        radarPx = radar.clientWidth;
        radar.width = radar.height = Math.round(radarPx * dpr);
      }
      if (pad) { pad.width = pad.clientWidth * dpr; pad.height = pad.clientHeight * dpr; }
    };
    resize();
    window.addEventListener('resize', resize);
    const name = (id: string) => SOLAR_IDS.has(id) ? tb(`${id}.name`) : t.has(`bodies.${id}`) ? t(`bodies.${id}`) : id.toUpperCase();
    const text = (el: HTMLElement | null, value: string) => { if (el && el.textContent !== value) el.textContent = value; };
    let raf = 0;
    let lastPaint = 0;
    const paint = (now: number) => {
      raf = requestAnimationFrame(paint);
      if (now - lastPaint < 33) return;
      lastPaint = now;
      if (touch) input.thrust = session.paused ? 0 : brakeRef.current ? -0.7 : 0.85;
      text(placeRef.current, tel.nearId ? t('orbitOf', { body: name(tel.nearId) }) : t(`systems.${tel.systemName}`));
      text(altRef.current, tel.nearId ? `${fmt(tel.nearAltKm)} km` : '—');
      text(velRef.current, `${fmt(tel.speedKmS)} ${t('kmS')}`);
      text(speedRef.current, fmt(tel.speedKmS));
      text(modeRef.current, t(`modes.${tel.pilot === 'eva' ? 'eva' : tel.mode}`));
      text(odoRef.current, fmt(tel.odometerKm));
      root?.style.setProperty('--speed', String(Math.min(1, tel.speedFrac)));
      if (root) root.dataset.view = tel.view;
      let status = '';
      if (tel.crashed) status = t('respawn', { n: Math.ceil(tel.respawnIn) });
      else if (tel.alert) status = t(`alerts.${tel.alert}`, { target: t(`systems.${tel.targetName}`), system: t(`systems.${tel.systemName}`) });
      else if (tel.pilot === 'eva') status = t(tel.canBoard ? 'evaBoardTouch' : 'evaOut');
      text(statusRef.current, status);
      const levels = [tel.shield / tel.maxShield, tel.energy, tel.boostCharge];
      levels.forEach((level, i) => {
        const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
        barRefs.current[i]?.style.setProperty('transform', `scaleX(${pct / 100})`);
        text(barValRefs.current[i], `${pct}%`);
      });
      const marker = markerRef.current;
      if (marker) {
        const locked = tel.navId && tel.nav.on;
        const show = !tel.crashed && (locked || tel.markerCount > 0);
        marker.hidden = !show;
        if (show) {
          const x = locked ? (tel.nav.x * 0.5 + 0.5) * vw : tel.markers[0];
          const y = locked ? (-tel.nav.y * 0.5 + 0.5) * vh : tel.markers[1];
          marker.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
          const id = locked ? tel.navId : tel.markerIds[0];
          text(markerNameRef.current, id === 'jump' ? t(`systems.${tel.targetName}`) : name(id));
        }
      }

      if (radar && radarPx > 0) {
        const ctx = radar.getContext('2d');
        if (ctx) {
          const c = radar.width / 2;
          const r = c - 3 * dpr;
          ctx.clearRect(0, 0, radar.width, radar.height);
          ctx.lineWidth = dpr;
          ctx.strokeStyle = 'rgba(160, 210, 245, 0.3)';
          for (const k of [0.4, 0.7, 1]) {
            ctx.beginPath(); ctx.arc(c, c, r * k, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(160, 210, 245, 0.9)';
          ctx.beginPath(); ctx.moveTo(c, c - 5 * dpr); ctx.lineTo(c + 3 * dpr, c + 4 * dpr);
          ctx.lineTo(c - 3 * dpr, c + 4 * dpr); ctx.closePath(); ctx.fill();
          for (let i = 0; i < tel.radarCount; i++) {
            ctx.beginPath(); ctx.arc(c + tel.radar[i * 2] * r, c - tel.radar[i * 2 + 1] * r, 2 * dpr, 0, Math.PI * 2); ctx.fill();
          }
          if (tel.navId) {
            ctx.beginPath(); ctx.arc(c + tel.navRadarX * r * 0.9, c - tel.navRadarY * r * 0.9, 3 * dpr, 0, Math.PI * 2); ctx.stroke();
          }
        }
      }
      if (pad) {
        const ctx = pad.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, pad.width, pad.height);
          const s = stickRef.current;
          if (s.id >= 0) {
            ctx.strokeStyle = 'rgba(160, 210, 245, 0.4)';
            ctx.lineWidth = dpr;
            ctx.beginPath();
            ctx.arc(s.ox * dpr, s.oy * dpr, STICK_RADIUS * dpr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc((s.ox + s.x * STICK_RADIUS) * dpr, (s.oy + s.y * STICK_RADIUS) * dpr, 12 * dpr, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    };
    raf = requestAnimationFrame(paint);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [active, paused, touch, session, t, tb]);

  const hold = (key: 'fire' | 'boost' | 'brake') => {
    const release = () => { if (key === 'brake') brakeRef.current = false; else session.input[key] = false; };
    return {
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        if (key === 'brake') brakeRef.current = true; else session.input[key] = true;
      },
      onPointerUp: release, onPointerCancel: release, onLostPointerCapture: release,
    };
  };
  return (
    <div ref={rootRef} className="flight-hud" data-phase={active ? 'flying' : 'idle'} data-paused={paused}>
      {!active ? (
        <div className="flight-hud__launch">
          <button type="button" className="flight-hud__ship" onClick={() => setShipKind(shipKind === 'kestrel' ? 'xfoil' : 'kestrel')} aria-label={t('hangar')}>
            {t(`ships.${shipKind}`)}
          </button>
          <button type="button" className="flight-hud__explore" onClick={enter}><Rocket size={16} aria-hidden />{t('explore')}</button>
        </div>
      ) : (
        <>
          <div className="flight-hud__head">
            <span ref={placeRef} className="flight-hud__place" />
            <span className="flight-hud__reading"><span>{t('altShort')}</span><span ref={altRef} /></span>
            <span className="flight-hud__reading"><span>{t('velShort')}</span><span ref={velRef} /></span>
            <span ref={statusRef} className="flight-hud__status" role="status" />
          </div>
          <div className="flight-hud__pause">
            <button type="button" onClick={() => setHelp((h) => !h)} aria-label={t('helpShow')} aria-expanded={help}>
              <HelpCircle size={19} aria-hidden />
            </button>
            <button type="button" onClick={paused ? resume : pause} aria-label={t(paused ? 'resume' : 'pause')}>
              {paused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
            </button>
            {paused && <button type="button" onClick={exit} aria-label={t('exit')}><X size={20} aria-hidden /></button>}
          </div>
          {help && (
            <div className="flight-hud__help" role="dialog" aria-label={t('help')}>
              <div className="flight-hud__help-head">
                <span>{t('help')}</span>
                <button type="button" onClick={() => setHelp(false)} aria-label={t('exit')}><X size={14} aria-hidden /></button>
              </div>
              {(touch ? TOUCH_ROWS : KEY_ROWS).map((k) => <p key={k}>{t(`keys.${k}`)}</p>)}
            </div>
          )}
          <div ref={markerRef} className="flight-hud__marker" hidden><span ref={markerNameRef} /></div>
          <div className="flight-hud__console">
            <button type="button" className="flight-hud__radar" aria-label={t('target')} onClick={() => { session.input.targetStep = 1; }} disabled={paused}>
              <canvas ref={radarRef} aria-hidden />
            </button>
            <div className="flight-hud__panel">
              <div className="flight-hud__odometer"><span>{t('odometer')}</span><span><span ref={odoRef}>0</span> <small>km</small></span></div>
              <button type="button" className="flight-hud__speed" aria-label={t('speedMode')} disabled={paused} onClick={() => { session.input.modeRequest = session.telemetry.mode === 'cruise' ? 'fast' : session.telemetry.mode === 'fast' ? 'jump' : 'cruise'; }}>
                <svg viewBox="0 0 120 120" aria-hidden>
                  <circle cx="60" cy="60" r="52" />
                  <circle className="flight-hud__speed-arc" cx="60" cy="60" r="52" pathLength="1" />
                  <line className="flight-hud__speed-index" x1="60" y1="4" x2="60" y2="14" />
                </svg>
                <span ref={modeRef} className="flight-hud__mode" />
                <span ref={speedRef} className="flight-hud__speed-value">0</span><small>{t('kmS')}</small>
              </button>
              <div className="flight-hud__systems">
                {BARS.map((key, i) => { const Icon = ICONS[i]; return <div key={key} className="flight-hud__sys" aria-label={t(key)}>
                  <Icon size={14} aria-hidden /><span className="flight-hud__sys-name">{t(key)}</span>
                  <span className="flight-hud__track"><span ref={(el) => { barRefs.current[i] = el; }} /></span>
                  <span ref={(el) => { barValRefs.current[i] = el; }} className="flight-hud__percent">100%</span>
                </div>; })}
              </div>
            </div>
            <div className="flight-hud__aux">
              {touch ? (
                <>
                  <button type="button" {...hold('fire')} aria-label={t('fire')}><Crosshair size={20} aria-hidden /><span>{t('fire')}</span></button>
                  <button type="button" {...hold('boost')} aria-label={t('boost')}><ChevronsUp size={20} aria-hidden /><span>{t('boost')}</span></button>
                  <button type="button" {...hold('brake')} aria-label={t('brake')}><Pause size={16} aria-hidden /><span>{t('brake')}</span></button>
                </>
              ) : (
                <button type="button" onClick={() => { session.input.foilsToggle = true; }} aria-label={t('foils')} disabled={paused}>
                  <ChevronsUp size={18} aria-hidden /><span>{t('foils')}</span>
                </button>
              )}
            </div>
          </div>
          {touch && !paused && <canvas ref={padRef} className="flight-hud__pad" aria-hidden />}
        </>
      )}
    </div>
  );
}
