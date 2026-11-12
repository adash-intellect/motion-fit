import { AVATAR_KINDS, AVATAR_LABELS, type AvatarKind, type Stage } from './scene/stage';
import type { MotionEngine } from './motion/motionEngine';
import { SQUAT_TIP_TEXT, type SquatTip } from './motion/form';
import type { ActivityPanel } from './ui/activityPanel';
import type { HandCursor } from './ui/handCursor';
import type { Sfx } from './game/sfx';
import { TargetSmash } from './game/targetSmash';
import { accuracy } from './game/smashRules';
import type { ArcadeGame, HudBox, PlayId, ResultStat } from './game/arcadeGame';
import { Goalkeeper } from './game/goalkeeper';
import { ShapeFit } from './game/shapeFit';
import { loadJson, loadNumber, loadString, saveJson, saveNumber, saveString } from './game/storage';
import { EXERCISES, HOLD_KNEE_DEG, PROGRAMS, type Program, type RepExercise } from './workout/programs';
import { WorkoutRunner, type WorkoutSummary } from './workout/workoutRunner';
import { CalorieMeter, DEFAULT_WEIGHT_KG, MAX_WEIGHT_KG, MIN_WEIGHT_KG } from './workout/calories';
import { addRecord, sanitize, summarize, type SessionMode, type SessionRecord } from './workout/history';
import { Coach } from './ui/coach';
import { desktop } from './desktop';
import { isIOS, isMobile } from './ui/device';
import {
  TEXT_SIZES, TEXT_SIZE_LABELS, applySettings, fullscreenState, saveSettings, setFullscreen, type Settings,
} from './ui/settings';
import {
  buildProgramButtons, renderProgress, renderSessionStats, renderSummary, renderWorkoutHud,
} from './ui/screens';

type Mode =
  | 'calibrating' | 'menu' | 'smash' | 'results' | 'free'
  | 'workouts' | 'workout' | 'summary' | 'progress' | 'settings'
  | 'playzone' | 'play' | 'playresults';
const MODES: Mode[] = [
  'calibrating', 'menu', 'smash', 'results', 'free', 'workouts', 'workout', 'summary', 'progress', 'settings',
  'playzone', 'play', 'playresults',
];
/** Full-screen menus (one element each, id = mode name). The hand cursor is shown on these. */
const SCREENS = ['menu', 'results', 'workouts', 'summary', 'progress', 'settings', 'playzone', 'playresults'] as const;
const PLAY_IDS: PlayId[] = ['goalkeeper', 'shapefit'];
const CURSOR_MODES: Mode[] = [...SCREENS];

/** Free-workout time counts as exercise for this long after the last rep. */
const FREE_ACTIVE_MS = 4000;
/** Sessions shorter than this are not saved. */
const MIN_SAVE_SEC = 20;

/** One play session (workout, free workout or game round) being measured for history. */
interface Session {
  mode: SessionMode;
  title: string;
  at: number;
  time: number;
  meter: CalorieMeter;
  reps: Record<RepExercise, number>;
  squats: number;
  cleanSquats: number;
  tips: Map<SquatTip, number>;
  lastRep: { kind: RepExercise; at: number } | null;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Screen/mode controller: calibration → menu → game / guided workout / free workout → results, plus history. */
export class App {
  private mode: Mode = 'calibrating';
  private readonly game: TargetSmash;
  /** Play Zone games (just for fun: not saved to history). */
  private readonly plays: Record<PlayId, ArcadeGame>;
  private play: ArcadeGame | null = null;
  private readonly runner = new WorkoutRunner();
  private readonly coach = new Coach();
  private best = loadNumber('best.smash');
  private weightKg = loadNumber('weightKg', DEFAULT_WEIGHT_KG);
  private history: SessionRecord[] = sanitize(loadJson('history'));
  private session: Session | null = null;
  private program: Program = PROGRAMS[0];
  private progressBack: Mode = 'menu';
  private countdownTimer = 0;
  /** Called whenever the visible screen changes (the remote-control highlight is reset). */
  onScreenChange: (() => void) | null = null;

