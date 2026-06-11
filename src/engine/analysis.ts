import { GameRow } from '../db.js';
import { scoreGuess } from './score.js';
import { wordList } from './words.js';

export type GuessVerdict = 'solved' | 'lucky' | 'solid' | 'unlucky';
export type GuessSkill = 'strong' | 'fine' | 'weak';

export interface GuessAnalysis {
  word: string;
  userName: string;
  /** candidate answers remaining before this guess */
  before: number;
  /** candidates remaining after the feedback from this guess */
  after: number;
  /** mean remaining over all possible answers (probability-weighted) */
  expected: number;
  /** typical (weighted median) remaining — what a 50/50 outcome looks like */
  median: number;
  /** luck of the outcome, judged against the median for THIS word */
  verdict: GuessVerdict;
  /** quality of the word choice itself, ranked against alternative guesses; null when trivial */
  skill: GuessSkill | null;
}

/** Feedback-pattern group sizes for `word` played against every word in `pool`. */
function patternGroups(pool: string[], word: string): { groups: Map<string, number>; keys: string[] } {
  const groups = new Map<string, number>();
  const keys: string[] = new Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const key = scoreGuess(pool[i], word).join(',');
    keys[i] = key;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return { groups, keys };
}

function expectedRemaining(groups: Map<string, number>, total: number): number {
  let sum = 0;
  for (const n of groups.values()) sum += (n * n) / Math.max(1, total);
  return sum;
}

/** Weighted median of "remaining" over equally likely answers: value n carries weight n. */
function medianRemaining(groups: Map<string, number>, total: number): number {
  const sizes = [...groups.values()].sort((a, b) => a - b);
  let acc = 0;
  for (const n of sizes) {
    acc += n;
    if (acc * 2 >= total) return n;
  }
  return sizes[sizes.length - 1] ?? 0;
}

/**
 * Rank the played word's expected remaining against a deterministic sample of
 * alternative guesses from the same pool. Top quarter = strong, bottom = weak.
 */
function skillGrade(pool: string[], playedExpected: number): GuessSkill | null {
  if (pool.length <= 3) return null; // any sane word ends it — nothing to grade
  const K = Math.min(40, pool.length);
  const bench: number[] = [];
  for (let i = 0; i < K; i++) {
    const alt = pool[Math.floor((i * pool.length) / K)];
    bench.push(expectedRemaining(patternGroups(pool, alt).groups, pool.length));
  }
  const better = bench.filter((e) => e < playedExpected - 1e-9).length;
  const pct = better / bench.length;
  if (pct <= 0.25) return 'strong';
  if (pct <= 0.75) return 'fine';
  return 'weak';
}

/**
 * Lifetime play-quality score for one guess: the percentile of its expected
 * narrowing among sampled alternative words from the same candidate pool.
 * 100 = better than every alternative, 50 = median, 0 = worst. Pure skill —
 * computed from EXPECTED remaining, so a lucky bad guess still scores low.
 * Returns null when the pool is too small for the score to mean anything.
 */
export function guessSkillScore(answer: string, prevGuesses: string[], word: string, lang: string): number | null {
  let candidates = wordList(lang, answer.length).answers;
  for (const prev of prevGuesses) {
    const pattern = scoreGuess(answer, prev).join(',');
    candidates = candidates.filter((c) => scoreGuess(c, prev).join(',') === pattern);
  }
  if (candidates.length <= 3) return null;
  const played = expectedRemaining(patternGroups(candidates, word).groups, candidates.length);
  const K = Math.min(40, candidates.length);
  let better = 0;
  for (let i = 0; i < K; i++) {
    const alt = candidates[Math.floor((i * candidates.length) / K)];
    const e = expectedRemaining(patternGroups(candidates, alt).groups, candidates.length);
    if (e < played - 1e-9) better++;
  }
  return Math.round(100 * (1 - better / K));
}

/**
 * WordleBot-style breakdown with two independent axes per guess:
 *  - skill: was the word choice good, compared to what else you could have played?
 *  - luck: did the answer land kinder or harsher than the typical (median) outcome?
 */
export function analyzeGame(game: GameRow): GuessAnalysis[] {
  let candidates = wordList(game.lang, game.answer.length).answers;
  const out: GuessAnalysis[] = [];

  for (const g of game.guesses) {
    const before = candidates.length;
    const actualPattern = scoreGuess(game.answer, g.word).join(',');
    const { groups, keys } = patternGroups(candidates, g.word);
    const expected = expectedRemaining(groups, before);
    const median = medianRemaining(groups, before);

    const solved = g.word === game.answer;
    const skill = solved ? null : skillGrade(candidates, expected);

    candidates = candidates.filter((_, i) => keys[i] === actualPattern);
    const after = candidates.length;

    let verdict: GuessVerdict;
    if (solved) verdict = 'solved';
    else if (median >= 4 && after <= median * 0.5) verdict = 'lucky';
    else if (median >= 4 && after >= median * 2 && after - median >= 5) verdict = 'unlucky';
    else verdict = 'solid';

    out.push({
      word: g.word,
      userName: g.userName,
      before,
      after,
      expected: Math.round(expected * 10) / 10,
      median,
      verdict,
      skill,
    });
  }
  return out;
}
