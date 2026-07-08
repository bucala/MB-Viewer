// MB Viewer icon rasterizer — shared by gen-icons.mjs (Tauri/desktop) and
// android-icons.mjs (Android launcher mipmaps). A tiny dependency-free
// renderer: supersampled SDF strokes over a gradient badge.
import { deflateSync } from 'node:zlib';

/* -------------------------------------------------------------------------- */
/* Design (all coordinates in a 0..1 box, y pointing down)                     */
/* -------------------------------------------------------------------------- */

const BG_TOP = [58, 63, 70];
const BG_BOTTOM = [21, 23, 27];
const BORDER = [108, 114, 123];
const CUBE = [176, 184, 194];
const LETTER = [244, 246, 249];
const HALO = [18, 20, 24];

/** Android adaptive-icon background color (matches the badge gradient). */
export const BACKGROUND_HEX = '#202329';

const MARGIN = 0.015;
const CORNER = 0.21;
const BORDER_W = 0.012;

// Isometric wireframe cube (top face visible, front vertical edge centered).
const CUBE_CENTER = [0.5, 0.46];
const CUBE_R = 0.315;
const CUBE_W = 0.02;

// "MB" drawn as capsule strokes + half-circle bowls.
const TEXT_CY = 0.475;
const TEXT_H = 0.33;
const M_W = 0.28;
const GAP = 0.075;
const B_W = 0.2;
const STROKE_W = 0.058;
const HALO_W = 0.02;

function cubeSegments() {
  const [cx, cy] = CUBE_CENTER;
  const c = Math.sqrt(3) / 2;
  const top = [cx, cy - CUBE_R];
  const upperRight = [cx + c * CUBE_R, cy - CUBE_R / 2];
  const lowerRight = [cx + c * CUBE_R, cy + CUBE_R / 2];
  const bottom = [cx, cy + CUBE_R];
  const lowerLeft = [cx - c * CUBE_R, cy + CUBE_R / 2];
  const upperLeft = [cx - c * CUBE_R, cy - CUBE_R / 2];
  const center = [cx, cy];
  return [
    [top, upperRight], [upperRight, lowerRight], [lowerRight, bottom],
    [bottom, lowerLeft], [lowerLeft, upperLeft], [upperLeft, top],
    [upperRight, center], [center, upperLeft], [center, bottom],
  ];
}

function letterShapes() {
  const y0 = TEXT_CY - TEXT_H / 2;
  const y1 = TEXT_CY + TEXT_H / 2;
  const x0 = (1 - (M_W + GAP + B_W)) / 2;

  const segments = [
    // M
    [[x0, y1], [x0, y0]],
    [[x0, y0], [x0 + M_W / 2, y0 + 0.62 * TEXT_H]],
    [[x0 + M_W / 2, y0 + 0.62 * TEXT_H], [x0 + M_W, y0]],
    [[x0 + M_W, y0], [x0 + M_W, y1]],
  ];

  // B: stem + three horizontals + two right-half-circle bowls.
  const bx = x0 + M_W + GAP;
  const r1 = 0.24 * TEXT_H;
  const r2 = 0.26 * TEXT_H;
  const midY = y0 + 2 * r1;
  const bowl1 = [bx + B_W - r1, y0 + r1, r1];
  const bowl2 = [bx + (B_W + 0.015) - r2, midY + r2, r2];
  segments.push(
    [[bx, y0], [bx, y1]],
    [[bx, y0], [bowl1[0], y0]],
    [[bx, midY], [bowl2[0], midY]],
    [[bx, y1], [bowl2[0], y1]],
  );
  return { segments, arcs: [bowl1, bowl2] };
}

const CUBE_SEGMENTS = cubeSegments();
const LETTERS = letterShapes();

/* -------------------------------------------------------------------------- */
/* Rasterizer                                                                  */
/* -------------------------------------------------------------------------- */

function sdRoundRect(x, y) {
  const hw = 0.5 - MARGIN;
  const qx = Math.abs(x - 0.5) - (hw - CORNER);
  const qy = Math.abs(y - 0.5) - (hw - CORNER);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - CORNER;
}

function sdCircleBadge(x, y) {
  return Math.hypot(x - 0.5, y - 0.5) - (0.5 - MARGIN);
}

function sdSegment(x, y, [[ax, ay], [bx, by]]) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(x - (ax + t * abx), y - (ay + t * aby));
}

/** Distance to the right half (dx ≥ 0) of a circle outline. */
function sdHalfArc(x, y, [cx, cy, r]) {
  const dx = x - cx;
  const dy = y - cy;
  if (dx >= 0) return Math.abs(Math.hypot(dx, dy) - r);
  return Math.min(Math.hypot(dx, dy - r), Math.hypot(dx, dy + r));
}

function minDistance(x, y, segments, arcs = []) {
  let d = Infinity;
  for (const seg of segments) d = Math.min(d, sdSegment(x, y, seg));
  for (const arc of arcs) d = Math.min(d, sdHalfArc(x, y, arc));
  return d;
}

