// Player fighter for Explore Mode — a small X-foil starfighter flying the
// real solar system, with three speed regimes, gravity wells, solid planets
// you can crash into, and a hyperdrive that jumps to the next star.
//
// Everything here is scene-scale. The ephemeris scene is tiny (Earth radius
// ≈ 0.028, alien saucer ≈ 0.012), so flight numbers live in "flight units"
// of FLIGHT_UNIT scene units and the hull in H, a fraction of that: the ship
// is about a third of an Earth radius long, so every planet towers over it.

import * as THREE from 'three';
import type { AlienHandle } from '@/lib/solar-system/aliens';
import { softSpriteTexture } from '@/lib/solar-system/soft-sprite';
import { makeRadio } from '@/lib/solar-system/radio';

export const FLIGHT_UNIT = 0.006;
const U = FLIGHT_UNIT;
/** Hull unit — the fighter is ~6.6 H long. */
const H = 0.22 * U;
/** Scene units → km, anchored on Earth's rendered radius (0.028 = 6,371 km). */
export const KM_PER_SCENE_UNIT = 6371 / 0.028;
const LIGHT_KM_S = 299_792.458;

export type SpeedMode = 'cruise' | 'fast' | 'jump';
export type ShipKind = 'xfoil' | 'interceptor';
export type Pilot = 'ship' | 'eva';
export type ViewMode = 'chase' | 'cockpit';
export type JumpPhase = 'none' | 'charge' | 'travel';
export type FlightAlert =
  | ''
  | 'proximity'
  | 'entry'
  | 'masslock'
  | 'charging'
  | 'jump'
  | 'arrived';

interface Regime {
  max: number;
  boost: number;
  accel: number;
  /** Turn-rate multiplier — a ship at a tenth of c cannot pivot like a dogfighter. */
  turn: number;
  camBack: number;
  fov: number;
}
const REGIMES: Record<Exclude<SpeedMode, 'jump'>, Regime> = {
  cruise: { max: 2.5 * U, boost: 5 * U, accel: 14 * U, turn: 1, camBack: 24 * H, fov: 46 },
  // Drag settles thrust at accel / (60 · 0.08); the fast regime needs the
  // extra push to actually reach its ceiling.
  fast: { max: 22 * U, boost: 34 * U, accel: 120 * U, turn: 0.55, camBack: 34 * H, fov: 60 },
};
/** EVA: the suit's SAFER jets — slow, precise, no weapons. */
// Suit scale. The world camera's near plane sits at 0.02 scene units —
// about 15 hull units — so an EVA camera can never ride closer than that.
// The suit is sized against that floor instead of against the airframe:
// small enough to read as a person beside the fighter, large enough to be
// a person on screen rather than two pixels.
const E = 1.5 * H;
const EVA: Regime = { max: 0.5 * U, boost: 0.9 * U, accel: 3 * U, turn: 1, camBack: 14 * E, fov: 50 };
const EVA_CAM_UP = 2.2 * E;
const EVA_HULL_RADIUS = 0.6 * E;
/** How close the suit must be to climb back aboard. */
const BOARD_RANGE = 14 * H;
const STATION_HP = 6;
/** Pilot's eye inside the hull, and the lens it looks through. */
const COCKPIT_EYE = new THREE.Vector3(0, 0.55 * H, 0.9 * H);
const COCKPIT_FOV = 70;
/** A hailing world opens its channel this close, in radii. */
const HAIL_RADII = 8;
const COMMS_LINES = 4;
const COMMS_LINE_SEC = 3.4;
const COMMS_GAP_SEC = 1.1;
const COMMS_COOLDOWN = 240;
/** Where the cannons' fire crosses the centreline. */
const BORESIGHT = 120 * H;
const JUMP_CAM_BACK = 44 * H;
const JUMP_FOV = 74;
const CAM_UP = 8 * H;
/** Chase-camera distance multiplier: how close and how far the player can pull. */
const CAM_ZOOM_MIN = 0.45;
const CAM_ZOOM_MAX = 3.2;
const CAM_ZOOM_STEP = 1.16;
/** The chase camera stops here: the world's near plane is 0.02 scene units,
 *  and anything closer would clip the ship — or the suit — out of frame. */
const MIN_CAM_BACK = 17 * H;
const CAM_LERP = 0.08; // per 60 fps frame
const DRAG_PER_FRAME = 0.92; // at 60 fps; applied as pow(0.92, dt·60)
const YAW_RATE = 1.5;
const PITCH_RATE = 1.3;
const ROLL_RATE = 2.2;
const MOUSE_SENS = 0.0022; // rad per px

const BOLT_SPEED = 24 * U;
const BOLT_LIFE = 0.8;
const BOLT_POOL = 16;
const FIRE_INTERVAL = 0.13;

/** Cannon energy: each bolt spends some, the bank refills between bursts. */
const ENERGY_PER_SHOT = 0.045;
const ENERGY_REGEN = 0.17;
/** Boost reservoir: burns while the throttle is firewalled, refills after.
 *  Eight seconds of continuous boost, about eleven to fill again — long
 *  enough to run something down, short enough to be a decision. */
const BOOST_DRAIN = 0.12;
const BOOST_REGEN = 0.09;
const BOOST_REGEN_DELAY = 1.2;
/** Below this the reservoir is spent and the boost cuts out. */
const BOOST_FLOOR = 0.02;

const MAX_HP = 100;
/** Enemy fire and re-entry heat floor here — only a planet kills you. */
const MIN_HP = 15;
const HP_REGEN_PER_SEC = 4.5;
const HP_REGEN_DELAY = 4;
const RADAR_RANGE = 60 * U;
export const RADAR_MAX = 16;
/** Bodies the canvas may label with an on-screen bracket at once. */
export const MARKER_MAX = 4;

/** Collision sphere around the hull centre. */
const HULL_RADIUS = 1.3 * H;
/** Flight acceleration at 1 g on a body's surface. */
const ONE_G = 3 * U;
/** Gravity is felt out to this many radii. */
const GRAVITY_REACH = 10;
/** The nearest-body readout reaches further, so a star fills it on arrival. */
const NEAR_REACH = 24;
/** The Sun's real 274 m/s² would pin the inner system; cap the wells. */
const MAX_SURFACE_G = 30;

const JUMP_CHARGE = 2.4;
const JUMP_TRAVEL = 4.6;
/** Altitude (in radii) below which a body mass-locks the hyperdrive. */
const MASS_LOCK_RADII = 3;
const JUMP_FLOW = 40 * U;
const RESPAWN_DELAY = 3.6;

const DUST_N = 220;
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
  /** Accumulated pointer deltas (px) since the last frame. */
  mouseDX: number;
  mouseDY: number;
  /** One-shot: the HUD / keys asked for a regime; the ship consumes it. */
  modeRequest: SpeedMode | null;
  /** One-shot: flip the S-foils. */
  foilsToggle: boolean;
  /** One-shot: leave the ship in the suit, or climb back aboard. */
  eject: boolean;
  /** One-shot: chase camera ↔ cockpit. */
  viewToggle: boolean;
  /** Chase-camera distance multiplier — the wheel, the +/− keys and the
   *  HUD's camera keys all move this. 1 = the regime's own distance. */
  camZoom: number;
}

export interface FlightTelemetry {
  /** Flight units per second. */
  speed: number;
  speedKmS: number;
  /** Fraction of c. */
  speedC: number;
  mode: SpeedMode;
  hp: number;
  maxHp: number;
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
  /** Distance flown under power, km. Hyperspace legs are not counted —
   *  four light years would bury every sublight number the odometer shows. */
  odometerKm: number;
  /** 0..1 — cannon energy bank and boost reservoir, as the console reads them. */
  energy: number;
  boostCharge: number;
  alert: FlightAlert;
  /** Nearest body ('' when nothing within reach) and altitude above its surface. */
  nearId: string;
  nearAltKm: number;
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
  /** On-screen target brackets, filled by the canvas each frame: x, y in CSS
   *  pixels per marker, with `markerIds` naming them. A body that already
   *  fills the frame is left unlabelled — you can see what it is. */
  markers: Float32Array;
  markerIds: string[];
  markerCount: number;
  /** Incoming transmission: who, which line (1-based, 0 = none), how far typed. */
  commsFrom: string;
  commsLine: number;
  commsProgress: number;
}

export interface FlightSession {
  /** Set by the overlay; the canvas spawns / tears down the ship on change. */
  active: boolean;
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
  /** An inhabited world: it opens a radio channel when the ship comes near. */
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
  /** Where the ship respawns after a crash — a safe spot in the current system. */
  home: FlightAnchor;
  /** The hyperdrive's destination. */
  jump: FlightAnchor & { name: string; distanceLy: number };
  systemName: string;
}

export function clearFlightInput(input: FlightInput) {
  input.thrust = 0;
  input.yaw = 0;
  input.lookYaw = 0;
  input.pitch = 0;
  input.roll = 0;
  input.boost = false;
  input.fire = false;
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.modeRequest = null;
  input.foilsToggle = false;
  input.eject = false;
  input.viewToggle = false;
  input.camZoom = 1;
}

