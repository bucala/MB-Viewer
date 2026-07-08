import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';

/**
 * Glue to the Capacitor mobile shell (no-op on web and desktop). The viewer
 * is a full-screen 3D app: the Android status bar would overlay the toolbar
 * (clock/battery over the app's own controls), so it is hidden entirely.
 */
export function initMobileIntegration(): void {
  if (!Capacitor.isNativePlatform()) return;

  const hide = () =>
    StatusBar.hide().catch((error: unknown) =>
      console.warn('[mobile] could not hide the status bar:', error),
    );

  void hide();
  // Android shows the bar again after backgrounding — re-hide on resume.
  document.addEventListener('resume', () => void hide());
}
