import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { ANSWERS, isValidWord } from '../src/engine/words.js';
import { GameService, MAX_GUESSES, pointsForGuessNumber, roundOrder } from '../src/game/service.js';

const CHAT = -100500;
const A = { id: 1, name: 'Alice' };
const B = { id: 2, name: 'Bob' };
const C = { id: 3, name: 'Cara' };

let db: Database.Database;
let svc: GameService;

beforeEach(() => {
  db = openDb(':memory:');
  svc = new GameService(db);
});

function forceAnswer(gameId: number, answer: string): void {
  db.prepare('UPDATE games SET answer = ? WHERE id = ?').run(answer, gameId);
}

function wrongWords(answer: string, n: number): string[] {
  return ANSWERS.filter((w) => w !== answer).slice(0, n);
}

describe('basic game flow', () => {
  it('start, guess, solve — with stats', () => {
    const game = svc.startGame(CHAT)!;
    expect(game).toBeTruthy();
    expect(svc.startGame(CHAT)).toBeNull(); // only one active game

    const [w1] = wrongWords(game.answer, 1);
    const r1 = svc.submitGuess(CHAT, A, w1);
    expect(r1.type).toBe('accepted');
    if (r1.type === 'accepted') expect(r1.guessNumber).toBe(1);

    const r2 = svc.submitGuess(CHAT, B, game.answer);
    expect(r2.type === 'accepted' && r2.solved).toBe(true);

    const sa = svc.statsFor(CHAT, A.id);
    const sb = svc.statsFor(CHAT, B.id);
    expect(sa.games_played).toBe(1);
    expect(sa.games_won).toBe(1);
    expect(sa.solves).toBe(0);
    expect(sa.current_streak).toBe(1);
    expect(sb.solves).toBe(1);
    expect(sb.dist2).toBe(1);
    expect(sb.guesses_total).toBe(1);
    expect(sb.greens).toBe(5);
  });

  it('rejects bad input', () => {
    expect(svc.submitGuess(CHAT, A, 'crane').type).toBe('no_game');
    const game = svc.startGame(CHAT)!;
    expect(svc.submitGuess(CHAT, A, 'zzzzz').type).toBe('not_a_word');
    const [w1] = wrongWords(game.answer, 1);
    svc.submitGuess(CHAT, A, w1);
    expect(svc.submitGuess(CHAT, B, w1).type).toBe('already_guessed');
  });

  it('loses after 6 wrong guesses and resets streak', () => {
    const game = svc.startGame(CHAT)!;
    const words = wrongWords(game.answer, MAX_GUESSES);
    let last;
    for (const w of words) last = svc.submitGuess(CHAT, A, w);
    expect(last!.type === 'accepted' && last!.lost).toBe(true);
    expect(svc.activeGame(CHAT)).toBeNull();
    const s = svc.statsFor(CHAT, A.id);
    expect(s.games_played).toBe(1);
    expect(s.games_won).toBe(0);
    expect(s.current_streak).toBe(0);
  });

  it('giveup reveals the answer', () => {
    expect(svc.giveUp(CHAT)).toBeNull();
    const game = svc.startGame(CHAT)!;
    const res = svc.giveUp(CHAT);
    expect(res?.answer).toBe(game.answer);
    expect(svc.activeGame(CHAT)).toBeNull();
  });
});

describe('creativity mode', () => {
  it('blocks recently used words (time mode, default on)', () => {
    const g1 = svc.startGame(CHAT)!;
    const [w1] = wrongWords(g1.answer, 1);
    svc.submitGuess(CHAT, A, w1);
    svc.giveUp(CHAT);

    svc.startGame(CHAT);
    expect(svc.submitGuess(CHAT, A, w1).type).toBe('creativity_blocked');

    const s = svc.settings(CHAT);
    s.creativity.enabled = false;
    svc.saveSettings(CHAT, s);
    expect(svc.submitGuess(CHAT, A, w1).type).toBe('accepted');
  });

  it('count mode only bans the last N words', () => {
    const s = svc.settings(CHAT);
    s.creativity.mode = 'count';
    s.creativity.count = 1;
    svc.saveSettings(CHAT, s);

    const g1 = svc.startGame(CHAT)!;
    const [w1, w2] = wrongWords(g1.answer, 2);
    svc.submitGuess(CHAT, A, w1);
    svc.submitGuess(CHAT, A, w2);
    svc.giveUp(CHAT); // burns the answer too (now the only banned word)

    const g2 = svc.startGame(CHAT)!;
    if (w1 !== g2.answer) {
      expect(svc.submitGuess(CHAT, A, w1).type).toBe('accepted');
    }
  });

  it('never picks a recently used answer', () => {
    const g1 = svc.startGame(CHAT)!;
    svc.giveUp(CHAT); // records g1.answer as used
    for (let i = 0; i < 25; i++) {
      const g = svc.startGame(CHAT)!;
      expect(g.answer).not.toBe(g1.answer);
      svc.giveUp(CHAT);
    }
  });
});

