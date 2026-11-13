import test from 'node:test'
import assert from 'node:assert/strict'
import { comisionPorReparto } from '../supabase/functions/_shared/saludDatos.js'

// Reparto de la venta (formulario «Reparto a proveedores»): la fila con tipo_costo 'pct' o 'uf' es el acuerdo; la factura emitida sin su fila se propone.
const vta = { id: 's2', amount_uf: 42.5 }
const fila = (o = {}) => ({ id: 'r1', sale_id: 's2', proveedor_id: 'p1', proveedor: 'Colab', tipo_costo: 'pct', valor: 85, billing_id: 'b0', created_at: '2026-10-01', ...o })
const fac = (o = {}) => ({ id: 'b1', sale_id: 's2', invoice_no: '502', status: 'Pendiente', billing_type: 'honorarios', issued_at: '2026-11-02', due: '2026-11-30', amount: 1444030, ...o })
const antes = { id: 'b0', sale_id: 's2', invoice_no: '482', status: 'Pagado', issued_at: '2026-10-02', due: '2026-10-30', amount: 1232190 }

test('% de la factura: propone el % (sujeta a cobro si está pendiente, por pagar si está pagada)', () => {
  const r = comisionPorReparto([antes, fac()], [fila()], [vta])
  assert.equal(r.length, 1); assert.equal(r[0].monto, 1227426); assert.equal(r[0].estado, 'pendiente'); assert.equal(r[0].tipo_costo, 'pct')
  assert.equal(comisionPorReparto([antes, fac({ status: 'Pagado' })], [fila()], [vta])[0].estado, 'por_pagar')
})
test('UF de la venta: la misma fracción del formulario (10,625 de 42,5 UF = 25 % de la factura mensual)', () => {
  const r = comisionPorReparto([antes, fac({ amount: 1753465, status: 'Pagado' })], [fila({ tipo_costo: 'uf', valor: 10.625 })], [vta])
  assert.equal(r.length, 1); assert.equal(r[0].monto, 438366); assert.equal(r[0].tipo_costo, 'uf')
  assert.equal(comisionPorReparto([antes, fac()], [fila({ tipo_costo: 'uf', valor: 10.625 })], [{ id: 's2' }]).length, 0)   // sin UF de la venta no infiere
})
test('no propone si ya tiene fila del colaborador, si es anterior a la 1ª comisión, omitida, reembolso o venta borrada', () => {
  assert.equal(comisionPorReparto([antes, fac()], [fila(), fila({ id: 'r2', billing_id: 'b1' })], [vta]).length, 0)
  assert.equal(comisionPorReparto([antes, fac({ due: '2026-09-01', issued_at: '2026-09-01' })], [fila()], [vta]).length, 0)
  assert.equal(comisionPorReparto([antes, fac()], [fila()], [vta], new Set(['b1|p1'])).length, 0)
  assert.equal(comisionPorReparto([antes, fac({ billing_type: 'reembolso' })], [fila()], [vta]).length, 0)
  assert.equal(comisionPorReparto([antes, fac()], [fila()], [{ id: 's2', deleted_at: 'x' }]).length, 0)
})
test('acuerdo sin ninguna fila fechada rige desde el inicio de la app', () => {
  assert.equal(comisionPorReparto([fac()], [fila({ billing_id: null })], [vta]).length, 1)
})
