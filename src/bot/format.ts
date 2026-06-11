import { ChatSettings, Difficulty, StatsRow, TournamentRow } from '../db.js';
import type { HardModeViolation } from '../engine/hardmode.js';
import { scoreGuess, type TileStatus } from '../engine/score.js';
import { roundOrder } from '../game/service.js';
import { formatTileLetter, type EmojiPackConfig, type TileColor } from '../render/emoji-pack.js';

export const HELP_TEXT = `<tg-emoji emoji-id="5282832726385268445">🔠</tg-emoji> Wordle

/play · start a new game
/tournament [N] · start a tournament
/w [WORD] · guess a word
/board · see current game board

<tg-emoji emoji-id="5879813604068298387">❗</tg-emoji> See /settings for cool modes and preferences!

<tg-emoji emoji-id="5884343982816759327">↗️</tg-emoji> <a href="https://github.com/ExposedCat/telewordle">Source Code</a>`;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  normal: '😎 normal',
  hard: '😤 hard',
  superhard: '🔥 super hard',
};

const TICK = '<tg-emoji emoji-id="5825794181183836432">✅</tg-emoji>';
const FORBIDDEN = '<tg-emoji emoji-id="5872829476143894491">🚫</tg-emoji>';
const ALREADY_GUESSED = '<tg-emoji emoji-id="5845943483382110702">♻️</tg-emoji>';
const A_YELLOW = '<tg-emoji emoji-id="5280718893806034581">🔠</tg-emoji>';
const A_GREEN = '<tg-emoji emoji-id="5282832726385268445">🔠</tg-emoji>';
const A_DARK = '<tg-emoji emoji-id="5282737683053980256">🔠</tg-emoji>';
const GAME_OVER = '<tg-emoji emoji-id="5927054181285237634">🏳️</tg-emoji>';

export function describeCreativity(s: ChatSettings): string {
  if (!s.creativity.configured) return 'off — set with /creativity 30m or /creativity 15w';
  if (!s.creativity.enabled) return 'off';
  return s.creativity.mode === 'time'
    ? `on — words from the last ${humanDuration(s.creativity.seconds)} are banned`
    : `on — the last ${s.creativity.count} words are banned`;
}

export function settingsText(s: ChatSettings): string {
  return `Mode /mode_help
/normal · normal mode${tick(s.difficulty === 'normal')}
/hard · hard mode${tick(s.difficulty === 'hard')}
/superhard · super hard mode${tick(s.difficulty === 'superhard')}

Creativity /creativity_help
/creativity · toggle creativity ${toggleIcon(s.creativity.enabled)}
/creativity 30m · time frame${tick(s.creativity.configured && s.creativity.mode === 'time')}
/creativity 15w · word frame${tick(s.creativity.configured && s.creativity.mode === 'count')}

Misc
/auto · guess without /w ${toggleIcon(s.bareWord)}
/usepack NAME · custom emoji pack ${toggleIcon(s.emojiPack !== null)}`;
}

export function modeHelpText(s: ChatSettings): string {
  return `Normal /normal${tick(s.difficulty === 'normal')}
Classic Wordle experience.

Hard /hard${tick(s.difficulty === 'hard')}
Each guess must use ${A_YELLOW} yellow and ${A_GREEN} green hints from previous guesses.

Super-hard /superhard${tick(s.difficulty === 'superhard')}
Hard, but ${A_DARK} dark hints cannot be used.`;
}

export function hardModeViolationText(
  violation: HardModeViolation,
  superHard: boolean,
  emojiPack: EmojiPackConfig | null
): string {
  const mode = superHard ? 'Super-hard' : 'Hard';
  const required = violation.required
    .map((hint) => formatTileLetter(hint.letter, hint.color, emojiPack))
    .join(' ');
  const forbidden = violation.forbidden.map((letter) => formatTileLetter(letter, 'dark-gray', emojiPack)).join(' ');

  if (required && forbidden) return `${mode}: you must use ${required}.\nYou cannot use ${forbidden}`;
  if (required) return `${mode}: you must use ${required}`;
  return `${mode}: you cannot use ${forbidden}`;
}

