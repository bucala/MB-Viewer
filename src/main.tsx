import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installBvhRaycast } from '@/core/bvh';
import App from '@/app/App';
import '@/index.css';

installBvhRaycast();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
