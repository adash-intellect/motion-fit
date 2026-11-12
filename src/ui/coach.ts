import { loadString, saveString } from '../game/storage';

/** Spoken coaching via the browser's built-in speech synthesis (works offline on Windows/Edge/Chrome). */
export class Coach {
  muted = loadString('voice', 'on') === 'off';
  private lastTip = -Infinity;
  private readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  /** Speak now, cutting off anything still being said. */
  say(text: string): void {
    if (this.muted || !this.supported) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  /** Form tip: spoken at most every few seconds and never over an announcement. */
  tip(text: string, now = performance.now()): void {
    if (this.muted || !this.supported || now - this.lastTip < 6000 || speechSynthesis.speaking) return;
    this.lastTip = now;
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  /** iPhone/iPad only speak after speech has been started from a tap: call from the Start button. */
  unlock(): void {
    if (!this.supported) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  toggle(): boolean {
    this.muted = !this.muted;
    saveString('voice', this.muted ? 'off' : 'on');
    if (this.muted && this.supported) speechSynthesis.cancel();
    return !this.muted;
  }
}
