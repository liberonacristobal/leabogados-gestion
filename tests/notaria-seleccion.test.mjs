// Selección de Pagar (notariaPorLiquidar + seleccionNotaria). Caso real anonimizado (19-11-2026): un cliente con fondo que cubre algunas OT
// por fecha y otras no, otro sin fondo, una OT sin cliente y dos personales sin fondo. Las partidas suman el pendiente.
import test from 'node:test'
import assert from 'node:assert/strict'
import { notariaPorLiquidar, seleccionNotaria, coberturaPersonaNotaria } from '../supabase/functions/_shared/notariaReglas.js'

const ot = (id, cli, monto, fecha, extra = {}) => ({ id, client_id: cli, type: 'gasto', category: 'Notaria', ot_number: String(100000 + id), amount: monto, date: fecha, project: '', ...extra })
const fondo = (id, cli, monto, extra = {}) => ({ id, client_id: cli, type: 'fondo', amount: monto, project: '', ...extra })
const suma = xs => xs.reduce((a, e) => a + e.amount, 0)

const base = [
  fondo('f1', 'A', 700000),
  ot(1, 'A', 400000, '2026-08-01'), ot(2, 'A', 300000, '2026-08-02'), ot(3, 'A', 200000, '2026-08-03'),   // el fondo cubre las dos primeras
  ot(4, 'B', 90000, '2026-09-01'),                                                                      // B no tiene fondo
  ot(5, null, 30000, '2026-11-16'),                                                                     // sin cliente ni persona
  ot(6, null, 10000, '2026-10-01', { personal_de: 'Ana' }), ot(7, null, 90000, '2026-10-02', { personal_de: 'Ana' }),   // personales sin fondo
]

test('cada OT pendiente cae en una sola partida y las partidas suman el pendiente', () => {
  const r = notariaPorLiquidar(base)
  assert.deepEqual(r.pagables.map(e => e.id), [1, 2])
  assert.deepEqual(r.esperan.map(e => e.id).sort(), [3, 4])
  assert.deepEqual(r.sinCliente.map(e => e.id).sort(), [5, 6, 7])
  assert.equal(r.montoPagables + r.montoEsperan + r.montoSinCliente + r.montoAsume, suma(base.filter(e => e.type !== 'fondo')))
})

test('con desempate por fecha: una OT más antigua que no cabe no deja pagar una posterior que sí cabe', () => {
  const r = notariaPorLiquidar([fondo('f', 'A', 500000), ot(1, 'A', 600000, '2026-08-01'), ot(2, 'A', 100000, '2026-08-02')])
  assert.deepEqual(r.pagables.map(e => e.id), [2])
  assert.deepEqual(r.esperan.map(e => e.id), [1])
})

test('la oficina y las incobrables se pagan completas', () => {
  const gastos = [ot(1, 'OF', 50000, '2026-08-01'), ot(2, 'C', 70000, '2026-08-02', { incobrable_at: '2026-10-13' })]
  const r = notariaPorLiquidar(gastos, { esOficina: cid => cid === 'OF' })
  assert.equal(r.pagables.length, 2)
  assert.equal(r.montoAsume, 70000)
  assert.equal(r.esperan.length, 0)
})

test('una persona con fondo propio paga sus OT; sin fondo quedan «sin cliente ni persona»', () => {
  const gastos = [fondo('fp', null, 100000, { personal_de: 'Ana' }), ot(1, null, 60000, '2026-10-01', { personal_de: 'Ana' }), ot(2, null, 60000, '2026-10-02', { personal_de: 'Ana' })]
  const r = notariaPorLiquidar(gastos)
  assert.deepEqual(r.pagables.map(e => e.id), [1])
  assert.deepEqual(r.sinCliente.map(e => e.id), [2])
  assert.equal(coberturaPersonaNotaria(gastos, 'Ana', gastos.filter(e => e.type !== 'fondo')).con, 100000)
})

test('las OT de $1 o menos no entran', () => {
  const r = notariaPorLiquidar([fondo('f', 'A', 1000), ot(1, 'A', 1, '2026-08-01')])
  assert.equal(r.pagables.length + r.esperan.length + r.sinCliente.length, 0)
})

test('seleccionNotaria: lo sugerido, menos lo sacado, más lo agregado mientras siga pendiente', () => {
  const r = notariaPorLiquidar(base)
  const pend = [...r.pagables, ...r.esperan, ...r.sinCliente]
  assert.deepEqual(seleccionNotaria(r.pagables, {}, pend), [1, 2])
  assert.deepEqual(seleccionNotaria(r.pagables, { sacadas: [1] }, pend), [2])
  assert.deepEqual(seleccionNotaria(r.pagables, { sacadas: [1], agregadas: [3] }, pend), [2, 3])
  // una OT agregada que ya no está pendiente (se liquidó) no vuelve
  assert.deepEqual(seleccionNotaria(r.pagables, { agregadas: [3] }, pend.filter(e => e.id !== 3)), [1, 2])
  // lo sugerido no se duplica si también figura como agregado
  assert.deepEqual(seleccionNotaria(r.pagables, { agregadas: [2] }, pend), [1, 2])
})
