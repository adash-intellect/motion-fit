import type { Activity } from './programs';

/**
 * MET values (energy cost relative to sitting still), approximated from the
 * Compendium of Physical Activities. Calories are an estimate, not a measurement.
 */
export const MET: Record<Activity, number> = {
  squat: 5.0,
  squatHold: 4.0,
  jumpingJack: 8.0,
  jump: 8.0,
  highKnee: 8.0,
  smash: 6.0,
  rest: 2.0,
  standing: 1.5,
};

export const DEFAULT_WEIGHT_KG = 70;
export const MIN_WEIGHT_KG = 30;
export const MAX_WEIGHT_KG = 200;

/** kcal = MET × body weight (kg) × hours */
export const kcalFor = (met: number, weightKg: number, seconds: number) => (met * weightKg * seconds) / 3600;

/** Accumulates estimated calories as time passes. */
export class CalorieMeter {
  kcal = 0;
  constructor(public weightKg = DEFAULT_WEIGHT_KG) {}

  /** Frames longer than 1 s (tab in background, debugger) are ignored. */
  tick(dt: number, activity: Activity): void {
    if (dt > 0 && dt < 1) this.kcal += kcalFor(MET[activity], this.weightKg, dt);
  }

  reset(): void {
    this.kcal = 0;
  }
}
