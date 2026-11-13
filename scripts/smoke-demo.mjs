// smoke-demo.mjs — prueba automática antes de publicar (npm run verificar; la corre el pre-push de .githooks).
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
  'repricing', 'cartera', 'presupuestoOficina', 'presupuesto', 'socios', 'panelSocios', 'informeMes', 'proveedores', 'subarriendo', 'resultadoAnio', 'facturasDelMes', 'cobradoMes', 'porFacturar', 'estadoResultados',
  'flujoCaja', 'mesEnMarcha', 'procesos', 'calendarioTrib', 'bandeja', 'miCarga', 'contactos', 'causas', 'novedades', 'pdfSinOficial', 'misComisiones', 'porCobrarMios', 'migmail']
// Páginas y ventanas que se abren sin datos (desde menú o tarjetas).
const MODALES = ['ajustes', 'revisionDatos', 'notificaciones', 'aprendizaje', 'modulos', 'papelera', 'porSocio', 'roles', 'users', 'coberturaSII', 'redProfesional', 'pdfupload', 'drive', 'importExcel', 'gmailContactos', 'gmailTareas', 'conciliaHub']
// Detalles con datos: los tres primeros de cada tipo (ficha del cliente, venta, factura, gasto, tarea).
const DETALLES = ['cliente', 'venta', 'factura', 'gasto', 'tarea']
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
    // La demo no depende de internet: un servicio externo lento (p. ej. mindicador.cl) no debe colgar la prueba.
    await page.setRequestInterception(true)
    page.on('request', req => { const h = new URL(req.url()).hostname; (h === 'localhost' || h === '127.0.0.1' || req.url().startsWith('data:') || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(h)) ? req.continue() : req.abort() })
    await page.goto(`${base}?demo=1`, { waitUntil: 'networkidle0', timeout: 60000 })
    const monto = await page.waitForFunction(() => !!window.__demo, { timeout: 20000 }).then(() => true, () => false)
    if (!monto) { const t = await page.evaluate(() => document.body.innerText.slice(0, 200)); fallas.push({ vista: nombre, donde: 'al abrir la demo', error: errores[0] || t || 'la app no montó' }); await page.close(); continue }
    // Aviso de Novedades al entrar.
    await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continuar')?.click() })

    const revisar = async (etiqueta, accion) => {
      errores = []
      await page.evaluate(accion.fn, accion.arg)
      await sleep(700)
      const texto = await page.evaluate(() => document.body.innerText)
      revisadas++
      // Celular: ninguna vista puede tener barra de desplazamiento horizontal (regla del 06-11-2026): la página no se pasa del ancho ni hay contenedores con overflow-x que se desplacen.
      const ancho = w < 768 ? await page.evaluate(() => {
        const vw = document.documentElement.clientWidth, ms = document.getElementById('main-scroll')
        if (document.documentElement.scrollWidth > vw + 1 || (ms && ms.scrollWidth > ms.clientWidth + 1)) return 'la página se pasa del ancho (' + Math.max(document.documentElement.scrollWidth, ms ? ms.scrollWidth : 0) + ' px en ' + vw + ')'
        const b = [...document.querySelectorAll('body *')].find(e => { const cs = getComputedStyle(e); return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && e.offsetParent !== null })
        return b ? 'barra horizontal en ' + b.tagName + ' «' + (b.innerText || '').replace(/\s+/g, ' ').slice(0, 40) + '» (' + b.scrollWidth + ' px en ' + b.clientWidth + ')' : null
      }) : null
      if (ancho) fallas.push({ vista: nombre, donde: etiqueta, error: 'scroll horizontal: ' + ancho })
      if (BLINDAJE.test(texto) || errores.length) {
        fallas.push({ vista: nombre, donde: etiqueta, error: errores[0] || (texto.match(BLINDAJE) || [''])[0] })
        // Recupera la app para seguir revisando el resto.
        await page.goto(`${base}?demo=1`, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => !!window.__demo, { timeout: 20000 }).catch(() => {})
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
    // Presupuesto: los seis pasos (el 4.º, Metas, es nuevo) y la pestaña Por socio del paso 5; cada uno sin error ni scroll horizontal en celular.
    if (!solo.length || solo.includes('presupuesto')) {
      for (let i = 1; i <= 6; i++) {
        await revisar(`presupuesto paso ${i}`, { fn: async (i) => { window.__demo.setModal(null); window.__demo.navTo({ tab: 'presupuesto' }); const esp = ms => new Promise(r => setTimeout(r, ms)); await esp(900); [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Paso ' + i + ':') || new RegExp('^(✓ )?' + i + ' · ').test(b.textContent.trim()))?.click(); await esp(300); if (i === 5) { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Por socio')?.click(); await esp(300) } }, arg: i })
        if (i === 6) { const t6 = await page.evaluate(() => document.body.innerText); if (!/Vendido/i.test(t6) || !/Retiros/i.test(t6) || !/Margen en caja/.test(t6) || /asegurad/i.test(t6)) fallas.push({ vista: nombre, donde: 'presupuesto paso 6', error: 'faltan las seis tarjetas del Seguimiento o la línea del plano del margen (o aparece «asegurado»)' }) }
        if (i === 5) { const t5 = await page.evaluate(async () => { [...document.querySelectorAll('[role=tab],button')].find(b => b.textContent.trim() === 'Resultado')?.click(); await new Promise(r => setTimeout(r, 400)); [...document.querySelectorAll('button')].find(b => /^Ver detalle/.test(b.textContent.trim()))?.click(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('button')].find(b => /Ajustar/.test(b.textContent))?.click(); await new Promise(r => setTimeout(r, 300)); return document.body.innerText }); if (!/Conservador/.test(t5) || !/Optimista/.test(t5) || !/Cobranza/.test(t5) || !/Por facturar que se arrastra/.test(t5) || !/Cerrar ▴/.test(t5)) fallas.push({ vista: nombre, donde: 'presupuesto paso 5', error: 'faltan los escenarios Conservador, Ideal y Optimista, la cobranza o la apertura del arrastre' }) }
        if (i === 1) { const t1 = await page.evaluate(() => document.body.innerText); if (!/CONVERSIÓN\s*\n?\s*\d+ %/i.test(t1)) fallas.push({ vista: nombre, donde: 'presupuesto paso 1', error: 'el indicador Conversión no muestra su cifra (la demo trae propuestas decididas)' }) }
        if (i === 4) { const t4 = await page.evaluate(() => document.body.innerText); if (!/Calculada|Fijada/.test(t4) || !/Falta facturar/i.test(t4) || !/Distribución/i.test(t4)) fallas.push({ vista: nombre, donde: 'presupuesto paso 4', error: 'faltan la tabla de metas, «Falta facturar» o los accesos inferiores' }) }
      }
    }
    // Resultado del año · planilla de octubre con «Impuestos mensuales» y el detalle de cada tipo (PPM, retención, impuesto único): página con «← Costos de …», sin error ni scroll horizontal.
    if (!solo.length || solo.includes('resultadoAnio')) {
      for (const k of ['planilla', 'PPM', 'Retención de honorarios', 'Impuesto único']) {
        await revisar(`resultado del año · impuestos mensuales · ${k}`, { fn: async (k) => { window.__demo.setModal(null); const esp = ms => new Promise(r => setTimeout(r, ms)); window.__demo.navTo({ tab: 'dashboard' }); await esp(400); window.__demo.navTo({ tab: 'resultadoAnio' }); await esp(900); const ce = [...document.querySelectorAll('td.er-c, div.er-c')]; const oct = ce.filter(x => x.tagName === 'TD')[9] || ce.find(x => /oct/i.test(x.textContent.slice(0, 12))); oct?.click(); await esp(400); if (k === 'planilla') return; [...document.querySelectorAll('[role=button]')].find(b => b.textContent.trim().startsWith(k === 'PPM' ? 'PPM' : k))?.click(); await esp(400) }, arg: k })
        const t = await page.evaluate(() => document.body.innerText)
        if (k === 'planilla' && (!/IMPUESTOS MENSUALES/i.test(t) || !/1\.833\.004/.test(t))) fallas.push({ vista: nombre, donde: 'planilla de octubre', error: 'falta el grupo «Impuestos mensuales» o su total no es el de octubre' })
        if (k === 'Retención de honorarios' && !/falta/.test(t)) fallas.push({ vista: nombre, donde: 'retención de honorarios', error: 'no marca la boleta por cargar' })
      }
    }
    // Presupuesto · Arrastre (paso 2): las tres páginas de líneas (por facturar, asesorías y todas) se abren desde sus filas; la demo trae cuotas con vencimiento en 2027.
    if (!solo.length || solo.includes('presupuesto')) {
      for (const k of ['Por facturar', 'Asesorías permanentes', 'Facturado del arrastre']) {
        await revisar(`presupuesto arrastre · ${k}`, { fn: async (k) => { window.__demo.setModal(null); window.__demo.navTo({ tab: 'presupuesto' }); const esp = ms => new Promise(r => setTimeout(r, ms)); await esp(900); [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Paso 2:'))?.click(); await esp(300); [...document.querySelectorAll('[role=button]')].find(b => b.textContent.trim().startsWith(k))?.click(); await esp(300); window.__arrastreSmoke = / · (valores calculados|\d+ líneas? ajustadas?)/.test(document.body.innerText) ? '' : 'la página del Arrastre no muestra sus líneas' }, arg: k })
        const af = await page.evaluate(() => window.__arrastreSmoke)
        if (af) fallas.push({ vista: nombre, donde: `presupuesto · Arrastre · ${k}`, error: af })
      }
    }
    // Procesos automáticos: los 4 chips filtran (aria-pressed) y tocarlos otra vez quitan el filtro; «Revisar ›» de Por aprobar está presente.
    if (!solo.length || solo.includes('procesos')) {
      await revisar('procesos · filtros', { fn: async () => {
        window.__demo.setModal(null); window.__demo.navTo({ tab: 'procesos' }); const esp = ms => new Promise(r => setTimeout(r, ms)); await esp(600)
        const chips = () => [...document.querySelectorAll('button[aria-pressed]')].filter(b => /^(Correctos|Con falla|Aún no corren|Apagados)/.test(b.textContent.trim()))
        window.__procesosSmoke = chips().length === 4 && /Revisar ›/.test(document.body.innerText) ? '' : 'faltan los 4 chips o «Revisar ›»'
        for (const t of ['Correctos', 'Con falla', 'Aún no corren', 'Apagados']) {
          const b = chips().find(x => x.textContent.trim().startsWith(t)); b.click(); await esp(150)
          if (chips().find(x => x.textContent.trim().startsWith(t)).getAttribute('aria-pressed') !== 'true' || chips().filter(x => x.getAttribute('aria-pressed') === 'true').length !== 1) window.__procesosSmoke += ` · «${t}» no queda activo`
        }
        chips().find(x => x.getAttribute('aria-pressed') === 'true').click(); await esp(150)
        if (chips().some(x => x.getAttribute('aria-pressed') === 'true')) window.__procesosSmoke += ' · el segundo toque no quita el filtro'
      }, arg: null })
      const pf = await page.evaluate(() => window.__procesosSmoke)
      if (pf) fallas.push({ vista: nombre, donde: 'procesos · filtros', error: pf })
    }
    // Bandeja del agente: los 4 filtros, llegando con foco desde navTo y tocando el chip (aria-pressed marca el activo).
    if (!solo.length || solo.includes('bandeja')) {
      for (const f of ['pend', 'hech', 'sosp', 'sin'])
        await revisar(`bandeja filtro ${f} (foco)`, { fn: f => { window.__demo.setModal(null); window.__demo.navTo({ tab: 'bandeja', foco: { f } }) }, arg: f })
      for (const [f, t] of [['hech', 'Ya registrados'], ['sin', 'Sin acción'], ['sosp', 'Sospechosos'], ['pend', 'Pendientes']]) {
        await revisar(`bandeja chip ${f}`, { fn: t => { window.__demo.setModal(null); window.__demo.navTo({ tab: 'bandeja' }); setTimeout(() => [...document.querySelectorAll('button[aria-pressed]')].find(b => b.textContent.trim().startsWith(t))?.click(), 250) }, arg: t })
        const activo = await page.evaluate(t => [...document.querySelectorAll('button[aria-pressed="true"]')].some(b => b.textContent.trim().startsWith(t)), t)
        if (!activo) fallas.push({ vista: nombre, donde: `bandeja chip ${f}`, error: 'el chip no quedó activo (aria-pressed)' })
      }
    }
    for (const d of DETALLES.filter(d => !solo.length || solo.includes(d))) for (const i of [0, 1, 2]) {
      await revisar(`detalle ${d} ${i + 1}`, { fn: ([d, i]) => { window.__demo.setModal(null); window.__demo.setTab('dashboard'); setTimeout(() => window.__demo.abrir(d, i), 50) }, arg: [d, i] })
      await page.evaluate(() => { window.__demo.setModal(null); window.__demo.setTab('dashboard') })
    }
    for (const m of MODALES.filter(m => !solo.length || solo.includes(m))) {
      await revisar(`página ${m}`, { fn: m => { window.__demo.setTab('dashboard'); window.__demo.setModal({ type: m }) }, arg: m })
      await page.evaluate(() => window.__demo.setModal(null))
    }
    await page.close()
  }
  // ── Carga real simulada: la app SIN modo demo, como en producción, con una sesión falsa de un socio y TODA llamada a Supabase
  // respondida aquí con los datos de la demo (nunca sale a la base real). Pasa por las mismas cargas que producción (getBilling,
  // selectAll, roles), que la demo se salta: el 24-10 una variable sin importar en supabase.js botó la app y la demo no lo vio.
  if (!solo.length) {
    const tmp = mkdtempSync(join(tmpdir(), 'smoke-'))
    writeFileSync(join(tmp, 'demo.mjs'), readFileSync(new URL('../src/demoData.js', import.meta.url), 'utf8'))
    const { demoData } = await import(join(tmp, 'demo.mjs'))
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const sbUrl = (env.match(/VITE_SUPABASE_URL=(\S+)/) || [])[1] || ''
    const ref = (sbUrl.match(/https:\/\/([a-z0-9]+)\./) || [])[1] || 'x'
    const email = 'cl@leabogados.cl'
    const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: { full_name: 'Prueba' } }
    const sesion = { access_token: 'prueba', refresh_token: 'prueba', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
    const tablas = { ...demoData, miembros: [{ email, nombre: 'Cristóbal', rol: 'admin', estudio_id: 'lea', es_socio: true }], user_roles: [{ email, role: 'admin', name: 'Cristóbal' }], estudios: [] }
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    let errores = []
    page.on('pageerror', e => errores.push(String(e?.message || e)))
    page.on('console', async m => { if (m.type() !== 'error' || RUIDO.test(m.text())) return; const partes = await Promise.all(m.args().map(a => a.evaluate(v => v instanceof Error ? v.message : String(v)).catch(() => ''))); const txt = partes.filter(Boolean).join(' ') || m.text(); if (!RUIDO.test(txt)) errores.push(txt) })
    await page.evaluateOnNewDocument((k, v) => { window.__pruebaCarga = true; try { localStorage.setItem(k, v) } catch (_) {} }, `sb-${ref}-auth-token`, JSON.stringify(sesion))
    await page.setRequestInterception(true)
    page.on('request', req => {
      const u = new URL(req.url())
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(u.hostname)) return req.continue()
      if (!sbUrl || !req.url().startsWith(sbUrl)) return req.abort()   // nada sale a internet
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Content-Range' }
      const resp = (status, body, extra = {}) => req.respond({ status, contentType: 'application/json', headers: { ...cors, ...extra }, body: body === undefined ? '' : JSON.stringify(body) })
      if (req.method() === 'OPTIONS') return resp(204)
      if (u.pathname.startsWith('/auth/v1/user')) return resp(200, user)
      if (u.pathname.startsWith('/auth/v1/')) return resp(200, sesion)
      if (u.pathname.startsWith('/functions/v1/')) return resp(200, {})
      if (u.pathname.startsWith('/storage/v1/')) return resp(200, [])
      const t = (u.pathname.match(/^\/rest\/v1\/(rpc\/)?([^/?]+)/) || [])
      if (t[1]) return resp(200, [])
      const filas = req.method() === 'GET' || req.method() === 'HEAD' ? (Array.isArray(tablas[t[2]]) ? tablas[t[2]] : []) : []
      if (/vnd\.pgrst\.object/.test(req.headers()['accept'] || '')) return filas.length ? resp(200, filas[0]) : resp(406, { code: 'PGRST116', message: 'sin filas' })
      return resp(req.method() === 'POST' ? 201 : 200, filas, { 'Content-Range': `0-${Math.max(0, filas.length - 1)}/${filas.length}` })
    })
    await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 })
    await page.waitForFunction(() => !!window.__demo, { timeout: 30000 }).catch(() => {})
    await sleep(1500)
    const FALLA_CARGA = /Error al cargar datos|No se pudieron cargar/
    const revisar = async (donde, fn, arg) => {
      errores = []
      if (fn) { await page.evaluate(fn, arg).catch(e => errores.push(String(e?.message || e))); await sleep(700) }
      const texto = await page.evaluate(() => document.body.innerText)
      revisadas++
      if (BLINDAJE.test(texto) || FALLA_CARGA.test(texto) || errores.length) fallas.push({ vista: 'carga real', donde, error: errores[0] || (texto.match(BLINDAJE) || texto.match(FALLA_CARGA) || [''])[0] })
    }
    await revisar('al entrar')
    const montada = await page.evaluate(() => !!window.__demo)
    if (!montada) fallas.push({ vista: 'carga real', donde: 'al entrar', error: 'la app no terminó de cargar (sin sesión o sin rol)' })
    else for (const t of TABS) await revisar(`pestaña ${t}`, t => { window.__demo.setModal(null); window.__demo.navTo({ tab: t }) }, t)
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
console.log(`✓ Prueba de la demo: ${revisadas} vistas sin error (escritorio y celular, y carga real simulada)`)
