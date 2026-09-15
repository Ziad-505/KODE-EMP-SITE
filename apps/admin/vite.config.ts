import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@kode/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/media': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  // Source maps are deliberately off.
  //
  // `true` emits index-<hash>.js.map next to the bundle, the Dockerfile copies
  // the whole dist into nginx, and nginx serves /assets/ with `expires 1y` — so
  // roughly 2 MB of original TypeScript, comments included, was publicly
  // fetchable by anyone who could load the page. Use 'hidden' if you later want
  // maps for an error tracker: it emits them without the sourceMappingURL
  // comment, so you can upload them and keep them out of the image.
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        /*
         * React, the router and the query client in their own chunk.
         *
         * Route splitting alone barely moved the first load, because the route
         * chunks are 2-6 kB each and the weight was always the shared runtime.
         * What this buys instead is caching across deploys: the vendor chunk's
         * hash only changes when a dependency changes, so shipping a content
         * fix re-downloads the app chunk and leaves ~100 kB of framework in the
         * browser cache.
         */
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
