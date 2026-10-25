import React from 'react'
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>{esPortal ? <PortalApp /> : <App />}</AppErrorBoundary>
  </React.StrictMode>
)
// Tue Jun  9 17:43:53 -04 2026
