import * as THREE from 'three';
import type { Stage } from '../scene/stage';
import type { Sfx } from './sfx';
import { ArcadeGame, measureBody, type BodyRef } from './arcadeGame';
import {
  BLOCK_DEPTH, BLOCK_Z, FIRE_SPEED_FACTOR, FOOT_RADIUS, GOAL_Z, HAND_RADIUS, LAUNCH_Z, START_LIVES,
  curveAmount, flightPoint, keeperDifficulty, pickAim, pickKind, pointsForSave, type BallKind,
} from './goalkeeperRules';

interface Ball {
  kind: BallKind;
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  from: { x: number; y: number };
  aim: { x: number; y: number };
  arc: number;
  curve: number;
  /** seconds from launch to the block plane */
  flight: number;
  age: number;
  /** Set once saved: the ball bounces away and fades. */
  rebound: THREE.Vector3 | null;
}

const COLORS: Record<BallKind, number> = { ball: 0xe0f2fe, curve: 0xe879f9, fire: 0xf97316 };
const GOAL_COLOR = 0x22d3ee;
const SAVE_WORDS = ['SAVE!', 'BLOCKED!', 'NICE!', 'GREAT SAVE!'];

/**
 * Goalkeeper: balls are shot at a goal behind you; stop them with your hands (or feet for low ones).
 * Three goals conceded and the game is over. Gets faster and trickier the longer you last.
 */
export class Goalkeeper extends ArcadeGame {
  readonly id = 'goalkeeper' as const;
  readonly title = 'Goalkeeper';

  private balls: Ball[] = [];
  private body: BodyRef | null = null;
  private shotTimer = 0;
  private lives = START_LIVES;
  private score = 0;
  private shots = 0;
  private saves = 0;
  private streak = 0;
  private bestStreak = 0;
  private footSaves = 0;
  private fireSaves = 0;
  private goalFlash = 0;

  private readonly limbs = {
    hands: [new THREE.Vector3(), new THREE.Vector3()],
    feet: [new THREE.Vector3(), new THREE.Vector3()],
    handOk: [false, false],
    footOk: [false, false],
  };

  private readonly goal = new THREE.Group();
  private readonly goalMat = new THREE.MeshStandardMaterial({
    color: GOAL_COLOR, emissive: GOAL_COLOR, emissiveIntensity: 1.4, roughness: 0.4,
  });
  private readonly ballGeo = new THREE.SphereGeometry(0.13, 20, 14);
  private readonly ringGeo = new THREE.RingGeometry(0.2, 0.24, 40);
  private readonly ballMats: Record<BallKind, THREE.MeshStandardMaterial>;

  constructor(scene3d: Stage, sfx: Sfx) {
    super(scene3d, sfx);
    this.ballMats = {
      ball: new THREE.MeshStandardMaterial({ color: COLORS.ball, emissive: 0x7dd3fc, emissiveIntensity: 0.9 }),
      curve: new THREE.MeshStandardMaterial({ color: COLORS.curve, emissive: 0xc026d3, emissiveIntensity: 1.5 }),
      fire: new THREE.MeshStandardMaterial({ color: COLORS.fire, emissive: 0xea580c, emissiveIntensity: 2 }),
    };
    this.group.add(this.goal);
  }

  protected reset(): void {
    this.lives = START_LIVES;
    this.score = this.shots = this.saves = this.streak = this.bestStreak = this.footSaves = this.fireSaves = 0;
    this.shotTimer = 1;
    this.goalFlash = 0;
    this.body = null;
    this.buildGoal(measureBody(this.scene3d));
    this.emitHud();
  }

  protected begin(): void {
    this.body = measureBody(this.scene3d);
    this.buildGoal(this.body);
  }

  onPose(): void {
    const l = this.limbs;
    l.handOk[0] = this.scene3d.getHand('left', l.hands[0]);
    l.handOk[1] = this.scene3d.getHand('right', l.hands[1]);
    l.footOk[0] = this.scene3d.getJoint(27, l.feet[0]);
    l.footOk[1] = this.scene3d.getJoint(28, l.feet[1]);
  }

