// Custom emoji tile packs (adopted from PR #2 by @ExposedCat).
// A pack is a Telegram custom-emoji sticker set with 105 tiles: A-Z in four
// colors (gray, yellow, green, dark-gray) plus one empty dark tile, in
// orderedTileKeys() order. When a chat configures one via /usepack, hint
// messages render real Wordle-style tiles; otherwise we fall back to
// ordinary emoji + letters.

export type TileColor = 'gray' | 'yellow' | 'green' | 'dark-gray';
export type TileKey = `${string}-${TileColor}`;

export interface EmojiPackConfig {
  name: string;
  tiles: Record<TileKey, string>;
}

type CustomEmojiSticker = {
  custom_emoji_id?: string;
};

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const COLORS: TileColor[] = ['gray', 'yellow', 'green', 'dark-gray'];
export const EMPTY_TILE_KEY: TileKey = 'empty-dark-gray';
export const FALLBACK_EMOJI = '🔠';

export function tileKey(letter: string, color: TileColor): TileKey {
  return `${letter.toUpperCase()}-${color}`;
}

export function orderedTileKeys(): TileKey[] {
  return [...LETTERS.flatMap((letter) => COLORS.map((color) => tileKey(letter, color))), EMPTY_TILE_KEY];
}

export function emojiPackFromStickers(name: string, stickers: CustomEmojiSticker[]): EmojiPackConfig {
  const keys = orderedTileKeys();
  if (stickers.length !== keys.length) {
    throw new Error(`Expected ${keys.length} emoji, got ${stickers.length}.`);
  }

  const tiles: Record<TileKey, string> = {};
  for (const [index, key] of keys.entries()) {
    const id = stickers[index].custom_emoji_id;
    if (id === undefined) {
      throw new Error(`Sticker ${index + 1} is missing custom_emoji_id.`);
    }
    tiles[key] = id;
  }

  return { name, tiles };
}

export function isEmojiPackConfig(value: unknown): value is EmojiPackConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Partial<EmojiPackConfig>;
  if (typeof config.name !== 'string' || typeof config.tiles !== 'object' || config.tiles === null) return false;
  return orderedTileKeys().every((key) => typeof config.tiles?.[key] === 'string');
}

/** Accepts a bare name, a full pack name, or a t.me/addemoji/... link. */
export function packNameCandidates(requestedName: string, botUsername: string): string[] {
  const name = extractPackName(requestedName);
  const suffix = `_by_${botUsername}`;
  if (name.toLowerCase().endsWith(suffix.toLowerCase())) return [name];

  const normalized = buildPackName(name, botUsername);
  return normalized === name ? [name] : [name, normalized];
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatTileLetter(letter: string, color: TileColor, emojiPack: EmojiPackConfig | null): string {
  if (emojiPack) {
    const id = emojiPack.tiles[tileKey(letter, color)];
    return `<tg-emoji emoji-id="${id}">${FALLBACK_EMOJI}</tg-emoji>`;
  }

  const upper = letter.toUpperCase();
  if (color === 'green') return `🟩${upper}`;
  if (color === 'yellow') return `🟨${upper}`;
  if (color === 'dark-gray') return `⬛${upper}`;
  return `◻️${upper}`;
}

function extractPackName(input: string): string {
  const match = input.match(/(?:https?:\/\/)?t\.me\/addemoji\/([A-Za-z0-9_]+)/i);
  return match?.[1] ?? input;
}

function buildPackName(requestedName: string, botUsername: string): string {
  const suffix = `_by_${botUsername}`;
  const maxBaseLength = 64 - suffix.length;
  const base =
    slugifyPackName(requestedName)
      .slice(0, maxBaseLength)
      .replace(/_+$/g, '') || 'pack';

  return `${base}${suffix}`;
}

function slugifyPackName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const withLeadingLetter = /^[a-z]/.test(slug) ? slug : `pack_${slug}`;
  return withLeadingLetter.replace(/_+$/g, '') || 'pack';
}
