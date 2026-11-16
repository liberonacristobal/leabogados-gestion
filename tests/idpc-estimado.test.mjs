// IDPC estimado del año: real hasta hoy más proyección moderada. Cifras sintéticas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idpcEstimado } from './../supabase/functions/_shared/idpcEstimado.js'

const perc = [10, 20, 30, 20, 20, 20, 20, 20, 20, 20, 0, 0].map(x => x * 1_000_000)
const pag = Array(12).fill(0).map((_, i) => (i < 10 ? 8 : 0) * 1_000_000)
const ppm = Array(12).fill(0).map((_, i) => (i < 10 ? 300_000 : 0))

test('real hasta el mes 10 y proyección moderada de los dos meses restantes', () => {
  const r = idpcEstimado({ percibidos: perc, pagados: pag, ppm, mesesReales: 10 })
  assert.equal(r.proyPercibidos, 2 * 20_000_000)      // promedio de los últimos 6 meses (20 M) × 2 meses
  assert.equal(r.proyPagados, 2 * 8_000_000)          // último mes × 2
  assert.equal(r.percibidos, 200_000_000 + 40_000_000)
  assert.equal(r.pagados, 80_000_000 + 16_000_000)
  assert.equal(r.base, 144_000_000)
  assert.equal(r.idpc, Math.round(72_000_000 * 0.125))  // incentivo 50 %, tasa 12,5 %
  assert.equal(r.saldo, r.idpc - (3_000_000 + 600_000))
})

test('los pagos ya comprometidos se suman a lo pagado real', () => {
  const a = idpcEstimado({ percibidos: perc, pagados: pag, ppm, mesesReales: 10 })
  const b = idpcEstimado({ percibidos: perc, pagados: pag, ppm, mesesReales: 10, extraPagado: 822_404 })
  assert.equal(b.pagados - a.pagados, 822_404)
  assert.ok(b.idpc <= a.idpc)
})

test('sin datos no da NaN y con el año completo no proyecta', () => {
  const v = idpcEstimado({ percibidos: [], pagados: [], ppm: [], mesesReales: 0 })
  assert.ok(Object.values(v).every(Number.isFinite))
  const c = idpcEstimado({ percibidos: perc, pagados: pag, ppm, mesesReales: 12 })
  assert.equal(c.proyPercibidos, 0); assert.equal(c.proyPagados, 0)
})