export function createFlightSession(): FlightSession {
  return {
    active: false,
    shipKind: 'xfoil',
    input: {
      thrust: 0, yaw: 0, lookYaw: 0, pitch: 0, roll: 0,
      boost: false, fire: false, mouseDX: 0, mouseDY: 0,
      modeRequest: null, foilsToggle: false, eject: false, viewToggle: false,
      camZoom: 1,
    },
    telemetry: {
      speed: 0,
      speedKmS: 0,
      speedC: 0,
      mode: 'cruise',
      hp: MAX_HP,
      maxHp: MAX_HP,
      boost: false,
      radar: new Float32Array(RADAR_MAX * 2),
      radarCount: 0,
      hitFlash: 0,
      kills: 0,
      foilsOpen: false,
      heat: 0,
      odometerKm: 0,
      energy: 1,
      boostCharge: 1,
      alert: '',
      nearId: '',
      nearAltKm: 0,
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
      markers: new Float32Array(MARKER_MAX * 2),
      markerIds: [],
      markerCount: 0,
      commsFrom: '',
      commsLine: 0,
      commsProgress: 0,
    },
  };
}

/* ───────────────────────── desktop controls ───────────────────────── */

const HANDLED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
  'Digit1', 'Digit2', 'Digit3', 'KeyF', 'KeyH', 'KeyV', 'KeyC',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight',
]);

/** Pull the chase camera in or push it out, within its stops. */
export function zoomFlightCamera(input: FlightInput, direction: number) {
  const next = input.camZoom * (direction > 0 ? CAM_ZOOM_STEP : 1 / CAM_ZOOM_STEP);
  input.camZoom = THREE.MathUtils.clamp(next, CAM_ZOOM_MIN, CAM_ZOOM_MAX);
}

/**
 * Keyboard + pointer-lock mouse. Must be called from a user gesture so the
 * lock request is honoured; returns the detach function. `onExit` fires on
 * ESC / X, or when a held pointer lock is released by the browser.
 */
export function attachDesktopControls(
  session: FlightSession,
  lockTarget: HTMLElement,
  onExit: () => void,
): () => void {
  const input = session.input;
  const pressed = new Set<string>();
  const sync = () => {
    const has = (c: string) => pressed.has(c);
    input.thrust = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0);
    input.yaw = (has('KeyD') || has('ArrowRight') ? 1 : 0) - (has('KeyA') || has('ArrowLeft') ? 1 : 0);
    input.roll = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
    input.boost = has('ShiftLeft') || has('ShiftRight');
    input.fire = has('Space');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'KeyX') {
      onExit();
      return;
    }
    if (!HANDLED_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Digit1') input.modeRequest = 'cruise';
    else if (e.code === 'Digit2') input.modeRequest = 'fast';
    else if (e.code === 'Digit3' || e.code === 'KeyH') input.modeRequest = 'jump';
    else if (e.code === 'KeyF') input.foilsToggle = true;
    else if (e.code === 'KeyV') input.eject = true;
    else if (e.code === 'KeyC') input.viewToggle = true;
    else if (e.code === 'Minus' || e.code === 'BracketLeft') zoomFlightCamera(input, 1);
    else if (e.code === 'Equal' || e.code === 'BracketRight') zoomFlightCamera(input, -1);
    pressed.add(e.code);
    sync();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!pressed.delete(e.code)) return;
    sync();
  };
  const onMouseMove = (e: MouseEvent) => {
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomFlightCamera(input, e.deltaY > 0 ? 1 : -1);
  };
  const onBlur = () => {
    pressed.clear();
    sync();
  };
  let lockHeld = false;
  const onLockChange = () => {
    if (document.pointerLockElement === lockTarget) {
      lockHeld = true;
    } else if (lockHeld) {
      lockHeld = false;
      onExit();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);
  try {
    const req = lockTarget.requestPointerLock() as unknown;
    if (req instanceof Promise) req.catch(() => undefined);
  } catch {
    // Pointer lock is optional — movementX/Y still steer without it.
  }
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerlockchange', onLockChange);
    lockHeld = false;
    if (document.pointerLockElement === lockTarget) document.exitPointerLock();
    clearFlightInput(input);
  };
}

/* ───────────────────────── ship geometry ───────────────────────── */

interface Foil {
  pivot: THREE.Group;
  /** +1 port (+X), -1 starboard. */
  side: number;
  /** +1 upper wing, -1 lower. */
  layer: number;
}

interface ShipParts {
  group: THREE.Group;
  /** Visual child — banks into turns while `group` carries the physics frame. */
  hull: THREE.Group;
  foils: Foil[];
  cannonTips: THREE.Object3D[];
  skinMat: THREE.MeshStandardMaterial;
  engineMat: THREE.MeshStandardMaterial;
  glowMats: THREE.SpriteMaterial[];
  glowSprites: THREE.Sprite[];
  /** Exhaust cones behind each nozzle — stretched by throttle. */
  plumes: THREE.Mesh[];
  plumeMat: THREE.MeshBasicMaterial | null;
  plasmaMat: THREE.SpriteMaterial;
  plasma: THREE.Sprite;
  strobeMat: THREE.MeshBasicMaterial;
  /** Navigation lights — their base colour lives in `userData.base`. */
  navMats: THREE.MeshBasicMaterial[];
  /** Materials shared across meshes — disposed once, by hand. */
  owned: THREE.Material[];
}

/** A tapered wing panel: a four-sided prism, wide-chorded at the root and
 *  narrow at the tip, laid along ±X so the caller only has to sweep it.
 *  `side` is +1 for port (+X), -1 for starboard. */
function wingPanel(side: number, rootR: number, tipR: number, span: number): THREE.CylinderGeometry {
  const geom = new THREE.CylinderGeometry(tipR, rootR, span, 4);
  geom.rotateY(Math.PI / 4);
  // Thin in Y, long in Z: a section, not a square post.
  geom.scale(1, 1, 1.5);
  geom.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);
  geom.scale(1, 0.13, 1);
  geom.translate(side * span * 0.5, 0, 0);
  return geom;
}

/** A hollow cone for an exhaust plume: base at the nozzle, tip trailing
 *  aft. Built along +Y, so the caller rotates it onto -Z. */
function plumeCone(radius: number, length: number): THREE.ConeGeometry {
  const geom = new THREE.ConeGeometry(radius, length, 14, 1, true);
  // Cone apex sits at +length/2; shift so the wide end lands on the origin
  // and the point runs out along +Y.
  geom.translate(0, length / 2, 0);
  return geom;
}

/**
 * An X-foil starfighter built from primitives: a long tapered nose in front
 * of a boxy engine fuselage, a faceted canopy with an astromech dome behind
 * it, four S-foils that each carry an engine at the root and a laser cannon
 * at the tip, red squadron stripes, and aviation navigation lights — red to
 * port, green to starboard, a white strobe on the spine. Forward is +Z.
 */
