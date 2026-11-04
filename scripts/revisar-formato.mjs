// revisar-formato.mjs — informe (no bloquea): recorre cada pestaña, página y detalle de la demo a 1280, 1024 y 375 px y lista el texto cortado con «…» y el desborde horizontal.
// Uso: npm run build && node scripts/revisar-formato.mjs
// (misma base que smoke-demo.mjs)
// Sirve el build (dist) con vite preview, abre la demo (?demo=1) en Chrome sin ventana y recorre cada vista y página sin datos
// propios, en escritorio (1280) y celular (375). Falla si una vista muestra el blindaje de error («Esta vista tuvo un problema» /
// «La app tuvo un problema») o si la página lanza un error de JavaScript. El build verde no garantiza que la app monte: dos veces
// una variable sin declarar dejó la pantalla en negro (2026-06 navOrigin, 2026-09 billingIntent).
// Chrome: CHROME_PATH o el de macOS. Uso: node scripts/smoke-demo.mjs [--solo=billing,sales]
import { preview } from 'vite'
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
if (!CHROME) { console.error('No encontré Chrome: define CHROME_PATH.'); process.exit(2) }

// Pestañas que se abren solas (sin un registro elegido). Las de detalle (tarea, gasto, factura, flujo) necesitan datos y se prueban por su lista.
const TABS = ['dashboard', 'sales', 'billing', 'expenses', 'clients', 'tasks', 'conciliacion', 'inteligencia', 'cajachica', 'cobranza', 'horas',
  'repricing', 'cartera', 'presupuestoOficina', 'socios', 'panelSocios', 'informeMes', 'proveedores', 'subarriendo', 'resultadoAnio', 'facturasDelMes', 'estadoResultados',
  'flujoCaja', 'procesos', 'calendarioTrib', 'bandeja', 'miCarga', 'contactos', 'causas', 'novedades', 'misComisiones', 'porCobrarMios']
// Páginas y ventanas que se abren sin datos (desde menú o tarjetas).
const MODALES = ['revisionDatos', 'notificaciones', 'aprendizaje', 'modulos', 'papelera', 'porSocio', 'roles', 'users', 'coberturaSII', 'redProfesional']
// Detalles con datos: los tres primeros de cada tipo (ficha del cliente, venta, factura, gasto, tarea).
const DETALLES = ['cliente', 'venta', 'factura', 'gasto', 'tarea']
const VISTAS = [['escritorio', 1280, 900], ['celular', 375, 812]]
const BLINDAJE = /Esta vista tuvo un problema|La app tuvo un problema/
// Ruido conocido de la demo (sin red real) que no es un error de la app.
const RUIDO = /Failed to load resource|ERR_|net::|favicon|Download the React DevTools|Warning: /


const sleep = ms => new Promise(r => setTimeout(r, ms))
const VISTAS_F = [['escritorio 1280', 1280, 900], ['escritorio 1024', 1024, 800], ['celular 375', 375, 812]]
const server = await preview({ preview: { port: 4180, strictPort: false }, logLevel: 'silent' })
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const informe = []

// Mide lo que el ojo ve mal: texto cortado con «…», desborde horizontal de la página, textos de menos de 10 px.
const medir = () => {
  const cortados = []
  const vistos = new Set()
  document.querySelectorAll('body *').forEach(e => {
    if (e.closest('nav,.sidenav,.bottomnav')) return
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return
    const s = getComputedStyle(e)
    const txt = (e.textContent || '').trim()
    if (!txt) return
    const ell = s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1
    const clamp = s.webkitLineClamp && s.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 3
    if ((ell || clamp) && !vistos.has(txt.slice(0, 40))) { vistos.add(txt.slice(0, 40)); cortados.push(`${e.tagName.toLowerCase()}|${txt.slice(0, 44)}`) }
  })
  const de = document.documentElement
  return { desborde: de.scrollWidth > de.clientWidth + 1, cortados: cortados.slice(0, 10), nCortados: cortados.length }
}

try {
  for (const [nombre, w, h] of VISTAS_F) {
    const page = await browser.newPage()
    await page.setViewport({ width: w, height: h, isMobile: w < 768, hasTouch: w < 768 })
    await page.setRequestInterception(true)
    page.on('request', req => { const hh = new URL(req.url()).hostname; (hh === 'localhost' || hh === '127.0.0.1' || req.url().startsWith('data:') || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(hh)) ? req.continue() : req.abort() })
    await page.goto(`${base}?demo=1`, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.waitForFunction(() => !!window.__demo, { timeout: 20000 })
    await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continuar')?.click() })
    const ver = async (etiqueta, fn, arg) => {
      await page.evaluate(fn, arg).catch(() => {}); await sleep(800)
      const m = await page.evaluate(medir)
      if (m.desborde || m.nCortados) informe.push({ vista: nombre, donde: etiqueta, ...m })
    }
    for (const t of TABS) await ver(`pestaña ${t}`, t => { window.__demo.setModal(null); window.__demo.navTo({ tab: t }) }, t)
    for (const d of DETALLES) for (const i of [0, 1, 2]) {
      await ver(`detalle ${d} ${i + 1}`, ([d, i]) => { window.__demo.setModal(null); window.__demo.setTab('dashboard'); setTimeout(() => window.__demo.abrir(d, i), 50) }, [d, i])
      await page.evaluate(() => { window.__demo.setModal(null); window.__demo.setTab('dashboard') })
    }
    for (const m of MODALES) { await ver(`página ${m}`, m => { window.__demo.setTab('dashboard'); window.__demo.setModal({ type: m }) }, m); await page.evaluate(() => window.__demo.setModal(null)) }
    await page.close()
  }
} finally {
  await browser.close()
  await new Promise(r => server.httpServer.close(r))
}
const porVista = {}
informe.forEach(i => { (porVista[i.donde] = porVista[i.donde] || []).push(i) })
for (const [donde, arr] of Object.entries(porVista)) {
  console.log(`\n${donde}`)
  arr.forEach(i => console.log(`  [${i.vista}]${i.desborde ? ' DESBORDE HORIZONTAL' : ''} ${i.nCortados ? `cortados(${i.nCortados}): ` + i.cortados.map(c => `«${c}»`).join(' ') : ''}`))
}
console.log(`\n${informe.length} combinaciones vista × formato con algo por revisar`)
