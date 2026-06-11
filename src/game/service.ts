import type Database from 'better-sqlite3';
import {
  ChatSettings,
  DuelPlayerResult,
  DuelRow,
  GameRow,
  GuessEntry,
  TournamentPlayer,
  TournamentRow,
  bumpStats,
  getStats,
  createDuel,
  createGame,
  createTournament,
  getActiveGame,
  getDuel,
  getOpenTournament,
  getSettings,
  getTournament,
  recentWords,
  recordUsedWord,
  saveSettings,
  updateDuel,
  updateGame,
  updateTournament,
} from '../db.js';
import { hardModeViolation, type HardModeViolation } from '../engine/hardmode.js';
import { scoreGuess, TileStatus } from '../engine/score.js';
import { isValidWord, pickAnswer } from '../engine/words.js';

export const MAX_GUESSES = 6;

export interface UserRef {
  id: number;
  name: string;
  username?: string;
  firstName?: string;
}

/** Turn order for a given 1-based round: players rotated left by (round - 1). */
export function roundOrder(players: TournamentPlayer[], round: number): TournamentPlayer[] {
  const k = (round - 1) % players.length;
  return [...players.slice(k), ...players.slice(0, k)];
}

export function pointsForGuessNumber(n: number): number {
  return MAX_GUESSES + 1 - n; // guess #1 → 6 pts … guess #6 → 1 pt
}

export type GuessOutcome =
  | { type: 'no_game' }
  | { type: 'not_a_word'; word: string }
  | { type: 'creativity_blocked'; word: string }
  | { type: 'hard_mode_violation'; word: string; violation: HardModeViolation; superHard: boolean }
  | { type: 'already_guessed'; word: string }
  | { type: 'not_your_turn'; currentPlayer: TournamentPlayer }
  | {
      type: 'accepted';
      game: GameRow;
      score: TileStatus[];
      guessNumber: number;
      solved: boolean;
      lost: boolean;
      tournament?: {
        t: TournamentRow;
        pointsAwarded: number;
        roundEnded: boolean;
        tournamentEnded: boolean;
        nextGame: GameRow | null;
        nextPlayer: TournamentPlayer | null;
        winners: TournamentPlayer[];
      };
      duel?: { d: DuelRow; finished: boolean; bothDone: boolean };
    };

export class GameService {
  constructor(private db: Database.Database) {}

  settings(chatId: number): ChatSettings {
    return getSettings(this.db, chatId);
  }

  saveSettings(chatId: number, s: ChatSettings): void {
    saveSettings(this.db, chatId, s);
  }

  activeGame(chatId: number): GameRow | null {
    return getActiveGame(this.db, chatId);
  }

  openTournament(chatId: number): TournamentRow | null {
    return getOpenTournament(this.db, chatId);
  }

  /** Start a regular game. Returns null if a game is already running. */
  startGame(chatId: number): GameRow | null {
    if (getActiveGame(this.db, chatId)) return null;
    const s = getSettings(this.db, chatId);
    const answer = pickAnswer(recentWords(this.db, chatId, s.creativity));
    return createGame(this.db, chatId, answer, 'normal');
  }

  /** Abort the current game (and tournament, if any). Returns the revealed answer or null. */
  giveUp(chatId: number): { answer: string; tournamentCancelled: boolean } | null {
    const game = getActiveGame(this.db, chatId);
    if (!game) return null;
    game.status = 'lost';
    game.finished_at = Date.now();
    updateGame(this.db, game);
    recordUsedWord(this.db, chatId, game.answer);
    let tournamentCancelled = false;
    if (game.tournament_id) {
      const t = getTournament(this.db, game.tournament_id);
      if (t && (t.status === 'active' || t.status === 'joining')) {
        t.status = 'cancelled';
        updateTournament(this.db, t);
        tournamentCancelled = true;
      }
    }
    return { answer: game.answer, tournamentCancelled };
  }

