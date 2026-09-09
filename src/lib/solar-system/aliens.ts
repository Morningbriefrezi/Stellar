// Alien encounters for SolarSystemCanvas — an easter egg in the guide, an
// opposition in Explore Mode. Ships are rocket-scale (a saucer spans ~1.5×
// the Earth launch vehicle, a tiny fraction of any planet).
//
// GUIDE (no target): rare, decorative sightings anchored near Earth —
//   flyby    — a saucer, scout probe, or mothership sweeps past on a curve
//              and warps out in a flash.
//   dogfight — a dart chases a saucer trading bolts.
//   battle   — two darts circle a saucer and a scout; one dart is lost.
//
// EXPLORE (target set): contact begins with curiosity. A scout appears on
// the radar, closes, holds station off the ship and scans it, then warps
// away. Shooting at it — or at anything that follows — provokes waves that
// hunt the ship with real flight: approach on a lead, strafe past firing,
// break away, reposition, jink when hit. Bolts are projectiles with a
// telegraph flash before each burst, so a pilot can read the attack.

import * as THREE from 'three';

export interface HostileTarget {
  group: THREE.Group;
  /** Called when an enemy bolt connects with the target. */
  onHit: (damage: number) => void;
}

export interface AlienEnemy {
  group: THREE.Group;
  hp: number;
  maxHp: number;
  /** Hit-test radius in scene units. */
  radius: number;
}

export interface AlienHandle {
  group: THREE.Group;
  update: (dtSec: number, earthPos: THREE.Vector3 | null) => void;
  dispose: () => void;
  /** Switch between passive sightings (null) and encounters around `target`. */
  setHostile: (target: HostileTarget | null) => void;
  /** Live, targetable ships of the current hostile wave. Reused array — read only. */
  enemies: AlienEnemy[];
  /** Apply damage; returns true when the ship is destroyed. */
  damage: (enemy: AlienEnemy, amount: number) => boolean;
  /** Pooled impact debris burst at `at`. */
  spawnSparks: (at: THREE.Vector3, speed: number) => void;
  /** Where the sensors see a contact (nearest visible ship), or null. */
  contactPos: THREE.Vector3 | null;
  /** What the contact is doing: a passive scan, or a hostile wave. */
  contactState: 'none' | 'scan' | 'hostile';
  /** A passive contact has completed a scan of the target at least once. */
  scanned: boolean;
  /** Bring the next encounter forward to now (development captures). */
  nudge: () => void;
}

function glowSprite(): THREE.CanvasTexture {
  const s = 96;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(220,255,244,0.95)');
  grad.addColorStop(0.4, 'rgba(140,255,214,0.4)');
  grad.addColorStop(1, 'rgba(80,255,190,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Classic saucer: brushed-metal hull, glass dome, ring of running lights,
 *  a dark underside with a bright drive ring. */
function buildSaucer(s: number, glowTex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.35, metalness: 0.85 });
  const hull = new THREE.Mesh(new THREE.SphereGeometry(s * 0.5, 24, 12), hullMat);
  hull.scale.y = 0.22;
  g.add(hull);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.3, s * 0.14, s * 0.08, 24), new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.7 }));
  under.position.y = -s * 0.1;
  g.add(under);
  const driveRing = new THREE.Mesh(new THREE.TorusGeometry(s * 0.22, s * 0.012, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 1.3) }));
  driveRing.rotation.x = Math.PI / 2;
  driveRing.position.y = -s * 0.14;
  g.add(driveRing);
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x9adfd2, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85,
    emissive: 0x2a7a6a, emissiveIntensity: 0.7,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(s * 0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = s * 0.08;
  g.add(dome);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x7dffd0 });
  const lightGeom = new THREE.SphereGeometry(s * 0.03, 6, 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const l = new THREE.Mesh(lightGeom, lightMat);
    l.position.set(Math.cos(a) * s * 0.44, 0, Math.sin(a) * s * 0.44);
    g.add(l);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.setScalar(s * 2.0);
  g.add(halo);
  return g;
}

/** Attack dart: a slim two-tone fuselage, swept fins, a hot engine and a
 *  glow behind it so it reads at range. Forward is +Z. */
