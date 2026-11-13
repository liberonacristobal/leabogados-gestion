import test from 'node:test'
import assert from 'node:assert/strict'
import { reembolsoProbable } from '../supabase/functions/_shared/saludDatos.js'

// Caso real anonimizado (13-11-2026): factura «Honorarios» sin venta por el mismo monto de un gasto del cliente (tasación pagada a un tercero).
const gasto = (o = {}) => ({ id: 'g1', client_id: 'c1', type: 'gasto', amount: 1177577, date: '2026-10-29', ...o })
const fac = (o = {}) => ({ id: 'f1', client_id: 'c1', invoice_no: '519', amount: 1177577, status: 'Pagado', billing_type: 'honorarios', sale_id: null, issued_at: '2026-11-13', ...o })

test('factura sin venta por el monto de un gasto pendiente del cliente: propone', () => {
  const r = reembolsoProbable([fac()], [gasto()])
  assert.equal(r.length, 1); assert.equal(r[0].gastos[0].id, 'g1')
})
test('suma de dos gastos también calza', () => {
  const r = reembolsoProbable([fac({ amount: 1000 })], [gasto({ id: 'a', amount: 400 }), gasto({ id: 'b', amount: 600 })])
  assert.deepEqual(r[0].gastos.map(g => g.id).sort(), ['a', 'b'])
})
test('no propone: con venta, ya reembolso, otro cliente, gasto rendido/cubierto/histórico, anterior a la app, monto distinto', () => {
  assert.equal(reembolsoProbable([fac({ sale_id: 's1' })], [gasto()]).length, 0)
  assert.equal(reembolsoProbable([fac({ billing_type: 'reembolso' })], [gasto()]).length, 0)
  assert.equal(reembolsoProbable([fac()], [gasto({ client_id: 'c2' })]).length, 0)
  assert.equal(reembolsoProbable([fac()], [gasto({ client_rendered_at: '2026-11-01' })]).length, 0)
  assert.equal(reembolsoProbable([fac()], [gasto({ reembolso_fondo_id: 'x' })]).length, 0)
  assert.equal(reembolsoProbable([fac()], [gasto({ no_descuenta_saldo: true })]).length, 0)
  assert.equal(reembolsoProbable([fac({ issued_at: '2026-05-01' })], [gasto()]).length, 0)
  assert.equal(reembolsoProbable([fac({ amount: 1177000 })], [gasto()]).length, 0)
  assert.equal(reembolsoProbable([fac({ status: 'Anulada' })], [gasto()]).length, 0)
})