describe('hard & super hard mode', () => {
  it('hard mode rejects guesses that ignore hints', () => {
    const s = svc.settings(CHAT);
    s.difficulty = 'hard';
    svc.saveSettings(CHAT, s);

    const game = svc.startGame(CHAT)!;
    forceAnswer(game.id, 'water');
    svc.submitGuess(CHAT, A, 'trace'); // t,r,a,e yellow
    const r = svc.submitGuess(CHAT, A, 'spill');
    expect(r.type).toBe('hard_mode_violation');
    expect(svc.submitGuess(CHAT, A, 'eater').type).toBe('accepted');
  });

  it('super hard mode also bans gray letters', () => {
    const s = svc.settings(CHAT);
    s.difficulty = 'superhard';
    s.creativity.enabled = false;
    svc.saveSettings(CHAT, s);

    const game = svc.startGame(CHAT)!;
    forceAnswer(game.id, 'water');
    svc.submitGuess(CHAT, A, 'crane'); // c, n gray; r,a,e yellow
    const r = svc.submitGuess(CHAT, A, 'racer'); // has r,a,e but replays gray c
    expect(r.type).toBe('hard_mode_violation');
    if (r.type === 'hard_mode_violation') expect(r.superHard).toBe(true);
    expect(svc.submitGuess(CHAT, A, 'water').type).toBe('accepted');
  });
});

describe('tournaments', () => {
  it('rotation and points helpers', () => {
    const players = [A, B, C].map((u) => ({ userId: u.id, userName: u.name }));
    expect(roundOrder(players, 1).map((p) => p.userId)).toEqual([1, 2, 3]);
    expect(roundOrder(players, 2).map((p) => p.userId)).toEqual([2, 3, 1]);
    expect(roundOrder(players, 3).map((p) => p.userId)).toEqual([3, 1, 2]);
    expect(roundOrder(players, 4).map((p) => p.userId)).toEqual([1, 2, 3]);
    expect(pointsForGuessNumber(1)).toBe(6);
    expect(pointsForGuessNumber(6)).toBe(1);
  });

  it('full 2-round tournament with turn enforcement and scoring', () => {
    const t0 = svc.createTournament(CHAT, 2, A)!;
    expect(t0.players).toHaveLength(1);
    expect(svc.joinTournament(t0.id, B)).not.toBe('already_in');
    expect(svc.joinTournament(t0.id, B)).toBe('already_in');

    const started = svc.startTournament(t0.id);
    expect(started).not.toBe('too_few');
    const { game } = started as Exclude<typeof started, 'too_few' | null>;
    forceAnswer(game.id, 'water');

    // round 1, order A → B
    expect(svc.submitGuess(CHAT, B, 'crane').type).toBe('not_your_turn');
    expect(svc.submitGuess(CHAT, A, 'crane').type).toBe('accepted');
    expect(svc.submitGuess(CHAT, A, 'trace').type).toBe('not_your_turn');

    const solve1 = svc.submitGuess(CHAT, B, 'water');
    expect(solve1.type).toBe('accepted');
    if (solve1.type !== 'accepted' || !solve1.tournament) throw new Error('expected tournament outcome');
    expect(solve1.tournament.pointsAwarded).toBe(5); // solved on guess #2
    expect(solve1.tournament.roundEnded).toBe(true);
    expect(solve1.tournament.tournamentEnded).toBe(false);
    expect(solve1.tournament.nextPlayer?.userId).toBe(B.id); // round 2 order rotates to B → A

    // round 2: B goes first and nails it on guess #1
    const game2 = solve1.tournament.nextGame!;
    forceAnswer(game2.id, 'abbey');
    const solve2 = svc.submitGuess(CHAT, B, 'abbey');
    if (solve2.type !== 'accepted' || !solve2.tournament) throw new Error('expected tournament outcome');
    expect(solve2.tournament.pointsAwarded).toBe(6);
    expect(solve2.tournament.tournamentEnded).toBe(true);
    expect(solve2.tournament.winners.map((w) => w.userId)).toEqual([B.id]);
    expect(solve2.tournament.t.scores[String(B.id)]).toBe(11);

    const sb = svc.statsFor(CHAT, B.id);
    expect(sb.tournaments_played).toBe(1);
    expect(sb.tournaments_won).toBe(1);
    expect(sb.tournament_points).toBe(11);
    expect(svc.statsFor(CHAT, A.id).tournaments_won).toBe(0);
  });

  it('forfeits the turn after too many failed attempts (default 5, configurable)', () => {
    expect(svc.settings(CHAT).maxFails).toBe(5);
    const s = svc.settings(CHAT);
    s.maxFails = 2;
    svc.saveSettings(CHAT, s);

    const t0 = svc.createTournament(CHAT, 1, A)!;
    svc.joinTournament(t0.id, B);
    const started = svc.startTournament(t0.id) as Exclude<ReturnType<typeof svc.startTournament>, 'too_few' | null>;
    forceAnswer(started.game.id, 'water');

    // out-of-turn rejections do NOT count as fails for anyone
    expect(svc.submitGuess(CHAT, B, 'zzzzz').type).toBe('not_your_turn');

    // A (at turn) spams nonsense
    const f1 = svc.submitGuess(CHAT, A, 'zzzzz');
    if (f1.type !== 'not_a_word') throw new Error('expected not_a_word');
    expect(f1.failInfo).toEqual({ count: 1, max: 2, forfeited: false, nextPlayer: null });

    const f2 = svc.submitGuess(CHAT, A, 'qqqqq');
    if (f2.type !== 'not_a_word') throw new Error('expected not_a_word');
    expect(f2.failInfo?.forfeited).toBe(true);
    expect(f2.failInfo?.nextPlayer?.userId).toBe(B.id);

    // turn has passed to B
    expect(svc.submitGuess(CHAT, A, 'crane').type).toBe('not_your_turn');
    expect(svc.submitGuess(CHAT, B, 'crane').type).toBe('accepted');

    // fail counter is fresh for the next turn (A again)
    const f3 = svc.submitGuess(CHAT, A, 'jjjjj');
    if (f3.type !== 'not_a_word') throw new Error('expected not_a_word');
    expect(f3.failInfo?.count).toBe(1);
  });

  it('maxFails 0 means unlimited', () => {
    const s = svc.settings(CHAT);
    s.maxFails = 0;
    svc.saveSettings(CHAT, s);
    const t0 = svc.createTournament(CHAT, 1, A)!;
    svc.joinTournament(t0.id, B);
    const started = svc.startTournament(t0.id) as Exclude<ReturnType<typeof svc.startTournament>, 'too_few' | null>;
    forceAnswer(started.game.id, 'water');
    for (let i = 0; i < 10; i++) {
      const r = svc.submitGuess(CHAT, A, 'zzzzz');
      if (r.type !== 'not_a_word') throw new Error('expected not_a_word');
      expect(r.failInfo).toBeUndefined();
    }
    expect(svc.submitGuess(CHAT, A, 'crane').type).toBe('accepted');
  });

  it('players can quit a lobby before it starts', () => {
    const t0 = svc.createTournament(CHAT, 2, A)!;
    svc.joinTournament(t0.id, B);
    svc.joinTournament(t0.id, C);

    expect(svc.quitTournament(t0.id, B.id)).not.toBe('not_in');
    expect(svc.quitTournament(t0.id, B.id)).toBe('not_in');
    const t = svc.openTournament(CHAT)!;
    expect(t.players.map((p) => p.userId)).toEqual([A.id, C.id]);

    const started = svc.startTournament(t0.id);
    expect(started).not.toBe('too_few'); // still 2 players left
    expect(svc.quitTournament(t0.id, C.id)).toBe('closed'); // no quitting mid-game
  });

  it('cancel: only the creator can', () => {
    const t = svc.createTournament(CHAT, 3, A)!;
    expect(svc.cancelTournament(CHAT, B.id)).toBe('not_allowed');
    const res = svc.cancelTournament(CHAT, A.id);
    expect(res).not.toBe('not_allowed');
    expect(svc.openTournament(CHAT)).toBeNull();
    expect(t.id).toBeTruthy();
  });
});

