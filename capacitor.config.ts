import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mbviewer.app',
  appName: 'MB Viewer',
  webDir: 'dist',
  server: {
    // WASM (occt-import-js) requires a secure context on Android.
    androidScheme: 'https',
  },
};

export default config;