  constructor(
    private readonly scene3d: Stage,
    private readonly motion: MotionEngine,
    private readonly panel: ActivityPanel,
    private readonly cursor: HandCursor,
    private readonly sfx: Sfx,
    private readonly settings: Settings,
  ) {
    this.game = new TargetSmash(scene3d, sfx);
    this.plays = { goalkeeper: new Goalkeeper(scene3d, sfx), shapefit: new ShapeFit(scene3d, sfx) };
    scene3d.onFrame = (dt) => {
      this.game.update(dt);
      for (const id of PLAY_IDS) this.plays[id].update(dt);
      this.update(dt);
    };
    $('best-smash').textContent = String(this.best);
    this.refreshPlayBests();
    buildProgramButtons((p) => this.startWorkout(p));

    this.bindMotion();
    this.bindGame();
    for (const id of PLAY_IDS) this.bindPlay(this.plays[id]);
    this.bindWorkout();
    this.bindButtons();
    this.refreshMenu();

    const saved = loadString('avatar', 'robot') as AvatarKind;
    void this.applyAvatar(AVATAR_KINDS.includes(saved) ? saved : 'robot');
  }

  /** Cycle Robot → Character → Skeleton. */
  async cycleAvatar(): Promise<void> {
    const cur = this.scene3d.currentAvatar ?? 'robot';
    const next = AVATAR_KINDS[(AVATAR_KINDS.indexOf(cur) + 1) % AVATAR_KINDS.length];
    $('avatar-name').textContent = 'Loading…';
    const got = await this.applyAvatar(next);
    // Character failed to load and fell back to the robot → skip ahead instead of getting stuck.
    if (got !== next && next === 'character') await this.applyAvatar('skeleton');
  }

  private async applyAvatar(kind: AvatarKind): Promise<AvatarKind> {
    const got = await this.scene3d.setAvatar(kind);
    $('avatar-name').textContent = AVATAR_LABELS[got];
    saveString('avatar', got);
    return got;
  }

  toggleQuality(): void {
    this.scene3d.setHighQuality(!this.scene3d.isHighQuality);
  }

  /** Call after the camera and model are ready. */
  begin(): void {
    this.setMode(this.motion.profile ? 'menu' : 'calibrating');
  }

  /** Call on every new pose frame. */
  onPose(nowMs: number): void {
    this.game.onPose(nowMs);
    if (this.mode === 'play') this.play?.onPose(nowMs);
  }

  recalibrate(): void {
    this.endSession();
    this.game.stop();
    this.stopPlay();
    this.motion.setPaused(false);
    this.motion.recalibrate();
    this.panel.showCalibration();
    this.setMode('calibrating');
  }

  handleKey(key: string): void {
    const m = this.mode;
    if (m === 'menu' && key === '1') this.startSmash();
    else if (m === 'menu' && key === '2') this.setMode('workouts');
    else if (m === 'menu' && key === '3') this.startFree();
    else if (m === 'menu' && key === '4') this.openPlayZone();
    else if (m === 'playzone' && PLAY_IDS[Number(key) - 1]) this.startPlay(PLAY_IDS[Number(key) - 1]);
    else if (m === 'menu' && key === 'h') this.showProgress('menu');
    else if (m === 'menu' && key === 's') this.openSettings();
    else if (m === 'workouts' && PROGRAMS[Number(key) - 1]) this.startWorkout(PROGRAMS[Number(key) - 1]);
    else if (m === 'workout' && key === 'n') this.runner.skip();
    else if (m === 'progress' && key === '-') this.changeWeight(-1);
    else if (m === 'progress' && (key === '+' || key === '=')) this.changeWeight(1);
    else if (key === 'escape') this.back();
    else if (key === 'f') void this.toggleFullscreen();
    else if (key === 'p') this.motion.setPaused(!this.motion.paused);
    else if (key === 'a') void this.cycleAvatar();
    else if (key === 'g') {
      this.toggleQuality();
      this.renderSettings();
    }
    else if (key === 'v') {
      this.panel.toast(this.coach.toggle() ? 'Voice coach on' : 'Voice coach off', 'ok');
      this.renderSettings();
    }
  }

  /** Esc / remote Back / gamepad B: leave the current screen. */
  back(): void {
    const m = this.mode;
    if (this.motion.paused) this.motion.setPaused(false);
    else if (m === 'progress') this.setMode(this.progressBack);
    else if (m === 'workouts' || m === 'settings' || m === 'playzone') this.setMode('menu');
    else if (m === 'play' || m === 'playresults') this.openPlayZone();
    else if (m !== 'calibrating' && m !== 'menu') this.toMenu();
  }

