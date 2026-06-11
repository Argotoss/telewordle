import { GameRow } from '../db.js';
import { scoreGuess } from './score.js';
import { wordList } from './words.js';

export type GuessVerdict = 'solved' | 'lucky' | 'solid' | 'unlucky';

export interface GuessAnalysis {
  word: string;
  userName: string;
  /** candidate answers remaining before this guess */
  before: number;
  /** candidates remaining after the feedback from this guess */
  after: number;
  /** how many candidates this guess was expected to leave, averaged over all possible answers */
  expected: number;
  verdict: GuessVerdict;
}

/**
 * WordleBot-style breakdown: for each guess, how far it narrowed the candidate
 * answer pool, and whether the outcome was luckier or unluckier than the
 * guess deserved (actual remaining vs. expected remaining).
 */
export function analyzeGame(game: GameRow): GuessAnalysis[] {
  let candidates = wordList(game.lang).answers;
  const out: GuessAnalysis[] = [];

  for (const g of game.guesses) {
    const before = candidates.length;
    const actualPattern = scoreGuess(game.answer, g.word).join(',');

    // Group candidates by the feedback this guess would produce if they were
    // the answer. Expected remaining = sum(group^2)/total (probability-weighted).
    const groups = new Map<string, number>();
    const keys: string[] = new Array(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      const key = scoreGuess(candidates[i], g.word).join(',');
      keys[i] = key;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    let expected = 0;
    for (const n of groups.values()) expected += (n * n) / Math.max(1, before);

    candidates = candidates.filter((_, i) => keys[i] === actualPattern);
    const after = candidates.length;

    let verdict: GuessVerdict;
    if (g.word === game.answer) verdict = 'solved';
    else if (after <= expected * 0.5) verdict = 'lucky';
    else if (after >= expected * 2 && after - expected >= 5) verdict = 'unlucky';
    else verdict = 'solid';

    out.push({ word: g.word, userName: g.userName, before, after, expected: Math.round(expected * 10) / 10, verdict });
  }
  return out;
}
