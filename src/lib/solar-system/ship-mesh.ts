// Stellar's own spacecraft, built from primitives so the page never fetches
// a model. Two airframes share one design language — graphite and titanium
// hulls, off-white structural panels, exposed reaction-control pods, a
// sensor package on the nose, radiators aft, and a real engine cluster with
// bells, hot cores and plumes — and differ in silhouette: the Kestrel is a
// broad-winged survey ship, the Lance a needle-nosed interceptor. Forward
// is +Z, up +Y, so the pilot's left (port) is +X.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { softSpriteTexture } from '@/lib/solar-system/soft-sprite';

export type ShipKind = 'kestrel' | 'lance';

/** A reaction-control jet: a sprite on the hull whose brightness answers
 *  the control inputs it opposes. Weights are signed: a jet with yaw +1
 *  fires when the pilot commands a right turn. */
export interface RcsJet {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  yaw: number;
  pitch: number;
  roll: number;
  /** Fires under reverse thrust — the forward-facing braking nozzles. */
  brake: number;
}

export interface WingPivot {
  pivot: THREE.Group;
  /** +1 port (+X), -1 starboard. */
  side: number;
  /** Sweep (rad) when spread for combat, and when folded for speed. */
  open: number;
  closed: number;
}

export interface ShipParts {
  group: THREE.Group;
  /** Visual child — banks into turns while `group` carries the physics frame. */
  hull: THREE.Group;
  wings: WingPivot[];
  cannonTips: THREE.Object3D[];
  skinMat: THREE.MeshStandardMaterial;
  /** Engine cores — emissive rises with throttle. */
  engineMat: THREE.MeshStandardMaterial;
  /** Nozzle bells — they glow dull red as heat soaks in. */
  bellMat: THREE.MeshStandardMaterial;
  glowMats: THREE.SpriteMaterial[];
  glowSprites: THREE.Sprite[];
  plumes: THREE.Mesh[];
  plumeMat: THREE.MeshBasicMaterial | null;
  plasmaMat: THREE.SpriteMaterial;
  plasma: THREE.Sprite;
  strobeMat: THREE.MeshBasicMaterial;
  /** Position lights — base colour in `userData.base`. */
  navMats: THREE.MeshBasicMaterial[];
  rcs: RcsJet[];
  /** Materials shared across meshes — disposed once, by hand. */
  owned: THREE.Material[];
  /** Hull length, for the camera and collision maths. */
  length: number;
}

interface Palette {
  graphite: THREE.MeshStandardMaterial;
  titanium: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  engineMat: THREE.MeshStandardMaterial;
  bellMat: THREE.MeshStandardMaterial;
  plumeMat: THREE.MeshBasicMaterial;
  owned: THREE.Material[];
}

function palette(accentHex: number, driveHex: number): Palette {
  const graphite = new THREE.MeshStandardMaterial({ color: 0x3a414b, roughness: 0.55, metalness: 0.5 });
  const titanium = new THREE.MeshStandardMaterial({ color: 0x7d8692, roughness: 0.42, metalness: 0.72 });
  const panel = new THREE.MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.66, metalness: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0f1216, roughness: 0.72, metalness: 0.45 });
  const accent = new THREE.MeshStandardMaterial({
    color: accentHex, roughness: 0.5, metalness: 0.2,
    emissive: new THREE.Color(accentHex), emissiveIntensity: 0.35,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x07111c, roughness: 0.08, metalness: 0.9,
    emissive: new THREE.Color(0x0b2a3c), emissiveIntensity: 0.55,
  });
  const drive = new THREE.Color(driveHex);
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xeaf7ff, emissive: drive, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0,
  });
  const bellMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d44, roughness: 0.5, metalness: 0.75, emissive: new THREE.Color(0x000000), emissiveIntensity: 1,
  });
  const plumeMat = new THREE.MeshBasicMaterial({
    color: drive.clone().multiplyScalar(1.5), transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  return {
    graphite, titanium, panel, dark, accent, glass, engineMat, bellMat, plumeMat,
    owned: [graphite, titanium, panel, dark, accent, glass, engineMat, bellMat, plumeMat],
  };
}

/** A tapered wing panel laid along ±X: thick chord at the root, thin at
 *  the tip, swept by the caller through its pivot. */
function wingPanel(side: number, rootChord: number, tipChord: number, span: number, thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Chord runs along Z (forward +), span along X.
  shape.moveTo(0, rootChord * 0.55);
  shape.lineTo(span, tipChord * 0.35);
  shape.lineTo(span, -tipChord * 0.65);
  shape.lineTo(0, -rootChord * 0.45);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  // Extrude runs along +Z; we want thickness along Y and the chord along Z.
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, -thick / 2, 0);
  if (side < 0) geom.scale(-1, 1, 1);
  return geom;
}

