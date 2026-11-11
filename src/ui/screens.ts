import { EXERCISES, PROGRAMS, estimateMinutes, stepLabel, type Program } from '../workout/programs';
import type { RunnerView } from '../workout/workoutRunner';
import { totalReps, type HistorySummary, type SessionRecord } from '../workout/history';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export const formatTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Fills the workout picker with one dwell button per program. */
export function buildProgramButtons(onPick: (p: Program) => void): void {
  const row = $('program-list');
  row.replaceChildren();
  PROGRAMS.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'big-btn';
    btn.dataset.dwell = '';
    const icon = document.createElement('span');
    icon.className = 'btn-icon';
    icon.textContent = p.icon;
    const small = document.createElement('small');
    small.textContent = `${i + 1} · ~${estimateMinutes(p)} min · ${p.subtitle}`;
    btn.append(icon, p.title, small);
    btn.addEventListener('click', () => onPick(p));
    row.appendChild(btn);
  });
}

/** Top-center workout panel: current step, counter/timer, progress bar, cue and what's next. */
export function renderWorkoutHud(v: RunnerView, holding: boolean): void {
  const name = $('w-name');
  const value = $('w-value');
  const cue = $('w-cue');
  $('w-step').textContent =
    v.phase === 'ready' ? 'Get ready' : `Step ${Math.min(v.index + 1, v.total)} of ${v.total}`;
  $('w-bar-fill').style.transform = `scaleX(${v.progress})`;
  $('w-next').textContent = v.next ? `Next: ${stepLabel(v.next)}` : v.phase === 'step' ? 'Last one!' : '';

  const panel = $('workout-hud');
  panel.classList.toggle('rest', v.step?.type === 'rest' || v.phase === 'ready');
  cue.classList.remove('ok', 'warn');

  if (v.phase === 'ready' || !v.step) {
    name.textContent = v.next ? stepLabel(v.next) : '';
    value.textContent = String(Math.ceil(v.secondsLeft));
    cue.textContent = v.next && v.next.type !== 'rest' ? EXERCISES[v.next.exercise].cue : '';
    return;
  }
  const step = v.step;
  if (step.type === 'rest') {
    name.textContent = 'Rest';
    value.textContent = String(Math.ceil(v.secondsLeft));
    cue.textContent = 'Breathe · shake it out';
  } else if (step.type === 'hold') {
    name.textContent = EXERCISES[step.exercise].name;
    value.textContent = `${Math.ceil(v.secondsLeft)}s`;
    cue.textContent = holding ? 'Hold it!' : 'Sit lower to start the clock';
    cue.classList.add(holding ? 'ok' : 'warn');
  } else {
    name.textContent = EXERCISES[step.exercise].name;
    value.textContent = `${v.reps} / ${step.target}`;
    cue.textContent = EXERCISES[step.exercise].cue;
  }
}

export function renderSessionStats(sec: number, kcal: number): void {
  $('ss-time').textContent = formatTime(sec);
  $('ss-kcal').textContent = String(Math.round(kcal));
}

export interface SummaryView {
  title: string;
  heading: string;
  durationSec: number;
  kcal: number;
  reps: number;
  formPct: number | null;
  steps: string;
  streak: number;
  tip: string;
}

export function renderSummary(s: SummaryView): void {
  $('s-heading').textContent = s.heading;
  $('s-title').textContent = s.title;
  $('s-time').textContent = formatTime(s.durationSec);
  $('s-kcal').textContent = String(Math.round(s.kcal));
  $('s-reps').textContent = String(s.reps);
  $('s-form').textContent = s.formPct === null ? '–' : `${Math.round(s.formPct * 100)}%`;
  $('s-steps').textContent = s.steps;
  $('s-streak').textContent = String(s.streak);
  $('s-tip').textContent = s.tip;
}

const MODE_ICON: Record<SessionRecord['mode'], string> = { workout: '🏋️', free: '💪', smash: '🎯' };

export function renderProgress(sum: HistorySummary, recent: SessionRecord[], weightKg: number): void {
  $('p-streak').textContent = String(sum.streakDays);
  $('p-sessions').textContent = String(sum.week.sessions);
  $('p-minutes').textContent = String(Math.round(sum.week.minutes));
  $('p-kcal').textContent = String(Math.round(sum.week.kcal));
  $('p-weight').textContent = String(weightKg);

  // 7-day bar chart of minutes, labelled with calories.
  const chart = $('p-chart');
  chart.replaceChildren();
  const max = Math.max(10, ...sum.last7.map((d) => d.minutes));
  for (const d of sum.last7) {
    const col = document.createElement('div');
    col.className = 'day' + (d.label === 'Today' ? ' today' : '');
    const val = document.createElement('span');
    val.className = 'day-val';
    val.textContent = d.sessions ? `${Math.round(d.minutes)}m` : '';
    const bar = document.createElement('div');
    bar.className = 'day-bar';
    bar.style.height = `${(d.minutes / max) * 100}%`;
    const label = document.createElement('span');
    label.className = 'day-label';
    label.textContent = d.label;
    col.append(val, bar, label);
    chart.appendChild(col);
  }

  const list = $('p-recent');
  list.replaceChildren();
  if (!recent.length) {
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = 'No sessions yet. Finish a workout, game or free session to see it here.';
    list.appendChild(empty);
  }
  for (const r of recent) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const when = new Date(r.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const detail =
      r.mode === 'smash' ? `${r.score ?? 0} pts` : `${totalReps(r)} reps${r.completed === false ? ' · partial' : ''}`;
    const cells = [`${MODE_ICON[r.mode]} ${r.title}`, when, formatTime(r.durationSec), detail, `${Math.round(r.kcal)} kcal`];
    for (const text of cells) {
      const c = document.createElement('span');
      c.textContent = text;
      row.appendChild(c);
    }
    list.appendChild(row);
  }
}