  /** Call from a tap / click (iPhone only allows speech after one). */
  unlockVoice(): void {
    this.coach.unlock();
  }

  togglePause(): void {
    this.motion.setPaused(!this.motion.paused);
  }

  // ---------------------------------------------------------------- settings

  private openSettings(): void {
    this.renderSettings();
    this.setMode('settings');
  }

  private async toggleFullscreen(): Promise<void> {
    const on = !(await fullscreenState());
    const ok = await setFullscreen(on);
    if (!ok) {
      $('set-note').textContent = isIOS
        ? 'iPhone / iPad: tap Share → Add to Home Screen, then open MotionFit from there for full screen.'
        : isMobile
          ? 'Tap the Full screen button directly (holding a hand over it does not work for this one).'
          : 'In the browser, press F on the keyboard to switch full screen.';
    }
    // The window needs a moment to change size before the state is read back.
    setTimeout(() => this.renderSettings(), 400);
  }

  private changeSetting(change: (s: Settings) => void): void {
    change(this.settings);
    saveSettings(this.settings);
    applySettings(this.settings);
    this.renderSettings();
  }

  private renderSettings(): void {
    const s = this.settings;
    const onOff = (v: boolean) => (v ? 'On' : 'Off');
    void fullscreenState().then((fs) => ($('set-fullscreen-v').textContent = onOff(fs)));
    $('set-text-v').textContent = TEXT_SIZE_LABELS[s.textSize];
    $('set-margin-v').textContent = onOff(s.tvMargin);
    $('set-voice-v').textContent = onOff(!this.coach.muted);
    $('set-graphics-v').textContent = this.scene3d.isHighQuality ? 'High' : 'Low';
    $('set-model-v').textContent = s.model === 'lite' ? 'Lite (fast)' : 'Full';
    $('set-autostart-v').textContent = onOff(s.autoStart);
    $('set-quit').classList.toggle('hidden', !desktop);
  }

  // ---------------------------------------------------------------- per-frame

  private update(dt: number): void {
    const s = this.session;
    if (!s || this.motion.paused) return;

    if (this.mode === 'workout') {
      const knee = this.motion.metrics.kneeDeg;
      const holding = knee !== null && knee <= HOLD_KNEE_DEG;
      const activity = this.runner.activity;
      s.time += dt;
      s.meter.tick(dt, activity === 'squatHold' && !holding ? 'standing' : activity);
      this.runner.tick(dt, holding); // may finish the workout and end the session
      if (this.mode === 'workout') renderWorkoutHud(this.runner.view(), holding);
    } else if (this.mode === 'free') {
      const recent = s.lastRep && performance.now() - s.lastRep.at < FREE_ACTIVE_MS;
      s.time += dt;
      s.meter.tick(dt, recent ? s.lastRep!.kind : 'standing');
    } else if (this.mode === 'smash' && this.game.isPlaying && !this.game.paused) {
      s.time += dt;
      s.meter.tick(dt, 'smash');
    }
    renderSessionStats(s.time, s.meter.kcal);
  }

  // ---------------------------------------------------------------- modes

  private setMode(mode: Mode): void {
    this.mode = mode;
    const body = document.body.classList;
    for (const m of MODES) body.remove(`mode-${m}`);
    body.add(`mode-${mode}`);

    for (const id of SCREENS) $(id).classList.toggle('hidden', mode !== id);
    $('set-note').textContent = '';
    $('game-hud').classList.toggle('hidden', mode !== 'smash' && mode !== 'results');
    $('play-hud').classList.toggle('hidden', mode !== 'play');
    $('workout-hud').classList.toggle('hidden', mode !== 'workout');
    if (mode !== 'smash' && mode !== 'workout' && mode !== 'play') $('countdown').classList.add('hidden');
    if (mode === 'menu') this.refreshMenu();

    this.panel.quiet = mode !== 'free';
    const arena = mode === 'smash' || mode === 'results' || mode === 'play' || mode === 'playresults';
    this.scene3d.setView(arena ? 'behind' : 'mirror');
    this.scene3d.setHandsHighlighted(mode === 'smash' || (mode === 'play' && this.play?.id === 'goalkeeper'));
    this.updateCursor();
    this.onScreenChange?.();
  }

  private updateCursor(): void {
    this.cursor.enabled = CURSOR_MODES.includes(this.mode) || this.motion.paused;
    if (!this.cursor.enabled) this.cursor.reset();
  }