  submitGuess(chatId: number, user: UserRef, rawWord: string): GuessOutcome {
    const word = rawWord.trim().toLowerCase();
    const game = getActiveGame(this.db, chatId);
    if (!game) return { type: 'no_game' };

    // Tournament turn enforcement happens before word validation so out-of-turn
    // players do not learn anything from dictionary or rule checks.
    let tournament: TournamentRow | null = null;
    if (game.kind === 'tournament' && game.tournament_id) {
      tournament = getTournament(this.db, game.tournament_id);
      if (tournament && tournament.status === 'active') {
        const order = roundOrder(tournament.players, tournament.current_round);
        const current = order[tournament.turn_idx % order.length];
        if (current.userId !== user.id) return { type: 'not_your_turn', currentPlayer: current };
      }
    }

    if (!isValidWord(word)) return { type: 'not_a_word', word };
    if (game.guesses.some((g) => g.word === word)) return { type: 'already_guessed', word };

    const settings = getSettings(this.db, chatId);
    const isDuel = game.kind === 'duel';

    // creativity mode (not for duels — both duelists must face the same word fairly)
    if (!isDuel && word !== game.answer && recentWords(this.db, chatId, settings.creativity).has(word)) {
      return { type: 'creativity_blocked', word };
    }

    // hard / super hard mode: all revealed hints must be used
    if (settings.difficulty !== 'normal') {
      const superHard = settings.difficulty === 'superhard';
      const violation = hardModeViolation(game.answer, game.guesses.map((g) => g.word), word, superHard);
      if (violation) return { type: 'hard_mode_violation', word, violation, superHard };
    }

    // accept the guess
    const entry: GuessEntry = { word, userId: user.id, userName: user.name, ts: Date.now() };
    game.guesses.push(entry);
    const score = scoreGuess(game.answer, word);
    const guessNumber = game.guesses.length;
    const solved = word === game.answer;
    const lost = !solved && guessNumber >= MAX_GUESSES;

    if (solved) game.status = 'solved';
    if (lost) game.status = 'lost';
    if (solved || lost) game.finished_at = Date.now();
    updateGame(this.db, game);

    if (!isDuel) {
      recordUsedWord(this.db, chatId, word);
      if (lost) recordUsedWord(this.db, chatId, game.answer); // revealed answer is burned too
    }

    const outcome: GuessOutcome = { type: 'accepted', game, score, guessNumber, solved, lost };

    if (isDuel) {
      outcome.duel = this.applyDuelProgress(game, user, solved, lost, guessNumber);
    } else {
      this.applyGuessStats(chatId, user, score);
      if (solved || lost) this.applyGameEndStats(chatId, game, solved, guessNumber);
      if (tournament && tournament.status === 'active') {
        outcome.tournament = this.advanceTournament(tournament, user, solved, lost, guessNumber);
      }
    }
    return outcome;
  }

  // ---------- tournaments ----------

  createTournament(chatId: number, rounds: number, creator: UserRef): TournamentRow | null {
    if (getOpenTournament(this.db, chatId) || getActiveGame(this.db, chatId)) return null;
    const t = createTournament(this.db, chatId, rounds, creator.id);
    t.players = [{ userId: creator.id, userName: creator.name, username: creator.username, firstName: creator.firstName ?? creator.name }];
    updateTournament(this.db, t);
    return getTournament(this.db, t.id);
  }

  joinTournament(tournamentId: number, user: UserRef): TournamentRow | 'closed' | 'already_in' | null {
    const t = getTournament(this.db, tournamentId);
    if (!t) return null;
    if (t.status !== 'joining') return 'closed';
    if (t.players.some((p) => p.userId === user.id)) return 'already_in';
    t.players.push({ userId: user.id, userName: user.name, username: user.username, firstName: user.firstName ?? user.name });
    updateTournament(this.db, t);
    return getTournament(this.db, t.id);
  }

  quitTournament(tournamentId: number, userId: number): TournamentRow | 'closed' | 'not_in' | null {
    const t = getTournament(this.db, tournamentId);
    if (!t) return null;
    if (t.status !== 'joining') return 'closed';
    if (!t.players.some((p) => p.userId === userId)) return 'not_in';
    t.players = t.players.filter((p) => p.userId !== userId);
    updateTournament(this.db, t);
    return getTournament(this.db, t.id);
  }

