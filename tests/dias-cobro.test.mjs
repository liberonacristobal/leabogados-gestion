// Días de cobro ponderados por monto: una factura grande y lenta pesa más que una chica y rápida. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumenDiasCobro, facturasCobradas, diasDeCobroFacturas } from './../supabase/functions/_shared/diasCobro.js'

test('ponderado por monto vs simple', () => {
  const r = resumenDiasCobro([{ monto: 9_000_000, dias: 10 }, { monto: 1_000_000, dias: 110 }])
  assert.equal(r.pond, 20)        // (9·10 + 1·110) ÷ 10
  assert.equal(r.simple, 60)      // (10 + 110) ÷ 2
  assert.equal(r.pct60, 90)       // 9 de 10 millones cobrados en ≤60 d
  assert.equal(r.pct90, 10)       // 1 de 10 millones en más de 90 d
})
test('sin datos o datos inválidos → null, nunca NaN', () => {
  for (const x of [[], null, [{ monto: 0, dias: 5 }], [{ monto: 100, dias: -3 }], [{ monto: 100, dias: 900 }], [{ monto: 100, dias: NaN }]]) {
    const r = resumenDiasCobro(x)
    assert.equal(r.pond, null); assert.equal(r.n, 0)
  }
})
test('el borde de 60 y 90 días', () => {
  const r = resumenDiasCobro([{ monto: 1, dias: 60 }, { monto: 1, dias: 61 }, { monto: 1, dias: 90 }, { monto: 1, dias: 91 }])
  assert.equal(r.pct60, 25); assert.equal(r.pct90, 25)
})
const _f = (id, tipo, emi, pago, monto) => ({ id, billing_type: tipo, status: 'Pagado', issued_at: emi, paid_at: pago, amount: monto })
test('una sola regla: emitidas en el período y pagadas, sin subarriendo, reembolsos ni notas de crédito', () => {
  const B = [_f('a', 'honorarios', '2026-03-01', '2026-03-11', 100), _f('b', 'honorarios', '2026-05-01', '2026-05-31', 300), _f('c', 'subarriendo', '2026-03-01', '2026-03-02', 999),
    _f('d', 'reembolso', '2026-03-01', '2026-03-02', 50), _f('e', 'honorarios', '2025-12-01', '2026-03-05', 70), { ..._f('f', 'honorarios', '2026-04-01', null, 10), status: 'Pendiente' }]
  assert.deepEqual(facturasCobradas(B, 2026).map((x) => x.b.id), ['a', 'b'])
  assert.deepEqual(facturasCobradas(B, 2026, { ym: '2026-04' }).map((x) => x.b.id), ['a'])           // hasta abril: la de mayo no entra
  assert.deepEqual(facturasCobradas(B, 2026, { ym: '2026-05', mes: true }).map((x) => x.b.id), ['b']) // solo las emitidas en mayo
  assert.equal(diasDeCobroFacturas(B, 2026).pond, 25)                                                // (100·10 + 300·30) ÷ 400
  assert.equal(diasDeCobroFacturas(B, 2026, { ym: '2026-04' }).pond, 10)
})
test('la factura emitida ya pagada (días negativos) no se mide: queda fuera, no cuenta como 0 días', () => {
  const r = resumenDiasCobro([{ monto: 100, dias: 20 }, { monto: 900, dias: -15 }])
  assert.equal(r.n, 1); assert.equal(r.pond, 20)
})
