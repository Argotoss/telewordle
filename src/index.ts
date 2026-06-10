import { Bot } from 'grammy';
import { registerHandlers } from './bot/handlers.js';
import { BOT_TOKEN, DB_PATH, assertConfig } from './config.js';
import { openDb } from './db.js';

assertConfig();

const db = openDb(DB_PATH);
const bot = new Bot(BOT_TOKEN);

registerHandlers(bot, db);

bot.catch((err) => {
  console.error('Bot error:', err.error);
});

const COMMANDS = [
  { command: 'play', description: 'Start a new game' },
  { command: 'guess', description: 'Guess a 5-letter word' },
  { command: 'board', description: 'Show the current board' },
  { command: 'giveup', description: 'End the game and reveal the word' },
  { command: 'stats', description: 'Your stats in this chat' },
  { command: 'tournament', description: 'Start a turn-based tournament' },
  { command: 'challenge', description: 'Duel a friend' },
  { command: 'settings', description: 'Chat settings' },
  { command: 'help', description: 'How to play' },
];

async function main(): Promise<void> {
  await bot.api.setMyCommands(COMMANDS);
  console.log('telewordle is running (long polling). Press Ctrl+C to stop.');
  await bot.start();
}

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
