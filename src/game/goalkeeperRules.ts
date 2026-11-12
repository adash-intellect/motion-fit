/** Pure rules for Goalkeeper — kept separate so they are easy to tune and test. */

export type BallKind = 'ball' | 'curve' | 'fire';

export const START_LIVES = 3;
/** Balls are launched from here (far end of the arena). */
export const LAUNCH_Z = -16;
/** The plane just in front of the player where balls can be blocked. */
export const BLOCK_Z = -0.3;
/** How far either side of BLOCK_Z a block still counts (single-camera depth is rough). */
export const BLOCK_DEPTH = 0.6;
/** The goal line behind the player: a ball past it is a goal. */
export const GOAL_Z = 0.6;
/** Block tolerance in the x/y plane: ball radius + hand (or foot) radius. */
export const HAND_RADIUS = 0.3;
export const FOOT_RADIUS = 0.26;
/** Fireballs fly this much faster than normal shots. */
export const FIRE_SPEED_FACTOR = 1.35;

export interface KeeperDifficulty {
  /** seconds between shots */
  interval: number;
  /** meters per second */
  speed: number;
  curveChance: number;
  fireChance: number;
  /** chance of a second ball fired at the same time */
  doubleChance: number;
}

/** Ramps up over the first 40 shots, then stays at the top level. */
export function keeperDifficulty(shots: number): KeeperDifficulty {
  const p = Math.min(1, Math.max(0, shots / 40));
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return {
    interval: lerp(2.4, 1.05),
    speed: lerp(7, 12.5),
    curveChance: shots < 6 ? 0 : lerp(0.1, 0.35),
    fireChance: shots < 10 ? 0 : lerp(0.08, 0.25),
    doubleChance: shots < 20 ? 0 : lerp(0.05, 0.25),
  };
}

export function pickKind(d: KeeperDifficulty, r: number): BallKind {
  if (r < d.fireChance) return 'fire';
  if (r < d.fireChance + d.curveChance) return 'curve';
  return 'ball';
}

/** Base points by ball type, plus a streak bonus (+2 per save in a row, up to +20). */
export function pointsForSave(kind: BallKind, streak: number): number {
  const base = kind === 'fire' ? 20 : kind === 'curve' ? 15 : 10;
  return base + Math.min(10, Math.max(0, streak)) * 2;
}

export interface AimBody {
  centerX: number;
  kneeY: number;
  hipY: number;
  headY: number;
  reach: number;
}

/**
 * Where a shot crosses the block plane. Always somewhere a hand or foot can reach, but never
 * where the hands hang at rest (beside the hips), so every save needs a move.
 */
export function pickAim(body: AimBody, rand: () => number = Math.random): { x: number; y: number } {
  const side = rand() < 0.5 ? -1 : 1;
  const low = body.kneeY - 0.15;
  const high = body.headY + 0.3;
  const y = low + rand() * Math.max(0.3, high - low);
  // Next to the hips the arms hang down, so low balls go wider.
  const minOut = y < body.hipY + 0.15 ? 0.45 : 0.3;
  const out = minOut + rand() * Math.max(0.05, body.reach - minOut);
  return { x: body.centerX + side * out, y };
}

/** Sideways bow of a curve ball (meters at mid-flight); bends toward the aim side's opposite first. */
export function curveAmount(kind: BallKind, aimX: number, centerX: number, rand: () => number = Math.random): number {
  if (kind !== 'curve') return 0;
  const away = aimX >= centerX ? -1 : 1;
  return away * (0.8 + rand() * 0.7);
}

/** Position on the flight path for u = 0 (launch) … 1 (block plane); u > 1 keeps going straight. */
export function flightPoint(
  from: { x: number; y: number },
  aim: { x: number; y: number },
  arc: number,
  curve: number,
  u: number,
): { x: number; y: number; z: number } {
  const k = Math.min(u, 1);
  const bow = 4 * k * (1 - k);
  // Past the block plane, continue along the final direction (derivative of the bow at u = 1 is -4).
  const extra = Math.max(0, u - 1);
  return {
    x: from.x + (aim.x - from.x) * u + curve * (bow - 4 * extra),
    y: from.y + (aim.y - from.y) * u + arc * (bow - 4 * extra),
    z: LAUNCH_Z + (BLOCK_Z - LAUNCH_Z) * u,
  };
}
