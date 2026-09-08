// Desktop controls for Explore Mode: keyboard plus pointer-lock mouse. The
// mouse is shaped here — a dead zone against sensor jitter, a soft response
// curve so small corrections are fine and big sweeps are quick, and a cap on
// how far one frame's motion can turn the nose — before the flight model
// ever sees it, so every ship gets the same feel.

import * as THREE from 'three';
import type { FlightInput, FlightSession, SpeedMode } from '@/lib/solar-system/player-ship';

const HANDLED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
  'Digit1', 'Digit2', 'Digit3', 'KeyF', 'KeyH', 'KeyV', 'KeyC', 'KeyZ', 'KeyT', 'KeyG', 'KeyR',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight',
]);

/** Chase-camera distance multiplier: how close and how far the player can pull. */
const CAM_ZOOM_MIN = 0.45;
const CAM_ZOOM_MAX = 3.2;
const CAM_ZOOM_STEP = 1.16;
/** Pixels of motion that count as none — trackpads and optical sensors drift. */
const MOUSE_DEAD_PX = 0.6;
/** Radians per pixel at the linear part of the curve. */
const MOUSE_SENS = 0.0014;
/** One frame of pointer motion can turn the nose at most this far — a flick
 *  of the wrist should not spin the ship. */
const MOUSE_MAX_STEP = 0.06;

/** Pull the chase camera in or push it out, within its stops. */
export function zoomFlightCamera(input: FlightInput, direction: number) {
  const next = input.camZoom * (direction > 0 ? CAM_ZOOM_STEP : 1 / CAM_ZOOM_STEP);
  input.camZoom = THREE.MathUtils.clamp(next, CAM_ZOOM_MIN, CAM_ZOOM_MAX);
}

/** Pixels of pointer travel → radians of commanded turn, with dead zone,
 *  a gentle power curve and a per-frame cap. */
export function shapeMouse(px: number, turn: number): number {
  const mag = Math.abs(px);
  if (mag < MOUSE_DEAD_PX) return 0;
  const shaped = Math.pow(mag - MOUSE_DEAD_PX, 1.12) * MOUSE_SENS * turn;
  return Math.sign(px) * Math.min(MOUSE_MAX_STEP, shaped);
}

/**
 * Keyboard + pointer-lock mouse. Must be called from a user gesture so the
 * lock request is honoured; returns the detach function. `onExit` fires on
 * ESC / X, or when a held pointer lock is released by the browser.
 */
export function attachDesktopControls(
  session: FlightSession,
  lockTarget: HTMLElement,
  onExit: () => void,
): () => void {
  const input = session.input;
  const pressed = new Set<string>();
  const sync = () => {
    const has = (c: string) => pressed.has(c);
    input.thrust = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0);
    input.yaw = (has('KeyD') || has('ArrowRight') ? 1 : 0) - (has('KeyA') || has('ArrowLeft') ? 1 : 0);
    input.roll = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
    input.boost = has('ShiftLeft') || has('ShiftRight');
    input.fire = has('Space');
    input.align = has('KeyG');
  };
  const modeFor: Record<string, SpeedMode> = { Digit1: 'cruise', Digit2: 'fast', Digit3: 'jump', KeyH: 'jump' };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'KeyX') {
      onExit();
      return;
    }
    if (session.paused || !HANDLED_KEYS.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    const mode = modeFor[e.code];
    if (mode) input.modeRequest = mode;
    else if (e.code === 'KeyF') input.foilsToggle = true;
    else if (e.code === 'KeyV') input.eject = true;
    else if (e.code === 'KeyC') input.viewToggle = true;
    else if (e.code === 'KeyZ') input.assistToggle = true;
    else if (e.code === 'KeyT') input.targetStep = e.shiftKey ? -1 : 1;
    else if (e.code === 'KeyR') input.targetClear = true;
    else if (e.code === 'Minus' || e.code === 'BracketLeft') zoomFlightCamera(input, 1);
    else if (e.code === 'Equal' || e.code === 'BracketRight') zoomFlightCamera(input, -1);
    pressed.add(e.code);
    sync();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!pressed.delete(e.code)) return;
    sync();
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!session.active || session.paused) return;
    if (!document.pointerLockElement && !(e.buttons & 1)) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  };
  const onWheel = (e: WheelEvent) => {
    if (session.paused) return;
    e.preventDefault();
    zoomFlightCamera(input, e.deltaY > 0 ? 1 : -1);
  };
  const onBlur = () => {
    pressed.clear();
    sync();
    input.mouseDX = input.mouseDY = 0;
  };
  let lockHeld = false;
  const onLockChange = () => {
    if (document.pointerLockElement === lockTarget) {
      lockHeld = true;
    } else if (lockHeld) {
      lockHeld = false;
      onBlur();
      if (!session.paused) onExit();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);
  try {
    const req = lockTarget.requestPointerLock() as unknown;
    if (req instanceof Promise) req.catch(() => undefined);
  } catch {
    // Pointer lock is optional — movementX/Y still steer without it.
  }
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerlockchange', onLockChange);
    lockHeld = false;
    if (document.pointerLockElement === lockTarget) document.exitPointerLock();
    clearFlightInput(input);
  };
}

export function clearFlightInput(input: FlightInput) {
  input.thrust = 0;
  input.yaw = 0;
  input.lookYaw = 0;
  input.pitch = 0;
  input.roll = 0;
  input.boost = false;
  input.fire = false;
  input.align = false;
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.modeRequest = null;
  input.foilsToggle = false;
  input.eject = false;
  input.viewToggle = false;
  input.assistToggle = false;
  input.targetStep = 0;
  input.targetClear = false;
  input.targetRequest = null;
  input.camZoom = 1;
}
