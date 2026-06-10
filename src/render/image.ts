import { createCanvas } from '@napi-rs/canvas';
import { GameRow } from '../db.js';
import { keyboardStatus, scoreGuess, TileStatus } from '../engine/score.js';
import { MAX_GUESSES } from '../game/service.js';

// Classic Wordle palette
const COLORS = {
  bg: '#121213',
  correct: '#538d4e',
  present: '#b59f3b',
  absent: '#3a3a3c',
  emptyBorder: '#3a3a3c',
  keyUnused: '#818384',
  text: '#ffffff',
};

const TILE = 62;
const TILE_GAP = 6;
const BOARD_COLS = 5;
const PAD = 24;

const KEY_W = 40;
const KEY_H = 54;
const KEY_GAP = 6;
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

const FONT = 'sans-serif';

export function renderBoardImage(game: GameRow): Buffer {
  const boardW = BOARD_COLS * TILE + (BOARD_COLS - 1) * TILE_GAP;
  const boardH = MAX_GUESSES * TILE + (MAX_GUESSES - 1) * TILE_GAP;
  const kbW = KEY_ROWS[0].length * KEY_W + (KEY_ROWS[0].length - 1) * KEY_GAP;
  const kbH = KEY_ROWS.length * KEY_H + (KEY_ROWS.length - 1) * KEY_GAP;
  const width = Math.max(boardW, kbW) + PAD * 2;
  const height = PAD + boardH + 30 + kbH + PAD;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // board
  const boardX = (width - boardW) / 2;
  const scores: TileStatus[][] = game.guesses.map((g) => scoreGuess(game.answer, g.word));
  for (let row = 0; row < MAX_GUESSES; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const x = boardX + col * (TILE + TILE_GAP);
      const y = PAD + row * (TILE + TILE_GAP);
      if (row < game.guesses.length) {
        ctx.fillStyle = COLORS[scores[row][col]];
        roundRect(ctx, x, y, TILE, TILE, 6);
        ctx.fill();
        ctx.fillStyle = COLORS.text;
        ctx.font = `bold 34px ${FONT}`;
        ctx.fillText(game.guesses[row].word[col].toUpperCase(), x + TILE / 2, y + TILE / 2 + 2);
      } else {
        ctx.strokeStyle = COLORS.emptyBorder;
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 6);
        ctx.stroke();
      }
    }
  }

  // keyboard
  const status = keyboardStatus(game.answer, game.guesses.map((g) => g.word));
  const kbTop = PAD + boardH + 30;
  KEY_ROWS.forEach((rowLetters, rowIdx) => {
    const rowW = rowLetters.length * KEY_W + (rowLetters.length - 1) * KEY_GAP;
    const startX = (width - rowW) / 2;
    const y = kbTop + rowIdx * (KEY_H + KEY_GAP);
    for (let i = 0; i < rowLetters.length; i++) {
      const letter = rowLetters[i];
      const s = status.get(letter.toLowerCase()) ?? 'unused';
      const x = startX + i * (KEY_W + KEY_GAP);
      ctx.fillStyle = s === 'unused' ? COLORS.keyUnused : COLORS[s];
      roundRect(ctx, x, y, KEY_W, KEY_H, 5);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillText(letter, x + KEY_W / 2, y + KEY_H / 2 + 1);
    }
  });

  return canvas.toBuffer('image/png');
}

function roundRect(
  ctx: import('@napi-rs/canvas').SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
