/**
 * Pure rules for Shape Fit — poses, pose matching and the silhouette geometry.
 *
 * Limb directions are measured in the frontal (x/y) plane, per side, so left and right use the
 * same numbers: 0° = pointing straight down, 90° = straight out to the side (away from the body),
 * 180° = straight up, negative = pointing in across the body.
 */

export type Seg = 'lUpper' | 'lFore' | 'rUpper' | 'rFore' | 'lThigh' | 'lShin' | 'rThigh' | 'rShin';
export type Side = 'left' | 'right';

/** MediaPipe landmark indices for each limb segment. */
export const SEGMENTS: Record<Seg, { from: number; to: number; side: Side; limb: 'arm' | 'leg' }> = {
  lUpper: { from: 11, to: 13, side: 'left', limb: 'arm' },
  lFore: { from: 13, to: 15, side: 'left', limb: 'arm' },
  rUpper: { from: 12, to: 14, side: 'right', limb: 'arm' },
  rFore: { from: 14, to: 16, side: 'right', limb: 'arm' },
  lThigh: { from: 23, to: 25, side: 'left', limb: 'leg' },
  lShin: { from: 25, to: 27, side: 'left', limb: 'leg' },
  rThigh: { from: 24, to: 26, side: 'right', limb: 'leg' },
  rShin: { from: 26, to: 28, side: 'right', limb: 'leg' },
};
export const SEG_IDS = Object.keys(SEGMENTS) as Seg[];

/** Allowed difference from the target direction, degrees. */
export const ARM_TOLERANCE = 30;
export const LEG_TOLERANCE = 28;
/** Crouching poses: the hips must drop at least this share of the silhouette's drop. */
export const CROUCH_SHARE = 0.55;
/** A silhouette counts as crouching when its hips are this much lower than standing (m). */
export const CROUCH_MIN_DROP = 0.12;

export const START_LIVES = 3;
/** Walls spawn this far away and are judged when they reach the player (z = 0). */
export const WALL_SPAWN_Z = -12;
export const WALL_JUDGE_Z = 0;
/** The best match during the last part of the approach counts, so a late wobble isn't punished. */
export const JUDGE_WINDOW_SECONDS = 0.45;

export interface ShapePose {
  id: string;
  name: string;
  /** 1 = from the start, 2 = from wall 5, 3 = from wall 10 */
  tier: 1 | 2 | 3;
  angles: Record<Seg, number>;
}

type Pair = [upper: number, lower: number];

function pose(id: string, name: string, tier: 1 | 2 | 3, armL: Pair, armR: Pair, legL: Pair = [0, 0], legR: Pair = legL): ShapePose {
  return {
    id,
    name,
    tier,
    angles: {
      lUpper: armL[0], lFore: armL[1], rUpper: armR[0], rFore: armR[1],
      lThigh: legL[0], lShin: legL[1], rThigh: legR[0], rShin: legR[1],
    },
  };
}

// No pose crosses both forearms in front of the chest: that is the pause gesture.
export const POSES: ShapePose[] = [
  pose('tpose', 'Airplane', 1, [90, 90], [90, 90]),
  pose('sky', 'Touch the Sky', 1, [175, 175], [175, 175]),
  pose('star', 'Star', 1, [135, 135], [135, 135], [25, 25]),
  pose('strong', 'Strongman', 1, [90, 180], [90, 180]),
  pose('waveL', 'Wave Left', 1, [170, 170], [0, 0]),
  pose('waveR', 'Wave Right', 1, [0, 0], [170, 170]),
  pose('diagL', 'Diagonal', 2, [135, 135], [45, 45]),
  pose('diagR', 'Diagonal', 2, [45, 45], [135, 135]),
  pose('hero', 'Superhero', 2, [40, -40], [40, -40], [15, 15]),
  pose('disco', 'Disco', 2, [40, -40], [150, 150]),
  pose('archer', 'Archer', 2, [90, 90], [90, -90]),
  pose('sumo', 'Sumo Squat', 3, [90, 180], [90, 180], [60, -10]),
  pose('kick', 'Side Kick', 3, [90, 90], [90, 90], [0, 0], [50, 50]),
  pose('lightning', 'Lightning', 3, [135, 135], [40, -40], [25, 25]),
];

/** Smallest difference between two directions, 0..180 degrees. */
export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b + 540) % 360) + 360) % 360 - 180);
}

/** Direction of the segment from → to in the frontal plane (scene coordinates, y up). */
export function segAngle(from: { x: number; y: number }, to: { x: number; y: number }, side: Side): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // The player's left side is at -x in the scene, so "outward" is -x for left limbs.
  const out = side === 'left' ? -dx : dx;
  return (Math.atan2(out, -dy) * 180) / Math.PI;
}

/** Measured directions per segment; null when a joint isn't visible. */
export type SegAngles = Record<Seg, number | null>;

export function measureAngles(joint: (i: number) => { x: number; y: number } | null): SegAngles {
  const out = {} as SegAngles;
  for (const id of SEG_IDS) {
    const s = SEGMENTS[id];
    const a = joint(s.from);
    const b = joint(s.to);
    out[id] = a && b ? segAngle(a, b, s.side) : null;
  }
  return out;
}

export interface Match {
  ok: Record<Seg, boolean>;
  /** Crouching poses: are the hips low enough? Always true for standing poses. */
  hipsOk: boolean;
  misses: number;
  /** Misses that are not even close (more than twice the tolerance off, a missing joint, or hips too high). */
  far: number;
}

