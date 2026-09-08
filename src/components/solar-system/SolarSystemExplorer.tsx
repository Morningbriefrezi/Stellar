'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { SolarSystemCanvas } from '@/components/solar-system/SolarSystemCanvas';
import { PlayerShip } from '@/components/solar-system/PlayerShip';
import { createFlightSession, type FlightSession } from '@/lib/solar-system/player-ship';
import type { SolarBodyId } from '@/lib/solar-system/ephemeris';

const SPEED_STEPS = [
  { id: 'realtime', rate: 1 },
  { id: '10m', rate: 600 },
  { id: '1h', rate: 3600 },
  { id: '1d', rate: 86400 },
] as const;

export default function SolarSystemExplorer() {
  const t = useTranslations('solarSystem');
  const format = useFormatter();
  const router = useRouter();
  const [epochMs, setEpochMs] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<SolarBodyId | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [flightActive, setFlightActive] = useState(false);
  const [zoomTo, setZoomTo] = useState<number | null>(null);
  const flightRef = useRef<FlightSession | null>(null);
  if (!flightRef.current) flightRef.current = createFlightSession();
  const zoomToSun = useCallback(() => { setSelectedId(null); setZoomTo(26); }, []);
  const consumeZoom = useCallback(() => setZoomTo(null), []);

  useEffect(() => {
    document.body.setAttribute('data-solar-immersive', '1');
    return () => document.body.removeAttribute('data-solar-immersive');
  }, []);
  useEffect(() => {
    if (!playing || flightActive) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setEpochMs((e) => e + SPEED_STEPS[speedIdx].rate * dt * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speedIdx, flightActive]);

  return (
    <div className="solar-system solar-system--immersive">
      {!flightActive && <div className="solar-system__chrome-float">
        <button type="button" className="solar-system__fab solar-system__fab--close" onClick={() => router.push('/sky')} aria-label={t('immersive.exit')}>
          <X size={20} aria-hidden />
        </button>
        <span className="solar-system__mini-clock">
          {selectedId ? t(`bodies.${selectedId}.name`) : format.dateTime(new Date(epochMs), { month: 'short', day: 'numeric' })}
        </span>
      </div>}
      <div className="solar-system__viewport solar-system__viewport--fill">
        <SolarSystemCanvas epochMs={epochMs} scaleMode="orrery" includePluto selectedId={selectedId} focusBodyId={selectedId}
          onSelect={setSelectedId} onZoomToSun={zoomToSun} zoomTo={zoomTo} onZoomToConsumed={consumeZoom} flight={flightRef.current} />
        <PlayerShip session={flightRef.current} onActiveChange={setFlightActive} />
      </div>
      {!flightActive && <div className="solar-system__dockbar" role="group" aria-label={t('time.title')}>
        <button type="button" className="solar-system__dockbtn" onClick={() => setPlaying((p) => !p)} aria-label={t(playing ? 'time.pause' : 'time.play')}>
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <button type="button" className="solar-system__chip solar-system__ratebtn" onClick={() => setSpeedIdx((i) => (i + 1) % SPEED_STEPS.length)} aria-label={t('time.speedAria')}>
          {t(`time.speed.${SPEED_STEPS[speedIdx].id}`)}
        </button>
        <button type="button" className="solar-system__dockbtn" onClick={() => { setEpochMs(Date.now()); zoomToSun(); }} aria-label={t('time.now')}>
          <RotateCcw size={16} aria-hidden />
        </button>
      </div>}
    </div>
  );
}
