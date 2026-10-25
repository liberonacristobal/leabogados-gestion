// Pruebas de las reglas únicas (_shared): las mismas funciones que usan la app y las funciones del servidor.
// Casos tomados de situaciones reales (sin nombres de clientes). Correr: npm test (también lo corre npm run verificar).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desescaparXml } from '../supabase/functions/_shared/xmlTexto.js'
import { selectAll, conOrden } from '../supabase/functions/_shared/paginar.js'
import { tasaBHE, RETENCION_BHE } from '../supabase/functions/_shared/comisionesReglas.js'
import { f29Base, f29Estimado, TASA_PPM } from '../supabase/functions/_shared/f29Reglas.js'
import { cuotasQueReemplaza, sugerirVentas } from '../supabase/functions/_shared/facturacionReglas.js'
import { elegirFactura, folioEnTexto } from '../supabase/functions/_shared/conciliacionReglas.js'
import { trabajosDetenidos } from '../supabase/functions/_shared/ventasReglas.js'
import { montoFactura } from '../supabase/functions/_shared/saludDatos.js'

test('texto del XML: se imprime como lo lee el cliente', () => {
  assert.equal(desescaparXml('BARRA &amp; STROBEL SPA'), 'BARRA & STROBEL SPA')      // factura N° 490: el PDF decía «&amp;»
  assert.equal(desescaparXml('PE&#209;A &lt;2&gt; &quot;X&quot;'), 'PEÑA <2> "X"')
  assert.equal(desescaparXml('A &amp;lt; B'), 'A &lt; B')                              // doble escape: una sola pasada
  assert.equal(desescaparXml(null), '')
})

test('paginar: orden estable y lectura completa', async () => {
  assert.equal(conOrden('billing?select=id'), 'billing?select=id&order=id.asc')
  assert.equal(conOrden('tgr_remates?select=sk'), 'tgr_remates?select=sk&order=sk.asc')   // sin columna id: su llave primaria
  assert.equal(conOrden('miembros'), 'miembros?order=email.asc')
  assert.equal(conOrden('sales?select=id&order=fecha.desc'), 'sales?select=id&order=fecha.desc')
  assert.equal(conOrden('rpc/procesos_estado'), 'rpc/procesos_estado')
  // 2.500 filas en páginas de 1.000 → se leen las 2.500 (antes, una consulta sola devolvía 1.000 sin avisar).
  const filas = Array.from({ length: 2500 }, (_, i) => ({ id: i }))
  let paginas = 0
  const build = () => ({ range: async (a, b) => { paginas++; return { data: filas.slice(a, b + 1), error: null } } })
  const r = await selectAll(build)
  assert.equal(r.data.length, 2500); assert.equal(paginas, 3)
  const conError = await selectAll(() => ({ range: async () => ({ data: null, error: { message: 'x' } }) }))
  assert.equal(conError.data, null); assert.equal(conError.error.message, 'x')
  const demo = await selectAll(() => Promise.resolve({ data: [1, 2], error: null }))     // cliente demo: no pagina
  assert.deepEqual(demo.data, [1, 2])
})

test('retención de boletas de honorarios por año', () => {
  assert.equal(tasaBHE('2025-12-31'), RETENCION_BHE[2025])
  assert.equal(tasaBHE('2026-03-01'), 0.1525)
  assert.equal(tasaBHE('2027-01-15'), 0.16)
})

test('F29: base del PPM, retenciones e impuesto único', () => {
  const docs = [
    { tipo_dte: 34, monto: 1000000, fecha_emision: '2026-09-05' },   // exenta: por su total
    { tipo_dte: 33, monto: 1190000, fecha_emision: '2026-09-10' },   // afecta: sin IVA
    { tipo_dte: 61, monto: 200000, fecha_emision: '2026-09-20' },    // nota de crédito: resta
    { tipo_dte: 34, monto: 5000000, fecha_emision: '2026-08-30' },   // otro mes: no cuenta
  ]
  assert.deepEqual(f29Base(docs, '2026-09'), { base: 1800000, n: 2 })
  const r = f29Estimado({ per: '2026-09', docs, boletas: [{ fecha: '2026-09-12', retencion: 30500 }, { fecha: '2026-09-13', retencion: 99, estado: 'anulada' }],
    valores: {}, declarados: { '2026-08': { tasa_ppm: 2, impuesto_unico: 45000 } } })
  assert.equal(r.tasa, 0.02); assert.equal(r.ppm, 36000); assert.equal(r.ret, 30500); assert.equal(r.iu, 45000)
  assert.equal(r.total, 36000 + 30500 + 45000); assert.equal(r.completo, true)
  assert.equal(f29Estimado({ per: '2026-09', docs, boletas: [], valores: {} }).tasa, TASA_PPM)   // sin F29 cargados: tasa por defecto
})

// Factura «2/2 · 40 UF» de $1.634.180 contra cuotas de 20 UF programadas a $817.440 (UF de otro día): calza dentro del 1%.
const cuotas = (saleId, n, monto, desde = 9) => Array.from({ length: n }, (_, i) => ({ id: `${saleId}-${i}`, sale_id: saleId, status: 'Programada', amount: monto, due: `2026-${String(desde + i).padStart(2, '0')}-01` }))
test('cuotas que reemplaza una factura', () => {
  const r = cuotasQueReemplaza(cuotas('A', 10, 817440), 1634180)
  assert.equal(r.cuotas.length, 2); assert.equal(r.suma, 1634880); assert.equal(r.dif, 700); assert.equal(r.calza, true)
  const no = cuotasQueReemplaza(cuotas('A', 10, 817440), 1000000)
  assert.equal(no.cuotas.length, 1); assert.equal(no.calza, false)
  assert.equal(cuotasQueReemplaza([], 1000).calza, false)
})

