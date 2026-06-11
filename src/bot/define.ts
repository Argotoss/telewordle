/** Free dictionary lookup for the answer word. English only for now. */
export async function fetchDefinition(word: string, lang: string): Promise<string | null> {
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
