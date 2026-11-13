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
  // Tauri: don't clear the terminal, and fail fast if the port is taken
  // (tauri.conf.json points at this exact port). The dev server stays on
  // localhost; VITE_LAN=1 exposes it on the LAN when a phone needs to reach
  // it (Capacitor live reload).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.VITE_LAN === '1' ? true : undefined,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