/** Hollow cone for an exhaust plume: wide end at the nozzle, tip trailing. */
function plumeCone(radius: number, length: number): THREE.ConeGeometry {
  const geom = new THREE.ConeGeometry(radius, length, 14, 1, true);
  geom.translate(0, length / 2, 0);
  return geom;
}

/** A six-sided tapered hull section along +Z. */
function hullSection(rFront: number, rBack: number, length: number, sides = 6): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(rFront, rBack, length, sides);
  g.rotateX(Math.PI / 2);
  g.rotateZ(Math.PI / sides);
  return g;
}

interface Builder {
  hull: THREE.Group;
  pal: Palette;
  H: number;
  glowTex: THREE.Texture;
  glowMats: THREE.SpriteMaterial[];
  glowSprites: THREE.Sprite[];
  plumes: THREE.Mesh[];
  rcs: RcsJet[];
  navMats: THREE.MeshBasicMaterial[];
  owned: THREE.Material[];
}

function mesh(b: Builder, geom: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = b.hull): THREE.Mesh {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** An engine: shroud ring, bell, hot core, plume and glow, facing aft. */
function engine(b: Builder, x: number, y: number, z: number, r: number, plumeLen: number, parent: THREE.Object3D = b.hull) {
  const H = b.H;
  const shroud = mesh(b, new THREE.CylinderGeometry(r * 1.15, r * 1.05, 0.5 * H, 16, 1, true), b.pal.dark, x, y, z + 0.2 * H, parent);
  shroud.rotation.x = Math.PI / 2;
  const bell = mesh(b, new THREE.CylinderGeometry(r * 0.72, r, 0.46 * H, 16, 1, true), b.pal.bellMat, x, y, z - 0.1 * H, parent);
  bell.rotation.x = Math.PI / 2;
  const core = mesh(b, new THREE.CylinderGeometry(r * 0.6, r * 0.5, 0.12 * H, 16), b.pal.engineMat, x, y, z + 0.05 * H, parent);
  core.rotation.x = Math.PI / 2;
  const plume = mesh(b, plumeCone(r * 0.78, plumeLen), b.pal.plumeMat, x, y, z - 0.3 * H, parent);
  plume.rotation.x = -Math.PI / 2;
  b.plumes.push(plume);
  const mat = new THREE.SpriteMaterial({
    map: b.glowTex, color: b.pal.plumeMat.color, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z - 0.4 * H);
  sprite.scale.setScalar(r * 4.2);
  parent.add(sprite);
  b.glowMats.push(mat);
  b.glowSprites.push(sprite);
}

/** A reaction-control pod: a small block with a nozzle and its puff. */
function rcsPod(
  b: Builder, x: number, y: number, z: number, nozzle: THREE.Vector3,
  k: { yaw?: number; pitch?: number; roll?: number; brake?: number },
) {
  const H = b.H;
  const pod = mesh(b, new THREE.BoxGeometry(0.16 * H, 0.16 * H, 0.22 * H), b.pal.dark, x, y, z);
  pod.lookAt(pod.position.clone().add(nozzle));
  const mat = new THREE.SpriteMaterial({
    map: b.glowTex, color: 0xdff4ff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z).addScaledVector(nozzle, 0.2 * H);
  sprite.scale.setScalar(0.55 * H);
  b.hull.add(sprite);
  b.rcs.push({ sprite, mat, yaw: k.yaw ?? 0, pitch: k.pitch ?? 0, roll: k.roll ?? 0, brake: k.brake ?? 0 });
}

function navLight(b: Builder, x: number, y: number, z: number, hex: number, r: number, parent: THREE.Object3D = b.hull) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.6) });
  m.userData.base = hex;
  b.owned.push(m);
  b.navMats.push(m);
  mesh(b, new THREE.SphereGeometry(r, 8, 8), m, x, y, z, parent);
}

