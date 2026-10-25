// Pruebas de las reglas únicas (_shared), segunda tanda: salud de datos, compras, notaría, comisiones, calces combinados.
// Casos de situaciones reales, sin nombres de clientes. Correr: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { folioDup, facDup, montoNeDte, rutMulti, comprasEnPlazoReclamo, comprasObservadasSII } from '../supabase/functions/_shared/saludDatos.js'
import { calcesCompraPago } from '../supabase/functions/_shared/comprasReglas.js'
import { liqParaCargo, notariaPendientes, disponibleNotaria, tipoActoNotaria } from '../supabase/functions/_shared/notariaReglas.js'
import { nombreGenerico } from '../supabase/functions/_shared/contrapartes.js'
import { estadoComision, pagarT, reajusteBHEPago } from '../supabase/functions/_shared/comisionesReglas.js'
import { elegirCombo } from '../supabase/functions/_shared/conciliacionReglas.js'
import { periodoDeTexto } from '../supabase/functions/_shared/facturacionReglas.js'

test('folio duplicado: solo folios vivos y numéricos', () => {
  const r = folioDup([{ invoice_no: '412' }, { invoice_no: 'Factura 412' }, { invoice_no: '413' }, { invoice_no: '414', status: 'Anulada' }, { invoice_no: '414' }, { invoice_no: '415', deleted_at: '2026-10-01' }, { invoice_no: '415' }])
  assert.deepEqual(r.map(x => x.folio), ['412'])
})

test('facturas duplicadas: la misma cuota del mismo receptor, no una serie mensual', () => {
  const base = { receptor_rut: '76.111.111-1', concept: 'Asesoría mensual', amount: 817440 }
  // Serie mensual: folios propios emitidos con un mes de diferencia → no es duplicado.
  assert.equal(facDup([{ ...base, invoice_no: '401', issued_at: '2026-09-01' }, { ...base, invoice_no: '420', issued_at: '2026-10-01' }]).length, 0)
  // Dos pagadas con folio propio → tramos legítimos, no duplicado.
  assert.equal(facDup([{ ...base, invoice_no: '401', issued_at: '2026-10-01', status: 'Pagado' }, { ...base, invoice_no: '402', issued_at: '2026-10-02', status: 'Pagado' }]).length, 0)
  // Misma semana, mismo receptor, mismo monto, pendientes → candidato a revisar.
  const dup = facDup([{ ...base, invoice_no: '401', issued_at: '2026-10-01', status: 'Pendiente' }, { ...base, invoice_no: '402', issued_at: '2026-10-03', status: 'Pendiente' }])
  assert.equal(dup.length, 1); assert.equal(dup[0].rows.length, 2)
  // Otro receptor con el mismo monto → no se cruzan.
  assert.equal(facDup([{ ...base, invoice_no: '401', issued_at: '2026-10-01' }, { ...base, receptor_rut: '77.222.222-2', invoice_no: '402', issued_at: '2026-10-01' }]).length, 0)
})

test('monto distinto del DTE y RUT en varias fichas', () => {
  const r = montoNeDte([{ amount: 1000, dte_xml: '<MntTotal>1000</MntTotal>' }, { amount: 1000, dte_xml: '<MntTotal>1190</MntTotal>' }, { amount: 1000 }])
  assert.equal(r.length, 1); assert.equal(r[0].dte, 1190)
  const m = rutMulti([{ client_id: 'a', rut: '76.111.111-1', name: 'X SpA' }, { client_id: 'b', rut: '761111111', name: 'X SpA' }, { client_id: 'a', rut: '77.222.222-2' }])
  assert.equal(m.length, 1); assert.deepEqual(m[0].clientIds.sort(), ['a', 'b'])
})

