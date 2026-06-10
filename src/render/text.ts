import { GameRow } from '../db.js';
import { keyboardStatus, scoreGuess, TileStatus } from '../engine/score.js';
import { MAX_GUESSES } from '../game/service.js';

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
export function textBoard(game: GameRow, opts: { revealAnswer?: boolean; includeKeyboard?: boolean } = {}): string {
  const lines: string[] = [];
  for (const g of game.guesses) {
    lines.push(letterRow(g.word));
    lines.push(emojiRow(scoreGuess(game.answer, g.word)));
  }
  const remaining = MAX_GUESSES - game.guesses.length;
  if (game.status === 'active') {
    for (let i = 0; i < remaining; i++) lines.push('⬜⬜⬜⬜⬜'); // ⬜ empty rows
  }
  let out = lines.join('\n');
  if ((opts.includeKeyboard ?? true) && (game.status !== 'active' || game.guesses.length > 0)) {
    out += '\n\n' + keyboardLine(game);
  }
  if (opts.revealAnswer && game.status === 'lost') {
    out += `\n\nThe word was: ${game.answer.toUpperCase()}`;
  }
  return out;
}

/** Compact letter-status summary. Absent letters are hidden; unused letters stay gray. */
export function keyboardLine(game: GameRow): string {
  const status = keyboardStatus(game.answer, game.guesses.map((g) => g.word));
  const greens: string[] = [];
  const yellows: string[] = [];
  const unused: string[] = [];
  for (const c of 'abcdefghijklmnopqrstuvwxyz') {
    const s = status.get(c);
    const C = c.toUpperCase();
    if (s === 'correct') greens.push(C);
    else if (s === 'present') yellows.push(C);
    else unused.push(C);
  }
  const parts: string[] = [];
  if (greens.length) parts.push(`\u{1F7E9} ${greens.join('')}`);
  if (yellows.length) parts.push(`\u{1F7E8} ${yellows.join('')}`);
  if (unused.length) parts.push(`◻️ ${unused.join('')}`);
  return parts.join('  ');
}
