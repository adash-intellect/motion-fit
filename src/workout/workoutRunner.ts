import { Emitter } from '../motion/emitter';
import { READY_SECONDS, type Activity, type Program, type RepExercise, type Step } from './programs';

export interface WorkoutSummary {
  programId: string;
  title: string;
  durationSec: number;
  reps: Record<RepExercise, number>;
  holdSec: number;
  stepsDone: number;
  stepsTotal: number;
  completed: boolean;
}

export type RunnerEvents = {
  /** Whole seconds left in "get ready" or a rest (3, 2, 1). */
  countdown: { value: number };
  stepStart: { index: number; step: Step; next: Step | null };
  rep: { count: number; target: number };
  stepEnd: { index: number; step: Step; completed: boolean };
  finished: WorkoutSummary;
};

export type RunnerPhase = 'idle' | 'ready' | 'step' | 'done';

export interface RunnerView {
  phase: RunnerPhase;
  index: number;
  total: number;
  step: Step | null;
  next: Step | null;
  /** reps done (reps step) */
  reps: number;
  /** seconds held so far (hold step) */
  held: number;
  /** seconds left: ready countdown, rest, hold target, or the rep step's time cap */
  secondsLeft: number;
  /** 0..1 progress of the current step */
  progress: number;
}

const COUNTDOWN_FROM = 3;

/**
 * Runs a workout program: get ready → steps (reps / hold / rest) → finished.
 * Pure logic: the app feeds it time (`tick`) and counted reps (`onRep`).
 */
export class WorkoutRunner {
  readonly events = new Emitter<RunnerEvents>();
  private program: Program | null = null;
  private phase: RunnerPhase = 'idle';
  private index = 0;
  private stepTime = 0;
  private totalTime = 0;
  private reps = 0;
  private held = 0;
  private stepsDone = 0;
  private lastCountdown = -1;
  private totals: Record<RepExercise, number> = WorkoutRunner.zero();
  private holdTotal = 0;

  private static zero(): Record<RepExercise, number> {
    return { squat: 0, jumpingJack: 0, jump: 0, highKnee: 0 };
  }

  get isRunning(): boolean {
    return this.phase === 'ready' || this.phase === 'step';
  }

  get currentStep(): Step | null {
    return this.phase === 'step' && this.program ? this.program.steps[this.index] : null;
  }

  /** What the player is doing right now, for calorie estimates. */
  get activity(): Activity {
    const step = this.currentStep;
    if (!step) return 'standing';
    return step.type === 'rest' ? 'rest' : step.exercise;
  }

  start(program: Program): void {
    this.program = program;
    this.phase = 'ready';
    this.index = 0;
    this.stepTime = this.totalTime = 0;
    this.reps = this.held = 0;
    this.stepsDone = 0;
    this.totals = WorkoutRunner.zero();
    this.holdTotal = 0;
    this.lastCountdown = -1;
  }

  /** Stop early. Returns the summary so far (null if nothing was running). */
  stop(): WorkoutSummary | null {
    if (!this.isRunning) return null;
    const summary = this.summary(false);
    this.phase = 'idle';
    return summary;
  }

  /** Advance time. `holding` = the player is currently in the hold position. */
  tick(dt: number, holding = false): void {
    if (!this.program || !this.isRunning) return;
    this.totalTime += dt;
    this.stepTime += dt;

    if (this.phase === 'ready') {
      this.countdown(READY_SECONDS - this.stepTime);
      if (this.stepTime >= READY_SECONDS) this.beginStep(0);
      return;
    }

    const step = this.program.steps[this.index];
    if (step.type === 'rest') {
      this.countdown(step.seconds - this.stepTime);
      if (this.stepTime >= step.seconds) this.endStep(true);
    } else if (step.type === 'hold') {
      if (holding) {
        this.held += dt;
        this.holdTotal += dt;
      }
      if (this.held >= step.seconds) this.endStep(true);
      else if (this.stepTime >= step.seconds * 2 + 15) this.endStep(false);
    } else if (this.stepTime >= step.capSec) {
      this.endStep(this.reps >= step.target);
    }
  }

  /** A rep was counted by the motion engine. Only the current step's exercise counts. */
  onRep(exercise: RepExercise): void {
    const step = this.currentStep;
    if (!step || step.type !== 'reps' || step.exercise !== exercise) return;
    this.reps++;
    this.totals[exercise]++;
    this.events.emit('rep', { count: this.reps, target: step.target });
    if (this.reps >= step.target) this.endStep(true);
  }

  /** Move on to the next step now. */
  skip(): void {
    if (this.phase === 'ready') this.beginStep(0);
    else if (this.phase === 'step') this.endStep(false);
  }

  view(): RunnerView {
    const steps = this.program?.steps ?? [];
    const step = this.currentStep;
    const base = {
      phase: this.phase,
      index: this.index,
      total: steps.length,
      step,
      next: this.phase === 'ready' ? (steps[0] ?? null) : (steps[this.index + 1] ?? null),
      reps: this.reps,
      held: this.held,
    };
    if (this.phase === 'ready') {
      const left = Math.max(0, READY_SECONDS - this.stepTime);
      return { ...base, secondsLeft: left, progress: 1 - left / READY_SECONDS };
    }
    if (!step) return { ...base, secondsLeft: 0, progress: this.phase === 'done' ? 1 : 0 };
    if (step.type === 'rest') {
      return {
        ...base,
        secondsLeft: Math.max(0, step.seconds - this.stepTime),
        progress: Math.min(1, this.stepTime / step.seconds),
      };
    }
    if (step.type === 'hold') {
      return {
        ...base,
        secondsLeft: Math.max(0, step.seconds - this.held),
        progress: Math.min(1, this.held / step.seconds),
      };
    }
    return {
      ...base,
      secondsLeft: Math.max(0, step.capSec - this.stepTime),
      progress: Math.min(1, this.reps / step.target),
    };
  }

  private countdown(left: number): void {
    const v = Math.ceil(left);
    if (v >= 1 && v <= COUNTDOWN_FROM && v !== this.lastCountdown) {
      this.lastCountdown = v;
      this.events.emit('countdown', { value: v });
    }
  }

  private beginStep(index: number): void {
    const steps = this.program!.steps;
    this.phase = 'step';
    this.index = index;
    this.stepTime = 0;
    this.reps = 0;
    this.held = 0;
    this.lastCountdown = -1;
    this.events.emit('stepStart', { index, step: steps[index], next: steps[index + 1] ?? null });
  }

  private endStep(completed: boolean): void {
    const steps = this.program!.steps;
    const step = steps[this.index];
    if (completed) this.stepsDone++;
    this.events.emit('stepEnd', { index: this.index, step, completed });
    if (this.index + 1 < steps.length) {
      this.beginStep(this.index + 1);
    } else {
      this.phase = 'done';
      this.events.emit('finished', this.summary(true));
    }
  }

  private summary(finished: boolean): WorkoutSummary {
    const p = this.program!;
    return {
      programId: p.id,
      title: p.title,
      durationSec: this.totalTime,
      reps: { ...this.totals },
      holdSec: this.holdTotal,
      stepsDone: this.stepsDone,
      stepsTotal: p.steps.length,
      completed: finished && this.stepsDone === p.steps.length,
    };
  }
}
