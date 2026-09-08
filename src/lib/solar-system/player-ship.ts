// Player spacecraft for Explore Mode — Stellar's own survey ship and
// interceptor flying the real solar system, with three speed regimes,
// gravity wells, solid planets you can crash into, a shield-then-hull
// damage model, a navigation target, an expedition log, and a hyperdrive
// that jumps to the next star.
//
// Everything here is scene-scale. The ephemeris scene is tiny (Earth radius
// ≈ 0.028, alien saucer ≈ 0.012), so flight numbers live in "flight units"
// of FLIGHT_UNIT scene units and the hull in H, a fraction of that: the ship
// is about a third of an Earth radius long, so every planet towers over it.
//
// Geometry lives in ship-mesh.ts, the chase camera in flight-camera.ts,
// desktop input in flight-input.ts, the two surviving sounds in
// flight-audio.ts, the expedition log in flight-missions.ts and target maths in
// flight-targeting.ts. This file is the flight model and the glue.

import * as THREE from 'three';
import type { AlienHandle } from '@/lib/solar-system/aliens';
import { softSpriteTexture } from '@/lib/solar-system/soft-sprite';
import { makeFlightAudio } from '@/lib/solar-system/flight-audio';
import { makeCameraRig, type CameraFrame } from '@/lib/solar-system/flight-camera';
import { buildCosmonaut, buildKestrel, buildXfoil, type ShipKind, type ShipParts } from '@/lib/solar-system/ship-mesh';
import { shapeMouse } from '@/lib/solar-system/flight-input';
import { makeMissionTracker, type MissionContext } from '@/lib/solar-system/flight-missions';
import { projectTarget, stepTarget, type TargetCandidate, type TargetKind, type TargetScreen } from '@/lib/solar-system/flight-targeting';

export type { ShipKind } from '@/lib/solar-system/ship-mesh';
export { zoomFlightCamera, clearFlightInput } from '@/lib/solar-system/flight-input';

export const FLIGHT_UNIT = 0.006;
const U = FLIGHT_UNIT;
/** Hull unit — the ships are 8–9 H long. Sized against the worlds: the
 *  Kestrel spans about a thirteenth of Earth's radius, so a planet fills
 *  the view the way it should from a small craft, and the Moon still towers
 *  over the ship. */
const H = 0.044 * U;
/** Scene units → km, anchored on Earth's rendered radius (0.028 = 6,371 km). */
export const KM_PER_SCENE_UNIT = 6371 / 0.028;
const LIGHT_KM_S = 299_792.458;

export type SpeedMode = 'cruise' | 'fast' | 'jump';
export type Pilot = 'ship' | 'eva';
export type ViewMode = 'chase' | 'cockpit';
export type JumpPhase = 'none' | 'charge' | 'travel';
export type FlightAlert =
  | ''
  | 'proximity'
  | 'entry'
  | 'masslock'
  | 'gravity'
  | 'solar'
  | 'charging'
  | 'jump'
  | 'jumpready'
  | 'arrived'
  | 'hostile'
  | 'contact'
  | 'lowshield'
  | 'shielddown'
  | 'hullcritical'
  | 'docked'
  | 'undocked';

interface Regime {
  max: number;
  boost: number;
  accel: number;
  /** Turn-rate multiplier — a ship at a tenth of c cannot pivot like a dogfighter. */
  turn: number;
  camBack: number;
  fov: number;
}
// Cruise is paced against the worlds, not against the void: at its ceiling
// the ship crosses Earth's disc in about fifteen seconds, so a planet has
// time to grow, a pass has time to be flown, and the console reads in
// hundreds rather than thousands. Fast is the concession that makes the
// space between planets crossable.
const REGIMES: Record<Exclude<SpeedMode, 'jump'>, Regime> = {
  cruise: { max: 0.6 * U, boost: 1.3 * U, accel: 4 * U, turn: 1, camBack: 24 * H, fov: 46 },
  // Drag settles thrust at accel / (60 · 0.08); the fast regime needs the
  // extra push to actually reach its ceiling.
  fast: { max: 12 * U, boost: 20 * U, accel: 70 * U, turn: 0.55, camBack: 34 * H, fov: 58 },
};
/** How quickly the drive re-tunes between regimes (per second). */
const REGIME_BLEND = 1.6;
/** EVA: the suit's SAFER jets — slow, precise, no weapons. */
const E = 1.5 * H;
const EVA: Regime = { max: 0.16 * U, boost: 0.3 * U, accel: 1 * U, turn: 1, camBack: 14 * E, fov: 50 };
const EVA_CAM_UP = 0.9 * E;
const EVA_HULL_RADIUS = 0.6 * E;
/** How close the suit must be to climb back aboard. */
const BOARD_RANGE = 14 * H;
const STATION_HP = 6;
/** Docking: a station takes a ship arriving this slowly as a visitor rather
 *  than as a wreck, and berths it this far off the hull. */
const DOCK_SPEED = 0.12 * U;
const DOCK_GAP = 5 * H;
/** The berth clamps on for this long before thrust can cast off again —
 *  without it the throttle that flew the ship in would release it at once. */
const DOCK_HOLD = 1.6;
/** Berthed, the station tops the ship back up at this rate per second. */
const DOCK_REPAIR = 24;
/** A world that hails also resupplies: hull, shields and the banks, slowly. */
const SUPPLY_RATE = 8;
/** Standing order: cannon hits a world takes before it comes apart, and how
 *  long the completion banner holds before the next order comes in. */
const ORDER_HITS = 30;
const ORDER_DONE_HOLD = 9;
/** Worlds the order never picks: home, and the one world that talks to us. */
const ORDER_SPARED = new Set(['earth', 'centauriPrime']);
/** Anything further than this is in the other star system. */
const SYSTEM_REACH = 20;
/** Pilot's eye inside the hull, and the lens it looks through. */
const COCKPIT_EYE = new THREE.Vector3(0, 0.5 * H, 1.5 * H);
const COCKPIT_FOV = 70;
/** A hailing world opens its channel this close, in radii. */
const HAIL_RADII = 8;
const COMMS_LINES = 4;
const COMMS_LINE_SEC = 3.4;
const COMMS_GAP_SEC = 1.1;
const COMMS_COOLDOWN = 240;
/** Where the cannons' fire crosses the centreline. */
const BORESIGHT = 120 * H;
/** Mild aim assist: shots bend this far (rad) toward a hostile near the reticle. */
const AIM_ASSIST_CONE = 0.09;
const JUMP_CAM_BACK = 44 * H;
const JUMP_FOV = 74;
/** How far above the hull the chase camera rides. Kept low so the ship sits
 *  a little below the middle of the frame with the whole view open above it,
 *  and clear of the console along the bottom edge. */
const CAM_UP = 2.6 * H;
/** The chase camera stops here — closer and the hull clips the near plane.
 *  The canvas pulls the near plane in to FLIGHT_NEAR while a ship is flying,
 *  which is what lets the camera ride this close to something this small. */
const MIN_CAM_BACK = 10 * H;
/** Near / far planes for the world camera while flying. The ship is tiny and
 *  the camera rides just behind it, so the near plane has to come in; nothing
 *  past the star shell is drawn in flight, so the far plane comes in too —
 *  together they leave the depth buffer more precision than the orbit view. */
export const FLIGHT_NEAR = 0.0012;
export const FLIGHT_FAR = 1400;
const CAM_ZOOM_MIN = 0.45;
const CAM_ZOOM_MAX = 3.2;
const DRAG_PER_FRAME = 0.92; // at 60 fps; applied as pow(0.92, dt·60)
/** With flight assist off only a whisper of drag remains — momentum is the point. */
const FREE_DRAG_PER_FRAME = 0.9998;
const YAW_RATE = 1.15;
const PITCH_RATE = 1.0;
const ROLL_RATE = 1.8;
/** Assist-off: keys accelerate the rates instead of setting them. */
const FREE_ANG_ACCEL = 2.4;
const FREE_ANG_MAX = 2.2;
/** Flight assist rolls the wings level when the pilot lets go of the roll
 *  keys — the single biggest thing that stops a new pilot getting lost. It
 *  waits this long after a deliberate roll, then corrects at this rate. */
const LEVEL_DELAY = 0.8;
const LEVEL_RATE = 1.1;

const BOLT_SPEED = 24 * U;
const BOLT_LIFE = 0.8;
const BOLT_POOL = 16;
const FIRE_INTERVAL = 0.13;

/** Cannon energy: each bolt spends some, the bank refills between bursts. */
const ENERGY_PER_SHOT = 0.045;
const ENERGY_REGEN = 0.17;
/** Boost reservoir: burns while the throttle is firewalled, refills after. */
const BOOST_DRAIN = 0.12;
const BOOST_REGEN = 0.09;
const BOOST_REGEN_DELAY = 1.2;
/** Below this the reservoir is spent and the boost cuts out. */
const BOOST_FLOOR = 0.02;

const MAX_SHIELD = 100;
const MAX_HULL = 100;
/** Shields come back a few seconds after the last hit; the hull knits slowly. */
const SHIELD_REGEN_PER_SEC = 7;
const SHIELD_REGEN_DELAY = 5;
const HULL_REGEN_PER_SEC = 1.2;
const HULL_REGEN_DELAY = 10;
const RADAR_RANGE = 60 * U;
export const RADAR_MAX = 16;
/** Bodies the canvas may label with an on-screen bracket at once. */
export const MARKER_MAX = 4;

/** Collision sphere around the hull centre. */
const HULL_RADIUS = 1.3 * H;
/** Flight acceleration at 1 g on a body's surface — set against the cruise
 *  drive, so a world pulls hard enough to be felt and to be climbed out of. */
const ONE_G = 0.9 * U;
/** Gravity is felt out to this many radii. */
const GRAVITY_REACH = 10;
/** The nearest-body readout reaches further, so a star fills it on arrival. */
const NEAR_REACH = 24;
/** The Sun's real 274 m/s² would pin the inner system; cap the wells. */
const MAX_SURFACE_G = 30;
/** Inside this many radii the fast drive is throttled by the well. */
const WELL_RADII = 7;

const JUMP_CHARGE = 2.4;
const JUMP_TRAVEL = 4.6;
/** Altitude (in radii) below which a body mass-locks the hyperdrive. */
const MASS_LOCK_RADII = 3;
const JUMP_FLOW = 40 * U;
const RESPAWN_DELAY = 3.6;
const DISCOVERY_HOLD = 6;

const DUST_N = 260;
const DUST_BOX = 40 * U;

