// Pruebas de tareas con evidencia, trabajo de un gasto, facturas de compra por pagar y fechas del calendario (_shared).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REGLAS_TAREA, evidenciaTarea } from './../supabase/functions/_shared/tareasReglas.js'
import { VENTA_REAL, toksTrab, glosaGenerica, ventaAprendida } from './../supabase/functions/_shared/ventaGastoReglas.js'
import { comprasPorPagar } from './../supabase/functions/_shared/comprasReglas.js'
import { finDeMes, diasA, CONTRIB_CUOTAS } from './../supabase/functions/_shared/calendarioReglas.js'
import { esNotaPend } from './../supabase/functions/_shared/notariaReglas.js'

const tarea = (title, o = {}) => ({ title, client_id: 'c1', created_at: '2026-10-01T10:00:00', status: 'Pendiente', ...o })

test('tarea con evidencia: «solicitar fondos» se cumple con una solicitud enviada después de crearla, del mismo cliente', () => {
  const d = { fundRequests: [{ id: 1, client_id: 'c1', enviada_at: '2026-10-05T09:00:00', monto: 500000 }, { id: 2, client_id: 'c2', enviada_at: '2026-10-06', monto: 1 }, { id: 3, client_id: 'c1', enviada_at: '2026-09-20', monto: 7 }] }
  const r = evidenciaTarea(tarea('Solicitar fondos para constitución'), d)
  assert.equal(r.regla, 'solicitud_fondos'); assert.equal(r.id, 1); assert.equal(r.texto, 'Solicitud de fondos enviada el 05-10-2026 por $500.000')
  assert.equal(evidenciaTarea(tarea('Solicitar fondos', { client_id: 'c9' }), d), null)
})

test('tarea con evidencia: sin solicitud sirve el fondo recibido; una tarea ya terminada, sin fecha o de otro tipo no tiene evidencia', () => {
  const d = { fondos: [{ id: 'e1', client_id: 'c1', type: 'fondo', amount: 300000, date: '2026-10-08' }] }
  assert.equal(evidenciaTarea(tarea('Pedir fondos'), d).tabla, 'expenses')
  assert.equal(evidenciaTarea(tarea('Pedir fondos', { status: 'Terminado' }), d), null)
  assert.equal(evidenciaTarea(tarea('Pedir fondos', { created_at: null }), d), null)
  assert.equal(evidenciaTarea(tarea('Llamar al cliente'), d), null)
  assert.equal(evidenciaTarea(null, d), null)
})

test('tarea con evidencia: factura emitida (con folio, no reembolso ni anulada, y de la venta de la tarea) y rendición enviada', () => {
  const b = (o) => ({ id: 'b', client_id: 'c1', sale_id: 's1', invoice_no: 'Factura 412', amount: 1000000, issued_at: '2026-10-09', status: 'Pendiente', ...o })
  const r = evidenciaTarea(tarea('Emitir factura septiembre', { sale_id: 's1' }), { billing: [b({})] })
  assert.equal(r.texto, 'Factura N° 412 emitida el 09-10-2026 por $1.000.000')
  assert.equal(evidenciaTarea(tarea('Facturar', { sale_id: 's1' }), { billing: [b({ billing_type: 'reembolso' }), b({ status: 'Anulada' }), b({ sale_id: 's2' }), b({ issued_at: '2026-09-01' })] }), null)
  const rd = evidenciaTarea(tarea('Rendición octubre'), { rendiciones: [{ id: 'r1', tipo: 'cliente', client_id: 'c1', sent_at: '2026-10-12T10:00:00', total: 80000 }] })
  assert.equal(rd.regla, 'rendicion_enviada'); assert.equal(rd.texto, 'Rendición enviada el 12-10-2026 por $80.000')
  assert.equal(REGLAS_TAREA.length, 4)
})

test('venta que puede recibir gastos: no propuesta, rechazada, borrador ni eliminada', () => {
  assert.equal(VENTA_REAL({ status: 'Activo' }), true)
  assert.equal(VENTA_REAL({ status: 'Terminado' }), true)
  for (const status of ['Propuesta', 'Rechazada', 'Borrador']) assert.equal(VENTA_REAL({ status }), false)
  assert.equal(VENTA_REAL({ status: 'Activo', deleted_at: 'x' }), false)
  assert.equal(VENTA_REAL(null), false)
})

test('glosa de un gasto: palabras clave sin las genéricas; solo trámite = genérica', () => {
  assert.deepEqual(toksTrab('Gastos notariales Osorno sociedad'), ['osorn'])
  assert.equal(glosaGenerica('Gastos notariales — Mandato judicial amplio'), true)
  assert.equal(glosaGenerica('Gastos notariales — Escritura Osorno'), false)
})

