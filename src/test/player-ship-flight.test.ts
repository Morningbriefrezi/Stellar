import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createFlightSession,
  createPlayerShip,
  FLIGHT_UNIT,
  KM_PER_SCENE_UNIT,
  type FlightBody,
  type FlightSession,
  type FlightWorld,
  type PlayerShipHandle,
} from '@/lib/solar-system/player-ship';
import { projectTarget } from '@/lib/solar-system/flight-targeting';
import { makeMissionTracker } from '@/lib/solar-system/flight-missions';
import type { AlienHandle } from '@/lib/solar-system/aliens';

const U = FLIGHT_UNIT;
const EARTH_R = 0.028;
const DT = 1 / 60;

// jsdom has no 2D canvas; the sprite textures only need a context that
// swallows calls, and the audio layer already guards a missing AudioContext.
beforeAll(() => {
  const ctx: unknown = new Proxy(
    {},
    {
      get: () => () => ctx,
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
});

const aliens = {
  group: new THREE.Group(),
  enemies: [],
  damage: () => false,
  spawnSparks: () => undefined,
  setHostile: () => undefined,
  update: () => undefined,
  dispose: () => undefined,
} as unknown as AlienHandle;

function body(id: string, x: number, radius: number, radiusKm: number, surfaceG: number, atmosphere: number): FlightBody {
  return { id, kind: 'planet', position: new THREE.Vector3(x, 0, 0), radius, radiusKm, surfaceG, atmosphere };
}

function makeWorld(): FlightWorld {
  const earth = body('earth', 1, EARTH_R, 6371, 9.81, 1.25);
  return {
    bodies: [body('sun', 0, 0.152, 696_000, 274, 1.3), earth],
    pois: [],
    // Four Earth radii up on the +Z side, looking at the planet.
    home: { position: new THREE.Vector3(1, 0, EARTH_R * 5), lookAt: earth.position.clone(), yaw: 0 },
    jump: {
      name: 'alphaCentauri',
      distanceLy: 4.37,
      position: new THREE.Vector3(-14, -25, 8),
      lookAt: new THREE.Vector3(-15, -26, 8),
      yaw: 0,
    },
    systemName: 'sol',
  };
}

let session: FlightSession;
let ship: PlayerShipHandle;
let world: FlightWorld;
let camera: THREE.PerspectiveCamera;
let clock = 0;

const step = (n: number, dt = DT) => {
  for (let i = 0; i < n; i++) {
    clock += dt;
    ship.update(dt, clock, camera, aliens, world);
  }
};
const seconds = (s: number, dt = DT) => step(Math.round(s / dt), dt);
const heading = () => new THREE.Vector3(0, 0, 1).applyQuaternion(ship.group.quaternion);
/** Home looks straight at Earth; speed runs need open space ahead. */
const faceAway = () => ship.group.lookAt(new THREE.Vector3(1, 0, 10));

beforeEach(() => {
  session = createFlightSession();
  world = makeWorld();
  camera = new THREE.PerspectiveCamera(42, 1, 0.02, 64000);
  ship = createPlayerShip(session);
  ship.spawn(world.home);
  clock = 0;
});

afterEach(() => ship.dispose());

describe('speed regimes', () => {
  it('cruise settles at its ceiling and reads out in km/s and c', () => {
    faceAway();
    session.input.thrust = 1;
    seconds(4);
    const tel = session.telemetry;
    expect(tel.mode).toBe('cruise');
    expect(tel.speed).toBeCloseTo(0.6, 1);
    expect(tel.speedKmS).toBeCloseTo(0.6 * U * KM_PER_SCENE_UNIT, 0);
    expect(tel.speedC).toBeCloseTo(tel.speedKmS / 299_792.458, 6);
  });

  it('fast mode reaches ten times cruise, boost more still', () => {
    faceAway();
    session.input.modeRequest = 'fast';
    session.input.thrust = 1;
    // The drive re-tunes over a second or so, and Earth's well throttles
    // the fast drive until the ship is clear of it.
    seconds(16);
    expect(session.telemetry.mode).toBe('fast');
    expect(session.telemetry.speed).toBeCloseTo(12, 0);
    session.input.boost = true;
    seconds(4);
    expect(session.telemetry.boost).toBe(true);
    expect(session.telemetry.speed).toBeCloseTo(20, 0);
  });

  it('turns slower at speed', () => {
    const start = heading();
    session.input.yaw = 1;
    seconds(1);
    const cruiseTurn = start.angleTo(heading());
    session.input.yaw = 0;
    seconds(1);
    ship.spawn(world.home);
    session.input.modeRequest = 'fast';
    // Let the drive finish re-tuning before measuring the fast-regime turn.
    seconds(4);
    const start2 = heading();
    session.input.yaw = 1;
    seconds(1);
    const fastTurn = start2.angleTo(heading());
    expect(cruiseTurn).toBeGreaterThan(0.5);
    expect(fastTurn / cruiseTurn).toBeCloseTo(0.55, 1);
  });
});

describe('hyperdrive', () => {
  it('is mass-locked inside three radii of a body', () => {
    ship.group.position.set(1, 0, EARTH_R * 3.5);
    session.input.modeRequest = 'jump';
    step(1);
    expect(session.telemetry.alert).toBe('masslock');
    expect(session.telemetry.mode).toBe('cruise');
    expect(session.telemetry.jumpPhase).toBe('none');
  });

  it('charges, travels to the latched destination and arrives coasting', () => {
    const destination = world.jump.position.clone();
    session.input.modeRequest = 'jump';
    step(1);
    expect(session.telemetry.jumpPhase).toBe('charge');
    expect(session.telemetry.alert).toBe('charging');
    expect(session.telemetry.mode).toBe('jump');
    seconds(2.5);
    expect(session.telemetry.jumpPhase).toBe('travel');
    expect(session.telemetry.speedC).toBeCloseTo(1, 6);
    // The world flips its idea of "the other system" mid-flight; the ship
    // must keep the destination it charged for.
    world.jump.position.set(1, 0, EARTH_R * 5);
    world.jump.name = 'sol';
    world.systemName = 'alphaCentauri';
    for (let i = 0; i < 300 && session.telemetry.jumpPhase !== 'none'; i++) step(1);
    // The very frame it drops out, the HUD banner must already name the
    // new system.
    expect(session.telemetry.jumpPhase).toBe('none');
    expect(session.telemetry.systemName).toBe('alphaCentauri');
    expect(session.telemetry.mode).toBe('cruise');
    expect(ship.group.position.distanceTo(destination)).toBeLessThan(1e-6);
    expect(session.telemetry.speed).toBeCloseTo(0.18, 5);
    expect(session.telemetry.alert).toBe('arrived');
    expect(session.telemetry.systemName).toBe('alphaCentauri');
    expect(heading().angleTo(new THREE.Vector3(-1, -1, 0).normalize())).toBeLessThan(0.01);
  });

  it('ignores regime requests while jumping', () => {
    session.input.modeRequest = 'jump';
    step(1);
    session.input.modeRequest = 'fast';
    seconds(1);
    expect(session.telemetry.mode).toBe('jump');
  });
});

describe('gravity and solid bodies', () => {
  it('pulls a coasting ship toward the nearest well', () => {
    const before = ship.group.position.distanceTo(world.bodies[1].position);
    seconds(5);
    const after = ship.group.position.distanceTo(world.bodies[1].position);
    expect(after).toBeLessThan(before);
    expect(session.telemetry.nearId).toBe('earth');
    expect(session.telemetry.nearAltKm).toBeLessThan(6371 * 4);
  });

  it('warns on a closing approach, then heats up in the atmosphere', () => {
    ship.group.position.set(1, 0, EARTH_R * 2.3);
    ship.group.lookAt(world.bodies[1].position);
    session.input.thrust = 1;
    seconds(1.5);
    expect(session.telemetry.alert).toBe('proximity');
    // Inside the air, still above the hull's own contact radius.
    ship.group.position.set(1, 0, EARTH_R * 1.2);
    session.input.thrust = 1;
    seconds(0.15);
    expect(session.telemetry.crashed).toBe(false);
    expect(session.telemetry.alert).toBe('entry');
    expect(session.telemetry.heat).toBeGreaterThan(0.05);
    // Re-entry heat bleeds the shields before it touches the hull.
    expect(session.telemetry.shield).toBeLessThan(100);
    expect(session.telemetry.hp).toBe(100);
  });

  it('throttles the fast drive inside a gravity well and frees it outside', () => {
    ship.group.position.set(1, 0, EARTH_R * 4.5);
    session.input.modeRequest = 'fast';
    session.input.thrust = 1;
    faceAway();
    seconds(0.3);
    // Still climbing out of Earth's well: well short of the fast ceiling.
    expect(session.telemetry.alert).toBe('gravity');
    expect(session.telemetry.speed).toBeLessThan(18);
    seconds(14);
    expect(session.telemetry.alert).not.toBe('gravity');
    expect(session.telemetry.speed).toBeCloseTo(12, 0);
  });

  it('flight assist off keeps momentum and needs counter-thrust', () => {
    // Clear of Earth's well, so only the drive and the drag act on the ship.
    ship.group.position.set(1, 0, EARTH_R * 14);
    faceAway();
    session.input.assistToggle = true;
    session.input.thrust = 1;
    seconds(2);
    expect(session.telemetry.assist).toBe(false);
    const coasting = session.telemetry.speed;
    session.input.thrust = 0;
    seconds(3);
    // Almost no drag: the ship keeps nearly all of its way on.
    expect(session.telemetry.speed).toBeGreaterThan(coasting * 0.9);
    // A short retro burn takes most of it off again.
    session.input.thrust = -1;
    seconds(0.1);
    expect(session.telemetry.speed).toBeLessThan(coasting * 0.5);
    session.input.thrust = 0;
    session.input.assistToggle = true;
    seconds(3);
    expect(session.telemetry.assist).toBe(true);
    expect(session.telemetry.speed).toBeLessThan(0.2);
  });

  it('crashes on contact, holds the wreck, then respawns at home', () => {
    ship.group.position.set(1, 0, EARTH_R * 1.6);
    ship.group.lookAt(world.bodies[1].position);
    session.input.modeRequest = 'fast';
    session.input.thrust = 1;
    let crashedAt = -1;
    for (let i = 0; i < 600 && crashedAt < 0; i++) {
      step(1);
      if (session.telemetry.crashed) crashedAt = i;
    }
    expect(crashedAt).toBeGreaterThan(0);
    expect(session.telemetry.hp).toBe(0);
    expect(session.telemetry.speed).toBe(0);
    expect(ship.group.visible).toBe(false);
    expect(ship.group.position.distanceTo(world.bodies[1].position)).toBeGreaterThan(EARTH_R);
    ship.takeDamage(50);
    expect(session.telemetry.hp).toBe(0);
    session.input.thrust = 0;
    seconds(3.7);
    expect(session.telemetry.crashed).toBe(false);
    expect(session.telemetry.hp).toBe(100);
    expect(ship.group.visible).toBe(true);
    expect(ship.group.position.distanceTo(world.home.position)).toBeLessThan(1e-4);
  });

  it('cannot tunnel through a small body between frames', () => {
    const pebble = body('pebble', 0, 0.004, 1000, 1, 1);
    world.bodies = [pebble];
    ship.group.position.set(-0.3, 0, 0);
    ship.group.lookAt(pebble.position);
    session.input.modeRequest = 'fast';
    session.input.boost = true;
    session.input.thrust = 1;
    // At the frame cap the ship covers more than a pebble diameter per step.
    let crashed = false;
    for (let i = 0; i < 120 && !crashed; i++) {
      step(1, 0.1);
      crashed = session.telemetry.crashed;
    }
    expect(crashed).toBe(true);
    expect(ship.group.position.length()).toBeLessThan(0.01);
  });
});

describe('EVA and stations', () => {
  it('ejects into the suit, flies it, and boards again when close', () => {
    faceAway();
    session.input.eject = true;
    step(1);
    expect(session.telemetry.pilot).toBe('eva');
    expect(session.telemetry.canBoard).toBe(true);
    // The suit is slow and unarmed; the ship holds station behind it.
    session.input.thrust = 1;
    session.input.fire = true;
    seconds(9);
    expect(session.telemetry.speed).toBeCloseTo(0.16, 1);
    expect(session.telemetry.foilsOpen).toBe(false);
    expect(session.telemetry.canBoard).toBe(false);
    session.input.eject = true;
    step(1);
    expect(session.telemetry.pilot).toBe('eva');
    session.input.thrust = 0;
    session.input.fire = false;
    // Fast is for the ship only.
    session.input.modeRequest = 'fast';
    step(1);
    expect(session.telemetry.mode).toBe('cruise');
    // Walk back within range and climb aboard.
    ship.group.position.copy(ship.fxGroup.children.find((o) => o.name === 'cosmonaut')!.position);
    step(1);
    expect(session.telemetry.canBoard).toBe(true);
    session.input.eject = true;
    step(1);
    expect(session.telemetry.pilot).toBe('ship');
  });

  it('interceptor is the faster ship', () => {
    const fast = createFlightSession();
    fast.shipKind = 'xfoil';
    const other = createPlayerShip(fast);
    other.spawn(world.home);
    other.group.lookAt(new THREE.Vector3(1, 0, 10));
    fast.input.thrust = 1;
    for (let i = 0; i < 240; i++) other.update(DT, i * DT, camera, aliens, world);
    expect(fast.telemetry.speed).toBeCloseTo(0.72, 1);
    other.dispose();
  });

  it('ramming a station destroys both; shots wear one down', () => {
    const iss = body('iss', 1, 0.0015, 0.11, 0, 1);
    iss.kind = 'station';
    // Close enough that a cruise burn reaches it before Earth's pull bends
    // the run: the drive is paced against the planets, not open space.
    iss.position.set(1, 0, EARTH_R * 5 + 0.004);
    world.bodies.push(iss);
    ship.group.lookAt(iss.position);
    session.input.thrust = 1;
    // Stop at the impact: hold on any longer and the wreck has already
    // respawned by the time the assertion runs.
    let hit = false;
    for (let i = 0; i < 900 && !hit; i++) {
      step(1);
      hit = session.telemetry.crashed;
    }
    expect(hit).toBe(true);
    expect(iss.destroyed).toBe(true);
  });

  it('comes alongside a station instead of wrecking it when it drifts in slowly', () => {
    const iss = body('iss', 1, 0.0005, 0.11, 0, 1);
    iss.kind = 'station';
    iss.position.set(1, 0, EARTH_R * 5 - 0.003);
    // Only Earth and the station: the Sun's pull would bend the run off the
    // berth over the minute this takes at docking speed.
    world.bodies = [world.bodies[1], iss];
    // A whisper of throttle: the drive settles far below docking speed.
    session.input.thrust = 0.03;
    let docked = false;
    for (let i = 0; i < 3600 && !docked; i++) {
      step(1);
      docked = session.telemetry.docked;
    }
    expect(docked).toBe(true);
    expect(session.telemetry.crashed).toBe(false);
    expect(iss.destroyed).toBeFalsy();
    expect(session.telemetry.dockedTo).toBe('iss');
    // The berth puts the ship back together, and thrust casts off again.
    session.input.thrust = 0;
    ship.takeDamage(160);
    const hull = session.telemetry.hp;
    expect(hull).toBeLessThan(100);
    seconds(2);
    expect(session.telemetry.hp).toBeGreaterThan(hull);
    session.input.thrust = 1;
    step(2);
    expect(session.telemetry.docked).toBe(false);
  });

  it('bolts spark off bodies and take a station apart', () => {
    const iss = body('iss', 1, 0.0015, 0.11, 0, 1);
    iss.kind = 'station';
    iss.position.set(1, 0, EARTH_R * 5 + 0.012);
    world.bodies.push(iss);
    ship.group.lookAt(iss.position);
    session.input.fire = true;
    seconds(3);
    expect(iss.destroyed).toBe(true);
    expect(session.telemetry.crashed).toBe(false);
  });
});

describe('standing order', () => {
  it('names a world in this system, spares Earth, and blows it apart under fire', () => {
    world.bodies[0].kind = 'star';
    const mars = body('mars', 1, 0.004, 3390, 0.1, 1);
    mars.position.set(1, 0, EARTH_R * 5 + 0.06);
    world.bodies.push(mars);
    step(1);
    expect(session.telemetry.orderId).toBe('mars');
    expect(session.telemetry.orderIntegrity).toBe(1);
    ship.group.lookAt(mars.position);
    session.input.fire = true;
    seconds(20);
    expect(mars.destroyed).toBe(true);
    // Nothing left in reach that the order is allowed to name.
    expect(session.telemetry.orderId).toBe('');
  });
});

describe('cockpit and radio', () => {
  it('toggles into the cockpit and hides the hull mesh', () => {
    session.input.viewToggle = true;
    step(1);
    expect(session.telemetry.view).toBe('cockpit');
    expect(ship.group.visible).toBe(false);
    // The eye sits inside the hull, not behind it.
    expect(camera.position.distanceTo(ship.group.position)).toBeLessThan(0.003);
    session.input.viewToggle = true;
    step(1);
    expect(session.telemetry.view).toBe('chase');
    expect(ship.group.visible).toBe(true);
  });

  it('an inhabited world opens a channel, speaks four lines, then signs off', () => {
    const home = body('centauriPrime', 1, EARTH_R, 7327, 9.9, 1.25);
    home.hails = true;
    home.position.set(1, 0, EARTH_R * 11);
    world.bodies.push(home);
    step(1);
    expect(session.telemetry.commsFrom).toBe('centauriPrime');
    expect(session.telemetry.commsLine).toBe(0);
    seconds(1);
    expect(session.telemetry.commsLine).toBe(1);
    seconds(1);
    expect(session.telemetry.commsProgress).toBeGreaterThan(0.2);
    seconds(16);
    expect(session.telemetry.commsLine).toBe(4);
    seconds(4);
    expect(session.telemetry.commsFrom).toBe('');
    // Quiet afterwards — no second hail straight away.
    seconds(2);
    expect(session.telemetry.commsFrom).toBe('');
  });
});

describe('shields, hull and wings', () => {
  it('shields absorb fire first, then the hull, and enough fire destroys the ship', () => {
    ship.takeDamage(40);
    expect(session.telemetry.shield).toBe(60);
    expect(session.telemetry.hp).toBe(100);
    ship.takeDamage(90);
    expect(session.telemetry.shield).toBe(0);
    expect(session.telemetry.hp).toBe(70);
    step(1);
    expect(session.telemetry.alert).toBe('shielddown');
    ship.takeDamage(500);
    expect(session.telemetry.hp).toBe(0);
    expect(session.telemetry.crashed).toBe(true);
    seconds(3.7);
    expect(session.telemetry.crashed).toBe(false);
    expect(session.telemetry.shield).toBe(100);
  });

  it('shields recharge after a quiet spell; the hull knits back slowly', () => {
    ship.takeDamage(120);
    expect(session.telemetry.shield).toBe(0);
    expect(session.telemetry.hp).toBe(80);
    seconds(4);
    expect(session.telemetry.shield).toBe(0);
    seconds(3);
    expect(session.telemetry.shield).toBeGreaterThan(5);
    expect(session.telemetry.hp).toBe(80);
    seconds(6);
    expect(session.telemetry.hp).toBeGreaterThan(80);
  });

  it('opens the foils to fight and locks them for speed', () => {
    session.input.fire = true;
    seconds(2);
    expect(session.telemetry.foilsOpen).toBe(true);
    session.input.fire = false;
    session.input.modeRequest = 'fast';
    seconds(2);
    expect(session.telemetry.foilsOpen).toBe(false);
    session.input.foilsToggle = true;
    seconds(2);
    expect(session.telemetry.foilsOpen).toBe(true);
  });
});


describe('flight review regressions', () => {
  it('pauses flight without resetting position or telemetry', () => {
    world.bodies = [];
    session.input.thrust = 1;
    seconds(1);
    const position = ship.group.position.clone();
    const speed = session.telemetry.speed;
    session.paused = true;
    seconds(3);
    expect(ship.group.position.equals(position)).toBe(true);
    expect(session.telemetry.speed).toBe(speed);
    session.paused = false;
    step(1);
    expect(ship.group.position.equals(position)).toBe(false);
  });

  it('has the same partial-throttle speed at 30 and 144 fps', () => {
    world.bodies = [];
    const speeds = [30, 144].map((fps) => {
      ship.spawn(world.home);
      session.input.thrust = 0.3;
      seconds(2, 1 / fps);
      return session.telemetry.speed;
    });
    expect(speeds[0]).toBeCloseTo(speeds[1], 6);
  });

  it('discards mouse motion during a jump instead of turning on arrival', () => {
    session.input.modeRequest = 'jump';
    step(1);
    session.input.mouseDX = 1000;
    session.input.mouseDY = 1000;
    step(1);
    expect(session.input.mouseDX).toBe(0);
    expect(session.input.mouseDY).toBe(0);
  });

  it('keeps cannon shots ahead of a boosting fast ship', () => {
    world.bodies = [];
    faceAway();
    session.input.modeRequest = 'fast';
    session.input.thrust = 1;
    session.input.boost = true;
    seconds(4);
    session.input.fire = true;
    step(1);
    session.input.fire = false;
    const bolt = ship.boltGroup.children.find((b) => b.visible)!;
    const before = bolt.position.clone().sub(ship.group.position).dot(heading());
    seconds(0.3);
    const after = bolt.position.clone().sub(ship.group.position).dot(heading());
    expect(after).toBeGreaterThan(before + 0.02);
  });

  it('uses suit acceleration immediately when ejecting from fast flight', () => {
    world.bodies = [];
    session.input.modeRequest = 'fast';
    seconds(4);
    session.input.eject = true;
    session.input.thrust = 1;
    step(1);
    expect(session.telemetry.speed).toBeLessThan(0.06);
  });

  it('keeps crash shake anchored and camera matrices current', () => {
    step(1);
    const origin = camera.position.clone();
    ship.takeDamage(300);
    seconds(1);
    expect(camera.position.distanceTo(origin)).toBeLessThan(0.003);
    const matrixPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    expect(matrixPosition.distanceTo(camera.position)).toBeLessThan(1e-9);
  });

  it('walks the chase camera round the hull on a right-drag and back on release', () => {
    faceAway();
    seconds(1);
    const behind = camera.position.clone();
    session.input.orbiting = true;
    session.input.orbitYaw = Math.PI;
    seconds(2);
    // Half a turn puts the lens on the far side, still looking at the ship.
    expect(camera.position.distanceTo(behind)).toBeGreaterThan(0.002);
    const toShip = ship.group.position.clone().sub(camera.position).normalize();
    const lens = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(lens.dot(toShip)).toBeGreaterThan(0.98);
    session.input.orbiting = false;
    seconds(2);
    expect(camera.position.distanceTo(behind)).toBeLessThan(0.002);
  });

  it('keeps targeting finite at the camera plane and points behind targets outward', () => {
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    camera.updateMatrixWorld(true);
    const out = { x: 0, y: 0, on: 0, angle: 0 };
    for (const pos of [new THREE.Vector3(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)]) {
      projectTarget(pos, camera, out);
      expect(Number.isFinite(out.x) && Number.isFinite(out.y)).toBe(true);
      expect(out.on).toBe(0);
      expect(Math.max(Math.abs(out.x), Math.abs(out.y))).toBeCloseTo(0.86);
    }
  });

  it('paces discovery notifications in seconds across frame rates', () => {
    const ctx = { nearId: 'earth', altRadii: 0.3, sunDist: 1, speedFrac: 0, mode: 'cruise', systemName: 'sol', kills: 1, scanned: false, probeDist: Infinity, targetId: '' };
    for (const fps of [30, 144]) {
      localStorage.clear();
      const tracker = makeMissionTracker();
      expect(tracker.tick(ctx, 1 / fps)).toBe('earthOrbit');
      for (let i = 0; i < fps * 5; i++) expect(tracker.tick(ctx, 1 / fps)).toBe('');
      let next = '';
      for (let i = 0; i < fps * 2 && !next; i++) next = tracker.tick(ctx, 1 / fps);
      expect(next).toBe('firstBlood');
    }
  });
});
