import { copyFileSync, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'copy-stockfish-wasm',
    closeBundle() {
      const source = new URL('./node_modules/stockfish/src/stockfish-nnue-16-single.wasm', import.meta.url)
      const target = new URL('./dist/assets/stockfish-nnue-16-single.wasm', import.meta.url)

      mkdirSync(new URL('./dist/assets/', import.meta.url), { recursive: true })
      copyFileSync(source, target)
    },
  }],
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**'],
  },
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
    origin: 'http://localhost:5173',
    port: 5173,
    cors: true,
    headers: {
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['stockfish'],
  },
})
