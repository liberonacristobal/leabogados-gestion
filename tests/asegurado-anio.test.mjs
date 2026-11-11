// Asegurado del año siguiente: proyectos vigentes + asesorías × 12, sin contar dos veces las cuotas de asesorías ni el subarriendo. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aseguradoAnio, cuotasEntre } from './../supabase/functions/_shared/aseguradoAnio.js'

const fila = (id, cid, monto, due, extra = {}) => ({ k: 'porVencer', motivo: null, id, monto, b: { id, client_id: cid, due, ...(extra.b || {}) }, ...extra, ...(extra.k ? { k: extra.k } : {}) })
const filas = [
  fila('1', 'a', 1_000_000, '2027-01-15'), fila('2', 'a', 500_000, '2027-03-10'), fila('3', 'b', 2_000_000, '2027-03-20'),
  fila('4', 'c', 90_000, '2027-02-05', { motivo: 'recurrente' }),                       // cuota de una asesoría: ya va en asesorías × 12
  fila('5', 'sub', 1_080_000, '2027-02-01', { b: { billing_type: 'subarriendo' } }),    // subarriendo: no es ingreso
  fila('6', 'd', 700_000, '2027-04-01', { k: 'fuera' }),                                 // fuera de lo vigente
  fila('7', 'e', 300_000, '2027-04-01', { k: 'porConfirmar' }),
]
const ases = [{ cid: 'c', anual: 1_080_000 }, { cid: 'f', anual: 240_000 }]

test('asegurado = proyectos vigentes + asesorías × 12; sin cuotas recurrentes, subarriendo ni partidas fuera de lo vigente', () => {
  const r = aseguradoAnio({ filas, asesorias: ases })
  assert.equal(r.proyectos, 3_500_000); assert.equal(r.asesorias, 1_320_000); assert.equal(r.total, 4_820_000); assert.equal(r.subarriendo, 1_080_000)
  const ingenuo = filas.filter((f) => f.k === 'porVencer').reduce((a, f) => a + f.monto, 0) + 1_320_000
  assert.ok(ingenuo > r.total)   // la suma ingenua cuenta de más (subarriendo y cuota recurrente)
})
test('por cliente y por mes suman el total; los morosos se señalan y no se descuentan', () => {
  const r = aseguradoAnio({ filas, asesorias: ases, morosos: ['a', 'zz'] })
  assert.equal(r.porCliente.reduce((x, c) => x + c.total, 0), r.total)
  assert.ok(Math.abs(r.porMes.reduce((x, v) => x + v, 0) - r.total) < 1e-6)
  assert.deepEqual(r.morosos.cids, ['a']); assert.equal(r.morosos.monto, 1_500_000); assert.ok(Math.abs(r.morosos.pct - 1_500_000 / 4_820_000 * 100) < 1e-9)
  assert.equal(r.total, 4_820_000)
  assert.equal(r.porCliente.find((c) => c.cid === 'c').asesorias, 1_080_000)
})
test('sin datos: todo cero', () => {
  const r = aseguradoAnio({ filas: [], asesorias: [] })
  assert.deepEqual([r.total, r.morosos.n, r.morosos.pct, r.porCliente.length], [0, 0, 0, 0])
  assert.deepEqual(aseguradoAnio({ filas: null, asesorias: null }).porMes, Array(12).fill(0))
})
test('cuotasEntre: solo proyectos vigentes dentro del rango', () => {
  const f = [fila('1', 'a', 100, '2026-11-20'), fila('2', 'a', 50, '2026-12-31'), fila('3', 'a', 70, '2027-01-01'), fila('4', 'c', 9, '2026-12-01', { motivo: 'recurrente' })]
  assert.equal(cuotasEntre(f, '2026-11-01', '2026-12-31'), 150)
})