export interface FlightInput {
  /** -1..1, forward positive. */
  thrust: number;
  /** -1..1, right positive (keys / left stick). */
  yaw: number;
  /** -1..1, right positive (right stick). */
  lookYaw: number;
  /** -1..1, nose-up positive. */
  pitch: number;
  /** -1..1, roll-right positive. */
  roll: number;
  boost: boolean;
  fire: boolean;
  /** Held: swing the nose onto the navigation target. */
  align: boolean;
  /** Accumulated pointer deltas (px) since the last frame. */
  mouseDX: number;
  mouseDY: number;
  /** One-shot: the HUD / keys asked for a regime; the ship consumes it. */
  modeRequest: SpeedMode | null;
  /** One-shot: sweep the wings. */
  foilsToggle: boolean;
  /** One-shot: leave the ship in the suit, or climb back aboard. */
  eject: boolean;
  /** One-shot: chase camera ↔ cockpit. */
  viewToggle: boolean;
  /** One-shot: flight assist on ↔ off. */
  assistToggle: boolean;
  /** One-shot: cycle the navigation target outward (+1) or inward (-1). */
  targetStep: number;
  targetClear: boolean;
  /** One-shot: lock a specific target by id (the HUD's list). */
  targetRequest: string | null;
  /** Chase-camera distance multiplier — 1 = the regime's own distance. */
  camZoom: number;
  /** Right button held: the chase camera walks around the hull. */
  orbiting: boolean;
  /** Where the free look has walked to (rad); both zero = back on the tail. */
  orbitYaw: number;
  orbitPitch: number;
}

export interface FlightTelemetry {
  /** Flight units per second. */
  speed: number;
  speedKmS: number;
  /** Fraction of c. */
  speedC: number;
  /** 0..1 of the regime's ceiling. */
  speedFrac: number;
  throttle: number;
  mode: SpeedMode;
  assist: boolean;
  /** The hyperdrive is clear of every mass lock. */
  driveReady: boolean;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  boost: boolean;
  /** Radar contacts as (x, y) pairs in [-1, 1] — right / ahead positive. */
  radar: Float32Array;
  radarCount: number;
  /** 1 right after taking damage, decays to 0. */
  hitFlash: number;
  kills: number;
  foilsOpen: boolean;
  /** 0..1 — atmospheric entry heating. */
  heat: number;
  /** 0..1 — how deep into an atmosphere the ship is, regardless of speed. */
  atmo: number;
  /** 0..1 — the Sun (or another star) filling the view. */
  sunGlare: number;
  /** Distance flown under power, km. */
  odometerKm: number;
  /** 0..1 — cannon energy bank and boost reservoir. */
  energy: number;
  boostCharge: number;
  alert: FlightAlert;
  /** Nearest body ('' when nothing within reach) and altitude above its surface. */
  nearId: string;
  nearAltKm: number;
  /** A body has just come within sensor reach: named once, then cleared. */
  region: string;
  jumpPhase: JumpPhase;
  /** 0..1 through the current jump phase. */
  jumpT: number;
  /** White-out at jump entry / exit, decays to 0. */
  jumpFlash: number;
  crashed: boolean;
  respawnIn: number;
  /** Camera shake amplitude, 0..~1.5. */
  shake: number;
  /** Which star system the ship is in, and where the hyperdrive points. */
  systemName: string;
  targetName: string;
  targetLy: number;
  pilot: Pilot;
  /** Ceiling of the current regime (with boost), km/s — scales the gauge. */
  maxKmS: number;
  /** In the suit and close enough to climb back aboard. */
  canBoard: boolean;
  view: ViewMode;
  /** Airframe bank (rad) and pitch rate, for the cockpit overlay. */
  bank: number;
  pitchRate: number;
  /** On-screen body brackets, filled by the canvas each frame: x, y in CSS
   *  pixels and the body's apparent size (0..1) per marker. */
  markers: Float32Array;
  markerIds: string[];
  markerCount: number;
  /** Navigation target: what, how far, where on the glass. */
  navId: string;
  navKind: TargetKind | '';
  navKm: number;
  nav: TargetScreen;
  /** Navigation target on the radar disc, body frame, (x, y) in [-1, 1]. */
  navRadarX: number;
  navRadarY: number;
  /** Velocity vector on the glass — where the ship is actually going. */
  vv: TargetScreen;
  /** Every lockable target this frame, for the HUD's list (reused array). */
  navList: TargetCandidate[];
  /** Newly unlocked discovery id; held for a few seconds, then ''. */
  discovery: string;
  discoveryCount: number;
  discoveryTotal: number;
  /** Alien contact state as the sensors see it. */
  contact: 'none' | 'scan' | 'hostile';
  /** Incoming transmission: who, which line (1-based, 0 = none), how far typed. */
  commsFrom: string;
  commsLine: number;
  commsProgress: number;
  /** Berthed at a station, and the id of the station holding the ship. */
  docked: boolean;
  dockedTo: string;
  /** Taking on fuel and stores from a friendly world. */
  supply: boolean;
  /** Standing order: the world to destroy, how much of it is left (1..0),
   *  and a short hold after it is done. */
  orderId: string;
  orderIntegrity: number;
  orderDone: boolean;
}

export interface FlightSession {
  /** Set by the overlay; the canvas spawns / tears down the ship on change. */
  active: boolean;
  paused: boolean;
  /** Chosen in the hangar before launch. */
  shipKind: ShipKind;
  input: FlightInput;
  telemetry: FlightTelemetry;
}

/** A solid body the ship can orbit, burn up in, or hit. */
export interface FlightBody {
  id: string;
  kind: 'star' | 'planet' | 'moon' | 'station';
  position: THREE.Vector3;
  radius: number;
  radiusKm: number;
  /** Surface gravity, m/s². */
  surfaceG: number;
  /** Top of the atmosphere as a multiple of the radius (1 = airless). */
  atmosphere: number;
  /** Stations can be shot down or rammed; the scene hides them while set. */
  destroyed?: boolean;
  hp?: number;
  /** An inhabited world: it opens a channel and resupplies ships that come near. */
  hails?: boolean;
}

export interface FlightAnchor {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  /** Extra yaw after the look-at, so a planet can sit off to one side. */
  yaw: number;
}

export interface FlightWorld {
  bodies: FlightBody[];
  /** Points of interest that are not solid — the deep-space probes. */
  pois: TargetCandidate[];
  /** Where the ship respawns after a crash — a safe spot in the current system. */
  home: FlightAnchor;
  /** The hyperdrive's destination. */
  jump: FlightAnchor & { name: string; distanceLy: number };
  systemName: string;
}

export function createFlightSession(): FlightSession {
  return {
    active: false,
    paused: false,
    shipKind: 'kestrel',
    input: {
      thrust: 0, yaw: 0, lookYaw: 0, pitch: 0, roll: 0,
      boost: false, fire: false, align: false, mouseDX: 0, mouseDY: 0,
      modeRequest: null, foilsToggle: false, eject: false, viewToggle: false, assistToggle: false,
      targetStep: 0, targetClear: false, targetRequest: null,
      camZoom: 1, orbiting: false, orbitYaw: 0, orbitPitch: 0,
    },
    telemetry: {
      speed: 0,
      speedKmS: 0,
      speedC: 0,
      speedFrac: 0,
      throttle: 0,
      mode: 'cruise',
      assist: true,
      driveReady: true,
      hp: MAX_HULL,
      maxHp: MAX_HULL,
      shield: MAX_SHIELD,
      maxShield: MAX_SHIELD,
      boost: false,
      radar: new Float32Array(RADAR_MAX * 2),
      radarCount: 0,
      hitFlash: 0,
      kills: 0,
      foilsOpen: false,
      heat: 0,
      atmo: 0,
      sunGlare: 0,
      odometerKm: 0,
      energy: 1,
      boostCharge: 1,
      alert: '',
      nearId: '',
      nearAltKm: 0,
      region: '',
      jumpPhase: 'none',
      jumpT: 0,
      jumpFlash: 0,
      crashed: false,
      respawnIn: 0,
      shake: 0,
      systemName: 'sol',
      targetName: 'alphaCentauri',
      targetLy: 4.37,
      pilot: 'ship',
      maxKmS: 5 * U * KM_PER_SCENE_UNIT,
      canBoard: false,
      view: 'chase',
      bank: 0,
      pitchRate: 0,
      markers: new Float32Array(MARKER_MAX * 3),
      markerIds: [],
      markerCount: 0,
      navId: '',
      navKind: '',
      navKm: 0,
      nav: { x: 0, y: 0, on: 0, angle: 0 },
      navRadarX: 0,
      navRadarY: 0,
      vv: { x: 0, y: 0, on: 0, angle: 0 },
      navList: [],
      discovery: '',
      discoveryCount: 0,
      discoveryTotal: 0,
      contact: 'none',
      commsFrom: '',
      commsLine: 0,
      commsProgress: 0,
      docked: false,
      dockedTo: '',
      supply: false,
      orderId: '',
      orderIntegrity: 1,
      orderDone: false,
    },
  };
}

/* ───────────────────────── crash effects ───────────────────────── */

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  settled: boolean;
}

interface CrashFx {
  group: THREE.Group;
  /** `body` null = destroyed in open space: no gravity, debris drifts.
   *  `scale` multiplies the whole burst — 1 is a ship, hundreds is a world. */
  trigger: (point: THREE.Vector3, normal: THREE.Vector3, body: FlightBody | null, impactVel: THREE.Vector3, scale?: number) => void;
  update: (dt: number) => void;
  dispose: () => void;
}

function ringTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0)');
  grad.addColorStop(0.8, 'rgba(255,220,180,0.9)');
  grad.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Impact on a planet: a white-hot core inside an orange fireball, a dark
 * smoke bloom that outlives both, a shock ring racing across the surface,
 * a spray of sparks, and hull fragments thrown up the surface normal that
 * fall back under the body's own gravity and come to rest on the ground.
 * In open space the same burst with no ground: the fragments tumble away.
 */
