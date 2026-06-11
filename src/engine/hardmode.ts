import { scoreGuess } from './score.js';

export type HardModeRequiredColor = 'green' | 'yellow';

export interface HardModeRequiredLetter {
  letter: string;
  color: HardModeRequiredColor;
}

export interface HardModeViolation {
  required: HardModeRequiredLetter[];
  forbidden: string[];
}

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
 * Returns the hint letters involved in a violation, or null if the guess is legal.
 */
export function hardModeViolation(
  answer: string,
  prevGuesses: string[],
  guess: string,
  superHard = false
): HardModeViolation | null {
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

  let positiveViolation = false;
  for (const [pos, letter] of greenAt) {
    if (g[pos] !== letter) positiveViolation = true;
  }
  for (const [letter, n] of required) {
    if (countLetter(g, letter) < n) positiveViolation = true;
  }

  const forbidden: string[] = [];
  if (superHard) {
    for (const [letter, limit] of maxAllowed) {
      if (countLetter(g, letter) > limit) forbidden.push(letter.toUpperCase());
    }
  }

  if (!positiveViolation && forbidden.length === 0) return null;
  return { required: requiredHints(greenAt, required), forbidden };
}

function requiredHints(greenAt: Map<number, string>, required: Map<string, number>): HardModeRequiredLetter[] {
  const hints: HardModeRequiredLetter[] = [];
  const greenCounts = new Map<string, number>();

  for (const [, letter] of [...greenAt].sort(([a], [b]) => a - b)) {
    hints.push({ letter: letter.toUpperCase(), color: 'green' });
    greenCounts.set(letter, (greenCounts.get(letter) ?? 0) + 1);
  }

  for (const [letter, n] of required) {
    const yellowCount = n - (greenCounts.get(letter) ?? 0);
    for (let i = 0; i < yellowCount; i++) {
      hints.push({ letter: letter.toUpperCase(), color: 'yellow' });
    }
  }

  return hints;
}

function countLetter(word: string, letter: string): number {
  return word.split('').filter((c) => c === letter).length;
}
