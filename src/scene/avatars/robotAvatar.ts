import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { P, allVisible, basisQuaternion, type Avatar, type ScenePose } from './types';

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

interface Limb {
  mesh: THREE.Mesh;
  a: number;
  b: number;
}

/**
 * Stylized robot built from primitives: glossy white shell, dark metal joints,
 * glowing visor and chest core. Robust to tracking noise and needs no assets.
 */
export class RobotAvatar implements Avatar {
  readonly object = new THREE.Group();

  private readonly mat = {
    shell: new THREE.MeshPhysicalMaterial({
      color: 0xeef2f8, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.85 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 2.2 }),
  };
  private readonly geos: THREE.BufferGeometry[] = [];

  private readonly limbs: Limb[] = [];
  private readonly joints: { mesh: THREE.Mesh; i: number }[] = [];
  private readonly chest: THREE.Group;
  private readonly pelvis: THREE.Mesh;
  private readonly abdomen: THREE.Mesh;
  private readonly neck: THREE.Mesh;
  private readonly head: THREE.Group;
  private readonly hands: { mesh: THREE.Mesh; wrist: number; index: number; pinky: number }[] = [];
  private readonly feet: { mesh: THREE.Mesh; heel: number; toe: number; ankle: number }[] = [];
  private forwardSign = new THREE.Vector3(0, 0, 1);

  constructor() {
    const g = <T extends THREE.BufferGeometry>(geo: T) => (this.geos.push(geo), geo);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    // Limbs: tapered cylinders, length 1 along +Y (scaled per frame).
    const limbDefs: [number, number, number, number][] = [
      [P.L_SHOULDER, P.L_ELBOW, 0.058, 0.05],
      [P.R_SHOULDER, P.R_ELBOW, 0.058, 0.05],
      [P.L_ELBOW, P.L_WRIST, 0.048, 0.038],
      [P.R_ELBOW, P.R_WRIST, 0.048, 0.038],
      [P.L_HIP, P.L_KNEE, 0.085, 0.065],
      [P.R_HIP, P.R_KNEE, 0.085, 0.065],
      [P.L_KNEE, P.L_ANKLE, 0.065, 0.048],
      [P.R_KNEE, P.R_ANKLE, 0.065, 0.048],
    ];
    for (const [a, b, rA, rB] of limbDefs) {
      // Cylinder from a (bottom, y=0) to b (top, y=1): translate so the base is at the origin.
      const geo = g(new THREE.CylinderGeometry(rB, rA, 1, 20, 1).translate(0, 0.5, 0));
      const m = mesh(geo, this.mat.shell);
      this.limbs.push({ mesh: m, a, b });
      this.object.add(m);
    }

    // Joint balls (dark metal) with a thin glowing ring at shoulders and knees.
    const jointDefs: [number, number][] = [
      [P.L_SHOULDER, 0.075], [P.R_SHOULDER, 0.075],
      [P.L_ELBOW, 0.054], [P.R_ELBOW, 0.054],
      [P.L_WRIST, 0.042], [P.R_WRIST, 0.042],
      [P.L_HIP, 0.08], [P.R_HIP, 0.08],
      [P.L_KNEE, 0.07], [P.R_KNEE, 0.07],
      [P.L_ANKLE, 0.052], [P.R_ANKLE, 0.052],
    ];
    const ballGeo = g(new THREE.SphereGeometry(1, 24, 16));
    for (const [i, r] of jointDefs) {
      const m = mesh(ballGeo, this.mat.dark);
      m.scale.setScalar(r);
      this.joints.push({ mesh: m, i });
      this.object.add(m);
    }

    // Chest: rounded shell + glowing core + shoulder plate.
    this.chest = new THREE.Group();
    const chestShell = mesh(g(new RoundedBoxGeometry(1, 1, 1, 4, 0.22)), this.mat.shell);
    chestShell.scale.set(0.36, 0.3, 0.2);
    const core = mesh(g(new THREE.CircleGeometry(0.035, 24)), this.mat.accent);
    core.position.set(0, 0.03, 0.101);
    const coreRing = mesh(g(new THREE.RingGeometry(0.045, 0.055, 32)), this.mat.dark);
    coreRing.position.set(0, 0.03, 0.1015);
    this.chest.add(chestShell, core, coreRing);
    this.object.add(this.chest);

    this.pelvis = mesh(g(new RoundedBoxGeometry(1, 1, 1, 4, 0.25)), this.mat.dark);
    this.object.add(this.pelvis);

    this.abdomen = mesh(g(new THREE.CylinderGeometry(0.1, 0.12, 1, 20).translate(0, 0.5, 0)), this.mat.dark);
    this.neck = mesh(g(new THREE.CylinderGeometry(0.04, 0.05, 1, 16).translate(0, 0.5, 0)), this.mat.dark);
    this.object.add(this.abdomen, this.neck);

    // Head: helmet + glowing visor + ear discs.
    this.head = new THREE.Group();
    const helmet = mesh(g(new RoundedBoxGeometry(0.2, 0.25, 0.23, 4, 0.085)), this.mat.shell);
    const visor = mesh(g(new RoundedBoxGeometry(0.17, 0.065, 0.04, 3, 0.02)), this.mat.accent);
    visor.position.set(0, 0.02, 0.105);
    const earGeo = g(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 20).rotateZ(Math.PI / 2));
    const earL = mesh(earGeo, this.mat.dark);
    const earR = mesh(earGeo, this.mat.dark);
    earL.position.set(0.105, 0, 0);
    earR.position.set(-0.105, 0, 0);
    this.head.add(helmet, visor, earL, earR);
    this.object.add(this.head);

