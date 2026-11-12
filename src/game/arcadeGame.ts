import * as THREE from 'three';
import { Emitter } from '../motion/emitter';
import type { Stage } from '../scene/stage';
import type { Sfx } from './sfx';
import { Particles } from './particles';

/** Play Zone games: just-for-fun motion games (no reps, calories or history; a high score each). */
export type PlayId = 'goalkeeper' | 'shapefit';

export interface HudBox {
  label: string;
  value: string;
  /** Optional CSS class for the value (e.g. 'low' turns it red). */
  cls?: string;
}

export interface ResultStat {
  label: string;
  value: string;
}

export type PlayEvents = {
  countdown: { value: number };
  hud: { boxes: HudBox[] };
  popup: { text: string; cls: 'good' | 'power' | 'bad'; screen: { x: number; y: number } };
  /** Short spoken cue (shown as a toast and read by the voice coach). */
  announce: { text: string };
  end: { score: number; stats: ResultStat[] };
};

export const PLAY_COUNTDOWN_SECONDS = 3;

type Phase = 'idle' | 'countdown' | 'playing' | 'ended';

/**
 * Shared round lifecycle for the Play Zone games: 3-2-1 countdown, pause, per-frame stepping,
 * a scene group that is only visible while the game is open, and particle effects.
 */
export abstract class ArcadeGame {
  readonly events = new Emitter<PlayEvents>();
  paused = false;
  abstract readonly id: PlayId;
  abstract readonly title: string;

  protected phase: Phase = 'idle';
  /** Seconds since the countdown ended (or since the countdown started, during the countdown). */
  protected clock = 0;
  protected readonly group = new THREE.Group();
  protected readonly particles: Particles;
  private lastCountdown = -1;

  constructor(
    protected readonly scene3d: Stage,
    protected readonly sfx: Sfx,
  ) {
    this.particles = new Particles(this.group);
    this.group.visible = false;
    scene3d.scene.add(this.group);
  }

  get isActive(): boolean {
    return this.phase === 'countdown' || this.phase === 'playing';
  }

  start(): void {
    this.clearRound();
    this.phase = 'countdown';
    this.clock = 0;
    this.lastCountdown = -1;
    this.paused = false;
    this.group.visible = true;
    this.reset();
  }

  stop(): void {
    this.clearRound();
    this.phase = 'idle';
    this.group.visible = false;
  }

  /** Call once per new pose frame. */
  onPose(_nowMs: number): void {}

  /** Call every render frame. */
  update(dt: number): void {
    this.particles.update(dt);
    if (!this.isActive || this.paused) return;
    this.clock += dt;

    if (this.phase === 'countdown') {
      const left = Math.ceil(PLAY_COUNTDOWN_SECONDS - this.clock);
      if (left !== this.lastCountdown) {
        this.lastCountdown = left;
        this.events.emit('countdown', { value: left });
        if (left > 0) this.sfx.beep();
        else this.sfx.go();
      }
      if (this.clock >= PLAY_COUNTDOWN_SECONDS) {
        this.phase = 'playing';
        this.clock = 0;
        this.begin(); // the player is standing ready: measure the body once
      }
      return;
    }
    this.step(dt);
  }

  protected finish(score: number, stats: ResultStat[]): void {
    this.phase = 'ended';
    this.clearRound();
    this.sfx.end();
    this.events.emit('end', { score, stats });
  }

  protected toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.scene3d.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /** New round: reset counters (called at start, before the countdown). */
  protected abstract reset(): void;
  /** Countdown finished: measure the player and start play. */
  protected abstract begin(): void;
  /** One frame of play. */
  protected abstract step(dt: number): void;
  /** Remove everything the round spawned. */
  protected abstract clearRound(): void;
}

/** Body reference measured from the avatar when a round starts (scene meters). */
export interface BodyRef {
  centerX: number;
  kneeY: number;
  hipY: number;
  shoulderY: number;
  headY: number;
  /** How far to the side a hand can comfortably reach from the body center. */
  reach: number;
}

export function measureBody(scene3d: Stage): BodyRef {
  const tmp = new THREE.Vector3();
  const y = (i: number, fallback: number) => (scene3d.getJoint(i, tmp) ? tmp.y : fallback);
  const x = (i: number, fallback: number) => (scene3d.getJoint(i, tmp) ? tmp.x : fallback);
  const shoulderY = (y(11, 1.45) + y(12, 1.45)) / 2;
  const ls = x(11, -0.18), rs = x(12, 0.18);
  return {
    centerX: (ls + rs) / 2,
    kneeY: (y(25, 0.5) + y(26, 0.5)) / 2,
    hipY: (y(23, 1) + y(24, 1)) / 2,
    shoulderY,
    headY: y(0, shoulderY + 0.2),
    reach: Math.max(0.55, Math.abs(ls - rs) * 2.1),
  };
}
