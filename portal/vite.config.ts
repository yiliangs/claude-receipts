import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app runs from any local path (file-served or static host).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  // 4179 keeps the receipts portal clear of other local dev servers. If taken, Vite bumps
  // and the launcher's --open follows the real port, so the right page always opens.
  server: { port: 4179 },
})
