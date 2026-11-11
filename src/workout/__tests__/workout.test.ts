import { beforeEach, describe, expect, it } from 'vitest';
import { WorkoutRunner, type RunnerEvents } from '../workoutRunner';
import { PROGRAMS, READY_SECONDS, estimateMinutes, type Program } from '../programs';
import { CalorieMeter, kcalFor } from '../calories';
import { addRecord, sanitize, summarize, type SessionRecord } from '../history';

const program: Program = {
  id: 'test',
  title: 'Test',
  icon: '',
  subtitle: '',
  steps: [
    { type: 'reps', exercise: 'squat', target: 3, capSec: 30 },
    { type: 'rest', seconds: 10 },
    { type: 'hold', exercise: 'squatHold', seconds: 5 },
  ],
};

let runner: WorkoutRunner;
let log: { type: keyof RunnerEvents; payload: unknown }[];

/** Advance time in 0.1 s frames. */
function run(seconds: number, holding = false) {
  for (let i = 0; i < Math.round(seconds * 10); i++) runner.tick(0.1, holding);
}
const of = (type: keyof RunnerEvents) => log.filter((e) => e.type === type).map((e) => e.payload);

beforeEach(() => {
  runner = new WorkoutRunner();
  log = [];
  for (const type of ['countdown', 'stepStart', 'rep', 'stepEnd', 'finished'] as const) {
    runner.events.on(type, (payload) => log.push({ type, payload }));
  }
  runner.start(program);
});

describe('WorkoutRunner', () => {
  it('counts down before the first step', () => {
    run(READY_SECONDS - 0.05);
    expect(of('countdown')).toEqual([{ value: 3 }, { value: 2 }, { value: 1 }]);
    expect(of('stepStart')).toHaveLength(0);
    run(0.1);
    expect(of('stepStart')).toHaveLength(1);
    expect(runner.activity).toBe('squat');
  });

  it('only counts reps of the current exercise and advances at the target', () => {
    run(READY_SECONDS + 0.1);
    runner.onRep('jumpingJack');
    runner.onRep('squat');
    runner.onRep('squat');
    expect(runner.view().reps).toBe(2);
    runner.onRep('squat');
    expect(of('stepEnd')).toEqual([{ index: 0, step: program.steps[0], completed: true }]);
    expect(runner.activity).toBe('rest');
    runner.onRep('squat'); // during rest: ignored
    expect(runner.view().reps).toBe(0);
  });

  it('moves on when a rep step hits its time cap', () => {
    run(READY_SECONDS + 0.1);
    runner.onRep('squat');
    run(30);
    expect(of('stepEnd')[0]).toMatchObject({ completed: false });
    expect(runner.activity).toBe('rest');
  });

  it('only counts hold time while the player is in position', () => {
    run(READY_SECONDS + 0.1);
    runner.skip(); // squats
    run(10.1); // rest
    expect(runner.activity).toBe('squatHold');
    run(3, false);
    expect(runner.view().held).toBe(0);
    run(3, true);
    expect(runner.view().held).toBeCloseTo(3, 5);
    run(2.1, true);
    const done = of('finished')[0] as RunnerEvents['finished'];
    expect(done).toBeDefined();
    expect(done.completed).toBe(false); // the squat step was skipped
    expect(done.stepsDone).toBe(2);
    expect(done.holdSec).toBeCloseTo(5, 0);
  });

  it('reports a completed workout with rep totals', () => {
    run(READY_SECONDS + 0.1);
    for (let i = 0; i < 3; i++) runner.onRep('squat');
    run(10.1);
    run(5.1, true);
    const done = of('finished')[0] as RunnerEvents['finished'];
    expect(done.completed).toBe(true);
    expect(done.reps.squat).toBe(3);
    expect(runner.isRunning).toBe(false);
  });

  it('returns a partial summary when stopped early', () => {
    run(READY_SECONDS + 0.1);
    runner.onRep('squat');
    const s = runner.stop()!;
    expect(s.completed).toBe(false);
    expect(s.reps.squat).toBe(1);
    expect(runner.stop()).toBeNull();
  });

  it('ships programs of a sensible length', () => {
    for (const p of PROGRAMS) {
      expect(estimateMinutes(p)).toBeGreaterThanOrEqual(2);
      expect(estimateMinutes(p)).toBeLessThanOrEqual(10);
    }
  });
});

describe('calories', () => {
  it('uses MET × kg × hours', () => {
    expect(kcalFor(8, 70, 3600)).toBe(560);
    const m = new CalorieMeter(80);
    for (let i = 0; i < 600; i++) m.tick(0.1, 'jumpingJack'); // 1 minute
    expect(m.kcal).toBeCloseTo((8 * 80) / 60, 5);
    m.tick(5, 'jumpingJack'); // a stalled frame is ignored
    expect(m.kcal).toBeCloseTo((8 * 80) / 60, 5);
  });
});

describe('history', () => {
  const day = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();
  const rec = (at: number, kcal = 10, durationSec = 300): SessionRecord => ({
    at, mode: 'workout', title: 'x', durationSec, kcal, reps: { squat: 5 },
  });

  it('counts a streak ending today or yesterday', () => {
    const records = [rec(day(12)), rec(day(11)), rec(day(10)), rec(day(8))];
    expect(summarize(records, day(12, 20)).streakDays).toBe(3);
    // Nothing yet today: the streak through yesterday still counts.
    expect(summarize(records, day(13, 9)).streakDays).toBe(3);
    // Missed a whole day: streak is broken.
    expect(summarize(records, day(14, 9)).streakDays).toBe(0);
  });

  it('totals the last 7 days', () => {
    const records = [rec(day(12, 8), 20, 600), rec(day(12, 18), 30, 300), rec(day(6), 50), rec(day(5), 99)];
    const s = summarize(records, day(12, 20));
    expect(s.last7).toHaveLength(7);
    expect(s.last7[6]).toMatchObject({ label: 'Today', kcal: 50, minutes: 15, sessions: 2 });
    expect(s.week).toEqual({ sessions: 3, minutes: 20, kcal: 100 });
    expect(s.totals).toEqual({ sessions: 4, kcal: 199, reps: 20 });
  });

  it('keeps records newest first and drops junk from storage', () => {
    const list = addRecord([rec(day(10))], rec(day(11)));
    expect(list.map((r) => r.at)).toEqual([day(11), day(10)]);
    expect(sanitize([rec(day(1)), { at: 'x' }, null, 5])).toHaveLength(1);
    expect(sanitize('nope')).toEqual([]);
  });
});
