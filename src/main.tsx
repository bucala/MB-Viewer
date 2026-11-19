import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installBvhRaycast } from '@/core/bvh';
import { initDesktopIntegration } from '@/core/desktop';
import { initMobileIntegration } from '@/core/mobile';
import { useViewer } from '@/store/viewerStore';
import { useSettings } from '@/store/settingsStore';
import App from '@/app/App';
import '@/index.css';

installBvhRaycast();
initDesktopIntegration();
initMobileIntegration();

// Store handles for e2e tests and console debugging — never in a release
// build (opt in with VITE_E2E=1 when testing a production bundle).
if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
  (globalThis as Record<string, unknown>).__mbViewer = { viewer: useViewer, settings: useSettings };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
