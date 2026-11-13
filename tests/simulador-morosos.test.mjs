// Simulador de cobro de la cartera morosa: tramos de mora, parte que entra, terceros proporcional y saldo corrido. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tramoDeMora, diasDeMora, resumenTramos, simularMorosos, TRAMOS_MORA } from './../supabase/functions/_shared/simuladorMorosos.js'

const D = s => new Date(s + 'T12:00:00').getTime()
const hoy = D('2026-11-12')
const sem = ini => ({ ini, entra: 0, com: 0, of: 1_000_000, sale: 1_000_000, run: 0 })
const weeks = ['2026-11-09', '2026-11-16', '2026-11-23'].map(sem)
// tres cobros morosos: 41, 84 y 195 días de mora; fechas esperadas en las 3 semanas
const items = [
  { b: { id: 'f1', client_id: 'c1', due: '2026-10-02' }, m: 10_000_000, t: D('2026-11-10') },
  { b: { id: 'f2', client_id: 'c2', due: '2026-08-20' }, m: 6_000_000, t: D('2026-11-17') },
  { b: { id: 'f3', client_id: 'c3', due: '2026-05-01' }, m: 4_000_000, t: D('2026-12-20') },
]
const comMoroso = [{ billId: 'f1', monto: 1_000_000 }, { billId: 'f2', monto: 600_000 }]

test('tramos: hasta 60, 61 a 120 y más de 120 días de mora', () => {
  assert.deepEqual([0, 60, 61, 120, 121, 400].map(tramoDeMora), [0, 0, 1, 1, 2, 2])
  assert.equal(TRAMOS_MORA.length, 3)
  assert.equal(diasDeMora({ due: '2026-10-02' }, hoy), 41)
  assert.equal(diasDeMora({}, hoy), 0)
})
test('resumen por tramo: monto y clientes', () => {
  const r = resumenTramos(items, hoy)
  assert.deepEqual(r.map(x => [x.monto, x.nCli]), [[10_000_000, 1], [6_000_000, 1], [4_000_000, 1]])
})
test('con 0 % no cambia nada; con 100 % entra todo lo que cae en las semanas y baja el resto', () => {
  const a = simularMorosos({ weeks, exclItems: items, comMoroso, hoyT: hoy, pct: [0, 0, 0] })
  assert.equal(a.E, 0); assert.equal(a.C, 0); assert.equal(a.fin, -3_000_000); assert.equal(a.cobros.length, 0); assert.equal(a.restoMonto, 20_000_000)
  const b = simularMorosos({ weeks, exclItems: items, comMoroso, hoyT: hoy, pct: [100, 100, 100] })
  assert.equal(b.simIng, 20_000_000)
  assert.equal(b.E, 16_000_000)   // los $4 M de diciembre quedan fuera de las 3 semanas
  assert.equal(b.C, 1_600_000); assert.equal(b.restoMonto, 0)
})
test('porcentaje por tramo: la parte de terceros baja en la misma proporción y el saldo se recalcula semana a semana', () => {
  const r = simularMorosos({ weeks, exclItems: items, comMoroso, hoyT: hoy, pct: [50, 0, 0] })
  assert.equal(r.simIng, 5_000_000); assert.equal(r.simCom, 500_000)
  assert.deepEqual(r.weeks.map(w => w.entra), [5_000_000, 0, 0])
  assert.deepEqual(r.weeks.map(w => w.run), [3_500_000, 2_500_000, 1_500_000])
  assert.equal(r.fin, 1_500_000)
  assert.equal(r.restoMonto, 15_000_000)
  assert.equal(weeks[0].entra, 0)   // no muta lo recibido
})
test('porcentaje libre: se acota 0–100, se redondea y un valor no numérico cuenta 0; lo del año incluye lo posterior a las semanas', () => {
  const r = simularMorosos({ weeks, exclItems: items, comMoroso, hoyT: hoy, pct: [150, 'x', 49.6], finAnio: D('2026-12-31') })
  assert.equal(r.simIng, 10_000_000 + 4_000_000 * 0.5)
  assert.equal(r.anioIng, r.simIng)
  const s = simularMorosos({ weeks, exclItems: items, comMoroso, hoyT: hoy, pct: [0, 0, 100], finAnio: D('2026-11-30') })
  assert.equal(s.simIng, 4_000_000); assert.equal(s.anioIng, 0)   // diciembre queda fuera de «hasta noviembre»
})
test('clientes: suma lo simulado a su fila', () => {
  const r = simularMorosos({ weeks, exclItems: items, comMoroso, hoyT: hoy, pct: [100, 0, 0], clientes: [{ cid: 'c1', entra: 0, com: 0, duda: 12_000_000 }, { cid: 'c9', entra: 5, com: 1, duda: 3 }] })
  assert.deepEqual(r.clientes.map(c => [c.cid, c.entra, c.com, c.duda]), [['c1', 10_000_000, 1_000_000, 2_000_000], ['c9', 5, 1, 3]])   // lo cobrado baja su deuda en duda
})

import { repartoOchoSemanas } from './../supabase/functions/_shared/simuladorMorosos.js'
test('reparto 8 semanas / después: cuadra por fila y por columna, y nada pasa del total', () => {
  const r = repartoOchoSemanas({ ing: 6_040_000, com: 2_940_000, ing8: 3_080_000, com8: 840_000 })
  assert.deepEqual(r.ing, [3_100_000, 2_900_000, 6_000_000])
  assert.deepEqual(r.com, [800_000, 2_100_000, 2_900_000])
  assert.deepEqual(r.neto, [2_300_000, 800_000, 3_100_000])
  assert.deepEqual(repartoOchoSemanas({ ing: 0, com: 0, ing8: 0, com8: 0 }).neto, [0, 0, 0])
  assert.equal(repartoOchoSemanas({ ing: 1_000_000, com: 0, ing8: 9_000_000, com8: 0 }).ing[1], 0)   // la parte de 8 semanas nunca excede el total
})
