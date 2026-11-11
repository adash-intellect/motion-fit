import { LM, allVisible, dist3, kneeAngle, median, mid, type MotionFrame } from './geometry';

/** Per-player body measurements captured while standing still. */
export interface BodyProfile {
  /** meters */
  shoulderWidth: number;
  /** hip-to-ankle, meters */
  legLength: number;
  /** hip-to-ankle vertical span in normalized image units */
  legLengthImg: number;
  /** ankle midpoint y (normalized image) while standing */
  standingAnkleY: number;
  /** converts normalized image-y distances to meters at the calibrated distance */
  metersPerImgUnit: number;
}

export type CalibrationStatus =
  | { state: 'need_full_body'; progress: 0; message: string }
  | { state: 'stand_straight'; progress: 0; message: string }
  | { state: 'hold_still'; progress: number; message: string }
  | { state: 'done'; progress: 1; message: string; profile: BodyProfile };

const REQUIRED = [
  LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP,
  LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
];

interface Sample {
  shoulderWidth: number;
  legLength: number;
  legLengthImg: number;
  ankleY: number;
  hipX: number;
  hipY: number;
}

/**
 * Asks the player to stand straight and still for `holdMs`, then measures them.
 * Movement beyond `maxDrift` (normalized image units) restarts the countdown.
 */
export class Calibrator {
  private samples: Sample[] = [];
  private start = 0;

  constructor(
    private readonly holdMs = 2000,
    private readonly maxDrift = 0.03,
  ) {}

  reset(): void {
    this.samples = [];
  }

  update(f: MotionFrame): CalibrationStatus {
    const { world: w, image: im } = f;

    if (!allVisible(im, REQUIRED, 0.6) || !allVisible(w, REQUIRED, 0.6)) {
      this.reset();
      return { state: 'need_full_body', progress: 0, message: 'Step back so your whole body is visible' };
    }

    const knee = kneeAngle(w);
    if (knee === null || knee < 160) {
      this.reset();
      return { state: 'stand_straight', progress: 0, message: 'Stand up straight, arms by your sides' };
    }

    const hipImg = mid(im[LM.L_HIP], im[LM.R_HIP]);
    const first = this.samples[0];
    if (first && Math.hypot(hipImg.x - first.hipX, hipImg.y - first.hipY) > this.maxDrift) {
      this.reset();
    }
    if (!this.samples.length) this.start = f.t;

    const leg = (h: number, k: number, a: number) => dist3(w[h], w[k]) + dist3(w[k], w[a]);
    const ankleImg = mid(im[LM.L_ANKLE], im[LM.R_ANKLE]);
    this.samples.push({
      shoulderWidth: dist3(w[LM.L_SHOULDER], w[LM.R_SHOULDER]),
      legLength: (leg(LM.L_HIP, LM.L_KNEE, LM.L_ANKLE) + leg(LM.R_HIP, LM.R_KNEE, LM.R_ANKLE)) / 2,
      legLengthImg: ankleImg.y - hipImg.y,
      ankleY: ankleImg.y,
      hipX: hipImg.x,
      hipY: hipImg.y,
    });

    const progress = Math.min(1, (f.t - this.start) / this.holdMs);
    if (progress < 1) {
      return { state: 'hold_still', progress, message: 'Hold still…' };
    }

    const pick = (k: keyof Sample) => median(this.samples.map((s) => s[k]));
    const legLength = pick('legLength');
    const legLengthImg = Math.max(pick('legLengthImg'), 1e-3);
    const profile: BodyProfile = {
      shoulderWidth: pick('shoulderWidth'),
      legLength,
      legLengthImg,
      standingAnkleY: pick('ankleY'),
      metersPerImgUnit: legLength / legLengthImg,
    };
    this.reset();
    return { state: 'done', progress: 1, message: 'Calibrated!', profile };
  }
}
