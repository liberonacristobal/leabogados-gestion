import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Versión del build (Vercel entrega el commit; en local, git): queda en cada error registrado (app_errores.version).
const build = (process.env.VERCEL_GIT_COMMIT_SHA || (()=>{ try{ return execSync('git rev-parse HEAD').toString().trim() }catch(_){ return '' } })() || 'local').slice(0,8)

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(build) },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // El logo de la rendición debe quedar inline (data URI) para que el PDF imprima sin red.
    assetsInlineLimit: 20000,
    // Librerías base en su propio archivo: no cambian entre publicaciones, así el teléfono las guarda y solo baja la app.
    rollupOptions: { output: { manualChunks: id => /node_modules\/(react|react-dom|scheduler|@supabase)\//.test(id) ? 'base' : undefined } },
  }
})
