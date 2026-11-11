import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { RiggedAvatar } from '../riggedAvatar';
import { P, type ScenePose } from '../types';
import { makeFrame, type PoseOptions } from '../../../motion/__tests__/syntheticPose';

const GLB = resolve(process.cwd(), 'public/models/character.glb');

/** Same landmark → scene mapping as Stage.updatePose. */
function scenePose(opts: PoseOptions, mirrored: boolean): ScenePose {
  const { world } = makeFrame(0, opts);
  const zSign = mirrored ? -1 : 1;
  const points = world.map((p) => new THREE.Vector3(-p.x, -p.y + 1, zSign * p.z));
  return { points, visible: points.map(() => true), mirrored };
}

const angleDeg = (a: THREE.Vector3, b: THREE.Vector3) => THREE.MathUtils.radToDeg(a.angleTo(b));

describe.skipIf(!existsSync(GLB))('rigged character retargeting', () => {
  let avatar: RiggedAvatar;

  beforeAll(async () => {
    const buf = readFileSync(GLB);
    avatar = await RiggedAvatar.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  });

  const poses: [string, PoseOptions][] = [
    ['standing', {}],
    ['arms up, feet wide', { arms: 'up', feetGap: 0.6 }],
    ['deep squat', { kneeDeg: 95 }],
    ['arms crossed forward', { arms: 'crossed' }],
  ];

  for (const mirrored of [false, true]) {
    for (const [name, opts] of poses) {
      it(`points every limb at the tracked joints — ${name} (${mirrored ? 'mirror' : 'behind'} view)`, () => {
        const pose = scenePose(opts, mirrored);
        avatar.update(pose);

        // In mirror view the character's left side follows the player's right.
        const L = mirrored ? 'R' : 'L';
        const R = mirrored ? 'L' : 'R';
        const idx = (side: 'L' | 'R', joint: string) => P[`${side}_${joint}` as keyof typeof P];

        const checks: [Parameters<RiggedAvatar['bonePosition']>[0], Parameters<RiggedAvatar['bonePosition']>[0], 'L' | 'R', string, string][] = [
          ['lArm', 'lForeArm', L, 'SHOULDER', 'ELBOW'],
          ['lForeArm', 'lHand', L, 'ELBOW', 'WRIST'],
          ['rArm', 'rForeArm', R, 'SHOULDER', 'ELBOW'],
          ['rForeArm', 'rHand', R, 'ELBOW', 'WRIST'],
          ['lUpLeg', 'lLeg', L, 'HIP', 'KNEE'],
          ['lLeg', 'lFoot', L, 'KNEE', 'ANKLE'],
          ['rUpLeg', 'rLeg', R, 'HIP', 'KNEE'],
          ['rLeg', 'rFoot', R, 'KNEE', 'ANKLE'],
        ];
        for (const [boneA, boneB, side, j1, j2] of checks) {
          const rigDir = avatar.bonePosition(boneB, new THREE.Vector3()).sub(avatar.bonePosition(boneA, new THREE.Vector3()));
          const want = pose.points[idx(side, j2)].clone().sub(pose.points[idx(side, j1)]);
          expect(angleDeg(rigDir, want), `${boneA}→${boneB}`).toBeLessThan(3);
        }

        // Hips are placed on the tracked hip midpoint.
        const hipMid = pose.points[P.L_HIP].clone().add(pose.points[P.R_HIP]).multiplyScalar(0.5);
        expect(avatar.bonePosition('hips', new THREE.Vector3()).distanceTo(hipMid)).toBeLessThan(0.02);

        // The character's left hand is on the same side as the tracked joint it follows.
        const lHand = avatar.bonePosition('lHand', new THREE.Vector3());
        const target = pose.points[idx(L, 'WRIST')];
        const other = pose.points[idx(R, 'WRIST')];
        expect(lHand.distanceTo(target)).toBeLessThan(lHand.distanceTo(other));
      });
    }
  }

  it('faces into the arena in behind view and toward the camera in mirror view', () => {
    const forward = () => {
      // Body forward = (left hip → right hip) × up, using the rig's own bones.
      const across = avatar.bonePosition('lUpLeg', new THREE.Vector3()).sub(avatar.bonePosition('rUpLeg', new THREE.Vector3()));
      const up = avatar.bonePosition('spine2', new THREE.Vector3()).sub(avatar.bonePosition('hips', new THREE.Vector3()));
      return new THREE.Vector3().crossVectors(across, up).normalize();
    };
    avatar.update(scenePose({}, false));
    const behindFwd = forward();
    avatar.update(scenePose({}, true));
    const mirrorFwd = forward();
    // Rest pose faces +z with this formula; behind view must be the opposite of mirror view.
    expect(behindFwd.z).toBeLessThan(-0.9);
    expect(mirrorFwd.z).toBeGreaterThan(0.9);
  });

  it('scales the character to the player', () => {
    avatar.update(scenePose({}, false));
    const hip = avatar.bonePosition('lUpLeg', new THREE.Vector3());
    const foot = avatar.bonePosition('lFoot', new THREE.Vector3());
    const knee = avatar.bonePosition('lLeg', new THREE.Vector3());
    const rigLeg = hip.distanceTo(knee) + knee.distanceTo(foot);
    expect(rigLeg).toBeGreaterThan(0.75);
    expect(rigLeg).toBeLessThan(1.05);
  });
});
