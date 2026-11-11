export type RepExercise = 'squat' | 'jumpingJack' | 'jump' | 'highKnee';
export type HoldExercise = 'squatHold';
export type Exercise = RepExercise | HoldExercise;
/** Everything the calorie meter can be told the player is doing. */
export type Activity = Exercise | 'rest' | 'standing' | 'smash';

export type Step =
  | { type: 'reps'; exercise: RepExercise; target: number; capSec: number }
  | { type: 'hold'; exercise: HoldExercise; seconds: number }
  | { type: 'rest'; seconds: number };

export interface Program {
  id: string;
  title: string;
  icon: string;
  subtitle: string;
  steps: Step[];
}

export const EXERCISES: Record<Exercise, { name: string; cue: string; secPerRep: number }> = {
  squat: { name: 'Squats', cue: 'Feet shoulder-width · sit back · chest up', secPerRep: 3 },
  jumpingJack: { name: 'Jumping Jacks', cue: 'Hands overhead and feet wide, then back together', secPerRep: 1.6 },
  jump: { name: 'Jumps', cue: 'Bend your knees and jump straight up', secPerRep: 2.2 },
  highKnee: { name: 'High Knees', cue: 'Run in place, knees up to hip height', secPerRep: 0.7 },
  squatHold: { name: 'Squat Hold', cue: 'Sit into a half squat and hold it', secPerRep: 1 },
};

/** Knee angle (degrees) at or below which a squat hold counts. */
export const HOLD_KNEE_DEG = 125;
/** Seconds of "get ready" before the first step. */
export const READY_SECONDS = 5;

/** A rep step gets twice the expected time plus a margin before it moves on anyway. */
const reps = (exercise: RepExercise, target: number): Step => ({
  type: 'reps',
  exercise,
  target,
  capSec: Math.round(target * EXERCISES[exercise].secPerRep * 2 + 15),
});
const hold = (seconds: number): Step => ({ type: 'hold', exercise: 'squatHold', seconds });
const rest = (seconds: number): Step => ({ type: 'rest', seconds });

export const PROGRAMS: Program[] = [
  {
    id: 'warmup',
    title: 'Warm-Up',
    icon: '🌅',
    subtitle: 'Easy start',
    steps: [
      reps('highKnee', 20), reps('jumpingJack', 10), reps('squat', 8),
      rest(15),
      reps('highKnee', 20), reps('squat', 8),
    ],
  },
  {
    id: 'burn',
    title: 'Quick Burn',
    icon: '🔥',
    subtitle: 'Full-body cardio',
    steps: [
      reps('jumpingJack', 20), rest(20),
      reps('squat', 12), rest(20),
      reps('highKnee', 30), rest(20),
      reps('jump', 8), rest(20),
      hold(30),
    ],
  },
  {
    id: 'legs',
    title: 'Leg Day',
    icon: '🦵',
    subtitle: 'Squats and holds',
    steps: [
      reps('squat', 15), rest(20),
      hold(30), rest(20),
      reps('jump', 10), rest(20),
      reps('squat', 15), rest(20),
      hold(45),
    ],
  },
];

/** Typical duration of one step, seconds. */
export function stepSeconds(step: Step): number {
  if (step.type === 'reps') return step.target * EXERCISES[step.exercise].secPerRep;
  return step.seconds;
}

export function estimateMinutes(program: Program): number {
  const sec = READY_SECONDS + program.steps.reduce((s, st) => s + stepSeconds(st), 0);
  return Math.max(1, Math.round(sec / 60));
}

export function stepLabel(step: Step): string {
  if (step.type === 'rest') return `Rest ${step.seconds}s`;
  if (step.type === 'hold') return `${EXERCISES[step.exercise].name} ${step.seconds}s`;
  return `${step.target} ${EXERCISES[step.exercise].name}`;
}
