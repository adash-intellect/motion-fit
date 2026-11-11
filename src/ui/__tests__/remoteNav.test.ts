import { describe, expect, it } from 'vitest';
import { pickInDirection, type Rect } from '../remoteNav';

const box = (x: number, y: number, w = 100, h = 60): Rect => ({ left: x, top: y, right: x + w, bottom: y + h });

// Menu layout: three big buttons on top, three small ones below.
const targets = [
  { item: 'smash', rect: box(100, 100) },
  { item: 'workouts', rect: box(400, 100) },
  { item: 'free', rect: box(700, 100) },
  { item: 'avatar', rect: box(150, 300) },
  { item: 'progress', rect: box(400, 300) },
  { item: 'settings', rect: box(650, 300) },
];
const from = (name: string) => targets.find((t) => t.item === name)!.rect;
const others = (name: string) => targets.filter((t) => t.item !== name);
const go = (name: string, dir: 'up' | 'down' | 'left' | 'right') => pickInDirection(from(name), dir, others(name));

describe('remote navigation', () => {
  it('moves along a row', () => {
    expect(go('smash', 'right')).toBe('workouts');
    expect(go('workouts', 'right')).toBe('free');
    expect(go('workouts', 'left')).toBe('smash');
  });

  it('moves between rows to the closest button below/above', () => {
    expect(go('workouts', 'down')).toBe('progress');
    expect(go('free', 'down')).toBe('settings');
    expect(go('avatar', 'up')).toBe('smash');
  });

  it('stays put at the edges', () => {
    expect(go('smash', 'left')).toBeNull();
    expect(go('free', 'up')).toBeNull();
    expect(go('settings', 'down')).toBeNull();
  });
});
