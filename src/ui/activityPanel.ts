import type { MotionEngine } from '../motion/motionEngine';
import { SQUAT_TIP_TEXT } from '../motion/form';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Binds MotionEngine events to the on-screen counters, calibration overlay, toasts and pause screen. */
export class ActivityPanel {
  private toastTimer = 0;
  /** When true, exercise toasts and floor pulses are suppressed (e.g. during a game). */
  quiet = false;
  private readonly el = {
    squat: $('count-squat'),
    jump: $('count-jump'),
    jack: $('count-jack'),
    highKnee: $('count-highknee'),
    calib: $('calibration'),
    calibRing: $('calib-ring'),
    calibPct: $('calib-pct'),
    calibMsg: $('calib-message'),
    toast: $('toast'),
    pauseProgress: $('pause-progress'),
    knee: $('knee-angle'),
  };

  constructor(
    private readonly engine: MotionEngine,
    onRep: (kind: 'squat' | 'jump' | 'jumpingJack' | 'highKnee') => void,
  ) {
    const ev = engine.events;

    ev.on('calibration', (s) => {
      this.el.calib.classList.remove('hidden');
      this.el.calibMsg.textContent = s.message;
      this.el.calibRing.style.setProperty('--p', String(s.progress));
      this.el.calibPct.textContent = `${Math.round(s.progress * 100)}%`;
    });
    ev.on('calibrated', () => {
      this.el.calib.classList.add('hidden');
      this.toast('Calibrated — start moving!', 'ok');
    });

    ev.on('squat', (r) => {
      this.bump(this.el.squat, r.count);
      if (this.quiet) return;
      if (r.tips.length) this.toast(SQUAT_TIP_TEXT[r.tips[0]], 'warn');
      else this.toast(r.depthDeg < 90 ? 'Deep squat!' : 'Squat ✓', 'ok');
      onRep('squat');
    });
    ev.on('jump', (j) => {
      this.bump(this.el.jump, j.count);
      if (this.quiet) return;
      this.toast(`Jump ✓  ~${Math.round(j.heightM * 100)} cm`, 'ok');
      onRep('jump');
    });
    ev.on('jumpingJack', (r) => {
      this.bump(this.el.jack, r.count);
      if (!this.quiet) onRep('jumpingJack');
    });
    ev.on('highKnee', (r) => {
      this.bump(this.el.highKnee, r.count);
      if (!this.quiet) onRep('highKnee');
    });
    ev.on('feedback', (f) => {
      if (!this.quiet) this.toast(f.message, 'warn');
    });

    ev.on('pauseProgress', ({ progress }) => {
      this.el.pauseProgress.textContent = progress > 0 ? `${Math.round(progress * 100)}%` : '';
    });
    ev.on('tracking', ({ lost }) => {
      if (lost && !engine.profile) this.el.calib.classList.add('hidden');
    });
  }

  /** Call every frame for continuously changing values. */
  tick(): void {
    const k = this.engine.metrics.kneeDeg;
    this.el.knee.textContent = k === null ? '–' : String(Math.round(k));
  }

  showCalibration(): void {
    this.el.calib.classList.remove('hidden');
  }

  refreshCounts(): void {
    this.el.squat.textContent = String(this.engine.squat.count);
    this.el.jump.textContent = String(this.engine.jumpCount);
    this.el.jack.textContent = String(this.engine.jack.count);
    this.el.highKnee.textContent = String(this.engine.highKnee.count);
  }

  private bump(el: HTMLElement, value: number): void {
    el.textContent = String(value);
    el.classList.remove('bump');
    void el.offsetWidth; // restart CSS animation
    el.classList.add('bump');
  }

  toast(message: string, level: 'ok' | 'warn'): void {
    const t = this.el.toast;
    t.textContent = message;
    t.className = `show ${level}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.className = ''), 1400);
  }
}
