import type { Pt } from '../geometry';
import { thighLiftDeg } from '../form';

export type HighKneeResult = { rep: { count: number; side: 'L' | 'R' } } | { feedback: string } | null;

/**
 * High knees (running in place): each knee lifted toward hip height counts as one rep.
 * The other thigh must stay low, so a squat (both thighs up) never counts.
 */
export class HighKneeDetector {
  static readonly UP_DEG = 55;
  static readonly DOWN_DEG = 25;
  static readonly PARTIAL_DEG = 35;
  static readonly OTHER_MAX_DEG = 30;
  static readonly FEEDBACK_EVERY_MS = 4000;

  count = 0;
  private raised = { L: false, R: false };
  private peak = { L: 0, R: 0 };
  private lastFeedback = -Infinity;

  /** True while a knee is lifted. */
  get inProgress(): boolean {
    return this.raised.L || this.raised.R || this.peak.L > 0 || this.peak.R > 0;
  }

  reset(): void {
    this.raised = { L: false, R: false };
    this.peak = { L: 0, R: 0 };
  }

  update(w: Pt[], t: number): HighKneeResult {
    const l = thighLiftDeg(w, 'L');
    const r = thighLiftDeg(w, 'R');
    if (l === null || r === null) return null;
    const lift = { L: l, R: r };
    const { UP_DEG, DOWN_DEG, PARTIAL_DEG, OTHER_MAX_DEG, FEEDBACK_EVERY_MS } = HighKneeDetector;

    let result: HighKneeResult = null;
    for (const side of ['L', 'R'] as const) {
      const me = lift[side];
      const other = lift[side === 'L' ? 'R' : 'L'];

      if (this.raised[side]) {
        if (me < DOWN_DEG) this.raised[side] = false;
        continue;
      }
      if (me > UP_DEG && other < OTHER_MAX_DEG) {
        this.raised[side] = true;
        this.peak[side] = 0;
        this.count++;
        result = { rep: { count: this.count, side } };
        continue;
      }
      if (me > PARTIAL_DEG && other < OTHER_MAX_DEG) {
        this.peak[side] = Math.max(this.peak[side], me);
      } else if (me < DOWN_DEG && this.peak[side] > 0) {
        this.peak[side] = 0;
        if (!result && t - this.lastFeedback > FEEDBACK_EVERY_MS) {
          this.lastFeedback = t;
          result = { feedback: 'Knees higher!' };
        }
      }
    }
    return result;
  }
}
