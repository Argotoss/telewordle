import { scoreGuess } from './score.js';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

/**
 * Hard mode: every hint revealed by previous guesses must be honored.
 *  - green letters must stay in the same position
 *  - yellow letters must appear somewhere in the guess (counted per letter,
 *    cumulative best-known requirement across all previous guesses)
 *
 * Super hard mode additionally bans ignoring negative information:
 *  - gray letters (not in the word at all) may not be used again
 *  - if a previous guess revealed the answer holds exactly N of a letter
 *    (extra copies came back gray), you may not play more than N of it
 *
 * Returns a human-readable violation, or null if the guess is legal.
 */
export function hardModeViolation(
  answer: string,
  prevGuesses: string[],
  guess: string,
  superHard = false
): string | null {
  const a = answer.toLowerCase();
  const g = guess.toLowerCase();

  const greenAt = new Map<number, string>(); // position -> required letter
  const required = new Map<string, number>(); // letter -> min count required
  const maxAllowed = new Map<string, number>(); // letter -> known exact count in answer

  for (const prev of prevGuesses) {
    const p = prev.toLowerCase();
    const score = scoreGuess(a, p);
    const scored = new Map<string, number>(); // correct+present per letter
    const played = new Map<string, number>(); // total occurrences in this guess
    for (let i = 0; i < p.length; i++) {
      played.set(p[i], (played.get(p[i]) ?? 0) + 1);
      if (score[i] === 'correct') greenAt.set(i, p[i]);
      if (score[i] === 'correct' || score[i] === 'present') {
        scored.set(p[i], (scored.get(p[i]) ?? 0) + 1);
      }
    }
    for (const [letter, n] of scored) {
      if (n > (required.get(letter) ?? 0)) required.set(letter, n);
    }
    // played more copies than scored → the answer has exactly `scored` of this letter
    for (const [letter, n] of played) {
      const hits = scored.get(letter) ?? 0;
      if (n > hits) maxAllowed.set(letter, hits);
    }
  }

  for (const [pos, letter] of greenAt) {
    if (g[pos] !== letter) return `the ${ORDINALS[pos]} letter must be ${letter.toUpperCase()}`;
  }
  for (const [letter, n] of required) {
    const have = g.split('').filter((c) => c === letter).length;
    if (have < n) {
      return n > 1
        ? `the guess must contain ${n}× ${letter.toUpperCase()}`
        : `the guess must contain ${letter.toUpperCase()}`;
    }
  }
  if (superHard) {
    for (const [letter, limit] of maxAllowed) {
      const have = g.split('').filter((c) => c === letter).length;
      if (have > limit) {
        return limit === 0
          ? `${letter.toUpperCase()} is not in the word — you can't use it again`
          : `the word has only ${limit}× ${letter.toUpperCase()} — you can't play ${have}`;
      }
    }
  }
  return null;
}