function buildShip(): ShipParts {
  const group = new THREE.Group();
  group.name = 'playerShip';
  const hull = new THREE.Group();
  group.add(hull);

  // Same finish as the interceptor: brushed gunmetal, black trim, one dark
  // red squadron accent, and ice-blue drives.
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xaeb5bf, roughness: 0.42, metalness: 0.72 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x767d88, roughness: 0.5, metalness: 0.66 });
  const shroud = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.66, metalness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x8e2b26, roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1622, roughness: 0.06, metalness: 0.95,
    emissive: new THREE.Color(0x0d3346), emissiveIntensity: 0.7,
  });
  const droid = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3b7bff).multiplyScalar(1.4) });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xdcf2ff,
    emissive: new THREE.Color(0x53b8ff),
    emissiveIntensity: 1.8,
    roughness: 0.25,
    metalness: 0,
  });
  const plumeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.55, 0.82, 1.5), transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const owned: THREE.Material[] = [skinMat, panel, shroud, stripe, glass, droid, engineMat, plumeMat];

  // ── Fuselage: engine box aft, long nose forward ──
  const aft = new THREE.Mesh(new THREE.BoxGeometry(1.3 * H, 1.0 * H, 2.6 * H), panel);
  aft.position.set(0, 0, -0.5 * H);
  hull.add(aft);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.7 * H, 0.26 * H, 2.2 * H), skinMat);
  spine.position.set(0, 0.6 * H, -0.5 * H);
  hull.add(spine);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.8 * H, 0.2 * H, 2.0 * H), shroud);
  keel.position.set(0, -0.56 * H, -0.5 * H);
  hull.add(keel);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * H, 0.55 * H, 3.0 * H, 18), skinMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.3 * H;
  hull.add(nose);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3 * H, 1.5 * H, 18), skinMat);
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 4.55 * H;
  hull.add(tip);
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.07 * H, 8, 8), shroud);
  sensor.position.z = 5.3 * H;
  hull.add(sensor);
  // Squadron stripes down the nose.
  const noseStripeGeom = new THREE.BoxGeometry(0.12 * H, 0.04 * H, 1.6 * H);
  for (const side of [-1, 1]) {
    const s = new THREE.Mesh(noseStripeGeom, stripe);
    s.position.set(side * 0.17 * H, 0.4 * H, 2.4 * H);
    s.rotation.x = -0.08;
    hull.add(s);
  }
  // Side greebles break the box into panels.
  const greebleGeom = new THREE.BoxGeometry(0.16 * H, 0.34 * H, 1.3 * H);
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(greebleGeom, shroud);
    g.position.set(side * 0.7 * H, -0.08 * H, -0.4 * H);
    hull.add(g);
  }

  // ── Canopy in a dark coaming, astromech dome behind it ──
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(0.82 * H, 0.5 * H, 1.5 * H), shroud);
  coaming.position.set(0, 0.55 * H, 1.0 * H);
  hull.add(coaming);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42 * H, 14, 10), glass);
  canopy.scale.set(0.85, 0.55, 1.5);
  canopy.position.set(0, 0.72 * H, 1.0 * H);
  hull.add(canopy);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3 * H, 14, 10), skinMat);
  dome.position.set(0, 0.72 * H, -0.35 * H);
  hull.add(dome);
  const band = new THREE.Mesh(new THREE.SphereGeometry(0.305 * H, 14, 10), droid);
  band.scale.set(1, 0.32, 1);
  band.position.set(0, 0.74 * H, -0.35 * H);
  hull.add(band);

  // ── S-foils: four wings on pivots at the fuselage sides. Each carries an
  // engine at the root and a cannon at the tip, so opening the foils fans
  // the engines and the guns out into the X. ──
  const wingGeom = new THREE.BoxGeometry(3.3 * H, 0.08 * H, 1.15 * H);
  const edgeGeom = new THREE.BoxGeometry(3.3 * H, 0.06 * H, 0.16 * H);
  const wingStripeGeom = new THREE.BoxGeometry(2.0 * H, 0.1 * H, 0.2 * H);
  const engineGeom = new THREE.CylinderGeometry(0.34 * H, 0.3 * H, 1.7 * H, 14);
  const intakeGeom = new THREE.ConeGeometry(0.34 * H, 0.5 * H, 14);
  const nozzleGeom = new THREE.CylinderGeometry(0.26 * H, 0.22 * H, 0.14 * H, 14);
  const nozzleRingGeom = new THREE.CylinderGeometry(0.31 * H, 0.31 * H, 0.3 * H, 14, 1, true);
  const cannonGeom = new THREE.CylinderGeometry(0.06 * H, 0.07 * H, 2.6 * H, 8);
  const cannonTipGeom = new THREE.SphereGeometry(0.1 * H, 8, 8);
  const navGeom = new THREE.SphereGeometry(0.08 * H, 8, 8);
  const glowTex = softSpriteTexture();
  const glowMats: THREE.SpriteMaterial[] = [];
  const glowSprites: THREE.Sprite[] = [];
  const plumes: THREE.Mesh[] = [];
  const plumeGeom = plumeCone(0.26 * H, 3.6 * H);
  const foils: Foil[] = [];
  const cannonTips: THREE.Object3D[] = [];
  const navMats: THREE.MeshBasicMaterial[] = [];
  // Forward is +Z with +Y up, so the pilot's left (port) is +X.
  const navColour: Record<number, number> = { 1: 0xff3b30, [-1]: 0x30ff6a };
  for (const side of [1, -1]) {
    for (const layer of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.65 * H, layer * 0.16 * H, -0.6 * H);
      hull.add(pivot);
      foils.push({ pivot, side, layer });

      const wing = new THREE.Mesh(wingGeom, skinMat);
      wing.position.set(side * 1.75 * H, 0, 0);
      pivot.add(wing);
      const edge = new THREE.Mesh(edgeGeom, panel);
      edge.position.set(side * 1.75 * H, 0, 0.62 * H);
      pivot.add(edge);
      const ws = new THREE.Mesh(wingStripeGeom, stripe);
      ws.position.set(side * 2.1 * H, layer * 0.03 * H, 0.1 * H);
      pivot.add(ws);

      const engine = new THREE.Mesh(engineGeom, panel);
      engine.rotation.x = Math.PI / 2;
      engine.position.set(side * 0.45 * H, layer * 0.2 * H, -0.5 * H);
      pivot.add(engine);
      const intake = new THREE.Mesh(intakeGeom, shroud);
      intake.rotation.x = Math.PI / 2;
      intake.position.set(side * 0.45 * H, layer * 0.2 * H, 0.6 * H);
      pivot.add(intake);
      const ring = new THREE.Mesh(nozzleRingGeom, shroud);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(side * 0.45 * H, layer * 0.2 * H, -1.38 * H);
      pivot.add(ring);
      const nozzle = new THREE.Mesh(nozzleGeom, engineMat);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(side * 0.45 * H, layer * 0.2 * H, -1.44 * H);
      pivot.add(nozzle);
      const plume = new THREE.Mesh(plumeGeom, plumeMat);
      plume.rotation.x = -Math.PI / 2;
      plume.position.set(side * 0.45 * H, layer * 0.2 * H, -1.5 * H);
      pivot.add(plume);
      plumes.push(plume);
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0x7fd4ff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(side * 0.45 * H, layer * 0.2 * H, -1.62 * H);
      sprite.scale.setScalar(1.2 * H);
      pivot.add(sprite);
      glowMats.push(mat);
      glowSprites.push(sprite);

      const cannon = new THREE.Mesh(cannonGeom, shroud);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(side * 3.35 * H, 0, 0.9 * H);
      pivot.add(cannon);
      const flare = new THREE.Mesh(cannonTipGeom, panel);
      flare.position.set(side * 3.35 * H, 0, 2.25 * H);
      pivot.add(flare);
      const cannonTip = new THREE.Object3D();
      cannonTip.position.set(side * 3.35 * H, 0, 2.4 * H);
      pivot.add(cannonTip);
      cannonTips.push(cannonTip);

      if (layer === 1) {
        const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(navColour[side]).multiplyScalar(1.6) });
        m.userData.base = navColour[side];
        const light = new THREE.Mesh(navGeom, m);
        light.position.set(side * 3.42 * H, 0.06 * H, -0.2 * H);
        pivot.add(light);
        owned.push(m);
        navMats.push(m);
      }
    }
  }

  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const strobe = new THREE.Mesh(navGeom, strobeMat);
  strobe.position.set(0, 0.78 * H, -1.3 * H);
  hull.add(strobe);
  owned.push(strobeMat);

  // Re-entry plasma sheath on the nose — invisible until the air bites.
  const plasmaMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: 0xff8a3a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const plasma = new THREE.Sprite(plasmaMat);
  plasma.position.set(0, 0, 4.2 * H);
  plasma.scale.setScalar(4 * H);
  hull.add(plasma);

  return {
    group, hull, foils, cannonTips, skinMat, engineMat, glowMats, glowSprites,
    plumes, plumeMat, plasmaMat, plasma, strobeMat, navMats, owned,
  };
}

/**
 * Interceptor. Built to the reference airframe: a slim gunmetal spine with
 * a long nose, two heavy nacelles set close in beside it burning ice-blue
 * and trailing a plume, wings swept hard back off the nacelles with the
 * navigation pods on the tips, a dark red flash on each nacelle shoulder,
 * canards forward and a pair of chin cannons. Forward is +Z.
 */