function builder(H: number, pal: Palette): Builder {
  const group = new THREE.Group();
  group.name = 'playerShip';
  const hull = new THREE.Group();
  group.add(hull);
  // A soft fill riding above and behind the hull — where the chase camera
  // sits — so the airframe reads as a machine against black instead of a
  // silhouette whenever the Sun is on the far side.
  const fill = new THREE.PointLight(0xdfe9ff, 0.05, 80 * H, 1.4);
  fill.position.set(0, 7 * H, -9 * H);
  group.add(fill);
  return {
    hull, pal, H, glowTex: softSpriteTexture(),
    glowMats: [], glowSprites: [], plumes: [], rcs: [], navMats: [], owned: [...pal.owned],
  };
}

/** Every static mesh under `root` that shares a material is baked into one
 *  mesh — a hull of a hundred primitives becomes a dozen draw calls. Sprites,
 *  lights, empties and groups (the wing pivots) are left alone. */
function bakeStatic(root: THREE.Object3D) {
  const byMat = new Map<THREE.Material, { geoms: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    child.updateMatrix();
    const g = child.geometry.clone().applyMatrix4(child.matrix);
    let entry = byMat.get(child.material);
    if (!entry) {
      entry = { geoms: [], meshes: [] };
      byMat.set(child.material, entry);
    }
    entry.geoms.push(g);
    entry.meshes.push(child);
  }
  byMat.forEach((entry, mat) => {
    if (entry.meshes.length < 2) {
      for (const g of entry.geoms) g.dispose();
      return;
    }
    const merged = mergeGeometries(entry.geoms, false);
    for (const g of entry.geoms) g.dispose();
    if (!merged) return;
    for (const m of entry.meshes) {
      root.remove(m);
      m.geometry.dispose();
    }
    root.add(new THREE.Mesh(merged, mat));
  });
}

