import * as THREE from 'three';
import type { Stage } from '../scene/stage';
import type { Sfx } from './sfx';
import { ArcadeGame } from './arcadeGame';
import {
  CROUCH_SHARE, DEFAULT_DIMS, JUDGE_WINDOW_SECONDS, SEGMENTS, SEG_IDS, START_LIVES, WALL_JUDGE_Z, WALL_SPAWN_Z,
  betterMatch, crouchDrop, judge, matchPose, measureAngles, pickPose, pointsFor, silhouette, wallSeconds,
  type BodyDims, type Match, type Seg, type SegAngles, type ShapePose, type Verdict,
} from './shapeFitRules';

const WALL_W = 3.8;
const WALL_H = 2.8;
const GAP_SECONDS = 0.9;
const COLOR_OK = 0x4ade80;
const COLOR_OFF = 0xfbbf24;
const COLOR_BODY = 0xe0f2fe;
const FRAME_COLOR = 0xe879f9;

interface Wall {
  pose: ShapePose;
  group: THREE.Group;
  segMats: Record<Seg, THREE.MeshBasicMaterial>;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  /** seconds to travel from spawn to the player */
  travel: number;
  age: number;
  /** Hip drop the pose needs (m); 0 for standing poses. */
  drop: number;
  best: Match | null;
  verdict: Verdict | null;
  /** seconds since the wall passed (fades out) */
  passed: number;
}

/**
 * Shape Fit: glowing walls slide toward you with a body-shaped opening. Strike the pose before
 * the wall arrives. Each limb of the shape lights green when yours matches. Three crashes and it's over.
 */
export class ShapeFit extends ArcadeGame {
  readonly id = 'shapefit' as const;
  readonly title = 'Shape Fit';

  private wall: Wall | null = null;
  private wallCount = 0;
  private gap = 0;
  private prevPose: string | null = null;
  private lives = START_LIVES;
  private score = 0;
  private perfect = 0;
  private good = 0;
  private streak = 0;
  private bestStreak = 0;
  private dims: BodyDims = DEFAULT_DIMS;
  private standHipY = 1;
  private centerX = 0;

  private angles: SegAngles | null = null;
  private hipY: number | null = null;
  private readonly tmp = new THREE.Vector3();

  constructor(scene3d: Stage, sfx: Sfx) {
    super(scene3d, sfx);
  }

  protected reset(): void {
    this.lives = START_LIVES;
    this.score = this.perfect = this.good = this.streak = this.bestStreak = this.wallCount = 0;
    this.prevPose = null;
    this.gap = 0.3;
    this.emitHud('Get ready');
  }

  protected begin(): void {
    this.measure();
  }

  onPose(): void {
    const pts = new Map<number, { x: number; y: number }>();
    const joint = (i: number) => {
      if (!pts.has(i) && this.scene3d.getJoint(i, this.tmp)) pts.set(i, { x: this.tmp.x, y: this.tmp.y });
      return pts.get(i) ?? null;
    };
    this.angles = measureAngles(joint);
    const l = joint(23), r = joint(24);
    this.hipY = l && r ? (l.y + r.y) / 2 : null;
  }

  protected step(dt: number): void {
    if (!this.wall) {
      this.gap -= dt;
      if (this.gap <= 0) this.spawnWall();
      return;
    }
    const w = this.wall;
    w.age += dt;

    if (w.verdict) {
      // Passed: keep sliding past the player and fade out.
      w.passed += dt;
      w.group.position.z += ((WALL_JUDGE_Z - WALL_SPAWN_Z) / w.travel) * dt;
      for (const m of w.materials) m.opacity = Math.max(0, (m.userData.base as number) * (1 - w.passed / 0.6));
      if (w.passed >= 0.6) this.removeWall();
      return;
    }

    const k = Math.min(1, w.age / w.travel);
    w.group.position.z = WALL_SPAWN_Z + (WALL_JUDGE_Z - WALL_SPAWN_Z) * k;

    const match = this.currentMatch(w);
    if (match) {
      for (const id of SEG_IDS) w.segMats[id].color.setHex(match.ok[id] ? COLOR_OK : COLOR_OFF);
      if (w.travel - w.age <= JUDGE_WINDOW_SECONDS && betterMatch(match, w.best)) w.best = match;
    }
    if (k >= 1) this.resolve(w);
  }

