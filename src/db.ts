import Database from 'better-sqlite3';
import { isEmojiPackConfig, type EmojiPackConfig } from './render/emoji-pack.js';

export type RenderMode = 'image' | 'sticker' | 'text';

export interface CreativitySettings {
  enabled: boolean;
  mode: 'time' | 'count';
  /** time window in seconds (mode === 'time') */
  seconds: number;
  /** last N words (mode === 'count') */
  count: number;
}

export type Difficulty = 'normal' | 'hard' | 'superhard';

export interface ChatSettings {
  bareWord: boolean;
  render: RenderMode;
  difficulty: Difficulty;
  /** Rejected guess attempts allowed before lockout (normal games) / turn forfeit (tournaments). 0 = unlimited. */
  maxFails: number;
  /** Tournaments: seconds a player gets per turn before it is forfeited. 0 = no timer. */
  turnTime: number;
  /** Word list language code (see engine/languages.ts). */
  language: string;
  /** Daily puzzle auto-post time as 'HH:MM' (server time), or null when not scheduled. */
  dailyTime: string | null;
  /** Delete the previous board message when posting a fresh one. */
  cleanup: boolean;
  /** Allow /hint (reveal a letter at the cost of one try). */
  hints: boolean;
  /** Mention (@ping) tournament players when it is their turn. */
  pings: boolean;
  /** Post a per-guess analysis after normal/daily games end. */
  breakdown: boolean;
  creativity: CreativitySettings;
  /** Custom emoji tiles for hint messages (set via /usepack), or null for the bundled default. */
  emojiPack: EmojiPackConfig | null;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  bareWord: false,
  render: 'image',
  difficulty: 'normal',
  maxFails: 5,
  turnTime: 120,
  language: 'en',
  dailyTime: null,
  cleanup: true,
  hints: true,
  pings: true,
  breakdown: true,
  creativity: { enabled: true, mode: 'time', seconds: 3600, count: 20 },
  emojiPack: null,
};

export interface GuessEntry {
  word: string;
  userId: number;
  userName: string;
  ts: number;
}

export type GameKind = 'normal' | 'tournament' | 'duel' | 'daily';
export type GameStatus = 'active' | 'solved' | 'lost';

export interface GameRow {
  id: number;
  chat_id: number;
  answer: string;
  status: GameStatus;
  kind: GameKind;
  guesses: GuessEntry[];
  /** rejected attempts per user this game (normal games; tournaments track per turn instead) */
  fail_counts: Record<string, number>;
  /** letters revealed via /hint — each one burned a try */
  hints: string[];
  lang: string;
  /** set for kind 'daily': the puzzle date 'YYYY-MM-DD' */
  daily_date: string | null;
  started_at: number;
  finished_at: number | null;
  tournament_id: number | null;
  duel_id: number | null;
}

export type TournamentStatus = 'joining' | 'active' | 'done' | 'cancelled';

export interface TournamentPlayer {
  userId: number;
  userName: string;
}

export interface TournamentRow {
  id: number;
  chat_id: number;
  rounds: number;
  current_round: number; // 1-based
  status: TournamentStatus;
  players: TournamentPlayer[];
  scores: Record<string, number>; // userId -> points
  turn_idx: number; // index into rotated order of the current round
  fail_count: number; // rejected attempts by the current player this turn
  last_activity: number; // last human action (create/join/guess) — drives auto-expiry
  idle_skips: number; // consecutive timer forfeits with no guess in between
  created_by: number;
}

export type DuelStatus = 'pending' | 'active' | 'done' | 'cancelled';

export interface DuelPlayerResult {
  userId: number;
  userName: string;
  guesses: number | null; // null = not finished
  solved: boolean;
  ms: number | null; // time to finish
}

export interface DuelRow {
  id: number;
  chat_id: number; // group chat where the duel was created/announced
  answer: string;
  status: DuelStatus;
  challenger: DuelPlayerResult;
  opponent: DuelPlayerResult | null;
}