function finish(b: Builder, wings: WingPivot[], cannonTips: THREE.Object3D[], strobeMat: THREE.MeshBasicMaterial, length: number, plasmaZ: number): ShipParts {
  const H = b.H;
  bakeStatic(b.hull);
  for (const w of wings) bakeStatic(w.pivot);
  b.owned.push(strobeMat);
  const plasmaMat = new THREE.SpriteMaterial({
    map: b.glowTex, color: 0xff8a3a, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const plasma = new THREE.Sprite(plasmaMat);
  plasma.position.set(0, 0, plasmaZ);
  plasma.scale.setScalar(4 * H);
  b.hull.add(plasma);
  return {
    group: b.hull.parent as THREE.Group,
    hull: b.hull,
    wings,
    cannonTips,
    skinMat: b.pal.titanium,
    engineMat: b.pal.engineMat,
    bellMat: b.pal.bellMat,
    glowMats: b.glowMats,
    glowSprites: b.glowSprites,
    plumes: b.plumes,
    plumeMat: b.pal.plumeMat,
    plasmaMat,
    plasma,
    strobeMat,
    navMats: b.navMats,
    rcs: b.rcs,
    owned: b.owned,
    length,
  };
}

/** The standard eight-pod RCS fit: four on the nose ring, four aft, plus
 *  two forward-facing braking nozzles. Yaw right fires the port nose pod
 *  and the starboard tail pod; pitch and roll pair up the same way. */
function standardRcs(b: Builder, noseZ: number, tailZ: number, r: number) {
  const H = b.H;
  const px = new THREE.Vector3(1, 0, 0);
  const nx = new THREE.Vector3(-1, 0, 0);
  const py = new THREE.Vector3(0, 1, 0);
  const ny = new THREE.Vector3(0, -1, 0);
  // Nose ring. Port pod pushes the nose to starboard → right turn.
  rcsPod(b, r, 0, noseZ, px, { yaw: 1, roll: 0 });
  rcsPod(b, -r, 0, noseZ, nx, { yaw: -1 });
  rcsPod(b, 0, r, noseZ, py, { pitch: -1 });
  rcsPod(b, 0, -r, noseZ, ny, { pitch: 1 });
  // Tail ring — opposite sense, and the roll couple.
  rcsPod(b, r, 0, tailZ, px, { yaw: -1, roll: 0.6 });
  rcsPod(b, -r, 0, tailZ, nx, { yaw: 1, roll: -0.6 });
  rcsPod(b, 0, r, tailZ, py, { pitch: 1 });
  rcsPod(b, 0, -r, tailZ, ny, { pitch: -1 });
  // Braking nozzles on the nose cheeks, facing forward.
  const fz = new THREE.Vector3(0, 0, 1);
  rcsPod(b, 0.7 * r, -0.5 * r, noseZ + 0.6 * H, fz, { brake: 1 });
  rcsPod(b, -0.7 * r, -0.5 * r, noseZ + 0.6 * H, fz, { brake: 1 });
}

/**
 * Kestrel — the survey ship. A broad graphite fuselage with off-white
 * panel work along the spine and cheeks, a long low canopy, a sensor ball
 * and dish under the chin, two variable-sweep wings carrying the position
 * lights and the cannons, a pair of radiator fins aft, and a three-nozzle
 * engine cluster: one big central bell flanked by two smaller ones.
 */
export function buildKestrel(H: number): ShipParts {
  const pal = palette(0xffb347, 0x5fc8ff);
  const b = builder(H, pal);
  const hull = b.hull;

  // ── Fuselage: nose cone, forward section, mid body, engine block. ──
  const nose = mesh(b, new THREE.ConeGeometry(0.42 * H, 1.9 * H, 6), pal.titanium, 0, 0, 3.75 * H);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 6;
  mesh(b, hullSection(0.42 * H, 0.62 * H, 2.2 * H), pal.graphite, 0, 0, 1.7 * H);
  mesh(b, hullSection(0.62 * H, 0.72 * H, 2.6 * H), pal.graphite, 0, 0, -0.7 * H);
  const block = mesh(b, new THREE.BoxGeometry(1.7 * H, 0.9 * H, 1.5 * H), pal.dark, 0, -0.05 * H, -2.55 * H);
  block.rotation.z = 0;
  // Off-white structural panels: the spine and the two cheeks.
  mesh(b, new THREE.BoxGeometry(0.46 * H, 0.1 * H, 3.6 * H), pal.panel, 0, 0.62 * H, -0.2 * H);
  for (const s of [1, -1]) {
    const cheek = mesh(b, new THREE.BoxGeometry(0.12 * H, 0.42 * H, 2.0 * H), pal.panel, s * 0.62 * H, -0.1 * H, 0.9 * H);
    cheek.rotation.y = s * 0.08;
    // Panel breaks: a dark seam and a vent grille.
    mesh(b, new THREE.BoxGeometry(0.14 * H, 0.05 * H, 1.2 * H), pal.dark, s * 0.66 * H, 0.12 * H, -0.6 * H);
    for (let i = 0; i < 4; i++) {
      mesh(b, new THREE.BoxGeometry(0.1 * H, 0.03 * H, 0.16 * H), pal.dark, s * 0.72 * H, -0.28 * H, -1.5 * H - i * 0.24 * H);
    }
  }
  // Amber flight stripe along the spine and the wing roots.
  mesh(b, new THREE.BoxGeometry(0.1 * H, 0.03 * H, 2.4 * H), pal.accent, 0, 0.69 * H, 0.2 * H);

  // ── Canopy: long and low, set into a dark coaming. ──
  mesh(b, new THREE.BoxGeometry(0.62 * H, 0.22 * H, 1.5 * H), pal.dark, 0, 0.5 * H, 1.6 * H);
  const canopy = mesh(b, new THREE.SphereGeometry(0.32 * H, 16, 12), pal.glass, 0, 0.58 * H, 1.65 * H);
  canopy.scale.set(0.9, 0.55, 2.3);
  // Canopy frame rails.
  for (const s of [1, -1]) {
    mesh(b, new THREE.BoxGeometry(0.03 * H, 0.16 * H, 1.3 * H), pal.titanium, s * 0.27 * H, 0.62 * H, 1.6 * H);
  }

  // ── Sensor package: chin ball, dish, and an antenna mast. ──
  mesh(b, new THREE.SphereGeometry(0.2 * H, 12, 10), pal.dark, 0, -0.42 * H, 2.4 * H);
  const dish = mesh(b, new THREE.CylinderGeometry(0.02 * H, 0.26 * H, 0.1 * H, 14, 1, true), pal.panel, 0, -0.52 * H, 2.1 * H);
  dish.rotation.x = -Math.PI / 2 + 0.5;
  mesh(b, new THREE.CylinderGeometry(0.015 * H, 0.02 * H, 0.9 * H, 6), pal.dark, 0.28 * H, 0.6 * H, -1.2 * H);
  // Sensor tip on the nose.
  mesh(b, new THREE.SphereGeometry(0.06 * H, 8, 8), pal.dark, 0, 0, 4.72 * H);

  // ── Wings: variable sweep on pivots at the mid body. Each carries a
  // cannon under the root, a pod and the position light at the tip. ──
  const wings: WingPivot[] = [];
  const cannonTips: THREE.Object3D[] = [];
  const cannonGeom = new THREE.CylinderGeometry(0.05 * H, 0.065 * H, 1.6 * H, 8);
  const wingGeoms = { 1: wingPanel(1, 1.5 * H, 0.5 * H, 3.0 * H, 0.09 * H), [-1]: wingPanel(-1, 1.5 * H, 0.5 * H, 3.0 * H, 0.09 * H) };
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.6 * H, -0.02 * H, -0.5 * H);
    hull.add(pivot);
    wings.push({ pivot, side: s, open: s * 0.12, closed: s * 0.62 });
    mesh(b, wingGeoms[s as 1 | -1], pal.titanium, 0, 0, 0, pivot);
    // Leading-edge strip in panel white, amber tip cap.
    const le = mesh(b, new THREE.BoxGeometry(2.9 * H, 0.06 * H, 0.14 * H), pal.panel, s * 1.5 * H, 0.03 * H, 0.65 * H, pivot);
    le.rotation.y = -s * 0.07;
    mesh(b, new THREE.BoxGeometry(0.12 * H, 0.1 * H, 0.5 * H), pal.accent, s * 2.98 * H, 0, -0.15 * H, pivot);
    // Wingtip pod with the position light.
    const pod = mesh(b, new THREE.CylinderGeometry(0.1 * H, 0.08 * H, 0.9 * H, 10), pal.graphite, s * 2.9 * H, 0, 0, pivot);
    pod.rotation.x = Math.PI / 2;
    navLight(b, s * 2.9 * H, 0, 0.5 * H, s > 0 ? 0xff3b30 : 0x30ff6a, 0.08 * H, pivot);
    // Cannon under the wing root.
    const cannon = mesh(b, cannonGeom, pal.dark, s * 0.75 * H, -0.18 * H, 0.9 * H, pivot);
    cannon.rotation.x = Math.PI / 2;
    const tip = new THREE.Object3D();
    tip.position.set(s * 0.75 * H, -0.18 * H, 1.8 * H);
    pivot.add(tip);
    cannonTips.push(tip);
  }

  // ── Radiators: two thin fins aft, white with an amber hot edge. ──
  for (const s of [1, -1]) {
    const fin = mesh(b, new THREE.BoxGeometry(0.05 * H, 0.9 * H, 1.1 * H), pal.panel, s * 0.42 * H, 0.75 * H, -2.3 * H);
    fin.rotation.z = s * 0.28;
    fin.rotation.x = 0.12;
    const edge = mesh(b, new THREE.BoxGeometry(0.06 * H, 0.06 * H, 1.0 * H), pal.accent, s * 0.55 * H, 1.16 * H, -2.35 * H);
    edge.rotation.z = s * 0.28;
    edge.rotation.x = 0.12;
  }

  // ── Engine cluster: one big central bell, two smaller outboard. ──
  engine(b, 0, 0.02 * H, -3.3 * H, 0.42 * H, 4.2 * H);
  engine(b, 0.62 * H, -0.12 * H, -3.2 * H, 0.24 * H, 2.8 * H);
  engine(b, -0.62 * H, -0.12 * H, -3.2 * H, 0.24 * H, 2.8 * H);

  // ── RCS, lights. ──
  standardRcs(b, 2.6 * H, -2.2 * H, 0.5 * H);
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mesh(b, new THREE.SphereGeometry(0.07 * H, 8, 8), strobeMat, 0, 0.7 * H, -2.9 * H);
  navLight(b, 0, -0.5 * H, -1.4 * H, 0xffb347, 0.06 * H);
  return finish(b, wings, cannonTips, strobeMat, 8 * H, 3.8 * H);
}

