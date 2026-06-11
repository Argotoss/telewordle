import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { availableLengths, dailyAnswer, isValidWord, wordList } from '../src/engine/words.js';
import { GameService, effectiveTries, maxGuessesFor } from '../src/game/service.js';

const CHAT = -33;
const A = { id: 1, name: 'Alice' };
const B = { id: 2, name: 'Bob' };

let db: Database.Database;
let svc: GameService;

beforeEach(() => {
  db = openDb(':memory:');
  svc = new GameService(db);
});

function setLength(len: number, tries?: number): void {
  const s = svc.settings(CHAT);
  s.wordLength = len;
  if (tries !== undefined) s.triesByLength[String(len)] = tries;
  svc.saveSettings(CHAT, s);
}

function wrongWords(lang: string, len: number, answer: string, n: number): string[] {
  return wordList(lang, len).answers.filter((w) => w !== answer).slice(0, n);
}

describe('word length buckets', () => {
  it('offers lengths 3-10 in both languages', () => {
    for (const lang of ['en', 'ru']) {
      expect(availableLengths(lang)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
      for (const len of availableLengths(lang)) {
        const { answers } = wordList(lang, len);
        expect(answers.length).toBeGreaterThanOrEqual(40);
        for (const w of answers.slice(0, 20)) expect(w).toHaveLength(len);
      }
    }
  });

  it('keeps the classic 5-letter lists intact', () => {
    expect(wordList('en', 5).answers.length).toBe(2315);
    expect(wordList('ru', 5).valid.has('лейло')).toBe(true);
  });

  it('validates words against their own length bucket', () => {
    expect(isValidWord('cat', 'en')).toBe(true);
    expect(isValidWord('crane', 'en')).toBe(true);
    expect(isValidWord('zz', 'en')).toBe(false);
  });

  it('daily words differ per length and stay deterministic', () => {
    expect(dailyAnswer('2026-06-11', 'en', 7)).toHaveLength(7);
    expect(dailyAnswer('2026-06-11', 'en', 7)).toBe(dailyAnswer('2026-06-11', 'en', 7));
  });
});

describe('configurable length & tries', () => {
  it('tries default to length + 1', () => {
    const s = svc.settings(CHAT);
    expect(effectiveTries(s, 3)).toBe(4);
    expect(effectiveTries(s, 5)).toBe(6);
    expect(effectiveTries(s, 10)).toBe(11);
    s.triesByLength['4'] = 3;
    expect(effectiveTries(s, 4)).toBe(3);
    s.triesByLength['4'] = 99;
    expect(effectiveTries(s, 4)).toBe(12); // clamped
  });

  it('starts games with the configured length and freezes the try budget', () => {
    setLength(7);
    const game = svc.startGame(CHAT)!;
    expect(game.answer).toHaveLength(7);
    expect(game.max_guesses).toBe(8);
    expect(maxGuessesFor(game)).toBe(8);

    // changing settings mid-game does not touch the running game
    setLength(3, 2);
    expect(maxGuessesFor(svc.activeGame(CHAT)!)).toBe(8);
  });

  it('loses exactly when the custom try budget runs out', () => {
    setLength(4, 3);
    const game = svc.startGame(CHAT)!;
    expect(game.max_guesses).toBe(3);
    let last;
    for (const w of wrongWords('en', 4, game.answer, 3)) last = svc.submitGuess(CHAT, A, w);
    expect(last!.type === 'accepted' && last!.lost).toBe(true);
  });

  it('rejects guesses of the wrong length with the expected size', () => {
    setLength(6);
    svc.startGame(CHAT);
    const r = svc.submitGuess(CHAT, A, 'crane');
    expect(r.type).toBe('wrong_length');
    if (r.type === 'wrong_length') expect(r.expected).toBe(6);
  });

  it('the daily ignores length settings: always 5 letters, 6 tries', async () => {
    setLength(8, 4);
    const res = await svc.startDaily(CHAT, '2026-06-11');
    if (res === 'busy' || res === 'done') throw new Error('expected fresh daily');
    expect(res.game.answer).toHaveLength(5);
    expect(res.game.max_guesses).toBe(6);
  });

  it('the game answer is always guessable even when off-list (official/custom words)', () => {
    const game = svc.startGame(CHAT)!;
    db.prepare('UPDATE games SET answer = ? WHERE id = ?').run('qzxwv', game.id);
    const r = svc.submitGuess(CHAT, A, 'qzxwv');
    expect(r.type === 'accepted' && r.solved).toBe(true);
  });

  it('tournament points scale with the game try budget', () => {
    setLength(4); // 5 tries → first-guess solve is worth 5 points
    const t0 = svc.createTournament(CHAT, 1, A)!;
    svc.joinTournament(t0.id, B);
    const started = svc.startTournament(t0.id) as Exclude<ReturnType<typeof svc.startTournament>, 'too_few' | null>;
    const r = svc.submitGuess(CHAT, A, started.game.answer);
    if (r.type !== 'accepted' || !r.tournament) throw new Error('expected tournament outcome');
    expect(r.tournament.pointsAwarded).toBe(5);
  });

  it('hints shorten the budget on any length', () => {
    setLength(3);
    const game = svc.startGame(CHAT)!;
    expect(game.max_guesses).toBe(4);
    const hint = svc.useHint(CHAT);
    if (hint.type !== 'ok') throw new Error(`expected ok, got ${hint.type}`);
    expect(maxGuessesFor(svc.activeGame(CHAT)!)).toBe(3);
  });
});
