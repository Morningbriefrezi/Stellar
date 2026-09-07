// Galactic-tier scene extras for SolarSystemCanvas.
// Builds three additive layers visible only when the user zooms way out:
//   1) NearbyStars  — bright named stars at real RA/Dec, distance-scaled.
//   2) MilkyWay     — tilted spiral-disk mesh + halo + faint disc sprinkle.
//                     The Sun sits offset from galactic centre inside the disk.
//   3) OtherGalaxies — distant galaxy sprites (M31, M33, LMC/SMC, M51, M104).
// All groups expose `update(zoomFactor, dt)` so the canvas loop can drive a
// smooth fade-in/out as `sysRadius` grows past the solar-system tier.

import * as THREE from 'three';

const PC_TO_UNIT = 22;       // 1 parsec → 22 scene units (compressed for visual cohesion)
const NEAR_STAR_MAX_R = 2600; // visual clamp so very distant catalog stars stay in view

export interface NearbyStarRow {
  id: string;
  name: string;
  ra: number;        // hours
  dec: number;       // degrees
  pc: number;        // parsecs (Hipparcos/Gaia)
  mag: number;       // apparent V magnitude
  spectral: 'O'|'B'|'A'|'F'|'G'|'K'|'M';
  /** Confirmed exoplanets in the system (omitted = none known). */
  planets?: number;
}

/**
 * Bright-star roster + the real nearest star systems and famous planet
 * hosts — every entry has a Hipparcos/Gaia-grade distance, and planet
 * counts stick to confirmed detections.
 */
export const NEARBY_STARS: NearbyStarRow[] = [
  { id: 'sirius',     name: 'Sirius',         ra: 6.752,  dec: -16.716, pc: 2.64,  mag: -1.46, spectral: 'A' },
  { id: 'canopus',    name: 'Canopus',        ra: 6.399,  dec: -52.696, pc: 95,    mag: -0.74, spectral: 'F' },
  { id: 'rigil',      name: 'Alpha Centauri', ra: 14.660, dec: -60.834, pc: 1.34,  mag: -0.27, spectral: 'G', planets: 3 },
  { id: 'arcturus',   name: 'Arcturus',       ra: 14.261, dec:  19.182, pc: 11.26, mag: -0.05, spectral: 'K' },
  { id: 'vega',       name: 'Vega',           ra: 18.616, dec:  38.784, pc: 7.68,  mag:  0.03, spectral: 'A' },
  { id: 'capella',    name: 'Capella',        ra: 5.278,  dec:  45.998, pc: 13.13, mag:  0.08, spectral: 'G' },
  { id: 'rigel',      name: 'Rigel',          ra: 5.243,  dec:  -8.202, pc: 264,   mag:  0.13, spectral: 'B' },
  { id: 'procyon',    name: 'Procyon',        ra: 7.655,  dec:   5.225, pc: 3.51,  mag:  0.34, spectral: 'F' },
  { id: 'achernar',   name: 'Achernar',       ra: 1.629,  dec: -57.237, pc: 42.7,  mag:  0.46, spectral: 'B' },
  { id: 'betelgeuse', name: 'Betelgeuse',     ra: 5.919,  dec:   7.407, pc: 168,   mag:  0.50, spectral: 'M' },
  { id: 'hadar',      name: 'Hadar',          ra: 14.064, dec: -60.373, pc: 119,   mag:  0.61, spectral: 'B' },
  { id: 'altair',     name: 'Altair',         ra: 19.846, dec:   8.868, pc: 5.13,  mag:  0.77, spectral: 'A' },
  { id: 'aldebaran',  name: 'Aldebaran',      ra: 4.598,  dec:  16.509, pc: 20.43, mag:  0.85, spectral: 'K' },
  { id: 'antares',    name: 'Antares',        ra: 16.490, dec: -26.432, pc: 169,   mag:  0.96, spectral: 'M' },
  { id: 'spica',      name: 'Spica',          ra: 13.420, dec: -11.161, pc: 78,    mag:  0.98, spectral: 'B' },
  { id: 'pollux',     name: 'Pollux',         ra: 7.755,  dec:  28.026, pc: 10.34, mag:  1.14, spectral: 'K', planets: 1 },
  { id: 'fomalhaut',  name: 'Fomalhaut',      ra: 22.961, dec: -29.622, pc: 7.7,   mag:  1.16, spectral: 'A' },
  { id: 'deneb',      name: 'Deneb',          ra: 20.690, dec:  45.280, pc: 802,   mag:  1.25, spectral: 'A' },
  { id: 'regulus',    name: 'Regulus',        ra: 10.139, dec:  11.967, pc: 24.31, mag:  1.40, spectral: 'B' },
  { id: 'castor',     name: 'Castor',         ra: 7.577,  dec:  31.888, pc: 15.6,  mag:  1.58, spectral: 'A' },
  { id: 'polaris',    name: 'Polaris',        ra: 2.530,  dec:  89.260, pc: 132,   mag:  1.97, spectral: 'F' },
  // The true nearest systems — dim red dwarfs the bright-star list skips.
  { id: 'barnard',    name: "Barnard's Star", ra: 17.963, dec:   4.693, pc: 1.83,  mag:  9.51, spectral: 'M', planets: 4 },
  { id: 'wolf359',    name: 'Wolf 359',       ra: 10.941, dec:   7.014, pc: 2.41,  mag: 13.54, spectral: 'M' },
  { id: 'lalande',    name: 'Lalande 21185',  ra: 11.055, dec:  35.970, pc: 2.55,  mag:  7.52, spectral: 'M', planets: 2 },
  { id: 'epseri',     name: 'Epsilon Eridani', ra: 3.549, dec:  -9.458, pc: 3.22,  mag:  3.73, spectral: 'K', planets: 1 },
  { id: 'tauceti',    name: 'Tau Ceti',       ra: 1.734,  dec: -15.937, pc: 3.65,  mag:  3.50, spectral: 'G', planets: 4 },
  { id: 'epsindi',    name: 'Epsilon Indi',   ra: 22.055, dec: -56.786, pc: 3.64,  mag:  4.69, spectral: 'K', planets: 1 },
  { id: 'cyg61',      name: '61 Cygni',       ra: 21.115, dec:  38.749, pc: 3.50,  mag:  5.21, spectral: 'K' },
  // Famous planetary systems a bit farther out.
  { id: 'gliese581',  name: 'Gliese 581',     ra: 15.323, dec:  -7.722, pc: 6.30,  mag: 10.57, spectral: 'M', planets: 3 },
  { id: 'trappist1',  name: 'TRAPPIST-1',     ra: 23.108, dec:  -5.041, pc: 12.47, mag: 18.80, spectral: 'M', planets: 7 },
  { id: 'peg51',      name: '51 Pegasi',      ra: 22.958, dec:  20.769, pc: 15.47, mag:  5.49, spectral: 'G', planets: 1 },
  { id: 'kepler90',   name: 'Kepler-90',      ra: 18.963, dec:  49.306, pc: 855,   mag: 14.0,  spectral: 'G', planets: 8 },
];

const SPECTRAL_RGB: Record<NearbyStarRow['spectral'], [number, number, number]> = {
  O: [0.64, 0.77, 1.00],
  B: [0.72, 0.82, 1.00],
  A: [0.87, 0.91, 1.00],
  F: [0.99, 0.97, 0.92],
  G: [1.00, 0.95, 0.78],
  K: [1.00, 0.78, 0.58],
  M: [1.00, 0.55, 0.34],
};

function raDecPcToVec(ra: number, dec: number, pc: number): THREE.Vector3 {
  const raRad = (ra / 24) * Math.PI * 2;
  const decRad = (dec / 180) * Math.PI;
  const dist = Math.min(pc * PC_TO_UNIT, NEAR_STAR_MAX_R);
  const x = dist * Math.cos(decRad) * Math.cos(raRad);
  const z = dist * Math.cos(decRad) * Math.sin(raRad);
  const y = dist * Math.sin(decRad);
  return new THREE.Vector3(x, y, z);
}