test('sugerir la venta de una factura sin venta', () => {
  const factura = { client_id: 'c1', amount: 1634180, concept: 'Honorarios' }
  const sales = [{ id: 'A', client_id: 'c1', status: 'Activo' }, { id: 'B', client_id: 'c1', status: 'Activo' }, { id: 'X', client_id: 'c1', status: 'Terminado' }]
  const billing = [...cuotas('A', 10, 817440), ...cuotas('B', 3, 408720)]
  const s0 = sugerirVentas({ factura, sales, billing })
  assert.deepEqual(s0.map(x => x.sale.id), ['A', 'B'])            // las terminadas no se sugieren
  assert.equal(s0[0].motivo, 'cuotas'); assert.equal(s0[0].auto, false)
  const aprendida = sugerirVentas({ factura, sales, billing, aprendidas: { A: 2 } })
  assert.equal(aprendida[0].auto, true)                           // 2 confirmaciones y las cuotas calzan: se asigna sola
  const otra = sugerirVentas({ factura, sales, billing, aprendidas: { B: 2 } })
  assert.equal(otra[0].sale.id, 'B'); assert.equal(otra[0].auto, false)   // aprendida pero sus cuotas no calzan: compuerta
  const rech = sugerirVentas({ factura, sales, billing, rechazadas: ['A'] })
  assert.equal(rech[rech.length - 1].sale.id, 'A')
})

test('calce de un abono con su factura', () => {
  const f = (id, monto, fecha, rut = '76111111-1', folio = id) => ({ b: { id, invoice_no: folio, issued_at: fecha, receptor_rut: rut }, saldo: monto })
  const mov = { monto: 500000, fecha: '2026-10-10', rut_contraparte: '76.111.111-1' }
  assert.equal(elegirFactura(mov, [f('401', 500000, '2026-09-01')]).id, '401')
  assert.equal(elegirFactura(mov, [f('401', 499999, '2026-09-01')]), null)                     // calce exacto: sin tolerancia
  assert.equal(folioEnTexto('PAGO FACTURA 412'), '412')
  const dos = [f('401', 500000, '2026-07-01'), f('412', 500000, '2026-10-01')]
  assert.equal(elegirFactura(mov, dos, 'PAGO FACTURA 412').id, '412')                          // el folio de la glosa manda
  assert.equal(elegirFactura(mov, dos, '').id, '401')                                         // app: la más antigua
  assert.equal(elegirFactura(mov, dos, '', { estricto: true }), null)                          // servidor sin costumbre: compuerta
  assert.equal(elegirFactura(mov, dos, '', { estricto: true, habito: 'fifo' }).id, '401')
  const otroRut = [f('401', 500000, '2026-07-01', '77222222-2'), f('412', 500000, '2026-10-01')]
  assert.equal(elegirFactura(mov, otroRut, '').id, '412')                                     // la del RUT del pagador
})

test('trabajos detenidos: con saldo, terminados y casos que no se marcan', () => {
  const hoy = '2026-10-24'
  const sales = [
    { id: 's1', client_id: 'c1', status: 'Activo', moneda: 'CLP', amount_clp: 397000, created_at: '2025-01-01' },
    { id: 's2', client_id: 'c2', status: 'Activo', moneda: 'CLP', amount_clp: 1000000, created_at: '2025-01-01' },
    { id: 's3', client_id: 'c3', status: 'Activo', moneda: 'CLP', amount_clp: 500000, created_at: '2026-09-01' },   // creada hace menos de 90 días
    { id: 's4', client_id: 'c4', status: 'Activo', moneda: 'CLP', amount_clp: 500000, created_at: '2025-01-01' },   // el cliente tuvo un gasto reciente
    { id: 's5', client_id: 'c5', status: 'Activo', moneda: 'UF', amount_uf: 20, created_at: '2025-01-01' },        // sin UF: no se afirma
  ]
  const billing = [
    { id: 'b1', sale_id: 's1', invoice_no: '100', status: 'Pendiente', amount: 397000, issued_at: '2025-09-24' },
    { id: 'b2', sale_id: 's2', invoice_no: '101', status: 'Pagado', amount: 1000000, paid_amount: 1000000, issued_at: '2025-06-01' },
    { id: 'b3', sale_id: 's3', invoice_no: '102', status: 'Pendiente', amount: 500000, issued_at: '2025-05-01' },
    { id: 'b4', sale_id: 's4', invoice_no: '103', status: 'Pendiente', amount: 500000, issued_at: '2025-05-01' },
    { id: 'b5', sale_id: 's5', invoice_no: '104', status: 'Pagado', amount: 800000, issued_at: '2025-05-01' },
  ]
  const expenses = [{ client_id: 'c4', date: '2026-10-01' }]
  const r = trabajosDetenidos({ sales, billing, expenses, hoy })
  const por = Object.fromEntries(r.map(x => [x.s.id, x]))
  assert.equal(por.s1.tipo, 'con_saldo'); assert.equal(por.s1.dias, 395); assert.equal(por.s1.porCobrar, 397000)
  assert.equal(por.s2.tipo, 'terminado')
  assert.equal(por.s3, undefined); assert.equal(por.s4, undefined); assert.equal(por.s5, undefined)
  const decidido = trabajosDetenidos({ sales, billing, expenses, hoy, decididos: { s2: '2026-10-01' } })
  assert.equal(decidido.find(x => x.s.id === 's2'), undefined)   // «Sigue activo» se recuerda 90 días
})

test('monto de una factura: manda el XML del SII', () => {
  assert.equal(montoFactura({ amount: 1000, dte_xml: '<Totales><MntTotal>1634180</MntTotal></Totales>' }), 1634180)
  assert.equal(montoFactura({ amount: 1000 }), 1000)
})
