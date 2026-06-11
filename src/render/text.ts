import { GameRow } from '../db.js';
import { getLanguage } from '../engine/languages.js';
import { keyboardStatus, scoreGuess, TileStatus } from '../engine/score.js';
import { maxGuessesFor } from '../game/service.js';

/** Show who played each row when more than one person is guessing. */
export function shouldShowNames(game: GameRow): boolean {
  return game.kind !== 'duel' && new Set(game.guesses.map((g) => g.userId)).size > 1;
}

export function shortName(userName: string): string {
  const first = userName.split(/\s+/)[0] ?? userName;
  return first.length > 10 ? `${first.slice(0, 9)}…` : first;
}

const EMOJI: Record<TileStatus, string> = {
  correct: '\u{1F7E9}', // 🟩
  present: '\u{1F7E8}', // 🟨
  absent: '\u{2B1B}', // ⬛
};

export function emojiRow(score: TileStatus[]): string {
  return score.map((s) => EMOJI[s]).join('');
}

function letterRow(word: string): string {
  return word.toUpperCase().split('').join(' ');
}

/** Board for text mode: letters row + emoji row per guess, plus empty slots. */
export function textBoard(game: GameRow, opts: { revealAnswer?: boolean } = {}): string {
  const lines: string[] = [];
  const showNames = shouldShowNames(game);
  for (const g of game.guesses) {
    lines.push(showNames ? `${letterRow(g.word)} · ${shortName(g.userName)}` : letterRow(g.word));
    lines.push(emojiRow(scoreGuess(game.answer, g.word)));
  }
  const remaining = maxGuessesFor(game) - game.guesses.length;
  if (game.status === 'active') {
    for (let i = 0; i < remaining; i++) lines.push('⬜⬜⬜⬜⬜'); // ⬜ empty rows
  }
  if (game.hints.length) {
    lines.push(`💡 ${game.hints.map((h) => h.toUpperCase()).join(', ')} revealed (−${game.hints.length} ${game.hints.length > 1 ? 'tries' : 'try'})`);
  }
  let out = lines.join('\n');
  if (game.status !== 'active' || game.guesses.length > 0) {
    out += '\n\n' + keyboardLine(game);
  }
  if (opts.revealAnswer && game.status === 'lost') {
    out += `\n\nThe word was: ${game.answer.toUpperCase()}`;
  }
  return out;
}

/** Compact letter-status summary, the text-mode equivalent of the on-screen keyboard. */
export function keyboardLine(game: GameRow): string {
  const alphabet = getLanguage(game.lang).alphabet;
  const status = keyboardStatus(game.answer, game.guesses.map((g) => g.word), alphabet);
  const greens: string[] = [];
  const yellows: string[] = [];
  const grays: string[] = [];
  const unused: string[] = [];
  for (const c of alphabet) {
    const s = status.get(c);
    const C = c.toUpperCase();
    if (s === 'correct') greens.push(C);
    else if (s === 'present') yellows.push(C);
    else if (s === 'absent') grays.push(C);
    else unused.push(C);
  }
  const parts: string[] = [];
  if (greens.length) parts.push(`\u{1F7E9} ${greens.join('')}`);
  if (yellows.length) parts.push(`\u{1F7E8} ${yellows.join('')}`);
  if (grays.length) parts.push(`⬛ ${grays.join('')}`);
  if (unused.length) parts.push(`◻️ ${unused.join('')}`);
  return parts.join('  ');
}
