import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { P, allVisible, type Avatar, type ScenePose } from './types';

/** Bones we drive, matched by name suffix so any Mixamo-rigged character works. */
const BONE_SUFFIX = {
  hips: 'hips', spine: 'spine', spine1: 'spine1', spine2: 'spine2', neck: 'neck', head: 'head',
  lArm: 'leftarm', lForeArm: 'leftforearm', lHand: 'lefthand', lMiddle: 'lefthandmiddle1',
  rArm: 'rightarm', rForeArm: 'rightforearm', rHand: 'righthand', rMiddle: 'righthandmiddle1',
  lUpLeg: 'leftupleg', lLeg: 'leftleg', lFoot: 'leftfoot', lToe: 'lefttoebase',
  rUpLeg: 'rightupleg', rLeg: 'rightleg', rFoot: 'rightfoot', rToe: 'righttoebase',
} as const;
type BoneKey = keyof typeof BONE_SUFFIX;
const REQUIRED: BoneKey[] = [
  'hips', 'spine', 'spine1', 'spine2', 'neck', 'head', 'lArm', 'lForeArm', 'lHand', 'rArm', 'rForeArm',
  'rHand', 'lUpLeg', 'lLeg', 'lFoot', 'rUpLeg', 'rLeg', 'rFoot',
];

/** Landmark indices for the character's left/right side. */
interface Side {
  shoulder: number; elbow: number; wrist: number; index: number; pinky: number;
  hip: number; knee: number; ankle: number; foot: number;
}
const LEFT: Side = {
  shoulder: P.L_SHOULDER, elbow: P.L_ELBOW, wrist: P.L_WRIST, index: P.L_INDEX, pinky: P.L_PINKY,
  hip: P.L_HIP, knee: P.L_KNEE, ankle: P.L_ANKLE, foot: P.L_FOOT,
};
const RIGHT: Side = {
  shoulder: P.R_SHOULDER, elbow: P.R_ELBOW, wrist: P.R_WRIST, index: P.R_INDEX, pinky: P.R_PINKY,
  hip: P.R_HIP, knee: P.R_KNEE, ankle: P.R_ANKLE, foot: P.R_FOOT,
};

// Scratch objects (avoid per-frame allocations).
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const mA = new THREE.Matrix4();
const mB = new THREE.Matrix4();

function basis(across: THREE.Vector3, up: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  const y = vA.copy(up).normalize();
  const x = vB.copy(across).addScaledVector(y, -across.dot(y)).normalize();
  const z = vC.crossVectors(x, y);
  return out.makeBasis(x, y, z);
}

/**
 * A skinned glTF character driven by pose landmarks.
 *
 * Retargeting approach (rig-agnostic): each frame the skeleton is reset to its rest pose,
 * then walked parent→child. Hips and chest are rotated so their rest "body frame" matches
 * the tracked one; each limb bone is rotated by the smallest rotation that points it at
 * the tracked joint. No knowledge of the rig's local axes is needed.
 */
export class RiggedAvatar implements Avatar {
  readonly object = new THREE.Group();
  private bones = {} as Record<BoneKey, THREE.Bone | undefined>;
  private readonly restLocal = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly restWorld = new Map<THREE.Bone, THREE.Quaternion>();
  private restHipsBasis = new THREE.Matrix4();
  private restChestBasis = new THREE.Matrix4();
  private rigLegLength = 1;
  private scale = 0;