  private toMenu(): void {
    this.endSession();
    this.game.stop();
    this.stopPlay();
    this.motion.setPaused(false);
    $('best-smash').textContent = String(this.best);
    this.setMode('menu');
  }

  private refreshMenu(): void {
    $('menu-streak').textContent = String(summarize(this.history, Date.now()).streakDays);
  }

  private startSmash(): void {
    this.endSession();
    this.motion.setPaused(false);
    this.beginSession('smash', 'Target Smash');
    this.setMode('smash');
    this.renderHud(60, 0, 0, 1);
    this.game.start();
  }

  // ---------------------------------------------------------------- Play Zone

  private openPlayZone(): void {
    this.stopPlay();
    this.motion.setPaused(false);
    this.refreshPlayBests();
    this.setMode('playzone');
  }

  private startPlay(id: PlayId): void {
    this.endSession();
    this.game.stop();
    this.stopPlay();
    this.motion.setPaused(false);
    this.play = this.plays[id];
    this.setMode('play');
    this.play.start();
  }

  private stopPlay(): void {
    for (const id of PLAY_IDS) this.plays[id].stop();
  }

  private refreshPlayBests(): void {
    for (const id of PLAY_IDS) $(`best-${id}`).textContent = String(loadNumber(`best.${id}`));
  }

  private bindPlay(g: ArcadeGame): void {
    const ev = g.events;
    ev.on('countdown', ({ value }) => this.showCountdown(value > 0 ? String(value) : 'GO!'));
    ev.on('hud', ({ boxes }) => renderPlayHud(boxes));
    ev.on('popup', ({ text, cls, screen }) => this.popup(text, cls, screen));
    ev.on('announce', ({ text }) => {
      this.panel.toast(text, 'ok');
      this.coach.say(text);
    });
    ev.on('end', ({ score, stats }) => {
      const key = `best.${g.id}`;
      const isBest = score > loadNumber(key);
      if (isBest) saveNumber(key, score);
      renderPlayResults(g.title, isBest, stats);
      this.coach.say(isBest ? `Game over. New high score, ${score}!` : `Game over. You scored ${score}.`);
      this.setMode('playresults');
    });
  }

  private startFree(): void {
    this.endSession();
    this.motion.setPaused(false);
    this.motion.resetCounts();
    this.panel.refreshCounts();
    this.beginSession('free', 'Free Workout');
    renderSessionStats(0, 0);
    this.setMode('free');
  }

  private startWorkout(program: Program): void {
    this.endSession();
    this.motion.setPaused(false);
    this.program = program;
    this.beginSession('workout', program.title);
    this.runner.start(program);
    renderSessionStats(0, 0);
    renderWorkoutHud(this.runner.view(), false);
    this.setMode('workout');
    const first = program.steps[0];
    this.coach.say(
      `${program.title}. Get ready. First up: ${first.type === 'reps' ? `${first.target} ${EXERCISES[first.exercise].name}` : 'squat hold'}.`,
    );
  }

  private showProgress(back: Mode): void {
    this.progressBack = back;
    renderProgress(summarize(this.history, Date.now()), this.history.slice(0, 5), this.weightKg);
    this.setMode('progress');
  }

  private changeWeight(deltaKg: number): void {
    this.weightKg = Math.min(MAX_WEIGHT_KG, Math.max(MIN_WEIGHT_KG, this.weightKg + deltaKg));
    saveNumber('weightKg', this.weightKg);
    $('p-weight').textContent = String(this.weightKg);
  }

  // ---------------------------------------------------------------- sessions / history

  private beginSession(mode: SessionMode, title: string): void {
    this.session = {
      mode,
      title,
      at: Date.now(),
      time: 0,
      meter: new CalorieMeter(this.weightKg),
      reps: { squat: 0, jumpingJack: 0, jump: 0, highKnee: 0 },
      squats: 0,
      cleanSquats: 0,
      tips: new Map(),
      lastRep: null,
    };
  }

