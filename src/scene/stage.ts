import * as THREE from 'three';
import type { Landmark } from '@mediapipe/tasks-vision';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildArena } from './environment';
import type { Avatar, ScenePose } from './avatars/types';
import { RobotAvatar } from './avatars/robotAvatar';
import { SkeletonAvatar } from './avatars/skeletonAvatar';
import { RiggedAvatar } from './avatars/riggedAvatar';
import { isMobile } from '../ui/device';

export type AvatarKind = 'robot' | 'character' | 'skeleton';
export const AVATAR_KINDS: AvatarKind[] = ['robot', 'character', 'skeleton'];
export const AVATAR_LABELS: Record<AvatarKind, string> = {
  robot: 'Robot',
  character: 'Character',
  skeleton: 'Skeleton',
};

const LANDMARK_COUNT = 33;
const FACE_MAX_INDEX = 10;
const MIN_VISIBILITY = 0.5;

/**
 * The 3D world: renderer + post-processing, arena, camera views, the player's avatar,
 * and scene-space access to tracked joints for games.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

  /** Called each render frame with the frame time in seconds (games hook in here). */
  onFrame: ((dt: number) => void) | null = null;
  /** Called when graphics quality changes automatically. */
  onQualityChange: ((high: boolean) => void) | null = null;

  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private highQuality = true;
  private slowFrames = 0;

  private readonly updateArena: (dt: number) => void;
  private avatar: Avatar | null = null;
  private avatarKind: AvatarKind | null = null;
  private readonly avatarCache = new Map<AvatarKind, Avatar>();

  private readonly pose: ScenePose = {
    points: Array.from({ length: LANDMARK_COUNT }, () => new THREE.Vector3()),
    visible: new Array<boolean>(LANDMARK_COUNT).fill(false),
    mirrored: true,
  };
  private hasPose = false;
  private groundOffset = 1;

  private readonly gloves: THREE.Mesh[];
  private glovesOn = false;
  private readonly pulses: { mesh: THREE.Mesh; age: number }[] = [];
  private lastRender = performance.now();

  /**
   * 'mirror': camera in front, avatar faces you like a reflection (menus, free workout).
   * 'behind': over-the-shoulder camera, avatar faces into the arena (games).
   */
  private view: 'mirror' | 'behind' = 'mirror';
  private zSign = -1;
  private readonly camGoal = { pos: new THREE.Vector3(0, 1.35, 3.8), look: new THREE.Vector3(0, 1, 0) };
  private readonly camLook = new THREE.Vector3(0, 1, 0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Phones have very dense screens; rendering at full density costs a lot of battery and frame rate.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera.position.copy(this.camGoal.pos);
    this.camera.lookAt(this.camLook);

    this.updateArena = buildArena(this.scene, this.renderer);

    // Post-processing: bloom makes the neon and visor glow.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Glowing gloves shown over the hands during games.
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0xfb923c, emissive: 0xf97316, emissiveIntensity: 1.6, roughness: 0.3,
    });
    const gloveGeo = new THREE.SphereGeometry(0.1, 24, 16);
    this.gloves = [0, 1].map(() => {
      const m = new THREE.Mesh(gloveGeo, gloveMat);
      m.castShadow = true;
      m.visible = false;
      this.scene.add(m);
      return m;
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------------ avatars

  get currentAvatar(): AvatarKind | null {
    return this.avatarKind;
  }

  /** Switch avatar. Falls back to the robot if the character model can't load. */
  async setAvatar(kind: AvatarKind): Promise<AvatarKind> {
    let next = this.avatarCache.get(kind);
    if (!next) {
      try {
        next = await this.createAvatar(kind);
      } catch (err) {
        console.warn(`Avatar "${kind}" failed to load, using robot`, err);
        return kind === 'robot' ? kind : this.setAvatar('robot');
      }
      this.avatarCache.set(kind, next);
    }
    if (this.avatar) this.scene.remove(this.avatar.object);
    this.avatar = next;
    this.avatarKind = kind;
    this.scene.add(next.object);
    next.update(this.hasPose ? this.pose : null);
    return kind;
  }

  private async createAvatar(kind: AvatarKind): Promise<Avatar> {
    switch (kind) {
      case 'robot':
        return new RobotAvatar();
      case 'skeleton':
        return new SkeletonAvatar();
      case 'character': {
        const url = new URL(`${import.meta.env.BASE_URL}models/character.glb`, window.location.href).href;
        return RiggedAvatar.load(url);
      }
    }
  }

  // ------------------------------------------------------------------ pose

  /** Update from MediaPipe world landmarks (meters, hip-centered, y down), or null when not tracked. */
  updatePose(world: Landmark[] | null): void {
    this.hasPose = !!world;
    if (world) {
      // Mirror: x flipped + toward camera is +z (a reflection). Behind: x flipped + forward is -z.
      let minY = Infinity;
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const lm = world[i];
        this.pose.points[i].set(-lm.x, -lm.y, this.zSign * lm.z);
        const vis = (lm.visibility ?? 1) >= MIN_VISIBILITY;
        this.pose.visible[i] = vis;
        if (vis && i > FACE_MAX_INDEX) minY = Math.min(minY, this.pose.points[i].y);
      }
      // Keep the lowest visible joint on the floor (smoothed to avoid bobbing).
      if (Number.isFinite(minY)) this.groundOffset += (-minY + 0.02 - this.groundOffset) * 0.15;
      for (const p of this.pose.points) p.y += this.groundOffset;
      this.pose.mirrored = this.view === 'mirror';
    }

    this.avatar?.update(this.hasPose ? this.pose : null);
    this.updateGloves();
  }

  /** Scene-space position of a landmark. Returns false if it isn't currently visible. */
  getJoint(i: number, out: THREE.Vector3): boolean {
    if (!this.hasPose || !this.pose.visible[i]) return false;
    out.copy(this.pose.points[i]);
    return true;
  }

  /** Scene-space palm position (between wrist and index knuckle). 'left' = player's left hand. */
  getHand(side: 'left' | 'right', out: THREE.Vector3): boolean {
    const [wrist, index] = side === 'left' ? [15, 19] : [16, 20];
    if (!this.getJoint(wrist, out)) return false;
    if (this.hasPose && this.pose.visible[index]) out.lerp(this.pose.points[index], 0.6);
    return true;
  }

  /** Show glowing gloves on the hands (games). */
  setHandsHighlighted(on: boolean): void {
    this.glovesOn = on;
    this.updateGloves();
  }

  private updateGloves(): void {
    (['left', 'right'] as const).forEach((side, i) => {
      const glove = this.gloves[i];
      glove.visible = this.glovesOn && this.getHand(side, glove.position);
    });
  }

  // ------------------------------------------------------------------ view & effects

  setView(view: 'mirror' | 'behind'): void {
    this.view = view;
    this.zSign = view === 'mirror' ? -1 : 1;
    if (view === 'mirror') {
      this.camGoal.pos.set(0, 1.35, 3.8);
      this.camGoal.look.set(0, 1, 0);
    } else {
      this.camGoal.pos.set(0, 1.8, 3.0);
      this.camGoal.look.set(0, 1.15, -4);
    }
  }

  getView(): 'mirror' | 'behind' {
    return this.view;
  }

  setHighQuality(high: boolean): void {
    this.highQuality = high;
    this.bloom.enabled = high;
    this.renderer.shadowMap.type = high ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.slowFrames = 0;
  }

  get isHighQuality(): boolean {
    return this.highQuality;
  }

  /** Expanding ring on the floor under the player — rep/jump feedback. */
  pulse(color: THREE.ColorRepresentation = 0x4ade80): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.45, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.012, 0);
    this.scene.add(mesh);
    this.pulses.push({ mesh, age: 0 });
  }

  render(): void {
    const now = performance.now();
    const rawDt = (now - this.lastRender) / 1000;
    const dt = Math.min(rawDt, 0.1);
    this.lastRender = now;

    this.autoQuality(rawDt);
    this.updateArena(dt);

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.age += dt;
      const k = p.age / 0.6;
      if (k >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.pulses.splice(i, 1);
        continue;
      }
      p.mesh.scale.setScalar(1 + k * 2.5);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }

    const ease = 1 - Math.exp(-dt * 4);
    this.camera.position.lerp(this.camGoal.pos, ease);
    this.camLook.lerp(this.camGoal.look, ease);
    this.camera.lookAt(this.camLook);

    this.onFrame?.(dt);

    if (this.highQuality) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Drop to low quality if rendering stays slow (bloom is the main cost). */
  private autoQuality(frameSeconds: number): void {
    if (!this.highQuality || frameSeconds > 0.5) return; // ignore tab switches
    this.slowFrames = frameSeconds > 1 / 40 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 180) {
      this.setHighQuality(false);
      this.onQualityChange?.(false);
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.fov = fovFor(w / h);
    this.camera.updateProjectionMatrix();
  }
}

/**
 * Vertical field of view for a screen shape. Wide screens use 50°. Tall (portrait phone) screens
 * widen it so the arena, the goal and outstretched arms still fit side to side (capped at 84°).
 */
export function fovFor(aspect: number): number {
  const minHalfWidth = 0.6; // tan of half the horizontal view
  const tanHalf = Math.min(Math.tan((42 * Math.PI) / 180), Math.max(Math.tan((25 * Math.PI) / 180), minHalfWidth / aspect));
  return (2 * Math.atan(tanHalf) * 180) / Math.PI;
}
