import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENROUTER_MODEL } from '../config.js';

const DEFINE_SYSTEM_PROMPT =
  'You write one-sentence dictionary definitions for a word game. Reply with only the definition sentence — no preamble, no quotes, no markdown. Write the definition in the same language as the word.';

/**
 * Definition of the answer word, best source first:
 *  1. DeepSeek v4 via OpenRouter (OPENROUTER_API_KEY) — smart, near-free
 *  2. Claude (ANTHROPIC_API_KEY) — fallback AI source
 *  3. dictionaryapi.dev (en) / ru.wiktionary.org (ru) — free, keyless
 * Everything is best-effort: any failure falls through, and a final null
 * just means the caller skips the 📖 line.
 */
export async function fetchDefinition(word: string, lang: string): Promise<string | null> {
  const ai = (await fetchOpenRouterDefinition(word, lang)) ?? (await fetchClaudeDefinition(word, lang));
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

function defineUserPrompt(word: string, lang: string): string {
  const langName = lang === 'ru' ? 'Russian' : 'English';
  return `Define the ${langName} word "${word}".`;
}

function formatAiDefinition(word: string, raw: string | undefined | null): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').replace(/^["'«»]+|["'«»]+$/g, '').trim();
  if (!text) return null;
  return `📖 ${word.toUpperCase()} — ${text.slice(0, 300)}`;
}

async function fetchOpenRouterDefinition(word: string, lang: string): Promise<string | null> {
  if (!OPENROUTER_API_KEY) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: 300,
        // a one-sentence definition needs no chain-of-thought; without this,
        // v4-pro burns the whole token budget on reasoning and returns nothing
        reasoning: { enabled: false },
        messages: [
          { role: 'system', content: DEFINE_SYSTEM_PROMPT },
          { role: 'user', content: defineUserPrompt(word, lang) },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return formatAiDefinition(word, data?.choices?.[0]?.message?.content);
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
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 200,
      system: DEFINE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: defineUserPrompt(word, lang) }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
    return formatAiDefinition(word, text);
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
