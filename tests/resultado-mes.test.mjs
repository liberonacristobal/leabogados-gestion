// resultadoMes (compartido.jsx) con la lógica REAL: el subarriendo no es ingreso, baja el costo (línea negativa) en las dos ramas, la NC de una factura de subarriendo no resta honorarios y el flujo usa costo bruto.
// compartido.jsx importa React y el cliente de Supabase, así que se empaqueta con esbuild a un archivo temporal y se importa. Datos anonimizados.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const raiz = resolve(import.meta.dirname, '..')
let M, dir
before(async () => {
  globalThis.localStorage = { getItem() { return null }, setItem() {} }
  dir = mkdtempSync(join(tmpdir(), 'rm-'))
  const out = join(dir, 'compartido.mjs')
  await build({ stdin: { contents: `export * from ${JSON.stringify(join(raiz, 'src/lib/compartido.jsx'))}`, resolveDir: raiz, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, nodePaths: [join(raiz, 'node_modules')],
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"x"', 'import.meta.env': '{}' },
    logLevel: 'silent', jsx: 'automatic', external: ['pdfjs-dist/build/pdf.worker?url'], banner: { js: "import {createRequire} from 'module'; const require=createRequire(import.meta.url);" } })
  M = await import(pathToFileURL(out).href)
})
after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* sin limpieza */ } })

const ym = '2026-05'
const billing = [{ id: 'h1', billing_type: 'honorarios', invoice_no: '1', status: 'Pagado', issued_at: '2026-05-10' }, { id: 'h2', billing_type: 'honorarios', invoice_no: '3', status: 'Pagado', issued_at: '2026-05-12' },
  { id: 's1', billing_type: 'subarriendo', invoice_no: '2', status: 'Pagado', issued_at: '2026-05-11' }, { id: 'ncs', billing_type: 'nota_credito', invoice_no: '4', nc_ref_billing_id: 's1', status: 'Pagado', issued_at: '2026-05-20' },
  { id: 'nch', billing_type: 'nota_credito', invoice_no: '5', nc_ref_billing_id: 'h2', status: 'Pagado', issued_at: '2026-05-21' }]
const doc = (t, id, monto, f) => ({ tipo_dte: t, monto, fecha_emision: f, billing_id: id, folio: id })
const sii = [doc(33, 'h1', 1_000_000, '2026-05-10'), doc(33, 'h2', 400_000, '2026-05-12'), doc(34, 's1', 500_000, '2026-05-11'), doc(61, 'ncs', 500_000, '2026-05-20'), doc(61, 'nch', 100_000, '2026-05-21')]
const costos = [{ categoria: 'Arriendo y espacio', item: 'Arriendo', monto: 2_000_000 }, { categoria: 'Arriendo y espacio', item: 'Subarriendo', monto: 500_000, es_ingreso: true, desde: '2026-03-01', monto_prev: 0 }, { categoria: 'Servicios', item: 'Internet', monto: 50_000 }]
const deps = { billing, terceros: [], costosOfiRows: costos, expenses: [], clients: [] }
const plan = { anio: 2026, mes: 5, sueldos: 1_000_000, cotizaciones: 200_000, ppm: 80_000, contadora: 50_000, arriendo: 2_000_000, gastos_comunes: 0, honorarios: 0, otros_costos: 0, subarriendo: 500_000, cerrado: true }

test('ingresos = facturación propia (sin la factura de subarriendo ni su nota de crédito); la NC de una factura propia sí resta', () => {
  const r = M.resultadoMes({ sii, plan: [], boleta: new Set() }, deps, ym)
  assert.equal(r.fac, 1_000_000 + 400_000 - 100_000)   // h1 + h2 − NC de h2; la factura de subarriendo y su NC no cuentan
  assert.equal(r.ing, r.fac + r.rex); assert.equal(r.ing, 1_300_000)
})
test('sin planilla: el costo es el presupuesto bruto y una línea negativa de subarriendo; el resultado cuadra', () => {
  const r = M.resultadoMes({ sii, plan: [], boleta: new Set() }, deps, ym)
  assert.equal(r.sub, 500_000); assert.equal(r.cosLines.find((x) => x.k === 'sub').m, -500_000); assert.equal(r.cosLines.find((x) => x.k === 'pre').m, 2_050_000)
  assert.equal(r.cos, 2_050_000 - 500_000); assert.equal(r.res, r.ing - r.cos - r.com); assert.equal(r.cos, r.cosLines.reduce((t, x) => t + x.m, 0))   // Costos = suma de sus líneas, con el subarriendo (negativo) dentro
})
test('con planilla: mismo tratamiento; la columna «subarriendo» de la planilla es solo informativa', () => {
  const a = M.resultadoMes({ sii, plan: [plan], boleta: new Set() }, deps, ym), b = M.resultadoMes({ sii, plan: [{ ...plan, subarriendo: 0 }], boleta: new Set() }, deps, ym)
  assert.equal(a.conPlanilla, true); assert.equal(a.sub, 500_000); assert.equal(a.cosLines.find((x) => x.k === 'sub').m, -500_000); assert.equal(a.res, a.ing - a.cos - a.com)
  assert.equal(a.cos, b.cos); assert.equal(a.ing, b.ing); assert.equal(a.res, b.res)   // la columna de la planilla no mueve nada
  assert.equal(a.ing, 1_300_000)
})
test('las dos ramas restan el mismo subarriendo (la diferencia entre ellas es la base de costos, no el subarriendo)', () => {
  const a = M.resultadoMes({ sii, plan: [plan], boleta: new Set() }, deps, ym), s = M.resultadoMes({ sii, plan: [], boleta: new Set() }, deps, ym)
  assert.equal(a.sub, s.sub); assert.equal(a.ing, s.ing)
})
test('sin ítem es_ingreso vigente el subarriendo no baja el costo (el aviso de Salud de datos lo detecta); antes de su inicio vale cero', () => {
  const sin = M.resultadoMes({ sii, plan: [], boleta: new Set() }, { ...deps, costosOfiRows: costos.filter((c) => !c.es_ingreso) }, ym)
  assert.equal(sin.sub, 0); assert.equal(sin.cos, 2_050_000)
  const antes = M.resultadoMes({ sii: [], plan: [], boleta: new Set() }, deps, '2026-02'); assert.equal(antes.sub, 0)
})
test('flujo de caja: el costo de operación real es BRUTO (cos + sub + ppm): el subarriendo ya entra por su cobro', () => {
  const r = M.resultadoMes({ sii, plan: [plan], boleta: new Set() }, deps, ym)
  assert.equal(M.costoOperacionBruto(r), r.cos + 500_000 + r.ppm); assert.ok(M.costoOperacionBruto(r) > r.cos + r.ppm)
  assert.equal(M.costoOperacionBruto({ cos: 10, sub: 0 }), 10); assert.equal(M.costoOperacionBruto(null), 0)
})