function makeCrashFx(): CrashFx {
  const group = new THREE.Group();
  group.name = 'playerCrash';
  group.visible = false;
  const glowTex = softSpriteTexture();
  const ringTex = ringTexture();

  const mkSprite = (color: number, additive: boolean) => {
    const mat = new THREE.SpriteMaterial({
      map: glowTex,
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const s = new THREE.Sprite(mat);
    group.add(s);
    return { s, mat };
  };
  const core = mkSprite(0xfff4dc, true);
  const fire = mkSprite(0xff7a2a, true);
  const smoke = mkSprite(0x14100c, false);

  const ringMat = new THREE.MeshBasicMaterial({
    map: ringTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
  group.add(ring);

  const SPARK_N = 160;
  const sparkPos = new Float32Array(SPARK_N * 3);
  const sparkVel: THREE.Vector3[] = [];
  for (let i = 0; i < SPARK_N; i++) sparkVel.push(new THREE.Vector3());
  const sparkGeom = new THREE.BufferGeometry();
  sparkGeom.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    map: glowTex,
    color: new THREE.Color(1.8, 0.9, 0.4),
    size: 0.5 * H,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const sparks = new THREE.Points(sparkGeom, sparkMat);
  group.add(sparks);

  const debrisSkin = new THREE.MeshStandardMaterial({ color: 0x8c9199, roughness: 0.7, metalness: 0.5, transparent: true });
  const debrisDark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.75, metalness: 0.4, transparent: true });
  const debris: Debris[] = [];
  const debrisGeoms: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const geom = new THREE.BoxGeometry(
      (0.15 + Math.random() * 0.45) * H,
      (0.05 + Math.random() * 0.15) * H,
      (0.2 + Math.random() * 0.6) * H,
    );
    debrisGeoms.push(geom);
    const mesh = new THREE.Mesh(geom, i % 3 === 0 ? debrisDark : debrisSkin);
    mesh.visible = false;
    group.add(mesh);
    debris.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), settled: false });
  }

  let life = -1;
  let fxScale = 1;
  let body: FlightBody | null = null;
  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const LIFE = 3.4;

  const randomInHemisphere = (out: THREE.Vector3, spread: number) => {
    out.copy(normal)
      .addScaledVector(tangent, (Math.random() * 2 - 1) * spread)
      .addScaledVector(bitangent, (Math.random() * 2 - 1) * spread)
      .normalize();
  };

  return {
    group,
    trigger(at, n, hitBody, impactVel, scale = 1) {
      life = 0;
      fxScale = scale;
      sparkMat.size = 0.5 * H * scale;
      body = hitBody;
      point.copy(at);
      normal.copy(n);
      tangent.set(0, 1, 0);
      if (Math.abs(normal.dot(tangent)) > 0.9) tangent.set(1, 0, 0);
      tangent.cross(normal).normalize();
      bitangent.crossVectors(normal, tangent);
      group.position.copy(point);
      group.visible = true;
      core.s.position.set(0, 0, 0);
      fire.s.position.copy(normal).multiplyScalar(0.8 * H * scale);
      smoke.s.position.copy(normal).multiplyScalar(2.2 * H * scale);
      ring.position.copy(normal).multiplyScalar(0.05 * H * scale);
      ring.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), normal);
      ring.visible = !!body;
      const kick = Math.min(1.6, 0.6 + impactVel.length() / (4 * U));
      const spread = body ? 1.4 : 4;
      for (let i = 0; i < SPARK_N; i++) {
        sparkPos[i * 3] = 0;
        sparkPos[i * 3 + 1] = 0;
        sparkPos[i * 3 + 2] = 0;
        randomInHemisphere(sparkVel[i], spread);
        sparkVel[i].multiplyScalar((1 + Math.random() * 5) * U * kick * scale);
      }
      sparkGeom.getAttribute('position').needsUpdate = true;
      for (const d of debris) {
        d.mesh.visible = true;
        d.mesh.scale.setScalar(scale);
        d.settled = false;
        d.mesh.position.set(0, 0, 0).addScaledVector(normal, 0.3 * H * scale);
        d.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        randomInHemisphere(d.vel, body ? 1.1 : 4);
        d.vel.multiplyScalar((0.8 + Math.random() * 3.2) * U * kick * scale * (body ? 1 : 0.4));
        d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      }
      debrisSkin.opacity = 1;
      debrisDark.opacity = 1;
    },
    update(dt) {
      if (life < 0) return;
      life += dt;
      // A world takes longer to come apart than a hull does.
      const tk = Math.min(2.5, Math.sqrt(fxScale));
      if (life > LIFE * tk) {
        life = -1;
        group.visible = false;
        for (const d of debris) d.mesh.visible = false;
        return;
      }
      const t = life / tk;
      const hs = H * fxScale;
      const coreK = Math.min(1, t / 0.45);
      core.s.scale.setScalar((1.5 + 6 * coreK) * hs);
      core.mat.opacity = Math.max(0, 1 - t / 0.5);
      const fireK = Math.min(1, t / 1.4);
      fire.s.scale.setScalar((2 + 14 * Math.sqrt(fireK)) * hs);
      fire.mat.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 1.3) * 0.95;
      fire.mat.color.setRGB(1.6, 0.45 + 0.5 * (1 - fireK), 0.15);
      const smokeK = Math.min(1, t / 2.8);
      smoke.s.scale.setScalar((3 + 20 * Math.sqrt(smokeK)) * hs);
      smoke.mat.opacity = t < 0.3 ? (t / 0.3) * 0.85 : Math.max(0, 1 - (t - 0.3) / 3.0) * 0.85;
      const ringK = Math.min(1, t / 1.0);
      ring.scale.setScalar((1 + 22 * Math.sqrt(ringK)) * hs);
      ringMat.opacity = Math.max(0, 1 - ringK) * 0.9;

      const g = body ? Math.min(MAX_SURFACE_G, body.surfaceG) / 9.81 * ONE_G : 0;
      const floor = body ? body.radius : 0;
      for (let i = 0; i < SPARK_N; i++) {
        const v = sparkVel[i];
        v.addScaledVector(normal, -g * dt);
        v.multiplyScalar(Math.exp(-dt * 1.6));
        sparkPos[i * 3] += v.x * dt;
        sparkPos[i * 3 + 1] += v.y * dt;
        sparkPos[i * 3 + 2] += v.z * dt;
      }
      sparkGeom.getAttribute('position').needsUpdate = true;
      sparkMat.opacity = Math.max(0, 1 - t / 1.3);

      for (const d of debris) {
        if (d.settled) continue;
        d.vel.addScaledVector(normal, -g * dt);
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.y += d.spin.y * dt;
        d.mesh.rotation.z += d.spin.z * dt;
        if (body) {
          tmp.copy(d.mesh.position).add(point).sub(body.position);
          if (tmp.length() < floor + 0.08 * hs) {
            tmp.normalize().multiplyScalar(floor + 0.08 * hs).add(body.position).sub(point);
            d.mesh.position.copy(tmp);
            d.settled = true;
          }
        }
      }
      const fade = Math.max(0, Math.min(1, (LIFE - t) / 1.0));
      debrisSkin.opacity = fade;
      debrisDark.opacity = fade;
    },
    dispose() {
      core.mat.dispose();
      fire.mat.dispose();
      smoke.mat.dispose();
      ringMat.dispose();
      ringTex.dispose();
      ring.geometry.dispose();
      sparkGeom.dispose();
      sparkMat.dispose();
      for (const gm of debrisGeoms) gm.dispose();
      debrisSkin.dispose();
      debrisDark.dispose();
    },
  };
}

/* ───────────────────────── ship runtime ───────────────────────── */

export interface PlayerShipHandle {
  group: THREE.Group;
  /** Bolts fly in world space — add this to the scene beside `group`. */
  boltGroup: THREE.Group;
  /** World-space effects: speed streaks, the hyperspace glow, crash debris, the suit. */
  fxGroup: THREE.Group;
  spawn: (anchor: FlightAnchor) => void;
  takeDamage: (amount: number) => void;
  update: (
    dtSec: number,
    timeSec: number,
    camera: THREE.PerspectiveCamera,
    aliens: AlienHandle,
    world: FlightWorld,
  ) => void;
  dispose: () => void;
}

interface Bolt {
  mesh: THREE.Mesh;
  dir: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number; // <0 idle
}

/** The starfighter trades armour for pace: faster, and it turns harder. */
function shipRegimes(kind: ShipKind): Record<Exclude<SpeedMode, 'jump'>, Regime> {
  if (kind !== 'xfoil') return REGIMES;
  const tune = (r: Regime): Regime => ({ ...r, max: r.max * 1.2, boost: r.boost * 1.2, accel: r.accel * 1.3, turn: r.turn * 1.15 });
  return { cruise: tune(REGIMES.cruise), fast: tune(REGIMES.fast) };
}

