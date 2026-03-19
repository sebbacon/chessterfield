import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: '/static/',
  build: {
    manifest: true,
    outDir: 'dist',
    rollupOptions: {
      input: '/src/main.js',
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['stockfish'],
  },
})
