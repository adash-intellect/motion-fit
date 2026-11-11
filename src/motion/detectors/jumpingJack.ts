import { LM, allVisible, mid, type Pt } from '../geometry';

export type JackResult = { rep: { count: number } } | { feedback: string } | null;

/**
 * Jumping jack = closed (arms down, feet together) → open (hands above head, feet wide) → closed.
 * Uses world landmarks (meters, y down), with distances relative to shoulder width.
 */
export class JumpingJackDetector {
  static readonly WIDE = 1.3; // feet gap / shoulder width
  static readonly TOGETHER = 1.0;

  count = 0;
  private phase: 'closed' | 'open' = 'closed';
  private armsOnly = false;

  /** True while mid-rep (arms up / feet wide). */
  get inProgress(): boolean {
    return this.phase === 'open' || this.armsOnly;
  }

  reset(): void {
    this.phase = 'closed';
    this.armsOnly = false;
  }

  update(w: Pt[], shoulderWidth: number): JackResult {
    const need = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST, LM.L_ANKLE, LM.R_ANKLE];
    if (!allVisible(w, need, 0.4)) return null;

    const lw = w[LM.L_WRIST], rw = w[LM.R_WRIST];
    const shoulders = mid(w[LM.L_SHOULDER], w[LM.R_SHOULDER]);
    const armsUp = lw.y < w[LM.NOSE].y && rw.y < w[LM.NOSE].y;
    const armsDown = lw.y > shoulders.y + 0.1 && rw.y > shoulders.y + 0.1;
    const gap = Math.abs(w[LM.L_ANKLE].x - w[LM.R_ANKLE].x) / shoulderWidth;
    const wide = gap > JumpingJackDetector.WIDE;
    const together = gap < JumpingJackDetector.TOGETHER;

    if (this.phase === 'closed') {
      if (armsUp && wide) {
        this.phase = 'open';
        this.armsOnly = false;
      } else if (armsUp) {
        this.armsOnly = true;
      } else if (armsDown && together && this.armsOnly) {
        this.armsOnly = false;
        return { feedback: 'Jump your feet wider' };
      }
      return null;
    }

    if (armsDown && together) {
      this.phase = 'closed';
      this.count++;
      return { rep: { count: this.count } };
    }
    return null;
  }
}
