import { describe, expect, it } from 'vitest';
import { alreadyGuessedText, giveUpText, hardModeViolationText } from '../src/bot/format.js';
import { EmojiPackConfig, orderedTileKeys } from '../src/render/emoji-pack.js';

function pack(): EmojiPackConfig {
  return {
    name: 'test_pack',
    tiles: Object.fromEntries(orderedTileKeys().map((key) => [key, `${key}-id`])) as EmojiPackConfig['tiles'],
  };
}

describe('hardModeViolationText', () => {
  it('formats required hard-mode hints as colored letters', () => {
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
    ).toBe('Hard: you must use 🟩W 🟨A');
  });

  it('formats super-hard forbidden hints on a darker second line', () => {
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
    ).toBe('Super-hard: you must use 🟨R 🟨A 🟨E.\nYou cannot use ⬛C');
  });
});

describe('alreadyGuessedText', () => {
  it('uses the custom already-guessed emoji and fallback scored letters', () => {
    expect(alreadyGuessedText('trace', 'water', null)).toBe(
      '🟨T 🟨R 🟨A ⬛C 🟨E was already guessed'
    );
  });

  it('uses custom emoji tiles for the scored word', () => {
    const text = alreadyGuessedText('water', 'water', pack());

    expect(text).toContain('5845943483382110702');
    expect(text).toContain('W-green-id');
    expect(text).toContain('A-green-id');
    expect(text).toContain('T-green-id');
    expect(text).toContain('E-green-id');
    expect(text).toContain('R-green-id');
  });
});

describe('giveUpText', () => {
  it('uses the custom game-over emoji label and reveals the answer', () => {
    expect(giveUpText('water')).toBe(
      '<tg-emoji emoji-id="5927054181285237634">🏳️</tg-emoji> Game Over! The word was WATER.'
    );
  });
});
