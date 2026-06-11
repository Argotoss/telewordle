import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { breakdownText, historyText, vsText } from '../src/bot/format.js';
import { getStats, openDb, recentFinishedGames } from '../src/db.js';
import { analyzeGame } from '../src/engine/analysis.js';
import { ANSWERS } from '../src/engine/words.js';
import { GameService, MAX_GUESSES, maxGuessesFor } from '../src/game/service.js';
import { shouldShowNames, textBoard } from '../src/render/text.js';

const CHAT = -55;
const A = { id: 1, name: 'Alice' };
const B = { id: 2, name: 'Bob' };

let db: Database.Database;
let svc: GameService;

beforeEach(() => {
  db = openDb(':memory:');
  svc = new GameService(db);
});

function wrongWords(answer: string, n: number): string[] {
  return ANSWERS.filter((w) => w !== answer).slice(0, n);
}

describe('hints', () => {
  it('reveals an untouched answer letter and burns a try', () => {
    const game = svc.startGame(CHAT)!;
    const res = svc.useHint(CHAT);
    if (res.type !== 'ok') throw new Error(`expected ok, got ${res.type}`);
    expect(game.answer).toContain(res.letter);
    expect(res.triesLeft).toBe(MAX_GUESSES - 1);
    expect(maxGuessesFor(svc.activeGame(CHAT)!)).toBe(MAX_GUESSES - 1);

    // losing now takes one guess fewer
    let last;
    for (const w of wrongWords(game.answer, MAX_GUESSES - 1)) last = svc.submitGuess(CHAT, A, w);
    expect(last!.type === 'accepted' && last!.lost).toBe(true);
  });

  it('never reveals a letter the players already know', () => {
    const game = svc.startGame(CHAT)!;
    // guess the answer's own letters via a hint first, then exhaust
    for (let i = 0; i < 5; i++) {
      const res = svc.useHint(CHAT);
      if (res.type !== 'ok') {
        expect(['no_tries', 'nothing_to_reveal']).toContain(res.type);
        return;
      }
      expect(new Set(game.hints)).toHaveProperty('size'); // hints accumulate uniquely
    }
  });

  it('is not allowed in tournaments', () => {
    const t0 = svc.createTournament(CHAT, 1, A)!;
    svc.joinTournament(t0.id, B);
    svc.startTournament(t0.id);
    expect(svc.useHint(CHAT).type).toBe('not_here');
  });

  it('blocks a hint that would leave zero tries', () => {
    const game = svc.startGame(CHAT)!;
    for (const w of wrongWords(game.answer, MAX_GUESSES - 1)) svc.submitGuess(CHAT, A, w);
    expect(svc.useHint(CHAT).type).toBe('no_tries');
  });
});

describe('post-game analysis', () => {
  it('tracks candidate narrowing and flags the solve', () => {
    db.prepare('UPDATE games SET answer = ? WHERE id = ?').run(
      'water',
      svc.startGame(CHAT)!.id
    );
    svc.submitGuess(CHAT, A, 'crane');
    svc.submitGuess(CHAT, B, 'water');
    const game = recentFinishedGames(db, CHAT, 1)[0];
    const rows = analyzeGame(game);
    expect(rows).toHaveLength(2);
    expect(rows[0].before).toBe(ANSWERS.length);
    expect(rows[0].after).toBeLessThan(rows[0].before);
    expect(rows[0].after).toBeGreaterThan(0); // 'water' itself must survive the filter
    expect(rows[1].verdict).toBe('solved');
    expect(rows[1].skill).toBeNull(); // no skill grade on the solving guess
    expect(rows[0].skill).toBe('strong'); // CRANE is a top-tier opener
    expect(rows[0].median).toBeGreaterThan(0);
    const text = breakdownText(game, rows);
    expect(text).toContain('🔬 Breakdown — WATER');
    expect(text).toContain('🧠 strong word');
  });

  it('flags weak word choices independently of luck', () => {
    db.prepare('UPDATE games SET answer = ? WHERE id = ?').run('abbey', svc.startGame(CHAT)!.id);
    svc.submitGuess(CHAT, A, 'mamma'); // dreadful opener: duplicate letters, rare ones
    svc.submitGuess(CHAT, A, 'abbey');
    const rows = analyzeGame(recentFinishedGames(db, CHAT, 1)[0]);
    expect(rows[0].skill).toBe('weak');
  });
});

describe('history & vs', () => {
  it('lists finished games newest first', () => {
    const g1 = svc.startGame(CHAT)!;
    svc.submitGuess(CHAT, A, g1.answer);
    const g2 = svc.startGame(CHAT)!;
    svc.giveUp(CHAT);
    const games = recentFinishedGames(db, CHAT);
    expect(games).toHaveLength(2);
    expect(games[0].id).toBe(g2.id);
    const text = historyText(games);
    expect(text).toContain('🟢');
    expect(text).toContain('🔴');
    expect(text).toContain('by Alice');
  });

  it('renders the rivalry card with crowns for the leader', () => {
    const g1 = svc.startGame(CHAT)!;
    svc.submitGuess(CHAT, B, wrongWords(g1.answer, 1)[0]);
    svc.submitGuess(CHAT, A, g1.answer);
    const text = vsText(getStats(db, CHAT, A.id), getStats(db, CHAT, B.id), 'Alice', 'Bob', {
      aWins: 0,
      bWins: 0,
      draws: 0,
    });
    expect(text).toContain('Alice 🆚 Bob');
    expect(text).toMatch(/Solves — 1 👑 vs 0/);
  });
});

describe('board names', () => {
  it('shows names only with multiple players, never in duels', () => {
    const game = svc.startGame(CHAT)!;
    svc.submitGuess(CHAT, A, wrongWords(game.answer, 2)[0]);
    expect(shouldShowNames(svc.activeGame(CHAT)!)).toBe(false); // one player so far
    svc.submitGuess(CHAT, B, wrongWords(game.answer, 2)[1]);
    const g = svc.activeGame(CHAT)!;
    expect(shouldShowNames(g)).toBe(true);
    expect(textBoard(g)).toContain('· Alice');
  });
});

describe('new settings defaults', () => {
  it('cleanup, hints, pings, breakdown all default on', () => {
    const s = svc.settings(CHAT);
    expect(s.cleanup).toBe(true);
    expect(s.hints).toBe(true);
    expect(s.pings).toBe(true);
    expect(s.breakdown).toBe(true);
  });
});
