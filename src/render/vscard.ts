import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';

export interface VsPlayer {
  name: string;
  /** raw profile photo bytes, or null to draw an initials circle */
  avatar: Buffer | null;
}

export interface VsRow {
  label: string;
  a: string;
  b: string;
  winner: 'a' | 'b' | 'tie';
}

const W = 520;
const PAD = 28;
const AVATAR = 104;
const RING = 4;
const ROW_H = 56;
const ROW_GAP = 14;
const SIDE_PILL_W = 124;
const RADIUS = 14;

const C = {
  bg: '#121213',
  pill: '#2c2c2e',
  pillCenter: '#232325',
  win: '#538d4e',
  text: '#ffffff',
  label: '#9a9da1',
  name: '#d7dadc',
  ringA: '#b59f3b',
  ringB: '#538d4e',
};

const FONT = 'sans-serif';

/** Pretty head-to-head card: avatars + VS + stat pills, leader highlighted green. */
export async function renderVsCard(a: VsPlayer, b: VsPlayer, rows: VsRow[]): Promise<Buffer> {
  const headerH = AVATAR + 38; // avatar + name line
  const rowsH = rows.length * ROW_H + (rows.length - 1) * ROW_GAP;
  const height = PAD + headerH + 26 + rowsH + PAD;

  const canvas = createCanvas(W, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, height);
  ctx.textBaseline = 'middle';

  // --- header: avatar A · VS · avatar B, names underneath ---
  const colAx = PAD + SIDE_PILL_W / 2; // center avatars over the value pills
  const colBx = W - PAD - SIDE_PILL_W / 2;
  await drawAvatar(ctx, a, colAx, PAD + AVATAR / 2, C.ringA);
  await drawAvatar(ctx, b, colBx, PAD + AVATAR / 2, C.ringB);

  ctx.textAlign = 'center';
  ctx.fillStyle = C.text;
  ctx.font = `bold 34px ${FONT}`;
  ctx.fillText('VS', W / 2, PAD + AVATAR / 2);

  ctx.fillStyle = C.name;
  drawFitted(ctx, firstName(a.name), colAx, PAD + AVATAR + 22, SIDE_PILL_W + 30, 20);
  drawFitted(ctx, firstName(b.name), colBx, PAD + AVATAR + 22, SIDE_PILL_W + 30, 20);

  // --- stat rows ---
  const centerW = W - 2 * PAD - 2 * SIDE_PILL_W - 2 * ROW_GAP;
  const centerX = PAD + SIDE_PILL_W + ROW_GAP;
  let y = PAD + headerH + 26;
  for (const row of rows) {
    pill(ctx, PAD, y, SIDE_PILL_W, ROW_H, row.winner === 'a' ? C.win : C.pill);
    pill(ctx, centerX, y, centerW, ROW_H, C.pillCenter);
    pill(ctx, W - PAD - SIDE_PILL_W, y, SIDE_PILL_W, ROW_H, row.winner === 'b' ? C.win : C.pill);

    const cy = y + ROW_H / 2 + 1;
    ctx.fillStyle = C.text;
    ctx.font = `bold 22px ${FONT}`;
    drawFitted(ctx, row.a, PAD + SIDE_PILL_W / 2, cy, SIDE_PILL_W - 20, 22, true);
    drawFitted(ctx, row.b, W - PAD - SIDE_PILL_W / 2, cy, SIDE_PILL_W - 20, 22, true);
    ctx.fillStyle = C.label;
    drawFitted(ctx, row.label, W / 2, cy, centerW - 24, 20);

    y += ROW_H + ROW_GAP;
  }

  return canvas.toBuffer('image/png');
}

async function drawAvatar(ctx: SKRSContext2D, p: VsPlayer, cx: number, cy: number, ring: string): Promise<void> {
  const r = AVATAR / 2;
  // ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = ring;
  ctx.lineWidth = RING;
  ctx.stroke();

  const inner = r - RING / 2 - 1;
  if (p.avatar) {
    try {
      const img = await loadImage(p.avatar);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, cx - inner, cy - inner, inner * 2, inner * 2);
      ctx.restore();
      return;
    } catch {
      // corrupted image — fall through to initials
    }
  }
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = C.pill;
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.font = `bold 38px ${FONT}`;
  ctx.fillText(initials(p.name), cx, cy + 2);
}

function pill(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x + RADIUS, y);
  ctx.arcTo(x + w, y, x + w, y + h, RADIUS);
  ctx.arcTo(x + w, y + h, x, y + h, RADIUS);
  ctx.arcTo(x, y + h, x, y, RADIUS);
  ctx.arcTo(x, y, x + w, y, RADIUS);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawFitted(ctx: SKRSContext2D, text: string, cx: number, cy: number, maxWidth: number, baseSize: number, bold = false): void {
  let size = baseSize;
  const weight = bold ? 'bold ' : '';
  ctx.font = `${weight}${size}px ${FONT}`;
  while (size > 10 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${weight}${size}px ${FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, cy, maxWidth);
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}