    // Hands and feet.
    const handGeo = g(new RoundedBoxGeometry(0.085, 0.11, 0.045, 3, 0.02).translate(0, 0.055, 0));
    for (const [wrist, index, pinky] of [
      [P.L_WRIST, P.L_INDEX, P.L_PINKY],
      [P.R_WRIST, P.R_INDEX, P.R_PINKY],
    ]) {
      const m = mesh(handGeo, this.mat.shell);
      this.hands.push({ mesh: m, wrist, index, pinky });
      this.object.add(m);
    }
    const footGeo = g(new RoundedBoxGeometry(0.1, 0.07, 0.25, 3, 0.03));
    for (const [heel, toe, ankle] of [
      [P.L_HEEL, P.L_FOOT, P.L_ANKLE],
      [P.R_HEEL, P.R_FOOT, P.R_ANKLE],
    ]) {
      const m = mesh(footGeo, this.mat.dark);
      this.feet.push({ mesh: m, heel, toe, ankle });
      this.object.add(m);
    }
  }

  update(pose: ScenePose | null): void {
    this.object.visible = !!pose;
    if (!pose) return;
    const pts = pose.points;
    const v = pose.visible;
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (const l of this.limbs) {
      const ok = v[l.a] && v[l.b];
      l.mesh.visible = ok;
      if (!ok) continue;
      dir.subVectors(pts[l.b], pts[l.a]);
      l.mesh.position.copy(pts[l.a]);
      l.mesh.scale.set(1, dir.length(), 1);
      l.mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
    }
    for (const j of this.joints) {
      j.mesh.visible = v[j.i];
      j.mesh.position.copy(pts[j.i]);
    }

    const torsoOk = allVisible(pose, P.L_SHOULDER, P.R_SHOULDER, P.L_HIP, P.R_HIP);
    this.chest.visible = this.pelvis.visible = this.abdomen.visible = torsoOk;
    const shoulderMid = new THREE.Vector3().addVectors(pts[P.L_SHOULDER], pts[P.R_SHOULDER]).multiplyScalar(0.5);
    const hipMid = new THREE.Vector3().addVectors(pts[P.L_HIP], pts[P.R_HIP]).multiplyScalar(0.5);

    // Which way the body faces: from the nose relative to the shoulders.
    if (v[P.NOSE] && torsoOk) {
      const f = new THREE.Vector3().subVectors(pts[P.NOSE], shoulderMid);
      f.y = 0;
      if (f.lengthSq() > 1e-4) this.forwardSign.copy(f.normalize());
    }

    if (torsoOk) {
      const up = new THREE.Vector3().subVectors(shoulderMid, hipMid);
      const torsoLen = up.length();
      const shoulderAcross = new THREE.Vector3().subVectors(pts[P.L_SHOULDER], pts[P.R_SHOULDER]);
      const hipAcross = new THREE.Vector3().subVectors(pts[P.L_HIP], pts[P.R_HIP]);

      basisQuaternion(shoulderAcross, up, q, this.forwardSign);
      this.chest.quaternion.copy(q);
      this.chest.position.copy(shoulderMid).addScaledVector(up, -0.22);
      const sw = shoulderAcross.length() / 0.36;
      this.chest.scale.set(sw, Math.max(0.6, torsoLen / 0.5), Math.min(1.3, Math.max(0.8, sw)));

      basisQuaternion(hipAcross, up, q, this.forwardSign);
      this.pelvis.quaternion.copy(q);
      this.pelvis.position.copy(hipMid).addScaledVector(up, 0.06);
      this.pelvis.scale.set(Math.max(0.24, hipAcross.length() + 0.12), 0.15, 0.19);

      // Abdomen bridges pelvis top to chest bottom.
      const a = hipMid.clone().addScaledVector(up, 0.1);
      const b = shoulderMid.clone().addScaledVector(up, -0.45);
      dir.subVectors(b, a);
      this.abdomen.position.copy(a);
      this.abdomen.scale.set(1, Math.max(0.01, dir.length()), 1);
      this.abdomen.quaternion.setFromUnitVectors(Y, dir.normalize());
    }

    // Head from the ears (fallback: nose) above the shoulders.
    const earsOk = allVisible(pose, P.L_EAR, P.R_EAR);
    const headOk = torsoOk && (earsOk || v[P.NOSE]);
    this.head.visible = this.neck.visible = headOk;
    if (headOk) {
      const center = earsOk
        ? new THREE.Vector3().addVectors(pts[P.L_EAR], pts[P.R_EAR]).multiplyScalar(0.5)
        : pts[P.NOSE].clone().addScaledVector(this.forwardSign, -0.08);
      // Ears nearly overlap when side-on to the camera → their line is unreliable; use the shoulders.
      const across = earsOk && pts[P.L_EAR].distanceTo(pts[P.R_EAR]) > 0.06
        ? new THREE.Vector3().subVectors(pts[P.L_EAR], pts[P.R_EAR])
        : new THREE.Vector3().subVectors(pts[P.L_SHOULDER], pts[P.R_SHOULDER]);
      const up = new THREE.Vector3().subVectors(center, shoulderMid);
      const faceHint = v[P.NOSE] ? new THREE.Vector3().subVectors(pts[P.NOSE], center) : this.forwardSign;
      basisQuaternion(across, up, q, faceHint);
      this.head.quaternion.copy(q);
      this.head.position.copy(center).addScaledVector(up.normalize(), 0.03);

      const neckBase = shoulderMid.clone().addScaledVector(up, -0.02);
      dir.subVectors(this.head.position, neckBase);
      this.neck.position.copy(neckBase);
      this.neck.scale.set(1, Math.max(0.01, dir.length() - 0.08), 1);
      this.neck.quaternion.setFromUnitVectors(Y, dir.normalize());
    }

    for (const h of this.hands) {
      const ok = v[h.wrist] && (v[h.index] || v[h.pinky]);
      h.mesh.visible = ok;
      if (!ok) continue;
      const tip = v[h.index] && v[h.pinky]
        ? new THREE.Vector3().addVectors(pts[h.index], pts[h.pinky]).multiplyScalar(0.5)
        : (v[h.index] ? pts[h.index] : pts[h.pinky]).clone();
      dir.subVectors(tip, pts[h.wrist]);
      const across = v[h.index] && v[h.pinky]
        ? new THREE.Vector3().subVectors(pts[h.index], pts[h.pinky])
        : new THREE.Vector3(1, 0, 0);
      basisQuaternion(across, dir, q);
      h.mesh.quaternion.copy(q);
      h.mesh.position.copy(pts[h.wrist]);
    }

    for (const f of this.feet) {
      const ok = v[f.heel] && v[f.toe];
      f.mesh.visible = ok;
      if (!ok) continue;
      dir.subVectors(pts[f.toe], pts[f.heel]);
      f.mesh.position.addVectors(pts[f.heel], pts[f.toe]).multiplyScalar(0.5);
      f.mesh.position.y = Math.max(f.mesh.position.y, 0.035);
      f.mesh.scale.set(1, 1, Math.max(0.6, dir.length() / 0.22));
      f.mesh.quaternion.setFromUnitVectors(Z, dir.normalize());
    }
  }

  dispose(): void {
    this.geos.forEach((g) => g.dispose());
    Object.values(this.mat).forEach((m) => m.dispose());
  }
}
