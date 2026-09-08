// Small worlds worth a visit: procedural cratered and banded surfaces for
// the dwarf planets of our own belt and the worlds of the next star. Every
// body here is a FlightBody, so it is solid, has gravity and can be landed
// on (or into).

import * as THREE from 'three';
import { sceneRadiusFromAu, type ScaleMode } from '@/lib/solar-system/ephemeris';
import type { FlightBody } from '@/lib/solar-system/player-ship';

const R_EARTH_KM = 6371;
const MS_DAY = 86_400_000;
/** Same law as `worldRadiusForBody`, taking a radius in km. */
export const sceneRadius = (km: number) => 0.028 * Math.pow(km / R_EARTH_KM, 0.36);

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t * 1664525 + 1013904223) >>> 0;
    return t / 4294967296;
  };
}

/** Grey-brown regolith pocked with craters: bright rims, shadowed floors. */
export function crateredTexture(seed: number, base: [number, number, number], craters = 140): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const rnd = seeded(seed);
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, w, h);
  // Mottling.
  for (let i = 0; i < 900; i++) {
    const k = 0.8 + rnd() * 0.4;
    g.fillStyle = `rgba(${base[0] * k},${base[1] * k},${base[2] * k},0.35)`;
    g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 18, 2 + rnd() * 10);
  }
  for (let i = 0; i < craters; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 2 + Math.pow(rnd(), 2.2) * 26;
    const floor = g.createRadialGradient(x, y, 0, x, y, r);
    floor.addColorStop(0, 'rgba(0,0,0,0.42)');
    floor.addColorStop(0.75, 'rgba(0,0,0,0.18)');
    floor.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = floor;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = Math.max(1, r * 0.12);
    g.beginPath();
    g.arc(x, y, r * 0.92, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Zonal bands with eddies for an ice giant. */
export function bandedTexture(seed: number, colours: [number, number, number][]): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const rnd = seeded(seed);
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    const col = colours[i % colours.length];
    const k = 0.85 + rnd() * 0.3;
    g.fillStyle = `rgb(${col[0] * k},${col[1] * k},${col[2] * k})`;
    g.fillRect(0, (i / bands) * h, w, h / bands + 1);
  }
  g.globalAlpha = 0.18;
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() > 0.5 ? '#ffffff' : '#000000';
    g.beginPath();
    g.ellipse(rnd() * w, rnd() * h, 8 + rnd() * 40, 2 + rnd() * 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** An inhabited ocean world: day map with continents and ice, a night map
 *  of city lights clustered on the land, and a broken cloud deck. */
export function livingWorldTextures(seed: number): { day: THREE.CanvasTexture; night: THREE.CanvasTexture; clouds: THREE.CanvasTexture } {
  const w = 1024;
  const h = 512;
  const rnd = seeded(seed);
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { c, g: c.getContext('2d')! };
  };
  const day = make();
  const night = make();
  const clouds = make();
  // Ocean with depth banding.
  const sea = day.g.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, '#9fd3ff');
  sea.addColorStop(0.15, '#1d5aa8');
  sea.addColorStop(0.5, '#123f86');
  sea.addColorStop(0.85, '#1d5aa8');
  sea.addColorStop(1, '#9fd3ff');
  day.g.fillStyle = sea;
  day.g.fillRect(0, 0, w, h);
  // Continents: clusters of soft blobs, greener near the equator, drier inland.
  const land: [number, number, number][] = [];
  for (let k = 0; k < 7; k++) {
    const cx = rnd() * w;
    const cy = h * (0.2 + rnd() * 0.6);
    for (let i = 0; i < 70; i++) {
      const x = cx + (rnd() - 0.5) * w * 0.22;
      const y = cy + (rnd() - 0.5) * h * 0.3;
      const r = 8 + rnd() * 34;
      const lat = Math.abs(y / h - 0.5) * 2;
      const green = 90 + (1 - lat) * 60 + rnd() * 30;
      day.g.fillStyle = `rgb(${70 + lat * 60 + rnd() * 20},${green},${50 + rnd() * 20})`;
      day.g.beginPath();
      day.g.arc(x, y, r, 0, Math.PI * 2);
      day.g.fill();
      land.push([x, y, r]);
    }
  }
  // Ice caps.
  for (const [y0, y1] of [[0, h * 0.06], [h * 0.94, h]]) {
    day.g.fillStyle = 'rgba(240,246,255,0.95)';
    day.g.fillRect(0, y0, w, y1 - y0);
  }
  // Night: cities on the land, brightest on the coasts.
  night.g.fillStyle = '#000000';
  night.g.fillRect(0, 0, w, h);
  for (const [x, y, r] of land) {
    const n = Math.floor(r * 0.6);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r;
      night.g.fillStyle = `rgba(255,${200 + rnd() * 40},${140 + rnd() * 60},${0.35 + rnd() * 0.65})`;
      night.g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  }
  // Clouds: streaky white on transparent.
  clouds.g.clearRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    clouds.g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.5})`;
    clouds.g.beginPath();
    clouds.g.ellipse(x, y, 18 + rnd() * 70, 5 + rnd() * 16, (rnd() - 0.5) * 0.5, 0, Math.PI * 2);
    clouds.g.fill();
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  return { day: tex(day.c), night: tex(night.c), clouds: tex(clouds.c) };
}

interface SmallWorldSpec {
  id: string;
  radiusKm: number;
  au: number;
  periodDays: number;
  inclinationDeg: number;
  phase: number;
  surfaceG: number;
  seed: number;
  base: [number, number, number];
}

/** Ceres and Vesta — the belt's two heavyweights, on circular stand-ins for
 *  their real orbits (true periods, mean distances, inclinations). */
const SMALL_WORLDS: SmallWorldSpec[] = [
  { id: 'ceres', radiusKm: 470, au: 2.77, periodDays: 1682, inclinationDeg: 10.6, phase: 2.1, surfaceG: 0.28, seed: 11, base: [118, 112, 104] },
  { id: 'vesta', radiusKm: 263, au: 2.36, periodDays: 1325, inclinationDeg: 7.1, phase: 4.4, surfaceG: 0.25, seed: 23, base: [140, 132, 118] },
];

export interface SmallBodiesHandle {
  group: THREE.Group;
  bodies: FlightBody[];
  update: (epochMs: number, mode: ScaleMode) => void;
  dispose: () => void;
}

export function makeSmallBodies(lite: boolean): SmallBodiesHandle {
  const group = new THREE.Group();
  group.name = 'smallBodies';
  const segs = lite ? 32 : 48;
  const recs: { mesh: THREE.Mesh; spec: SmallWorldSpec; body: FlightBody }[] = [];
  const disposables: { dispose: () => void }[] = [];
  for (const spec of SMALL_WORLDS) {
    const r = sceneRadius(spec.radiusKm);
    const geom = new THREE.SphereGeometry(r, segs, segs);
    // Lumpy silhouettes — these are not spheres in real life either.
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const rnd = seeded(spec.seed);
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + (rnd() - 0.5) * 0.06;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * (k * 0.94), pos.getZ(i) * k);
    }
    geom.computeVertexNormals();
    const tex = crateredTexture(spec.seed, spec.base);
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.004, roughness: 0.95, metalness: 0.02 });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    disposables.push(geom, mat, tex);
    recs.push({
      mesh,
      spec,
      body: { id: spec.id, kind: 'planet', position: new THREE.Vector3(), radius: r, radiusKm: spec.radiusKm, surfaceG: spec.surfaceG, atmosphere: 1 },
    });
  }
  return {
    group,
    bodies: recs.map((r) => r.body),
    update(epochMs, mode) {
      for (const { mesh, spec, body } of recs) {
        const theta = spec.phase + (epochMs / (spec.periodDays * MS_DAY)) * Math.PI * 2;
        const rr = sceneRadiusFromAu(spec.au, mode);
        const inc = THREE.MathUtils.degToRad(spec.inclinationDeg);
        const x = Math.cos(theta) * rr;
        const z = Math.sin(theta) * rr;
        mesh.position.set(x, -z * Math.sin(inc), z * Math.cos(inc));
        mesh.rotation.y = theta * 40;
        body.position.copy(mesh.position);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