  /** Stop whatever is running and save it if it was long enough. */
  private endSession(): void {
    const s = this.session;
    if (!s) return;
    if (s.mode === 'workout') {
      const summary = this.runner.stop();
      if (summary) this.saveSession(s, { reps: summary.reps, holdSec: summary.holdSec, completed: false });
    } else if (s.mode === 'free') {
      const reps = Object.values(s.reps).reduce((a, b) => a + b, 0);
      if (reps > 0) {
        this.saveSession(s, { reps: s.reps });
        this.panel.toast(`Saved: ${reps} reps · ${Math.round(s.meter.kcal)} kcal`, 'ok');
      }
    }
    // Unfinished game rounds are not saved.
    this.session = null;
  }

  private saveSession(s: Session, extra: Partial<SessionRecord>): SessionRecord | null {
    this.session = null;
    if (s.time < MIN_SAVE_SEC) return null;
    const rec: SessionRecord = {
      at: s.at,
      mode: s.mode,
      title: s.title,
      durationSec: Math.round(s.time),
      kcal: Math.round(s.meter.kcal * 10) / 10,
      reps: s.reps,
      formPct: s.squats ? s.cleanSquats / s.squats : null,
      ...extra,
    };
    this.history = addRecord(this.history, rec);
    saveJson('history', this.history);
    return rec;
  }

