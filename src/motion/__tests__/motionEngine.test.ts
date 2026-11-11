import { beforeEach, describe, expect, it } from 'vitest';
import { MotionEngine, type MotionEvents } from '../motionEngine';
import { FRAME_MS, makeFrame, ramp, type PoseOptions } from './syntheticPose';
import type { MotionFrame } from '../geometry';

let engine: MotionEngine;
let t: number;
let log: { type: keyof MotionEvents; payload: unknown }[];

function feed(frames: Iterable<MotionFrame>) {
  for (const f of frames) {
    engine.update(f, f.t);
    t = f.t;
  }
}
function hold(ms: number, pose: PoseOptions = {}) {
  const n = Math.round(ms / FRAME_MS);
  feed(Array.from({ length: n }, (_, i) => makeFrame(t + (i + 1) * FRAME_MS, pose)));
}
function move(ms: number, from: PoseOptions, to: PoseOptions, fixed: PoseOptions = {}) {
  feed(ramp(t, ms, from, to, fixed));
}
const events = (type: keyof MotionEvents) => log.filter((e) => e.type === type);

function calibrate() {
  hold(2300);
  expect(engine.profile).not.toBeNull();
  log = [];
}

beforeEach(() => {
  engine = new MotionEngine();
  t = 0;
  log = [];
  const types: (keyof MotionEvents)[] = [
    'calibrated', 'squat', 'jump', 'jumpingJack', 'highKnee', 'feedback', 'pauseToggle',
  ];
  for (const type of types) engine.events.on(type, (payload) => log.push({ type, payload }));
});

describe('calibration', () => {
  it('measures the player after standing still for ~2 s', () => {
    hold(1500);
    expect(engine.profile).toBeNull();
    hold(800);
    const p = engine.profile!;
    expect(p.shoulderWidth).toBeCloseTo(0.36, 2);
    expect(p.legLength).toBeCloseTo(0.9, 1);
    expect(p.metersPerImgUnit).toBeCloseTo(1 / 0.3, 1);
    expect(events('calibrated')).toHaveLength(1);
  });

  it('restarts the countdown when the player moves', () => {
    hold(1500);
    hold(100, { lift: 0.3 }); // big movement
    hold(1500, { lift: 0.3 });
    expect(engine.profile).toBeNull();
  });

  it('waits while the legs are bent', () => {
    hold(3000, { kneeDeg: 120 });
    expect(engine.profile).toBeNull();
  });
});

describe('squats', () => {
  beforeEach(calibrate);

  it('counts a full squat on the way back up', () => {
    move(600, { kneeDeg: 178 }, { kneeDeg: 90 });
    expect(events('squat')).toHaveLength(0);
    move(600, { kneeDeg: 90 }, { kneeDeg: 178 });
    const reps = events('squat');
    expect(reps).toHaveLength(1);
    expect((reps[0].payload as MotionEvents['squat']).depthDeg).toBeLessThan(95);
  });

  it('counts consecutive reps', () => {
    for (let i = 0; i < 5; i++) {
      move(500, { kneeDeg: 178 }, { kneeDeg: 95 });
      move(500, { kneeDeg: 95 }, { kneeDeg: 178 });
    }
    expect(engine.squat.count).toBe(5);
  });

  it('gives "go lower" feedback for a half squat and does not count it', () => {
    move(500, { kneeDeg: 178 }, { kneeDeg: 130 });
    move(500, { kneeDeg: 130 }, { kneeDeg: 178 });
    expect(engine.squat.count).toBe(0);
    expect(events('feedback').map((e) => (e.payload as { message: string }).message)).toContain(
      'Go a little lower',
    );
  });

  it('is not mistaken for a jump', () => {
    move(600, { kneeDeg: 178 }, { kneeDeg: 90 });
    move(600, { kneeDeg: 90 }, { kneeDeg: 178 });
    expect(events('jump')).toHaveLength(0);
  });
});

describe('jumps', () => {
  beforeEach(calibrate);

  it('detects a jump and estimates its height', () => {
    move(200, { lift: 0 }, { lift: 0.15 });
    move(200, { lift: 0.15 }, { lift: 0 });
    hold(200);
    const jumps = events('jump');
    expect(jumps).toHaveLength(1);
    expect((jumps[0].payload as MotionEvents['jump']).heightM).toBeCloseTo(0.15, 1);
  });

  it('ignores small hops below the threshold', () => {
    move(150, { lift: 0 }, { lift: 0.03 });
    move(150, { lift: 0.03 }, { lift: 0 });
    expect(events('jump')).toHaveLength(0);
  });

  it('does not count slowly stepping away from the camera', () => {
    move(4000, { lift: 0 }, { lift: 0.3 });
    hold(500, { lift: 0.3 });
    expect(events('jump')).toHaveLength(0);
  });
});

