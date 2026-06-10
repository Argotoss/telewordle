import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { GameRow } from '../db.js';
import { scoreGuess, TileStatus } from '../engine/score.js';
import { MAX_GUESSES } from '../game/service.js';

// Classic Wordle palette
const COLORS = {
  bg: '#121213',
  correct: '#538d4e',
  present: '#b59f3b',
  absent: '#3a3a3c',
  emptyBorder: '#3a3a3c',
  text: '#ffffff',
};

const TILE = 62;
const TILE_GAP = 6;
const BOARD_COLS = 5;
const PAD = 24;

const FONT = 'sans-serif';
const STICKER_SIZE = 512;

function renderBoardCanvas(game: GameRow, opts: { background?: boolean } = {}): Canvas {
  const boardW = BOARD_COLS * TILE + (BOARD_COLS - 1) * TILE_GAP;
  const boardH = MAX_GUESSES * TILE + (MAX_GUESSES - 1) * TILE_GAP;
  const width = boardW + PAD * 2;
  const height = boardH + PAD * 2;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (opts.background ?? true) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);
  }
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

  return canvas;
}

export function renderBoardImage(game: GameRow): Buffer {
  return renderBoardCanvas(game).toBuffer('image/png');
}

export function renderBoardSticker(game: GameRow): Buffer {
  const source = renderBoardCanvas(game, { background: false });
  const sticker = createCanvas(STICKER_SIZE, STICKER_SIZE);
  const ctx = sticker.getContext('2d');
  const scale = Math.min(STICKER_SIZE / source.width, STICKER_SIZE / source.height);
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const x = Math.round((STICKER_SIZE - width) / 2);
  const y = Math.round((STICKER_SIZE - height) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, x, y, width, height);

  return sticker.toBuffer('image/webp', 100);
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