  private finishWorkout(summary: WorkoutSummary): void {
    const s = this.session;
    if (!s) return;
    this.saveSession(s, { reps: summary.reps, holdSec: summary.holdSec, completed: summary.completed });

    const reps = Object.values(summary.reps).reduce((a, b) => a + b, 0);
    const formPct = s.squats ? s.cleanSquats / s.squats : null;
    const topTip = [...s.tips.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let tip = '';
    if (topTip && (formPct ?? 1) < 0.8) tip = `Focus next time: ${SQUAT_TIP_TEXT[topTip].toLowerCase()}`;
    else if (formPct !== null && s.squats >= 5) tip = 'Great squat form!';

    const streak = summarize(this.history, Date.now()).streakDays;
    renderSummary({
      heading: summary.completed ? 'Workout complete!' : 'Workout finished',
      title: summary.title,
      durationSec: s.time,
      kcal: s.meter.kcal,
      reps,
      formPct,
      steps: `${summary.stepsDone}/${summary.stepsTotal}`,
      streak,
      tip,
    });
    this.sfx.end();
    this.coach.say(
      `Workout complete. About ${Math.round(s.meter.kcal)} calories.${streak > 1 ? ` That's a ${streak} day streak!` : ''}`,
    );
    this.setMode('summary');
  }

  /** A rep was counted by the motion engine. */
  private onRep(kind: RepExercise): void {
    const s = this.session;
    if (!s) return;
    if (this.mode === 'workout') {
      this.runner.onRep(kind); // the runner keeps the workout's own rep totals
    } else if (this.mode === 'free') {
      s.reps[kind]++;
      s.lastRep = { kind, at: performance.now() };
    }
  }

  private onSquatForm(tips: SquatTip[]): void {
    const s = this.session;
    const counts =
      (this.mode === 'free' && s) ||
      (this.mode === 'workout' && s && this.runner.currentStep?.type === 'reps' && this.runner.currentStep.exercise === 'squat');
    if (!counts || !s) return;
    s.squats++;
    if (!tips.length) {
      s.cleanSquats++;
      return;
    }
    s.tips.set(tips[0], (s.tips.get(tips[0]) ?? 0) + 1);
    const text = SQUAT_TIP_TEXT[tips[0]];
    if (this.mode === 'workout') this.panel.toast(text, 'warn'); // free mode: the panel already shows it
    this.coach.tip(text);
  }

  // ---------------------------------------------------------------- wiring

  private bindMotion(): void {
    const ev = this.motion.events;

    ev.on('calibrated', () => {
      if (this.mode === 'calibrating') this.setMode('menu');
    });

    ev.on('squat', (r) => {
      this.game.recordExercise('squat');
      this.onSquatForm(r.tips);
      this.onRep('squat');
    });
    ev.on('jump', () => {
      this.game.recordExercise('jump');
      this.onRep('jump');
    });
    ev.on('jumpingJack', () => this.onRep('jumpingJack'));
    ev.on('highKnee', () => this.onRep('highKnee'));
    ev.on('feedback', ({ message }) => {
      // Guided workouts: only show tips for the exercise being done.
      const step = this.runner.currentStep;
      if (this.mode !== 'workout' || step?.type !== 'reps') return;
      const relevant =
        (message === 'Go a little lower' && step.exercise === 'squat') ||
        (message === 'Jump your feet wider' && step.exercise === 'jumpingJack') ||
        (message === 'Knees higher!' && step.exercise === 'highKnee');
      if (relevant) {
        this.panel.toast(message, 'warn');
        this.coach.tip(message);
      }
    });

    ev.on('pauseToggle', ({ paused }) => {
      const pausable = this.mode === 'smash' || this.mode === 'free' || this.mode === 'workout' || this.mode === 'play';
      if (paused && !pausable) {
        this.motion.setPaused(false); // nothing to pause on menus
        return;
      }
      this.game.paused = paused;
      if (this.play) this.play.paused = paused;
      $('paused').classList.toggle('hidden', !paused);
      this.updateCursor();
      this.onScreenChange?.();
    });

    // Auto-pause if the player walks out of view mid-round or mid-workout.
    ev.on('tracking', ({ lost }) => {
      const running =
        (this.mode === 'smash' && this.game.isActive) ||
        (this.mode === 'workout' && this.runner.isRunning) ||
        (this.mode === 'play' && !!this.play?.isActive);
      if (lost && running) this.motion.setPaused(true);
    });
  }

  private bindWorkout(): void {
    const ev = this.runner.events;

    ev.on('countdown', ({ value }) => {
      this.sfx.beep();
      if (this.runner.view().phase === 'ready') this.showCountdown(String(value));
    });

    ev.on('stepStart', ({ index, step, next }) => {
      this.sfx.go();
      if (index === 0) this.showCountdown('GO!');
      if (step.type === 'rest') {
        const nextName = next && next.type !== 'rest' ? EXERCISES[next.exercise].name : 'the next one';
        this.coach.say(`Rest. Next up: ${nextName}.`);
      } else if (step.type === 'hold') {
        this.coach.say(`Squat hold, ${step.seconds} seconds. Sit low and hold.`);
        this.scene3d.pulse(0x4ade80);
      } else {
        this.coach.say(`${step.target} ${EXERCISES[step.exercise].name}. Go!`);
        this.scene3d.pulse(0x38bdf8);
      }
    });

    ev.on('rep', ({ count, target }) => {
      this.sfx.rep();
      const el = $('w-value');
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
      const left = target - count;
      if (left === 3 && target >= 8) this.coach.say('3 more');
      else if (count * 2 === target && target >= 10) this.coach.say('Halfway');
    });

    ev.on('stepEnd', ({ step, completed }) => {
      if (step.type !== 'rest' && completed) {
        this.sfx.comboUp();
        this.scene3d.pulse(0xfbbf24);
      }
    });

    ev.on('finished', (summary) => this.finishWorkout(summary));
  }

  private bindGame(): void {
    const ev = this.game.events;

    ev.on('countdown', ({ value }) => this.showCountdown(value > 0 ? String(value) : 'GO!'));

    ev.on('tick', ({ timeLeft, score, combo, multiplier }) =>
      this.renderHud(timeLeft, score, combo, multiplier),
    );

    ev.on('hit', ({ points, power, kind, screen }) => {
      const label = power ? `POWER +${points}` : kind === 'low' ? `LOW +${points}` : `+${points}`;
      this.popup(label, power ? 'power' : 'good', screen);
    });
    ev.on('bomb', ({ points, screen }) => this.popup(`BOOM ${points}`, 'bad', screen));

    ev.on('end', (stats) => {
      const isBest = stats.score > this.best;
      if (isBest) {
        this.best = stats.score;
        saveNumber('best.smash', stats.score);
      }
      if (this.session) {
        this.session.reps.squat = stats.squats;
        this.session.reps.jump = stats.jumps;
        this.saveSession(this.session, { score: stats.score, completed: true, formPct: null });
      }
      $('new-best').classList.toggle('hidden', !isBest);
      $('r-score').textContent = String(stats.score);
      $('r-accuracy').textContent = `${Math.round(accuracy(stats) * 100)}%`;
      $('r-combo').textContent = String(stats.bestCombo);
      $('r-power').textContent = String(stats.powerHits);
      $('r-squats').textContent = String(stats.squats);
      $('r-bombs').textContent = String(stats.bombsHit);
      this.setMode('results');
    });
  }

  private bindButtons(): void {
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
    on('btn-smash', () => this.startSmash());
    on('btn-workouts', () => this.setMode('workouts'));
    on('btn-free', () => this.startFree());
    on('btn-progress', () => this.showProgress('menu'));
    on('btn-avatar', () => void this.cycleAvatar());
    on('btn-workouts-back', () => this.setMode('menu'));
    on('btn-again', () => this.startSmash());
    on('btn-results-menu', () => this.toMenu());
    on('btn-summary-again', () => this.startWorkout(this.program));
    on('btn-summary-progress', () => this.showProgress('summary'));
    on('btn-summary-menu', () => this.toMenu());
    on('btn-progress-back', () => this.setMode(this.progressBack));
    on('btn-weight-down', () => this.changeWeight(-5));
    on('btn-weight-up', () => this.changeWeight(5));
    on('btn-resume', () => this.motion.setPaused(false));
    on('btn-pause-menu', () => this.toMenu());
    on('btn-settings', () => this.openSettings());
    on('btn-playzone', () => this.openPlayZone());
    on('btn-goalkeeper', () => this.startPlay('goalkeeper'));
    on('btn-shapefit', () => this.startPlay('shapefit'));
    on('btn-playzone-back', () => this.setMode('menu'));
    on('btn-play-again', () => this.play && this.startPlay(this.play.id));
    on('btn-play-zone', () => this.openPlayZone());
    on('btn-play-menu', () => this.toMenu());
    on('btn-settings-back', () => this.setMode('menu'));
    on('set-fullscreen', () => void this.toggleFullscreen());
    on('set-text', () =>
      this.changeSetting((s) => (s.textSize = TEXT_SIZES[(TEXT_SIZES.indexOf(s.textSize) + 1) % TEXT_SIZES.length])),
    );
    on('set-margin', () => this.changeSetting((s) => (s.tvMargin = !s.tvMargin)));
    on('set-voice', () => {
      this.coach.toggle();
      this.renderSettings();
    });
    on('set-graphics', () => {
      this.toggleQuality();
      this.renderSettings();
    });
    on('set-model', () => {
      this.changeSetting((s) => (s.model = s.model === 'lite' ? 'full' : 'lite'));
      $('set-note').textContent = 'The tracking model changes the next time MotionFit starts.';
    });
    on('set-autostart', () => this.changeSetting((s) => (s.autoStart = !s.autoStart)));
    on('set-quit', () => desktop?.quit());
  }

  // ---------------------------------------------------------------- HUD helpers

  private showCountdown(text: string): void {
    const el = $('countdown');
    el.textContent = text;
    el.classList.remove('hidden', 'pop');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this.countdownTimer);
    if (text === 'GO!') this.countdownTimer = window.setTimeout(() => el.classList.add('hidden'), 800);
  }

