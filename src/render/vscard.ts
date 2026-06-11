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

// Rendered as a 512x512 transparent WebP and sent as a sticker — it shows up
// large and borderless in chat instead of a framed compressed photo.
const W = 512;
const H = 512;
const PAD = 28;
const AVATAR = 84;
const RING = 4;
const SIDE_PILL_W = 132;
const ROW_GAP = 10;
const RADIUS = 13;

const C = {
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

/** Pretty head-to-head sticker: avatars + VS + stat pills, leader highlighted green. */
export async function renderVsCard(a: VsPlayer, b: VsPlayer, rows: VsRow[]): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'middle';

  // --- header: avatar A · VS · avatar B, names underneath ---
  const colAx = PAD + SIDE_PILL_W / 2; // center avatars over the value pills
  const colBx = W - PAD - SIDE_PILL_W / 2;
  const avatarCy = 20 + AVATAR / 2;
  await drawAvatar(ctx, a, colAx, avatarCy, C.ringA);
  await drawAvatar(ctx, b, colBx, avatarCy, C.ringB);

  // VS and names sit on small dark badges: the sticker floats on the chat
  // background, which can be light — bare light text would disappear there.
  ctx.textAlign = 'center';
  pill(ctx, W / 2 - 36, avatarCy - 22, 72, 44, C.pillCenter);
  ctx.fillStyle = C.text;
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillText('VS', W / 2, avatarCy + 1);

  const nameCy = 20 + AVATAR + 17;
  for (const [name, cx] of [
    [firstName(a.name), colAx],
    [firstName(b.name), colBx],
  ] as const) {
    ctx.font = `16px ${FONT}`;
    const w = Math.min(SIDE_PILL_W + 16, Math.ceil(ctx.measureText(name).width) + 24);
    pill(ctx, cx - w / 2, nameCy - 13, w, 26, C.pillCenter);
    ctx.fillStyle = C.name;
    drawFitted(ctx, name, cx, nameCy + 1, w - 16, 16);
  }

  // --- stat rows, sized to fill the remaining square exactly ---
  const top = 20 + AVATAR + 34;
  const rowH = Math.floor((H - top - 18 - (rows.length - 1) * ROW_GAP) / Math.max(1, rows.length));
  const centerW = W - 2 * PAD - 2 * SIDE_PILL_W - 2 * 12;
  const centerX = PAD + SIDE_PILL_W + 12;
  let y = top;
  for (const row of rows) {
    pill(ctx, PAD, y, SIDE_PILL_W, rowH, row.winner === 'a' ? C.win : C.pill);
    pill(ctx, centerX, y, centerW, rowH, C.pillCenter);
    pill(ctx, W - PAD - SIDE_PILL_W, y, SIDE_PILL_W, rowH, row.winner === 'b' ? C.win : C.pill);

    const cy = y + rowH / 2 + 1;
    ctx.fillStyle = C.text;
    drawFitted(ctx, row.a, PAD + SIDE_PILL_W / 2, cy, SIDE_PILL_W - 20, 21, true);
    drawFitted(ctx, row.b, W - PAD - SIDE_PILL_W / 2, cy, SIDE_PILL_W - 20, 21, true);
    ctx.fillStyle = C.label;
    drawFitted(ctx, row.label, W / 2, cy, centerW - 20, 18);

    y += rowH + ROW_GAP;
  }

  return canvas.toBuffer('image/webp', 100);
}

async function drawAvatar(ctx: SKRSContext2D, p: VsPlayer, cx: number, cy: number, ring: string): Promise<void> {
  const r = AVATAR / 2;
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
  ctx.font = `bold 32px ${FONT}`;
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
