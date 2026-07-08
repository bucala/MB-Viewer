// Writes the MB Viewer launcher icons into the generated Capacitor Android
// project (android/ is gitignored — run this after `npx cap add android`).
// Produces the full mipmap set: legacy square + round launcher icons and the
// adaptive-icon foreground (artwork inside the 66/108dp safe zone) with a
// matching background color resource.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BACKGROUND_HEX, makePng, renderForeground, renderIcon, renderRoundIcon,
} from './icon-lib.mjs';

const resDir = join(process.argv[2] ?? 'android', 'app', 'src', 'main', 'res');

try {
  await access(resDir);
} catch {
  console.error(
    `[android-icons] ${resDir} not found — generate the project first (npx cap add android).`,
  );
  process.exit(1);
}

/** Launcher densities: mdpi ×1 … xxxhdpi ×4 (48dp icon, 108dp adaptive layer). */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

for (const [density, scale] of DENSITIES) {
  const dir = join(resDir, `mipmap-${density}`);
  await mkdir(dir, { recursive: true });
  const iconPx = Math.round(48 * scale);
  const layerPx = Math.round(108 * scale);
  await writeFile(join(dir, 'ic_launcher.png'), makePng(iconPx, renderIcon(iconPx)));
  await writeFile(join(dir, 'ic_launcher_round.png'), makePng(iconPx, renderRoundIcon(iconPx)));
  await writeFile(
    join(dir, 'ic_launcher_foreground.png'),
    makePng(layerPx, renderForeground(layerPx)),
  );
}

// Adaptive-icon background color (referenced by mipmap-anydpi-v26/ic_launcher.xml).
const valuesDir = join(resDir, 'values');
await mkdir(valuesDir, { recursive: true });
await writeFile(
  join(valuesDir, 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND_HEX}</color>\n</resources>\n`,
);

console.log(`[android-icons] MB Viewer launcher icons written to ${resDir}`);
