import * as THREE from 'three';

/** MediaPipe pose landmark indices used by the avatars. */
export const P = {
  NOSE: 0,
  L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_PINKY: 17, R_PINKY: 18,
  L_INDEX: 19, R_INDEX: 20,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32,
} as const;

/** Tracked body in scene space (meters, y up, feet on the floor). */
export interface ScenePose {
  points: THREE.Vector3[];
  visible: boolean[];
  /**
   * True when the scene shows a mirror image (a reflection, not a rotation).
   * Rigged characters swap left/right so the figure still looks natural.
   */
  mirrored: boolean;
}

export interface Avatar {
  readonly object: THREE.Object3D;
  update(pose: ScenePose | null): void;
  dispose(): void;
}

const tmpX = new THREE.Vector3();
const tmpY = new THREE.Vector3();
const tmpZ = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

/**
 * Orthonormal rotation from an "across" axis (x) and an "up" axis (y).
 * If `forwardHint` is given and the resulting forward (z) points away from it,
 * x is flipped so the object faces the hint (keeps it a rotation, never a reflection).
 */
export function basisQuaternion(
  across: THREE.Vector3,
  up: THREE.Vector3,
  out: THREE.Quaternion,
  forwardHint?: THREE.Vector3 | null,
): THREE.Quaternion {
  tmpY.copy(up).normalize();
  tmpX.copy(across).addScaledVector(tmpY, -across.dot(tmpY));
  if (tmpX.lengthSq() < 1e-8) {
    // Degenerate (across parallel to up): pick any axis perpendicular to up.
    tmpX.set(1, 0, 0).addScaledVector(tmpY, -tmpY.x);
    if (tmpX.lengthSq() < 1e-8) tmpX.set(0, 0, 1);
  }
  tmpX.normalize();
  tmpZ.crossVectors(tmpX, tmpY);
  if (forwardHint && tmpZ.dot(forwardHint) < 0) {
    tmpX.negate();
    tmpZ.negate();
  }
  tmpM.makeBasis(tmpX, tmpY, tmpZ);
  return out.setFromRotationMatrix(tmpM);
}

export const allVisible = (pose: ScenePose, ...idx: number[]) => idx.every((i) => pose.visible[i]);