  private renderHud(timeLeft: number, score: number, combo: number, mult: number): void {
    const time = $('g-time');
    time.textContent = String(Math.ceil(timeLeft));
    time.classList.toggle('low', timeLeft <= 10);
    $('g-score').textContent = String(score);
    const comboEl = $('g-combo');
    comboEl.textContent = combo > 1 ? `${combo} · x${mult}` : `x${mult}`;
    comboEl.classList.toggle('hot', mult > 1);
  }

  private popup(text: string, cls: string, screen: { x: number; y: number }): void {
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.textContent = text;
    el.style.left = `${screen.x * 100}%`;
    el.style.top = `${screen.y * 100}%`;
    $('popups').appendChild(el);
    setTimeout(() => el.remove(), 800);
  }
}

/** Top-center HUD for Play Zone games: whatever boxes the game sends. */
function renderPlayHud(boxes: HudBox[]): void {
  $('play-hud').replaceChildren(
    ...boxes.map((b) => {
      const box = document.createElement('div');
      box.className = 'g-box';
      const label = document.createElement('span');
      label.className = 'g-label';
      label.textContent = b.label;
      const value = document.createElement('span');
      value.textContent = b.value;
      if (b.cls) value.className = b.cls;
      box.append(label, value);
      return box;
    }),
  );
}

function renderPlayResults(title: string, isBest: boolean, stats: ResultStat[]): void {
  $('pr-title').textContent = title;
  $('pr-best').classList.toggle('hidden', !isBest);
  $('pr-stats').replaceChildren(
    ...stats.map((s) => {
      const cell = document.createElement('div');
      const value = document.createElement('span');
      value.textContent = s.value;
      const label = document.createElement('small');
      label.textContent = s.label;
      cell.append(value, label);
      return cell;
    }),
  );
}
