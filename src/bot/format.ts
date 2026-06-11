import { ChatSettings, Difficulty, GameRow, StatsRow, TournamentRow } from '../db.js';
import type { HardModeViolation } from '../engine/hardmode.js';
import { getLanguage, LANGUAGES } from '../engine/languages.js';
import { scoreGuess, type TileStatus } from '../engine/score.js';
import { MAX_GUESSES, roundOrder } from '../game/service.js';
import { formatTileLetter, type EmojiPackConfig, type TileColor } from '../render/emoji-pack.js';

export const HELP_TEXT = `🟩 Wordle Bot — How to Play

/play starts a game with a random 5-letter word.
Guess it in 6 tries — everyone in the chat plays together!

🟩 Green  — right letter, right spot
🟨 Yellow — right letter, wrong spot
⬛ Gray   — letter not in the word

Commands
/play — start a new game
/daily — today's daily puzzle (same word everywhere!)
/guess WORD — submit a guess (/w works too)
/board — show the current board
/giveup — end the game and reveal the word
/stats — your stats · /top — chat leaderboard
/tournament N — start an N-round turn-based tournament
/challenge — duel a friend (same word, fewest guesses wins)
/settings — board style, language, difficulty, creativity & more
/help — this message`;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  normal: '😎 normal',
  hard: '😤 hard',
  superhard: '🔥 super hard',
};

export const RENDER_LABEL: Record<ChatSettings['render'], string> = {
  image: '🖼 image',
  sticker: '🧩 sticker',
  text: '🔤 text',
};

/** "Hard mode: you must use 🟩W 🟨A. You cannot use ⬛C" — tiles via the chat's emoji pack if set. */
export function hardModeViolationText(
  violation: HardModeViolation,
  superHard: boolean,
  emojiPack: EmojiPackConfig | null
): string {
  const mode = superHard ? '🔥 Super hard mode' : '😤 Hard mode';
  const required = violation.required
    .map((hint) => formatTileLetter(hint.letter, hint.color, emojiPack))
    .join(' ');
  const forbidden = violation.forbidden.map((letter) => formatTileLetter(letter, 'dark-gray', emojiPack)).join(' ');

  if (required && forbidden) return `${mode}: you must use ${required}.\nYou cannot use ${forbidden}`;
  if (required) return `${mode}: you must use ${required}`;
  return `${mode}: you cannot use ${forbidden}`;
}

/** "♻️ 🟨T 🟨R 🟨A ⬛C 🟨E was already guessed" */
export function alreadyGuessedText(word: string, answer: string, emojiPack: EmojiPackConfig | null): string {
  const tiles = scoreGuess(answer, word)
    .map((status, index) => formatTileLetter(word[index], tileStatusColor(status), emojiPack))
    .join(' ');
  return `♻️ ${tiles} was already guessed`;
}

function tileStatusColor(status: TileStatus): TileColor {
  if (status === 'correct') return 'green';
  if (status === 'present') return 'yellow';
  return 'dark-gray';
}

export function describeCreativity(s: ChatSettings): string {
  if (!s.creativity.enabled) return 'OFF';
  return s.creativity.mode === 'time'
    ? `ON — last ${humanDuration(s.creativity.seconds)} banned`
    : `ON — last ${s.creativity.count} words banned`;
}

const DIFFICULTY_NOTE: Record<Difficulty, string> = {
  normal: 'classic rules',
  hard: 'reuse all 🟩/🟨 hints',
  superhard: 'reuse all hints, ⬛ letters banned',
};

export function settingsText(s: ChatSettings): string {
  return `⚙️ Settings

• Bare words: ${s.bareWord ? 'ON — plain 5-letter words count' : 'OFF — guess with /guess WORD'}
• Board: ${RENDER_LABEL[s.render]}
• Language: ${getLanguage(s.language).label} · /settings lang ${Object.keys(LANGUAGES).filter((c) => c !== s.language).join(' | ')}
• Difficulty: ${DIFFICULTY_LABEL[s.difficulty]} — ${DIFFICULTY_NOTE[s.difficulty]}
• Creativity: ${describeCreativity(s)} · /settings creativity 30m | 15w
• Max fails: ${s.maxFails > 0 ? `${s.maxFails} per player` : 'unlimited'} · /settings fails 5 | off
• Turn timer: ${s.turnTime > 0 ? `${humanDuration(s.turnTime)} (tournaments)` : 'off'} · /settings turntime 2m | off
• Daily puzzle: ${s.dailyTime ? `auto-post at ${s.dailyTime}` : 'manual — /daily to play'} · /daily 09:00 | off
• Emoji pack: ${s.emojiPack ? s.emojiPack.name : 'default'} · /usepack NAME | off

Fails: rejected guesses lock you out of the game (tournaments: forfeit your turn).
Bare words need privacy mode off (@BotFather → /setprivacy).`;
}

/** Parse "90s" / "2m" / "1h" / "1d" into seconds. */
export function parseDuration(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n <= 0) return null;
  const unit = m[2][0];
  return n * (unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400);
}