describe('duels', () => {
  it('full duel: fewer guesses wins, group stats recorded', () => {
    const GROUP = -200;
    const d0 = svc.createDuel(GROUP, A);
    db.prepare('UPDATE duels SET answer = ? WHERE id = ?').run('water', d0.id);

    const accA = svc.acceptDuel(d0.id, 100, A);
    expect(accA).not.toBe('not_found');
    const accB = svc.acceptDuel(d0.id, 200, B);
    expect(accB).not.toBe('full');
    expect(svc.acceptDuel(d0.id, 300, C)).toBe('full');

    // Alice solves in 2
    svc.submitGuess(100, A, 'crane');
    const ra = svc.submitGuess(100, A, 'water');
    if (ra.type !== 'accepted' || !ra.duel) throw new Error('expected duel outcome');
    expect(ra.duel.finished).toBe(true);
    expect(ra.duel.bothDone).toBe(false);

    // Bob fails all 6
    let rb;
    for (const w of wrongWords('water', MAX_GUESSES)) rb = svc.submitGuess(200, B, w);
    if (rb!.type !== 'accepted' || !rb!.duel) throw new Error('expected duel outcome');
    expect(rb!.duel.bothDone).toBe(true);

    const d = svc.getDuel(d0.id)!;
    expect(d.status).toBe('done');
    const winner = svc.duelWinner(d);
    expect(winner !== 'draw' && winner?.userId).toBe(A.id);

    expect(svc.statsFor(GROUP, A.id).duels_won).toBe(1);
    expect(svc.statsFor(GROUP, B.id).duels_played).toBe(1);
    expect(svc.statsFor(GROUP, B.id).duels_won).toBe(0);
  });
});

describe('word list sanity', () => {
  it('has the expected shape', () => {
    expect(ANSWERS.length).toBeGreaterThan(2000);
    for (const w of ['water', 'crane', 'trace', 'abbey', 'eater', 'racer']) {
      expect(isValidWord(w)).toBe(true);
    }
    expect(isValidWord('zzzzz')).toBe(false);
  });
});
