import * as THREE from 'three';
import { Emitter } from '../motion/emitter';
import type { Stage } from '../scene/stage';
import type { Sfx } from './sfx';
import { Particles } from './particles';
import {
  COUNTDOWN_SECONDS, HIT_DEPTH, HIT_PLANE_Z, HIT_RADIUS_XY, MISS_Z, POWER_SPEED, ROUND_SECONDS,
  SPAWN_Z, difficulty, multiplier, pointsFor, type SmashStats, type TargetKind,
} from './smashRules';

export type SmashEvents = {
  countdown: { value: number };
  tick: { timeLeft: number; score: number; combo: number; multiplier: number };
  hit: { points: number; power: boolean; kind: TargetKind; screen: { x: number; y: number } };
  miss: Record<string, never>;
  bomb: { points: number; screen: { x: number; y: number } };
  end: SmashStats;
};

interface Target {
  kind: TargetKind;
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  speed: number;
  spin: THREE.Vector3;
}

type Phase = 'idle' | 'countdown' | 'playing' | 'ended';

/** Body reference heights (scene meters), sampled from the avatar when spawning. */
interface BodyRef {
  centerX: number;
  kneeY: number;
  hipY: number;
  shoulderY: number;
  headY: number;
  reach: number;
}

/**
 * Target Smash: orbs fly toward the player; smash them with either hand.
 * Low orbs (purple) need a squat or deep reach; red bombs must be avoided.
 */
export class TargetSmash {
  readonly events = new Emitter<SmashEvents>();
  paused = false;

  private phase: Phase = 'idle';
  private readonly group = new THREE.Group();
  private readonly particles: Particles;
  private targets: Target[] = [];
  private clock = 0;
  private spawnTimer = 0;
  private lastCountdown = -1;
  private combo = 0;
  private stats: SmashStats = TargetSmash.emptyStats();
  private body: BodyRef | null = null;

  // Hand tracking (sampled at pose rate)
  private readonly hands = {
    left: { pos: new THREE.Vector3(), prev: new THREE.Vector3(), ok: false, speed: 0, t: 0 },
    right: { pos: new THREE.Vector3(), prev: new THREE.Vector3(), ok: false, speed: 0, t: 0 },
  };

