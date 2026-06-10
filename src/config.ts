import 'dotenv/config';

export const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
export const DB_PATH = process.env.DB_PATH ?? 'telewordle.db';

export function assertConfig(): void {
  if (!BOT_TOKEN) {
    console.error('Missing BOT_TOKEN. Copy .env.example to .env and paste the token from @BotFather.');
    process.exit(1);
  }
}
