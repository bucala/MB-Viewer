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

// Store handles for e2e tests and console debugging.
(globalThis as Record<string, unknown>).__mbViewer = { viewer: useViewer, settings: useSettings };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
