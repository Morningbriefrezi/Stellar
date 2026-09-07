import * as THREE from 'three';
import { getSaturnRingStripTexture } from '@/lib/solar-system/saturn-ring-strip';
import { GeoMoon } from 'astronomy-engine';
import {
  helioEqjToThree,
  sampleOrbitPath,
  sceneRadiusFromAu,
  worldRadiusForBody,
  type ScaleMode,
  type SolarBodyId,
} from '@/lib/solar-system/ephemeris';

const SRGB = THREE.SRGBColorSpace;
const MS_DAY = 86_400_000;
/** Mean motion (rad/ms) for a circular heliocentric orbit at `au` — Kepler's third law. */
function meanMotionRadPerMs(au: number): number {
  return (Math.PI * 2) / (Math.pow(au, 1.5) * 365.256 * MS_DAY);
}

/* ───────────────────────── orbit rings ───────────────────────── */

/**
 * True orbit paths — each line is the body's real heliocentric trajectory
 * sampled over one sidereal period, so Mercury's eccentric ellipse and
 * Pluto's inclined Neptune-crossing orbit render exactly as in space
 * (instead of the flat concentric circles a toy orrery would draw).
 */
export function makeOrbitRings(mode: ScaleMode, includePluto: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'orbitRings';

  const ids: Exclude<SolarBodyId, 'sun'>[] = [
    'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune',
  ];
  if (includePluto) ids.push('pluto');

  for (const id of ids) {
    const pts = sampleOrbitPath(id, mode);
    const pos = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      pos[i * 3] = pts[i].x;
      pos[i * 3 + 1] = pts[i].y;
      pos[i * 3 + 2] = pts[i].z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const opacity = id === 'pluto' ? 0.1 : 0.13;
    const mat = new THREE.LineBasicMaterial({
      color: 0x6b86c8,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const line = new THREE.LineLoop(geom, mat);
    line.userData.orbitFor = id;
    group.add(line);
  }
  return group;
}

/** Dim the orbit paths. They orient you from far out, but crossing the frame
 *  at close range they are just lines over the thing you came to look at. */
export function setOrbitRingsFade(group: THREE.Group, k: number) {
  group.visible = k > 0.02;
  if (!group.visible) return;
  for (const child of group.children) {
    const line = child as THREE.LineLoop;
    const base = (line.userData.baseOpacity as number | undefined) ??
      ((line.material as THREE.LineBasicMaterial).opacity);
    line.userData.baseOpacity = base;
    (line.material as THREE.LineBasicMaterial).opacity = base * k;
  }
}

export function disposeOrbitRings(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.LineLoop || o instanceof THREE.Line) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

/* ───────────────────────── asteroid belt ───────────────────────── */

export interface BeltHandle {
  group: THREE.Group;
  /** Repositions every particle for the simulation epoch — Keplerian rates. */
  update: (epochMs: number) => void;
  dispose: () => void;
}

function diskSprite(): THREE.CanvasTexture {
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,235,200,1)');
  grad.addColorStop(0.45, 'rgba(220,200,170,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB;
  return t;
}

/**
 * PointsMaterial whose sprites never balloon when the camera flies close —
 * gl_PointSize is clamped to `maxPx` (device pixels), and optionally scaled
 * per-particle by an `aSize` attribute. Fixes the "giant bokeh blob" artifact
 * when the orbit camera passes through a particle field.
 */
export function clampedPointsMaterial(
  params: THREE.PointsMaterialParameters,
  maxPx: number,
  perParticleSize: boolean,
): THREE.PointsMaterial {
  const mat = new THREE.PointsMaterial(params);
  mat.onBeforeCompile = (shader) => {
    if (perParticleSize) {
      shader.vertexShader = shader.vertexShader
        .replace('uniform float size;', 'uniform float size;\nattribute float aSize;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    }
    shader.vertexShader = shader.vertexShader.replace(
      'if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );',
      `if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	gl_PointSize = min( gl_PointSize, ${maxPx.toFixed(1)} );`,
    );
  };
  return mat;
}

/** Jupiter's mean-motion resonances sweep these radii clean (Kirkwood gaps). */
const KIRKWOOD_GAPS_AU = [2.065, 2.502, 2.825, 2.958];

export function makeAsteroidBelt(mode: ScaleMode, lite: boolean): BeltHandle {
  const count = lite ? 2200 : 5200;
  const innerAu = 2.15;
  const outerAu = 3.3;

  // Rejection-sample semi-major axes so the real Kirkwood gaps appear as
  // thin cleared rings, denser toward the inner belt as in space.
  const sampleBeltAu = (): number => {
    for (;;) {
      const au = innerAu + Math.pow(Math.random(), 0.62) * (outerAu - innerAu);
      let keep = 1;
      for (const g of KIRKWOOD_GAPS_AU) {
        const d = au - g;
        keep *= 1 - 0.94 * Math.exp(-(d * d) / (2 * 0.022 * 0.022));
      }
      if (Math.random() < keep) return au;
    }
  };

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const angles = new Float32Array(count);
  const radii = new Float32Array(count);
  const heights = new Float32Array(count);
  const driftRates = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const au = sampleBeltAu();
    const r = sceneRadiusFromAu(au, mode);
    // Vertical spread from orbital inclinations (roughly gaussian, up to ~10°).
    const y = ((Math.random() + Math.random() + Math.random()) / 1.5 - 1) * r * 0.07;
    angles[i] = a;
    radii[i] = r;
    heights[i] = y;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * r;
    // Real taxonomy mix: ~70% dark carbonaceous C-types, ~25% reddish
    // silicate S-types, a few bright metallic/basaltic bodies.
    const typ = Math.random();
    let cr: number;
    let cg: number;
    let cb: number;
    if (typ < 0.7) {
      const s = 0.3 + Math.random() * 0.22;
      cr = s; cg = s * 0.95; cb = s * 0.88;
    } else if (typ < 0.95) {
      const s = 0.42 + Math.random() * 0.3;
      cr = s; cg = s * 0.78; cb = s * 0.6;
    } else {
      const s = 0.62 + Math.random() * 0.34;
      cr = s; cg = s * 0.94; cb = s * 0.86;
    }
    colors[i * 3] = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;
    // Power-law size distribution — plenty of dust, a handful of big ones.
    sizes[i] = 0.45 + Math.pow(Math.random(), 2.6) * 1.9;
    // True Keplerian mean motion for the particle's heliocentric distance —
    // an inner-belt asteroid takes ~3.2 years per lap, exactly as in space.
    driftRates[i] = meanMotionRadPerMs(au);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const sprite = diskSprite();
  const mat = clampedPointsMaterial({
    map: sprite,
    size: 0.03,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    sizeAttenuation: true,
    alphaTest: 0.02,
    blending: THREE.NormalBlending,
  }, 3.5, true);
  const points = new THREE.Points(geo, mat);
  points.name = 'asteroidBelt';

  const group = new THREE.Group();
  group.name = 'asteroidBeltGroup';
  group.add(points);

  // A few resolvable boulders among the dust — lumpy displaced icosahedra
  // (Ceres/Vesta-class stand-ins) on their own Keplerian orbits, tumbling
  // slowly. Everything else in the belt stays a point sprite.
  const boulders: {
    mesh: THREE.Mesh;
    r: number;
    y: number;
    angle0: number;
    rate: number;
    spinRate: number;
  }[] = [];
  // Match the point-sprite taxonomy: dark C, reddish S, brighter stony.
  const boulderMats = [
    new THREE.MeshStandardMaterial({ color: 0x5d564e, roughness: 0.97, metalness: 0.02 }),
    new THREE.MeshStandardMaterial({ color: 0x8a6f58, roughness: 0.95, metalness: 0.03 }),
    new THREE.MeshStandardMaterial({ color: 0x92897c, roughness: 0.92, metalness: 0.05 }),
  ];
  const BOULDER_N = lite ? 5 : 10;
  for (let i = 0; i < BOULDER_N; i++) {
    const big = i < 2; // a couple of Ceres/Vesta-class bodies
    // True rock scale — far smaller than any planet (Earth renders at 0.028
    // scene units). Earlier sizes made boulders read as extra planets.
    const bGeom = new THREE.IcosahedronGeometry(
      big ? 0.0035 + Math.random() * 0.0015 : 0.0015 + Math.random() * 0.0015,
      big ? 2 : 1,
    );
    // Gently lumpy silhouette — potato, not shrapnel. The big ones stay
    // rounder (self-gravity), the small ones get more elongated.
    const rough = big ? 0.08 : 0.16;
    const stretch = big ? 1 : 1 + Math.random() * 0.45;
    const bp = bGeom.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < bp.count; v++) {
      const k = 1 - rough + Math.random() * rough * 2;
      bp.setXYZ(v, bp.getX(v) * k * stretch, bp.getY(v) * (1 - rough + Math.random() * rough * 2), bp.getZ(v) * k);
    }
    bGeom.computeVertexNormals();
    const bMesh = new THREE.Mesh(bGeom, boulderMats[i % boulderMats.length]);
    const au = sampleBeltAu();
    const rr = sceneRadiusFromAu(au, mode);
    boulders.push({
      mesh: bMesh,
      r: rr,
      y: ((Math.random() + Math.random()) - 1) * rr * 0.05,
      angle0: Math.random() * Math.PI * 2,
      rate: meanMotionRadPerMs(au),
      spinRate: (0.5 + Math.random()) * 2e-5, // rad/ms of sim time
    });
    group.add(bMesh);
  }

  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;

  return {
    group,
    update(epochMs: number) {
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const a = angles[i] + driftRates[i] * epochMs;
        const r = radii[i];
        arr[i * 3] = Math.cos(a) * r;
        arr[i * 3 + 1] = heights[i];
        arr[i * 3 + 2] = Math.sin(a) * r;
      }
      posAttr.needsUpdate = true;
      for (const b of boulders) {
        const a = b.angle0 + b.rate * epochMs;
        b.mesh.position.set(Math.cos(a) * b.r, b.y, Math.sin(a) * b.r);
        b.mesh.rotation.y = b.spinRate * epochMs;
        b.mesh.rotation.x = b.spinRate * 0.6 * epochMs;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      sprite.dispose();
      for (const b of boulders) b.mesh.geometry.dispose();
      for (const m of boulderMats) m.dispose();
    },
  };
}

/* ───────────────────────── kuiper belt ───────────────────────── */

export function makeKuiperBelt(mode: ScaleMode, lite: boolean): BeltHandle {
  const count = lite ? 600 : 1400;
  const innerAu = 30;
  const outerAu = 50;
  const inner = sceneRadiusFromAu(innerAu, mode);
  const outer = sceneRadiusFromAu(outerAu, mode);
  const thickness = (outer - inner) * 0.18;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const angles = new Float32Array(count);
  const radii = new Float32Array(count);
  const heights = new Float32Array(count);
  const driftRates = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const au = innerAu + Math.random() * (outerAu - innerAu);
    const r = sceneRadiusFromAu(au, mode);
    const y = (Math.random() - 0.5) * thickness;
    angles[i] = a;
    radii[i] = r;
    heights[i] = y;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * r;
    const shade = 0.45 + Math.random() * 0.4;
    colors[i * 3] = 0.6 * shade;
    colors[i * 3 + 1] = 0.66 * shade;
    colors[i * 3 + 2] = 0.85 * shade;
    driftRates[i] = meanMotionRadPerMs(au);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const sprite = diskSprite();
  const mat = clampedPointsMaterial({
    map: sprite,
    size: 0.026,
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
    alphaTest: 0.02,
    blending: THREE.NormalBlending,
  }, 2.5, false);
  const points = new THREE.Points(geo, mat);
  points.name = 'kuiperBelt';

  const group = new THREE.Group();
  group.name = 'kuiperBeltGroup';
  group.add(points);

  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;

  return {
    group,
    update(epochMs: number) {
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const a = angles[i] + driftRates[i] * epochMs;
        const r = radii[i];
        arr[i * 3] = Math.cos(a) * r;
        arr[i * 3 + 1] = heights[i];
        arr[i * 3 + 2] = Math.sin(a) * r;
      }
      posAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      sprite.dispose();
    },
  };
}

/* ───────────────────────── earth clouds + moon ───────────────────────── */

function cloudsTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 220; i++) {
    const cx = Math.random() * w;
    const cy = Math.pow(Math.random(), 0.7) * h;
    const rx = 30 + Math.random() * 70;
    const ry = 12 + Math.random() * 32;
    const alpha = 0.18 + Math.random() * 0.34;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.4})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export interface EarthExtrasHandle {
  cloudMesh: THREE.Mesh;
  atmosphereMesh: THREE.Mesh;
  moonGroup: THREE.Group;
  moonMesh: THREE.Mesh;
  /** `dtSec` drives the real-time weather (lightning); epoch drives orbits. */
  update: (epochMs: number, dtSec: number) => void;
  dispose: () => void;
}

function moonTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b6b1a8';
  ctx.fillRect(0, 0, w, h);
  // Noise.
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 28;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  // Craters.
  for (let i = 0; i < 110; i++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    const r = 3 + Math.random() * 14;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(40,38,34,0.55)');
    g.addColorStop(0.7, 'rgba(80,76,70,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Maria.
  ctx.fillStyle = 'rgba(60,58,55,0.32)';
  for (let i = 0; i < 8; i++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 25 + Math.random() * 45, 14 + Math.random() * 28, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  return tex;
}

const ATMOSPHERE_VERT = `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorldPos;
  varying vec3 vWorldNrm;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mvPos.xyz);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNrm = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

// Rayleigh-style limb: fresnel rim that is brightest on the sunlit side and
// fades around the terminator. The Sun sits at the scene origin.
const ATMOSPHERE_FRAG = `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorldPos;
  varying vec3 vWorldNrm;
  void main() {
    float fresnel = pow(1.0 - max(dot(vNormal, vView), 0.0), uPower);
    float sunFacing = dot(normalize(vWorldNrm), normalize(-vWorldPos));
    float lit = 0.28 + 0.72 * smoothstep(-0.35, 0.4, sunFacing);
    gl_FragColor = vec4(uColor * fresnel * uIntensity * lit, fresnel * lit);
  }
`;

export function makeAtmosphereShell(planetRadius: number, color: number, scale = 1.06, intensity = 1.2, power = 2.2): THREE.Mesh {
  const geom = new THREE.SphereGeometry(planetRadius * scale, 48, 48);
  const c = new THREE.Color(color);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
      uIntensity: { value: intensity },
      uPower: { value: power },
    },
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.isAtmosphere = true;
  return mesh;
}

export function disposeAtmosphereShell(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}

export function makeEarthExtras(earthRadius: number, lite: boolean): EarthExtrasHandle {
  // Cloud layer — procedural fallback swaps to the real NASA-derived
  // satellite cloud composite once it loads.
  const cloudsTex = cloudsTexture();
  const cloudGeom = new THREE.SphereGeometry(earthRadius * 1.013, lite ? 48 : 72, lite ? 48 : 72);
  const cloudMat = new THREE.MeshStandardMaterial({
    map: cloudsTex,
    alphaMap: cloudsTex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
  });
  const cloudMesh = new THREE.Mesh(cloudGeom, cloudMat);
  cloudMesh.userData.isClouds = true;

  let realCloudsTex: THREE.Texture | null = null;
  new THREE.TextureLoader().load('/solar-system/planets/earth-clouds.jpg', (tex) => {
    tex.colorSpace = SRGB;
    tex.wrapS = THREE.RepeatWrapping;
    realCloudsTex = tex;
    cloudMat.map = tex;
    cloudMat.alphaMap = tex; // clouds-on-black composite doubles as alpha
    cloudMat.needsUpdate = true;
  });

  // Thunderstorms — small flash sprites parked inside the cloud layer.
  // Each storm cell flickers 2–3 times, goes dark, then re-arms elsewhere
  // on its own schedule, the way lightning looks from orbit.
  const STORM_N = lite ? 3 : 6;
  const stormTex = cometGlowSprite(); // cool white-blue glow — reads as lightning
  const storms: {
    sprite: THREE.Sprite;
    mat: THREE.SpriteMaterial;
    wait: number;
    burst: number; // >0 while flickering
  }[] = [];
  const placeStorm = (spr: THREE.Sprite) => {
    // Bias toward the tropics where thunderstorms actually cluster.
    const lat = (Math.random() + Math.random() - 1) * 0.62; // ±~35°
    const lon = Math.random() * Math.PI * 2;
    const r = earthRadius * 1.015;
    spr.position.set(
      r * Math.cos(lat) * Math.cos(lon),
      r * Math.sin(lat),
      r * Math.cos(lat) * Math.sin(lon),
    );
  };
  for (let i = 0; i < STORM_N; i++) {
    const mat = new THREE.SpriteMaterial({
      map: stormTex,
      color: new THREE.Color(0.85, 0.9, 1.0),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(earthRadius * 0.14);
    placeStorm(sprite);
    cloudMesh.add(sprite); // rides the cloud layer's rotation
    storms.push({ sprite, mat, wait: 1 + Math.random() * 5, burst: 0 });
  }

  // Atmosphere fresnel shell
  const atmosphereMesh = makeAtmosphereShell(earthRadius, 0x6ab7ff, 1.06, 1.3, 2.4);

  // Moon — orbiting parent group; group orbits, moon spins. The procedural
  // fallback texture swaps to the real NASA LRO-derived global map on load,
  // so Mare Tranquillitatis and Tycho's rays sit where they belong.
  const moonGroup = new THREE.Group();
  moonGroup.name = 'moonGroup';
  const moonTex = moonTexture();
  const moonRadius = earthRadius * 0.273;
  const moonGeom = new THREE.SphereGeometry(moonRadius, lite ? 32 : 48, lite ? 32 : 48);
  const moonMat = new THREE.MeshStandardMaterial({
    map: moonTex,
    roughness: 0.96,
    metalness: 0,
  });
  let realMoonTex: THREE.Texture | null = null;
  new THREE.TextureLoader().load('/solar-system/planets/moon.jpg', (tex) => {
    tex.colorSpace = SRGB;
    realMoonTex = tex;
    moonMat.map = tex;
    moonMat.needsUpdate = true;
  });
  const moonMesh = new THREE.Mesh(moonGeom, moonMat);
  // Distance: in real life ≈ 30 Earth diameters, but compressed for visibility.
  const moonDist = earthRadius * 4.2;
  moonMesh.position.set(moonDist, 0, 0);
  moonGroup.add(moonMesh);

  const moonDir = new THREE.Vector3();

  return {
    cloudMesh,
    atmosphereMesh,
    moonGroup,
    moonMesh,
    update(epochMs: number, dtSec: number) {
      // Cloud is a child of spinning Earth; set local rotation to a small drift
      // so world-space cloud motion = earth spin + slight delta (visual drift).
      cloudMesh.rotation.y = (epochMs / (86400 * 1000)) * Math.PI * 2 * 0.04;
      // Real geocentric Moon direction from the lunar ephemeris — phase,
      // 5.1° inclination, and node regression all come along for free.
      // Only the distance is compressed for visibility.
      moonDir.copy(helioEqjToThree(GeoMoon(new Date(epochMs)))).normalize();
      moonMesh.position.copy(moonDir).multiplyScalar(moonDist);
      // Tidally locked — keep the same hemisphere pointed at Earth.
      moonMesh.rotation.y = Math.atan2(-moonDir.z, -moonDir.x);

      // Lightning — quick double/triple flickers, then a long dark rearm.
      for (const s of storms) {
        if (s.burst > 0) {
          s.burst -= dtSec;
          // Flicker envelope: a few sharp pulses across ~0.5 s.
          const p = Math.max(0, s.burst) * 14;
          s.mat.opacity = Math.max(0, Math.sin(p) * Math.sin(p * 2.7)) * 0.9;
          if (s.burst <= 0) {
            s.mat.opacity = 0;
            s.wait = 2 + Math.random() * 7;
            placeStorm(s.sprite);
          }
        } else {
          s.wait -= dtSec;
          if (s.wait <= 0) s.burst = 0.5;
        }
      }
    },
    dispose() {
      cloudGeom.dispose();
      cloudMat.dispose();
      cloudsTex.dispose();
      realCloudsTex?.dispose();
      for (const s of storms) s.mat.dispose();
      stormTex.dispose();
      disposeAtmosphereShell(atmosphereMesh);
      moonGeom.dispose();
      moonMat.dispose();
      moonTex.dispose();
      realMoonTex?.dispose();
    },
  };
}

/* ───────────────────────── sun corona + lens flare ───────────────────────── */

export interface SunExtrasHandle {
  group: THREE.Group;
  /** Pass `camera` to drive the directional lens flare (ghosts appear as the
   *  view swings toward the Sun). */
  update: (cameraPos: THREE.Vector3, sunPos: THREE.Vector3, dtSec: number, camera?: THREE.Camera) => void;
  dispose: () => void;
}

function lensFlareSprite(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,240,200,0.95)');
  grad.addColorStop(0.18, 'rgba(255,200,120,0.55)');
  grad.addColorStop(0.5, 'rgba(255,140,60,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB;
  return t;
}

/**
 * Corona: the K-corona as a spacecraft actually records it — a smooth
 * luminous halo, brightest at the limb and falling off fast, with only a
 * faint large-scale streamer structure. Deliberately no hard rays: spikes
 * radiating from a star are a camera artefact, not something you would see.
 */
function coronaRaysTexture(): THREE.CanvasTexture {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  const cx = s / 2;
  const cy = s / 2;
  const img = ctx.createImageData(s, s);
  const R = s * 0.5;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x - cx) / R;
      const dy = (y - cy) / R;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      // Radial falloff of the corona's surface brightness.
      let b = Math.exp(-Math.pow(Math.max(r - 0.12, 0) * 3.6, 1.35));
      // Very broad, low-contrast streamer lobes — equatorial, as in reality.
      const a = Math.atan2(dy, dx);
      const streamer = 1 + 0.22 * Math.sin(a * 2) + 0.1 * Math.sin(a * 3 + 1.1);
      b *= streamer;
      // Feather the outer edge so the sprite never shows its bounds.
      b *= 1 - Math.pow(r, 6);
      const i = (y * s + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 214;
      img.data[i + 2] = 168;
      img.data[i + 3] = Math.round(Math.max(0, Math.min(1, b)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  return tex;
}

/** Glowing prominence loop — a fiery arc that stands on the solar limb. */
function prominenceTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  // Arch: half-ellipse from (0.2w, h) to (0.8w, h) peaking near y = 0.18h.
  const draw = (lw: number, alpha: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(w / 2, h, w * 0.3, h * 0.82, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  };
  draw(18, 0.25, '#ff5a20');
  draw(10, 0.5, '#ff8a30');
  draw(5, 0.85, '#ffc060');
  draw(2, 1.0, '#fff0c0');
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  return tex;
}

/** Elongated jet for eruptive flares. */
function flareJetTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(255,220,150,0.95)');
  g.addColorStop(0.35, 'rgba(255,150,60,0.55)');
  g.addColorStop(1, 'rgba(255,90,30,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h);
  ctx.quadraticCurveTo(w * 0.18, h * 0.45, w * 0.42, 0);
  ctx.lineTo(w * 0.58, 0);
  ctx.quadraticCurveTo(w * 0.82, h * 0.45, w * 0.5, h);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  return tex;
}

export function makeSunExtras(sunRadius: number): SunExtrasHandle {
  const group = new THREE.Group();
  group.name = 'sunExtras';

  // ── Multi-layer corona: additive billboards, two of them slowly
  // counter-rotating streamer layers, all breathing on their own phase. ──
  const flareTex = lensFlareSprite();
  const raysTex = coronaRaysTexture();
  // Kept tight to the disc. A corona that reaches ten radii out is bigger
  // than the inner planets' orbits at this scale and simply erases whatever
  // you flew over to look at.
  const CORONA_SPECS = [
    { tex: flareTex, scale: 1.7, opacity: 0.5, color: 0xffd9a0, spin: 0 },
    { tex: raysTex, scale: 2.5, opacity: 0.45, color: 0xffc078, spin: 0.025 },
    { tex: raysTex, scale: 3.3, opacity: 0.24, color: 0xff9a50, spin: -0.014 },
    { tex: flareTex, scale: 4.2, opacity: 0.12, color: 0xff8040, spin: 0 },
  ];
  const corona = CORONA_SPECS.map((spec, i) => {
    const mat = new THREE.SpriteMaterial({
      map: spec.tex,
      color: spec.color,
      transparent: true,
      opacity: spec.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.name = 'sunCorona';
    sprite.scale.setScalar(sunRadius * spec.scale);
    group.add(sprite);
    return { sprite, mat, base: sunRadius * spec.scale, spin: spec.spin, phase: i * 1.7 };
  });

  // ── Prominence loops — fiery arcs anchored on the limb, carried around
  // by the Sun's slow rotation, each breathing on its own rhythm. ──
  const promTex = prominenceTexture();
  const promGroup = new THREE.Group();
  promGroup.name = 'sunProminences';
  const proms: { pivot: THREE.Group; plane: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number; speed: number }[] = [];
  const promGeom = new THREE.PlaneGeometry(sunRadius * 1.35, sunRadius * 0.72);
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: promTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(promGeom, mat);
    // Stand the arc on the limb: texture "up" points radially outward.
    plane.rotation.z = -Math.PI / 2;
    plane.position.x = sunRadius * 1.08;
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 4) * Math.PI * 2 + Math.random() * 0.8;
    pivot.rotation.z = (Math.random() - 0.5) * 1.1;
    pivot.add(plane);
    promGroup.add(pivot);
    proms.push({ pivot, plane, mat, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 0.5 });
  }

  // ── Eruptive flare — a jet that bursts from a random limb point every
  // several seconds, grows, and fades. ──
  const jetTex = flareJetTexture();
  const jetMat = new THREE.MeshBasicMaterial({
    map: jetTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const jetGeom = new THREE.PlaneGeometry(sunRadius * 0.5, sunRadius * 1.3);
  const jet = new THREE.Mesh(jetGeom, jetMat);
  jet.rotation.z = -Math.PI / 2;
  jet.position.x = sunRadius * 1.05;
  const jetPivot = new THREE.Group();
  jetPivot.add(jet);
  promGroup.add(jetPivot);
  let flareClock = 3; // first eruption a few seconds in
  let flareT = -1;    // <0 = idle, otherwise seconds since eruption began
  const FLARE_DUR = 3.2;

  // ── Glare: a single soft bloom around the disc that strengthens as the
  // view swings toward the Sun. No ghost rings — coloured discs strung
  // across the frame are a camera defect, and they land on top of whatever
  // planet you came to look at. ──
  const flareMat = new THREE.SpriteMaterial({
    map: flareTex,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flare = new THREE.Sprite(flareMat);
  flare.scale.set(sunRadius * 3, sunRadius * 3, 1);
  flare.name = 'sunFlare';
  group.add(flare);
  group.add(promGroup);

  let pulse = 0;
  const camFwd = new THREE.Vector3();
  const toSun = new THREE.Vector3();

  return {
    group,
    update(cameraPos, sunPos, dtSec, camera) {
      pulse += dtSec * 0.8;
      group.position.copy(sunPos);
      for (const c of corona) {
        c.mat.rotation += c.spin * dtSec;
        c.sprite.scale.setScalar(c.base * (1 + Math.sin(pulse * 1.3 + c.phase) * 0.03));
      }
      // Flare scales with camera distance so it doesn't get monstrous at zoom-in.
      const dist = cameraPos.distanceTo(sunPos);
      const flareScale = THREE.MathUtils.clamp(dist * 0.12, sunRadius * 2.4, sunRadius * 7);
      flare.scale.set(flareScale, flareScale, 1);

      let vis = 0;
      if (camera && dist > 1e-6) {
        camera.getWorldDirection(camFwd);
        toSun.copy(sunPos).sub(cameraPos).divideScalar(dist);
        vis = THREE.MathUtils.smoothstep(camFwd.dot(toSun), 0.72, 0.97);
      }
      flareMat.opacity = 0.16 + 0.22 * vis;

      // Prominences are a close-range detail — from system distance the
      // flat arc planes would read as odd rings, so fade them out beyond
      // ~12 solar radii and let the corona carry the look.
      const promVis = THREE.MathUtils.clamp((sunRadius * 12 - dist) / (sunRadius * 6), 0, 1);
      promGroup.visible = promVis > 0.01;

      // Prominences ride the Sun's slow rotation and breathe individually.
      promGroup.rotation.y += dtSec * 0.02;
      for (const p of proms) {
        p.phase += dtSec * p.speed;
        const s = 1 + Math.sin(p.phase) * 0.18;
        p.plane.scale.set(1, s, 1);
        p.mat.opacity = (0.65 + 0.3 * Math.sin(p.phase * 0.7 + 1.3)) * promVis;
      }

      // Eruptive flare cycle: idle → burst (grow fast, fade out) → idle.
      if (flareT < 0) {
        flareClock -= dtSec;
        if (flareClock <= 0) {
          flareT = 0;
          jetPivot.rotation.y = Math.random() * Math.PI * 2;
          jetPivot.rotation.z = (Math.random() - 0.5) * 1.6;
        }
      } else {
        flareT += dtSec;
        const t = flareT / FLARE_DUR;
        if (t >= 1) {
          flareT = -1;
          flareClock = 6 + Math.random() * 9;
          jetMat.opacity = 0;
        } else {
          // Fast rise, slow decay.
          const env = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
          jetMat.opacity = env * 0.85 * promVis;
          const grow = 0.5 + Math.min(1, t * 2.2) * 0.9;
          jet.scale.set(1, grow, 1);
        }
      }
    },
    dispose() {
      for (const c of corona) c.mat.dispose();
      flareMat.dispose();
      flareTex.dispose();
      raysTex.dispose();
      promGeom.dispose();
      for (const p of proms) p.mat.dispose();
      promTex.dispose();
      jetGeom.dispose();
      jetMat.dispose();
      jetTex.dispose();
    },
  };
}

/* ───────────────────────── milky way background ───────────────────────── */

export function makeMilkyWayBand(lite: boolean): THREE.Points {
  const count = lite ? 800 : 2400;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const inclination = 0.42; // band tilt vs ecliptic
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const angle = u * Math.PI * 2;
    const bandThickness = (Math.random() - 0.5) * 0.55;
    const r = 280 + Math.random() * 60;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = bandThickness * r * 0.18;
    // rotate around X by inclination
    const cy = Math.cos(inclination);
    const sy = Math.sin(inclination);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y * cy - z * sy;
    pos[i * 3 + 2] = y * sy + z * cy;
    const warmth = 0.4 + Math.random() * 0.6;
    col[i * 3] = 0.92 * warmth;
    col[i * 3 + 1] = 0.82 * warmth;
    col[i * 3 + 2] = 0.68 * warmth;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: lite ? 0.5 : 0.42,
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'milkyWay';
  return pts;
}

export function disposeMilkyWayBand(pts: THREE.Points) {
  pts.geometry.dispose();
  (pts.material as THREE.Material).dispose();
}

export interface MilkyWayGlowHandle {
  group: THREE.Group;
  setFade: (k: number) => void;
  dispose: () => void;
}

/** Bright core along the band's plane, mottled along its length, cut by
 *  dark dust lanes. Sampled around a torus tube: v = 0.5 is the plane. */
function milkyGlowTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const lanes: [number, number, number][] = [];
  for (let i = 0; i < 14; i++) lanes.push([Math.random() * W, 0.44 + Math.random() * 0.12, 18 + Math.random() * 50]);
  for (let x = 0; x < W; x++) {
    const mottle =
      0.6 +
      0.4 * Math.sin(x * 0.021) * Math.sin(x * 0.0073 + 1.2) +
      0.18 * Math.sin(x * 0.11 + 0.4) * Math.sin(x * 0.037);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      let b = Math.max(0, -Math.cos(v * Math.PI * 2));
      b = Math.pow(b, 1.6) * mottle;
      for (const [lx, lv, lw] of lanes) {
        const dx = Math.min(Math.abs(x - lx), W - Math.abs(x - lx)) / lw;
        const dv = (v - lv) / 0.05;
        b *= 1 - 0.75 * Math.exp(-(dx * dx + dv * dv));
      }
      const i = (y * W + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 226;
      img.data[i + 2] = 190;
      img.data[i + 3] = Math.round(Math.min(1, b) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Soft luminous ribbon behind the particle band — a textured torus seen
 *  from inside, additive and faint. Sits at the band's inclination. */
export function makeMilkyWayGlow(lite: boolean): MilkyWayGlowHandle {
  const group = new THREE.Group();
  group.name = 'milkyWayGlow';
  const tex = milkyGlowTexture();
  const geom = new THREE.TorusGeometry(305, 36, lite ? 14 : 24, lite ? 64 : 112);
  const BASE_OPACITY = 0.22;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  // Torus lies in XY; lay it into the ecliptic, then tilt to the band.
  mesh.rotation.x = 0.42 - Math.PI / 2;
  group.add(mesh);
  return {
    group,
    setFade(k) {
      mat.opacity = BASE_OPACITY * k;
      mesh.visible = k > 0.01;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

export interface NebulaeHandle {
  group: THREE.Group;
  setFade: (k: number) => void;
  dispose: () => void;
}

function nebulaTexture(r: number, g: number, b: number): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'lighter';
  const blob = (cx: number, cy: number, rx: number, ry: number, a: number, rot: number) => {
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},${a * 0.4})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(rx, ry);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  blob(s / 2, s / 2, s * 0.46, s * 0.4, 0.5, 0);
  for (let i = 0; i < 6; i++) {
    blob(
      s * (0.3 + Math.random() * 0.4),
      s * (0.3 + Math.random() * 0.4),
      s * (0.12 + Math.random() * 0.2),
      s * (0.08 + Math.random() * 0.14),
      0.22 + Math.random() * 0.2,
      Math.random() * Math.PI,
    );
  }
  // Fade hard to transparent at the sprite edge so no square ever shows.
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.5);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  return tex;
}

/** Two or three faint nebulae far behind the star shell, at staggered
 *  depths, for a sense of cosmic distance at the solar tier. */
export function makeNebulae(lite: boolean): NebulaeHandle {
  const group = new THREE.Group();
  group.name = 'nebulae';
  const specs = [
    { rgb: [255, 120, 190], dir: [0.62, 0.28, -0.73], r: 430, scale: 300, opacity: 0.16 },
    { rgb: [90, 150, 255], dir: [-0.55, -0.12, -0.83], r: 560, scale: 420, opacity: 0.13 },
    { rgb: [160, 95, 255], dir: [-0.2, 0.5, 0.84], r: 690, scale: 520, opacity: 0.11 },
  ].slice(0, lite ? 2 : 3);
  const items = specs.map((spec) => {
    const tex = nebulaTexture(spec.rgb[0], spec.rgb[1], spec.rgb[2]);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: spec.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(spec.dir[0], spec.dir[1], spec.dir[2]).normalize().multiplyScalar(spec.r);
    sprite.scale.setScalar(spec.scale);
    group.add(sprite);
    return { tex, mat, base: spec.opacity };
  });
  return {
    group,
    setFade(k) {
      for (const it of items) it.mat.opacity = it.base * k;
      group.visible = k > 0.01;
    },
    dispose() {
      for (const it of items) {
        it.mat.dispose();
        it.tex.dispose();
      }
    },
  };
}

/* ───────────────────────── saturn particle rings ───────────────────────── */
/**
 * Particle-based Saturn ring system matching the home-page hero look:
 * 4–18k tiny disks with Cassini + Encke gaps, banded warm palette,
 * Keplerian angular drift entirely on the GPU. Replaces the flat
 * RingGeometry mesh so the rings feel like millions of icy pebbles when
 * the camera orbits close to Saturn.
 */
export interface SaturnRingsHandle {
  group: THREE.Group;
  /** `simSec` — simulation seconds (epoch-relative), so ring motion tracks sim speed. */
  update: (simSec: number) => void;
  dispose: () => void;
}

export function makeSaturnParticleRings(saturnRadius: number, lite: boolean): SaturnRingsHandle {
  // ── Banded ring plane — carries the photoreal look ──────────────
  const meshInner = saturnRadius * 1.11;
  const meshOuter = saturnRadius * 2.33;
  const ringGeom = new THREE.RingGeometry(meshInner, meshOuter, 256, 1);
  // RingGeometry UVs are planar; remap radially so the strip texture reads
  // as concentric bands.
  const posAttr2 = ringGeom.getAttribute('position') as THREE.BufferAttribute;
  const uvAttr = ringGeom.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < posAttr2.count; i++) {
    const len = Math.hypot(posAttr2.getX(i), posAttr2.getY(i));
    uvAttr.setXY(i, (len - meshInner) / (meshOuter - meshInner), 0.5);
  }
  // Lit ring plane: sunlit face bright, unlit face dimmer (light scattered
  // through the ice), and Saturn's globe casts a hard shadow across it.
  // The Sun sits at the scene origin; the planet centre is the mesh origin.
  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: getSaturnRingStripTexture() },
      uPlanetRadius: { value: saturnRadius },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNrm;
      varying vec3 vCenter;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNrm = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vCenter = modelMatrix[3].xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uPlanetRadius;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNrm;
      varying vec3 vCenter;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.01) discard;
        vec3 toSun = normalize(-vWorldPos);
        float facing = dot(vWorldNrm, toSun);
        // Which face are we looking at, and is it the sunlit one?
        float front = gl_FrontFacing ? 1.0 : -1.0;
        float sunlit = step(0.0, facing * front);
        float lambert = abs(facing);
        float light = mix(0.16 + 0.34 * lambert, 0.28 + 0.9 * lambert, sunlit);
        // Planet shadow: ray from this ring point toward the Sun vs the globe.
        vec3 d = vWorldPos - vCenter;
        float b = dot(d, toSun);
        float c = dot(d, d) - uPlanetRadius * uPlanetRadius;
        float disc = b * b - c;
        float shadow = 1.0;
        if (disc > 0.0) {
          float tHit = -b + sqrt(disc);
          if (tHit > 0.0) shadow = 0.08 + 0.92 * (1.0 - smoothstep(0.0, uPlanetRadius * 0.06, sqrt(disc)));
        }
        gl_FragColor = vec4(tex.rgb * light * shadow, tex.a);
      }
    `,
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  ringMesh.rotation.x = -Math.PI / 2; // lie in the equatorial plane
  ringMesh.renderOrder = 1;

  // ── Sparse ice-particle sparkle on top (close-range depth cue) ──
  const RING_COUNT = lite ? 1500 : 4500;
  // Real ring extents: C ring inner edge 1.24 R♄ → A ring outer edge 2.27 R♄.
  const innerR = saturnRadius * 1.239;
  const outerR = saturnRadius * 2.270;

  const yJitter = new Float32Array(RING_COUNT);
  const colors = new Float32Array(RING_COUNT * 3);
  const sizes = new Float32Array(RING_COUNT);
  const radii = new Float32Array(RING_COUNT);
  const baseAngles = new Float32Array(RING_COUNT);

  const palette = [
    new THREE.Color('#f5dcb6'),
    new THREE.Color('#e7c08c'),
    new THREE.Color('#d49a5e'),
    new THREE.Color('#fff3da'),
    new THREE.Color('#a87444'),
  ];

  let filled = 0;
  while (filled < RING_COUNT) {
    const t = Math.pow(Math.random(), 0.85);
    const r = innerR + t * (outerR - innerR);
    // Cassini division: 1.95–1.99 R♄. Encke gap: 2.214 R♄, 325 km wide.
    const cassini = Math.abs(r - saturnRadius * 1.97);
    if (cassini < saturnRadius * 0.04 && Math.random() < 0.88) continue;
    const encke = Math.abs(r - saturnRadius * 2.214);
    if (encke < saturnRadius * 0.006 && Math.random() < 0.92) continue;
    radii[filled] = r;
    baseAngles[filled] = Math.random() * Math.PI * 2;
    yJitter[filled] = (Math.random() - 0.5) * saturnRadius * 0.012;
    const c = palette[Math.floor(Math.random() * palette.length)];
    const shade = 0.6 + Math.random() * 0.5;
    colors[filled * 3 + 0] = c.r * shade;
    colors[filled * 3 + 1] = c.g * shade;
    colors[filled * 3 + 2] = c.b * shade;
    sizes[filled] = saturnRadius * (0.012 + Math.random() * 0.036);
    filled += 1;
  }

  const positions = new Float32Array(RING_COUNT * 3);
  for (let i = 0; i < RING_COUNT; i++) positions[i * 3 + 1] = yJitter[i];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aBaseAngle', new THREE.BufferAttribute(baseAngles, 1));

  // Real ring dynamics: a particle at x Saturn radii orbits with period
  // T = 2π·√(x³·R³/GM) ≈ 4.2 h at the ring's inner edge. uOmegaScale folds the
  // scene-unit conversion in so the shader only needs pow(aRadius, -1.5).
  const RING_PERIOD_AT_1R_SEC = 15_096;
  const omegaScale = ((Math.PI * 2) / RING_PERIOD_AT_1R_SEC) * Math.pow(saturnRadius, 1.5);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
      uTime: { value: 0 },
      uOmegaScale: { value: omegaScale },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float aRadius;
      attribute float aBaseAngle;
      varying vec3 vColor;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uOmegaScale;
      void main() {
        vColor = color;
        float a = aBaseAngle + uOmegaScale * pow(aRadius, -1.5) * uTime;
        vec3 pos = vec3(cos(a) * aRadius, position.y, sin(a) * aRadius);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = max(1.0, size * uPixelRatio * (260.0 / max(0.0001, -mv.z)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, alpha * 0.4);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'saturnParticleRings';
  points.renderOrder = 2;

  const group = new THREE.Group();
  group.name = 'saturnParticleRingsGroup';
  group.add(ringMesh);
  group.add(points);

  return {
    group,
    update(simSec: number) {
      mat.uniforms.uTime.value = simSec;
    },
    dispose() {
      ringGeom.dispose();
      ringMat.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ───────────────────────── uranus rings ───────────────────────── */
/**
 * Uranus's narrow, dark ring system — a faint inner band plus the dominant
 * ε ring at its real 2.0 R♅ radius. Added as children of the planet mesh so
 * they pick up the real 82° tilt (rings nearly face-on to the orbit plane).
 */
export function makeUranusRings(planetRadius: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'uranusRings';
  const defs = [
    { inner: 1.64, outer: 1.95, color: 0x8fa3ad, opacity: 0.06 },
    { inner: 1.99, outer: 2.04, color: 0xaebfc9, opacity: 0.24 },
  ];
  for (const d of defs) {
    const geom = new THREE.RingGeometry(planetRadius * d.inner, planetRadius * d.outer, 96);
    const mat = new THREE.MeshBasicMaterial({
      color: d.color,
      transparent: true,
      opacity: d.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = Math.PI / 2;
    group.add(mesh);
  }
  return group;
}

/* ───────────────────────── auroras ───────────────────────── */
/**
 * Auroral ovals — glowing curtain cones ringing each magnetic pole, added as
 * children of the planet mesh so they inherit the real axial tilt and spin.
 * Earth's oval is offset ~11° from the spin axis (magnetic pole ≠ geographic
 * pole); the gas giants' ovals hug the poles tighter. Curtain rays drift
 * slowly and the whole oval breathes, like time-lapse footage from orbit.
 */
export interface AuroraHandle {
  group: THREE.Group;
  update: (dtSec: number) => void;
  dispose: () => void;
}

function auroraCurtainTexture(base: THREE.Color, top: THREE.Color): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    // Smooth pseudo-random ray brightness along the oval.
    const ray =
      0.45 +
      0.3 * Math.sin(x * 0.23) * Math.sin(x * 0.071 + 2.1) +
      0.25 * Math.sin(x * 0.53 + 0.7);
    for (let y = 0; y < h; y++) {
      const v = y / h; // 0 = top of curtain, 1 = base
      const heightFade = Math.pow(v, 1.6);           // bright at the base
      const r = base.r * v + top.r * (1 - v);
      const g = base.g * v + top.g * (1 - v);
      const b = base.b * v + top.b * (1 - v);
      const a = Math.max(0, ray) * heightFade;
      const i = (y * w + x) * 4;
      img.data[i] = r * 255;
      img.data[i + 1] = g * 255;
      img.data[i + 2] = b * 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = SRGB;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function makeAurora(
  planetRadius: number,
  opts: {
    color: number;
    topColor?: number;
    latitudeDeg?: number;
    magneticTiltDeg?: number;
    intensity?: number;
  },
): AuroraHandle {
  const group = new THREE.Group();
  group.name = 'aurora';
  const lat = THREE.MathUtils.degToRad(opts.latitudeDeg ?? 70);
  const intensity = opts.intensity ?? 0.55;
  const tex = auroraCurtainTexture(
    new THREE.Color(opts.color),
    new THREE.Color(opts.topColor ?? opts.color),
  );

  const ringR = planetRadius * Math.cos(lat);
  const baseY = planetRadius * Math.sin(lat);
  const height = planetRadius * 0.16;
  const mats: THREE.MeshBasicMaterial[] = [];
  for (const side of [1, -1]) {
    const geom = new THREE.CylinderGeometry(ringR * 0.88, ringR, height, 48, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: intensity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mats.push(mat);
    const curtain = new THREE.Mesh(geom, mat);
    curtain.position.y = side * (baseY + height * 0.4);
    if (side < 0) curtain.rotation.x = Math.PI;
    group.add(curtain);
  }

  // Magnetic axis offset from the spin axis.
  group.rotation.z = THREE.MathUtils.degToRad(opts.magneticTiltDeg ?? 0);

  let t = Math.random() * 10;
  return {
    group,
    update(dtSec: number) {
      t += dtSec;
      tex.offset.x = t * 0.012; // rays drift along the oval
      const breathe = 0.75 + 0.25 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1.2);
      for (const m of mats) m.opacity = intensity * breathe;
    },
    dispose() {
      for (const m of mats) m.dispose();
      group.children.forEach((ch) => {
        if (ch instanceof THREE.Mesh) ch.geometry.dispose();
      });
      tex.dispose();
    },
  };
}

/* ───────────────────────── earth rocket launch ───────────────────────── */
/**
 * A small rocket that lifts off from Earth every so often: vertical ascent,
 * gravity turn downrange (the real launch profile), engine plume + smoke
 * trail while burning, engine cutoff, then a quiet coast as it fades out.
 * Decorative and real-time — the canvas pins the group to Earth each frame.
 */
export interface EarthRocketHandle {
  group: THREE.Group;
  update: (dtSec: number) => void;
  dispose: () => void;
}

export function makeEarthRocket(earthRadius: number): EarthRocketHandle {
  const group = new THREE.Group();
  group.name = 'earthRocket';

  // Oversized relative to true scale (a real rocket would be sub-pixel) but
  // slim, so it reads as a launch vehicle rather than another moon.
  const L = earthRadius * 0.3;

  // ── Two-stage vehicle, built along +Z so lookAt() points it downrange ──
  const rocket = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xf2eee4, roughness: 0.5, metalness: 0.35, transparent: true,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x23262e, roughness: 0.65, metalness: 0.3, transparent: true,
  });
  // The booster gets its own materials so it can fade out on its own after
  // separation instead of hanging beside Earth like a stray moon.
  const s1WhiteMat = whiteMat.clone();
  const s1DarkMat = darkMat.clone();

  // First stage (booster) — its own group so it can separate mid-flight.
  const stage1 = new THREE.Group();
  const s1Body = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.052, L * 0.056, L * 0.46, 12), s1WhiteMat);
  s1Body.rotation.x = Math.PI / 2;
  stage1.add(s1Body);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.052, L * 0.036, L * 0.05, 10), s1DarkMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -L * 0.25;
  stage1.add(nozzle);
  // Four grid-fin stubs near the interstage.
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.012, L * 0.05, L * 0.04), s1DarkMat);
    const a = (i / 4) * Math.PI * 2;
    fin.position.set(Math.cos(a) * L * 0.06, Math.sin(a) * L * 0.06, L * 0.18);
    fin.rotation.z = a;
    stage1.add(fin);
  }
  stage1.position.z = -L * 0.14;
  rocket.add(stage1);

  // Interstage band + second stage + fairing.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.052, L * 0.052, L * 0.035, 12), darkMat);
  band.rotation.x = Math.PI / 2;
  band.position.z = L * 0.1;
  rocket.add(band);
  const s2Body = new THREE.Mesh(new THREE.CylinderGeometry(L * 0.048, L * 0.052, L * 0.2, 12), whiteMat);
  s2Body.rotation.x = Math.PI / 2;
  s2Body.position.z = L * 0.22;
  rocket.add(s2Body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(L * 0.048, L * 0.14, 12), whiteMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = L * 0.39;
  rocket.add(nose);
  group.add(rocket);

  // Engine exhaust — an elongated flame cone (bright at the nozzle, tapering
  // to a point behind, the way a real ascent plume reads) plus a hot glow
  // sprite right at the engine.
  const plumeTex = cometGlowSprite();
  const flameTex = flareJetTexture();
  const flameMat = new THREE.MeshBasicMaterial({
    map: flameTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const flameGeom = new THREE.ConeGeometry(L * 0.045, L * 0.55, 10, 1, true);
  const flame = new THREE.Mesh(flameGeom, flameMat);
  flame.rotation.x = -Math.PI / 2; // apex trails behind the nozzle
  flame.position.z = -L * 0.53;
  rocket.add(flame);
  const plumeGlowMat = new THREE.SpriteMaterial({
    map: plumeTex, color: new THREE.Color(1.0, 0.85, 0.6),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const plumeGlow = new THREE.Sprite(plumeGlowMat);
  plumeGlow.position.z = -L * 0.28;
  rocket.add(plumeGlow);

  // Booster-separation flash — a brief white pop at staging.
  const sepFlashMat = new THREE.SpriteMaterial({
    map: plumeTex, color: new THREE.Color(1.0, 1.0, 0.95),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sepFlash = new THREE.Sprite(sepFlashMat);
  group.add(sepFlash);

  // Liftoff flash at the pad.
  const padFlashMat = new THREE.SpriteMaterial({
    map: plumeTex, color: new THREE.Color(1.0, 0.85, 0.6),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const padFlash = new THREE.Sprite(padFlashMat);
  group.add(padFlash);

  // Smoke/exhaust trail — ring buffer of fading points.
  const TRAIL_N = 56;
  const trailPos = new Float32Array(TRAIL_N * 3);
  const trailCol = new Float32Array(TRAIL_N * 3);
  const trailAge = new Float32Array(TRAIL_N).fill(Infinity);
  let trailHead = 0;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  const trailMat = new THREE.PointsMaterial({
    map: plumeTex,
    size: L * 0.3,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  const trail = new THREE.Points(trailGeo, trailMat);
  group.add(trail);

  // Flight profile — a launch leaves Earth roughly every 15 seconds.
  const FLIGHT_DUR = 10;
  const BURN_FRAC = 0.62;
  const SEP_T = 0.45;      // booster separation (fraction of flight)
  let idleClock = 4;       // first launch shortly after load
  let flightT = -1;        // <0 idle, else seconds since liftoff
  let separated = false;
  let roll = 0;            // slow roll program during ascent
  const launchDir = new THREE.Vector3(0, 1, 0);
  const downrange = new THREE.Vector3(1, 0, 0);
  const dir = new THREE.Vector3();
  const posNow = new THREE.Vector3();
  const posNext = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const sepPos = new THREE.Vector3();
  const sepVel = new THREE.Vector3();
  let emitAcc = 0;

  const flightPos = (t: number, out: THREE.Vector3) => {
    // Vertical rise blending into a downrange arc — a gravity turn.
    const alt = earthRadius * (1.02 + 2.8 * Math.pow(t, 1.55));
    const phi = 1.9 * t * t;
    dir.copy(launchDir).multiplyScalar(Math.cos(phi)).addScaledVector(downrange, Math.sin(phi)).normalize();
    return out.copy(dir).multiplyScalar(alt);
  };

  const beginFlight = () => {
    flightT = 0;
    separated = false;
    roll = 0;
    // Random launch site; downrange direction is any perpendicular ("east").
    launchDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    downrange.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .cross(launchDir).normalize();
    trailAge.fill(Infinity);
    // Re-attach the booster for the next flight.
    stage1.visible = true;
    if (stage1.parent !== rocket) rocket.add(stage1);
    stage1.position.set(0, 0, -L * 0.14);
    stage1.rotation.set(0, 0, 0);
    whiteMat.opacity = 1;
    darkMat.opacity = 1;
    s1WhiteMat.opacity = 1;
    s1DarkMat.opacity = 1;
    flame.position.z = -L * 0.53;
    plumeGlow.position.z = -L * 0.28;
    flightPos(0, posNow);
    padFlash.position.copy(posNow);
    padFlash.scale.setScalar(L * 0.9);
    rocket.visible = true;
  };

  rocket.visible = false;

  return {
    group,
    update(dtSec: number) {
      // Age the trail regardless of flight state so smoke keeps dissolving.
      for (let i = 0; i < TRAIL_N; i++) {
        trailAge[i] += dtSec;
        const fade = Math.max(0, 1 - trailAge[i] / 3.2);
        const warm = Math.min(1, trailAge[i] * 2); // orange → gray smoke
        trailCol[i * 3] = fade * (1 - warm * 0.45);
        trailCol[i * 3 + 1] = fade * (0.78 - warm * 0.3);
        trailCol[i * 3 + 2] = fade * (0.55 - warm * 0.1);
      }
      (trailGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

      if (flightT < 0) {
        idleClock -= dtSec;
        if (idleClock <= 0) beginFlight();
        return;
      }

      flightT += dtSec;
      const t = flightT / FLIGHT_DUR;
      if (t >= 1) {
        flightT = -1;
        // ~15 s cadence: 10 s flight + ~5 s turnaround.
        idleClock = 4.5 + Math.random();
        rocket.visible = false;
        stage1.visible = false;
        flameMat.opacity = 0;
        plumeGlowMat.opacity = 0;
        padFlashMat.opacity = 0;
        sepFlashMat.opacity = 0;
        return;
      }

      flightPos(t, posNow);
      flightPos(Math.min(1, t + 0.01), posNext);
      rocket.position.copy(posNow);
      // lookAt works in world space — offset by the group's world position.
      group.getWorldPosition(lookTarget);
      lookTarget.add(posNext);
      rocket.lookAt(lookTarget);
      // Slow roll program after clearing the pad — lookAt resets orientation
      // every frame, so the accumulated roll is re-applied on top of it.
      if (t > 0.06) roll += dtSec * 0.55;
      rocket.rotateZ(roll);

      // Booster separation: white staging pop, detach, tumble, fade fast.
      if (!separated && t >= SEP_T) {
        separated = true;
        stage1.getWorldPosition(sepPos);
        group.worldToLocal(sepPos);
        sepVel.copy(posNext).sub(posNow).normalize().multiplyScalar(earthRadius * 0.55);
        group.add(stage1);
        stage1.position.copy(sepPos);
        sepFlash.position.copy(sepPos);
        sepFlash.scale.setScalar(L * 0.5);
        sepFlashMat.opacity = 0.9;
        // The vacuum engine on the second stage takes over — move the
        // exhaust up to its nozzle.
        flame.position.z = -L * 0.2;
        plumeGlow.position.z = L * 0.06;
      }
      sepFlashMat.opacity = Math.max(0, sepFlashMat.opacity - dtSec * 2.6);
      if (separated && stage1.visible) {
        const tau = flightT - SEP_T * FLIGHT_DUR;
        // Coast forward while gravity bends it back toward Earth; gone in a
        // couple of seconds so it never reads as a second moon.
        stage1.position.copy(sepPos)
          .addScaledVector(sepVel, tau * Math.max(0.15, 1 - tau * 0.22))
          .addScaledVector(posNow.clone().normalize(), -earthRadius * 0.05 * tau * tau);
        stage1.rotation.x += dtSec * 1.6;
        stage1.rotation.y += dtSec * 0.9;
        const s1Fade = Math.max(0, 1 - tau / 2.0);
        s1WhiteMat.opacity = s1Fade;
        s1DarkMat.opacity = s1Fade;
        if (tau > 2.0) stage1.visible = false;
      }

      const burning = t < BURN_FRAC;
      const fade = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
      whiteMat.opacity = fade;
      darkMat.opacity = fade;
      if (!separated) {
        s1WhiteMat.opacity = fade;
        s1DarkMat.opacity = fade;
      }
      // Flame flickers in length and brightness while the engine burns.
      flameMat.opacity = burning ? 0.75 + Math.random() * 0.25 : 0;
      const flick = burning ? 0.85 + Math.random() * 0.3 : 0.001;
      flame.scale.set(0.92 + Math.random() * 0.16, flick, 0.92 + Math.random() * 0.16);
      plumeGlowMat.opacity = burning ? 0.6 + Math.random() * 0.25 : 0;
      plumeGlow.scale.setScalar(L * 0.28 * flick);
      // Pad flash decays over the first second of flight.
      padFlashMat.opacity = Math.max(0, 0.9 - flightT * 1.1);

      if (burning) {
        emitAcc += dtSec;
        // Drop a smoke puff every ~90 ms of burn.
        while (emitAcc > 0.09) {
          emitAcc -= 0.09;
          trailPos[trailHead * 3] = posNow.x;
          trailPos[trailHead * 3 + 1] = posNow.y;
          trailPos[trailHead * 3 + 2] = posNow.z;
          trailAge[trailHead] = 0;
          trailHead = (trailHead + 1) % TRAIL_N;
        }
        (trailGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    },
    dispose() {
      rocket.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      stage1.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      whiteMat.dispose();
      darkMat.dispose();
      s1WhiteMat.dispose();
      s1DarkMat.dispose();
      flameGeom.dispose();
      flameMat.dispose();
      flameTex.dispose();
      plumeGlowMat.dispose();
      padFlashMat.dispose();
      sepFlashMat.dispose();
      plumeTex.dispose();
      trailGeo.dispose();
      trailMat.dispose();
    },
  };
}

/* ───────────────────────── earth satellites ───────────────────────── */
/**
 * The real hardware around Earth — the ISS, Hubble, smallsats, a navigation
 * bird in MEO, a geostationary relay, and JWST holding station at the
 * Sun–Earth L2 point on the planet's shadow side. Deliberately tiny (the
 * station spans ~1/6 of the Moon's diameter here) and hugging the planet on
 * faint orbit rings, so they read as spacecraft, never as extra moons. The
 * named ones carry small mono labels. Epoch-driven like everything else.
 */
export interface EarthSatellitesHandle {
  group: THREE.Group;
  /** The station node (local to `group`) and its collision radius. */
  station: THREE.Group;
  stationRadius: number;
  /** `earthPos` — Earth's heliocentric scene position (fixes JWST on the
   *  anti-sunward Sun–Earth line; the Sun sits at the scene origin). */
  update: (epochMs: number, earthPos: THREE.Vector3) => void;
  dispose: () => void;
}

interface SatSpec {
  kind: 'station' | 'telescope' | 'smallsat' | 'nav' | 'geo' | 'jwst';
  label?: string;
  distMul: number;   // orbit radius ÷ Earth radius (compressed like the Moon)
  periodMin: number; // real orbital period in minutes
  incl: number;      // rad — 51.6° for the station, polar for one smallsat
  node: number;      // rad
  phase: number;     // rad
}

const SAT_SPECS: SatSpec[] = [
  { kind: 'station',   label: 'ISS',    distMul: 1.14, periodMin: 92,   incl: 0.90, node: 0.3, phase: 0.0 },
  { kind: 'telescope', label: 'HUBBLE', distMul: 1.2,  periodMin: 95,   incl: 0.50, node: 2.1, phase: 2.2 },
  { kind: 'smallsat',  distMul: 1.26, periodMin: 100,  incl: 1.70, node: 0.9, phase: 4.1 },
  { kind: 'nav',       distMul: 2.05, periodMin: 718,  incl: 0.96, node: 1.5, phase: 1.0 },
  { kind: 'smallsat',  distMul: 1.17, periodMin: 96,   incl: 0.60, node: 4.2, phase: 5.3 },
  { kind: 'smallsat',  distMul: 1.32, periodMin: 104,  incl: 0.20, node: 5.1, phase: 0.7 },
  { kind: 'geo',       distMul: 3.1,  periodMin: 1436, incl: 0.02, node: 0.0, phase: 3.0 },
  // JWST — no geocentric orbit; it rides the Sun–Earth line at L2, tracing
  // a slow halo loop around the point. periodMin here is the halo period.
  { kind: 'jwst', label: 'JWST', distMul: 5.8, periodMin: 6 * 30 * 24 * 60, incl: 0, node: 0, phase: 0 },
];

function satLabelSprite(text: string, earthRadius: number): {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  tex: THREE.CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '500 30px "JetBrains Mono", "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(196,210,236,0.9)';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = SRGB;
  // depthTest stays ON so a label ducks behind Earth with its satellite
  // instead of floating over the planet's disk.
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.9, depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(earthRadius * 1.1, earthRadius * 0.275, 1);
  sprite.center.set(0.5, -0.6); // float just above the spacecraft
  return { sprite, mat, tex };
}

export function makeEarthSatellites(earthRadius: number, lite: boolean): EarthSatellitesHandle {
  const group = new THREE.Group();
  group.name = 'earthSatellites';

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xcfd6dd, roughness: 0.35, metalness: 0.8,
  });
  const foilMat = new THREE.MeshStandardMaterial({
    color: 0xc8a24a, roughness: 0.45, metalness: 0.85,
  });
  // Solar panels glint faintly so satellites stay findable on the night side.
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x1c2f6e, roughness: 0.4, metalness: 0.5,
    emissive: 0x16255a, emissiveIntensity: 0.55,
  });

  const b = earthRadius * 0.02; // base module size

  const buildSat = (kind: SatSpec['kind']): THREE.Group => {
    const g = new THREE.Group();
    if (kind === 'station') {
      // Truss with two double solar wings — the classic station silhouette.
      const truss = new THREE.Mesh(new THREE.BoxGeometry(b * 2.6, b * 0.24, b * 0.24), bodyMat);
      g.add(truss);
      const hab = new THREE.Mesh(new THREE.CylinderGeometry(b * 0.22, b * 0.22, b * 1.1, 8), bodyMat);
      hab.rotation.x = Math.PI / 2;
      g.add(hab);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.BoxGeometry(b * 0.9, b * 0.02, b * 0.55), panelMat);
          wing.position.set(sx * b * 1.05, 0, sz * b * 0.42);
          g.add(wing);
        }
      }
    } else if (kind === 'telescope') {
      // Hubble: silver tube, foil aft shroud, two flat panels.
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(b * 0.28, b * 0.28, b * 1.15, 10), bodyMat);
      tube.rotation.z = 0.5;
      g.add(tube);
      const aft = new THREE.Mesh(new THREE.CylinderGeometry(b * 0.3, b * 0.3, b * 0.35, 10), foilMat);
      aft.rotation.z = 0.5;
      aft.position.set(Math.sin(0.5) * b * 0.42, -Math.cos(0.5) * b * 0.42, 0);
      g.add(aft);
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(b * 0.05, b * 0.5, b * 0.8), panelMat);
        wing.position.set(s * b * 0.42, 0, 0);
        g.add(wing);
      }
    } else if (kind === 'jwst') {
      // JWST: gold hex mirror stack on a silver kite sunshield.
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xd9b24a, roughness: 0.25, metalness: 1.0,
        emissive: 0x6a541e, emissiveIntensity: 0.35,
      });
      const mirror = new THREE.Mesh(new THREE.CylinderGeometry(b * 0.34, b * 0.34, b * 0.05, 6), goldMat);
      mirror.position.y = b * 0.16;
      g.add(mirror);
      const shieldMat = new THREE.MeshStandardMaterial({
        color: 0xd8dcec, roughness: 0.35, metalness: 0.75, side: THREE.DoubleSide,
      });
      const shield = new THREE.Mesh(new THREE.PlaneGeometry(b * 1.1, b * 0.65), shieldMat);
      shield.rotation.x = -Math.PI / 2;
      g.add(shield);
    } else if (kind === 'nav' || kind === 'geo') {
      // Boxy bus with a long twin-panel span.
      const bus = new THREE.Mesh(new THREE.BoxGeometry(b * 0.5, b * 0.5, b * 0.5), kind === 'geo' ? foilMat : bodyMat);
      g.add(bus);
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(b * 1.3, b * 0.02, b * 0.4), panelMat);
        wing.position.x = s * b * 0.92;
        g.add(wing);
      }
    } else {
      // Smallsat — a shoebox with one panel wing.
      const bus = new THREE.Mesh(new THREE.BoxGeometry(b * 0.3, b * 0.2, b * 0.42), bodyMat);
      g.add(bus);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(b * 0.75, b * 0.015, b * 0.36), panelMat);
      wing.position.x = b * 0.5;
      g.add(wing);
    }
    return g;
  };

  const specs = lite
    ? SAT_SPECS.filter((s) => s.label || s.kind === 'geo')
    : SAT_SPECS;
  const recs: { node: THREE.Group; spec: SatSpec }[] = [];
  const ringGeos: THREE.BufferGeometry[] = [];
  const labelTextures: THREE.CanvasTexture[] = [];
  const labelMats: THREE.SpriteMaterial[] = [];
  const ringMat = new THREE.LineBasicMaterial({
    color: 0x8fa8d8, transparent: true, opacity: 0.07, depthWrite: false,
  });

  for (const spec of specs) {
    const node = buildSat(spec.kind);
    group.add(node);
    recs.push({ node, spec });

    if (spec.label) {
      const { sprite, mat, tex } = satLabelSprite(spec.label, earthRadius);
      labelTextures.push(tex);
      labelMats.push(mat);
      node.add(sprite);
    }

    // JWST holds the L2 point — no geocentric orbit ring to draw.
    if (spec.kind === 'jwst') continue;

    // Faint orbit ring — instantly says "spacecraft", not "moon".
    const SEG = 72;
    const pts = new Float32Array(SEG * 3);
    const r = earthRadius * spec.distMul;
    const sinI = Math.sin(spec.incl);
    const cosI = Math.cos(spec.incl);
    const sinN = Math.sin(spec.node);
    const cosN = Math.cos(spec.node);
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y2 = -z * sinI;
      const z2 = z * cosI;
      pts[i * 3] = x * cosN - z2 * sinN;
      pts[i * 3 + 1] = y2;
      pts[i * 3 + 2] = x * sinN + z2 * cosN;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    ringGeos.push(rg);
    group.add(new THREE.LineLoop(rg, ringMat));
  }

  const antiSun = new THREE.Vector3();
  const haloA = new THREE.Vector3();
  const haloB = new THREE.Vector3();

  const stationRec = recs.find((r) => r.spec.kind === 'station') ?? recs[0];

  return {
    group,
    station: stationRec.node,
    stationRadius: b * 1.3,
    update(epochMs: number, earthPos: THREE.Vector3) {
      for (const { node, spec } of recs) {
        if (spec.kind === 'jwst') {
          // L2 sits on the Sun–Earth line beyond Earth (Sun at the origin),
          // and the observatory traces a slow halo loop around the point.
          antiSun.copy(earthPos).normalize();
          const haloAng = (epochMs / (spec.periodMin * 60_000)) * Math.PI * 2;
          // Perpendicular frame for the halo circle.
          haloA.set(-antiSun.z, 0, antiSun.x).normalize();
          haloB.crossVectors(antiSun, haloA);
          node.position.copy(antiSun).multiplyScalar(earthRadius * spec.distMul)
            .addScaledVector(haloA, Math.cos(haloAng) * earthRadius * 0.5)
            .addScaledVector(haloB, Math.sin(haloAng) * earthRadius * 0.5);
          // Sunshield squarely between the mirror and the Sun.
          node.lookAt(node.position.x + antiSun.x, node.position.y + antiSun.y, node.position.z + antiSun.z);
          continue;
        }
        const a = spec.phase + (epochMs / (spec.periodMin * 60_000)) * Math.PI * 2;
        const r = earthRadius * spec.distMul;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y2 = -z * Math.sin(spec.incl);
        const z2 = z * Math.cos(spec.incl);
        node.position.set(
          x * Math.cos(spec.node) - z2 * Math.sin(spec.node),
          y2,
          x * Math.sin(spec.node) + z2 * Math.cos(spec.node),
        );
        // Keep the same face (and panel span) oriented along the orbit.
        node.rotation.y = -a;
      }
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else (m as THREE.Material).dispose();
        }
      });
      ringGeos.forEach((g) => g.dispose());
      ringMat.dispose();
      bodyMat.dispose();
      foilMat.dispose();
      panelMat.dispose();
      labelMats.forEach((m) => m.dispose());
      labelTextures.forEach((t) => t.dispose());
    },
  };
}

