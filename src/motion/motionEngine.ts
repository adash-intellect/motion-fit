import { Emitter } from './emitter';
import { kneeAngle, type MotionFrame } from './geometry';
import { Calibrator, type BodyProfile, type CalibrationStatus } from './calibration';
import { SquatDetector, type SquatRep } from './detectors/squat';
import { JumpDetector, type JumpEvent } from './detectors/jump';
import { JumpingJackDetector } from './detectors/jumpingJack';
import { HighKneeDetector } from './detectors/highKnee';
import { PauseGestureDetector } from './detectors/pauseGesture';
import { SquatFormMonitor, thighLiftDeg, type SquatTip } from './form';

export type MotionEvents = {
  calibration: CalibrationStatus;
  calibrated: BodyProfile;
  squat: SquatRep & { tips: SquatTip[] };
  jump: JumpEvent & { count: number };
  jumpingJack: { count: number };
  highKnee: { count: number; side: 'L' | 'R' };
  feedback: { message: string };
  pauseProgress: { progress: number };
  pauseToggle: { paused: boolean };
  tracking: { lost: boolean };
};

export interface MotionMetrics {
  kneeDeg: number | null;
}

/** Thighs this far apart (degrees) mean one knee is lifted, not a squat. */
const ASYMMETRIC_THIGH_DEG = 30;
/** Hops within this window of jumping-jack / high-knee activity are not counted as jumps. */
const JUMP_SUPPRESS_MS = 1200;

/**
 * Turns raw pose frames into game-level events. Games subscribe to `events`
 * and never touch landmarks directly.
 */
export class MotionEngine {
  readonly events = new Emitter<MotionEvents>();
  readonly squat = new SquatDetector();
  readonly jump = new JumpDetector();
  readonly jack = new JumpingJackDetector();
  readonly highKnee = new HighKneeDetector();

  jumpCount = 0;
  profile: BodyProfile | null = null;
  paused = false;
  metrics: MotionMetrics = { kneeDeg: null };

  private readonly calibrator = new Calibrator();
  private readonly pauseGesture = new PauseGestureDetector();
  private readonly squatForm = new SquatFormMonitor();
  private lastSeen = 0;
  private lost = true;
  private lastHopActivity = -Infinity;

  /** Discard the current body profile and run calibration again. */
  recalibrate(): void {
    this.profile = null;
    this.calibrator.reset();
    this.pauseGesture.reset();
    this.resetDetectors();
  }

  resetCounts(): void {
    this.squat.count = this.jumpCount = this.jack.count = this.highKnee.count = 0;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.resetDetectors();
    this.events.emit('pauseToggle', { paused });
  }

  update(frame: MotionFrame | null, now = performance.now()): void {
    if (!frame) {
      if (!this.lost && now - this.lastSeen > 500) {
        this.lost = true;
        this.resetDetectors();
        this.events.emit('tracking', { lost: true });
      }
      this.metrics.kneeDeg = null;
      return;
    }
    this.lastSeen = frame.t;
    if (this.lost) {
      this.lost = false;
      this.events.emit('tracking', { lost: false });
    }

    const knee = kneeAngle(frame.world);
    this.metrics.kneeDeg = knee;

    if (!this.profile) {
      const status = this.calibrator.update(frame);
      this.events.emit('calibration', status);
      if (status.state === 'done') {
        this.profile = status.profile;
        this.events.emit('calibrated', status.profile);
      }
      return;
    }

    const pause = this.pauseGesture.update(frame.world, frame.t);
    this.events.emit('pauseProgress', { progress: pause.progress });
    if (pause.fired) this.setPaused(!this.paused);
    if (this.paused) return;

    // Jumping jacks first, so their hops are not also counted as jumps.
    const jack = this.jack.update(frame.world, this.profile.shoulderWidth);
    if (this.jack.inProgress) this.lastHopActivity = frame.t;
    if (jack && 'rep' in jack) {
      this.lastHopActivity = frame.t;
      this.events.emit('jumpingJack', jack.rep);
    } else if (jack) this.events.emit('feedback', { message: jack.feedback });

    const hk = this.highKnee.update(frame.world, frame.t);
    if (this.highKnee.inProgress) this.lastHopActivity = frame.t;
    if (hk && 'rep' in hk) {
      this.lastHopActivity = frame.t;
      this.events.emit('highKnee', hk.rep);
    } else if (hk) this.events.emit('feedback', { message: hk.feedback });

    if (knee !== null) this.updateSquat(frame, knee);

    const jump = this.jump.update(frame, this.profile, knee);
    if (jump && frame.t - this.lastHopActivity > JUMP_SUPPRESS_MS) {
      this.events.emit('jump', { ...jump, count: ++this.jumpCount });
    }
  }

  private updateSquat(frame: MotionFrame, knee: number): void {
    // One knee lifted (high knees, stepping) bends the average knee angle without being a squat.
    const l = thighLiftDeg(frame.world, 'L');
    const r = thighLiftDeg(frame.world, 'R');
    if (l !== null && r !== null && Math.abs(l - r) > ASYMMETRIC_THIGH_DEG) {
      this.squat.reset();
      this.squatForm.reset();
      return;
    }

    this.squatForm.sample(frame.world, knee);
    const sq = this.squat.update(knee, frame.t);
    if (sq && 'rep' in sq) {
      this.events.emit('squat', { ...sq.rep, tips: this.squatForm.evaluate(sq.rep.durationMs) });
    } else if (sq) {
      this.events.emit('feedback', { message: sq.feedback });
    }
    if (knee > SquatDetector.UP_DEG) this.squatForm.reset();
  }

  private resetDetectors(): void {
    this.squat.reset();
    this.jump.reset();
    this.jack.reset();
    this.highKnee.reset();
    this.squatForm.reset();
    // Note: the pause gesture is deliberately not reset here. Resetting it on pause toggle
    // would let a long-held X re-fire and immediately unpause.
  }
}
