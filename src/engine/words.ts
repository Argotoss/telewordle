import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LANGUAGE, getLanguage } from './languages.js';

const DATA_DIR = process.env.WORDLE_DATA_DIR ?? join(process.cwd(), 'data');

export const MIN_WORD_LENGTH = 3;
export const MAX_WORD_LENGTH = 10;
export const DEFAULT_WORD_LENGTH = 5;
/** a length is playable only when it has at least this many possible answers */
const MIN_ANSWERS_PER_LENGTH = 40;

export interface WordList {
  answers: string[];
  valid: Set<string>;
}

interface LanguageBuckets {
  byLength: Map<number, WordList>;
}

const cache = new Map<string, LanguageBuckets>();

function loadWords(lang: string, file: string): string[] {
  const l = getLanguage(lang);
  return readFileSync(join(DATA_DIR, 'words', l.code, file), 'utf8')
    .split('\n')
    .map((w) => l.normalize(w.trim()))
    .filter((w) => w.length >= MIN_WORD_LENGTH && w.length <= MAX_WORD_LENGTH && l.pattern.test(w));
}

function buckets(lang: string): LanguageBuckets {
  const code = getLanguage(lang).code;
  let b = cache.get(code);
  if (!b) {
    const byLength = new Map<number, WordList>();
    for (const w of loadWords(code, 'answers.txt')) {
      let list = byLength.get(w.length);
      if (!list) byLength.set(w.length, (list = { answers: [], valid: new Set() }));
      list.answers.push(w);
      list.valid.add(w);
    }
    for (const w of loadWords(code, 'allowed.txt')) {
      byLength.get(w.length)?.valid.add(w);
    }
    for (const [len, list] of byLength) {
      if (list.answers.length < MIN_ANSWERS_PER_LENGTH) byLength.delete(len);
    }
    b = { byLength };
    cache.set(code, b);
  }
  return b;
}

export function wordList(lang: string = DEFAULT_LANGUAGE, length: number = DEFAULT_WORD_LENGTH): WordList {
  return buckets(lang).byLength.get(length) ?? { answers: [], valid: new Set() };
}

/** Word lengths actually playable in this language (enough answers exist). */
export function availableLengths(lang: string = DEFAULT_LANGUAGE): number[] {
  return [...buckets(lang).byLength.keys()].sort((a, b) => a - b);
}

/** Validity is judged against the bucket matching the word's own length. */
export function isValidWord(word: string, lang: string = DEFAULT_LANGUAGE): boolean {
  const w = getLanguage(lang).normalize(word);
  return wordList(lang, w.length).valid.has(w);
}

/** Random answer of the given length, excluding `exclude` (creativity mode). */
export function pickAnswer(
  exclude: Set<string> = new Set(),
  lang: string = DEFAULT_LANGUAGE,
  length: number = DEFAULT_WORD_LENGTH
): string {
  const { answers } = wordList(lang, length);
  const pool = exclude.size ? answers.filter((w) => !exclude.has(w)) : answers;
  const from = pool.length ? pool : answers; // never brick the game if everything is excluded
  return from[Math.floor(Math.random() * from.length)];
}

/** Deterministic word of the day per language, length, and date. */
export function dailyAnswer(
  dateStr: string,
  lang: string = DEFAULT_LANGUAGE,
  length: number = DEFAULT_WORD_LENGTH
): string {
  const { answers } = wordList(lang, length);
  let h = 2166136261;
  for (const c of `${getLanguage(lang).code}:${length}:${dateStr}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return answers[(h >>> 0) % answers.length];
}

/** Kept for tests/back-compat: the English 5-letter answer list. */
export const ANSWERS: string[] = wordList('en', 5).answers;
