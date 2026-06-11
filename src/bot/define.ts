/**
 * Dictionary lookups for the answer word.
 *  - English: dictionaryapi.dev (free, keyless)
 *  - Russian: ru.wiktionary.org plain-text extracts (free, keyless)
 * Both are best-effort: any failure returns null and the caller just skips the 📖 line.
 */
export async function fetchDefinition(word: string, lang: string): Promise<string | null> {
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