function buildInterceptor(): ShipParts {
  const group = new THREE.Group();
  group.name = 'playerShip';
  const hull = new THREE.Group();
  group.add(hull);

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.36, metalness: 0.78 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x6f7681, roughness: 0.46, metalness: 0.7 });
  const shroud = new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: 0.62, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8c2823, roughness: 0.48, metalness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1622, roughness: 0.05, metalness: 0.96,
    emissive: new THREE.Color(0x0d3346), emissiveIntensity: 0.7,
  });
  // Bright enough to clear the bloom threshold: the drives are the light
  // source in every frame the ship is in.
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xe8f6ff, emissive: new THREE.Color(0x8fd4ff), emissiveIntensity: 2.4, roughness: 0.2, metalness: 0,
  });
  const markerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.8, 2.4) });
  const plumeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.5, 0.86, 1.6), transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const owned: THREE.Material[] = [skinMat, panel, shroud, accent, glass, engineMat, markerMat, plumeMat];

  // ── Spine: a narrow six-sided body, a long nose, a keel beneath. ──
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4 * H, 0.56 * H, 4.6 * H, 6), skinMat);
  body.rotation.x = Math.PI / 2;
  body.rotation.z = Math.PI / 6;
  body.position.z = 0.1 * H;
  hull.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4 * H, 2.8 * H, 6), skinMat);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.z = Math.PI / 6;
  nose.position.z = 3.8 * H;
  hull.add(nose);
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.028 * H, 0.05 * H, 1.2 * H, 6), shroud);
  probe.rotation.x = Math.PI / 2;
  probe.position.z = 5.6 * H;
  hull.add(probe);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.62 * H, 0.2 * H, 3.6 * H), shroud);
  keel.position.set(0, -0.5 * H, 0);
  hull.add(keel);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.46 * H, 0.16 * H, 3.2 * H), panel);
  spine.position.set(0, 0.48 * H, -0.5 * H);
  hull.add(spine);
  // Formation light on the spine — the one cool marker on a grey hull.
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.075 * H, 10, 10), markerMat);
  marker.position.set(0, 0.6 * H, 0.5 * H);
  hull.add(marker);

  // ── Canopy: a narrow dark blister set into a black coaming. ──
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(0.66 * H, 0.28 * H, 1.8 * H), shroud);
  coaming.position.set(0, 0.4 * H, 1.5 * H);
  hull.add(coaming);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.32 * H, 16, 12), glass);
  canopy.scale.set(0.92, 0.6, 2.4);
  canopy.position.set(0, 0.54 * H, 1.5 * H);
  hull.add(canopy);

  // ── Tail: two small canted stabilisers off the spine. ──
  const finGeom = new THREE.BoxGeometry(0.07 * H, 0.95 * H, 1.1 * H);
  for (const side of [1, -1]) {
    const fin = new THREE.Mesh(finGeom, skinMat);
    fin.position.set(side * 0.38 * H, 0.6 * H, -2.0 * H);
    fin.rotation.z = side * 0.34;
    fin.rotation.x = 0.2;
    hull.add(fin);
  }

  const canardGeom = new THREE.BoxGeometry(1.3 * H, 0.07 * H, 0.55 * H);
  const nacelleGeom = new THREE.CylinderGeometry(0.72 * H, 0.64 * H, 3.6 * H, 20);
  const intakeGeom = new THREE.CylinderGeometry(0.72 * H, 0.72 * H, 0.3 * H, 20, 1, true);
  const bellGeom = new THREE.CylinderGeometry(0.58 * H, 0.5 * H, 0.18 * H, 20);
  const ringGeom = new THREE.CylinderGeometry(0.7 * H, 0.7 * H, 0.4 * H, 20, 1, true);
  const flashGeom = new THREE.BoxGeometry(0.2 * H, 0.34 * H, 1.5 * H);
  const pylonGeom = new THREE.BoxGeometry(0.75 * H, 0.2 * H, 1.8 * H);
  const wingGeoms = { 1: wingPanel(1, 1.0 * H, 0.42 * H, 2.7 * H), [-1]: wingPanel(-1, 1.0 * H, 0.42 * H, 2.7 * H) };
  const wingEdgeGeom = new THREE.BoxGeometry(2.4 * H, 0.16 * H, 0.2 * H);
  const podGeom = new THREE.CylinderGeometry(0.12 * H, 0.1 * H, 0.9 * H, 10);
  const cannonGeom = new THREE.CylinderGeometry(0.055 * H, 0.07 * H, 2.0 * H, 8);
  const navGeom = new THREE.SphereGeometry(0.095 * H, 10, 10);
  const glowTex = softSpriteTexture();
  const glowMats: THREE.SpriteMaterial[] = [];
  const glowSprites: THREE.Sprite[] = [];
  const plumes: THREE.Mesh[] = [];
  const cannonTips: THREE.Object3D[] = [];
  const navMats: THREE.MeshBasicMaterial[] = [];
  // Forward is +Z with +Y up, so the pilot's left (port) is +X.
  const navColour: Record<number, number> = { 1: 0xff3b30, [-1]: 0x30ff6a };
  const plumeGeom = plumeCone(0.5 * H, 6.4 * H);
  const NX = 1.35 * H; // nacelle centreline — close in beside the spine

  for (const side of [1, -1]) {
    const px = side * NX;

    // Canard, well forward, sharply swept.
    const canard = new THREE.Mesh(canardGeom, panel);
    canard.position.set(side * 0.95 * H, 0.02 * H, 2.5 * H);
    canard.rotation.y = side * 0.6;
    canard.rotation.z = -side * 0.14;
    hull.add(canard);

    // Nacelle on a stub pylon: intake forward, shroud ring and hot bell aft.
    const pylon = new THREE.Mesh(pylonGeom, panel);
    pylon.position.set(side * 0.9 * H, -0.04 * H, -0.4 * H);
    hull.add(pylon);
    const nacelle = new THREE.Mesh(nacelleGeom, skinMat);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(px, -0.08 * H, -1.1 * H);
    hull.add(nacelle);
    const intake = new THREE.Mesh(intakeGeom, shroud);
    intake.rotation.x = Math.PI / 2;
    intake.position.set(px, -0.08 * H, 0.76 * H);
    hull.add(intake);
    // The red flash sits on the outboard shoulder, where the reference
    // carries it — the only warm colour anywhere on the airframe.
    const flash = new THREE.Mesh(flashGeom, accent);
    flash.position.set(px + side * 0.62 * H, 0.06 * H, 0.1 * H);
    hull.add(flash);
    const ring = new THREE.Mesh(ringGeom, shroud);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(px, -0.08 * H, -2.82 * H);
    hull.add(ring);
    const bell = new THREE.Mesh(bellGeom, engineMat);
    bell.rotation.x = Math.PI / 2;
    bell.position.set(px, -0.08 * H, -2.94 * H);
    hull.add(bell);
    const plume = new THREE.Mesh(plumeGeom, plumeMat);
    plume.rotation.x = -Math.PI / 2;
    plume.position.set(px, -0.08 * H, -3.0 * H);
    hull.add(plume);
    plumes.push(plume);
    const mat = new THREE.SpriteMaterial({
      map: glowTex, color: 0x9adcff, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(px, -0.08 * H, -3.05 * H);
    sprite.scale.setScalar(2.4 * H);
    hull.add(sprite);
    glowMats.push(mat);
    glowSprites.push(sprite);

    // Wing: rooted on the nacelle and swept hard back. Everything the wing
    // carries hangs off the same pivot, so the leading edge, the tip pod and
    // the navigation light stay on the wing however far it is swept.
    const wingPivot = new THREE.Group();
    wingPivot.position.set(side * 1.5 * H, -0.04 * H, -0.7 * H);
    wingPivot.rotation.y = side * 0.48;
    wingPivot.rotation.z = -side * 0.2;
    hull.add(wingPivot);
    const wing = new THREE.Mesh(wingGeoms[side as 1 | -1], skinMat);
    wingPivot.add(wing);
    const edge = new THREE.Mesh(wingEdgeGeom, panel);
    edge.position.set(side * 1.35 * H, 0.03 * H, 1.0 * H);
    wingPivot.add(edge);
    const pod = new THREE.Mesh(podGeom, panel);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 2.6 * H, 0, -0.1 * H);
    wingPivot.add(pod);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(navColour[side]).multiplyScalar(1.6) });
    m.userData.base = navColour[side];
    const light = new THREE.Mesh(navGeom, m);
    light.position.set(side * 2.6 * H, 0, 0.42 * H);
    wingPivot.add(light);
    owned.push(m);
    navMats.push(m);

    // Chin cannon.
    const cannon = new THREE.Mesh(cannonGeom, shroud);
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(side * 0.38 * H, -0.34 * H, 2.1 * H);
    hull.add(cannon);
    const tip = new THREE.Object3D();
    tip.position.set(side * 0.38 * H, -0.34 * H, 3.2 * H);
    hull.add(tip);
    cannonTips.push(tip);
  }

  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const strobe = new THREE.Mesh(navGeom, strobeMat);
  strobe.position.set(0, 0.66 * H, -1.8 * H);
  hull.add(strobe);
  owned.push(strobeMat);

  const plasmaMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xff8a3a, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const plasma = new THREE.Sprite(plasmaMat);
  plasma.position.set(0, 0, 4.6 * H);
  plasma.scale.setScalar(4 * H);
  hull.add(plasma);

  return {
    group, hull, foils: [], cannonTips, skinMat, engineMat, glowMats, glowSprites,
    plumes, plumeMat, plasmaMat, plasma, strobeMat, navMats, owned,
  };
}

/**
 * The suit: a white hard-upper-torso EVA suit with a gold visor, the life
 * support pack on the back, red mission stripes, a chest display and the
 * SAFER jet pack whose nozzles glow when it fires. Head is +Y, forward +Z.
 */