/**
 * Lance — the interceptor. A narrow needle fuselage with a raised spine,
 * canards forward, two close-set nacelles each on a stub pylon, small
 * hard-swept wings off the nacelles, ice-blue accents, and a single big
 * engine between the nacelles.
 */
export function buildLance(H: number): ShipParts {
  const pal = palette(0x7fd8ff, 0x8fd4ff);
  const b = builder(H, pal);
  const hull = b.hull;

  const nose = mesh(b, new THREE.ConeGeometry(0.34 * H, 2.8 * H, 6), pal.titanium, 0, 0, 4.0 * H);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 6;
  mesh(b, hullSection(0.34 * H, 0.5 * H, 3.0 * H), pal.graphite, 0, 0, 1.1 * H);
  mesh(b, hullSection(0.5 * H, 0.46 * H, 2.4 * H), pal.graphite, 0, 0, -1.6 * H);
  mesh(b, new THREE.BoxGeometry(0.34 * H, 0.14 * H, 3.4 * H), pal.panel, 0, 0.5 * H, -0.6 * H);
  mesh(b, new THREE.BoxGeometry(0.08 * H, 0.03 * H, 2.6 * H), pal.accent, 0, 0.58 * H, -0.4 * H);
  mesh(b, new THREE.BoxGeometry(0.5 * H, 0.18 * H, 3.0 * H), pal.dark, 0, -0.42 * H, -0.2 * H);
  // Probe on the nose.
  mesh(b, new THREE.CylinderGeometry(0.02 * H, 0.04 * H, 1.1 * H, 6), pal.dark, 0, 0, 5.8 * H).rotation.x = Math.PI / 2;

  // Canopy: a narrow blister well forward.
  mesh(b, new THREE.BoxGeometry(0.5 * H, 0.2 * H, 1.6 * H), pal.dark, 0, 0.36 * H, 1.6 * H);
  const canopy = mesh(b, new THREE.SphereGeometry(0.26 * H, 16, 12), pal.glass, 0, 0.46 * H, 1.6 * H);
  canopy.scale.set(0.9, 0.6, 2.6);

  // Sensor package: a flat array under the chin.
  mesh(b, new THREE.BoxGeometry(0.4 * H, 0.08 * H, 0.6 * H), pal.dark, 0, -0.34 * H, 2.6 * H);
  mesh(b, new THREE.SphereGeometry(0.11 * H, 10, 8), pal.dark, 0, -0.4 * H, 2.95 * H);

  // Canards.
  for (const s of [1, -1]) {
    const c = mesh(b, new THREE.BoxGeometry(1.1 * H, 0.05 * H, 0.5 * H), pal.titanium, s * 0.8 * H, 0, 2.6 * H);
    c.rotation.y = s * 0.55;
    c.rotation.z = -s * 0.12;
  }

  // Nacelles on pylons, wings swept off them, chin cannons.
  const wings: WingPivot[] = [];
  const cannonTips: THREE.Object3D[] = [];
  const NX = 1.05 * H;
  const wingGeoms = { 1: wingPanel(1, 1.2 * H, 0.35 * H, 2.2 * H, 0.08 * H), [-1]: wingPanel(-1, 1.2 * H, 0.35 * H, 2.2 * H, 0.08 * H) };
  for (const s of [1, -1]) {
    const px = s * NX;
    mesh(b, new THREE.BoxGeometry(0.7 * H, 0.16 * H, 1.6 * H), pal.titanium, s * 0.7 * H, -0.06 * H, -0.5 * H);
    const nac = mesh(b, new THREE.CylinderGeometry(0.44 * H, 0.4 * H, 3.6 * H, 14), pal.graphite, px, -0.08 * H, -1.0 * H);
    nac.rotation.x = Math.PI / 2;
    const intake = mesh(b, new THREE.CylinderGeometry(0.46 * H, 0.46 * H, 0.3 * H, 14, 1, true), pal.dark, px, -0.08 * H, 0.85 * H);
    intake.rotation.x = Math.PI / 2;
    // Ice-blue flash on the nacelle shoulder and a white panel strip.
    mesh(b, new THREE.BoxGeometry(0.14 * H, 0.3 * H, 1.3 * H), pal.accent, px + s * 0.4 * H, 0.08 * H, 0, hull);
    mesh(b, new THREE.BoxGeometry(0.16 * H, 0.06 * H, 2.2 * H), pal.panel, px, 0.42 * H, -0.8 * H);
    const pivot = new THREE.Group();
    pivot.position.set(px + s * 0.3 * H, -0.04 * H, -0.9 * H);
    hull.add(pivot);
    wings.push({ pivot, side: s, open: s * 0.3, closed: s * 0.75 });
    mesh(b, wingGeoms[s as 1 | -1], pal.titanium, 0, 0, 0, pivot);
    const pod = mesh(b, new THREE.CylinderGeometry(0.09 * H, 0.07 * H, 0.8 * H, 10), pal.graphite, s * 2.15 * H, 0, 0, pivot);
    pod.rotation.x = Math.PI / 2;
    navLight(b, s * 2.15 * H, 0, 0.45 * H, s > 0 ? 0xff3b30 : 0x30ff6a, 0.08 * H, pivot);
    engine(b, px, -0.08 * H, -2.85 * H, 0.32 * H, 3.6 * H);
    // Chin cannon.
    const cannon = mesh(b, new THREE.CylinderGeometry(0.05 * H, 0.06 * H, 2.0 * H, 8), pal.dark, s * 0.32 * H, -0.3 * H, 2.2 * H);
    cannon.rotation.x = Math.PI / 2;
    const tip = new THREE.Object3D();
    tip.position.set(s * 0.32 * H, -0.3 * H, 3.3 * H);
    hull.add(tip);
    cannonTips.push(tip);
  }
  // Central drive between the nacelles, and twin tail fins.
  engine(b, 0, 0.05 * H, -2.9 * H, 0.3 * H, 4.4 * H);
  for (const s of [1, -1]) {
    const fin = mesh(b, new THREE.BoxGeometry(0.05 * H, 0.8 * H, 1.0 * H), pal.panel, s * 0.3 * H, 0.7 * H, -2.0 * H);
    fin.rotation.z = s * 0.4;
    fin.rotation.x = 0.2;
    const edge = mesh(b, new THREE.BoxGeometry(0.06 * H, 0.05 * H, 0.9 * H), pal.accent, s * 0.55 * H, 1.03 * H, -2.05 * H);
    edge.rotation.z = s * 0.4;
    edge.rotation.x = 0.2;
  }

  standardRcs(b, 2.4 * H, -2.0 * H, 0.42 * H);
  const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mesh(b, new THREE.SphereGeometry(0.07 * H, 8, 8), strobeMat, 0, 0.6 * H, -2.5 * H);
  navLight(b, 0, -0.5 * H, -1.0 * H, 0x7fd8ff, 0.06 * H);
  return finish(b, wings, cannonTips, strobeMat, 9 * H, 4.6 * H);
}

