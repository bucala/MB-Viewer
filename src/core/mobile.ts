import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { openModelFile } from '@/core/loaders/openModelFile';

interface CadFilePlugin {
  addListener(event: 'openFile', listener: (file: { uri: string; name: string }) => void): Promise<PluginListenerHandle>;
}

const CadFile = registerPlugin<CadFilePlugin>('CadFile');

/** Handle files opened by Android and keep the viewer fullscreen on mobile. */
export function initMobileIntegration(): void {
  if (!Capacitor.isNativePlatform()) return;

  if (Capacitor.getPlatform() === 'android') {
    void CadFile.addListener('openFile', ({ uri, name }) => {
      void openModelFile({
        name,
        async arrayBuffer() {
          // Capacitor streams the content URI into the WebView without base64 IPC.
          const response = await fetch(Capacitor.convertFileSrc(uri), { cache: 'no-store' });
          if (!response.ok) throw new Error(`Could not open Android document (${response.status})`);
          return response.arrayBuffer();
        },
      });
    }).catch((error: unknown) => console.warn('[mobile] could not listen for CAD files:', error));
  }

  const hide = () =>
    StatusBar.hide().catch((error: unknown) =>
      console.warn('[mobile] could not hide the status bar:', error),
    );

  void hide();
  // Hide the system bar again on resume so it doesn't overlay the toolbar.
  document.addEventListener('resume', () => void hide());
}