function buildCosmonaut(): ShipParts {
  const group = new THREE.Group();
  group.name = 'cosmonaut';
  const hull = new THREE.Group();
  group.add(hull);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.7, metalness: 0.05 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.3 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.6, metalness: 0.1 });
  const visor = new THREE.MeshStandardMaterial({ color: 0xd9a62b, roughness: 0.15, metalness: 0.95, emissive: new THREE.Color(0x3a2a08), emissiveIntensity: 0.6 });
  const display = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5eead4).multiplyScalar(1.4) });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0xe0f4ff, emissive: new THREE.Color(0x9ad8ff), emissiveIntensity: 1.5, roughness: 0.3, metalness: 0 });
  const owned: THREE.Material[] = [skinMat, grey, red, visor, display, engineMat];

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34 * E, 0.5 * E, 6, 12), skinMat);
  hull.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3 * E, 16, 12), skinMat);
  helmet.position.set(0, 0.7 * E, 0);
  hull.add(helmet);
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.22 * E, 16, 12), visor);
  vis.scale.set(1, 0.85, 0.7);
  vis.position.set(0, 0.7 * E, 0.16 * E);
  hull.add(vis);
  // Neck ring, so the helmet reads as a separate piece.
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * E, 0.24 * E, 0.07 * E, 14), grey);
  ring.position.set(0, 0.46 * E, 0);
  hull.add(ring);
  // Life support: the pack is what you see from behind, so it is the
  // biggest thing on the suit and a different colour from the torso.
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.66 * E, 0.9 * E, 0.36 * E), grey);
  pack.position.set(0, 0.04 * E, -0.46 * E);
  hull.add(pack);
  const packLid = new THREE.Mesh(new THREE.BoxGeometry(0.7 * E, 0.1 * E, 0.4 * E), red);
  packLid.position.set(0, 0.5 * E, -0.46 * E);
  hull.add(packLid);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.28 * E, 0.16 * E, 0.04 * E), display);
  chest.position.set(0, 0.2 * E, 0.35 * E);
  hull.add(chest);
  const limbGeom = new THREE.CapsuleGeometry(0.11 * E, 0.62 * E, 4, 8);
  const legGeom = new THREE.CapsuleGeometry(0.13 * E, 0.78 * E, 4, 8);
  const gloveGeom = new THREE.SphereGeometry(0.13 * E, 10, 8);
  const bootGeom = new THREE.BoxGeometry(0.22 * E, 0.14 * E, 0.34 * E);
  const stripeGeom = new THREE.BoxGeometry(0.24 * E, 0.06 * E, 0.24 * E);
  for (const side of [-1, 1]) {
    // Arms held out and forward, the way a suited crew member floats.
    const arm = new THREE.Mesh(limbGeom, skinMat);
    arm.position.set(side * 0.52 * E, 0.02 * E, 0.14 * E);
    arm.rotation.z = side * 0.62;
    arm.rotation.x = -0.5;
    hull.add(arm);
    const glove = new THREE.Mesh(gloveGeom, grey);
    glove.position.set(side * 0.78 * E, 0.26 * E, 0.36 * E);
    hull.add(glove);
    const armStripe = new THREE.Mesh(stripeGeom, red);
    armStripe.position.set(side * 0.58 * E, 0.2 * E, 0.1 * E);
    armStripe.rotation.z = side * 0.62;
    hull.add(armStripe);
    const leg = new THREE.Mesh(legGeom, skinMat);
    leg.position.set(side * 0.21 * E, -0.8 * E, 0.02 * E);
    leg.rotation.x = 0.22;
    leg.rotation.z = side * 0.1;
    hull.add(leg);
    const boot = new THREE.Mesh(bootGeom, grey);
    boot.position.set(side * 0.24 * E, -1.24 * E, 0.14 * E);
    hull.add(boot);
    const legStripe = new THREE.Mesh(stripeGeom, red);
    legStripe.position.set(side * 0.21 * E, -0.58 * E, 0.06 * E);
    hull.add(legStripe);
  }
  // SAFER nozzles at the pack's lower corners, with their exhaust.
  const nozzleGeom = new THREE.SphereGeometry(0.06 * E, 8, 8);
  const glowTex = softSpriteTexture();
  const glowMats: THREE.SpriteMaterial[] = [];
  const glowSprites: THREE.Sprite[] = [];
  for (const side of [-1, 1]) {
    const n = new THREE.Mesh(nozzleGeom, engineMat);
    n.position.set(side * 0.24 * E, -0.36 * E, -0.6 * E);
    hull.add(n);
    const mat = new THREE.SpriteMaterial({ map: glowTex, color: 0xbfe8ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(side * 0.24 * E, -0.4 * E, -0.72 * E);
    sprite.scale.setScalar(0.5 * E);
    hull.add(sprite);
    glowMats.push(mat);
    glowSprites.push(sprite);
  }
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.05 * E, 8, 8), strobeMat);
  strobe.position.set(0, 0.98 * E, -0.05 * E);
  hull.add(strobe);
  owned.push(strobeMat);
  const plasmaMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a3a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const plasma = new THREE.Sprite(plasmaMat);
  plasma.position.set(0, 0.2 * E, 0.5 * E);
  plasma.scale.setScalar(2.2 * E);
  hull.add(plasma);
  return { group, hull, foils: [], cannonTips: [], skinMat, engineMat, glowMats, glowSprites, plumes: [], plumeMat: null, plasmaMat, plasma, strobeMat, navMats: [], owned };
}

/* ───────────────────────── audio ───────────────────────── */

function makeFlightAudio() {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  const ready = () => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  };
  const tone = (
    c: AudioContext, type: OscillatorType, f0: number, f1: number, gain: number, dur: number,
  ) => {
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };
  const rumble = (c: AudioContext, cutoff0: number, cutoff1: number, gain: number, dur: number) => {
    if (!noise) return;
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff0, t0);
    lp.frequency.exponentialRampToValueAtTime(cutoff1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    src.connect(lp).connect(g).connect(c.destination);
    src.onended = () => {
      src.disconnect();
      lp.disconnect();
      g.disconnect();
    };
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };
  const safe = (fn: (c: AudioContext) => void) => {
    try {
      fn(ready());
    } catch {
      // No audio available (autoplay policy, missing API) — the flight stays silent.
    }
  };
  return {
    laser() {
      safe((c) => tone(c, 'sawtooth', 620, 180, 0.09, 0.11));
    },
    boom() {
      safe((c) => {
        rumble(c, 900, 60, 0.7, 1.8);
        tone(c, 'sine', 90, 28, 0.5, 1.4);
      });
    },
    charge() {
      safe((c) => tone(c, 'sine', 110, 880, 0.12, JUMP_CHARGE));
    },
    whoosh() {
      safe((c) => rumble(c, 200, 4200, 0.35, 1.2));
    },
    dispose() {
      void ctx?.close();
      ctx = null;
      noise = null;
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
  trigger: (point: THREE.Vector3, normal: THREE.Vector3, body: FlightBody, impactVel: THREE.Vector3) => void;
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

  const debrisSkin = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.7, metalness: 0.3, transparent: true });
  const debrisDark = new THREE.MeshStandardMaterial({ color: 0x33373f, roughness: 0.75, metalness: 0.4, transparent: true });
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
    trigger(at, n, hitBody, impactVel) {
      life = 0;
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
      fire.s.position.copy(normal).multiplyScalar(0.8 * H);
      smoke.s.position.copy(normal).multiplyScalar(2.2 * H);
      ring.position.copy(normal).multiplyScalar(0.05 * H);
      ring.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), normal);
      const kick = Math.min(1.6, 0.6 + impactVel.length() / (4 * U));
      for (let i = 0; i < SPARK_N; i++) {
        sparkPos[i * 3] = 0;
        sparkPos[i * 3 + 1] = 0;
        sparkPos[i * 3 + 2] = 0;
        randomInHemisphere(sparkVel[i], 1.4);
        sparkVel[i].multiplyScalar((1 + Math.random() * 5) * U * kick);
      }
      sparkGeom.getAttribute('position').needsUpdate = true;
      for (const d of debris) {
        d.mesh.visible = true;
        d.settled = false;
        d.mesh.position.set(0, 0, 0).addScaledVector(normal, 0.3 * H);
        d.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        randomInHemisphere(d.vel, 1.1);
        d.vel.multiplyScalar((0.8 + Math.random() * 3.2) * U * kick);
        d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      }
      debrisSkin.opacity = 1;
      debrisDark.opacity = 1;
    },
    update(dt) {
      if (life < 0) return;
      life += dt;
      if (life > LIFE) {
        life = -1;
        group.visible = false;
        for (const d of debris) d.mesh.visible = false;
        return;
      }
      const t = life;
      // Fireball: the core flashes and dies, the fire swells then cools, the
      // smoke keeps growing and lingers.
      const coreK = Math.min(1, t / 0.45);
      core.s.scale.setScalar((1.5 + 6 * coreK) * H);
      core.mat.opacity = Math.max(0, 1 - t / 0.5);
      const fireK = Math.min(1, t / 1.4);
      fire.s.scale.setScalar((2 + 14 * Math.sqrt(fireK)) * H);
      fire.mat.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 1.3) * 0.95;
      fire.mat.color.setRGB(1.6, 0.45 + 0.5 * (1 - fireK), 0.15);
      const smokeK = Math.min(1, t / 2.8);
      smoke.s.scale.setScalar((3 + 20 * Math.sqrt(smokeK)) * H);
      smoke.mat.opacity = t < 0.3 ? (t / 0.3) * 0.85 : Math.max(0, 1 - (t - 0.3) / 3.0) * 0.85;
      // Shock ring races out across the ground and thins as it goes.
      const ringK = Math.min(1, t / 1.0);
      ring.scale.setScalar((1 + 22 * Math.sqrt(ringK)) * H);
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
          // Local position → distance from the body centre; stop on the ground.
          tmp.copy(d.mesh.position).add(point).sub(body.position);
          if (tmp.length() < floor + 0.08 * H) {
            tmp.normalize().multiplyScalar(floor + 0.08 * H).add(body.position).sub(point);
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
  life: number; // <0 idle
}

/** The interceptor trades armour for pace: faster, and it turns harder. */
function shipRegimes(kind: ShipKind): Record<Exclude<SpeedMode, 'jump'>, Regime> {
  if (kind !== 'interceptor') return REGIMES;
  const tune = (r: Regime): Regime => ({ ...r, max: r.max * 1.2, boost: r.boost * 1.2, accel: r.accel * 1.3, turn: r.turn * 1.15 });
  return { cruise: tune(REGIMES.cruise), fast: tune(REGIMES.fast) };
}

