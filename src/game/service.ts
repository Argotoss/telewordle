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
import { getLanguage } from '../engine/languages.js';
import { scoreGuess, TileStatus } from '../engine/score.js';
import { fetchOfficialWordle } from '../engine/official-wordle.js';
import { DEFAULT_WORD_LENGTH, availableLengths, dailyAnswer, isValidWord, pickAnswer } from '../engine/words.js';
import { getDailyGame, recordDailyResult } from '../db.js';

export const MAX_GUESSES = 6;

// Backstop auto-expiry. The primary unblock flow is the "disband & start new"
// button anyone can press; these only sweep up things nobody ever came back for.
export const LOBBY_IDLE_MS = 3 * 60 * 60_000; // lobby with no joins/start
export const TOURNAMENT_IDLE_MS = 3 * 60 * 60_000; // active tournament with no human guess
export const GAME_IDLE_MS = 24 * 60 * 60_000; // regular game with no guesses

export const MAX_TRIES = 12;

/** Effective try limit for a game: its frozen budget minus hints burned. */
export function maxGuessesFor(game: GameRow): number {
  return (game.max_guesses ?? MAX_GUESSES) - (game.hints?.length ?? 0);
}

/** Try budget for a word length: the per-length override, or length + 1. */
export function effectiveTries(s: ChatSettings, length: number): number {
  const tries = s.triesByLength[String(length)] ?? length + 1;
  return Math.max(1, Math.min(MAX_TRIES, tries));
}

/** The chat's configured length, snapped to what the language actually offers. */
export function effectiveLength(s: ChatSettings): number {
  const lengths = availableLengths(s.language);
  return lengths.includes(s.wordLength) ? s.wordLength : DEFAULT_WORD_LENGTH;
}

export interface UserRef {
  id: number;
  name: string;
}

/** Turn order for a given 1-based round: players rotated left by (round - 1). */
export function roundOrder(players: TournamentPlayer[], round: number): TournamentPlayer[] {
  const k = (round - 1) % players.length;
  return [...players.slice(k), ...players.slice(0, k)];
}

export function pointsForGuessNumber(n: number, maxGuesses: number = MAX_GUESSES): number {
  return maxGuesses + 1 - n; // guess #1 earns the most, the final try earns 1
}

/**
 * Anti-spam fail tracking for rejected guesses.
 * Tournaments: counts per turn; hitting the limit forfeits the turn.
 * Normal group games: counts per player per game; hitting the limit locks that player out.
 */
export interface FailInfo {
  count: number;
  max: number;
  forfeited: boolean;
  lockedOut: boolean;
  nextPlayer: TournamentPlayer | null;
}

export type HintOutcome =
  | { type: 'ok'; letter: string; triesLeft: number; game: GameRow }
  | { type: 'no_game' }
  | { type: 'not_here' }
  | { type: 'no_tries' }
  | { type: 'nothing_to_reveal' };

