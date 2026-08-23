/**
 * Standalone Vite config for previewing the RENDERER in a plain browser
 * (design work / UI review without launching Electron).
 *
 *   npx vite --config vite.preview.config.ts
 *
 * The Electron API is mocked by src/renderer/src/dev/mockApi.ts.
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  server: {
    port: 5273,
    strictPort: true
  }
})
