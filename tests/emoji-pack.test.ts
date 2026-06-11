import { describe, expect, it } from 'vitest';
import type { GameRow } from '../src/db.js';
import { EmojiPackConfig, formatTileLetter, orderedTileKeys, renderKeyboardList } from '../src/render/emoji-pack.js';

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

function pack(): EmojiPackConfig {
  return {
    name: 'test_pack',
    tiles: Object.fromEntries(orderedTileKeys().map((key) => [key, `${key}-id`])) as EmojiPackConfig['tiles'],
  };
}

describe('renderKeyboardList', () => {
  it('omits absent letters and keeps unused letters visible', () => {
    const text = renderKeyboardList(game('water', ['trace']), null);

    expect(text).toContain('🟨T');
    expect(text).toContain('🟨R');
    expect(text).toContain('🟨A');
    expect(text).toContain('🟨E');
    expect(text).toContain('◻️Q');
    expect(text).not.toContain('C');
  });

  it('uses gray, yellow, and green custom emoji ids', () => {
    const text = renderKeyboardList(game('water', ['trace', 'wheat']), pack());

    expect(text).toContain('Q-gray-id');
    expect(text).toContain('W-green-id');
    expect(text).toContain('R-yellow-id');
    expect(text).not.toContain('C-dark-gray-id');
  });
});

describe('formatTileLetter', () => {
  it('uses dark-gray tiles for forbidden custom emoji letters', () => {
    expect(formatTileLetter('c', 'dark-gray', pack())).toContain('C-dark-gray-id');
  });

  it('falls back to dark square letters without a custom emoji pack', () => {
    expect(formatTileLetter('c', 'dark-gray', null)).toBe('⬛C');
  });
});
