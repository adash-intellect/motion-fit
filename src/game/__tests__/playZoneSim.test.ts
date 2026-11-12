import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Stage } from '../../scene/stage';
import { Sfx } from '../sfx';
import type { ArcadeGame, PlayEvents } from '../arcadeGame';
import { Goalkeeper } from '../goalkeeper';
import { ShapeFit } from '../shapeFit';
import { DEFAULT_DIMS, POSES, silhouette, type ShapePose } from '../shapeFitRules';

/** Just enough of the Stage for the games: a scene, a camera and settable joints. */
function fakeStage() {
  const joints = new Map<number, THREE.Vector3>();
  const stage = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200),
    getJoint(i: number, out: THREE.Vector3) {
      const p = joints.get(i);
      if (!p) return false;
      out.copy(p);
      return true;
    },
    getHand(side: 'left' | 'right', out: THREE.Vector3) {
      return stage.getJoint(side === 'left' ? 15 : 16, out);
    },
    pulse() {},
  };
  stage.camera.position.set(0, 1.8, 3);
  stage.camera.lookAt(0, 1.15, -4);
  stage.camera.updateMatrixWorld();
  /** Put the body in a pose (2D positions; depth 0). */
  const strike = (pose: ShapePose) => {
    joints.clear();
    for (const [i, p] of silhouette(pose, DEFAULT_DIMS)) joints.set(i, new THREE.Vector3(p.x, p.y, 0));
  };
  return { stage: stage as unknown as Stage, joints, strike };
}

const standing = POSES.find((p) => p.id === 'waveL')!; // borrowed for its standing legs and torso

/** Run the game in 1/60 s steps until it ends (or the time limit), calling `each` before every step. */
function run(game: ArcadeGame, seconds: number, each: (t: number) => void) {
  const ends: PlayEvents['end'][] = [];
  const popups: string[] = [];
  game.events.on('end', (e) => ends.push(e));
  game.events.on('popup', (e) => popups.push(e.text));
  game.start();
  const dt = 1 / 60;
  for (let t = 0; t < seconds && !ends.length; t += dt) {
    each(t);
    game.onPose(t * 1000);
    game.update(dt);
  }
  return { end: ends[0] ?? null, popups };
}

describe('Goalkeeper (simulated)', () => {
  it('a keeper who never moves concedes three goals and the game ends', () => {
    const { stage, strike, joints } = fakeStage();
    const game = new Goalkeeper(stage, new Sfx());
    const { end, popups } = run(game, 60, () => {
      strike(standing);
      // Both arms hanging at the sides.
      joints.set(15, new THREE.Vector3(-0.25, 0.85, 0));
      joints.set(16, new THREE.Vector3(0.25, 0.85, 0));
    });
    expect(end).not.toBeNull();
    expect(end!.score).toBe(0);
    expect(popups.filter((p) => p === 'GOAL!')).toHaveLength(3);
    expect(game.isActive).toBe(false);
  });

  it('a keeper whose hand meets every ball keeps saving', () => {
    const { stage, strike, joints } = fakeStage();
    const game = new Goalkeeper(stage, new Sfx());
    const balls = (game as unknown as { balls: { mesh: THREE.Mesh; rebound: unknown }[] }).balls;
    const { end, popups } = run(game, 45, () => {
      strike(standing);
      // Move the right hand onto whichever incoming ball is closest to the player.
      const next = balls.filter((b) => !b.rebound).sort((a, b) => b.mesh.position.z - a.mesh.position.z)[0];
      if (next) joints.set(16, next.mesh.position.clone());
    });
    expect(end).toBeNull(); // still alive after 45 s
    expect(popups.filter((p) => p === 'GOAL!')).toHaveLength(0);
    expect(popups.length).toBeGreaterThan(10);
    game.stop();
  });
});

describe('Shape Fit (simulated)', () => {
  it('copying every wall pose clears every wall perfectly', () => {
    const { stage, strike } = fakeStage();
    const game = new ShapeFit(stage, new Sfx());
    const current = () => (game as unknown as { wall: { pose: ShapePose } | null }).wall?.pose ?? standing;
    const { end, popups } = run(game, 90, () => strike(current()));
    expect(end).toBeNull();
    expect(popups.length).toBeGreaterThanOrEqual(10);
    expect(popups.every((p) => p.startsWith('PERFECT'))).toBe(true);
    game.stop();
  });

  it('standing still crashes through three walls and ends the game', () => {
    const { stage, strike, joints } = fakeStage();
    const game = new ShapeFit(stage, new Sfx());
    const { end, popups } = run(game, 60, () => {
      strike(standing);
      const sh = joints.get(11)!;
      joints.set(13, new THREE.Vector3(sh.x, sh.y - 0.29, 0)); // left arm down too
      joints.set(15, new THREE.Vector3(sh.x, sh.y - 0.55, 0));
    });
    expect(end).not.toBeNull();
    expect(popups).toEqual(['CRASH!', 'CRASH!', 'CRASH!']);
    expect(end!.stats.find((s) => s.label === 'Walls faced')!.value).toBe('3');
  });
});
