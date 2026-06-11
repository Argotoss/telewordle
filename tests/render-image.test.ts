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

describe('vs card', () => {
  it('renders a PNG with initials fallback when avatars are missing', async () => {
    const { renderVsCard } = await import('../src/render/vscard.js');
    const png = await renderVsCard({ name: 'Alice', avatar: null }, { name: 'Bob Smith', avatar: null }, [
      { label: 'Won games', a: '2', b: '0', winner: 'a' },
      { label: 'Win rate', a: 'n/a', b: 'n/a', winner: 'tie' },
    ]);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.length).toBeGreaterThan(5000);
  });
});

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
