import { ChatSettings, Difficulty, StatsRow, TournamentRow } from '../db.js';
import type { HardModeViolation } from '../engine/hardmode.js';
import { scoreGuess, type TileStatus } from '../engine/score.js';
import { roundOrder } from '../game/service.js';
import { formatTileLetter, type EmojiPackConfig, type TileColor } from '../render/emoji-pack.js';

export const HELP_TEXT = `🟩 Wordle Bot — How to Play

/play starts a game with a random 5-letter word.
Guess it in 6 tries — everyone in the chat plays together!

🟩 Green  — right letter, right spot
🟨 Yellow — right letter, wrong spot
⬛ Gray   — letter not in the word

Commands
/play — start a new game
/guess WORD — submit a guess (/w works too)
/board — show the current board
/giveup — end the game and reveal the word
/stats — your stats in this chat
/tournament N — start an N-round turn-based tournament
/challenge — duel a friend (same word, fewest guesses wins)
/settings — bare-word guessing, image/text mode, difficulty, creativity mode
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
• Difficulty: ${DIFFICULTY_LABEL[s.difficulty]} — ${DIFFICULTY_NOTE[s.difficulty]}
• Creativity: ${describeCreativity(s)} · /settings creativity 30m | 15w
• Max fails: ${s.maxFails > 0 ? `${s.maxFails} per player` : 'unlimited'} · /settings fails 5 | off
• Emoji pack: ${s.emojiPack ? s.emojiPack.name : 'default'} · /usepack NAME | off

Fails: rejected guesses lock you out of the game (tournaments: forfeit your turn).
Bare words need privacy mode off (@BotFather → /setprivacy).`;
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