/** Cube wireframe + MB monogram, no badge. Returns null where transparent. */
function shadeArtwork(x, y, t) {
  let color = null;
  if (minDistance(x, y, CUBE_SEGMENTS) <= CUBE_W / 2) {
    color = CUBE;
  }
  const letterDistance = minDistance(x, y, LETTERS.segments, LETTERS.arcs);
  if (letterDistance <= STROKE_W / 2 + HALO_W) {
    color = HALO; // separation halo so the cube lines don't touch the glyphs
  }
  if (letterDistance <= STROKE_W / 2) {
    // Slight vertical shading on the glyphs for a metallic feel.
    const l = 1 - 0.18 * t;
    color = [LETTER[0] * l, LETTER[1] * l, LETTER[2] * l];
  }
  return color;
}

/**
 * `badge`: 'square' (rounded rect), 'round' (circle) or null (transparent —
 * Android adaptive foreground, artwork rescaled into the 66/108dp safe zone).
 */
function shade(x, y, badge) {
  if (badge === null) {
    // Map the foreground canvas onto the artwork: center it and shrink it a
    // touch inside the adaptive-icon safe zone (Ø 66/108 ≈ 0.61 of canvas).
    const k = 0.88;
    const ux = 0.5 + (x - 0.5) / k;
    const uy = CUBE_CENTER[1] + 0.005 + (y - 0.5) / k;
    return shadeArtwork(ux, uy, Math.max(0, Math.min(1, uy))) ?? [0, 0, 0, -1];
  }

  const sd = badge === 'round' ? sdCircleBadge(x, y) : sdRoundRect(x, y);
  if (sd > 0) return [0, 0, 0, -1];

  // Vertical background gradient with a soft top highlight.
  const t = Math.max(0, Math.min(1, y));
  const glow = Math.max(0, 1 - Math.hypot((x - 0.5) / 0.75, (y - 0.18) / 0.55)) * 0.10;
  let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t + glow * 255;
  let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t + glow * 255;
  let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t + glow * 255;

  if (sd > -BORDER_W) {
    const k = 0.65;
    r = r * (1 - k) + BORDER[0] * k;
    g = g * (1 - k) + BORDER[1] * k;
    b = b * (1 - k) + BORDER[2] * k;
  }

  const art = shadeArtwork(x, y, t);
  if (art) [r, g, b] = art;
  return [r, g, b];
}

/** Render at `size` px, supersampled; returns RGBA (row-major). */
function renderVariant(size, badge) {
  const ss = size >= 128 ? 4 : 8;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const sample = shade(
            (px + (sx + 0.5) / ss) / size,
            (py + (sy + 0.5) / ss) / size,
            badge,
          );
          if (sample[3] === -1) continue; // transparent sample
          r += sample[0]; g += sample[1]; b += sample[2]; a += 255;
        }
      }
      const n = ss * ss;
      const alpha = a / n;
      const offset = (py * size + px) * 4;
      // Un-premultiply the averaged color.
      const scale = alpha > 0 ? 255 / alpha : 0;
      out[offset] = Math.min(255, Math.round((r / n) * scale));
      out[offset + 1] = Math.min(255, Math.round((g / n) * scale));
      out[offset + 2] = Math.min(255, Math.round((b / n) * scale));
      out[offset + 3] = Math.round(alpha);
    }
  }
  return out;
}

/** Rounded-square badge (desktop/Tauri, Android legacy launcher). */
export const renderIcon = (size) => renderVariant(size, 'square');
/** Circular badge (Android legacy round launcher). */
export const renderRoundIcon = (size) => renderVariant(size, 'round');
/** Transparent-background artwork (Android adaptive-icon foreground). */
export const renderForeground = (size) => renderVariant(size, null);

/* -------------------------------------------------------------------------- */
/* PNG / ICO encoding                                                          */
/* -------------------------------------------------------------------------- */

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = -1;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function makePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Raw scanlines: filter byte 0 + RGBA pixels.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    rgba.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Classic BMP (DIB) icon entry: BGRA bottom-up + 1-bit AND mask. */
export function makeDibEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND heights
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bpp
  const maskRow = Math.ceil(size / 32) * 4;
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);

  const xor = Buffer.alloc(size * size * 4);
  const and = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size; // bottom-up
    for (let x = 0; x < size; x++) {
      const src = (srcRow + x) * 4;
      const dst = (y * size + x) * 4;
      xor[dst] = rgba[src + 2];
      xor[dst + 1] = rgba[src + 1];
      xor[dst + 2] = rgba[src];
      xor[dst + 3] = rgba[src + 3];
      if (rgba[src + 3] < 128) {
        and[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return Buffer.concat([header, xor, and]);
}

/** ICO container: BMP entries for the small sizes, PNG for 256 (Vista+). */
export function makeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = [];
  const blobs = [];
  let offset = 6 + entries.length * 16;
  for (const { size, data } of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    directory.push(dir);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...directory, ...blobs]);
}
