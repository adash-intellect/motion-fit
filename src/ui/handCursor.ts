import { LM, isVisible, mid, type Pt } from '../motion/geometry';

const DWELL_MS = 1100;
const COOLDOWN_MS = 900;

/**
 * Hand-controlled cursors for TV-distance navigation.
 * Each hand maps from a body-relative "reach box" to the screen (mirrored),
 * so buttons are reachable without walking. Hover a [data-dwell] element to fill it, then it clicks.
 */
export class HandCursor {
  enabled = false;
  private readonly cursors: Record<'left' | 'right', HTMLElement>;
  private hovered = new Map<HTMLElement, number>(); // element → dwell start
  private cooldownUntil = 0;

  constructor(private readonly onSelect: () => void = () => {}) {
    const make = (side: string) => {
      const el = document.createElement('div');
      el.className = `hand-cursor ${side}`;
      document.body.appendChild(el);
      return el;
    };
    this.cursors = { left: make('left'), right: make('right') };
  }

  update(world: Pt[] | null, now = performance.now()): void {
    const positions: { x: number; y: number }[] = [];

    for (const side of ['left', 'right'] as const) {
      const el = this.cursors[side];
      const p = this.enabled && world ? this.map(world, side) : null;
      el.classList.toggle('visible', !!p);
      if (!p) continue;
      const x = p.x * window.innerWidth;
      const y = p.y * window.innerHeight;
      el.style.transform = `translate(${x}px, ${y}px)`;
      // Hit-test where the cursor actually appears (the page may be scaled by the TV edge margin).
      const r = el.getBoundingClientRect();
      positions.push({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
    }

    this.dwell(positions, now);
  }

  private map(w: Pt[], side: 'left' | 'right'): { x: number; y: number } | null {
    const [wrist, index] = side === 'left' ? [LM.L_WRIST, 19] : [LM.R_WRIST, 20];
    const need = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
    if (!isVisible(w[wrist]) || need.some((i) => !isVisible(w[i], 0.3))) return null;

    const hand = isVisible(w[index]) ? mid(w[wrist], w[index]) : w[wrist];
    const shoulders = mid(w[LM.L_SHOULDER], w[LM.R_SHOULDER]);
    const hips = mid(w[LM.L_HIP], w[LM.R_HIP]);
    const sw = Math.max(0.25, Math.abs(w[LM.L_SHOULDER].x - w[LM.R_SHOULDER].x));

    const halfWidth = sw * 2;
    const top = w[LM.NOSE].y - 0.35;
    const bottom = hips.y + 0.1;
    // Mirror: the player's right hand (negative MediaPipe x) moves the cursor right.
    const x = 0.5 - (hand.x - shoulders.x) / (2 * halfWidth);
    const y = (hand.y - top) / (bottom - top);
    const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));
    return { x: clamp(x), y: clamp(y) };
  }

  private dwell(positions: { x: number; y: number }[], now: number): void {
    const targets = this.enabled
      ? Array.from(document.querySelectorAll<HTMLElement>('[data-dwell]')).filter(
          (el) => el.offsetParent !== null,
        )
      : [];

    const under = new Set<HTMLElement>();
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      const pad = 12;
      if (positions.some((p) => p.x > r.left - pad && p.x < r.right + pad && p.y > r.top - pad && p.y < r.bottom + pad)) {
        under.add(el);
      }
    }

    for (const el of [...this.hovered.keys()]) {
      if (!under.has(el)) {
        this.hovered.delete(el);
        el.style.setProperty('--dwell', '0');
        el.classList.remove('dwelling');
      }
    }

    if (now < this.cooldownUntil) return;

    for (const el of under) {
      const start = this.hovered.get(el) ?? now;
      this.hovered.set(el, start);
      const progress = Math.min(1, (now - start) / DWELL_MS);
      el.style.setProperty('--dwell', String(progress));
      el.classList.add('dwelling');
      if (progress >= 1) {
        this.reset();
        this.cooldownUntil = now + COOLDOWN_MS;
        this.onSelect();
        el.click();
        return;
      }
    }
  }

  reset(): void {
    for (const el of this.hovered.keys()) {
      el.style.setProperty('--dwell', '0');
      el.classList.remove('dwelling');
    }
    this.hovered.clear();
  }
}