describe('jumping jacks', () => {
  beforeEach(calibrate);

  const jack = () => {
    move(250, { feetGap: 0.25, lift: 0, arms: 'down' }, { feetGap: 0.6, lift: 0.08, arms: 'up' });
    move(150, { feetGap: 0.6, lift: 0.08, arms: 'up' }, { feetGap: 0.6, lift: 0, arms: 'up' });
    move(250, { feetGap: 0.6, lift: 0, arms: 'up' }, { feetGap: 0.25, lift: 0.08, arms: 'down' });
    move(150, { feetGap: 0.25, lift: 0.08, arms: 'down' }, { feetGap: 0.25, lift: 0, arms: 'down' });
  };

  it('counts full jumping jacks without also counting jumps', () => {
    jack();
    jack();
    jack();
    hold(1500);
    expect(engine.jack.count).toBe(3);
    expect(events('jump')).toHaveLength(0);
  });

  it('asks for wider feet when only the arms move', () => {
    hold(300, { arms: 'up' });
    hold(300, { arms: 'down' });
    expect(engine.jack.count).toBe(0);
    expect(events('feedback').map((e) => (e.payload as { message: string }).message)).toContain(
      'Jump your feet wider',
    );
  });
});

describe('pause gesture', () => {
  beforeEach(calibrate);

  it('toggles pause after holding crossed arms, and ignores exercise while paused', () => {
    hold(500, { arms: 'crossed' });
    expect(engine.paused).toBe(false);
    hold(500, { arms: 'crossed' });
    expect(engine.paused).toBe(true);

    hold(300);
    move(600, { kneeDeg: 178 }, { kneeDeg: 90 });
    move(600, { kneeDeg: 90 }, { kneeDeg: 178 });
    expect(engine.squat.count).toBe(0);

    hold(1000, { arms: 'crossed' });
    expect(engine.paused).toBe(false);
    expect(events('pauseToggle')).toHaveLength(2);
  });

  it('does not re-toggle while the X is still being held', () => {
    hold(3000, { arms: 'crossed' });
    expect(engine.paused).toBe(true);
    expect(events('pauseToggle')).toHaveLength(1);
  });
});

describe('tracking loss', () => {
  beforeEach(calibrate);

  it('resets a half-finished rep when the player disappears', () => {
    move(600, { kneeDeg: 178 }, { kneeDeg: 90 });
    engine.update(null, t + 1000);
    t += 1000;
    hold(300);
    expect(engine.squat.count).toBe(0);
  });
});

describe('squat form tips', () => {
  beforeEach(calibrate);
  const squat = (fixed: PoseOptions = {}, ms = 700) => {
    move(ms, { kneeDeg: 178 }, { kneeDeg: 95 }, fixed);
    hold(150, { ...fixed, kneeDeg: 95 });
    move(ms, { kneeDeg: 95 }, { kneeDeg: 178 }, fixed);
  };
  const tips = () => events('squat').map((e) => (e.payload as MotionEvents['squat']).tips);

  it('reports a clean, controlled squat with no tips', () => {
    squat({ feetGap: 0.4 });
    expect(tips()).toEqual([[]]);
  });

  it('flags knees caving in', () => {
    squat({ feetGap: 0.4, kneesIn: 0.05 });
    expect(tips()[0]).toContain('kneesOut');
  });

  it('flags leaning too far forward', () => {
    squat({ feetGap: 0.4, torsoLeanDeg: 65 });
    expect(tips()[0]).toEqual(['chestUp']);
  });

  it('flags a rushed rep', () => {
    squat({ feetGap: 0.4 }, 250);
    expect(tips()[0]).toContain('slowDown');
  });
});

describe('high knees', () => {
  beforeEach(calibrate);
  const knee = (side: 'L' | 'R', deg = 75) => {
    move(200, {}, {}, { raiseKnee: { side, deg: deg / 2 } });
    hold(100, { raiseKnee: { side, deg } });
    hold(150);
  };

  it('counts each lifted knee', () => {
    for (let i = 0; i < 3; i++) {
      knee('L');
      knee('R');
    }
    expect(events('highKnee')).toHaveLength(6);
    expect(engine.highKnee.count).toBe(6);
  });

  it('is not counted as squats or jumps, and squats are not counted as high knees', () => {
    knee('L');
    knee('R');
    expect(events('squat')).toHaveLength(0);
    expect(events('jump')).toHaveLength(0);
    expect(events('feedback').map((e) => (e.payload as { message: string }).message)).not.toContain(
      'Go a little lower',
    );
    move(600, { kneeDeg: 178 }, { kneeDeg: 90 });
    move(600, { kneeDeg: 90 }, { kneeDeg: 178 });
    expect(events('highKnee')).toHaveLength(2);
    expect(events('squat')).toHaveLength(1);
  });

  it('asks for higher knees when they only come up a little', () => {
    knee('L', 45);
    expect(events('highKnee')).toHaveLength(0);
    expect(events('feedback').map((e) => (e.payload as { message: string }).message)).toContain('Knees higher!');
  });
});