test('costoOperacionReal (el consumidor real del flujo) con 3 meses de planilla: mensual = bruto (cos + subarriendo + PPM), no el neto', () => {
  const clients = [{ id: 'of', is_internal: true, name: 'Oficina' }], hoy = new Date(2026, 5, 15)
  const planes = [3, 4, 5].map((mes) => ({ ...plan, mes })), expenses = [{ id: 'e1', client_id: 'of', type: 'gasto', category: 'Aseo', date: '2026-05-05', amount: 100_000 }]
  const d = { billing: [], terceros: [], costosOfiRows: costos, expenses, clients }
  const real = M.costoOperacionReal({ sii: [], plan: planes, boleta: new Set() }, d, hoy)
  assert.ok(real); assert.deepEqual([...real.meses].sort(), ['2026-03', '2026-04', '2026-05'])
  const rs = real.meses.map((y) => M.resultadoMes({ sii: [], plan: planes, boleta: new Set() }, d, y))
  const bruto = rs.reduce((a, r) => a + r.cos + r.sub + r.ppm, 0) / 3, neto = rs.reduce((a, r) => a + r.cos + r.ppm, 0) / 3
  assert.equal(real.mensual, bruto); assert.equal(real.mensual - neto, 500_000)
})
test('sin planilla, el costo neto de resultadoMes y el presupuesto de costos del año (sin PPM, neto) son la misma cifra', () => {
  const rows = [...costos, { categoria: 'Impuestos y patentes', item: 'PPM', monto: 80_000 }]
  const r = M.resultadoMes({ sii: [], plan: [], boleta: new Set() }, { ...deps, costosOfiRows: rows }, ym)
  const bud = M.costoOficinaNeto(rows.filter((x) => !M.esPPMcosto(x)), ym)   // misma expresión que budMes de presupuestoDatos.js
  assert.equal(r.cos, bud); assert.equal(bud, 2_050_000 - 500_000)
})

test('planilla sin cerrar y sin remuneraciones (solo el arriendo) es borrador: el mes usa el presupuesto neto y marca planillaIncompleta; con sueldos, aunque estimada, se usa; cerrada, siempre', () => {
  const borrador = { anio: 2026, mes: 5, sueldos: 0, cotizaciones: 0, ppm: 0, arriendo: 2_000_000, estimado: false, cerrado: false }
  const b = M.resultadoMes({ sii: [], plan: [borrador], boleta: new Set() }, deps, ym), s = M.resultadoMes({ sii: [], plan: [], boleta: new Set() }, deps, ym)
  assert.equal(b.conPlanilla, false); assert.equal(b.planillaIncompleta, true); assert.equal(b.cos, s.cos); assert.equal(b.cos, 2_050_000 - 500_000)
  const est = M.resultadoMes({ sii: [], plan: [{ ...plan, cerrado: false, estimado: true }], boleta: new Set() }, deps, ym)
  assert.equal(est.conPlanilla, true); assert.equal(est.planillaIncompleta, false); assert.equal(est.estimado, true)
  const cer = M.resultadoMes({ sii: [], plan: [{ ...borrador, cerrado: true }], boleta: new Set() }, deps, ym)
  assert.equal(cer.conPlanilla, true); assert.equal(s.planillaIncompleta, false)
  assert.equal(M.costoOperacionReal({ sii: [], plan: [3, 4, 5].map((mes) => ({ ...borrador, mes })), boleta: new Set() }, { ...deps, clients: [{ id: 'of', is_internal: true }], expenses: [{ client_id: 'of', type: 'gasto', category: 'Aseo', date: '2026-05-05', amount: 1 }] }, new Date(2026, 5, 15)), null)   // borradores no alimentan el flujo
})

test('remuneraciones desde el banco: quien emite boleta cuesta el bruto de la boleta (500.000 líquidos a 15,25 % = 589.970), la misma fuente que Impuestos mensuales', async () => {
  const { brutoDeLiquido } = await import('./../supabase/functions/_shared/impuestosMensuales.js')
  const r = M.remuneracionesBancoMes([{ client_id: 'of', type: 'gasto', category: 'Sueldos', subcategory: 'Carla', date: '2026-10-30', amount: 500000 }], [{ id: 'of', is_internal: true }], '2026-10', new Set(['carla']))
  assert.equal(r.items[0].costo, 589_970); assert.equal(r.items[0].costo, brutoDeLiquido(500000, 0.1525)); assert.equal(r.total, 589_970)
})
