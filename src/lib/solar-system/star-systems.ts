// The next star over: Alpha Centauri, built at its real place in the sky
// (the nearby-star catalogue puts it 1.34 pc from the Sun) so the hyperdrive
// has somewhere to go. A is a Sun twin and borrows the Sun's photosphere
// shader and corona; B is the orange K1 companion; Proxima is the red dwarf
// out on the far side, carrying the rocky Proxima b. Sizes use the same
// radius law as the planets, so the stars dwarf the fighter the way the
// Sun does.

import * as THREE from 'three';
import { nearbyStarPosition } from '@/lib/solar-system/galactic-scene';
import { makeAtmosphereShell, disposeAtmosphereShell, makeSunExtras, type SunExtrasHandle } from '@/lib/solar-system/scene-extras';
import { softSpriteTexture } from '@/lib/solar-system/soft-sprite';
import { bandedTexture, crateredTexture, livingWorldTextures, sceneRadius } from '@/lib/solar-system/small-bodies';
import type { FlightAnchor, FlightBody } from '@/lib/solar-system/player-ship';

const R_SUN_KM = 696_000;
const R_EARTH_KM = 6371;

export interface StarSystemHandle {
  group: THREE.Group;
  center: THREE.Vector3;
  bodies: FlightBody[];
  /** Where a jump drops out: a few radii short of A, nose on the star. */
  arrival: FlightAnchor;
  update: (dtSec: number, cameraPos: THREE.Vector3, camera: THREE.PerspectiveCamera) => void;
  dispose: () => void;
}

