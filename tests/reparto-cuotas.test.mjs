// Alcance de una comisión dentro de las cuotas de una venta (todas, desde un mes o cuotas elegidas). Datos anonimizados.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cuotaEntra, cuotasLibres, inferirAlcance } from '../supabase/functions/_shared/repartoCuotas.js'

const cuotas = [
  { id: 'c1', due: '2026-08-01' }, { id: 'c2', due: '2026-10-01' }, { id: 'c3', due: '2026-11-20' }, { id: 'c4', due: '2026-12-31' },
  { id: 'c5', due: '2026-12-01' }, { id: 'c6', due: '2027-03-31' }, { id: 'c7', due: '2027-03-31' }, { id: 'c8', due: '2027-06-30' },
]

test('sin alcance: entran todas las cuotas', () => {
  assert.equal(cuotasLibres({ proveedor_id: 'p' }, cuotas).length, 8)
})

test('desde un mes: entran las de ese mes en adelante', () => {
  assert.deepEqual(cuotasLibres({ desde: '2026-12' }, cuotas).map(c => c.id), ['c4', 'c5', 'c6', 'c7', 'c8'])
})

test('solo: entran únicamente las cuotas elegidas, aunque haya otras en el mismo mes', () => {
  assert.deepEqual(cuotasLibres({ solo: ['c5', 'c6'], desde: '2026-12' }, cuotas).map(c => c.id), ['c5', 'c6'])
  assert.equal(cuotaEntra({ solo: ['c5'] }, { id: 'c4', due: '2026-12-31' }), false)
})

test('las cuotas que el proveedor ya tiene pagadas salen de las libres', () => {
  const r = cuotasLibres({ proveedor_id: 'p', solo: ['c5', 'c6'] }, cuotas, new Set(['p|c5']))
  assert.deepEqual(r.map(c => c.id), ['c6'])
})

test('reabrir: todas las cuotas con comisión = sin alcance', () => {
  assert.deepEqual(inferirAlcance(cuotas.map(c => c.id), cuotas), { desde: '', solo: [] })
})

test('reabrir: de una cuota al final sin saltos = desde ese mes', () => {
  assert.deepEqual(inferirAlcance(['c6', 'c7', 'c8'], cuotas), { desde: '2027-03', solo: [] })
})

test('reabrir: cuotas salteadas o un ítem suelto = solo con las cuotas exactas (el caso que antes se pisaba)', () => {
  assert.deepEqual(inferirAlcance(['c5', 'c6'], cuotas), { desde: '', solo: ['c5', 'c6'] })
})

test('reabrir: un mes con dos cuotas donde solo una tiene comisión no se confunde con «desde»', () => {
  assert.deepEqual(inferirAlcance(['c4'], cuotas), { desde: '', solo: ['c4'] })
})
