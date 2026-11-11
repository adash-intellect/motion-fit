export interface SquatRep {
  count: number;
  /** smallest knee angle reached (lower = deeper) */
  depthDeg: number;
  durationMs: number;
}

export type SquatResult = { rep: SquatRep } | { feedback: string } | null;

/**
 * Counts squats from the knee angle using hysteresis:
 * a rep starts below DOWN_DEG and completes when the knees straighten past UP_DEG.
 * Dipping below PARTIAL_DEG without reaching DOWN_DEG yields "go lower" feedback.
 */
export class SquatDetector {
  static readonly DOWN_DEG = 110;
  static readonly UP_DEG = 160;
  static readonly PARTIAL_DEG = 140;
  static readonly MIN_REP_MS = 400;

  count = 0;
  private phase: 'up' | 'down' = 'up';
  private dipping = false;
  private minAngle = 180;
  private startT = 0;

  reset(): void {
    this.phase = 'up';
    this.dipping = false;
    this.minAngle = 180;
  }

  update(knee: number, t: number): SquatResult {
    const { DOWN_DEG, UP_DEG, PARTIAL_DEG, MIN_REP_MS } = SquatDetector;

    if (this.phase === 'up') {
      if (knee < PARTIAL_DEG) {
        if (!this.dipping) this.startT = t;
        this.dipping = true;
        this.minAngle = Math.min(this.minAngle, knee);
      }
      if (knee < DOWN_DEG) {
        this.phase = 'down';
        return null;
      }
      if (this.dipping && knee > UP_DEG) {
        this.reset();
        return { feedback: 'Go a little lower' };
      }
      return null;
    }

    // phase === 'down'
    this.minAngle = Math.min(this.minAngle, knee);
    if (knee > UP_DEG) {
      const durationMs = t - this.startT;
      const depthDeg = this.minAngle;
      this.reset();
      if (durationMs < MIN_REP_MS) return null; // too fast → likely tracking noise
      this.count++;
      return { rep: { count: this.count, depthDeg, durationMs } };
    }
    return null;
  }
}
