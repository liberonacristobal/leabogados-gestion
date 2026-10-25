// smoke-demo.mjs — prueba automática antes de publicar (npm run verificar; la corre el pre-push de .githooks).
// Sirve el build (dist) con vite preview, abre la demo (?demo=1) en Chrome sin ventana y recorre cada vista y página sin datos
// propios, en escritorio (1280) y celular (375). Falla si una vista muestra el blindaje de error («Esta vista tuvo un problema» /
// «La app tuvo un problema») o si la página lanza un error de JavaScript. El build verde no garantiza que la app monte: dos veces
// una variable sin declarar dejó la pantalla en negro (2026-06 navOrigin, 2026-09 billingIntent).
// Chrome: CHROME_PATH o el de macOS. Uso: node scripts/smoke-demo.mjs [--solo=billing,sales]
import { preview } from 'vite'
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
if (!CHROME) { console.error('No encontré Chrome: define CHROME_PATH.'); process.exit(2) }

// Pestañas que se abren solas (sin un registro elegido). Las de detalle (tarea, gasto, factura, flujo) necesitan datos y se prueban por su lista.
const TABS = ['dashboard', 'sales', 'billing', 'expenses', 'clients', 'tasks', 'conciliacion', 'inteligencia', 'cajachica', 'cobranza', 'horas',
  'repricing', 'cartera', 'presupuestoOficina', 'socios', 'proveedores', 'subarriendo', 'resultadoAnio', 'facturasDelMes', 'estadoResultados',
  'flujoCaja', 'procesos', 'calendarioTrib', 'bandeja', 'miCarga', 'contactos', 'causas', 'novedades', 'misComisiones', 'porCobrarMios']
// Páginas y ventanas que se abren sin datos (desde menú o tarjetas).
const MODALES = ['revisionDatos', 'aprendizaje', 'modulos', 'papelera', 'porSocio', 'roles', 'users', 'coberturaSII', 'redProfesional']
const VISTAS = [['escritorio', 1280, 900], ['celular', 375, 812]]
const BLINDAJE = /Esta vista tuvo un problema|La app tuvo un problema/
// Ruido conocido de la demo (sin red real) que no es un error de la app.
const RUIDO = /Failed to load resource|ERR_|net::|favicon|Download the React DevTools|Warning: /

const solo = (process.argv.find(a => a.startsWith('--solo=')) || '').slice(7).split(',').filter(Boolean)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const server = await preview({ preview: { port: 4179, strictPort: false }, logLevel: 'silent' })
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const fallas = []
let revisadas = 0

try {
  for (const [nombre, w, h] of VISTAS) {
    const page = await browser.newPage()
    await page.setViewport({ width: w, height: h, isMobile: w < 768, hasTouch: w < 768 })
    let errores = []
    page.on('pageerror', e => errores.push(String(e?.message || e)))
    page.on('console', async m => {
      if (m.type() !== 'error' || RUIDO.test(m.text())) return
      // React registra el objeto Error: se lee su mensaje en vez de «JSHandle@error».
      const partes = await Promise.all(m.args().map(a => a.evaluate(v => v instanceof Error ? v.message : String(v)).catch(() => '')))
      const txt = partes.filter(Boolean).join(' ') || m.text()
      if (!RUIDO.test(txt)) errores.push(txt)
    })
    await page.goto(`${base}?demo=1`, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.waitForFunction(() => !!window.__demo, { timeout: 30000 })
    // Aviso de Novedades al entrar.
    await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continuar')?.click() })

    const revisar = async (etiqueta, accion) => {
      errores = []
      await page.evaluate(accion.fn, accion.arg)
      await sleep(700)
      const texto = await page.evaluate(() => document.body.innerText)
      revisadas++
      if (BLINDAJE.test(texto) || errores.length) {
        fallas.push({ vista: nombre, donde: etiqueta, error: errores[0] || (texto.match(BLINDAJE) || [''])[0] })
        // Recupera la app para seguir revisando el resto.
        await page.goto(`${base}?demo=1`, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => !!window.__demo)
        await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continuar')?.click() })
      }
    }
    // Lectores de documentos (carga diferida): un PDF mínimo se abre y la librería de Word responde.
    if (!solo.length && nombre === 'escritorio') {
      const lect = await page.evaluate(async () => {
        try {
          const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
          const lib = await window.__demo.cargarPdfjs()
          const doc = await lib.getDocument({ data: new TextEncoder().encode(pdf) }).promise
          const mm = await window.__demo.cargarMammoth()
          return doc.numPages === 1 && typeof mm.extractRawText === 'function' ? null : `PDF ${doc.numPages} páginas · Word ${typeof mm.extractRawText}`
        } catch (e) { return String(e?.message || e) }
      })
      revisadas++
      if (lect) fallas.push({ vista: nombre, donde: 'lectores de PDF y Word', error: lect })
    }
    for (const t of TABS.filter(t => !solo.length || solo.includes(t)))
      await revisar(`pestaña ${t}`, { fn: t => { window.__demo.setModal(null); window.__demo.navTo({ tab: t }) }, arg: t })
    for (const m of MODALES.filter(m => !solo.length || solo.includes(m))) {
      await revisar(`página ${m}`, { fn: m => { window.__demo.setTab('dashboard'); window.__demo.setModal({ type: m }) }, arg: m })
      await page.evaluate(() => window.__demo.setModal(null))
    }
    await page.close()
  }
} finally {
  await browser.close()
  await new Promise(r => server.httpServer.close(r))
}

if (fallas.length) {
  console.error(`\n✗ Prueba de la demo: ${fallas.length} de ${revisadas} vistas con error`)
  fallas.forEach(f => console.error(`  · ${f.vista} · ${f.donde}: ${String(f.error).slice(0, 220)}`))
  process.exit(1)
}
console.log(`✓ Prueba de la demo: ${revisadas} vistas sin error (escritorio y celular)`)
