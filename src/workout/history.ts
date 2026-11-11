import type { RepExercise } from './programs';

export type SessionMode = 'workout' | 'free' | 'smash';

export interface SessionRecord {
  /** start time, epoch ms */
  at: number;
  mode: SessionMode;
  title: string;
  durationSec: number;
  kcal: number;
  reps: Partial<Record<RepExercise, number>>;
  holdSec?: number;
  score?: number;
  /** share of squats with no form tips, 0..1 (null when no squats were done) */
  formPct?: number | null;
  completed?: boolean;
}

export const MAX_RECORDS = 300;

export interface DayTotal {
  /** start of the local day, epoch ms */
  day: number;
  label: string;
  kcal: number;
  minutes: number;
  sessions: number;
}

export interface HistorySummary {
  streakDays: number;
  week: { sessions: number; minutes: number; kcal: number };
  last7: DayTotal[];
  totals: { sessions: number; kcal: number; reps: number };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Start of the local day `n` days before the day containing `t` (safe across DST changes). */
function daysBefore(t: number, n: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n).getTime();
}

export const totalReps = (r: SessionRecord) => Object.values(r.reps).reduce((s, v) => s + (v ?? 0), 0);

/** Newest first, capped at MAX_RECORDS. */
export function addRecord(records: SessionRecord[], rec: SessionRecord): SessionRecord[] {
  return [rec, ...records].sort((a, b) => b.at - a.at).slice(0, MAX_RECORDS);
}

export function summarize(records: SessionRecord[], now: number): HistorySummary {
  const byDay = new Map<number, SessionRecord[]>();
  for (const r of records) {
    const d = startOfDay(r.at);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  // Streak: consecutive days with a session, ending today (or yesterday if nothing yet today).
  let streakDays = 0;
  let n = byDay.has(startOfDay(now)) ? 0 : 1;
  while (byDay.has(daysBefore(now, n))) {
    streakDays++;
    n++;
  }

  const last7: DayTotal[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = daysBefore(now, i);
    const recs = byDay.get(day) ?? [];
    last7.push({
      day,
      label: i === 0 ? 'Today' : WEEKDAYS[new Date(day).getDay()],
      kcal: recs.reduce((s, r) => s + r.kcal, 0),
      minutes: recs.reduce((s, r) => s + r.durationSec, 0) / 60,
      sessions: recs.length,
    });
  }

  return {
    streakDays,
    week: {
      sessions: last7.reduce((s, d) => s + d.sessions, 0),
      minutes: last7.reduce((s, d) => s + d.minutes, 0),
      kcal: last7.reduce((s, d) => s + d.kcal, 0),
    },
    last7,
    totals: {
      sessions: records.length,
      kcal: records.reduce((s, r) => s + r.kcal, 0),
      reps: records.reduce((s, r) => s + totalReps(r), 0),
    },
  };
}

/** Keeps only entries that look like records (storage may hold old or hand-edited data). */
export function sanitize(data: unknown): SessionRecord[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (r): r is SessionRecord =>
      !!r &&
      typeof r === 'object' &&
      Number.isFinite(r.at) &&
      typeof r.title === 'string' &&
      Number.isFinite(r.durationSec) &&
      Number.isFinite(r.kcal) &&
      !!r.reps &&
      typeof r.reps === 'object',
  );
}
