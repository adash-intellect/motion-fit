/**
 * Synthesized sound effects (Web Audio) — no audio assets needed.
 * Browsers start audio suspended; call unlock() from a user gesture (the Start button).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.5,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, cutoff: number, volume = 0.5): void {
    if (!this.ctx || !this.master || this.muted) return;
    const len = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  hit(power = false): void {
    this.tone(520, 1250, 0.09, 'triangle', 0.45);
    this.noise(0.05, 4000, 0.25);
    if (power) this.tone(1300, 2400, 0.12, 'sine', 0.3, 0.03);
  }
  miss(): void {
    this.tone(220, 140, 0.18, 'triangle', 0.3);
  }
  bomb(): void {
    this.noise(0.45, 700, 0.9);
    this.tone(120, 45, 0.4, 'sawtooth', 0.35);
  }
  comboUp(): void {
    this.tone(880, 880, 0.08, 'square', 0.15);
    this.tone(1320, 1320, 0.12, 'square', 0.15, 0.08);
  }
  beep(): void {
    this.tone(660, 660, 0.12, 'square', 0.2);
  }
  go(): void {
    this.tone(990, 990, 0.3, 'square', 0.25);
  }
  rep(): void {
    this.tone(880, 1320, 0.07, 'sine', 0.25);
  }
  select(): void {
    this.tone(700, 1100, 0.1, 'sine', 0.3);
  }
  end(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, 'triangle', 0.3, i * 0.12));
  }
}