function buildDart(s: number, glowTex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x4a3f5c, roughness: 0.4, metalness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x9a8fb4, roughness: 0.35, metalness: 0.8 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(s * 0.1, s * 0.7, 6), hullMat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(s * 0.05, s * 0.09, s * 0.36), trimMat);
  spine.position.set(0, s * 0.03, -s * 0.12);
  g.add(spine);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(s * 0.34, s * 0.015, s * 0.16), hullMat);
    fin.position.set(side * s * 0.18, 0, -s * 0.18);
    fin.rotation.y = -side * 0.5;
    g.add(fin);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(s * 0.06, s * 0.02, s * 0.08), trimMat);
    tip.position.set(side * s * 0.34, 0, -s * 0.28);
    g.add(tip);
  }
  const engine = new THREE.Mesh(new THREE.SphereGeometry(s * 0.045, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.5) }));
  engine.position.z = -s * 0.36;
  g.add(engine);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xff9a5a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.position.z = -s * 0.42;
  glow.scale.setScalar(s * 0.5);
  g.add(glow);
  return g;
}

/** Mothership: long dark hull, rows of lit windows, violet drive glow. */
function buildMothership(s: number): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, roughness: 0.5, metalness: 0.75 });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(s * 0.22, s * 1.7, 6, 14), hullMat);
  hull.rotation.x = Math.PI / 2;
  g.add(hull);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(s * 0.1, s * 0.32, s * 1.1), hullMat);
  g.add(spine);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff });
  const winGeom = new THREE.BoxGeometry(s * 0.015, s * 0.03, s * 0.06);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const w = new THREE.Mesh(winGeom, winMat);
      w.position.set(side * s * 0.225, s * 0.02, (i / 8 - 0.5) * s * 1.5);
      g.add(w);
    }
  }
  const drive = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.12, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xb08cff, transparent: true, opacity: 0.9 }),
  );
  drive.position.z = -s * 1.06;
  g.add(drive);
  return g;
}

/** Scout probe: small glowing orb with a sensor ring. */
function buildProbe(s: number, glowTex: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.1, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x9adfd2, roughness: 0.2, metalness: 0.4, emissive: 0x35c0a0, emissiveIntensity: 1.4 }),
  );
  g.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.16, s * 0.008, 6, 32), new THREE.MeshStandardMaterial({ color: 0x5e6a74, roughness: 0.4, metalness: 0.8 }));
  ring.rotation.x = Math.PI / 2 + 0.4;
  g.add(ring);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.setScalar(s * 0.55);
  g.add(halo);
  return g;
}

interface Bolt {
  mesh: THREE.Mesh;
  /** Guide-mode bolts lerp between two points; hostile bolts fly a velocity. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Group | null;
  t: number;
  life: number;
  damage: number;
}

interface SparkBurst {
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  vel: Float32Array;
  origin: THREE.Vector3;
  life: number; // <0 idle
}

type Manoeuvre = 'approach' | 'strafe' | 'break' | 'reposition' | 'evade' | 'hold';

interface Fighter {
  ship: THREE.Group;
  vel: THREE.Vector3;
  goal: THREE.Vector3;
  lateral: THREE.Vector3;
  state: Manoeuvre;
  stateT: number;
  maxSpeed: number;
  accel: number;
  /** Seconds until the next shot; a telegraph flash leads it. */
  fireIn: number;
  telegraphMat: THREE.SpriteMaterial;
  /** Shots fired so far in the current burst. */
  burst: number;
  /** Saucers and the mothership hold station instead of strafing. */
  heavy: boolean;
}

