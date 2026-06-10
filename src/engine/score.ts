export type TileStatus = 'correct' | 'present' | 'absent';

/**
 * Classic Wordle two-pass scoring with correct duplicate-letter handling:
 * exact matches consume letters first, then leftover letters satisfy
 * "present" marks left-to-right.
 */
export function scoreGuess(answer: string, guess: string): TileStatus[] {
  const a = answer.toLowerCase();
  const g = guess.toLowerCase();
  if (a.length !== g.length) throw new Error('length mismatch');

  const result: TileStatus[] = new Array(g.length).fill('absent');
  const remaining: Record<string, number> = {};

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      result[i] = 'correct';
    } else {
      remaining[a[i]] = (remaining[a[i]] ?? 0) + 1;
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] === 'correct') continue;
    if (remaining[g[i]]) {
      result[i] = 'present';
      remaining[g[i]]--;
    }
  }
  return result;
}

export type KeyStatus = TileStatus | 'unused';

const RANK: Record<KeyStatus, number> = { unused: 0, absent: 1, present: 2, correct: 3 };

/** Best-known status per letter across all guesses (correct > present > absent > unused). */
export function keyboardStatus(answer: string, guesses: string[]): Map<string, KeyStatus> {
  const map = new Map<string, KeyStatus>();
  for (const c of 'abcdefghijklmnopqrstuvwxyz') map.set(c, 'unused');
  for (const guess of guesses) {
    const score = scoreGuess(answer, guess);
    const g = guess.toLowerCase();
    for (let i = 0; i < g.length; i++) {
      const prev = map.get(g[i]) ?? 'unused';
      if (RANK[score[i]] > RANK[prev]) map.set(g[i], score[i]);
    }
  }
  return map;
}
