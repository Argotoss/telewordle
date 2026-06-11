import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '../config.js';

/**
 * Definition of the answer word, best source first:
 *  1. Claude (only when ANTHROPIC_API_KEY is set) — natural one-sentence
 *     explanations in the game's language, works for every word incl. slang
 *  2. dictionaryapi.dev (en) / ru.wiktionary.org (ru) — free, keyless
 * Everything is best-effort: any failure falls through, and a final null
 * just means the caller skips the 📖 line.
 */
export async function fetchDefinition(word: string, lang: string): Promise<string | null> {
  const ai = await fetchClaudeDefinition(word, lang);
  if (ai) return ai;
  if (lang === 'ru') return fetchRussianDefinition(word);
  if (lang !== 'en') return null;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const meaning = data?.[0]?.meanings?.[0];
    const def = meaning?.definitions?.[0]?.definition;
    if (!def) return null;
    const pos = meaning?.partOfSpeech ? ` (${meaning.partOfSpeech})` : '';
    return `📖 ${word.toUpperCase()}${pos} — ${String(def).slice(0, 300)}`;
  } catch {
    return null;
  }
}

let claude: Anthropic | null = null;

function claudeClient(): Anthropic | null {
  if (!ANTHROPIC_API_KEY) return null;
  claude ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 8000, maxRetries: 1 });
  return claude;
}

async function fetchClaudeDefinition(word: string, lang: string): Promise<string | null> {
  const client = claudeClient();
  if (!client) return null;
  try {
    const langName = lang === 'ru' ? 'Russian' : 'English';
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 200,
      system:
        'You write one-sentence dictionary definitions for a word game. Reply with only the definition sentence — no preamble, no quotes, no markdown. Write the definition in the same language as the word.',
      messages: [{ role: 'user', content: `Define the ${langName} word "${word}".` }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;
    return `📖 ${word.toUpperCase()} — ${text.slice(0, 300)}`;
  } catch {
    return null;
  }
}

async function fetchRussianDefinition(word: string): Promise<string | null> {
  try {
    const url =
      'https://ru.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&format=json&redirects=1&titles=' +
      encodeURIComponent(word);
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const page = Object.values(data?.query?.pages ?? {})[0] as any;
    const def = firstRussianMeaning(String(page?.extract ?? ''));
    if (!def) return null;
    return `📖 ${word.toUpperCase()} — ${def.slice(0, 300)}`;
  } catch {
    return null;
  }
}

const SECTION_AFTER_MEANING = /^(Синонимы|Антонимы|Гиперонимы|Гипонимы|Согипонимы|Холонимы|Меронимы|Родственные слова|Этимология|Фразеологизмы|Перевод|Библиография|Анаграммы)/;

/** Pull the first meaning line out of a ru.wiktionary plain-text extract. */
export function firstRussianMeaning(extract: string): string | null {
  const lines = extract.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => l === 'Значение');
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (SECTION_AFTER_MEANING.test(line)) break;
    const def = line.split('◆')[0].trim(); // ◆ starts the usage examples
    if (def && def !== '?' && def.length > 2) return def;
  }
  return null;
}
