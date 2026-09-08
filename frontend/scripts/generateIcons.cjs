#!/usr/bin/env node
//
// Generates the home-screen icons into frontend/public/.
//
//   node scripts/generateIcons.cjs
//
// Written by hand rather than pulled from an image library so the whole icon
// set can be regenerated after a colour change with no extra dependencies.
// The mark is three stacked bars — the roster — on the app's dark ground.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [26, 26, 26]; // --text
const ACCENT = [0, 128, 96]; // --accent
const LIGHT = [246, 246, 247]; // --bg

// --- Minimal PNG writer (RGB, no alpha: iOS applies its own icon mask) ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10-12: compression, filter, interlace — all 0

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      raw[offset++] = pixels[i];
      raw[offset++] = pixels[i + 1];
      raw[offset++] = pixels[i + 2];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- The mark ---

// Distance from a point to a rounded rectangle, used to antialias its edges.
function roundedRectDistance(x, y, left, top, width, height, radius) {
  const cx = Math.abs(x - (left + width / 2)) - (width / 2 - radius);
  const cy = Math.abs(y - (top + height / 2)) - (height / 2 - radius);
  const dx = Math.max(cx, 0);
  const dy = Math.max(cy, 0);
  return Math.min(Math.max(cx, cy), 0) + Math.sqrt(dx * dx + dy * dy) - radius;
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 3);
  const s = size / 512; // the mark is designed at 512 and scaled

  // Bars sit inside the middle ~60% so Android's maskable safe zone can crop
  // the corners without cutting the mark.
  const barWidth = 268 * s;
  const barHeight = 52 * s;
  const gap = 34 * s;
  const radius = 18 * s;
  const totalHeight = barHeight * 3 + gap * 2;
  const left = (size - barWidth) / 2;
  const top = (size - totalHeight) / 2;

  const bars = [
    { y: top, color: ACCENT },
    { y: top + barHeight + gap, color: LIGHT },
    { y: top + (barHeight + gap) * 2, color: LIGHT },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = BG[0];
      let g = BG[1];
      let b = BG[2];

      for (const bar of bars) {
        const distance = roundedRectDistance(
          x + 0.5,
          y + 0.5,
          left,
          bar.y,
          barWidth,
          barHeight,
          radius
        );
        // Blend across one pixel of the edge so the bars are not jagged.
        const coverage = Math.min(Math.max(0.5 - distance, 0), 1);
        if (coverage > 0) {
          r = Math.round(r + (bar.color[0] - r) * coverage);
          g = Math.round(g + (bar.color[1] - g) * coverage);
          b = Math.round(b + (bar.color[2] - b) * coverage);
        }
      }

      const i = (y * size + x) * 3;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }

  return encodePng(size, pixels);
}

const outDir = path.join(__dirname, "..", "public");
fs.mkdirSync(outDir, { recursive: true });

// 180 is what iOS uses for the home screen; 192/512 are the manifest sizes.
for (const [name, size] of [
  ["favicon-32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`${name} (${size}x${size}) — ${fs.statSync(file).size} bytes`);
}
