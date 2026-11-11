import type { MotionFrame, Pt } from '../geometry';

export interface PoseOptions {
  /** knee angle in degrees (180 = straight legs) */
  kneeDeg?: number;
  arms?: 'down' | 'up' | 'crossed';
  /** distance between ankles, meters */
  feetGap?: number;
  /** whole body raised off the floor, meters (jumping) — image space only */
  lift?: number;
  visibility?: number;
  /** torso tipped forward from vertical, degrees */
  torsoLeanDeg?: number;
  /** each knee moved this many meters toward the midline (knees caving in) */
  kneesIn?: number;
  /** one thigh lifted forward (high knee), degrees from hanging straight down */
  raiseKnee?: { side: 'L' | 'R'; deg: number };
}

const THIGH = 0.45;
const SHIN = 0.45;
const IMG_SCALE = 0.3; // normalized image units per meter
const GROUND_Y = 0.9;

/**
 * Builds a plausible MediaPipe-like frame (world: meters, hip-centered, y down;
 * image: normalized, feet on GROUND_Y unless lifted). Player's left side is +x.
 */
export function makeFrame(t: number, o: PoseOptions = {}): MotionFrame {
  const { kneeDeg = 178, arms = 'down', feetGap = 0.25, lift = 0, visibility = 0.99, torsoLeanDeg = 0, kneesIn = 0 } = o;
  const a = ((180 - kneeDeg) * Math.PI) / 180;
  const w: Pt[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility }));
  const set = (i: number, x: number, y: number, z = 0) => (w[i] = { x, y, z, visibility });

  set(0, 0, -0.65);
  for (const [s, sh, el, wr, hip, knee, ankle] of [
    [1, 11, 13, 15, 23, 25, 27],
    [-1, 12, 14, 16, 24, 26, 28],
  ] as const) {
    set(sh, s * 0.18, -0.5);
    if (arms === 'down') {
      set(el, s * 0.2, -0.25);
      set(wr, s * 0.22, 0);
    } else if (arms === 'up') {
      set(el, s * 0.25, -0.75);
      set(wr, s * 0.28, -0.95);
    } else {
      set(el, s * 0.2, -0.3, -0.15);
      set(wr, -s * 0.08, -0.3, -0.25);
    }
    const hx = s * 0.1;
    const ax = (s * feetGap) / 2;
    set(hip, hx, 0);
    const raised = o.raiseKnee && (o.raiseKnee.side === 'L' ? 1 : -1) === s ? o.raiseKnee.deg : null;
    if (raised !== null) {
      const r = (raised * Math.PI) / 180;
      set(knee, hx, THIGH * Math.cos(r), -THIGH * Math.sin(r));
      set(ankle, hx, THIGH * Math.cos(r) + SHIN, -THIGH * Math.sin(r));
      continue;
    }
    const ky = THIGH * Math.cos(a);
    const kz = -THIGH * Math.sin(a);
    set(knee, (hx + ax) / 2 - s * kneesIn, ky, kz);
    set(ankle, ax, ky + SHIN, kz);
  }
  for (let i = 1; i <= 10; i++) w[i] = { ...w[0] };
  for (const i of [17, 19, 21]) w[i] = { ...w[15] };
  for (const i of [18, 20, 22]) w[i] = { ...w[16] };
  for (const i of [29, 31]) w[i] = { ...w[27] };
  for (const i of [30, 32]) w[i] = { ...w[28] };
  if (torsoLeanDeg) {
    // Tip the upper body (landmarks 0–22) forward (toward -z) around the hips.
    const th = (torsoLeanDeg * Math.PI) / 180;
    for (let i = 0; i <= 22; i++) {
      const p = w[i];
      w[i] = { ...p, y: p.y * Math.cos(th), z: p.z + p.y * Math.sin(th) };
    }
  }

  const floor = Math.max(w[27].y, w[28].y);
  const image = w.map((p) => ({
    x: 0.5 + p.x * IMG_SCALE,
    y: GROUND_Y - lift * IMG_SCALE - (floor - p.y) * IMG_SCALE,
    z: p.z,
    visibility,
  }));
  return { world: w, image, t };
}

export const FRAME_MS = 33;

/** Linearly interpolates numeric pose options from `from` to `to` over `ms`. */
export function* ramp(
  startT: number,
  ms: number,
  from: PoseOptions,
  to: PoseOptions,
  fixed: PoseOptions = {},
): Generator<MotionFrame> {
  const steps = Math.max(1, Math.round(ms / FRAME_MS));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const lerp = (key: 'kneeDeg' | 'feetGap' | 'lift', def: number) =>
      (from[key] ?? def) + ((to[key] ?? def) - (from[key] ?? def)) * k;
    yield makeFrame(startT + i * FRAME_MS, {
      ...fixed,
      arms: k < 0.5 ? (from.arms ?? fixed.arms) : (to.arms ?? fixed.arms),
      kneeDeg: lerp('kneeDeg', 178),
      feetGap: lerp('feetGap', 0.25),
      lift: lerp('lift', 0),
    });
  }
}
