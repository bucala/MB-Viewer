// Copies the occt-import-js (OpenCASCADE WebAssembly) runtime out of
// node_modules into public/, where the classic worker in
// public/occt-worker.js can importScripts() it. Keeping the Emscripten
// UMD bundle out of Vite's module graph makes dev and production builds
// behave identically. Runs automatically on `npm install` (postinstall).
import { cp, mkdir, access } from 'node:fs/promises';

const srcDir = new URL('../node_modules/occt-import-js/dist/', import.meta.url);
const dstDir = new URL('../public/vendor/occt/', import.meta.url);
const files = ['occt-import-js.js', 'occt-import-js.wasm'];

try {
  await access(srcDir);
} catch {
  console.warn('[copy-occt] occt-import-js is not installed yet — skipping.');
  process.exit(0);
}

await mkdir(dstDir, { recursive: true });
for (const file of files) {
  await cp(new URL(file, srcDir), new URL(file, dstDir));
}
console.log('[copy-occt] occt-import-js runtime copied to public/vendor/occt');
