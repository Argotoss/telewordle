import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { GameRow } from '../db.js';
import { KeyStatus, keyboardStatus, scoreGuess, TileStatus } from '../engine/score.js';
import { MAX_GUESSES } from '../game/service.js';

// Classic Wordle palette
const COLORS = {
  bg: '#121213',
  correct: '#538d4e',
  present: '#b59f3b',
  absent: '#3a3a3c',
  unused: '#818384',
  emptyBorder: '#3a3a3c',
  text: '#ffffff',
};

const TILE = 62;
const TILE_GAP = 6;
const BOARD_COLS = 5;
const PAD = 24;

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KEY_W = 42;
const KEY_H = 54;
const KEY_GAP = 6;
const KEY_ROW_GAP = 8;
const BOARD_ALIGN_KEY_COUNT = 8;

const FONT = 'sans-serif';
const STICKER_WIDTH = 512;
const STICKER_PAD_X = 19;
const STICKER_PAD_Y = 18;
const STICKER_CONTENT_WIDTH = STICKER_WIDTH - STICKER_PAD_X * 2;
const WEBP_QUALITY = 100;

type VisibleKeyStatus = Exclude<KeyStatus, 'absent'>;
type VisibleKey = {
  letter: string;
  status: VisibleKeyStatus;
};

function renderBoardCanvas(game: GameRow, opts: { background?: boolean; pad?: number } = {}): Canvas {
  const pad = opts.pad ?? PAD;
  const boardW = BOARD_COLS * TILE + (BOARD_COLS - 1) * TILE_GAP;
  const boardH = MAX_GUESSES * TILE + (MAX_GUESSES - 1) * TILE_GAP;
  const width = boardW + pad * 2;
  const height = boardH + pad * 2;

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
      const y = pad + row * (TILE + TILE_GAP);
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

export function renderBoardSticker(game: GameRow, opts: { alignToKeyboard?: boolean } = {}): Buffer {
  const source = renderBoardCanvas(game, { background: false, pad: 0 });
  const contentWidth = opts.alignToKeyboard ?? true ? keyboardContentWidth(game) : STICKER_CONTENT_WIDTH;
  const scale = contentWidth / source.width;
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const sticker = createCanvas(STICKER_WIDTH, height + STICKER_PAD_Y * 2);
  const ctx = sticker.getContext('2d');
  const x = Math.round((STICKER_WIDTH - width) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, STICKER_PAD_Y, width, height);

  return encodeSticker(sticker);
}

export function renderKeyboardSticker(game: GameRow): Buffer {
  const rows = visibleKeyboardRows(game);

  const totalH = rows.length * KEY_H + Math.max(0, rows.length - 1) * KEY_ROW_GAP;
  const sticker = createCanvas(STICKER_WIDTH, totalH + STICKER_PAD_Y * 2);
  const ctx = sticker.getContext('2d');
  let y = STICKER_PAD_Y;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 26px ${FONT}`;

  for (const row of rows) {
    const rowW = keyboardRowWidth(row.length);
    let x = Math.round((STICKER_WIDTH - rowW) / 2);

    for (const key of row) {
      ctx.fillStyle = keyboardFill(key.status);
      roundRect(ctx, x, y, KEY_W, KEY_H, 6);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(key.letter, x + KEY_W / 2, y + KEY_H / 2 + 1);
      x += KEY_W + KEY_GAP;
    }

    y += KEY_H + KEY_ROW_GAP;
  }

  return encodeSticker(sticker);
}

function keyboardContentWidth(game: GameRow): number {
  const widestRow = Math.max(...visibleKeyboardRows(game).map((row) => keyboardRowWidth(row.length)), 0);
  if (!widestRow) return STICKER_CONTENT_WIDTH;
  return Math.min(widestRow, keyboardRowWidth(BOARD_ALIGN_KEY_COUNT));
}

function visibleKeyboardRows(game: GameRow): VisibleKey[][] {
  const status = keyboardStatus(
    game.answer,
    game.guesses.map((g) => g.word)
  );

  return KEY_ROWS.map((row) =>
    row.split('').flatMap((letter): VisibleKey[] => {
      const keyStatus = status.get(letter.toLowerCase()) ?? 'unused';
      if (keyStatus === 'absent') return [];
      return [{ letter, status: keyStatus }];
    })
  ).filter((row) => row.length > 0);
}

function keyboardRowWidth(keyCount: number): number {
  return keyCount * KEY_W + Math.max(0, keyCount - 1) * KEY_GAP;
}

function encodeSticker(canvas: Canvas): Buffer {
  return canvas.toBuffer('image/webp', WEBP_QUALITY);
}

function keyboardFill(status: VisibleKeyStatus): string {
  if (status === 'correct') return COLORS.correct;
  if (status === 'present') return COLORS.present;
  return COLORS.unused;
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
