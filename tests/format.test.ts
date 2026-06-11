import { describe, expect, it } from 'vitest';
import { alreadyGuessedText, hardModeViolationText } from '../src/bot/format.js';
import { EmojiPackConfig, orderedTileKeys } from '../src/render/emoji-pack.js';

function pack(): EmojiPackConfig {
  return {
    name: 'test_pack',
    tiles: Object.fromEntries(orderedTileKeys().map((key) => [key, `${key}-id`])) as EmojiPackConfig['tiles'],
  };
}

describe('hardModeViolationText', () => {
  it('formats required hints as colored letters', () => {
    expect(
      hardModeViolationText(
        {
          required: [
            { letter: 'W', color: 'green' },
            { letter: 'A', color: 'yellow' },
          ],
          forbidden: [],
        },
        false,
        null
      )
    ).toBe('😤 Hard mode: you must use 🟩W 🟨A');
  });

  it('formats super-hard forbidden hints on a second line', () => {
    expect(
      hardModeViolationText(
        {
          required: [
            { letter: 'R', color: 'yellow' },
            { letter: 'A', color: 'yellow' },
            { letter: 'E', color: 'yellow' },
          ],
          forbidden: ['C'],
        },
        true,
        null
      )
    ).toBe('🔥 Super hard mode: you must use 🟨R 🟨A 🟨E.\nYou cannot use ⬛C');
  });

  it('uses custom emoji tiles when a pack is set', () => {
    const text = hardModeViolationText({ required: [{ letter: 'W', color: 'green' }], forbidden: [] }, false, pack());
    expect(text).toContain('W-green-id');
  });
});

describe('alreadyGuessedText', () => {
  it('shows the scored word as fallback tiles', () => {
    expect(alreadyGuessedText('trace', 'water', null)).toBe('♻️ 🟨T 🟨R 🟨A ⬛C 🟨E was already guessed');
  });

  it('uses custom emoji tiles for the scored word', () => {
    const text = alreadyGuessedText('water', 'water', pack());
    for (const letter of ['W', 'A', 'T', 'E', 'R']) {
      expect(text).toContain(`${letter}-green-id`);
    }
  });
});
