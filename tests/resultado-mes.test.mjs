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

test('de lo emitido a lo facturado: Total emitido − reembolsos − subarriendo − por cuenta de externos − notas de crédito = Facturado (caso real de noviembre anonimizado)', () => {
  const ym = '2026-11'
  const billing = [
    { id: 'h1', billing_type: 'honorarios', invoice_no: '1', status: 'Pagado' },
    { id: 'h2', billing_type: 'honorarios', invoice_no: '2', status: 'Anulada' },
    { id: 'r1', billing_type: 'reembolso', invoice_no: '3', status: 'Pendiente' },
    { id: 's1', billing_type: 'subarriendo', invoice_no: '4', status: 'Pagado' },
    { id: 'e1', billing_type: 'honorarios', invoice_no: '5', status: 'Pagado' },
  ]
  const terceros = [{ billing_id: 'e1', comision_pct: 15, comision_monto: 60_000, monto: 340_000 }]
  const sii = [
    { tipo_dte: 34, monto: 1_000_000, fecha_emision: '2026-11-03', folio: '1', billing_id: 'h1' },
    { tipo_dte: 34, monto: 500_000, fecha_emision: '2026-11-13', folio: '2', billing_id: 'h2' },
    { tipo_dte: 61, monto: 500_000, fecha_emision: '2026-11-13', folio: '9', billing_id: null },
    { tipo_dte: 34, monto: 200_000, fecha_emision: '2026-11-05', folio: '3', billing_id: 'r1' },
    { tipo_dte: 34, monto: 300_000, fecha_emision: '2026-11-06', folio: '4', billing_id: 's1' },
    { tipo_dte: 34, monto: 400_000, fecha_emision: '2026-11-07', folio: '5', billing_id: 'e1' },
  ]
  const r = M.resultadoMes({ sii, plan: [], boleta: new Set() }, { billing, terceros, costosOfiRows: [], expenses: [], clients: [] }, ym)
  assert.equal(r.fac, 1_000_000)                       // honorarios propios: 1.000.000 + 500.000 − la NC de 500.000
  assert.deepEqual(r.facExc, { reemb: 200_000, subarr: 300_000, ext: 400_000, nc: 500_000 })
  assert.equal(r.totalEmitido, 2_400_000)               // todos los documentos tipo 33/34 del mes
  assert.equal(r.totalEmitido - r.facExc.reemb - r.facExc.subarr - r.facExc.ext - r.facExc.nc, r.fac)
})

test('el impuesto único de las liquidaciones va dentro de Remuneraciones: líquido del banco + impuesto único (+ retención de la boleta), y sin remuneración no hay impuesto único', () => {
  const ym2 = '2026-10', clients = [{ id: 'of', is_internal: true }]
  const expenses = [
    { client_id: 'of', type: 'gasto', category: 'Sueldos', subcategory: 'Ana', date: '2026-10-30', amount: 1_000_000 },
    { client_id: 'of', type: 'gasto', category: 'Sueldos', subcategory: 'Beto', date: '2026-10-30', amount: 600_000 },
    { client_id: 'of', type: 'gasto', category: 'Sueldos', subcategory: 'Carla', date: '2026-10-30', amount: 500_000 },   // emite boleta
  ]
  const liq = [{ periodo: '2026-10', persona: 'A', impuesto_unico: 50_000 }, { periodo: '2026-10', persona: 'B', impuesto_unico: 20_000 }]
  const r = M.resultadoMes({ sii: [], plan: [{ anio: 2026, mes: 10 }], boleta: new Set(['carla']), liq }, { billing: [], terceros: [], costosOfiRows: [], expenses, clients }, ym2)
  const bruta = Math.round(500_000 / (1 - 0.1525))
  assert.equal(r.remDet.iu, 70_000); assert.equal(r.remDet.liquido, 1_600_000); assert.equal(r.remDet.boleta, 500_000); assert.ok(Math.abs(r.remDet.retencion - (bruta - 500_000)) <= 1)
  assert.ok(Math.abs(r.cosLines.find((x) => x.k === 'rem').m - (1_600_000 + bruta + 70_000)) <= 1)
  assert.equal(r.cos, r.cosLines.reduce((t, x) => t + x.m, 0))
  const sin = M.resultadoMes({ sii: [], plan: [], boleta: new Set(), liq }, { billing: [], terceros: [], costosOfiRows: [], expenses: [], clients }, '2026-11')
  assert.equal(sin.remDet.iu, 0)   // sin remuneración en el mes no se carga impuesto único
})

test('el costo de los socios del mes (sueldo, impuesto único y cotizaciones) sale de resultadoMes y suma lo que el Resultado ya descuenta por ellos', () => {
  const clients = [{ id: 'of', is_internal: true }]
  const expenses = [
    { client_id: 'of', type: 'gasto', category: 'Sueldos', subcategory: 'Socia', date: '2026-10-30', amount: 2_300_000 },
    { client_id: 'of', type: 'gasto', category: 'Sueldos', subcategory: 'Empleado', date: '2026-10-30', amount: 1_500_000 },
  ]
  const liq = [{ periodo: '2026-10', persona: 'UNO PEREZ SOCIA', imponible: 3_000_000, impuesto_unico: 100_000, liquido: 2_300_000 }, { periodo: '2026-10', persona: 'TRES LOPEZ EMPLEADO', imponible: 2_000_000, impuesto_unico: 30_000, liquido: 1_500_000 }]
  const fu = { sii: [], plan: [{ anio: 2026, mes: 10, cotizaciones: 1_300_000 }], boleta: new Set(), liq, socios: ['Socia'] }
  const r = M.resultadoMes(fu, { billing: [], terceros: [], costosOfiRows: [], expenses, clients }, '2026-10')
  // trabajador socia: 3.000.000 − 100.000 − 2.300.000 = 600.000; empleado: 470.000; empleador = 1.300.000 − 1.070.000 = 230.000, de lo cual 60 % es de la socia
  assert.equal(r.socDet.sueldo, 2_300_000); assert.equal(r.socDet.iu, 100_000); assert.equal(r.socDet.cotTrab, 600_000); assert.equal(r.socDet.cotEmp, 138_000)
  assert.equal(r.soc, 2_300_000 + 100_000 + 600_000 + 138_000); assert.equal(r.socRem, 2_400_000); assert.equal(r.socCot, 738_000)
  assert.ok(r.soc <= r.cosLines.filter((x) => x.k === 'rem' || x.k === 'cot').reduce((a, x) => a + x.m, 0))   // nunca más de lo que el Resultado descuenta en Remuneraciones y Cotizaciones
  const sinSocios = M.resultadoMes({ ...fu, socios: [] }, { billing: [], terceros: [], costosOfiRows: [], expenses, clients }, '2026-10'); assert.equal(sinSocios.soc, 0)
})
