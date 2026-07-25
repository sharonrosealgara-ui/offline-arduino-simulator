/**
 * Generates build/icon.ico procedurally (no network, no binary assets in git).
 * Draws a simple "circuit chip" mark: dark rounded square, green PCB inner square,
 * white pin stubs — rendered at 16/24/32/48/64/128/256 px and packed into ICO.
 *
 * ICO container format: 6-byte header, 16-byte directory entries, PNG payloads
 * (Vista+ supports PNG-compressed ICO entries; electron-builder accepts this).
 *
 * Usage: node scripts/generate-placeholder-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Minimal PNG encoder (truecolor + alpha, no external deps).
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Icon artwork: rounded dark tile, PCB-green chip, silver pins, gold dot.
// ---------------------------------------------------------------------------
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  const radius = size * 0.18;
  const inside = (x, y) => {
    const pad = size * 0.02;
    const l = pad;
    const t = pad;
    const r = size - pad;
    const bmax = size - pad;
    if (x < l || x >= r || y < t || y >= bmax) return false;
    const cx = Math.max(l + radius, Math.min(x, r - radius));
    const cy = Math.max(t + radius, Math.min(y, bmax - radius));
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 || (x >= l + radius && x < r - radius) || (y >= t + radius && y < bmax - radius);
  };

  // Background tile (dark slate)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inside(x, y)) set(x, y, 24, 27, 31);
    }
  }

  // Chip body (PCB green) centered
  const c0 = Math.round(size * 0.26);
  const c1 = Math.round(size * 0.74);
  for (let y = c0; y < c1; y += 1) {
    for (let x = c0; x < c1; x += 1) set(x, y, 26, 107, 60);
  }

  // Pins: 4 per side (silver)
  const pinLen = Math.max(2, Math.round(size * 0.08));
  const pinThick = Math.max(1, Math.round(size * 0.05));
  for (let n = 0; n < 4; n += 1) {
    const offset = Math.round(c0 + ((c1 - c0) * (n + 0.5)) / 4 - pinThick / 2);
    for (let t = 0; t < pinThick; t += 1) {
      for (let l = 1; l <= pinLen; l += 1) {
        set(offset + t, c0 - l, 156, 163, 175); // top
        set(offset + t, c1 + l - 1, 156, 163, 175); // bottom
        set(c0 - l, offset + t, 156, 163, 175); // left
        set(c1 + l - 1, offset + t, 156, 163, 175); // right
      }
    }
  }

  // Gold "pin 1" dot
  const dotR = Math.max(1, Math.round(size * 0.06));
  const dx = Math.round(size * 0.35);
  const dy = Math.round(size * 0.35);
  for (let y = -dotR; y <= dotR; y += 1) {
    for (let x = -dotR; x <= dotR; x += 1) {
      if (x * x + y * y <= dotR * dotR) set(dx + x, dy + y, 251, 191, 36);
    }
  }

  return px;
}

// ---------------------------------------------------------------------------
// ICO packing
// ---------------------------------------------------------------------------
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => encodePng(s, drawIcon(s)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);

let offset = 6 + 16 * sizes.length;
const entries = [];
for (let i = 0; i < sizes.length; i += 1) {
  const e = Buffer.alloc(16);
  e[0] = sizes[i] === 256 ? 0 : sizes[i]; // width (0 = 256)
  e[1] = sizes[i] === 256 ? 0 : sizes[i]; // height
  e[2] = 0; // palette
  e[3] = 0; // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  entries.push(e);
}

const outDir = path.resolve('build');
mkdirSync(outDir, { recursive: true });
const ico = Buffer.concat([header, ...entries, ...pngs]);
writeFileSync(path.join(outDir, 'icon.ico'), ico);
// electron-builder also likes a 256px PNG fallback
writeFileSync(path.join(outDir, 'icon.png'), pngs[pngs.length - 1]);
console.log(`[generate-placeholder-icon] wrote build/icon.ico (${ico.length} bytes) + build/icon.png`);
