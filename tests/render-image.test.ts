import { describe, expect, it } from 'vitest';
import type { GameRow } from '../src/db.js';
import { renderBoardImage, renderBoardSticker, renderKeyboardSticker } from '../src/render/image.js';

function game(answer: string, guesses: string[]): GameRow {
  return {
    id: 1,
    chat_id: 1,
    answer,
    status: 'active',
    kind: 'normal',
    guesses: guesses.map((word, index) => ({ word, userId: 1, userName: 'Ada', ts: index })),
    started_at: 0,
    finished_at: null,
    tournament_id: null,
    duel_id: null,
  };
}

function expectWebp(buffer: Buffer): void {
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
}

describe('rendering', () => {
  it('renders the classic PNG board', () => {
    const png = renderBoardImage(game('water', ['trace']));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('renders board and keyboard stickers as WebP images', () => {
    const row = game('water', ['trace', 'wheat']);
    expectWebp(renderBoardSticker(row));
    expectWebp(renderKeyboardSticker(row));
  });
});
