import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.WORDLE_DATA_DIR ?? join(process.cwd(), 'data');

function loadList(file: string): string[] {
  return readFileSync(join(DATA_DIR, file), 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{5}$/.test(w));
}

export const ANSWERS: string[] = loadList('answers.txt');
const VALID: Set<string> = new Set([...ANSWERS, ...loadList('allowed.txt')]);

export function isValidWord(word: string): boolean {
  return VALID.has(word.toLowerCase());
}

/** Random answer, excluding any words in `exclude` (creativity mode). */
export function pickAnswer(exclude: Set<string> = new Set()): string {
  const pool = exclude.size ? ANSWERS.filter((w) => !exclude.has(w)) : ANSWERS;
  const from = pool.length ? pool : ANSWERS; // never brick the game if everything is excluded
  return from[Math.floor(Math.random() * from.length)];
}
