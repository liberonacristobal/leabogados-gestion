import test from 'node:test'
import assert from 'node:assert/strict'
import { mensualMayorQueVenta } from '../supabase/functions/_shared/ventasReglas.js'

// Caso real 2026: venta mensual de 30 UF cuyas facturas salían de 42,5 UF (la tarifa subió pero la venta no se actualizó).
const uf = { '2026-11-02': 41258 }
const venta = (o = {}) => ({ id: 's1', status: 'Activo', cobro_type: 'mensual', moneda: 'UF', amount_uf: 30, ...o })
const fac = (o = {}) => ({ id: 'b1', sale_id: 's1', invoice_no: '495', status: 'Pagado', billing_type: 'honorarios', issued_at: '2026-11-02', amount: 1753465, ...o })

test('factura mensual mayor que su venta: se señala con la diferencia en UF', () => {
  const r = mensualMayorQueVenta({ sales: [venta()], billing: [fac()], uf })
  assert.equal(r.length, 1); assert.ok(Math.abs(r[0].factura_en - 42.5) < 0.01); assert.ok(Math.abs(r[0].dif - 12.5) < 0.01)
})
test('venta al día (42,5 UF), tolerancia 3 %, otra forma de cobro, anulada o anterior a la app: no se señala', () => {
  assert.equal(mensualMayorQueVenta({ sales: [venta({ amount_uf: 42.5 })], billing: [fac()], uf }).length, 0)
  assert.equal(mensualMayorQueVenta({ sales: [venta({ amount_uf: 41.5 })], billing: [fac()], uf }).length, 0)
  assert.equal(mensualMayorQueVenta({ sales: [venta({ cobro_type: 'cuotas' })], billing: [fac()], uf }).length, 0)
  assert.equal(mensualMayorQueVenta({ sales: [venta()], billing: [fac({ status: 'Anulada' })], uf }).length, 0)
  assert.equal(mensualMayorQueVenta({ sales: [venta()], billing: [fac({ issued_at: '2026-05-01' })], uf }).length, 0)
})
test('sin UF de la fecha no infiere; en pesos compara pesos; usa la última factura', () => {
  assert.equal(mensualMayorQueVenta({ sales: [venta()], billing: [fac()], uf: {} }).length, 0)
  assert.equal(mensualMayorQueVenta({ sales: [venta({ moneda: 'CLP', amount_uf: null, amount_clp: 1000000 })], billing: [fac()], uf }).length, 1)
  const r = mensualMayorQueVenta({ sales: [venta()], billing: [fac({ id: 'b0', issued_at: '2026-10-02', amount: 1745602 }), fac({ amount: 1237740 })], uf: { '2026-10-02': 40000, '2026-11-02': 41258 } })
  assert.equal(r.length, 0)   // la última (1.237.740 = 30 UF) ya cuadra
})
