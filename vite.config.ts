import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/index.html'),
        preview: resolve(__dirname, 'src/preview/index.html'),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    // mcp-server is a separate Node package with its own vitest run.
    exclude: ['node_modules', 'dist', 'mcp-server/**'],
  },
});
