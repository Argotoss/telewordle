import { describe, expect, it } from 'vitest';
import { keyboardStatus, scoreGuess } from '../src/engine/score.js';

describe('scoreGuess', () => {
  it('marks all green on exact match', () => {
    expect(scoreGuess('water', 'water')).toEqual(['correct', 'correct', 'correct', 'correct', 'correct']);
  });

  it('marks absent letters', () => {
    expect(scoreGuess('water', 'sport')).toEqual(['absent', 'absent', 'absent', 'present', 'present']);
  });

  it('handles present letters in wrong spots', () => {
    expect(scoreGuess('water', 'trace')).toEqual(['present', 'present', 'present', 'absent', 'present']);
  });

  it('does not over-mark duplicate letters in the guess', () => {
    // answer 'olive' has one l (in position 1); guess 'llama' → exact l consumes it, first l gets nothing
    expect(scoreGuess('olive', 'llama')).toEqual(['absent', 'correct', 'absent', 'absent', 'absent']);
  });

  it('prefers exact matches when the guess has duplicates', () => {
    // answer a-b-b-e-y vs guess b-a-b-e-s: b@2 and e@3 exact; leading b and a present; s absent
    expect(scoreGuess('abbey', 'babes')).toEqual(['present', 'present', 'correct', 'correct', 'absent']);
    // answer a-b-b-e-y vs guess k-e-b-a-b: b@2 exact, second b present (answer has two b's)
    expect(scoreGuess('abbey', 'kebab')).toEqual(['absent', 'present', 'correct', 'present', 'present']);
  });

  it('marks duplicate guess letters absent when answer has fewer', () => {
    // answer 'crane' has one e; guess 'eerie' → only one e scores
    const res = scoreGuess('crane', 'eerie');
    const eScores = [res[0], res[1], res[4]];
    expect(eScores.filter((s) => s !== 'absent')).toHaveLength(1);
  });
});

describe('keyboardStatus', () => {
  it('tracks best status per letter across guesses', () => {
    const map = keyboardStatus('water', ['trace', 'wheat']);
    expect(map.get('w')).toBe('correct'); // wheat: w in position
    expect(map.get('t')).toBe('present');
    expect(map.get('c')).toBe('absent');
    expect(map.get('z')).toBe('unused');
  });

  it('never downgrades a letter', () => {
    const map = keyboardStatus('water', ['water', 'trace']);
    expect(map.get('t')).toBe('correct'); // correct from 'water' must survive 'trace'
  });
});
