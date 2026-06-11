import { describe, expect, it } from 'vitest';
import {
  EmojiPackConfig,
  emojiPackFromStickers,
  formatTileLetter,
  isEmojiPackConfig,
  orderedTileKeys,
  packNameCandidates,
} from '../src/render/emoji-pack.js';

function pack(): EmojiPackConfig {
  return {
    name: 'test_pack',
    tiles: Object.fromEntries(orderedTileKeys().map((key) => [key, `${key}-id`])) as EmojiPackConfig['tiles'],
  };
}

describe('orderedTileKeys', () => {
  it('has 26 letters × 4 colors + 1 empty tile', () => {
    expect(orderedTileKeys()).toHaveLength(26 * 4 + 1);
  });
});

describe('emojiPackFromStickers', () => {
  it('maps stickers to tile keys in order', () => {
    const stickers = orderedTileKeys().map((key) => ({ custom_emoji_id: `${key}-id` }));
    const config = emojiPackFromStickers('p', stickers);
    expect(config.tiles['A-gray']).toBe('A-gray-id');
    expect(config.tiles['Z-dark-gray']).toBe('Z-dark-gray-id');
    expect(isEmojiPackConfig(config)).toBe(true);
  });

  it('rejects wrong sticker counts', () => {
    expect(() => emojiPackFromStickers('p', [{ custom_emoji_id: 'x' }])).toThrow(/Expected 105/);
  });
});

describe('isEmojiPackConfig', () => {
  it('rejects junk', () => {
    expect(isEmojiPackConfig(null)).toBe(false);
    expect(isEmojiPackConfig({ name: 'x', tiles: {} })).toBe(false);
  });
});

describe('formatTileLetter', () => {
  it('uses custom emoji ids when a pack is set', () => {
    expect(formatTileLetter('c', 'dark-gray', pack())).toContain('C-dark-gray-id');
  });

  it('falls back to colored squares without a pack', () => {
    expect(formatTileLetter('c', 'dark-gray', null)).toBe('⬛C');
    expect(formatTileLetter('w', 'green', null)).toBe('🟩W');
    expect(formatTileLetter('a', 'yellow', null)).toBe('🟨A');
  });
});

describe('packNameCandidates', () => {
  it('accepts t.me/addemoji links', () => {
    expect(packNameCandidates('https://t.me/addemoji/MyTiles_by_somebot', 'somebot')).toEqual(['MyTiles_by_somebot']);
  });

  it('also tries the bot-suffixed name for bare names', () => {
    expect(packNameCandidates('MyTiles', 'somebot')).toEqual(['MyTiles', 'mytiles_by_somebot']);
  });
});
