#!/usr/bin/env node
//
// Generates the home-screen icons into frontend/public/.
//
//   node scripts/generateIcons.cjs
//
// Written by hand rather than pulled from an image library so the whole icon
// set can be regenerated after a colour change with no extra dependencies.
// The mark is an X, in the marker yellow, on the app's ink ground.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [36, 31, 71]; // --ink
const MARK = [255, 207, 71]; // --mark

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

// Distance from a point to one stroke of the X: a band around a slanted line,
// cut off flat at the top and bottom like a letter rather than rounded like a
// "close" button. Negative inside, positive outside, in pixels.
function strokeDistance(x, y, c, slant, height, halfWidth) {
  // The centre line runs from (c - slant, c - height) to (c + slant, c + height).
  const dx = 2 * slant;
  const dy = 2 * height;
  const length = Math.hypot(dx, dy);
  const across = Math.abs((x - c) * dy - (y - c) * dx) / length - halfWidth;
  const beyond = Math.abs(y - c) - height;
  return Math.max(across, beyond);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 3);
  const s = size / 512; // the mark is designed at 512 and scaled

  // A letter X: the falling stroke heavy, the rising one light, the contrast
  // a typeface gives it. It sits inside the middle 80% circle, Android's
  // maskable safe zone, so a circular or squircle crop never clips it.
  const c = size / 2;
  const height = 124 * s;
  const slant = 92 * s;
  const strokes = [
    { slant, halfWidth: 46 * s },
    { slant: -slant, halfWidth: 19 * s },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.min(
        ...strokes.map((k) => strokeDistance(x + 0.5, y + 0.5, c, k.slant, height, k.halfWidth))
      );
      // Blend across one pixel of the edge so the strokes are not jagged.
      const coverage = Math.min(Math.max(0.5 - distance, 0), 1);

      const i = (y * size + x) * 3;
      pixels[i] = Math.round(BG[0] + (MARK[0] - BG[0]) * coverage);
      pixels[i + 1] = Math.round(BG[1] + (MARK[1] - BG[1]) * coverage);
      pixels[i + 2] = Math.round(BG[2] + (MARK[2] - BG[2]) * coverage);
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