/** Scene position of a catalogue star by id, in the same frame the
 *  nearby-stars layer draws it — null for an unknown id. */
export function nearbyStarPosition(id: string): THREE.Vector3 | null {
  const star = NEARBY_STARS.find((s) => s.id === id);
  return star ? raDecPcToVec(star.ra, star.dec, star.pc) : null;
}

/* ───────────────────────── nearby stars layer ───────────────────────── */

export interface NearbyStarsHandle {
  group: THREE.Group;
  positions: Map<string, THREE.Vector3>;
  /** `labelFade` defaults to `fade`; pass a lower value to hide the catalog
   *  labels while keeping the stars (e.g. once the galactic tier takes over). */
  setFade: (fade: number, labelFade?: number) => void;
  dispose: () => void;
}

export function makeNearbyStars(lite: boolean): NearbyStarsHandle {
  const group = new THREE.Group();
  group.name = 'galactic.nearbyStars';

  const sprite = softStarSprite();

  // Named stars — each its own sprite, carrying a catalog label with the
  // real distance and, where the system has them, its confirmed planet
  // count. Zooming out of the solar system introduces the actual stellar
  // neighbourhood: Barnard's four worlds, TRAPPIST-1's seven, and so on.
  const positions = new Map<string, THREE.Vector3>();
  const coreSprite = starCoreSprite();
  const namedMats: THREE.SpriteMaterial[] = [];
  const labelMats: THREE.SpriteMaterial[] = [];
  const labelTextures: THREE.CanvasTexture[] = [];
  for (const star of NEARBY_STARS) {
    const pos = raDecPcToVec(star.ra, star.dec, star.pc);
    positions.set(star.id, pos.clone());
    const [r, g, b] = SPECTRAL_RGB[star.spectral];
    const mat = new THREE.SpriteMaterial({
      map: coreSprite,
      color: new THREE.Color(r, g, b),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(pos);
    // Apparent brightness — brighter (lower mag) gets a larger sprite. Kept
    // small: a star is a point with a halo, not a fog ball.
    const apparent = THREE.MathUtils.clamp(1.8 - star.mag * 0.6, 0.4, 3.0);
    spr.scale.setScalar(6 + apparent * 2.6);
    group.add(spr);
    namedMats.push(mat);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 170;
    const ctx = canvas.getContext('2d')!;
    ctx.textBaseline = 'middle';
    ctx.font = '500 44px "JetBrains Mono", "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(212,224,244,0.92)';
    ctx.fillText(star.name.toUpperCase(), 10, 52);
    const ly = star.pc * 3.2616;
    const info = ly >= 100 ? `${Math.round(ly)} LY` : `${ly.toFixed(1)} LY`;
    ctx.font = '500 32px "JetBrains Mono", "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(142,162,198,0.85)';
    const planetTag = star.planets === 1 ? '1 PLANET' : `${star.planets} PLANETS`;
    ctx.fillText(star.planets ? `${info} · ${planetTag}` : info, 10, 118);
    const labelTex = new THREE.CanvasTexture(canvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const labelMat = new THREE.SpriteMaterial({
      map: labelTex, transparent: true, opacity: 0, depthWrite: false,
    });
    const label = new THREE.Sprite(labelMat);
    // Scale with distance so labels stay a readable size across the layer.
    const s = 6 + pos.length() * 0.042;
    label.scale.set(s * 3, s, 1);
    label.center.set(-0.1, 0.5); // sits just right of the star's glow
    label.position.copy(pos);
    group.add(label);
    labelMats.push(labelMat);
    labelTextures.push(labelTex);
  }

  // Background field stars filling the rest of the celestial sphere — they
  // give the deep-space backdrop a real density without overpowering the
  // named stars. Count is modest because they're rendered as Points with
  // a softer sprite, not full sprites.
  const fieldN = lite ? 4500 : 12000;
  const fieldPos = new Float32Array(fieldN * 3);
  const fieldCol = new Float32Array(fieldN * 3);
  for (let i = 0; i < fieldN; i++) {
    const u = Math.random();
    const v = Math.random();
    const t = 2 * Math.PI * u;
    const p = Math.acos(2 * v - 1);
    const r = 800 + Math.random() * 1900;
    fieldPos[i * 3] = r * Math.sin(p) * Math.cos(t);
    fieldPos[i * 3 + 1] = r * Math.sin(p) * Math.sin(t);
    fieldPos[i * 3 + 2] = r * Math.cos(p);
    const sp = pickFieldSpectral();
    const c = 0.45 + Math.random() * 0.55;
    fieldCol[i * 3] = sp[0] * c;
    fieldCol[i * 3 + 1] = sp[1] * c;
    fieldCol[i * 3 + 2] = sp[2] * c;
  }
  const fieldGeo = new THREE.BufferGeometry();
  fieldGeo.setAttribute('position', new THREE.BufferAttribute(fieldPos, 3));
  fieldGeo.setAttribute('color', new THREE.BufferAttribute(fieldCol, 3));
  const fieldMat = new THREE.PointsMaterial({
    map: sprite,
    size: lite ? 5 : 4,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    alphaTest: 0.02,
  });
  const field = new THREE.Points(fieldGeo, fieldMat);
  group.add(field);

  const setFade = (fade: number, labelFade?: number) => {
    const f = THREE.MathUtils.clamp(fade, 0, 1);
    const lf = THREE.MathUtils.clamp(labelFade ?? fade, 0, 1);
    for (const m of namedMats) m.opacity = f;
    for (const m of labelMats) m.opacity = lf * 0.85;
    fieldMat.opacity = f * 0.72;
    group.visible = f > 0.005;
  };

  return {
    group,
    positions,
    setFade,
    dispose: () => {
      for (const m of namedMats) m.dispose();
      for (const m of labelMats) m.dispose();
      for (const t of labelTextures) t.dispose();
      coreSprite.dispose();
      sprite.dispose();
      fieldGeo.dispose();
      fieldMat.dispose();
    },
  };
}

function pickFieldSpectral(): [number, number, number] {
  const r = Math.random();
  if (r < 0.04) return [0.66, 0.78, 1.00];   // B
  if (r < 0.14) return [0.84, 0.90, 1.00];   // A
  if (r < 0.32) return [0.98, 0.98, 1.00];   // F
  if (r < 0.50) return [1.00, 0.96, 0.84];   // G
  if (r < 0.75) return [1.00, 0.86, 0.66];   // K
  return [1.00, 0.70, 0.52];                 // M
}

/** Tight stellar profile — hot pinpoint core, small halo. The broad soft
 *  sprite reads as fog when a star is viewed from the stellar tier. */
function starCoreSprite(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.07, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.34, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softStarSprite(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0,    'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.86)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1.0,  'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ─────────────────── shared barred-spiral galaxy model ─────────────────── */

/**
 * A galaxy's structure, in the terms astronomers describe one: how tightly the
 * arms wind, how many there are, how long the bar is, where the star-forming
 * ring sits. Both the painted disk texture and the 3D star volume are built
 * from the same model so the glow and the resolved stars trace the same arms —
 * drawn from two unrelated formulas, as they were, they cancelled into mush.
 */
interface SpiralModel {
  /** Log-spiral pitch angle. The Milky Way winds at ~14°, Andromeda's Sb disk
   *  at ~8.5° — that difference, plus M31's much higher inclination, is most
   *  of why the two read as different galaxies and not the same one twice. */
  pitchDeg: number;
  arms: number;
  /** Relative surface brightness per arm. The Milky Way has two major arms
   *  (Perseus, Scutum–Centaurus) and two minor ones between them. */
  armWeight: number[];
  /** Central bar half-length as a fraction of the disk radius, and its angle. */
  barFraction: number;
  barAngleDeg: number;
  /** Bulge radius as a fraction of the disk radius. */
  bulge: number;
  /** Fraction of stars belonging to the bulge rather than the disk. */
  bulgeShare: number;
  /** Star-forming annulus radius (Andromeda's 10 kpc "ring of fire"). */
  ringAt?: number;
  hiiChance: number;
}

/** Milky Way: SBbc, four arms off a bar inclined ~27° to the Sun–centre line. */
const MILKY_WAY_MODEL: SpiralModel = {
  pitchDeg: 14,
  arms: 4,
  // Perseus and Scutum–Centaurus carry most of the light; Sagittarius–Carina
  // and Norma are the minor pair between them.
  armWeight: [1, 0.35, 1, 0.35],
  barFraction: 0.2,
  barAngleDeg: 27,
  bulge: 0.13,
  bulgeShare: 0.16,
  hiiChance: 0.05,
};

/** Andromeda: Sb, tightly wound, big bulge, and the 10 kpc star-forming ring
 *  that dominates every infrared image of it. */
const ANDROMEDA_MODEL: SpiralModel = {
  pitchDeg: 8.5,
  arms: 2,
  armWeight: [1, 0.9],
  barFraction: 0.05,
  barAngleDeg: 0,
  bulge: 0.19,
  bulgeShare: 0.24,
  ringAt: 0.64,
  hiiChance: 0.06,
};

/** Ridge longitude of arm `i` at radius `r`: the log spiral θ = θ₀ + ln(r/r₀)·cot(p). */
function armLongitude(m: SpiralModel, arm: number, r: number, R: number): number {
  const cot = 1 / Math.tan(THREE.MathUtils.degToRad(m.pitchDeg));
  return (arm * Math.PI * 2) / m.arms + Math.log(Math.max(r, R * 0.06) / (R * 0.18)) * cot;
}

function pickArm(m: SpiralModel): number {
  const total = m.armWeight.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < m.armWeight.length; i++) {
    roll -= m.armWeight[i];
    if (roll <= 0) return i;
  }
  return 0;
}

/** Sum of three uniforms — a cheap gaussian, mean 0, range ±1.5. */
function gauss(): number {
  return Math.random() + Math.random() + Math.random() - 1.5;
}

/**
 * Star sampler for a barred spiral centred on the origin in the XZ plane:
 * an exponential disk, log-spiral arm density waves, a central bar, a spheroidal
 * bulge, a thin vertical profile that flares outward, and population colouring
 * (warm old bulge, blue OB associations on the arm ridges, pink HII knots,
 * yellow inter-arm disk).
 */
function sampleSpiralStars(
  starN: number,
  R: number,
  m: SpiralModel,
): { pos: Float32Array; col: Float32Array } {
  const Rd = R * 0.3;
  const thin = R * 0.011;
  const pos = new Float32Array(starN * 3);
  const col = new Float32Array(starN * 3);
  const barAngle = THREE.MathUtils.degToRad(m.barAngleDeg);
  for (let i = 0; i < starN; i++) {
    let x: number;
    let y: number;
    let z: number;
    let cr: number;
    let cg: number;
    let cb: number;

    if (Math.random() < m.bulgeShare) {
      // Spheroidal bulge — old, metal-rich, warm. Flattened along the pole.
      const u = Math.random();
      const v = Math.random();
      const t = 2 * Math.PI * u;
      const p = Math.acos(2 * v - 1);
      const r = Math.pow(Math.random(), 1.9) * R * m.bulge;
      x = r * Math.sin(p) * Math.cos(t);
      z = r * Math.sin(p) * Math.sin(t);
      y = r * Math.cos(p) * 0.62;
      cr = 1.0; cg = 0.80; cb = 0.55;
    } else {
      const r = Math.min(-Rd * Math.log(Math.random() * Math.random() + 1e-6) * 0.5, R * 0.99);
      const rNorm = r / R;
      const inBar = r < R * m.barFraction;
      let theta = Math.random() * Math.PI * 2;
      let onArm = false;
      const inRing = m.ringAt != null && Math.abs(rNorm - m.ringAt) < 0.06;

      if (inBar) {
        // Bar stars sit along a thin, straight rod through the centre.
        theta = barAngle + (Math.random() < 0.5 ? 0 : Math.PI) + gauss() * 0.22;
      } else if (Math.random() < 0.62) {
        const arm = pickArm(m);
        // Arm width grows with radius, so the outer arms dissolve naturally.
        const sigma = 0.10 + 0.45 * rNorm;
        const scatter = gauss() * sigma;
        theta = armLongitude(m, arm, r, R) + scatter;
        onArm = Math.abs(scatter) < sigma * 0.55;
      }

      x = Math.cos(theta) * r;
      z = Math.sin(theta) * r;
      if (inBar) {
        // Squash across the bar's long axis so it reads as a bar, not a disk.
        const bx = x * Math.cos(-barAngle) - z * Math.sin(-barAngle);
        const bz = (x * Math.sin(-barAngle) + z * Math.cos(-barAngle)) * 0.32;
        x = bx * Math.cos(barAngle) - bz * Math.sin(barAngle);
        z = bx * Math.sin(barAngle) + bz * Math.cos(barAngle);
      }
      const h = thin * (1 + rNorm * 2.4);
      y = (gauss() + gauss()) * 0.45 * h;

      if (inBar) {
        cr = 1.0; cg = 0.83; cb = 0.58;
      } else if ((onArm || inRing) && Math.random() < m.hiiChance) {
        cr = 1.0; cg = 0.52; cb = 0.62;                     // HII star-forming knot
      } else if (onArm || inRing) {
        cr = 0.70; cg = 0.81; cb = 1.0;                     // young OB association
      } else {
        cr = 1.0; cg = 0.91; cb = 0.72;                     // inter-arm disk
      }
    }

    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    // Power-law luminosity: a handful of bright stars over a faint majority.
    // A flat spread makes every point equal and the whole disk reads as grit.
    const lum = 0.14 + 0.86 * Math.pow(Math.random(), 2.4);
    col[i * 3] = cr * lum;
    col[i * 3 + 1] = cg * lum;
    col[i * 3 + 2] = cb * lum;
  }
  return { pos, col };
}

/**
 * The painted disk under the star volume: bulge, bar, arm splats, blue arm
 * ridges, pink HII, and dark dust lanes multiplied along the inner edge of
 * every arm — the lanes are what make a rendered spiral read as photographic
 * rather than as a swirl of dots.
 */
function spiralGalaxyTexture(m: SpiralModel, lite: boolean, size = 2048): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const mid = size / 2;
  const R = size * 0.47;
  const barAngle = THREE.MathUtils.degToRad(m.barAngleDeg);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  const toCanvas = (r: number, theta: number): [number, number] => [
    mid + Math.cos(theta) * r,
    mid + Math.sin(theta) * r,
  ];

  // Bulge — the luminous heart, warm and steeply peaked.
  const bulgeR = R * (m.bulge * 2.6);
  const bg = ctx.createRadialGradient(mid, mid, 0, mid, mid, bulgeR);
  bg.addColorStop(0, 'rgba(255,246,222,0.98)');
  bg.addColorStop(0.08, 'rgba(255,226,168,0.82)');
  bg.addColorStop(0.26, 'rgba(255,186,104,0.34)');
  bg.addColorStop(0.6, 'rgba(180,168,190,0.09)');
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Bar — an elongated glow through the centre at its real position angle.
  if (m.barFraction > 0.08) {
    ctx.save();
    ctx.translate(mid, mid);
    ctx.rotate(barAngle);
    ctx.scale(1, 0.3);
    const barR = R * m.barFraction * 1.5;
    const barGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, barR);
    barGrad.addColorStop(0, 'rgba(255,232,182,0.72)');
    barGrad.addColorStop(0.55, 'rgba(255,204,132,0.30)');
    barGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = barGrad;
    ctx.fillRect(-barR, -barR, barR * 2, barR * 2);
    ctx.restore();
  }

  // Arm splats. Radius is drawn from an exponential disk so the arms are
  // dense where the galaxy is bright, and each splat's own scatter widens
  // outward, which is what gives the arms their frayed outer ends.
  const armSplats = lite ? 22000 : 62000;
  for (let i = 0; i < armSplats; i++) {
    const arm = pickArm(m);
    const rNorm = Math.min(0.99, 0.1 + Math.pow(Math.random(), 0.62) * 0.92);
    const r = rNorm * R;
    const sigma = (0.09 + 0.4 * rNorm) * 0.55;
    const scatter = gauss() * sigma;
    const theta = armLongitude(m, arm, r, R) + scatter;
    const [x, y] = toCanvas(r, theta);
    const ridge = Math.abs(scatter) < sigma * 0.5;
    const fade = 1 - rNorm * 0.72;
    if (ridge && Math.random() < 0.34) {
      // Young blue stars trace the ridge line itself.
      ctx.fillStyle = `rgba(178,206,255,${0.36 * fade + 0.05})`;
    } else {
      const warm = Math.floor(214 - 40 * rNorm);
      ctx.fillStyle = `rgba(${warm + 26},${warm},${Math.floor(170 + 60 * rNorm)},${0.3 * fade + 0.04})`;
    }
    ctx.fillRect(x, y, 2.1, 2.1);
  }

  // Star-forming ring, where the model has one.
  if (m.ringAt != null) {
    for (let i = 0; i < (lite ? 4000 : 14000); i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = R * (m.ringAt + gauss() * 0.028);
      const [x, y] = toCanvas(r, theta);
      ctx.fillStyle = `rgba(184,208,255,${0.16 + Math.random() * 0.24})`;
      ctx.fillRect(x, y, 1.7, 1.7);
    }
  }

  // HII regions — soft pink glows loosely scattered along the arms.
  for (let i = 0; i < (lite ? 40 : 120); i++) {
    const arm = pickArm(m);
    const rNorm = 0.28 + Math.random() * 0.66;
    const r = rNorm * R;
    const theta = armLongitude(m, arm, r, R) + gauss() * 0.05;
    const [x, y] = toCanvas(r, theta);
    const rad = size * (0.004 + Math.random() * 0.006);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,152,176,0.42)');
    grad.addColorStop(0.55, 'rgba(255,112,144,0.16)');
    grad.addColorStop(1, 'rgba(255,80,110,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Dust lanes — dark cloud on the inner (concave) edge of each arm, where a
  // density wave piles gas up before it forms stars.
  ctx.globalCompositeOperation = 'multiply';
  const dustSplats = lite ? 12000 : 34000;
  for (let i = 0; i < dustSplats; i++) {
    const arm = pickArm(m);
    const rNorm = 0.12 + Math.pow(Math.random(), 0.55) * 0.82;
    const r = rNorm * R;
    const sigma = (0.07 + 0.26 * rNorm) * 0.5;
    // The lane leads the ridge by a small, radius-independent angle.
    const theta = armLongitude(m, arm, r, R) - 0.17 + gauss() * sigma;
    const [x, y] = toCanvas(r, theta);
    const a = 0.5 - rNorm * 0.34;
    ctx.fillStyle = `rgba(24,14,20,${a})`;
    ctx.fillRect(x, y, 1.7, 1.7);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Fade the rim to transparent so the disk has no cut circular edge.
  ctx.globalCompositeOperation = 'destination-in';
  const rim = ctx.createRadialGradient(mid, mid, R * 0.62, mid, mid, R * 1.02);
  rim.addColorStop(0, 'rgba(0,0,0,1)');
  rim.addColorStop(0.72, 'rgba(0,0,0,0.55)');
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ───────────────────────── milky way disk ───────────────────────── */

export interface MilkyWayHandle {
  group: THREE.Group;
  /** The disk mesh — exposed so the canvas can register it for picking. */
  pickTarget: THREE.Mesh;
  /** Galactic centre, in the group's local frame (the Sun is at the group's
   *  origin, so this is where the "Milky Way" label belongs). */
  center: THREE.Vector3;
  setFade: (fade: number) => void;
  dispose: () => void;
}

/** Stellar-disk radius in scene units. The Milky Way's is ~16 kpc across its
 *  bright stellar disk, so one unit here is about 3.6 parsecs. */
const MW_RADIUS = 4400;
/** The Sun orbits 8.2 kpc out — 0.51 of that disk radius. */
const SUN_R_FRACTION = 0.512;

export function makeMilkyWayDisk(lite = false): MilkyWayHandle {
  const group = new THREE.Group();
  group.name = 'galactic.milkyWay';

  // Tilt the galaxy frame so the disk doesn't sit flat on the ecliptic —
  // the galactic plane is inclined ~60° to it.
  group.rotation.set(THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(28), 0, 'XYZ');

  // Where we actually are: 0.51 R out, and *between* arms. The Sun sits in
  // the Orion Spur, the short bridge running between the Sagittarius–Carina
  // and Perseus arms — not on a major arm, which is why the summer Milky Way
  // shows Sagittarius as a wall of stars and Perseus as a fainter one.
  const sunR = MW_RADIUS * SUN_R_FRACTION;
  const sunPhi =
    armLongitude(MILKY_WAY_MODEL, 0, sunR, MW_RADIUS) +
    ((Math.PI * 2) / MILKY_WAY_MODEL.arms) * 0.55;
  const sunLocal = new THREE.Vector3(Math.cos(sunPhi) * sunR, 0, Math.sin(sunPhi) * sunR);

  // Everything galactic hangs off this, shifted so the Sun lands on the
  // scene origin — the camera orbits the Sun, so the Sun has to be there.
  const galaxy = new THREE.Group();
  galaxy.position.copy(sunLocal).negate();
  group.add(galaxy);

  const diskGeom = new THREE.CircleGeometry(MW_RADIUS, 192);
  // Painting the disk costs a few hundred thousand splats. Deferred to the
  // first frame the galaxy is actually visible, so it never sits in front of
  // the solar system's first paint.
  const diskMat = new THREE.MeshBasicMaterial({
    map: null,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const disk = new THREE.Mesh(diskGeom, diskMat);
  disk.rotation.x = -Math.PI / 2; // CircleGeometry is XY; the disk is XZ
  galaxy.add(disk);

  // Resolved stars above and below the painted disk — this is what gives the
  // galaxy real depth, and what you fly through on the way out.
  const starN = lite ? 16000 : 52000;
  const { pos: vPos, col: vCol } = sampleSpiralStars(starN, MW_RADIUS, MILKY_WAY_MODEL);
  const volGeom = new THREE.BufferGeometry();
  volGeom.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
  volGeom.setAttribute('color', new THREE.BufferAttribute(vCol, 3));
  const starSprite = softStarSprite();
  const volMat = new THREE.PointsMaterial({
    map: starSprite,
    size: lite ? 11 : 8,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    alphaTest: 0.02,
  });
  galaxy.add(new THREE.Points(volGeom, volMat));

  // The Orion Spur: the short, faint segment of arm the Sun actually lives
  // in. Without it we sit in an empty inter-arm gap, which is wrong — the
  // spur is a real structure, about 3.5 kpc long.
  const spurN = lite ? 900 : 2600;
  const spurPos = new Float32Array(spurN * 3);
  const spurCol = new Float32Array(spurN * 3);
  const spurDir = new THREE.Vector3(-Math.sin(sunPhi), 0, Math.cos(sunPhi));
  for (let i = 0; i < spurN; i++) {
    const along = (Math.random() - 0.45) * MW_RADIUS * 0.28;
    const across = gauss() * MW_RADIUS * 0.018;
    spurPos[i * 3] = sunLocal.x + spurDir.x * along + Math.cos(sunPhi) * across;
    spurPos[i * 3 + 1] = gauss() * MW_RADIUS * 0.008;
    spurPos[i * 3 + 2] = sunLocal.z + spurDir.z * along + Math.sin(sunPhi) * across;
    const lum = 0.2 + 0.8 * Math.pow(Math.random(), 2.2);
    spurCol[i * 3] = 0.78 * lum;
    spurCol[i * 3 + 1] = 0.85 * lum;
    spurCol[i * 3 + 2] = 1.0 * lum;
  }
  const spurGeom = new THREE.BufferGeometry();
  spurGeom.setAttribute('position', new THREE.BufferAttribute(spurPos, 3));
  spurGeom.setAttribute('color', new THREE.BufferAttribute(spurCol, 3));
  const spurMat = new THREE.PointsMaterial({
    map: starSprite,
    size: lite ? 10 : 7,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    alphaTest: 0.02,
  });
  galaxy.add(new THREE.Points(spurGeom, spurMat));

  // Population-II halo — old stars scattered well off the disk plane.
  const haloN = lite ? 700 : 1600;
  const haloPos = new Float32Array(haloN * 3);
  const haloCol = new Float32Array(haloN * 3);
  for (let i = 0; i < haloN; i++) {
    const u = Math.random();
    const v = Math.random();
    const t = 2 * Math.PI * u;
    const p = Math.acos(2 * v - 1);
    const r = Math.pow(Math.random(), 0.4) * MW_RADIUS * 0.85 + MW_RADIUS * 0.05;
    haloPos[i * 3] = r * Math.sin(p) * Math.cos(t);
    haloPos[i * 3 + 1] = r * Math.cos(p) * 0.5;
    haloPos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    const warm = 0.35 + Math.random() * 0.4;
    haloCol[i * 3] = 1.0 * warm;
    haloCol[i * 3 + 1] = 0.76 * warm;
    haloCol[i * 3 + 2] = 0.5 * warm;
  }
  const haloGeom = new THREE.BufferGeometry();
  haloGeom.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
  haloGeom.setAttribute('color', new THREE.BufferAttribute(haloCol, 3));
  const haloMat = new THREE.PointsMaterial({
    map: starSprite,
    size: 12,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    alphaTest: 0.02,
  });
  galaxy.add(new THREE.Points(haloGeom, haloMat));

  // The nucleus stays a bright luminous core from every angle — the painted
  // disk vanishes edge-on, and without this the centre reads as loose grit.
  const coreGlowMat = new THREE.SpriteMaterial({
    map: starSprite,
    color: new THREE.Color(1.0, 0.86, 0.62),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const coreGlow = new THREE.Sprite(coreGlowMat);
  coreGlow.scale.setScalar(MW_RADIUS * 0.5);
  galaxy.add(coreGlow);

  const setFade = (fade: number) => {
    const f = THREE.MathUtils.clamp(fade, 0, 1);
    // The painted disk carries the smooth glow, the point volume the stars.
    // Weighted the other way the galaxy turns into a haze.
    if (f > 0.005 && !diskMat.map) {
      diskMat.map = spiralGalaxyTexture(MILKY_WAY_MODEL, lite, lite ? 1024 : 2048);
      diskMat.needsUpdate = true;
    }
    diskMat.opacity = f * 0.78;
    volMat.opacity = f * 0.85;
    spurMat.opacity = f * 0.7;
    haloMat.opacity = f * 0.2;
    coreGlowMat.opacity = f * 0.34;
    group.visible = f > 0.005;
  };

  return {
    group,
    pickTarget: disk,
    center: sunLocal.clone().negate(),
    setFade,
    dispose: () => {
      diskGeom.dispose();
      diskMat.map?.dispose();
      diskMat.dispose();
      volGeom.dispose();
      volMat.dispose();
      spurGeom.dispose();
      spurMat.dispose();
      haloGeom.dispose();
      haloMat.dispose();
      coreGlowMat.dispose();
      starSprite.dispose();
    },
  };
}

/* ───────────────────────── andromeda (M31) ───────────────────────── */

export interface AndromedaHandle {
  group: THREE.Group;
  setFade: (fade: number) => void;
  dispose: () => void;
}

/** M31's disk radius — half again the Milky Way's, as it really is. */
const M31_RADIUS = 6600;

/**
 * Andromeda, the only galaxy close enough to read as a neighbour rather than
 * as a distant smudge: a painted Sb disk with its dust lanes and 10 kpc ring,
 * a resolved star volume over it, the bright bulge, and M32 and M110 — the two
 * satellite ellipticals that sit in every photograph of it.
 */
export function makeAndromedaGalaxy(lite: boolean): AndromedaHandle {
  const group = new THREE.Group();
  group.name = 'galactic.andromeda';

  const diskGeom = new THREE.CircleGeometry(M31_RADIUS, 160);
  const diskMat = new THREE.MeshBasicMaterial({
    map: null,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const disk = new THREE.Mesh(diskGeom, diskMat);
  disk.rotation.x = -Math.PI / 2;
  group.add(disk);

  const starN = lite ? 9000 : 26000;
  const { pos, col } = sampleSpiralStars(starN, M31_RADIUS, ANDROMEDA_MODEL);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sprite = softStarSprite();
  const mat = new THREE.PointsMaterial({
    map: sprite,
    size: lite ? 15 : 11,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    alphaTest: 0.02,
  });
  group.add(new THREE.Points(geom, mat));

  const glowMat = new THREE.SpriteMaterial({
    map: sprite,
    color: new THREE.Color(1.0, 0.88, 0.66),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(M31_RADIUS * 0.62);
  group.add(glow);

  // M32 (compact, tucked against the disk) and M110 (looser, out along the
  // minor axis). Both are ellipticals, so both are point clouds, not sprites —
  // a fuzzy blob beside a resolved galaxy is what makes a render look fake.
  const satMats: THREE.PointsMaterial[] = [];
  const satGeoms: THREE.BufferGeometry[] = [];
  const SATELLITES: { at: [number, number, number]; r: number; n: number; flat: number }[] = [
    { at: [M31_RADIUS * 0.34, M31_RADIUS * 0.04, -M31_RADIUS * 0.2], r: M31_RADIUS * 0.075, n: lite ? 500 : 1500, flat: 0.85 },
    { at: [-M31_RADIUS * 0.2, M31_RADIUS * 0.05, M31_RADIUS * 0.56], r: M31_RADIUS * 0.12, n: lite ? 400 : 1200, flat: 0.6 },
  ];
  for (const s of SATELLITES) {
    const sPos = new Float32Array(s.n * 3);
    const sCol = new Float32Array(s.n * 3);
    for (let i = 0; i < s.n; i++) {
      const u = Math.random();
      const v = Math.random();
      const t = 2 * Math.PI * u;
      const p = Math.acos(2 * v - 1);
      const r = Math.pow(Math.random(), 2.2) * s.r;
      sPos[i * 3] = s.at[0] + r * Math.sin(p) * Math.cos(t);
      sPos[i * 3 + 1] = s.at[1] + r * Math.cos(p) * s.flat;
      sPos[i * 3 + 2] = s.at[2] + r * Math.sin(p) * Math.sin(t);
      const lum = 0.2 + 0.8 * Math.pow(Math.random(), 2.2);
      sCol[i * 3] = 1.0 * lum;
      sCol[i * 3 + 1] = 0.86 * lum;
      sCol[i * 3 + 2] = 0.66 * lum;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
    const m = new THREE.PointsMaterial({
      map: sprite,
      size: lite ? 13 : 10,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.02,
    });
    group.add(new THREE.Points(g, m));
    satGeoms.push(g);
    satMats.push(m);
  }

  // Far enough out that the Milky Way stands alone at the galactic tier and
  // Andromeda arrives on its own as the next thing in the sky. The rotation
  // is solved, not guessed: it puts the disk 77° from face-on *as seen from
  // here*, which is the long shallow ellipse of every photograph of M31.
  // Guessed Euler angles left it 36° from face-on, i.e. a second Milky Way.
  group.position.set(23480, 9845, -28213);
  group.rotation.set(-1.4216, -0.1404, 1.1124);

  const setFade = (fade: number) => {
    const f = THREE.MathUtils.clamp(fade, 0, 1);
    if (f > 0.005 && !diskMat.map) {
      diskMat.map = spiralGalaxyTexture(ANDROMEDA_MODEL, lite, lite ? 1024 : 2048);
      diskMat.needsUpdate = true;
    }
    diskMat.opacity = f * 0.8;
    mat.opacity = f * 0.85;
    glowMat.opacity = f * 0.34;
    for (const m of satMats) m.opacity = f * 0.7;
    group.visible = f > 0.005;
  };

  return {
    group,
    setFade,
    dispose: () => {
      diskGeom.dispose();
      diskMat.map?.dispose();
      diskMat.dispose();
      geom.dispose();
      mat.dispose();
      glowMat.dispose();
      for (const g of satGeoms) g.dispose();
      for (const m of satMats) m.dispose();
      sprite.dispose();
    },
  };
}

/* ───────────────────────── other galaxies ───────────────────────── */

interface GalaxyDef {
  id: string;
  name: string;
  pos: [number, number, number];
  size: number;
  shape: 'spiral' | 'elliptical' | 'irregular';
  tilt: number; // disk tilt
  color: [number, number, number];
  /** `local` = Local Group, arriving alongside Andromeda. `far` = everything
   *  past it, which only shows up once Andromeda is already behind you. */
  tier: 'local' | 'far';
}

// Laid out so the ladder outward reads in the right order: the Milky Way
// alone, then its two Magellanic satellites, then Andromeda and Triangulum
// as the Local Group, and only then the rest of the nearby universe. Before
// this they all sat inside 6000 units and piled onto the Milky Way at once.
const OTHER_GALAXIES: GalaxyDef[] = [
  // M31 lives in makeAndromedaGalaxy as a full particle galaxy. Sizes are
  // relative to the Milky Way's 8800-unit disk: the Magellanic Clouds really
  // are small next to it, and they should look it.
  { id: 'lmc',  name: 'LMC',         pos: [-18000, -24000,  16000], size: 2600, shape: 'irregular',  tilt: 0.2,  color: [1.0, 0.88, 0.74], tier: 'local' },
  { id: 'smc',  name: 'SMC',         pos: [-24000, -25000,  12000], size: 1600, shape: 'irregular',  tilt: 0.6,  color: [1.0, 0.86, 0.82], tier: 'local' },
  { id: 'm33',  name: 'Triangulum',  pos: [-34000,  25000, -34000], size: 5300, shape: 'spiral',     tilt: 0.4,  color: [0.96, 0.94, 1.0], tier: 'local' },
  { id: 'm51',  name: 'Whirlpool',   pos: [-52000,  47000, -43000], size: 8600, shape: 'spiral',     tilt: -0.2, color: [0.94, 0.94, 1.0], tier: 'far' },
  { id: 'm104', name: 'Sombrero',    pos: [ 48000, -31000,  57000], size: 6300, shape: 'spiral',     tilt: 1.4,  color: [1.0, 0.94, 0.84], tier: 'far' },
  { id: 'm87',  name: 'M87',         pos: [-58000, -35000, -44000], size: 14000, shape: 'elliptical', tilt: 0.0, color: [1.0, 0.90, 0.74], tier: 'far' },
  { id: 'cen-a',name: 'Centaurus A', pos: [ 38000, -45000, -58000], size: 7500, shape: 'elliptical', tilt: 0.9,  color: [1.0, 0.86, 0.66], tier: 'far' },
];

export interface OtherGalaxiesHandle {
  group: THREE.Group;
  /** Local Group members and the far field fade on separate schedules. */
  setFade: (local: number, far: number) => void;
  dispose: () => void;
}

export function makeOtherGalaxies(): OtherGalaxiesHandle {
  const group = new THREE.Group();
  group.name = 'galactic.others';
  const localMats: THREE.MeshBasicMaterial[] = [];
  const farMats: THREE.MeshBasicMaterial[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  const texs: THREE.Texture[] = [];

  for (const g of OTHER_GALAXIES) {
    const tex = galaxySpriteTexture(g.shape, g.color);
    texs.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    (g.tier === 'local' ? localMats : farMats).push(mat);
    const geom = new THREE.PlaneGeometry(g.size, g.size);
    geoms.push(geom);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
    // Face roughly toward origin, then apply per-galaxy tilt.
    mesh.lookAt(0, 0, 0);
    mesh.rotateZ(g.tilt);
    mesh.userData.galaxyId = g.id;
    group.add(mesh);
  }

  const setFade = (local: number, far: number) => {
    const lf = THREE.MathUtils.clamp(local, 0, 1);
    const ff = THREE.MathUtils.clamp(far, 0, 1);
    for (const m of localMats) m.opacity = lf;
    for (const m of farMats) m.opacity = ff;
    group.visible = Math.max(lf, ff) > 0.005;
  };

  return {
    group,
    setFade,
    dispose: () => {
      for (const m of localMats) m.dispose();
      for (const m of farMats) m.dispose();
      for (const g of geoms) g.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

/**
 * A galaxy far enough away to be unresolved: a bright core, a soft disk, and
 * arms suggested by wide feathered arcs. Drawn from individual dots — as it
 * was — a galaxy at this distance reads as a loose swarm of stars sitting in
 * front of the Milky Way, which is what made the far field look like clutter.
 */
function galaxySpriteTexture(
  shape: 'spiral' | 'elliptical' | 'irregular',
  color: [number, number, number],
): THREE.CanvasTexture {
  const SIZE = 384;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const [cr, cg, cb] = color.map((v) => Math.floor(v * 255));
  const rgba = (a: number, dim = 1) =>
    `rgba(${Math.floor(cr * dim)},${Math.floor(cg * dim)},${Math.floor(cb * dim)},${a})`;

  if (shape === 'spiral') {
    // Disk glow, then two feathered arms, then the nucleus on top.
    const disk = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.44);
    disk.addColorStop(0, rgba(0.5));
    disk.addColorStop(0.3, rgba(0.22, 0.9));
    disk.addColorStop(0.65, rgba(0.07, 0.8));
    disk.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = disk;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.lineCap = 'round';
    for (let arm = 0; arm < 2; arm++) {
      // Each arm is stroked several times, wide and faint to narrow and
      // brighter — a cheap feather that reads as an unresolved arm.
      for (let pass = 0; pass < 4; pass++) {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const t = 0.16 + (i / 60) * 0.84;
          const theta = arm * Math.PI + t * Math.PI * 1.5;
          const r = t * SIZE * 0.42;
          const x = cx + Math.cos(theta) * r;
          const y = cy + Math.sin(theta) * r * 0.94;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = SIZE * (0.075 - pass * 0.016);
        ctx.strokeStyle = rgba(0.05 + pass * 0.035, 0.95 - pass * 0.08);
        ctx.stroke();
      }
    }

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.13);
    core.addColorStop(0, 'rgba(255,250,236,0.95)');
    core.addColorStop(0.4, rgba(0.5));
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, SIZE, SIZE);
  } else if (shape === 'elliptical') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.72);
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, SIZE * 0.44);
    bg.addColorStop(0, 'rgba(255,248,230,0.95)');
    bg.addColorStop(0.18, rgba(0.6));
    bg.addColorStop(0.45, rgba(0.24, 0.85));
    bg.addColorStop(0.78, rgba(0.07, 0.7));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
    ctx.restore();
  } else {
    // Irregular — a handful of overlapping soft knots, no hard edges.
    for (let blob = 0; blob < 6; blob++) {
      const bx = cx + (Math.random() - 0.5) * SIZE * 0.34;
      const by = cy + (Math.random() - 0.5) * SIZE * 0.28;
      const br = SIZE * (0.1 + Math.random() * 0.16);
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, rgba(0.34 + Math.random() * 0.2));
      bg.addColorStop(0.5, rgba(0.1, 0.9));
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ───────────────────────── cosmic web ───────────────────────── */

/**
 * 2×2 galaxy sprite atlas: spiral face-on / elliptical / edge-on disk /
 * irregular. Each galaxy is drawn inside the central ~72% of its tile so the
 * per-point rotation in the shader never clips a corner. This is what turns
 * the far tier into a Hubble-deep-field of shaped galaxies instead of dots.
 */
function galaxyAtlasTexture(): THREE.CanvasTexture {
  const TILE = 256;
  const c = document.createElement('canvas');
  c.width = c.height = TILE * 2;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, TILE * 2, TILE * 2);

  const withTile = (tx: number, ty: number, draw: (cx: number, cy: number) => void) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx * TILE, ty * TILE, TILE, TILE);
    ctx.clip();
    draw(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
    ctx.restore();
  };

  // Tile (0,0) — face-on spiral.
  withTile(0, 0, (cx, cy) => {
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, TILE * 0.34);
    bg.addColorStop(0, 'rgba(255,244,222,0.95)');
    bg.addColorStop(0.18, 'rgba(255,232,190,0.5)');
    bg.addColorStop(0.55, 'rgba(190,200,235,0.16)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(cx - TILE / 2, cy - TILE / 2, TILE, TILE);
    for (let i = 0; i < 2600; i++) {
      const arm = Math.floor(Math.random() * 2);
      const t = Math.pow(Math.random(), 0.6);
      const theta = arm * Math.PI + t * Math.PI * 1.7;
      const rr = t * TILE * 0.34;
      const jit = (1 - t * 0.5) * 7;
      const x = cx + Math.cos(theta) * rr + (Math.random() - 0.5) * jit;
      const y = cy + Math.sin(theta) * rr * 0.92 + (Math.random() - 0.5) * jit;
      const a = (1 - t) * 0.5 + 0.08;
      ctx.fillStyle = `rgba(214,226,255,${a})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  });

  // Tile (1,0) — elliptical.
  withTile(1, 0, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.72);
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, TILE * 0.32);
    bg.addColorStop(0, 'rgba(255,240,214,0.95)');
    bg.addColorStop(0.35, 'rgba(244,222,186,0.42)');
    bg.addColorStop(0.75, 'rgba(220,198,168,0.12)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(-TILE / 2, -TILE / 2, TILE, TILE);
    ctx.restore();
  });

  // Tile (0,1) — edge-on disk: thin streak + central bulge + dust hint.
  withTile(0, 1, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    const streak = ctx.createLinearGradient(-TILE * 0.34, 0, TILE * 0.34, 0);
    streak.addColorStop(0, 'rgba(0,0,0,0)');
    streak.addColorStop(0.2, 'rgba(235,225,205,0.55)');
    streak.addColorStop(0.5, 'rgba(255,244,222,0.9)');
    streak.addColorStop(0.8, 'rgba(235,225,205,0.55)');
    streak.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = streak;
    ctx.beginPath();
    ctx.ellipse(0, 0, TILE * 0.34, TILE * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    const bulge = ctx.createRadialGradient(0, 0, 0, 0, 0, TILE * 0.1);
    bulge.addColorStop(0, 'rgba(255,240,210,0.95)');
    bulge.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bulge;
    ctx.beginPath();
    ctx.ellipse(0, 0, TILE * 0.1, TILE * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();
    // Dust lane
    ctx.fillStyle = 'rgba(20,12,8,0.5)';
    ctx.fillRect(-TILE * 0.3, -1.5, TILE * 0.6, 3);
    ctx.restore();
  });

  // Tile (1,1) — irregular: offset clumps.
  withTile(1, 1, (cx, cy) => {
    for (let b = 0; b < 5; b++) {
      const bx = cx + (Math.random() - 0.5) * TILE * 0.3;
      const by = cy + (Math.random() - 0.5) * TILE * 0.3;
      const br = TILE * (0.07 + Math.random() * 0.12);
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, 'rgba(226,232,255,0.6)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(cx - TILE / 2, cy - TILE / 2, TILE, TILE);
    }
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const GALAXY_POINTS_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAngle;
  attribute vec2 aTile;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAngle;
  varying vec2 vTile;
  varying float vAlpha;
  uniform float uPixelRatio;
  void main() {
    vColor = color;
    vAngle = aAngle;
    vTile = aTile;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (900.0 / max(1.0, -mv.z)), 1.5, 220.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const GALAXY_POINTS_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAngle;
  varying vec2 vTile;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float s = sin(vAngle);
    float co = cos(vAngle);
    vec2 rp = vec2(p.x * co - p.y * s, p.x * s + p.y * co);
    if (abs(rp.x) > 0.5 || abs(rp.y) > 0.5) discard;
    vec2 uv = (rp + 0.5) * 0.5 + vTile;
    vec4 t = texture2D(uAtlas, uv);
    float a = t.a * uOpacity * vAlpha;
    if (a < 0.012) discard;
    gl_FragColor = vec4(vColor * t.rgb, a);
  }
`;

export interface CosmicWebHandle {
  group: THREE.Group;
  setFade: (fade: number) => void;
  dispose: () => void;
}

/**
 * Large-scale structure of the universe, the way simulations like Illustris
 * and Uchuu show it: galaxy clusters as bright knots, filaments of galaxies
 * strung between neighbouring knots, and near-empty voids in between. Built
 * from three point clouds (filaments / cluster cores / sparse field) so the
 * whole tier costs three draw calls.
 */
export function makeCosmicWeb(lite: boolean): CosmicWebHandle {
  const group = new THREE.Group();
  group.name = 'galactic.cosmicWeb';

  const NODE_N = lite ? 42 : 64;
  const R_MIN = 80000;
  const R_MAX = 112000;
  const nodes: THREE.Vector3[] = [];
  for (let i = 0; i < NODE_N; i++) {
    const u = Math.random();
    const v = Math.random();
    const t = 2 * Math.PI * u;
    const p = Math.acos(2 * v - 1);
    const r = R_MIN + Math.pow(Math.random(), 0.7) * (R_MAX - R_MIN);
    nodes.push(new THREE.Vector3(
      r * Math.sin(p) * Math.cos(t),
      r * Math.sin(p) * Math.sin(t),
      r * Math.cos(p),
    ));
  }

  // Filaments — each node links to its 2–3 nearest neighbours (deduped), and
  // galaxies are scattered along a gently bowed curve between the pair with
  // gaussian spread, exactly how the web looks in N-body survey maps.
  const links: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < NODE_N; i++) {
    const dists = nodes
      .map((n, j) => ({ j, d: i === j ? Infinity : nodes[i].distanceToSquared(n) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2 + (i % 2));
    for (const { j } of dists) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push(i < j ? [i, j] : [j, i]);
      }
    }
  }

  // ── One merged deep field: every entry is a shaped galaxy sprite with its
  // own rotation, atlas tile, tint, and brightness — filament members,
  // cluster members, and lonely void galaxies all in a single draw call. ──
  const filN = lite ? 5200 : 13000;
  const coreN = lite ? 2600 : 6400;
  const fieldN = lite ? 1400 : 3600;
  const total = filN + coreN + fieldN;

  const gPos = new Float32Array(total * 3);
  const gCol = new Float32Array(total * 3);
  const gSize = new Float32Array(total);
  const gAngle = new Float32Array(total);
  const gTile = new Float32Array(total * 2);
  const gAlpha = new Float32Array(total);

  // Atlas tile UV offsets (flipY canvas → top row is v=0.5).
  const TILE_SPIRAL: [number, number] = [0, 0.5];
  const TILE_ELLIPTICAL: [number, number] = [0.5, 0.5];
  const TILE_EDGE: [number, number] = [0, 0];
  const TILE_IRREGULAR: [number, number] = [0.5, 0];

  let w = 0;
  const put = (
    x: number, y: number, z: number,
    kind: 'cluster' | 'filament' | 'field',
  ) => {
    const i = w++;
    gPos[i * 3] = x;
    gPos[i * 3 + 1] = y;
    gPos[i * 3 + 2] = z;
    // Morphology mix: clusters are elliptical-rich (real morphology–density
    // relation); filaments and the field are spiral-rich.
    const roll = Math.random();
    let tile: [number, number];
    if (kind === 'cluster') {
      tile = roll < 0.55 ? TILE_ELLIPTICAL : roll < 0.8 ? TILE_SPIRAL : roll < 0.93 ? TILE_EDGE : TILE_IRREGULAR;
    } else {
      tile = roll < 0.45 ? TILE_SPIRAL : roll < 0.68 ? TILE_EDGE : roll < 0.86 ? TILE_ELLIPTICAL : TILE_IRREGULAR;
    }
    gTile[i * 2] = tile[0];
    gTile[i * 2 + 1] = tile[1];
    gAngle[i] = Math.random() * Math.PI * 2;
    // Tint: ellipticals warm gold, spirals blue-white, plus a redshifted tail.
    const isEll = tile === TILE_ELLIPTICAL;
    const redshifted = Math.random() < 0.16;
    if (redshifted) {
      gCol[i * 3] = 0.95; gCol[i * 3 + 1] = 0.62; gCol[i * 3 + 2] = 0.5;
    } else if (isEll) {
      gCol[i * 3] = 1.0; gCol[i * 3 + 1] = 0.88; gCol[i * 3 + 2] = 0.7;
    } else {
      gCol[i * 3] = 0.82; gCol[i * 3 + 1] = 0.88; gCol[i * 3 + 2] = 1.0;
    }
    if (kind === 'cluster') {
      gSize[i] = 380 + Math.random() * Math.random() * 900;
      gAlpha[i] = 0.55 + Math.random() * 0.45;
    } else if (kind === 'filament') {
      gSize[i] = 260 + Math.random() * 460;
      gAlpha[i] = 0.4 + Math.random() * 0.4;
    } else {
      gSize[i] = 220 + Math.random() * 460;
      gAlpha[i] = 0.2 + Math.random() * 0.3;
    }
  };

  const mid = new THREE.Vector3();
  const bow = new THREE.Vector3();
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const bows = links.map(([ia, ib]) => {
    // Fixed random bow per filament, perpendicular-ish to the link.
    mid.copy(nodes[ia]).add(nodes[ib]).multiplyScalar(0.5);
    const len = nodes[ia].distanceTo(nodes[ib]);
    return new THREE.Vector3(
      (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5),
    ).normalize().multiplyScalar(len * (0.08 + Math.random() * 0.14)).add(mid);
  });
  for (let i = 0; i < filN; i++) {
    const li = i % links.length;
    const [ia, ib] = links[li];
    pA.copy(nodes[ia]);
    pB.copy(nodes[ib]);
    bow.copy(bows[li]);
    // Quadratic bezier sample, biased toward the ends (denser near clusters).
    let s = Math.random();
    s = s < 0.5 ? Math.pow(s * 2, 1.4) / 2 : 1 - Math.pow((1 - s) * 2, 1.4) / 2;
    const inv = 1 - s;
    pt.set(0, 0, 0)
      .addScaledVector(pA, inv * inv)
      .addScaledVector(bow, 2 * inv * s)
      .addScaledVector(pB, s * s);
    const len = pA.distanceTo(pB);
    const spread = len * 0.035;
    put(
      pt.x + (Math.random() + Math.random() - 1) * spread,
      pt.y + (Math.random() + Math.random() - 1) * spread,
      pt.z + (Math.random() + Math.random() - 1) * spread,
      'filament',
    );
  }

  // Cluster cores — dense knots at the nodes (galaxies crowd there).
  for (let i = 0; i < coreN; i++) {
    const n = nodes[i % NODE_N];
    const sigma = 1900 + (i % 7) * 320;
    put(
      n.x + (Math.random() + Math.random() + Math.random() - 1.5) * sigma,
      n.y + (Math.random() + Math.random() + Math.random() - 1.5) * sigma,
      n.z + (Math.random() + Math.random() + Math.random() - 1.5) * sigma,
      'cluster',
    );
  }

  // Sparse lonely galaxies drifting in the voids.
  for (let i = 0; i < fieldN; i++) {
    const u = Math.random();
    const v = Math.random();
    const t = 2 * Math.PI * u;
    const p = Math.acos(2 * v - 1);
    const r = R_MIN * 0.8 + Math.random() * (R_MAX - R_MIN * 0.8);
    put(
      r * Math.sin(p) * Math.cos(t),
      r * Math.sin(p) * Math.sin(t),
      r * Math.cos(p),
      'field',
    );
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(gCol, 3));
  geom.setAttribute('aSize', new THREE.BufferAttribute(gSize, 1));
  geom.setAttribute('aAngle', new THREE.BufferAttribute(gAngle, 1));
  geom.setAttribute('aTile', new THREE.BufferAttribute(gTile, 2));
  geom.setAttribute('aAlpha', new THREE.BufferAttribute(gAlpha, 1));

  const atlas = galaxyAtlasTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas },
      uOpacity: { value: 0 },
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
    },
    vertexShader: GALAXY_POINTS_VERT,
    fragmentShader: GALAXY_POINTS_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geom, mat);
  group.add(pts);

  const setFade = (fade: number) => {
    const f = THREE.MathUtils.clamp(fade, 0, 1);
    // Held below full: the web is the backdrop behind the Local Group, and at
    // full brightness its filaments read as loose star clumps competing with
    // the Milky Way rather than as structure a hundred thousand units away.
    mat.uniforms.uOpacity.value = f * 0.7;
    group.visible = f > 0.005;
  };

  return {
    group,
    setFade,
    dispose: () => {
      geom.dispose();
      mat.dispose();
      atlas.dispose();
    },
  };
}

/* ───────────────────────── tier helper ───────────────────────── */

/**
 * Map the camera's radial distance to a "galactic tier" value used by the
 * canvas loop to fade each layer in/out:
 *   tier.solar    — solar system fade (1 = full, 0 = hidden)
 *   tier.stellar  — nearby-star sprites fade in
 *   tier.galactic — Milky Way fades in
 *   tier.local    — Local Group: the Magellanic Clouds, Andromeda, Triangulum
 *   tier.universe — the nearby universe past the Local Group
 *   tier.web      — cosmic web / large-scale structure, the outermost tier
 */
export interface TierBlend {
  solar: number;
  stellar: number;
  galactic: number;
  local: number;
  universe: number;
  web: number;
}

export function tierBlendFromRadius(radius: number): TierBlend {
  // One thing at a time on the way out — the tiers used to overlap inside
  // 6000 units, so the Milky Way, Andromeda and the cosmic web all arrived
  // together and read as one field of scattered smudges.
  //   <  60      : pure solar
  //   60-220     : the stellar neighbourhood fades in
  //   1400-3600   : the Milky Way, on its own
  //   7000-12000  : the Local Group joins it
  //   13000-17500 : the nearby universe
  //   15500+      : the cosmic web behind all of it
  const stellar = smoothstep(60, 220, radius);
  const galactic = smoothstep(1400, 3600, radius);
  const local = smoothstep(7000, 12000, radius);
  const universe = smoothstep(13000, 17500, radius);
  const web = smoothstep(15500, 21000, radius);
  // The solar tier doesn't fully disappear — at huge distances the sun
  // simply becomes a tiny dot via perspective, no need to hide the meshes.
  const solar = 1.0;
  return { solar, stellar, galactic, local, universe, web };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
