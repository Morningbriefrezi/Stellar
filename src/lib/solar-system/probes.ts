// Deep-space probes — the five spacecraft leaving the solar system, shown at
// their real heliocentric positions for the simulation epoch. Voyager 1 & 2,
// Pioneer 10 & 11, and New Horizons are all on hyperbolic escape trajectories
// that have been essentially straight lines for decades, so a fixed outbound
// direction plus the published recession rate reproduces their positions to
// within a fraction of a degree. Each probe carries a live mono label with its
// current distance in AU — zoom out past Neptune and you find where humanity's
// hardware actually is right now. No other consumer sky app shows this.

import * as THREE from 'three';
import { sceneRadiusFromAu, type ScaleMode } from '@/lib/solar-system/ephemeris';
import type { TargetCandidate } from '@/lib/solar-system/flight-targeting';

export interface ProbesHandle {
  group: THREE.Group;
  /** Live positions, for the flight deck's navigation targets. */
  targets: TargetCandidate[];
  /** `cameraRadius` — current system-camera radius (0 while a body is focused). */
  update: (epochMs: number, cameraRadius: number) => void;
  dispose: () => void;
}

interface ProbeSpec {
  name: string;
  /** Target id on the flight deck (and its message key). */
  id: string;
  /** Heliocentric distance (AU) on 2026-01-01. */
  r0Au: number;
  /** Current recession speed (AU/year). */
  auPerYear: number;
  /** Outbound direction, ecliptic J2000 longitude/latitude (deg). */
  eclLonDeg: number;
  eclLatDeg: number;
}

const T0_MS = Date.UTC(2026, 0, 1);
const MS_YEAR = 365.25 * 86_400_000;

// Positions cross-checked against the mission "where are they now" trackers.
const PROBE_SPECS: ProbeSpec[] = [
  { name: 'VOYAGER 1', id: 'voyager1', r0Au: 169.0, auPerYear: 3.57, eclLonDeg: 255.3, eclLatDeg: 35.0 },
  { name: 'VOYAGER 2', id: 'voyager2', r0Au: 141.4, auPerYear: 3.16, eclLonDeg: 289.9, eclLatDeg: -32.5 },
  { name: 'PIONEER 10', id: 'pioneer10', r0Au: 137.1, auPerYear: 2.54, eclLonDeg: 76.0, eclLatDeg: 3.0 },
  { name: 'PIONEER 11', id: 'pioneer11', r0Au: 116.6, auPerYear: 2.3, eclLonDeg: 292.5, eclLatDeg: 12.5 },
  { name: 'NEW HORIZONS', id: 'newHorizons', r0Au: 61.5, auPerYear: 2.94, eclLonDeg: 293.3, eclLatDeg: -1.5 },
];

function dotTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(200,225,255,0.7)');
  grad.addColorStop(1, 'rgba(160,200,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeDeepSpaceProbes(mode: ScaleMode): ProbesHandle {
  const group = new THREE.Group();
  group.name = 'deepSpaceProbes';

  const dotTex = dotTexture();

  interface ProbeRec {
    spec: ProbeSpec;
    dir: THREE.Vector3; // unit outbound direction, scene frame
    dot: THREE.Sprite;
    dotMat: THREE.SpriteMaterial;
    label: THREE.Sprite;
    labelMat: THREE.SpriteMaterial;
    labelTex: THREE.CanvasTexture;
    labelCtx: CanvasRenderingContext2D;
    lastDrawnAu: number;
    trailGeo: THREE.BufferGeometry;
    trailMat: THREE.LineBasicMaterial;
  }

  const recs: ProbeRec[] = [];

  for (const spec of PROBE_SPECS) {
    const lon = THREE.MathUtils.degToRad(spec.eclLonDeg);
    const lat = THREE.MathUtils.degToRad(spec.eclLatDeg);
    // Ecliptic (x toward the equinox, z north) → scene frame (Y-up).
    const dir = new THREE.Vector3(
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat),
      -Math.cos(lat) * Math.sin(lon),
    );

    const dotMat = new THREE.SpriteMaterial({
      map: dotTex,
      color: 0xd8ecff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dot = new THREE.Sprite(dotMat);
    dot.scale.setScalar(0.09);
    group.add(dot);

    // Live label: "VOYAGER 1  169.4 AU" — redrawn when the distance moves.
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    const labelTex = new THREE.CanvasTexture(canvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const labelMat = new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(3.4, 3.4 * (96 / 640), 1);
    label.center.set(0, 0.5); // anchor at the left edge, beside the dot
    group.add(label);

    // Short trail marking the last ~20 years of the outbound leg.
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const trailMat = new THREE.LineBasicMaterial({
      color: 0x9fc0e8, transparent: true, opacity: 0, depthWrite: false,
    });
    group.add(new THREE.Line(trailGeo, trailMat));

    recs.push({
      spec, dir, dot, dotMat, label, labelMat, labelTex, labelCtx: ctx,
      lastDrawnAu: -1, trailGeo, trailMat,
    });
  }

  const drawLabel = (rec: ProbeRec, au: number) => {
    const { labelCtx: ctx } = rec;
    ctx.clearRect(0, 0, 640, 96);
    ctx.textBaseline = 'middle';
    ctx.font = '500 38px "JetBrains Mono", "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(214,226,246,0.92)';
    ctx.fillText(rec.spec.name, 14, 46);
    const nameW = ctx.measureText(rec.spec.name).width;
    ctx.fillStyle = 'rgba(143,163,200,0.85)';
    ctx.fillText(`${au.toFixed(1)} AU`, 14 + nameW + 26, 46);
    rec.labelTex.needsUpdate = true;
    rec.lastDrawnAu = au;
  };

  const pos = new THREE.Vector3();
  const past = new THREE.Vector3();
  const targets: TargetCandidate[] = recs.map((rec) => ({ id: rec.spec.id, kind: 'probe', position: new THREE.Vector3() }));

  return {
    group,
    targets,
    update(epochMs: number, cameraRadius: number) {
      // Labels live in the outer-system band: fade in once the camera leaves
      // the inner planets, fade out again as the stellar tier takes over.
      const camR = cameraRadius;
      const fade =
        camR <= 0
          ? 0
          : THREE.MathUtils.smoothstep(camR, 7, 13) *
            (1 - THREE.MathUtils.smoothstep(camR, 260, 700));

      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        const yr = (epochMs - T0_MS) / MS_YEAR;
        const au = Math.max(5, rec.spec.r0Au + rec.spec.auPerYear * yr);
        const r = sceneRadiusFromAu(au, mode);
        pos.copy(rec.dir).multiplyScalar(r);
        rec.dot.position.copy(pos);
        targets[i].position.copy(pos);
        rec.label.position.copy(pos);
        rec.label.position.x += 0.14;

        const rPast = sceneRadiusFromAu(Math.max(4, au - rec.spec.auPerYear * 20), mode);
        past.copy(rec.dir).multiplyScalar(rPast);
        const tp = rec.trailGeo.getAttribute('position') as THREE.BufferAttribute;
        tp.setXYZ(0, past.x, past.y, past.z);
        tp.setXYZ(1, pos.x, pos.y, pos.z);
        tp.needsUpdate = true;

        rec.dotMat.opacity = camR <= 0 ? 0.35 : 0.6 + fade * 0.35;
        rec.labelMat.opacity = fade * 0.95;
        rec.trailMat.opacity = fade * 0.3;
        if (Math.abs(au - rec.lastDrawnAu) > 0.2) drawLabel(rec, au);
      }
    },
    dispose() {
      for (const rec of recs) {
        rec.dotMat.dispose();
        rec.labelMat.dispose();
        rec.labelTex.dispose();
        rec.trailGeo.dispose();
        rec.trailMat.dispose();
      }
      dotTex.dispose();
    },
  };
}