  protected step(dt: number): void {
    const d = keeperDifficulty(this.shots);
    this.shotTimer -= dt;
    if (this.shotTimer <= 0) {
      this.shotTimer = d.interval;
      this.shoot(d.speed, pickKind(d, Math.random()));
      if (Math.random() < d.doubleChance) this.shoot(d.speed, 'ball');
    }

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const done = this.moveBall(this.balls[i], dt);
      if (this.phase !== 'playing') return; // the last goal ended the game (and cleared the balls)
      if (done) this.removeBall(i);
    }

    if (this.goalFlash > 0) {
      this.goalFlash = Math.max(0, this.goalFlash - dt);
      this.goalMat.emissive.setHex(this.goalFlash > 0 ? 0xef4444 : GOAL_COLOR);
      this.goalMat.color.setHex(this.goalFlash > 0 ? 0xef4444 : GOAL_COLOR);
    }
  }

  private shoot(speed: number, kind: BallKind): void {
    const body = (this.body ??= measureBody(this.scene3d));
    const aim = pickAim(body);
    const from = { x: body.centerX + (Math.random() * 2 - 1) * 2, y: 0.4 + Math.random() * 0.8 };
    const v = speed * (kind === 'fire' ? FIRE_SPEED_FACTOR : 1) * (0.92 + Math.random() * 0.16);

    const mesh = new THREE.Mesh(this.ballGeo, this.ballMats[kind]);
    mesh.position.set(from.x, from.y, LAUNCH_Z);
    mesh.castShadow = true;
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({
        color: COLORS[kind], transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.position.set(aim.x, aim.y, BLOCK_Z);
    this.group.add(mesh, ring);

    this.balls.push({
      kind,
      mesh,
      ring,
      from,
      aim,
      arc: kind === 'fire' ? 0.15 : 0.4 + Math.random() * 0.8,
      curve: curveAmount(kind, aim.x, body.centerX),
      flight: (BLOCK_Z - LAUNCH_Z) / v,
      age: 0,
      rebound: null,
    });
    this.shots++;
    // A small flash where the shot comes from, so the player can track it from the start.
    this.particles.burst(mesh.position, COLORS[kind], 10, 1.2);
  }

  /** Returns true when the ball should be removed. */
  private moveBall(b: Ball, dt: number): boolean {
    b.age += dt;
    const ringMat = b.ring.material as THREE.MeshBasicMaterial;

    if (b.rebound) {
      b.rebound.y -= 9 * dt;
      b.mesh.position.addScaledVector(b.rebound, dt);
      const mat = b.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, mat.opacity - dt * 1.4);
      ringMat.opacity = 0;
      return mat.opacity <= 0;
    }

    const u = b.age / b.flight;
    const p = flightPoint(b.from, b.aim, b.arc, b.curve, u);
    b.mesh.position.set(p.x, p.y, p.z);
    b.mesh.rotation.x += dt * 8;
    if (b.kind === 'fire' && Math.random() < 0.5) this.particles.burst(b.mesh.position, COLORS.fire, 3, 0.6);

    // The ring fades in and shrinks onto the spot as the ball arrives.
    const k = Math.min(1, Math.max(0, (u - 0.35) / 0.65));
    ringMat.opacity = u <= 1 ? 0.85 * k : 0;
    b.ring.scale.setScalar(1 + (1 - k) * 2);

    const blocker = this.blockedBy(b);
    if (blocker) {
      this.onSave(b, blocker);
      return false;
    }
    if (p.z > GOAL_Z) {
      this.onGoal(b);
      return true;
    }
    return false;
  }

  private blockedBy(b: Ball): 'hand' | 'foot' | null {
    const p = b.mesh.position;
    if (Math.abs(p.z - BLOCK_Z) > BLOCK_DEPTH) return null;
    const l = this.limbs;
    // Depth from a single webcam is unreliable, so x/y decide the block inside the depth window.
    for (let i = 0; i < 2; i++) {
      if (l.handOk[i] && Math.hypot(l.hands[i].x - p.x, l.hands[i].y - p.y) < HAND_RADIUS) return 'hand';
    }
    for (let i = 0; i < 2; i++) {
      if (l.footOk[i] && Math.hypot(l.feet[i].x - p.x, l.feet[i].y - p.y) < FOOT_RADIUS) return 'foot';
    }
    return null;
  }

  private onSave(b: Ball, by: 'hand' | 'foot'): void {
    this.saves++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (by === 'foot') this.footSaves++;
    if (b.kind === 'fire') this.fireSaves++;
    const points = pointsForSave(b.kind, this.streak - 1);
    this.score += points;

    // Bounce back into the arena and fade out.
    const mat = this.ballMats[b.kind].clone();
    mat.transparent = true;
    b.mesh.material = mat;
    b.rebound = new THREE.Vector3((Math.random() * 2 - 1) * 2.5, 3 + Math.random() * 2, -6 - Math.random() * 3);

    const power = b.kind !== 'ball' || this.streak % 5 === 0;
    this.sfx.hit(power);
    if (this.streak % 5 === 0) this.sfx.comboUp();
    this.particles.burst(b.mesh.position, COLORS[b.kind], power ? 34 : 22, power ? 3.5 : 2.5);
    const word = by === 'foot' ? 'FOOT SAVE!' : b.kind === 'fire' ? 'FIRE SAVE!' : SAVE_WORDS[this.saves % SAVE_WORDS.length];
    this.events.emit('popup', { text: `${word} +${points}`, cls: power ? 'power' : 'good', screen: this.toScreen(b.mesh.position) });
    if (this.streak === 10 || this.streak === 25) this.events.emit('announce', { text: `${this.streak} saves in a row!` });
    this.emitHud();
  }

  private onGoal(b: Ball): void {
    this.lives--;
    this.streak = 0;
    this.goalFlash = 0.5;
    this.sfx.bomb();
    this.scene3d.pulse(0xef4444);
    this.particles.burst(b.mesh.position, 0xef4444, 30, 3);
    this.events.emit('popup', { text: 'GOAL!', cls: 'bad', screen: this.toScreen(new THREE.Vector3(b.aim.x, b.aim.y, BLOCK_Z)) });
    this.emitHud();
    if (this.lives <= 0) {
      this.finish(this.score, [
        { label: 'Score', value: String(this.score) },
        { label: 'Saves', value: String(this.saves) },
        { label: 'Shots faced', value: String(this.shots) },
        { label: 'Best streak', value: String(this.bestStreak) },
        { label: 'Fireball saves', value: String(this.fireSaves) },
        { label: 'Foot saves', value: String(this.footSaves) },
      ]);
    } else if (this.lives === 1) {
      this.events.emit('announce', { text: 'Last life!' });
    }
  }

  private emitHud(): void {
    this.events.emit('hud', {
      boxes: [
        { label: 'Score', value: String(this.score) },
        { label: 'Lives', value: '❤'.repeat(Math.max(0, this.lives)) || '–', cls: this.lives <= 1 ? 'low' : undefined },
        { label: 'Streak', value: String(this.streak), cls: this.streak >= 5 ? 'hot' : undefined },
      ],
    });
  }

  /** Neon goal frame behind the player, sized to their reach. */
  private buildGoal(body: BodyRef): void {
    for (const c of [...this.goal.children]) {
      this.goal.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const halfW = body.reach + 0.35;
    const h = Math.max(2, body.headY + 0.5);
    const r = 0.05;
    const post = (x: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), this.goalMat);
      m.position.set(body.centerX + x, h / 2, GOAL_Z);
      return m;
    };
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, halfW * 2 + r * 2, 12), this.goalMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(body.centerX, h, GOAL_Z);
    const line = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.01, 0.06), this.goalMat);
    line.position.set(body.centerX, 0.01, GOAL_Z);
    this.goal.add(post(-halfW), post(halfW), bar, line);
    this.goalMat.color.setHex(GOAL_COLOR);
    this.goalMat.emissive.setHex(GOAL_COLOR);
  }

  private removeBall(i: number): void {
    const b = this.balls[i];
    this.group.remove(b.mesh, b.ring);
    (b.ring.material as THREE.Material).dispose();
    if (b.rebound) (b.mesh.material as THREE.Material).dispose(); // the faded clone
    this.balls.splice(i, 1);
  }

  protected clearRound(): void {
    for (let i = this.balls.length - 1; i >= 0; i--) this.removeBall(i);
  }
}