export function humanDuration(seconds: number): string {
  if (seconds % 86400 === 0 && seconds >= 86400) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600}h`;
  if (seconds % 60 === 0 && seconds >= 60) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/** Parse "30m", "2h", "90s", "1d" → seconds; or "15 words" → word count. */
export function parseCreativityValue(input: string): { seconds: number } | { count: number } | null {
  const trimmed = input.trim().toLowerCase();
  const words = trimmed.match(/^(\d+)\s*(words?|w)$/);
  if (words) {
    const n = parseInt(words[1], 10);
    return n > 0 ? { count: n } : null;
  }
  const time = trimmed.match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (time) {
    const n = parseInt(time[1], 10);
    if (n <= 0) return null;
    const unit = time[2][0];
    const mult = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return { seconds: n * mult };
  }
  return null;
}

const ROW_NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

export function statsText(s: StatsRow, displayName: string): string {
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const winRate = pct(s.games_won, s.games_played);
  const solveShare = pct(s.solves, s.games_won);

  const lines: string[] = [`📊 ${displayName}`, ''];
  lines.push(`🎮 Games · ${s.games_played} played, ${s.games_won} won (${winRate}%)`);
  if (s.solves > 0) lines.push(`🎯 Solver · ${s.solves} winning guess${s.solves > 1 ? 'es' : ''} — ${solveShare}% of wins`);
  lines.push(`🔥 Streak · ${s.current_streak} now, ${s.best_streak} best`);
  if (s.fastest_ms !== null) lines.push(`⚡ Fastest · ${humanMs(s.fastest_ms)}`);
  if (s.guesses_total > 0) {
    lines.push(`✍️ Letters · ${s.guesses_total} guesses, ${pct(s.greens, s.guesses_total * 5)}% 🟩 ${pct(s.yellows, s.guesses_total * 5)}% 🟨`);
  }

  const dist = [s.dist1, s.dist2, s.dist3, s.dist4, s.dist5, s.dist6];
  if (dist.some((n) => n > 0)) {
    const maxDist = Math.max(...dist);
    lines.push('', 'Winning guesses');
    dist.forEach((n, i) => {
      const bar = n > 0 ? '▰'.repeat(Math.max(1, Math.round((n / maxDist) * 8))) + ` ${n}` : '·';
      lines.push(`${ROW_NUM[i]} ${bar}`);
    });
  }

  const extras: string[] = [];
  if (s.daily_played > 0) extras.push(`☀️ Daily · ${s.daily_played} played, streak ${s.daily_streak} (best ${s.daily_best})`);
  if (s.tournaments_played > 0) extras.push(`🏆 Tournaments · ${s.tournaments_played} played, ${s.tournaments_won} won, ${s.tournament_points} pts`);
  if (s.duels_played > 0) extras.push(`⚔️ Duels · ${s.duels_played} played, ${s.duels_won} won`);
  if (extras.length) lines.push('', ...extras);

  if (s.games_played === 0 && extras.length === 0) {
    return `📊 ${displayName}\n\nNothing here yet — guess a word and come back! 🟩`;
  }
  return lines.join('\n');
}

/** Chat leaderboard: ranked by winning guesses, then wins, then points. */
export function topText(rows: StatsRow[]): string {
  if (!rows.length) return '🏆 No players yet — /play to get this chat on the board!';
  const ranked = [...rows].sort(
    (a, b) =>
      b.solves - a.solves ||
      b.games_won - a.games_won ||
      b.tournament_points - a.tournament_points ||
      a.guesses_total - b.guesses_total
  );
  const medals = ['🥇', '🥈', '🥉'];
  const lines = ranked.slice(0, 10).map((s, i) => {
    const rank = medals[i] ?? ` ${i + 1}.`;
    const winRate = s.games_played ? Math.round((100 * s.games_won) / s.games_played) : 0;
    const bits = [`${s.solves} solve${s.solves === 1 ? '' : 's'}`, `${winRate}% wins`];
    if (s.current_streak > 1) bits.push(`🔥${s.current_streak}`);
    if (s.tournament_points > 0) bits.push(`🏆${s.tournament_points}`);
    return `${rank} ${s.name || 'Player'} — ${bits.join(' · ')}`;
  });
  return `🏆 Leaderboard\n\n${lines.join('\n')}\n\nRanked by winning guesses. Play to climb!`;
}

/** Spoiler-free result grid for the daily puzzle, in the classic shareable format. */
export function dailyShareText(game: GameRow): string {
  const solved = game.status === 'solved';
  const tries = solved ? `${game.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const grid = game.guesses
    .map((g) =>
      scoreGuess(game.answer, g.word)
        .map((s) => (s === 'correct' ? '🟩' : s === 'present' ? '🟨' : '⬛'))
        .join('')
    )
    .join('\n');
  const solver = solved ? `\n🎉 Solved by ${game.guesses[game.guesses.length - 1].userName}` : '';
  const langTag = game.lang !== 'en' ? ` (${game.lang.toUpperCase()})` : '';
  return `☀️ Daily${langTag} — ${game.daily_date} — ${tries}\n\n${grid}${solver}`;
}

export function humanMs(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export function standingsText(t: TournamentRow): string {
  const rankLabels = ['🥇', '🥈', '🥉'];
  const rows = [...t.players]
    .map((p) => ({ p, pts: t.scores[String(p.userId)] ?? 0 }))
    .sort((a, b) => b.pts - a.pts)
    .map((r, i) => `${rankLabels[i] ?? `${i + 1}.`} ${r.p.userName} — ${r.pts} pts`);
  return rows.join('\n');
}

export function turnOrderText(t: TournamentRow): string {
  return roundOrder(t.players, t.current_round)
    .map((p) => p.userName)
    .join(' → ');
}