export interface StatsRow {
  chat_id: number;
  user_id: number;
  name: string;
  games_played: number;
  games_won: number; // games the player participated in that were solved (by anyone)
  solves: number; // games where THIS player's guess was the winning one
  guesses_total: number;
  greens: number;
  yellows: number;
  current_streak: number;
  best_streak: number;
  dist1: number;
  dist2: number;
  dist3: number;
  dist4: number;
  dist5: number;
  dist6: number;
  fastest_ms: number | null;
  tournaments_played: number;
  tournaments_won: number;
  tournament_points: number;
  duels_played: number;
  duels_won: number;
  daily_played: number;
  daily_streak: number;
  daily_best: number;
  last_daily: string | null;
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      chat_id INTEGER PRIMARY KEY,
      settings TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      kind TEXT NOT NULL DEFAULT 'normal',
      guesses TEXT NOT NULL DEFAULT '[]',
      fail_counts TEXT NOT NULL DEFAULT '{}',
      hints TEXT NOT NULL DEFAULT '[]',
      lang TEXT NOT NULL DEFAULT 'en',
      daily_date TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      tournament_id INTEGER,
      duel_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_games_active ON games(chat_id, status);
    CREATE TABLE IF NOT EXISTS used_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      used_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_used_words ON used_words(chat_id, used_at);
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      rounds INTEGER NOT NULL,
      current_round INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'joining',
      players TEXT NOT NULL DEFAULT '[]',
      scores TEXT NOT NULL DEFAULT '{}',
      turn_idx INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_activity INTEGER NOT NULL DEFAULT 0,
      idle_skips INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS duels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      challenger TEXT NOT NULL,
      opponent TEXT
    );
    CREATE TABLE IF NOT EXISTS stats (
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      games_played INTEGER NOT NULL DEFAULT 0,
      games_won INTEGER NOT NULL DEFAULT 0,
      solves INTEGER NOT NULL DEFAULT 0,
      guesses_total INTEGER NOT NULL DEFAULT 0,
      greens INTEGER NOT NULL DEFAULT 0,
      yellows INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      dist1 INTEGER NOT NULL DEFAULT 0,
      dist2 INTEGER NOT NULL DEFAULT 0,
      dist3 INTEGER NOT NULL DEFAULT 0,
      dist4 INTEGER NOT NULL DEFAULT 0,
      dist5 INTEGER NOT NULL DEFAULT 0,
      dist6 INTEGER NOT NULL DEFAULT 0,
      fastest_ms INTEGER,
      tournaments_played INTEGER NOT NULL DEFAULT 0,
      tournaments_won INTEGER NOT NULL DEFAULT 0,
      tournament_points INTEGER NOT NULL DEFAULT 0,
      duels_played INTEGER NOT NULL DEFAULT 0,
      duels_won INTEGER NOT NULL DEFAULT 0,
      daily_played INTEGER NOT NULL DEFAULT 0,
      daily_streak INTEGER NOT NULL DEFAULT 0,
      daily_best INTEGER NOT NULL DEFAULT 0,
      last_daily TEXT,
      PRIMARY KEY (chat_id, user_id)
    );
  `);
  // migrations for databases created before the max-fails features
  const tCols = db.prepare('PRAGMA table_info(tournaments)').all() as { name: string }[];
  if (!tCols.some((c) => c.name === 'fail_count')) {
    db.exec("ALTER TABLE tournaments ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0");
  }
  const gCols = db.prepare('PRAGMA table_info(games)').all() as { name: string }[];
  if (!gCols.some((c) => c.name === 'fail_counts')) {
    db.exec("ALTER TABLE games ADD COLUMN fail_counts TEXT NOT NULL DEFAULT '{}'");
  }
  if (!gCols.some((c) => c.name === 'lang')) {
    db.exec("ALTER TABLE games ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
    db.exec('ALTER TABLE games ADD COLUMN daily_date TEXT');
  }
  if (!gCols.some((c) => c.name === 'hints')) {
    db.exec("ALTER TABLE games ADD COLUMN hints TEXT NOT NULL DEFAULT '[]'");
  }
  if (!tCols.some((c) => c.name === 'last_activity')) {
    db.exec('ALTER TABLE tournaments ADD COLUMN last_activity INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE tournaments ADD COLUMN idle_skips INTEGER NOT NULL DEFAULT 0');
  }
  const sCols = db.prepare('PRAGMA table_info(stats)').all() as { name: string }[];
  if (!sCols.some((c) => c.name === 'daily_played')) {
    db.exec('ALTER TABLE stats ADD COLUMN daily_played INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE stats ADD COLUMN daily_streak INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE stats ADD COLUMN daily_best INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE stats ADD COLUMN last_daily TEXT');
  }
  return db;
}

// ---------- chats / settings ----------

export function getSettings(db: Database.Database, chatId: number): ChatSettings {
  const row = db.prepare('SELECT settings FROM chats WHERE chat_id = ?').get(chatId) as
    | { settings: string }
    | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const parsed = JSON.parse(row.settings);
  // merge so settings added in later versions get defaults
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...parsed,
    creativity: { ...structuredClone(DEFAULT_SETTINGS.creativity), ...(parsed.creativity ?? {}) },
    emojiPack: isEmojiPackConfig(parsed.emojiPack) ? parsed.emojiPack : null,
  };
}

export function saveSettings(db: Database.Database, chatId: number, s: ChatSettings): void {
  db.prepare(
    `INSERT INTO chats (chat_id, settings) VALUES (?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET settings = excluded.settings`
  ).run(chatId, JSON.stringify(s));
}

// ---------- games ----------

function parseGame(row: any): GameRow {
  return {
    ...row,
    guesses: JSON.parse(row.guesses),
    fail_counts: JSON.parse(row.fail_counts ?? '{}'),
    hints: JSON.parse(row.hints ?? '[]'),
  };
}

export function getActiveGame(db: Database.Database, chatId: number): GameRow | null {
  const row = db
    .prepare(`SELECT * FROM games WHERE chat_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`)
    .get(chatId);
  return row ? parseGame(row) : null;
}

export function getGame(db: Database.Database, id: number): GameRow | null {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  return row ? parseGame(row) : null;
}

export function createGame(
  db: Database.Database,
  chatId: number,
  answer: string,
  kind: GameKind = 'normal',
  opts: { tournamentId?: number; duelId?: number; lang?: string; dailyDate?: string } = {}
): GameRow {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO games (chat_id, answer, kind, lang, daily_date, started_at, tournament_id, duel_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(chatId, answer, kind, opts.lang ?? 'en', opts.dailyDate ?? null, now, opts.tournamentId ?? null, opts.duelId ?? null);
  return getGame(db, Number(info.lastInsertRowid))!;
}

export function getDailyGame(db: Database.Database, chatId: number, dateStr: string): GameRow | null {
  const row = db
    .prepare(`SELECT * FROM games WHERE chat_id = ? AND kind = 'daily' AND daily_date = ? LIMIT 1`)
    .get(chatId, dateStr);
  return row ? parseGame(row) : null;
}

/** All chats that have ever saved settings (used by the daily scheduler). */
export function allChatIds(db: Database.Database): number[] {
  return (db.prepare('SELECT chat_id FROM chats').all() as { chat_id: number }[]).map((r) => r.chat_id);
}

/** Chats with a tournament currently in progress (used to restore turn timers on boot). */
export function activeTournamentChats(db: Database.Database): number[] {
  return (
    db.prepare(`SELECT DISTINCT chat_id FROM tournaments WHERE status = 'active'`).all() as { chat_id: number }[]
  ).map((r) => r.chat_id);
}

export function updateGame(db: Database.Database, game: GameRow): void {
  db.prepare(
    `UPDATE games SET status = ?, guesses = ?, fail_counts = ?, hints = ?, finished_at = ? WHERE id = ?`
  ).run(
    game.status,
    JSON.stringify(game.guesses),
    JSON.stringify(game.fail_counts),
    JSON.stringify(game.hints),
    game.finished_at,
    game.id
  );
}

/** Recently finished games in this chat, newest first (for /history and /define). */
export function recentFinishedGames(db: Database.Database, chatId: number, limit = 10): GameRow[] {
  return (
    db
      .prepare(
        `SELECT * FROM games WHERE chat_id = ? AND status IN ('solved','lost') AND kind != 'duel'
         ORDER BY finished_at DESC LIMIT ?`
      )
      .all(chatId, limit) as any[]
  ).map(parseGame);
}

/** All finished duels announced in this chat (for /vs head-to-head records). */
export function finishedDuels(db: Database.Database, chatId: number): DuelRow[] {
  const rows = db.prepare(`SELECT * FROM duels WHERE chat_id = ? AND status = 'done'`).all(chatId) as any[];
  return rows.map((row) => ({
    ...row,
    challenger: JSON.parse(row.challenger),
    opponent: row.opponent ? JSON.parse(row.opponent) : null,
  }));
}

// ---------- used words (creativity mode) ----------

export function recordUsedWord(db: Database.Database, chatId: number, word: string): void {
  db.prepare('INSERT INTO used_words (chat_id, word, used_at) VALUES (?, ?, ?)').run(
    chatId,
    word.toLowerCase(),
    Date.now()
  );
}

export function recentWords(db: Database.Database, chatId: number, c: CreativitySettings): Set<string> {
  if (!c.enabled) return new Set();
  let rows: { word: string }[];
  if (c.mode === 'time') {
    rows = db
      .prepare('SELECT word FROM used_words WHERE chat_id = ? AND used_at >= ?')
      .all(chatId, Date.now() - c.seconds * 1000) as { word: string }[];
  } else {
    rows = db
      .prepare('SELECT word FROM used_words WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
      .all(chatId, c.count) as { word: string }[];
  }
  return new Set(rows.map((r) => r.word));
}

// ---------- tournaments ----------

function parseTournament(row: any): TournamentRow {
  return { ...row, players: JSON.parse(row.players), scores: JSON.parse(row.scores) };
}

export function getOpenTournament(db: Database.Database, chatId: number): TournamentRow | null {
  const row = db
    .prepare(
      `SELECT * FROM tournaments WHERE chat_id = ? AND status IN ('joining','active') ORDER BY id DESC LIMIT 1`
    )
    .get(chatId);
  return row ? parseTournament(row) : null;
}

export function getTournament(db: Database.Database, id: number): TournamentRow | null {
  const row = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  return row ? parseTournament(row) : null;
}

export function createTournament(
  db: Database.Database,
  chatId: number,
  rounds: number,
  createdBy: number
): TournamentRow {
  const info = db
    .prepare('INSERT INTO tournaments (chat_id, rounds, created_by, last_activity) VALUES (?, ?, ?, ?)')
    .run(chatId, rounds, createdBy, Date.now());
  return getTournament(db, Number(info.lastInsertRowid))!;
}

export function updateTournament(db: Database.Database, t: TournamentRow): void {
  db.prepare(
    `UPDATE tournaments SET current_round = ?, status = ?, players = ?, scores = ?, turn_idx = ?, fail_count = ?, last_activity = ?, idle_skips = ? WHERE id = ?`
  ).run(
    t.current_round,
    t.status,
    JSON.stringify(t.players),
    JSON.stringify(t.scores),
    t.turn_idx,
    t.fail_count,
    t.last_activity,
    t.idle_skips,
    t.id
  );
}

// ---------- duels ----------

function parseDuel(row: any): DuelRow {
  return {
    ...row,
    challenger: JSON.parse(row.challenger),
    opponent: row.opponent ? JSON.parse(row.opponent) : null,
  };
}

export function createDuel(db: Database.Database, chatId: number, answer: string, challenger: DuelPlayerResult): DuelRow {
  const info = db
    .prepare('INSERT INTO duels (chat_id, answer, challenger) VALUES (?, ?, ?)')
    .run(chatId, answer, JSON.stringify(challenger));
  return getDuel(db, Number(info.lastInsertRowid))!;
}

export function getDuel(db: Database.Database, id: number): DuelRow | null {
  const row = db.prepare('SELECT * FROM duels WHERE id = ?').get(id);
  return row ? parseDuel(row) : null;
}

export function updateDuel(db: Database.Database, d: DuelRow): void {
  db.prepare('UPDATE duels SET status = ?, challenger = ?, opponent = ? WHERE id = ?').run(
    d.status,
    JSON.stringify(d.challenger),
    d.opponent ? JSON.stringify(d.opponent) : null,
    d.id
  );
}

// ---------- stats ----------

/** Everyone with at least one game in this chat, for the leaderboard. */
export function getChatStats(db: Database.Database, chatId: number): StatsRow[] {
  return db
    .prepare(
      `SELECT * FROM stats WHERE chat_id = ?
       AND (games_played > 0 OR tournaments_played > 0 OR duels_played > 0 OR daily_played > 0)`
    )
    .all(chatId) as StatsRow[];
}

export function getStats(db: Database.Database, chatId: number, userId: number): StatsRow {
  let row = db
    .prepare('SELECT * FROM stats WHERE chat_id = ? AND user_id = ?')
    .get(chatId, userId) as StatsRow | undefined;
  if (!row) {
    db.prepare('INSERT INTO stats (chat_id, user_id) VALUES (?, ?)').run(chatId, userId);
    row = db.prepare('SELECT * FROM stats WHERE chat_id = ? AND user_id = ?').get(chatId, userId) as StatsRow;
  }
  return row;
}

export function bumpStats(
  db: Database.Database,
  chatId: number,
  userId: number,
  name: string,
  delta: Partial<
    Record<
      keyof Omit<StatsRow, 'chat_id' | 'user_id' | 'name' | 'fastest_ms' | 'current_streak' | 'daily_streak' | 'daily_best' | 'last_daily'>,
      number
    >
  >,
  extra: { setCurrentStreak?: number; fastestMs?: number } = {}
): void {
  const row = getStats(db, chatId, userId);
  const updates: string[] = ['name = ?'];
  const values: unknown[] = [name];
  for (const [k, v] of Object.entries(delta)) {
    if (!v) continue;
    updates.push(`${k} = ${k} + ?`);
    values.push(v);
  }
  if (extra.setCurrentStreak !== undefined) {
    updates.push('current_streak = ?');
    values.push(extra.setCurrentStreak);
    if (extra.setCurrentStreak > row.best_streak) {
      updates.push('best_streak = ?');
      values.push(extra.setCurrentStreak);
    }
  }
  if (extra.fastestMs !== undefined && (row.fastest_ms === null || extra.fastestMs < row.fastest_ms)) {
    updates.push('fastest_ms = ?');
    values.push(extra.fastestMs);
  }
  values.push(chatId, userId);
  db.prepare(`UPDATE stats SET ${updates.join(', ')} WHERE chat_id = ? AND user_id = ?`).run(...values);
}

/** Record a finished daily for one participant, maintaining their consecutive-day streak. */
export function recordDailyResult(
  db: Database.Database,
  chatId: number,
  userId: number,
  name: string,
  dateStr: string,
  solved: boolean
): void {
  const row = getStats(db, chatId, userId);
  if (row.last_daily === dateStr) return; // already counted today
  const yesterday = new Date(new Date(`${dateStr}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  const streak = solved ? (row.last_daily === yesterday ? row.daily_streak + 1 : 1) : 0;
  db.prepare(
    `UPDATE stats SET name = ?, daily_played = daily_played + 1, daily_streak = ?, daily_best = MAX(daily_best, ?), last_daily = ?
     WHERE chat_id = ? AND user_id = ?`
  ).run(name, streak, streak, dateStr, chatId, userId);
}