export type GuessOutcome =
  | { type: 'no_game' }
  | { type: 'not_a_word'; word: string; failInfo?: FailInfo }
  | { type: 'wrong_length'; word: string; expected: number; failInfo?: FailInfo }
  | { type: 'creativity_blocked'; word: string; failInfo?: FailInfo }
  | { type: 'hard_mode_violation'; word: string; violation: HardModeViolation; superHard: boolean; failInfo?: FailInfo }
  | { type: 'already_guessed'; word: string; failInfo?: FailInfo }
  | { type: 'locked_out'; max: number }
  | { type: 'not_your_turn'; currentPlayer: TournamentPlayer }
  /** a non-participant typed a word during a tournament — stay silent, don't spam */
  | { type: 'ignored' }
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
    const length = effectiveLength(s);
    const answer = pickAnswer(recentWords(this.db, chatId, s.creativity), s.language, length);
    return createGame(this.db, chatId, answer, 'normal', { lang: s.language, maxGuesses: effectiveTries(s, length) });
  }

  /**
   * Start (or fetch) today's daily puzzle. The word is deterministic per
   * language per date — every chat gets the same one.
   */
  async startDaily(chatId: number, dateStr: string): Promise<{ game: GameRow; created: boolean } | 'busy' | 'done'> {
    const existing = getDailyGame(this.db, chatId, dateStr);
    if (existing) return existing.status === 'active' ? { game: existing, created: false } : 'done';
    if (getActiveGame(this.db, chatId)) return 'busy';
    const s = getSettings(this.db, chatId);
    // The daily is sacred: always 5 letters and 6 tries, and for English it is
    // THE official Wordle word of the day (deterministic pick as offline fallback).
    const official = s.language === 'en' ? await fetchOfficialWordle(dateStr) : null;
    const answer = official ?? dailyAnswer(dateStr, s.language, DEFAULT_WORD_LENGTH);
    const game = createGame(this.db, chatId, answer, 'daily', { lang: s.language, dailyDate: dateStr, maxGuesses: 6 });
    return { game, created: true };
  }

  dailyGame(chatId: number, dateStr: string): GameRow | null {
    return getDailyGame(this.db, chatId, dateStr);
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
    const game = getActiveGame(this.db, chatId);
    if (!game) return { type: 'no_game' };
    const word = getLanguage(game.lang).normalize(rawWord.trim());

    const settings = getSettings(this.db, chatId);
    const isDuel = game.kind === 'duel';

    // tournament turn enforcement comes first: rejected attempts by the
    // player at turn count toward the max-fails limit
    let tournament: TournamentRow | null = null;
    if (game.kind === 'tournament' && game.tournament_id) {
      tournament = getTournament(this.db, game.tournament_id);
      if (tournament && tournament.status === 'active') {
        const order = roundOrder(tournament.players, tournament.current_round);
        const current = order[tournament.turn_idx % order.length];
        if (current.userId !== user.id) {
          if (!tournament.players.some((p) => p.userId === user.id)) return { type: 'ignored' };
          return { type: 'not_your_turn', currentPlayer: current };
        }
      } else {
        tournament = null;
      }
    }

    // normal group games: players who burned all their failed attempts are out for this game
    const lockoutApplies = !tournament && !isDuel && settings.maxFails > 0;
    if (lockoutApplies && (game.fail_counts[String(user.id)] ?? 0) >= settings.maxFails) {
      return { type: 'locked_out', max: settings.maxFails };
    }

    const fail = <T extends Extract<GuessOutcome, { failInfo?: FailInfo }>>(outcome: T): T =>
      this.countFailedAttempt(tournament, lockoutApplies ? game : null, user, settings.maxFails, outcome);

    if (word.length !== game.answer.length && word !== game.answer) {
      return fail({ type: 'wrong_length', word, expected: game.answer.length });
    }
    // the game's own answer is always guessable, even when it's outside our
    // lists (official NYT words, custom words like лейло)
    if (word !== game.answer && !isValidWord(word, game.lang)) return fail({ type: 'not_a_word', word });
    if (game.guesses.some((g) => g.word === word)) return fail({ type: 'already_guessed', word });

    // creativity mode (not for duels — both duelists must face the same word fairly)
    if (!isDuel && word !== game.answer && recentWords(this.db, chatId, settings.creativity).has(word)) {
      return fail({ type: 'creativity_blocked', word });
    }

    // hard / super hard mode: all revealed hints must be used
    if (settings.difficulty !== 'normal') {
      const superHard = settings.difficulty === 'superhard';
      const violation = hardModeViolation(game.answer, game.guesses.map((g) => g.word), word, superHard);
      if (violation) return fail({ type: 'hard_mode_violation', word, violation, superHard });
    }

    // accept the guess
    const entry: GuessEntry = { word, userId: user.id, userName: user.name, ts: Date.now() };
    game.guesses.push(entry);
    const score = scoreGuess(game.answer, word);
    const guessNumber = game.guesses.length;
    const solved = word === game.answer;
    const lost = !solved && guessNumber >= maxGuessesFor(game);

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
      if ((solved || lost) && game.kind === 'daily' && game.daily_date) {
        const participants = new Map<number, string>();
        for (const g of game.guesses) participants.set(g.userId, g.userName);
        for (const [userId, name] of participants) {
          recordDailyResult(this.db, chatId, userId, name, game.daily_date, solved);
        }
      }
      if (tournament && tournament.status === 'active') {
        outcome.tournament = this.advanceTournament(tournament, user, solved, lost, guessNumber, game);
      }
    }
    return outcome;
  }

  /**
   * Reveal one letter of the answer that no guess (or earlier hint) has touched
   * yet, at the cost of one try. Group games only — never tournaments or duels.
   */
  useHint(chatId: number): HintOutcome {
    const game = getActiveGame(this.db, chatId);
    if (!game) return { type: 'no_game' };
    if (game.kind === 'tournament' || game.kind === 'duel') return { type: 'not_here' };
    if (game.guesses.length >= maxGuessesFor(game) - 1) return { type: 'no_tries' };
    const known = new Set<string>(game.hints);
    for (const g of game.guesses) for (const c of g.word) known.add(c);
    const unrevealed = [...new Set(game.answer.split(''))].filter((c) => !known.has(c));
    if (!unrevealed.length) return { type: 'nothing_to_reveal' };
    const letter = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    game.hints.push(letter);
    updateGame(this.db, game);
    return { type: 'ok', letter, triesLeft: maxGuessesFor(game) - game.guesses.length, game };
  }

  /**
   * Skip the current tournament player's turn (turn timer expired).
   * If everyone has been skipped twice in a row without a single guess,
   * the tournament is considered abandoned and cancelled.
   */
  forfeitTurnByTimeout(
    chatId: number
  ): { t: TournamentRow; skipped: TournamentPlayer; nextPlayer: TournamentPlayer; abandoned: boolean; answer?: string } | null {
    const t = getOpenTournament(this.db, chatId);
    if (!t || t.status !== 'active') return null;
    const order = roundOrder(t.players, t.current_round);
    const skipped = order[t.turn_idx % order.length];
    t.turn_idx = (t.turn_idx + 1) % t.players.length;
    t.fail_count = 0;
    t.idle_skips += 1;

    if (t.idle_skips >= t.players.length * 2) {
      t.status = 'cancelled';
      updateTournament(this.db, t);
      const answer = this.endTournamentGame(t);
      return { t, skipped, nextPlayer: skipped, abandoned: true, answer };
    }
    updateTournament(this.db, t);
    const nextPlayer = roundOrder(t.players, t.current_round)[t.turn_idx];
    return { t, skipped, nextPlayer, abandoned: false };
  }

  /**
   * Lazily expire whatever is blocking the chat past its idle limit:
   * a lobby nobody started, or an active tournament nobody plays.
   */
  expireStaleTournament(chatId: number, now = Date.now()): { kind: 'lobby' | 'active'; t: TournamentRow; answer?: string } | null {
    const t = getOpenTournament(this.db, chatId);
    if (!t) return null;
    if (t.status === 'joining' && now - t.last_activity > LOBBY_IDLE_MS) {
      t.status = 'cancelled';
      updateTournament(this.db, t);
      return { kind: 'lobby', t };
    }
    if (t.status === 'active' && now - t.last_activity > TOURNAMENT_IDLE_MS) {
      t.status = 'cancelled';
      updateTournament(this.db, t);
      return { kind: 'active', t, answer: this.endTournamentGame(t) };
    }
    return null;
  }

  /**
   * Disband whatever is blocking the chat — open tournament (any state) and/or
   * the active game. Anyone may trigger this via the disband button; that is
   * the point: the original creator might be long gone.
   */
  disbandBlocking(chatId: number): { answer?: string; tournamentCancelled: boolean } | null {
    let tournamentCancelled = false;
    const t = getOpenTournament(this.db, chatId);
    if (t) {
      t.status = 'cancelled';
      updateTournament(this.db, t);
      tournamentCancelled = true;
    }
    let answer: string | undefined;
    const game = getActiveGame(this.db, chatId);
    if (game) {
      game.status = 'lost';
      game.finished_at = Date.now();
      updateGame(this.db, game);
      if (game.kind !== 'duel') recordUsedWord(this.db, chatId, game.answer);
      answer = game.answer;
    }
    if (!t && !game) return null;
    return { answer, tournamentCancelled };
  }

  /** Expire a regular (non-tournament) game that nobody has touched for hours. */
  expireStaleGame(chatId: number, now = Date.now()): { answer: string } | null {
    const game = getActiveGame(this.db, chatId);
    if (!game || game.kind === 'tournament') return null;
    const lastTouch = game.guesses.length ? game.guesses[game.guesses.length - 1].ts : game.started_at;
    if (now - lastTouch <= GAME_IDLE_MS) return null;
    game.status = 'lost';
    game.finished_at = now;
    updateGame(this.db, game);
    if (game.kind !== 'duel') recordUsedWord(this.db, chatId, game.answer);
    return { answer: game.answer };
  }

  /** End the active game of a cancelled tournament, revealing its answer. */
  private endTournamentGame(t: TournamentRow): string | undefined {
    const game = getActiveGame(this.db, t.chat_id);
    if (!game || game.tournament_id !== t.id) return undefined;
    game.status = 'lost';
    game.finished_at = Date.now();
    updateGame(this.db, game);
    recordUsedWord(this.db, t.chat_id, game.answer);
    return game.answer;
  }

  // ---------- tournaments ----------

  createTournament(chatId: number, rounds: number, creator: UserRef): TournamentRow | null {
    if (getOpenTournament(this.db, chatId) || getActiveGame(this.db, chatId)) return null;
    const t = createTournament(this.db, chatId, rounds, creator.id);
    t.players = [{ userId: creator.id, userName: creator.name }];
    updateTournament(this.db, t);
    return getTournament(this.db, t.id);
  }

  joinTournament(tournamentId: number, user: UserRef): TournamentRow | 'closed' | 'already_in' | null {
    const t = getTournament(this.db, tournamentId);
    if (!t) return null;
    if (t.status !== 'joining') return 'closed';
    if (t.players.some((p) => p.userId === user.id)) return 'already_in';
    t.players.push({ userId: user.id, userName: user.name });
    t.last_activity = Date.now();
    updateTournament(this.db, t);
    return getTournament(this.db, t.id);
  }

  quitTournament(tournamentId: number, userId: number): TournamentRow | 'closed' | 'not_in' | null {
    const t = getTournament(this.db, tournamentId);
    if (!t) return null;
    if (t.status !== 'joining') return 'closed';
    if (!t.players.some((p) => p.userId === userId)) return 'not_in';
    t.players = t.players.filter((p) => p.userId !== userId);
    t.last_activity = Date.now();
    updateTournament(this.db, t);
    return getTournament(this.db, t.id);
  }

  /** Start the tournament: first round game is created. */
  startTournament(tournamentId: number): { t: TournamentRow; game: GameRow; firstPlayer: TournamentPlayer } | 'too_few' | null {
    const t = getTournament(this.db, tournamentId);
    if (!t || t.status !== 'joining') return null;
    if (t.players.length < 2) return 'too_few';
    t.status = 'active';
    t.current_round = 1;
    t.turn_idx = 0;
    t.last_activity = Date.now();
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
    const length = effectiveLength(s);
    const answer = pickAnswer(recentWords(this.db, t.chat_id, s.creativity), s.language, length);
    return createGame(this.db, t.chat_id, answer, 'tournament', {
      tournamentId: t.id,
      lang: s.language,
      maxGuesses: effectiveTries(s, length),
    });
  }

  /**
   * A rejected guess counts as a failed attempt (maxFails 0 = unlimited).
   * Tournaments: counted per turn; reaching the limit forfeits the turn.
   * Normal games: counted per player; reaching the limit locks them out of this game.
   */
  private countFailedAttempt<T extends Extract<GuessOutcome, { failInfo?: FailInfo }>>(
    t: TournamentRow | null,
    game: GameRow | null,
    user: UserRef,
    maxFails: number,
    outcome: T
  ): T {
    if (maxFails <= 0) return outcome;
    if (t) {
      t.fail_count += 1;
      const forfeited = t.fail_count >= maxFails;
      let nextPlayer: TournamentPlayer | null = null;
      if (forfeited) {
        t.turn_idx = (t.turn_idx + 1) % t.players.length;
        t.fail_count = 0;
        nextPlayer = roundOrder(t.players, t.current_round)[t.turn_idx];
      }
      updateTournament(this.db, t);
      outcome.failInfo = {
        count: forfeited ? maxFails : t.fail_count,
        max: maxFails,
        forfeited,
        lockedOut: false,
        nextPlayer,
      };
    } else if (game) {
      const key = String(user.id);
      const count = (game.fail_counts[key] ?? 0) + 1;
      game.fail_counts[key] = count;
      updateGame(this.db, game);
      outcome.failInfo = { count, max: maxFails, forfeited: false, lockedOut: count >= maxFails, nextPlayer: null };
    }
    return outcome;
  }

  private advanceTournament(
    t: TournamentRow,
    user: UserRef,
    solved: boolean,
    lost: boolean,
    guessNumber: number,
    game: GameRow
  ): NonNullable<Extract<GuessOutcome, { type: 'accepted' }>['tournament']> {
    let pointsAwarded = 0;
    const roundEnded = solved || lost;
    let tournamentEnded = false;
    let nextGame: GameRow | null = null;
    let nextPlayer: TournamentPlayer | null = null;
    let winners: TournamentPlayer[] = [];

    if (solved) {
      pointsAwarded = pointsForGuessNumber(guessNumber, game.max_guesses ?? MAX_GUESSES);
      t.scores[String(user.id)] = (t.scores[String(user.id)] ?? 0) + pointsAwarded;
    }
    t.fail_count = 0; // an accepted guess always hands over a fresh turn
    t.last_activity = Date.now();
    t.idle_skips = 0;

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
    const answer = pickAnswer(recentWords(this.db, chatId, s.creativity), s.language, effectiveLength(s));
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
    const origin = getSettings(this.db, d.chat_id);
    const game = createGame(this.db, privateChatId, d.answer, 'duel', {
      duelId: d.id,
      lang: origin.language,
      maxGuesses: effectiveTries(origin, d.answer.length),
    });
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
