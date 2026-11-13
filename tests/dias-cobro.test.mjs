// Días de cobro ponderados por monto: una factura grande y lenta pesa más que una chica y rápida. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumenDiasCobro } from './../supabase/functions/_shared/diasCobro.js'

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
