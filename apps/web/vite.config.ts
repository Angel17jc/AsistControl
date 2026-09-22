/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development too: the refresh cookie (SameSite=strict, path /api/auth) just works.
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/socket.io': { target: API, ws: true },
      '/health': { target: API },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