  private constructor(private readonly model: THREE.Object3D) {
    this.object.add(model);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // skinned bounds don't follow the pose
      }
    });

    const all: THREE.Bone[] = [];
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) all.push(o as THREE.Bone);
    });
    for (const [key, suffix] of Object.entries(BONE_SUFFIX) as [BoneKey, string][]) {
      this.bones[key] = all.find((b) => b.name.toLowerCase().endsWith(suffix));
    }
    const missing = REQUIRED.filter((k) => !this.bones[k]);
    if (missing.length) throw new Error(`Character rig is missing bones: ${missing.join(', ')}`);

    model.updateMatrixWorld(true);
    for (const b of all) {
      this.restLocal.set(b, b.quaternion.clone());
      this.restWorld.set(b, b.getWorldQuaternion(new THREE.Quaternion()));
    }
    const w = (k: BoneKey) => this.bones[k]!.getWorldPosition(new THREE.Vector3());
    this.restHipsBasis = basis(w('lUpLeg').sub(w('rUpLeg')), w('spine2').sub(w('hips')), new THREE.Matrix4());
    this.restChestBasis = basis(w('lArm').sub(w('rArm')), w('spine2').sub(w('hips')), new THREE.Matrix4());
    this.rigLegLength =
      (w('lUpLeg').distanceTo(w('lLeg')) + w('lLeg').distanceTo(w('lFoot')) +
        w('rUpLeg').distanceTo(w('rLeg')) + w('rLeg').distanceTo(w('rFoot'))) / 2;
  }

  static async load(url: string): Promise<RiggedAvatar> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new RiggedAvatar(gltf.scene);
  }

  /** Build from raw GLB bytes (used by tests). */
  static async fromBuffer(data: ArrayBuffer): Promise<RiggedAvatar> {
    const gltf = await new GLTFLoader().parseAsync(data, '');
    return new RiggedAvatar(gltf.scene);
  }

  /** World position of a driven bone (used by tests). */
  bonePosition(key: BoneKey, out: THREE.Vector3): THREE.Vector3 {
    return this.bones[key]!.getWorldPosition(out);
  }

  update(pose: ScenePose | null): void {
    this.object.visible = !!pose;
    if (!pose || !allVisible(pose, P.L_HIP, P.R_HIP, P.L_SHOULDER, P.R_SHOULDER)) {
      this.object.visible = false;
      return;
    }
    const pts = pose.points;
    // A mirror image is a reflection: the figure's left side is driven by the player's right.
    const L = pose.mirrored ? RIGHT : LEFT;
    const R = pose.mirrored ? LEFT : RIGHT;
    const b = this.bones as Record<BoneKey, THREE.Bone>;

    // 1. Reset to rest pose.
    for (const [bone, q] of this.restLocal) bone.quaternion.copy(q);

    // 2. Scale to the player's leg length, and place the hips.
    if (allVisible(pose, L.hip, L.knee, L.ankle, R.hip, R.knee, R.ankle)) {
      const leg =
        (pts[L.hip].distanceTo(pts[L.knee]) + pts[L.knee].distanceTo(pts[L.ankle]) +
          pts[R.hip].distanceTo(pts[R.knee]) + pts[R.knee].distanceTo(pts[R.ankle])) / 2;
      const target = (leg * 1.05) / this.rigLegLength; // rig leg ends at the ankle joint, add a little for the foot
      this.scale = this.scale === 0 ? target : this.scale + (target - this.scale) * 0.05;
    }
    if (this.scale === 0) this.scale = 1.7 / (this.rigLegLength * 2.1);
    this.model.scale.setScalar(this.scale);

    const hipMid = new THREE.Vector3().addVectors(pts[L.hip], pts[R.hip]).multiplyScalar(0.5);
    const shoulderMid = new THREE.Vector3().addVectors(pts[L.shoulder], pts[R.shoulder]).multiplyScalar(0.5);
    this.model.position.set(0, 0, 0);
    this.model.updateMatrixWorld(true);
    const hipsWorld = b.hips.getWorldPosition(new THREE.Vector3());
    this.model.position.copy(hipMid).sub(hipsWorld);
    this.model.updateMatrixWorld(true);

    // 3. Torso: rotate hips and chest so their rest body frames match the tracked frames.
    const up = new THREE.Vector3().subVectors(shoulderMid, hipMid);
    const hipDelta = this.frameDelta(
      new THREE.Vector3().subVectors(pts[L.hip], pts[R.hip]), up, this.restHipsBasis, new THREE.Quaternion(),
    );
    const chestDelta = this.frameDelta(
      new THREE.Vector3().subVectors(pts[L.shoulder], pts[R.shoulder]), up, this.restChestBasis, new THREE.Quaternion(),
    );
    this.setWorld(b.hips, qB.copy(hipDelta).multiply(this.restWorld.get(b.hips)!));
    const spineChain: [THREE.Bone, number][] = [[b.spine, 0.33], [b.spine1, 0.66], [b.spine2, 1]];
    for (const [bone, t] of spineChain) {
      qA.copy(hipDelta).slerp(chestDelta, t);
      this.setWorld(bone, qB.copy(qA).multiply(this.restWorld.get(bone)!));
    }

    // 4. Head: point the neck toward the ears (or nose).
    const headTarget = allVisible(pose, P.L_EAR, P.R_EAR)
      ? new THREE.Vector3().addVectors(pts[P.L_EAR], pts[P.R_EAR]).multiplyScalar(0.5)
      : pose.visible[P.NOSE] ? pts[P.NOSE] : null;
    if (headTarget) this.aim(b.neck, b.head, vC.subVectors(headTarget, shoulderMid));

    // 5. Limbs, parent → child.
    for (const [side, arm, fore, hand, middle, upLeg, leg, foot, toe] of [
      [L, b.lArm, b.lForeArm, b.lHand, b.lMiddle, b.lUpLeg, b.lLeg, b.lFoot, b.lToe],
      [R, b.rArm, b.rForeArm, b.rHand, b.rMiddle, b.rUpLeg, b.rLeg, b.rFoot, b.rToe],
    ] as const) {
      this.aimBetween(pose, arm, fore, side.shoulder, side.elbow);
      this.aimBetween(pose, fore, hand, side.elbow, side.wrist);
      if (middle && allVisible(pose, side.wrist, side.index, side.pinky)) {
        // Use vC: aim() overwrites vA/vB internally.
        const dir = vC.addVectors(pts[side.index], pts[side.pinky]).multiplyScalar(0.5).sub(pts[side.wrist]);
        this.aim(hand, middle, dir);
      }
      this.aimBetween(pose, upLeg, leg, side.hip, side.knee);
      this.aimBetween(pose, leg, foot, side.knee, side.ankle);
      if (toe) this.aimBetween(pose, foot, toe, side.ankle, side.foot);
    }
  }

  /** Rotation taking the rest body frame to the tracked one. */
  private frameDelta(across: THREE.Vector3, up: THREE.Vector3, rest: THREE.Matrix4, out: THREE.Quaternion) {
    basis(across, up, mA);
    mB.copy(rest).transpose(); // inverse of a rotation
    return out.setFromRotationMatrix(mA.multiply(mB));
  }

  private aimBetween(pose: ScenePose, bone: THREE.Bone, child: THREE.Bone, from: number, to: number): void {
    if (!pose.visible[from] || !pose.visible[to]) return;
    this.aim(bone, child, vC.subVectors(pose.points[to], pose.points[from]));
  }

  /** Smallest rotation that points bone→child along `dir` (world space). */
  private aim(bone: THREE.Bone, child: THREE.Bone, dir: THREE.Vector3): void {
    if (dir.lengthSq() < 1e-8) return;
    const from = bone.getWorldPosition(vA);
    const cur = child.getWorldPosition(vB).sub(from).normalize();
    qA.setFromUnitVectors(cur, dir.clone().normalize());
    bone.getWorldQuaternion(qB);
    this.setWorld(bone, qA.multiply(qB));
  }

  private setWorld(bone: THREE.Bone, worldQ: THREE.Quaternion): void {
    const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    bone.quaternion.copy(parentQ.invert().multiply(worldQ));
    bone.updateMatrixWorld(true);
  }

  dispose(): void {
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
    });
  }
}
