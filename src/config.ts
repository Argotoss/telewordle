import 'dotenv/config';

export const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
export const DB_PATH = process.env.DB_PATH ?? 'telewordle.db';
/** Optional: enables AI-written word explanations; dictionaries are the fallback. */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

export function assertConfig(): void {
  if (!BOT_TOKEN) {
    console.error('Missing BOT_TOKEN. Copy .env.example to .env and paste the token from @BotFather.');
    process.exit(1);
  }
}
