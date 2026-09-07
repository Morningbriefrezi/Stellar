// Cockpit view. The world camera sits at the pilot's eye, but the world's
// near plane is wider than the whole fighter, so the interior is its own
// little scene in metres, drawn over the frame with the depth buffer
// cleared: a wraparound canopy on thin struts, a combining glass carrying
// the flight symbology, a coaming with the odometer strip and the warning
// lamps, a centre stack, two multi-function displays, a throttle that
// answers the drive and a stick that answers the airframe, side consoles
// with switch banks and guarded caps, and the seat's shoulders at the edge
// of frame. Everything readable is drawn to canvas textures and refreshed
// five times a second, so the interior costs almost nothing.

import * as THREE from 'three';
import type { FlightTelemetry } from '@/lib/solar-system/player-ship';

export interface CockpitHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Airframe tilt, hull shake, and the live figures on the glass. */
  update: (dt: number, tel: FlightTelemetry) => void;
  setAspect: (aspect: number) => void;
  dispose: () => void;
}

interface Pane {
  tex: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

function pane(w: number, h: number): Pane {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, ctx, w, h };
}

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DIM = 'rgba(248,244,236,0.5)';
const INK = 'rgba(248,244,236,0.9)';

const ALERT_TEXT: Record<string, string> = {
  proximity: 'PULL UP',
  entry: 'RE-ENTRY',
  masslock: 'MASS LOCK',
  charging: 'DRIVE CHARGING',
  jump: 'LIGHT SPEED',
  arrived: 'ARRIVED',
};

