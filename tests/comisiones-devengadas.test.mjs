import test from 'node:test'
import assert from 'node:assert/strict'
import { comisionesDevengadas, fechaComisionDevengada } from '../supabase/functions/_shared/comisionesReglas.js'

const fac = (o = {}) => ({ id: 'b1', invoice_no: '495', status: 'Pagado', issued_at: '2026-11-02', ...o })
const com = (o = {}) => ({ id: 't1', billing_id: 'b1', monto: 438366, estado: 'por_pagar', comision_pct: null, ...o })

test('la comisión de una factura emitida cuenta en el mes de la factura, aunque no se haya pagado', () => {
  const r = comisionesDevengadas([com()], [fac()], '2026-11')
  assert.equal(r.length, 1); assert.equal(r[0].base, 'emision')
  assert.equal(comisionesDevengadas([com()], [fac()], '2026-12').length, 0)
})
test('pagada en otro mes: sigue en el mes de la factura (no se cuenta dos veces)', () => {
  const t = com({ estado: 'pagado', pagado_at: '2026-12-10' })
  assert.equal(comisionesDevengadas([t], [fac()], '2026-11').length, 1)
  assert.equal(comisionesDevengadas([t], [fac()], '2026-12').length, 0)
})
test('cuota programada o factura anulada no devenga; pagada antes de emitirse cuenta al pagarse', () => {
  assert.equal(comisionesDevengadas([com()], [fac({ invoice_no: null, status: 'Programada' })], '2026-11').length, 0)
  assert.equal(comisionesDevengadas([com()], [fac({ status: 'Anulada' })], '2026-11').length, 0)
  const p = comisionesDevengadas([com({ estado: 'pagado', pagado_at: '2026-11-20' })], [fac({ invoice_no: null, status: 'Programada' })], '2026-11')
  assert.equal(p.length, 1); assert.equal(p[0].base, 'pago')
})
test('factura anterior a la app y comisión sin factura: al pagarse; externos (con %) no se tocan', () => {
  assert.equal(fechaComisionDevengada(com({ estado: 'pagado', pagado_at: '2026-04-13' }), fac({ issued_at: '2026-01-30' }), '2026-06-06').base, 'pago')
  assert.equal(fechaComisionDevengada(com({ billing_id: null, estado: 'pagado', pagado_at: '2026-07-13' }), null, '2026-06-06').fecha, '2026-07-13')
  assert.equal(fechaComisionDevengada(com({ comision_pct: 15 }), fac(), '2026-06-06'), null)
  assert.equal(fechaComisionDevengada(com(), fac({ issued_at: '2026-01-30' }), '2026-06-06'), null)
})
