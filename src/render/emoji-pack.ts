import type { GameRow } from '../db.js';
import { KeyStatus, keyboardStatus } from '../engine/score.js';

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

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

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

export function packNameCandidates(requestedName: string, botUsername: string): string[] {
  const name = extractPackName(requestedName);
  const suffix = `_by_${botUsername}`;
  if (name.toLowerCase().endsWith(suffix.toLowerCase())) return [name];

  const normalized = buildPackName(name, botUsername);
  return normalized === name ? [name] : [name, normalized];
}

export function normalizeExistingPackName(requestedName: string, botUsername: string): string {
  return packNameCandidates(requestedName, botUsername)[0];
}

export function renderKeyboardList(game: GameRow, emojiPack: EmojiPackConfig | null): string {
  const status = keyboardStatus(
    game.answer,
    game.guesses.map((g) => g.word)
  );

  return KEY_ROWS.map((row) => {
    return row
      .split('')
      .flatMap((letter) => {
        const keyStatus = status.get(letter.toLowerCase()) ?? 'unused';
        if (keyStatus === 'absent') return [];
        return [formatKeyboardLetter(letter, keyStatus, emojiPack)];
      })
      .join(' ');
  })
    .filter(Boolean)
    .join('\n');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatKeyboardLetter(letter: string, status: Exclude<KeyStatus, 'absent'>, emojiPack: EmojiPackConfig | null): string {
  if (emojiPack) {
    const id = emojiPack.tiles[tileKey(letter, keyboardColor(status))];
    return `<tg-emoji emoji-id="${id}">${FALLBACK_EMOJI}</tg-emoji>`;
  }

  const upper = letter.toUpperCase();
  if (status === 'correct') return `🟩${upper}`;
  if (status === 'present') return `🟨${upper}`;
  return `◻️${upper}`;
}

function keyboardColor(status: Exclude<KeyStatus, 'absent'>): TileColor {
  if (status === 'correct') return 'green';
  if (status === 'present') return 'yellow';
  return 'gray';
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
