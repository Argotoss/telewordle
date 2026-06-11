/**
 * The official NYT Wordle solution of the day. The daily puzzle is sacred:
 * always 5 letters, 6 tries, and — for English — the very same word the rest
 * of the world is playing. Falls back to our deterministic pick when offline.
 */
const cache = new Map<string, string | null>();

export async function fetchOfficialWordle(dateStr: string): Promise<string | null> {
  if (process.env.VITEST) return null; // tests stay offline and deterministic
  if (cache.has(dateStr)) return cache.get(dateStr)!;
  let solution: string | null = null;
  try {
    const res = await fetch(`https://www.nytimes.com/svc/wordle/v2/${dateStr}.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { solution?: string };
      const word = (data.solution ?? '').toLowerCase().trim();
      if (/^[a-z]{5}$/.test(word)) solution = word;
    }
  } catch {
    // offline or NYT hiccup — caller falls back to the deterministic pick
  }
  cache.set(dateStr, solution);
  return solution;
}
