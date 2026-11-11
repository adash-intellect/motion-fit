/** Rolling frames-per-second counter over a 1-second window. */
export class FpsCounter {
  private stamps: number[] = [];

  tick(now = performance.now()): number {
    this.stamps.push(now);
    while (this.stamps.length && now - this.stamps[0] > 1000) this.stamps.shift();
    return this.stamps.length;
  }
}
