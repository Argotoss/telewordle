import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { GameRow } from '../db.js';
import { getLanguage } from '../engine/languages.js';
import { keyboardStatus, scoreGuess, TileStatus } from '../engine/score.js';
import { maxGuessesFor } from '../game/service.js';
import { shouldShowNames } from './text.js';

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
const PAD = 24;
const NAME_ROOM = 130; // extra PNG width so names always fit beside wide boards

const KEY_W = 40;
const KEY_H = 54;
const KEY_GAP = 6;

function keyRows(game: GameRow): string[] {
  return getLanguage(game.lang).keyRows;
}

/** Key width that fits the longest keyboard row into the given width. */
function fitKeyWidth(rows: string[], maxWidth: number): number {
  const maxKeys = Math.max(...rows.map((r) => r.length));
  return Math.min(KEY_W, Math.floor((maxWidth - (maxKeys - 1) * KEY_GAP) / maxKeys));
}

const FONT = 'sans-serif';

// Sticker output (from PR #2): Telegram stickers are 512px wide, so boards
// rendered this way show up much larger in chat than photo messages.
const STICKER_WIDTH = 512;
const STICKER_PAD_Y = 18;
const BOARD_ALIGN_KEY_COUNT = 8; // board scaled to ~8 keys wide, like the classic layout


function boardRows(game: GameRow): number {
  return maxGuessesFor(game);
}

function boardCols(game: GameRow): number {
  return game.answer.length;
}

function boardWidth(game: GameRow): number {
  const cols = boardCols(game);
  return cols * TILE + (cols - 1) * TILE_GAP;
}

function boardHeight(rows: number): number {
  return rows * TILE + (rows - 1) * TILE_GAP;
}

/** Draw text left-aligned at (x, y), shrinking the font until it fits maxWidth. */
function drawFittedText(ctx: SKRSContext2D, text: string, x: number, y: number, maxWidth: number): void {
  let size = 18;
  ctx.font = `${size}px ${FONT}`;
  while (size > 9 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${size}px ${FONT}`;
  }
  ctx.fillText(text, x, y, maxWidth);
}

/**
 * The board grid is always drawn at `left` regardless of names — names live in
 * the margin to the right of it, never pushing or resizing the board.
 */
function drawBoard(ctx: SKRSContext2D, game: GameRow, left: number, top: number, nameMaxWidth = 0): void {
  const scores: TileStatus[][] = game.guesses.map((g) => scoreGuess(game.answer, g.word));
  const rows = boardRows(game);
  const cols = boardCols(game);
  const names = shouldShowNames(game) && nameMaxWidth > 14;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = left + col * (TILE + TILE_GAP);
      const y = top + row * (TILE + TILE_GAP);
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
    if (names && row < game.guesses.length) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.keyUnused;
      const firstName = game.guesses[row].userName.split(/\s+/)[0] ?? '';
      drawFittedText(ctx, firstName, left + boardWidth(game) + 10, top + row * (TILE + TILE_GAP) + TILE / 2 + 1, nameMaxWidth);
      ctx.restore();
    }
  }
}

/** Full classic keyboard: every letter stays visible (absent = dark, unused = light). */
function drawKeyboard(ctx: SKRSContext2D, game: GameRow, width: number, top: number, keyW = KEY_W): void {
  const status = keyboardStatus(game.answer, game.guesses.map((g) => g.word));
  keyRows(game).forEach((rowLetters, rowIdx) => {
    const rowW = rowLetters.length * keyW + (rowLetters.length - 1) * KEY_GAP;
    const startX = (width - rowW) / 2;
    const y = top + rowIdx * (KEY_H + KEY_GAP);
    for (let i = 0; i < rowLetters.length; i++) {
      const letter = rowLetters[i];
      const s = status.get(letter.toLowerCase()) ?? 'unused';
      const x = startX + i * (keyW + KEY_GAP);
      ctx.fillStyle = s === 'unused' ? COLORS.keyUnused : COLORS[s];
      roundRect(ctx, x, y, keyW, KEY_H, 5);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = `bold ${Math.round(keyW / 2)}px ${FONT}`;
      ctx.fillText(letter, x + keyW / 2, y + KEY_H / 2 + 1);
    }
  });
}

/** Classic single PNG: board with the keyboard underneath. The board is always centered. */
export function renderBoardImage(game: GameRow): Buffer {
  const rows = keyRows(game);
  const maxKeys = Math.max(...rows.map((r) => r.length));
  const kbW = maxKeys * KEY_W + (maxKeys - 1) * KEY_GAP;
  const kbH = rows.length * KEY_H + (rows.length - 1) * KEY_GAP;
  const boardW = boardWidth(game);
  const boardH = boardHeight(boardRows(game));
  const nameRoom = shouldShowNames(game) ? NAME_ROOM : 0;
  const width = Math.max(boardW + nameRoom * 2, kbW) + PAD * 2; // symmetric so the board stays centered
  const height = PAD + boardH + 30 + kbH + PAD;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const boardLeft = (width - boardW) / 2;
  const nameMaxWidth = width - boardLeft - boardW - 14; // names live in the right margin
  drawBoard(ctx, game, boardLeft, PAD, nameMaxWidth);
  drawKeyboard(ctx, game, width, PAD + boardH + 30);

  return canvas.toBuffer('image/png');
}

/** Transparent-background board as a 512px-wide WebP sticker. The board is always centered. */
export function renderBoardSticker(game: GameRow): Buffer {
  const boardW = boardWidth(game);
  const boardH = boardHeight(boardRows(game));
  const contentWidth = BOARD_ALIGN_KEY_COUNT * KEY_W + (BOARD_ALIGN_KEY_COUNT - 1) * KEY_GAP;
  // width-driven scale, capped so tall boards (short words = huge tiles,
  // long words = many rows) never exceed the 512px sticker height, and so
  // player names keep readable side margins on small boards
  let scale = Math.min(contentWidth / boardW, (STICKER_WIDTH - STICKER_PAD_Y * 2) / boardH);
  if (shouldShowNames(game)) scale = Math.min(scale, STICKER_WIDTH / (boardW + 140));
  // symmetric side margins sized so the scaled canvas fills the full sticker width
  const side = Math.max(0, Math.floor((STICKER_WIDTH / scale - boardW) / 2));
  const sourceW = boardW + side * 2;
  const source = createCanvas(sourceW, boardH);
  const ctx = source.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawBoard(ctx, game, side, 0, side - 10);

  const width = Math.round(sourceW * scale);
  const height = Math.round(source.height * scale);
  const sticker = createCanvas(STICKER_WIDTH, height + STICKER_PAD_Y * 2);
  const sctx = sticker.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, Math.round((STICKER_WIDTH - width) / 2), STICKER_PAD_Y, width, height);

  return encodeSticker(sticker);
}

/** Full keyboard as a 512px-wide WebP sticker. */
export function renderKeyboardSticker(game: GameRow): Buffer {
  const rows = keyRows(game);
  const keyW = fitKeyWidth(rows, STICKER_WIDTH - 24);
  const kbH = rows.length * KEY_H + (rows.length - 1) * KEY_GAP;
  const sticker = createCanvas(STICKER_WIDTH, kbH + STICKER_PAD_Y * 2);
  const ctx = sticker.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawKeyboard(ctx, game, STICKER_WIDTH, STICKER_PAD_Y, keyW);
  return encodeSticker(sticker);
}

function encodeSticker(canvas: Canvas): Buffer {
  return canvas.toBuffer('image/webp', 100);
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