/* ───────────────────────── meteors over earth ───────────────────────── */
/**
 * Sporadic meteors burning up in Earth's upper atmosphere — the view a crew
 * on orbit actually gets: a white-hot head streaking along a great circle
 * just above the limb, leaving a short incandescent train that cools from
 * white through orange, then a final flare as the rock ablates away.
 * Real-time and decorative, like the rocket and the lightning.
 */
export interface MeteorsHandle {
  group: THREE.Group;
  update: (dtSec: number) => void;
  dispose: () => void;
}

export function makeMeteors(earthRadius: number): MeteorsHandle {
  const group = new THREE.Group();
  group.name = 'earthMeteors';

  const R = earthRadius * 1.05; // burn-up altitude, just above the clouds
  const tex = cometGlowSprite();

  interface Meteor {
    head: THREE.Sprite;
    headMat: THREE.SpriteMaterial;
    trail: THREE.Points;
    trailGeo: THREE.BufferGeometry;
    trailMat: THREE.PointsMaterial;
    trailAges: Float32Array;
    trailHead: number;
    n: THREE.Vector3;      // entry point normal
    tdir: THREE.Vector3;   // flight direction (tangent)
    age: number;           // <0 = idle
    dur: number;
    wait: number;
    emitAcc: number;
  }

  const TRAIL_N = 10;
  const meteors: Meteor[] = [];
  for (let i = 0; i < 2; i++) {
    const headMat = new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(1.0, 0.98, 0.92),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const head = new THREE.Sprite(headMat);
    head.scale.setScalar(earthRadius * 0.05);
    group.add(head);

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
    const trailMat = new THREE.PointsMaterial({
      map: tex, size: earthRadius * 0.04, vertexColors: true, transparent: true,
      opacity: 0.9, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    group.add(trail);

    meteors.push({
      head, headMat, trail, trailGeo, trailMat,
      trailAges: new Float32Array(TRAIL_N).fill(Infinity),
      trailHead: 0,
      n: new THREE.Vector3(),
      tdir: new THREE.Vector3(),
      age: -1,
      dur: 0.8,
      wait: 2 + i * 5 + Math.random() * 4,
      emitAcc: 0,
    });
  }

  const pos = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  const headPos = (m: Meteor, out: THREE.Vector3) => {
    // Great-circle streak: ~0.9 rad of arc across the visible limb.
    const a = (m.age / m.dur) * 0.9;
    return out.copy(m.n).multiplyScalar(Math.cos(a)).addScaledVector(m.tdir, Math.sin(a)).multiplyScalar(R);
  };

  return {
    group,
    update(dtSec: number) {
      for (const m of meteors) {
        // Trail cools white → orange → gone in ~0.45 s.
        const tp = m.trailGeo.getAttribute('position') as THREE.BufferAttribute;
        const tc = m.trailGeo.getAttribute('color') as THREE.BufferAttribute;
        for (let i = 0; i < TRAIL_N; i++) {
          m.trailAges[i] += dtSec;
          const fade = Math.max(0, 1 - m.trailAges[i] / 0.45);
          const cool = Math.min(1, m.trailAges[i] * 4);
          tc.setXYZ(i, fade, fade * (0.95 - cool * 0.4), fade * (0.85 - cool * 0.6));
        }
        tc.needsUpdate = true;

        if (m.age < 0) {
          m.wait -= dtSec;
          if (m.wait <= 0) {
            m.age = 0;
            m.dur = 0.6 + Math.random() * 0.5;
            m.n.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
            m.tdir.crossVectors(m.n, tmp).normalize();
            m.trailAges.fill(Infinity);
          }
          continue;
        }

        m.age += dtSec;
        if (m.age >= m.dur) {
          m.age = -1;
          m.wait = 3 + Math.random() * 6;
          m.headMat.opacity = 0;
          continue;
        }

        headPos(m, pos);
        m.head.position.copy(pos);
        const k = m.age / m.dur;
        // Ramp in fast, flare briefly at the end as the meteoroid breaks up.
        const flare = k > 0.82 ? 1.6 - (k - 0.82) * 4 : 1;
        m.headMat.opacity = Math.min(1, k * 8) * (1 - k) * 1.4 * flare;
        m.head.scale.setScalar(earthRadius * (0.04 + 0.03 * flare));

        m.emitAcc += dtSec;
        while (m.emitAcc > 0.03) {
          m.emitAcc -= 0.03;
          tp.setXYZ(m.trailHead, pos.x, pos.y, pos.z);
          m.trailAges[m.trailHead] = 0;
          m.trailHead = (m.trailHead + 1) % TRAIL_N;
        }
        tp.needsUpdate = true;
      }
    },
    dispose() {
      for (const m of meteors) {
        m.headMat.dispose();
        m.trailGeo.dispose();
        m.trailMat.dispose();
      }
      tex.dispose();
    },
  };
}

/* ───────────────────────── planetary moons ───────────────────────── */
/**
 * Named moons for the outer/terrestrial giants — Earth keeps its dedicated
 * Moon in `makeEarthExtras`; this covers everyone else. Each moon orbits in a
 * per-planet sub-group that the canvas keeps pinned to its planet's position,
 * so the moons follow the planet around the Sun without inheriting its spin.
 * Distances/radii are visually compressed (true ratios would put most moons
 * inside the planet sprite or off-screen) but the relative ordering, colour,
 * and Triton's retrograde motion are real.
 */
interface MoonSpec {
  planet: SolarBodyId;
  name: string;
  radiusMul: number;    // moon radius ÷ planet radius
  distMul: number;      // orbit radius ÷ planet radius
  inclination: number;  // rad
  phase: number;        // rad
  /** True sidereal orbital period in days (negative = retrograde). */
  periodDays: number;
  color: number;
  roughness: number;
}

const MOON_SPECS: MoonSpec[] = [
  // Mars — Phobos laps Mars 3×/day, faster than Mars rotates.
  { planet: 'mars', name: 'Phobos', radiusMul: 0.09, distMul: 1.9, inclination: 0.02, phase: 0.0, periodDays: 0.3189, color: 0x8a7d6e, roughness: 0.95 },
  { planet: 'mars', name: 'Deimos', radiusMul: 0.06, distMul: 2.7, inclination: 0.03, phase: 1.4, periodDays: 1.2624, color: 0x9b8d7c, roughness: 0.95 },
  // Jupiter — Galilean moons in their real 1:2:4 Laplace resonance.
  { planet: 'jupiter', name: 'Io',       radiusMul: 0.026, distMul: 1.7, inclination: 0.02, phase: 0.3, periodDays: 1.7691, color: 0xe6d24a, roughness: 0.80 },
  { planet: 'jupiter', name: 'Europa',   radiusMul: 0.022, distMul: 2.1, inclination: 0.02, phase: 2.0, periodDays: 3.5512, color: 0xd9cebb, roughness: 0.55 },
  { planet: 'jupiter', name: 'Ganymede', radiusMul: 0.037, distMul: 2.8, inclination: 0.03, phase: 3.6, periodDays: 7.1546, color: 0xa69884, roughness: 0.80 },
  { planet: 'jupiter', name: 'Callisto', radiusMul: 0.034, distMul: 3.7, inclination: 0.04, phase: 5.0, periodDays: 16.689, color: 0x726658, roughness: 0.90 },
  // Saturn — moons orbit clear of the rings (outer ring ≈ 2.27× radius)
  { planet: 'saturn', name: 'Titan', radiusMul: 0.040, distMul: 3.4, inclination: 0.05, phase: 0.8, periodDays: 15.945, color: 0xd1933a, roughness: 0.70 },
  { planet: 'saturn', name: 'Rhea',  radiusMul: 0.015, distMul: 2.8, inclination: 0.04, phase: 2.6, periodDays: 4.5182, color: 0xc7c0b2, roughness: 0.85 },
  // Uranus
  { planet: 'uranus', name: 'Titania', radiusMul: 0.030, distMul: 2.4, inclination: 0.06, phase: 1.0, periodDays: 8.7062, color: 0x9fb1b5, roughness: 0.85 },
  { planet: 'uranus', name: 'Oberon',  radiusMul: 0.028, distMul: 3.1, inclination: 0.06, phase: 3.3, periodDays: 13.463, color: 0x8b969a, roughness: 0.85 },
  // Neptune — Triton orbits retrograde
  { planet: 'neptune', name: 'Triton', radiusMul: 0.035, distMul: 2.6, inclination: 0.35, phase: 0.5, periodDays: -5.877, color: 0xd7c5c0, roughness: 0.70 },
  // Pluto — Charon is huge relative to its primary
  { planet: 'pluto', name: 'Charon', radiusMul: 0.50, distMul: 2.9, inclination: 0.20, phase: 1.2, periodDays: 6.3873, color: 0xb3a698, roughness: 0.90 },
];

export interface PlanetMoonsHandle {
  group: THREE.Group;
  /** Every moon with its planet, mesh (local to the planet's sub-group) and radius. */
  moons: { name: string; planet: SolarBodyId; mesh: THREE.Mesh; radius: number }[];
  /** Pins each planet's moon sub-group to its planet, then places every moon
   *  at its epoch-accurate orbital phase (real sidereal periods). */
  update: (epochMs: number, planetPos: (id: SolarBodyId) => THREE.Vector3 | null | undefined) => void;
  dispose: () => void;
}

export function makePlanetMoons(lite: boolean): PlanetMoonsHandle {
  const group = new THREE.Group();
  group.name = 'planetMoons';
  const segs = lite ? 16 : 24;

  const subgroups = new Map<SolarBodyId, THREE.Group>();
  const recs: { mesh: THREE.Mesh; spec: MoonSpec }[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  for (const spec of MOON_SPECS) {
    let sub = subgroups.get(spec.planet);
    if (!sub) {
      sub = new THREE.Group();
      sub.visible = false;
      subgroups.set(spec.planet, sub);
      group.add(sub);
    }
    const pr = worldRadiusForBody(spec.planet);
    const geom = new THREE.SphereGeometry(pr * spec.radiusMul, segs, segs);
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: 0.02,
    });
    geoms.push(geom);
    mats.push(mat);
    const mesh = new THREE.Mesh(geom, mat);
    sub.add(mesh);
    recs.push({ mesh, spec });
  }

  return {
    group,
    moons: recs.map((r) => ({
      name: r.spec.name,
      planet: r.spec.planet,
      mesh: r.mesh,
      radius: worldRadiusForBody(r.spec.planet) * r.spec.radiusMul,
    })),
    update(epochMs, planetPos) {
      subgroups.forEach((sub, id) => {
        const p = planetPos(id);
        if (p) {
          sub.visible = true;
          sub.position.copy(p);
        } else {
          sub.visible = false;
        }
      });
      for (const rec of recs) {
        const theta = rec.spec.phase + (epochMs / (Math.abs(rec.spec.periodDays) * MS_DAY)) * Math.PI * 2 * Math.sign(rec.spec.periodDays);
        const pr = worldRadiusForBody(rec.spec.planet);
        const r = pr * rec.spec.distMul;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const sinI = Math.sin(rec.spec.inclination);
        const cosI = Math.cos(rec.spec.inclination);
        // Tilt the in-plane point about the X axis by the orbital inclination.
        rec.mesh.position.set(x, -z * sinI, z * cosI);
        rec.mesh.rotation.y = -theta; // tidally locked — same face toward the planet
      }
    },
    dispose() {
      geoms.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}

/* ───────────────────────── comet ───────────────────────── */
/**
 * A single bright comet on a steep eccentric orbit through the inner system.
 * Nucleus + glowing coma + a two-component (blue ion / cream dust) particle
 * tail. The tail is re-oriented every frame to point directly away from the
 * Sun and grows + brightens near perihelion — both real comet behaviours.
 */
export interface CometHandle {
  group: THREE.Group;
  update: (epochMs: number, sunPos: THREE.Vector3) => void;
  dispose: () => void;
}

function cometGlowSprite(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(224,242,255,0.95)');
  grad.addColorStop(0.3, 'rgba(150,200,255,0.45)');
  grad.addColorStop(1, 'rgba(120,170,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB;
  return t;
}

export function makeComet(mode: ScaleMode, lite: boolean): CometHandle {
  const group = new THREE.Group();
  group.name = 'comet';

  // Keplerian elements (AU) — a bright short-period comet on a steep orbit.
  const aAu = 2.4;
  const e = 0.74;
  const inc = 0.5;
  const node = 0.9;
  const cosN = Math.cos(node);
  const sinN = Math.sin(node);
  const sinI = Math.sin(inc);
  const cosI = Math.cos(inc);
  const periodMs = Math.pow(aAu, 1.5) * 365.256 * MS_DAY; // Kepler's third law
  const perihelionAu = aAu * (1 - e);
  const a = sceneRadiusFromAu(aAu, mode); // for sizing the tail/coma only

  /** True anomaly at `epochMs` — mean anomaly → Newton-solved eccentric anomaly. */
  const trueAnomalyAt = (epochMs: number): number => {
    const M = ((epochMs % periodMs) / periodMs) * Math.PI * 2;
    let E = M;
    for (let i = 0; i < 6; i++) {
      E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    return 2 * Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2),
    );
  };

  /** Scene position for true anomaly `theta`; also reports the AU distance. */
  const orbitPos = (theta: number, out: THREE.Vector3): { rAu: number } => {
    const rAu = (aAu * (1 - e * e)) / (1 + e * Math.cos(theta));
    const r = sceneRadiusFromAu(rAu, mode);
    const xp = Math.cos(theta) * r;
    const zp = Math.sin(theta) * r;
    // Tilt about X by inclination, then rotate about Y by the node longitude.
    const y = -zp * sinI;
    const z = zp * cosI;
    out.set(xp * cosN - z * sinN, y, xp * sinN + z * cosN);
    return { rAu };
  };

  // Nucleus — small dim icy body.
  const nucGeo = new THREE.SphereGeometry(Math.max(0.012, a * 0.006), 16, 16);
  const nucMat = new THREE.MeshStandardMaterial({
    color: 0x9fb6c8,
    roughness: 0.85,
    metalness: 0.05,
    emissive: 0x223344,
    emissiveIntensity: 0.4,
  });
  const nucleus = new THREE.Mesh(nucGeo, nucMat);
  group.add(nucleus);

  // Coma — additive sprite centred on the nucleus.
  const glowTex = cometGlowSprite();
  const coma = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const comaBase = Math.max(0.08, a * 0.05);
  coma.scale.setScalar(comaBase);
  group.add(coma);

  // Two distinct tails, the way real comets carry them: a straight narrow
  // blue ion tail blown directly anti-sunward by the solar wind, and a
  // wider cream dust tail that lags behind along the orbit. Particles are
  // baked along local +X; each group is oriented every frame.
  const baseLen = a * 0.55;
  const tailSprite = diskSprite();
  const makeTail = (
    n: number,
    len: number,
    width: number,
    rgb: [number, number, number],
  ) => {
    const p = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = Math.pow(Math.random(), 0.7); // denser toward the nucleus
      p[i * 3] = t * len;
      p[i * 3 + 1] = (Math.random() - 0.5) * width * (0.2 + t);
      p[i * 3 + 2] = (Math.random() - 0.5) * width * (0.2 + t);
      const fade = (1 - t) * 0.9 + 0.1;
      col[i * 3] = rgb[0] * fade;
      col[i * 3 + 1] = rgb[1] * fade;
      col[i * 3 + 2] = rgb[2] * fade;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      map: tailSprite,
      size: a * 0.02,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01,
    });
    const grp = new THREE.Group();
    grp.add(new THREE.Points(geo, mat));
    group.add(grp);
    return { grp, geo, mat };
  };
  const ionTail = makeTail(lite ? 160 : 340, baseLen * 1.15, baseLen * 0.035, [0.5, 0.7, 1.0]);
  const dustTail = makeTail(lite ? 220 : 480, baseLen * 0.85, baseLen * 0.09, [0.95, 0.9, 0.7]);

  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const qDust = new THREE.Quaternion();
  const qLag = new THREE.Quaternion();

  return {
    group,
    update(epochMs, sunPos) {
      const theta = trueAnomalyAt(epochMs);
      const { rAu } = orbitPos(theta, tmp);
      group.position.copy(tmp);

      // Ion tail points dead anti-sunward; the dust tail lags ~14° behind
      // it toward the orbit just travelled. Length + brightness scale with
      // the real heliocentric distance (strongest at perihelion).
      dir.copy(tmp).sub(sunPos).normalize();
      q.setFromUnitVectors(xAxis, dir);
      ionTail.grp.quaternion.copy(q);
      qLag.setFromAxisAngle(yAxis, 0.24);
      qDust.copy(q).multiply(qLag);
      dustTail.grp.quaternion.copy(qDust);

      const lenF = THREE.MathUtils.clamp((perihelionAu / rAu) * 1.1, 0.45, 1.8);
      ionTail.grp.scale.setScalar(lenF);
      dustTail.grp.scale.setScalar(lenF * 0.9);
      const bright = THREE.MathUtils.clamp(perihelionAu / rAu, 0.2, 1.0);
      (coma.material as THREE.SpriteMaterial).opacity = 0.35 + bright * 0.55;
      coma.scale.setScalar(comaBase * (0.7 + bright * 0.7));
      ionTail.mat.opacity = 0.3 + bright * 0.55;
      dustTail.mat.opacity = 0.25 + bright * 0.5;
    },
    dispose() {
      nucGeo.dispose();
      nucMat.dispose();
      (coma.material as THREE.SpriteMaterial).map?.dispose();
      (coma.material as THREE.SpriteMaterial).dispose();
      ionTail.geo.dispose();
      ionTail.mat.dispose();
      dustTail.geo.dispose();
      dustTail.mat.dispose();
      tailSprite.dispose();
    },
  };
}