  private readonly geo = {
    orb: new THREE.IcosahedronGeometry(0.17, 1),
    bomb: new THREE.OctahedronGeometry(0.2, 0),
    ring: new THREE.RingGeometry(0.22, 0.26, 40),
  };
  private readonly mat = {
    orb: new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 1.6, flatShading: true }),
    low: new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0x9333ea, emissiveIntensity: 1.6, flatShading: true }),
    bomb: new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 1.8, flatShading: true }),
  };
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly scene3d: Stage,
    private readonly sfx: Sfx,
  ) {
    this.particles = new Particles(this.group);
    scene3d.scene.add(this.group);
  }

  static emptyStats(): SmashStats {
    return { score: 0, hits: 0, misses: 0, bombsHit: 0, powerHits: 0, lowHits: 0, bestCombo: 0, squats: 0, jumps: 0 };
  }

  /** True while the round clock is running (after the countdown). */
  get isPlaying(): boolean {
    return this.phase === 'playing';
  }

  get isActive(): boolean {
    return this.phase === 'countdown' || this.phase === 'playing';
  }

  start(): void {
    this.clear();
    this.stats = TargetSmash.emptyStats();
    this.combo = 0;
    this.clock = 0;
    this.spawnTimer = 0.5;
    this.lastCountdown = -1;
    this.paused = false;
    this.body = null;
    this.phase = 'countdown';
  }

  stop(): void {
    this.clear();
    this.phase = 'idle';
  }

  /** Called by the app when the motion engine counts an exercise during the round. */
  recordExercise(kind: 'squat' | 'jump'): void {
    if (this.phase !== 'playing') return;
    if (kind === 'squat') this.stats.squats++;
    else this.stats.jumps++;
  }

  /** Sample hand positions — call once per new pose frame. */
  onPose(nowMs: number): void {
    for (const side of ['left', 'right'] as const) {
      const h = this.hands[side];
      h.prev.copy(h.pos);
      const ok = this.scene3d.getHand(side, h.pos);
      const dt = (nowMs - h.t) / 1000;
      // Speed is smoothed a little so a single noisy frame doesn't count as a punch.
      const raw = ok && h.ok && dt > 0 && dt < 0.2 ? h.pos.distanceTo(h.prev) / dt : 0;
      h.speed = h.speed * 0.4 + raw * 0.6;
      h.ok = ok;
      h.t = nowMs;
    }
  }

  /** Advance the simulation — call every render frame. */
  update(dt: number): void {
    this.particles.update(dt);
    if (!this.isActive || this.paused) return;

    this.clock += dt;

    if (this.phase === 'countdown') {
      const left = Math.ceil(COUNTDOWN_SECONDS - this.clock);
      if (left !== this.lastCountdown) {
        this.lastCountdown = left;
        this.events.emit('countdown', { value: left });
        if (left > 0) this.sfx.beep();
        else this.sfx.go();
      }
      if (this.clock >= COUNTDOWN_SECONDS) {
        this.phase = 'playing';
        this.clock = 0;
        this.body = this.bodyRef(); // player is standing ready — measure once
      }
      return;
    }

    const progress = this.clock / ROUND_SECONDS;
    const diff = difficulty(progress);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = diff.spawnInterval;
      this.spawn(diff.speed, diff.bombChance, diff.lowChance);
      if (Math.random() < diff.pairChance) this.spawn(diff.speed, 0, diff.lowChance);
    }

    this.moveTargets(dt);

    this.events.emit('tick', {
      timeLeft: Math.max(0, ROUND_SECONDS - this.clock),
      score: this.stats.score,
      combo: this.combo,
      multiplier: multiplier(this.combo),
    });

    if (this.clock >= ROUND_SECONDS) this.finish();
  }

  private finish(): void {
    this.phase = 'ended';
    this.clear();
    this.sfx.end();
    this.events.emit('end', { ...this.stats });
  }

  private bodyRef(): BodyRef {
    const y = (i: number, fallback: number) => (this.scene3d.getJoint(i, this.tmp) ? this.tmp.y : fallback);
    const x = (i: number, fallback: number) => (this.scene3d.getJoint(i, this.tmp) ? this.tmp.x : fallback);
    const shoulderY = (y(11, 1.45) + y(12, 1.45)) / 2;
    const ls = x(11, 0.18), rs = x(12, -0.18);
    return {
      centerX: (ls + rs) / 2,
      kneeY: (y(25, 0.5) + y(26, 0.5)) / 2,
      hipY: (y(23, 1) + y(24, 1)) / 2,
      shoulderY,
      headY: y(0, shoulderY + 0.2),
      reach: Math.max(0.55, Math.abs(ls - rs) * 2.1),
    };
  }

  private spawn(speed: number, bombChance: number, lowChance: number): void {
    const r = Math.random();
    const kind: TargetKind = r < bombChance ? 'bomb' : r < bombChance + lowChance ? 'low' : 'orb';
    const body = (this.body ??= this.bodyRef());

    // Hands hanging at rest sit just below hip height beside the body. Keep targets clear of
    // that zone so nothing gets "hit" (or a bomb triggered) without the player moving.
    const side = Math.random() < 0.5 ? -1 : 1;
    let x: number, y: number;
    if (kind === 'low') {
      // Low and out to the side → needs a squat or lunge to reach.
      x = body.centerX + side * (0.5 + Math.random() * Math.max(0.05, body.reach - 0.5));
      y = body.kneeY + Math.random() * Math.max(0.1, (body.hipY - body.kneeY) * 0.5);
    } else {
      const minY = body.hipY + (kind === 'bomb' ? 0.35 : 0.2);
      x = body.centerX + (Math.random() * 2 - 1) * body.reach;
      y = minY + Math.random() * Math.max(0.2, body.headY + 0.3 - minY);
    }

    const mesh = new THREE.Mesh(kind === 'bomb' ? this.geo.bomb : this.geo.orb, this.mat[kind]);
    mesh.position.set(x, y, SPAWN_Z);
    mesh.castShadow = true;

    // Target ring sits on the hit plane, showing exactly where the target will arrive.
    const ringMat = new THREE.MeshBasicMaterial({
      color: kind === 'bomb' ? 0xef4444 : kind === 'low' ? 0xc084fc : 0x38bdf8,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.geo.ring, ringMat);
    ring.position.set(x, y, HIT_PLANE_Z);

    this.group.add(mesh, ring);
    this.targets.push({
      kind,
      mesh,
      ring,
      speed: speed * (0.9 + Math.random() * 0.2),
      spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3),
    });
  }

  private moveTargets(dt: number): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.mesh.position.z += t.speed * dt;
      t.mesh.rotation.x += t.spin.x * dt;
      t.mesh.rotation.y += t.spin.y * dt;

      // Ring fades in and shrinks onto the target as it arrives — a timing cue for depth.
      const dist = HIT_PLANE_Z - t.mesh.position.z;
      const k = Math.min(1, Math.max(0, 1 - dist / 8));
      const ringMat = t.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.8 * k;
      t.ring.scale.setScalar(1 + Math.max(0, dist) * 0.25);

      const hitBy = this.touchingHand(t);
      if (hitBy) {
        this.onHit(t, hitBy.speed);
        this.remove(i);
      } else if (t.mesh.position.z > MISS_Z) {
        if (t.kind !== 'bomb') this.onMiss();
        this.remove(i);
      }
    }
  }

  private touchingHand(t: Target): { speed: number } | null {
    const p = t.mesh.position;
    if (Math.abs(p.z - HIT_PLANE_Z) > HIT_DEPTH) return null;
    for (const side of ['left', 'right'] as const) {
      const h = this.hands[side];
      if (!h.ok) continue;
      // Depth from a single webcam is unreliable, so x/y decide the hit inside the depth window.
      if (Math.hypot(h.pos.x - p.x, h.pos.y - p.y) < HIT_RADIUS_XY) return { speed: h.speed };
    }
    return null;
  }

  private onHit(t: Target, handSpeed: number): void {
    const screen = this.toScreen(t.mesh.position);
    if (t.kind === 'bomb') {
      const points = pointsFor('bomb', false, 1);
      this.stats.score = Math.max(0, this.stats.score + points);
      this.stats.bombsHit++;
      this.combo = 0;
      this.sfx.bomb();
      this.particles.burst(t.mesh.position, 0xef4444, 40, 4);
      this.events.emit('bomb', { points, screen });
      return;
    }

    const prevMult = multiplier(this.combo);
    this.combo++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    const mult = multiplier(this.combo);
    const power = handSpeed >= POWER_SPEED;
    const points = pointsFor(t.kind, power, mult);

    this.stats.score += points;
    this.stats.hits++;
    if (power) this.stats.powerHits++;
    if (t.kind === 'low') this.stats.lowHits++;

    this.sfx.hit(power);
    if (mult > prevMult) this.sfx.comboUp();
    this.particles.burst(t.mesh.position, t.kind === 'low' ? 0xc084fc : 0x38bdf8, power ? 36 : 22, power ? 4 : 2.5);
    this.events.emit('hit', { points, power, kind: t.kind, screen });
  }

  private onMiss(): void {
    this.stats.misses++;
    this.combo = 0;
    this.sfx.miss();
    this.events.emit('miss', {});
  }

  private toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.scene3d.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  private remove(i: number): void {
    const t = this.targets[i];
    this.group.remove(t.mesh, t.ring);
    (t.ring.material as THREE.Material).dispose();
    this.targets.splice(i, 1);
  }

  private clear(): void {
    for (let i = this.targets.length - 1; i >= 0; i--) this.remove(i);
  }
}
