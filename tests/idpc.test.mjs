// IDPC Pro Pyme general: caso base del F22 del año tributario 2026 (ejercicio 2025), cifras de la declaración presentada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idpcAnual } from './../supabase/functions/_shared/idpc.js'

test('F22 AT 2026: base, incentivo al ahorro, IDPC y saldo coinciden con la declaración', () => {
  const r = idpcAnual({ percibidos: 205_206_232, pagados: 128_699_621, ppmPagado: 3_659_360 })
  assert.equal(r.base, 76_506_611)          // código 1729
  assert.equal(r.incentivo, 38_253_306)     // código 1432
  assert.equal(r.baseAfecta, 38_253_305)    // código 18
  assert.equal(r.idpc, 4_781_663)           // código 20
  assert.equal(r.saldo, 1_122_303)          // código 90 (impuesto adeudado)
})

test('con pérdida no hay IDPC y el PPM queda a favor', () => {
  const r = idpcAnual({ percibidos: 10_000_000, pagados: 12_000_000, ppmPagado: 200_000 })
  assert.equal(r.perdida, 2_000_000); assert.equal(r.idpc, 0); assert.equal(r.saldo, -200_000)
})

test('el tope del incentivo reduce la rebaja; datos vacíos no dan NaN', () => {
  const r = idpcAnual({ percibidos: 100_000_000, pagados: 0, topeIncentivo: 10_000_000 })
  assert.equal(r.incentivo, 10_000_000); assert.equal(r.idpc, Math.round(90_000_000 * 0.125))
  const v = idpcAnual({ percibidos: null, pagados: undefined })
  assert.ok(Object.values(v).every(Number.isFinite))
})
