import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RobotAvatar } from '../robotAvatar';
import type { ScenePose } from '../types';
import { makeFrame, type PoseOptions } from '../../../motion/__tests__/syntheticPose';

function scenePose(opts: PoseOptions, mirrored: boolean): ScenePose {
  const { world } = makeFrame(0, opts);
  const zSign = mirrored ? -1 : 1;
  const points = world.map((p) => new THREE.Vector3(-p.x, -p.y + 1, zSign * p.z));
  // Synthetic nose sits on the body's center line; push it forward like a real face.
  points[0].z += zSign * -0.1;
  return { points, visible: points.map(() => true), mirrored };
}

/** The visor is the emissive mesh inside the head group. */
function visorWorldZ(robot: RobotAvatar): { visor: number; head: number } {
  robot.object.updateMatrixWorld(true);
  let visor = 0, head = 0;
  robot.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.material as THREE.MeshStandardMaterial).emissiveIntensity > 2 && m.parent !== robot.object) {
      const g = m.parent!;
      if (g.children.length === 4) {
        visor = m.getWorldPosition(new THREE.Vector3()).z;
        head = g.getWorldPosition(new THREE.Vector3()).z;
      }
    }
  });
  return { visor, head };
}

describe('robot avatar', () => {
  it('builds every part without NaNs across poses', () => {
    const robot = new RobotAvatar();
    for (const opts of [{}, { arms: 'up' as const }, { kneeDeg: 95 }, { arms: 'crossed' as const }]) {
      robot.update(scenePose(opts, false));
      robot.object.updateMatrixWorld(true);
      robot.object.traverse((o) => {
        const e = o.matrixWorld.elements;
        expect(e.every(Number.isFinite)).toBe(true);
      });
    }
  });

  it('faces into the arena in behind view and toward the camera in mirror view', () => {
    const robot = new RobotAvatar();
    robot.update(scenePose({}, false));
    const behind = visorWorldZ(robot);
    expect(behind.visor).toBeLessThan(behind.head);

    robot.update(scenePose({}, true));
    const mirror = visorWorldZ(robot);
    expect(mirror.visor).toBeGreaterThan(mirror.head);
  });

  it('hides when there is no pose', () => {
    const robot = new RobotAvatar();
    robot.update(null);
    expect(robot.object.visible).toBe(false);
  });
});