export function createPlayerShip(session: FlightSession): PlayerShipHandle {
  const shipParts: ShipParts = session.shipKind === 'xfoil' ? buildXfoil(H) : buildKestrel(H);
  const evaParts = buildCosmonaut(E);
  const { group, cannonTips } = shipParts;
  const evaG = evaParts.group;
  evaG.visible = false;
  const regimes = shipRegimes(session.shipKind);
  const tel = session.telemetry;
  const input = session.input;
  const audio = makeFlightAudio();
  const crash = makeCrashFx();
  const rig = makeCameraRig();
  const missions = makeMissionTracker();
  tel.discoveryTotal = missions.total;
  tel.discoveryCount = missions.count();

  const fxGroup = new THREE.Group();
  fxGroup.name = 'playerFx';
  fxGroup.add(crash.group);
  fxGroup.add(evaG);

  // Pooled bolts — HDR amber so the bloom pass lights them up, and long
  // enough to read as a tracer rather than a dot.
  const boltGeom = new THREE.CylinderGeometry(0.14 * H, 0.14 * H, 6 * H, 6);
  boltGeom.rotateX(Math.PI / 2); // along +Z
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.5, 0.5) });
  const bolts: Bolt[] = [];
  const boltGroup = new THREE.Group();
  boltGroup.name = 'playerBolts';
  for (let i = 0; i < BOLT_POOL; i++) {
    const mesh = new THREE.Mesh(boltGeom, boltMat);
    mesh.visible = false;
    boltGroup.add(mesh);
    bolts.push({ mesh, dir: new THREE.Vector3(), velocity: new THREE.Vector3(), life: -1 });
  }

  // Speed streaks: a box of particles around the ship, drawn as segments
  // stretched along the flow — motes at cruise, lines at a tenth of c, a
  // tunnel in hyperspace.
  const dustRel: THREE.Vector3[] = [];
  const dustPos = new Float32Array(DUST_N * 6);
  for (let i = 0; i < DUST_N; i++) {
    dustRel.push(new THREE.Vector3(
      (Math.random() - 0.5) * DUST_BOX,
      (Math.random() - 0.5) * DUST_BOX,
      (Math.random() - 0.5) * DUST_BOX,
    ));
  }
  const dustGeom = new THREE.BufferGeometry();
  dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.LineBasicMaterial({
    color: 0xaac4ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.LineSegments(dustGeom, dustMat);
  dust.frustumCulled = false;
  fxGroup.add(dust);

  // Hyperspace: a glow far down the tunnel, and a ring of streaks that
  // converge on it.
  const jumpGlowMat = new THREE.SpriteMaterial({
    map: softSpriteTexture(),
    color: new THREE.Color(1.2, 1.5, 2.4),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const jumpGlow = new THREE.Sprite(jumpGlowMat);
  jumpGlow.visible = false;
  fxGroup.add(jumpGlow);
  const TUNNEL_N = 140;
  const tunnelPos = new Float32Array(TUNNEL_N * 6);
  const tunnelSeed = new Float32Array(TUNNEL_N * 3);
  for (let i = 0; i < TUNNEL_N; i++) {
    tunnelSeed[i * 3] = Math.random() * Math.PI * 2;
    tunnelSeed[i * 3 + 1] = 0.35 + Math.random() * 0.65;
    tunnelSeed[i * 3 + 2] = Math.random();
  }
  const tunnelGeom = new THREE.BufferGeometry();
  tunnelGeom.setAttribute('position', new THREE.BufferAttribute(tunnelPos, 3));
  const tunnelMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(0.7, 0.9, 1.6),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tunnel = new THREE.LineSegments(tunnelGeom, tunnelMat);
  tunnel.frustumCulled = false;
  tunnel.visible = false;
  fxGroup.add(tunnel);

  const vel = new THREE.Vector3();
  const angVel = new THREE.Vector3();
  const angTarget = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const flow = new THREE.Vector3();
  const jumpDir = new THREE.Vector3();
  const jumpStart = new THREE.Vector3();
  const jumpTarget: FlightAnchor = { position: new THREE.Vector3(), lookAt: new THREE.Vector3(), yaw: 0 };
  let jumpName = '';
  let jumpOrigin = '';
  let arrivedHold = 0;
  const crashLook = new THREE.Vector3();
  const invQ = new THREE.Quaternion();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const navPos = new THREE.Vector3();
  const candidates: TargetCandidate[] = [];
  const jumpCandidate: TargetCandidate = { id: 'jump', kind: 'jump', position: new THREE.Vector3() };
  const contactCandidate: TargetCandidate = { id: 'contact', kind: 'contact', position: new THREE.Vector3() };
  const bodyCandidates = new Map<string, TargetCandidate>();
  const missionCtx: MissionContext = {
    nearId: '', altRadii: 99, sunDist: 0, speedFrac: 0, mode: 'cruise', systemName: 'sol',
    kills: 0, scanned: false, probeDist: Infinity, targetId: '',
  };

  let pilot: Pilot = 'ship';
  let view: ViewMode = 'chase';
  let mode: SpeedMode = 'cruise';
  let assist = true;
  let commsLine = -1;
  let commsT = 0;
  let commsCool = 0;
  let commsFrom = '';
  let regime: Regime = regimes.cruise;
  // The drive re-tunes between regimes over a second or so rather than
  // stepping — the effective numbers chase the selected regime.
  const eff = { max: regimes.cruise.max, boost: regimes.cruise.boost, accel: regimes.cruise.accel, turn: regimes.cruise.turn };
  let jumpPhase: JumpPhase = 'none';
  let jumpT = 0;
  let pendYaw = 0;
  let pendPitch = 0;
  let fireAcc = 0;
  let cannonIdx = 0;
  let hull = MAX_HULL;
  let shield = MAX_SHIELD;
  let sinceHit = 99;
  let camBack = REGIMES.cruise.camBack;
  let bank = 0;
  let foilT = 0;
  let foilsForced: boolean | null = null;
  let heat = 0;
  let heatSoak = 0;
  let energy = 1;
  let boostCharge = 1;
  let sinceBoost = 99;
  let odometerKm = 0;
  let crashT = -1;
  let alertHold = 0;
  let levelHold = 0;
  let heldAlert: FlightAlert = '';
  let navId = '';
  let lastRegion = '';
  let regionHold = 0;
  let discoveryHold = 0;
  let lastEnemies = 0;
  let lastContact: 'none' | 'scan' | 'hostile' = 'none';
  let lockedFor = 0;
  let lowShieldWarned = false;
  let vibe = 0;
  let dockedTo: FlightBody | null = null;
  let dockHold = 0;
  const dockOffset = new THREE.Vector3();
  let orderId = '';
  let orderHits = ORDER_HITS;
  let orderDoneHold = 0;

  /** Whatever the player is flying right now — the ship, or the suit. */
  const actor = () => (pilot === 'ship' ? group : evaG);
  const parts = () => (pilot === 'ship' ? shipParts : evaParts);
  const hullRadius = () => (pilot === 'ship' ? HULL_RADIUS : EVA_HULL_RADIUS);

  const setAlert = (a: FlightAlert, hold: number) => {
    heldAlert = a;
    alertHold = hold;
  };

  const fire = (enemies: AlienHandle['enemies']) => {
    const b = bolts.find((x) => x.life < 0);
    if (!b) return;
    cannonIdx = (cannonIdx + 1) % cannonTips.length;
    group.updateMatrixWorld(true);
    cannonTips[cannonIdx].getWorldPosition(b.mesh.position);
    b.mesh.position.addScaledVector(fwd, 2 * H);
    // Guns are boresighted to converge well ahead of the nose…
    tmp.copy(group.position).addScaledVector(fwd, BORESIGHT);
    // …and bend a little toward a hostile sitting near the reticle, because
    // browser mouse-flight combat is otherwise a coin toss.
    let bestDot = Math.cos(AIM_ASSIST_CONE);
    for (const e of enemies) {
      tmp2.copy(e.group.position).sub(group.position);
      const d = tmp2.length();
      if (d < 1e-9 || d > BORESIGHT * 3) continue;
      const dot = tmp2.divideScalar(d).dot(fwd);
      if (dot > bestDot) {
        bestDot = dot;
        tmp.copy(e.group.position);
      }
    }
    b.dir.copy(tmp).sub(b.mesh.position).normalize();
    b.mesh.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), b.dir);
    b.velocity.copy(b.dir).multiplyScalar(BOLT_SPEED).add(vel);
    b.life = 0;
    b.mesh.visible = true;
    audio.laser();
    rig.kick(0.05);
  };

  const spawn = (anchor: FlightAnchor) => {
    pilot = 'ship';
    evaG.visible = false;
    group.position.copy(anchor.position);
    group.lookAt(anchor.lookAt);
    group.rotateY(anchor.yaw);
    vel.set(0, 0, 0);
    angVel.set(0, 0, 0);
    pendYaw = pendPitch = 0;
    input.mouseDX = 0;
    input.mouseDY = 0;
    input.modeRequest = null;
    input.foilsToggle = false;
    input.eject = false;
    hull = MAX_HULL;
    shield = MAX_SHIELD;
    sinceHit = 99;
    heat = 0;
    heatSoak = 0;
    energy = 1;
    boostCharge = 1;
    sinceBoost = 99;
    crashT = -1;
    dockedTo = null;
    dockHold = 0;
    mode = 'cruise';
    regime = regimes.cruise;
    eff.max = regime.max;
    eff.boost = regime.boost;
    eff.accel = regime.accel;
    eff.turn = regime.turn;
    jumpPhase = 'none';
    foilsForced = null;
    lowShieldWarned = false;
    group.visible = true;
    rig.snap();
    tel.hp = hull;
    tel.shield = shield;
    tel.crashed = false;
    tel.respawnIn = 0;
    tel.pilot = 'ship';
  };

  /** Come alongside: the berth holds the ship a few hull-lengths off the
   *  structure with the nose already pointing out, so W departs. */
  const dock = (b: FlightBody, outward: THREE.Vector3) => {
    dockedTo = b;
    dockHold = DOCK_HOLD;
    dockOffset.copy(outward).multiplyScalar(b.radius + HULL_RADIUS + DOCK_GAP);
    group.position.copy(b.position).add(dockOffset);
    group.lookAt(tmp.copy(group.position).add(outward));
    vel.set(0, 0, 0);
    angVel.set(0, 0, 0);
    pendYaw = pendPitch = 0;
    mode = 'cruise';
    regime = regimes.cruise;
    setAlert('docked', 4);
    rig.snap();
  };

  const undock = () => {
    if (!dockedTo) return;
    vel.copy(dockOffset).normalize().multiplyScalar(0.25 * regimes.cruise.max);
    dockedTo = null;
    setAlert('undocked', 2);
  };

  /** Standing order: one world in the system the ship is actually in. */
  const pickOrder = (w: FlightWorld, from: THREE.Vector3) => {
    const pool = w.bodies.filter((b) => b.kind === 'planet' && !b.destroyed
      && !ORDER_SPARED.has(b.id) && from.distanceTo(b.position) < SYSTEM_REACH);
    if (pool.length === 0) {
      // Nothing in reach worth naming — look again in a few seconds rather
      // than rebuilding the pool every frame.
      orderDoneHold = 5;
      return;
    }
    orderId = pool[Math.floor(Math.random() * pool.length)].id;
    orderHits = ORDER_HITS;
  };

  const destroyWorld = (b: FlightBody, from: THREE.Vector3) => {
    tmp2.copy(from).sub(b.position);
    if (tmp2.lengthSq() < 1e-12) tmp2.set(0, 1, 0);
    tmp2.normalize();
    crash.trigger(b.position, tmp2, null, vel, b.radius / (8 * H));
    b.destroyed = true;
    audio.boom();
    rig.kick(1.2);
    tel.jumpFlash = 0.9;
    orderId = '';
    orderDoneHold = ORDER_DONE_HOLD;
  };

  const destroyStation = (b: FlightBody, from: THREE.Vector3) => {
    tmp2.copy(from).sub(b.position).normalize();
    if (tmp2.lengthSq() < 0.5) tmp2.set(0, 1, 0);
    crash.trigger(b.position, tmp2, b, vel);
    b.destroyed = true;
    audio.boom();
  };

  const doCrash = (at: THREE.Vector3, normal: THREE.Vector3, body: FlightBody | null) => {
    crash.trigger(at, normal, body, vel);
    crashLook.copy(at);
    vel.set(0, 0, 0);
    angVel.set(0, 0, 0);
    hull = 0;
    shield = 0;
    crashT = 0;
    rig.kick(1.5);
    heat = 0;
    actor().visible = false;
    for (const b of bolts) {
      b.life = -1;
      b.mesh.visible = false;
    }
    audio.boom();
    tel.hp = 0;
    tel.shield = 0;
    tel.hitFlash = 1;
    tel.crashed = true;
    tel.jumpFlash = 0.8;
  };

  /** Shields take the hit first; whatever is left reaches the hull. */
  const damage = (amount: number, fromHeat: boolean) => {
    if (crashT >= 0 || jumpPhase !== 'none') return;
    sinceHit = 0;
    const hadShield = shield > 0;
    const toShield = Math.min(shield, amount);
    shield -= toShield;
    const rest = amount - toShield;
    if (rest > 0) hull = Math.max(0, hull - rest);
    tel.shield = shield;
    tel.hp = hull;
    if (!fromHeat) {
      tel.hitFlash = 1;
      rig.kick(rest > 0 ? 0.5 : 0.25);
    }
    if (hadShield && shield <= 0) {
      setAlert('shielddown', 2.2);
    } else if (shield > 0 && shield < MAX_SHIELD * 0.25 && !lowShieldWarned) {
      lowShieldWarned = true;
      setAlert('lowshield', 1.6);
    }
    if (shield > MAX_SHIELD * 0.25) lowShieldWarned = false;
    if (hull <= 0) {
      up.set(0, 1, 0).applyQuaternion(actor().quaternion);
      doCrash(tmp.copy(actor().position), up, null);
    } else if (hull < MAX_HULL * 0.25 && rest > 0) {
      setAlert('hullcritical', 2);
    }
  };

  const camFrame: CameraFrame = {
    view: 'chase',
    position: group.position,
    quaternion: group.quaternion,
    velocity: vel,
    angular: angVel,
    speedFrac: 0,
    accelRef: REGIMES.cruise.accel,
    boost: false,
    bank: 0,
    camBack: REGIMES.cruise.camBack,
    camUp: CAM_UP,
    lookAhead: 6 * U,
    fov: REGIMES.cruise.fov,
    cockpitEye: COCKPIT_EYE,
    orbitYaw: 0,
    orbitPitch: 0,
    heat: 0,
    crashLook,
  };

  const updateCamera = (dt: number, camera: THREE.PerspectiveCamera, fovTarget: number) => {
    const a = actor();
    camFrame.view = crashT >= 0 ? 'crash' : view === 'cockpit' && pilot === 'ship' ? 'cockpit' : 'chase';
    camFrame.position = a.position;
    camFrame.quaternion = a.quaternion;
    camFrame.speedFrac = eff.max > 0 ? vel.length() / eff.max : 0;
    camFrame.accelRef = eff.accel;
    camFrame.boost = tel.boost;
    camFrame.bank = bank;
    camFrame.camBack = camBack;
    camFrame.camUp = pilot === 'ship' ? CAM_UP : EVA_CAM_UP;
    camFrame.lookAhead = pilot === 'ship' ? 6 * U : 2 * E;
    camFrame.fov = fovTarget;
    camFrame.orbitYaw = input.orbiting ? input.orbitYaw : 0;
    camFrame.orbitPitch = input.orbiting ? input.orbitPitch : 0;
    camFrame.heat = heat;
    rig.update(dt, camFrame, camera);
  };

  const updateDust = (dt: number, speed: number) => {
    const jumping = jumpPhase === 'travel';
    let stretch: number;
    if (jumping) {
      flow.copy(jumpDir).multiplyScalar(JUMP_FLOW);
      stretch = 0.5;
    } else {
      flow.copy(vel);
      // Motes at cruise, streaks once the ship is really moving.
      stretch = 0.02 + 0.06 * THREE.MathUtils.clamp(speed / (10 * U), 0, 1);
    }
    const half = DUST_BOX / 2;
    const p = actor().position;
    for (let i = 0; i < DUST_N; i++) {
      const r = dustRel[i];
      r.addScaledVector(flow, -dt);
      if (r.x > half) r.x -= DUST_BOX; else if (r.x < -half) r.x += DUST_BOX;
      if (r.y > half) r.y -= DUST_BOX; else if (r.y < -half) r.y += DUST_BOX;
      if (r.z > half) r.z -= DUST_BOX; else if (r.z < -half) r.z += DUST_BOX;
      const o = i * 6;
      dustPos[o] = p.x + r.x;
      dustPos[o + 1] = p.y + r.y;
      dustPos[o + 2] = p.z + r.z;
      dustPos[o + 3] = p.x + r.x - flow.x * stretch;
      dustPos[o + 4] = p.y + r.y - flow.y * stretch;
      dustPos[o + 5] = p.z + r.z - flow.z * stretch;
    }
    dustGeom.getAttribute('position').needsUpdate = true;
    if (jumping) {
      dustMat.opacity = 0.95;
      dustMat.color.setRGB(0.9, 1.2, 2.0);
    } else {
      dustMat.opacity = THREE.MathUtils.clamp(speed / (3 * U), 0.06, 1) * 0.5;
      dustMat.color.setRGB(0.67, 0.77, 1.0);
    }
    dust.visible = crashT < 0 && dustMat.opacity > 0.01;
  };

  /** The hyperspace tunnel: streaks on a ring around the line of flight,
   *  sliding toward the ship, growing brighter and tighter as the jump runs. */
  const updateTunnel = () => {
    if (jumpPhase !== 'travel') {
      tunnel.visible = false;
      return;
    }
    tunnel.visible = true;
    const s = Math.min(1, jumpT / JUMP_TRAVEL);
    const tighten = 1 - 0.55 * Math.sin(s * Math.PI);
    up.set(0, 1, 0);
    if (Math.abs(up.dot(jumpDir)) > 0.9) up.set(1, 0, 0);
    right.crossVectors(jumpDir, up).normalize();
    up.crossVectors(right, jumpDir).normalize();
    const p = group.position;
    const len = 18 * U;
    for (let i = 0; i < TUNNEL_N; i++) {
      const a = tunnelSeed[i * 3];
      const r = tunnelSeed[i * 3 + 1] * 9 * U * tighten;
      // Each streak slides back along the tunnel and wraps.
      let z = (tunnelSeed[i * 3 + 2] + jumpT * 1.7) % 1;
      z = (z - 0.5) * 60 * U;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      const o = i * 6;
      tunnelPos[o] = p.x + right.x * cx + up.x * cy + jumpDir.x * z;
      tunnelPos[o + 1] = p.y + right.y * cx + up.y * cy + jumpDir.y * z;
      tunnelPos[o + 2] = p.z + right.z * cx + up.z * cy + jumpDir.z * z;
      tunnelPos[o + 3] = tunnelPos[o] + jumpDir.x * len;
      tunnelPos[o + 4] = tunnelPos[o + 1] + jumpDir.y * len;
      tunnelPos[o + 5] = tunnelPos[o + 2] + jumpDir.z * len;
    }
    tunnelGeom.getAttribute('position').needsUpdate = true;
    tunnelMat.opacity = 0.55 + 0.4 * Math.sin(s * Math.PI);
  };

  const holdTelemetry = (camera: THREE.PerspectiveCamera, dt: number) => {
    tel.speed = tel.speedKmS = tel.speedC = tel.speedFrac = 0;
    tel.throttle = 0;
    tel.alert = '';
    tel.heat = 0;
    tel.atmo = 0;
    tel.shake = rig.shake();
    tel.radarCount = 0;
    tel.canBoard = false;
    tel.nav.on = 0;
    tel.navId = '';
    updateCamera(dt, camera, REGIMES.cruise.fov);
    updateDust(dt, 0);
    for (const j of shipParts.rcs) j.mat.opacity = 0;
  };

  return {
    group,
    boltGroup,
    fxGroup,
    spawn,
    takeDamage(amount) {
      damage(amount, false);
    },
    update(dt, timeSec, camera, aliens, world) {
      if (session.paused) return;
      tel.hitFlash = Math.max(0, tel.hitFlash - dt * 2.5);
      tel.jumpFlash = Math.max(0, tel.jumpFlash - dt * 1.6);
      alertHold -= dt;
      crash.update(dt);
      if (jumpPhase !== 'none' || crashT >= 0) {
        input.mouseDX = input.mouseDY = 0;
        pendYaw = pendPitch = 0;
      }
      const enemies = aliens.enemies;
      tel.systemName = arrivedHold > 0 ? jumpName : jumpPhase === 'none' ? world.systemName : jumpOrigin;
      if (arrivedHold > 0) arrivedHold -= 1;
      tel.targetName = jumpPhase === 'none' ? world.jump.name : jumpName;
      tel.targetLy = world.jump.distanceLy;

      // ── Wreck: hold the camera on the impact, count down, respawn. ──
      if (crashT >= 0) {
        crashT += dt;
        if (crashT >= RESPAWN_DELAY) {
          spawn(world.home);
        } else {
          tel.respawnIn = RESPAWN_DELAY - crashT;
          holdTelemetry(camera, dt);
          return;
        }
      }

      energy = Math.min(1, energy + ENERGY_REGEN * dt);
      sinceBoost += dt;
      if (sinceBoost > BOOST_REGEN_DELAY) boostCharge = Math.min(1, boostCharge + BOOST_REGEN * dt);
      sinceHit += dt;
      if (shield < MAX_SHIELD && sinceHit > SHIELD_REGEN_DELAY) {
        shield = Math.min(MAX_SHIELD, shield + SHIELD_REGEN_PER_SEC * dt);
        tel.shield = shield;
      }
      if (hull < MAX_HULL && sinceHit > HULL_REGEN_DELAY) {
        hull = Math.min(MAX_HULL, hull + HULL_REGEN_PER_SEC * dt);
        tel.hp = hull;
      }

      // ── Leave the ship, or climb back in. ──
      if (input.eject) {
        input.eject = false;
        if (jumpPhase === 'none') {
          if (pilot === 'ship') {
            pilot = 'eva';
            up.set(0, 1, 0).applyQuaternion(group.quaternion);
            evaG.position.copy(group.position).addScaledVector(up, 2.5 * H);
            evaG.quaternion.copy(group.quaternion);
            evaG.visible = true;
            vel.set(0, 0, 0);
            angVel.set(0, 0, 0);
            mode = 'cruise';
            Object.assign(eff, EVA);
            camBack = Math.max(MIN_CAM_BACK, EVA.camBack * (input.camZoom || 1));
            rig.snap();
          } else if (evaG.position.distanceTo(group.position) < BOARD_RANGE) {
            pilot = 'ship';
            evaG.visible = false;
            vel.set(0, 0, 0);
            angVel.set(0, 0, 0);
            camBack = Math.max(MIN_CAM_BACK, regimes[mode === 'jump' ? 'cruise' : mode].camBack * (input.camZoom || 1));
            rig.snap();
          }
        }
      }
      if (input.viewToggle) {
        input.viewToggle = false;
        view = view === 'chase' ? 'cockpit' : 'chase';
        rig.snap();
      }
      if (input.assistToggle) {
        input.assistToggle = false;
        assist = !assist;
      }
      const me = actor();
      tel.pilot = pilot;
      tel.view = view;
      tel.assist = assist;
      regime = pilot === 'eva' ? EVA : mode === 'jump' ? regime : regimes[mode];
      // Effective drive numbers chase the selected regime.
      const bk = 1 - Math.exp(-dt * REGIME_BLEND);
      eff.max += (regime.max - eff.max) * bk;
      eff.boost += (regime.boost - eff.boost) * bk;
      eff.accel += (regime.accel - eff.accel) * bk;
      eff.turn += (regime.turn - eff.turn) * bk;

      // ── Mass lock: inside a few radii of anything massive the drive is
      // locked; the HUD carries the state and the request is refused. ──
      let locked = false;
      for (const b of world.bodies) {
        if (!b.destroyed && b.kind !== 'station' && me.position.distanceTo(b.position) < b.radius * (1 + MASS_LOCK_RADII)) {
          locked = true;
          break;
        }
      }
      const wasLocked = lockedFor > 0;
      lockedFor = locked ? lockedFor + dt : 0;
      tel.driveReady = !locked && pilot === 'ship' && jumpPhase === 'none';
      if (wasLocked && !locked && mode === 'fast' && pilot === 'ship') {
        setAlert('jumpready', 2.2);
      }

      const req = input.modeRequest;
      input.modeRequest = null;
      if (req && jumpPhase === 'none' && pilot === 'ship') {
        if (req === 'jump') {
          if (locked) {
            setAlert('masslock', 1.8);
          } else {
            mode = 'jump';
            jumpPhase = 'charge';
            jumpT = 0;
            foilsForced = null;
            jumpTarget.position.copy(world.jump.position);
            jumpTarget.lookAt.copy(world.jump.lookAt);
            jumpTarget.yaw = world.jump.yaw;
            jumpName = world.jump.name;
            jumpOrigin = world.systemName;
          }
        } else {
          mode = req;
          regime = regimes[req];
          foilsForced = null;
        }
      }
      if (input.foilsToggle) {
        input.foilsToggle = false;
        foilsForced = !(foilsForced ?? foilT > 0.5);
      }

      // ── Hyperdrive. ──
      let speed = vel.length();
      let rcsYaw = 0;
      let rcsPitch = 0;
      let rcsRoll = 0;
      let rcsBrake = 0;
      let wellK = 1;
      if (jumpPhase !== 'none') tel.boost = false;
      if (jumpPhase === 'charge') {
        jumpT += dt;
        jumpDir.copy(jumpTarget.position).sub(group.position).normalize();
        qA.copy(group.quaternion);
        group.lookAt(tmp.copy(group.position).add(jumpDir));
        qB.copy(group.quaternion);
        group.quaternion.copy(qA).slerp(qB, 1 - Math.exp(-dt * 4));
        vel.multiplyScalar(Math.exp(-dt * 3));
        group.position.addScaledVector(vel, dt);
        rig.kick(Math.min(0.35, jumpT / JUMP_CHARGE * 0.35));
        if (jumpT >= JUMP_CHARGE) {
          jumpPhase = 'travel';
          jumpT = 0;
          jumpStart.copy(group.position);
          group.lookAt(tmp.copy(group.position).add(jumpDir));
          vel.set(0, 0, 0);
          tel.jumpFlash = 1;
          rig.kick(0.8);
          audio.whoosh();
        }
      } else if (jumpPhase === 'travel') {
        jumpT += dt;
        const s = Math.min(1, jumpT / JUMP_TRAVEL);
        const e = s * s * (3 - 2 * s);
        group.position.lerpVectors(jumpStart, jumpTarget.position, e);
        rig.kick(0.25);
        if (s >= 1) {
          jumpPhase = 'none';
          mode = 'cruise';
          regime = regimes.cruise;
          group.position.copy(jumpTarget.position);
          group.lookAt(jumpTarget.lookAt);
          group.rotateY(jumpTarget.yaw);
          // Drop out with a little way on, nose on the star, so arrival is
          // a coast into the system rather than a dead stop.
          fwd.set(0, 0, 1).applyQuaternion(group.quaternion);
          vel.copy(fwd).multiplyScalar(0.3 * regimes.cruise.max);
          angVel.set(0, 0, 0);
          rig.snap();
          arrivedHold = 3;
          tel.systemName = jumpName;
          tel.jumpFlash = 1;
          setAlert('arrived', 3);
          audio.whoosh();
        }
      } else {
        // ── Attitude. With assist the keys command rates and the airframe
        // damps itself; without it they command angular acceleration and
        // the rates persist until countered. The mouse commands an angle
        // either way, shaped in flight-input. ──
        const turn = eff.turn;
        const yawIn = THREE.MathUtils.clamp(input.yaw + input.lookYaw, -1, 1);
        angTarget.set(-input.pitch * PITCH_RATE * turn, -yawIn * YAW_RATE * turn, input.roll * ROLL_RATE);
        if (assist || pilot === 'eva') {
          angVel.lerp(angTarget, 1 - Math.exp(-dt * 4.2));
        } else {
          angVel.addScaledVector(angTarget, FREE_ANG_ACCEL * dt);
          angVel.multiplyScalar(Math.exp(-dt * 0.12));
          const am = angVel.length();
          if (am > FREE_ANG_MAX) angVel.multiplyScalar(FREE_ANG_MAX / am);
        }
        pendYaw += shapeMouse(-input.mouseDX, turn);
        pendPitch += shapeMouse(input.mouseDY, turn);
        input.mouseDX = 0;
        input.mouseDY = 0;
        const mk = 1 - Math.exp(-dt * 9);
        let dYaw = pendYaw * mk;
        let dPitch = pendPitch * mk;
        pendYaw -= dYaw;
        pendPitch -= dPitch;
        // Align: a limited cruise assist that swings the nose onto the
        // target while held. The player still flies; this only points.
        if (input.align && navId && pilot === 'ship') {
          qA.copy(me.quaternion);
          me.lookAt(navPos);
          qB.copy(me.quaternion);
          me.quaternion.copy(qA).slerp(qB, 1 - Math.exp(-dt * 2.5));
          angVel.multiplyScalar(Math.exp(-dt * 6));
          dYaw = dPitch = 0;
          pendYaw = pendPitch = 0;
        }
        me.rotateY(angVel.y * dt + dYaw);
        me.rotateX(angVel.x * dt + dPitch);
        me.rotateZ(angVel.z * dt);
        // Wings level. With assist on, the moment the pilot stops rolling the
        // airframe rights itself against the ecliptic, so "up" stays up and a
        // turn never quietly becomes a barrel roll. The correction fades out
        // as the nose points at the poles, where level has no meaning.
        levelHold = input.roll !== 0 || input.align ? LEVEL_DELAY : Math.max(0, levelHold - dt);
        if (assist && pilot === 'ship' && levelHold <= 0) {
          right.set(1, 0, 0).applyQuaternion(me.quaternion);
          const upright = 1 - Math.abs(fwd.y);
          me.rotateZ(-THREE.MathUtils.clamp(right.y * 2, -1, 1) * LEVEL_RATE * upright * upright * dt);
        }
        rcsYaw = THREE.MathUtils.clamp(yawIn - dYaw * 25, -1, 1);
        rcsPitch = THREE.MathUtils.clamp(input.pitch - dPitch * 25, -1, 1);
        rcsRoll = input.roll;
        // The airframe banks into the turn; the physics frame does not.
        // Forward is +Z with the port wing on +X, so a turn to starboard is a
        // negative yaw rate and dropping the starboard wing is a positive roll.
        const bankTarget = yawIn * 0.32 - dYaw * 5 - angVel.y * 0.1;
        bank += (THREE.MathUtils.clamp(bankTarget, -0.55, 0.55) - bank) * (1 - Math.exp(-dt * 3.4));
        parts().hull.rotation.z = pilot === 'ship' ? bank : bank * 0.3;
        parts().hull.rotation.x = -angVel.x * 0.05;

        // ── Thrust, drag, gravity. ──
        const boost = input.boost && input.thrust > 0 && boostCharge > BOOST_FLOOR;
        if (boost) {
          boostCharge = Math.max(0, boostCharge - BOOST_DRAIN * dt);
          sinceBoost = 0;
        }
        fwd.set(0, 0, 1).applyQuaternion(me.quaternion);
        const drag = assist || pilot === 'eva' ? DRAG_PER_FRAME : FREE_DRAG_PER_FRAME;
        const decay = -60 * Math.log(drag);
        const damping = Math.exp(-decay * dt);
        vel.multiplyScalar(damping);
        vel.addScaledVector(fwd, input.thrust * eff.accel * (boost ? 2 : 1) * (1 - damping) / decay);
        rcsBrake = input.thrust < 0 ? -input.thrust : 0;
        for (const b of world.bodies) {
          if (b.destroyed || b.kind === 'station') continue;
          tmp.copy(b.position).sub(me.position);
          const d = tmp.length();
          if (d < 1e-9) continue;
          // The well throttles the fast drive: a tenth of c is for the
          // space between worlds, not for the space around one.
          const wk = THREE.MathUtils.clamp((d / b.radius - 1) / WELL_RADII, 0.1, 1);
          if (wk < wellK) wellK = wk;
          const reach = b.radius * GRAVITY_REACH;
          if (d >= reach) continue;
          const g = (Math.min(MAX_SURFACE_G, b.surfaceG) / 9.81) * ONE_G;
          const ratio = b.radius / Math.max(d, b.radius);
          const edge = THREE.MathUtils.clamp((reach - d) / (b.radius * 3), 0, 1);
          vel.addScaledVector(tmp.divideScalar(d), g * ratio * ratio * edge * dt);
        }
        // Air bites: heat bleeds speed and scorches the hull.
        vel.multiplyScalar(Math.exp(-dt * 2.5 * heat));
        let max = boost ? eff.boost : eff.max;
        if (mode === 'fast' && pilot === 'ship') max = Math.max(regimes.cruise.max, max * wellK);
        speed = vel.length();
        if (speed > max) {
          vel.multiplyScalar(max / speed);
          speed = max;
        }
        prevPos.copy(me.position);
        me.position.addScaledVector(vel, dt);
        tel.boost = boost;

        // ── Berthed: the station carries the ship, its crews put the hull
        // and the banks back together, and any thrust casts off. ──
        if (dockedTo) {
          if (dockedTo.destroyed || pilot !== 'ship') {
            dockedTo = null;
          } else if (dockHold <= 0 && input.thrust > 0) {
            undock();
          } else {
            dockHold -= dt;
            me.position.copy(dockedTo.position).add(dockOffset);
            prevPos.copy(me.position);
            vel.set(0, 0, 0);
            speed = 0;
            shield = Math.min(MAX_SHIELD, shield + DOCK_REPAIR * dt);
            hull = Math.min(MAX_HULL, hull + DOCK_REPAIR * dt);
            energy = 1;
            boostCharge = 1;
            tel.shield = shield;
            tel.hp = hull;
            if (alertHold <= 0) setAlert('docked', 1);
          }
        }

        // ── Solid bodies: swept sphere test, so a tenth of c cannot tunnel
        // through a planet between two frames. ──
        seg.copy(me.position).sub(prevPos);
        const segLen2 = seg.lengthSq();
        const hr = hullRadius();
        for (const b of world.bodies) {
          if (b.destroyed) continue;
          tmp.copy(b.position).sub(prevPos);
          const t = segLen2 > 0 ? THREE.MathUtils.clamp(tmp.dot(seg) / segLen2, 0, 1) : 0;
          tmp2.copy(prevPos).addScaledVector(seg, t).sub(b.position);
          const d = tmp2.length();
          if (d < b.radius + hr) {
            tmp2.divideScalar(Math.max(d, 1e-9));
            tmp.copy(b.position).addScaledVector(tmp2, b.radius);
            if (b.kind === 'station' && speed <= DOCK_SPEED && pilot === 'ship') {
              dock(b, tmp2);
              break;
            }
            if (b.kind === 'station') destroyStation(b, prevPos);
            doCrash(tmp, tmp2, b);
            break;
          }
        }
        if (crashT >= 0) {
          tel.respawnIn = RESPAWN_DELAY;
          holdTelemetry(camera, dt);
          return;
        }

        fireAcc -= dt;
        if (input.fire && fireAcc <= 0 && pilot === 'ship' && cannonTips.length > 0 && energy >= ENERGY_PER_SHOT) {
          fireAcc = FIRE_INTERVAL;
          energy -= ENERGY_PER_SHOT;
          fire(enemies);
        }
        odometerKm += vel.length() * dt * KM_PER_SCENE_UNIT;
      }

      speed = vel.length();

      // ── Nearest body: altitude readout, proximity warning, re-entry. ──
      let near: FlightBody | null = null;
      let nearD = Infinity;
      let nearScore = Infinity;
      let sunBody: FlightBody | null = null;
      let sunD = Infinity;
      for (const b of world.bodies) {
        if (b.destroyed || b.kind === 'station') continue;
        const d = me.position.distanceTo(b.position);
        // Altitude in the body's own radii, so a small moon only takes the
        // readout when the ship is genuinely close to it.
        const score = (d - b.radius) / b.radius;
        if (score < nearScore) {
          nearScore = score;
          nearD = d - b.radius;
          near = b;
        }
        if (b.kind === 'star' && d < sunD) {
          sunD = d;
          sunBody = b;
        }
      }
      let heatTarget = 0;
      let atmo = 0;
      let alert: FlightAlert = '';
      let region = '';
      if (near && nearD < near.radius * NEAR_REACH && jumpPhase !== 'travel') {
        tel.nearId = near.id;
        tel.nearAltKm = Math.max(0, (nearD / near.radius) * near.radiusKm);
        region = near.id;
        if (jumpPhase === 'none') {
          const atmoTop = near.radius * (near.atmosphere - 1);
          if (atmoTop > 0 && nearD < atmoTop) {
            atmo = 1 - nearD / atmoTop;
            heatTarget = atmo * THREE.MathUtils.clamp(speed / (0.5 * U), 0, 1.4);
            heatTarget = Math.min(1, heatTarget);
            alert = near.kind === 'star' ? 'solar' : 'entry';
          } else if (nearD < near.radius * 1.5) {
            tmp.copy(near.position).sub(me.position).normalize();
            if (vel.dot(tmp) > 0.3 * U) alert = 'proximity';
          } else if (near.kind === 'star' && nearD < near.radius * 2.5) {
            alert = 'solar';
          }
        }
      } else {
        tel.nearId = '';
        tel.nearAltKm = 0;
      }
      if (region !== lastRegion) {
        lastRegion = region;
        regionHold = region ? 3.5 : 0;
      }
      regionHold -= dt;
      tel.region = regionHold > 0 ? region : '';
      heat += (heatTarget - heat) * (1 - Math.exp(-dt * 4));
      if (heat > 0.05) {
        damage(18 * heat * dt, true);
        if (crashT >= 0) {
          tel.respawnIn = RESPAWN_DELAY;
          holdTelemetry(camera, dt);
          return;
        }
      }
      if (!alert && mode === 'fast' && wellK < 0.6 && jumpPhase === 'none' && pilot === 'ship') alert = 'gravity';
      const live = parts();
      live.plasmaMat.opacity = Math.min(1, heat * 1.3);
      const plasmaBase = pilot === 'ship' ? H : E;
      live.plasma.scale.set((4 + 6 * heat) * plasmaBase, (3 + 2 * heat) * plasmaBase, 1);
      live.skinMat.emissive.setRGB(1.0, 0.35, 0.08).multiplyScalar(heat * 0.9);
      if (jumpPhase === 'charge') alert = 'charging';
      else if (jumpPhase === 'travel') alert = 'jump';
      else if (alertHold > 0) alert = heldAlert;

      // ── Wings: spread for a fight (firing, or contacts on the radar),
      // swept flat for speed. F overrides until the next regime change. ──
      const foilsAuto = jumpPhase === 'none' && mode !== 'fast' && (input.fire || aliens.contactState === 'hostile');
      const foilsOpen = pilot === 'ship' && jumpPhase === 'none' && (foilsForced ?? foilsAuto);
      foilT += ((foilsOpen ? 1 : 0) - foilT) * (1 - Math.exp(-dt * 3.2));
      for (const w of shipParts.wings) {
        const a = THREE.MathUtils.lerp(w.closed, w.open, foilT);
        if (w.axis === 'z') w.pivot.rotation.z = a;
        else w.pivot.rotation.y = a;
      }

      // ── Engine visuals: the core answers the throttle with a ramp, the
      // plume stretches with thrust and boost, the bells soak heat under
      // sustained burn, RCS jets flash with the controls, and the hull
      // shivers under full power. ──
      const thrusting = jumpPhase === 'none' && input.thrust > 0;
      const chargeK = jumpPhase === 'charge' ? jumpT / JUMP_CHARGE : jumpPhase === 'travel' ? 1 : 0;
      const throttle = jumpPhase === 'none' ? Math.max(0, input.thrust) : 1;
      heatSoak += ((thrusting ? (tel.boost ? 1 : 0.55) : 0) - heatSoak) * (1 - Math.exp(-dt * (thrusting ? 0.5 : 0.9)));
      const pulse = 0.8 + 0.08 * Math.sin(timeSec * 7)
        + (thrusting ? 0.55 : 0) + (tel.boost ? 1.0 : 0)
        + (mode === 'fast' ? 0.5 : 0) + chargeK * 1.6;
      live.engineMat.emissiveIntensity = 1.5 * pulse;
      live.bellMat.emissive.setRGB(0.9, 0.22, 0.05).multiplyScalar(heatSoak * 0.6);
      const glowBase = pilot === 'ship' ? H : 0.45 * E;
      for (let i = 0; i < live.glowMats.length; i++) {
        live.glowMats[i].opacity = Math.min(1, 0.5 * pulse);
        const gs = (1.0 + 0.4 * (pulse - 0.8)) * glowBase;
        live.glowSprites[i].scale.set(gs, gs, 1);
      }
      if (live.plumeMat) {
        live.plumeMat.opacity = Math.min(0.85, 0.14 + 0.34 * (pulse - 0.8));
        const stretch = 0.35 + 0.85 * Math.min(1.6, pulse - 0.75);
        const flicker = 1 + 0.06 * Math.sin(timeSec * 43) * (thrusting ? 1 : 0.3);
        for (const pl of live.plumes) pl.scale.set(1, Math.max(0.12, stretch * flicker), 1);
      }
      for (const j of shipParts.rcs) {
        const k = Math.max(0, j.yaw * rcsYaw + j.pitch * rcsPitch + j.roll * rcsRoll + j.brake * rcsBrake);
        const target = Math.min(1, k) * (pilot === 'ship' && jumpPhase === 'none' ? 0.9 : 0);
        j.mat.opacity += (target - j.mat.opacity) * (1 - Math.exp(-dt * (target > j.mat.opacity ? 30 : 12)));
      }
      vibe = tel.boost ? 1 : thrusting ? 0.35 : 0;
      const shiver = vibe * 0.05 * H;
      shipParts.hull.position.set(
        Math.sin(timeSec * 71) * shiver,
        Math.sin(timeSec * 53 + 1) * shiver,
        0,
      );
      const beat = timeSec % 1.4;
      const flashing = beat < 0.07 || (beat > 0.18 && beat < 0.25);
      shipParts.strobeMat.color.setScalar(flashing ? 2.4 : 0.05);
      evaParts.strobeMat.color.setScalar(flashing ? 2.4 : 0.05);
      const beacon = 1.45 + 0.25 * (0.5 + 0.5 * Math.sin(timeSec * 2.4));
      for (const m of shipParts.navMats) m.color.setHex(m.userData.base as number).multiplyScalar(beacon);
      group.visible = crashT < 0 && !(view === 'cockpit' && pilot === 'ship');
      const speedFrac = eff.max > 0 ? speed / eff.max : 0;

      // ── Radio. ──
      commsCool -= dt;
      let hailing: FlightBody | null = null;
      for (const b of world.bodies) {
        if (b.hails && !b.destroyed && me.position.distanceTo(b.position) < b.radius * HAIL_RADII) {
          hailing = b;
          break;
        }
      }
      // A friendly world does more than talk: it tops the ship up while it
      // stays inside the hail.
      const supplying = !!hailing && pilot === 'ship' && crashT < 0 && !dockedTo && jumpPhase === 'none';
      if (supplying) {
        shield = Math.min(MAX_SHIELD, shield + SUPPLY_RATE * dt);
        hull = Math.min(MAX_HULL, hull + SUPPLY_RATE * dt);
        energy = Math.min(1, energy + 0.4 * dt);
        boostCharge = Math.min(1, boostCharge + 0.25 * dt);
        tel.shield = shield;
        tel.hp = hull;
      }
      tel.supply = supplying;
      if (commsLine < 0) {
        if (hailing && commsCool <= 0 && pilot === 'ship' && crashT < 0) {
          commsLine = 0;
          commsT = 0;
          commsFrom = hailing.id;
        }
      } else {
        commsT += dt;
        const gone = !hailing || hailing.id !== commsFrom;
        if (commsLine === 0 && commsT > 0.7) {
          commsLine = 1;
          commsT = 0;
        } else if (commsLine >= 1 && commsLine <= COMMS_LINES && commsT > COMMS_LINE_SEC + COMMS_GAP_SEC) {
          commsLine += 1;
          commsT = 0;
        } else if (commsLine > COMMS_LINES && commsT > 1.2) {
          commsLine = -1;
          commsCool = COMMS_COOLDOWN;
        }
        if (gone && commsLine >= 0) {
          commsLine = -1;
          commsCool = 20;
        }
      }
      tel.commsFrom = commsLine >= 0 ? commsFrom : '';
      tel.commsLine = commsLine >= 1 && commsLine <= COMMS_LINES ? commsLine : 0;
      tel.commsProgress = tel.commsLine ? Math.min(1, commsT / COMMS_LINE_SEC) : 0;

      // ── Bolts. ──
      for (const b of bolts) {
        if (b.life < 0) continue;
        b.life += dt;
        if (b.life > BOLT_LIFE) {
          b.life = -1;
          b.mesh.visible = false;
          continue;
        }
        prevPos.copy(b.mesh.position);
        b.mesh.position.addScaledVector(b.velocity, dt);
        seg.copy(b.mesh.position).sub(prevPos);
        const boltLen2 = seg.lengthSq();
        let spent = false;
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          const r = e.radius + 0.3 * U;
          tmp.copy(e.group.position).sub(prevPos);
          const along = boltLen2 > 0 ? THREE.MathUtils.clamp(tmp.dot(seg) / boltLen2, 0, 1) : 0;
          tmp2.copy(prevPos).addScaledVector(seg, along);
          if (tmp2.distanceToSquared(e.group.position) < r * r) {
            aliens.spawnSparks(b.mesh.position, 0.034);
            if (aliens.damage(e, 15)) tel.kills += 1;
            spent = true;
            break;
          }
        }
        if (!spent) {
          seg.copy(b.mesh.position).sub(prevPos);
          const segLen2 = seg.lengthSq();
          for (const body of world.bodies) {
            if (body.destroyed) continue;
            const r = body.radius + (body.kind === 'station' ? 3 * H : 0);
            tmp.copy(body.position).sub(prevPos);
            const t = segLen2 > 0 ? THREE.MathUtils.clamp(tmp.dot(seg) / segLen2, 0, 1) : 0;
            tmp2.copy(prevPos).addScaledVector(seg, t);
            if (tmp2.distanceToSquared(body.position) < r * r) {
              aliens.spawnSparks(b.mesh.position, 0.02);
              if (body.kind === 'station') {
                body.hp = (body.hp ?? STATION_HP) - 1;
                if (body.hp <= 0) destroyStation(body, b.mesh.position);
              } else if (body.id === orderId) {
                orderHits -= 1;
                if (orderHits <= 0) destroyWorld(body, b.mesh.position);
              }
              spent = true;
              break;
            }
          }
        }
        if (spent) {
          b.life = -1;
          b.mesh.visible = false;
        }
      }

      // ── Alien contact state: a scan is a curiosity, a wave is a warning. ──
      const contactState = aliens.contactState ?? 'none';
      const contactPos = aliens.contactPos ?? null;
      if (contactState === 'hostile' && enemies.length > 0 && lastEnemies === 0) {
        setAlert('hostile', 2.5);
      }
      lastEnemies = enemies.length;
      if (contactState === 'scan' && lastContact !== 'scan') {
        setAlert('contact', 3);
      }
      lastContact = contactState;
      tel.contact = contactState;

      // ── Navigation target. ──
      candidates.length = 0;
      for (const b of world.bodies) {
        if (b.destroyed) continue;
        let c = bodyCandidates.get(b.id);
        if (!c) {
          c = { id: b.id, kind: b.kind, position: b.position };
          bodyCandidates.set(b.id, c);
        }
        c.position = b.position;
        candidates.push(c);
      }
      for (const p of world.pois) candidates.push(p);
      if (contactPos) {
        contactCandidate.position.copy(contactPos);
        candidates.push(contactCandidate);
      }
      jumpCandidate.position.copy(world.jump.position);
      candidates.push(jumpCandidate);
      tel.navList = candidates;
      if (input.targetClear) {
        input.targetClear = false;
        navId = '';
      }
      if (input.targetRequest) {
        navId = input.targetRequest;
        input.targetRequest = null;
      }
      if (input.targetStep) {
        navId = stepTarget(candidates, navId, me.position, input.targetStep);
        input.targetStep = 0;
      }
      const navC = navId ? candidates.find((c) => c.id === navId) : undefined;
      if (navC) {
        navPos.copy(navC.position);
        tel.navId = navC.id;
        tel.navKind = navC.kind;
        tel.navKm = navPos.distanceTo(me.position) * KM_PER_SCENE_UNIT;
      } else {
        navId = '';
        tel.navId = '';
        tel.navKind = '';
        tel.navKm = 0;
        tel.nav.on = 0;
      }

      // ── Follow camera; the regime sets how far back it rides. ──
      fwd.set(0, 0, 1).applyQuaternion(me.quaternion);
      const camZoom = THREE.MathUtils.clamp(input.camZoom || 1, CAM_ZOOM_MIN, CAM_ZOOM_MAX);
      const camBackTarget = Math.max(
        MIN_CAM_BACK,
        (jumpPhase !== 'none' ? JUMP_CAM_BACK : regime.camBack) * camZoom,
      );
      camBack += (camBackTarget - camBack) * (1 - Math.exp(-dt * 2.5));
      const fovTarget = jumpPhase !== 'none' ? JUMP_FOV : view === 'cockpit' && pilot === 'ship' ? COCKPIT_FOV : regime.fov;
      updateCamera(dt, camera, fovTarget);
      if (navC) projectTarget(navPos, camera, tel.nav);
      // The velocity vector: a point down the line of flight, on the glass.
      if (speed > 0.05 * U && jumpPhase === 'none') {
        tmp.copy(vel).divideScalar(speed);
        tmp2.copy(me.position).addScaledVector(tmp, 6 * U);
        projectTarget(tmp2, camera, tel.vv);
      } else {
        tel.vv.on = 0;
      }
      tel.bank = bank;
      tel.pitchRate = angVel.x;

      // The Sun in the lens: how much of the view it fills, and whether the
      // nose is on it. The canvas pulls the exposure down against it.
      let glare = 0;
      if (sunBody && sunD > 1e-9) {
        tmp.copy(sunBody.position).sub(camera.position);
        const d = tmp.length();
        camera.getWorldDirection(tmp2);
        const facing = THREE.MathUtils.smoothstep(tmp.divideScalar(d).dot(tmp2), 0.55, 0.96);
        const apparent = THREE.MathUtils.clamp(sunBody.radius / d / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), 0, 1);
        glare = THREE.MathUtils.clamp(facing * (0.25 + apparent * 2.2) + apparent * 0.6, 0, 1);
      }
      tel.sunGlare += (glare - tel.sunGlare) * (1 - Math.exp(-dt * 3));

      if (jumpPhase === 'travel') {
        jumpGlow.visible = true;
        jumpGlow.position.copy(group.position).addScaledVector(jumpDir, 30 * U);
        const s = Math.min(1, jumpT / JUMP_TRAVEL);
        jumpGlow.scale.setScalar((6 + 26 * s) * U);
        jumpGlowMat.opacity = 0.9;
      } else {
        jumpGlow.visible = false;
      }
      updateDust(dt, speed);
      updateTunnel();

      // ── Standing order: one world in this system to take apart. ──
      orderDoneHold -= dt;
      if (orderId) {
        const target = world.bodies.find((b) => b.id === orderId);
        if (!target || target.destroyed || me.position.distanceTo(target.position) > SYSTEM_REACH) orderId = '';
      }
      if (!orderId && orderDoneHold <= 0 && jumpPhase === 'none' && crashT < 0) pickOrder(world, me.position);
      tel.orderId = orderId;
      tel.orderIntegrity = orderId ? Math.max(0, orderHits / ORDER_HITS) : 0;
      tel.orderDone = orderDoneHold > 0;

      // ── Expedition log. ──
      missionCtx.nearId = tel.nearId;
      missionCtx.altRadii = near ? nearD / near.radius : 99;
      missionCtx.sunDist = me.position.length();
      missionCtx.speedFrac = speedFrac;
      missionCtx.mode = mode;
      missionCtx.systemName = tel.systemName;
      missionCtx.kills = tel.kills;
      missionCtx.scanned = !!aliens.scanned;
      missionCtx.targetId = navId;
      let probeDist = Infinity;
      for (const p of world.pois) {
        const d = p.position.distanceTo(me.position);
        if (d < probeDist) probeDist = d;
      }
      missionCtx.probeDist = probeDist;
      if (crashT < 0) {
        const unlocked = missions.tick(missionCtx, dt);
        if (unlocked) {
          tel.discovery = unlocked;
          tel.discoveryCount = missions.count();
          discoveryHold = DISCOVERY_HOLD;
        }
      }
      discoveryHold -= dt;
      if (discoveryHold <= 0) tel.discovery = '';

      // ── Telemetry for the HUD (no allocations). ──
      const kmS = jumpPhase === 'travel' ? LIGHT_KM_S : (speed * KM_PER_SCENE_UNIT);
      tel.speed = speed / U;
      tel.speedKmS = kmS;
      tel.speedC = kmS / LIGHT_KM_S;
      tel.speedFrac = jumpPhase === 'travel' ? 1 : Math.min(1.2, speedFrac);
      tel.throttle = input.thrust;
      tel.maxKmS = (jumpPhase !== 'none' ? LIGHT_KM_S / KM_PER_SCENE_UNIT : eff.boost) * KM_PER_SCENE_UNIT;
      tel.mode = mode;
      tel.foilsOpen = foilT > 0.5;
      tel.heat = heat;
      tel.atmo = atmo;
      tel.odometerKm = odometerKm;
      tel.energy = energy;
      tel.boostCharge = boostCharge;
      tel.alert = alert;
      tel.jumpPhase = jumpPhase;
      tel.jumpT = jumpPhase === 'charge' ? jumpT / JUMP_CHARGE : jumpPhase === 'travel' ? Math.min(1, jumpT / JUMP_TRAVEL) : 0;
      tel.shake = rig.shake();
      tel.respawnIn = 0;
      tel.canBoard = pilot === 'eva' && evaG.position.distanceTo(group.position) < BOARD_RANGE;
      tel.docked = !!dockedTo;
      tel.dockedTo = dockedTo ? dockedTo.id : '';
      invQ.copy(me.quaternion).invert();
      let n = 0;
      const blip = (p: THREE.Vector3) => {
        tmp.copy(p).sub(me.position).applyQuaternion(invQ);
        let x = -tmp.x / RADAR_RANGE;
        let y = tmp.z / RADAR_RANGE;
        const len = Math.hypot(x, y);
        if (len > 1) {
          x /= len;
          y /= len;
        }
        tel.radar[n * 2] = x;
        tel.radar[n * 2 + 1] = y;
        n += 1;
      };
      for (let i = 0; i < enemies.length && n < RADAR_MAX; i++) blip(enemies[i].group.position);
      if (enemies.length === 0 && contactPos && n < RADAR_MAX) blip(contactPos);
      tel.radarCount = n;
      if (navC) {
        tmp.copy(navPos).sub(me.position).applyQuaternion(invQ);
        const len = Math.hypot(tmp.x, tmp.z) || 1;
        tel.navRadarX = -tmp.x / len;
        tel.navRadarY = tmp.z / len;
      }
    },
    dispose() {
      audio.dispose();
      crash.dispose();
      boltGeom.dispose();
      boltMat.dispose();
      dustGeom.dispose();
      dustMat.dispose();
      tunnelGeom.dispose();
      tunnelMat.dispose();
      jumpGlowMat.dispose();
      const geoms = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      for (const root of [group, evaG]) {
        root.traverse((o) => {
          if (o instanceof THREE.Mesh) geoms.add(o.geometry);
          else if (o instanceof THREE.Sprite) mats.add(o.material as THREE.SpriteMaterial);
        });
      }
      for (const g of geoms) g.dispose();
      for (const m of shipParts.owned) mats.add(m);
      for (const m of evaParts.owned) mats.add(m);
      for (const m of mats) m.dispose();
    },
  };
}
