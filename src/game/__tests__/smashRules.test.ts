import { describe, expect, it } from 'vitest';
import { accuracy, difficulty, multiplier, pointsFor, POWER_SPEED } from '../smashRules';
import { TargetSmash } from '../targetSmash';

describe('smash rules', () => {
  it('multiplier steps up every 5 hits and caps at x4', () => {
    expect([0, 4, 5, 9, 10, 15, 50].map(multiplier)).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });

  it('scores low targets higher, doubles power hits, and penalises bombs', () => {
    expect(pointsFor('orb', false, 1)).toBe(10);
    expect(pointsFor('low', false, 1)).toBe(15);
    expect(pointsFor('orb', true, 3)).toBe(60);
    expect(pointsFor('bomb', true, 4)).toBe(-20);
  });

  it('gets harder over the round', () => {
    const start = difficulty(0);
    const end = difficulty(1);
    expect(end.spawnInterval).toBeLessThan(start.spawnInterval);
    expect(end.speed).toBeGreaterThan(start.speed);
    expect(start.bombChance).toBe(0); // no bombs in the warm-up
    expect(start.pairChance).toBe(0);
    expect(difficulty(2)).toEqual(end); // clamped
  });

  it('computes accuracy safely', () => {
    const s = TargetSmash.emptyStats();
    expect(accuracy(s)).toBe(0);
    expect(accuracy({ ...s, hits: 3, misses: 1 })).toBe(0.75);
  });

  it('power threshold is a brisk punch, not a gentle reach', () => {
    expect(POWER_SPEED).toBeGreaterThan(1.5);
  });
});
