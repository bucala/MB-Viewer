// Renders the MB Viewer app icon (dark rounded square, wireframe cube, "MB")
// for the Tauri bundle — see scripts/icon-lib.mjs for the rasterizer.
// Writes: src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.png,
// icon.ico}. The .ico carries 16/24/32/48 px BMP entries plus a 256 px PNG
// entry, so Explorer, the taskbar and the "Open with" dialog all get crisp art.
// Android launcher icons come from scripts/android-icons.mjs.
import { mkdir, writeFile } from 'node:fs/promises';
import { makeDibEntry, makeIco, makePng, renderIcon } from './icon-lib.mjs';

const dir = new URL('../src-tauri/icons/', import.meta.url);
await mkdir(dir, { recursive: true });

const sizes = new Map([16, 24, 32, 48, 128, 256].map((s) => [s, renderIcon(s)]));

await writeFile(new URL('32x32.png', dir), makePng(32, sizes.get(32)));
await writeFile(new URL('128x128.png', dir), makePng(128, sizes.get(128)));
await writeFile(new URL('128x128@2x.png', dir), makePng(256, sizes.get(256)));
await writeFile(new URL('icon.png', dir), makePng(256, sizes.get(256)));
await writeFile(
  new URL('icon.ico', dir),
  makeIco([
    ...[16, 24, 32, 48].map((s) => ({ size: s, data: makeDibEntry(s, sizes.get(s)) })),
    { size: 256, data: makePng(256, sizes.get(256)) },
  ]),
);

console.log('[gen-icons] MB Viewer icons written to src-tauri/icons');
