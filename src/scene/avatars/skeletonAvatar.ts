import * as THREE from 'three';
import { POSE_CONNECTIONS } from '../../pose/poseTracker';
import type { Avatar, ScenePose } from './types';

const FACE_MAX_INDEX = 10;
const UP = new THREE.Vector3(0, 1, 0);

/** Debug view: joints as spheres, bones as sticks. */
export class SkeletonAvatar implements Avatar {
  readonly object = new THREE.Group();
  private readonly joints: THREE.Mesh[] = [];
  private readonly bones: { mesh: THREE.Mesh; a: number; b: number }[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor() {
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0c4a6e });
    const handMat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0x7c2d12 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
    const faceGeo = new THREE.SphereGeometry(0.018, 12, 8);
    const jointGeo = new THREE.SphereGeometry(0.035, 16, 12);
    const boneGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 10);
    this.disposables.push(jointMat, handMat, boneMat, faceGeo, jointGeo, boneGeo);
    const handIdx = new Set([15, 16, 17, 18, 19, 20]);

    for (let i = 0; i < 33; i++) {
      const mesh = new THREE.Mesh(i <= FACE_MAX_INDEX ? faceGeo : jointGeo, handIdx.has(i) ? handMat : jointMat);
      mesh.castShadow = true;
      this.joints.push(mesh);
      this.object.add(mesh);
    }
    for (const { start, end } of POSE_CONNECTIONS) {
      if (start <= FACE_MAX_INDEX && end <= FACE_MAX_INDEX) continue;
      const mesh = new THREE.Mesh(boneGeo, boneMat);
      mesh.castShadow = true;
      this.bones.push({ mesh, a: start, b: end });
      this.object.add(mesh);
    }
  }

  update(pose: ScenePose | null): void {
    this.object.visible = !!pose;
    if (!pose) return;
    const dir = new THREE.Vector3();
    pose.points.forEach((p, i) => {
      this.joints[i].visible = pose.visible[i];
      this.joints[i].position.copy(p);
    });
    for (const b of this.bones) {
      const ok = pose.visible[b.a] && pose.visible[b.b];
      b.mesh.visible = ok;
      if (!ok) continue;
      const pa = pose.points[b.a], pb = pose.points[b.b];
      dir.subVectors(pb, pa);
      b.mesh.position.addVectors(pa, pb).multiplyScalar(0.5);
      b.mesh.scale.set(1, dir.length(), 1);
      b.mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
