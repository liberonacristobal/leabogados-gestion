import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // El logo de la rendición debe quedar inline (data URI) para que el PDF imprima sin red.
    assetsInlineLimit: 20000,
  }
})