test('trabajo aprendido: vale solo si todas las decisiones anteriores apuntan al mismo trabajo', () => {
  const ventas = [{ id: 's1', title: 'Puesta en marcha Osorno' }, { id: 's2', title: 'Asesoría Villarica' }]
  const e = { client_id: 'c1', concept: 'Escritura osorno copias' }
  const key = 'c1::copias escritura osorno'
  assert.equal(ventaAprendida(e, ventas, [{ key, meta: { sale_id: 's1' } }, { key, value: 'Puesta en marcha Osorno' }]).n, 2)
  assert.equal(ventaAprendida(e, ventas, [{ key, meta: { sale_id: 's1' } }, { key, meta: { sale_id: 's2' } }]), null)
  assert.equal(ventaAprendida(e, ventas, []), null)
  assert.equal(ventaAprendida({ ...e, client_id: null }, ventas, [{ key }]), null)
})

const doc = (id, o = {}) => ({ id, tipo_dte: 33, emisor_rut: '76.111.111-1', emisor_name: 'Proveedor Uno', monto: 100000, fecha_emision: '2026-08-01', ...o })
const base = { hoy: '2026-10-29' }

test('compras por pagar: factura con más de 30 días, sin pago enlazado ni cargo del banco por el monto', () => {
  const r = comprasPorPagar({ ...base, docs: [doc(1)] })
  assert.equal(r.length, 1); assert.equal(r[0].falta, 100000); assert.equal(r[0].dias, 89)
})

test('compras por pagar: se descartan con evidencia (cargo del RUT, dos cargos que suman, gasto, tarjeta, colaborador, nota de crédito, marcada pagada)', () => {
  const cargo = (monto, o = {}) => ({ id: 'm' + monto, tipo: 'cargo', rut_contraparte: '76111111-1', monto, fecha: '2026-08-20', ...o })
  const casos = {
    cargoExacto: { cargos: [cargo(100000)] },
    dosCargos: { cargos: [cargo(60000), cargo(40000)] },
    gasto: { gastos: [{ amount: 100000, date: '2026-08-02' }] },
    tarjeta: { tarjetaReglas: ['proveedor uno'] },
    colaborador: { rutsColaboradores: new Set(['761111111']) },
    notaCredito: { docs: [doc(1), doc(2, { tipo_dte: 61 })] },
    pagada: { pagadas: new Set(['1']) },
    emisorTarjeta: { emisoresPago: new Set(['761111111']) },
  }
  for (const [k, extra] of Object.entries(casos)) assert.equal(comprasPorPagar({ ...base, docs: [doc(1)], ...extra }).length, 0, k)
})

test('compras por pagar: un pago parcial baja lo que falta; lo anterior a la app, lo reciente y lo ya enlazado no entra', () => {
  const r = comprasPorPagar({ ...base, docs: [doc(1)], cargos: [{ id: 'm', tipo: 'cargo', rut_contraparte: '76111111-1', monto: 30000, fecha: '2026-08-20' }] })
  assert.deepEqual([r[0].pagado, r[0].falta], [30000, 70000])
  assert.equal(comprasPorPagar({ ...base, docs: [doc(1, { fecha_emision: '2026-05-01' })] }).length, 0)
  assert.equal(comprasPorPagar({ ...base, docs: [doc(1, { fecha_emision: '2026-10-15' })] }).length, 0)
  assert.equal(comprasPorPagar({ ...base, docs: [doc(1, { movimiento_id: 'x' })] }).length, 0)
  assert.equal(comprasPorPagar({ ...base, docs: [doc(1, { tipo_dte: 61 })] }).length, 0)
})

test('fechas del calendario: fin de mes (incluido bisiesto y diciembre) y días entre fechas', () => {
  assert.equal(finDeMes('2026-02'), '2026-02-28'); assert.equal(finDeMes('2028-02'), '2028-02-29'); assert.equal(finDeMes('2026-12'), '2026-12-31')
  assert.equal(diasA('2026-10-01', '2026-10-29'), 28); assert.equal(diasA('2026-10-29', '2026-10-01'), -28)
  assert.deepEqual(CONTRIB_CUOTAS.map(c => c[0]), ['04', '06', '09', '11'])
})

test('gasto de notaría pendiente: con N° de OT, sin liquidar ni incluido en una liquidación; un fondo no', () => {
  const e = { category: 'Notaria', ot_number: 'OT 123', amount: 5000 }
  assert.equal(esNotaPend(e), true)
  assert.equal(esNotaPend({ ...e, ot_number: '' }), false)
  assert.equal(esNotaPend({ ...e, notaria_render_id: 'r' }), false)
  assert.equal(esNotaPend({ ...e, notaria_liquidado_at: '2026-10-01' }), false)
  assert.equal(esNotaPend({ ...e, type: 'fondo' }), false)
  assert.equal(esNotaPend(null), false)
})

test('compras por pagar: la factura exenta (34) también cuenta', () => {
  assert.equal(comprasPorPagar({ hoy: '2026-10-29', docs: [{ id: 1, tipo_dte: 34, emisor_rut: '76.111.111-1', monto: 50000, fecha_emision: '2026-08-01' }] }).length, 1)
})

test('tarea con evidencia: la rendición enviada de otro cliente no cuenta', () => {
  const d = { rendiciones: [{ id: 'r1', tipo: 'cliente', client_id: 'c2', sent_at: '2026-10-12T10:00:00', total: 80000 }] }
  assert.equal(evidenciaTarea(tarea('Rendición octubre'), d), null)
})
