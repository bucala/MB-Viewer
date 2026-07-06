import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri: don't clear the terminal, expose the dev server on the LAN so the
  // Android WebView (Capacitor live reload) can reach it, and fail fast if
  // the port is taken (tauri.conf.json points at this exact port).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
