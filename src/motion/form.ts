import { LM, allVisible, mid, type Pt } from './geometry';

const DEG = 180 / Math.PI;

/** Torso (hip midpoint → shoulder midpoint) angle from vertical, degrees. 0 = upright. */
export function torsoLeanDeg(w: Pt[]): number | null {
  if (!allVisible(w, [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP])) return null;
  const s = mid(w[LM.L_SHOULDER], w[LM.R_SHOULDER]);
  const h = mid(w[LM.L_HIP], w[LM.R_HIP]);
  const dx = s.x - h.x, dy = s.y - h.y, dz = s.z - h.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  // World y points down, so "up" is -y.
  return Math.acos(Math.min(1, Math.max(-1, -dy / len))) * DEG;
}

/**
 * Knee gap divided by ankle gap (left-right only).
 * Around 0.9–1.1 when the knees track over the feet; well below 1 when they cave in.
 */
export function kneeTrackingRatio(w: Pt[]): number | null {
  if (!allVisible(w, [LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE])) return null;
  const ankleGap = Math.abs(w[LM.L_ANKLE].x - w[LM.R_ANKLE].x);
  if (ankleGap < 0.12) return null; // feet too close together to judge
  return Math.abs(w[LM.L_KNEE].x - w[LM.R_KNEE].x) / ankleGap;
}

/** Thigh elevation, degrees: 0 = hanging straight down, 90 = horizontal. */
export function thighLiftDeg(w: Pt[], side: 'L' | 'R'): number | null {
  const [hip, knee] = side === 'L' ? [LM.L_HIP, LM.L_KNEE] : [LM.R_HIP, LM.R_KNEE];
  if (!allVisible(w, [hip, knee])) return null;
  const dx = w[knee].x - w[hip].x, dy = w[knee].y - w[hip].y, dz = w[knee].z - w[hip].z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  return Math.acos(Math.min(1, Math.max(-1, dy / len))) * DEG;
}

export type SquatTip = 'kneesOut' | 'chestUp' | 'slowDown';

/** Most important first. */
export const SQUAT_TIP_TEXT: Record<SquatTip, string> = {
  kneesOut: 'Push your knees out',
  chestUp: 'Keep your chest up',
  slowDown: 'Slow down, control it',
};

/**
 * Watches the bottom part of each squat and reports form tips when the rep completes.
 * A problem must show up on several frames so a single noisy frame doesn't trigger a tip.
 */
export class SquatFormMonitor {
  static readonly SAMPLE_BELOW_KNEE_DEG = 130;
  static readonly MAX_LEAN_DEG = 55;
  static readonly MIN_KNEE_RATIO = 0.72;
  static readonly MIN_REP_MS = 700;
  static readonly FRAMES_TO_FLAG = 3;

  private leanFrames = 0;
  private kneeFrames = 0;

  reset(): void {
    this.leanFrames = this.kneeFrames = 0;
  }

  sample(w: Pt[], kneeDeg: number): void {
    if (kneeDeg > SquatFormMonitor.SAMPLE_BELOW_KNEE_DEG) return;
    const lean = torsoLeanDeg(w);
    if (lean !== null && lean > SquatFormMonitor.MAX_LEAN_DEG) this.leanFrames++;
    const ratio = kneeTrackingRatio(w);
    if (ratio !== null && ratio < SquatFormMonitor.MIN_KNEE_RATIO) this.kneeFrames++;
  }

  /** Tips for the rep that just finished (empty = good rep). Resets the monitor. */
  evaluate(durationMs: number): SquatTip[] {
    const n = SquatFormMonitor.FRAMES_TO_FLAG;
    const tips: SquatTip[] = [];
    if (this.kneeFrames >= n) tips.push('kneesOut');
    if (this.leanFrames >= n) tips.push('chestUp');
    if (durationMs < SquatFormMonitor.MIN_REP_MS) tips.push('slowDown');
    this.reset();
    return tips;
  }
}
