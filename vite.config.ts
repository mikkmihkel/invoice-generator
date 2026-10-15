/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Content-Security-Policy for the production build (tested in Chromium: register search incl. live RIK API,
 * PDF preview iframe, downloads, print, Google Identity Services popup, Drive/Gmail APIs).
 * - 'unsafe-inline' styles: the blob: PDF viewer inherits this policy and uses inline styles; GIS injects a <style>.
 * - Not applied in dev: the React refresh preamble is an inline script.
 * - frame-ancestors cannot be set from a <meta> tag (GitHub Pages sends no custom headers).
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://ariregister.rik.ee https://data-api.ecb.europa.eu https://ec.europa.eu/taxation_customs/vies/rest-api/ https://www.googleapis.com https://gmail.googleapis.com https://oauth2.googleapis.com https://accounts.google.com/gsi/",
  'frame-src blob: https://accounts.google.com/gsi/',
  "worker-src 'none'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'upgrade-insecure-requests',
].join('; ')

function securityHeaders(): Plugin {
  return {
    name: 'security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head-prepend' },
    ],
  }
}

// Relative base so the build works on GitHub Pages under /<repo>/ and on a custom domain alike.
// Routing uses HashRouter, so no server-side rewrites are needed.
export default defineConfig({
  base: './',
  plugins: [react(), securityHeaders()],
  // pdfmake + its fonts (~1.8 MB) are lazy-loaded chunks only fetched when a PDF is rendered.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
  },
})
