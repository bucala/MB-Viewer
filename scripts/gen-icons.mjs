// Generates placeholder app icons for the Tauri bundle (solid dark square).
// Replace with real branding via `npx @tauri-apps/cli icon path/to/icon.png`.
// Writes: src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico}
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const COLOR = [23, 23, 23, 255]; // neutral-900

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

function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Raw scanlines: filter byte 0 + RGBA pixels.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    for (let x = 0; x < size; x++) {
      raw.set(COLOR, row + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO container with a single PNG-compressed 256×256 entry (Vista+ format).
function makeIco(png256) {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header[6] = 0; // width 256 -> 0
  header[7] = 0; // height 256 -> 0
  header.writeUInt16LE(1, 12); // color planes
  header.writeUInt16LE(32, 14); // bits per pixel
  header.writeUInt32LE(png256.length, 6 + 8);
  header.writeUInt32LE(6 + 16, 6 + 12); // data offset
  return Buffer.concat([header, png256]);
}

const dir = new URL('../src-tauri/icons/', import.meta.url);
await mkdir(dir, { recursive: true });

const png32 = makePng(32);
const png128 = makePng(128);
const png256 = makePng(256);

await writeFile(new URL('32x32.png', dir), png32);
await writeFile(new URL('128x128.png', dir), png128);
await writeFile(new URL('128x128@2x.png', dir), png256);
await writeFile(new URL('icon.png', dir), png256);
await writeFile(new URL('icon.ico', dir), makeIco(png256));

console.log('[gen-icons] placeholder icons written to src-tauri/icons');
