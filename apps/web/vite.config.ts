/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

// Same-origin in development too: the refresh cookie (SameSite=strict, path /api/auth) just works.
const proxy = {
  '/api': { target: API, changeOrigin: true },
  '/socket.io': { target: API, ws: true },
  '/health': { target: API },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  // `vite preview` serves the production bundle; the browser tests drive that one.
  preview: { port: 4173, proxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Forms are filled with user-event, one timer per keystroke: on a loaded machine a long
    // form took more than Vitest's 5 s. A real hang still fails, just later.
    testTimeout: 15_000,
  },
});
