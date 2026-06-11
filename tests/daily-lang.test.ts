import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { dailyShareText, topText } from '../src/bot/format.js';
import { getChatStats, openDb } from '../src/db.js';
import { getLanguage, looksLikeGuess } from '../src/engine/languages.js';
import { dailyAnswer, isValidWord, wordList } from '../src/engine/words.js';
import { GameService } from '../src/game/service.js';

const CHAT = -77;
const A = { id: 1, name: 'Alice' };
const B = { id: 2, name: 'Bob' };

let db: Database.Database;
let svc: GameService;

beforeEach(() => {
  db = openDb(':memory:');
  svc = new GameService(db);
});

describe('languages', () => {
  it('loads the Russian word list', () => {
    const { answers, valid } = wordList('ru');
    expect(answers.length).toBeGreaterThan(500);
    expect(valid.size).toBeGreaterThan(2000);
    for (const w of answers) expect(w).toMatch(/^[а-я]{5}$/);
  });

  it('normalizes ё to е and validates Cyrillic guesses', () => {
    expect(getLanguage('ru').normalize('Аё')).toBe('ае');
    expect(looksLikeGuess('доска')).toBe(true);
    expect(looksLikeGuess('доске?')).toBe(false);
    expect(looksLikeGuess('crane')).toBe(true);
    const ruWord = wordList('ru').answers[0];
    expect(isValidWord(ruWord, 'ru')).toBe(true);
    expect(isValidWord('crane', 'ru')).toBe(false);
  });

  it('plays a Russian game end to end', () => {
    const s = svc.settings(CHAT);
    s.language = 'ru';
    svc.saveSettings(CHAT, s);
    const game = svc.startGame(CHAT)!;
    expect(game.lang).toBe('ru');
    expect(game.answer).toMatch(/^[а-я]{5}$/);
    expect(svc.submitGuess(CHAT, A, 'crane').type).toBe('not_a_word');
    const r = svc.submitGuess(CHAT, A, game.answer);
    expect(r.type === 'accepted' && r.solved).toBe(true);
  });
});

describe('daily puzzle', () => {
  it('is deterministic per language and date', () => {
    expect(dailyAnswer('2026-06-11')).toBe(dailyAnswer('2026-06-11'));
    expect(dailyAnswer('2026-06-11')).not.toBe(dailyAnswer('2026-06-12'));
    expect(dailyAnswer('2026-06-11', 'ru')).toMatch(/^[а-я]{5}$/);
  });

  it('one per chat per day, with streak tracking', () => {
    const day1 = '2026-06-10';
    const day2 = '2026-06-11';

    const res = svc.startDaily(CHAT, day1);
    if (res === 'busy' || res === 'done') throw new Error('expected a fresh daily');
    expect(res.created).toBe(true);
    expect(res.game.answer).toBe(dailyAnswer(day1));

    // solving it records daily stats and finishes the day
    svc.submitGuess(CHAT, A, res.game.answer);
    expect(svc.startDaily(CHAT, day1)).toBe('done');
    expect(svc.statsFor(CHAT, A.id).daily_streak).toBe(1);

    // next day solved too → streak grows
    const res2 = svc.startDaily(CHAT, day2);
    if (res2 === 'busy' || res2 === 'done') throw new Error('expected a fresh daily');
    svc.submitGuess(CHAT, A, res2.game.answer);
    const stats = svc.statsFor(CHAT, A.id);
    expect(stats.daily_played).toBe(2);
    expect(stats.daily_streak).toBe(2);
    expect(stats.daily_best).toBe(2);
  });

  it('share grid has no letters in it', () => {
    const res = svc.startDaily(CHAT, '2026-06-11');
    if (res === 'busy' || res === 'done') throw new Error('expected a fresh daily');
    svc.submitGuess(CHAT, A, res.game.answer);
    const text = dailyShareText(svc.dailyGame(CHAT, '2026-06-11')!);
    expect(text).toContain('1/6');
    expect(text).toContain('🟩🟩🟩🟩🟩');
    expect(text.toLowerCase()).not.toContain(res.game.answer);
  });
});

describe('turn timeout forfeit', () => {
  it('skips the current player and resets the fail counter', () => {
    const t0 = svc.createTournament(CHAT, 1, A)!;
    svc.joinTournament(t0.id, B);
    svc.startTournament(t0.id);

    expect(svc.forfeitTurnByTimeout(-999)).toBeNull(); // no tournament there
    const res = svc.forfeitTurnByTimeout(CHAT)!;
    expect(res.skipped.userId).toBe(A.id);
    expect(res.nextPlayer.userId).toBe(B.id);
    // it is B's turn now
    expect(svc.submitGuess(CHAT, A, 'crane').type).toBe('not_your_turn');
    expect(svc.submitGuess(CHAT, B, 'crane').type).toBe('accepted');
  });
});

describe('leaderboard', () => {
  it('ranks players by winning guesses', () => {
    const g1 = svc.startGame(CHAT)!;
    svc.submitGuess(CHAT, B, 'crane' === g1.answer ? 'trace' : 'crane');
    svc.submitGuess(CHAT, A, g1.answer);
    const text = topText(getChatStats(db, CHAT));
    expect(text.indexOf('Alice')).toBeLessThan(text.indexOf('Bob'));
    expect(text).toContain('🥇 Alice');
  });
});
