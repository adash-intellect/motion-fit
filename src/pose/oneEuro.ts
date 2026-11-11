/**
 * One Euro filter (Casiez et al. 2012): removes jitter when still,
 * stays responsive during fast movement. Ideal for pose landmarks.
 */
class LowPass {
  private y: number | null = null;
  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  get last(): number | null {
    return this.y;
  }
  reset(): void {
    this.y = null;
  }
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param t timestamp in seconds */
  filter(value: number, t: number): number {
    const dt = this.lastT === null ? 1 / 30 : Math.max(t - this.lastT, 1e-3);
    this.lastT = t;
    const prev = this.x.last;
    const derivative = prev === null ? 0 : (value - prev) / dt;
    const edx = this.dx.filter(derivative, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastT = null;
  }
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Applies independent One Euro filters to x/y/z of every landmark. */
export class LandmarkSmoother {
  private filters: OneEuroFilter[][] = [];

  constructor(
    private minCutoff = 1.0,
    private beta = 0.02,
  ) {}

  smooth<T extends Point3>(points: T[], tSeconds: number): T[] {
    return points.map((p, i) => {
      const f = (this.filters[i] ??= [0, 1, 2].map(
        () => new OneEuroFilter(this.minCutoff, this.beta),
      ));
      return {
        ...p,
        x: f[0].filter(p.x, tSeconds),
        y: f[1].filter(p.y, tSeconds),
        z: f[2].filter(p.z, tSeconds),
      };
    });
  }

  reset(): void {
    this.filters = [];
  }
}
