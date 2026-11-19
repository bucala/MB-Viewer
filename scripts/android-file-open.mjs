import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

if (process.env.CAPACITOR_PLATFORM_NAME !== 'android') process.exit(0);

const main = new URL('../android/app/src/main/', import.meta.url);
const manifest = new URL('AndroidManifest.xml', main);
const plugins = new URL('assets/capacitor.plugins.json', main);
const javaDir = new URL('java/com/mbviewer/app/', main);
const classpath = 'com.mbviewer.app.CadFilePlugin';

// content:// URIs can have opaque paths, so unknown CAD documents need the
// octet-stream filter. The viewer checks the name or STEP header at import.
const mimeTypes = [
  'application/octet-stream',
  'application/step',
  'application/x-step',
  'model/step',
  'model/iges',
  'application/iges',
  'model/stl',
  'application/sla',
  'model/obj',
  'model/gltf-binary',
];
const marker = '<!-- MB Viewer file opening -->';
const filter = [
  marker,
  '            <intent-filter>',
  '                <action android:name="android.intent.action.VIEW" />',
  '                <category android:name="android.intent.category.DEFAULT" />',
  '                <data android:scheme="content" />',
  ...mimeTypes.map((type) => `                <data android:mimeType="${type}" />`),
  '            </intent-filter>',
  '            <!-- End MB Viewer file opening -->',
].join('\n');

const xml = await readFile(manifest, 'utf8');
const mainActivity = /(<activity\b[^>]*\bandroid:name="\.MainActivity"[^>]*>[\s\S]*?)([ \t]*<\/activity>)/;
if (!mainActivity.test(xml)) throw new Error('Could not find the Capacitor MainActivity in AndroidManifest.xml');
const updatedXml = xml.replace(mainActivity, (_, body, close) => {
  const previous = /<!-- MB Viewer file opening -->[\s\S]*?<!-- End MB Viewer file opening -->/;
  const updatedBody = body.includes(marker)
    ? body.replace(previous, filter)
    : `${body}            ${filter}\n`;
  return updatedBody + close;
});

const entries = JSON.parse(await readFile(plugins, 'utf8'));
if (!entries.some((entry) => entry.classpath === classpath)) entries.push({ classpath });
await mkdir(javaDir, { recursive: true });
await copyFile(new URL('./android-native/CadFilePlugin.java', import.meta.url), new URL('CadFilePlugin.java', javaDir));
await writeFile(plugins, JSON.stringify(entries, null, 2) + '\n');
await writeFile(manifest, updatedXml);
