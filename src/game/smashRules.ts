/** Pure game rules for Target Smash — kept separate so they are easy to tune and test. */

export type TargetKind = 'orb' | 'low' | 'bomb';

export const ROUND_SECONDS = 60;
export const COUNTDOWN_SECONDS = 3;

/** Hand must be this fast (m/s) when it hits for a POWER bonus. */
export const POWER_SPEED = 2.2;

/** Hit tolerance: target radius + hand radius in the x/y plane, and depth window. */
export const HIT_RADIUS_XY = 0.3;
export const HIT_DEPTH = 0.6;

export const SPAWN_Z = -14;
/** Plane (in front of the player) where targets are meant to be hit. */
export const HIT_PLANE_Z = -0.35;
/** Past this z the target is behind the player → missed. */
export const MISS_Z = 0.7;

export interface Difficulty {
  /** seconds between spawns */
  spawnInterval: number;
  /** meters per second */
  speed: number;
  bombChance: number;
  lowChance: number;
  pairChance: number;
}

/** Difficulty ramps smoothly over the round (progress 0 → 1). */
export function difficulty(progress: number): Difficulty {
  const p = Math.min(1, Math.max(0, progress));
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return {
    spawnInterval: lerp(1.15, 0.55),
    speed: lerp(5, 8.5),
    bombChance: p < 0.15 ? 0 : lerp(0.05, 0.18),
    lowChance: lerp(0.15, 0.3),
    pairChance: p < 0.4 ? 0 : lerp(0, 0.3),
  };
}

/** Combo multiplier: x1, then +1 every 5 consecutive hits, capped at x4. */
export function multiplier(combo: number): number {
  return Math.min(4, 1 + Math.floor(combo / 5));
}

export function pointsFor(kind: TargetKind, power: boolean, mult: number): number {
  if (kind === 'bomb') return -20;
  const base = kind === 'low' ? 15 : 10;
  return base * mult * (power ? 2 : 1);
}

export interface SmashStats {
  score: number;
  hits: number;
  misses: number;
  bombsHit: number;
  powerHits: number;
  lowHits: number;
  bestCombo: number;
  squats: number;
  jumps: number;
}

export const accuracy = (s: SmashStats) =>
  s.hits + s.misses === 0 ? 0 : s.hits / (s.hits + s.misses);
