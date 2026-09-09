'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import LiveView from './LiveView';
import TelemetryPanel from './TelemetryPanel';
import ControlPanel from './ControlPanel';
import MissionLog, { type LogEntry } from './MissionLog';
import CompareControl from './CompareControl';
import TimeControl from './TimeControl';
import SessionClock from './SessionClock';
import { acquisitionStateAt, planAcquisition, pointingAt, type Acquisition } from '@/lib/observatory/mission';
import { LIMITS, evaluateSafety, type AltAz, type SafetyVerdict } from '@/lib/observatory/safety';
import {
  DEFAULT_SEEING_ARCSEC,
  ROIS,
  ROI_BY_ID,
  TRAINS,
  TRAIN_BY_ID,
  fieldOfView,
  effectiveFocalLength,
  fieldRotationDegPerHour,
  resolvingPowerArcsec,
} from '@/lib/observatory/optics';
import {
  SIM_TARGETS,
  SIM_TARGET_BY_ID,
  targetAltAz,
  targetPhoto,
  targetSizeArcmin,
  targetRaHours,
  targetFrameSpan,
  type SimTarget,
} from '@/lib/observatory/sim-targets';
import { effectiveBlurArcsec } from '@/lib/observatory/render';
import { MotorAudio } from '@/lib/observatory/motor-audio';
import { hourAngle, localSiderealHours } from '@/lib/observatory/site-time';
import EventsPanel from './EventsPanel';
import { getSunAltitude, getTonightDarkWindow } from '@/lib/dark-window';
import type { ObservatoryNode } from '@/lib/observatory/types';

/**
 * What an observer would actually put in the train for each target.
 *
 * Planets get a Barlow and a cropped read-out, because 2.9 um pixels
 * undersample this scope at f/10 and a small ROI is what lifts the frame rate
 * into lucky-imaging territory. The Moon gets the reducer so the disc fits.
 * Deep sky stays native and full-frame.
 */
const RECOMMENDED_SETUP: Record<string, { train: string; roi: string; exposureSec: number }> = {
  moon: { train: 'reducer', roi: 'full', exposureSec: 0.01 },
  jupiter: { train: 'barlow2', roi: '640', exposureSec: 0.02 },
  saturn: { train: 'barlow3', roi: '640', exposureSec: 0.05 },
  mars: { train: 'barlow3', roi: '400', exposureSec: 0.02 },
  venus: { train: 'barlow2', roi: '640', exposureSec: 0.005 },
  m42: { train: 'native', roi: 'full', exposureSec: 8 },
  m31: { train: 'reducer', roi: 'full', exposureSec: 30 },
  m57: { train: 'native', roi: 'full', exposureSec: 8 },
};

/** Where the mount sits when it is not working. */
const PARKED: AltAz = { altitude: 0, azimuth: 0 };

/**
 * The middle of the next dark window that has not happened yet.
 *
 * getTonightDarkWindow anchors at noon *yesterday* whenever it is asked before
 * midday, which is the right answer for "was last night dark" and the wrong one
 * here: at 11:00 it returns a midpoint around 01:00 this morning, already in the
 * past, and jumping to it moves the clock nowhere. Asking again from twelve
 * hours ahead moves the anchor to today's noon and yields tonight instead.
 */
function nextDarkMidpoint(lat: number, lon: number, from: Date): Date | null {
  for (const hoursAhead of [0, 12, 24]) {
    const reference = new Date(from.getTime() + hoursAhead * 3_600_000);
    const midpoint = getTonightDarkWindow(lat, lon, reference).midpoint;
    if (midpoint && midpoint.getTime() > from.getTime()) return midpoint;
  }
  return null;
}
const SEEING_ARCSEC = DEFAULT_SEEING_ARCSEC;
const TICK_MS = 250;

