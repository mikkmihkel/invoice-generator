/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works on GitHub Pages under /<repo>/ and on a custom domain alike.
// Routing uses HashRouter, so no server-side rewrites are needed.
export default defineConfig({
  base: './',
  plugins: [react()],
  // pdfmake + its fonts (~1.8 MB) are lazy-loaded chunks only fetched when a PDF is rendered.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
  },
})