  private currentMatch(w: Wall): Match | null {
    if (!this.angles) return null;
    const hipsOk = w.drop === 0 || (this.hipY !== null && this.standHipY - this.hipY >= w.drop * CROUCH_SHARE);
    return matchPose(w.pose, this.angles, hipsOk);
  }

  private resolve(w: Wall): void {
    const verdict = w.best ? judge(w.best) : 'crash';
    const center = this.toScreen(new THREE.Vector3(this.centerX, 1.3, WALL_JUDGE_Z - 0.5));

    if (verdict === 'crash') {
      this.lives--;
      this.streak = 0;
      this.sfx.bomb();
      this.scene3d.pulse(0xef4444);
      // Shatter: bursts across the wall.
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Vector3(
          this.centerX + (Math.random() - 0.5) * WALL_W,
          0.3 + Math.random() * (WALL_H - 0.4),
          w.group.position.z,
        );
        this.particles.burst(p, i % 2 ? FRAME_COLOR : 0x818cf8, 22, 3.5);
      }
      this.events.emit('popup', { text: 'CRASH!', cls: 'bad', screen: center });
      this.removeWall();
      this.emitHud('');
      if (this.lives <= 0) {
        this.finish(this.score, [
          { label: 'Score', value: String(this.score) },
          { label: 'Walls passed', value: String(this.perfect + this.good) },
          { label: 'Perfect', value: String(this.perfect) },
          { label: 'Good', value: String(this.good) },
          { label: 'Best streak', value: String(this.bestStreak) },
          { label: 'Walls faced', value: String(this.wallCount) },
        ]);
        return;
      }
      if (this.lives === 1) this.events.emit('announce', { text: 'Last life!' });
    } else {
      const points = pointsFor(verdict, this.streak);
      this.score += points;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      if (verdict === 'perfect') this.perfect++;
      else this.good++;
      w.verdict = verdict;
      this.sfx.hit(verdict === 'perfect');
      if (this.streak % 5 === 0) this.sfx.comboUp();
      this.scene3d.pulse(verdict === 'perfect' ? 0xfbbf24 : COLOR_OK);
      this.particles.burst(new THREE.Vector3(this.centerX, 1.2, WALL_JUDGE_Z), COLOR_OK, 30, 3);
      this.events.emit('popup', {
        text: `${verdict === 'perfect' ? 'PERFECT' : 'GOOD'} +${points}`,
        cls: verdict === 'perfect' ? 'power' : 'good',
        screen: center,
      });
      this.emitHud('');
    }
    this.gap = GAP_SECONDS;
  }

  private spawnWall(): void {
    const pose = pickPose(this.wallCount, this.prevPose);
    this.prevPose = pose.id;
    const travel = wallSeconds(this.wallCount);
    this.wallCount++;

    const group = new THREE.Group();
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const track = <T extends THREE.Material>(m: T, opacity: number): T => {
      m.transparent = true;
      m.opacity = opacity;
      m.userData.base = opacity;
      m.depthWrite = false;
      materials.push(m);
      return m;
    };
    const geo = <G extends THREE.BufferGeometry>(g: G): G => (geometries.push(g), g);

    // The wall panel and its neon frame.
    const panel = new THREE.Mesh(
      geo(new THREE.PlaneGeometry(WALL_W, WALL_H)),
      track(new THREE.MeshStandardMaterial({ color: 0x312e81, emissive: 0x1e1b4b, emissiveIntensity: 0.8, side: THREE.DoubleSide }), 0.45),
    );
    panel.position.set(this.centerX, WALL_H / 2, 0);
    group.add(panel);
    const frameMat = track(new THREE.MeshBasicMaterial({ color: FRAME_COLOR }), 1);
    const edge = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, 0.06)), frameMat);
      m.position.set(this.centerX + x, y, 0);
      group.add(m);
    };
    edge(WALL_W + 0.08, 0.08, 0, WALL_H);
    edge(0.08, WALL_H, -WALL_W / 2, WALL_H / 2);
    edge(0.08, WALL_H, WALL_W / 2, WALL_H / 2);

    // The body-shaped opening, drawn as glowing limbs on the wall.
    const joints = silhouette(pose, this.dims, this.centerX);
    const at = (i: number) => joints.get(i) as { x: number; y: number };
    const bodyMat = track(new THREE.MeshBasicMaterial({ color: COLOR_BODY }), 0.95);
    const limb = (a: { x: number; y: number }, b: { x: number; y: number }, r: number, mat: THREE.Material) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const m = new THREE.Mesh(geo(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 12)), mat);
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.05);
      m.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
      group.add(m);
    };
    const midpoint = (i: number, j: number) => ({ x: (at(i).x + at(j).x) / 2, y: (at(i).y + at(j).y) / 2 });
    limb(midpoint(23, 24), midpoint(11, 12), 0.16, bodyMat);
    limb(at(11), at(12), 0.09, bodyMat);
    limb(at(23), at(24), 0.1, bodyMat);
    const head = new THREE.Mesh(geo(new THREE.SphereGeometry(this.dims.head + 0.03, 20, 14)), bodyMat);
    head.position.set(at(0).x, at(0).y, 0.05);
    group.add(head);

    const segMats = {} as Record<Seg, THREE.MeshBasicMaterial>;
    for (const id of SEG_IDS) {
      const s = SEGMENTS[id];
      segMats[id] = track(new THREE.MeshBasicMaterial({ color: COLOR_OFF }), 0.95);
      limb(at(s.from), at(s.to), s.limb === 'arm' ? 0.08 : 0.1, segMats[id]);
    }

    group.position.z = WALL_SPAWN_Z;
    this.group.add(group);
    this.wall = {
      pose, group, segMats, materials, geometries, travel, age: 0,
      drop: crouchDrop(pose, this.dims), best: null, verdict: null, passed: 0,
    };
    this.events.emit('announce', { text: pose.name });
    this.emitHud(pose.name);
  }

  /** Limb lengths and hip height from the player (clamped to sensible ranges). */
  private measure(): void {
    const p = (i: number) => (this.scene3d.getJoint(i, this.tmp) ? this.tmp.clone() : null);
    const len = (a: number, b: number) => {
      const pa = p(a), pb = p(b);
      return pa && pb ? pa.distanceTo(pb) : null;
    };
    const avg = (...v: (number | null)[]) => {
      const ok = v.filter((x): x is number => x !== null);
      return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null;
    };
    const fit = (v: number | null, def: number) => (v === null ? def : Math.min(def * 1.5, Math.max(def * 0.6, v)));
    const D = DEFAULT_DIMS;
    const ls = p(11), rs = p(12), lh = p(23), rh = p(24);
    this.dims = {
      shoulderHalf: fit(ls && rs ? Math.abs(ls.x - rs.x) / 2 : null, D.shoulderHalf),
      hipHalf: fit(lh && rh ? Math.abs(lh.x - rh.x) / 2 : null, D.hipHalf),
      torso: fit(ls && rs && lh && rh ? (ls.y + rs.y - lh.y - rh.y) / 2 : null, D.torso),
      upperArm: fit(avg(len(11, 13), len(12, 14)), D.upperArm),
      forearm: fit(avg(len(13, 15), len(14, 16)), D.forearm),
      thigh: fit(avg(len(23, 25), len(24, 26)), D.thigh),
      shin: fit(avg(len(25, 27), len(26, 28)), D.shin),
      head: D.head,
    };
    this.standHipY = lh && rh ? (lh.y + rh.y) / 2 : 1;
    this.centerX = lh && rh ? (lh.x + rh.x) / 2 : 0;
  }

  private emitHud(shape: string): void {
    this.events.emit('hud', {
      boxes: [
        { label: 'Score', value: String(this.score) },
        { label: 'Lives', value: '❤'.repeat(Math.max(0, this.lives)) || '–', cls: this.lives <= 1 ? 'low' : undefined },
        { label: 'Shape', value: shape || this.wall?.pose.name || '…', cls: 'wide' },
      ],
    });
  }

  private removeWall(): void {
    const w = this.wall;
    if (!w) return;
    this.group.remove(w.group);
    for (const g of w.geometries) g.dispose();
    for (const m of w.materials) m.dispose();
    this.wall = null;
  }

  protected clearRound(): void {
    this.removeWall();
  }
}