/**
 * The suit: a white hard-upper-torso EVA suit with a gold visor, the life
 * support pack on the back, red mission stripes, a chest display and the
 * SAFER jet pack whose nozzles glow when it fires. Head is +Y, forward +Z.
 * `E` is the suit's own unit.
 */
export function buildCosmonaut(E: number): ShipParts {
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
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.75 });
  const owned: THREE.Material[] = [skinMat, grey, red, visor, display, engineMat, bellMat];

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34 * E, 0.5 * E, 6, 12), skinMat);
  hull.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3 * E, 16, 12), skinMat);
  helmet.position.set(0, 0.7 * E, 0);
  hull.add(helmet);
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.22 * E, 16, 12), visor);
  vis.scale.set(1, 0.85, 0.7);
  vis.position.set(0, 0.7 * E, 0.16 * E);
  hull.add(vis);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * E, 0.24 * E, 0.07 * E, 14), grey);
  ring.position.set(0, 0.46 * E, 0);
  hull.add(ring);
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
  return {
    group, hull, wings: [], cannonTips: [], skinMat, engineMat, bellMat, glowMats, glowSprites,
    plumes: [], plumeMat: null, plasmaMat, plasma, strobeMat, navMats: [], rcs: [], owned, length: 2.6 * E,
  };
}
