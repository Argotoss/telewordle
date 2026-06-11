/**
 * Language registry. Adding a language = one entry here plus
 * data/words/<code>/answers.txt and allowed.txt word lists.
 */
export interface Language {
  code: string;
  label: string;
  /** all letters, lowercase, in display order for the text-mode keyboard line */
  alphabet: string;
  /** keyboard rows (uppercase) for image/sticker rendering */
  keyRows: string[];
  /** matches one full bare guess in this language (any playable length) */
  pattern: RegExp;
  /** canonicalize input (e.g. Russian ё → е) */
  normalize: (word: string) => string;
}

export const LANGUAGES: Record<string, Language> = {
  en: {
    code: 'en',
    label: '🇬🇧 English',
    alphabet: 'abcdefghijklmnopqrstuvwxyz',
    keyRows: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
    pattern: /^[a-zA-Z]{3,10}$/,
    normalize: (w) => w.toLowerCase(),
  },
  ru: {
    code: 'ru',
    label: '🇷🇺 Русский',
    alphabet: 'абвгдежзийклмнопрстуфхцчшщъыьэюя',
    keyRows: ['ЙЦУКЕНГШЩЗХЪ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'],
    pattern: /^[а-яёА-ЯЁ]{3,10}$/u,
    normalize: (w) => w.toLowerCase().replace(/ё/g, 'е'),
  },
};

export const DEFAULT_LANGUAGE = 'en';

export function getLanguage(code: string | null | undefined): Language {
  return LANGUAGES[code ?? DEFAULT_LANGUAGE] ?? LANGUAGES[DEFAULT_LANGUAGE];
}

/** true if the text could be a bare guess in ANY language (cheap pre-filter). */
export function looksLikeGuess(text: string): boolean {
  return Object.values(LANGUAGES).some((l) => l.pattern.test(text));
}
