import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LANGUAGE, getLanguage } from './languages.js';

const DATA_DIR = process.env.WORDLE_DATA_DIR ?? join(process.cwd(), 'data');

interface WordList {
  answers: string[];
  valid: Set<string>;
}

const cache = new Map<string, WordList>();

function loadList(lang: string, file: string): string[] {
  const l = getLanguage(lang);
  return readFileSync(join(DATA_DIR, 'words', l.code, file), 'utf8')
    .split('\n')
    .map((w) => l.normalize(w.trim()))
    .filter((w) => w.length === 5 && l.pattern.test(w));
}

export function wordList(lang: string = DEFAULT_LANGUAGE): WordList {
  const code = getLanguage(lang).code;
  let list = cache.get(code);
  if (!list) {
    const answers = loadList(code, 'answers.txt');
    list = { answers, valid: new Set([...answers, ...loadList(code, 'allowed.txt')]) };
    cache.set(code, list);
  }
  return list;
}

export function isValidWord(word: string, lang: string = DEFAULT_LANGUAGE): boolean {
  return wordList(lang).valid.has(getLanguage(lang).normalize(word));
}

/** Random answer, excluding any words in `exclude` (creativity mode). */
export function pickAnswer(exclude: Set<string> = new Set(), lang: string = DEFAULT_LANGUAGE): string {
  const { answers } = wordList(lang);
  const pool = exclude.size ? answers.filter((w) => !exclude.has(w)) : answers;
  const from = pool.length ? pool : answers; // never brick the game if everything is excluded
  return from[Math.floor(Math.random() * from.length)];
}

/** Deterministic word of the day: everyone gets the same word per language per date. */
export function dailyAnswer(dateStr: string, lang: string = DEFAULT_LANGUAGE): string {
  const { answers } = wordList(lang);
  let h = 2166136261;
  for (const c of `${getLanguage(lang).code}:${dateStr}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return answers[(h >>> 0) % answers.length];
}

/** Kept for tests/back-compat: the English answer list. */
export const ANSWERS: string[] = wordList('en').answers;
