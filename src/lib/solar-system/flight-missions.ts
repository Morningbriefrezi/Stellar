// The expedition log: a short list of places worth flying to and things
// worth doing, each unlocked once from the flight telemetry and remembered
// in localStorage. Pure logic — the HUD names them from the message
// catalogue, the canvas never sees them.

export interface MissionContext {
  /** Nearest body id ('' when nothing is close) and altitude in radii above its surface. */
  nearId: string;
  altRadii: number;
  /** Heliocentric distance in scene units. */
  sunDist: number;
  speedFrac: number;
  mode: string;
  systemName: string;
  kills: number;
  /** A passive contact has finished scanning the ship. */
  scanned: boolean;
  /** Scene distance to the nearest deep-space probe. */
  probeDist: number;
  targetId: string;
}

export interface Discovery {
  id: string;
  /** The body the discovery belongs to, for the HUD's region readout. */
  body?: string;
  when: (c: MissionContext) => boolean;
}

/** Heliocentric distance the flight model treats as the heliopause — about
 *  120 AU on the orrery's compression, past every planet and inside the probes. */
export const HELIOPAUSE_SCENE = 8.2;

export const DISCOVERIES: Discovery[] = [
  { id: 'moonPass', body: 'moon', when: (c) => c.nearId === 'moon' && c.altRadii < 1.2 },
  { id: 'earthOrbit', body: 'earth', when: (c) => c.nearId === 'earth' && c.altRadii < 0.9 && c.altRadii > 0.15 },
  { id: 'issFlyby', body: 'iss', when: (c) => c.targetId === 'iss' && c.nearId === 'earth' && c.altRadii < 0.6 },
  { id: 'marsVisit', body: 'mars', when: (c) => c.nearId === 'mars' && c.altRadii < 2.5 },
  { id: 'venusClouds', body: 'venus', when: (c) => c.nearId === 'venus' && c.altRadii < 0.5 },
  { id: 'mercuryDawn', body: 'mercury', when: (c) => c.nearId === 'mercury' && c.altRadii < 2 },
  { id: 'beltCrossing', body: 'ceres', when: (c) => (c.nearId === 'ceres' || c.nearId === 'vesta') && c.altRadii < 6 },
  { id: 'jupiterApproach', body: 'jupiter', when: (c) => c.nearId === 'jupiter' && c.altRadii < 2.2 },
  { id: 'greatRedSpot', body: 'jupiter', when: (c) => c.nearId === 'jupiter' && c.altRadii < 0.35 },
  { id: 'europaScan', body: 'europa', when: (c) => c.nearId === 'europa' && c.altRadii < 2.5 },
  { id: 'saturnRings', body: 'saturn', when: (c) => c.nearId === 'saturn' && c.altRadii < 1.4 && c.altRadii > 0.12 },
  { id: 'titanHaze', body: 'titan', when: (c) => c.nearId === 'titan' && c.altRadii < 2.5 },
  { id: 'uranusTilt', body: 'uranus', when: (c) => c.nearId === 'uranus' && c.altRadii < 2.5 },
  { id: 'neptuneWinds', body: 'neptune', when: (c) => c.nearId === 'neptune' && c.altRadii < 2.5 },
  { id: 'plutoHeart', body: 'pluto', when: (c) => c.nearId === 'pluto' && c.altRadii < 2.5 },
  { id: 'solarCorona', body: 'sun', when: (c) => c.nearId === 'sun' && c.altRadii < 0.6 },
  { id: 'probeFound', when: (c) => c.probeDist < 0.12 },
  { id: 'heliopause', when: (c) => c.sunDist > HELIOPAUSE_SCENE && c.systemName === 'sol' },
  { id: 'anomaly', when: (c) => c.scanned },
  { id: 'firstBlood', when: (c) => c.kills >= 1 },
  { id: 'lightSpeed', when: (c) => c.mode === 'jump' },
  { id: 'alphaCentauri', body: 'alphaCenA', when: (c) => c.systemName === 'alphaCentauri' },
  { id: 'centauriPrime', body: 'centauriPrime', when: (c) => c.nearId === 'centauriPrime' && c.altRadii < 2.5 },
  { id: 'proximaB', body: 'proximaB', when: (c) => c.nearId === 'proximaB' && c.altRadii < 2.5 },
];

const STORE_KEY = 'stellar_expedition_log';

export interface MissionTracker {
  /** Evaluate this frame; returns the id of a newly unlocked discovery, or ''. */
  tick: (c: MissionContext, dt: number) => string;
  has: (id: string) => boolean;
  count: () => number;
  total: number;
}

function load(): Set<string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function save(done: Set<string>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...done]));
  } catch {
    // Private mode or quota — the log lives for the session only.
  }
}

export function makeMissionTracker(): MissionTracker {
  const done = load();
  // Only one unlock per frame, and a short lockout after it, so two
  // discoveries earned in the same pass arrive as two moments.
  let cooldown = 0;
  return {
    total: DISCOVERIES.length,
    tick(c, dt) {
      if (cooldown > 0) {
        cooldown -= dt;
        return '';
      }
      for (const d of DISCOVERIES) {
        if (done.has(d.id)) continue;
        if (!d.when(c)) continue;
        done.add(d.id);
        save(done);
        cooldown = 6;
        return d.id;
      }
      return '';
    },
    has: (id) => done.has(id),
    count: () => done.size,
  };
}
