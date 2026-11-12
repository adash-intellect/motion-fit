import { describe, expect, it } from 'vitest';
import {
  BLOCK_Z, LAUNCH_Z, curveAmount, flightPoint, keeperDifficulty, pickAim, pickKind, pointsForSave,
} from '../goalkeeperRules';
import {
  DEFAULT_DIMS, POSES, SEG_IDS, angleDiff, crouchDrop, judge, matchPose, measureAngles, pickPose, pointsFor,
  segAngle, silhouette, standingHipY, wallSeconds,
} from '../shapeFitRules';

/** Deterministic pseudo-random sequence. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe('goalkeeper rules', () => {
  const body = { centerX: 0, kneeY: 0.5, hipY: 0.95, headY: 1.65, reach: 0.8 };

  it('gets faster and trickier, then levels off', () => {
    const start = keeperDifficulty(0);
    const late = keeperDifficulty(40);
    expect(late.interval).toBeLessThan(start.interval);
    expect(late.speed).toBeGreaterThan(start.speed);
    expect(start.curveChance + start.fireChance + start.doubleChance).toBe(0); // straight shots to start
    expect(keeperDifficulty(400)).toEqual(late);
    expect(pickKind(start, 0)).toBe('ball');
    expect(pickKind(late, 0)).toBe('fire');
  });

  it('scores trickier balls and streaks higher', () => {
    expect(pointsForSave('ball', 0)).toBe(10);
    expect(pointsForSave('curve', 0)).toBe(15);
    expect(pointsForSave('fire', 0)).toBe(20);
    expect(pointsForSave('ball', 3)).toBe(16);
    expect(pointsForSave('ball', 99)).toBe(30); // streak bonus capped
  });

  it('never aims where the hands hang at rest, and stays within reach', () => {
    const rand = seeded(7);
    for (let i = 0; i < 500; i++) {
      const { x, y } = pickAim(body, rand);
      const out = Math.abs(x - body.centerX);
      expect(out).toBeLessThanOrEqual(body.reach + 1e-9);
      expect(out).toBeGreaterThanOrEqual(0.3);
      if (y < body.hipY + 0.15) expect(out).toBeGreaterThanOrEqual(0.45);
      expect(y).toBeGreaterThanOrEqual(body.kneeY - 0.15);
      expect(y).toBeLessThanOrEqual(body.headY + 0.3 + 1e-9);
    }
  });

  it('flies from the launcher to exactly the aim point, curving on the way', () => {
    const from = { x: 1, y: 0.8 };
    const aim = { x: -0.6, y: 1.4 };
    const curve = curveAmount('curve', aim.x, 0, () => 0.5);
    expect(curve).toBeGreaterThan(0); // aimed left → bows right first
    expect(curveAmount('ball', aim.x, 0)).toBe(0);

    const start = flightPoint(from, aim, 0.5, curve, 0);
    expect(start).toEqual({ x: 1, y: 0.8, z: LAUNCH_Z });
    const arrive = flightPoint(from, aim, 0.5, curve, 1);
    expect(arrive.x).toBeCloseTo(aim.x);
    expect(arrive.y).toBeCloseTo(aim.y);
    expect(arrive.z).toBeCloseTo(BLOCK_Z);
    const mid = flightPoint(from, aim, 0.5, curve, 0.5);
    expect(mid.y).toBeCloseTo((from.y + aim.y) / 2 + 0.5); // arc peaks mid-flight
    expect(flightPoint(from, aim, 0.5, curve, 1.05).z).toBeGreaterThan(BLOCK_Z); // keeps going
  });
});

describe('shape fit rules', () => {
  const byId = (id: string) => POSES.find((p) => p.id === id)!;

  it('measures limb directions per side: down 0, out 90, up 180, in negative', () => {
    const o = { x: 0, y: 0 };
    expect(segAngle(o, { x: 0, y: -1 }, 'right')).toBeCloseTo(0);
    expect(segAngle(o, { x: 1, y: 0 }, 'right')).toBeCloseTo(90);
    expect(segAngle(o, { x: -1, y: 0 }, 'left')).toBeCloseTo(90); // the left side is at -x
    expect(angleDiff(segAngle(o, { x: 0, y: 1 }, 'left'), 180)).toBeCloseTo(0);
    expect(segAngle(o, { x: -1, y: 0 }, 'right')).toBeCloseTo(-90);
    expect(angleDiff(170, -170)).toBeCloseTo(20);
    expect(angleDiff(-40, 40)).toBeCloseTo(80);
  });

  it('a body in the silhouette pose matches it perfectly, and every pose differs from the others', () => {
    for (const pose of POSES) {
      const joints = silhouette(pose, DEFAULT_DIMS);
      const angles = measureAngles((i) => joints.get(i) ?? null);
      const own = matchPose(pose, angles);
      expect(own.misses, pose.id).toBe(0);
      expect(judge(own)).toBe('perfect');

      for (const other of POSES) {
        if (other === pose || other.name === pose.name) continue;
        expect(judge(matchPose(other, angles)), `${pose.id} as ${other.id}`).toBe('crash');
      }
    }
  });

  it('just standing does not pass a wall', () => {
    const stand = measureAngles((i) => {
      const j = silhouette(byId('waveL'), DEFAULT_DIMS); // borrow leg and torso positions
      if (i === 13 || i === 15) return { x: j.get(11)!.x, y: j.get(11)!.y - (i === 13 ? 0.29 : 0.55) };
      return j.get(i) ?? null;
    });
    for (const pose of POSES) expect(judge(matchPose(pose, stand)), pose.id).toBe('crash');
  });

  it('allows one limb off for a "good", and missing joints count as off', () => {
    const pose = byId('tpose');
    const joints = silhouette(pose, DEFAULT_DIMS);
    const angles = measureAngles((i) => joints.get(i) ?? null);
    expect(judge(matchPose(pose, { ...angles, lFore: 0 }))).toBe('crash'); // 90° off: not close
    expect(judge(matchPose(pose, { ...angles, lFore: 45 }))).toBe('good'); // 45° off: close
    expect(judge(matchPose(pose, { ...angles, lFore: 45, rFore: 45 }))).toBe('crash');
    expect(judge(matchPose(pose, { ...angles, lFore: null, rFore: null }))).toBe('crash');
    expect(matchPose(pose, angles, false).misses).toBe(1); // hips not low enough
    expect(SEG_IDS).toHaveLength(8);
  });

  it('stands the silhouette on the floor; only real squats need a crouch', () => {
    const stand = silhouette(byId('tpose'), DEFAULT_DIMS);
    expect(stand.get(23)!.y).toBeCloseTo(standingHipY(DEFAULT_DIMS));
    const kick = silhouette(byId('kick'), DEFAULT_DIMS);
    expect(Math.min(kick.get(27)!.y, kick.get(28)!.y)).toBeCloseTo(0.08); // standing leg on the floor
    expect(kick.get(28)!.y).toBeGreaterThan(0.2); // kicking leg lifted
    expect(crouchDrop(byId('sumo'), DEFAULT_DIMS)).toBeGreaterThan(0.15);
    expect(crouchDrop(byId('star'), DEFAULT_DIMS)).toBe(0);
    expect(crouchDrop(byId('kick'), DEFAULT_DIMS)).toBe(0);
  });

  it('walls speed up, harder poses unlock, and the same pose never comes twice in a row', () => {
    expect(wallSeconds(0)).toBeCloseTo(6.5);
    expect(wallSeconds(20)).toBeCloseTo(3.2);
    expect(wallSeconds(100)).toBeCloseTo(3.2);
    const rand = seeded(3);
    let prev: string | null = null;
    for (let wall = 0; wall < 60; wall++) {
      const p = pickPose(wall, prev, rand);
      expect(p.id).not.toBe(prev);
      expect(p.tier).toBeLessThanOrEqual(wall >= 10 ? 3 : wall >= 5 ? 2 : 1);
      prev = p.id;
    }
    expect(pointsFor('perfect', 0)).toBe(100);
    expect(pointsFor('good', 2)).toBe(70);
    expect(pointsFor('crash', 5)).toBe(0);
  });
});
