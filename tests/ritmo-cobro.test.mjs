// Pruebas del ritmo de cobro conservador (_shared/ritmoCobro.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentil, mediana, ritmosDePago, ESPERA_MINIMA, ESPERA_SIN_HISTORIAL } from './../supabase/functions/_shared/ritmoCobro.js'

const HOY = new Date('2026-11-06T12:00:00').getTime(), DAY = 864e5
const pago = (c, d, hace = 10) => ({ c, d, p: HOY - hace * DAY })

test('percentil y mediana con casos borde', () => {
  assert.equal(percentil([], 0.75), null); assert.equal(mediana([]), null)
  assert.equal(percentil([10, 20, 30, 40], 0.75), 30); assert.equal(mediana([10, 20, 30, 40]), 25); assert.equal(mediana([5]), 5)
})

test('cliente con historial usa su mediana; sin historial se proyecta con el percentil 75 del estudio, no la mediana', () => {
  const pagos = [...[10, 12, 14].map(d => pago('a', d)), ...[20, 30, 40, 50].map(d => pago('b', d)), pago('c', 60)]
  const R = ritmosDePago(pagos, HOY)
  assert.equal(R.propio('a'), true); assert.equal(R.mediano('a'), 12); assert.equal(R.conservador('a'), 12)
  assert.equal(R.propio('c'), false); assert.equal(R.mediano('c'), R.estudio.mediana)
  assert.equal(R.conservador('c'), R.estudio.p75); assert.ok(R.estudio.p75 > R.estudio.mediana)
  assert.equal(R.conservador('desconocido'), R.estudio.p75)
})

test('sin ningún pago histórico hay valores por defecto y nunca NaN', () => {
  const R = ritmosDePago([], HOY)
  assert.equal(R.estudio.mediana, 30); assert.equal(R.estudio.p75, 45)
  assert.equal(R.esperaRestante('x', 100), ESPERA_SIN_HISTORIAL)
})

test('una factura que ya se pasó espera lo que les faltaba a quienes llevaban ese tiempo, y nunca menos de una semana', () => {
  const R = ritmosDePago([10, 20, 30, 45, 60, 90].map(d => pago('a', d)), HOY)
  assert.equal(R.esperaRestante('a', 25), 28)                // pagos de más de 25 días: 30, 45, 60 y 90 → faltaban 5, 20, 35 y 65 → mediana 27,5
  const R2 = ritmosDePago([30, 31, 32, 33].map(d => pago('b', d)), HOY)
  assert.equal(R2.esperaRestante('b', 29), ESPERA_MINIMA)    // faltaban 1 a 4 días: lo vencido no entra antes de la semana siguiente
  const R3 = ritmosDePago([10, 12, 14].map(d => pago('c', d)), HOY)
  assert.equal(R3.esperaRestante('c', 11), ESPERA_SIN_HISTORIAL)   // menos de 3 pagos comparables: dos semanas
})
