import { LM, allVisible, type Pt } from '../geometry';

/**
 * Fires once when the player holds their forearms crossed in front of the chest
 * (an "X") for HOLD_MS. Must be released before it can fire again.
 */
export class PauseGestureDetector {
  static readonly HOLD_MS = 800;

  private since: number | null = null;
  private fired = false;

  reset(): void {
    this.since = null;
    this.fired = false;
  }

  /** Returns 0..1 hold progress, and `fired` true on the frame the gesture triggers. */
  update(w: Pt[], t: number): { progress: number; fired: boolean } {
    const need = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP];
    let crossed = false;
    if (allVisible(w, need, 0.5)) {
      const ls = w[LM.L_SHOULDER], rs = w[LM.R_SHOULDER];
      const lw = w[LM.L_WRIST], rw = w[LM.R_WRIST];
      const top = Math.min(ls.y, rs.y) - 0.05;
      const bottom = Math.max(w[LM.L_HIP].y, w[LM.R_HIP].y);
      const swapped = Math.sign(lw.x - rw.x) !== Math.sign(ls.x - rs.x);
      const atChest = [lw, rw].every((p) => p.y > top && p.y < bottom);
      crossed = swapped && atChest;
    }

    if (!crossed) {
      this.reset();
      return { progress: 0, fired: false };
    }
    this.since ??= t;
    const progress = Math.min(1, (t - this.since) / PauseGestureDetector.HOLD_MS);
    if (progress >= 1 && !this.fired) {
      this.fired = true;
      return { progress, fired: true };
    }
    return { progress: this.fired ? 0 : progress, fired: false };
  }
}
