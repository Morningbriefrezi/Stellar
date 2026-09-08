// The chase camera for Explore Mode. It is a rig on a spring behind the
// ship rather than a point pinned to it: acceleration pulls it back, braking
// pushes it in, a turn swings it to the outside, the lens opens with speed
// and boost, and a smooth noise field shakes it under thrust, in air and on
// impact. Every response is written as an exponential approach in dt, so the
// feel is the same at 30 and 144 fps. The cockpit eye reuses the same
// acceleration cue as a small head lag.

import * as THREE from 'three';

export type CameraView = 'chase' | 'cockpit' | 'crash';

export interface CameraFrame {
  view: CameraView;
  /** Physics frame of whatever is being flown. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  /** Angular rates (rad/s) in the body frame: x pitch, y yaw, z roll. */
  angular: THREE.Vector3;
  /** Speed as a fraction of the regime's ceiling, 0..1+. */
  speedFrac: number;
  /** Full-throttle acceleration of the regime — normalises the pullback. */
  accelRef: number;
  boost: boolean;
  /** Airframe bank (rad) the hull is showing. */
  bank: number;
  /** Rest distance behind and above the actor, in scene units. */
  camBack: number;
  camUp: number;
  lookAhead: number;
  fov: number;
  /** Local-space eye for the cockpit view. */
  cockpitEye: THREE.Vector3;
  /** 0..1 — atmospheric heating; buffets the rig. */
  heat: number;
  /** Where the camera looks while the wreck burns. */
  crashLook: THREE.Vector3;
}

export interface CameraRig {
  update: (dt: number, frame: CameraFrame, camera: THREE.PerspectiveCamera) => void;
  /** Next update lands the camera instantly — spawn, respawn, view change. */
  snap: () => void;
  /** Add impulse shake (0..~1.5): hits, collisions, the jump. */
  kick: (amount: number) => void;
  /** Current shake amplitude for the HUD. */
  shake: () => number;
}

/** Smooth, deterministic noise: three incommensurate sines — no random
 *  jitter, so the shake reads as a structure vibrating, not as static. */
function wobble(t: number, phase: number): number {
  return Math.sin(t * 37.1 + phase) * 0.5 + Math.sin(t * 23.7 + phase * 1.7 + 1.0) * 0.32 + Math.sin(t * 61.3 + phase * 0.6 + 2.0) * 0.18;
}

export function makeCameraRig(): CameraRig {
  const camPos = new THREE.Vector3();
  const camUp = new THREE.Vector3(0, 1, 0);
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const headLag = new THREE.Vector3();
  const bankedUp = new THREE.Vector3();
  const rollQ = new THREE.Quaternion();
  let snap = true;
  let prevVFwd = 0;
  let accel = 0;
  let impulse = 0;
  let fov = 0;
  let back = 0;
  let clock = 0;
  let lastView: CameraView = 'chase';

  return {
    update(dt, f, camera) {
      clock += dt;
      if (f.view !== lastView) {
        lastView = f.view;
        snap = true;
      }
      fwd.set(0, 0, 1).applyQuaternion(f.quaternion);
      up.set(0, 1, 0).applyQuaternion(f.quaternion);
      right.crossVectors(fwd, up);

      // Longitudinal acceleration, normalised to the drive's own push, and
      // low-passed so a single frame's thrust step cannot snap the rig.
      const vFwd = f.velocity.dot(fwd);
      const raw = dt > 0 ? (vFwd - prevVFwd) / dt : 0;
      prevVFwd = vFwd;
      const norm = f.accelRef > 0 ? THREE.MathUtils.clamp(raw / f.accelRef, -1.5, 1.5) : 0;
      accel += (norm - accel) * (1 - Math.exp(-dt * 5));

      impulse *= Math.exp(-dt * 2.4);
      const buffet = (f.boost ? 0.09 : 0) + (f.speedFrac > 0.92 ? 0.05 : 0) + f.heat * 0.45;
      const amp = impulse + buffet;

      if (f.view === 'crash') {
        camera.up.copy(camUp);
        camera.lookAt(f.crashLook);
      } else if (f.view === 'cockpit') {
        // The head is pushed back into the seat under thrust and forward
        // under braking, and sags a little into a turn.
        headLag.set(
          f.angular.y * 0.00025,
          -f.angular.x * 0.00012,
          -accel * 0.00035,
        );
        eye.copy(f.cockpitEye).add(headLag).applyQuaternion(f.quaternion).add(f.position);
        camera.position.copy(eye);
        camUp.copy(up);
        camera.up.copy(camUp);
        look.copy(eye).addScaledVector(fwd, f.lookAhead).addScaledVector(right, -f.angular.y * f.lookAhead * 0.05);
        camera.lookAt(look);
      } else {
        // Rest distance grows with speed; thrust pulls the rig back, braking
        // pushes it in on the tail.
        const backTarget = f.camBack * (1 + 0.16 * Math.min(1, f.speedFrac) + 0.22 * Math.max(0, accel) - 0.14 * Math.max(0, -accel));
        if (snap) back = backTarget;
        back += (backTarget - back) * (1 - Math.exp(-dt * 3.5));
        // Turning swings the rig to the outside and lets it fall on a climb.
        const swing = f.camBack * 0.35;
        target.copy(f.position)
          .addScaledVector(fwd, -back)
          .addScaledVector(up, f.camUp - f.angular.x * swing * 0.5)
          .addScaledVector(right, f.angular.y * swing);
        if (snap) {
          camPos.copy(target);
          camUp.copy(up);
        } else {
          // Tighter with speed: at cruise the rig floats, at a tenth of c it
          // is bolted to the tail — anything looser reads as lag, not mass.
          const rate = 6 + 8 * Math.min(1, f.speedFrac);
          camPos.lerp(target, 1 - Math.exp(-dt * rate));
          // The camera takes a share of the airframe's bank.
          rollQ.setFromAxisAngle(fwd, f.bank * 0.35);
          bankedUp.copy(up).applyQuaternion(rollQ);
          camUp.lerp(bankedUp, 1 - Math.exp(-dt * 5)).normalize();
        }
        camera.position.copy(camPos);
        camera.up.copy(camUp);
        look.copy(f.position)
          .addScaledVector(fwd, f.lookAhead)
          .addScaledVector(right, -f.angular.y * f.lookAhead * 0.12);
        camera.lookAt(look);
      }

      if (amp > 0.002) {
        const s = amp * f.camBack * 0.045;
        camera.position
          .addScaledVector(right, wobble(clock, 0) * s)
          .addScaledVector(up, wobble(clock, 3.3) * s)
          .addScaledVector(fwd, wobble(clock, 6.1) * s * 0.4);
      }

      const fovTarget = f.fov + (f.boost ? 9 : 0) + 5 * Math.min(1, f.speedFrac) ** 2;
      if (snap || fov === 0) fov = fovTarget;
      fov += (fovTarget - fov) * (1 - Math.exp(-dt * 3.2));
      if (Math.abs(fov - camera.fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      snap = false;
    },
    snap() {
      snap = true;
    },
    kick(amount) {
      impulse = Math.max(impulse, amount);
    },
    shake() {
      return impulse;
    },
  };
}
