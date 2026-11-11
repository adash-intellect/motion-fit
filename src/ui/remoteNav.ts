type Dir = 'up' | 'down' | 'left' | 'right';

const KEY_DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
/** Keys TV remotes and keyboards send for "back". */
const BACK_KEYS = new Set(['Backspace', 'BrowserBack', 'GoBack']);

/** Standard gamepad mapping. */
const PAD = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const STICK = 0.6;
const REPEAT_FIRST_MS = 400;
const REPEAT_MS = 180;

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Picks the best target in a direction: must lie that way from the current one;
 * closest wins, with sideways offset weighted more so movement feels like a grid.
 */
export function pickInDirection<T>(from: Rect, dir: Dir, targets: { item: T; rect: Rect }[]): T | null {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const { item, rect } of targets) {
    const tx = (rect.left + rect.right) / 2;
    const ty = (rect.top + rect.bottom) / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    const [main, side] = dir === 'left' ? [-dx, dy] : dir === 'right' ? [dx, dy] : dir === 'up' ? [-dy, dx] : [dy, dx];
    if (main <= 1) continue;
    const score = main + Math.abs(side) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

/**
 * TV remote / keyboard arrows / gamepad navigation over the same [data-dwell] buttons the hand cursor uses.
 * Arrows (or d-pad / left stick) move the highlight, Enter (or A) presses it, Back (or B) goes back.
 */
export class RemoteNav {
  private current: HTMLElement | null = null;
  private padPrev: boolean[] = [];
  private stickDir: Dir | null = null;
  private stickNext = 0;

  constructor(
    private readonly actions: { back: () => void; pause: () => void; moved?: () => void },
  ) {}

  /** Returns true if the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    const dir = KEY_DIRS[e.key];
    if (dir) {
      this.move(dir);
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const el = this.valid(this.current);
      if (!el) return false;
      el.click();
      return true;
    }
    if (BACK_KEYS.has(e.key)) {
      this.actions.back();
      return true;
    }
    return false;
  }

  /** Call once per frame. */
  pollGamepad(now = performance.now()): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) return;

    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.padPrev[i];
    if (edge(PAD.A)) this.valid(this.current)?.click();
    if (edge(PAD.B)) this.actions.back();
    if (edge(PAD.START)) this.actions.pause();

    // D-pad and stick share one auto-repeat.
    const [ax = 0, ay = 0] = pad.axes;
    let dir: Dir | null = null;
    if (pressed[PAD.UP] || ay < -STICK) dir = 'up';
    else if (pressed[PAD.DOWN] || ay > STICK) dir = 'down';
    else if (pressed[PAD.LEFT] || ax < -STICK) dir = 'left';
    else if (pressed[PAD.RIGHT] || ax > STICK) dir = 'right';

    if (dir !== this.stickDir) {
      this.stickDir = dir;
      if (dir) {
        this.move(dir);
        this.stickNext = now + REPEAT_FIRST_MS;
      }
    } else if (dir && now >= this.stickNext) {
      this.move(dir);
      this.stickNext = now + REPEAT_MS;
    }
    this.padPrev = pressed;
  }

  /** Clears the highlight (e.g. when the screen changes). */
  clear(): void {
    this.current?.classList.remove('nav-focus');
    this.current = null;
  }

  private targets(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-dwell]')).filter(
      (el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled,
    );
  }

  private valid(el: HTMLElement | null): HTMLElement | null {
    return el && this.targets().includes(el) ? el : null;
  }

  private move(dir: Dir): void {
    const targets = this.targets();
    if (!targets.length) return;
    const cur = this.valid(this.current);
    let next: HTMLElement | null;
    if (!cur) {
      next = targets[0];
    } else {
      const others = targets.filter((t) => t !== cur).map((item) => ({ item, rect: item.getBoundingClientRect() }));
      next = pickInDirection(cur.getBoundingClientRect(), dir, others);
    }
    if (!next) return;
    this.current?.classList.remove('nav-focus');
    this.current = next;
    next.classList.add('nav-focus');
    next.focus({ preventScroll: true });
    this.actions.moved?.();
  }
}