  /** Start the tournament: first round game is created. */
  startTournament(tournamentId: number): { t: TournamentRow; game: GameRow; firstPlayer: TournamentPlayer } | 'too_few' | null {
    const t = getTournament(this.db, tournamentId);
    if (!t || t.status !== 'joining') return null;
    if (t.players.length < 1) return 'too_few';
    if (t.rounds < 1) t.rounds = t.players.length;
    t.status = 'active';
    t.current_round = 1;
    t.turn_idx = 0;
    for (const p of t.players) t.scores[String(p.userId)] = 0;
    updateTournament(this.db, t);
    const game = this.newTournamentGame(t);
    return { t: getTournament(this.db, t.id)!, game, firstPlayer: roundOrder(t.players, 1)[0] };
  }

  cancelTournament(chatId: number, userId: number): TournamentRow | 'not_allowed' | null {
    const t = getOpenTournament(this.db, chatId);
    if (!t) return null;
    if (t.created_by !== userId) return 'not_allowed';
    t.status = 'cancelled';
    updateTournament(this.db, t);
    const game = getActiveGame(this.db, chatId);
    if (game && game.tournament_id === t.id) {
      game.status = 'lost';
      game.finished_at = Date.now();
      updateGame(this.db, game);
      recordUsedWord(this.db, chatId, game.answer);
    }
    return t;
  }

  private newTournamentGame(t: TournamentRow): GameRow {
    const s = getSettings(this.db, t.chat_id);
    const answer = pickAnswer(recentWords(this.db, t.chat_id, s.creativity));
    return createGame(this.db, t.chat_id, answer, 'tournament', { tournamentId: t.id });
  }

  private advanceTournament(
    t: TournamentRow,
    user: UserRef,
    solved: boolean,
    lost: boolean,
    guessNumber: number
  ): NonNullable<Extract<GuessOutcome, { type: 'accepted' }>['tournament']> {
    let pointsAwarded = 0;
    const roundEnded = solved || lost;
    let tournamentEnded = false;
    let nextGame: GameRow | null = null;
    let nextPlayer: TournamentPlayer | null = null;
    let winners: TournamentPlayer[] = [];

    if (solved) {
      pointsAwarded = pointsForGuessNumber(guessNumber);
      t.scores[String(user.id)] = (t.scores[String(user.id)] ?? 0) + pointsAwarded;
    }

    if (roundEnded) {
      if (t.current_round >= t.rounds) {
        t.status = 'done';
        tournamentEnded = true;
        winners = this.tournamentWinners(t);
        updateTournament(this.db, t);
        this.applyTournamentStats(t, winners);
      } else {
        t.current_round += 1;
        t.turn_idx = 0;
        updateTournament(this.db, t);
        nextGame = this.newTournamentGame(t);
        nextPlayer = roundOrder(t.players, t.current_round)[0];
      }
    } else {
      t.turn_idx = (t.turn_idx + 1) % t.players.length;
      updateTournament(this.db, t);
      nextPlayer = roundOrder(t.players, t.current_round)[t.turn_idx];
    }
    return { t, pointsAwarded, roundEnded, tournamentEnded, nextGame, nextPlayer, winners };
  }

  tournamentWinners(t: TournamentRow): TournamentPlayer[] {
    const max = Math.max(...t.players.map((p) => t.scores[String(p.userId)] ?? 0));
    return t.players.filter((p) => (t.scores[String(p.userId)] ?? 0) === max);
  }

  private applyTournamentStats(t: TournamentRow, winners: TournamentPlayer[]): void {
    for (const p of t.players) {
      bumpStats(this.db, t.chat_id, p.userId, p.userName, {
        tournaments_played: 1,
        tournaments_won: winners.some((w) => w.userId === p.userId) ? 1 : 0,
        tournament_points: t.scores[String(p.userId)] ?? 0,
      });
    }
  }

  // ---------- duels ----------

  /** Create a duel; challenger plays in their private chat once they press Play. */
  createDuel(chatId: number, challenger: UserRef): DuelRow {
    const s = getSettings(this.db, chatId);
    const answer = pickAnswer(recentWords(this.db, chatId, s.creativity));
    return createDuel(this.db, chatId, answer, {
      userId: challenger.id,
      userName: challenger.name,
      guesses: null,
      solved: false,
      ms: null,
    });
  }

  getDuel(id: number): DuelRow | null {
    return getDuel(this.db, id);
  }