export function makeAlphaCentauri(sunMaterial: THREE.Material, lite: boolean): StarSystemHandle {
  const group = new THREE.Group();
  group.name = 'alphaCentauri';
  const center = nearbyStarPosition('rigil') ?? new THREE.Vector3(-14, -25, 8);
  group.position.copy(center);

  const segs = lite ? 48 : 80;
  const glowTex = softSpriteTexture();
  const owned: THREE.Material[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  const textures: THREE.CanvasTexture[] = [];
  const bodies: FlightBody[] = [];

  const addBody = (
    id: string, local: THREE.Vector3, radiusKm: number, surfaceG: number, atmosphere: number,
    material: THREE.Material, glow: { color: THREE.Color; scale: number } | null,
    kind: FlightBody['kind'] = 'star',
  ) => {
    const r = sceneRadius(radiusKm);
    const geom = new THREE.SphereGeometry(r, segs, segs);
    geoms.push(geom);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.copy(local);
    group.add(mesh);
    if (glow) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: glow.color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      owned.push(mat);
      const s = new THREE.Sprite(mat);
      s.position.copy(local);
      s.scale.setScalar(r * glow.scale);
      group.add(s);
    }
    const body: FlightBody = {
      id,
      kind,
      position: local.clone().add(center),
      radius: r,
      radiusKm,
      surfaceG,
      atmosphere,
    };
    bodies.push(body);
    return { mesh, body };
  };

  // Alpha Centauri A — G2V, 1.22 R☉. Same shader as the Sun, same corona.
  const a = addBody('alphaCenA', new THREE.Vector3(0, 0, 0), 1.22 * R_SUN_KM, 274, 1.5, sunMaterial, null);
  const coronaA: SunExtrasHandle = makeSunExtras(a.body.radius);
  group.add(coronaA.group);
  coronaA.group.position.set(0, 0, 0);
  const lightA = new THREE.PointLight(0xfff4e0, 5.4, 14, 1.1);
  group.add(lightA);

  // Alpha Centauri B — K1V, 0.86 R☉, orange. The pair's 23 AU mean
  // separation is compressed the way the planets' orbits are.
  const matB = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.15, 0.5) });
  owned.push(matB);
  const bLocal = new THREE.Vector3(1.15, 0.06, 0.42);
  addBody('alphaCenB', bLocal, 0.86 * R_SUN_KM, 274, 1.5, matB, {
    // The halo stays inside a few stellar radii — Centauri Prime orbits
    // half a scene unit out and a wide glow would swallow it.
    color: new THREE.Color(1.0, 0.62, 0.3), scale: 2.6,
  });
  const lightB = new THREE.PointLight(0xffc890, 4.0, 3.5, 1.1);
  lightB.position.copy(bLocal);
  group.add(lightB);

  // Centauri Prime — a fictional inhabited ocean world in B's habitable
  // zone: continents, ice caps, a cloud deck, a blue limb, and cities that
  // light the night side. Two satellites and three freighters keep it
  // company, and it hails ships that come close.
  const lw = livingWorldTextures(97);
  const matLife = new THREE.MeshStandardMaterial({
    map: lw.day, roughness: 0.62, metalness: 0.02,
    emissiveMap: lw.night, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0.9,
  });
  const matClouds = new THREE.MeshStandardMaterial({ map: lw.clouds, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  owned.push(matLife, matClouds);
  textures.push(lw.day, lw.night, lw.clouds);
  const LIFE_ORBIT = 0.5;
  const lifeLocal = bLocal.clone().add(new THREE.Vector3(LIFE_ORBIT, -0.03, 0));
  const life = addBody('centauriPrime', lifeLocal, 1.15 * R_EARTH_KM, 9.9, 1.25, matLife, null, 'planet');
  life.body.hails = true;
  life.mesh.rotation.z = 0.35;
  const cloudGeom = new THREE.SphereGeometry(life.body.radius * 1.02, segs, segs);
  geoms.push(cloudGeom);
  const clouds = new THREE.Mesh(cloudGeom, matClouds);
  life.mesh.add(clouds);
  const atmo = makeAtmosphereShell(life.body.radius, 0x7fb4ff, 1.07, 1.35, 2.4);
  life.mesh.add(atmo);
  let lifeAngle = 0;

  // Satellites: a bus with two panels, on two inclined orbits.
  const satMat = new THREE.MeshStandardMaterial({ color: 0xd0d6dc, roughness: 0.4, metalness: 0.8 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1c2f6e, roughness: 0.4, metalness: 0.5, emissive: 0x16255a, emissiveIntensity: 0.5 });
  owned.push(satMat, panelMat);
  const sr = life.body.radius;
  const sats: { g: THREE.Group; r: number; rate: number; incl: number; phase: number }[] = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const bus = new THREE.Mesh(new THREE.BoxGeometry(sr * 0.05, sr * 0.05, sr * 0.08), satMat);
    geoms.push(bus.geometry);
    g.add(bus);
    for (const side of [-1, 1]) {
      const pnl = new THREE.Mesh(new THREE.BoxGeometry(sr * 0.16, sr * 0.005, sr * 0.06), panelMat);
      geoms.push(pnl.geometry);
      pnl.position.x = side * sr * 0.12;
      g.add(pnl);
    }
    group.add(g);
    sats.push({ g, r: sr * (1.6 + i * 0.7), rate: 0.5 - i * 0.18, incl: 0.3 + i * 0.6, phase: i * 2.1 });
  }

  // Freighters: long hulls with a ring habitat and cargo pods, drifting on
  // the lanes below the satellites, running lights pulsing.
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8e949c, roughness: 0.55, metalness: 0.6 });
  const podMat = new THREE.MeshStandardMaterial({ color: 0xb4522f, roughness: 0.7, metalness: 0.3 });
  const engMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 2.2) });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.2) });
  owned.push(hullMat, podMat, engMat, lampMat);
  const freighters: { g: THREE.Group; r: number; rate: number; y: number; phase: number }[] = [];
  const fl = sr * 0.5;
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const add = (geom: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      geoms.push(geom);
      const o = new THREE.Mesh(geom, m);
      o.position.set(x, y, z);
      o.rotation.x = rx;
      g.add(o);
      return o;
    };
    add(new THREE.CylinderGeometry(fl * 0.05, fl * 0.06, fl, 12), hullMat, 0, 0, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(fl * 0.16, fl * 0.025, 10, 32), hullMat, 0, 0, fl * 0.15, 0);
    add(new THREE.BoxGeometry(fl * 0.12, fl * 0.12, fl * 0.18), hullMat, 0, 0, fl * 0.42);
    for (let k = 0; k < 4; k++) {
      add(new THREE.BoxGeometry(fl * 0.07, fl * 0.07, fl * 0.12), podMat, Math.cos(k * 1.57) * fl * 0.09, Math.sin(k * 1.57) * fl * 0.09, -fl * 0.15);
    }
    add(new THREE.CylinderGeometry(fl * 0.03, fl * 0.05, fl * 0.08, 10), engMat, 0, 0, -fl * 0.52, Math.PI / 2);
    add(new THREE.SphereGeometry(fl * 0.012, 6, 6), lampMat, 0, fl * 0.07, fl * 0.5);
    add(new THREE.SphereGeometry(fl * 0.012, 6, 6), lampMat, 0, -fl * 0.07, -fl * 0.4);
    group.add(g);
    freighters.push({ g, r: sr * (3.2 + i * 1.1), rate: 0.09 - i * 0.02, y: (i - 1) * sr * 0.4, phase: i * 2.0 });
  }
  let lampClock = 0;

  // Proxima Centauri — M5.5V red dwarf, 0.154 R☉, well out from the pair.
  const matP = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.5, 0.28) });
  owned.push(matP);
  const proximaLocal = new THREE.Vector3(-2.6, -0.5, 1.6);
  addBody('proxima', proximaLocal, 0.154 * R_SUN_KM, 274, 1.5, matP, {
    color: new THREE.Color(1.0, 0.4, 0.22), scale: 3,
  });
  const lightP = new THREE.PointLight(0xff7a48, 2.4, 2.2, 1.1);
  lightP.position.copy(proximaLocal);
  group.add(lightP);

  // Proxima's worlds: b, a rocky 1.07 R⊕ in an 11-day orbit with a thin
  // air; d, a sub-Earth skimming the star every five days. Both cratered,
  // tidally locked, lit red by their sun.
  const texPb = crateredTexture(41, [126, 92, 76], 90);
  const matPb = new THREE.MeshStandardMaterial({ map: texPb, bumpMap: texPb, bumpScale: 0.003, roughness: 0.9, metalness: 0.05 });
  const texPd = crateredTexture(57, [96, 88, 84], 160);
  const matPd = new THREE.MeshStandardMaterial({ map: texPd, bumpMap: texPd, bumpScale: 0.002, roughness: 0.95, metalness: 0.02 });
  owned.push(matPb, matPd);
  textures.push(texPb, texPd);
  const PB_ORBIT = 0.24;
  const PD_ORBIT = 0.14;
  const pb = addBody('proximaB', proximaLocal.clone().add(new THREE.Vector3(PB_ORBIT, 0, 0)), 1.07 * R_EARTH_KM, 11.2, 1.2, matPb, null, 'planet');
  const pd = addBody('proximaD', proximaLocal.clone().add(new THREE.Vector3(0, 0, PD_ORBIT)), 0.81 * R_EARTH_KM, 6.5, 1, matPd, null, 'planet');
  let pbAngle = 0;

  // Alpha Centauri A's Neptune-size candidate (Wagner et al. 2021): a banded
  // ice giant with a faint ring, on a compressed 1.1 AU orbit.
  const texC1 = bandedTexture(73, [[96, 150, 190], [128, 178, 208], [70, 120, 170], [150, 190, 214]]);
  const matC1 = new THREE.MeshStandardMaterial({ map: texC1, roughness: 0.7, metalness: 0.05 });
  owned.push(matC1);
  textures.push(texC1);
  const C1_ORBIT = 0.95;
  const c1 = addBody('alphaCenAc', new THREE.Vector3(-C1_ORBIT, 0.02, 0), 3.9 * R_EARTH_KM, 11, 1.22, matC1, null, 'planet');
  const ringGeom = new THREE.RingGeometry(c1.body.radius * 1.5, c1.body.radius * 2.2, 96);
  geoms.push(ringGeom);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9fc4dc, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  owned.push(ringMat);
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = Math.PI / 2 + 0.35;
  c1.mesh.add(ring);
  let c1Angle = 0;

  // Drop out of hyperspace twelve radii short of A on the side away from B,
  // nose on the star, so the pair reads as A in front and B beyond it.
  const awayFromB = new THREE.Vector3(1.15, 0.06, 0.42).normalize().negate();
  const arrival: FlightAnchor = {
    position: center.clone().addScaledVector(awayFromB, a.body.radius * 12).add(new THREE.Vector3(0, a.body.radius * 2, 0)),
    lookAt: center.clone(),
    yaw: 0.3,
  };

  return {
    group,
    center,
    bodies,
    arrival,
    update(dtSec, cameraPos, camera) {
      coronaA.update(cameraPos, center, dtSec, camera);
      // The corona group is a child here, so undo the world position it sets.
      coronaA.group.position.set(0, 0, 0);
      pbAngle += dtSec * 0.06;
      pb.mesh.position.set(proximaLocal.x + Math.cos(pbAngle) * PB_ORBIT, proximaLocal.y, proximaLocal.z + Math.sin(pbAngle) * PB_ORBIT);
      pb.mesh.rotation.y = pbAngle;
      pb.body.position.copy(pb.mesh.position).add(center);
      pd.mesh.position.set(proximaLocal.x + Math.sin(pbAngle * 2.2) * PD_ORBIT, proximaLocal.y + 0.01, proximaLocal.z + Math.cos(pbAngle * 2.2) * PD_ORBIT);
      pd.mesh.rotation.y = -pbAngle * 2.2;
      pd.body.position.copy(pd.mesh.position).add(center);
      lifeAngle += dtSec * 0.01;
      life.mesh.position.set(bLocal.x + Math.cos(lifeAngle) * LIFE_ORBIT, bLocal.y - 0.03, bLocal.z + Math.sin(lifeAngle) * LIFE_ORBIT);
      life.mesh.rotation.y += dtSec * 0.12;
      clouds.rotation.y += dtSec * 0.02;
      life.body.position.copy(life.mesh.position).add(center);
      for (const sat of sats) {
        const a = sat.phase + lampClock * sat.rate;
        sat.g.position.set(
          life.mesh.position.x + Math.cos(a) * sat.r,
          life.mesh.position.y + Math.sin(a) * sat.r * Math.sin(sat.incl),
          life.mesh.position.z + Math.sin(a) * sat.r * Math.cos(sat.incl),
        );
        sat.g.lookAt(life.mesh.position.x, life.mesh.position.y, life.mesh.position.z);
      }
      lampClock += dtSec;
      lampMat.color.setRGB(2.4, 2.0, 1.2).multiplyScalar(0.75 + 0.25 * Math.sin(lampClock * 2.2));
      for (const f of freighters) {
        const a = f.phase + lampClock * f.rate;
        f.g.position.set(
          life.mesh.position.x + Math.cos(a) * f.r,
          life.mesh.position.y + f.y,
          life.mesh.position.z + Math.sin(a) * f.r,
        );
        // Nose along the lane.
        f.g.lookAt(
          life.mesh.position.x + Math.cos(a + 0.05) * f.r,
          life.mesh.position.y + f.y,
          life.mesh.position.z + Math.sin(a + 0.05) * f.r,
        );
      }
      c1Angle += dtSec * 0.012;
      c1.mesh.position.set(-Math.cos(c1Angle) * C1_ORBIT, 0.02, Math.sin(c1Angle) * C1_ORBIT);
      c1.mesh.rotation.y += dtSec * 0.3;
      c1.body.position.copy(c1.mesh.position).add(center);
    },
    dispose() {
      coronaA.dispose();
      lightA.dispose();
      lightB.dispose();
      lightP.dispose();
      disposeAtmosphereShell(atmo);
      for (const g of geoms) g.dispose();
      for (const m of owned) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