export function makeAlienEncounters(): AlienHandle {
  const group = new THREE.Group();
  group.name = 'alienEncounters';
  group.visible = false;

  // Rocket-scale, and set against the player's hull: a saucer spans a few
  // Kestrel lengths, not a moon.
  const S = 0.0028;
  const glowTex = glowSprite();

  const saucer = buildSaucer(S, glowTex);
  const dartA = buildDart(S * 0.9, glowTex);
  const dartB = buildDart(S * 0.9, glowTex);
  const mothership = buildMothership(S * 1.5);
  const probe = buildProbe(S, glowTex);
  const ships = [saucer, dartA, dartB, mothership, probe];

  const warpMat = new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const warpFlash = new THREE.Sprite(warpMat);
  for (const s of ships) {
    s.visible = false;
    group.add(s);
  }
  group.add(warpFlash);

  // Bolts — HDR so the bloom pass catches them; red is reserved for shots
  // at the player, and those are longer so they read as incoming.
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.2, 0.6), transparent: true, opacity: 0.95 });
  const boltMatRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.35, 0.25), transparent: true, opacity: 0.95 });
  const boltGeom = new THREE.CylinderGeometry(S * 0.014, S * 0.014, S * 0.45, 5);
  boltGeom.rotateX(Math.PI / 2);
  const boltGeomLong = new THREE.CylinderGeometry(S * 0.018, S * 0.018, S * 0.9, 5);
  boltGeomLong.rotateX(Math.PI / 2);
  const bolts: Bolt[] = [];
  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(boltGeom, boltMat);
    mesh.visible = false;
    group.add(mesh);
    bolts.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, t: -1, life: 0, damage: 10 });
  }

  const hitMat = new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color(0.6, 0.8, 1.0),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const hitFlash = new THREE.Sprite(hitMat);
  hitFlash.scale.setScalar(S * 1.4);
  saucer.add(hitFlash);

  // Scan beam: a thin additive line from the scout to the target.
  const beamGeom = new THREE.BufferGeometry();
  beamGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const beamMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 1.8, 1.4), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Line(beamGeom, beamMat);
  beam.frustumCulled = false;
  group.add(beam);

  const SPARK_N = 16;
  const sparks: SparkBurst[] = [];
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_N * 3), 3));
    const mat = new THREE.PointsMaterial({
      map: glowTex, color: 0xffc07a, size: S * 0.14, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    group.add(points);
    sparks.push({ points, mat, vel: new Float32Array(SPARK_N * 3), origin: new THREE.Vector3(), life: -1 });
  }
  const spawnSparks = (at: THREE.Vector3, speed: number) => {
    const b = sparks.find((x) => x.life < 0) ?? sparks[0];
    b.origin.copy(at);
    const p = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SPARK_N; i++) {
      p.setXYZ(i, at.x, at.y, at.z);
      b.vel[i * 3] = (Math.random() - 0.5) * speed;
      b.vel[i * 3 + 1] = (Math.random() - 0.5) * speed;
      b.vel[i * 3 + 2] = (Math.random() - 0.5) * speed;
    }
    p.needsUpdate = true;
    b.life = 0;
    b.mat.opacity = 1;
    b.points.visible = true;
    group.visible = true;
  };

  const boomMat = new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color(1.0, 0.62, 0.3),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const boomFlash = new THREE.Sprite(boomMat);
  group.add(boomFlash);

  const explode = (ship: THREE.Group) => {
    boomFlash.position.copy(ship.position);
    boomFlash.scale.setScalar(S * (ship === mothership ? 4.5 : 2.4));
    boomMat.opacity = 1;
    spawnSparks(ship.position, S * 4.5);
    ship.visible = false;
  };

  // Encounter state.
  type Mode = 'idle' | 'flyby' | 'dogfight' | 'battle' | 'scan' | 'hostile';
  let mode: Mode = 'idle';
  let lead: THREE.Group = saucer;
  let clock = 70 + Math.random() * 50;
  let encT = 0;
  let encDur = 15;
  let fireAcc = 0;
  let dartBDown = false;
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const battleCenter = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const posNext = new THREE.Vector3();
  const chase = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const rand = new THREE.Vector3();
  const targetVel = new THREE.Vector3();
  const targetPrev = new THREE.Vector3();
  const contactPos = new THREE.Vector3();

  const randDir = (out: THREE.Vector3) =>
    out.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5).normalize();

  const bezier = (t: number, out: THREE.Vector3) => {
    const inv = 1 - t;
    return out.set(0, 0, 0)
      .addScaledVector(pA, inv * inv)
      .addScaledVector(pB, 2 * inv * t)
      .addScaledVector(pC, t * t);
  };

  interface Track { ship: THREE.Group; r: number; omega: number; phase: number; tilt: THREE.Quaternion }
  const tracks: Track[] = [];
  const makeTrack = (ship: THREE.Group, r: number, omega: number): Track => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2, 0,
    ));
    return { ship, r, omega, phase: Math.random() * Math.PI * 2, tilt: q };
  };
  const trackPos = (tr: Track, t: number, out: THREE.Vector3) => {
    const a = tr.phase + tr.omega * t;
    out.set(Math.cos(a) * tr.r, 0, Math.sin(a) * tr.r).applyQuaternion(tr.tilt).add(battleCenter);
    return out;
  };

  // ── Explore-mode state ──
  let hostile: HostileTarget | null = null;
  let wave = 0;
  let provoked = false;
  let scanT = 0;
  let scansSeen = 0;
  const enemyByShip = new Map<THREE.Group, AlienEnemy>([
    [saucer, { group: saucer, hp: 60, maxHp: 60, radius: S * 0.62 }],
    [dartA, { group: dartA, hp: 30, maxHp: 30, radius: S * 0.5 }],
    [dartB, { group: dartB, hp: 30, maxHp: 30, radius: S * 0.5 }],
    [probe, { group: probe, hp: 30, maxHp: 30, radius: S * 0.42 }],
    [mothership, { group: mothership, hp: 240, maxHp: 240, radius: S * 1.5 }],
  ]);
  const enemies: AlienEnemy[] = [];
  const fighters = new Map<THREE.Group, Fighter>();
  for (const ship of ships) {
    const telegraphMat = new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(2.6, 0.5, 0.3), transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const telegraph = new THREE.Sprite(telegraphMat);
    telegraph.position.z = S * 0.3;
    telegraph.scale.setScalar(S * 0.6);
    ship.add(telegraph);
    const heavy = ship === saucer || ship === mothership;
    fighters.set(ship, {
      ship, vel: new THREE.Vector3(), goal: new THREE.Vector3(), lateral: new THREE.Vector3(),
      state: 'approach', stateT: 0,
      maxSpeed: ship === mothership ? 0.006 : heavy ? 0.012 : 0.024,
      accel: ship === mothership ? 0.6 : heavy ? 1.6 : 3.2,
      fireIn: 2 + Math.random() * 2, telegraphMat, burst: 0, heavy,
    });
  }
  const active: Fighter[] = [];
  const refreshEnemies = () => {
    enemies.length = 0;
    if (mode !== 'hostile' && mode !== 'scan') return;
    for (const f of active) {
      if (f.ship.visible) enemies.push(enemyByShip.get(f.ship)!);
    }
  };
  const resetHp = () => {
    enemyByShip.forEach((e) => { e.hp = e.maxHp; });
  };

  const begin = (m: Exclude<Mode, 'idle' | 'hostile' | 'scan'>, earth: THREE.Vector3 | null) => {
    mode = m;
    encT = 0;
    dartBDown = false;
    const anchor = earth ?? tmp.set(1, 0, 0);

    if (m === 'battle') {
      encDur = 18 + Math.random() * 5;
      randDir(rand);
      battleCenter.copy(anchor).addScaledVector(rand, 0.1 + Math.random() * 0.1);
      tracks.length = 0;
      tracks.push(
        makeTrack(saucer, S * 5, 0.9),
        makeTrack(probe, S * 8, -1.2),
        makeTrack(dartA, S * 11, 1.5),
        makeTrack(dartB, S * 14, -1.1),
      );
      saucer.visible = true;
      probe.visible = true;
      dartA.visible = true;
      dartB.visible = true;
      group.visible = true;
      return;
    }

    if (m === 'flyby') {
      const pick = Math.random();
      lead = pick < 0.4 ? saucer : pick < 0.75 ? probe : mothership;
    } else {
      lead = saucer;
    }
    encDur =
      lead === probe ? 9 + Math.random() * 3 :
      lead === mothership ? 20 + Math.random() * 6 :
      m === 'dogfight' ? 15 + Math.random() * 4 :
      13 + Math.random() * 5;

    randDir(rand);
    pA.copy(anchor).addScaledVector(rand, 0.5 + Math.random() * 0.3);
    pC.copy(anchor).multiplyScalar(2).sub(pA);
    randDir(rand);
    pC.addScaledVector(rand, 0.12);
    randDir(rand);
    pB.copy(anchor).addScaledVector(rand, 0.08 + Math.random() * 0.1);

    for (const s of ships) s.visible = false;
    lead.visible = true;
    if (m === 'dogfight') dartA.visible = true;
    group.visible = true;
  };

  /** A scout arrives at radar range, closes on the ship, holds off it and
   *  scans. Every third sighting brings the saucer instead. */
  const beginScan = (target: HostileTarget) => {
    mode = 'scan';
    encT = 0;
    encDur = 26;
    scanT = 0;
    resetHp();
    lead = scansSeen % 3 === 2 ? saucer : probe;
    scansSeen += 1;
    for (const s of ships) s.visible = false;
    lead.visible = true;
    randDir(rand);
    lead.position.copy(target.group.position).addScaledVector(rand, 0.3);
    const f = fighters.get(lead)!;
    f.vel.set(0, 0, 0);
    f.state = 'approach';
    f.stateT = 0;
    active.length = 0;
    active.push(f);
    refreshEnemies();
    group.visible = true;
  };

  const beginHostile = (target: HostileTarget) => {
    mode = 'hostile';
    encT = 0;
    encDur = 60;
    wave += 1;
    resetHp();
    for (const s of ships) s.visible = false;
    active.length = 0;
    const roster: THREE.Group[] = wave % 4 === 0
      ? [mothership, dartA, dartB]
      : wave === 1 ? [dartA] : wave === 2 ? [dartA, dartB] : [saucer, dartA, dartB];
    for (const ship of roster) {
      const f = fighters.get(ship)!;
      randDir(rand);
      ship.position.copy(target.group.position).addScaledVector(rand, 0.28 + Math.random() * 0.1);
      ship.visible = true;
      f.vel.set(0, 0, 0);
      f.state = f.heavy ? 'hold' : 'approach';
      f.stateT = 0;
      f.fireIn = 2.5 + Math.random() * 2;
      f.burst = 0;
      active.push(f);
    }
    refreshEnemies();
    group.visible = true;
  };

  const endEncounter = () => {
    mode = 'idle';
    // Curiosity comes back sooner than a fight does.
    clock = hostile ? (provoked ? 150 + Math.random() * 150 : 90 + Math.random() * 120) : 260 + Math.random() * 280;
    for (const s of ships) {
      s.visible = false;
      s.scale.setScalar(1);
    }
    for (const f of fighters.values()) f.telegraphMat.opacity = 0;
    warpMat.opacity = 0;
    boomMat.opacity = 0;
    beamMat.opacity = 0;
    for (const b of bolts) {
      b.t = -1;
      b.mesh.visible = false;
    }
    enemies.length = 0;
    active.length = 0;
    group.visible = false;
  };

  const fireBolt = (from: THREE.Group, target: THREE.Group, spread: number) => {
    const b = bolts.find((x) => x.t < 0);
    if (!b) return;
    b.mesh.material = boltMat;
    b.mesh.geometry = boltGeom;
    b.from.copy(from.position);
    b.to.copy(target.position);
    b.vel.set(0, 0, 0);
    if (Math.random() < 0.55) {
      b.to.x += (Math.random() - 0.5) * spread;
      b.to.y += (Math.random() - 0.5) * spread;
      b.target = null;
    } else {
      b.target = target;
    }
    b.t = 0;
    b.mesh.visible = true;
  };

  /** A projectile at the player: aimed at a lead on the target's motion,
   *  with a spread that makes a straight-and-level ship the easy kill. */
  const fireProjectile = (from: THREE.Group, target: HostileTarget, speed: number, spread: number, damage: number) => {
    const b = bolts.find((x) => x.t < 0);
    if (!b) return;
    b.mesh.material = boltMatRed;
    b.mesh.geometry = boltGeomLong;
    b.mesh.position.copy(from.position);
    const d = tmp.copy(target.group.position).sub(from.position).length();
    const lead = Math.min(1.2, d / speed);
    tmp.copy(target.group.position).addScaledVector(targetVel, lead * 0.85);
    tmp.x += (Math.random() - 0.5) * spread;
    tmp.y += (Math.random() - 0.5) * spread;
    tmp.z += (Math.random() - 0.5) * spread;
    b.vel.copy(tmp).sub(from.position).normalize().multiplyScalar(speed);
    b.mesh.lookAt(tmp);
    b.target = target.group;
    b.t = 0;
    b.life = 0;
    b.damage = damage;
    b.mesh.visible = true;
  };

  /** Steer a fighter toward its goal with a speed cap and finite thrust. */
  const steer = (f: Fighter, dt: number, speedK = 1) => {
    tmp.copy(f.goal).sub(f.ship.position);
    const d = tmp.length();
    if (d > 1e-9) tmp.divideScalar(d).multiplyScalar(f.maxSpeed * speedK);
    f.vel.lerp(tmp, Math.min(1, f.accel * dt));
    f.ship.position.addScaledVector(f.vel, dt);
    if (f.vel.lengthSq() > 1e-12) {
      tmp2.copy(f.ship.position).add(f.vel);
      if (f.ship === saucer) saucer.rotation.y += dt * 2.0;
      else f.ship.lookAt(tmp2);
    }
    return d;
  };

  /** One fighter's manoeuvre cycle around the target. */
  const flyFighter = (f: Fighter, target: HostileTarget, dt: number, mayFire: boolean) => {
    const tp = target.group.position;
    f.stateT += dt;
    const dist = f.ship.position.distanceTo(tp);
    if (f.heavy) {
      // Saucer and mothership: hold a slow drifting station off the ship,
      // keeping range, and fire from there.
      if (f.state !== 'hold' || f.stateT > 6) {
        f.state = 'hold';
        f.stateT = 0;
        randDir(f.lateral);
      }
      f.goal.copy(tp).addScaledVector(f.lateral, f.ship === mothership ? S * 14 : S * 8);
      steer(f, dt, 0.8);
    } else {
      switch (f.state) {
        case 'approach': {
          f.goal.copy(tp).addScaledVector(targetVel, 0.8);
          steer(f, dt);
          if (dist < S * 9) {
            f.state = 'strafe';
            f.stateT = 0;
            randDir(f.lateral).multiplyScalar(S * 1.5);
          }
          break;
        }
        case 'strafe': {
          // Fly straight through, past the target, guns on it.
          f.goal.copy(tp).add(f.lateral).addScaledVector(f.vel, 1.5);
          steer(f, dt, 1.1);
          tmp.copy(tp).sub(f.ship.position);
          const passed = tmp.dot(f.vel) < 0 || dist < S * 1.5;
          if (passed || f.stateT > 4) {
            f.state = 'break';
            f.stateT = 0;
            randDir(f.lateral);
          }
          break;
        }
        case 'break': {
          // Turn away and open range — no shots while showing the tail.
          f.goal.copy(f.ship.position).addScaledVector(f.lateral, S * 12).addScaledVector(f.vel, 1);
          steer(f, dt, 1.2);
          if (f.stateT > 2.2) {
            f.state = 'reposition';
            f.stateT = 0;
            randDir(f.lateral);
          }
          break;
        }
        case 'reposition': {
          f.goal.copy(tp).addScaledVector(f.lateral, S * 22);
          const d = steer(f, dt);
          if (d < S * 4 || f.stateT > 5) {
            f.state = 'approach';
            f.stateT = 0;
          }
          break;
        }
        case 'evade': {
          f.goal.copy(f.ship.position).addScaledVector(f.lateral, S * 10);
          steer(f, dt, 1.3);
          if (f.stateT > 1.1) {
            f.state = 'break';
            f.stateT = 0;
          }
          break;
        }
        default:
          f.state = 'approach';
      }
    }
    // Weapons: only with the target roughly ahead, after a visible telegraph.
    const canFire = mayFire && (f.heavy || f.state === 'approach' || f.state === 'strafe');
    f.telegraphMat.opacity = Math.max(0, f.telegraphMat.opacity - dt * 3);
    if (!canFire) return;
    tmp.copy(tp).sub(f.ship.position).normalize();
    tmp2.set(0, 0, 1).applyQuaternion(f.ship.quaternion);
    const onTarget = f.ship === saucer || tmp.dot(tmp2) > 0.85;
    if (!onTarget) return;
    f.fireIn -= dt;
    if (f.fireIn < 0.4 && f.burst === 0) f.telegraphMat.opacity = 1;
    if (f.fireIn <= 0) {
      const heavy = f.ship === mothership;
      fireProjectile(f.ship, target, heavy ? 0.045 : 0.07, heavy ? S * 1.2 : S * 2.2, heavy ? 22 : 9);
      f.burst += 1;
      if (f.burst >= (heavy ? 1 : 3)) {
        f.burst = 0;
        f.fireIn = heavy ? 4 + Math.random() * 2 : 2.2 + Math.random() * 1.6;
      } else {
        f.fireIn = 0.16;
      }
    }
  };

  const handle: AlienHandle = {
    group,
    enemies,
    spawnSparks,
    contactPos: null,
    contactState: 'none',
    scanned: false,
    nudge() {
      clock = 0;
    },
    setHostile(target) {
      if (target === hostile) return;
      hostile = target;
      wave = 0;
      provoked = false;
      scansSeen = 0;
      endEncounter();
      for (const sp of sparks) if (sp.life >= 0) group.visible = true;
      // First contact arrives early enough to be found, late enough to be a surprise.
      clock = target ? 45 + Math.random() * 40 : 260 + Math.random() * 280;
      if (target) targetPrev.copy(target.group.position);
    },
    damage(enemy, amount) {
      if (!enemy.group.visible || enemy.hp <= 0) return false;
      // Firing on a scout is the provocation the waves wait for.
      if (mode === 'scan' && enemy.group === lead) {
        provoked = true;
        encT = Math.max(encT, encDur * 0.92);
        clock = 6;
      }
      enemy.hp -= amount;
      if (enemy.group === saucer) hitMat.opacity = 0.9;
      const f = fighters.get(enemy.group);
      if (f && !f.heavy && mode === 'hostile' && f.state !== 'evade' && Math.random() < 0.6) {
        f.state = 'evade';
        f.stateT = 0;
        randDir(f.lateral);
      }
      if (enemy.hp > 0) return false;
      explode(enemy.group);
      refreshEnemies();
      return true;
    },
    update(dtSec: number, earthPos: THREE.Vector3 | null) {
      let sparksAlive = false;
      for (const sp of sparks) {
        if (sp.life < 0) continue;
        sparksAlive = true;
        sp.life += dtSec;
        const p = sp.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < SPARK_N; i++) {
          p.setXYZ(
            i,
            p.getX(i) + sp.vel[i * 3] * dtSec,
            p.getY(i) + sp.vel[i * 3 + 1] * dtSec,
            p.getZ(i) + sp.vel[i * 3 + 2] * dtSec,
          );
        }
        p.needsUpdate = true;
        sp.mat.opacity = Math.max(0, 1 - sp.life / 0.7);
        if (sp.life > 0.7) {
          sp.life = -1;
          sp.points.visible = false;
        }
      }
      boomMat.opacity = Math.max(0, boomMat.opacity - dtSec * 2.2);
      if (hostile && dtSec > 0) {
        targetVel.copy(hostile.group.position).sub(targetPrev).divideScalar(dtSec);
        targetPrev.copy(hostile.group.position);
      }

      if (mode === 'idle') {
        handle.contactPos = null;
        handle.contactState = 'none';
        if (!sparksAlive && boomMat.opacity <= 0) group.visible = false;
        clock -= dtSec;
        if (clock <= 0) {
          if (hostile) {
            // Waves only follow provocation; an unprovoked ship sees scouts.
            if (provoked && Math.random() < 0.7) beginHostile(hostile);
            else beginScan(hostile);
          } else {
            const r = Math.random();
            begin(r < 0.5 ? 'flyby' : r < 0.75 ? 'dogfight' : 'battle', earthPos);
          }
        }
        return;
      }

      encT += dtSec;
      let t = Math.min(1, encT / encDur);

      if (mode === 'scan' && hostile) {
        const f = active[0];
        const tp = hostile.group.position;
        if (!f.ship.visible) {
          t = 1;
        } else {
          const dist = f.ship.position.distanceTo(tp);
          // Approach, hold off the ship on its beam, scan, leave.
          if (f.state === 'approach') {
            f.goal.copy(tp);
            steer(f, dtSec, 0.9);
            if (dist < S * 7) {
              f.state = 'hold';
              f.stateT = 0;
              randDir(f.lateral);
            }
          } else {
            f.stateT += dtSec;
            f.goal.copy(tp).addScaledVector(f.lateral, S * 6).addScaledVector(targetVel, 0.3);
            steer(f, dtSec, 0.9);
            if (f.stateT > 2 && scanT < 5) {
              scanT += dtSec;
              beamMat.opacity = 0.5 + 0.4 * Math.sin(scanT * 9);
              const bp = beamGeom.getAttribute('position') as THREE.BufferAttribute;
              bp.setXYZ(0, f.ship.position.x, f.ship.position.y, f.ship.position.z);
              bp.setXYZ(1, tp.x, tp.y, tp.z);
              bp.needsUpdate = true;
              if (scanT >= 5) {
                handle.scanned = true;
                beamMat.opacity = 0;
              }
            } else {
              beamMat.opacity = Math.max(0, beamMat.opacity - dtSec * 4);
            }
            if (scanT >= 5 && f.stateT > 9.5) t = Math.max(t, 0.95);
          }
          contactPos.copy(f.ship.position);
          handle.contactPos = contactPos;
          handle.contactState = 'scan';
        }
      } else if (mode === 'hostile' && hostile) {
        let alive = 0;
        let nearest = Infinity;
        for (const f of active) {
          if (!f.ship.visible) continue;
          alive += 1;
          flyFighter(f, hostile, dtSec, t < 0.9);
          const d = f.ship.position.distanceToSquared(hostile.group.position);
          if (d < nearest) {
            nearest = d;
            contactPos.copy(f.ship.position);
          }
        }
        handle.contactPos = alive ? contactPos : null;
        handle.contactState = 'hostile';
        if (alive === 0) t = 1;
      } else if (mode === 'battle') {
        for (const tr of tracks) {
          if (tr.ship === dartB && dartBDown) continue;
          trackPos(tr, encT, pos);
          trackPos(tr, encT + 0.05, posNext);
          tr.ship.position.copy(pos);
          if (tr.ship === saucer) saucer.rotation.y += dtSec * 2.0;
          else tr.ship.lookAt(tmp.copy(posNext));
        }
        fireAcc -= dtSec;
        if (fireAcc <= 0 && t < 0.88) {
          fireAcc = 0.35 + Math.random() * 0.35;
          const r = Math.random();
          if (r < 0.4) fireBolt(dartA, saucer, S * 2.5);
          else if (r < 0.65 && !dartBDown) fireBolt(dartB, Math.random() < 0.5 ? saucer : probe, S * 2.5);
          else fireBolt(saucer, dartBDown || Math.random() < 0.5 ? dartA : dartB, S * 3);
        }
        if (!dartBDown && t > 0.72) {
          dartBDown = true;
          explode(dartB);
        }
      } else {
        bezier(t, pos);
        bezier(Math.min(1, t + 0.01), posNext);
        lead.position.copy(pos);
        if (lead === saucer) lead.rotation.y += dtSec * 2.0;
        else lead.lookAt(tmp.copy(posNext));
        if (mode === 'dogfight') {
          chase.copy(pos).sub(posNext).normalize().multiplyScalar(S * 6);
          chase.add(pos);
          chase.x += Math.sin(encT * 3.1) * S * 1.5;
          chase.y += Math.cos(encT * 2.3) * S * 1.5;
          dartA.position.copy(chase);
          tmp.copy(saucer.position);
          dartA.lookAt(tmp);
          fireAcc -= dtSec;
          if (fireAcc <= 0) {
            fireAcc = 0.5 + Math.random() * 0.5;
            fireBolt(dartA, saucer, S * 2.5);
          }
        }
      }

      // Advance bolts. Guide bolts lerp; projectiles fly and are swept
      // against the target's hull.
      const playerGroup = hostile?.group ?? null;
      for (const b of bolts) {
        if (b.t < 0) continue;
        if (b.vel.lengthSq() > 0) {
          b.life += dtSec;
          tmp.copy(b.mesh.position);
          b.mesh.position.addScaledVector(b.vel, dtSec);
          if (playerGroup && b.target === playerGroup) {
            tmp2.copy(playerGroup.position).sub(tmp);
            const segLen2 = b.vel.lengthSq() * dtSec * dtSec;
            const along = segLen2 > 0 ? THREE.MathUtils.clamp(tmp2.dot(b.vel) * dtSec / segLen2, 0, 1) : 0;
            tmp.addScaledVector(b.vel, along * dtSec);
            if (tmp.distanceToSquared(playerGroup.position) < (S * 0.32) ** 2) {
              spawnSparks(playerGroup.position, S * 2.8);
              hostile?.onHit(b.damage);
              b.t = -1;
              b.mesh.visible = false;
              continue;
            }
          }
          if (b.life > 2.2) {
            b.t = -1;
            b.mesh.visible = false;
          }
          continue;
        }
        b.t += dtSec * 2.6;
        if (b.t >= 1) {
          if (b.target) {
            spawnSparks(b.target.position, S * 2.8);
            if (b.target === saucer) hitMat.opacity = 0.9;
          }
          b.t = -1;
          b.mesh.visible = false;
          continue;
        }
        b.mesh.position.lerpVectors(b.from, b.to, b.t);
        tmp.copy(b.to);
        b.mesh.lookAt(tmp);
      }
      hitMat.opacity = Math.max(0, hitMat.opacity - dtSec * 3);

      // Warp-out flash at the end of the run.
      if (t > 0.94) {
        const k = (t - 0.94) / 0.06;
        const anchorShip = mode === 'battle' || mode === 'hostile' || mode === 'scan' ? (active[0]?.ship ?? saucer) : lead;
        warpFlash.position.copy(anchorShip.position);
        warpFlash.scale.setScalar(S * (1 + k * 6) * (lead === mothership ? 1.8 : 1));
        warpMat.opacity = Math.sin(k * Math.PI) * 0.9;
        beamMat.opacity = 0;
        for (const s of ships) {
          if (s.visible) s.scale.setScalar(Math.max(0.001, 1 - k));
        }
      }

      if (t >= 1) endEncounter();
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else (m as THREE.Material).dispose();
        } else if (o instanceof THREE.Sprite) {
          (o.material as THREE.SpriteMaterial).dispose();
        }
      });
      boltMatRed.dispose();
      boltGeomLong.dispose();
      glowTex.dispose();
    },
  };
  return handle;
}
