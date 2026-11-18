import test from 'node:test'
import assert from 'node:assert/strict'
import { hojasGastosCliente, pagoDeGasto, descuentaSaldo, fechaExcel } from '../supabase/functions/_shared/gastosClienteExcel.js'
import { fgCliente } from '../supabase/functions/_shared/gastosReglas.js'

const cli = { id: 'c1', name: 'Cliente de prueba' }
const g = (id, amount, extra = {}) => ({ id, client_id: 'c1', type: 'gasto', amount, date: '2026-09-01', created_at: `2026-09-0${id}T12:00:00Z`, concept: `Glosa ${id}`, category: 'Notaria', ...extra })
const exps = [
  { id: 'f1', client_id: 'c1', type: 'fondo', amount: 1000000, date: '2026-08-01', concept: 'Provisión' },
  g(1, 400000, { ot_number: '490673', concept: 'Gastos notariales — Cesion de derechos', description: 'Detalle largo sin resumir', materia: 'Cesión', requirente: 'Persona X', notas: 'ojo', notaria_liquidado_at: '2026-09-20T15:00:00Z' }),
  g(2, 50000, { category: 'CBR', rendered_at: '2026-09-25T10:00:00Z' }),
  g(3, 30000, { category: 'Diario Oficial' }),
  g(4, 10000, { no_descuenta_saldo: true }),
  g(5, 99000, { deleted_at: '2026-09-02' }),
  { ...g(6, 7000), client_id: 'otro' },
]

test('Excel de gastos: una fila por gasto con OT y glosas completas; no entran borrados ni de otro cliente', () => {
  const h = hojasGastosCliente({ cliente: cli, expenses: exps, pagadoPor: e => e.category === 'Notaria' ? 'Notaría' : 'Oficina' })
  assert.equal(h.gastos.length, 1 + 4 + 1)                         // encabezado + 4 gastos + Total
  const enc = h.gastos[0], f = h.gastos[1]
  assert.equal(f[enc.indexOf('OT')], '490673')
  assert.equal(f[enc.indexOf('Concepto')], 'Gastos notariales — Cesion de derechos')
  assert.equal(f[enc.indexOf('Descripción')], 'Detalle largo sin resumir')
  assert.equal(f[enc.indexOf('Materia')], 'Cesión'); assert.equal(f[enc.indexOf('Requirente')], 'Persona X'); assert.equal(f[enc.indexOf('Nota')], 'ojo')
})

test('Excel de gastos: estado y fecha de pago salen de la liquidación o de la rendición; sin ellas, Sin pago', () => {
  const h = hojasGastosCliente({ cliente: cli, expenses: exps }), enc = h.gastos[0]
  const est = h.gastos.slice(1, 5).map(r => [r[enc.indexOf('Estado de pago')], r[enc.indexOf('Medio de pago')], r[enc.indexOf('Fecha de pago')]?.v ?? ''])
  assert.deepEqual(est[0], ['Pagado', 'Liquidación a la notaría', fechaExcel('2026-09-20')])
  assert.deepEqual(est[1], ['Pagado', 'Rendición de caja chica', fechaExcel('2026-09-25')])
  assert.deepEqual(est[2], ['Sin pago', '', ''])
  assert.deepEqual(pagoDeGasto({}), { pagado: false, fecha: null, medio: '' })
})

test('Excel de gastos: el saldo es el de fgCliente y los grupos suman el total cargado', () => {
  const h = hojasGastosCliente({ cliente: cli, expenses: exps }), fg = fgCliente(exps.filter(e => !e.deleted_at), 'c1')
  const r = Object.fromEntries(h.resumen.slice(1).map(x => [`${x[0]}|${x[1]}`, x[3]?.v]))
  assert.equal(r['Saldo|Saldo'], fg.saldo); assert.equal(r['Saldo|Fondos recibidos'], 1000000); assert.equal(r['Saldo|Gastos que descuentan saldo'], 480000)
  assert.equal(r['Saldo|Gastos saldados fuera de la app (no descuentan)'], 10000)
  const total = h.totales.gastos
  assert.equal(total, 490000)
  for (const g of ['Estado de pago', 'Pagado por', 'Categoría']) {
    const s = h.resumen.slice(1).filter(x => x[0] === g).reduce((a, x) => a + x[3].v, 0)
    assert.equal(s, total, g)
  }
  assert.equal(descuentaSaldo({ no_descuenta_saldo: true }), 'No, saldado fuera de la app')
})

test('fechaExcel: la fecha de un timestamp es la de Chile, no la UTC', () => {
  assert.equal(fechaExcel('2026-09-20T02:00:00Z'), fechaExcel('2026-09-19'))   // 23:00 del 19 en Chile
  assert.equal(fechaExcel('2026-09-20'), 46285)
  assert.equal(fechaExcel(null), null)
})
