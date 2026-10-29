// Service worker de la app: avisos y apertura sin conexión.
// Guarda solo los archivos con huella (/assets, no cambian entre publicaciones) y la página de entrada con respaldo:
// la página va primero a la red (cada publicación se ve al instante) y solo sin señal se usa la copia.
// Nunca guarda consultas a Supabase: las cifras siempre salen del servidor.
const CACHE = 'firmdesk-app-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

// Al publicar una versión nueva se borran las copias de la anterior (si no, la carpeta crecería sin límite).
async function limpiarSiHayVersionNueva() {
  try {
    const v = (await (await fetch('/version.json', { cache: 'no-store' })).json())?.v
    if (!v) return
    const c = await caches.open(CACHE)
    const previa = await c.match('/__version')
    if (previa && (await previa.text()) === v) return
    if (previa) for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith('/assets/')) await c.delete(k)
    await c.put('/__version', new Response(v))
  } catch (_) {}
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req)
      if (hit) return hit
      const r = await fetch(req)
      if (r.ok) c.put(req, r.clone())
      return r
    }))
    return
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); e.waitUntil(limpiarSiHayVersionNueva().then(() => caches.open(CACHE)).then(c => c.put('/index.html', copia))) }
      return r
    }).catch(async () => (await caches.match('/index.html')) || Response.error()))
  }
})

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
