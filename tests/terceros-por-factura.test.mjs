// El pago a un tercero se calcula sobre la factura emitida (no sobre la cuota programada). Casos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tercerosPorFactura } from '../supabase/functions/_shared/comisionesReglas.js'

const venta = { moneda: 'UF', amount_uf: 1100 }
const T = o => ({ id: 't', estado: 'pendiente', tipo_costo: 'uf', valor: 440, monto: 735167, liquido: null, bhe_id: null, comision_pct: null, ...o })

test('UF: el reparto sigue a la factura emitida (440 de 1.100 UF = 40 %)', () => {
  assert.deepEqual(tercerosPorFactura({ terceros: [T()], venta, montoFactura: 1890854, fecha: '2026-11-03' }), [{ id: 't', patch: { monto: 756342 } }])
})
test('porcentaje: factura × %', () => {
  assert.deepEqual(tercerosPorFactura({ terceros: [T({ tipo_costo: 'pct', valor: 30, monto: 400000 })], venta, montoFactura: 1341792, fecha: '2026-11-03' }), [{ id: 't', patch: { monto: 402538 } }])
})
test('monto fijo, ya pagado, con boleta registrada y retención de un externo no cambian', () => {
  const f = o => tercerosPorFactura({ terceros: [T(o)], venta, montoFactura: 1890854, fecha: '2026-11-03' })
  assert.deepEqual(f({ tipo_costo: 'clp' }), []); assert.deepEqual(f({ estado: 'pagado' }), []); assert.deepEqual(f({ bhe_id: 'b1' }), []); assert.deepEqual(f({ comision_pct: 15 }), [])
})
test('si ya está al día no hay cambio; sin UF de la venta o venta en pesos, el reparto en UF no se toca', () => {
  assert.deepEqual(tercerosPorFactura({ terceros: [T({ monto: 756342 })], venta, montoFactura: 1890854, fecha: '2026-11-03' }), [])
  assert.deepEqual(tercerosPorFactura({ terceros: [T()], venta: { moneda: 'UF', amount_uf: 0 }, montoFactura: 1890854, fecha: '2026-11-03' }), [])
  assert.deepEqual(tercerosPorFactura({ terceros: [T()], venta: { moneda: 'CLP', amount_uf: 1100 }, montoFactura: 1890854, fecha: '2026-11-03' }), [])
  assert.deepEqual(tercerosPorFactura({ terceros: [T()], venta, montoFactura: 0, fecha: '2026-11-03' }), [])
})
test('con boleta de honorarios: el cálculo es el líquido y el bruto sale con la retención vigente', () => {
  const r = tercerosPorFactura({ terceros: [T({ tipo_costo: 'pct', valor: 20, liquido: 59494, monto: 70200, retencion: 10706 })], venta, montoFactura: 1000000, fecha: '2026-11-03' })
  assert.equal(r[0].patch.liquido, 200000); assert.equal(r[0].patch.monto - r[0].patch.retencion, 200000); assert.ok(r[0].patch.monto > 200000)
})
