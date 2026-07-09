// Builds the Windows Explorer thumbnail provider (thumbnailer/ crate) and
// copies mb_viewer_thumbs.dll next to the Tauri config so it gets bundled as
// an app resource. No-op on non-Windows hosts (the DLL is Windows-only).
import { spawnSync } from 'node:child_process';
import { cp, mkdir, access } from 'node:fs/promises';

if (process.platform !== 'win32') {
  console.warn('[thumbnailer] not Windows — skipping thumbnail provider build.');
  process.exit(0);
}

const manifest = new URL('../thumbnailer/Cargo.toml', import.meta.url);
const result = spawnSync(
  'cargo',
  ['build', '--release', '--manifest-path', manifest.pathname.replace(/^\//, '')],
  { stdio: 'inherit', shell: true },
);
if (result.status !== 0) {
  console.error('[thumbnailer] cargo build failed.');
  process.exit(result.status ?? 1);
}

const dll = new URL('../thumbnailer/target/release/mb_viewer_thumbs.dll', import.meta.url);
const dstDir = new URL('../src-tauri/', import.meta.url);
const dst = new URL('mb_viewer_thumbs.dll', dstDir);

try {
  await access(dll);
} catch {
  console.error('[thumbnailer] built DLL not found:', dll.pathname);
  process.exit(1);
}

await mkdir(dstDir, { recursive: true });
await cp(dll, dst);
console.log('[thumbnailer] mb_viewer_thumbs.dll copied to src-tauri/');
