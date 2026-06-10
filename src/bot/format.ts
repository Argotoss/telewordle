import { ChatSettings, Difficulty, StatsRow, TournamentRow } from '../db.js';
import { roundOrder } from '../game/service.js';

export const HELP_TEXT = `🟩 Wordle Bot — How to Play

/play starts a game with a random 5-letter word.
Guess it in 6 tries — everyone in the chat plays together!

🟩 Green  — right letter, right spot
🟨 Yellow — right letter, wrong spot
⬛ Gray   — letter not in the word

Commands
/play — start a new game
/guess WORD — submit a guess
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

export function describeCreativity(s: ChatSettings): string {
  if (!s.creativity.enabled) return 'off';
  return s.creativity.mode === 'time'
    ? `on — words from the last ${humanDuration(s.creativity.seconds)} are banned`
    : `on — the last ${s.creativity.count} words are banned`;
}

export function settingsText(s: ChatSettings): string {
  return `⚙️ Settings for this chat

• Bare-word guessing: ${s.bareWord ? 'ON — any valid 5-letter word counts as a guess' : 'OFF — use /guess WORD'}
• Board style: ${s.render === 'image' ? '🖼 image' : '🔤 text'}
• Difficulty: ${DIFFICULTY_LABEL[s.difficulty]}
• Creativity mode: ${describeCreativity(s)}
• Max failed attempts (tournaments): ${s.maxFails > 0 ? `${s.maxFails} per turn` : 'unlimited'}

Difficulty: hard = every green/yellow hint must be used in later guesses; super hard = additionally, gray letters may not be played again.

Creativity mode bans recently used words (as guesses AND as answers).
Configure it with:
  /settings creativity 30m   (time window: s/m/h/d)
  /settings creativity 15 words   (last N words)

Max failed attempts: in tournaments, rejected guesses (unknown word, hard-mode or creativity violations) by the player at turn count as fails — hit the limit and the turn passes on. Configure with:
  /settings fails 5   (or: /settings fails off)

Note: bare-word guessing needs the bot to see all messages — disable privacy mode via @BotFather (/setprivacy) or make the bot a group admin.`;
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
