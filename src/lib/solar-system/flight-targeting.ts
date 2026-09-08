// Navigation targets for Explore Mode: everything the deck can lock —
// every solid body, the deep-space probes, an alien contact, the
// hyperdrive's destination — ordered by range so cycling walks outward
// from the ship. The selected target is projected to the glass each frame;
// when it leaves the frame the marker slides to the edge and points.

import * as THREE from 'three';

export type TargetKind = 'star' | 'planet' | 'moon' | 'station' | 'probe' | 'contact' | 'jump';

export interface TargetCandidate {
  id: string;
  kind: TargetKind;
  position: THREE.Vector3;
}

/** Screen-space marker state, in normalised device coordinates (-1..1). */
export interface TargetScreen {
  x: number;
  y: number;
  /** 1 when the target is inside the frame, 0 when the marker is an edge arrow. */
  on: number;
  /** Direction the edge arrow points, radians, screen-space (0 = right, π/2 = up). */
  angle: number;
}

const EDGE = 0.86;
const dist = new THREE.Vector3();
const proj = new THREE.Vector3();

/** Walk the candidate list by range from `from`; `dir` +1 outward, -1 inward. */
export function stepTarget(cands: TargetCandidate[], currentId: string, from: THREE.Vector3, dir: number): string {
  if (!cands.length) return '';
  const sorted = cands
    .map((c) => ({ id: c.id, d: dist.copy(c.position).sub(from).lengthSq() }))
    .sort((a, b) => a.d - b.d);
  const i = sorted.findIndex((c) => c.id === currentId);
  if (i < 0) return dir >= 0 ? sorted[0].id : sorted[sorted.length - 1].id;
  const n = sorted.length;
  return sorted[(i + (dir >= 0 ? 1 : -1) + n) % n].id;
}

/** Project a world point onto the glass; off-frame targets become an arrow
 *  on the frame's edge pointing the way. */
export function projectTarget(pos: THREE.Vector3, camera: THREE.Camera, out: TargetScreen) {
  proj.copy(pos).applyMatrix4(camera.matrixWorldInverse);
  const behind = proj.z >= 0;
  proj.z = -Math.max(Math.abs(proj.z), 1e-6);
  proj.applyMatrix4(camera.projectionMatrix);
  const x = proj.x;
  const y = proj.y;
  if (!behind && Math.abs(x) <= EDGE && Math.abs(y) <= EDGE) {
    out.x = x;
    out.y = y;
    out.on = 1;
    out.angle = 0;
    return;
  }
  const len = Math.hypot(x, y) || 1;
  let ex = x / len;
  let ey = y / len;
  if (behind && Math.hypot(x, y) < 0.05) {
    ex = 0;
    ey = -1;
  }
  const k = EDGE / Math.max(Math.abs(ex), Math.abs(ey));
  out.x = ex * k;
  out.y = ey * k;
  out.on = 0;
  out.angle = Math.atan2(ey, ex);
}