  /**
   * A player opens the duel deep link in their private chat: create their private game.
   * Returns the game, or a string describing why not.
   */
  acceptDuel(duelId: number, privateChatId: number, user: UserRef): { d: DuelRow; game: GameRow } | 'not_found' | 'full' | 'already_playing' | 'own_game_running' {
    const d = getDuel(this.db, duelId);
    if (!d || d.status === 'cancelled' || d.status === 'done') return 'not_found';
    const isChallenger = d.challenger.userId === user.id;
    if (!isChallenger && d.opponent && d.opponent.userId !== user.id) return 'full';
    if (getActiveGame(this.db, privateChatId)) return 'own_game_running';

    if (isChallenger) {
      if (d.challenger.guesses !== null) return 'already_playing';
    } else if (d.opponent) {
      if (d.opponent.guesses !== null) return 'already_playing';
    } else {
      d.opponent = { userId: user.id, userName: user.name, guesses: null, solved: false, ms: null };
      d.status = 'active';
      updateDuel(this.db, d);
    }
    const game = createGame(this.db, privateChatId, d.answer, 'duel', { duelId: d.id });
    return { d: getDuel(this.db, duelId)!, game };
  }

  private applyDuelProgress(
    game: GameRow,
    user: UserRef,
    solved: boolean,
    lost: boolean,
    guessNumber: number
  ): { d: DuelRow; finished: boolean; bothDone: boolean } {
    const d = getDuel(this.db, game.duel_id!)!;
    const finished = solved || lost;
    if (finished) {
      const result: DuelPlayerResult = {
        userId: user.id,
        userName: user.name,
        guesses: guessNumber,
        solved,
        ms: Date.now() - game.started_at,
      };
      if (d.challenger.userId === user.id) d.challenger = result;
      else d.opponent = result;
      const bothDone =
        d.challenger.guesses !== null && d.opponent !== null && d.opponent.guesses !== null;
      if (bothDone) {
        d.status = 'done';
        this.applyDuelStats(d);
      }
      updateDuel(this.db, d);
      return { d, finished, bothDone };
    }
    return { d, finished: false, bothDone: false };
  }

  /** Lower guess count wins (must have solved); tie on guesses → faster time wins; full tie → draw. */
  duelWinner(d: DuelRow): DuelPlayerResult | 'draw' | null {
    if (!d.opponent || d.challenger.guesses === null || d.opponent.guesses === null) return null;
    const a = d.challenger;
    const b = d.opponent;
    if (a.solved && !b.solved) return a;
    if (b.solved && !a.solved) return b;
    if (!a.solved && !b.solved) return 'draw';
    if (a.guesses! !== b.guesses!) return a.guesses! < b.guesses! ? a : b;
    if (a.ms! !== b.ms!) return a.ms! < b.ms! ? a : b;
    return 'draw';
  }

  private applyDuelStats(d: DuelRow): void {
    const winner = this.duelWinner(d);
    for (const p of [d.challenger, d.opponent!]) {
      bumpStats(this.db, d.chat_id, p.userId, p.userName, {
        duels_played: 1,
        duels_won: winner !== 'draw' && winner?.userId === p.userId ? 1 : 0,
      });
    }
  }

  // ---------- stats ----------

  private applyGuessStats(chatId: number, user: UserRef, score: TileStatus[]): void {
    bumpStats(this.db, chatId, user.id, user.name, {
      guesses_total: 1,
      greens: score.filter((s) => s === 'correct').length,
      yellows: score.filter((s) => s === 'present').length,
    });
  }

  private applyGameEndStats(chatId: number, game: GameRow, solved: boolean, guessNumber: number): void {
    const participants = new Map<number, string>();
    for (const g of game.guesses) participants.set(g.userId, g.userName);
    const solver = solved ? game.guesses[game.guesses.length - 1] : null;

    for (const [userId, name] of participants) {
      const prev = this.statsFor(chatId, userId).current_streak;
      bumpStats(
        this.db,
        chatId,
        userId,
        name,
        { games_played: 1, games_won: solved ? 1 : 0 },
        { setCurrentStreak: solved ? prev + 1 : 0 }
      );
    }
    if (solver) {
      const distKey = `dist${guessNumber}` as 'dist1';
      bumpStats(
        this.db,
        chatId,
        solver.userId,
        solver.userName,
        { solves: 1, [distKey]: 1 },
        { fastestMs: (game.finished_at ?? Date.now()) - game.started_at }
      );
    }
  }

  statsFor(chatId: number, userId: number) {
    return getStats(this.db, chatId, userId);
  }
}