export function matchPose(target: ShapePose, actual: SegAngles, hipsOk = true): Match {
  const ok = {} as Record<Seg, boolean>;
  let misses = hipsOk ? 0 : 1;
  let far = misses;
  for (const id of SEG_IDS) {
    const a = actual[id];
    const tol = SEGMENTS[id].limb === 'arm' ? ARM_TOLERANCE : LEG_TOLERANCE;
    const diff = a === null ? Infinity : angleDiff(a, target.angles[id]);
    ok[id] = diff <= tol;
    if (!ok[id]) misses++;
    if (diff > tol * 2) far++;
  }
  return { ok, hipsOk, misses, far };
}

export type Verdict = 'perfect' | 'good' | 'crash';

/** Every segment right = perfect; one slightly off = good; anything more = crash through the wall. */
export function judge(m: { misses: number; far: number }): Verdict {
  if (m.misses === 0) return 'perfect';
  return m.misses === 1 && m.far === 0 ? 'good' : 'crash';
}

/** Ranks matches during the judging window: fewer misses first, then fewer far misses. */
export const betterMatch = (a: Match, b: Match | null) =>
  !b || a.misses < b.misses || (a.misses === b.misses && a.far < b.far);

export function pointsFor(verdict: Verdict, streak: number): number {
  if (verdict === 'crash') return 0;
  return (verdict === 'perfect' ? 100 : 50) + Math.min(10, Math.max(0, streak)) * 10;
}

/** Seconds a wall takes to arrive: 6.5 s at first, down to 3.2 s by wall 20. */
export function wallSeconds(wall: number): number {
  const p = Math.min(1, Math.max(0, wall / 20));
  return 6.5 + (3.2 - 6.5) * p;
}

export function tierFor(wall: number): 1 | 2 | 3 {
  return wall >= 10 ? 3 : wall >= 5 ? 2 : 1;
}

/** A random pose allowed at this wall, never the same as the previous one. */
export function pickPose(wall: number, prevId: string | null, rand: () => number = Math.random): ShapePose {
  const tier = tierFor(wall);
  const pool = POSES.filter((p) => p.tier <= tier && p.id !== prevId);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

// ------------------------------------------------------------------ silhouette

export interface BodyDims {
  shoulderHalf: number;
  hipHalf: number;
  /** hip center → shoulder center */
  torso: number;
  upperArm: number;
  forearm: number;
  thigh: number;
  shin: number;
  head: number;
}

export const DEFAULT_DIMS: BodyDims = {
  shoulderHalf: 0.19, hipHalf: 0.11, torso: 0.5, upperArm: 0.29, forearm: 0.26, thigh: 0.42, shin: 0.41, head: 0.12,
};

/** Ankles sit this far above the floor. */
const ANKLE_HEIGHT = 0.08;

export type JointMap = Map<number, { x: number; y: number }>;

/** Point at `len` along direction `deg` (see the angle convention above) from `p`. */
function along(p: { x: number; y: number }, deg: number, len: number, side: Side): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const out = Math.sin(r) * len;
  return { x: p.x + (side === 'left' ? -out : out), y: p.y - Math.cos(r) * len };
}

/** Standing hip height for these dimensions. */
export const standingHipY = (d: BodyDims) => ANKLE_HEIGHT + d.thigh + d.shin;

/**
 * Joint positions (landmark index → x/y) of the pose drawn for a body with these dimensions,
 * standing on the floor (y = 0) and centered on `centerX`. Index 0 is the head center.
 */
export function silhouette(p: ShapePose, d: BodyDims, centerX = 0): JointMap {
  const a = p.angles;
  // Leg drop below the hips, per side; the lower foot stands on the floor.
  const legDrop = (thigh: number, shin: number) =>
    Math.cos((thigh * Math.PI) / 180) * d.thigh + Math.cos((shin * Math.PI) / 180) * d.shin;
  const hipY = ANKLE_HEIGHT + Math.max(legDrop(a.lThigh, a.lShin), legDrop(a.rThigh, a.rShin));

  const j: JointMap = new Map();
  const lHip = { x: centerX - d.hipHalf, y: hipY };
  const rHip = { x: centerX + d.hipHalf, y: hipY };
  const shY = hipY + d.torso;
  const lSh = { x: centerX - d.shoulderHalf, y: shY };
  const rSh = { x: centerX + d.shoulderHalf, y: shY };
  j.set(23, lHip).set(24, rHip).set(11, lSh).set(12, rSh);
  j.set(0, { x: centerX, y: shY + 0.1 + d.head });

  const lEl = along(lSh, a.lUpper, d.upperArm, 'left');
  const rEl = along(rSh, a.rUpper, d.upperArm, 'right');
  j.set(13, lEl).set(14, rEl);
  j.set(15, along(lEl, a.lFore, d.forearm, 'left')).set(16, along(rEl, a.rFore, d.forearm, 'right'));

  const lKn = along(lHip, a.lThigh, d.thigh, 'left');
  const rKn = along(rHip, a.rThigh, d.thigh, 'right');
  j.set(25, lKn).set(26, rKn);
  j.set(27, along(lKn, a.lShin, d.shin, 'left')).set(28, along(rKn, a.rShin, d.shin, 'right'));
  return j;
}

/** How far the silhouette's hips are below standing (0 for standing poses). */
export function crouchDrop(p: ShapePose, d: BodyDims): number {
  const hipY = (silhouette(p, d).get(23) as { y: number }).y;
  const drop = standingHipY(d) - hipY;
  return drop >= CROUCH_MIN_DROP ? drop : 0;
}
