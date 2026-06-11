import { describe, expect, it } from 'vitest';
import { hardModeViolation } from '../src/engine/hardmode.js';

describe('hard mode', () => {
  it('allows anything with no previous guesses', () => {
    expect(hardModeViolation('water', [], 'crane')).toBeNull();
  });

  it('requires yellow letters to be reused', () => {
    // 'trace' vs answer 'water': t, r, a, e all yellow
    expect(hardModeViolation('water', ['trace'], 'spill')).toEqual({
      required: [
        { letter: 'T', color: 'yellow' },
        { letter: 'R', color: 'yellow' },
        { letter: 'A', color: 'yellow' },
        { letter: 'E', color: 'yellow' },
      ],
      forbidden: [],
    });
    expect(hardModeViolation('water', ['trace'], 'eater')).toBeNull();
  });

  it('requires green letters to stay in place', () => {
    // 'wheat' vs 'water': w green at position 1
    expect(hardModeViolation('water', ['wheat'], 'sword')).toEqual({
      required: [
        { letter: 'W', color: 'green' },
        { letter: 'E', color: 'yellow' },
        { letter: 'A', color: 'yellow' },
        { letter: 'T', color: 'yellow' },
      ],
      forbidden: [],
    });
    expect(hardModeViolation('water', ['wheat'], 'water')).toBeNull(); // keeps the green w and all yellows
  });

  it('tracks duplicate-letter requirements', () => {
    // answer 'abbey', guess 'babes' → two b hints (one green, one yellow);
    // 'rebel' keeps both greens (b@3rd, e@4th) but plays only one b
    expect(hardModeViolation('abbey', ['babes'], 'rebel')).toEqual({
      required: [
        { letter: 'B', color: 'green' },
        { letter: 'E', color: 'green' },
        { letter: 'B', color: 'yellow' },
        { letter: 'A', color: 'yellow' },
      ],
      forbidden: [],
    });
  });

  it('does not ban gray letters in plain hard mode', () => {
    // 'crane' vs 'water': c gray; plain hard mode lets you replay it
    expect(hardModeViolation('water', ['crane'], 'reach')).toBeNull();
  });
});

describe('super hard mode', () => {
  it('bans gray letters', () => {
    // 'crane' vs answer 'water': c is gray
    expect(hardModeViolation('water', ['crane'], 'reach', true)).toEqual({
      required: [
        { letter: 'R', color: 'yellow' },
        { letter: 'A', color: 'yellow' },
        { letter: 'E', color: 'yellow' },
      ],
      forbidden: ['C'],
    });
  });

  it('enforces known exact letter counts', () => {
    // answer 'crane' has one e; guess 'eerie' reveals only one e counts.
    // 'reeve' keeps the green e and the yellow r but plays three e's.
    const v = hardModeViolation('crane', ['eerie'], 'reeve', true);
    expect(v).toEqual({
      required: [
        { letter: 'E', color: 'green' },
        { letter: 'R', color: 'yellow' },
      ],
      forbidden: ['E'],
    });
  });

  it('accepts a guess using all information', () => {
    expect(hardModeViolation('water', ['crane', 'wheat'], 'water', true)).toBeNull();
  });
});