test('compras: plazo de reclamo de 8 días y observadas por el SII', () => {
  const docs = [
    { id: 1, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-20', tipo_dte: 33 },   // vence 28-10
    { id: 2, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-10', tipo_dte: 33 },   // venció 18-10
    { id: 3, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-22', tipo_dte: 61 },   // nota de crédito: no se reclama
    { id: 4, sii_estado: 'ACEPTADO', fecha_recepcion: '2026-10-22', tipo_dte: 33 },
  ]
  const r = comprasEnPlazoReclamo(docs, '2026-10-24')
  assert.deepEqual(r.map(x => x.d.id), [1]); assert.equal(r[0].vence, '2026-10-28'); assert.equal(r[0].quedan, 4)
  assert.equal(comprasEnPlazoReclamo(docs, '2026-10-24', new Set(['1'])).length, 0)   // ya revisada
  const obs = comprasObservadasSII([{ id: 'a', observado_sii: true, periodo: '2025-09', folio: 2 }, { id: 'b', observado_sii: false }, { id: 'c', observado_sii: true, periodo: '2025-08', folio: 9 }], new Set(['x']))
  assert.deepEqual(obs.map(x => x.id), ['c', 'a'])
})

test('factura de compra ↔ pago del banco: calce exacto y único', () => {
  const d = (id, monto, fecha, rut = '76.111.111-1') => ({ id, tipo_dte: 33, monto, fecha_emision: fecha, emisor_rut: rut })
  const c = (id, monto, fecha, rut = '76111111-1') => ({ id, tipo: 'cargo', monto: -monto, fecha, rut_contraparte: rut })
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01')], [c('m1', 119000, '2026-10-20')]).length, 1)
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01')], [c('m1', 119001, '2026-10-20')]).length, 0)    // al peso
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01')], [c('m1', 119000, '2027-01-10')]).length, 0)    // fuera de 75 días
  // Dos facturas iguales y un solo pago → ambiguo, no se enlaza ninguna.
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01'), d('f2', 119000, '2026-10-02')], [c('m1', 119000, '2026-10-20')]).length, 0)
  // Un cargo ya enlazado a otra factura no se reutiliza.
  assert.equal(calcesCompraPago([{ ...d('f0', 119000, '2026-09-01'), movimiento_id: 'm1' }, d('f1', 119000, '2026-10-01')], [c('m1', 119000, '2026-10-20')]).length, 0)
})

test('notaría: deuda por OT, disponible del cliente y liquidación del pago', () => {
  const g = [
    { id: 1, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: '446651', amount: 100000 },
    { id: 2, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: '', amount: 50000 },             // sin OT: no es deuda con la notaría
    { id: 3, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: '446652', amount: 1 },            // escritura anulada
    { id: 4, client_id: 'c', type: 'fondo', amount: 300000 },
    { id: 5, client_id: 'c', type: 'gasto', category: 'CBR', amount: 40000, rendered_at: '2026-10-01' },      // ya pagado
    { id: 6, client_id: 'c', type: 'gasto', category: 'CBR', amount: 30000 },                                 // reservado para otro gasto
  ]
  assert.deepEqual(notariaPendientes(g).map(e => e.id), [1])
  const d = disponibleNotaria(g, 'c')
  assert.equal(d.fondo, 300000); assert.equal(d.pagado, 40000)
  assert.equal(d.reservado, 80000)   // gasto 2 (sin OT) + gasto 6; la notaría con OT no se reserva: es la que se paga
  assert.equal(d.disp, 180000)
  assert.equal(disponibleNotaria(g, 'of', { esOficina: id => id === 'of' }).disp, Infinity)
  const liqs = [{ id: 'L1', total: 1335000, created_at: '2026-10-10' }, { id: 'L2', total: 900000, created_at: '2026-10-12' }]
  const m = { tipo: 'cargo', monto: -1335000, fecha: '2026-10-19', rut_contraparte: '7777777-7' }
  assert.deepEqual(liqParaCargo(m, liqs, new Set()), { liq: liqs[0], exacto: true, auto: false })
  assert.equal(liqParaCargo(m, liqs, new Set(['7777777-7'])).auto, true)                                     // RUT ya aprendido de la notaría
  assert.equal(liqParaCargo({ ...m, monto: -1300000 }, liqs, new Set()), null)                               // distinto y RUT desconocido
  assert.equal(liqParaCargo({ ...m, monto: -1300000 }, liqs, new Set(['7777777-7'])).exacto, false)          // dentro del 10%: solo sugiere
  assert.equal(tipoActoNotaria({ materia: 'MANDATO JUDICIAL' }), 'Mandato judicial')
  assert.equal(tipoActoNotaria({ concept: 'Poder especial' }), 'Poder o mandato especial')
  assert.equal(tipoActoNotaria({ concept: 'xyz' }), 'Otro')
})

test('nombre genérico del banco: no identifica al pagador', () => {
  assert.equal(nombreGenerico('NOMINA MISMO DIA PROVEEDORES'), true)
  assert.equal(nombreGenerico('PAGO MASIVO 2026'), true)
  assert.equal(nombreGenerico(''), true)
  assert.equal(nombreGenerico('Inversiones Ríofrío Ltda'), false)
})

test('comisiones: estado, monto a transferir y reajuste de la retención', () => {
  assert.equal(estadoComision({ estado: 'pagado' }, { status: 'Pendiente' }), 'pagada')
  assert.equal(estadoComision({ estado: 'pendiente' }, { status: 'Pagado' }), 'por_pagar')     // el cliente ya pagó su cuota
  assert.equal(estadoComision({ estado: 'pendiente' }, { status: 'Pendiente' }), 'por_devengar')
  assert.equal(pagarT({ monto: 100000, liquido: 84750 }), 84750)                               // boleta: se transfiere el líquido
  assert.equal(pagarT({ monto: 100000 }), 100000)                                              // factura: el monto
  // Estimada con la tasa de 2025 (14,5%) y pagada en 2026 (15,25%): el bruto se rehace con la tasa del año del pago.
  const r = reajusteBHEPago({ monto: 100000, liquido: 85500, retencion: 14500 }, '2026-03-01')
  assert.deepEqual(r, { monto: Math.round(85500 / (1 - 0.1525)), retencion: Math.round(85500 / (1 - 0.1525)) - 85500 })
  assert.equal(reajusteBHEPago({ monto: 100000, liquido: 85500, retencion: 14500, bhe_id: 'b1' }, '2026-03-01'), null)   // con boleta mandan sus cifras
})

test('abono que paga varias facturas: combinación exacta y única', () => {
  const f = (id, saldo, fecha) => ({ b: { id, issued_at: fecha }, saldo })
  const mov = { monto: 300000, fecha: '2026-10-15' }
  assert.deepEqual(elegirCombo(mov, [f('a', 100000, '2026-09-01'), f('b', 200000, '2026-10-01'), f('c', 50000, '2026-08-01')]).map(b => b.id), ['a', 'b'])
  assert.equal(elegirCombo(mov, [f('a', 100000, '2026-09-01'), f('z', 200000, '2026-11-01')]), null)          // una factura futura no entra
  // Cuatro cuotas iguales de 75.000 que suman el abono.
  assert.equal(elegirCombo(mov, [1, 2, 3, 4, 5].map(i => f('q' + i, 75000, `2026-0${i}-01`))).length, 4)
  assert.equal(elegirCombo(mov, [f('a', 100000, '2026-09-01')]), null)
})

test('período y cuota desde la glosa', () => {
  assert.deepEqual(periodoDeTexto('Honorarios septiembre 2026 · cuota 3'), { mes: 8, anio: 2026, cuota: 3 })
  assert.deepEqual(periodoDeTexto('Asesoría legal 2/5'), { mes: null, anio: null, cuota: 2 })
  assert.equal(periodoDeTexto('Servicios oct. 2025').mes, 9)
})
