import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App, { PortalApp, AppErrorBoundary } from './App.jsx'

// Tras una publicación, una pestaña abierta con la versión anterior pide archivos que ya no existen: se recarga una vez.
window.addEventListener('vite:preloadError', e => {
  try { if (sessionStorage.getItem('recarga_version')) return; sessionStorage.setItem('recarga_version', '1') } catch (_) { return }
  e.preventDefault(); window.location.reload()
})
window.addEventListener('load', () => { try { setTimeout(() => sessionStorage.removeItem('recarga_version'), 10000) } catch (_) {} })

// Notificaciones al teléfono: el service worker solo recibe avisos (public/sw.js); no en la demo.
if ('serviceWorker' in navigator && new URLSearchParams(window.location.search).get('demo') !== '1') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}

// Modo portal del cliente: /portal (o ?portal=1) → página externa con login por correo, separada del app interno.
const esPortal = window.location.pathname.replace(/\/+$/,'') === '/portal' || new URLSearchParams(window.location.search).get('portal') === '1'

// Franja de aviso cuando se cae la conexión; se quita sola al volver (la app ya abierta sigue mostrando lo cargado).
function AvisoConexion() {
  const [en, setEn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
  useEffect(() => {
    const on = () => setEn(true), off = () => setEn(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (en) return null
  return (
    <div role="status" style={{ position: 'sticky', top: 0, zIndex: 100000, background: '#FBF0DC', color: '#B8741A', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 'calc(7px + env(safe-area-inset-top, 0px)) 16px 7px', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span>Sin conexión. No se pueden guardar cambios.</span>
      <button onClick={() => window.location.reload()} style={{ background: 'none', border: 'none', color: '#003C50', fontWeight: 600, fontSize: 12, cursor: 'pointer', padding: 0 }}>Reintentar</button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AvisoConexion /><AppErrorBoundary>{esPortal ? <PortalApp /> : <App />}</AppErrorBoundary>
  </React.StrictMode>
)
// Tue Jun  9 17:43:53 -04 2026