export function makeCockpit(accent: number): CockpitHandle {
  const accentCss = `#${new THREE.Color(accent).getHexString()}`;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(76, 1, 0.05, 40);
  camera.position.set(0, 1.3, -0.3);
  const rig = new THREE.Group();
  scene.add(rig);

  const dark = new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.8, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x272b33, roughness: 0.55, metalness: 0.55 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.95, metalness: 0.05 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 1, metalness: 0 });
  const accentMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent) });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const red = new THREE.MeshBasicMaterial({ color: 0xff5a5a });
  const owned: THREE.Material[] = [dark, trim, seatMat, rubber, accentMat, amber, red];
  const geoms: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
    geoms.push(g);
    const o = new THREE.Mesh(g, m);
    rig.add(o);
    return o;
  };

  // ── Canopy: two A-pillars, a brow, open glass between them. ──
  for (const x of [-1.95, 1.95]) {
    const s = add(new THREE.BoxGeometry(0.07, 2.6, 0.07), trim);
    s.position.set(x, 1.7, 1.25);
    s.rotation.z = x < 0 ? 0.3 : -0.3;
  }
  const brow = add(new THREE.BoxGeometry(3.3, 0.1, 0.12), trim);
  brow.position.set(0, 2.62, 1.0);
  // Overhead panel under the brow — breaker row with one amber guard.
  const overhead = add(new THREE.BoxGeometry(1.6, 0.1, 0.5), dark);
  overhead.position.set(0, 2.42, 0.55);
  overhead.rotation.x = 0.35;
  for (let i = 0; i < 8; i++) {
    const b = add(new THREE.BoxGeometry(0.05, 0.03, 0.09), i === 3 ? amber : trim);
    b.position.set(-0.5 + i * 0.143, 2.37, 0.42);
    b.rotation.x = 0.35;
  }

  // ── Combining glass: the flight symbology, projected on the canopy at
  // the pilot's eye height. Additive, so the sky reads straight through. ──
  const hud = pane(768, 480);
  const hudMat = new THREE.MeshBasicMaterial({
    map: hud.tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  owned.push(hudMat);
  // Centred on the eye's own line of sight, so the boresight really does
  // mark where the nose points, and standing clear of the coaming below.
  const hudPlane = add(new THREE.PlaneGeometry(2.3, 1.15), hudMat);
  hudPlane.position.set(0, 1.42, 1.75);
  hudPlane.rotation.set(0, Math.PI, 0);
  // Its own frame: two posts and a bar, so it reads as hardware.
  for (const x of [-1.19, 1.19]) {
    const post = add(new THREE.BoxGeometry(0.04, 1.2, 0.04), trim);
    post.position.set(x, 1.42, 1.75);
  }
  const hudBar = add(new THREE.BoxGeometry(2.42, 0.05, 0.06), trim);
  hudBar.position.set(0, 0.85, 1.75);

  // ── Coaming: the hood over the dash, carrying the odometer strip. ──
  const coaming = add(new THREE.BoxGeometry(3.1, 0.16, 0.42), dark);
  coaming.position.set(0, 1.02, 1.32);
  coaming.rotation.x = -0.42;
  const odo = pane(1024, 96);
  const odoMat = new THREE.MeshBasicMaterial({ map: odo.tex });
  owned.push(odoMat);
  const odoPlane = add(new THREE.PlaneGeometry(2.0, 0.19), odoMat);
  odoPlane.position.set(0, 1.2, 0.98);
  odoPlane.rotation.set(-0.42, Math.PI, 0, 'YXZ');

  // Warning lamps in a row on the coaming lip: master caution, hull, heat.
  const lampGeom = new THREE.BoxGeometry(0.17, 0.06, 0.04);
  const lampMats: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x1a1410 });
    owned.push(m);
    lampMats.push(m);
    const lamp = add(lampGeom, m);
    lamp.position.set(-0.9 + i * 0.42, 1.06, 1.14);
    lamp.rotation.x = -0.42;
  }

  // ── Dash: a slab with a raised centre stack. ──
  const dash = add(new THREE.BoxGeometry(3.1, 0.2, 1.0), dark);
  dash.position.set(0, 0.62, 0.95);
  dash.rotation.x = -0.16;
  const stack = add(new THREE.BoxGeometry(1.5, 0.14, 0.7), trim);
  stack.position.set(0, 0.78, 0.86);
  stack.rotation.x = -0.42;

  // Centre instrument glass: the gauge cluster.
  const cluster = pane(640, 320);
  const clusterMat = new THREE.MeshBasicMaterial({ map: cluster.tex });
  owned.push(clusterMat);
  const clusterPlane = add(new THREE.PlaneGeometry(1.16, 0.58), clusterMat);
  clusterPlane.position.set(0, 0.9, 0.72);
  clusterPlane.rotation.set(-0.42, Math.PI, 0, 'YXZ');

  // Two multi-function displays: the attitude and navigation page to port,
  // the tactical scope to starboard (forward is +Z, so port is +X).
  const mfdL = pane(384, 288);
  const mfdR = pane(384, 288);
  const mfdLMat = new THREE.MeshBasicMaterial({ map: mfdL.tex });
  const mfdRMat = new THREE.MeshBasicMaterial({ map: mfdR.tex });
  owned.push(mfdLMat, mfdRMat);
  for (const [x, mat] of [[1.05, mfdLMat], [-1.05, mfdRMat]] as const) {
    const p = add(new THREE.PlaneGeometry(0.62, 0.46), mat);
    p.position.set(x, 0.83, 0.82);
    p.rotation.set(-0.42, Math.PI + (x < 0 ? -0.22 : 0.22), 0, 'YXZ');
  }

  // ── Switch banks: two rows of keys along the dash lip, with guarded
  // covers over the outboard pair. ──
  const keyGeom = new THREE.BoxGeometry(0.075, 0.025, 0.06);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 12; i++) {
      const m = i % 5 === 0 ? amber : i % 5 === 2 ? accentMat : i === 11 ? red : trim;
      const k = add(keyGeom, m);
      k.position.set(-0.72 + i * 0.131, 0.7 - row * 0.045, 1.3 - row * 0.09);
      k.rotation.x = -0.16;
    }
  }
  for (const x of [-1.15, 1.15]) {
    const guard = add(new THREE.BoxGeometry(0.2, 0.12, 0.16), trim);
    guard.position.set(x, 0.72, 1.24);
    guard.rotation.x = -0.16;
    const cap = add(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10), red);
    cap.position.set(x, 0.75, 1.19);
    cap.rotation.x = Math.PI / 2 - 0.16;
  }

  // ── Side consoles: throttle quadrant to port, keypad to starboard. ──
  for (const x of [-1.6, 1.6]) {
    const c = add(new THREE.BoxGeometry(0.55, 0.34, 1.3), dark);
    c.position.set(x, 0.5, 0.35);
    c.rotation.y = x < 0 ? 0.16 : -0.16;
  }
  const quadrant = add(new THREE.BoxGeometry(0.34, 0.06, 0.5), trim);
  quadrant.position.set(-1.55, 0.68, 0.5);
  // The throttle rides its own pivot at the quadrant hinge, so it swings
  // forward as the drive comes up instead of sliding through the console.
  const throttlePivot = new THREE.Group();
  throttlePivot.position.set(-1.55, 0.7, 0.5);
  rig.add(throttlePivot);
  const throttleGeom = new THREE.CylinderGeometry(0.028, 0.032, 0.3, 8);
  geoms.push(throttleGeom);
  const throttle = new THREE.Mesh(throttleGeom, trim);
  throttle.position.set(0, 0.13, 0);
  throttlePivot.add(throttle);
  const gripGeom = new THREE.SphereGeometry(0.055, 10, 8);
  geoms.push(gripGeom);
  const throttleGrip = new THREE.Mesh(gripGeom, rubber);
  throttleGrip.position.set(0, 0.28, 0);
  throttlePivot.add(throttleGrip);
  // Detent marks along the quadrant.
  for (let i = 0; i < 4; i++) {
    const d = add(new THREE.BoxGeometry(0.06, 0.012, 0.02), i === 3 ? amber : trim);
    d.position.set(-1.42, 0.71, 0.66 - i * 0.1);
  }
  for (let i = 0; i < 9; i++) {
    const k = add(new THREE.BoxGeometry(0.055, 0.02, 0.055), i === 4 ? accentMat : trim);
    k.position.set(1.48 + (i % 3) * 0.075, 0.69, 0.62 - Math.floor(i / 3) * 0.1);
  }

  // ── Stick on its own pivot, seat and harness. ──
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0.3, 0.44, 0.24);
  rig.add(stickPivot);
  const columnGeom = new THREE.CylinderGeometry(0.035, 0.05, 0.46, 10);
  geoms.push(columnGeom);
  const column = new THREE.Mesh(columnGeom, trim);
  column.position.set(0, 0.2, -0.03);
  column.rotation.x = 0.26;
  stickPivot.add(column);
  const stickGripGeom = new THREE.CapsuleGeometry(0.055, 0.1, 4, 10);
  geoms.push(stickGripGeom);
  const grip = new THREE.Mesh(stickGripGeom, rubber);
  grip.position.set(0, 0.42, -0.1);
  grip.rotation.x = 0.26;
  stickPivot.add(grip);
  const triggerGeom = new THREE.BoxGeometry(0.03, 0.05, 0.02);
  geoms.push(triggerGeom);
  const trigger = new THREE.Mesh(triggerGeom, red);
  trigger.position.set(0, 0.43, -0.17);
  stickPivot.add(trigger);
  const seatPan = add(new THREE.BoxGeometry(1.24, 0.18, 0.34), seatMat);
  seatPan.position.set(0, 0.4, -0.28);
  for (const x of [-0.62, 0.62]) {
    const bolster = add(new THREE.BoxGeometry(0.16, 0.5, 0.3), seatMat);
    bolster.position.set(x, 0.62, -0.3);
  }
  for (const x of [-0.34, 0.34]) {
    const strap = add(new THREE.BoxGeometry(0.11, 0.9, 0.03), seatMat);
    strap.position.set(x, 0.72, -0.16);
    strap.rotation.z = x < 0 ? -0.2 : 0.2;
  }

  scene.add(new THREE.AmbientLight(0x5c6b8a, 0.8));
  const glow = new THREE.PointLight(accent, 1.5, 4.5, 1.5);
  glow.position.set(0, 0.95, 0.8);
  scene.add(glow);
  const warm = new THREE.PointLight(0xffb347, 0.55, 3.2, 1.5);
  warm.position.set(-1.3, 0.95, 0.6);
  scene.add(warm);

  /* ── Canvas drawing ── */

  const grid = (p: Pane, colour: string, step: number) => {
    p.ctx.strokeStyle = colour;
    p.ctx.lineWidth = 1;
    for (let x = 0; x < p.w; x += step) {
      p.ctx.beginPath();
      p.ctx.moveTo(x, 0);
      p.ctx.lineTo(x, p.h);
      p.ctx.stroke();
    }
    for (let y = 0; y < p.h; y += step) {
      p.ctx.beginPath();
      p.ctx.moveTo(0, y);
      p.ctx.lineTo(p.w, y);
      p.ctx.stroke();
    }
  };

  const km = (v: number) => Math.round(v).toLocaleString('en-US');

  /** Combining glass: boresight, pitch ladder, speed and altitude tapes,
   *  the drive state and any standing caution. Black is transparent here —
   *  the plane is additive — so nothing is filled but the symbols. */
  const drawHud = (tel: FlightTelemetry, t: number) => {
    const { ctx, w, h } = hud;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = accentCss;
    ctx.fillStyle = accentCss;
    ctx.lineWidth = 3;

    // Pitch ladder, rolled with the airframe.
    ctx.save();
    ctx.beginPath();
    ctx.rect(90, 60, w - 180, h - 120);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-tel.bank);
    ctx.globalAlpha = 0.75;
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const y = i * 62 + tel.pitchRate * 220;
      const half = 96;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(-half + 34, y);
      ctx.moveTo(half - 34, y);
      ctx.lineTo(half, y);
      ctx.stroke();
      ctx.font = `600 22px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.abs(i) * 10}`, -half - 10, y + 8);
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.abs(i) * 10}`, half + 10, y + 8);
    }
    // Horizon line, longer and unbroken.
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(-230, tel.pitchRate * 220);
    ctx.lineTo(-40, tel.pitchRate * 220);
    ctx.moveTo(40, tel.pitchRate * 220);
    ctx.lineTo(230, tel.pitchRate * 220);
    ctx.stroke();
    ctx.restore();

    // Boresight.
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 46, cy);
    ctx.lineTo(cx - 16, cy);
    ctx.moveTo(cx + 16, cy);
    ctx.lineTo(cx + 46, cy);
    ctx.moveTo(cx, cy - 46);
    ctx.lineTo(cx, cy - 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.stroke();

    // Speed tape left, altitude tape right.
    ctx.font = `600 26px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(96, cy - 34, 168, 68);
    ctx.fillText(`${km(tel.speedKmS)}`, 108, cy + 2);
    ctx.font = `600 15px ${MONO}`;
    ctx.fillText('KM/S', 108, cy + 24);
    ctx.textAlign = 'right';
    ctx.font = `600 26px ${MONO}`;
    ctx.strokeRect(w - 264, cy - 34, 168, 68);
    ctx.fillText(tel.nearId ? km(tel.nearAltKm) : '——', w - 108, cy + 2);
    ctx.font = `600 15px ${MONO}`;
    ctx.fillText(tel.nearId ? `ALT KM · ${tel.nearId.toUpperCase()}` : 'NO BODY', w - 108, cy + 24);

    // Drive state along the top, hull along the bottom.
    ctx.textAlign = 'center';
    ctx.font = `600 20px ${MONO}`;
    ctx.globalAlpha = 0.8;
    const drive = tel.jumpPhase === 'none' ? tel.mode.toUpperCase() : 'HYPERDRIVE';
    ctx.fillText(`${drive} · ${tel.speedC.toFixed(3)} C`, cx, 88);
    ctx.fillText(`HULL ${Math.round(tel.hp)}%`, cx, h - 140);

    // Caution caption, blinking, under the boresight.
    const caution = ALERT_TEXT[tel.alert] ?? '';
    if (caution && Math.sin(t * 7) > -0.25) {
      ctx.fillStyle = tel.alert === 'proximity' || tel.alert === 'entry' ? '#ff5a5a' : '#ffb347';
      ctx.globalAlpha = 1;
      ctx.font = `600 30px ${MONO}`;
      ctx.fillText(caution, cx, cy + 120);
    }
    ctx.globalAlpha = 1;
    hud.tex.needsUpdate = true;
  };

  /** Odometer strip: one line of numbers across the coaming. */
  const drawOdo = (tel: FlightTelemetry) => {
    const { ctx, w, h } = odo;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(248,244,236,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    // One line only: the strip is shallow, and a second row would sit
    // behind the coaming's lip from the pilot's eye.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let x = 22;
    const cell = (label: string, value: string, colour: string) => {
      ctx.fillStyle = DIM;
      ctx.font = `600 20px ${MONO}`;
      ctx.fillText(label, x, 50);
      x += ctx.measureText(label).width + 10;
      ctx.fillStyle = colour;
      ctx.font = `600 32px ${MONO}`;
      ctx.fillText(value, x, 48);
      x += ctx.measureText(value).width + 30;
    };
    cell('VEL', `${km(tel.speedKmS)} km/s`, '#ffffff');
    cell('ALT', tel.nearId ? `${km(tel.nearAltKm)} km` : '—', accentCss);
    cell('MODE', (tel.jumpPhase === 'none' ? tel.mode : 'jump').toUpperCase(), '#ffb347');
    cell('HULL', `${Math.round(tel.hp)}`, tel.hp > 50 ? '#ffffff' : '#ff5a5a');
    ctx.textBaseline = 'alphabetic';
    odo.tex.needsUpdate = true;
  };

  /** Centre cluster: a speed arc, hull and heat bars, a caution lamp. */
  const drawCluster = (tel: FlightTelemetry, t: number) => {
    const { ctx, w, h } = cluster;
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, w, h);
    grid(cluster, 'rgba(94,234,212,0.07)', 40);
    const cx = 150;
    const cy = 150;
    const r = 96;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const frac = tel.maxKmS > 0 ? Math.min(1, tel.speedKmS / tel.maxKmS) : 0;
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(248,244,236,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = frac < 0.5 ? accentCss : frac < 0.85 ? '#ffb347' : '#ff5a5a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(248,244,236,0.45)';
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10);
      const len = i % 5 === 0 ? 14 : 8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
      ctx.lineTo(cx + Math.cos(a) * (r - 10 - len), cy + Math.sin(a) * (r - 10 - len));
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 44px ${MONO}`;
    ctx.fillText(km(tel.speedKmS), cx, cy + 6);
    ctx.fillStyle = DIM;
    ctx.font = `600 16px ${MONO}`;
    ctx.fillText('KM/S', cx, cy + 34);
    ctx.fillStyle = accentCss;
    ctx.font = `600 18px ${MONO}`;
    ctx.fillText(`${tel.speedC.toFixed(3)} c`, cx, cy + 62);
    ctx.textAlign = 'left';
    const bar = (x: number, label: string, k: number, colour: string) => {
      ctx.fillStyle = DIM;
      ctx.font = `600 15px ${MONO}`;
      ctx.fillText(label, x, 44);
      ctx.strokeStyle = 'rgba(248,244,236,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 54, 44, 184);
      ctx.fillStyle = colour;
      const fill = Math.max(0, Math.min(1, k)) * 180;
      ctx.fillRect(x + 2, 236 - fill, 40, fill);
    };
    bar(340, 'HULL', tel.hp / tel.maxHp, tel.hp > 50 ? accentCss : tel.hp > 25 ? '#ffb347' : '#ff5a5a');
    bar(410, 'HEAT', tel.heat, tel.heat > 0.6 ? '#ff5a5a' : '#ffb347');
    // Hyperdrive charge column — dead until the drive spools.
    bar(480, 'DRIVE', tel.jumpT, tel.jumpPhase === 'none' ? 'rgba(188,208,255,0.2)' : '#bcd0ff');

    // Kill tally and the caution lamp.
    ctx.fillStyle = DIM;
    ctx.font = `600 15px ${MONO}`;
    ctx.fillText('KILLS', 552, 44);
    ctx.fillStyle = INK;
    ctx.font = `600 34px ${MONO}`;
    ctx.fillText(String(tel.kills), 552, 84);
    const warn = tel.hp < 60 || tel.heat > 0.35 || tel.alert === 'proximity';
    ctx.fillStyle = warn && Math.sin(t * 6) > 0 ? '#ff5a5a' : 'rgba(255,90,90,0.15)';
    ctx.beginPath();
    ctx.arc(574, 176, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(248,244,236,0.6)';
    ctx.font = `600 13px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('CAUTION', 574, 222);
    ctx.textAlign = 'left';
    cluster.tex.needsUpdate = true;
  };

  /** Port MFD: the tactical scope — contacts, range rings, boresight. */
  const drawScope = (tel: FlightTelemetry, t: number) => {
    const { ctx, w, h } = mfdR;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2 + 8;
    const reach = Math.min(cx, cy) - 24;
    ctx.strokeStyle = 'rgba(94,234,212,0.28)';
    ctx.lineWidth = 1.5;
    for (const k of [0.34, 0.67, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, reach * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - reach);
    ctx.lineTo(cx, cy + reach);
    ctx.moveTo(cx - reach, cy);
    ctx.lineTo(cx + reach, cy);
    ctx.stroke();
    // Sweep line, so the scope reads as live even with an empty sky.
    const sweep = (t * 1.3) % (Math.PI * 2);
    ctx.strokeStyle = 'rgba(94,234,212,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * reach, cy + Math.sin(sweep) * reach);
    ctx.stroke();
    ctx.fillStyle = accentCss;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.lineTo(cx - 6, cy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff5a5a';
    for (let i = 0; i < tel.radarCount; i++) {
      const x = cx + tel.radar[i * 2] * reach;
      const y = cy - tel.radar[i * 2 + 1] * reach;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(248,244,236,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = accentCss;
    ctx.font = `600 20px ${MONO}`;
    ctx.fillText('TAC', 14, 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = tel.radarCount ? '#ff5a5a' : DIM;
    ctx.fillText(`${tel.radarCount} CTC`, w - 14, 30);
    ctx.textAlign = 'left';
    mfdR.tex.needsUpdate = true;
  };

  /** Port MFD: where you are and where the drive points, over an attitude
   *  ladder. The navigation block sits at the top — from the seat the dash
   *  lip eats the bottom edge of the screen. */
  const drawNav = (tel: FlightTelemetry, t: number) => {
    const { ctx, w, h } = mfdL;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accentCss;
    ctx.font = `600 20px ${MONO}`;
    ctx.fillText('NAV', 14, 30);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(-tel.bank * 57)}°`, w - 14, 30);
    ctx.textAlign = 'left';
    // Navigation block: the system you are in, the star the drive points at.
    ctx.fillStyle = DIM;
    ctx.font = `600 17px ${MONO}`;
    ctx.fillText('SYSTEM', 14, 66);
    ctx.fillText('NEXT', 14, 96);
    ctx.fillStyle = INK;
    ctx.font = `600 19px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(tel.systemName.toUpperCase().slice(0, 12), w - 14, 66);
    ctx.fillText(`${tel.targetLy.toFixed(2)} LY`, w - 14, 96);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(248,244,236,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 112);
    ctx.lineTo(w - 4, 112);
    ctx.stroke();

    // Attitude ladder under it, rolling and pitching with the airframe.
    const acy = 112 + (h - 116) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(4, 112, w - 8, h - 116);
    ctx.clip();
    ctx.translate(w / 2, acy);
    ctx.rotate(-tel.bank);
    ctx.translate(0, tel.pitchRate * 200);
    ctx.strokeStyle = 'rgba(94,234,212,0.5)';
    ctx.lineWidth = 2;
    for (let i = -4; i <= 4; i++) {
      const y = i * 26;
      const len = i === 0 ? 150 : 64;
      ctx.beginPath();
      ctx.moveTo(-len, y);
      ctx.lineTo(len, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 46, acy);
    ctx.lineTo(w / 2 - 14, acy);
    ctx.moveTo(w / 2 + 14, acy);
    ctx.lineTo(w / 2 + 46, acy);
    ctx.stroke();
    // Data-link blip, bottom corner of the ladder.
    ctx.fillStyle = 'rgba(255,179,71,0.8)';
    ctx.beginPath();
    ctx.arc(w - 26, h - 30 - (t % 2) * 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(248,244,236,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    mfdL.tex.needsUpdate = true;
  };

  let sinceHud = 1;
  let sinceDraw = 1;
  let clock = 0;
  let flicker = 0;
  let throttleShown = 0;

  return {
    scene,
    camera,
    update(dt, tel) {
      clock += dt;
      rig.rotation.z = -tel.bank * 0.32;
      rig.rotation.x = -tel.pitchRate * 0.1;
      camera.position.set(
        (Math.random() - 0.5) * tel.shake * 0.03,
        1.3 + (Math.random() - 0.5) * tel.shake * 0.03,
        -0.3,
      );
      camera.lookAt(0, 1.5, 6);
      flicker += dt;
      glow.intensity = 1.4 + 0.12 * Math.sin(flicker * 1.7);

      // The throttle answers the drive, the stick answers the airframe —
      // the two controls a pilot would watch move on their own.
      const frac = tel.maxKmS > 0 ? Math.min(1, tel.speedKmS / tel.maxKmS) : 0;
      throttleShown += (frac - throttleShown) * (1 - Math.exp(-dt * 4));
      throttlePivot.rotation.x = 0.42 - throttleShown * 0.78;
      stickPivot.rotation.z = -tel.bank * 0.5;
      stickPivot.rotation.x = 0.26 - tel.pitchRate * 0.5;

      // Warning lamps: master caution, hull, heat.
      const beat = Math.sin(clock * 6) > 0;
      const lamp = (i: number, on: boolean, colour: number) =>
        lampMats[i].color.setHex(on && beat ? colour : 0x1a1410);
      lamp(0, !!tel.alert, tel.alert === 'proximity' || tel.alert === 'entry' ? 0xff5a5a : 0xffb347);
      lamp(1, tel.hp < 60, 0xff5a5a);
      lamp(2, tel.heat > 0.2, 0xffb347);

      // Panels refresh five times a second — the eye cannot tell, and the
      // canvas uploads stay off the frame budget. The combining glass runs
      // faster than the rest because it carries the moving ladder, but not
      // every frame: a full-size texture upload per frame is not worth it,
      // and the whole rig already banks with the airframe.
      sinceHud += dt;
      if (sinceHud > 0.06) {
        sinceHud = 0;
        drawHud(tel, clock);
      }
      sinceDraw += dt;
      if (sinceDraw > 0.2) {
        sinceDraw = 0;
        drawOdo(tel);
        drawCluster(tel, clock);
        drawScope(tel, clock);
        drawNav(tel, clock);
      }
    },
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const g of geoms) g.dispose();
      for (const m of owned) m.dispose();
      hud.tex.dispose();
      odo.tex.dispose();
      cluster.tex.dispose();
      mfdL.tex.dispose();
      mfdR.tex.dispose();
    },
  };
}
