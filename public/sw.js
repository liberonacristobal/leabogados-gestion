// Service worker de la app: SOLO notificaciones (no guarda copias de la app, así cada publicación se ve al instante).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch (_) { d = { cuerpo: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Aviso', {
    body: d.cuerpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.etiqueta || undefined,
    data: { url: d.url || '/' },
  }))
})

// Tocar la notificación abre (o enfoca) la app en la vista del aviso.
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const app = abiertas.find(c => new URL(c.url).origin === self.location.origin)
    // App abierta: se le pasa la dirección y ella abre la vista (el iPhone no permite cambiarla desde aquí).
    if (app) { app.postMessage({ tipo: 'abrir-aviso', url }); await app.focus(); return }
    await self.clients.openWindow(url)
  })())
})
