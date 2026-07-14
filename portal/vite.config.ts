import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built app runs from any local path (file-served or static host).
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react()],
  publicDir: command === 'serve' ? 'public' : false,
  build: { outDir: '../dist/portal', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 4179 },
}))
