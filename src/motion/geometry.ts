/** Minimal landmark shape shared by MediaPipe image and world landmarks. */
export interface Pt {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** One pose sample: world landmarks in meters (hip-centered, y down), image landmarks normalized 0..1. */
export interface MotionFrame {
  world: Pt[];
  image: Pt[];
  /** milliseconds */
  t: number;
}

/** MediaPipe Pose landmark indices used by the motion layer. */
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
} as const;

export const isVisible = (p: Pt | undefined, min = 0.5): p is Pt =>
  !!p && (p.visibility ?? 1) >= min;

export const allVisible = (pts: Pt[], idx: number[], min = 0.5) =>
  idx.every((i) => isVisible(pts[i], min));

export const mid = (a: Pt, b: Pt): Pt => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
  visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
});

export const dist3 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Angle ABC at vertex B, in degrees (0..180). */
export function angleDeg(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x, v1y = a.y - b.y, v1z = a.z - b.z;
  const v2x = c.x - b.x, v2y = c.y - b.y, v2z = c.z - b.z;
  const n = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z);
  if (n === 0) return 180;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y + v1z * v2z) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Average knee angle of the visible legs (180 = straight), or null if no leg is visible. */
export function kneeAngle(world: Pt[]): number | null {
  const legs: [number, number, number][] = [
    [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
    [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
  ];
  const angles = legs
    .filter((leg) => allVisible(world, leg))
    .map(([h, k, a]) => angleDeg(world[h], world[k], world[a]));
  if (!angles.length) return null;
  return angles.reduce((s, v) => s + v, 0) / angles.length;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
