import { LM, isVisible, type MotionFrame } from '../geometry';
import type { BodyProfile } from '../calibration';

export interface JumpEvent {
  /** estimated foot clearance in meters */
  heightM: number;
  airtimeMs: number;
}

/**
 * Detects jumps from both ankles rising in the image above a standing baseline.
 * (World landmarks are hip-centered, so they can't see the whole body leave the floor.)
 * The baseline slowly follows the player while they stand, so stepping closer/farther is tolerated.
 */
export class JumpDetector {
  static readonly TAKEOFF = 0.08; // fraction of leg length
  static readonly LAND = 0.03;
  static readonly MIN_AIR_MS = 60;
  static readonly MAX_AIR_MS = 1500;

  private airborne = false;
  private airStart = 0;
  private peak = 0;
  private baseline: number | null = null;

  reset(): void {
    this.airborne = false;
    this.baseline = null;
  }

  update(f: MotionFrame, profile: BodyProfile, knee: number | null): JumpEvent | null {
    const la = f.image[LM.L_ANKLE];
    const ra = f.image[LM.R_ANKLE];
    if (!isVisible(la) || !isVisible(ra)) return null;

    const ankleY = (la.y + ra.y) / 2;
    this.baseline ??= profile.standingAnkleY;
    // Both feet must leave the floor: use the smaller rise.
    const rise = Math.min(this.baseline - la.y, this.baseline - ra.y);
    const takeoff = JumpDetector.TAKEOFF * profile.legLengthImg;
    const land = JumpDetector.LAND * profile.legLengthImg;

    if (!this.airborne) {
      if (rise > takeoff) {
        this.airborne = true;
        this.airStart = f.t;
        this.peak = rise;
      } else if ((knee ?? 180) > 150 && Math.abs(this.baseline - ankleY) < takeoff) {
        // Standing: let the baseline drift with the player.
        this.baseline += (ankleY - this.baseline) * 0.05;
      }
      return null;
    }

    this.peak = Math.max(this.peak, rise);
    const air = f.t - this.airStart;
    if (air > JumpDetector.MAX_AIR_MS) {
      // Not a jump — the player moved away from the camera. Re-anchor.
      this.airborne = false;
      this.baseline = ankleY;
      return null;
    }
    if (rise < land) {
      this.airborne = false;
      if (air < JumpDetector.MIN_AIR_MS) return null;
      return { heightM: this.peak * profile.metersPerImgUnit, airtimeMs: air };
    }
    return null;
  }
}
