import { loadJson, saveJson } from '../game/storage';
import { desktop } from '../desktop';
import { isMobile } from './device';

export type TextSize = 'normal' | 'large' | 'xlarge';
export type ModelChoice = 'lite' | 'full';

export interface Settings {
  textSize: TextSize;
  /** Shrinks the picture a little so TVs that crop the edges (overscan) don't hide the HUD. */
  tvMargin: boolean;
  model: ModelChoice;
  /** Start the camera without pressing Start (desktop app, or browser once permission is granted). */
  autoStart: boolean;
}

// Phones get the faster Lite tracking model by default.
const DEFAULTS: Settings = { textSize: 'normal', tvMargin: false, model: isMobile ? 'lite' : 'full', autoStart: true };
export const TEXT_SIZES: TextSize[] = ['normal', 'large', 'xlarge'];
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { normal: 'Normal', large: 'Large', xlarge: 'Extra large' };

export function loadSettings(): Settings {
  const raw = loadJson('settings');
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) } as Settings;
  if (!TEXT_SIZES.includes(s.textSize)) s.textSize = DEFAULTS.textSize;
  if (s.model !== 'lite' && s.model !== 'full') s.model = DEFAULTS.model;
  s.tvMargin = !!s.tvMargin;
  s.autoStart = !!s.autoStart;
  return s;
}

export function saveSettings(s: Settings): void {
  saveJson('settings', s);
}

/** Applies the visual settings to the page. */
export function applySettings(s: Settings): void {
  const body = document.body.classList;
  for (const t of TEXT_SIZES) body.toggle(`text-${t}`, s.textSize === t);
  body.toggle('tv-margin', s.tvMargin);
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

/**
 * Desktop app: switches the window directly. Browser: only works from a key press or click,
 * not from a hand-cursor dwell (browsers require a real user gesture).
 */
export async function setFullscreen(on: boolean): Promise<boolean> {
  if (desktop) {
    desktop.setFullscreen(on);
    return true;
  }
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
    return true;
  } catch {
    return false;
  }
}

export async function fullscreenState(): Promise<boolean> {
  return desktop ? desktop.isFullscreen() : isFullscreen();
}