export default function SessionConsole({
  node,
  cloudCover,
  session,
}: {
  node: ObservatoryNode;
  cloudCover: number | null;
  /**
   * A booked slot. The console runs on the real clock inside it — there is no
   * moving time when the instrument is somebody else's for twenty minutes.
   */
  session?: { id: string; startsAtMs: number; endsAtMs: number };
}) {
  const { getAccessToken } = usePrivy();
  const [clock, setClock] = useState<number | null>(null);
  // Simulated time runs forward from the real clock plus an offset, so the
  // console keeps ticking wherever the visitor moved it to.
  const [offsetMs, setOffsetMs] = useState(0);
  const now = (clock ?? 0) + offsetMs;
  const [acquisition, setAcquisition] = useState<Acquisition | null>(null);
  const [exposureSec, setExposureSec] = useState(2);
  const [trainId, setTrainId] = useState('native');
  const [roiId, setRoiId] = useState('full');
  const [gain, setGain] = useState(40);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [captures, setCaptures] = useState(0);
  const [splitAt, setSplitAt] = useState<number | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const audioRef = useRef<MotorAudio | null>(null);
  if (audioRef.current === null && typeof window !== 'undefined') audioRef.current = new MotorAudio();

  useEffect(() => {
    const real = Date.now();
    setClock(real);

    // Opening the console in daylight refuses all eight targets for the same
    // reason, which teaches a visitor nothing and reads as a broken page. The
    // simulator is the one thing here anyone can touch without an account, so
    // it starts in tonight's dark window whenever the Sun is up. A booked
    // session never moves: the instrument is somebody else's for those twenty
    // minutes and the clock is the real one.
    if (!session && getSunAltitude(node.lat, node.lon, new Date(real)) > LIMITS.sunAltitudeCeilingDeg) {
      const midpoint = nextDarkMidpoint(node.lat, node.lon, new Date(real));
      if (midpoint) setOffsetMs(midpoint.getTime() - real);
    }

    const id = setInterval(() => setClock(Date.now()), TICK_MS);
    return () => clearInterval(id);
    // Mount only: this picks a starting clock, it does not track the Sun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = useMemo(() => new Date(now), [now]);
  // Commands must be evaluated on the same clock the buttons were graded on.
  // Reading Date.now() inside a handler instead let a target be offered at the
  // simulated hour and then refused at the real one.
  const nowRef = useRef(now);
  nowRef.current = now;
  const train = TRAIN_BY_ID.get(trainId) ?? TRAINS[1];
  const roi = ROI_BY_ID.get(roiId) ?? ROIS[0];
  const fov = useMemo(
    () => fieldOfView(node.instrument, train, roi),
    [node.instrument, train, roi],
  );
  const diffractionArcsec = useMemo(
    () => resolvingPowerArcsec(node.instrument),
    [node.instrument],
  );

  // Recomputed each tick: a target that is safe now can set below the limit
  // twenty minutes later, and the buttons must say so before they are pressed.
  const verdicts = useMemo(() => {
    const out: Record<string, SafetyVerdict> = {};
    for (const target of SIM_TARGETS) {
      out[target.id] = evaluateSafety(node, targetAltAz(target, node, date), date);
    }
    return out;
  }, [node, date]);

  const status = acquisition ? acquisitionStateAt(acquisition, now) : null;
  const pointing = acquisition ? pointingAt(acquisition, now) : PARKED;
  const target = acquisition ? SIM_TARGET_BY_ID.get(acquisition.targetId) ?? null : null;

  const settledMs = acquisition && status?.state === 'OBSERVING' ? now - acquisition.settledAtMs : 0;
  const subs = Math.floor(settledMs / (exposureSec * 1000));
  const rotationRate = fieldRotationDegPerHour(node.lat, pointing.altitude, pointing.azimuth);

  const slewing = status?.state === 'SLEWING';
  const observing = status?.state === 'OBSERVING';

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioOn) return;

    // A real mount ramps its axes up and back down rather than stepping to
    // full rate, so the pitch follows an acceleration profile.
    const ramp = (p: number) => Math.min(1, Math.min(p, 1 - p) / 0.15);
    audio.setSlew(slewing ? 3 * ramp(status?.progress ?? 0) : 0);
    audio.setTracking(observing);
  }, [audioOn, slewing, observing, status?.progress]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioOn) return;
    audio.click('relay');
  }, [audioOn, slewing]);

  useEffect(() => () => audioRef.current?.stop(), []);

  const toggleAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioOn) {
      audio.setSlew(0);
      audio.setTracking(false);
      setAudioOn(false);
      return;
    }
    // Browsers only allow an audio context to start inside a user gesture.
    setAudioOn(await audio.start());
  }, [audioOn]);

  const append = useCallback((text: string, refused = false) => {
    setLog((prev) => [...prev, { at: nowRef.current, text, refused }].slice(-60));
  }, []);

  const goTo = useCallback(
    (next: SimTarget) => {
      const atMs = nowRef.current;
      const at = new Date(atMs);
      const to = targetAltAz(next, node, at);
      const verdict = evaluateSafety(node, to, at);

      if (!verdict.ok) {
        append(`GoTo ${next.name} refused — ${verdict.reason}`, true);
        return;
      }

      const from = acquisition ? pointingAt(acquisition, atMs) : PARKED;
      setAcquisition(
        planAcquisition({
          targetId: next.id,
          targetName: next.name,
          from,
          to,
          startedAtMs: atMs,
          warm: acquisition !== null,
        }),
      );
      const setup = RECOMMENDED_SETUP[next.id] ?? { train: 'native', roi: 'full', exposureSec: 2 };
      setTrainId(setup.train);
      setRoiId(setup.roi);
      setExposureSec(setup.exposureSec);
      setCaptures(0);
      append(`GoTo ${next.name} — ${to.altitude.toFixed(1)}° altitude, ${to.azimuth.toFixed(1)}° azimuth`);
    },
    [acquisition, append, node],
  );

  const capture = useCallback(async () => {
    if (!target) return;
    if (audioOn) audioRef.current?.click('shutter');
    setCaptures((c) => c + 1);
    append(`Captured ${target.name} — ${subs} subs, ${(subs * exposureSec).toFixed(0)}s integration`);

    // The sandbox keeps its frames in the browser. A booked session files them,
    // and the server decides what they are worth — the log says which.
    if (!session) return;
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/observatory/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sessionId: session.id,
          targetId: target.id,
          targetName: target.name,
          exposureSec,
          subs,
          opticalTrain: trainId,
          roi: roiId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        append(`Frame not filed — ${data.error ?? 'the store refused it'}.`);
        return;
      }
      append(data.admitted ? 'Filed to your Collection.' : data.reason);
    } catch {
      append('Frame not filed — network error.');
    }
  }, [append, audioOn, exposureSec, getAccessToken, roiId, session, subs, target, trainId]);

  const jumpToNight = useCallback(() => {
    const real = Date.now();
    const midpoint = nextDarkMidpoint(node.lat, node.lon, new Date(real));
    if (!midpoint) return;

    const nextOffset = midpoint.getTime() - real;
    setOffsetMs(nextOffset);
    nowRef.current = real + nextOffset;
    setAcquisition(null);
    append('Clock moved to tonight\u2019s dark window.');
  }, [append, node.lat, node.lon]);

  const returnToNow = useCallback(() => {
    setOffsetMs(0);
    nowRef.current = Date.now();
    setAcquisition(null);
    append('Clock returned to now.');
  }, [append]);

  const park = useCallback(() => {
    setAcquisition(null);
    append('Parked. Mount at home, camera idle.');
  }, [append]);

  // Every number on this console comes from a clock, and the server's clock is
  // not the visitor's — rendering any of it before mount is a guaranteed
  // hydration mismatch. The shell holds the layout until the browser takes over.
  if (clock === null) {
    return (
      <div className="obs-panel" style={{ minHeight: '28rem' }}>
        <div className="obs-panel__bar">
          <span className="flex items-center gap-2">
            <span className="obs-led" aria-hidden="true" />
            <span className="obs-panel__title">Standby</span>
          </span>
          <span className="obs-panel__title">Acquiring site clock</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] lg:items-start">
      <div className="flex flex-col gap-4">
        {session ? (
          <SessionClock
            now={now}
            timezone={node.timezone}
            startsAtMs={session.startsAtMs}
            endsAtMs={session.endsAtMs}
          />
        ) : (
          <TimeControl
            now={now}
            timezone={node.timezone}
            offsetMs={offsetMs}
            onJumpToNight={jumpToNight}
            onReturnToNow={returnToNow}
          />
        )}

        <div className="obs-frame">
          <LiveView
            state={status?.state ?? 'SCHEDULED'}
            progress={status?.progress ?? 0}
            photoSrc={target ? targetPhoto(target)?.src ?? null : null}
            fovArcmin={fov.widthArcmin}
            targetArcmin={target ? targetSizeArcmin(target, date) : 0}
            seeingArcsec={SEEING_ARCSEC}
            diffractionArcsec={diffractionArcsec}
            plateScaleArcsecPx={fov.plateScaleArcsecPx}
            bortle={node.bortle}
            subs={Math.max(1, subs)}
            gain={gain}
            rotationDeg={(rotationRate * settledMs) / 3_600_000}
            seed={Math.round(pointing.altitude * 10) * 1000 + Math.round(pointing.azimuth * 10)}
            frameSpan={target ? targetFrameSpan(target) : 1}
            showFieldStars={target?.brightness !== 'bright'}
            splitAt={status?.state === 'OBSERVING' ? splitAt : null}
          />

          <span className="obs-frame__tag">Simulated</span>

          {splitAt !== null && status?.state === 'OBSERVING' && (
            <>
              <span className="obs-frame__corner-note obs-frame__corner-note--left">1 sub</span>
              <span className="obs-frame__corner-note obs-frame__corner-note--right">
                {subs.toLocaleString()} stacked
              </span>
            </>
          )}
        </div>

        <div className="obs-panel">
          <div className="obs-panel__bar" style={{ borderBottom: 0 }}>
            <span className="flex items-center gap-2">
              <span
                className={`obs-led ${
                  observing ? 'obs-led--nominal' : status ? 'obs-led--active' : ''
                }`}
                aria-hidden="true"
              />
              <span className="obs-panel__title">{status?.state ?? 'Parked'}</span>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {status ? status.detail : 'Mount at home'}
              </span>
            </span>

            <span className="flex items-center gap-3">
              {status && !observing && (
                <span className="obs-panel__title" style={{ color: 'var(--accent-text)' }}>
                  {Math.round(status.progress * 100)}%
                  {status.msToSettled > 0 && ` · T-${Math.ceil(status.msToSettled / 1000)}s`}
                </span>
              )}
              <button
                type="button"
                className="obs-action"
                onClick={toggleAudio}
                aria-pressed={audioOn}
                title="Servo and drive audio"
              >
                {audioOn ? 'Audio on' : 'Audio off'}
              </button>
            </span>
          </div>
        </div>

        <CompareControl
          splitAt={splitAt}
          onSplit={setSplitAt}
          disabled={status?.state !== 'OBSERVING'}
        />

        <EventsPanel lat={node.lat} lon={node.lon} now={now} timezone={node.timezone} />

        <TelemetryPanel
          t={{
            altitude: pointing.altitude,
            hourAngle: target ? hourAngle(targetRaHours(target, date), node.lon, date) : null,
            siderealHours: localSiderealHours(node.lon, date),
            azimuth: pointing.azimuth,
            fovArcmin: fov.widthArcmin,
            targetArcmin: target ? targetSizeArcmin(target, date) : null,
            subs,
            exposureSec,
            gain,
            seeingArcsec: SEEING_ARCSEC,
            resolvedArcsec: effectiveBlurArcsec({
              seeingArcsec: SEEING_ARCSEC,
              diffractionArcsec,
              subs: Math.max(1, subs),
            }),
            focalLengthMm: effectiveFocalLength(node.instrument, train),
            plateScaleArcsecPx: fov.plateScaleArcsecPx,
            rotationDegPerHour: acquisition ? rotationRate : null,
            cloudCover,
          }}
        />
      </div>

      <div className="flex flex-col gap-4">
        <ControlPanel
          targetId={target?.id ?? null}
          verdicts={verdicts}
          onGoTo={goTo}
          exposureSec={exposureSec}
          brightness={target?.brightness ?? 'faint'}
          onExposure={setExposureSec}
          trainId={trainId}
          onTrain={setTrainId}
          roiId={roiId}
          onRoi={setRoiId}
          gain={gain}
          onGain={setGain}
          onCapture={capture}
          canCapture={status?.state === 'OBSERVING'}
          onPark={park}
          parked={acquisition === null}
        />
        <MissionLog entries={log} timezone={node.timezone} />
        {captures > 0 && (
          <p className="obs-label">
            {captures} simulated capture{captures === 1 ? '' : 's'} · not saved, never minted
          </p>
        )}
      </div>
    </div>
  );
}
