// Renders a sample board to /tmp/telewordle-sample.png and prints the text-mode
// equivalent, so the visual output can be checked without a Telegram token.
import { writeFileSync } from 'node:fs';
import { GameRow } from '../src/db.js';
import { renderBoardImage, renderBoardSticker, renderKeyboardSticker } from '../src/render/image.js';
import { textBoard } from '../src/render/text.js';

const mk = (word: string, userId: number, userName: string) => ({ word, userId, userName, ts: 0 });

const game: GameRow = {
  id: 1,
  chat_id: 1,
  answer: 'water',
  status: 'active',
  kind: 'normal',
  guesses: [mk('sport', 1, 'A'), mk('trace', 1, 'A'), mk('react', 1, 'A'), mk('water', 1, 'A')],
  started_at: 0,
  finished_at: null,
  tournament_id: null,
  duel_id: null,
};

const pngOut = '/tmp/telewordle-sample.png';
const boardWebpOut = '/tmp/telewordle-board-sample.webp';
const keyboardWebpOut = '/tmp/telewordle-keyboard-sample.webp';
writeFileSync(pngOut, renderBoardImage(game));
writeFileSync(boardWebpOut, renderBoardSticker(game));
writeFileSync(keyboardWebpOut, renderKeyboardSticker(game));
console.log(`wrote ${pngOut}, ${boardWebpOut}, ${keyboardWebpOut}`);
console.log('--- text mode ---');
console.log(textBoard(game));