export function createPlayerShip(session: FlightSession): PlayerShipHandle {
  const shipParts = session.shipKind === 'interceptor' ? buildInterceptor() : buildShip();
  const evaParts = buildCosmonaut();
  const { group, cannonTips } = shipParts;
  const evaG = evaParts.group;
  evaG.visible = false;
  const regimes = shipRegimes(session.shipKind);
  const tel = session.telemetry;
  const input = session.input;
  const audio = makeFlightAudio();
  const radio = makeRadio();
  const crash = makeCrashFx();

  const fxGroup = new THREE.Group();
  fxGroup.name = 'playerFx';
  fxGroup.add(crash.group);
  fxGroup.add(evaG);

  // Pooled bolts — HDR red so the bloom pass lights them up.
  const boltGeom = new THREE.CylinderGeometry(0.16 * H, 0.16 * H, 5 * H, 6);
  boltGeom.rotateX(Math.PI / 2); // along +Z
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 0.7, 0.35) });
  const bolts: Bolt[] = [];
  const boltGroup = new THREE.Group();
  boltGroup.name = 'playerBolts';
  for (let i = 0; i < BOLT_POOL; i++) {
    const mesh = new THREE.Mesh(boltGeom, boltMat);
    mesh.visible = false;
    boltGroup.add(mesh);
    bolts.push({ mesh, dir: new THREE.Vector3(), life: -1 });
  }

  // Speed streaks: a box of particles around the ship, drawn as segments
  // stretched along the flow — dots at cruise, lines at a tenth of c, a
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

  const vel = new THREE.Vector3();
  const angVel = new THREE.Vector3();
  const angTarget = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const camUp = new THREE.Vector3(0, 1, 0);
  const lookPt = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const flow = new THREE.Vector3();
  const jumpDir = new THREE.Vector3();
  const jumpStart = new THREE.Vector3();
  // The destination is latched when the drive starts charging: the world's
  // idea of "the other system" flips halfway across, and a target that
  // moved with it would fold the jump back on itself.
  const jumpTarget: FlightAnchor = { position: new THREE.Vector3(), lookAt: new THREE.Vector3(), yaw: 0 };
  let jumpName = '';
  let jumpOrigin = '';
  // The world only notices the new system once it has seen the ship there,
  // so the arrival frames keep reporting the latched destination.
  let arrivedHold = 0;
  const crashLook = new THREE.Vector3();
  const invQ = new THREE.Quaternion();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();

  let pilot: Pilot = 'ship';
  let view: ViewMode = 'chase';
  let mode: SpeedMode = 'cruise';
  // Radio: -1 idle, 0 = channel opening, 1..N = line N, then the tail.
  let commsLine = -1;
  let commsT = 0;
  let commsCool = 0;
  let commsFrom = '';
  const eye = new THREE.Vector3();
  let regime: Regime = regimes.cruise;
  let jumpPhase: JumpPhase = 'none';
  let jumpT = 0;
  let pendYaw = 0;
  let pendPitch = 0;
  let fireAcc = 0;
  let cannonIdx = 0;
  let hp = MAX_HP;
  let sinceHit = 99;
  let snapCamera = true;
  let camBack = REGIMES.cruise.camBack;
  let bank = 0;
  let foilT = 0;
  let foilsForced: boolean | null = null;
  let heat = 0;
  let energy = 1;
  let boostCharge = 1;
  let sinceBoost = 99;
  let odometerKm = 0;
  let shake = 0;
  let crashT = -1;
  let alertHold = 0;
  let heldAlert: FlightAlert = '';

  /** Whatever the player is flying right now — the ship, or the suit. */
  const actor = () => (pilot === 'ship' ? group : evaG);
  const parts = () => (pilot === 'ship' ? shipParts : evaParts);
  const hullRadius = () => (pilot === 'ship' ? HULL_RADIUS : EVA_HULL_RADIUS);

  const setAlert = (a: FlightAlert, hold: number) => {
    heldAlert = a;
    alertHold = hold;
  };

  const fire = () => {
    const b = bolts.find((x) => x.life < 0);
    if (!b) return;
    cannonIdx = (cannonIdx + 1) % cannonTips.length;
    group.updateMatrixWorld(true);
    cannonTips[cannonIdx].getWorldPosition(b.mesh.position);
    b.mesh.position.addScaledVector(fwd, 2 * H);
    // Wingtip guns are boresighted to converge well ahead of the nose.
    b.dir.copy(group.position).addScaledVector(fwd, BORESIGHT).sub(b.mesh.position).normalize();
    b.mesh.quaternion.setFromUnitVectors(tmp.set(0, 0, 1), b.dir);
    b.life = 0;
    b.mesh.visible = true;
    audio.laser();
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
    // Pointer deltas that piled up during the countdown must not jerk the nose.
    input.mouseDX = 0;
    input.mouseDY = 0;
    input.modeRequest = null;
    input.foilsToggle = false;
    input.eject = false;
    hp = MAX_HP;
    sinceHit = 99;
    heat = 0;
    energy = 1;
    boostCharge = 1;
    sinceBoost = 99;
    crashT = -1;
    mode = 'cruise';
    regime = regimes.cruise;
    jumpPhase = 'none';
    foilsForced = null;
    group.visible = true;
    snapCamera = true;
    tel.hp = hp;
    tel.crashed = false;
    tel.respawnIn = 0;
    tel.pilot = 'ship';
  };

  /** A station shot down or rammed: the same fireball, then the scene hides it. */
  const destroyStation = (b: FlightBody, from: THREE.Vector3) => {
    tmp2.copy(from).sub(b.position).normalize();
    if (tmp2.lengthSq() < 0.5) tmp2.set(0, 1, 0);
    crash.trigger(b.position, tmp2, b, vel);
    b.destroyed = true;
    audio.boom();
  };

  const doCrash = (at: THREE.Vector3, normal: THREE.Vector3, body: FlightBody) => {
    crash.trigger(at, normal, body, vel);
    crashLook.copy(at);
    vel.set(0, 0, 0);
    angVel.set(0, 0, 0);
    hp = 0;
    crashT = 0;
    shake = 1.5;
    heat = 0;
    actor().visible = false;
    for (const b of bolts) {
      b.life = -1;
      b.mesh.visible = false;
    }
    audio.boom();
    tel.hp = 0;
    tel.hitFlash = 1;
    tel.crashed = true;
    tel.jumpFlash = 0.8;
  };

  const updateCamera = (dt: number, camera: THREE.PerspectiveCamera, fovTarget: number) => {
    const k = 1 - Math.pow(1 - CAM_LERP, dt * 60);
    const a = actor();
    if (crashT >= 0) {
      // Hold position over the wreck; the shake does the talking.
      camera.up.copy(camUp);
      camera.lookAt(crashLook);
    } else if (view === 'cockpit' && pilot === 'ship') {
      // Pilot's eye: no lag, the frame is the ship's own.
      up.set(0, 1, 0).applyQuaternion(group.quaternion);
      eye.copy(COCKPIT_EYE).applyQuaternion(group.quaternion).add(group.position);
      camera.position.copy(eye);
      camUp.copy(up);
      camera.up.copy(camUp);
      lookPt.copy(eye).addScaledVector(fwd, 10 * U);
      camera.lookAt(lookPt);
    } else {
      up.set(0, 1, 0).applyQuaternion(a.quaternion);
      camTarget.copy(a.position).addScaledVector(fwd, -camBack).addScaledVector(up, pilot === 'ship' ? CAM_UP : EVA_CAM_UP);
      if (snapCamera) {
        snapCamera = false;
        camera.position.copy(camTarget);
        camUp.copy(up);
      } else {
        camera.position.lerp(camTarget, k);
        camUp.lerp(up, k).normalize();
      }
      camera.up.copy(camUp);
      lookPt.copy(a.position).addScaledVector(fwd, pilot === 'ship' ? 6 * U : 2 * E);
      camera.lookAt(lookPt);
    }
    if (shake > 0.002) {
      const amp = shake * 1.6 * H;
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
      camera.position.z += (Math.random() - 0.5) * amp;
    }
    const fov = camera.fov + (fovTarget - camera.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(fov - camera.fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  const updateDust = (dt: number, speed: number) => {
    const jumping = jumpPhase === 'travel';
    let stretch: number;
    if (jumping) {
      flow.copy(jumpDir).multiplyScalar(JUMP_FLOW);
      stretch = 0.5;
    } else {
      flow.copy(vel);
      stretch = 0.055;
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
      dustMat.opacity = THREE.MathUtils.clamp(speed / (3 * U), 0, 1) * 0.55;
      dustMat.color.setRGB(0.67, 0.77, 1.0);
    }
    dust.visible = crashT < 0 && dustMat.opacity > 0.01;
  };

  const holdTelemetry = (camera: THREE.PerspectiveCamera, dt: number) => {
    tel.speed = tel.speedKmS = tel.speedC = 0;
    tel.alert = '';
    tel.heat = 0;
    tel.shake = shake;
    tel.radarCount = 0;
    tel.canBoard = false;
    updateCamera(dt, camera, REGIMES.cruise.fov);
    updateDust(dt, 0);
  };

  return {
    group,
    boltGroup,
    fxGroup,
    spawn,
    takeDamage(amount) {
      if (crashT >= 0 || jumpPhase !== 'none') return;
      hp = Math.max(MIN_HP, hp - amount);
      sinceHit = 0;
      tel.hp = hp;
      tel.hitFlash = 1;
    },
    update(dt, timeSec, camera, aliens, world) {
      tel.hitFlash = Math.max(0, tel.hitFlash - dt * 2.5);
      tel.jumpFlash = Math.max(0, tel.jumpFlash - dt * 1.6);
      shake *= Math.exp(-dt * 2.2);
      alertHold -= dt;
      crash.update(dt);
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

      // Cannon energy trickles back always; the boost reservoir waits a
      // beat after the throttle comes off, so a held boost really does run
      // the tank down instead of topping up under the player's thumb.
      energy = Math.min(1, energy + ENERGY_REGEN * dt);
      sinceBoost += dt;
      if (sinceBoost > BOOST_REGEN_DELAY) boostCharge = Math.min(1, boostCharge + BOOST_REGEN * dt);

      // Hull recharges once nobody has landed a hit for a few seconds.
      sinceHit += dt;
      if (hp < MAX_HP && sinceHit > HP_REGEN_DELAY) {
        hp = Math.min(MAX_HP, hp + HP_REGEN_PER_SEC * dt);
        tel.hp = hp;
      }

      // ── Leave the ship, or climb back in. The ship holds station where
      // it was left; the suit spawns just above the canopy. ──
      const a = actor();
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
            camBack = Math.max(MIN_CAM_BACK, EVA.camBack * (input.camZoom || 1));
            snapCamera = true;
          } else if (evaG.position.distanceTo(group.position) < BOARD_RANGE) {
            pilot = 'ship';
            evaG.visible = false;
            vel.set(0, 0, 0);
            angVel.set(0, 0, 0);
            camBack = Math.max(MIN_CAM_BACK, regimes[mode === 'jump' ? 'cruise' : mode].camBack * (input.camZoom || 1));
            snapCamera = true;
          }
        }
      }
      if (input.viewToggle) {
        input.viewToggle = false;
        view = view === 'chase' ? 'cockpit' : 'chase';
        snapCamera = true;
      }
      const me = actor();
      tel.pilot = pilot;
      tel.view = view;
      regime = pilot === 'eva' ? EVA : mode === 'jump' ? regime : regimes[mode];

      // ── Regime requests. A jump needs clear space: inside a few radii of
      // anything massive the drive is mass-locked, the way every serious
      // space sim does it. The suit only ever cruises. ──
      const req = input.modeRequest;
      input.modeRequest = null;
      if (req && jumpPhase === 'none' && pilot === 'ship') {
        if (req === 'jump') {
          let locked = false;
          for (const b of world.bodies) {
            if (!b.destroyed && me.position.distanceTo(b.position) < b.radius * (1 + MASS_LOCK_RADII)) {
              locked = true;
              break;
            }
          }
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
            audio.charge();
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

      // ── Hyperdrive. Charge: the nose swings onto the star and the ship
      // comes to rest. Travel: the ship rides a straight line to the
      // destination while the streak tunnel and the white-out sell the
      // speed. Arrival: dead stop, facing the new system. ──
      let speed = vel.length();
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
        if (jumpT >= JUMP_CHARGE) {
          jumpPhase = 'travel';
          jumpT = 0;
          jumpStart.copy(group.position);
          group.lookAt(tmp.copy(group.position).add(jumpDir));
          vel.set(0, 0, 0);
          tel.jumpFlash = 1;
          audio.whoosh();
        }
      } else if (jumpPhase === 'travel') {
        jumpT += dt;
        const s = Math.min(1, jumpT / JUMP_TRAVEL);
        const e = s * s * (3 - 2 * s);
        group.position.lerpVectors(jumpStart, jumpTarget.position, e);
        shake = Math.max(shake, 0.25);
        if (s >= 1) {
          jumpPhase = 'none';
          mode = 'cruise';
          regime = regimes.cruise;
          group.position.copy(jumpTarget.position);
          group.lookAt(jumpTarget.lookAt);
          group.rotateY(jumpTarget.yaw);
          vel.set(0, 0, 0);
          angVel.set(0, 0, 0);
          snapCamera = true;
          arrivedHold = 3;
          tel.systemName = jumpName;
          tel.jumpFlash = 1;
          setAlert('arrived', 3);
          audio.whoosh();
        }
      } else {
        // ── Attitude: keys / sticks drive smoothed angular rates; the mouse
        // adds a pending angle that eases out over a few frames. ──
        const turn = regime.turn;
        const yawIn = THREE.MathUtils.clamp(input.yaw + input.lookYaw, -1, 1);
        angTarget.set(-input.pitch * PITCH_RATE * turn, -yawIn * YAW_RATE * turn, input.roll * ROLL_RATE);
        angVel.lerp(angTarget, 1 - Math.exp(-dt * 7));
        pendYaw += -input.mouseDX * MOUSE_SENS * turn;
        pendPitch += input.mouseDY * MOUSE_SENS * turn;
        input.mouseDX = 0;
        input.mouseDY = 0;
        const mk = 1 - Math.exp(-dt * 14);
        const dYaw = pendYaw * mk;
        const dPitch = pendPitch * mk;
        pendYaw -= dYaw;
        pendPitch -= dPitch;
        me.rotateY(angVel.y * dt + dYaw);
        me.rotateX(angVel.x * dt + dPitch);
        me.rotateZ(angVel.z * dt);
        // The airframe banks into a turn; the physics frame does not.
        const bankTarget = -(yawIn * 0.5 + dYaw * 6) - angVel.y * 0.12;
        bank += (THREE.MathUtils.clamp(bankTarget, -0.6, 0.6) - bank) * (1 - Math.exp(-dt * 5));
        parts().hull.rotation.z = pilot === 'ship' ? bank : bank * 0.3;
        parts().hull.rotation.x = -angVel.x * 0.04;

        // ── Thrust, drag, gravity. Drag is per-frame and frame-rate
        // independent; every body within ten radii pulls with an inverse-
        // square well scaled from its real surface gravity. ──
        const boost = input.boost && input.thrust > 0 && boostCharge > BOOST_FLOOR;
        if (boost) {
          boostCharge = Math.max(0, boostCharge - BOOST_DRAIN * dt);
          sinceBoost = 0;
        }
        fwd.set(0, 0, 1).applyQuaternion(me.quaternion);
        vel.addScaledVector(fwd, input.thrust * regime.accel * (boost ? 2 : 1) * dt);
        vel.multiplyScalar(Math.pow(DRAG_PER_FRAME, dt * 60));
        for (const b of world.bodies) {
          if (b.destroyed || b.kind === 'station') continue;
          tmp.copy(b.position).sub(me.position);
          const d = tmp.length();
          const reach = b.radius * GRAVITY_REACH;
          if (d >= reach || d < 1e-9) continue;
          const g = (Math.min(MAX_SURFACE_G, b.surfaceG) / 9.81) * ONE_G;
          const ratio = b.radius / Math.max(d, b.radius);
          // Fade the well out over its last three radii so nothing pops.
          const edge = THREE.MathUtils.clamp((reach - d) / (b.radius * 3), 0, 1);
          vel.addScaledVector(tmp.divideScalar(d), g * ratio * ratio * edge * dt);
        }
        // Air bites: heat bleeds speed and scorches the hull.
        vel.multiplyScalar(Math.exp(-dt * 2.5 * heat));
        const max = boost ? regime.boost : regime.max;
        speed = vel.length();
        if (speed > max) {
          vel.multiplyScalar(max / speed);
          speed = max;
        }
        prevPos.copy(me.position);
        me.position.addScaledVector(vel, dt);
        tel.boost = boost;

        // ── Solid bodies: swept sphere test, so a tenth of c cannot tunnel
        // through a planet between two frames. Ramming a station takes it
        // down with you. ──
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

        // ── Lasers: the cannons fire in rotation. The suit is unarmed. ──
        fireAcc -= dt;
        if (input.fire && fireAcc <= 0 && pilot === 'ship' && cannonTips.length > 0 && energy >= ENERGY_PER_SHOT) {
          fireAcc = FIRE_INTERVAL;
          energy -= ENERGY_PER_SHOT;
          fire();
        }

        // The odometer counts the ground the ship has actually covered.
        odometerKm += vel.length() * dt * KM_PER_SCENE_UNIT;
      }

      // ── Nearest body: altitude readout, proximity warning, re-entry. ──
      let near: FlightBody | null = null;
      let nearD = Infinity;
      for (const b of world.bodies) {
        if (b.destroyed || b.kind === 'station') continue;
        const d = me.position.distanceTo(b.position);
        if (d - b.radius < nearD) {
          nearD = d - b.radius;
          near = b;
        }
      }
      let heatTarget = 0;
      let alert: FlightAlert = '';
      if (near && nearD < near.radius * NEAR_REACH) {
        tel.nearId = near.id;
        tel.nearAltKm = Math.max(0, (nearD / near.radius) * near.radiusKm);
        if (jumpPhase === 'none') {
          const atmoTop = near.radius * (near.atmosphere - 1);
          if (atmoTop > 0 && nearD < atmoTop) {
            heatTarget = (1 - nearD / atmoTop) * THREE.MathUtils.clamp(speed / (2 * U), 0, 1.4);
            heatTarget = Math.min(1, heatTarget);
            alert = 'entry';
          } else if (nearD < near.radius * 1.5) {
            tmp.copy(near.position).sub(me.position).normalize();
            if (vel.dot(tmp) > 0.3 * U) alert = 'proximity';
          }
        }
      } else {
        tel.nearId = '';
        tel.nearAltKm = 0;
      }
      heat += (heatTarget - heat) * (1 - Math.exp(-dt * 4));
      if (heat > 0.05) {
        shake = Math.max(shake, heat * 0.4);
        if (hp > MIN_HP) {
          hp = Math.max(MIN_HP, hp - 18 * heat * dt);
          sinceHit = 0;
          tel.hp = hp;
        }
      }
      const live = parts();
      live.plasmaMat.opacity = Math.min(1, heat * 1.3);
      const plasmaBase = pilot === 'ship' ? H : E;
      live.plasma.scale.set((4 + 6 * heat) * plasmaBase, (3 + 2 * heat) * plasmaBase, 1);
      live.skinMat.emissive.setRGB(1.0, 0.35, 0.08).multiplyScalar(heat * 0.9);
      if (jumpPhase === 'charge') alert = 'charging';
      else if (jumpPhase === 'travel') alert = 'jump';
      else if (alertHold > 0) alert = heldAlert;

      // ── S-foils: open for a fight (firing, or contacts on the radar), lock
      // flat for speed. F overrides until the next regime change. ──
      const foilsAuto = jumpPhase === 'none' && mode !== 'fast' && (input.fire || enemies.length > 0);
      const foilsOpen = pilot === 'ship' && jumpPhase === 'none' && (foilsForced ?? foilsAuto);
      foilT += ((foilsOpen ? 1 : 0) - foilT) * (1 - Math.exp(-dt * 3.2));
      for (const f of shipParts.foils) {
        f.pivot.rotation.z = f.layer * f.side * (0.05 + 0.3 * foilT);
      }

      // Engine glow answers the throttle: idle shimmer, a hard step under
      // thrust, a longer plume on boost, and a surge while the drive charges.
      const thrusting = jumpPhase === 'none' && input.thrust > 0;
      const chargeK = jumpPhase === 'charge' ? jumpT / JUMP_CHARGE : jumpPhase === 'travel' ? 1 : 0;
      const pulse = 0.8 + 0.08 * Math.sin(timeSec * 7)
        + (thrusting ? 0.55 : 0) + (tel.boost ? 1.0 : 0)
        + (mode === 'fast' ? 0.5 : 0) + chargeK * 1.6;
      live.engineMat.emissiveIntensity = 1.5 * pulse;
      const glowBase = pilot === 'ship' ? H : 0.45 * E;
      for (let i = 0; i < live.glowMats.length; i++) {
        live.glowMats[i].opacity = Math.min(1, 0.5 * pulse);
        const gs = (1.0 + 0.4 * (pulse - 0.8)) * glowBase;
        live.glowSprites[i].scale.set(gs, gs, 1);
      }
      // The plume is the throttle made visible: a stub at idle, a long
      // tapering cone under boost or a charging drive.
      if (live.plumeMat) {
        live.plumeMat.opacity = Math.min(0.85, 0.14 + 0.34 * (pulse - 0.8));
        const stretch = 0.35 + 0.85 * Math.min(1.6, pulse - 0.75);
        for (const pl of live.plumes) pl.scale.set(1, Math.max(0.12, stretch), 1);
      }
      // Anti-collision strobe: a double flash roughly once a second, the
      // rhythm every real aircraft and spacecraft carries.
      const beat = timeSec % 1.4;
      const flashing = beat < 0.07 || (beat > 0.18 && beat < 0.25);
      shipParts.strobeMat.color.setScalar(flashing ? 2.4 : 0.05);
      evaParts.strobeMat.color.setScalar(flashing ? 2.4 : 0.05);
      // Position lights breathe very slightly, the way an airliner's do.
      const beacon = 1.45 + 0.25 * (0.5 + 0.5 * Math.sin(timeSec * 2.4));
      for (const m of shipParts.navMats) m.color.setHex(m.userData.base as number).multiplyScalar(beacon);
      // From the pilot's seat the hull is the cockpit overlay, not the mesh.
      group.visible = crashT < 0 && !(view === 'cockpit' && pilot === 'ship');

      // ── Radio: an inhabited world opens a channel when the ship comes
      // near, speaks its lines, and signs off; then a long quiet. ──
      commsCool -= dt;
      let hailing: FlightBody | null = null;
      for (const b of world.bodies) {
        if (b.hails && !b.destroyed && me.position.distanceTo(b.position) < b.radius * HAIL_RADII) {
          hailing = b;
          break;
        }
      }
      if (commsLine < 0) {
        if (hailing && commsCool <= 0 && pilot === 'ship' && crashT < 0) {
          commsLine = 0;
          commsT = 0;
          commsFrom = hailing.id;
          radio.open();
        }
      } else {
        commsT += dt;
        const gone = !hailing || hailing.id !== commsFrom;
        if (commsLine === 0 && commsT > 0.7) {
          commsLine = 1;
          commsT = 0;
          radio.speak(COMMS_LINE_SEC * 0.85, 11);
        } else if (commsLine >= 1 && commsLine <= COMMS_LINES && commsT > COMMS_LINE_SEC + COMMS_GAP_SEC) {
          commsLine += 1;
          commsT = 0;
          if (commsLine <= COMMS_LINES) radio.speak(COMMS_LINE_SEC * 0.85, 11 + commsLine * 7);
          else radio.close();
        } else if (commsLine > COMMS_LINES && commsT > 1.2) {
          commsLine = -1;
          commsCool = COMMS_COOLDOWN;
        }
        if (gone && commsLine >= 0) {
          radio.close();
          commsLine = -1;
          commsCool = 20;
        }
      }
      tel.commsFrom = commsLine >= 0 ? commsFrom : '';
      tel.commsLine = commsLine >= 1 && commsLine <= COMMS_LINES ? commsLine : 0;
      tel.commsProgress = tel.commsLine ? Math.min(1, commsT / COMMS_LINE_SEC) : 0;

      // Bolts advance in world space and hit-test against the live enemies
      // and every solid body — a shot at the Moon sparks off the regolith;
      // enough shots take a station apart.
      for (const b of bolts) {
        if (b.life < 0) continue;
        b.life += dt;
        if (b.life > BOLT_LIFE) {
          b.life = -1;
          b.mesh.visible = false;
          continue;
        }
        prevPos.copy(b.mesh.position);
        b.mesh.position.addScaledVector(b.dir, BOLT_SPEED * dt);
        let spent = false;
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          const r = e.radius + 0.3 * U;
          if (b.mesh.position.distanceToSquared(e.group.position) < r * r) {
            aliens.spawnSparks(b.mesh.position, 0.034);
            if (aliens.damage(e, 15)) tel.kills += 1;
            spent = true;
            break;
          }
        }
        if (!spent) {
          // Swept against each body, so a small station cannot sit between
          // two bolt positions untouched.
          seg.copy(b.mesh.position).sub(prevPos);
          const segLen2 = seg.lengthSq();
          for (const body of world.bodies) {
            if (body.destroyed) continue;
            // A station is a truss, not a ball: give the shot the truss's reach.
            const r = body.radius + (body.kind === 'station' ? 3 * H : 0);
            tmp.copy(body.position).sub(prevPos);
            const t = segLen2 > 0 ? THREE.MathUtils.clamp(tmp.dot(seg) / segLen2, 0, 1) : 0;
            tmp2.copy(prevPos).addScaledVector(seg, t);
            if (tmp2.distanceToSquared(body.position) < r * r) {
              aliens.spawnSparks(b.mesh.position, 0.02);
              if (body.kind === 'station') {
                body.hp = (body.hp ?? STATION_HP) - 1;
                if (body.hp <= 0) destroyStation(body, b.mesh.position);
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
      tel.bank = bank;
      tel.pitchRate = angVel.x;

      // Hyperspace glow sits far down the tunnel and swells as you close.
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

      // ── Telemetry for the HUD (no allocations). ──
      const kmS = jumpPhase === 'travel' ? LIGHT_KM_S : (speed * KM_PER_SCENE_UNIT);
      tel.speed = speed / U;
      tel.speedKmS = kmS;
      tel.speedC = kmS / LIGHT_KM_S;
      tel.maxKmS = (jumpPhase !== 'none' ? LIGHT_KM_S / KM_PER_SCENE_UNIT : regime.boost) * KM_PER_SCENE_UNIT;
      tel.mode = mode;
      tel.foilsOpen = foilT > 0.5;
      tel.heat = heat;
      tel.odometerKm = odometerKm;
      tel.energy = energy;
      tel.boostCharge = boostCharge;
      tel.alert = alert;
      tel.jumpPhase = jumpPhase;
      tel.jumpT = jumpPhase === 'charge' ? jumpT / JUMP_CHARGE : jumpPhase === 'travel' ? Math.min(1, jumpT / JUMP_TRAVEL) : 0;
      tel.shake = shake;
      tel.respawnIn = 0;
      tel.canBoard = pilot === 'eva' && evaG.position.distanceTo(group.position) < BOARD_RANGE;
      invQ.copy(me.quaternion).invert();
      let n = 0;
      for (let i = 0; i < enemies.length && n < RADAR_MAX; i++) {
        tmp.copy(enemies[i].group.position).sub(me.position).applyQuaternion(invQ);
        // Local +X is the ship's left (forward is +Z), so mirror for the screen.
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
      }
      tel.radarCount = n;
    },
    dispose() {
      audio.dispose();
      radio.dispose();
      crash.dispose();
      boltGeom.dispose();
      boltMat.dispose();
      dustGeom.dispose();
      dustMat.dispose();
      jumpGlowMat.dispose();
      // Geometries and materials are shared across meshes here, so collect
      // them before disposing — traversing blind would free each many times.
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