export function alreadyGuessedText(word: string, answer: string, emojiPack: EmojiPackConfig | null): string {
  const tiles = scoreGuess(answer, word)
    .map((status, index) => formatTileLetter(word[index], tileStatusColor(status), emojiPack))
    .join(' ');

  return [emojiPack ? ALREADY_GUESSED : null, `${tiles} was already guessed`].filter(Boolean).join(' ');
}

export function giveUpText(answer: string): string {
  return `${GAME_OVER} Game Over! The word was ${answer.toUpperCase()}.`;
}

export function creativityHelpText(s: ChatSettings): string {
  return `Toggle /creativity ${toggleIcon(s.creativity.enabled)}
Turns creativity on or off using the saved frame.

Time frame /creativity 30m${tick(s.creativity.configured && s.creativity.mode === 'time')}
Bans words used within a time window. Supports s, m, h, d.

Word frame /creativity 15w${tick(s.creativity.configured && s.creativity.mode === 'count')}
Bans the last N used words.`;
}

function tick(enabled: boolean): string {
  return enabled ? ` ${TICK}` : '';
}

function toggleIcon(enabled: boolean): string {
  return enabled ? TICK : FORBIDDEN;
}

function tileStatusColor(status: TileStatus): TileColor {
  if (status === 'correct') return 'green';
  if (status === 'present') return 'yellow';
  return 'dark-gray';
}

export function humanDuration(seconds: number): string {
  if (seconds % 86400 === 0 && seconds >= 86400) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0 && seconds >= 3600) return `${seconds / 3600}h`;
  if (seconds % 60 === 0 && seconds >= 60) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/** Parse "30m", "2h", "90s", "1d" → seconds; or "15w" / "15 words" → word count. */
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

export function statsText(s: StatsRow, displayName: string): string {
  const winRate = s.games_played ? Math.round((100 * s.games_won) / s.games_played) : 0;
  const guessAcc = s.guesses_total
    ? `${Math.round((100 * s.greens) / (s.guesses_total * 5))}% green, ${Math.round((100 * s.yellows) / (s.guesses_total * 5))}% yellow`
    : '—';
  const dist = [s.dist1, s.dist2, s.dist3, s.dist4, s.dist5, s.dist6];
  const maxDist = Math.max(1, ...dist);
  const distLines = dist
    .map((n, i) => `${i + 1}: ${'▓'.repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / maxDist) * 8)))} ${n}`)
    .join('\n');
  const fastest = s.fastest_ms !== null ? humanMs(s.fastest_ms) : '—';
  const solveShare = s.games_won ? Math.round((100 * s.solves) / s.games_won) : 0;

  return `📊 Stats — ${displayName}

Games played: ${s.games_played}
Games won (with the group): ${s.games_won} (${winRate}%)
Winning guesses by you: ${s.solves}${s.games_won ? ` — you land the final word in ${solveShare}% of wins` : ''}
Current streak: ${s.current_streak} · Best streak: ${s.best_streak}
Fastest solve: ${fastest}

Guesses made: ${s.guesses_total}
Letter accuracy: ${guessAcc}

Winning-guess distribution
${distLines}

🏆 Tournaments: ${s.tournaments_played} played · ${s.tournaments_won} won · ${s.tournament_points} pts
⚔️ Duels: ${s.duels_played} played · ${s.duels_won} won`;
}

export function humanMs(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export function standingsText(t: TournamentRow): string {
  const rows = [...t.players]
    .map((p) => ({ p, pts: t.scores[String(p.userId)] ?? 0 }))
    .sort((a, b) => b.pts - a.pts)
    .map((r, i) => `${i + 1}. ${r.p.userName} — ${r.pts} pts`);
  return rows.join('\n');
}

export function turnOrderText(t: TournamentRow): string {
  return roundOrder(t.players, t.current_round)
    .map((p) => p.userName)
    .join(' → ');
}
